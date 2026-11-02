#!/usr/bin/env python3
"""worker/archive.py — thư viện ảnh tư liệu lịch sử có giấy phép rõ ràng (Wikimedia Commons) + dựng cảnh 9:16 từ ảnh.

Thư viện cục bộ: data/archive/<topic>/<slug>.jpg + data/archive/<topic>/index.json (mỗi ảnh: nguồn, tác giả, giấy phép,
có cần ghi công không...). Video sau dùng lại ảnh đã có (tìm theo từ khoá trong index trước, thiếu mới tải).
Chỉ nhận: phạm vi công cộng (PD), CC0, CC BY, CC BY-SA. Loại NC/ND, "fair use", ảnh báo chí/stock, giấy phép không rõ.

Cảnh từ ảnh (compose): nền mờ + ảnh đóng khung có parallax ("frame"), cận cảnh full-bleed zoom vào điểm nhấn
("detail"), lia ngang ("pan"), hoặc nền tối cho thẻ số liệu ("backdrop"); nhãn Noto Serif + dòng ghi công nhỏ.
Xuất mp4 1080x1920 30fps, render.py dùng như clip của cảnh.

Cảnh trong video (data/videos/<id>.json):
  "archive": {"items": [{"id": "cuu-dinh/hien-lam-cac-1920s", "label": "...", "mode": "frame", "focus": [0.5, 0.4]}],
              "query": "Cửu Đỉnh Huế", "topic": "cuu-dinh"}      # query/topic: tự tìm (thư viện rồi Commons) nếu thiếu items
CLI:
  python3 worker/archive.py search "Nine Dynastic Urns" [--limit 20]
  python3 worker/archive.py fetch --topic cuu-dinh --query "Cửu Đỉnh Huế" [--n 6]
  python3 worker/archive.py add --topic cuu-dinh "File:Hiển Lâm các & Cửu Đỉnh, 1920s.jpg" [--slug hien-lam-cac-1920s] [--keywords "..."]
  python3 worker/archive.py list [--topic cuu-dinh]
  python3 worker/archive.py credits --video vid-su-20          # dòng ghi công cho caption + credits.json
  python3 worker/archive.py compose --id cuu-dinh/x --out a.mp4 --dur 6 --label "..." [--mode frame]
"""
import argparse, hashlib, html, io, json, math, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
API = "https://commons.wikimedia.org/w/api.php"
UA = "video-studio/1.0 (history shorts; contact via github.com/trungsin) python-urllib"
ALLOWED = re.compile(r"^(public domain|pd\b.*|cc0.*|cc[- ]by(-sa)?[- ]\d(\.\d)?.*)$", re.I)
BLOCKED = re.compile(r"\b(nc|nd|non-?commercial|no ?deriv|fair use|all rights reserved)\b", re.I)

def data_dir(): return os.path.abspath(os.environ.get("DATA_DIR") or os.path.join(HERE, "..", "data"))
def archive_dir(): return os.path.abspath(os.environ.get("ARCHIVE_DIR") or os.path.join(data_dir(), "archive"))

