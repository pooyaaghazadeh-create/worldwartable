---
name: Round card phases
description: Prepare and Act phase constraints for Hitman and General proficiency cards.
---

The Global Condition is drawn immediately after proficiency cards are dealt, without waiting for investments. A player holding Hitman must use it before they can lock their own investments. All seated commanders must lock investments before any Act action is available; General may then be activated before its owner marks ready.

**Why:** The user clarified that every commander must complete Prepare before Act actions are enabled; this supersedes the earlier local-only gate.

**How to apply:** Draw the Global Condition as part of the automatic card-deal sequence, never as a side effect of locking investments. Keep the Act tab navigable during Prepare so players can inspect the strategic map. Enable Act actions only after every seated player has locked investments and the event is drawn; enforce the same rule server-side for each Act action, including General. Never consume a card for an invalid phase attempt.