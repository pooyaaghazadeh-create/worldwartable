---
name: Starting player funds
description: Initial coin grants, reconnect balance preservation, and the retired purchase flow.
---

Newly joined players start with 500 coins in their new wallet. Reconnecting must preserve the current wallet balance; do not reset or top up existing balances. Coin purchases and host approvals are not part of the game.

Retain existing coin-request records when removing the purchase flow; do not run a destructive migration just to remove the feature.

**Why:** The user requested 500 starting coins and said coin buying is unnecessary; existing request records may be historical.

**How to apply:** Grant coins only when a new wallet is created in either edition, keep reconnect logic from changing balances, and reject purchase or approval events.
