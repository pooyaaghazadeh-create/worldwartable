"""Regression coverage for viewable-but-locked Act phase controls."""

import unittest
from pathlib import Path


class ClientPhaseGateTests(unittest.TestCase):
    def setUp(self):
        self.source = (Path(__file__).resolve().parents[1] / "script.js").read_text()

    def test_act_tab_navigation_is_not_blocked_before_prepare_finishes(self):
        tab_start = self.source.index("window.selectGameTab = function")
        tab_end = self.source.index("function initializeGameTabs", tab_start)
        tab_body = self.source[tab_start:tab_end]

        self.assertNotIn('tabName === "act" && !isActPhaseReady()', tab_body)

    def test_act_map_actions_remain_locked_until_prepare_finishes(self):
        board_start = self.source.index("function renderCommandBoardDetails")
        board_end = self.source.index("function renderCommandBoard()", board_start)
        board_body = self.source[board_start:board_end]
        trade_start = self.source.index("window.openTradeModal")
        trade_end = self.source.index("window.closeTradeModal", trade_start)
        trade_body = self.source[trade_start:trade_end]

        self.assertIn("const actActionsLocked = !isActPhaseReady();", board_body)
        self.assertIn("trade.disabled = gameFinished || actActionsLocked", board_body)
        self.assertIn("battle.disabled = gameFinished || actActionsLocked", board_body)
        self.assertIn("if (!requireActPhase()) return;", trade_body)

    def test_trade_and_battle_are_not_ordered_against_each_other(self):
        board_start = self.source.index("function renderCommandBoardDetails")
        board_end = self.source.index("function renderCommandBoard()", board_start)
        board_body = self.source[board_start:board_end]
        skirmish_start = self.source.index("window.openSkirmishModal = function")
        skirmish_end = self.source.index("window.closeSkirmishModal", skirmish_start)
        skirmish_body = self.source[skirmish_start:skirmish_end]

        self.assertNotIn("fieldTradeAttemptsUsed", board_body[board_body.index("const battle"):])
        self.assertNotIn("if (!investmentsLocked)", skirmish_body)
        self.assertIn("No Field Trade is required first.", board_body)


if __name__ == "__main__":
    unittest.main()