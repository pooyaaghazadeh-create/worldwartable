"""Edition-scoping and Simple Edition rule regression coverage."""

import os
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SESSION_SECRET", "test-session-secret")

import server


class _DeterministicRandomizer:
    def sample(self, population, count):
        return list(population[:count])


class EditionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_paths = {
            name: config["database_path"] for name, config in server.EDITIONS.items()
        }
        for edition in server.EDITIONS:
            server.EDITIONS[edition]["database_path"] = Path(self.temp_dir.name) / f"{edition}.sqlite3"
            server.initialize_database(edition)
        self.handler = object.__new__(server.GameHandler)

    def tearDown(self):
        if hasattr(self, "http_server"):
            self.http_server.shutdown()
            self.http_server.server_close()
            self.http_thread.join(timeout=2)
        for edition, path in self.original_paths.items():
            server.EDITIONS[edition]["database_path"] = path
        self.temp_dir.cleanup()

    def add_player(self, edition, handle, country):
        with server.database(edition) as connection:
            cursor = connection.execute(
                "INSERT INTO players (handle, handle_key, country, created_at) VALUES (?, ?, ?, 1)",
                (handle, handle.casefold(), country),
            )
            connection.execute(
                "INSERT INTO player_wallets (player_id, coins, loans) VALUES (?, 0, 0)",
                (cursor.lastrowid,),
            )
            return cursor.lastrowid

    def test_rooms_are_database_isolated_and_snapshots_identify_the_edition(self):
        self.add_player("simple", "Simple Commander", "USA 🇺🇸")

        with server.database("advanced") as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM players").fetchone()[0], 0)

        token = server.ACTIVE_EDITION.set("simple")
        try:
            with server.database() as connection:
                snapshot = self.handler.room_snapshot(connection)
        finally:
            server.ACTIVE_EDITION.reset(token)

        self.assertEqual(snapshot["edition"], "simple")
        self.assertEqual(snapshot["editionLabel"], "Simple Edition")
        self.assertEqual([player["handle"] for player in snapshot["players"]], ["Simple Commander"])

        with server.database("simple") as connection:
            tv_snapshot = self.handler.room_snapshot(
                connection,
                include_investments=False,
                include_total_investment=False,
            )
        self.assertNotIn("totalInvestment", tv_snapshot["players"][0])

    def test_simple_deal_excludes_banker_and_president_while_advanced_keeps_them(self):
        simple_id = self.add_player("simple", "Simple Commander", "USA 🇺🇸")
        advanced_id = self.add_player("advanced", "Advanced Commander", "Canada 🇨🇦")

        with patch("server.secrets.SystemRandom", return_value=_DeterministicRandomizer()):
            token = server.ACTIVE_EDITION.set("simple")
            try:
                with server.database() as connection:
                    self.assertTrue(self.handler.deal_round_cards(connection))
                    cards = connection.execute(
                        "SELECT cards FROM player_round_cards WHERE player_id = ?", (simple_id,)
                    ).fetchone()["cards"]
            finally:
                server.ACTIVE_EDITION.reset(token)

            token = server.ACTIVE_EDITION.set("advanced")
            try:
                with server.database() as connection:
                    self.assertTrue(self.handler.deal_round_cards(connection))
                    advanced_cards = connection.execute(
                        "SELECT cards FROM player_round_cards WHERE player_id = ?", (advanced_id,)
                    ).fetchone()["cards"]
            finally:
                server.ACTIVE_EDITION.reset(token)

        self.assertNotIn("Banker", cards)
        self.assertNotIn("President", cards)
        self.assertEqual(len(json.loads(cards)), 1)
        self.assertEqual(advanced_cards, '["Banker", "President"]')
        self.assertEqual(len(json.loads(advanced_cards)), 2)

    def test_simple_server_rejects_banker_and_alliance_actions(self):
        responses = []
        self.handler.send_json = lambda payload, status=server.HTTPStatus.OK, cookie=None: responses.append(
            (payload, status)
        )
        token = server.ACTIVE_EDITION.set("simple")
        try:
            self.handler.take_banker_loan({"id": 1}, {})
            self.handler.propose_alliance({"id": 1}, {})
        finally:
            server.ACTIVE_EDITION.reset(token)

        self.assertEqual(responses[0][1], server.HTTPStatus.FORBIDDEN)
        self.assertIn("unavailable", responses[0][0]["error"])
        self.assertEqual(responses[1][1], server.HTTPStatus.FORBIDDEN)
        self.assertIn("unavailable", responses[1][0]["error"])

    def test_simple_atomic_bomb_remains_available_during_pandemic(self):
        attacker_id = self.add_player("simple", "Attacker", "USA 🇺🇸")
        target_id = self.add_player("simple", "Target", "Canada 🇨🇦")
        responses = []
        self.handler.send_json = lambda payload, status=server.HTTPStatus.OK, cookie=None: responses.append(
            (payload, status)
        )

        with server.database("simple") as connection:
            connection.execute(
                "INSERT INTO player_round_cards (player_id, cards, dealt_at) VALUES (?, ?, 1)",
                (attacker_id, json.dumps(["Atomic Bomb"])),
            )
            connection.execute(
                "INSERT INTO player_round_resources (player_id, agri, oil, mines, locked_at) VALUES (?, 10, 10, 10, 1)",
                (attacker_id,),
            )
            connection.execute(
                "INSERT INTO player_round_resources (player_id, agri, oil, mines, locked_at) VALUES (?, 100, 10, 10, 1)",
                (target_id,),
            )
            connection.execute(
                "UPDATE room_state SET active_condition = ? WHERE id = 1",
                (json.dumps({"id": "pandemic"}),),
            )

        token = server.ACTIVE_EDITION.set("simple")
        try:
            self.handler.atomic_strike(
                {"id": attacker_id, "country": "USA 🇺🇸"},
                {"field": "agri", "targetCountry": "Canada 🇨🇦"},
            )
        finally:
            server.ACTIVE_EDITION.reset(token)

        self.assertEqual(responses[-1][1], server.HTTPStatus.CREATED)
        with server.database("simple") as connection:
            remaining = connection.execute(
                "SELECT agri FROM player_round_resources WHERE player_id = ?", (target_id,)
            ).fetchone()["agri"]
        self.assertEqual(remaining, 80)

    def test_one_browser_can_keep_independent_sessions_for_both_editions(self):
        self.http_server = server.ThreadingHTTPServer(("127.0.0.1", 0), server.GameHandler)
        self.http_thread = threading.Thread(target=self.http_server.serve_forever, daemon=True)
        self.http_thread.start()
        port = self.http_server.server_address[1]
        cookie_jar = {}

        def request(method, path, payload=None):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            headers = {"Content-Type": "application/json"}
            if cookie_jar:
                headers["Cookie"] = "; ".join(f"{name}={value}" for name, value in cookie_jar.items())
            body = json.dumps(payload).encode() if payload is not None else None
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = json.loads(response.read().decode())
            for name, value in response.getheaders():
                if name.casefold() == "set-cookie":
                    cookie_name, cookie_value = value.split(";", 1)[0].split("=", 1)
                    cookie_jar[cookie_name] = cookie_value
            connection.close()
            return response.status, data

        self.assertEqual(
            request("POST", "/api/room/join", {"handle": "Advanced Commander", "edition": "advanced"})[0],
            201,
        )
        self.assertEqual(
            request("POST", "/api/room/join", {"handle": "Simple Commander", "edition": "simple"})[0],
            201,
        )

        self.assertIn("world_war_session_advanced", cookie_jar)
        self.assertIn("world_war_session_simple", cookie_jar)
        advanced_status, advanced_session = request("GET", "/api/session?edition=advanced")
        simple_status, simple_session = request("GET", "/api/session?edition=simple")
        self.assertEqual(advanced_status, 200)
        self.assertEqual(simple_status, 200)
        self.assertEqual(advanced_session["player"]["handle"], "Advanced Commander")
        self.assertEqual(simple_session["player"]["handle"], "Simple Commander")

        reset_status, reset_data = request(
            "POST",
            "/api/room/reset",
            {"edition": "advanced"},
        )
        self.assertEqual(reset_status, 200)
        self.assertTrue(reset_data["ok"])

        advanced_status, advanced_session = request("GET", "/api/session?edition=advanced")
        simple_status, simple_session = request("GET", "/api/session?edition=simple")
        self.assertEqual(advanced_status, 200)
        self.assertIsNone(advanced_session["player"])
        self.assertEqual(simple_status, 200)
        self.assertEqual(simple_session["player"]["handle"], "Simple Commander")

    def test_player_return_url_uses_the_requested_edition_and_public_dev_domain(self):
        self.handler.headers = {"Host": "127.0.0.1:5000"}
        responses = []
        self.handler.send_json = lambda payload, status=server.HTTPStatus.OK, cookie=None: responses.append(
            (payload, status)
        )

        with patch.dict(os.environ, {"REPLIT_DEV_DOMAIN": "table.example.replit.dev"}):
            token = server.ACTIVE_EDITION.set("simple")
            try:
                self.handler.send_player_return_url()
            finally:
                server.ACTIVE_EDITION.reset(token)

        self.assertEqual(responses[0][1], server.HTTPStatus.OK)
        self.assertEqual(
            responses[0][0]["url"],
            "https://table.example.replit.dev/mobile.html?edition=simple",
        )


if __name__ == "__main__":
    unittest.main()