#!/usr/bin/env python3
"""worker/render.py — render một job video 9:16 từ data/videos/<id>.json.

  python3 worker/render.py --video vid-xxx [--data ./data] [--media ./media] [--copy-to out/sample.mp4]

Quy trình (ý tưởng lấy từ skill tts-motion-video):
  1. TTS từng cảnh: edge-tts (vi-VN-HoaiMyNeural / NamMinhNeural, có mốc thời gian từng từ) hoặc
     VieNeu qua Gradio (VIENEU_GRADIO_URL, đồng bộ theo cụm câu; lỗi thì quay về edge-tts).
  2. Hình mỗi cảnh: ảnh upload/tư liệu (Ken Burns; ảnh nhỏ được phóng lanczos + làm nét), clip upload (cắt/khớp thời lượng),
     cảnh chưa có hình thì sinh ảnh AI từ `visual`. Nền gradient (placeholder) chỉ khi chưa cấu hình API ảnh;
     đã cấu hình mà sinh ảnh lỗi thì render dừng với lỗi, không xuất video có cảnh trống.
  3. Phụ đề ASS: tiêu đề động (pop + trượt), chữ chạy theo từng từ (từ đang đọc đổi màu, phóng to),
     chip tên kênh, thanh tiến độ.
     Ảnh AI gửi kèm ảnh ref nhân vật + bối cảnh (profile.cast) qua worker/media_gen.py; cảnh motion="video"
     thử image-to-video (VIDEO_PROVIDER), không có thì Ken Burns (zoom vào/ra, lia ngang/dọc).
  4. Ghép: nền + lớp tối + ASS + giọng (+ nhạc nền tự tổng hợp, tự giảm khi có giọng) -> H.264/AAC, faststart.
Worker ghi tiến độ vào render.{state,progress,log} của file JSON (ghi nguyên tử).
"""
import argparse, asyncio, json, os, re, shutil, subprocess, sys, tempfile, time, hashlib, urllib.request, base64
from datetime import datetime, timezone

W, H, FPS = 1080, 1920, 30
FONT = os.environ.get("FONT_NAME", "Be Vietnam Pro")
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.environ.get("FONTS_DIR", os.path.join(HERE, "fonts"))

# ---------------------------------------------------------------- job state
class Job:
    def __init__(self, data_dir, media_dir, vid):
        self.path = os.path.join(data_dir, "videos", f"{vid}.json")
        self.data_dir, self.media_dir, self.vid = data_dir, media_dir, vid
        self.logs = []

    def load(self):
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def update(self, **render):
        """Đọc lại file (web có thể vừa sửa), chỉ ghi đè phần render/status."""
        v = self.load()
        status = render.pop("_status", None)
        v["render"] = {**v.get("render", {}), **render, "log": self.logs[-30:]}
        if status: v["status"] = status
        v["updatedAt"] = now()
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(v, f, ensure_ascii=False, indent=2); f.write("\n")
        os.replace(tmp, self.path)

    def set_scene(self, idx, **kw):
        """Ghi lại ảnh/clip đã sinh cho cảnh idx để lần render sau dùng lại (không sinh lại tốn tiền)."""
        v = self.load()
        if 0 <= idx < len(v.get("scenes", [])):
            v["scenes"][idx].update(kw)
            tmp = f"{self.path}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(v, f, ensure_ascii=False, indent=2); f.write("\n")
            os.replace(tmp, self.path)

    def set_video(self, **kw):
        """Ghi một số trường cấp video (VD credits ảnh tư liệu)."""
        v = self.load(); v.update(kw); v["updatedAt"] = now()
        tmp = f"{self.path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(v, f, ensure_ascii=False, indent=2); f.write("\n")
        os.replace(tmp, self.path)

    def log(self, msg, progress=None):
        line = f"{datetime.now().strftime('%H:%M:%S')} {msg}"
        print(line, flush=True); self.logs.append(line)
        kw = {"state": "running"}
        if progress is not None: kw["progress"] = round(progress, 3)
        self.update(**kw)

def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{os.path.basename(cmd[0])} lỗi: {p.stderr.strip()[-600:]}")
    return p.stdout

def probe_dur(f):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).strip())

# ---------------------------------------------------------------- TTS
async def _edge(text, voice, rate, mp3):
    import edge_tts
    c = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(mp3, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["offset"] / 1e7, (ch["offset"] + ch["duration"]) / 1e7, ch["text"]))
    return words

# Edge-tts có thể trả luồng bị ngắt giữa chừng: file vẫn hợp lệ nhưng thiếu cuối câu (VD mất câu kết).
# Bình thường edge trả ≥ 97% số từ của văn bản; dưới ngưỡng này coi là bị cắt.
MIN_WORD_RATIO = 0.85
# Giọng Việt bình thường ~3.5-4.5 âm tiết/giây; nhanh hơn ngưỡng này nghĩa là đoạn âm thanh bị cắt ngắn.
MAX_SYLLABLES_PER_SEC = 9.0

def spoken_tokens(text):
    return [t for t in text.split() if re.search(r"\w", t)]

def speech_complete(words, text):
    """Đủ lời: số từ có mốc thời gian không ít hơn MIN_WORD_RATIO số từ của văn bản."""
    n = len(spoken_tokens(text))
    return n == 0 or len(words) >= MIN_WORD_RATIO * n

def _edge_cache_key(text, voice, rate):
    # Cùng khoá với tts_local.edge_tts_all (mvlib là mã vendor, không sửa ở đây).
    return os.path.join(tts_local._cache_dir(), "edge_" + hashlib.sha1(f"{voice}|{rate}|{text}".encode()).hexdigest())

def tts_edge(text, voice, rate, out):
    if not voice.startswith(("vi-VN", "en-")): voice = "vi-VN-HoaiMyNeural"
    rate = rate or "+0%"
    try:   # cache theo hash (voice|rate|text) dùng chung với motion-video
        words = [tuple(w) for w in asyncio.run(tts_local.edge_tts_all([(text, voice, rate, out)]))[0]]
        if speech_complete(words, text): return words
        print(f"edge cache thiếu lời ({len(words)}/{len(spoken_tokens(text))} từ): xoá cache, đọc lại")
        for ext in (".mp3", ".json"):
            try: os.remove(_edge_cache_key(text, voice, rate) + ext)
            except FileNotFoundError: pass
    except Exception as e:
        print("edge cache path failed:", e)
    got = 0
    for attempt in range(3):
        try:
            words = asyncio.run(_edge(text, voice, rate, out))
            if words and os.path.getsize(out) > 1000 and speech_complete(words, text): return words
            got = len(words)
        except Exception as e:
            if attempt == 2: raise RuntimeError(f"edge-tts lỗi: {e}")
        time.sleep(2 * (attempt + 1))
    # Không xuất video thiếu lời: render dừng với lỗi để không bị duyệt/đăng.
    raise RuntimeError(f"edge-tts không trả đủ lời ({got}/{len(spoken_tokens(text))} từ) sau 3 lần")

