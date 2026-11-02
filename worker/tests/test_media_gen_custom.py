"""Provider ảnh tự thêm (data/image-providers.json + khoá trong ENV_FILE); không gọi mạng."""
import base64, json, os, sys, tempfile, unittest
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..")]
import media_gen as mg  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32

class Resp:
    def __init__(self, j): self.j = j
    def read(self): return json.dumps(self.j).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False

class Custom(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.out = os.path.join(self.tmp, "a.png")
        json.dump({"providers": [
            {"id": "cliproxy-gpt", "kind": "openai", "baseUrl": "http://proxy:8317/v1", "model": "gpt-image-2", "size": "1024x1536", "maxRefs": 2},
            {"id": "cliproxy-gem", "kind": "gemini", "baseUrl": "http://proxy:8317/v1beta", "model": "gemini-3.1-flash-image"},
            {"id": "gemini", "kind": "openai", "baseUrl": "http://evil"},   # trùng provider có sẵn -> bỏ qua
        ]}, open(os.path.join(self.tmp, "image-providers.json"), "w"))
        self.envf = os.path.join(self.tmp, ".env")
        open(self.envf, "w").write('IMAGE_PROVIDER_KEY__CLIPROXY_GPT="sk-file"\n')
        self.env = mock.patch.dict(os.environ, {"DATA_DIR": self.tmp, "ENV_FILE": self.envf, "IMAGE_PROVIDER_KEY__CLIPROXY_GPT": "sk-old"}, clear=False)
        self.env.start(); os.environ.pop("IMAGE_FALLBACK", None)
    def tearDown(self): self.env.stop()

    def test_list_skips_builtin_ids(self):
        self.assertEqual(sorted(mg.custom_providers()), ["cliproxy-gem", "cliproxy-gpt"])

    def test_openai_generations_uses_file_key(self):
        seen = {}
        def fake(req, timeout=0):
            seen["url"], seen["auth"], seen["body"] = req.full_url, req.get_header("Authorization"), json.loads(req.data)
            return Resp({"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.generate_image("p", self.out, provider="cliproxy-gpt"))
        self.assertEqual(seen["url"], "http://proxy:8317/v1/images/generations")
        self.assertEqual(seen["auth"], "Bearer sk-file")
        self.assertEqual(seen["body"]["model"], "gpt-image-2")
        self.assertEqual(seen["body"]["size"], "1024x1536")
        self.assertEqual(mg.LAST_PROVIDER, "cliproxy-gpt")
        self.assertEqual(open(self.out, "rb").read(), PNG)

    def test_openai_edits_caps_refs(self):
        refs = []
        for i in range(3):
            r = os.path.join(self.tmp, f"r{i}.png"); open(r, "wb").write(PNG); refs.append(r)
        seen = {}
        def fake(req, timeout=0):
            seen["url"], seen["n"] = req.full_url, req.data.count(b'name="image[]"')
            return Resp({"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            mg.generate_image("p", self.out, refs=refs, provider="cliproxy-gpt")
        self.assertEqual(seen["url"], "http://proxy:8317/v1/images/edits")
        self.assertEqual(seen["n"], 2)

    def test_gemini_kind_without_key(self):
        seen = {}
        def fake(req, timeout=0):
            seen["url"], seen["key"] = req.full_url, req.get_header("X-goog-api-key")
            return Resp({"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(PNG).decode()}}]}}]})
        with mock.patch.object(mg.urllib.request, "urlopen", fake):
            self.assertTrue(mg.generate_image("p", self.out, aspect="9:16", provider="cliproxy-gem"))
        self.assertEqual(seen["url"], "http://proxy:8317/v1beta/models/gemini-3.1-flash-image:generateContent")
        self.assertIsNone(seen["key"])

    def test_unknown_provider_raises(self):
        with self.assertRaises(RuntimeError): mg.generate_image("p", self.out, provider="nope")

if __name__ == "__main__": unittest.main()
