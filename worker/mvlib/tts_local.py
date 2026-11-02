"""tts_local.py - shared TTS + timing helpers (motion-video make_video.py and video-studio worker).
Backends: edge (exact word timestamps, cached by hash, concurrent), gTTS, datxanh (remote VieNeu Gradio),
vieneu (local VieNeu-TTS v3 Turbo, CPU). align_words(): faster-whisper word timestamps mapped onto script tokens.
Env: MV_TTS_CACHE (cache dir, default <here>/.tts_cache), MV_MODELS_DIR (default <here>/models: hf/, whisper/),
VIENEU_PRECISION (int8|fp32)."""
import asyncio, json, os, re, subprocess
async def edge_tts_scene(text, voice, rate, mp3):
    import edge_tts
    c = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(mp3, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["offset"]/1e7, (ch["offset"]+ch["duration"])/1e7, ch["text"]))
    return words

def _cache_dir():
    d = os.environ.get("MV_TTS_CACHE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tts_cache"); os.makedirs(d, exist_ok=True); return d

async def edge_tts_all(jobs):
    """jobs: list of (text, voice, rate, mp3). Cached by sha1(voice|rate|text); uncached run concurrently."""
    import hashlib, shutil
    async def one(text, voice, rate, mp3):
        k = os.path.join(_cache_dir(), "edge_" + hashlib.sha1(f"{voice}|{rate}|{text}".encode()).hexdigest())
        if os.path.exists(k + ".mp3") and os.path.exists(k + ".json"):
            shutil.copy(k + ".mp3", mp3); return [tuple(w) for w in json.load(open(k + ".json"))]
        for attempt in range(3):
            try:
                words = await edge_tts_scene(text, voice, rate, mp3); break
            except Exception:
                if attempt == 2: raise
                await asyncio.sleep(1.5)
        shutil.copy(mp3, k + ".mp3"); json.dump(words, open(k + ".json", "w"), ensure_ascii=False)
        return words
    sem = asyncio.Semaphore(4)
    async def lim(*a):
        async with sem: return await one(*a)
    return await asyncio.gather(*(lim(*j) for j in jobs))

def gtts_scene(text, lang, mp3):
    from gtts import gTTS
    gTTS(text, lang=lang).save(mp3)
    d = probe_dur(mp3); toks = text.split(); tot = sum(len(t) for t in toks) or 1
    t, words = 0.0, []
    for w in toks:  # estimated timing proportional to word length
        dd = d*len(w)/tot; words.append((t, t+dd, w)); t += dd
    return words

