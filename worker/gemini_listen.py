"""worker/gemini_listen.py — "nghe thử" giọng đọc bằng Gemini (audio input) để bắt lỗi phát âm mà whisper bỏ sót.

Whisper chỉ phiên âm (dễ "tự sửa" lỗi thanh điệu, viết số thành 1968...). Ở đây gửi audio từng cảnh + các câu kỳ vọng
cho một model Gemini Flash có audio input, yêu cầu JSON có cấu trúc: từng câu đọc đúng không, từ đọc sai / méo /
sai thanh điệu, ngắt nghỉ bất thường, tiếng rè/robot, kèm mốc thời gian + độ tin cậy.

Dùng trong worker (tts_qc / render.py) khi bật TTS_QC_GEMINI=1 hoặc profile.ttsQc.gemini = true, và qua CLI:
    python worker/gemini_listen.py --video vid-su-15                 # đọc media/out/vid-su-15.mp4 + timeline
    python worker/gemini_listen.py --mp4 x.mp4 --video vid-su-15      # mp4 khác, kịch bản lấy từ video JSON
    python worker/gemini_listen.py --wav a.wav --text "Câu một. Câu hai."
Biến: GEMINI_API_KEY (bắt buộc; không bao giờ in ra), TTS_QC_GEMINI_MODEL (mặc định gemini-3.5-flash-lite),
TTS_QC_GEMINI_MIN_CONF (mặc định 0.7), GEMINI_BASE_URL.
Chi phí: đọc usageMetadata của từng lượt gọi, nhân bảng giá PRICES (USD / 1M token, bảng giá ai.google.dev 10/2026).
"""
import argparse, base64, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request

DEFAULT_MODEL = "gemini-3.5-flash-lite"
# USD / 1M token (Standard, paid tier), giá audio input: ai.google.dev/gemini-api/docs/pricing (cập nhật 2026-10-16)
PRICES = {
    "gemini-3.5-flash-lite": {"in_text": 0.30, "in_audio": 0.30, "out": 2.50},
    "gemini-3.8-flash": {"in_text": 0.75, "in_audio": 0.75, "out": 3.75},
    "gemini-3.6-flash": {"in_text": 0.75, "in_audio": 0.75, "out": 3.75},
    "gemini-3.1-flash-lite": {"in_text": 0.25, "in_audio": 0.50, "out": 1.50},
    "gemini-3-flash-preview": {"in_text": 0.50, "in_audio": 1.00, "out": 3.00},
}
ISSUE_TYPES = ["mispronounced", "wrong_tone", "garbled", "missing_word", "extra_word", "unnatural_pause", "robotic", "other"]
# loại lỗi làm câu "hỏng" (sinh lại); unnatural_pause / other chỉ hỏng khi độ tin cậy rất cao
HARD = {"mispronounced", "wrong_tone", "garbled", "missing_word", "extra_word", "robotic"}

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "sentences": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "index": {"type": "INTEGER"},
            "heard": {"type": "STRING", "description": "Những gì thực sự nghe được, viết tiếng Việt có dấu"},
            "pronunciation_ok": {"type": "BOOLEAN"},
            "issues": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "word": {"type": "STRING", "description": "từ trong câu kỳ vọng bị lỗi"},
                "heard_as": {"type": "STRING"},
                "type": {"type": "STRING", "enum": ISSUE_TYPES},
                "start_s": {"type": "NUMBER", "description": "giây tính từ đầu đoạn audio"},
                "confidence": {"type": "NUMBER", "description": "0..1"},
                "note": {"type": "STRING"}},
                "required": ["word", "type", "start_s", "confidence"]}}},
            "required": ["index", "heard", "pronunciation_ok", "issues"]}},
        "naturalness": {"type": "INTEGER", "description": "1 (robot) .. 5 (tự nhiên như người đọc)"}},
    "required": ["sentences", "naturalness"]}

