"""worker/tts_qc.py — kiểm tra chất lượng từng câu TTS (VieNeu) trước khi dùng / ghi cache.

VieNeu lấy mẫu ngẫu nhiên nên đôi khi ra đoạn "rè/robot" hoặc lặp/bỏ chữ. Kiểm tra cũ (whisper cả cảnh, difflib theo
từ) bỏ sót lỗi ngắn. Ở đây chấm từng câu riêng:
  1. Whisper (word_timestamps) phiên âm lại câu -> so khớp theo ký tự (có dấu) với câu kỳ vọng; đếm cụm chèn/thay.
  2. Độ tin cậy từng từ (probability): từ < WORD_P_MIN hoặc trung bình thấp -> nghi đoạn rè.
  3. Âm học: tốc độ đọc bất thường (ký tự/giây), khoảng lặng giữa câu quá dài, cửa sổ 200 ms có độ phẳng phổ
     (spectral flatness) cao + năng lượng lớn (tiếng rè/noise), hoặc hai từ whisper cách nhau quá xa.
qc_take() trả dict {ok, score, reasons[], heard, ...}; vieneu_scene_qc() sinh lại tới TTS_QC_TRIES lần, giữ bản tốt nhất,
và ghi file .qc.json cạnh file cache: cache chỉ được dùng lại khi sidecar ghi ok (bản cache cũ không có sidecar sẽ bị
kiểm tra lại, hỏng thì sinh lại).
Biến môi trường: TTS_QC=0 tắt; TTS_QC_TRIES (mặc định 6); TTS_QC_MODEL (mặc định = ALIGN_MODEL hoặc "small").
"""
import difflib, hashlib, json, os, re, subprocess, unicodedata
import numpy as np

WORD_P_MIN = 0.35      # một từ dưới ngưỡng này bị coi là "không nghe rõ"
GOOD_MIN_P = 0.6       # bản đạt nhưng có từ < ngưỡng này -> thử thêm EXTRA_TRIES bản, giữ bản điểm cao nhất
EXTRA_TRIES = 2
MEAN_P_MIN = 0.55
CHAR_SIM_MIN = 0.86
CPS_RANGE = (9.0, 21.0)
GAP_MAX = 0.9          # giây lặng giữa hai từ trong cùng một câu
FLAT_MAX = 0.30        # spectral flatness (0..1) của cửa sổ có tiếng (tiếng rè/ồn trắng; giọng robot thường không bắt được)
WORD_DUR_MAX = 0.55    # giây cho một âm tiết

def _norm(t, D=None):
    import vn_norm
    t = vn_norm.normalize(vn_norm.strip_markers(t), D)
    t = unicodedata.normalize("NFC", t.lower())
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()

def _pcm(path, sr=16000):
    return np.frombuffer(subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-ar", str(sr), "-ac", "1",
                                                   "-f", "f32le", "-"]), np.float32)

_wh = {}
def _whisper():
    from faster_whisper import WhisperModel
    import tts_local
    name = os.environ.get("TTS_QC_MODEL") or os.environ.get("ALIGN_MODEL", "small")
    if name not in _wh:
        _wh[name] = WhisperModel(name, device="cpu", compute_type="int8",
                                 download_root=os.path.join(tts_local.MODELS, "whisper"))
    return _wh[name]

