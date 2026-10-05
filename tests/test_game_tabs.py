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
        self.assertEqual(tab_names, ["prepare", "act", "review"])

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

    def test_tab_navigation_and_responsive_grid_match_three_tabs(self):
        select_start = self.script.index("window.selectGameTab = function")
        select_end = self.script.index("function initializeGameTabs", select_start)
        select_function = self.script[select_start:select_end]
        self.assertIn('const validTabs = ["prepare", "act", "review"];', select_function)
        self.assertNotIn('"status"', select_function)
        self.assertGreaterEqual(
            self.styles.count("grid-template-columns: repeat(3, minmax(0, 1fr));"),
            2,
        )


if __name__ == "__main__":
    unittest.main()