DATXANH_URL = os.environ.get("DATXANH_TTS_URL", "https://tts.datxanhmientrung.ai/")
_dx_client = None
def split_phrases(text, maxw=14):
    """Split narration into short phrases at punctuation; long ones split into balanced chunks."""
    out = []
    for seg in re.findall(r"[^.!?;,:]+[.!?;,:]*", text):
        ws = seg.split(); n = -(-len(ws)//maxw) or 1; size = -(-len(ws)//n)
        for j in range(0, len(ws), size):
            out.append(" ".join(ws[j:j+size]))
    return [o for o in out if re.search(r"\w", o)]

def datxanh_scene(text, voice, out_wav, tmp, temperature=0.8):
    """VieNeu-TTS Gradio app (no auth). No word timestamps -> synthesize per phrase,
    measure each clip, spread word timings inside the phrase by character length."""
    global _dx_client
    from gradio_client import Client
    import shutil
    if _dx_client is None: _dx_client = Client(DATXANH_URL, verbose=False)
    words, clips, t = [], [], 0.0
    import hashlib
    cdir = _cache_dir()
    for k, ph in enumerate(split_phrases(text)):
        cached = os.path.join(cdir, hashlib.sha1(f"{voice}|{temperature}|{ph}".encode()).hexdigest() + ".wav")
        for attempt in range(3):
            if os.path.exists(cached): src = cached; break
            try:
                r = _dx_client.predict(ph, voice, None, "", "Standard (Một lần)", True, 16,
                                       temperature, 256, True, api_name="/wrapper")
                src = r[0] if isinstance(r, (list, tuple)) else r
                if isinstance(src, dict): src = src.get("path") or src.get("value")
                shutil.copy(src, cached)
                break
            except Exception as e:
                if attempt == 2: raise
                print("datxanh retry:", e)
        clip = os.path.join(tmp, f"{os.path.basename(out_wav)}_{k}.wav")
        # trim leading/trailing silence so phrase timing is tight
        subprocess.run(["ffmpeg","-y","-v","error","-i",src,"-af",
            "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.25",
            "-ar","48000","-ac","2",clip], check=True)
        d = probe_dur(clip); toks = ph.split(); tot = sum(len(x) for x in toks) or 1
        speak = max(d - 0.25, 0.1); u = t
        for w in toks:
            dd = speak*len(w)/tot; words.append((u, u+dd, w)); u += dd
        t += d; clips.append(clip)
    lst = out_wav + ".txt"; open(lst,"w").write("".join(f"file '{c}'\n" for c in clips))
    subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",lst,"-c","copy",out_wav], check=True)
    return words

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get("MV_MODELS_DIR") or os.path.join(HERE, "models")
_vn = None
def vieneu_model():
    global _vn
    if _vn is None:
        hf = os.path.join(MODELS, "hf")
        old = {k: os.environ.get(k) for k in ("HF_HUB_CACHE", "HF_HUB_OFFLINE")}
        if os.path.isdir(hf):   # dereferenced local copy (onnxruntime rejects HF cache symlinks)
            os.environ["HF_HUB_CACHE"] = hf; os.environ["HF_HUB_OFFLINE"] = "1"
        try:
            import huggingface_hub.constants as hc; hc.HF_HUB_CACHE = os.environ.get("HF_HUB_CACHE", hc.HF_HUB_CACHE); hc.HF_HUB_OFFLINE = bool(os.environ.get("HF_HUB_OFFLINE"))
            from vieneu import Vieneu
            _vn = Vieneu(precision=os.environ.get("VIENEU_PRECISION", "int8"))
        finally:
            for k, v in old.items():
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v
            try:
                import huggingface_hub.constants as hc, importlib; importlib.reload(hc)
            except Exception: pass
    return _vn

def vieneu_scene(text, voice, out_wav, tmp):
    """VieNeu v3 Turbo (local CPU): whole sentences per pause-chunk, normalized text, cached by hash."""
    import hashlib, vn_norm
    clips = []
    for k, (chunk, pause) in enumerate(vn_norm.split_pauses(text)):
        if chunk:
            sp = vn_norm.normalize(chunk)
            cached = os.path.join(_cache_dir(), "vn_" + hashlib.sha1(f"{voice}|{sp}".encode()).hexdigest() + ".wav")
            if not os.path.exists(cached):
                m = vieneu_model(); m.save(m.infer(sp, voice=voice), cached)
            c = os.path.join(tmp, f"{os.path.basename(out_wav)}_{k}.wav")
            subprocess.run(["ffmpeg","-y","-v","error","-i",cached,"-af",
                "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                "-ar","48000","-ac","2",c], check=True); clips.append(c)
        if pause:
            c = os.path.join(tmp, f"{os.path.basename(out_wav)}_{k}_p.wav")
            subprocess.run(["ffmpeg","-y","-v","error","-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t",f"{pause}",c], check=True); clips.append(c)
    lst = out_wav + ".txt"; open(lst,"w").write("".join(f"file '{c}'\n" for c in clips))
    subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0","-i",lst,"-c","copy",out_wav], check=True)
    return estimate_words(text, probe_dur(out_wav))

def estimate_words(text, dur):
    import vn_norm
    toks = vn_norm.spoken_tokens(text); tot = sum(len(sp) for _, sp in toks) or 1; t, out = 0.0, []
    for o, sp in toks:
        d = dur * len(sp) / tot; out.append((t, t + d, o)); t += d
    return out

_wh = None
def align_words(audio, text, model="small"):
    """faster-whisper word timestamps (CPU int8) mapped onto the script tokens with difflib.
    Returns [(start, end, original_token)] or None if unavailable."""
    global _wh
    import difflib, numpy as np, vn_norm
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    if _wh is None: _wh = WhisperModel(model, device="cpu", compute_type="int8",
                                         download_root=os.path.join(MODELS, "whisper"))
    pcm = np.frombuffer(subprocess.check_output(["ffmpeg","-v","error","-i",audio,"-ar","16000","-ac","1","-f","f32le","-"]), np.float32)
    toks = vn_norm.spoken_tokens(text); spoken = []
    for i, (o, sp) in enumerate(toks):
        for w in sp.split(): spoken.append((re.sub(r"[^\w]", "", w.lower()), i))
    segs, _ = _wh.transcribe(pcm, language="vi", word_timestamps=True, initial_prompt=" ".join(sp for _, sp in toks)[:800],
                             vad_filter=False, beam_size=5, condition_on_previous_text=False)
    hyp = [(re.sub(r"[^\w]", "", w.word.lower()), w.start, w.end) for s in segs for w in s.words]
    if not hyp: return None
    sm = difflib.SequenceMatcher(None, [w for w, _ in spoken], [h[0] for h in hyp], autojunk=False)
    times = [None] * len(spoken)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): times[a + k] = (hyp[b + k][1], hyp[b + k][2])
    for op, a1, a2, b1, b2 in sm.get_opcodes():   # replaced spans: spread hyp time over spoken words
        if op == "replace" and b2 > b1:
            t0, t1 = hyp[b1][1], hyp[b2 - 1][2]
            for k in range(a1, a2): times[k] = (t0 + (t1 - t0) * (k - a1) / (a2 - a1), t0 + (t1 - t0) * (k - a1 + 1) / (a2 - a1))
    matched = sum(1 for t in times if t); dur = probe_dur(audio)
    # interpolate gaps
    for k in range(len(times)):
        if times[k] is None:
            prev = next((times[j][1] for j in range(k - 1, -1, -1) if times[j]), 0.0)
            nxt = next((times[j][0] for j in range(k + 1, len(times)) if times[j]), dur)
            gap = [j for j in range(k, len(times)) if times[j] is None]; run = 1
            while k + run < len(times) and times[k + run] is None: run += 1
            step = (nxt - prev) / (run + 0)
            for r in range(run): times[k + r] = (prev + step * r, prev + step * (r + 1))
    out = []
    for i, (o, sp) in enumerate(toks):
        ts_ = [times[k] for k, (_, ti) in enumerate(spoken) if ti == i]
        if ts_: out.append((ts_[0][0], ts_[-1][1], o))
    align_words.last_ratio = matched / max(1, len(spoken))
    return out

def probe_dur(f):
    return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f]).strip())

