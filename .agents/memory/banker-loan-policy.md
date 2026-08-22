---
name: Banker loan policy
description: The agreed formula for Banker card lending and repayment.
---

Banker cards automatically lend an integer whole-coin amount equal to 20% of the player's currently unallocated cash; players do not choose the amount. Settlement requires the principal plus 20% interest.

**Why:** This keeps lending proportional to usable funds and prevents coins committed to locked field investments from being treated as available cash.

**How to apply:** Keep the server authoritative for the 20% calculation, use the same unallocated-cash concept in client previews, and keep all rulebook languages consistent with this formula.