"""Server-managed room ownership for World War Table."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("WORLD_WAR_DB_PATH", ROOT / ".world_war_room.sqlite3"))
SESSION_SECRET = os.environ.get("SESSION_SECRET")
if not SESSION_SECRET:
    raise RuntimeError("SESSION_SECRET must be configured before starting the game server.")

COUNTRIES = [
    {"id": 1, "country": "USA 🇺🇸"},
    {"id": 2, "country": "Saudi Arabia 🇸🇦"},
    {"id": 3, "country": "Australia 🇦🇺"},
    {"id": 4, "country": "Brazil 🇧🇷"},
    {"id": 5, "country": "Norway 🇳🇴"},
    {"id": 6, "country": "Canada 🇨🇦"},
    {"id": 7, "country": "China 🇨🇳"},
    {"id": 8, "country": "Japan 🇯🇵"},
    {"id": 9, "country": "Germany 🇩🇪"},
    {"id": 10, "country": "South Africa 🇿🇦"},
]
CARD_TITLES = ("Banker", "President", "General", "Spy", "Merchant", "Atomic Bomb")
RESOURCE_FIELDS = ("agri", "oil", "mines")
ROUND_MULTIPLIER_VALUES = (1, 2, 3)
COIN_PURCHASE_AMOUNT = 100
MAX_PURCHASE_CAP = 500
GLOBAL_CONDITIONS = (
    {"id": "economic-recession"},
    {"id": "global-warming"},
    {"id": "pandemic"},
    {"id": "cold-war"},
)
HOST_EVENT_TYPES = {
    "HOST_DEAL_CARDS",
    "HOST_DRAW_EVENT",
    "EXECUTE_ROUND_CALCULATION",
    "RESOLVE_COIN_REQUEST",
}
ROOM_EVENT_TYPES = {
    "REQUEST_COINS",
    "SET_READY",
    "PROPOSE_ALLIANCE",
    "APPROVE_ALLIANCE",
    "CONFIRM_ALLIANCE",
    "REJECT_ALLIANCE",
    "LOCK_RESOURCES",
    "ALLIANCE_SKIRMISH",
    "SOLO_SKIRMISH",
    "ACTIVATE_GENERAL",
    "TAKE_BANKER_LOAN",
    "REPAY_BANKER_LOAN",
    "ACTIVATE_MERCHANT",
    "ATOMIC_STRIKE",
    "PROPOSE_TRADE",
    "RESPOND_TRADE",
    "SPY_INTERRUPT",
}
RECONNECT_CODE_TTL_SECONDS = 24 * 60 * 60


def generate_round_resource_multipliers() -> dict[str, dict[str, int]]:
    randomizer = secrets.SystemRandom()
    return {
        country["country"]: {
            field: value
            for field, value in zip(RESOURCE_FIELDS, randomizer.sample(ROUND_MULTIPLIER_VALUES, len(RESOURCE_FIELDS)))
        }
        for country in COUNTRIES
    }


def parse_round_resource_multipliers(raw_value: str | None) -> dict[str, dict[str, int]]:
    try:
        multipliers = json.loads(raw_value) if raw_value else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    if not isinstance(multipliers, dict):
        return {}
    for country in COUNTRIES:
        values = multipliers.get(country["country"])
        if (
            not isinstance(values, dict)
            or any(not isinstance(values.get(field), int) for field in RESOURCE_FIELDS)
            or sorted(values[field] for field in RESOURCE_FIELDS) != list(ROUND_MULTIPLIER_VALUES)
        ):
            return {}
    return multipliers


def legacy_fresh_banker_principal(
    events: list[dict[str, object]],
    country: str,
    outstanding_debt: int,
) -> int:
    """Find legacy Banker principal issued after that country's last settlement."""
    fresh_principal = 0
    for event in events:
        event_type = event.get("event_type")
        payload = event.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                continue
        if not isinstance(payload, dict):
            continue
        if event_type == "TAKE_BANKER_LOAN" and payload.get("country") == country:
            fresh_principal += max(0, int(payload.get("amount", 0) or 0))
        elif event_type == "REPAY_BANKER_LOAN" and payload.get("country") == country:
            fresh_principal = 0
        elif event_type == "EXECUTE_ROUND_CALCULATION":
            results = payload.get("results")
            if isinstance(results, dict) and country in results:
                fresh_principal = 0
    return min(max(0, outstanding_debt), fresh_principal)


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()
    finally:
        connection.close()


