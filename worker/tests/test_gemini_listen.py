"""Kiểm tra gemini_listen không gọi mạng (giả lập _post / listen)."""
import json, os, subprocess, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), os.path.join(HERE, "..", "mvlib")]
import gemini_listen as gl  # noqa: E402

def resp(sentences, nat=4, usage=None):
    return {"candidates": [{"content": {"parts": [{"text": "```json\n" + json.dumps({"sentences": sentences, "naturalness": nat}) + "\n```"}]}}],
            "usageMetadata": usage or {"promptTokenCount": 900, "candidatesTokenCount": 200, "thoughtsTokenCount": 100,
                                       "promptTokensDetails": [{"modality": "AUDIO", "tokenCount": 300}, {"modality": "TEXT", "tokenCount": 600}]}}

class Pure(unittest.TestCase):
    def test_cost(self):
        u = resp([])["usageMetadata"]
        self.assertAlmostEqual(gl.cost_usd(u, "gemini-3.5-flash-lite"), (600 * 0.30 + 300 * 0.30 + 300 * 2.50) / 1e6)
        self.assertAlmostEqual(gl.cost_usd(u, "gemini-3.1-flash-lite"), (600 * 0.25 + 300 * 0.50 + 300 * 1.50) / 1e6)
    def test_parse_fenced(self):
        self.assertEqual(gl.parse_response(resp([{"index": 1}]))["sentences"][0]["index"], 1)
    def test_judge_thresholds(self):
        res = {"sentences": [
            {"index": 1, "heard": "a", "pronunciation_ok": False, "issues": [{"word": "Tonkin", "type": "mispronounced", "start_s": 2, "confidence": 0.75}]},
            {"index": 2, "heard": "b", "pronunciation_ok": True, "issues": [{"word": "x", "type": "unnatural_pause", "start_s": 1, "confidence": 0.8}]},
            {"index": 3, "heard": "c", "pronunciation_ok": True, "issues": [{"word": "y", "type": "wrong_tone", "start_s": 1, "confidence": 0.3}]}]}
        j = gl.judge(res, ["một", "hai", "ba", "bốn"], min_conf=0.7)
        self.assertEqual([x["ok"] for x in j], [False, True, True, True])
        self.assertTrue(j[3]["missing"])
    def test_enabled(self):
        old = dict(os.environ)
        try:
            os.environ["GEMINI_API_KEY"] = "x"; os.environ.pop("TTS_QC_GEMINI", None)
            self.assertFalse(gl.enabled({}))
            self.assertTrue(gl.enabled({"ttsQc": {"gemini": True}}))
            os.environ["TTS_QC_GEMINI"] = "0"; self.assertFalse(gl.enabled({"ttsQc": {"gemini": True}}))
            os.environ["TTS_QC_GEMINI"] = "1"; self.assertTrue(gl.enabled({}))
            del os.environ["GEMINI_API_KEY"]; self.assertFalse(gl.enabled({}))
        finally:
            os.environ.clear(); os.environ.update(old)

class Listen(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.mkdtemp(); self.wav = os.path.join(self.td, "a.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", self.wav], check=True)
        self._post = gl._post; os.environ["GEMINI_API_KEY"] = "test-key"
    def tearDown(self):
        gl._post = self._post
    def test_listen_body_and_result(self):
        seen = {}
        def fake(model, body, timeout=180):
            seen["model"] = model; seen["body"] = body
            return resp([{"index": 1, "heard": "Tông kin", "pronunciation_ok": True, "issues": []}])
        gl._post = fake
        r = gl.listen(self.wav, ["Tonkin."], model="gemini-3.5-flash-lite")
        parts = seen["body"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["inline_data"]["mime_type"], "audio/mp3")
        self.assertIn("1. Tonkin.", parts[1]["text"])
        self.assertNotIn("test-key", json.dumps(seen["body"]))
        self.assertTrue(r["sentences"][0]["ok"]); self.assertGreater(r["cost_usd"], 0)
    def test_no_retry_on_402(self):
        calls = []
        def fake(model, body, timeout=180):
            calls.append(1); raise gl.GeminiError("gemini HTTP 402: credits", 402)
        gl._post = fake
        with self.assertRaises(gl.GeminiError) as cm: gl.listen(self.wav, ["a."])
        self.assertEqual(cm.exception.code, 402); self.assertEqual(len(calls), 1)

class SceneQC(unittest.TestCase):
    def test_flag_then_regen_then_cached(self):
        import tts_qc
        td = tempfile.mkdtemp(); os.environ["MV_TTS_CACHE"] = td
        qc = [{"text": "câu một", "ok": True}, {"text": "về sau thành tông kin", "ok": True}]
        rounds = iter([
            [{"index": 1, "ok": True, "issues": [], "bad": [], "heard": "câu một"},
             {"index": 2, "ok": False, "heard": "thông kinh", "issues": [], "bad": [{"word": "tông kin", "heard_as": "thông kinh", "type": "mispronounced", "start_s": 1.2, "confidence": 0.9}]}],
            [{"index": 1, "ok": True, "issues": [], "bad": [], "heard": "câu một"},
             {"index": 2, "ok": True, "issues": [], "bad": [], "heard": "về sau thành Tông-kin"}]])
        orig = gl.listen
        gl.listen = lambda *a, **k: {"sentences": next(rounds), "naturalness": 4, "usage": {}, "cost_usd": 0.0001, "model": "m"}
        regen_calls = []
        def regen():
            regen_calls.append(1)
            side = tts_qc.sidecar("v", "về sau thành tông kin"); self.assertFalse(json.load(open(side))["ok"])
            return [dict(qc[0]), {"text": "về sau thành tông kin", "ok": True}]
        try:
            led = gl.Ledger(); logs = []
            out = gl.scene_qc("x.wav", [dict(q) for q in qc], "v", regen, led, logs.append, rounds=2, model="m")
            self.assertEqual(len(regen_calls), 1); self.assertEqual(led.calls, 2)
            self.assertTrue(all(q["gemini"]["ok"] for q in out))
            # đã có phán quyết đạt (cùng model) -> không gọi lại
            gl.listen = lambda *a, **k: self.fail("không được gọi lại Gemini")
            gl.scene_qc("x.wav", out, "v", regen, led, None, model="m")
        finally:
            gl.listen = orig

if __name__ == "__main__":
    unittest.main()
