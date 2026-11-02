"""Kiểm tra worker/archive.py không gọi mạng (giả lập Commons API + tải ảnh)."""
import io, json, os, subprocess, sys, tempfile, unittest
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, ".."), os.path.join(HERE, "..", "mvlib")]
import archive as ar  # noqa: E402

def page(title, lic, w=2000, h=1500, artist="<a href='x'>Nguyễn Văn A</a>", sha1="abc", usage=""):
    return {"title": title, "index": 1, "imageinfo": [{"descriptionurl": f"https://commons.wikimedia.org/wiki/{title}", "width": w, "height": h,
            "mime": "image/jpeg", "thumburl": "https://upload.example/x.jpg", "sha1": sha1,
            "extmetadata": {"LicenseShortName": {"value": lic}, "Artist": {"value": artist}, "UsageTerms": {"value": usage},
                            "DateTimeOriginal": {"value": "1925"}, "ImageDescription": {"value": "Cửu Đỉnh <b>Huế</b>"}}}]}

def jpeg_bytes(size=(1200, 900), color=(120, 90, 60)):
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", size, color).save(b, "JPEG"); return b.getvalue()

class FakeResp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False

class Pure(unittest.TestCase):
    def test_license_filter(self):
        for ok in ("Public domain", "PD-old-70", "CC0", "CC BY 2.0", "CC BY-SA 4.0", "CC BY-SA 3.0 vn"):
            self.assertTrue(ar.license_ok(ok), ok)
        for bad in ("CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0", "Fair use", "", "All rights reserved"):
            self.assertFalse(ar.license_ok(bad), bad)
        self.assertFalse(ar.license_ok("CC BY 4.0", "Non-commercial use only"))
    def test_attribution(self):
        self.assertFalse(ar.needs_attribution("Public domain")); self.assertFalse(ar.needs_attribution("CC0"))
        self.assertTrue(ar.needs_attribution("CC BY-SA 4.0"))
    def test_slugify(self):
        self.assertEqual(ar.slugify("File:Hổ khắc trên Cửu Đỉnh Huế (Cao Đỉnh).jpg"), "file-ho-khac-tren-cuu-dinh-hue-cao-dinh")
        self.assertEqual(ar.slugify("???"), "img")
    def test_credit_lines(self):
        by = {"author": "Phương Huy", "license": "CC BY-SA 4.0", "attributionRequired": True}
        pd = {"author": "Unknown", "license": "Public domain", "attributionRequired": False, "date": "1920s"}
        self.assertEqual(ar.credit_line(by), "Phương Huy / Wikimedia Commons, CC BY-SA 4.0")
        self.assertEqual(ar.credit_line(pd), "tác giả không rõ, 1920s (phạm vi công cộng), Wikimedia Commons")
        c = ar.caption_credits([by, by, pd])
        self.assertEqual(c, "📷 Ảnh tư liệu, Wikimedia Commons: Phương Huy (CC BY-SA 4.0); tác giả không rõ, 1920s (phạm vi công cộng)")
        self.assertEqual(ar.caption_credits([{**pd, "author": "BAVH 1914", "date": "1914"}]), "📷 Ảnh tư liệu, Wikimedia Commons: BAVH 1914 (phạm vi công cộng)")
        self.assertIn("Phương Huy / Wikimedia Commons, CC BY-SA 4.0", ar.caption_credits([by], short=False))
        self.assertEqual(ar.caption_credits([]), "")

