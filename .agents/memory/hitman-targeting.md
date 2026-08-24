---
name: Hitman targeting
description: Player-directed targeting rules for the Hitman proficiency card.
---

The player using a Hitman selects both a seated opposing country and the card type to target: General or Spy. The target may not be the attacker.

**Why:** The intended rule is player-directed targeting, not random opponent selection.

**How to apply:** Validate the selected country server-side as an opposing seated player before consuming the Hitman. Broadcast the attacker, target, and success/failure publicly, but do not disclose the disabled card type; keep that detail private to the attacker.