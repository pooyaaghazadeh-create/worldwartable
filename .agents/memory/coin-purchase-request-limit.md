---
name: Coin purchase request limit
description: The standing limit for player coin-purchase requests during one game.
---

Players may submit at most five coin-purchase requests in a game. The allowance counts every submitted request, whether it is pending, approved, or rejected, and resets when a new game is started.

**Why:** This caps repeated requests independently of the 500-coin wallet ceiling and makes the Banker request flow predictable.

**How to apply:** Enforce the limit on the server and keep the Commander Status counter synchronized with the authoritative request count; client-side disabled controls are explanatory only.