PROMPT = """Bạn là biên tập viên âm thanh người Việt (giọng chuẩn), kiểm tra một đoạn đọc TTS tiếng Việt cho video lịch sử.
Nghe kỹ đoạn audio đính kèm và so với kịch bản kỳ vọng (các câu được đọc theo đúng thứ tự, cách nhau bằng khoảng lặng ngắn).
Với TỪNG câu, cho biết người nghe Việt có nghe đúng và tự nhiên không. Báo lỗi khi:
- mispronounced: từ đọc sai âm (phụ âm/vần), người nghe sẽ hiểu thành từ khác;
- wrong_tone: sai thanh điệu (vd "nghe" thành "nghệ", "sử" thành "sự");
- garbled: méo, nhoè, lẫn âm, nuốt chữ, không nghe ra;
- missing_word / extra_word: thiếu hoặc thừa từ, lặp từ;
- unnatural_pause: ngắt nghỉ sai chỗ làm vỡ nghĩa hoặc khoảng lặng dài bất thường giữa câu;
- robotic: tiếng rè, kim loại, giật, nhiễu.
Lưu ý: số trong kịch bản đã viết bằng chữ, hãy so theo chữ (vd "chín trăm sáu mươi tám" KHÔNG phải 1968).
Tên nước ngoài (Tonkin, Tunquin, Alexandre de Rhodes, Alger...) được phép đọc theo kiểu Việt hoá; chỉ báo lỗi nếu
người nghe Việt không nhận ra tên đó hoặc nó nghe thành một từ tiếng Việt có nghĩa khác (vd "Tonkin" nghe thành "thông kinh").
Không bắt lỗi giọng điệu/cảm xúc, chỉ bắt lỗi nghe được thật. Không chắc thì để confidence thấp.
start_s là giây (xấp xỉ) tính từ đầu đoạn audio. pronunciation_ok = true nếu câu không có lỗi nào.
Kịch bản kỳ vọng:
{script}
"""

class GeminiError(RuntimeError):
    def __init__(self, msg, code=None):
        super().__init__(msg); self.code = code

def _key():
    k = os.environ.get("GEMINI_API_KEY")
    if not k: raise GeminiError("thiếu GEMINI_API_KEY")
    return k

def model_name():
    return os.environ.get("TTS_QC_GEMINI_MODEL") or DEFAULT_MODEL

def enabled(profile=None):
    """TTS_QC_GEMINI=1/0 ghi đè; không đặt thì theo profile.ttsQc.gemini. Cần GEMINI_API_KEY."""
    env = os.environ.get("TTS_QC_GEMINI")
    on = env == "1" if env in ("0", "1") else bool(((profile or {}).get("ttsQc") or {}).get("gemini"))
    return on and bool(os.environ.get("GEMINI_API_KEY"))

def cost_usd(usage, model):
    """usageMetadata -> USD. Token audio tính theo giá audio, phần còn lại của prompt theo giá text; output gồm thinking."""
    p = PRICES.get(model) or PRICES[DEFAULT_MODEL]
    prompt = usage.get("promptTokenCount", 0)
    audio = sum(d.get("tokenCount", 0) for d in usage.get("promptTokensDetails") or [] if d.get("modality") == "AUDIO")
    out = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return ((prompt - audio) * p["in_text"] + audio * p["in_audio"] + out * p["out"]) / 1e6

def _audio_b64(path, start=None, dur=None):
    """Cắt (tuỳ chọn) + nén mono 16 kHz MP3 64 kbps để gửi inline (một cảnh ~10 s ≈ 80 KB)."""
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "a.mp3")
        cmd = ["ffmpeg", "-y", "-v", "error"] + (["-ss", f"{start:.3f}"] if start else []) + ["-i", path] \
            + (["-t", f"{dur:.3f}"] if dur else []) + ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out]
        subprocess.run(cmd, check=True)
        return base64.b64encode(open(out, "rb").read()).decode()

def _post(model, body, timeout=180):
    key = _key()
    base = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    req = urllib.request.Request(f"{base}/models/{model}:generateContent", data=json.dumps(body).encode(), method="POST",
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")[:400].replace(key, "[key]")
        raise GeminiError(f"gemini HTTP {e.code}: {msg}", e.code) from None

def parse_response(j):
    """Lấy JSON từ candidates[0]; chịu được ```json ... ``` bao ngoài."""
    for c in j.get("candidates") or []:
        txt = "".join(p.get("text", "") for p in (c.get("content") or {}).get("parts") or [] if not p.get("thought"))
        if txt.strip():
            txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt.strip())
            return json.loads(txt)
    raise GeminiError(f"gemini không trả nội dung: {str(j.get('promptFeedback') or j)[:300]}")

def judge(result, sentences, min_conf=None):
    """Chuẩn hoá kết quả -> [{index, text, ok, issues, heard}] theo đúng thứ tự `sentences`."""
    min_conf = float(min_conf if min_conf is not None else os.environ.get("TTS_QC_GEMINI_MIN_CONF", "0.7"))
    by = {int(s.get("index", -1)): s for s in result.get("sentences") or []}
    out = []
    for i, text in enumerate(sentences, 1):
        s = by.get(i) or {}
        issues = [x for x in s.get("issues") or [] if isinstance(x, dict)]
        bad = [x for x in issues if float(x.get("confidence") or 0) >= (min_conf if x.get("type") in HARD else max(min_conf, 0.85))]
        out.append({"index": i, "text": text, "ok": not bad, "issues": issues, "bad": bad, "heard": s.get("heard", ""),
                    "missing": not s})
    return out

