"""Regression coverage for accessible icon-only sound controls."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SoundControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "script.js").read_text()
        cls.styles = (ROOT / "style.css").read_text()

    def test_player_and_tv_controls_start_as_icon_only_buttons(self):
        for filename in ("mobile.html", "tv.html"):
            markup = (ROOT / filename).read_text()
            match = re.search(r'<button[^>]*data-sound-toggle[^>]*>(.*?)</button>', markup, re.S)
            self.assertIsNotNone(match, filename)
            self.assertEqual(match.group(1).strip(), "🔇", filename)
            button_markup = match.group(0)
            self.assertIn('aria-label="Turn game sound on"', button_markup)
            self.assertIn('aria-pressed="false"', button_markup)

    def test_sound_state_changes_icon_and_accessible_label(self):
        self.assertIn('button.textContent = this.enabled ? "🔊" : "🔇";', self.script)
        self.assertIn('button.setAttribute("aria-label", this.enabled ? "Turn game sound off" : "Turn game sound on");', self.script)
        self.assertIn('button.setAttribute("aria-pressed", String(this.enabled));', self.script)
        self.assertNotIn('"Sound: On"', self.script)
        self.assertNotIn('"Sound: Off"', self.script)

    def test_icon_button_keeps_a_compact_touch_target(self):
        self.assertIn(".sound-toggle {", self.styles)
        self.assertIn("min-width: 40px;", self.styles)
        self.assertIn("height: 36px;", self.styles)
        self.assertIn("padding: 0;", self.styles)


if __name__ == "__main__":
    unittest.main()
