"""Regression coverage for private Hitman result delivery to the acting player."""

import unittest
from pathlib import Path


class HitmanClientFlowTests(unittest.TestCase):
    def test_room_event_response_delivers_private_hitman_result(self):
        source = (Path(__file__).resolve().parents[1] / "script.js").read_text()
        room_event_start = source.index("async function submitRoomEvent")
        polling_start = source.index("function startHostEventPolling", room_event_start)
        room_event_body = source[room_event_start:polling_start]

        self.assertIn(
            "if (data.hitmanResult) handleHitmanResult(data.hitmanResult);",
            room_event_body,
        )
        self.assertIn("void refreshCurrentHand();", source[source.index("function handleHitmanResult"):])

    def test_host_command_response_does_not_handle_player_private_hitman_result(self):
        source = (Path(__file__).resolve().parents[1] / "script.js").read_text()
        host_command_start = source.index("async function submitHostCommand")
        room_event_start = source.index("async function submitRoomEvent", host_command_start)
        host_command_body = source[host_command_start:room_event_start]

        self.assertNotIn("data.hitmanResult", host_command_body)

    def test_hitman_event_publishes_a_safe_public_result_notification(self):
        source = (Path(__file__).resolve().parents[1] / "script.js").read_text()
        hitman_start = source.index('} else if (event.type === "HITMAN_STRIKE")')
        next_event_start = source.index('} else if (event.type === "SOLO_SKIRMISH")', hitman_start)
        hitman_body = source[hitman_start:next_event_start]

        self.assertIn("const publicMessage = succeeded", hitman_body)
        self.assertIn('logAction(publicMessage, "CARD")', hitman_body)
        self.assertIn('category: "HITMAN RESULT"', hitman_body)
        self.assertIn("The targeted card type remains private.", hitman_body)
        self.assertNotIn("event.payload.targetCard", hitman_body)

    def test_hitman_modal_sends_the_selected_opposing_country(self):
        source = (Path(__file__).resolve().parents[1] / "script.js").read_text()
        hitman_start = source.index("window.openHitmanModal = function")
        atomic_start = source.index("window.openAtomicModal", hitman_start)
        hitman_body = source[hitman_start:atomic_start]

        self.assertIn('document.getElementById("select-hitman-target-country")', hitman_body)
        self.assertIn("liveCountryNames(true)", hitman_body)
        self.assertIn('submitRoomEvent("HITMAN_STRIKE", { targetCountry, targetCard })', hitman_body)

    def test_atomic_result_notifications_omit_remaining_investment(self):
        source = (Path(__file__).resolve().parents[1] / "script.js").read_text()
        atomic_result_start = source.index('} else if (event.type === "ATOMIC_STRIKE")')
        next_event_start = source.index('} else if (event.type === "PROPOSE_TRADE")', atomic_result_start)
        atomic_body = source[atomic_result_start:next_event_start]

        self.assertIn("investments destroyed:", atomic_body)
        self.assertNotIn("Remaining investment:", atomic_body)
        self.assertNotIn("remain invested", source)


if __name__ == "__main__":
    unittest.main()