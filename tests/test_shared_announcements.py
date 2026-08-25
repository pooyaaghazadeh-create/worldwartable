"""Regression coverage for server-synchronized round announcements."""

import unittest
from pathlib import Path


class SharedAnnouncementTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.client = (root / "script.js").read_text()
        self.server = (root / "server.py").read_text()

    def section(self, source, start, end):
        return source[source.index(start) : source.index(end, source.index(start))]

    def test_local_action_logs_do_not_populate_the_shared_announcement_feed(self):
        log_action = self.section(
            self.client,
            "window.logAction = function",
            "function sharedAnnouncementTime",
        )

        self.assertNotIn("gameActivityLedger", log_action)
        self.assertNotIn("localStorage", log_action)
        self.assertNotIn("GAME_RESULT", log_action)

    def test_shared_feed_is_derived_from_server_events_with_server_time(self):
        event_handler = self.section(
            self.client,
            "function applyHostEvent",
            "async function submitHostCommand",
        )

        self.assertIn("recordSharedRoundAnnouncement(event)", event_handler)
        self.assertIn('const announceAfterApply = event.type === "EXECUTE_ROUND_CALCULATION";', event_handler)
        self.assertIn('"createdAt": row["created_at"]', self.server)
        self.assertIn('"createdAt": created_at', self.server)

    def test_round_completion_announcement_contains_no_viewer_specific_settlement(self):
        lifecycle = self.section(
            self.client,
            "function publishRoundLifecycleAlerts",
            "function applyHostEvent",
        )

        self.assertNotIn("assignedCountry", lifecycle)
        self.assertNotIn("Your settlement:", lifecycle)
        self.assertIn(
            "The server has settled every commander’s field income and Banker obligations.",
            lifecycle,
        )


if __name__ == "__main__":
    unittest.main()