def initialize_database() -> None:
    with database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS players (
              id INTEGER PRIMARY KEY,
              handle TEXT NOT NULL,
              handle_key TEXT NOT NULL UNIQUE,
              country TEXT NOT NULL UNIQUE,
              is_host INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              player_id INTEGER NOT NULL REFERENCES players(id),
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS host_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS room_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              host_player_id INTEGER REFERENCES players(id),
              active_condition TEXT
            );
            CREATE TABLE IF NOT EXISTS player_round_resources (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              agri INTEGER NOT NULL,
              oil INTEGER NOT NULL,
              mines INTEGER NOT NULL,
              locked_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS player_wallets (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
              loans INTEGER NOT NULL DEFAULT 0 CHECK (loans >= 0),
              loan_interest INTEGER NOT NULL DEFAULT 0 CHECK (loan_interest >= 0)
            );
            CREATE TABLE IF NOT EXISTS player_round_readiness (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              ready_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS coin_requests (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
              amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 100),
              status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS round_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              cards_dealt INTEGER NOT NULL DEFAULT 0,
              event_drawn INTEGER NOT NULL DEFAULT 0,
              round_number INTEGER NOT NULL DEFAULT 1,
              game_finished INTEGER NOT NULL DEFAULT 0,
               final_placements TEXT,
               resource_multipliers TEXT
            );
            CREATE TABLE IF NOT EXISTS player_round_effects (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              merchant_active INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS player_round_settlements (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              round_number INTEGER NOT NULL,
              settlement TEXT NOT NULL,
              settled_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS trade_proposals (
              proposal_id TEXT PRIMARY KEY,
              proposer_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
              target_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
              offered_amount INTEGER NOT NULL,
              requested_amount INTEGER NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
              created_at INTEGER NOT NULL,
              offered_field TEXT NOT NULL DEFAULT 'unallocated',
              requested_field TEXT NOT NULL DEFAULT 'unallocated',
              round_number INTEGER NOT NULL DEFAULT 0,
              proposer_receipt INTEGER NOT NULL DEFAULT 0,
              target_receipt INTEGER NOT NULL DEFAULT 0,
              broken_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS trade_escrow (
              proposal_id TEXT PRIMARY KEY REFERENCES trade_proposals(proposal_id) ON DELETE CASCADE,
              owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
              field TEXT NOT NULL CHECK (field IN ('unallocated', 'agri', 'oil', 'mines')),
              amount INTEGER NOT NULL CHECK (amount > 0)
            );
            CREATE TABLE IF NOT EXISTS solo_skirmish_state (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              attacks_used INTEGER NOT NULL DEFAULT 0,
              max_attacks INTEGER NOT NULL DEFAULT 1 CHECK (max_attacks BETWEEN 1 AND 2)
            );
            CREATE TABLE IF NOT EXISTS player_round_cards (
              player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
              cards TEXT NOT NULL,
              dealt_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS active_alliances (
              proposal_id TEXT PRIMARY KEY REFERENCES alliance_proposals(proposal_id) ON DELETE CASCADE,
              initiator_player_id INTEGER NOT NULL REFERENCES players(id),
              initiator_country TEXT NOT NULL,
              alliance_type TEXT NOT NULL,
              members TEXT NOT NULL,
              agri INTEGER NOT NULL,
              oil INTEGER NOT NULL,
              mines INTEGER NOT NULL,
              attacks_used INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alliance_proposals (
              proposal_id TEXT PRIMARY KEY,
              initiator_player_id INTEGER NOT NULL REFERENCES players(id),
              initiator_country TEXT NOT NULL,
              alliance_type TEXT NOT NULL,
              members TEXT NOT NULL,
              targets TEXT NOT NULL,
              approvals TEXT NOT NULL,
              proposal_data TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
              created_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_room_host
              ON players(is_host) WHERE is_host = 1;
            """
        )
        proposal_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(trade_proposals)")
        }
        if "offered_field" not in proposal_columns:
            connection.execute(
                "ALTER TABLE trade_proposals ADD COLUMN offered_field TEXT NOT NULL DEFAULT 'unallocated'"
            )
        if "requested_field" not in proposal_columns:
            connection.execute(
                "ALTER TABLE trade_proposals ADD COLUMN requested_field TEXT NOT NULL DEFAULT 'unallocated'"
            )
        if "round_number" not in proposal_columns:
            connection.execute(
                "ALTER TABLE trade_proposals ADD COLUMN round_number INTEGER NOT NULL DEFAULT 0"
            )
        if "proposer_receipt" not in proposal_columns:
            connection.execute(
                "ALTER TABLE trade_proposals ADD COLUMN proposer_receipt INTEGER NOT NULL DEFAULT 0"
            )
        if "target_receipt" not in proposal_columns:
            connection.execute(
                "ALTER TABLE trade_proposals ADD COLUMN target_receipt INTEGER NOT NULL DEFAULT 0"
            )
        if "broken_at" not in proposal_columns:
            connection.execute("ALTER TABLE trade_proposals ADD COLUMN broken_at INTEGER")
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS eligible_spy_trades
            ON trade_proposals (round_number, status, broken_at, created_at)
            """
        )
        round_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(round_state)")
        }
        if "round_number" not in round_columns:
            connection.execute(
                "ALTER TABLE round_state ADD COLUMN round_number INTEGER NOT NULL DEFAULT 1"
            )
        if "game_finished" not in round_columns:
            connection.execute(
                "ALTER TABLE round_state ADD COLUMN game_finished INTEGER NOT NULL DEFAULT 0"
            )
        if "final_placements" not in round_columns:
            connection.execute("ALTER TABLE round_state ADD COLUMN final_placements TEXT")
        if "resource_multipliers" not in round_columns:
            connection.execute("ALTER TABLE round_state ADD COLUMN resource_multipliers TEXT")
        wallet_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(player_wallets)")
        }
        if "loan_interest" not in wallet_columns:
            connection.execute(
                "ALTER TABLE player_wallets ADD COLUMN loan_interest INTEGER NOT NULL DEFAULT 0"
            )
            historical_events = [
                {"event_type": row["event_type"], "payload": row["payload"]}
                for row in connection.execute(
                    "SELECT event_type, payload FROM host_events ORDER BY id ASC"
                )
            ]
            for wallet in connection.execute(
                """
                SELECT player_wallets.player_id, player_wallets.loans, players.country
                FROM player_wallets
                JOIN players ON players.id = player_wallets.player_id
                WHERE player_wallets.loans > 0
                """
            ):
                fresh_principal = legacy_fresh_banker_principal(
                    historical_events, wallet["country"], wallet["loans"]
                )
                connection.execute(
                    "UPDATE player_wallets SET loan_interest = ? WHERE player_id = ?",
                    (int(fresh_principal * 0.20), wallet["player_id"]),
                )
        connection.execute("INSERT OR IGNORE INTO room_state (id, host_player_id) VALUES (1, NULL)")
        connection.execute("INSERT OR IGNORE INTO round_state (id) VALUES (1)")
        multiplier_row = connection.execute(
            "SELECT resource_multipliers FROM round_state WHERE id = 1"
        ).fetchone()
        if not multiplier_row or not parse_round_resource_multipliers(multiplier_row["resource_multipliers"]):
            connection.execute(
                "UPDATE round_state SET resource_multipliers = ? WHERE id = 1",
                (json.dumps(generate_round_resource_multipliers()),),
            )
        connection.execute(
            """
            INSERT OR IGNORE INTO player_wallets (player_id, coins, loans)
            SELECT id, 0, 0 FROM players
            """
        )
        existing_host = connection.execute(
            "SELECT id FROM players WHERE is_host = 1 ORDER BY id LIMIT 1"
        ).fetchone()
        if existing_host:
            connection.execute(
                "UPDATE room_state SET host_player_id = COALESCE(host_player_id, ?) WHERE id = 1",
                (existing_host["id"],),
            )
        player_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(players)")
        }
        if "reconnect_hash" not in player_columns:
            connection.execute("ALTER TABLE players ADD COLUMN reconnect_hash TEXT")
        if "reconnect_expires_at" not in player_columns:
            connection.execute("ALTER TABLE players ADD COLUMN reconnect_expires_at INTEGER")
        room_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(room_state)")
        }
        if "active_condition" not in room_columns:
            connection.execute("ALTER TABLE room_state ADD COLUMN active_condition TEXT")


def normalize_handle(handle: str) -> str:
    return " ".join(handle.strip().casefold().split())


def token_hash(token: str) -> str:
    return hmac.new(SESSION_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


def reconnect_code_hash(code: str) -> str:
    return hmac.new(
        SESSION_SECRET.encode(),
        f"reconnect:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


def issue_reconnect_code() -> tuple[str, str, int]:
    code = secrets.token_urlsafe(18)
    return code, reconnect_code_hash(code), int(time.time()) + RECONNECT_CODE_TTL_SECONDS


class GameHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/session":
            self.send_session()
            return
        if parsed.path == "/api/room/state":
            self.send_room_state()
            return
        if parsed.path == "/api/events":
            self.send_events(parse_qs(parsed.query))
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        payload = self.read_json()
        if payload is None:
            return
        if parsed.path == "/api/room/join":
            self.join_room(payload)
            return
        if parsed.path == "/api/room/resume":
            self.resume_room(payload)
            return
        if parsed.path == "/api/host/command":
            self.create_host_event(payload)
            return
        if parsed.path == "/api/room/event":
            self.create_room_event(payload)
            return
        if parsed.path == "/api/room/reset":
            self.reset_room()
            return
        if parsed.path == "/api/room/leave":
            self.leave_room()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")

    def read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Invalid JSON request."}, HTTPStatus.BAD_REQUEST)
            return None

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, cookie: str | None = None) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(encoded)

    def session_player(self) -> sqlite3.Row | None:
        raw_cookie = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        cookie.load(raw_cookie)
        token = cookie.get("world_war_session")
        if not token:
            return None
        with database() as connection:
            return connection.execute(
                """
                SELECT players.id, players.handle, players.country,
                       room_state.host_player_id = players.id AS is_host
                FROM sessions
                JOIN players ON players.id = sessions.player_id
                JOIN room_state ON room_state.id = 1
                WHERE sessions.token_hash = ?
                """,
                (token_hash(token.value),),
            ).fetchone()

    def send_session(self) -> None:
        player = self.session_player()
        if not player:
            self.send_json({"player": None, "playerCount": 0})
            return
        with database() as connection:
            count = connection.execute("SELECT COUNT(*) FROM players").fetchone()[0]
            hand_row = connection.execute(
                "SELECT cards FROM player_round_cards WHERE player_id = ?", (player["id"],)
            ).fetchone()
            wallet_row = connection.execute(
                "SELECT coins, loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            lock_row = connection.execute(
                "SELECT agri, oil, mines FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone()
            settlement_row = connection.execute(
                "SELECT settlement FROM player_round_settlements WHERE player_id = ?", (player["id"],)
            ).fetchone()
            room = self.room_snapshot(connection)
        try:
            last_settlement = json.loads(settlement_row["settlement"]) if settlement_row else None
        except (TypeError, json.JSONDecodeError):
            last_settlement = None
        self.send_json(
            {
                "player": {
                    "handle": player["handle"],
                    "country": player["country"],
                    "isHost": bool(player["is_host"]),
                },
                "playerCount": count,
                "hand": json.loads(hand_row["cards"]) if hand_row else [],
                "room": room,
                "economy": {
                    "coins": wallet_row["coins"] if wallet_row else 0,
                    "loans": wallet_row["loans"] if wallet_row else 0,
                    "loanInterest": wallet_row["loan_interest"] if wallet_row else 0,
                    "investments": {field: lock_row[field] for field in ("agri", "oil", "mines")} if lock_row else None,
                    "lastSettlement": last_settlement,
                },
            }
        )

    def room_snapshot(
        self,
        connection: sqlite3.Connection,
        include_investments: bool = True,
    ) -> dict:
        room = connection.execute(
            """
            SELECT room_state.active_condition, round_state.round_number,
                   round_state.game_finished, round_state.final_placements,
                   round_state.resource_multipliers
            FROM room_state
            JOIN round_state ON round_state.id = 1
            WHERE room_state.id = 1
            """
        ).fetchone()
        players = [
            {
                "handle": row["handle"],
                "country": row["country"],
                "isHost": bool(row["is_host"]),
                "locked": bool(row["locked"]),
                "ready": bool(row["ready"]),
                "investments": (
                    {field: row[field] or 0 for field in RESOURCE_FIELDS}
                    if include_investments and row["locked"] else None
                ),
                "totalInvestment": (
                    (row["agri"] or 0) + (row["oil"] or 0) + (row["mines"] or 0)
                    if row["agri"] is not None else None
                ),
            }
            for row in connection.execute(
                """
                SELECT players.handle, players.country,
                       room_state.host_player_id = players.id AS is_host,
                       player_round_resources.player_id IS NOT NULL AS locked,
                       player_round_resources.agri, player_round_resources.oil,
                       player_round_resources.mines,
                       player_round_readiness.player_id IS NOT NULL AS ready
                FROM players
                JOIN room_state ON room_state.id = 1
                LEFT JOIN player_round_resources ON player_round_resources.player_id = players.id
                LEFT JOIN player_round_readiness ON player_round_readiness.player_id = players.id
                ORDER BY players.id
                """
            )
        ]
        alliances = [
            {
                "proposalId": row["proposal_id"],
                "initiator": row["initiator_country"],
                "allianceType": row["alliance_type"],
                "members": json.loads(row["members"]),
                "pool": {field: row[field] for field in ("agri", "oil", "mines")},
                "attacksUsed": row["attacks_used"],
            }
            for row in connection.execute(
                "SELECT * FROM active_alliances ORDER BY created_at"
            )
        ]
        current_round = room["round_number"] if room else 1
        pending_trades = [
            {
                "id": row["proposal_id"],
                "proposerCountry": row["proposer_country"],
                "targetCountry": row["target_country"],
                "offeredAmount": row["offered_amount"],
                "requestedAmount": row["requested_amount"],
                "offeredField": row["offered_field"],
                "requestedField": row["requested_field"],
                "status": row["status"],
            }
            for row in connection.execute(
                """
                SELECT trades.proposal_id, trades.offered_amount, trades.requested_amount,
                       trades.offered_field, trades.requested_field, trades.status,
                       proposer.country AS proposer_country, target.country AS target_country
                FROM trade_proposals AS trades
                JOIN players AS proposer ON proposer.id = trades.proposer_id
                JOIN players AS target ON target.id = trades.target_id
                WHERE trades.round_number = ?
                  AND trades.broken_at IS NULL
                  AND (
                    trades.status = 'pending'
                    OR (
                      trades.status = 'accepted'
                      AND trades.proposer_receipt > 0
                      AND trades.target_receipt > 0
                    )
                  )
                ORDER BY trades.created_at
                """,
                (current_round,),
            )
        ]
        return {
            "players": players,
            "activeCondition": json.loads(room["active_condition"]) if room and room["active_condition"] else None,
            "alliances": alliances,
            "pendingTrades": pending_trades,
            "roundNumber": current_round,
            "gameFinished": bool(room["game_finished"]) if room else False,
            "finalPlacements": json.loads(room["final_placements"]) if room and room["final_placements"] else [],
            "resourceMultipliers": (
                parse_round_resource_multipliers(room["resource_multipliers"]) if room else {}
            ),
        }

    def send_room_state(self) -> None:
        player = self.session_player()
        with database() as connection:
            self.send_json(
                {
                    "room": self.room_snapshot(
                        connection,
                        include_investments=player is not None,
                    )
                }
            )

    def join_room(self, payload: dict) -> None:
        handle = str(payload.get("handle", "")).strip()
        handle_key = normalize_handle(handle)
        if not handle_key or len(handle) > 40:
            self.send_json({"error": "Enter a commander name between 1 and 40 characters."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            game_state = connection.execute(
                "SELECT game_finished FROM round_state WHERE id = 1"
            ).fetchone()
            if game_state and game_state["game_finished"]:
                self.send_json(
                    {"error": "This three-round game is finished. Wait for the host to restart the room before joining."},
                    HTTPStatus.CONFLICT,
                )
                return
            if connection.execute("SELECT 1 FROM players WHERE handle_key = ?", (handle_key,)).fetchone():
                self.send_json({"error": "That commander name is already seated in this room."}, HTTPStatus.CONFLICT)
                return
            used_countries = {
                row[0] for row in connection.execute("SELECT country FROM players").fetchall()
            }
            available = [country for country in COUNTRIES if country["country"] not in used_countries]
            if not available:
                self.send_json({"error": "The World War Table is full."}, HTTPStatus.CONFLICT)
                return

            seat = secrets.choice(available)
            cursor = connection.execute(
                "INSERT INTO players (handle, handle_key, country, is_host, created_at) VALUES (?, ?, ?, 0, ?)",
                (handle, handle_key, seat["country"], int(time.time())),
            )
            connection.execute(
                "INSERT INTO player_wallets (player_id, coins, loans) VALUES (?, 0, 0)",
                (cursor.lastrowid,),
            )
            room = connection.execute(
                "SELECT host_player_id FROM room_state WHERE id = 1"
            ).fetchone()
            is_host = room["host_player_id"] is None
            if is_host:
                connection.execute(
                    "UPDATE room_state SET host_player_id = ? WHERE id = 1 AND host_player_id IS NULL",
                    (cursor.lastrowid,),
                )
                connection.execute("UPDATE players SET is_host = 1 WHERE id = ?", (cursor.lastrowid,))
            reconnect_code, reconnect_hash, reconnect_expires_at = issue_reconnect_code()
            connection.execute(
                """
                UPDATE players
                SET reconnect_hash = ?, reconnect_expires_at = ?
                WHERE id = ?
                """,
                (reconnect_hash, reconnect_expires_at, cursor.lastrowid),
            )
            token = secrets.token_urlsafe(32)
            connection.execute(
                "INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)",
                (token_hash(token), cursor.lastrowid, int(time.time())),
            )
            self.publish_room_event(
                connection,
                "PLAYER_JOINED",
                {"handle": handle, "country": seat["country"]},
            )
            room_snapshot = self.room_snapshot(connection)

        cookie = f"world_war_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400"
        self.send_json(
            {
                "player": {
                    "handle": handle,
                    "country": seat["country"],
                    "isHost": is_host,
                },
                "reconnectCode": reconnect_code,
                "room": room_snapshot,
            },
            HTTPStatus.CREATED,
            cookie,
        )

    def resume_room(self, payload: dict) -> None:
        handle = str(payload.get("handle", "")).strip()
        handle_key = normalize_handle(handle)
        reconnect_code = str(payload.get("reconnectCode", "")).strip()
        invalid_response = {
            "error": "Could not resume this player. Check your commander name and reconnect code."
        }
        if not handle_key or len(handle) > 40 or not reconnect_code:
            self.send_json(invalid_response, HTTPStatus.UNAUTHORIZED)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            player = connection.execute(
                """
                SELECT players.id, players.handle, players.country, players.reconnect_hash,
                       players.reconnect_expires_at,
                       room_state.host_player_id = players.id AS is_host
                FROM players
                JOIN room_state ON room_state.id = 1
                WHERE players.handle_key = ?
                """,
                (handle_key,),
            ).fetchone()
            now = int(time.time())
            if (
                not player
                or not player["reconnect_hash"]
                or not player["reconnect_expires_at"]
                or player["reconnect_expires_at"] < now
                or not hmac.compare_digest(
                    player["reconnect_hash"], reconnect_code_hash(reconnect_code)
                )
            ):
                self.send_json(invalid_response, HTTPStatus.UNAUTHORIZED)
                return

            next_reconnect_code, next_reconnect_hash, next_reconnect_expires_at = issue_reconnect_code()
            connection.execute("DELETE FROM sessions WHERE player_id = ?", (player["id"],))
            connection.execute(
                """
                UPDATE players
                SET reconnect_hash = ?, reconnect_expires_at = ?
                WHERE id = ?
                """,
                (next_reconnect_hash, next_reconnect_expires_at, player["id"]),
            )
            token = secrets.token_urlsafe(32)
            connection.execute(
                "INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)",
                (token_hash(token), player["id"], now),
            )
            room_snapshot = self.room_snapshot(connection)

        cookie = f"world_war_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400"
        self.send_json(
            {
                "player": {
                    "handle": player["handle"],
                    "country": player["country"],
                    "isHost": bool(player["is_host"]),
                },
                "reconnectCode": next_reconnect_code,
                "room": room_snapshot,
            },
            HTTPStatus.CREATED,
            cookie,
        )

    def create_host_event(self, payload: dict) -> None:
        player = self.session_player()
        if not player or not player["is_host"]:
            self.send_json({"error": "Only the room creator can issue host commands."}, HTTPStatus.FORBIDDEN)
            return

        event_type = payload.get("type")
        event_payload = payload.get("payload")
        if event_type not in HOST_EVENT_TYPES:
            self.send_json({"error": "Unsupported host command."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            game_state = connection.execute(
                "SELECT game_finished FROM round_state WHERE id = 1"
            ).fetchone()
            if game_state and game_state["game_finished"]:
                self.send_json(
                    {"error": "The three-round game is finished. Restart the room to begin a new game."},
                    HTTPStatus.CONFLICT,
                )
                return
            if event_type == "HOST_DRAW_EVENT":
                state = connection.execute("SELECT cards_dealt, event_drawn FROM round_state WHERE id = 1").fetchone()
                if not state["cards_dealt"] or state["event_drawn"]:
                    self.send_json({"error": "Deal cards first, then draw exactly one Global Condition."}, HTTPStatus.CONFLICT)
                    return
                player_count = connection.execute("SELECT COUNT(*) FROM players").fetchone()[0]
                locked_count = connection.execute("SELECT COUNT(*) FROM player_round_resources").fetchone()[0]
                if not player_count or locked_count != player_count:
                    self.send_json(
                        {"error": "Every seated player must lock investments before the Global Condition is drawn."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                event_payload = secrets.choice(GLOBAL_CONDITIONS)
                connection.execute(
                    "UPDATE room_state SET active_condition = ? WHERE id = 1",
                    (json.dumps(event_payload),),
                )
                connection.execute("UPDATE round_state SET event_drawn = 1 WHERE id = 1")
            elif event_type == "HOST_DEAL_CARDS":
                if connection.execute(
                    "SELECT 1 FROM player_round_cards LIMIT 1"
                ).fetchone():
                    self.send_json(
                        {"error": "Proficiency cards have already been dealt this round."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                state = connection.execute("SELECT cards_dealt FROM round_state WHERE id = 1").fetchone()
                if state["cards_dealt"]:
                    self.send_json({"error": "Proficiency cards have already been dealt this round."}, HTTPStatus.CONFLICT)
                    return
                players = connection.execute("SELECT id FROM players ORDER BY id").fetchall()
                for seated_player in players:
                    hand = secrets.SystemRandom().sample(CARD_TITLES, 2)
                    connection.execute(
                        """
                        INSERT INTO player_round_cards (player_id, cards, dealt_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT(player_id) DO UPDATE SET cards = excluded.cards, dealt_at = excluded.dealt_at
                        """,
                        (seated_player["id"], json.dumps(hand), int(time.time())),
                    )
                connection.execute("UPDATE round_state SET cards_dealt = 1 WHERE id = 1")
                event_payload = {}
            elif event_type == "RESOLVE_COIN_REQUEST":
                request_id = event_payload.get("requestId") if isinstance(event_payload, dict) else None
                approved = event_payload.get("approved") if isinstance(event_payload, dict) else None
                if not isinstance(request_id, int) or not isinstance(approved, bool):
                    self.send_json({"error": "Choose a valid pending coin request."}, HTTPStatus.BAD_REQUEST)
                    return
                request = connection.execute(
                    """
                    SELECT coin_requests.*, players.country, player_wallets.coins
                    FROM coin_requests
                    JOIN players ON players.id = coin_requests.player_id
                    JOIN player_wallets ON player_wallets.player_id = players.id
                    WHERE coin_requests.id = ?
                    """,
                    (request_id,),
                ).fetchone()
                if not request or request["status"] != "pending":
                    self.send_json({"error": "That coin request is no longer pending."}, HTTPStatus.CONFLICT)
                    return
                if approved and request["coins"] + request["amount"] > MAX_PURCHASE_CAP:
                    self.send_json(
                        {"error": f"Approving this request would exceed the {MAX_PURCHASE_CAP} coin wallet cap."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                connection.execute(
                    "UPDATE coin_requests SET status = ? WHERE id = ?",
                    ("approved" if approved else "rejected", request_id),
                )
                if approved:
                    connection.execute(
                        "UPDATE player_wallets SET coins = coins + ? WHERE player_id = ?",
                        (request["amount"], request["player_id"]),
                    )
                next_wallet = connection.execute(
                    "SELECT coins FROM player_wallets WHERE player_id = ?", (request["player_id"],)
                ).fetchone()
                event_payload = {
                    "requestId": request_id,
                    "country": request["country"],
                    "amount": request["amount"],
                    "approved": approved,
                    "coins": next_wallet["coins"],
                }
            elif event_type == "EXECUTE_ROUND_CALCULATION":
                player_count = connection.execute("SELECT COUNT(*) FROM players").fetchone()[0]
                locked_count = connection.execute("SELECT COUNT(*) FROM player_round_resources").fetchone()[0]
                ready_count = connection.execute("SELECT COUNT(*) FROM player_round_readiness").fetchone()[0]
                state = connection.execute(
                    """
                    SELECT cards_dealt, event_drawn, round_number, game_finished,
                           resource_multipliers
                    FROM round_state WHERE id = 1
                    """
                ).fetchone()
                if not player_count or locked_count != player_count or ready_count != player_count or not state["cards_dealt"] or not state["event_drawn"]:
                    self.send_json({"error": "Every seated player must lock resources and mark ready after cards and a Global Condition are set."}, HTTPStatus.CONFLICT)
                    return
                if state["game_finished"] or state["round_number"] > 3:
                    self.send_json(
                        {"error": "The three-round game is finished. Restart the room to begin a new game."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                round_multipliers = parse_round_resource_multipliers(state["resource_multipliers"])
                if not round_multipliers:
                    self.send_json(
                        {"error": "Round resource multipliers are unavailable. Restart the room to begin a new game."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                condition_row = connection.execute(
                    "SELECT active_condition FROM room_state WHERE id = 1"
                ).fetchone()
                condition = json.loads(condition_row["active_condition"]) if condition_row and condition_row["active_condition"] else None
                if not isinstance(condition, dict):
                    condition = None
                self.refund_pending_trade_escrow(connection)
                locked_resources = {
                    row["player_id"]: row
                    for row in connection.execute("SELECT * FROM player_round_resources")
                }
                alliance_by_member = {
                    country: alliance
                    for alliance in connection.execute("SELECT * FROM active_alliances")
                    for country in json.loads(alliance["members"])
                }
                results = {}
                for seated in connection.execute(
                    """
                    SELECT players.id, players.country, player_wallets.coins, player_wallets.loans,
                           player_wallets.loan_interest
                    FROM players JOIN player_wallets ON player_wallets.player_id = players.id
                    """
                ):
                    resources = locked_resources[seated["id"]]
                    alliance = alliance_by_member.get(seated["country"])
                    field_yields = {}
                    if alliance:
                        member_count = len(json.loads(alliance["members"]))
                        for field in RESOURCE_FIELDS:
                            multiplier = self.field_multiplier(
                                seated["country"], field, condition, round_multipliers
                            )
                            income = self.calculate_field_yield(alliance[field], multiplier, member_count)
                            field_yields[field] = {
                                "basis": alliance[field],
                                "multiplier": multiplier,
                                "income": income,
                                "isAlliancePool": True,
                            }
                        settlement_source = {
                            "type": "alliance",
                            "allianceType": alliance["alliance_type"],
                            "memberCount": member_count,
                        }
                    else:
                        for field in RESOURCE_FIELDS:
                            multiplier = self.field_multiplier(
                                seated["country"], field, condition, round_multipliers
                            )
                            income = self.calculate_field_yield(resources[field], multiplier)
                            field_yields[field] = {
                                "basis": resources[field],
                                "multiplier": multiplier,
                                "income": income,
                                "isAlliancePool": False,
                            }
                        settlement_source = {"type": "solo"}
                    gross_profit = sum(item["income"] for item in field_yields.values())
                    loan_settlement = self.settle_banker_debt(
                        seated["coins"],
                        gross_profit,
                        seated["loans"],
                        seated["loan_interest"],
                    )
                    repayment_due = loan_settlement["repaymentDue"]
                    repayment_collected = loan_settlement["collected"]
                    next_coins = loan_settlement["endingBalance"]
                    next_loan = loan_settlement["principalRemaining"]
                    next_loan_interest = loan_settlement["interestRemaining"]
                    connection.execute(
                        """
                        UPDATE player_wallets
                        SET coins = ?, loans = ?, loan_interest = ?
                        WHERE player_id = ?
                        """,
                        (next_coins, next_loan, next_loan_interest, seated["id"]),
                    )
                    settlement_record = {
                        "source": settlement_source,
                        "balanceBefore": seated["coins"],
                        "grossFieldIncome": gross_profit,
                        "loan": {
                            "principalBefore": seated["loans"],
                            "interestBefore": seated["loan_interest"],
                            "repaymentDue": repayment_due,
                            "collected": repayment_collected,
                            "principalCollected": loan_settlement["principalCollected"],
                            "interestCollected": loan_settlement["interestCollected"],
                            "principalRemaining": next_loan,
                            "interestRemaining": next_loan_interest,
                        },
                        "endingBalance": next_coins,
                        "fieldYields": field_yields,
                        "round": state["round_number"],
                    }
                    results[seated["country"]] = {
                        "coins": next_coins,
                        "loans": next_loan,
                        "loanInterest": next_loan_interest,
                        "grossProfit": gross_profit,
                        "repayment": repayment_collected,
                    }
                    connection.execute(
                        """
                        INSERT INTO player_round_settlements (player_id, round_number, settlement, settled_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(player_id) DO UPDATE SET
                          round_number = excluded.round_number,
                          settlement = excluded.settlement,
                          settled_at = excluded.settled_at
                        """,
                        (
                            seated["id"],
                            state["round_number"],
                            json.dumps(settlement_record),
                            int(time.time()),
                        ),
                    )
                completed_round = state["round_number"]
                final_placements = []
                if completed_round == 3:
                    previous_coins = None
                    placement = 0
                    for index, ranked_player in enumerate(
                        connection.execute(
                            """
                            SELECT players.country, player_wallets.coins
                            FROM players
                            JOIN player_wallets ON player_wallets.player_id = players.id
                            ORDER BY player_wallets.coins DESC, players.country ASC
                            """
                        )
                    ):
                        if previous_coins != ranked_player["coins"]:
                            placement = index + 1
                            previous_coins = ranked_player["coins"]
                        final_placements.append(
                            {
                                "placement": placement,
                                "country": ranked_player["country"],
                                "coins": ranked_player["coins"],
                            }
                        )
                event_payload = {
                    "results": results,
                    "round": completed_round,
                    "gameFinished": completed_round == 3,
                    "nextRound": None if completed_round == 3 else completed_round + 1,
                    "placements": final_placements,
                    "resourceMultipliers": round_multipliers,
                }
                connection.execute("DELETE FROM player_round_resources")
                connection.execute("DELETE FROM solo_skirmish_state")
                connection.execute("DELETE FROM player_round_cards")
                connection.execute("DELETE FROM player_round_readiness")
                connection.execute("DELETE FROM player_round_effects")
                connection.execute("DELETE FROM active_alliances")
                connection.execute("DELETE FROM trade_escrow")
                connection.execute("DELETE FROM trade_proposals")
                connection.execute("UPDATE room_state SET active_condition = NULL WHERE id = 1")
                if completed_round == 3:
                    connection.execute(
                        """
                        UPDATE round_state
                        SET cards_dealt = 0, event_drawn = 0, game_finished = 1,
                            final_placements = ?
                        WHERE id = 1
                        """,
                        (json.dumps(final_placements),),
                    )
                else:
                    next_round_multipliers = generate_round_resource_multipliers()
                    event_payload["resourceMultipliers"] = next_round_multipliers
                    connection.execute(
                        """
                        UPDATE round_state
                        SET cards_dealt = 0, event_drawn = 0, round_number = ?,
                            game_finished = 0, final_placements = NULL,
                            resource_multipliers = ?
                        WHERE id = 1
                        """,
                        (completed_round + 1, json.dumps(next_round_multipliers)),
                    )
            cursor = connection.execute(
                "INSERT INTO host_events (event_type, payload, created_at) VALUES (?, ?, ?)",
                (event_type, json.dumps(event_payload), int(time.time())),
            )
            event = {
                "id": cursor.lastrowid,
                "type": event_type,
                "payload": event_payload,
            }
        self.send_json({"event": event})

    def create_room_event(self, payload: dict) -> None:
        player = self.session_player()
        if not player:
            self.send_json({"error": "Join the room before sending game events."}, HTTPStatus.UNAUTHORIZED)
            return
        with database() as connection:
            game_state = connection.execute(
                "SELECT game_finished FROM round_state WHERE id = 1"
            ).fetchone()
        if game_state and game_state["game_finished"]:
            self.send_json(
                {"error": "The three-round game is finished. Wait for the host to restart the room."},
                HTTPStatus.CONFLICT,
            )
            return

        event_type = payload.get("type")
        event_payload = payload.get("payload")
        if event_type not in ROOM_EVENT_TYPES or not isinstance(event_payload, dict):
            self.send_json({"error": "Unsupported room event."}, HTTPStatus.BAD_REQUEST)
            return

        if event_type == "REQUEST_COINS":
            self.request_coins(player, event_payload)
        elif event_type == "SET_READY":
            self.set_ready(player, event_payload)
        elif event_type == "LOCK_RESOURCES":
            self.lock_resources(player, event_payload)
        elif event_type == "ALLIANCE_SKIRMISH":
            self.alliance_skirmish(player, event_payload)
        elif event_type == "SOLO_SKIRMISH":
            self.solo_skirmish(player, event_payload)
        elif event_type == "ACTIVATE_GENERAL":
            self.activate_general(player, event_payload)
        elif event_type == "TAKE_BANKER_LOAN":
            self.take_banker_loan(player, event_payload)
        elif event_type == "REPAY_BANKER_LOAN":
            self.repay_banker_loan(player, event_payload)
        elif event_type == "ACTIVATE_MERCHANT":
            self.activate_merchant(player, event_payload)
        elif event_type == "ATOMIC_STRIKE":
            self.atomic_strike(player, event_payload)
        elif event_type == "PROPOSE_TRADE":
            self.propose_trade(player, event_payload)
        elif event_type == "RESPOND_TRADE":
            self.respond_trade(player, event_payload)
        elif event_type == "SPY_INTERRUPT":
            self.spy_interrupt(player, event_payload)
        elif event_type == "PROPOSE_ALLIANCE":
            self.propose_alliance(player, event_payload)
        elif event_type == "APPROVE_ALLIANCE":
            self.approve_alliance(player, event_payload)
        elif event_type == "REJECT_ALLIANCE":
            self.reject_alliance(player, event_payload)
        else:
            self.confirm_alliance(player, event_payload)

    def publish_room_event(self, connection: sqlite3.Connection, event_type: str, payload: dict) -> dict:
        cursor = connection.execute(
            "INSERT INTO host_events (event_type, payload, created_at) VALUES (?, ?, ?)",
            (event_type, json.dumps(payload), int(time.time())),
        )
        return {"id": cursor.lastrowid, "type": event_type, "payload": payload}

    @staticmethod
    def consume_card(connection: sqlite3.Connection, player_id: int, title: str) -> bool:
        row = connection.execute(
            "SELECT cards FROM player_round_cards WHERE player_id = ?", (player_id,)
        ).fetchone()
        cards = json.loads(row["cards"]) if row else []
        if title not in cards:
            return False
        cards.remove(title)
        connection.execute(
            "UPDATE player_round_cards SET cards = ? WHERE player_id = ?",
            (json.dumps(cards), player_id),
        )
        return True

    @staticmethod
    def banker_interest(loan_principal: int) -> int:
        return int(max(0, loan_principal) * 0.20)

    @classmethod
    def banker_repayment_due(cls, loan_principal: int, loan_interest: int | None = None) -> int:
        """Return the persisted debt due without reapplying interest to a prior shortfall."""
        interest = cls.banker_interest(loan_principal) if loan_interest is None else max(0, loan_interest)
        return max(0, loan_principal) + interest

    @classmethod
    def settle_banker_debt(
        cls,
        balance_before: int,
        gross_income: int,
        loan_principal: int,
        loan_interest: int,
    ) -> dict[str, int]:
        """Collect the one-time interest first, then reduce principal without compounding."""
        due = cls.banker_repayment_due(loan_principal, loan_interest)
        collected = min(max(0, balance_before + gross_income), due)
        interest_collected = min(max(0, loan_interest), collected)
        principal_collected = collected - interest_collected
        return {
            "repaymentDue": due,
            "collected": collected,
            "principalCollected": principal_collected,
            "interestCollected": interest_collected,
            "principalRemaining": max(0, loan_principal - principal_collected),
            "interestRemaining": max(0, loan_interest - interest_collected),
            "endingBalance": max(0, balance_before + gross_income - collected),
        }

    @staticmethod
    def calculate_field_yield(basis: int, multiplier: float, member_count: int = 1) -> int:
        """Round each field payout down after applying multiplier and alliance share."""
        return int(max(0, basis) * multiplier / max(1, member_count))

    @staticmethod
    def banker_loan_amount(available_coins: int) -> int:
        return int(max(0, available_coins) * 0.20)

    @staticmethod
    def unallocated_wallet_coins(
        connection: sqlite3.Connection,
        player_id: int,
        wallet_coins: int,
    ) -> int:
        locked = connection.execute(
            """
            SELECT COALESCE(SUM(agri + oil + mines), 0) AS allocated
            FROM player_round_resources
            WHERE player_id = ?
            """,
            (player_id,),
        ).fetchone()
        return max(0, wallet_coins - (locked["allocated"] if locked else 0))

    def take_banker_loan(self, player: sqlite3.Row, payload: dict) -> None:
        if payload:
            self.send_json({"error": "The Banker loan amount is calculated automatically."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            wallet = connection.execute(
                "SELECT coins, loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            available_coins = self.unallocated_wallet_coins(
                connection, player["id"], wallet["coins"] if wallet else 0
            )
            amount = self.banker_loan_amount(available_coins)
            if amount <= 0:
                self.send_json(
                    {"error": "You need at least 5 unallocated coins to take a Banker loan."},
                    HTTPStatus.CONFLICT,
                )
                return
            if not self.consume_card(connection, player["id"], "Banker"):
                self.send_json({"error": "You need an unplayed Banker card."}, HTTPStatus.FORBIDDEN)
                return
            interest = self.banker_interest(amount)
            connection.execute(
                """
                UPDATE player_wallets
                SET coins = coins + ?, loans = loans + ?, loan_interest = loan_interest + ?
                WHERE player_id = ?
                """,
                (amount, amount, interest, player["id"]),
            )
            wallet = connection.execute(
                "SELECT coins, loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            event = self.publish_room_event(connection, "TAKE_BANKER_LOAN", {
                "country": player["country"],
                "amount": amount,
                "availableCoins": available_coins,
                "coins": wallet["coins"],
                "loans": wallet["loans"],
                "loanInterest": wallet["loan_interest"],
                "repaymentDue": self.banker_repayment_due(wallet["loans"], wallet["loan_interest"]),
            })
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def repay_banker_loan(self, player: sqlite3.Row, payload: dict) -> None:
        if payload:
            self.send_json({"error": "Loan repayment does not accept extra data."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            wallet = connection.execute(
                "SELECT coins, loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if not wallet or self.banker_repayment_due(wallet["loans"], wallet["loan_interest"]) <= 0:
                self.send_json({"error": "You do not have an active Banker loan."}, HTTPStatus.CONFLICT)
                return
            repayment_due = self.banker_repayment_due(wallet["loans"], wallet["loan_interest"])
            available_coins = self.unallocated_wallet_coins(
                connection, player["id"], wallet["coins"]
            )
            if available_coins < repayment_due:
                self.send_json(
                    {
                        "error": f"You need {repayment_due} unallocated coins to settle your loan and interest, but only have {available_coins}.",
                        "repaymentDue": repayment_due,
                        "availableCoins": available_coins,
                        "shortfall": repayment_due - available_coins,
                    },
                    HTTPStatus.CONFLICT,
                )
                return
            connection.execute(
                "UPDATE player_wallets SET coins = coins - ?, loans = 0, loan_interest = 0 WHERE player_id = ?",
                (repayment_due, player["id"]),
            )
            updated_wallet = connection.execute(
                "SELECT coins, loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            event = self.publish_room_event(
                connection,
                "REPAY_BANKER_LOAN",
                {
                    "country": player["country"],
                    "repayment": repayment_due,
                    "coins": updated_wallet["coins"],
                    "loans": updated_wallet["loans"],
                    "loanInterest": updated_wallet["loan_interest"],
                    "repaymentDue": 0,
                },
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def activate_merchant(self, player: sqlite3.Row, payload: dict) -> None:
        if payload:
            self.send_json({"error": "Merchant activation does not accept extra data."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if not self.consume_card(connection, player["id"], "Merchant"):
                self.send_json({"error": "You need an unplayed Merchant card."}, HTTPStatus.FORBIDDEN)
                return
            connection.execute(
                "INSERT INTO player_round_effects (player_id, merchant_active) VALUES (?, 1) ON CONFLICT(player_id) DO UPDATE SET merchant_active = 1",
                (player["id"],),
            )
            event = self.publish_room_event(connection, "ACTIVATE_MERCHANT", {"country": player["country"]})
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def atomic_strike(self, player: sqlite3.Row, payload: dict) -> None:
        field, target_country = payload.get("field"), payload.get("targetCountry")
        if field not in {"agri", "oil", "mines"} or not isinstance(target_country, str):
            self.send_json({"error": "Choose a valid seated target and resource field."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attacker_resources = connection.execute(
                "SELECT 1 FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if not attacker_resources:
                self.send_json(
                    {"error": "Lock your own investments before using an Atomic Bomb."},
                    HTTPStatus.CONFLICT,
                )
                return
            target = connection.execute(
                "SELECT id, country FROM players WHERE country = ?", (target_country,)
            ).fetchone()
            resources = target and connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (target["id"],)
            ).fetchone()
            if not target or target["id"] == player["id"] or not resources:
                self.send_json({"error": "The target must be another seated player with locked resources."}, HTTPStatus.CONFLICT)
                return
            if not self.consume_card(connection, player["id"], "Atomic Bomb"):
                self.send_json({"error": "You need an unplayed Atomic Bomb card."}, HTTPStatus.FORBIDDEN)
                return
            destroyed = (resources[field] + 1) // 2
            remaining = resources[field] - destroyed
            connection.execute(
                f"UPDATE player_round_resources SET {field} = ? WHERE player_id = ?",
                (remaining, target["id"]),
            )
            event = self.publish_room_event(connection, "ATOMIC_STRIKE", {
                "attackerCountry": player["country"], "targetCountry": target["country"],
                "targetField": field, "destroyed": destroyed, "remaining": remaining
            })
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def propose_trade(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id, target_country = payload.get("id"), payload.get("targetCountry")
        offered, requested = payload.get("offeredAmount"), payload.get("requestedAmount")
        offered_field, requested_field = payload.get("offeredField"), payload.get("requestedField")
        if not isinstance(proposal_id, str) or not isinstance(target_country, str) or any(
            isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in (offered, requested)
        ) or offered_field not in {"unallocated", "agri", "oil", "mines"} or requested_field not in {"unallocated", "agri", "oil", "mines"}:
            self.send_json({"error": "Enter a valid trade proposal."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            round_state = connection.execute(
                "SELECT round_number FROM round_state WHERE id = 1"
            ).fetchone()
            current_round = round_state["round_number"] if round_state else 1
            target = connection.execute("SELECT id, country FROM players WHERE country = ?", (target_country,)).fetchone()
            if not target:
                self.send_json({"error": "That trade partner is no longer seated in this room."}, HTTPStatus.CONFLICT)
                return
            if target["id"] == player["id"]:
                self.send_json({"error": "Choose another player as your trade partner."}, HTTPStatus.BAD_REQUEST)
                return
            if offered_field != "unallocated" and not connection.execute(
                "SELECT 1 FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone():
                self.send_json(
                    {"error": "Lock your investments before offering a field investment in a trade."},
                    HTTPStatus.CONFLICT,
                )
                return
            if not self.asset_available(connection, player["id"], offered_field, offered):
                self.send_json(
                    {"error": "Your offered amount is no longer available. Adjust the offer and try again."},
                    HTTPStatus.CONFLICT,
                )
                return
            self.change_asset(connection, player["id"], offered_field, -offered)
            connection.execute(
                """
                INSERT INTO trade_proposals
                  (proposal_id, proposer_id, target_id, offered_amount, requested_amount, status, created_at,
                   offered_field, requested_field, round_number)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """,
                (
                    proposal_id, player["id"], target["id"], offered, requested, int(time.time()),
                    offered_field, requested_field, current_round,
                ),
            )
            connection.execute(
                "INSERT INTO trade_escrow (proposal_id, owner_id, field, amount) VALUES (?, ?, ?, ?)",
                (proposal_id, player["id"], offered_field, offered),
            )
            event = self.publish_room_event(connection, "PROPOSE_TRADE", {
                "id": proposal_id, "proposerCountry": player["country"], "targetCountry": target_country,
                "offeredField": offered_field, "offeredAmount": offered,
                "requestedField": requested_field, "requestedAmount": requested,
                "assets": {player["country"]: self.player_assets(connection, player["id"])}
            })
        self.send_json({"event": event}, HTTPStatus.CREATED)

    @staticmethod
    def asset_available(connection: sqlite3.Connection, player_id: int, field: str, amount: int) -> bool:
        if field == "unallocated":
            wallet = connection.execute("SELECT coins FROM player_wallets WHERE player_id = ?", (player_id,)).fetchone()
            resources = connection.execute("SELECT agri, oil, mines FROM player_round_resources WHERE player_id = ?", (player_id,)).fetchone()
            committed = sum(resources[name] for name in ("agri", "oil", "mines")) if resources else 0
            return bool(wallet and wallet["coins"] - committed >= amount)
        resources = connection.execute("SELECT * FROM player_round_resources WHERE player_id = ?", (player_id,)).fetchone()
        return bool(resources and resources[field] >= amount)

    @staticmethod
    def change_asset(connection: sqlite3.Connection, player_id: int, field: str, delta: int) -> None:
        if field == "unallocated":
            connection.execute("UPDATE player_wallets SET coins = coins + ? WHERE player_id = ?", (delta, player_id))
        else:
            connection.execute(f"UPDATE player_round_resources SET {field} = {field} + ? WHERE player_id = ?", (delta, player_id))

    @staticmethod
    def player_assets(connection: sqlite3.Connection, player_id: int) -> dict:
        wallet = connection.execute("SELECT coins FROM player_wallets WHERE player_id = ?", (player_id,)).fetchone()
        resources = connection.execute("SELECT agri, oil, mines FROM player_round_resources WHERE player_id = ?", (player_id,)).fetchone()
        return {
            "coins": wallet["coins"] if wallet else 0,
            "investments": {field: resources[field] for field in ("agri", "oil", "mines")} if resources else None,
        }

    def refund_pending_trade_escrow(self, connection: sqlite3.Connection) -> None:
        escrows = connection.execute(
            """
            SELECT escrow.owner_id, escrow.field, escrow.amount
            FROM trade_escrow AS escrow
            JOIN trade_proposals AS trades ON trades.proposal_id = escrow.proposal_id
            WHERE trades.status = 'pending'
            """
        ).fetchall()
        for escrow in escrows:
            self.change_asset(connection, escrow["owner_id"], escrow["field"], escrow["amount"])
        connection.execute("DELETE FROM trade_escrow")
        connection.execute("DELETE FROM trade_proposals WHERE status = 'pending'")

    @staticmethod
    def trade_receipt(connection: sqlite3.Connection, player_id: int, amount: int) -> int:
        condition_row = connection.execute("SELECT active_condition FROM room_state WHERE id = 1").fetchone()
        condition = json.loads(condition_row["active_condition"]) if condition_row and condition_row["active_condition"] else {}
        merchant = connection.execute(
            "SELECT merchant_active FROM player_round_effects WHERE player_id = ?", (player_id,)
        ).fetchone()
        adjusted = amount + (amount // 10 if merchant and merchant["merchant_active"] else 0)
        return int(adjusted * .8) if isinstance(condition, dict) and condition.get("id") == "economic-recession" else adjusted

    def respond_trade(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id, approved = payload.get("proposalId"), payload.get("approved")
        if not isinstance(proposal_id, str) or not isinstance(approved, bool):
            self.send_json({"error": "Choose a valid trade response."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute("SELECT * FROM trade_proposals WHERE proposal_id = ?", (proposal_id,)).fetchone()
            if not proposal or proposal["status"] != "pending" or proposal["target_id"] != player["id"]:
                self.send_json({"error": "That trade is no longer available to you."}, HTTPStatus.CONFLICT)
                return
            escrow = connection.execute("SELECT * FROM trade_escrow WHERE proposal_id = ?", (proposal_id,)).fetchone()
            if not escrow:
                self.send_json({"error": "The proposal escrow is missing."}, HTTPStatus.CONFLICT)
                return
            if approved and not self.asset_available(connection, player["id"], proposal["requested_field"], proposal["requested_amount"]):
                approved = False
            rows = connection.execute("SELECT id, country FROM players WHERE id IN (?, ?)", (proposal["proposer_id"], player["id"])).fetchall()
            countries = {row["id"]: row["country"] for row in rows}
            if approved:
                proposer_receipt = self.trade_receipt(connection, proposal["proposer_id"], proposal["requested_amount"])
                target_receipt = self.trade_receipt(connection, player["id"], escrow["amount"])
                self.change_asset(connection, player["id"], proposal["requested_field"], -proposal["requested_amount"])
                self.change_asset(connection, proposal["proposer_id"], proposal["requested_field"], proposer_receipt)
                self.change_asset(connection, player["id"], escrow["field"], target_receipt)
                connection.execute(
                    """
                    UPDATE trade_proposals
                    SET status = 'accepted', proposer_receipt = ?, target_receipt = ?
                    WHERE proposal_id = ?
                    """,
                    (proposer_receipt, target_receipt, proposal_id),
                )
            else:
                self.change_asset(connection, proposal["proposer_id"], escrow["field"], escrow["amount"])
                connection.execute(
                    "UPDATE trade_proposals SET status = 'rejected' WHERE proposal_id = ?",
                    (proposal_id,),
                )
            connection.execute("DELETE FROM trade_escrow WHERE proposal_id = ?", (proposal_id,))
            assets = {
                row["country"]: self.player_assets(connection, row["id"])
                for row in rows
            }
            event = self.publish_room_event(connection, "RESPOND_TRADE", {
                "proposalId": proposal_id, "approved": approved, "proposerCountry": countries[proposal["proposer_id"]],
                "targetCountry": countries[player["id"]], "assets": assets,
                "offeredField": proposal["offered_field"], "offeredAmount": proposal["offered_amount"],
                "requestedField": proposal["requested_field"], "requestedAmount": proposal["requested_amount"]
            })
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def spy_interrupt(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id = payload.get("proposalId")
        if not isinstance(proposal_id, str):
            self.send_json({"error": "Choose a current-round trade to break."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            condition_row = connection.execute("SELECT active_condition FROM room_state WHERE id = 1").fetchone()
            condition = json.loads(condition_row["active_condition"]) if condition_row and condition_row["active_condition"] else {}
            if isinstance(condition, dict) and condition.get("id") == "cold-war":
                self.send_json({"error": "Cold War blocks Spy cards this round."}, HTTPStatus.CONFLICT)
                return
            proposal = connection.execute(
                "SELECT * FROM trade_proposals WHERE proposal_id = ?", (proposal_id,)
            ).fetchone()
            round_state = connection.execute(
                "SELECT round_number FROM round_state WHERE id = 1"
            ).fetchone()
            current_round = round_state["round_number"] if round_state else 1
            if (
                not proposal
                or proposal["round_number"] != current_round
                or proposal["broken_at"] is not None
                or proposal["status"] not in {"pending", "accepted"}
            ):
                self.send_json(
                    {"error": "That trade is no longer eligible for a Spy operation."},
                    HTTPStatus.CONFLICT,
                )
                return

            rows = connection.execute(
                "SELECT id, country FROM players WHERE id IN (?, ?)",
                (proposal["proposer_id"], proposal["target_id"]),
            ).fetchall()
            countries = {row["id"]: row["country"] for row in rows}
            resolution = "cancelled"
            if proposal["status"] == "pending":
                escrow = connection.execute(
                    "SELECT * FROM trade_escrow WHERE proposal_id = ?", (proposal_id,)
                ).fetchone()
                if not escrow:
                    self.send_json({"error": "The proposal escrow is missing."}, HTTPStatus.CONFLICT)
                    return
            else:
                proposer_receipt = proposal["proposer_receipt"]
                target_receipt = proposal["target_receipt"]
                if proposer_receipt <= 0 or target_receipt <= 0:
                    self.send_json(
                        {"error": "This trade does not have reversible settlement details."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                if not self.asset_available(
                    connection, proposal["proposer_id"], proposal["requested_field"], proposer_receipt
                ) or not self.asset_available(
                    connection, proposal["target_id"], proposal["offered_field"], target_receipt
                ):
                    self.send_json(
                        {
                            "error": (
                                "This trade cannot be broken because one of the transferred "
                                "assets has already been spent."
                            )
                        },
                        HTTPStatus.CONFLICT,
                    )
                    return

            if not self.consume_card(connection, player["id"], "Spy"):
                self.send_json({"error": "You need an unplayed Spy card."}, HTTPStatus.FORBIDDEN)
                return

            if proposal["status"] == "pending":
                self.change_asset(connection, escrow["owner_id"], escrow["field"], escrow["amount"])
                connection.execute("DELETE FROM trade_escrow WHERE proposal_id = ?", (proposal_id,))
            else:
                self.change_asset(
                    connection, proposal["proposer_id"], proposal["requested_field"], -proposal["proposer_receipt"]
                )
                self.change_asset(
                    connection, proposal["target_id"], proposal["offered_field"], -proposal["target_receipt"]
                )
                self.change_asset(
                    connection, proposal["proposer_id"], proposal["offered_field"], proposal["offered_amount"]
                )
                self.change_asset(
                    connection, proposal["target_id"], proposal["requested_field"], proposal["requested_amount"]
                )
                resolution = "reversed"
            connection.execute(
                "UPDATE trade_proposals SET status = 'rejected', broken_at = ? WHERE proposal_id = ?",
                (int(time.time()), proposal_id),
            )
            assets = {
                row["country"]: self.player_assets(connection, row["id"])
                for row in rows
            }
            event = self.publish_room_event(connection, "SPY_INTERRUPT", {
                "country": player["country"],
                "proposalId": proposal_id,
                "resolution": resolution,
                "proposerCountry": countries.get(proposal["proposer_id"]),
                "targetCountry": countries.get(proposal["target_id"]),
                "assets": assets,
            })
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def lock_resources(self, player: sqlite3.Row, payload: dict) -> None:
        fields = ("agri", "oil", "mines")
        values = {field: payload.get(field) for field in fields}
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 100000 for value in values.values()):
            self.send_json({"error": "Locked resources must be whole, non-negative field values."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                "SELECT 1 FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone():
                self.send_json({"error": "Your resources are already locked for this round."}, HTTPStatus.CONFLICT)
                return
            wallet = connection.execute(
                "SELECT coins FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if not wallet or sum(values.values()) > wallet["coins"]:
                self.send_json({"error": "You cannot lock more resources than your server-approved wallet balance."}, HTTPStatus.CONFLICT)
                return
            connection.execute(
                """
                INSERT INTO player_round_resources (player_id, agri, oil, mines, locked_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (player["id"], values["agri"], values["oil"], values["mines"], int(time.time())),
            )
            event = self.publish_room_event(
                connection,
                "LOCK_RESOURCES",
                {"country": player["country"], **values},
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def request_coins(self, player: sqlite3.Row, payload: dict) -> None:
        if payload:
            self.send_json({"error": "Coin requests do not accept client-supplied amounts."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            wallet = connection.execute(
                "SELECT coins FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            pending_amount = connection.execute(
                """
                SELECT COALESCE(SUM(amount), 0)
                FROM coin_requests
                WHERE player_id = ? AND status = 'pending'
                """,
                (player["id"],),
            ).fetchone()[0]
            if not wallet or wallet["coins"] + pending_amount + COIN_PURCHASE_AMOUNT > MAX_PURCHASE_CAP:
                self.send_json(
                    {
                        "error": (
                            f"Your approved coins and pending requests already reach the "
                            f"{MAX_PURCHASE_CAP} coin purchase cap."
                        )
                    },
                    HTTPStatus.CONFLICT,
                )
                return
            cursor = connection.execute(
                "INSERT INTO coin_requests (player_id, amount, status, created_at) VALUES (?, ?, 'pending', ?)",
                (player["id"], COIN_PURCHASE_AMOUNT, int(time.time())),
            )
            event = self.publish_room_event(
                connection,
                "REQUEST_COINS",
                {
                    "requestId": cursor.lastrowid,
                    "country": player["country"],
                    "amount": COIN_PURCHASE_AMOUNT,
                },
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def set_ready(self, player: sqlite3.Row, payload: dict) -> None:
        ready = payload.get("ready") if isinstance(payload, dict) else None
        if not isinstance(ready, bool):
            self.send_json({"error": "Ready state must be true or false."}, HTTPStatus.BAD_REQUEST)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if ready and not connection.execute(
                "SELECT 1 FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone():
                self.send_json({"error": "Lock resources before marking ready."}, HTTPStatus.CONFLICT)
                return
            if ready:
                connection.execute(
                    "INSERT INTO player_round_readiness (player_id, ready_at) VALUES (?, ?) ON CONFLICT(player_id) DO UPDATE SET ready_at = excluded.ready_at",
                    (player["id"], int(time.time())),
                )
            else:
                connection.execute("DELETE FROM player_round_readiness WHERE player_id = ?", (player["id"],))
            event = self.publish_room_event(
                connection, "SET_READY", {"country": player["country"], "ready": ready}
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    @staticmethod
    def field_multiplier(
        country: str,
        field: str,
        condition: dict | None,
        round_multipliers: dict[str, dict[str, int]],
    ) -> float:
        if condition and condition.get("id") == "pandemic":
            return 1
        multiplier = round_multipliers.get(country, {}).get(field, 1)
        if condition and condition.get("id") == "global-warming" and field in {"agri", "oil"}:
            return multiplier * 0.9
        return multiplier

    def alliance_skirmish(self, player: sqlite3.Row, payload: dict) -> None:
        field = payload.get("field")
        target_kind = payload.get("targetKind")
        target_id = payload.get("targetId")
        if field not in {"agri", "oil", "mines"} or target_kind not in {"solo", "alliance"} or not isinstance(target_id, str):
            self.send_json({"error": "Choose a valid resource field and target."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attacker = connection.execute(
                "SELECT * FROM active_alliances WHERE initiator_player_id = ?", (player["id"],)
            ).fetchone()
            if not attacker:
                self.send_json({"error": "Only a confirmed alliance initiator may launch an alliance skirmish."}, HTTPStatus.FORBIDDEN)
                return
            attacker_wallet = connection.execute(
                "SELECT loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if attacker_wallet and self.banker_repayment_due(
                attacker_wallet["loans"], attacker_wallet["loan_interest"]
            ) > 0:
                repayment_due = self.banker_repayment_due(
                    attacker_wallet["loans"], attacker_wallet["loan_interest"]
                )
                self.send_json(
                    {"error": f"Settle your Banker loan and {attacker_wallet['loan_interest']} coins of interest before launching a Field Battle."},
                    HTTPStatus.CONFLICT,
                )
                return
            if attacker["attacks_used"] >= 1:
                self.send_json({"error": "This alliance has already used its skirmish this round."}, HTTPStatus.CONFLICT)
                return

            attacker_members = set(json.loads(attacker["members"]))
            defender = None
            defender_country = None
            defender_pool = False
            if target_kind == "alliance":
                defender = connection.execute(
                    "SELECT * FROM active_alliances WHERE proposal_id = ?", (target_id,)
                ).fetchone()
                if not defender or defender["proposal_id"] == attacker["proposal_id"]:
                    self.send_json({"error": "That alliance is not a valid target."}, HTTPStatus.BAD_REQUEST)
                    return
                defender_country = defender["initiator_country"]
                defender_pool = True
            else:
                target_player = connection.execute(
                    "SELECT id, country FROM players WHERE country = ?", (target_id,)
                ).fetchone()
                if not target_player or target_player["country"] in attacker_members:
                    self.send_json({"error": "That country is not a valid solo target."}, HTTPStatus.BAD_REQUEST)
                    return
                if connection.execute(
                    "SELECT 1 FROM active_alliances WHERE members LIKE ?",
                    (f'%"{target_player["country"]}"%',),
                ).fetchone():
                    self.send_json({"error": "Alliance members must be targeted through their alliance."}, HTTPStatus.BAD_REQUEST)
                    return
                defender = connection.execute(
                    "SELECT * FROM player_round_resources WHERE player_id = ?", (target_player["id"],)
                ).fetchone()
                if not defender:
                    self.send_json({"error": "The selected country has not locked resources this round."}, HTTPStatus.CONFLICT)
                    return
                defender_country = target_player["country"]

            attack_resource = attacker[field]
            defend_resource = defender[field]
            if attack_resource <= 0 or defend_resource <= 0:
                self.send_json({"error": "Both sides must hold resources in the selected field."}, HTTPStatus.CONFLICT)
                return

            condition_row = connection.execute("SELECT active_condition FROM room_state WHERE id = 1").fetchone()
            condition = json.loads(condition_row["active_condition"]) if condition_row and condition_row["active_condition"] else None
            if not isinstance(condition, dict):
                condition = None
            multiplier_row = connection.execute(
                "SELECT resource_multipliers FROM round_state WHERE id = 1"
            ).fetchone()
            round_multipliers = parse_round_resource_multipliers(
                multiplier_row["resource_multipliers"] if multiplier_row else None
            )
            attacker_power = attack_resource * self.field_multiplier(
                attacker["initiator_country"], field, condition, round_multipliers
            )
            defender_power = defend_resource * self.field_multiplier(
                defender_country, field, condition, round_multipliers
            )
            if attacker_power > defender_power:
                outcome = "victory"
                transfer = defend_resource
                connection.execute(
                    f"UPDATE active_alliances SET {field} = {field} + ?, attacks_used = 1 WHERE proposal_id = ?",
                    (transfer, attacker["proposal_id"]),
                )
                target_table = "active_alliances" if defender_pool else "player_round_resources"
                target_key = "proposal_id" if defender_pool else "player_id"
                target_value = defender["proposal_id"] if defender_pool else target_player["id"]
                connection.execute(f"UPDATE {target_table} SET {field} = 0 WHERE {target_key} = ?", (target_value,))
                winner = attacker["initiator_country"]
            elif attacker_power < defender_power:
                outcome = "defeat"
                transfer = attack_resource
                connection.execute(
                    f"UPDATE active_alliances SET {field} = 0, attacks_used = 1 WHERE proposal_id = ?",
                    (attacker["proposal_id"],),
                )
                if defender_pool:
                    connection.execute(
                        f"UPDATE active_alliances SET {field} = {field} + ? WHERE proposal_id = ?",
                        (transfer, defender["proposal_id"]),
                    )
                else:
                    connection.execute(
                        f"UPDATE player_round_resources SET {field} = {field} + ? WHERE player_id = ?",
                        (transfer, target_player["id"]),
                    )
                winner = defender_country
            else:
                outcome = "stalemate"
                transfer = 0
                connection.execute(
                    "UPDATE active_alliances SET attacks_used = 1 WHERE proposal_id = ?",
                    (attacker["proposal_id"],),
                )
                winner = None

            attacker_after = connection.execute(
                "SELECT * FROM active_alliances WHERE proposal_id = ?", (attacker["proposal_id"],)
            ).fetchone()
            defender_after = connection.execute(
                "SELECT * FROM active_alliances WHERE proposal_id = ?", (defender["proposal_id"],)
            ).fetchone() if defender_pool else connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (target_player["id"],)
            ).fetchone()
            event = self.publish_room_event(
                connection,
                "ALLIANCE_SKIRMISH",
                {
                    "field": field,
                    "outcome": outcome,
                    "winner": winner,
                    "transfer": transfer,
                    "attacker": {
                        "proposalId": attacker_after["proposal_id"],
                        "initiator": attacker_after["initiator_country"],
                        "members": json.loads(attacker_after["members"]),
                        "pool": {key: attacker_after[key] for key in ("agri", "oil", "mines")},
                        "attacksUsed": attacker_after["attacks_used"],
                    },
                    "defender": {
                        "kind": target_kind,
                        "id": target_id,
                        "country": defender_country,
                        "pool": {key: defender_after[key] for key in ("agri", "oil", "mines")},
                    },
                    "attackerPower": attacker_power,
                    "defenderPower": defender_power,
                },
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def activate_general(self, player: sqlite3.Row, payload: dict) -> None:
        if payload:
            self.send_json({"error": "General activation does not accept extra data."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT OR IGNORE INTO solo_skirmish_state (player_id, attacks_used, max_attacks)
                VALUES (?, 0, 1)
                """,
                (player["id"],),
            )
            state = connection.execute(
                "SELECT * FROM solo_skirmish_state WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if state["max_attacks"] >= 2:
                self.send_json({"error": "Your General skirmish allowance is already active."}, HTTPStatus.CONFLICT)
                return
            hand_row = connection.execute(
                "SELECT cards FROM player_round_cards WHERE player_id = ?", (player["id"],)
            ).fetchone()
            hand = json.loads(hand_row["cards"]) if hand_row else []
            if "General" not in hand:
                self.send_json(
                    {"error": "You need an unplayed General card for a second solo skirmish."},
                    HTTPStatus.FORBIDDEN,
                )
                return
            hand.remove("General")
            connection.execute(
                "UPDATE player_round_cards SET cards = ? WHERE player_id = ?",
                (json.dumps(hand), player["id"]),
            )
            connection.execute(
                "UPDATE solo_skirmish_state SET max_attacks = 2 WHERE player_id = ?",
                (player["id"],),
            )
            event = self.publish_room_event(
                connection,
                "ACTIVATE_GENERAL",
                {"country": player["country"], "attacksUsed": state["attacks_used"], "maxAttacks": 2},
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def solo_skirmish(self, player: sqlite3.Row, payload: dict) -> None:
        field = payload.get("field")
        target_id = payload.get("targetId")
        if field not in {"agri", "oil", "mines"} or not isinstance(target_id, str):
            self.send_json({"error": "Choose a valid resource field and target."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            attacker_wallet = connection.execute(
                "SELECT loans, loan_interest FROM player_wallets WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if attacker_wallet and self.banker_repayment_due(
                attacker_wallet["loans"], attacker_wallet["loan_interest"]
            ) > 0:
                repayment_due = self.banker_repayment_due(
                    attacker_wallet["loans"], attacker_wallet["loan_interest"]
                )
                self.send_json(
                    {"error": f"Settle your Banker loan and {attacker_wallet['loan_interest']} coins of interest before launching a Field Battle."},
                    HTTPStatus.CONFLICT,
                )
                return
            target_player = connection.execute(
                "SELECT id, country FROM players WHERE country = ?", (target_id,)
            ).fetchone()
            if not target_player or target_player["id"] == player["id"]:
                self.send_json({"error": "That country is not a valid solo target."}, HTTPStatus.BAD_REQUEST)
                return

            alliance_members = {
                country
                for row in connection.execute("SELECT members FROM active_alliances")
                for country in json.loads(row["members"])
            }
            if player["country"] in alliance_members or target_player["country"] in alliance_members:
                self.send_json(
                    {"error": "Confirmed alliance members must use alliance skirmishes."},
                    HTTPStatus.CONFLICT,
                )
                return

            attacker = connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone()
            defender = connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (target_player["id"],)
            ).fetchone()
            if not attacker or not defender:
                self.send_json(
                    {"error": "Both countries must lock resources before a solo skirmish."},
                    HTTPStatus.CONFLICT,
                )
                return

            connection.execute(
                """
                INSERT OR IGNORE INTO solo_skirmish_state (player_id, attacks_used, max_attacks)
                VALUES (?, 0, 1)
                """,
                (player["id"],),
            )
            state = connection.execute(
                "SELECT * FROM solo_skirmish_state WHERE player_id = ?", (player["id"],)
            ).fetchone()
            if state["attacks_used"] >= state["max_attacks"]:
                self.send_json(
                    {"error": "You have used all solo skirmishes allowed this round."},
                    HTTPStatus.CONFLICT,
                )
                return

            attack_resource = attacker[field]
            defend_resource = defender[field]
            if attack_resource <= 0 or defend_resource <= 0:
                self.send_json(
                    {"error": "Both sides must hold resources in the selected field."},
                    HTTPStatus.CONFLICT,
                )
                return

            condition_row = connection.execute(
                "SELECT active_condition FROM room_state WHERE id = 1"
            ).fetchone()
            condition = (
                json.loads(condition_row["active_condition"])
                if condition_row and condition_row["active_condition"]
                else None
            )
            if not isinstance(condition, dict):
                condition = None
            multiplier_row = connection.execute(
                "SELECT resource_multipliers FROM round_state WHERE id = 1"
            ).fetchone()
            round_multipliers = parse_round_resource_multipliers(
                multiplier_row["resource_multipliers"] if multiplier_row else None
            )
            attacker_power = attack_resource * self.field_multiplier(
                player["country"], field, condition, round_multipliers
            )
            defender_power = defend_resource * self.field_multiplier(
                target_player["country"], field, condition, round_multipliers
            )
            if attacker_power > defender_power:
                outcome = "victory"
                transfer = defend_resource
                winner = player["country"]
                connection.execute(
                    f"UPDATE player_round_resources SET {field} = {field} + ? WHERE player_id = ?",
                    (transfer, player["id"]),
                )
                connection.execute(
                    f"UPDATE player_round_resources SET {field} = 0 WHERE player_id = ?",
                    (target_player["id"],),
                )
            elif attacker_power < defender_power:
                outcome = "defeat"
                transfer = attack_resource
                winner = target_player["country"]
                connection.execute(
                    f"UPDATE player_round_resources SET {field} = 0 WHERE player_id = ?",
                    (player["id"],),
                )
                connection.execute(
                    f"UPDATE player_round_resources SET {field} = {field} + ? WHERE player_id = ?",
                    (transfer, target_player["id"]),
                )
            else:
                outcome = "stalemate"
                transfer = 0
                winner = None

            connection.execute(
                "UPDATE solo_skirmish_state SET attacks_used = attacks_used + 1 WHERE player_id = ?",
                (player["id"],),
            )
            attacker_after = connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (player["id"],)
            ).fetchone()
            defender_after = connection.execute(
                "SELECT * FROM player_round_resources WHERE player_id = ?", (target_player["id"],)
            ).fetchone()
            state_after = connection.execute(
                "SELECT * FROM solo_skirmish_state WHERE player_id = ?", (player["id"],)
            ).fetchone()
            event = self.publish_room_event(
                connection,
                "SOLO_SKIRMISH",
                {
                    "field": field,
                    "outcome": outcome,
                    "winner": winner,
                    "transfer": transfer,
                    "attackerPower": attacker_power,
                    "defenderPower": defender_power,
                    "attacker": {
                        "country": player["country"],
                        "resources": {
                            key: attacker_after[key] for key in ("agri", "oil", "mines")
                        },
                        "attacksUsed": state_after["attacks_used"],
                        "maxAttacks": state_after["max_attacks"],
                    },
                    "defender": {
                        "country": target_player["country"],
                        "resources": {
                            key: defender_after[key] for key in ("agri", "oil", "mines")
                        },
                    },
                },
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def propose_alliance(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id = payload.get("proposalId")
        members = payload.get("members")
        targets = payload.get("pendingTargets")
        alliance_type = payload.get("allianceType")
        proposal_data = payload.get("data")
        if (
            not isinstance(proposal_id, str)
            or not proposal_id
            or len(proposal_id) > 128
            or alliance_type not in {"Mega-Merger", "Counter-Union"}
            or not isinstance(members, list)
            or not isinstance(targets, list)
            or not isinstance(proposal_data, dict)
            or payload.get("initiator") != player["country"]
            or payload.get("approvals") != [player["country"]]
            or len(members) not in {2, 3}
            or members[0] != player["country"]
            or any(not isinstance(country, str) or not country for country in members)
            or len(set(members)) != len(members)
            or targets != members[1:]
        ):
            self.send_json({"error": "Malformed alliance proposal."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            seated_countries = {
                row["country"] for row in connection.execute("SELECT country FROM players")
            }
            if not set(members).issubset(seated_countries):
                self.send_json({"error": "Alliance members must be seated players."}, HTTPStatus.BAD_REQUEST)
                return
            if alliance_type == "Mega-Merger":
                hand_row = connection.execute(
                    "SELECT cards FROM player_round_cards WHERE player_id = ?", (player["id"],)
                ).fetchone()
                hand = json.loads(hand_row["cards"]) if hand_row else []
                if "President" not in hand:
                    self.send_json({"error": "A Mega-Merger requires an unplayed President card."}, HTTPStatus.FORBIDDEN)
                    return
            confirmed_members = {
                country
                for row in connection.execute("SELECT members FROM active_alliances")
                for country in json.loads(row["members"])
            }
            if set(members) & confirmed_members:
                self.send_json({"error": "A confirmed alliance member cannot join another alliance this round."}, HTTPStatus.CONFLICT)
                return
            pending_members = {
                country
                for row in connection.execute(
                    "SELECT members FROM alliance_proposals WHERE status = 'pending'"
                )
                for country in json.loads(row["members"])
            }
            if set(members) & pending_members:
                self.send_json({"error": "A player may participate in only one pending alliance proposal."}, HTTPStatus.CONFLICT)
                return
            if connection.execute(
                "SELECT 1 FROM alliance_proposals WHERE proposal_id = ?", (proposal_id,)
            ).fetchone():
                self.send_json({"error": "That alliance proposal already exists."}, HTTPStatus.CONFLICT)
                return

            canonical_payload = {
                "proposalId": proposal_id,
                "initiator": player["country"],
                "allianceType": alliance_type,
                "members": members,
                "approvals": [player["country"]],
                "pendingTargets": targets,
                "data": proposal_data,
            }
            connection.execute(
                """
                INSERT INTO alliance_proposals (
                  proposal_id, initiator_player_id, initiator_country, alliance_type,
                  members, targets, approvals, proposal_data, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """,
                (
                    proposal_id,
                    player["id"],
                    player["country"],
                    alliance_type,
                    json.dumps(members),
                    json.dumps(targets),
                    json.dumps([player["country"]]),
                    json.dumps(proposal_data),
                    int(time.time()),
                ),
            )
            if alliance_type == "Mega-Merger":
                hand.remove("President")
                connection.execute(
                    "UPDATE player_round_cards SET cards = ? WHERE player_id = ?",
                    (json.dumps(hand), player["id"]),
                )
            event = self.publish_room_event(connection, "PROPOSE_ALLIANCE", canonical_payload)
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def approve_alliance(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id = payload.get("proposalId")
        if not isinstance(proposal_id, str) or payload.get("approvedBy") != player["country"]:
            self.send_json({"error": "Malformed alliance approval."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute(
                "SELECT * FROM alliance_proposals WHERE proposal_id = ?", (proposal_id,)
            ).fetchone()
            if not proposal:
                self.send_json({"error": "Alliance proposal not found."}, HTTPStatus.NOT_FOUND)
                return
            if proposal["status"] != "pending":
                self.send_json({"error": "This alliance proposal is no longer pending."}, HTTPStatus.CONFLICT)
                return
            targets = json.loads(proposal["targets"])
            approvals = json.loads(proposal["approvals"])
            if player["country"] not in targets:
                self.send_json({"error": "Only invited alliance members can approve."}, HTTPStatus.FORBIDDEN)
                return
            if player["country"] in approvals:
                self.send_json({"error": "This alliance member already approved."}, HTTPStatus.CONFLICT)
                return

            approvals.append(player["country"])
            connection.execute(
                "UPDATE alliance_proposals SET approvals = ? WHERE proposal_id = ?",
                (json.dumps(approvals), proposal_id),
            )
            event = self.publish_room_event(
                connection,
                "APPROVE_ALLIANCE",
                {"proposalId": proposal_id, "approvedBy": player["country"]},
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def reject_alliance(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id = payload.get("proposalId")
        if not isinstance(proposal_id, str) or payload.get("rejectedBy") != player["country"]:
            self.send_json({"error": "Malformed alliance rejection."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute(
                "SELECT status, targets FROM alliance_proposals WHERE proposal_id = ?", (proposal_id,)
            ).fetchone()
            if not proposal:
                self.send_json({"error": "Alliance proposal not found."}, HTTPStatus.NOT_FOUND)
                return
            if proposal["status"] != "pending":
                self.send_json({"error": "This alliance proposal is no longer pending."}, HTTPStatus.CONFLICT)
                return
            if player["country"] not in json.loads(proposal["targets"]):
                self.send_json({"error": "Only invited alliance members can reject."}, HTTPStatus.FORBIDDEN)
                return

            connection.execute(
                "UPDATE alliance_proposals SET status = 'rejected' WHERE proposal_id = ?",
                (proposal_id,),
            )
            event = self.publish_room_event(
                connection,
                "REJECT_ALLIANCE",
                {"proposalId": proposal_id, "rejectedBy": player["country"]},
            )
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def confirm_alliance(self, player: sqlite3.Row, payload: dict) -> None:
        proposal_id = payload.get("proposalId")
        if not isinstance(proposal_id, str) or payload.get("initiator") != player["country"]:
            self.send_json({"error": "Malformed alliance confirmation."}, HTTPStatus.BAD_REQUEST)
            return

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            proposal = connection.execute(
                "SELECT * FROM alliance_proposals WHERE proposal_id = ?", (proposal_id,)
            ).fetchone()
            if not proposal:
                self.send_json({"error": "Alliance proposal not found."}, HTTPStatus.NOT_FOUND)
                return
            if proposal["status"] != "pending":
                self.send_json({"error": "This alliance proposal is no longer pending."}, HTTPStatus.CONFLICT)
                return
            if proposal["initiator_player_id"] != player["id"]:
                self.send_json({"error": "Only the alliance initiator can confirm."}, HTTPStatus.FORBIDDEN)
                return

            members = json.loads(proposal["members"])
            targets = json.loads(proposal["targets"])
            approvals = json.loads(proposal["approvals"])
            if not set(targets).issubset(set(approvals)):
                self.send_json({"error": "Every invited alliance member must approve first."}, HTTPStatus.CONFLICT)
                return
            confirmed_members = {
                country
                for row in connection.execute("SELECT members FROM active_alliances")
                for country in json.loads(row["members"])
            }
            if set(members) & confirmed_members:
                self.send_json({"error": "A confirmed alliance member cannot join another alliance this round."}, HTTPStatus.CONFLICT)
                return
            locked_resources = {
                row["player_id"]: row
                for row in connection.execute(
                    """
                    SELECT player_round_resources.*
                    FROM player_round_resources
                    JOIN players ON players.id = player_round_resources.player_id
                    WHERE players.country IN ({})
                    """.format(",".join("?" for _ in members)),
                    members,
                )
            }
            member_rows = connection.execute(
                "SELECT id, country FROM players WHERE country IN ({})".format(",".join("?" for _ in members)),
                members,
            ).fetchall()
            if len(member_rows) != len(members) or any(row["id"] not in locked_resources for row in member_rows):
                self.send_json({"error": "Every alliance member must lock resources before confirmation."}, HTTPStatus.CONFLICT)
                return
            initiator_resources = locked_resources[player["id"]]
            member_count = len(members)
            pool = {
                field: max(150, initiator_resources[field] * member_count + 150)
                for field in ("agri", "oil", "mines")
            }

            connection.execute(
                "UPDATE alliance_proposals SET status = 'confirmed' WHERE proposal_id = ?",
                (proposal_id,),
            )
            connection.execute(
                """
                INSERT INTO active_alliances (
                  proposal_id, initiator_player_id, initiator_country, alliance_type,
                  members, agri, oil, mines, attacks_used, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    proposal_id,
                    player["id"],
                    proposal["initiator_country"],
                    proposal["alliance_type"],
                    json.dumps(members),
                    pool["agri"],
                    pool["oil"],
                    pool["mines"],
                    int(time.time()),
                ),
            )
            proposal_data = json.loads(proposal["proposal_data"])
            proposal_data.update(
                {
                    "proposalId": proposal_id,
                    "initiator": proposal["initiator_country"],
                    "members": members,
                    "pool": pool,
                    "attacksUsed": 0,
                }
            )
            canonical_payload = {
                "proposalId": proposal_id,
                "initiator": proposal["initiator_country"],
                "allianceType": proposal["alliance_type"],
                "members": members,
                "approvals": approvals,
                "pendingTargets": [],
                "data": proposal_data,
            }
            event = self.publish_room_event(connection, "CONFIRM_ALLIANCE", canonical_payload)
        self.send_json({"event": event}, HTTPStatus.CREATED)

    def send_events(self, query: dict) -> None:
        try:
            after = max(0, int(query.get("after", ["0"])[0]))
        except ValueError:
            after = 0
        with database() as connection:
            events = [
                {"id": row["id"], "type": row["event_type"], "payload": json.loads(row["payload"])}
                for row in connection.execute(
                    "SELECT id, event_type, payload FROM host_events WHERE id > ? ORDER BY id ASC",
                    (after,),
                )
            ]
        self.send_json({"events": events})

    def leave_room(self) -> None:
        player = self.session_player()
        if not player:
            self.send_json({"error": "You are no longer seated in this room."}, HTTPStatus.UNAUTHORIZED)
            return

        player_id = player["id"]
        player_country = player["country"]
        player_handle = player["handle"]
        was_host = bool(player["is_host"])

        def includes_departing_country(serialized_countries: str) -> bool:
            try:
                return player_country in json.loads(serialized_countries)
            except (TypeError, json.JSONDecodeError):
                return False

        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")

            alliance_ids = [
                row["proposal_id"]
                for row in connection.execute(
                    "SELECT proposal_id, initiator_player_id, members FROM active_alliances"
                )
                if row["initiator_player_id"] == player_id or includes_departing_country(row["members"])
            ]
            if alliance_ids:
                placeholders = ", ".join("?" for _ in alliance_ids)
                connection.execute(
                    f"DELETE FROM active_alliances WHERE proposal_id IN ({placeholders})",
                    alliance_ids,
                )

            proposal_ids = [
                row["proposal_id"]
                for row in connection.execute(
                    "SELECT proposal_id, initiator_player_id, members, targets FROM alliance_proposals"
                )
                if (
                    row["initiator_player_id"] == player_id
                    or includes_departing_country(row["members"])
                    or includes_departing_country(row["targets"])
                )
            ]
            if proposal_ids:
                placeholders = ", ".join("?" for _ in proposal_ids)
                connection.execute(
                    f"DELETE FROM active_alliances WHERE proposal_id IN ({placeholders})",
                    proposal_ids,
                )
                connection.execute(
                    f"DELETE FROM alliance_proposals WHERE proposal_id IN ({placeholders})",
                    proposal_ids,
                )

            trade_ids = [
                row["proposal_id"]
                for row in connection.execute(
                    "SELECT proposal_id FROM trade_proposals WHERE proposer_id = ? OR target_id = ?",
                    (player_id, player_id),
                )
            ]
            if trade_ids:
                placeholders = ", ".join("?" for _ in trade_ids)
                connection.execute(
                    f"DELETE FROM trade_escrow WHERE owner_id = ? OR proposal_id IN ({placeholders})",
                    [player_id, *trade_ids],
                )
                connection.execute(
                    f"DELETE FROM trade_proposals WHERE proposal_id IN ({placeholders})",
                    trade_ids,
                )
            else:
                connection.execute("DELETE FROM trade_escrow WHERE owner_id = ?", (player_id,))

            if was_host:
                connection.execute("UPDATE room_state SET host_player_id = NULL WHERE id = 1")
                connection.execute("UPDATE players SET is_host = 0 WHERE id = ?", (player_id,))

            for table in (
                "sessions",
                "player_round_resources",
                "solo_skirmish_state",
                "player_round_cards",
                "player_round_readiness",
                "coin_requests",
                "player_round_effects",
                "player_wallets",
            ):
                connection.execute(f"DELETE FROM {table} WHERE player_id = ?", (player_id,))
            connection.execute("DELETE FROM players WHERE id = ?", (player_id,))

            remaining_count = connection.execute("SELECT COUNT(*) FROM players").fetchone()[0]
            new_host_country = None
            if was_host and remaining_count:
                replacement = connection.execute(
                    "SELECT id, country FROM players ORDER BY created_at, id LIMIT 1"
                ).fetchone()
                connection.execute(
                    "UPDATE room_state SET host_player_id = ? WHERE id = 1",
                    (replacement["id"],),
                )
                connection.execute("UPDATE players SET is_host = 1 WHERE id = ?", (replacement["id"],))
                new_host_country = replacement["country"]

            if not remaining_count:
                connection.execute("DELETE FROM host_events")
                connection.execute("DELETE FROM active_alliances")
                connection.execute("DELETE FROM alliance_proposals")
                connection.execute("UPDATE room_state SET host_player_id = NULL, active_condition = NULL WHERE id = 1")
                connection.execute(
                    """
                    UPDATE round_state
                    SET cards_dealt = 0, event_drawn = 0, round_number = 1,
                        game_finished = 0, final_placements = NULL,
                        resource_multipliers = ?
                    WHERE id = 1
                    """,
                    (json.dumps(generate_round_resource_multipliers()),),
                )
            else:
                self.publish_room_event(
                    connection,
                    "PLAYER_LEFT",
                    {
                        "handle": player_handle,
                        "country": player_country,
                        "newHostCountry": new_host_country,
                    },
                )

        self.send_json(
            {"ok": True, "playerCount": remaining_count, "newHostCountry": new_host_country},
            cookie="world_war_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        )

    def reset_room(self) -> None:
        player = self.session_player()
        if not player or not player["is_host"]:
            self.send_json({"error": "Only the room creator can reset the room."}, HTTPStatus.FORBIDDEN)
            return
        with database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            game_state = connection.execute(
                "SELECT game_finished FROM round_state WHERE id = 1"
            ).fetchone()
            if not game_state or not game_state["game_finished"]:
                self.send_json(
                    {"error": "The host can restart the room only after the third round is complete."},
                    HTTPStatus.CONFLICT,
                )
                return
            connection.execute("DELETE FROM sessions")
            connection.execute("DELETE FROM player_round_resources")
            connection.execute("DELETE FROM solo_skirmish_state")
            connection.execute("DELETE FROM player_round_cards")
            connection.execute("DELETE FROM player_round_readiness")
            connection.execute("DELETE FROM coin_requests")
            connection.execute("DELETE FROM player_round_effects")
            connection.execute("DELETE FROM player_round_settlements")
            connection.execute("DELETE FROM player_wallets")
            connection.execute("DELETE FROM active_alliances")
            connection.execute("DELETE FROM trade_escrow")
            connection.execute("DELETE FROM trade_proposals")
            connection.execute("DELETE FROM players")
            connection.execute("DELETE FROM host_events")
            connection.execute("DELETE FROM alliance_proposals")
            connection.execute("UPDATE room_state SET host_player_id = NULL, active_condition = NULL WHERE id = 1")
            connection.execute(
                """
                UPDATE round_state
                SET cards_dealt = 0, event_drawn = 0, round_number = 1,
                    game_finished = 0, final_placements = NULL,
                    resource_multipliers = ?
                WHERE id = 1
                """,
                (json.dumps(generate_round_resource_multipliers()),),
            )
        self.send_json({"ok": True}, cookie="world_war_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")


if __name__ == "__main__":
    initialize_database()
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("0.0.0.0", 5000), GameHandler)
    print("World War Table server listening on port 5000")
    server.serve_forever()