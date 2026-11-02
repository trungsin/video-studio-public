"""Provider ảnh quanlop + chuỗi dự phòng; không gọi mạng (giả lập urlopen)."""
import io, json, os, sys, tempfile, unittest, urllib.error
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..")]
import media_gen as mg  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
KEY = "ql-secret-key-123"

class Resp:
    def __init__(self, data, ct="image/png"): self.data, self.headers = data, {"Content-Type": ct}
    def read(self): return self.data
    def __enter__(self): return self
    def __exit__(self, *a): return False

def http_err(code, body=b'{"error":{"code":"x"}}'):
    return urllib.error.HTTPError("u", code, "err", {}, io.BytesIO(body))

class Base(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"QUANLOP_IMAGE_API_KEY": KEY, "IMAGE_PROVIDER": "quanlop", "GEMINI_API_KEY": "g"}, clear=False)
        self.env.start(); os.environ.pop("IMAGE_FALLBACK", None); os.environ.pop("QUANLOP_IMAGE_BASE_URL", None)
        self.tmp = tempfile.mkdtemp(); self.out = os.path.join(self.tmp, "a.png")
        self.sleep = mock.patch.object(mg.time, "sleep", lambda s: None); self.sleep.start()
    def tearDown(self): self.env.stop(); self.sleep.stop()

class Quanlop(Base):
    def test_request_format_and_png(self):
        seen = {}
        def fake(req, timeout=0):
            seen.update(url=req.full_url, body=json.loads(req.data), auth=req.get_header("Authorization"), ua=req.get_header("User-agent"))
            return Resp(PNG)
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.generate_image("An in study", self.out, ["/nonexistent.png"], "9:16"))
        self.assertEqual(seen["url"], "https://image2.quanlop.vn/v1/images")
        self.assertEqual(seen["body"], {"prompt": "An in study", "aspect_ratio": "9:16"})
        self.assertEqual(seen["auth"], f"Bearer {KEY}")
        self.assertTrue(seen["ua"].startswith("video-studio"))
        self.assertEqual(open(self.out, "rb").read(), PNG)
        self.assertEqual(mg.LAST_PROVIDER, "quanlop")

    def test_json_b64_response(self):
        import base64
        body = json.dumps({"data": [{"b64_json": base64.b64encode(PNG).decode()}]}).encode()
        with mock.patch.object(mg.urllib.request, "urlopen", lambda req, timeout=0: Resp(body, "application/json")):
            mg.img_quanlop("x", [], self.out)
        self.assertEqual(open(self.out, "rb").read(), PNG)

    def test_prompt_trimmed_under_body_limit(self):
        seen = {}
        def fake(req, timeout=0): seen["n"] = len(req.data); return Resp(PNG)
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            mg.img_quanlop("chữ " * 9000, [], self.out)
        self.assertLessEqual(seen["n"], mg.QUANLOP_MAX_BODY)

    def test_bad_aspect_falls_back_to_9_16(self):
        seen = {}
        def fake(req, timeout=0): seen.update(json.loads(req.data)); return Resp(PNG)
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            mg.img_quanlop("x", [], self.out, "weird")
        self.assertEqual(seen["aspect_ratio"], "9:16")

    def test_retry_once_on_5xx_then_ok(self):
        calls = []
        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) == 1: raise http_err(503)
            return Resp(PNG)
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.img_quanlop("x", [], self.out))
        self.assertEqual(len(calls), 2)

    def test_error_never_leaks_key(self):
        def fake(req, timeout=0): raise http_err(401, f'{{"error":"bad key {KEY}"}}'.encode())
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            with self.assertRaises(RuntimeError) as cm: mg.img_quanlop("x", [], self.out)
        self.assertNotIn(KEY, str(cm.exception)); self.assertIn("401", str(cm.exception))

    def test_non_image_payload_rejected(self):
        with mock.patch.object(mg.urllib.request, "urlopen", lambda req, timeout=0: Resp(b"<html>", "text/html")):
            with self.assertRaises(RuntimeError): mg.img_quanlop("x", [], self.out)

    def test_missing_key(self):
        os.environ.pop("QUANLOP_IMAGE_API_KEY")
        with self.assertRaises(RuntimeError): mg.img_quanlop("x", [], self.out)

    def test_capacity_429_without_retry_after_backs_off_then_ok(self):
        calls, waits = [], []
        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) <= 3: raise http_err(429, b'{"error":{"code":"capacity_exceeded"}}')
            return Resp(PNG)
        with mock.patch.object(mg.time, "sleep", waits.append), mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.img_quanlop("x", [], self.out))
        self.assertEqual(len(calls), 4)
        self.assertEqual(waits, [10, 20, 40])

    def test_remote_disconnect_is_retried(self):
        calls = []
        def fake(req, timeout=0):
            calls.append(1)
            if len(calls) == 1: raise mg.http.client.RemoteDisconnected("Remote end closed connection without response")
            return Resp(PNG)
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.img_quanlop("x", [], self.out))
        self.assertEqual(len(calls), 2)

    def test_persistent_overload_raises_after_retries(self):
        calls = []
        def fake(req, timeout=0): calls.append(1); raise http_err(429)
        os.environ["QUANLOP_RETRIES"] = "3"
        try:
            with mock.patch.object(mg.urllib.request, "urlopen", fake):
                with self.assertRaises(RuntimeError) as cm: mg.img_quanlop("x", [], self.out)
        finally:
            os.environ.pop("QUANLOP_RETRIES")
        self.assertEqual(len(calls), 3); self.assertIn("429", str(cm.exception))

    def test_502_for_fixed_ratio_switches_to_free_aspect_without_waiting(self):
        # Gateway chỉ dùng Codex khi không ghi tỷ lệ; 502 nghĩa là mọi provider hỗ trợ 9:16 đều lỗi.
        bodies, waits = [], []
        def fake(req, timeout=0):
            bodies.append(json.loads(req.data))
            if len(bodies) == 1: raise http_err(502, b'{"title":"Error 502: Bad gateway"}')
            return Resp(PNG)
        with mock.patch.object(mg.time, "sleep", waits.append), mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.img_quanlop("A forest", [], self.out, "9:16"))
        self.assertEqual(bodies[0], {"prompt": "A forest", "aspect_ratio": "9:16"})
        self.assertNotIn("aspect_ratio", bodies[1])
        self.assertTrue(bodies[1]["prompt"].startswith(mg.QUANLOP_FREE_ASPECT_HINT) and bodies[1]["prompt"].endswith("A forest"))
        self.assertEqual(waits, [])

    def test_free_aspect_fallback_can_be_disabled(self):
        bodies = []
        def fake(req, timeout=0):
            bodies.append(json.loads(req.data))
            if len(bodies) == 1: raise http_err(502)
            return Resp(PNG)
        os.environ["QUANLOP_FREE_ASPECT_FALLBACK"] = "0"
        try:
            with mock.patch.object(mg.urllib.request, "urlopen", fake):
                self.assertTrue(mg.img_quanlop("A forest", [], self.out, "9:16"))
        finally:
            os.environ.pop("QUANLOP_FREE_ASPECT_FALLBACK")
        self.assertEqual([b.get("aspect_ratio") for b in bodies], ["9:16", "9:16"])