def flatness_windows(pcm, sr=16000, win=0.2):
    """[(t, flatness, rms)] cho từng cửa sổ có năng lượng (bỏ khoảng lặng)."""
    n = int(sr * win); out = []
    peak = float(np.abs(pcm).max() or 1)
    for i in range(0, max(0, len(pcm) - n), n // 2):
        x = pcm[i:i + n] * np.hanning(n); rms = float(np.sqrt(np.mean(x ** 2)))
        if rms < 0.04 * peak: continue
        p = np.abs(np.fft.rfft(x)) ** 2 + 1e-12
        out.append((i / sr, float(np.exp(np.mean(np.log(p))) / np.mean(p)), rms))
    return out

def word_issues(exp, got):
    """exp/got đã chuẩn hoá (_norm). Bỏ qua thay 1-1 (whisper sai chính tả); báo từ CHÈN thêm và mất >= 2 từ."""
    et, gt, out = exp.split(), got.split(), []
    for op, a, b, c, d in difflib.SequenceMatcher(None, et, gt, autojunk=False).get_opcodes():
        if op == "insert" or (op == "replace" and d - c > b - a):
            out.append(f"chèn từ {' '.join(gt[c:d])!r} (sau {' '.join(et[max(0, a - 2):a])!r})")
        elif (op == "delete" and b - a >= 2) or (op == "replace" and b - a - (d - c) >= 2):
            out.append(f"mất từ {' '.join(et[a:b])!r}")
    return out

def qc_take(wav, expected, D=None):
    pcm = _pcm(wav); dur = len(pcm) / 16000 or 0.01
    segs, _ = _whisper().transcribe(pcm, language="vi", beam_size=5, word_timestamps=True, temperature=0.0,
                                    condition_on_previous_text=False)
    segs = list(segs); words = [w for s in segs for w in (s.words or [])]
    heard = " ".join(s.text.strip() for s in segs)
    exp, got = _norm(expected, D), _norm(heard, D)
    sm = difflib.SequenceMatcher(None, exp, got, autojunk=False)
    sim = sm.ratio(); reasons = []
    if sim < CHAR_SIM_MIN: reasons.append(f"char_sim {sim:.2f}")
    # so khớp theo từ: whisper hay viết sai chính tả 1-1 (bỏ qua), nhưng từ CHÈN thêm / mất 2+ từ là dấu hiệu rè, lặp
    reasons += word_issues(exp, got)
    # từ kéo dài bất thường (âm tiết > WORD_DUR_MAX, trừ từ cuối và số)
    long_w = [(round(float(w.start), 2), w.word.strip(), round(float(w.end - w.start), 2)) for w in words[:-1]
              if w.end - w.start > WORD_DUR_MAX and not re.search(r"\d", w.word)]
    if long_w: reasons.append(f"từ kéo dài {long_w[:3]}")
    probs = [w.probability for w in words]
    low = [(round(float(w.start), 2), w.word.strip(), round(float(w.probability), 2)) for w in words if w.probability < WORD_P_MIN]
    if low: reasons.append(f"từ kém tin cậy {low[:4]}")
    if probs and float(np.mean(probs)) < MEAN_P_MIN: reasons.append(f"mean_p {np.mean(probs):.2f}")
    cps = len(exp.replace(" ", "")) / dur
    if len(exp) >= 25 and not (CPS_RANGE[0] <= cps <= CPS_RANGE[1]): reasons.append(f"tốc độ {cps:.1f} ký tự/s")
    gaps = [(round(float(a.end), 2), round(float(b.start - a.end), 2)) for a, b in zip(words, words[1:]) if b.start - a.end > GAP_MAX]
    if gaps: reasons.append(f"khoảng lặng {gaps[:3]}")
    if words and dur - words[-1].end > 0.8: reasons.append(f"đuôi thừa {dur - words[-1].end:.1f}s")
    fw = flatness_windows(pcm)
    noisy = [(round(t, 2), round(f, 2)) for t, f, _ in fw if f > FLAT_MAX]
    if noisy: reasons.append(f"phổ phẳng (rè) {noisy[:3]}")
    score = sim + 0.3 * (float(np.mean(probs)) if probs else 0) - 0.08 * len(reasons)
    return {"ok": not reasons, "score": round(score, 4), "sim": round(sim, 3), "mean_p": round(float(np.mean(probs)) if probs else 0, 3),
            "min_p": round(min(probs), 3) if probs else 0, "cps": round(cps, 1), "reasons": reasons, "heard": heard}

_warmed = set()
def _warm(m, voice):
    """Vài lượt infer đầu tiên sau khi nạp model hay ra tiếng rè -> chạy nháp 2 câu ngắn rồi bỏ."""
    if voice not in _warmed:
        for t in ("Xin chào các bạn.", "Hôm nay mình kể một chuyện sử."):
            try: m.infer(t, voice=voice)
            except Exception: pass
        _warmed.add(voice)
    return m

def enabled():
    if os.environ.get("TTS_QC", "1") == "0": return False
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False

def sidecar(voice, sp):
    """Đường dẫn file .qc.json của câu sp (đã chuẩn hoá) trong cache VieNeu."""
    import tts_local
    return os.path.join(tts_local._cache_dir(), "vn_" + hashlib.sha1(f"{voice}|{sp}".encode()).hexdigest() + ".qc.json")

def mark(voice, sp, **fields):
    """Ghi thêm trường vào sidecar (vd gemini=..., hoặc ok=False để buộc sinh lại câu)."""
    side = sidecar(voice, sp)
    q = json.load(open(side)) if os.path.exists(side) else {}
    q.update(fields); json.dump(q, open(side, "w"), ensure_ascii=False); return q

def vieneu_scene_qc(text, voice, out_wav, tmp, D=None, log=None):
    """Như tts_local.vieneu_scene nhưng kiểm tra + sinh lại từng câu; trả về (words, [qc từng câu])."""
    import tts_local, vn_norm
    tries = int(os.environ.get("TTS_QC_TRIES", "6")); clips, report = [], []
    for k, (chunk, pause) in enumerate(vn_norm.split_pauses(text)):
        if chunk:
            sp = vn_norm.normalize(chunk)
            side = sidecar(voice, sp); cached = side[:-8] + ".wav"
            qc = json.load(open(side)) if os.path.exists(cached) and os.path.exists(side) else None
            if qc is not None and qc.get("gemini_reject") and log:
                log(f"Gemini báo câu '{sp[:40]}' đọc sai: {qc['gemini_reject'][:160]} -> sinh lại")
            if os.path.exists(cached) and qc is None:
                qc = qc_take(cached, sp, D); qc["try"] = 0; json.dump(qc, open(side, "w"), ensure_ascii=False)
                if log and not qc["ok"]: log(f"QC bản cache '{sp[:40]}' hỏng: {'; '.join(qc['reasons'])[:160]} -> sinh lại")
            # đạt nhưng có từ sát ngưỡng -> thử thêm vài bản để chọn bản rõ nhất (chỉ một lần, đánh dấu "polished")
            polish = qc is not None and qc["ok"] and qc.get("min_p", 1) < GOOD_MIN_P and not qc.get("polished")
            if qc is None or not qc["ok"] or polish:
                best = qc if os.path.exists(cached) else None
                m = _warm(tts_local.vieneu_model(), voice); extra = 0
                for t in range(1, tries + 1):
                    cand = os.path.join(tmp, f"qc_{k}_{t}.wav")
                    m.save(m.infer(sp, voice=voice) if t <= tries // 2 else m.infer(sp, voice=voice, temperature=0.25), cand)
                    q = qc_take(cand, sp, D); q["try"] = t
                    if log: log(f"QC câu '{sp[:40]}' lần {t}: {'OK' if q['ok'] else '; '.join(q['reasons'])[:160]}")
                    if best is None or (q["ok"], q["score"]) > (best["ok"], best["score"]):
                        best = q; os.replace(cand, cached)
                    if q["ok"]:
                        extra += 1
                        if (q["min_p"] >= GOOD_MIN_P and not polish) or extra > EXTRA_TRIES: break
                qc = dict(best, polished=True); json.dump(qc, open(side, "w"), ensure_ascii=False)
            report.append({"text": sp, **qc})
            c = os.path.join(tmp, f"{os.path.basename(out_wav)}_{k}.wav")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", cached, "-af",
                "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                "-ar", "48000", "-ac", "2", c], check=True); clips.append(c)
        if pause:
            c = os.path.join(tmp, f"{os.path.basename(out_wav)}_{k}_p.wav")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{pause}", c], check=True)
            clips.append(c)
    lst = out_wav + ".txt"; open(lst, "w").write("".join(f"file '{c}'\n" for c in clips))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out_wav], check=True)
    return tts_local.estimate_words(vn_norm.strip_markers(text), tts_local.probe_dur(out_wav)), report
