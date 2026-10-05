"""Regression coverage for automatic host controls."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class HostPanelVisibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "script.js").read_text()
        cls.mobile = (ROOT / "mobile.html").read_text()

    def test_gameplay_has_no_player_host_view_toggle(self):
        self.assertNotIn('id="btn-mode-player"', self.mobile)
        self.assertNotIn('id="btn-mode-host"', self.mobile)
        self.assertNotIn('id="lbl-view-mode"', self.mobile)
        self.assertNotIn("window.switchMode", self.script)
        self.assertNotIn("activeMode", self.script)

    def test_host_panel_visibility_tracks_the_authenticated_host_role(self):
        sync_start = self.script.index("function syncHostAccessUI()")
        sync_end = self.script.index("function requireRoomCreator", sync_start)
        sync_body = self.script[sync_start:sync_end]

        self.assertIn("const hostPanel = document.getElementById(\"host-panel\");", sync_body)
        self.assertIn('hostPanel?.classList.toggle("hidden", !isRoomCreator);', sync_body)
        self.assertIn("isRoomCreator = Boolean(session?.player?.isHost);", self.script)
        self.assertIn('id="host-panel"', self.mobile)

    def test_non_hosts_still_cannot_run_host_commands(self):
        guard_start = self.script.index("function requireRoomCreator")
        guard_end = self.script.index("function isGlobalConditionActive", guard_start)
        guard_body = self.script[guard_start:guard_end]

        self.assertIn("if (isRoomCreator) return true;", guard_body)
        self.assertIn("Only the room creator can", guard_body)


if __name__ == "__main__":
    unittest.main()
