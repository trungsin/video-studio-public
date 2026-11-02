"""charts.py - animated chart frames (Pillow, 2x supersampled) for make_video.py.
Types: bar, hbar, line, donut, kpi. Effects: axis/grid fade-in, staggered eased bar growth,
count-up value labels, highlighted key item, line draw-on with glowing head dot, donut sweep,
KPI count-up with underline sweep."""
import math, os
from PIL import Image, ImageDraw, ImageFont

FD = "/usr/share/fonts/truetype/sand-box/google/Be Vietnam Pro/BeVietnamPro-"
_fc = {}
def font(sz, w="Regular"):
    k = (sz, w)
    if k not in _fc:
        try: _fc[k] = ImageFont.truetype(FD + w + ".ttf", sz)
        except OSError: _fc[k] = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", sz)
    return _fc[k]

def ass2rgb(c):  # "&HBBGGRR&" -> (r,g,b)
    h = c.strip("&H").rjust(6, "0")[-6:]
    return (int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16))

def mix(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
def clamp(x): return max(0.0, min(1.0, x))
def ease_out(t): t = clamp(t); return 1 - (1 - t) ** 3
def ease_io(t): t = clamp(t); return 4*t*t*t if t < .5 else 1 - (-2*t + 2) ** 3 / 2
def ease_back(t):
    t = clamp(t); c = 1.70158
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2

def fmt(v, dec, unit):
    s = f"{v:,.{dec}f}".replace(",", "_").replace(".", ",").replace("_", ".") if dec else f"{int(round(v))}"
    return s + unit

def palette(st):
    text = ass2rgb(st["text"]); acc = ass2rgb(st["accent"]); bg = int(st["bg"], 16)
    bgc = ((bg >> 16) & 255, (bg >> 8) & 255, bg & 255)
    dark = sum(bgc) < 3 * 128
    card = mix(bgc, (255, 255, 255), 0.07) if dark else mix(bgc, (255, 255, 255), 0.6)
    return dict(text=text, acc=acc, muted=mix(text, card, 0.6) if dark else mix(acc, bgc, 0.45),
                grid=mix(text, card, 0.82), sub=mix(text, card, 0.4), card=card, bg=bgc, dark=dark)

def render_frame(ch, t, W, H, P, S=2):
    """t in [0,1] animation progress (1 = final state). Returns RGBA image W x H."""
    im = Image.new("RGBA", (W*S, H*S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    a_in = ease_out(t / 0.15)  # card + axis fade-in
    A = lambda c, a=1.0: c + (int(255 * a * a_in),)
    # card
    if ch.get("bleed"):   # full-bleed image: no card/caption
        _image(d, ch, t, (0, 0, W*S, H*S), P, S, A)
        return im.resize((W, H), Image.LANCZOS)
    d.rounded_rectangle([0, 0, W*S-1, H*S-1], radius=28*S, fill=A(P["card"], 1.0 if P.get("dark") else 0.92), outline=A(P["grid"], 1), width=2*S)
    pad = 44*S; top = pad
    if ch.get("caption") and ch["type"] != "terminal":
        d.text((pad, top), ch["caption"], font=font(30*S, "SemiBold"), fill=A(P["text"]))
        top += 52*S
    bottom = H*S - pad - (34*S if ch.get("source") else 0)
    if ch.get("source"):
        d.text((pad, H*S - pad - 22*S), "Nguồn: " + ch["source"], font=font(19*S), fill=A(P["sub"]))
    box = (pad, top + 10*S, W*S - pad, bottom)
    {"bar": _bar, "hbar": _hbar, "line": _line, "donut": _donut, "kpi": _kpi,
     "image": _image, "terminal": _terminal}[ch["type"]](d, ch, t, box, P, S, A)
    return im.resize((W, H), Image.LANCZOS)

def _hl(ch, i, n):
    hs = ch.get("highlight", [])
    return any((h if h >= 0 else n + h) == i for h in hs)

def _bar(d, ch, t, box, P, S, A):
    x0, y0, x1, y1 = box; vals = ch["values"]; labs = ch["labels"]; n = len(vals)
    lab_h = 36*S; y1b = y1 - lab_h; vmax = max(vals) * 1.15
    for k in range(1, 4):  # grid
        gy = y1b - (y1b - y0) * k / 4
        d.line([x0, gy, x1, gy], fill=A(P["grid"], 0.8), width=S)
    d.line([x0, y1b, x1, y1b], fill=A(P["sub"]), width=2*S)
    slot = (x1 - x0) / n; bw = slot * 0.62
    for i, v in enumerate(vals):
        p = ease_out((t - 0.12 - i * 0.45 / n) / 0.4)
        cx = x0 + slot * (i + 0.5); hl = _hl(ch, i, n)
        col = P["acc"] if hl or not ch.get("highlight") else P["muted"]
        h = (y1b - y0) * v / vmax * p
        if h > 1: d.rounded_rectangle([cx - bw/2, y1b - h, cx + bw/2, y1b], radius=min(8*S, h/2), fill=A(col))
        f = font((24 if n > 8 else 28)*S, "Bold" if hl else "Medium")
        if p > 0.05:
            s = fmt(v * p, ch.get("dec", 0), ch.get("unit", ""))
            d.text((cx, y1b - h - 8*S), s, font=f, anchor="md", fill=A(P["acc"] if hl else P["text"], clamp(p * 1.5)))
        d.text((cx, y1b + 10*S), labs[i], font=font((18 if n > 10 else 22)*S), anchor="ma", fill=A(P["sub"]))

def _hbar(d, ch, t, box, P, S, A):
    x0, y0, x1, y1 = box; vals = ch["values"]; labs = ch["labels"]; n = len(vals)
    lw = max(d.textlength(l, font=font(26*S)) for l in labs) + 24*S
    bx0 = x0 + lw; vmax = max(vals) * 1.18; slot = (y1 - y0) / n; bh = min(slot * 0.58, 70*S)
    d.line([bx0, y0, bx0, y1], fill=A(P["sub"]), width=2*S)
    for i, v in enumerate(vals):
        p = ease_out((t - 0.12 - i * 0.4 / n) / 0.4); hl = _hl(ch, i, n)
        col = P["acc"] if hl or not ch.get("highlight") else P["muted"]
        cy = y0 + slot * (i + 0.5); w = (x1 - bx0) * v / vmax * p
        d.text((bx0 - 14*S, cy), labs[i], font=font(26*S, "SemiBold" if hl else "Regular"), anchor="rm", fill=A(P["text"]))
        if w > 1: d.rounded_rectangle([bx0, cy - bh/2, bx0 + w, cy + bh/2], radius=min(8*S, w/2), fill=A(col))
        if p > 0.05:
            d.text((bx0 + w + 12*S, cy), fmt(v * p, ch.get("dec", 0), ch.get("unit", "")),
                   font=font(28*S, "Bold" if hl else "Medium"), anchor="lm", fill=A(P["acc"] if hl else P["text"], clamp(p*1.5)))

def _line(d, ch, t, box, P, S, A):
    x0, y0, x1, y1 = box; vals = ch["values"]; labs = ch["labels"]; n = len(vals)
    lab_h = 36*S; y1b = y1 - lab_h; vmin, vmax = min(vals), max(vals); rng = (vmax - vmin) or 1
    lo, hi = vmin - rng * 0.25, vmax + rng * 0.3
    X = lambda i: x0 + 30*S + (x1 - x0 - 60*S) * i / (n - 1)
    Y = lambda v: y1b - (y1b - y0) * (v - lo) / (hi - lo)
    for k in range(1, 4):
        gy = y1b - (y1b - y0) * k / 4; d.line([x0, gy, x1, gy], fill=A(P["grid"], 0.8), width=S)
    d.line([x0, y1b, x1, y1b], fill=A(P["sub"]), width=2*S)
    step = max(1, math.ceil(n / 8))
    for i in range(n):
        if i % step == 0 or i == n - 1:
            d.text((X(i), y1b + 10*S), labs[i], font=font(20*S), anchor="ma", fill=A(P["sub"]))
    p = ease_io((t - 0.12) / 0.75) * (n - 1)  # draw-on progress in point units
    if p <= 0: return
    k = int(p); fr = p - k
    pts = [(X(i), Y(vals[i])) for i in range(k + 1)]
    if k < n - 1: pts.append((X(k) + (X(k+1) - X(k)) * fr, Y(vals[k] + (vals[k+1] - vals[k]) * fr)))
    # soft area under line
    if len(pts) > 1:
        area = Image.new("RGBA", d._image.size, (0, 0, 0, 0))
        ImageDraw.Draw(area).polygon(pts + [(pts[-1][0], y1b), (pts[0][0], y1b)], fill=P["acc"] + (38,))
        d._image.alpha_composite(area)
        d.line(pts, fill=A(P["acc"]), width=6*S, joint="curve")
    every = ch.get("label_every", 1 if n <= 10 else 2)
    for i in range(k + 1):
        cx, cy = X(i), Y(vals[i]); hl = _hl(ch, i, n)
        pop = ease_back(clamp((p - i) / 0.6 + 0.4)); r = (9 if hl else 6) * S * pop
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=A(P["card"]), outline=A(P["acc"]), width=3*S)
        if hl or i % every == 0 or i == n - 1 or vals[i] in (vmax, vmin) and vals.index(vals[i]) == i:
            d.text((cx, cy - 18*S), fmt(vals[i], ch.get("dec", 0), ch.get("unit", "")),
                   font=font((30 if hl else 22)*S, "Bold" if hl else "Medium"), anchor="md",
                   fill=A(P["acc"] if hl else P["text"], clamp(pop)))
    hx, hy = pts[-1]
    if k < n - 1:  # glowing head dot (trail)
        for r, a in ((22, 50), (14, 110)):
            d.ellipse([hx - r*S, hy - r*S, hx + r*S, hy + r*S], fill=P["acc"] + (a,))
        d.ellipse([hx - 7*S, hy - 7*S, hx + 7*S, hy + 7*S], fill=A(P["acc"]))

def _donut(d, ch, t, box, P, S, A):
    x0, y0, x1, y1 = box; vals = ch["values"]; labs = ch["labels"]; n = len(vals)
    tot = sum(vals); R = min((y1 - y0) / 2 * 0.9, (x1 - x0) * 0.27); cx = x0 + R + 20*S; cy = (y0 + y1) / 2
    cols = ch.get("colors") or [mix(P["acc"], P["bg"], k / max(n, 1) * 0.8) for k in range(n)]
    hlidx = [(h if h >= 0 else n + h) for h in ch.get("highlight", [0])]
    sweep = ease_io((t - 0.1) / 0.7) * 360; ang = -90; th = R * 0.36
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=A(P["grid"]), width=int(th))
    for i, v in enumerate(vals):
        span = 360 * v / tot; e = min(ang + span, -90 + sweep)
        col = P["acc"] if i in hlidx else cols[i] if ch.get("colors") else mix(P["acc"], P["bg"], 0.35 + 0.45 * (i / n))
        if e > ang:
            rr = R + (8*S if i in hlidx else 0)
            d.arc([cx - rr, cy - rr, cx + rr, cy + rr], ang, e, fill=A(col), width=int(th + (8*S if i in hlidx else 0)))
        ang += span
    hi = hlidx[0]; pv = ease_out((t - 0.2) / 0.6)
    d.text((cx, cy - 8*S), fmt(vals[hi] * pv, ch.get("dec", 0), ch.get("unit", "")), font=font(64*S, "Bold"), anchor="mm", fill=A(P["acc"]))
    fc = 24
    while fc > 14 and d.textlength(labs[hi], font=font(fc*S, "Medium")) > R * 1.15: fc -= 1
    d.text((cx, cy + 44*S), labs[hi], font=font(fc*S, "Medium"), anchor="mm", fill=A(P["sub"]))
    fl = 28
    while fl > 16 and max(d.textlength(f"{l}  {fmt(v, ch.get('dec',0), ch.get('unit',''))}", font=font(fl*S, "SemiBold")) for l, v in zip(labs, vals)) > x1 - (cx + R + 110*S): fl -= 1
    lx = cx + R + 70*S; ly0 = cy - n * 30*S
    for i, v in enumerate(vals):  # legend slides in
        q = ease_out((t - 0.3 - i * 0.08) / 0.3); ly = ly0 + i * 60*S
        col = P["acc"] if i in hlidx else mix(P["acc"], P["bg"], 0.35 + 0.45 * (i / n))
        d.rounded_rectangle([lx, ly, lx + 26*S, ly + 26*S], radius=6*S, fill=A(col, q))
        d.text((lx + 40*S - (1 - q) * 30*S, ly + 13*S), f"{labs[i]}  {fmt(v, ch.get('dec',0), ch.get('unit',''))}",
               font=font(fl*S, "SemiBold" if i in hlidx else "Regular"), anchor="lm", fill=A(P["text"], q))

def _wrap(d, text, f, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

def _kpi(d, ch, t, box, P, S, A):
    x0, y0, x1, y1 = box; vals = ch["values"]; labs = ch["labels"]; n = len(vals)
    cw = (x1 - x0) / n
    for i, v in enumerate(vals):
        q = ease_out((t - 0.1 - i * 0.15) / 0.6); cx = x0 + cw * (i + 0.5); cy = (y0 + y1) / 2 - 30*S
        u = ch["units"][i] if ch.get("units") else ch.get("unit", ""); dc = ch["decs"][i] if ch.get("decs") else ch.get("dec", 0)
        pre = ""
        if u.startswith("^"): pre, u = u[1:], ""
        num = f"{int(round(v*q)):,}".replace(",", ".") if v >= 1000 and not dc else fmt(v * q, dc, "")
        final = f"{int(round(v)):,}".replace(",", ".") if v >= 1000 and not dc else fmt(v, dc, "")
        fs = 120
        while fs > 40 and d.textlength(pre + final + u, font=font(fs*S, "Bold")) > cw * 0.9: fs -= 4
        fn = font(fs*S, "Bold"); fu = font(int(fs*0.5)*S, "Bold")
        wn = d.textlength(pre + num, font=fn); wu = d.textlength(u, font=fu) if u else 0
        sx = cx - (wn + wu) / 2; col = A(P["acc"], clamp(q * 2))
        d.text((sx, cy), pre + num, font=fn, anchor="ls", fill=col)
        if u: d.text((sx + wn + 4*S, cy), u, font=fu, anchor="ls", fill=col)
        lw = cw * 0.5 * ease_out((t - 0.3 - i * 0.15) / 0.4)
        d.rounded_rectangle([cx - lw/2, cy + 26*S, cx + lw/2, cy + 34*S], radius=4*S, fill=A(P["acc"]))
        fl = font(28*S, "Medium")
        for j, line in enumerate(_wrap(d, labs[i], fl, cw * 0.86)):
            d.text((cx, cy + 74*S + j * 38*S), line, font=fl, anchor="mm", fill=A(P["text"], clamp(q * 2)))

_imgc = {}
def _image(d, ch, t, box, P, S, A):
    """Slide/screenshot with Ken Burns (zoom: in|out, default in) over the whole scene, fade-in."""
    x0, y0, x1, y1 = [int(v) for v in box]; bw, bh = x1 - x0, y1 - y0
    if ch["src"] not in _imgc: _imgc[ch["src"]] = Image.open(ch["src"]).convert("RGB")
    im = _imgc[ch["src"]]; iw, ih = im.size
    e = ease_io(t); z = 1.0 + 0.10 * (e if ch.get("zoom", "in") == "in" else 1 - e)
    if ch.get("fit", "contain") == "cover":
        base = max(bw / iw, bh / ih); tw, th = bw, bh
    else:
        base = min(bw / iw, bh / ih); tw, th = int(iw * base), int(ih * base)
    cw_, chh_ = tw / (base * z), th / (base * z)
    cxs = iw / 2 + (iw - cw_) * 0.5 * (e - 0.5); cys = ih / 2
    crop = im.crop((int(cxs - cw_/2), int(cys - chh_/2), int(cxs + cw_/2), int(cys + chh_/2))).resize((tw, th), Image.BILINEAR)
    x0 += (bw - tw) // 2; y0 += (bh - th) // 2; x1, y1, bw, bh = x0 + tw, y0 + th, tw, th
    rad = 0 if ch.get("bleed") else 18*S
    mask = Image.new("L", (bw, bh), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw-1, bh-1], radius=rad, fill=int(255 * ease_out(t / 0.06)))
    d._image.paste(crop, (x0, y0), mask)
    if not ch.get("bleed"): d.rounded_rectangle([x0, y0, x1, y1], radius=18*S, outline=A(P["grid"]), width=2*S)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
def _terminal(d, ch, t, box, P, S, A):
    """Terminal window. '$ ' lines typed char by char, others appear as output.
    Font auto-shrinks (26->17 px) to fit long lines, then lines wrap; window scrolls so the newest
    rows stay visible (max_rows caps visible rows)."""
    x0, y0, x1, y1 = box; lines = ch.get("lines", [])
    d.rounded_rectangle([x0, y0, x1, y1], radius=16*S, fill=A((24, 28, 36)))
    d.rounded_rectangle([x0, y0, x1, y0 + 44*S], radius=16*S, fill=A((44, 50, 62)))
    d.rectangle([x0, y0 + 28*S, x1, y0 + 44*S], fill=A((44, 50, 62)))
    for k, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x0 + (22 + k*26)*S, y0 + 14*S, x0 + (38 + k*26)*S, y0 + 30*S], fill=A(c))
    if ch.get("caption"):
        d.text(((x0 + x1) / 2, y0 + 22*S), ch["caption"], font=font(20*S, "Medium"), anchor="mm", fill=A((170, 178, 190)))
    tx = x0 + 30*S; avail = x1 - 30*S - tx
    longest = max([len(l) for l in lines] + [1])
    fs = 26
    while fs > 17 and ImageFont.truetype(MONO, fs*S).getlength("M") * min(longest + 2, 58) > avail: fs -= 1
    f = ImageFont.truetype(MONO, fs*S); cwid = f.getlength("M"); cols = max(10, int(avail / cwid))
    lh = int(fs * 1.62) * S; top = y0 + 62*S
    rows_fit = max(3, int((y1 - 16*S - top) / lh)); max_rows = min(rows_fit, int(ch.get("max_rows", rows_fit)))
    def wrap(l, ind):  # hard-wrap to cols, continuation rows indented
        out = [l[:cols]]; l = l[cols:]
        while l: out.append(" " * ind + l[:cols - ind]); l = l[cols - ind:]
        return out
    cost = [len(l) if l.startswith("$ ") else 12 for l in lines]; tot = sum(cost) or 1
    budget = clamp((t - 0.08) / 0.85) * tot; rows = []   # (text, color, is_prompt_first)
    for l, c in zip(lines, cost):
        if budget <= 0: break
        if l.startswith("$ "):
            n = int(min(len(l), budget)); txt = l[:n]
            for k, r in enumerate(wrap(txt, 4)): rows.append((r, "cmd", k == 0))
        else:
            col = "ok" if l.startswith(("✓", "OK", "→")) else "out"
            for r in wrap(l, 2): rows.append((r, col, False))
        budget -= c
    vis = rows[-max_rows:]; y = top; cur = None
    colors = {"cmd": (235, 238, 242), "ok": (140, 200, 255), "out": (170, 178, 190)}
    for r, col, first in vis:
        if col == "cmd" and first:
            d.text((tx, y), "$", font=f, fill=A((39, 201, 63))); d.text((tx + 2*cwid, y), r[2:], font=f, fill=A(colors[col]))
        else:
            d.text((tx, y), r, font=f, fill=A(colors[col]))
        cur = (tx + d.textlength(r, font=f), y); y += lh
    if len(rows) > len(vis):   # scrolled: fade hint at top
        d.text((x1 - 40*S, top - 14*S), "⋮", font=f, fill=A((110, 118, 130)))
    if cur and (t > 0.95 and int(t * 12) % 2 == 0 or t <= 0.95):
        ch_ = int(fs * 1.25) * S
        d.rectangle([cur[0] + 4*S, cur[1] + 4*S, cur[0] + 4*S + cwid * 0.55, cur[1] + ch_], fill=A((235, 238, 242)))

