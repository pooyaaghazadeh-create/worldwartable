---
name: Round card phases
description: Prepare and Act phase constraints for Hitman and General proficiency cards.
---

The Global Condition is drawn immediately after proficiency cards are dealt, without waiting for investments. Prepare still ends only after each commander has locked investments. A player holding Hitman must use it before they can lock investments. General may be activated only during Act, after table-wide Prepare completion and before its owner marks ready.

**Why:** Revealing the condition at the start of the round lets commanders plan around it, while investment locking and readiness still control the transition to Act.

**How to apply:** Draw the Global Condition as part of the automatic card-deal sequence, never as a side effect of locking investments. Keep the Act tab navigable during Prepare so players can inspect the strategic map, but disable its trade, battle, and alliance-skirmish controls until Act opens. Enforce card timing server-side as well as in the interface. Never consume either card for an invalid phase attempt.