def split_phrases(text, maxw=14):
    out = []
    for seg in re.findall(r"[^.!?;,:]+[.!?;,:]*", text):
        ws = seg.split(); n = -(-len(ws) // maxw) or 1; size = -(-len(ws) // n)
        for j in range(0, len(ws), size): out.append(" ".join(ws[j:j + size]))
    return [o for o in out if re.search(r"\w", o)]

def tts_vieneu(text, voice, out, tmp):
    """VieNeu-TTS Gradio (không có mốc từng từ): tổng hợp theo cụm, đo độ dài, chia thời gian theo số ký tự."""
    url = os.environ.get("VIENEU_GRADIO_URL")
    if not url: raise RuntimeError("chưa đặt VIENEU_GRADIO_URL")
    from gradio_client import Client
    client = Client(url, verbose=False)
    cdir = os.path.join(tmp, "vn"); os.makedirs(cdir, exist_ok=True)
    words, clips, t = [], [], 0.0
    for k, ph in enumerate(split_phrases(text)):
        clip = os.path.join(cdir, f"{k}.wav")
        n = len(spoken_tokens(ph))
        for attempt in range(3):
            r = client.predict(ph, voice, None, "", "Standard (Một lần)", True, 16, 0.8, 256, True, api_name="/wrapper")
            src = r[0] if isinstance(r, (list, tuple)) else r
            if isinstance(src, dict): src = src.get("path") or src.get("value")
            run(["ffmpeg", "-y", "-v", "error", "-i", src, "-af",
                 "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.2",
                 "-ar", "48000", "-ac", "2", clip])
            d = probe_dur(clip)
            # Cụm ngắn (< 4 âm tiết) có thể đọc nhanh tự nhiên; chỉ kiểm tra cụm đủ dài.
            if n < 4 or n / max(d - 0.2, 0.1) <= MAX_SYLLABLES_PER_SEC: break
            print(f"VieNeu cụm {k + 1} quá ngắn ({n} âm tiết / {d:.1f}s), đọc lại")
        else:
            raise RuntimeError(f"VieNeu trả âm thanh bị cắt ở cụm {k + 1} sau 3 lần")
        toks = ph.split(); tot = sum(len(x) for x in toks) or 1
        speak = max(d - 0.2, 0.1); u = t
        for w in toks:
            dd = speak * len(w) / tot; words.append((u, u + dd, w)); u += dd
        t += d; clips.append(clip)
    lst = os.path.join(cdir, "list.txt"); open(lst, "w").write("".join(f"file '{c}'\n" for c in clips))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
    return words

def attach_punct(words, text):
    """Gắn lại dấu câu/hoa thường từ văn bản gốc vào từ của edge-tts."""
    toks = text.split(); out = []; i = 0
    for (a, b, w) in words:
        if i < len(toks) and re.sub(r"\W", "", toks[i].lower()).startswith(re.sub(r"\W", "", w.lower())[:1] or "x"):
            out.append((a, b, toks[i])); i += 1
        else: out.append((a, b, w))
    return out

# ---------------------------------------------------------------- visuals
def hex_rgb(h, default=(40, 40, 60)):
    m = re.match(r"#?([0-9a-fA-F]{6})", h or "")
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4)) if m else default

