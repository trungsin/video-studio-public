"""Giọng bị cắt giữa chừng (edge-tts ngắt luồng, VieNeu trả đoạn ngắn) không được lọt vào video; không gọi mạng."""
import os, sys, tempfile, types, unittest
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), os.path.join(HERE, "..", "mvlib")]
import render  # noqa: E402

TEXT = " ".join(f"từ{k}" for k in range(40))   # 40 từ
FULL = [(k * 0.3, k * 0.3 + 0.25, f"từ{k}") for k in range(40)]
CUT = FULL[:10]                                 # luồng bị ngắt sau 10 từ


class EdgeTruncation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.out = os.path.join(self.tmp, "tts.mp3")
        self.key = os.path.join(self.tmp, "edge_key")
        patches = [mock.patch.object(render.time, "sleep"), mock.patch.object(render, "_edge_cache_key", return_value=self.key)]
        for p in patches: p.start(); self.addCleanup(p.stop)

    def edge(self, results):
        """Giả lập edge-tts gọi trực tiếp: mỗi lần trả một danh sách từ, ghi file âm thanh hợp lệ."""
        calls = iter(results)
        async def fake(text, voice, rate, mp3):
            open(mp3, "wb").write(b"0" * 4000)
            return next(calls)
        return mock.patch.object(render, "_edge", side_effect=fake)

    def test_partial_cached_result_is_purged_and_reread(self):
        for ext in (".mp3", ".json"): open(self.key + ext, "w").write("x")
        async def cached(jobs): return [CUT]
        with mock.patch.object(render.tts_local, "edge_tts_all", side_effect=cached), self.edge([FULL]):
            words = render.tts_edge(TEXT, "vi-VN-HoaiMyNeural", "+0%", self.out)
        self.assertEqual(len(words), 40)
        self.assertFalse(os.path.exists(self.key + ".mp3"))
        self.assertFalse(os.path.exists(self.key + ".json"))

    def test_retries_a_cut_stream_until_complete(self):
        async def failing(jobs): raise RuntimeError("No audio was received")
        with mock.patch.object(render.tts_local, "edge_tts_all", side_effect=failing), self.edge([CUT, FULL]) as e:
            words = render.tts_edge(TEXT, "vi-VN-HoaiMyNeural", "+0%", self.out)
        self.assertEqual(len(words), 40)
        self.assertEqual(e.call_count, 2)

    def test_fails_render_instead_of_returning_cut_speech(self):
        async def failing(jobs): raise RuntimeError("No audio was received")
        with mock.patch.object(render.tts_local, "edge_tts_all", side_effect=failing), self.edge([CUT, CUT, CUT]):
            with self.assertRaisesRegex(RuntimeError, "không trả đủ lời"):
                render.tts_edge(TEXT, "vi-VN-HoaiMyNeural", "+0%", self.out)

    def test_complete_cached_result_is_used_as_is(self):
        async def cached(jobs): return [FULL]
        with mock.patch.object(render.tts_local, "edge_tts_all", side_effect=cached), self.edge([]) as e:
            self.assertEqual(len(render.tts_edge(TEXT, "vi-VN-HoaiMyNeural", "+0%", self.out)), 40)
        self.assertEqual(e.call_count, 0)


class VieneuTruncation(unittest.TestCase):
    PHRASE = "Một lần lóe sét có thể trải rộng tới đâu"   # 10 âm tiết, một cụm

    def run_vieneu(self, durations):
        """Mỗi lần gọi Gradio trả một đoạn có độ dài lấy từ `durations`."""
        client = mock.Mock(); client.predict.return_value = "/tmp/fake.wav"
        fake_mod = types.SimpleNamespace(Client=mock.Mock(return_value=client))
        tmp = tempfile.mkdtemp()
        with mock.patch.dict(sys.modules, {"gradio_client": fake_mod}), \
             mock.patch.dict(os.environ, {"VIENEU_GRADIO_URL": "http://fake"}), \
             mock.patch.object(render, "run"), mock.patch.object(render, "probe_dur", side_effect=durations):
            return render.tts_vieneu(self.PHRASE, "Mai Anh", os.path.join(tmp, "out.wav"), tmp), client

    def test_cut_phrase_is_regenerated(self):
        words, client = self.run_vieneu([0.6, 2.9])    # 10 âm tiết / 0.4s: bị cắt; 2.9s: bình thường
        self.assertEqual(client.predict.call_count, 2)
        self.assertEqual(len(words), 10)
        self.assertAlmostEqual(words[-1][1], 2.7, places=2)

    def test_persistently_cut_phrase_raises_so_renderer_falls_back(self):
        with self.assertRaisesRegex(RuntimeError, "bị cắt"):
            self.run_vieneu([0.6, 0.6, 0.6])


if __name__ == "__main__":
    unittest.main()
