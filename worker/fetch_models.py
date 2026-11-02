#!/usr/bin/env python3
"""Download render models into worker/mvlib/models (or MV_MODELS_DIR):
  face_yunet.onnx + face_sface.onnx (OpenCV zoo)        - face-aware captions + character drift check (~39 MB)
  hf/  VieNeu-TTS v3 Turbo + MOSS tokenizer (~700 MB)    - local Vietnamese TTS   (--vieneu)
  whisper/ faster-whisper small (~480 MB)                - word alignment          (--whisper)
HF cache symlinks are replaced by real files because onnxruntime rejects external data outside the model dir.
Usage: python3 worker/fetch_models.py [--vieneu] [--whisper] [--all]"""
import os, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
M = os.environ.get("MV_MODELS_DIR") or os.path.join(HERE, "mvlib", "models")
os.makedirs(M, exist_ok=True)
ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models/"
for name, url in [("face_yunet.onnx", ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx"),
                  ("face_sface.onnx", ZOO + "face_recognition_sface/face_recognition_sface_2021dec.onnx")]:
    p = os.path.join(M, name)
    if not os.path.exists(p): print("download", name); urllib.request.urlretrieve(url, p)
args = set(sys.argv[1:])
if args & {"--vieneu", "--all"}:
    hf = os.path.join(M, "hf"); os.environ["HF_HUB_CACHE"] = hf
    sys.path.insert(0, os.path.join(HERE, "mvlib"))
    from vieneu import Vieneu
    try: Vieneu(precision="int8")      # downloads everything it needs into hf/
    except Exception as e: print("first load (expected to fail on symlinks):", str(e)[:120])
    for dp, _, fs in os.walk(hf):
        for f in fs:
            p = os.path.join(dp, f)
            if os.path.islink(p): real = os.path.realpath(p); os.unlink(p); shutil.copy(real, p)
    shutil.rmtree(os.path.join(hf, "blobs"), ignore_errors=True)
    for d in os.listdir(hf): shutil.rmtree(os.path.join(hf, d, "blobs"), ignore_errors=True)
    os.environ["HF_HUB_OFFLINE"] = "1"; Vieneu(precision="int8"); print("vieneu OK")
if args & {"--whisper", "--all"}:
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="int8", download_root=os.path.join(M, "whisper")); print("whisper OK")
print("models in", M)
