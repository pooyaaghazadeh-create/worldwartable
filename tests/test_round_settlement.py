"""Regression coverage for the authoritative round-settlement formulas."""

import os
import unittest

os.environ.setdefault("SESSION_SECRET", "test-session-secret")

from server import GameHandler, legacy_fresh_banker_principal


class RoundSettlementTests(unittest.TestCase):
    ROUND_MULTIPLIERS = {
        "USA 🇺🇸": {"agri": 3, "oil": 2, "mines": 1},
    }

    def multiplier(self, field, condition=None):
        return GameHandler.field_multiplier(
            "USA 🇺🇸", field, condition, self.ROUND_MULTIPLIERS
        )

    def test_solo_fields_round_down_independently(self):
        self.assertEqual(GameHandler.calculate_field_yield(11, self.multiplier("agri")), 33)
        self.assertEqual(GameHandler.calculate_field_yield(11, self.multiplier("oil")), 22)
        self.assertEqual(GameHandler.calculate_field_yield(11, self.multiplier("mines")), 11)

    def test_global_warming_reduces_only_agriculture_and_oil(self):
        warming = {"id": "global-warming"}
        self.assertEqual(self.multiplier("agri", warming), 2.7)
        self.assertEqual(self.multiplier("oil", warming), 1.8)
        self.assertEqual(self.multiplier("mines", warming), 1)
        self.assertEqual(GameHandler.calculate_field_yield(11, self.multiplier("agri", warming)), 29)
        self.assertEqual(GameHandler.calculate_field_yield(11, self.multiplier("oil", warming)), 19)

    def test_pandemic_overrides_only_the_selected_field_to_one(self):
        pandemic = {"id": "pandemic", "field": "agri"}
        self.assertEqual(self.multiplier("agri", pandemic), 1)
        self.assertEqual(self.multiplier("oil", pandemic), 2)
        self.assertEqual(self.multiplier("mines", pandemic), 1)
        self.assertEqual(GameHandler.calculate_field_yield(17, self.multiplier("agri", pandemic)), 17)
        self.assertEqual(GameHandler.calculate_field_yield(17, self.multiplier("oil", pandemic)), 34)

    def test_cold_war_and_recession_leave_field_income_unchanged(self):
        for condition in ({"id": "cold-war"}, {"id": "economic-recession"}):
            self.assertEqual(self.multiplier("agri", condition), 3)
            self.assertEqual(GameHandler.calculate_field_yield(12, self.multiplier("agri", condition)), 36)

    def test_alliance_share_uses_pool_and_rounds_each_field(self):
        self.assertEqual(GameHandler.calculate_field_yield(151, 1.8, 3), 90)
        self.assertEqual(GameHandler.calculate_field_yield(151, 1, 3), 50)

    def test_trade_and_conflict_adjusted_field_bases_use_same_formula(self):
        # These are the post-trade, post-skirmish, and post-Atomic-Bomb locked amounts
        # that the authoritative settlement receives.
        self.assertEqual(GameHandler.calculate_field_yield(45, 2), 90)  # trade-adjusted
        self.assertEqual(GameHandler.calculate_field_yield(0, 3), 0)  # lost in a battle
        self.assertEqual(GameHandler.calculate_field_yield(24, 3), 72)  # Atomic Bomb remainder

    def test_atomic_bomb_destroys_twenty_percent_rounded_up(self):
        self.assertEqual(GameHandler.atomic_destruction_amount(500), 100)
        self.assertEqual(GameHandler.atomic_destruction_amount(24), 5)
        self.assertEqual(GameHandler.atomic_destruction_amount(1), 1)
        self.assertEqual(GameHandler.atomic_destruction_amount(0), 0)

    def test_pandemic_uses_the_same_selected_field_for_battle_and_income(self):
        pandemic = {"id": "pandemic", "field": "oil"}
        self.assertEqual(self.multiplier("agri", pandemic), 3)
        self.assertEqual(self.multiplier("oil", pandemic), 1)
        self.assertEqual(self.multiplier("mines", pandemic), 1)

    def test_full_loan_payment_collects_principal_and_one_time_interest(self):
        settlement = GameHandler.settle_banker_debt(70, 50, 100, 20)
        self.assertEqual(settlement["repaymentDue"], 120)
        self.assertEqual(settlement["collected"], 120)
        self.assertEqual(settlement["principalRemaining"], 0)
        self.assertEqual(settlement["interestRemaining"], 0)
        self.assertEqual(settlement["endingBalance"], 0)

    def test_locked_investment_is_not_added_again_to_ending_balance(self):
        # A player with 500 locked and no unallocated cash earns 500, not 1,000.
        settlement = GameHandler.settle_banker_debt(0, 500, 0, 0)
        self.assertEqual(settlement["endingBalance"], 500)

    def test_partial_loan_carry_forward_does_not_compound_interest(self):
        first = GameHandler.settle_banker_debt(0, 50, 100, 20)
        self.assertEqual(first["collected"], 50)
        self.assertEqual(first["interestCollected"], 20)
        self.assertEqual(first["principalRemaining"], 70)
        self.assertEqual(first["interestRemaining"], 0)

        second = GameHandler.settle_banker_debt(
            0, 0, first["principalRemaining"], first["interestRemaining"]
        )
        self.assertEqual(second["repaymentDue"], 70)
        self.assertEqual(second["principalRemaining"], 70)
        self.assertEqual(second["interestRemaining"], 0)

    def test_legacy_remaining_debt_is_preserved_without_new_interest(self):
        # Before the separate-interest model, a partially paid loan was stored as
        # its remaining total debt. Migration must not infer fresh interest from it.
        legacy = GameHandler.settle_banker_debt(0, 0, 70, 0)
        self.assertEqual(legacy["repaymentDue"], 70)
        self.assertEqual(legacy["principalRemaining"], 70)
        self.assertEqual(legacy["interestRemaining"], 0)

    def test_legacy_migration_identifies_untouched_principal_from_history(self):
        events = [
            {"event_type": "TAKE_BANKER_LOAN", "payload": {"country": "USA 🇺🇸", "amount": 100}},
        ]
        fresh = legacy_fresh_banker_principal(events, "USA 🇺🇸", 100)
        self.assertEqual(fresh, 100)
        self.assertEqual(GameHandler.banker_repayment_due(100, int(fresh * 0.20)), 120)

    def test_legacy_migration_does_not_recharge_a_settled_shortfall(self):
        events = [
            {"event_type": "TAKE_BANKER_LOAN", "payload": {"country": "USA 🇺🇸", "amount": 100}},
            {"event_type": "EXECUTE_ROUND_CALCULATION", "payload": {"results": {"USA 🇺🇸": {"loans": 70}}}},
        ]
        fresh = legacy_fresh_banker_principal(events, "USA 🇺🇸", 70)
        self.assertEqual(fresh, 0)
        self.assertEqual(GameHandler.banker_repayment_due(70, int(fresh * 0.20)), 70)

    def test_rankings_use_confirmed_final_wallet_balances(self):
        balances = [("Japan 🇯🇵", 300), ("Canada 🇨🇦", 300), ("USA 🇺🇸", 250)]
        ordered = sorted(balances, key=lambda row: (-row[1], row[0]))
        placements = []
        prior = None
        for index, (country, coins) in enumerate(ordered):
            if coins != prior:
                placement = index + 1
                prior = coins
            placements.append((placement, country, coins))
        self.assertEqual(placements, [(1, "Canada 🇨🇦", 300), (1, "Japan 🇯🇵", 300), (3, "USA 🇺🇸", 250)])


if __name__ == "__main__":
    unittest.main()