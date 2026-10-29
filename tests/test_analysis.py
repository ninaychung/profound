"""Run: python -m unittest discover -s tests   (from the repo root)"""
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aeo import analysis as A

ANS, PR = "data/answers.jsonl", "data/prompts.json"


class Sample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res, cls.h, cls.md = A.run(ANS, PR)

    def test_hygiene_counts(self):
        self.assertEqual(self.h["raw_lines"], 618)
        self.assertEqual(self.h["duplicate_rows_removed"], 6)
        self.assertEqual(self.h["error_rows_excluded"], 12)
        self.assertEqual(self.h["successful_answers"], 600)

    def test_windows(self):
        self.assertEqual(self.res["baseline"], ("2026-09-01", "2026-09-14"))
        self.assertEqual(self.res["current"], ("2026-10-01", "2026-10-14"))

    def test_hand_numbers_integrations(self):
        t = {x["topic"]: x for x in self.res["topics"]}["Integrations"]
        pm = t["per_model"]
        self.assertEqual((pm["ChatGPT"]["baseline"]["k"], pm["ChatGPT"]["baseline"]["n"]), (32, 80))
        self.assertEqual((pm["Google Gemini"]["baseline"]["k"], pm["Google Gemini"]["baseline"]["n"]), (4, 20))
        self.assertEqual((pm["ChatGPT"]["current"]["k"], pm["ChatGPT"]["current"]["n"]), (4, 20))
        self.assertEqual((pm["Google Gemini"]["current"]["k"], pm["Google Gemini"]["current"]["n"]), (8, 80))
        self.assertAlmostEqual(t["baseline"], 0.30); self.assertAlmostEqual(t["current"], 0.15)
        self.assertEqual((t["raw"]["current"]["k"], t["raw"]["current"]["n"]), (12, 100))   # the "12 out of 100" a reader gets by hand

    def test_recommendation(self):
        self.assertEqual(self.res["recommendation"]["topic"], "Integrations")
        self.assertTrue(self.res["recommendation"]["supported"])

    def test_no_check_fails(self):
        self.assertFalse([c for c in self.res["checks"] if c[1] == "FAIL"])

    def test_bootstrap_is_deterministic(self):
        a = A.run(ANS, PR)[0]["topics"][0]["ci95_pp"]
        self.assertEqual(a, self.res["topics"][0]["ci95_pp"])

    def test_error_rows_not_counted_as_absence(self):
        rows, errors, _, _ = A.load(ANS, PR)
        self.assertTrue(all(r["status"] == "success" for r in rows))
        self.assertEqual(len(errors), 12)


class Format(unittest.TestCase):
    def test_missing_fields_message(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.jsonl")
            with open(p, "w") as f:
                f.write(json.dumps({"id": "x", "prompt_id": "p11", "model": "m"}) + "\n")
            with self.assertRaises(ValueError) as cm:
                A.load(p, PR)
            self.assertIn("answer_id", str(cm.exception))
            self.assertIn("format may have changed", str(cm.exception))

    def test_bad_json_line(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.jsonl")
            open(p, "w").write("{not json}\n")
            with self.assertRaises(ValueError):
                A.load(p, PR)


if __name__ == "__main__":
    unittest.main()
