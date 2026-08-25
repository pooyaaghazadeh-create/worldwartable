"""Regression coverage for player-facing gameplay rules."""

import unittest
from pathlib import Path


class RulebookTests(unittest.TestCase):
    def setUp(self):
        self.source = (Path(__file__).resolve().parents[1] / "rulebook.html").read_text()

    def test_rulebook_documents_the_automatic_global_condition_timing(self):
        self.assertIn("immediately after proficiency cards are dealt", self.source)
        self.assertIn("Automatic immediately after cards", self.source)
        self.assertIn("kartları dağıtıldıktan hemen sonra", self.source)
        self.assertIn("بلافاصله پس از توزیع کارت‌های مهارت", self.source)
        self.assertNotIn("After every seated player has locked investments", self.source)

    def test_rulebook_documents_editions_and_hitman_rules(self):
        self.assertIn("Advanced: 2 · Simple: 1", self.source)
        self.assertGreaterEqual(self.source.count("<h3>Hitman</h3>"), 3)
        self.assertIn("before locking investments", self.source)
        self.assertIn("never reveals which card type was targeted", self.source)

    def test_rulebook_uses_the_correct_atomic_bomb_destruction_amount(self):
        self.assertNotIn("current investment's half", self.source)
        self.assertNotIn("mevcut yatırımının yarısı", self.source)
        self.assertNotIn("نیمی از سرمایه‌گذاری", self.source)
        self.assertGreaterEqual(self.source.count("20%"), 2)
        self.assertIn("%20si", self.source)
        self.assertIn("۲۰٪", self.source)


if __name__ == "__main__":
    unittest.main()