---
name: Round action caps
description: Per-round policy for Field Trade attempts and solo Field Battle allowances.
---

Each commander may submit at most two Field Trade proposals per round. A submitted proposal consumes an allowance regardless of whether it is accepted, rejected, canceled, or later expires. A solo commander has one Field Battle per round; activating General raises only that commander’s solo allowance to two. Alliance skirmishes retain their independent one-per-alliance limit.

**Why:** Attempt limits must prevent repeated speculative offers, not merely count completed trades, while General should improve personal solo combat without changing alliance limits.

**How to apply:** Enforce these limits from persisted round data on the server. Treat client indicators only as feedback, and restore their displayed battle allowance from the authenticated session after a refresh.