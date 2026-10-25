// A monster's printed weaknesses and odd defenses, said on its damage-card row for whoever applies the blow.
//
// The user's ruling (2026-10-23): "takes +1d4 damage from bronze", "half damage from smashing weapons",
// "harmed only by black iron" and the like are NOT applied by the card. Only the table knows what the blow was
// struck with, so the card reminds the GM, right above Apply, and the GM adjusts or ignores the row. The one
// exception that IS arithmetic, a lower armor against one thing, is the row's "Not bronze" box
// (data/monster-armor.js, combat/attack-flow.js#wireConditionalArmor).
//
// GM only: a stat block's qualities are the GM's notes, and Apply on a monster is the GM's press anyway.

import { monsterDamageNotes } from "../../data/monster-armor.js";
import { format } from "../../utils/i18n.js";

/**
 * Append the reminder line for one pending row to the card's actions, when its target is a monster that prints
 * any. Returns whether a line was drawn.
 *
 * @param {HTMLElement} actions  the card's `.stonetop-attack-actions`
 * @param {{row: {name?: string}, target: Actor|null, several?: boolean, isGM?: boolean}} p
 */
export function appendMonsterDamageNotes(actions, { row, target, several = false, isGM = !!globalThis.game?.user?.isGM } = {}) {
	if (!isGM || !actions || target?.type !== "monster") return false;
	const notes = monsterDamageNotes(target.system);
	if (!notes.length) return false;
	const line = document.createElement("p");
	line.className = "stonetop-damage-foe-notes";
	const text = notes.join("; ");
	line.textContent = several
		? format("stonetop.fight.foeNotes.rowFor", { name: row?.name || target.name || "", notes: text })
		: format("stonetop.fight.foeNotes.row", { notes: text });
	actions.append(line);
	return true;
}