def listen(audio_path, sentences, start=None, dur=None, model=None, retries=2):
    """Gửi một đoạn audio + danh sách câu kỳ vọng. Trả {"sentences": judge(...), "naturalness", "usage", "cost_usd", "model"}."""
    model = model or model_name()
    script = "\n".join(f"{i}. {t}" for i, t in enumerate(sentences, 1))
    gen = {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0}
    body = {"contents": [{"role": "user", "parts": [
        {"inline_data": {"mime_type": "audio/mp3", "data": _audio_b64(audio_path, start, dur)}},
        {"text": PROMPT.replace("{script}", script)}]}], "generationConfig": dict(gen, thinkingConfig={"thinkingLevel": "low"})}
    last = None
    for a in range(retries + 1):
        try:
            j = _post(model, body)
            res = parse_response(j)
            usage = j.get("usageMetadata") or {}
            return {"sentences": judge(res, sentences), "naturalness": res.get("naturalness"), "usage": usage,
                    "cost_usd": cost_usd(usage, model), "model": model}
        except GeminiError as e:
            last = e
            if "thinking" in str(e).lower() and "thinkingConfig" in body["generationConfig"]:
                body["generationConfig"] = gen; continue           # model không hỗ trợ thinkingLevel
            if e.code and 400 <= e.code < 500 and e.code != 429: raise   # lỗi yêu cầu/khoá: không thử lại
            time.sleep(4 * (a + 1))
        except (json.JSONDecodeError, urllib.error.URLError, TimeoutError) as e:
            last = GeminiError(f"gemini lỗi: {e}"); time.sleep(4 * (a + 1))
    raise last

class Ledger:
    """Cộng dồn token + chi phí trong một lần render / CLI."""
    def __init__(self): self.calls = 0; self.prompt = 0; self.audio = 0; self.out = 0; self.usd = 0.0
    def add(self, r):
        u = r.get("usage") or {}; self.calls += 1; self.prompt += u.get("promptTokenCount", 0)
        self.audio += sum(d.get("tokenCount", 0) for d in u.get("promptTokensDetails") or [] if d.get("modality") == "AUDIO")
        self.out += u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0); self.usd += r.get("cost_usd", 0.0)
    def summary(self):
        return {"calls": self.calls, "prompt_tokens": self.prompt, "audio_tokens": self.audio, "output_tokens": self.out,
                "cost_usd": round(self.usd, 6)}
    def __str__(self):
        return f"{self.calls} lượt, {self.prompt} token vào ({self.audio} audio), {self.out} token ra, ≈ ${self.usd:.4f}"

def fmt_issue(x):
    h = f" → '{x['heard_as']}'" if x.get("heard_as") else ""
    return f"{x.get('type')} '{x.get('word')}'{h} @{float(x.get('start_s') or 0):.1f}s ({float(x.get('confidence') or 0):.2f})"

# ---------- tích hợp worker: nghe từng cảnh sau QC whisper, câu sai -> sinh lại ----------
def scene_qc(src_wav, qc, voice, regen, ledger, log=None, rounds=None, model=None):
    """qc: danh sách câu (dict có "text" = câu đã chuẩn hoá) của một cảnh VieNeu, audio ở src_wav.
    Câu có phán quyết Gemini (cùng model) đã lưu trong sidecar và đạt thì không gọi lại (khỏi tốn tiền khi render lại).
    Câu bị Gemini bắt lỗi: đánh dấu sidecar ok=False rồi gọi regen() (= tts_qc.vieneu_scene_qc lại) để sinh câu đó,
    tối đa `rounds` vòng (TTS_QC_GEMINI_ROUNDS, mặc định 2). Trả (qc mới, src_wav) với mỗi câu thêm khoá "gemini"."""
    import tts_qc
    model = model or model_name(); rounds = int(rounds if rounds is not None else os.environ.get("TTS_QC_GEMINI_ROUNDS", "2"))
    for rnd in range(rounds + 1):
        cached = [(q.get("gemini") or {}) for q in qc]
        if all(c.get("ok") and c.get("model") == model for c in cached):
            return qc
        r = listen(src_wav, [q["text"] for q in qc], model=model); ledger.add(r)
        bad = []
        for q, g in zip(qc, r["sentences"]):
            q["gemini"] = {"ok": g["ok"], "model": model, "heard": g["heard"], "issues": g["issues"]}
            tts_qc.mark(voice, q["text"], gemini=q["gemini"])
            if not g["ok"]: bad.append((q, g))
        if log: log(f"Gemini nghe: {len(qc) - len(bad)}/{len(qc)} câu đạt (tự nhiên {r.get('naturalness')}/5, ${r['cost_usd']:.5f})"
                    + "".join(f"; '{q['text'][:30]}': " + ", ".join(fmt_issue(x) for x in g["bad"]) for q, g in bad))
        if not bad or rnd == rounds: return qc
        for q, g in bad:
            tts_qc.mark(voice, q["text"], ok=False, gemini_reject="; ".join(fmt_issue(x) for x in g["bad"]))
        qc = regen()
    return qc

