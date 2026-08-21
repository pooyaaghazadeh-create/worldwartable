---
name: Reversible trade settlements
description: Rules for undoing accepted trades when modifiers affect the amounts each side received.
---

Accepted trades that may be reversed must retain the actual receipt amount delivered to each participant and the round in which they settled.

**Why:** Merchant bonuses and global conditions can alter a receipt. Recalculating from later game state would fail to restore the original balances exactly.

**How to apply:** When adding a reversible settlement effect, persist its realized amounts at settlement time. Reverse only within the originating round, only once, and only when each recipient still has the required returned asset.