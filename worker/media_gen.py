#!/usr/bin/env python3
"""worker/media_gen.py — adapter sinh ảnh / video cho cảnh, có ảnh tham chiếu nhân vật + bối cảnh.

Ảnh (IMAGE_PROVIDER):
  openai      OpenAI-compatible. Không ref -> POST {IMAGE_BASE_URL}/images/generations;
              có ref -> POST /images/edits (multipart, nhiều field image[]), VD gpt-image-1, Pollinations gen API.
  xai         xAI Grok Imagine (docs.x.ai): /v1/images/generations và /v1/images/edits (JSON, ảnh dạng data URI,
              tối đa 5 ảnh nguồn). Biến: XAI_API_KEY (hoặc IMAGE_API_KEY), IMAGE_MODEL mặc định grok-imagine-image-2.0.
  hf-kontext  FLUX.1-Kontext-Dev trên Hugging Face Space (gradio). Miễn phí nhưng giới hạn lượt khi ẩn danh;
              đặt HF_TOKEN để có thêm quota. Chỉ nhận 1 ảnh: dùng ref đầu tiên (nên là ảnh "nhân vật trong bối cảnh").
  gemini      Google Gemini API (REST generateContent, ai.google.dev). Biến: GEMINI_API_KEY (hoặc IMAGE_API_KEY),
              IMAGE_MODEL mặc định gemini-3.1-flash-image, IMAGE_ASPECT mặc định 9:16 (responseModalities IMAGE +
              imageConfig.aspectRatio). Tối đa 4 ảnh ref gửi dạng inline_data (GEMINI_MAX_REFS).
  quanlop     API ảnh riêng của người dùng (https://image2.quanlop.vn, không có docs công khai; dò 2026-10-18):
              POST /v1/images, Authorization: Bearer QUANLOP_IMAGE_API_KEY, JSON chặt (trường lạ -> 400)
              {"prompt": "...", "aspect_ratio": "9:16"} -> trả thẳng bytes PNG (image/png), 9:16 = 768x1376, ~12–21 s/ảnh.
              Không nhận `size`/`model`; body tối đa ~16 KB -> CHƯA gửi được ảnh ref (không tìm thấy trường ảnh nào):
              chỉ dùng prompt (luôn kèm mô tả cố định nhân vật + bối cảnh). Cần User-Agent (Cloudflare chặn UA mặc định).
              Biến: QUANLOP_IMAGE_API_KEY, QUANLOP_IMAGE_BASE_URL (mặc định https://image2.quanlop.vn).
  Dự phòng: IMAGE_FALLBACK="gemini" (danh sách, phân tách dấu phẩy) - provider chính lỗi thì thử lần lượt.
            Mặc định quanlop -> gemini; provider khác không có dự phòng trừ khi đặt IMAGE_FALLBACK (đặt "none" để tắt).
  Theo profile: data/profiles/<slug>.json "imageProvider" (render.py, API sinh ảnh cảnh/ref truyền --provider).
  Provider tự thêm trên giao diện (trang "Provider AI"): data/image-providers.json, mỗi mục
              {id, label, kind: "openai"|"gemini", baseUrl, model, size?, maxRefs?}. Khoá API nằm trong file env
              (biến IMAGE_PROVIDER_KEY__<ID>, đọc từ môi trường hoặc ENV_FILE), không bao giờ ghi vào data/.
              kind "openai" = API ảnh OpenAI-compatible (CLIProxyAPI, OpenAI, gateway); "gemini" = generateContent.
  none / ""   không sinh ảnh -> render dùng nền gradient (placeholder).
Không có ref hoặc provider không hỗ trợ ref -> prompt chữ, luôn kèm mô tả cố định nhân vật + bối cảnh.

Video (VIDEO_PROVIDER, tuỳ chọn, image-to-video cho cảnh có motion="video"):
  xai         POST /v1/videos/generations {model, prompt, image:{url:data-uri}, duration, aspect_ratio} rồi poll
              GET /v1/videos/{request_id}. VIDEO_MODEL mặc định grok-imagine-video.
  veo         Google Veo qua Gemini API (predictLongRunning + poll operation), image-to-video 9:16. Biến: GEMINI_API_KEY,
              VIDEO_MODEL mặc định veo-3.1-fast-generate-preview, VIDEO_RESOLUTION 720p, độ dài 4/6/8 giây (làm tròn lên).
              Giá tham khảo (trang pricing Gemini 10/2026): Fast $0.10/s 720p, Lite $0.05/s. Âm thanh clip bị bỏ khi render.
  (khác)      TODO: thêm adapter (Veo, Kling, Runway...). Không cấu hình -> Ken Burns trên ảnh tĩnh.

CLI:
  python3 worker/media_gen.py image --prompt "..." --out a.png [--ref r1.png --ref r2.png]
  python3 worker/media_gen.py video --image a.png --prompt "..." --out a.mp4 [--seconds 5]
Chưa chạy thử với key openai/xai thật; hf-kontext đã dùng để tạo dữ liệu mẫu.
"""
import argparse, base64, http.client, json, mimetypes, os, shutil, sys, time, urllib.error, urllib.request, uuid