def _frame_bytes(args):
    ch, t, W, H, P, S = args
    return render_frame(ch, t, W, H, P, S).tobytes()

_POOL = None
def render_to_video(ch, out, W, H, P, dur, fps=30, S=2, workers=None):
    """Render frames in parallel and pipe raw RGBA to ffmpeg -> lossless qtrle .mov with alpha."""
    import subprocess, multiprocessing as mp
    global _POOL
    N = max(2, int(dur * fps))
    if _POOL is None: _POOL = mp.get_context("fork").Pool(workers or os.cpu_count())
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}",
                          "-r", str(fps), "-i", "-", "-c:v", "qtrle", out], stdin=subprocess.PIPE)
    for b in _POOL.imap(_frame_bytes, [(ch, f / (N - 1), W, H, P, S) for f in range(N)], chunksize=4):
        p.stdin.write(b)
    p.stdin.close(); p.wait()
    if p.returncode: raise RuntimeError("ffmpeg chart encode failed")
    return N

def render_sequence(ch, outdir, W, H, P, dur, fps=30):
    """Write frames 0000.png.. for an animation of `dur` seconds (last frame = final state)."""
    os.makedirs(outdir, exist_ok=True); N = max(2, int(dur * fps))
    for f in range(N):
        render_frame(ch, f / (N - 1), W, H, P).save(os.path.join(outdir, f"{f:04d}.png"), compress_level=1)
    return N
