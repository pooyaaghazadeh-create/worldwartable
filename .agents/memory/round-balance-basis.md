---
name: Round balance basis
description: The confirmed treatment of locked investment capital during round settlement.
---

At round closure, calculate the ending wallet from unallocated cash plus the rounded field payouts, then subtract any loan collection. Do not add locked field capital to the ending wallet a second time.

**Why:** A locked field allocation is the capital consumed to generate its resource payout. Counting the full wallet and then adding income doubles a fully locked investment.

**How to apply:** Use the server’s locked-resource total to determine the pre-settlement unallocated balance. Keep the client receipt and any fallback calculation aligned with this same basis.