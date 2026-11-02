"""python3 -m unittest discover -s worker/tests  (không cần model: chỉ kiểm tra phần logic thuần)."""
import os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), os.path.join(HERE, "..", "mvlib")]
import vn_norm, tts_qc  # noqa: E402

class SpokenText(unittest.TestCase):
    def setUp(self):
        import render
        self.f = render.spoken_text
    def test_pause_with_value_is_kept(self):
        out = self.f("Mở la bàn nào! [pause 0.15] Năm 1400.", {})
        self.assertIn("[pause 0.15]", out)
        self.assertEqual([p for _, p in vn_norm.split_pauses(out)], [0.15, 0.0])
        self.assertNotIn("không phẩy", out)
    def test_plain_pause(self):
        self.assertEqual([p for _, p in vn_norm.split_pauses(self.f("A. [pause] B.", {}))], [0.4, 0.0])

class WordIssues(unittest.TestCase):
    def test_insertion_flagged(self):
        r = tts_qc.word_issues("chỉ dùng khoảng bảy năm đến khi nhà hồ", "chỉ dùng khoảng bảy năm tới đến khi nhà hồ")
        self.assertTrue(any("chèn" in x for x in r))
    def test_tail_garbage_flagged(self):
        self.assertTrue(tts_qc.word_issues("không có nghĩa là ngu đâu", "không có nghĩa là ngu là thô"))
    def test_one_to_one_misspelling_ok(self):
        self.assertEqual(tts_qc.word_issues("sử mình hay lắm", "sự mình hay lắm"), [])
    def test_dropped_words_flagged(self):
        self.assertTrue(any("mất" in x for x in tts_qc.word_issues("theo truyền thuyết họ hồ là con cháu", "theo truyền thuyết con cháu")))

class AcronymCase(unittest.TestCase):
    def setUp(self):
        import render
        self.r = render
        self.pron = render.load_pron(os.path.join(HERE, "no-such-dir"))
    def test_pronoun_ai_untouched(self):
        self.assertEqual(self.r.spoken_text("Theo bạn, ai mới là người quyết định?", self.pron), "Theo bạn, ai mới là người quyết định?")
        self.assertEqual(self.r.spoken_text("Ai cũng biết.", self.pron), "Ai cũng biết.")
    def test_uppercase_acronym_expanded(self):
        self.assertEqual(self.r.spoken_text("Ảnh do AI tạo.", self.pron), "Ảnh do ây ai tạo.")
        self.assertIn("tê tê ét", self.r.spoken_text("(TTS)", self.pron))
    def test_default_dict_normalize(self):
        # tts_local / tts_qc gọi vn_norm.normalize(chunk) với từ điển mặc định
        self.assertEqual(vn_norm.normalize("Theo bạn, ai mới là người quyết định?"), "Theo bạn, ai mới là người quyết định?")
        self.assertIn("ây ai", vn_norm.normalize("Ảnh do AI tạo."))
    def test_lowercase_entry_still_case_insensitive(self):
        self.assertEqual(self.r.spoken_text("Datxanh", self.pron), "Đất Xanh")

if __name__ == "__main__":
    unittest.main()
