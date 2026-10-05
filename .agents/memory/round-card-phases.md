---
name: Round card phases
description: Prepare and Act phase constraints for Hitman and General proficiency cards.
---

The Global Condition is drawn immediately after proficiency cards are dealt, without waiting for investments. A player holding Hitman must use it before they can lock their own investments. General may be activated during Act after its owner locks their own investments and before they mark ready; other commanders do not need to finish Prepare first.

**Why:** The user requested that Act actions not wait for the whole table to finish Prepare; card timing should follow the acting player's own phase.

**How to apply:** Draw the Global Condition as part of the automatic card-deal sequence, never as a side effect of locking investments. Keep the Act tab navigable during Prepare so players can inspect the strategic map. Enable that player's Act actions after their own investments are locked and the event is drawn; enforce General timing server-side as well as in the interface. Never consume either card for an invalid phase attempt.