class Library(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.env = mock.patch.dict(os.environ, {"ARCHIVE_DIR": os.path.join(self.tmp, "archive"), "DATA_DIR": self.tmp}); self.env.start()
    def tearDown(self): self.env.stop()

    def _urlopen(self, pages):
        def f(req, timeout=0):
            url = req.full_url if hasattr(req, "full_url") else req
            self.assertTrue(req.get_header("User-agent"))
            if "api.php" in url: return FakeResp(json.dumps({"query": {"pages": pages}}).encode())
            return FakeResp(jpeg_bytes())
        return f

    def test_search_filters_and_add_fetch(self):
        pages = [page("File:Cuu Dinh Hue.jpg", "CC BY 2.0"), page("File:NC.jpg", "CC BY-NC 2.0", sha1="n"),
                 page("File:Small.jpg", "CC0", w=400, h=300, sha1="s")]
        with mock.patch("urllib.request.urlopen", self._urlopen(pages)):
            res = ar.search("cuu dinh hue")
            self.assertEqual([r["title"] for r in res], ["File:Cuu Dinh Hue.jpg"])
            self.assertEqual(res[0]["author"], "Nguyễn Văn A")
            it = ar.add("cuu-dinh", res[0], keywords=["cuu", "dinh"])
            again = ar.add("cuu-dinh", res[0])
        self.assertEqual(it["id"], again["id"]); self.assertTrue(it["attributionRequired"])
        self.assertTrue(os.path.exists(ar.item_path(it)))
        self.assertEqual(len(ar.load_index("cuu-dinh")["items"]), 1)
        self.assertTrue(os.path.exists(os.path.join(ar.archive_dir(), "CREDITS.md")) or os.path.exists(os.path.join(ar.archive_dir(), "cuu-dinh", "CREDITS.md")))
        # find_local khớp từ khoá, fetch dùng thư viện trước (không gọi mạng)
        self.assertEqual(ar.find_local("cửu đỉnh", "cuu-dinh")["id"], it["id"])
        self.assertIsNone(ar.find_local("thành cổ quảng trị", "cuu-dinh"))
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("không được gọi mạng")):
            self.assertEqual(ar.fetch("cuu-dinh", "cửu đỉnh huế", n=1)[0]["id"], it["id"])
        with self.assertRaises(RuntimeError):
            ar.add("cuu-dinh", {**res[0], "license": "CC BY-ND 4.0", "title": "File:ND.jpg"})

    def test_scene_items_and_video_credits(self):
        pages = [page("File:A.jpg", "CC BY-SA 4.0")]
        with mock.patch("urllib.request.urlopen", self._urlopen(pages)):
            it = ar.add("t", ar.search("a")[0])
        sc = {"archive": {"items": [{"id": it["id"], "label": "Nhãn", "mode": "detail", "focus": [0.4, 0.5]}]}}
        got = ar.scene_items(sc)
        self.assertEqual(got[0]["mode"], "detail"); self.assertIn("CC BY-SA 4.0", got[0]["credit"])
        v = {"scenes": [sc, {"title": "x"}, sc]}
        self.assertEqual([x["id"] for x in ar.video_credits(v)], [it["id"]])

    def test_compose_smoke(self):
        from PIL import Image
        p1, p2 = os.path.join(self.tmp, "a.jpg"), os.path.join(self.tmp, "b.jpg")
        Image.new("RGB", (1600, 1000), (150, 120, 80)).save(p1); Image.new("RGB", (900, 1400), (60, 80, 100)).save(p2)
        out = os.path.join(self.tmp, "o.mp4")
        items = [{"path": p1, "label": "Cửu Đỉnh · thập niên 1920", "credit": "tác giả không rõ (phạm vi công cộng)", "mode": "frame"},
                 {"path": p2, "label": "Hổ", "credit": "A / Wikimedia Commons, CC BY-SA 4.0", "mode": "detail", "focus": [0.5, 0.4]}]
        ar.compose(items, out, 1.2, fps=10)
        pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out],
                            capture_output=True, text=True).stdout.strip()
        self.assertEqual(pr, "1080,1920")
        for mode in ("pan", "backdrop"):
            ar.compose([{**items[0], "mode": mode}], out, 0.5, fps=10)
            self.assertGreater(os.path.getsize(out), 1000)

class CliJson(unittest.TestCase):
    def test_search_json(self):
        hit = {"title": "File:A.jpg", "page": "https://c/A", "author": "X", "license": "CC BY 4.0", "licenseUrl": "u", "width": 10, "height": 20,
               "thumb": "t", "description": "d", "date": "1925", "url": "secret-internal"}
        out = io.StringIO()
        with mock.patch.object(ar, "search", return_value=[hit]), mock.patch.object(sys, "argv", ["archive.py", "search", "q", "--json"]), mock.patch("sys.stdout", out):
            ar.main()
        rows = json.loads(out.getvalue())
        self.assertEqual(rows[0]["title"], "File:A.jpg"); self.assertEqual(rows[0]["license"], "CC BY 4.0"); self.assertNotIn("url", rows[0])

if __name__ == "__main__":
    unittest.main()
