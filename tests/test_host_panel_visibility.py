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

    def test_host_actions_visibility_tracks_the_authenticated_host_role(self):
        sync_start = self.script.index("function syncHostAccessUI()")
        sync_end = self.script.index("function requireRoomCreator", sync_start)
        sync_body = self.script[sync_start:sync_end]

        self.assertIn('const resetButton = document.getElementById("btn-host-reset");', sync_body)
        self.assertIn('const reviewActions = document.getElementById("host-review-actions");', sync_body)
        self.assertIn('resetButton?.classList.toggle("hidden", !isRoomCreator);', sync_body)
        self.assertIn('reviewActions?.classList.toggle("hidden", !isRoomCreator);', sync_body)
        self.assertIn("isRoomCreator = Boolean(session?.player?.isHost);", self.script)
        self.assertIn('id="host-review-actions"', self.mobile)
        self.assertIn('id="btn-host-reset"', self.mobile)
        self.assertNotIn('id="host-panel"', self.mobile)

    def test_host_buttons_remain_outside_ready_box_below_live_table(self):
        header_start = self.mobile.index('<div class="game-header-actions">')
        header_end = self.mobile.index("</div>", header_start)
        header_actions = self.mobile[header_start:header_end]
        self.assertIn('id="btn-host-reset"', header_actions)
        self.assertIn('id="btn-exit-game"', header_actions)

        act_start = self.mobile.index('<section id="tab-panel-act"')
        act_panel = self.mobile[act_start:self.mobile.index("</main>", act_start)]
        table_index = act_panel.index('class="card full-width command-board-card"')
        consensus_index = act_panel.index('class="card full-width ready-consensus-card compact-round-card"')
        consensus_end = act_panel.index("</section>", consensus_index)
        consensus_card = act_panel[consensus_index:consensus_end]
        ready_index = consensus_card.index('id="btn-player-ready"')
        actions_index = act_panel.index('id="host-review-actions"', consensus_end)

        self.assertLess(table_index, consensus_index)
        self.assertLess(ready_index, len(consensus_card))
        self.assertGreater(actions_index, consensus_end)
        self.assertNotIn('id="btn-host-advance"', consensus_card)
        self.assertNotIn('id="btn-host-restart"', consensus_card)
        self.assertIn('id="btn-host-advance"', act_panel[actions_index:])
        self.assertIn('id="btn-host-restart"', act_panel[actions_index:])
        self.assertIn('id="round-settlement-card"', act_panel)
        self.assertIn('id="round-announcements"', act_panel)

    def test_non_hosts_still_cannot_run_host_commands(self):
        guard_start = self.script.index("function requireRoomCreator")
        guard_end = self.script.index("function isGlobalConditionActive", guard_start)
        guard_body = self.script[guard_start:guard_end]

        self.assertIn("if (isRoomCreator) return true;", guard_body)
        self.assertIn("Only the room creator can", guard_body)


if __name__ == "__main__":
    unittest.main()
