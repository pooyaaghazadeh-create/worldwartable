"""Regression coverage for table-wide Act phase gates."""

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

    def test_act_actions_wait_until_every_commander_finishes_prepare(self):
        prepare_start = self.source.index("function isPrepareCompleteForAct()")
        prepare_end = self.source.index("function isActPhaseReady()", prepare_start)
        prepare_body = self.source[prepare_start:prepare_end]
        self.assertIn("hasLocalPrepareCompleted()", prepare_body)
        self.assertIn("activeRoomPlayers.length >= totalPlayers", prepare_body)
        self.assertIn("lockedPlayersSet.size >= totalPlayers", prepare_body)
        self.assertIn("activeRoomPlayers.every(player =>", prepare_body)

        board_start = self.source.index("function renderCommandBoardDetails")
        board_end = self.source.index("function renderCommandBoard()", board_start)
        board_body = self.source[board_start:board_end]
        trade_start = self.source.index("window.openTradeModal")
        trade_end = self.source.index("window.closeTradeModal", trade_start)
        trade_body = self.source[trade_start:trade_end]

        self.assertIn("const actActionsLocked = !isActPhaseReady();", board_body)
        self.assertIn("trade.disabled = gameFinished || actActionsLocked", board_body)
        self.assertIn("battle.disabled = gameFinished || actActionsLocked", board_body)
        self.assertIn("president.disabled = gameFinished || isSimpleEdition() || actActionsLocked", board_body)
        self.assertIn("if (!requireActPhase()) return;", self.source[self.source.index("window.openAtomicModal"):])
        self.assertIn("if (!requireActPhase()) return;", trade_body)
        self.assertIn("Complete Prepare for every commander before using Act actions.", self.source)

    def test_act_card_actions_are_not_playable_during_incomplete_prepare(self):
        hand_start = self.source.index("function renderHand()")
        hand_end = self.source.index("function playCardAction", hand_start)
        hand_body = self.source[hand_start:hand_end]
        self.assertIn('["General", "Atomic Bomb", "President"].includes(card.title)', hand_body)
        self.assertIn("isActPhaseDisabled = isActCard && !isActPhaseReady()", hand_body)

        server = (Path(__file__).resolve().parents[1] / "server.py").read_text()
        self.assertIn("Gate Act actions until every seated player completes Prepare.", server)
        self.assertIn('phase["prepared_count"] < phase["player_count"]', server)

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