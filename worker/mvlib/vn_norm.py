"""vn_norm.py - Vietnamese text normalization for TTS (numbers, %, units, dates, times) + pronunciation
dictionary + pause markers. Works per token so captions can keep the original text:
    spoken_tokens(text) -> [(orig_token, spoken_string), ...]
Pause marker in narration: [pause] or [pause 0.6] (seconds) -> silence; not shown in captions."""
import os, re

DIGITS = "không một hai ba bốn năm sáu bảy tám chín".split()

def _3(n, full):
    """0..999 -> words. full=True forces 'không trăm' / 'linh' for inner groups."""
    h, t, u = n // 100, n // 10 % 10, n % 10; out = []
    if h or full: out += [DIGITS[h], "trăm"]
    if t == 0:
        if u and (h or full): out.append("linh")
    elif t == 1: out.append("mười")
    else: out += [DIGITS[t], "mươi"]
    if u:
        if u == 1 and t > 1: out.append("mốt")
        elif u == 5 and t >= 1: out.append("lăm")
        elif u == 4 and t > 1: out.append("tư")
        else: out.append(DIGITS[u])
    return out

def num2words(n):
    n = int(n)
    if n == 0: return "không"
    if n < 0: return "âm " + num2words(-n)
    units = ["", "nghìn", "triệu", "tỷ"]; groups = []
    while n: groups.append(n % 1000); n //= 1000
    if len(groups) > 4:  # >= nghìn tỷ: recurse on tỷ
        hi = int("".join(f"{g:03d}" for g in reversed(groups[3:]))); lo = groups[:3]
        return num2words(hi) + " tỷ " + num2words(int("".join(f"{g:03d}" for g in reversed(lo)))) if any(lo) else num2words(hi) + " tỷ"
    out = []
    for i in range(len(groups) - 1, -1, -1):
        g = groups[i]
        if g == 0: continue
        out += _3(g, full=i < len(groups) - 1) + ([units[i]] if units[i] else [])
    return " ".join(out)

def read_number(s):
    """'4.587' -> bốn nghìn năm trăm tám mươi bảy; '7,5' -> bảy phẩy năm; '3.350,2'."""
    s = s.strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", s): s = s.replace(".", "")
    if re.fullmatch(r"\d+\.\d{1,2}", s): s = s.replace(".", ",")   # 1.5 -> 1,5 (decimal)
    if "," in s:
        a, b = s.split(",", 1)
        dec = " ".join(DIGITS[int(c)] for c in b) if b.startswith("0") or len(b) > 2 else num2words(int(b))
        return num2words(int(a or 0)) + " phẩy " + dec
    return num2words(int(s))

UNITS = {"%": "phần trăm", "m²": "mét vuông", "m2": "mét vuông", "km²": "ki lô mét vuông", "km": "ki lô mét",
         "m": "mét", "cm": "xen ti mét", "mm": "mi li mét", "kg": "ki lô gam", "g": "gam", "ha": "héc ta",
         "đ": "đồng", "vnđ": "đồng", "usd": "đô la", "$": "đô la", "h": "giờ", "s": "giây", "gb": "ghi ga bai",
         "mb": "mê ga bai", "kb": "ki lô bai", "x": "lần", "tr": "triệu"}

def is_acronym(k):
    """'AI', 'TTS', 'MP4' -> True; 'ai', 'Datxanh', '9:16' -> False."""
    return k == k.upper() and k != k.lower()

def load_dict(path=None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "pronounce.txt")
    d = {}
    if os.path.exists(path):
        for ln in open(path, encoding="utf-8"):
            ln = ln.split("#", 1)[0].strip()
            if "=>" in ln:
                k, v = [x.strip() for x in ln.split("=>", 1)]
                d[k if is_acronym(k) else k.lower()] = v   # ALL-CAPS (AI, TTS) only matches ALL-CAPS tokens
    return d

def norm_token(tok, D):
    """One whitespace token -> spoken string (may be several words, or '' to drop)."""
    m = re.match(r"^([\"'(\[“]*)(.*?)([\"')\]”.,!?;:…]*)$", tok); pre, core, post = m.groups()
    if not core: return tok
    low = core.lower()
    if core in D and is_acronym(core): return D[core] + post
    if low in D: return D[low] + post
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", core)        # date dd/mm/yyyy
    if m: return f"ngày {num2words(m[1])} tháng {num2words(m[2])} năm {num2words(m[3])}{post}"
    m = re.fullmatch(r"(\d{1,2})/(\d{4})", core)                          # mm/yyyy
    if m: return f"tháng {num2words(m[1])} năm {num2words(m[2])}{post}"
    m = re.fullmatch(r"(\d{1,3})/(\d{1,3})", core)                      # fraction 1/2
    if m: return f"{num2words(m[1])} phần {num2words(m[2])}{post}"
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", core)                          # hh:mm or ratio
    if m: return f"{num2words(m[1])} giờ {num2words(m[2])}{post}" if int(m[1]) < 24 and int(m[2]) < 60 else core + post
    m = re.fullmatch(r"(\d+)-(\d+)", core)                                # range 3-5
    if m: return f"{num2words(m[1])} đến {num2words(m[2])}{post}"
    m = re.fullmatch(r"([<>~]?)([\d.,]*\d)([^\d.,]*)", core)              # number + unit
    if m:
        sign, num, unit = m.groups(); w = read_number(num)
        u = UNITS.get(unit.lower(), unit) if unit else ""
        sp = {"<": "dưới ", ">": "hơn ", "~": "khoảng "}.get(sign, "")
        return (sp + w + (" " + u if u else "")).strip() + post
    return tok

PAUSE = re.compile(r"\[pause(?:\s+([\d.]+))?\]", re.I)

def split_pauses(text):
    """-> [(chunk_text, pause_after_seconds)]"""
    out, last = [], 0
    for m in PAUSE.finditer(text):
        out.append((text[last:m.start()].strip(), float(m[1] or 0.4))); last = m.end()
    out.append((text[last:].strip(), 0.0))
    return [(c, p) for c, p in out if c or p]

def strip_markers(text): return re.sub(r"\s+", " ", PAUSE.sub(" ", text)).strip()

def _ctx(prev, sp):
    return sp[len(prev) + 1:] if prev and prev.lower() in ("ngày", "tháng") and sp.startswith(prev.lower() + " ") else sp

def spoken_tokens(text, D=None):
    D = load_dict() if D is None else D
    out, prev = [], None
    for t in strip_markers(text).split():
        out.append((t, _ctx(prev, norm_token(t, D)))); prev = t
    return out

def normalize(text, D=None):
    """Keeps pause markers; normalizes everything else."""
    D = load_dict() if D is None else D
    out, prev = [], None
    for t in re.split(r"\s+(?![\d.]*\])", text):
        if not t: continue
        out.append(t if PAUSE.fullmatch(t) else _ctx(prev, norm_token(t, D))); prev = t
    return " ".join(out)

if __name__ == "__main__":
    import sys
    for s in sys.argv[1:] or ["Doanh thu tăng 12,5% lên 4.587 tỷ đồng ngày 17/10/2026, diện tích 120m², lúc 9:30 có 21 người, 105 căn, 1.000.000 lượt xem."]:
        print(normalize(s))
