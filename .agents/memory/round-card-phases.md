---
name: Round card phases
description: Prepare and Act phase constraints for Hitman and General proficiency cards.
---

Prepare ends only after each commander has locked investments and the Global Condition has been drawn. A player holding Hitman must use it before they can lock investments. General may be activated only during Act, after table-wide Prepare completion and before its owner marks ready.

**Why:** These card timings create a meaningful preparation phase and let Hitman disable General before Act begins.

**How to apply:** Enforce phase timing server-side as well as in the interface. Never consume either card for an invalid phase attempt.