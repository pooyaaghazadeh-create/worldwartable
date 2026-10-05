---
name: Act action independence
description: Act action availability after an individual commander completes Prepare.
---

After the global event is drawn and a commander locks their own investments, that commander may choose a Field Trade or Field Battle without waiting for other commanders to finish Prepare. Completing, proposing, accepting, rejecting, or skipping a trade must never unlock or block a Field Battle. Marking ready still closes that commander's Act actions.

**Why:** The user requested that one commander’s Act actions not wait on every other commander’s Prepare, while keeping Field Trade and Field Battle independent.

**How to apply:** Gate both actions on the acting commander's own locked investments, the global event being drawn, and that commander not being marked ready. Retain per-player limits and legitimate requirements, such as a battle allowance, valid locked targets, and Banker repayment, but never use another commander's Prepare state or trade state as an action prerequisite.