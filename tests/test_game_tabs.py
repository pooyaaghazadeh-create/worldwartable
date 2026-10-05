import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GameTabLayoutTests(unittest.TestCase):
    def setUp(self):
        self.html = (ROOT / "mobile.html").read_text()
        self.script = (ROOT / "script.js").read_text()
        self.styles = (ROOT / "style.css").read_text()

    def test_prepare_tab_contains_status_cards_and_preparation_content(self):
        tab_start = self.html.index('<nav class="game-tabs"')
        tab_end = self.html.index("</nav>", tab_start)
        tablist = self.html[tab_start:tab_end]
        tab_names = re.findall(r'data-game-tab="([^"]+)"', tablist)
        self.assertEqual(tab_names, ["prepare", "act"])

        prepare_start = self.html.index('<section id="tab-panel-prepare"')
        act_start = self.html.index('<section id="tab-panel-act"', prepare_start)
        prepare_panel = self.html[prepare_start:act_start]
        for required_content in (
            'id="commander-status-strip"',
            'class="game-cards-panel full-width"',
            'class="resource-workspace full-width"',
        ):
            with self.subTest(content=required_content):
                self.assertIn(required_content, prepare_panel)

        for redundant_heading in (
            'id="txt-prepare-section"',
            'id="txt-prepare-section-desc"',
            'id="txt-act-section"',
            'id="txt-act-section-desc"',
            'id="txt-review-section"',
            'id="txt-review-section-desc"',
            'class="flow-section-label',
        ):
            self.assertNotIn(redundant_heading, self.html)
        self.assertNotIn('id="tab-panel-status"', self.html)
        self.assertNotIn('data-game-tab="status"', self.html)

    def test_next_move_status_copy_is_removed_but_lock_button_remains(self):
        self.assertNotIn('class="status-next-action"', self.html)
        self.assertNotIn('id="txt-next-move"', self.html)
        self.assertNotIn("NEXT MOVE", self.html)
        self.assertNotIn('id="status-next-action"', self.html)
        self.assertNotIn("txtStatusLock", self.script)
        self.assertIn('id="btn-lock-invest"', self.html)

    def test_game_cards_box_omits_redundant_kicker_and_instruction(self):
        prepare_start = self.html.index('<section id="tab-panel-prepare"')
        act_start = self.html.index('<section id="tab-panel-act"', prepare_start)
        prepare_panel = self.html[prepare_start:act_start]
        cards_start = prepare_panel.index('class="game-cards-panel full-width"')
        cards_grid = prepare_panel.index('<div class="game-cards-grid">', cards_start)
        cards_header = prepare_panel[cards_start:cards_grid]

        self.assertIn('aria-labelledby="txt-game-cards-title"', cards_header)
        self.assertIn('<h2 id="txt-game-cards-title">Game Cards</h2>', cards_header)
        self.assertIn('id="global-event-banner"', prepare_panel)
        self.assertIn('id="cards-container"', prepare_panel)
        self.assertNotIn("ROUND DECK", self.html)
        self.assertNotIn("Live conditions and your available proficiency cards.", self.script)
        self.assertNotIn("txtGameCardsKicker", self.script)
        self.assertNotIn("txtGameCardsDesc", self.script)

    def test_round_closure_consensus_is_below_live_table_in_act_tab(self):
        act_start = self.html.index('<section id="tab-panel-act"')
        act_panel = self.html[act_start:self.html.index("</main>", act_start)]
        table_position = act_panel.index('class="card full-width command-board-card"')
        consensus_position = act_panel.index('class="card full-width ready-consensus-card compact-round-card"')

        self.assertLess(table_position, consensus_position)
        self.assertIn('id="btn-player-ready"', act_panel)
        consensus_end = act_panel.index("</section>", consensus_position)
        consensus_card = act_panel[consensus_position:consensus_end]
        self.assertNotIn('id="txt-ready-title"', consensus_card)
        self.assertNotIn('id="val-ready-count"', consensus_card)
        self.assertNotIn('id="round-readiness-meter"', consensus_card)
        self.assertNotIn('id="btn-host-advance"', consensus_card)
        self.assertNotIn('id="btn-host-restart"', consensus_card)
        self.assertIn('id="host-review-actions"', act_panel[consensus_end:])
        self.assertNotIn('class="card full-width announcement-card"', act_panel)
        self.assertEqual(self.html.count('id="btn-player-ready"'), 1)

    def test_review_content_is_kept_in_act_without_review_tab(self):
        self.assertNotIn('data-game-tab="review"', self.html)
        self.assertNotIn('id="tab-panel-review"', self.html)
        act_start = self.html.index('<section id="tab-panel-act"')
        act_panel = self.html[act_start:self.html.index("</main>", act_start)]
        self.assertIn('id="round-settlement-card"', self.html)
        self.assertIn('id="final-placements-panel"', self.html)
        self.assertNotIn('id="round-announcements"', self.html)
        self.assertNotIn('📣 Round Announcements', act_panel)
        for retained_panel in (
            'id="round-settlement-card"',
            'id="final-placements-panel"',
        ):
            self.assertIn(retained_panel, act_panel)

    def test_tab_navigation_and_responsive_grid_match_two_tabs(self):
        select_start = self.script.index("window.selectGameTab = function")
        select_end = self.script.index("function initializeGameTabs", select_start)
        select_function = self.script[select_start:select_end]
        self.assertIn('const validTabs = ["prepare", "act"];', select_function)
        self.assertNotIn('"status"', select_function)
        self.assertRegex(self.styles, r"\.game-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);")
        self.assertIn('.game-tabs {\n    grid-template-columns: repeat(2, minmax(0, 1fr));', self.styles)

    def test_locking_and_phase_changes_do_not_auto_switch_tabs(self):
        sync_start = self.script.index("function syncCommanderStatus(")
        sync_end = self.script.index("\nfunction ", sync_start + 1)
        sync_body = self.script[sync_start:sync_end]

        self.assertNotIn("selectGameTab(", sync_body)
        self.assertIn("lastKnownGamePhase = phase;", sync_body)
        self.assertIn('tab.classList.toggle("is-current-phase", tab.dataset.gameTab === tabPhase)', sync_body)


if __name__ == "__main__":
    unittest.main()