class Chain(Base):
    def test_default_chains(self):
        self.assertEqual(mg.provider_chain(), ["quanlop", "gemini"])
        self.assertEqual(mg.provider_chain("gemini"), ["gemini"])
        os.environ["IMAGE_FALLBACK"] = "quanlop"; self.assertEqual(mg.provider_chain("gemini"), ["gemini", "quanlop"])
        os.environ["IMAGE_FALLBACK"] = "none"; self.assertEqual(mg.provider_chain("quanlop"), ["quanlop"])
        os.environ["IMAGE_PROVIDER"] = ""; os.environ.pop("IMAGE_BASE_URL", None); self.assertEqual(mg.provider_chain(), [])

    def test_fallback_to_gemini_gets_refs_and_aspect(self):
        got = {}
        def boom(*a, **k): raise RuntimeError("quanlop HTTP 500")
        def gem(prompt, refs, out, aspect=None): got.update(refs=refs, aspect=aspect); open(out, "wb").write(PNG); return True
        ref = os.path.join(self.tmp, "r.png"); open(ref, "wb").write(PNG)
        with mock.patch.dict(mg.IMAGE_PROVIDERS, {"quanlop": boom, "gemini": gem}):
            self.assertTrue(mg.generate_image("p", self.out, [ref], "9:16"))
        self.assertEqual(got, {"refs": [ref], "aspect": "9:16"}); self.assertEqual(mg.LAST_PROVIDER, "gemini")

    def test_all_fail_raises_combined(self):
        def boom(name):
            def f(*a, **k): raise RuntimeError(f"{name} down")
            return f
        with mock.patch.dict(mg.IMAGE_PROVIDERS, {"quanlop": boom("q"), "gemini": boom("g")}):
            with self.assertRaises(RuntimeError) as cm: mg.generate_image("p", self.out)
        self.assertIn("q down", str(cm.exception)); self.assertIn("g down", str(cm.exception))

    def test_provider_arg_overrides_env(self):
        used = []
        def gem(prompt, refs, out, aspect=None): used.append("gemini"); return True
        with mock.patch.dict(mg.IMAGE_PROVIDERS, {"gemini": gem}):
            mg.generate_image("p", self.out, provider="gemini")
        self.assertEqual(used, ["gemini"])

if __name__ == "__main__":
    unittest.main()