# ---------- CLI: kiểm tra mp4 có sẵn theo từng cảnh ----------
def _sentences_of(narration):
    sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)), os.path.join(os.path.dirname(os.path.abspath(__file__)), "mvlib")]
    import vn_norm
    return [c.strip() for c, _ in vn_norm.split_pauses(narration) if c.strip()] if "[pause" in narration else \
        [s.strip() for s in re.split(r"(?<=[.!?…])\s+", vn_norm.strip_markers(narration)) if s.strip()]

def check_video(video_id, mp4=None, root=None, model=None, log=print):
    root = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    v = json.load(open(os.path.join(root, "data", "videos", f"{video_id}.json"), encoding="utf-8"))
    mp4 = mp4 or os.path.join(root, "media", "out", f"{video_id}.mp4")
    tl_path = mp4[:-4] + ".timeline.json"
    if not os.path.exists(tl_path): tl_path = os.path.join(root, "media", "out", f"{video_id}.timeline.json")
    tl = json.load(open(tl_path, encoding="utf-8"))
    scenes = [s for s in v["scenes"] if (s.get("narration") or "").strip() or s.get("title")]
    led, rows = Ledger(), []
    for i, (sc, seg) in enumerate(zip(scenes, tl), 1):
        sents = _sentences_of(sc.get("narration") or "")
        if not sents: continue
        r = listen(mp4, sents, start=seg["start"], dur=seg["end"] - seg["start"] + 0.15, model=model); led.add(r)
        for s in r["sentences"]:
            rows.append({"scene": i, **s, "t0": seg["start"]})
            mark = "OK " if s["ok"] else "LỖI"
            log(f"cảnh {i} câu {s['index']} {mark} {s['text'][:60]}" + ("" if s["ok"] else " | " + "; ".join(fmt_issue(x) for x in s["bad"])))
        log(f"  cảnh {i}: tự nhiên {r.get('naturalness')}/5, ${r['cost_usd']:.5f}")
    rep = {"video": video_id, "mp4": mp4, "model": model or model_name(), "sentences": rows,
           "bad": sum(not r["ok"] for r in rows), "total": len(rows), "usage": led.summary()}
    log(f"{video_id}: {rep['total'] - rep['bad']}/{rep['total']} câu đạt · {led}")
    return rep

def main(argv=None):
    ap = argparse.ArgumentParser(description="Nghe kiểm tra phát âm bằng Gemini (không in khoá API).")
    ap.add_argument("--video"); ap.add_argument("--mp4"); ap.add_argument("--wav"); ap.add_argument("--text")
    ap.add_argument("--model"); ap.add_argument("--root", help="thư mục video-studio (mặc định: cha của worker/)")
    ap.add_argument("--out", help="ghi báo cáo JSON (mặc định <mp4>.gemini.json)")
    a = ap.parse_args(argv)
    if a.wav:
        if not a.text: ap.error("--wav cần --text")
        r = listen(a.wav, _sentences_of(a.text), model=a.model)
        print(json.dumps({k: r[k] for k in ("sentences", "naturalness", "cost_usd", "model")}, ensure_ascii=False, indent=1)); return 0
    if not a.video: ap.error("cần --video (hoặc --wav/--text)")
    rep = check_video(a.video, a.mp4, root=a.root, model=a.model)
    out = a.out or rep["mp4"][:-4] + ".gemini.json"
    json.dump(rep, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1); print("báo cáo:", out)
    return 1 if rep["bad"] else 0

if __name__ == "__main__":
    sys.exit(main())
