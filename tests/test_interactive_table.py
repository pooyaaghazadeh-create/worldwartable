"""Regression coverage for the per-player interactive table."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class InteractiveTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "script.js").read_text()
        cls.mobile = (ROOT / "mobile.html").read_text()
        cls.styles = (ROOT / "style.css").read_text()

    def test_interactive_table_is_the_default_player_view(self):
        self.assertIn('let activeGameTab = "act";', self.script)
        self.assertIn('class="tv-felt player-table-felt"', self.mobile)
        self.assertNotIn('id="btn-open-tv-view"', self.mobile)

    def test_only_opposing_country_badges_are_targetable(self):
        self.assertIn('const interactivePlayerView = document.body.classList.contains("mobile-controller");', self.script)
        self.assertIn("const canSelect = interactivePlayerView && !isSelf;", self.script)
        self.assertIn('document.createElement(canSelect ? "button" : "article")', self.script)
        self.assertIn('seat.setAttribute("aria-pressed", String(isSelected));', self.script)
        self.assertIn("selectedBoardCountry = player.country;", self.script)
        self.assertIn("syncTableTargetSelectors();", self.script)

    def test_local_country_stays_at_the_button_seat(self):
        self.assertIn("const pinSelfToButton = interactivePlayerView", self.script)
        self.assertIn("const rosterPlayers = pinSelfToButton", self.script)
        self.assertIn("seatPosition = 6;", self.script)
        self.assertIn("if (pinSelfToButton && nextSeatPosition === 6) nextSeatPosition += 1;", self.script)
        self.assertIn("seat.dataset.seatPosition = String(seatPosition);", self.script)
        self.assertIn('.poker-seat[data-seat-position="6"] { top: auto; bottom: 0; left: 50%; }', self.styles)
        self.assertIn("grid-column: 1 / -1;", self.styles)

    def test_trade_battle_and_target_cards_use_the_selected_badge(self):
        self.assertIn("window.openCommandBoardTrade = function()", self.script)
        self.assertIn('setCommandBoardTarget("select-trade-partner");', self.script)
        self.assertIn('setCommandBoardTarget("select-skirmish-target-country");', self.script)
        self.assertIn('currentHand.findIndex(card => card.title === "Hitman")', self.script)
        self.assertIn('currentHand.findIndex(card => card.title === "Atomic Bomb")', self.script)
        self.assertIn('currentHand.findIndex(card => card.title === "President")', self.script)
        self.assertIn('populateTableTargetSelect("select-hitman-target-country", "hitman-target-display")', self.script)
        self.assertIn('populateTableTargetSelect("select-atomic-target-country", "atomic-target-display")', self.script)
        self.assertIn("selectedBoardCountry = selectedPartner.value;", self.script)

    def test_target_country_dropdowns_are_hidden_but_remain_synced_for_existing_actions(self):
        for select_id in (
            "select-trade-partner",
            "select-skirmish-target-country",
            "select-hitman-target-country",
            "select-atomic-target-country",
            "select-pres-partner-1",
        ):
            self.assertIn(f'id="{select_id}" class="modal-select hidden" hidden', self.mobile)
        for display_id in (
            "trade-target-display",
            "skirmish-target-display",
            "hitman-target-display",
            "atomic-target-display",
        ):
            self.assertIn(f'id="{display_id}" class="selected-target-preview"', self.mobile)
        self.assertIn('id="president-partner-display" class="selected-target-preview"', self.mobile)

    def test_blackout_still_hides_opponent_intelligence_and_mobile_layout_is_responsive(self):
        self.assertIn("const intelHidden = isCountryIntelHiddenByBlackout(player.country);", self.script)
        self.assertIn("isCountryIntelHiddenByBlackout(player.country) ? null : player.totalInvestment", self.script)
        self.assertIn(".player-table-felt .poker-seat.is-targetable", self.styles)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr));", self.styles)

    def test_empty_country_details_do_not_repeat_the_table_instructions(self):
        self.assertNotIn("Select an opposing country to view its command profile.", self.mobile)
        self.assertNotIn("txtBoardDetailsEmpty", self.script)
        self.assertIn("if (!player) return;", self.script)


if __name__ == "__main__":
    unittest.main()