def slugify(s, maxlen=60):
    s = unicodedata.normalize("NFD", s.replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\.(jpe?g|png|tiff?|webp)$", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:maxlen].strip("-") or "img"

def plain(htm):
    t = re.sub(r"<[^>]+>", " ", htm or ""); t = html.unescape(re.sub(r"\s+", " ", t)).strip()
    return t

def license_ok(short, usage=""):
    s = (short or "").strip()
    if not s or BLOCKED.search(s) or BLOCKED.search(usage or ""): return False
    return bool(ALLOWED.match(s))

def needs_attribution(short):
    return not re.match(r"^(public domain|pd\b|cc0)", (short or "").strip(), re.I)

# ---------------------------------------------------------------- Commons API
def _api(params):
    q = urllib.parse.urlencode({"format": "json", "formatversion": "2", **params})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def _meta(page):
    ii = (page.get("imageinfo") or [{}])[0]; m = ii.get("extmetadata") or {}
    g = lambda k: (m.get(k) or {}).get("value", "")
    return {
        "title": page.get("title", ""), "page": ii.get("descriptionurl", ""), "source": "Wikimedia Commons",
        "author": plain(g("Artist")) or plain(g("Credit")) or "không rõ tác giả",
        "license": plain(g("LicenseShortName")), "licenseUrl": plain(g("LicenseUrl")),
        "usageTerms": plain(g("UsageTerms")), "date": plain(g("DateTimeOriginal"))[:40],
        "description": plain(g("ImageDescription"))[:400], "width": ii.get("width"), "height": ii.get("height"),
        "mime": ii.get("mime", ""), "thumb": ii.get("thumburl") or ii.get("url"), "sha1": ii.get("sha1", ""),
    }

IIPROP = {"prop": "imageinfo", "iiprop": "url|size|mime|sha1|extmetadata", "iiurlwidth": "2000",
          "iiextmetadatafilter": "LicenseShortName|LicenseUrl|UsageTerms|Artist|Credit|DateTimeOriginal|ImageDescription"}

def search(query, limit=20):
    """Tìm ảnh trên Commons, chỉ trả ảnh jpeg/png đủ lớn có giấy phép hợp lệ."""
    j = _api({"action": "query", "generator": "search", "gsrnamespace": "6", "gsrsearch": query, "gsrlimit": str(min(limit * 2, 50)), **IIPROP})
    pages = sorted((j.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        m = _meta(p)
        if m["mime"] not in ("image/jpeg", "image/png") or max(m["width"] or 0, m["height"] or 0) < 900: continue
        if not license_ok(m["license"], m["usageTerms"]): continue
        out.append(m)
        if len(out) >= limit: break
    return out

def file_info(title):
    t = title if title.startswith("File:") else "File:" + title
    j = _api({"action": "query", "titles": t, **IIPROP})
    pages = (j.get("query") or {}).get("pages") or []
    if not pages or pages[0].get("missing"): raise RuntimeError(f"không thấy {t} trên Commons")
    return _meta(pages[0])

# ---------------------------------------------------------------- thư viện cục bộ
def load_index(topic):
    f = os.path.join(archive_dir(), topic, "index.json")
    try:
        with open(f, encoding="utf-8") as fh: return json.load(fh)
    except FileNotFoundError: return {"topic": topic, "items": []}

def save_index(topic, idx):
    d = os.path.join(archive_dir(), topic); os.makedirs(d, exist_ok=True)
    idx["items"].sort(key=lambda x: x["id"])
    tmp = os.path.join(d, "index.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(idx, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(d, "index.json"))
    write_credits_md(topic, idx)

def write_credits_md(topic, idx):
    lines = [f"# Ghi công ảnh tư liệu · {topic}", "", "Nguồn: Wikimedia Commons. Giữ nguyên ghi công khi dùng lại (CC BY / CC BY-SA bắt buộc).", ""]
    for it in idx["items"]:
        lines.append(f"- **{it['id']}** — {it['title']} · {it['author']} · {it['license']}"
                     + (f" ({it['licenseUrl']})" if it.get("licenseUrl") else "") + f" · {it['page']}")
    with open(os.path.join(archive_dir(), topic, "CREDITS.md"), "w", encoding="utf-8") as fh: fh.write("\n".join(lines) + "\n")

def all_items():
    root = archive_dir(); out = []
    if not os.path.isdir(root): return out
    for t in sorted(os.listdir(root)):
        if os.path.isfile(os.path.join(root, t, "index.json")): out += load_index(t)["items"]
    return out

def get_item(item_id):
    topic = item_id.split("/", 1)[0]
    it = next((x for x in load_index(topic)["items"] if x["id"] == item_id), None)
    if not it: raise RuntimeError(f"không có ảnh {item_id} trong data/archive")
    return it

def item_path(it): return os.path.join(archive_dir(), it["file"])

def _download(url, dest, max_side=2000):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: data = r.read(); break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3: raise
            time.sleep(5 * (attempt + 1))
    from PIL import Image
    im = Image.open(io.BytesIO(data)); im = im.convert("RGB")
    if max(im.size) > max_side: im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(dest, "JPEG", quality=88, optimize=True)
    return im.size

def add(topic, meta, slug=None, keywords=None):
    """Lưu một ảnh (meta từ search/file_info) vào thư viện; trả item (dùng lại nếu đã có cùng sha1/tiêu đề)."""
    if not license_ok(meta["license"], meta.get("usageTerms", "")): raise RuntimeError(f"giấy phép không dùng được: {meta['license']!r} ({meta['title']})")
    idx = load_index(topic)
    old = next((x for x in idx["items"] if x["title"] == meta["title"] or (meta.get("sha1") and x.get("sha1") == meta["sha1"])), None)
    if old:
        if keywords: old["keywords"] = sorted(set(old.get("keywords", [])) | set(keywords)); save_index(topic, idx)
        return old
    slug = slug or slugify(meta["title"].replace("File:", ""))
    base, n = slug, 2
    while any(x["id"] == f"{topic}/{slug}" for x in idx["items"]): slug = f"{base}-{n}"; n += 1
    rel = f"{topic}/{slug}.jpg"; dest = os.path.join(archive_dir(), rel); os.makedirs(os.path.dirname(dest), exist_ok=True)
    w, h = _download(meta["thumb"], dest)
    it = {"id": f"{topic}/{slug}", "file": rel, "w": w, "h": h, "attributionRequired": needs_attribution(meta["license"]),
          "keywords": sorted(set(keywords or [])), "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
          **{k: meta.get(k, "") for k in ("title", "page", "source", "author", "license", "licenseUrl", "date", "description", "sha1")},
          "originalSize": [meta.get("width"), meta.get("height")]}
    idx["items"].append(it); save_index(topic, idx)
    return it

def _norm(s): return slugify(s, 400).replace("-", " ")

def find_local(query, topic=None, exclude=()):
    """Ảnh trong thư viện khớp nhiều từ khoá nhất (tiêu đề, mô tả, keywords)."""
    q = set(_norm(query).split()); best, score = None, 0
    for it in (load_index(topic)["items"] if topic else all_items()):
        if it["id"] in exclude: continue
        hay = set(_norm(" ".join([it["title"], it.get("description", ""), " ".join(it.get("keywords", []))])).split())
        s = len(q & hay) / max(len(q), 1)
        if s > score: best, score = it, s
    return best if score >= 0.5 else None

def fetch(topic, query, n=4, exclude=()):
    """Bước 'tải + cache theo từ khoá': dùng ảnh có sẵn trong thư viện, thiếu thì tải từ Commons (giấy phép hợp lệ)."""
    got = []
    loc = find_local(query, topic, exclude)
    if loc: got.append(loc)
    if len(got) >= n: return got
    for m in search(query, limit=n * 3):
        it = add(topic, m, keywords=_norm(query).split())
        if it["id"] not in exclude and it not in got: got.append(it)
        if len(got) >= n: break
    return got

def credit_line(it):
    a = re.sub(r"\s+", " ", it.get("author") or "").strip()
    a = re.sub(r"^(Unknown author|Unknown|không rõ tác giả)$", "tác giả không rõ", a, flags=re.I)
    if not it.get("attributionRequired"): return f"{a}, {it.get('date') or ''} (phạm vi công cộng), Wikimedia Commons".replace(", (", " (").replace(",  ", ", ")
    return f"{a} / Wikimedia Commons, {it['license']}"

def video_credits(v):
    """Ảnh tư liệu dùng trong video -> list item (không trùng)."""
    seen, out = set(), []
    for sc in v.get("scenes") or []:
        for x in ((sc.get("archive") or {}).get("items") or []):
            if x.get("id") and x["id"] not in seen:
                seen.add(x["id"]); out.append(get_item(x["id"]))
    return out

def caption_credits(items, short=True):
    """Dòng 'Ảnh tư liệu:' cho caption (bắt buộc với CC BY/BY-SA)."""
    if not items: return ""
    if not short: return "📷 Ảnh tư liệu: " + "; ".join(dict.fromkeys(credit_line(it) for it in items))
    # gọn để caption vừa giới hạn 500 ký tự của Threads: "Tác giả (giấy phép)", nguồn chung Wikimedia Commons
    parts = []
    for it in items:
        a = re.sub(r"\s+", " ", it.get("author") or "").strip()
        a = re.sub(r"^(Unknown author|Unknown|không rõ tác giả)$", "tác giả không rõ", a, flags=re.I)
        if it.get("attributionRequired"): parts.append(f"{a} ({it['license']})")
        else:
            d = (it.get("date") or "").strip()
            parts.append(f"{a}{', ' + d if d and d not in a else ''} (phạm vi công cộng)")
    return "📷 Ảnh tư liệu, Wikimedia Commons: " + "; ".join(dict.fromkeys(parts))

# ---------------------------------------------------------------- dựng cảnh
def _font(style="SemiBold", size=40, italic=False):
    from PIL import ImageFont
    cands = []
    for root in (os.path.join(HERE, "fonts"), "/usr/share/fonts"):
        for dp, _, fs in os.walk(root):
            for f in fs:
                fl = f.lower()
                if fl.startswith("notoserif-") and ("italic" in fl) == italic and fl.endswith(".ttf") and "display" not in fl: cands.append(os.path.join(dp, f))
    if not cands: return ImageFont.load_default()
    cands.sort(key=lambda p: ("variable" not in p.lower(), p))
    f = ImageFont.truetype(cands[0], size)
    try: f.set_variation_by_name(style)
    except Exception: pass
    return f

def _wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def plaque(label, credit, width, small=False):
    """Nhãn kiểu bảo tàng: vạch vàng + chữ Noto Serif + dòng ghi công nghiêng nhỏ, nền tối trong suốt (RGBA)."""
    from PIL import Image, ImageDraw
    ls, cs, pad = (32, 21, 20) if small else (40, 24, 28)
    fl, fc = _font("SemiBold", ls), _font("Regular", cs, italic=True)
    d0 = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    ll = _wrap(d0, label or "", fl, width - 2 * pad) if label else []
    cl = _wrap(d0, credit or "", fc, width - 2 * pad) if credit else []
    lh, ch = int(ls * 1.3), int(cs * 1.35)
    h = pad + 18 + len(ll) * lh + (6 if cl else 0) + len(cl) * ch + pad - 8
    im = Image.new("RGBA", (width, h), (12, 10, 8, 158)); d = ImageDraw.Draw(im)
    d.rectangle([pad, pad, pad + 80, pad + 3], fill=(201, 162, 39, 255))
    y = pad + 14
    for t in ll: d.text((pad, y), t, font=fl, fill=(245, 236, 214, 255)); y += lh
    y += 6 if cl else 0
    for t in cl: d.text((pad, y), t, font=fc, fill=(205, 198, 186, 235)); y += ch
    return im

def _ease(t): return 0.5 - 0.5 * math.cos(math.pi * min(max(t, 0), 1))

def _cover_affine(iw, ih, z, cx, cy):
    """Hệ số affine (PIL: toạ độ ra -> toạ độ nguồn) để phủ kín W×H, phóng z, tâm ở (cx,cy) chuẩn hoá trên ảnh nguồn."""
    s = max(W / iw, H / ih) * z
    vw, vh = W / s, H / s
    x0 = min(max(cx * iw - vw / 2, 0), iw - vw); y0 = min(max(cy * ih - vh / 2, 0), ih - vh)
    return (1 / s, 0, x0, 0, 1 / s, y0)

def _frame_layer(img, box_w=960, box_h=720, border=10):
    """Khung ảnh nằm gọn giữa tiêu đề (y≈330–470) và phụ đề (y≈1254–1434)."""
    from PIL import Image, ImageDraw, ImageFilter
    im = img.copy(); im.thumbnail((box_w - 2 * border, box_h - 2 * border), Image.LANCZOS)
    fw, fh = im.width + 2 * border, im.height + 2 * border
    sh = 40
    lay = Image.new("RGBA", (fw + 2 * sh, fh + 2 * sh), (0, 0, 0, 0))
    shadow = Image.new("RGBA", lay.size, (0, 0, 0, 0)); ImageDraw.Draw(shadow).rectangle([sh, sh + 12, sh + fw, sh + fh + 12], fill=(0, 0, 0, 170))
    lay = Image.alpha_composite(lay, shadow.filter(ImageFilter.GaussianBlur(18)))
    card = Image.new("RGBA", (fw, fh), (238, 228, 205, 255)); card.paste(im, (border, border))
    lay.alpha_composite(card, (sh, sh))
    return lay, (sh, sh, fw, fh)

def compose(items, out, dur, fps=FPS, xfade=0.5):
    """items: [{path, label, credit, mode, focus}] -> mp4 W×H dài dur giây (các ảnh chia đều, chuyển mờ xfade)."""
    from PIL import Image, ImageFilter, ImageEnhance
    import numpy as np
    n = len(items); seg = dur / n
    prepared = []
    for it in items:
        src = Image.open(it["path"]).convert("RGB"); mode = it.get("mode") or "frame"
        p = {"src": src, "mode": mode, "focus": it.get("focus") or [0.5, 0.45]}
        if mode in ("frame", "backdrop"):
            bg = src.copy(); bg.thumbnail((720, 720)); bg = bg.filter(ImageFilter.GaussianBlur(14 if mode == "frame" else 3))
            p["bg"] = ImageEnhance.Brightness(bg).enhance(0.42 if mode == "frame" else 0.38)
        if mode == "frame":
            p["layer"], p["inner"] = _frame_layer(src)
            pl = plaque(it.get("label"), it.get("credit"), p["inner"][2] - 20, small=True) if (it.get("label") or it.get("credit")) else None
            p["plaque"] = pl
        else:
            pl = plaque(it.get("label"), it.get("credit"), W - 140) if (it.get("label") or it.get("credit")) else None
            p["plaque"] = pl
        prepared.append(p)
    vig = np.ones((H, W), "float32")
    yy, xx = np.mgrid[0:H, 0:W]; r = np.sqrt(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H / 2) / (H * 0.72)) ** 2)
    vig = (1 - 0.35 * np.clip(r - 0.35, 0, 1) ** 1.5)[..., None]
    frames = int(round(dur * fps))
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def render(p, t):          # t: 0..1 trong đoạn của ảnh
        e = _ease(t); mode = p["mode"]; fx, fy = p["focus"]
        if mode in ("frame", "backdrop"):
            bg = p["bg"]; z = 1.0 + 0.07 * e
            canvas = bg.transform((W, H), Image.AFFINE, _cover_affine(bg.width, bg.height, z, 0.5, 0.5), resample=Image.BICUBIC).convert("RGBA")
            if mode == "frame":
                lay = p["layer"]; zf = 1.0 + 0.035 * e
                lw, lh = int(lay.width * zf), int(lay.height * zf)
                l2 = lay.resize((lw, lh), Image.BICUBIC)
                cx, cy = W / 2, H * 0.452 - 18 * e
                canvas.alpha_composite(l2, (int(cx - lw / 2), int(cy - lh / 2)))
                if p["plaque"] is not None:
                    sh, _, fw, fh = p["inner"]
                    px = int(cx - lw / 2 + (sh + 10) * zf); py = int(cy - lh / 2 + (sh + fh) * zf - p["plaque"].height - 10 * zf)
                    canvas.alpha_composite(_fade(p["plaque"], t, seg), (max(px, 0), py))
            elif p["plaque"] is not None:
                canvas.alpha_composite(_fade(p["plaque"], t, seg), (70, int(H * 0.755)))
            return canvas.convert("RGB")
        src = p["src"]
        if mode == "pan":
            z = 1.02; cx = 0.2 + 0.6 * e if src.width / src.height > W / H else fx; cy = fy if src.width / src.height > W / H else 0.25 + 0.5 * e
        else:   # detail: zoom chậm vào điểm nhấn
            z = 1.04 + 0.14 * e; cx, cy = 0.5 + (fx - 0.5) * e, 0.5 + (fy - 0.5) * e
        im = src.transform((W, H), Image.AFFINE, _cover_affine(src.width, src.height, z, cx, cy), resample=Image.BICUBIC).convert("RGBA")
        if p["plaque"] is not None: im.alpha_composite(_fade(p["plaque"], t, seg), (70, int(H * 0.585)))
        return im.convert("RGB")

    def _fade(pl, t, seg_d):
        a = min(max((t * seg_d - 0.5) / 0.6, 0), 1)
        if a >= 1: return pl
        q = pl.copy(); q.putalpha(pl.getchannel("A").point(lambda v: int(v * a))); return q

    try:
        for f in range(frames):
            tt = f / fps; k = min(int(tt / seg), n - 1); t = (tt - k * seg) / seg
            fr = np.asarray(render(prepared[k], t), "float32")
            # chuyển mờ sang ảnh kế tiếp trong xfade giây cuối đoạn
            if k + 1 < n and tt > (k + 1) * seg - xfade:
                a = (tt - ((k + 1) * seg - xfade)) / xfade
                nx = np.asarray(render(prepared[k + 1], 0.0), "float32"); fr = fr * (1 - a) + nx * a
            fr = np.clip(fr * vig, 0, 255).astype("uint8")
            proc.stdin.write(fr.tobytes())
    finally:
        proc.stdin.close(); rc = proc.wait()
    if rc: raise RuntimeError(f"ffmpeg compose lỗi ({rc})")
    return out

def scene_items(sc, used=()):
    """Danh sách ảnh của cảnh: items có id; nếu không có thì tìm/tải theo query + topic (bước tool theo từ khoá)."""
    a = sc.get("archive") or {}
    items = [dict(x) for x in a.get("items") or [] if x.get("id")]
    if not items and a.get("query"):
        got = fetch(a.get("topic") or slugify(a["query"])[:30], a["query"], int(a.get("n") or 1), exclude=used)
        items = [{"id": it["id"], "mode": a.get("mode") or "frame"} for it in got]
        a["items"] = items; sc["archive"] = a
    out = []
    for x in items:
        it = get_item(x["id"])
        out.append({"path": item_path(it), "label": x.get("label", ""), "credit": x.get("credit") or credit_line(it),
                    "mode": x.get("mode") or "frame", "focus": x.get("focus"), "id": it["id"]})
    return out

# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search"); s.add_argument("query"); s.add_argument("--limit", type=int, default=20); s.add_argument("--json", action="store_true")
    f = sub.add_parser("fetch"); f.add_argument("--topic", required=True); f.add_argument("--query", required=True); f.add_argument("--n", type=int, default=4)
    a = sub.add_parser("add"); a.add_argument("--topic", required=True); a.add_argument("title"); a.add_argument("--slug"); a.add_argument("--keywords", default="")
    l = sub.add_parser("list"); l.add_argument("--topic")
    c = sub.add_parser("credits"); c.add_argument("--video", required=True); c.add_argument("--out")
    m = sub.add_parser("compose"); m.add_argument("--id", action="append", required=True); m.add_argument("--out", required=True)
    m.add_argument("--dur", type=float, default=6); m.add_argument("--label", action="append", default=[]); m.add_argument("--mode", default="frame")
    x = ap.parse_args()
    if x.cmd == "search":
        res = search(x.query, x.limit)
        if x.json: print(json.dumps([{k: r.get(k) for k in ("title", "page", "author", "license", "licenseUrl", "width", "height", "thumb", "description", "date")} for r in res], ensure_ascii=False))
        else:
            for r in res: print(f"{r['title'][5:90]} | {r['width']}x{r['height']} | {r['license']} | {r['author'][:40]}")
    elif x.cmd == "fetch":
        for it in fetch(x.topic, x.query, x.n): print(it["id"], "|", it["license"], "|", it["author"][:40])
    elif x.cmd == "add":
        it = add(x.topic, file_info(x.title), x.slug, [k for k in x.keywords.split(",") if k.strip()]); print(json.dumps(it, ensure_ascii=False, indent=1))
    elif x.cmd == "list":
        for it in (load_index(x.topic)["items"] if x.topic else all_items()): print(it["id"], "|", it["license"], "|", it["author"][:40], "|", it["page"])
    elif x.cmd == "credits":
        v = json.load(open(os.path.join(data_dir(), "videos", f"{x.video}.json"), encoding="utf-8"))
        items = video_credits(v)
        rows = [{"id": i["id"], "title": i["title"], "author": i["author"], "license": i["license"], "licenseUrl": i.get("licenseUrl"),
                 "source": i["page"], "attributionRequired": i["attributionRequired"]} for i in items]
        if x.out: json.dump(rows, open(x.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(caption_credits(items)); print(json.dumps(rows, ensure_ascii=False, indent=1))
    elif x.cmd == "compose":
        its = []
        for i, iid in enumerate(x.id):
            it = get_item(iid); its.append({"path": item_path(it), "label": x.label[i] if i < len(x.label) else "", "credit": credit_line(it), "mode": x.mode})
        compose(its, x.out, x.dur); print(x.out)

if __name__ == "__main__":
    main()
