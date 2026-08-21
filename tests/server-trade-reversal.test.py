import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

os.environ.setdefault("SESSION_SECRET", "trade-reversal-test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class QuietGameHandler(server.GameHandler):
    def log_message(self, format, *args):
        pass


class TradeReversalServerTest(unittest.TestCase):
    def setUp(self):
        self.database_directory = tempfile.TemporaryDirectory()
        server.DATABASE_PATH = Path(self.database_directory.name) / "room.sqlite3"
        server.initialize_database()
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), QuietGameHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.players = {}
        for handle in ("Proposer", "Target", "Spy"):
            self.players[handle] = self.join(handle)
        self.seed_players()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.database_directory.cleanup()

    def request(self, method, path, payload=None, cookie=None):
        connection = http.client.HTTPConnection(*self.httpd.server_address)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw_body = response.read()
        response_cookie = response.getheader("Set-Cookie")
        connection.close()
        return (
            response.status,
            json.loads(raw_body.decode("utf-8")) if raw_body else {},
            response_cookie,
        )

    def join(self, handle):
        status, payload, cookie = self.request("POST", "/api/room/join", {"handle": handle})
        self.assertEqual(status, 201)
        self.assertIsNotNone(cookie)
        return {
            "cookie": cookie.split(";", 1)[0],
            "country": payload["player"]["country"],
        }

    def send_event(self, handle, event_type, payload, expected_status=201):
        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {"type": event_type, "payload": payload},
            self.players[handle]["cookie"],
        )
        self.assertEqual(status, expected_status, response)
        return response

    def player_id(self, handle):
        with server.database() as connection:
            row = connection.execute(
                "SELECT id FROM players WHERE handle = ?", (handle,)
            ).fetchone()
        return row["id"]

    def seed_players(self):
        with server.database() as connection:
            for handle in self.players:
                player_id = self.player_id_from_connection(connection, handle)
                connection.execute(
                    """
                    INSERT INTO player_round_resources
                      (player_id, agri, oil, mines, locked_at)
                    VALUES (?, 100, 100, 100, 1)
                    """,
                    (player_id,),
                )
                connection.execute(
                    "UPDATE player_wallets SET coins = 100 WHERE player_id = ?",
                    (player_id,),
                )
                connection.execute(
                    """
                    INSERT INTO player_round_cards (player_id, cards, dealt_at)
                    VALUES (?, ?, 1)
                    """,
                    (player_id, json.dumps(["Spy"])),
                )

    @staticmethod
    def player_id_from_connection(connection, handle):
        row = connection.execute(
            "SELECT id FROM players WHERE handle = ?", (handle,)
        ).fetchone()
        return row["id"]

    def set_condition(self, condition):
        with server.database() as connection:
            connection.execute(
                "UPDATE room_state SET active_condition = ? WHERE id = 1",
                (json.dumps(condition) if condition is not None else None,),
            )

    def set_round(self, round_number):
        with server.database() as connection:
            connection.execute(
                "UPDATE round_state SET round_number = ? WHERE id = 1",
                (round_number,),
            )

    def set_merchant(self, *handles):
        with server.database() as connection:
            for handle in handles:
                connection.execute(
                    """
                    INSERT INTO player_round_effects (player_id, merchant_active)
                    VALUES (?, 1)
                    ON CONFLICT(player_id) DO UPDATE SET merchant_active = 1
                    """,
                    (self.player_id_from_connection(connection, handle),),
                )

    def set_spy_cards(self, handle, count):
        with server.database() as connection:
            connection.execute(
                "UPDATE player_round_cards SET cards = ? WHERE player_id = ?",
                (json.dumps(["Spy"] * count), self.player_id_from_connection(connection, handle)),
            )

    def cards_for(self, handle):
        with server.database() as connection:
            row = connection.execute(
                "SELECT cards FROM player_round_cards WHERE player_id = ?",
                (self.player_id_from_connection(connection, handle),),
            ).fetchone()
        return json.loads(row["cards"])

    def assets_for(self, handle):
        with server.database() as connection:
            return server.GameHandler.player_assets(
                connection, self.player_id_from_connection(connection, handle)
            )

    def proposal(self, proposal_id):
        with server.database() as connection:
            return connection.execute(
                "SELECT * FROM trade_proposals WHERE proposal_id = ?",
                (proposal_id,),
            ).fetchone()

    def propose_trade(self, proposal_id="trade-1", offered_amount=30, requested_amount=25):
        self.send_event(
            "Proposer",
            "PROPOSE_TRADE",
            {
                "id": proposal_id,
                "targetCountry": self.players["Target"]["country"],
                "offeredAmount": offered_amount,
                "requestedAmount": requested_amount,
                "offeredField": "oil",
                "requestedField": "agri",
            },
        )

    def accept_trade(self, proposal_id="trade-1"):
        self.send_event(
            "Target",
            "RESPOND_TRADE",
            {"proposalId": proposal_id, "approved": True},
        )

    def spy_trade(self, proposal_id="trade-1", expected_status=201):
        return self.send_event(
            "Spy",
            "SPY_INTERRUPT",
            {"proposalId": proposal_id},
            expected_status,
        )

    def test_spy_cancels_pending_offer_and_restores_escrow(self):
        before = self.assets_for("Proposer")
        self.propose_trade()
        after_offer = self.assets_for("Proposer")
        self.assertEqual(after_offer["investments"]["oil"], before["investments"]["oil"] - 30)

        response = self.spy_trade()

        self.assertEqual(response["event"]["payload"]["resolution"], "cancelled")
        self.assertEqual(self.assets_for("Proposer"), before)
        self.assertEqual(self.assets_for("Target"), {
            "coins": 100,
            "investments": {"agri": 100, "oil": 100, "mines": 100},
        })
        self.assertEqual(self.cards_for("Spy"), [])
        trade = self.proposal("trade-1")
        self.assertEqual(trade["status"], "rejected")
        self.assertIsNotNone(trade["broken_at"])

    def test_missing_pending_trade_escrow_preserves_spy_and_state(self):
        self.propose_trade()
        trade_before = dict(self.proposal("trade-1"))
        assets_before = {
            handle: self.assets_for(handle)
            for handle in self.players
        }
        spy_cards_before = self.cards_for("Spy")

        with server.database() as connection:
            connection.execute(
                "DELETE FROM trade_escrow WHERE proposal_id = ?",
                ("trade-1",),
            )

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertEqual(response["error"], "The proposal escrow is missing.")
        self.assertEqual(dict(self.proposal("trade-1")), trade_before)
        self.assertEqual(
            {
                handle: self.assets_for(handle)
                for handle in self.players
            },
            assets_before,
        )
        self.assertEqual(self.cards_for("Spy"), spy_cards_before)

    def test_missing_pending_trade_escrow_preserves_acceptance_state(self):
        self.propose_trade()
        trade_before = dict(self.proposal("trade-1"))
        proposer_before = self.assets_for("Proposer")
        target_before = self.assets_for("Target")
        spy_cards_before = self.cards_for("Spy")

        with server.database() as connection:
            connection.execute(
                "DELETE FROM trade_escrow WHERE proposal_id = ?",
                ("trade-1",),
            )

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "RESPOND_TRADE",
                "payload": {"proposalId": "trade-1", "approved": True},
            },
            self.players["Target"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertEqual(response["error"], "The proposal escrow is missing.")
        self.assertEqual(dict(self.proposal("trade-1")), trade_before)
        self.assertEqual(self.assets_for("Proposer"), proposer_before)
        self.assertEqual(self.assets_for("Target"), target_before)
        self.assertEqual(self.cards_for("Spy"), spy_cards_before)

    def test_spy_reversal_restores_exact_balances_with_merchant_and_recession(self):
        self.set_merchant("Proposer", "Target")
        self.set_condition({"id": "economic-recession"})
        proposer_before = self.assets_for("Proposer")
        target_before = self.assets_for("Target")

        self.propose_trade()
        self.accept_trade()

        # 25 -> floor(25 * 1.10) = 27 -> floor(27 * .80) = 21.
        # 30 -> floor(30 * 1.10) = 33 -> floor(33 * .80) = 26.
        trade = self.proposal("trade-1")
        self.assertEqual(trade["proposer_receipt"], 21)
        self.assertEqual(trade["target_receipt"], 26)
        self.assertNotEqual(self.assets_for("Proposer"), proposer_before)
        self.assertNotEqual(self.assets_for("Target"), target_before)

        response = self.spy_trade()

        self.assertEqual(response["event"]["payload"]["resolution"], "reversed")
        self.assertEqual(self.assets_for("Proposer"), proposer_before)
        self.assertEqual(self.assets_for("Target"), target_before)
        self.assertEqual(self.cards_for("Spy"), [])

    def test_spent_settlement_asset_preserves_spy_card(self):
        self.propose_trade()
        self.accept_trade()
        with server.database() as connection:
            connection.execute(
                """
                UPDATE player_round_resources
                SET agri = agri - 101
                WHERE player_id = ?
                """,
                (self.player_id_from_connection(connection, "Proposer"),),
            )

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertIn("already been spent", response["error"])
        self.assertEqual(self.cards_for("Spy"), ["Spy"])
        self.assertEqual(self.proposal("trade-1")["status"], "accepted")

    def test_legacy_accepted_trade_preserves_spy_and_state(self):
        self.propose_trade()
        self.accept_trade()
        with server.database() as connection:
            connection.execute(
                """
                UPDATE trade_proposals
                SET proposer_receipt = 0, target_receipt = 0
                WHERE proposal_id = ?
                """,
                ("trade-1",),
            )

        trade_before = dict(self.proposal("trade-1"))
        proposer_before = self.assets_for("Proposer")
        target_before = self.assets_for("Target")
        spy_cards_before = self.cards_for("Spy")

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertIn("reversible settlement", response["error"])
        self.assertEqual(dict(self.proposal("trade-1")), trade_before)
        self.assertEqual(self.assets_for("Proposer"), proposer_before)
        self.assertEqual(self.assets_for("Target"), target_before)
        self.assertEqual(self.cards_for("Spy"), spy_cards_before)

    def test_prior_round_trade_preserves_spy_card(self):
        self.propose_trade()
        self.accept_trade()
        self.set_round(2)

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertIn("no longer eligible", response["error"])
        self.assertEqual(self.cards_for("Spy"), ["Spy"])

    def test_broken_trade_preserves_a_second_spy_card(self):
        self.set_spy_cards("Spy", 2)
        self.propose_trade()
        self.accept_trade()
        self.spy_trade()
        self.assertEqual(self.cards_for("Spy"), ["Spy"])

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertIn("no longer eligible", response["error"])
        self.assertEqual(self.cards_for("Spy"), ["Spy"])

    def test_cold_war_preserves_spy_card(self):
        self.set_condition({"id": "cold-war"})
        self.propose_trade()

        status, response, _ = self.request(
            "POST",
            "/api/room/event",
            {
                "type": "SPY_INTERRUPT",
                "payload": {"proposalId": "trade-1"},
            },
            self.players["Spy"]["cookie"],
        )

        self.assertEqual(status, 409)
        self.assertIn("Cold War", response["error"])
        self.assertEqual(self.cards_for("Spy"), ["Spy"])
        self.assertEqual(self.proposal("trade-1")["status"], "pending")


if __name__ == "__main__":
    unittest.main()