def placeholder_bg(path, colors, k, label):
    """Nền gradient theo màu thương hiệu + đốm sáng mềm. Ghi chú prompt ảnh nhỏ phía trên (placeholder)."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    import numpy as np
    c1 = np.array(colors[k % len(colors)], float); c2 = np.array(colors[(k + 1) % len(colors)], float)
    y = np.linspace(0, 1, H)[:, None, None]; x = np.linspace(0, 1, W)[None, :, None]
    t = np.clip(0.65 * y + 0.35 * x, 0, 1)
    img = (c1 * (1 - t) + c2 * t)
    im = Image.fromarray(img.astype("uint8"), "RGB")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    rnd = int(hashlib.md5(f"{label}{k}".encode()).hexdigest()[:8], 16)
    for j in range(5):
        r = 180 + (rnd >> (j * 3)) % 260; cx = (rnd >> (j * 5)) % W; cy = (rnd >> (j * 4)) % H
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 38))
    ov = ov.filter(ImageFilter.GaussianBlur(70))
    im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
    if label:
        try: f = ImageFont.truetype(find_font("BeVietnamPro-Medium.ttf") or "", 30)
        except Exception: f = ImageFont.load_default()
        d2 = ImageDraw.Draw(im)
        txt = ("Ảnh minh hoạ: " + label)[:70]
        d2.rounded_rectangle([60, 250, 60 + d2.textlength(txt, font=f) + 40, 305], 14, fill=(0, 0, 0))
        d2.text((80, 258), txt, font=f, fill=(255, 255, 255))
    im.save(path, quality=92)

def find_font(name):
    for root in (FONTS_DIR, "/usr/share/fonts"):
        for dp, _, fs in os.walk(root):
            if name in fs: return os.path.join(dp, name)
    return None

sys.path.insert(0, HERE)
import tts_qc  # noqa: E402  (kiểm tra từng câu TTS: rè, chèn/mất từ, kéo dài)
import gemini_listen  # noqa: E402  (tuỳ chọn: Gemini nghe lại, bắt lỗi phát âm / thanh điệu)
import media_gen  # noqa: E402  (adapter ảnh/video: openai, xai, hf-kontext)
import archive  # noqa: E402  (ảnh tư liệu Wikimedia Commons: thư viện data/archive + dựng cảnh parallax/zoom)
MVLIB = os.path.join(HERE, "mvlib")   # module dùng chung, vendor từ skill motion-video (scripts/sync-mvlib.sh)
sys.path.insert(0, MVLIB)
os.environ.setdefault("MV_MODELS_DIR", os.path.join(MVLIB, "models"))
import vn_norm, tts_local  # noqa: E402

def has_mod(name):
    import importlib.util
    try: return importlib.util.find_spec(name) is not None
    except Exception: return False

def spoken_text(raw, pron):
    """Chuẩn hoá từng token để đọc nhưng giữ nguyên dấu ngắt [pause] / [pause 0.3] (không tách "[pause" và "0.3]")."""
    toks = [t for t in re.split(r"(\[pause(?:\s+[\d.]+)?\])|\s+", raw, flags=re.I) if t]
    return " ".join(t if vn_norm.PAUSE.fullmatch(t) else norm_tok(t, pron) for t in toks)

def load_pron(data_dir):
    """Từ điển phát âm: worker/mvlib/pronounce.txt + data/pronounce.txt (team sửa được, ưu tiên).
    Khoá TOÀN CHỮ HOA (AI, TTS) chỉ khớp token viết hoa (vn_norm.is_acronym), nên đại từ "ai" không thành "ây ai"."""
    d = vn_norm.load_dict(os.path.join(MVLIB, "pronounce.txt"))
    d.update(vn_norm.load_dict(os.path.join(data_dir, "pronounce.txt"))); return d

def norm_tok(tok, pron):
    return vn_norm.norm_token(tok, pron)

def scene_clip(src, dur, out, k, is_video, clip_start=0.0, max_slow=1.4):
    """Ra clip nền W×H, FPS, dài dur giây. Ảnh: Ken Burns. Clip (cảnh type "clip"): cover-crop 9:16, bỏ tiếng,
    khớp thời lượng bằng cách chậm lại tối đa max_slow lần (hoặc nhanh lên tối đa 1.25), thiếu thì giữ khung cuối."""
    frames = max(int(round(dur * FPS)), 1)
    cover = f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}"
    if is_video:
        try: cd = probe_dur(src) - clip_start
        except Exception: cd = dur
        f = min(max(dur / max(cd, 0.1), 0.8), max_slow)  # >1 = chậm lại
        vf = (f"trim=start={clip_start:.3f},setpts={f:.4f}*(PTS-STARTPTS),{cover},fps={FPS},"
              f"tpad=stop_mode=clone:stop_duration={dur:.3f},trim=duration={dur:.3f},setsar=1,format=yuv420p")
        run(["ffmpeg", "-y", "-v", "error", "-i", src, "-map", "0:v:0", "-an", "-vf", vf,
             "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15", "-threads", "2", out])   # trung gian: nhanh, gần lossless
        return
    # Ken Burns: luân phiên zoom vào, zoom ra, lia ngang, lia dọc (trên ảnh đã phóng 1.5x để chuyển động mượt)
    mode = KB_MODES[k % len(KB_MODES)]
    a = float(os.environ.get("KB_AMOUNT", "0.12"))            # biên độ zoom/lia; nhỏ hơn = ít "AI slideshow" hơn
    p = f"(0.5-0.5*cos(PI*on/{frames}))"                        # ease in-out thay vì tuyến tính
    if mode == "in":     z, x, y = f"1.0+{a}*{p}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif mode == "out":  z, x, y = f"{1+a}-{a}*{p}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif mode == "pan_x": z, x, y = f"{1+a}", f"(iw-iw/zoom)*{p}", "ih/2-(ih/zoom/2)"
    else:                z, x, y = f"{1+a}", "iw/2-(iw/zoom/2)", f"(ih-ih/zoom)*(1-{p})"
    # Ảnh có sẵn (tư liệu/upload) nhỏ hơn khung phóng 1.5x: phóng lanczos + làm nét nhẹ để bù mềm do phóng.
    up = f"scale={int(W*1.5)}:{int(H*1.5)}:force_original_aspect_ratio=increase:flags=lanczos,crop={int(W*1.5)}:{int(H*1.5)}"
    if still_needs_upscale(src): up += ",unsharp=5:5:0.6:5:5:0.0"
    vf = (f"{up},zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps={FPS},setsar=1,format=yuv420p")
    run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", src, "-frames:v", str(frames), "-vf", vf,
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15", "-threads", "2", out])

def still_needs_upscale(src):
    """True nếu ảnh tĩnh phải phóng lên để phủ khung Ken Burns (W×H ×1.5)."""
    try:
        from PIL import Image
        with Image.open(src) as im: iw, ih = im.size
    except Exception:
        return False
    return max(W * 1.5 / iw, H * 1.5 / ih) > 1.0

KB_MODES = ["in", "pan_x", "out", "pan_y"]

def resolve_media(rel, data_dir, media_dir):
    """"assets/..." nằm trong DATA_DIR (ảnh mẫu/ref được commit), còn lại trong MEDIA_DIR."""
    if os.path.isabs(rel): return rel
    return os.path.join(data_dir if rel.startswith("assets/") else media_dir, rel)

def shade_png(path):
    """Lớp tối trên/dưới để chữ dễ đọc."""
    from PIL import Image
    import numpy as np
    y = np.linspace(0, 1, H)
    a = np.clip((y - 0.45) / 0.55, 0, 1) ** 1.3 * 200 + np.clip((0.18 - y) / 0.18, 0, 1) * 120
    arr = np.zeros((H, W, 4), "uint8"); arr[..., 3] = a[:, None].astype("uint8")
    Image.fromarray(arr, "RGBA").save(path)

# ---------------------------------------------------------------- layout helpers (đo chữ, khuôn mặt)
_fonts = {}
def _tw(text, fs):
    from PIL import ImageFont
    if fs not in _fonts:
        fp = find_font("BeVietnamPro-Bold.ttf") or find_font("DejaVuSans-Bold.ttf")
        _fonts[fs] = ImageFont.truetype(fp, int(fs)) if fp else ImageFont.load_default()
    return _fonts[fs].getlength(text)

def fit_text(text, fs, maxw, maxlines=2, minfs=None):
    """Ngắt dòng + thu nhỏ chữ cho vừa maxw trong tối đa maxlines dòng. -> (lines, fs)"""
    minfs = minfs or int(fs * 0.62)
    while True:
        lines, cur = [], ""
        for w in text.split():
            t = (cur + " " + w).strip()
            if _tw(t, fs) <= maxw or not cur: cur = t
            else: lines.append(cur); cur = w
        lines.append(cur)
        if len(lines) <= maxlines or fs <= minfs: return lines, fs
        fs -= 2

def face_rect_frame(src, is_vid):
    """Khuôn mặt lớn nhất (ảnh, hoặc 6 khung lấy mẫu của clip) quy ra toạ độ khung 1080x1920 (cover-crop), có lề
    cho tóc/cằm và chuyển động Ken Burns. None nếu không có OpenCV/model hoặc không thấy mặt."""
    try:
        import character
        boxes, (iw, ih) = character.face_boxes(src, n=6)
    except Exception as e:
        print("face detect off:", str(e)[:100]); return None
    if not boxes or not iw: return None
    base = max(W / iw, H / ih); ox = (iw * base - W) / 2; oy = (ih * base - H) / 2
    zx = 0.0 if is_vid else 0.12        # Ken Burns phóng tới 1.12 / lia: nới rộng vùng mặt
    R = None
    for fx, fy, fw, fh in boxes:
        x0 = fx * base - ox; y0 = fy * base - oy; x1 = (fx + fw) * base - ox; y1 = (fy + fh) * base - oy
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; hw = (x1 - x0) * (0.8 + zx) ; hh = (y1 - y0) * (0.5 + zx)
        r = (cx - hw, cy - hh - (y1 - y0) * 0.25, cx + hw, cy + hh + (y1 - y0) * 0.1)
        R = r if R is None else (min(R[0], r[0]), min(R[1], r[1]), max(R[2], r[2]), max(R[3], r[3]))
    return R

def _overlap(r, y0, y1): return bool(r) and not (y1 < r[1] or y0 > r[3])

# ---------------------------------------------------------------- captions (ASS)
def ts(t):
    t = max(t, 0); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

def esc(s): return s.replace("{", "(").replace("}", ")").replace("\\", "/")

def ass_color(rgb): return "&H{:02X}{:02X}{:02X}&".format(rgb[2], rgb[1], rgb[0])

CAP_FS, CAP_L, CAP_R = 90, 70, 170       # phụ đề 90px; lề phải chừa cột nút TikTok/Reels
SAFE_BOTTOM = 0.75                        # không đặt phụ đề thấp hơn 75% chiều cao (vùng chú thích/nút của app)

def build_ass(scenes, total, brand, accent, title_bg, cap_y=0.70, title_y=330):
    acc = ass_color(accent); tbg = ass_color(title_bg)
    cap_y = min(cap_y, SAFE_BOTTOM - 0.03)
    cx = (CAP_L + W - CAP_R) // 2
    hdr = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,{FONT},92,&H00FFFFFF&,&H00FFFFFF&,{tbg},&H00000000&,1,0,0,0,100,100,0,0,3,22,0,8,90,90,{title_y},1
Style: Cap,{FONT},{CAP_FS},&H00FFFFFF&,&H00FFFFFF&,&H00101010&,&H78000000&,1,0,0,0,100,100,0,0,1,7,3,5,{CAP_L},{CAP_R},0,1
Style: Brand,{FONT},38,&H00FFFFFF&,&H00FFFFFF&,&H50000000&,&H50000000&,1,0,0,0,100,100,0,0,3,14,0,7,60,60,90,1
Style: Bar,{FONT},10,{acc},{acc},{acc},&H0&,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    def P(*a): ev.append("Dialogue: " + ",".join(str(x) for x in a))
    if brand:
        P(5, ts(0), ts(total), "Brand", "", 0, 0, 0, "", f"{{\\fad(400,300)}}● {esc(brand)}")
    P(6, ts(0), ts(total), "Bar", "", 0, 0, 0, "", f"{{\\an7\\pos(0,{H-14})\\fscx0\\t(0,{int(total*1000)},\\fscx100)\\p1}}m 0 0 l {W} 0 {W} 14 0 14{{\\p0}}")
    capw = W - CAP_L - CAP_R
    for sc in scenes:
        s0, s1 = sc["start"], sc["end"]; face = sc.get("face")
        ty, cy = title_y, int(H * cap_y)
        tl, tfs = [], 92
        if sc.get("title"):
            tl, tfs = fit_text(sc["title"], 92, W - 180 - 44, 1, minfs=74)
            if _tw(tl[0], tfs) > W - 224: tl, tfs = fit_text(sc["title"], 92, W - 224, 2)
        th = int(len(tl) * tfs * 1.25) + 44
        if face:   # tránh khuôn mặt: tiêu đề xuống dưới mặt (hoặc ~60%), phụ đề sang dải trống
            if tl and _overlap(face, ty - 22, ty + th):
                below = int(face[3] + 40)
                ty = below if below + th < H * 0.66 else int(H * 0.58)
            tband = (ty - 22, ty + th) if tl else None
            for cand in [cy, int(H * 0.72), int(H * 0.64), int(H * 0.22), int(H * 0.16)]:
                y0, y1 = cand - CAP_FS, cand + CAP_FS
                if not _overlap(face, y0, y1) and not (tband and not (y1 < tband[0] or y0 > tband[1])):
                    cy = cand; break
            sc["layout"] = {"titleY": ty, "captionY": cy, "face": [int(v) for v in face]}
        if tl:
            txt = "\\N".join(esc(x) for x in tl)
            P(2, ts(s0 + 0.05), ts(s1 - 0.05), "Title", "", 0, 0, 0, "",
              f"{{\\an8\\fs{tfs}\\move({W//2},{ty+70},{W//2},{ty},0,380)\\fad(250,200)\\fscx60\\fscy60\\t(0,220,\\fscx108\\fscy108)\\t(220,380,\\fscx100\\fscy100)}}{txt}")
        # phụ đề theo từ: cụm ≤ 4 từ (và vừa 1 dòng), từ đang đọc đổi màu + phóng to
        ws = sc["words"]; groups, g = [], []
        for w in ws:
            if g and _tw(" ".join(x[2] for x in g + [w]), CAP_FS) * 1.06 > capw: groups.append(g); g = []
            g.append(w)
            if len(g) >= 4 or re.search(r"[.,!?;:]$", w[2]): groups.append(g); g = []
        if g: groups.append(g)
        for gi, grp in enumerate(groups):
            g_end = (groups[gi + 1][0][0] if gi + 1 < len(groups) else grp[-1][1] + 0.35)
            g_end = min(g_end, s1 - s0 - 0.02)
            for wi, (wa, wb, w) in enumerate(grp):
                a = s0 + wa; b = s0 + (grp[wi + 1][0] if wi + 1 < len(grp) else g_end)
                if b - a < 0.02: continue
                parts = []
                for wj, (_, _, w2) in enumerate(grp):
                    if wj == wi: parts.append(f"{{\\c{acc}\\fscx112\\fscy112}}{esc(w2)}{{\\c&HFFFFFF&\\fscx100\\fscy100}}")
                    else: parts.append(esc(w2))
                pop = "\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)" if wi == 0 else ""
                P(3, ts(a), ts(b), "Cap", "", 0, 0, 0, "", f"{{\\an5\\pos({cx},{cy}){pop}}}" + " ".join(parts))
    return hdr + "\n".join(ev) + "\n"

# ---------------------------------------------------------------- audio
def synth_bed(path, dur, bpm=88, sr=48000):
    """Nhạc nền tự tổng hợp (không bản quyền): Am-F-C-G, pad mềm + nhịp bass nhẹ."""
    import numpy as np, wave
    t = np.arange(int(dur * sr)) / sr; bar = 4 * 60 / bpm
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (130.81, 196.0, 261.63), (196.0, 246.94, 293.66)]
    out = np.zeros_like(t)
    for k in range(int(dur / bar) + 1):
        a0 = int(k * bar * sr); a1 = min(len(t), int((k + 1.15) * bar * sr))
        if a0 >= len(t): break
        tt = t[a0:a1] - k * bar; env = np.minimum(1, tt / 0.6) * np.exp(-tt / (bar * 1.2))
        for f in chords[k % 4]:
            out[a0:a1] += env * (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt))
        for b in range(4):
            b0 = a0 + int(b * 60 / bpm * sr); b1 = min(a1, b0 + int(0.3 * sr))
            if b0 < len(t):
                tb = t[b0:b1] - t[b0]; out[b0:b1] += 0.7 * np.exp(-tb / 0.1) * np.sin(2 * np.pi * chords[k % 4][0] / 2 * tb)
    out *= np.minimum(1, t / 1.5) * np.minimum(1, (dur - t) / 2.0).clip(0)
    out = out / (np.abs(out).max() + 1e-9) * 0.8
    st = np.stack([out, np.roll(out, int(0.012 * sr))], 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((st * 32767).astype("<i2").tobytes())

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--data", default=os.environ.get("DATA_DIR", "./data"))
    ap.add_argument("--media", default=os.environ.get("MEDIA_DIR", "./media"))
    ap.add_argument("--copy-to", help="sao chép MP4 kết quả tới đường dẫn này")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    data_dir, media_dir = os.path.abspath(a.data), os.path.abspath(a.media)
    os.environ["DATA_DIR"] = data_dir   # worker/archive.py đọc thư viện ảnh tư liệu ở DATA_DIR/archive (hoặc ARCHIVE_DIR)
    job = Job(data_dir, media_dir, a.video)
    # chỉ một render tại một thời điểm (VieNeu + whisper + ffmpeg cùng lúc nhiều job làm treo/OOM máy).
    # flock tự nhả khi tiến trình thoát (kể cả khi chết), nên không bao giờ kẹt khoá.
    import fcntl
    os.makedirs(media_dir, exist_ok=True)
    lockf = open(os.path.join(media_dir, "render.lock"), "a+")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        job.update(state="queued", progress=0.0, _status="doing")
        job.log("Đang chờ render khác xong (khoá media/render.lock)")
        fcntl.flock(lockf, fcntl.LOCK_EX)
    lockf.seek(0); lockf.truncate(); lockf.write(f"{os.getpid()} {a.video}\n"); lockf.flush()
    t_start = time.time()
    tmp = tempfile.mkdtemp(prefix="vs_render_")
    try:
        v = job.load()
        job.update(state="running", progress=0.01, startedAt=now(), error=None, _status="doing")
        prof = {}
        pp = os.path.join(data_dir, "profiles", f"{v['profile']}.json")
        if os.path.exists(pp): prof = json.load(open(pp, encoding="utf-8"))
        colors = [hex_rgb(c.get("hex")) for c in prof.get("sections", {}).get("colors", [])] or [(255, 122, 89), (255, 194, 75)]
        import colorsys
        hsv = lambda c: colorsys.rgb_to_hsv(*(x / 255 for x in c))
        # màu nhấn (từ đang đọc): sáng + bão hoà để nổi trên chữ trắng; nền tiêu đề: màu chính nếu đủ tối
        cands = [c for c in colors if hsv(c)[2] > 0.6 and hsv(c)[1] > 0.45]
        accent = max(cands, key=lambda c: hsv(c)[1] * hsv(c)[2]) if cands else (255, 214, 10)
        title_bg = colors[0] if hsv(colors[0])[2] < 0.85 and sum(colors[0]) < 450 else min(colors, key=sum)
        # Nhãn kênh trên video: profile.brand (tên hiển thị cố định) > handle kết nối đầu tiên > tên profile.
        # Handle có thể là ID trang Facebook, nên kênh cần tên rõ ràng phải đặt "brand".
        ch = next((c for c in prof.get("channels", []) if c.get("connected")), None)
        brand = (prof.get("brand") or "").strip() or (ch or {}).get("handle") or prof.get("name") or ""

        if v.get("kbAmount") is not None: os.environ["KB_AMOUNT"] = str(float(v["kbAmount"]))
        XF = float(v.get("crossfade") if v.get("crossfade") is not None else 0.35)  # giây, 0 = cắt thẳng
        tts = v.get("tts") or {"engine": "vieneu", "voice": "Ngọc Huyền", "rate": "+0%"}
        for idx, sc in enumerate(v["scenes"]): sc["_idx"] = idx
        scenes = [s for s in v["scenes"] if (s.get("narration") or "").strip() or s.get("title")]
        cast = prof.get("cast") or {}
        pick = lambda arr, cid: next((x for x in arr if x.get("id") == cid), arr[0] if arr else None)
        character = pick(cast.get("characters") or [], v.get("characterId"))
        setting = pick(cast.get("settings") or [], v.get("settingId"))
        cast_refs = [os.path.join(data_dir, r) for r in ((character or {}).get("refs", []) + (setting or {}).get("refs", []))]
        if not scenes: raise RuntimeError("Không có cảnh nào")
        n = len(scenes)

        # 1) TTS
        #   engine "edge": edge-tts (mốc từ chính xác, cache). engine "vieneu": VieNeu-TTS v3 Turbo chạy local (CPU) nếu có,
        #   không thì Gradio (VIENEU_GRADIO_URL), cuối cùng edge. Giọng không có mốc từ -> căn bằng faster-whisper (tts.align,
        #   mặc định bật nếu cài). Văn bản chuẩn hoá số/đơn vị/ngày (vn_norm) + từ điển phát âm, phụ đề giữ chữ gốc.
        env_engine = os.environ.get("TTS_ENGINE_OVERRIDE")          # vd "vieneu" để nâng mọi video lên VieNeu
        engine = env_engine or tts.get("engine") or "edge"
        align_opt = str(tts.get("align", os.environ.get("TTS_ALIGN", "auto"))).lower()   # auto|on|off
        can_align = align_opt != "off" and has_mod("faster_whisper")
        pron = load_pron(data_dir)
        vn_voice = tts.get("voice") if not str(tts.get("voice", "")).startswith(("vi-VN", "en-")) else os.environ.get("VIENEU_VOICE", "Ngọc Huyền")
        local_ok = engine == "vieneu" and has_mod("vieneu") and os.environ.get("VIENEU_LOCAL", "1") != "0"
        os.environ.setdefault("MV_TTS_CACHE", os.path.join(media_dir, "cache", "tts"))
        if engine == "vieneu" and not local_ok and not os.environ.get("VIENEU_GRADIO_URL"):
            job.log("VieNeu chưa cài trên worker (pip install vieneu) và chưa đặt VIENEU_GRADIO_URL -> dùng edge-tts")
        t = 0.0; wavs = []; qc_all = []
        g_on = engine == "vieneu" and tts_qc.enabled() and gemini_listen.enabled(prof)
        g_led = gemini_listen.Ledger()
        if g_on: job.log(f"Gemini nghe kiểm tra: bật ({gemini_listen.model_name()})")
        for i, sc in enumerate(scenes):
            raw = (sc.get("narration") or "").strip(); text = vn_norm.strip_markers(raw)
            job.log(f"TTS cảnh {i+1}/{n} ({engine}{' local' if local_ok else ''}, {vn_voice if engine == 'vieneu' else tts.get('voice')})", 0.02 + 0.30 * i / n)
            words, src, exact = [], None, False
            if text:
                if engine == "vieneu" and local_ok:
                    try:
                        src = os.path.join(tmp, f"tts{i}.wav")
                        spoken = spoken_text(raw, pron)
                        if tts_qc.enabled():
                            _, qc = tts_qc.vieneu_scene_qc(spoken, vn_voice, src, tmp, pron, job.log)
                            if g_on:
                                regen = lambda: tts_qc.vieneu_scene_qc(spoken, vn_voice, src, tmp, pron, job.log)[1]
                                try:
                                    qc = gemini_listen.scene_qc(src, qc, vn_voice, regen, g_led, job.log)
                                except gemini_listen.GeminiError as e:
                                    job.log(f"Gemini nghe lỗi, bỏ qua bước này: {str(e)[:200]}")
                                    if e.code in (401, 402, 403): g_on = False   # hết credit / khoá sai: tắt cho cả job
                            bad = [q for q in qc if not q["ok"] or not (q.get("gemini") or {}).get("ok", True)]
                            job.log(f"QC giọng cảnh {i+1}: {len(qc) - len(bad)}/{len(qc)} câu sạch"
                                    + (f"; còn lỗi: {bad[0]['text'][:40]} ({'; '.join(bad[0]['reasons'] or ['gemini'])[:120]})" if bad else ""))
                            qc_all.extend({"scene": i + 1, **q} for q in qc)
                        else:
                            tts_local.vieneu_scene(spoken, vn_voice, src, tmp)
                        words = tts_local.estimate_words(text, probe_dur(src))
                    except Exception as e:
                        job.log(f"VieNeu local lỗi ({str(e)[:160]}); thử Gradio/edge"); src = None; local_ok = False
                if engine == "vieneu" and src is None and os.environ.get("VIENEU_GRADIO_URL"):
                    try:
                        src = os.path.join(tmp, f"tts{i}.wav")
                        words = tts_vieneu(" ".join(norm_tok(t_, pron) for t_ in text.split()), vn_voice, src, tmp)
                        if len(words) != len(text.split()): words = tts_local.estimate_words(text, probe_dur(src))
                    except Exception as e:
                        job.log(f"VieNeu Gradio lỗi ({e}); chuyển sang edge-tts"); src = None
                if src is None or not words:
                    src = os.path.join(tmp, f"tts{i}.mp3")
                    words = attach_punct(tts_edge(text, tts.get("voice", "vi-VN-HoaiMyNeural"), tts.get("rate", "+0%"), src), text); exact = True
                if not exact and can_align:
                    try:
                        al = tts_local.align_words(src, text, os.environ.get("ALIGN_MODEL", "small"))
                        if al: words = al; job.log(f"Căn mốc từ cảnh {i+1}: whisper khớp {tts_local.align_words.last_ratio:.0%}")
                    except Exception as e:
                        job.log(f"Căn mốc whisper lỗi ({str(e)[:120]}), dùng ước lượng")
                dur = probe_dur(src) + (0.35 if i < n - 1 else 0.9)
            else:
                dur = 2.2
            wav = os.path.join(tmp, f"s{i}.wav")
            inp = ["-i", src] if src else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            run(["ffmpeg", "-y", "-v", "error", *inp, "-af", "apad", "-t", f"{dur:.3f}", "-ar", "48000", "-ac", "2", wav])
            sc.update(start=t, end=t + dur, words=words); t += dur; wavs.append(wav)
        total = t
        lst = os.path.join(tmp, "a.txt"); open(lst, "w").write("".join(f"file '{w}'\n" for w in wavs))
        voice = os.path.join(tmp, "voice.wav")
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", voice])
        if v.get("loudnorm", True) and os.environ.get("LOUDNORM", "1") != "0":   # EBU R128 -16 LUFS cho giọng
            vn_ = os.path.join(tmp, "voice_ln.wav")
            run(["ffmpeg", "-y", "-v", "error", "-i", voice, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", vn_])
            voice = vn_

        # 2) Hình nền từng cảnh
        clips, clip_jobs = [], []
        archive_used = set()
        for i, sc in enumerate(scenes):
            job.log(f"Dựng hình cảnh {i+1}/{n}", 0.35 + 0.35 * i / n)
            img = sc.get("clip") or sc.get("image"); is_vid = False
            src = resolve_media(img, data_dir, media_dir) if img else None
            if sc.get("archive"):
                # cảnh ảnh tư liệu: dựng clip 9:16 (khung + parallax / cận cảnh zoom / nền cho thẻ số liệu) + nhãn Noto Serif
                try:
                    had = any(x.get("id") for x in (sc["archive"].get("items") or []))
                    its = archive.scene_items(sc, used=archive_used)
                    if its:
                        archive_used.update(x["id"] for x in its)
                        src = os.path.join(tmp, f"arch{i}.mp4")
                        d = sc["end"] - sc["start"] + (XF if (XF and i < n - 1) else 0) + 0.1
                        archive.compose(its, src, d)
                        if not had:
                            job.set_scene(sc["_idx"], archive=sc["archive"])   # lưu ảnh đã tự chọn theo từ khoá
                        job.log(f"Ảnh tư liệu cảnh {i+1}: " + ", ".join(x["id"] for x in its))
                except Exception as e:
                    job.log(f"Ảnh tư liệu cảnh {i+1} lỗi: {str(e)[:160]}"); src = src if (src and not src.startswith(tmp)) else None
            if src and not os.path.exists(src):
                job.log(f"Thiếu file {img}, dùng nền thay thế"); src = None
            if not src:
                # sinh ảnh AI kèm ref nhân vật + bối cảnh; lưu lại vào job để không sinh lại
                rel = os.path.join("uploads", v["id"], f"scene-{sc['_idx']}-ai.png")
                gen = os.path.join(media_dir, rel)
                base = sc.get("visual") or sc.get("title") or ""
                cdesc = (character or {}).get("description"); sdesc = (setting or {}).get("description")
                prompt = base if (cdesc and cdesc in base) else media_gen.build_prompt(base, cdesc, sdesc)
                try:
                    if media_gen.generate_image(prompt, gen, cast_refs, sc.get("aspect") or v.get("aspect") or "9:16", prof.get("imageProvider")):
                        job.log(f"Ảnh AI cảnh {i+1} ({media_gen.LAST_PROVIDER}, {len(cast_refs)} ref)")
                        job.set_scene(sc["_idx"], image=rel); src = gen
                except Exception as e:
                    # Đã cấu hình API ảnh mà vẫn lỗi (sau khi thử lại/dự phòng): dừng render, không ghép nền placeholder
                    # vào video thật. Ảnh các cảnh đã sinh được lưu lại, render lần sau chỉ sinh cảnh còn thiếu.
                    job.log(f"Ảnh AI cảnh {i+1} lỗi: {str(e)[:160]}")
                    raise RuntimeError(f"Không sinh được ảnh cảnh {i+1}; render lại sau khi API ảnh ổn định") from e
            if src and sc.get("motion") == "video" and not re.search(r"\.(mp4|mov|webm)$", src, re.I):
                rel = os.path.join("uploads", v["id"], f"scene-{sc['_idx']}-motion.mp4")
                try:
                    if media_gen.generate_video(src, (sc.get("visual") or sc.get("title") or "") + ". Subtle natural motion.", os.path.join(media_dir, rel), min(8, max(3, sc["end"] - sc["start"]))):
                        job.log(f"Image-to-video cảnh {i+1}"); job.set_scene(sc["_idx"], image=rel); src = os.path.join(media_dir, rel)
                except Exception as e:
                    job.log(f"Image-to-video cảnh {i+1} lỗi: {str(e)[:160]} -> Ken Burns")
            if src: is_vid = bool(re.search(r"\.(mp4|mov|webm)$", src, re.I))
            if not src:
                src = os.path.join(tmp, f"bg{i}.jpg"); placeholder_bg(src, colors, i, sc.get("visual") or "")
            out = os.path.join(tmp, f"c{i}.mp4")
            pad = XF if (XF and i < n - 1) else 0.0  # phần chồng cho crossfade
            sc["_src"], sc["_is_vid"] = src, is_vid
            clip_jobs.append((src, sc["end"] - sc["start"] + pad, out, i, is_vid, float(sc.get("clipStart") or 0), float(v.get("maxSlow") or 1.4)))
            clips.append(out)
        # dựng các cảnh song song (mỗi cảnh một ffmpeg), song song với dò khuôn mặt
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max(1, min(len(clip_jobs), (os.cpu_count() or 2) // 2 or 1, 4))) as ex:
            futs = [ex.submit(scene_clip, *jb) for jb in clip_jobs]
            if v.get("faceAware", True) and has_mod("cv2"):
                for sc in scenes:
                    if sc.get("_src") and not sc["_src"].startswith(tmp):
                        sc["face"] = face_rect_frame(sc["_src"], sc["_is_vid"])
                nf = sum(1 for sc in scenes if sc.get("face"))
                job.log(f"Dò khuôn mặt: {nf}/{n} cảnh có mặt -> đặt tiêu đề/phụ đề tránh mặt", 0.6)
            for f in futs: f.result()
        # kiểm tra lệch nhân vật (SFace) so với ảnh chân dung tham chiếu của nhân vật
        drift = None
        if character and has_mod("cv2") and v.get("driftCheck", True):
            try:
                import character as chmod
                refs = [os.path.join(data_dir, r) for r in character.get("refs", [])]
                portrait = character.get("portrait") and os.path.join(data_dir, character["portrait"])
                portrait = portrait or next((r for r in refs if "portrait" in os.path.basename(r).lower()), refs[0] if refs else None)
                items = [sc["_src"] for sc in scenes if sc.get("_src") and not sc["_src"].startswith(tmp)]
                if portrait and items:
                    thr, rows = chmod.check({"portrait": portrait, "drift_threshold": float(character.get("driftThreshold") or 0.363)}, items)
                    bad = [r for r in rows if r["status"] == "DRIFT"]
                    drift = {"threshold": thr, "flagged": len(bad), "items": [{**r, "item": os.path.relpath(r["item"], data_dir) if r["item"].startswith(data_dir) else os.path.basename(r["item"])} for r in rows]}
                    nof = sum(1 for r in rows if r["status"] == "NO_FACE")
                    job.log("Kiểm tra nhân vật (SFace): " + (", ".join(f"{os.path.basename(r['item'])} {r['score']}" for r in bad) + f" LỆCH (< {thr})" if bad
                            else f"{len(rows) - nof} cảnh khớp, {nof} cảnh không thấy mặt (ngưỡng {thr})"), 0.68)
            except Exception as e:
                job.log(f"Kiểm tra nhân vật lỗi: {str(e)[:120]}")
        cl = os.path.join(tmp, "v.txt"); open(cl, "w").write("".join(f"file '{c}'\n" for c in clips))
        bg = os.path.join(tmp, "bg.mp4")
        if XF and len(clips) > 1:
            # crossfade: cảnh i dài thêm XF giây, chuyển cảnh bắt đầu đúng lúc lời đọc cảnh i+1 bắt đầu
            ins = sum((["-i", c] for c in clips), [])
            chain, last = [], "[0:v]"
            for j in range(1, len(clips)):
                o = f"[x{j}]"
                chain.append(f"{last}[{j}:v]xfade=transition=fade:duration={XF}:offset={scenes[j]['start']:.3f}{o}")
                last = o
            run(["ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", ";".join(chain), "-map", last,
                 "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15", "-pix_fmt", "yuv420p", bg])
        else:
            run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", cl, "-c", "copy", bg])

        # 3) Phụ đề + lớp tối
        job.log("Phụ đề theo từng từ + tiêu đề động", 0.72)
        ass = os.path.join(tmp, "subs.ass")
        open(ass, "w", encoding="utf-8").write(build_ass(scenes, total, brand, accent, title_bg,
            float(v.get("captionY") or 0.70), int(v.get("titleY") or 330)))
        shade = os.path.join(tmp, "shade.png"); shade_png(shade)

        # 4) Âm thanh + ghép
        audio_in = ["-i", voice]; afl = "[2:a]anull[aout]"
        if v.get("music", "synth") == "synth":
            bed = os.path.join(tmp, "bed.wav"); synth_bed(bed, total)
            audio_in += ["-i", bed]
            afl = (f"[2:a]asplit=2[vo][sc];[3:a]volume={float(v.get('musicVol') or 0.20):.2f}[m];"
                   "[m][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=400[md];"
                   "[vo][md]amix=inputs=2:normalize=0:duration=first[aout]")
        job.log("Ghép video H.264/AAC", 0.80)
        rel = os.path.join("out", f"{v['id']}.mp4"); out_mp4 = os.path.join(media_dir, rel)
        os.makedirs(os.path.dirname(out_mp4), exist_ok=True)
        fontsdir = f":fontsdir={FONTS_DIR}" if os.path.isdir(FONTS_DIR) else ""
        # cảnh có scene.chart (bar/hbar/line/donut/kpi/terminal, cùng định dạng skill motion-video): thẻ động phủ giữa khung
        ch_in, chain, last = [], [], "[sh]"
        k0 = 2 + len(audio_in) // 2
        for i, sc in enumerate(scenes):
            chd = sc.get("chart")
            if not isinstance(chd, dict) or not chd.get("type"): continue
            try:
                import charts
                st = {"text": "&HFFFFFF&", "accent": ass_color(accent), "bg": "0x14181F"}
                bx = (60, int(H * 0.30), W - 120, int(H * 0.36))
                if chd.get("src"): chd["src"] = resolve_media(chd["src"], data_dir, media_dir)
                mov = os.path.join(tmp, f"chart{i}.mov"); d = sc["end"] - sc["start"]
                charts.render_to_video(dict(chd), mov, bx[2], bx[3], charts.palette(st), max(1.5, d * 0.6 - 0.4))
                ch_in += ["-itsoffset", f"{sc['start']+0.4:.3f}", "-i", mov]; kk = k0 + len(chain); o = f"[ov{kk}]"
                chain.append(f"{last}[{kk}:v]overlay={bx[0]}:{bx[1]}:eof_action=repeat:enable='between(t,{sc['start']+0.4:.3f},{sc['end']-0.05:.3f})'{o}"); last = o
                job.log(f"Thẻ {chd['type']} cảnh {i+1}")
            except Exception as e:
                job.log(f"Thẻ cảnh {i+1} lỗi: {str(e)[:120]}")
        grain = int(v.get("grain") or 0)   # hạt phim nhẹ (0 = tắt, ~5-8 là vừa), áp lên hình trước lớp chữ
        gf = f",noise=c0s={grain}:c0f=t+u" if grain > 0 else ""
        vf = f"[0:v][1:v]overlay=0:0{gf}[sh];" + "".join(c + ";" for c in chain) + f"{last}ass={ass}{fontsdir},format=yuv420p[vout];{afl}"
        tmp_out = out_mp4 + ".part.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", bg, "-loop", "1", "-i", shade, *audio_in, *ch_in,
             "-filter_complex", vf, "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
             "-c:v", "libx264", "-preset", os.environ.get("RENDER_PRESET", "veryfast"), "-crf", "20", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp_out])
        os.replace(tmp_out, out_mp4)
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{min(1.5, total/2):.2f}", "-i", out_mp4, "-frames:v", "1", "-vf", "scale=360:-2", out_mp4[:-4] + ".jpg"])
        dur = probe_dur(out_mp4)
        if a.copy_to:
            os.makedirs(os.path.dirname(os.path.abspath(a.copy_to)), exist_ok=True); shutil.copy(out_mp4, a.copy_to)
        job.log(f"Xong {dur:.1f}s trong {time.time()-t_start:.0f}s → {rel}", 1.0)
        extra = {"drift": drift} if drift else {}
        if archive_used:
            try:
                its = archive.video_credits(job.load())
                job.set_video(credits=archive.caption_credits(its), archiveCredits=[{k: x.get(k) for k in ("id", "title", "author", "license", "licenseUrl", "page", "attributionRequired")} for x in its])
                job.log(f"Ghi công ảnh tư liệu: {len(its)} ảnh")
            except Exception as e:
                job.log(f"Ghi công ảnh tư liệu lỗi: {str(e)[:120]}")
        if drift: json.dump(drift, open(out_mp4[:-4] + ".drift.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if qc_all: json.dump(qc_all, open(out_mp4[:-4] + ".ttsqc.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if g_led.calls:
            job.log(f"Gemini nghe tổng: {g_led}")
            json.dump({"model": gemini_listen.model_name(), "usage": g_led.summary()},
                      open(out_mp4[:-4] + ".gemini-usage.json", "w", encoding="utf-8"), indent=1)
        job.update(state="done", progress=1.0, output=rel, duration=round(dur, 2), finishedAt=now(), _status="review", **extra)
        # lưu timeline để AI/người xem lại
        json.dump([{k: s.get(k) for k in ("title", "start", "end", "words", "layout")} for s in scenes],
                  open(out_mp4[:-4] + ".timeline.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    except Exception as e:
        print("RENDER LỖI:", e, file=sys.stderr)
        try:
            job.logs.append(f"LỖI: {e}")
            job.update(state="error", error=str(e)[:800], finishedAt=now(), _status="doing")
        except Exception: pass
        sys.exit(1)
    finally:
        if not a.keep: shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