def _env(*names, default=None):
    for n in names:
        if os.environ.get(n): return os.environ[n]
    return default

def _data_uri(path):
    mt = mimetypes.guess_type(path)[0] or "image/png"
    return f"data:{mt};base64," + base64.b64encode(open(path, "rb").read()).decode()

def _post_json(url, body, key, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def _get_json(url, key, timeout=60):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, json.load(r)

def _multipart(fields, files):
    b = uuid.uuid4().hex; out = []
    for k, v in fields.items():
        out += [f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()]
    for k, p in files:
        mt = mimetypes.guess_type(p)[0] or "image/png"
        out += [f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{os.path.basename(p)}\"\r\nContent-Type: {mt}\r\n\r\n".encode(),
                open(p, "rb").read(), b"\r\n"]
    out.append(f"--{b}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={b}"

def _save_result(j, out):
    d = (j.get("data") or [{}])[0]
    if d.get("b64_json"): open(out, "wb").write(base64.b64decode(d["b64_json"])); return True
    if d.get("url"): urllib.request.urlretrieve(d["url"], out); return True
    raise RuntimeError(f"không có ảnh trong kết quả: {str(j)[:200]}")

# ---------------------------------------------------------------- image providers
def img_openai(prompt, refs, out, cfg=None):
    """cfg (provider tự thêm): {baseUrl, key, model, size, maxRefs}; không có -> biến IMAGE_*."""
    cfg = cfg or {}
    base = (cfg.get("baseUrl") or _env("IMAGE_BASE_URL", default="https://api.openai.com/v1")).rstrip("/")
    key = cfg["key"] if "key" in cfg else _env("IMAGE_API_KEY")
    model = cfg.get("model") or _env("IMAGE_MODEL", default="gpt-image-1")
    size = cfg.get("size") or _env("IMAGE_SIZE", default="1024x1536")
    if not key and not cfg: raise RuntimeError("thiếu IMAGE_API_KEY")
    auth = {"Authorization": f"Bearer {key}"} if key else {}   # CLIProxyAPI có thể chạy không cần khoá
    refs = refs[: int(cfg.get("maxRefs", 16))]
    try:
        if refs:
            body, ct = _multipart({"model": model, "prompt": prompt, "size": size, "n": "1"}, [("image[]", r) for r in refs])
            req = urllib.request.Request(base + "/images/edits", data=body, method="POST", headers={**auth, "Content-Type": ct})
        else:
            req = urllib.request.Request(base + "/images/generations", method="POST", headers={**auth, "Content-Type": "application/json"},
                                         data=json.dumps({"model": model, "prompt": prompt, "size": size, "n": 1}).encode())
        with urllib.request.urlopen(req, timeout=300) as r: return _save_result(json.load(r), out)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"openai HTTP {e.code}: {msg.replace(key, '[key]') if key else msg}")

def img_xai(prompt, refs, out):
    key = _env("XAI_API_KEY", "IMAGE_API_KEY"); base = _env("XAI_BASE_URL", default="https://api.x.ai/v1").rstrip("/")
    model = _env("IMAGE_MODEL", default="grok-imagine-image-2.0")
    if not key: raise RuntimeError("thiếu XAI_API_KEY")
    body = {"model": model, "prompt": prompt, "response_format": "b64_json", "aspect_ratio": "9:16"}
    if not refs: return _save_result(_post_json(base + "/images/generations", body, key), out)
    imgs = [{"url": _data_uri(r), "type": "image_url"} for r in refs[:5]]
    # TODO(kiểm chứng): docs ghi "tối đa 5 ảnh nguồn" nhưng chưa nêu rõ tên field cho nhiều ảnh; 1 ảnh dùng "image".
    if len(imgs) == 1: body["image"] = imgs[0]
    else: body["images"] = imgs
    return _save_result(_post_json(base + "/images/edits", body, key), out)

def img_hf_kontext(prompt, refs, out):
    from gradio_client import Client, handle_file
    if not refs: raise RuntimeError("hf-kontext cần ít nhất 1 ảnh tham chiếu")
    space = _env("HF_KONTEXT_SPACE", default="black-forest-labs/FLUX.1-Kontext-Dev")
    tok = _env("HF_TOKEN")
    last = None
    for attempt in range(int(_env("HF_RETRIES", default="6"))):
        try:
            c = Client(space, verbose=False, **({"token": tok} if tok else {}))
            r, _ = c.predict(handle_file(refs[0]), prompt, 7 + attempt, False, 2.5, 24, api_name="/infer")
            shutil.copy(r if isinstance(r, str) else r["path"], out); return True
        except Exception as e:
            last = e; print("hf-kontext thử lại:", str(e)[:120], file=sys.stderr); time.sleep(40)
    raise RuntimeError(f"hf-kontext lỗi: {last}")

def img_gemini(prompt, refs, out, aspect=None, cfg=None):
    """Gemini image generation/editing qua REST: text + tối đa 4 ảnh ref (inline_data) -> 1 ảnh.
    cfg (provider tự thêm, VD CLIProxyAPI /v1beta): {baseUrl, key, model, maxRefs}."""
    cfg = cfg or {}
    key = cfg["key"] if "key" in cfg else _env("GEMINI_API_KEY", "IMAGE_API_KEY")
    if not key and not cfg: raise RuntimeError("thiếu GEMINI_API_KEY")
    model = cfg.get("model") or _env("IMAGE_MODEL", default="gemini-3.1-flash-image")
    if not cfg and model.startswith(("gpt-", "grok-", "dall-e")): model = "gemini-3.1-flash-image"   # IMAGE_MODEL của provider khác
    base = (cfg.get("baseUrl") or _env("GEMINI_BASE_URL", default="https://generativelanguage.googleapis.com/v1beta")).rstrip("/")
    aspect = aspect or _env("IMAGE_ASPECT", default="9:16")
    parts = [{"text": prompt}]
    for r in refs[: int(cfg.get("maxRefs") or _env("GEMINI_MAX_REFS", default="4"))]:
        parts.append({"inline_data": {"mime_type": mimetypes.guess_type(r)[0] or "image/png",
                                      "data": base64.b64encode(open(r, "rb").read()).decode()}})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect}}}
    req = urllib.request.Request(f"{base}/models/{model}:generateContent", data=json.dumps(body).encode(), method="POST",
                                 headers={**({"x-goog-api-key": key} if key else {}), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: j = json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"gemini HTTP {e.code}: {msg.replace(key, '[key]') if key else msg}")
    for c in j.get("candidates") or []:
        for prt in (c.get("content") or {}).get("parts") or []:
            d = prt.get("inlineData") or prt.get("inline_data")
            if d and d.get("data"):
                open(out, "wb").write(base64.b64decode(d["data"])); return True
    fb = j.get("promptFeedback") or [c.get("finishReason") for c in j.get("candidates") or []]
    raise RuntimeError(f"gemini không trả ảnh: {str(fb)[:300]}")

QUANLOP_MAX_BODY = 16000   # máy chủ trả request_too_large khi body JSON > ~16 KB
QUANLOP_ASPECTS = {"9:16", "16:9", "1:1", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "21:9"}
# Gateway chỉ gọi Codex khi KHÔNG ghi aspect_ratio (Codex không giữ kích thước yêu cầu). Ảnh trả về thường vuông,
# renderer cắt cover về 9:16 nên nhắc bố cục dọc, chủ thể ở giữa để phần bị cắt là nền.
QUANLOP_FREE_ASPECT_HINT = "Vertical portrait composition, main subject centered in the middle third, nothing important near the left or right edges. "

def img_quanlop(prompt, refs, out, aspect=None):
    """API ảnh quanlop: JSON {prompt, aspect_ratio} -> PNG bytes (hoặc JSON data[0].b64_json/url nếu máy chủ đổi)."""
    key = _env("QUANLOP_IMAGE_API_KEY")
    if not key: raise RuntimeError("thiếu QUANLOP_IMAGE_API_KEY")
    base = _env("QUANLOP_IMAGE_BASE_URL", default="https://image2.quanlop.vn").rstrip("/")
    aspect = aspect or _env("IMAGE_ASPECT", default="9:16")
    if aspect not in QUANLOP_ASPECTS: aspect = "9:16"
    if refs: print(f"quanlop: API chưa nhận ảnh ref -> bỏ qua {len(refs)} ref, chỉ dùng prompt", file=sys.stderr)
    def encode(b):
        raw = json.dumps(b, ensure_ascii=False).encode()
        if len(raw) > QUANLOP_MAX_BODY:   # cắt prompt cho vừa giới hạn body
            over = len(raw) - QUANLOP_MAX_BODY
            b = {**b, "prompt": b["prompt"].encode()[: max(200, len(b["prompt"].encode()) - over - 64)].decode(errors="ignore")}
            raw = json.dumps(b, ensure_ascii=False).encode()
        return raw
    body = {"prompt": prompt, "aspect_ratio": aspect}
    raw = encode(body)
    free_ok = _env("QUANLOP_FREE_ASPECT_FALLBACK", default="1") != "0"
    # API dùng chung hay trả 429 capacity_exceeded / rớt kết nối lúc tải cao: chờ tăng dần rồi gọi lại
    # (Retry-After nếu có, không thì 10, 20, 40, 60 giây...). Lỗi 4xx khác (khóa sai, body sai) dừng ngay.
    tries = max(1, int(_env("QUANLOP_RETRIES", default="6")))
    max_wait = float(_env("QUANLOP_RETRY_MAX_WAIT", default="60"))
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(base + "/v1/images", data=raw, method="POST", headers={
            "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "image/*, application/json",
            "User-Agent": "video-studio/1.0 (+media_gen)"})
        wait = 0.0
        try:
            with urllib.request.urlopen(req, timeout=int(_env("QUANLOP_TIMEOUT", default="180"))) as r:
                data, ct = r.read(), r.headers.get("Content-Type", "")
            break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:300].replace(key, "[key]")
            last = RuntimeError(f"quanlop HTTP {e.code}: {msg}")
            if e.code not in (429, 500, 502, 503, 504): raise last
            # 502: gateway không tạo được ảnh với tỷ lệ cố định (mọi provider hỗ trợ tỷ lệ lỗi, VD Gemini hết quota,
            # Grok hết credit). Qua Cloudflare nội dung lỗi bị thay, nên chỉ dựa vào mã. Gọi lại ngay không ghi tỷ lệ.
            if free_ok and "aspect_ratio" in body and e.code == 502:
                print("quanlop: hết provider cho tỷ lệ cố định -> gọi lại không ghi tỷ lệ (Codex), cắt về khung dọc khi render", file=sys.stderr)
                body = {"prompt": QUANLOP_FREE_ASPECT_HINT + prompt}
                raw = encode(body)
                continue
            try: wait = float(e.headers.get("Retry-After") or 0)
            except (TypeError, ValueError, AttributeError): wait = 0.0
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            last = RuntimeError(f"quanlop lỗi mạng: {e}")
        if attempt + 1 < tries:
            delay = min(wait or 10 * 2 ** attempt, max_wait)
            print(f"quanlop: {last} -> thử lại sau {delay:.0f}s ({attempt + 2}/{tries})", file=sys.stderr)
            time.sleep(delay)
    else:
        raise last or RuntimeError("quanlop lỗi")
    if ct.startswith("application/json") or data[:1] == b"{":
        return _save_result(json.loads(data), out)
    if not (data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff" or data[:4] == b"RIFF"):
        raise RuntimeError(f"quanlop trả dữ liệu không phải ảnh ({ct or 'không rõ'}, {len(data)} byte)")
    _write_image(data, out)
    return True

def _write_image(data, out):
    """Ghi ảnh; nếu định dạng khác đuôi file (.png/.jpg) thì chuyển bằng Pillow (nếu có)."""
    want_png = out.lower().endswith(".png"); is_png = data[:4] == b"\x89PNG"
    if want_png == is_png or not out.lower().endswith((".png", ".jpg", ".jpeg")):
        open(out, "wb").write(data); return
    try:
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        (im if want_png else im.convert("RGB")).save(out, "PNG" if want_png else "JPEG", quality=92)
    except ImportError:
        open(out, "wb").write(data)

IMAGE_PROVIDERS = {"openai": img_openai, "xai": img_xai, "hf-kontext": img_hf_kontext, "gemini": img_gemini, "quanlop": img_quanlop}
ASPECT_PROVIDERS = {"gemini", "quanlop"}
DEFAULT_FALLBACK = {"quanlop": ["gemini"]}
LAST_PROVIDER = None

# ---------------------------------------------------------------- provider tự thêm (giao diện)
CUSTOM_KINDS = {"openai", "gemini"}

def _env_file_value(name):
    """Đọc 1 biến từ ENV_FILE (khoá vừa lưu trên giao diện, tiến trình chưa nạp lại env)."""
    f = os.environ.get("ENV_FILE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try: lines = open(f, encoding="utf-8").read().splitlines()
    except OSError: return None
    val = None
    for line in lines:
        k, sep, v = line.strip().removeprefix("export ").partition("=")
        if sep and k.strip() == name:
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1].replace('\\"', '"').replace("\\\\", "\\") if v[0] == '"' else v[1:-1]
            val = v
    return val

def custom_key_env(pid):
    return "IMAGE_PROVIDER_KEY__" + pid.upper().replace("-", "_")

def custom_providers():
    """{id: cfg} từ DATA_DIR/image-providers.json (đọc mỗi lần gọi để thấy provider vừa thêm)."""
    data_dir = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    try: raw = json.load(open(os.path.join(data_dir, "image-providers.json"), encoding="utf-8"))
    except (OSError, ValueError): return {}
    out = {}
    for p in raw.get("providers") or []:
        pid = str(p.get("id") or "").lower()
        if pid and p.get("kind") in CUSTOM_KINDS and p.get("baseUrl") and pid not in IMAGE_PROVIDERS: out[pid] = p
    return out

def run_custom(p, prompt, refs, out, aspect):
    name = custom_key_env(p["id"])
    fresh = _env_file_value(name)   # file env mới hơn môi trường lúc khởi động (khoá đổi/xoá trên giao diện)
    key = fresh if fresh is not None else os.environ.get(name, "")
    cfg = {"baseUrl": p["baseUrl"], "key": key, "model": p.get("model") or "", "size": p.get("size") or "",
           **({"maxRefs": int(p["maxRefs"])} if str(p.get("maxRefs", "")).strip() != "" else {})}
    if p["kind"] == "gemini": return img_gemini(prompt, refs, out, aspect or p.get("aspect"), cfg=cfg)
    return img_openai(prompt, refs, out, cfg=cfg)

def build_prompt(visual, character=None, setting=None):
    """Prompt cảnh luôn kèm mô tả cố định nhân vật + bối cảnh để giữ nhất quán kể cả khi không gửi được ảnh ref."""
    parts = [visual or ""]
    if character: parts.append(f"Same recurring character in every scene: {character}")
    if setting: parts.append(f"Same location in every scene: {setting}")
    parts.append("Photorealistic vertical 9:16 photo, natural light, no text, no watermark.")
    return " ".join(p.strip().rstrip(".") + "." for p in parts if p and p.strip())

def load_character_prompt(path, visual):
    """Character profile JSON {description, setting, refs[], seed, ...} -> (prompt, refs, seed). Paths relative to the JSON."""
    """Also accepts an app profile (data/profiles/<slug>.json[#characterId]): uses cast.characters/settings, refs relative to DATA_DIR."""
    cid = None
    if "#" in path: path, cid = path.split("#", 1)
    p = json.load(open(path, encoding="utf-8")); base = os.path.dirname(os.path.abspath(path))
    if "cast" in p:
        cast = p["cast"] or {}; chars = cast.get("characters") or []; sets = cast.get("settings") or []
        c = next((x for x in chars if x.get("id") == cid), chars[0] if chars else {}); st = sets[0] if sets else {}
        data_dir = os.path.dirname(base)
        refs = [os.path.join(data_dir, r) for r in (c.get("refs", []) + st.get("refs", []))]
        return build_prompt(visual, c.get("description"), st.get("description")), refs, c.get("seed")
    refs = [r if os.path.isabs(r) else os.path.join(base, r) for r in p.get("refs", [])]
    return build_prompt(visual, p.get("description"), p.get("setting")), refs, p.get("seed")

def provider_chain(provider=None):
    """[provider chính, dự phòng...]: provider (profile/CLI) > IMAGE_PROVIDER; dự phòng IMAGE_FALLBACK hoặc mặc định."""
    prov = (provider or _env("IMAGE_PROVIDER", default="") or ("openai" if _env("IMAGE_BASE_URL") else "")).strip().lower()
    if prov in ("", "none"): return []
    fb = _env("IMAGE_FALLBACK")
    rest = [x.strip().lower() for x in fb.split(",")] if fb is not None else DEFAULT_FALLBACK.get(prov, [])
    chain = [prov]
    for x in rest:
        if x and x != "none" and x not in chain: chain.append(x)
    return chain

def generate_image(prompt, out, refs=None, aspect=None, provider=None):
    """Trả True nếu sinh được ảnh; False nếu chưa cấu hình provider. Provider chính lỗi -> thử dự phòng (IMAGE_FALLBACK)."""
    global LAST_PROVIDER
    chain = provider_chain(provider)
    if not chain: return False
    custom = custom_providers()
    if chain[0] not in IMAGE_PROVIDERS and chain[0] not in custom: raise RuntimeError(f"IMAGE_PROVIDER không hỗ trợ: {chain[0]}")
    refs = [r for r in (refs or []) if r and os.path.exists(r)]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    errors = []
    for prov in chain:
        fn = IMAGE_PROVIDERS.get(prov)
        if not fn and prov not in custom: errors.append(f"{prov}: không hỗ trợ"); continue
        try:
            if not fn: ok = run_custom(custom[prov], prompt, refs, out, aspect)
            else: ok = fn(prompt, refs, out, aspect) if prov in ASPECT_PROVIDERS else fn(prompt, refs, out)
            LAST_PROVIDER = prov
            if errors: print(f"ảnh: dùng dự phòng {prov} sau lỗi: {'; '.join(errors)}", file=sys.stderr)
            return ok
        except Exception as e:
            errors.append(f"{prov}: {str(e)[:240]}")
            print(f"ảnh: {prov} lỗi: {str(e)[:240]}", file=sys.stderr)
    raise RuntimeError("Sinh ảnh lỗi (" + " | ".join(errors) + ")")

# ---------------------------------------------------------------- video providers
def vid_xai(image, prompt, out, seconds):
    key = _env("XAI_API_KEY", "VIDEO_API_KEY"); base = _env("XAI_BASE_URL", default="https://api.x.ai/v1").rstrip("/")
    if not key: raise RuntimeError("thiếu XAI_API_KEY")
    j = _post_json(base + "/videos/generations", {"model": _env("VIDEO_MODEL", default="grok-imagine-video"), "prompt": prompt,
                   "image": {"url": _data_uri(image)}, "duration": int(seconds), "aspect_ratio": "9:16", "resolution": "720p"}, key)
    rid = j.get("request_id") or j.get("id")
    for _ in range(120):
        time.sleep(5)
        st, r = _get_json(f"{base}/videos/{rid}", key)
        if r.get("status") == "done" and r.get("video", {}).get("url"):
            urllib.request.urlretrieve(r["video"]["url"], out); return True
        if r.get("status") in ("failed", "expired") or r.get("error"): raise RuntimeError(f"xai video lỗi: {r}")
    raise RuntimeError("xai video quá thời gian")

def vid_veo(image, prompt, out, seconds):
    key = _env("GEMINI_API_KEY", "VIDEO_API_KEY")
    if not key: raise RuntimeError("thiếu GEMINI_API_KEY")
    model = _env("VIDEO_MODEL", default="veo-3.1-fast-generate-preview")
    if not model.startswith("veo"): model = "veo-3.1-fast-generate-preview"
    base = _env("GEMINI_BASE_URL", default="https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    dur = next((d for d in (4, 6, 8) if d >= seconds), 8)
    inst = {"prompt": prompt, "image": {"bytesBase64Encoded": base64.b64encode(open(image, "rb").read()).decode(),
                                        "mimeType": mimetypes.guess_type(image)[0] or "image/png"}}
    params = {"aspectRatio": _env("VIDEO_ASPECT", default="9:16"), "durationSeconds": dur,
              "resolution": _env("VIDEO_RESOLUTION", default="720p")}
    if _env("VIDEO_NEGATIVE"): params["negativePrompt"] = _env("VIDEO_NEGATIVE")
    if _env("VIDEO_PERSON"): params["personGeneration"] = _env("VIDEO_PERSON")
    def call(url, body=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     method="POST" if body is not None else "GET",
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"veo HTTP {e.code}: {e.read().decode(errors='replace')[:400].replace(key, '[key]')}")
    op = call(f"{base}/models/{model}:predictLongRunning", {"instances": [inst], "parameters": params})
    name = op["name"]
    for _ in range(90):
        if op.get("done"): break
        time.sleep(10); op = call(f"{base}/{name}")
    if not op.get("done"): raise RuntimeError("veo quá thời gian")
    if op.get("error"): raise RuntimeError(f"veo lỗi: {str(op['error'])[:300]}")
    resp = op.get("response") or {}
    samples = (resp.get("generateVideoResponse") or resp).get("generatedSamples") or (resp.get("generatedVideos") or [])
    if not samples: raise RuntimeError(f"veo không trả video: {str(resp)[:300]}")
    uri = (samples[0].get("video") or {}).get("uri")
    req = urllib.request.Request(uri, headers={"x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=300) as r, open(out, "wb") as f: shutil.copyfileobj(r, f)
    return True

VIDEO_PROVIDERS = {"xai": vid_xai, "veo": vid_veo}

def generate_video(image, prompt, out, seconds=5):
    prov = (_env("VIDEO_PROVIDER", default="") or "").lower()
    if prov in ("", "none"): return False
    fn = VIDEO_PROVIDERS.get(prov)
    if not fn: raise RuntimeError(f"VIDEO_PROVIDER chưa có adapter: {prov} (TODO)")
    return fn(image, prompt, out, seconds)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["image", "video"])
    ap.add_argument("--prompt", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--ref", action="append", default=[]); ap.add_argument("--image"); ap.add_argument("--seconds", type=float, default=5)
    ap.add_argument("--aspect", help="tỉ lệ ảnh (gemini/quanlop), VD 9:16, 16:9, 1:1")
    ap.add_argument("--provider", help="provider ảnh cho lần này (ghi đè IMAGE_PROVIDER), VD quanlop, gemini")
    ap.add_argument("--character", help="character profile JSON (motion-video characters/*.json) or app profile data/profiles/<slug>.json[#characterId]: adds fixed description/setting + refs")
    a = ap.parse_args()
    if a.character:
        a.prompt, refs, seed = load_character_prompt(a.character, a.prompt)
        a.ref = a.ref + [r for r in refs if r not in a.ref]
        if seed is not None: os.environ.setdefault("IMAGE_SEED", str(seed))
    ok = generate_image(a.prompt, a.out, a.ref, a.aspect, a.provider) if a.kind == "image" else generate_video(a.image, a.prompt, a.out, a.seconds)
    print(json.dumps({"ok": bool(ok), "out": a.out if ok else None, **({"provider": LAST_PROVIDER} if a.kind == "image" and ok else {})}))
    sys.exit(0 if ok else 2)
