"""character.py - character profiles + face tools (OpenCV YuNet detector, SFace embeddings).
Profile JSON (characters/<id>.json): id, name, description, setting, portrait, refs[], seed, voice{tts,voice,edge_voice,rate},
drift_threshold. Relative paths resolve against the JSON file's folder.
CLI:
  python character.py prompt characters/may.json "cracks an egg into a bowl"
  python character.py check  characters/may.json img1.jpg clip.mp4 ... [--frames 6] [--json out.json]
Drift check: cosine similarity of each face vs the portrait (SFace; OpenCV's recommended same-person
threshold is 0.363). Clips: N evenly spaced frames, score = median over frames with a face."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get("MV_MODELS_DIR") or os.path.join(HERE, "models")
YUNET = os.path.join(MODELS, "face_yunet.onnx"); SFACE = os.path.join(MODELS, "face_sface.onnx")
VIDEO_EXT = (".mp4", ".mov", ".webm", ".mkv", ".m4v")

def load_profile(path):
    p = json.load(open(path, encoding="utf-8")); base = os.path.dirname(os.path.abspath(path))
    R = lambda f: f if not f or os.path.isabs(f) else os.path.join(base, f)
    p["portrait"] = R(p.get("portrait")); p["refs"] = [R(r) for r in p.get("refs", [])]; p["_path"] = path
    return p

def build_prompt(p, action):
    """Scene prompt that always repeats the fixed character + setting text (same wording every time)."""
    parts = [action, f"Same recurring character in every scene: {p['description']}"]
    if p.get("setting"): parts.append(f"Same location in every scene: {p['setting']}")
    parts.append("Photorealistic vertical 9:16 photo, natural light, no text, no watermark.")
    return " ".join(x.strip().rstrip(".") + "." for x in parts if x)

_det = {}; _rec = None
def faces(img, score=0.7):
    """BGR image -> array of faces (N x 15: x,y,w,h, 5 landmarks, score), largest first, or []."""
    import cv2
    h, w = img.shape[:2]
    if (w, h) not in _det: _det[(w, h)] = cv2.FaceDetectorYN.create(YUNET, "", (w, h), score)
    _, f = _det[(w, h)].detect(img)
    if f is None: return []
    return sorted(f, key=lambda r: -r[2] * r[3])

def embed(img, face):
    import cv2
    global _rec
    if _rec is None: _rec = cv2.FaceRecognizerSF.create(SFACE, "")
    return _rec.feature(_rec.alignCrop(img, face))

def similarity(e1, e2):
    import cv2
    return float(_rec.match(e1, e2, cv2.FaceRecognizerSF_FR_COSINE))

def read_image(path, maxside=1280):
    import cv2
    im = cv2.imread(path)
    if im is None: return None, 1.0
    s = min(1.0, maxside / max(im.shape[:2]))
    return (cv2.resize(im, None, fx=s, fy=s) if s < 1 else im), s

def sample_frames(path, n=6, maxside=1280):
    """Evenly spaced frames from a video -> list of (t_seconds, BGR)."""
    import cv2
    cap = cv2.VideoCapture(path); N = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1; fps = cap.get(cv2.CAP_PROP_FPS) or 30
    out = []
    for k in range(n):
        idx = int((k + 0.5) * N / n); cap.set(cv2.CAP_PROP_POS_FRAMES, idx); ok, fr = cap.read()
        if not ok: continue
        s = min(1.0, maxside / max(fr.shape[:2]))
        out.append((idx / fps, cv2.resize(fr, None, fx=s, fy=s) if s < 1 else fr))
    cap.release(); return out

def face_boxes(path, n=6):
    """Largest-face boxes in source pixel coords for an image or a video (sampled). -> (boxes, (w,h))."""
    import cv2
    if path.lower().endswith(VIDEO_EXT):
        cap = cv2.VideoCapture(path); W = cap.get(cv2.CAP_PROP_FRAME_WIDTH); H = cap.get(cv2.CAP_PROP_FRAME_HEIGHT); cap.release()
        frames = sample_frames(path, n)
    else:
        im = cv2.imread(path)
        if im is None: return [], (0, 0)
        H, W = im.shape[:2]; frames = [(0, read_image(path)[0])]
    boxes = []
    for _, fr in frames:
        f = faces(fr)
        if len(f):
            s = W / fr.shape[1]; x, y, w, h = [float(v) * s for v in f[0][:4]]; boxes.append((x, y, w, h))
    return boxes, (W, H)

def check(profile, items, frames=6, threshold=None):
    thr = threshold or profile.get("drift_threshold", 0.363)
    ref, _ = read_image(profile["portrait"]); rf = faces(ref)
    if not len(rf): raise SystemExit("no face in portrait " + profile["portrait"])
    re_ = embed(ref, rf[0]); rows = []
    for it in items:
        if it.lower().endswith(VIDEO_EXT): frs = sample_frames(it, frames)
        else: frs = [(0.0, read_image(it)[0])]
        sc = []
        for t, fr in frs:
            if fr is None: continue
            f = faces(fr)
            if len(f): sc.append((t, similarity(re_, embed(fr, f[0]))))
        if not sc: rows.append(dict(item=it, score=None, status="NO_FACE", frames=len(frs))); continue
        vals = sorted(v for _, v in sc); med = vals[len(vals) // 2]
        rows.append(dict(item=it, score=round(med, 3), min=round(vals[0], 3), frames=len(frs), with_face=len(sc),
                         worst_t=round(min(sc, key=lambda x: x[1])[0], 2), status="OK" if med >= thr else "DRIFT"))
    return thr, rows

def print_report(thr, rows):
    print(f"drift check vs portrait (SFace cosine, threshold {thr})")
    for r in rows:
        extra = f"  min {r['min']} @ {r['worst_t']}s, face in {r['with_face']}/{r['frames']} frames" if r.get("min") is not None else ""
        print(f"  {r['status']:8} {str(r['score']):>6}  {os.path.basename(r['item'])}{extra}")
    bad = [r for r in rows if r["status"] != "OK"]
    print(f"  -> {len(bad)} flagged of {len(rows)}")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["prompt", "check"]); ap.add_argument("profile"); ap.add_argument("items", nargs="*")
    ap.add_argument("--frames", type=int, default=6); ap.add_argument("--threshold", type=float); ap.add_argument("--json")
    a = ap.parse_args(); p = load_profile(a.profile)
    if a.cmd == "prompt": print(build_prompt(p, " ".join(a.items))); print("refs:", p["refs"]); print("seed:", p.get("seed"))
    else:
        thr, rows = check(p, a.items, a.frames, a.threshold); print_report(thr, rows)
        if a.json: json.dump(dict(threshold=thr, items=rows), open(a.json, "w"), ensure_ascii=False, indent=1)
