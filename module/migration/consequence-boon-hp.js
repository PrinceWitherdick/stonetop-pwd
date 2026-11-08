// A marked arcana Consequence's max HP and armor, typed by hand before the sheet counted them.
//
// The sheet now adds what a marked Consequence gives for good to max HP on its own
// (actors/character/CharacterArcana.js#consequenceBoonsFrom): the Redwood Effigy's "Gain +1 armor and
// +4 max HP" (Book II p.571), the Creepy Cave's "increase your max HP by 2" (p.528). Before that, the
// only way to have it was the hand-set max HP (`hp.adjustment`, the signed delta StonetopCharacter#setMaxHp
// keeps), so a character who had marked one and typed it in would now get it twice.
//
// The same for armor: the Consequences' +1 armor (the Redwood Effigy, the Hec'tumel Codex, the Lidless Orb, the Creepy
// Cave) is counted too, and the hand-set armor (`armor.adjustment`, a delta the same way) may hold it.
//
// Only an adjustment that IS the boon, to the point, is taken back out: that one can only have been typed for it.
// One bigger than the boon may hold it plus something else (a GM's ruling, another arcanum's "+4 max HP"), or
// something else entirely, so it is left as it is and the GM is asked to check it (flag, never guess). ONCE PER
// WORLD (the creation-finished-grandfather.js pattern): a later version's run would reach an adjustment typed under
// the new code. Each character written to is stamped as settled in the same write, so nothing reaches it twice.

import { STONETOP_SCOPE, resolvedFlagProperty } from "../actors/character/StonetopFlags.js";
import { sweepVersion } from "./once-per-version.js";
import { escHtml } from "../utils/strings.js";

export const CONSEQUENCE_BOON_HP_SWEEP = "consequenceBoonHp";

/** Actor flag: this character's hand-set max HP and armor have been settled against its Consequence boons. */
export const CONSEQUENCE_BOON_HP_FLAG = "consequenceBoonHpSettled";

/**
 * The adjustment once a boon of `boon` already in it is taken out, or null when it is left as it is: no boon, or an
 * adjustment that is not the boon itself (smaller cannot hold it, bigger may hold something else; see
 * mayHoldBoon). PURE.
 */
export function settledAdjustment(adjustment, boon) {
	const adj = Math.trunc(Number(adjustment) || 0);
	const gift = Math.trunc(Number(boon) || 0);
	if (gift <= 0 || adj !== gift) return null;
	return 0;
}

/** Whether an adjustment bigger than the boon may hold it among something else: the GM's to check. PURE. */
export function mayHoldBoon(adjustment, boon) {
	const adj = Math.trunc(Number(adjustment) || 0);
	const gift = Math.trunc(Number(boon) || 0);
	return gift > 0 && adj > gift;
}

/** What each sheet field the sweep reads is called in the GM's whisper, and where its adjustment lives. */
const FIELDS = [
	{ key: "hp", path: "system.attributes.hp.adjustment", read: a => a.system?.attributes?.hp?.adjustment, words: "max HP" },
	{ key: "armor", path: "system.attributes.armor.adjustment", read: a => a.system?.attributes?.armor?.adjustment, words: "armor" },
];

/**
 * Take a marked Consequence's max HP and armor back out of every hand-set adjustment that is exactly it, and name
 * to the GM each one bigger that may still hold it (see above). Does nothing in a world that has run it before,
 * under any version.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @param {Function} [options.notify]  how the GM is told (tests); a GM whisper otherwise
 * @returns {Promise<number>} how many characters were written to
 */
export async function settleConsequenceBoonHp({ actors = globalThis.game?.actors ?? [], notify = null } = {}) {
	if (sweepVersion(CONSEQUENCE_BOON_HP_SWEEP)) return 0;
	const settled = [];
	const toCheck = [];
	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		if (resolvedFlagProperty(actor, CONSEQUENCE_BOON_HP_FLAG)) continue;
		const boons = await actor.typedActor?.arcanaConsequenceBoons?.();
		if (!boons) continue;
		const update = {};
		const took = [];
		for (const field of FIELDS) {
			const before = field.read(actor);
			const boon = Math.trunc(Number(boons[field.key]) || 0);
			const after = settledAdjustment(before, boon);
			if (after !== null) {
				update[field.path] = after;
				took.push(`${boon} ${field.words}`);
			} else if (mayHoldBoon(before, boon)) {
				toCheck.push({ name: actor.name ?? "", words: field.words, typed: Math.trunc(Number(before) || 0), boon });
			}
		}
		if (!took.length) continue;
		// Quiet in the ledger: max HP and armor are what they were, now counted once.
		await actor.update({ ...update, [`flags.${STONETOP_SCOPE}.${CONSEQUENCE_BOON_HP_FLAG}`]: true }, { stonetopLedger: true });
		settled.push({ name: actor.name ?? "", took: took.join(", ") });
	}
	if (settled.length || toCheck.length) {
		const parts = [];
		if (settled.length) {
			const line = s => `<li>${escHtml(s.name)}: ${escHtml(s.took)}</li>`;
			parts.push("<p>A marked arcana Consequence's max HP and armor are counted by the sheet now, so they were taken "
				+ `back out of what was typed by hand for:</p><ul>${settled.map(line).join("")}</ul>`);
		}
		if (toCheck.length) {
			const line = c => `<li>${escHtml(c.name)}: ${escHtml(c.words)} typed as +${c.typed}, the Consequence gives +${c.boon}</li>`;
			parts.push("<p>These were typed by hand as more than a marked Consequence gives, so they were left alone. "
				+ "If the Consequence is part of it, it is now counted twice: take it out by hand.</p>"
				+ `<ul>${toCheck.map(line).join("")}</ul>`);
		}
		const html = parts.join("");
		if (notify) await notify(html);
		else await (await import("../utils/chat.js")).whisperGm(html);
	}
	return settled.length;
}
