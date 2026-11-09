// THE DAMAGE AN ARCANUM'S MOVE DEALS, as a button on its roll card (audit EDG-4, 2026-11-06).
//
// An arcanum's mysteries and moves are rolled from the guided window (StonetopCharacterSheet#_arcanumMoveGuide),
// with the card's own words as the roll card's ladder. Where those words deal damage, the damage was prose only:
// the Red Scepter's Burning Hatred, "on a 10+, the Scepter deals 2d4 damage (messy, ignores armor)" (Book II
// pp.558-559), the Hungering Maw's Siphon, "on a 10+, deal 1d10 damage (grabby, ignores armor); on a 7-9, deal
// 1d10 damage (ignores armor) but choose one" (pp.572-573). The GM rolled it off the card and typed the HP in,
// so armor, piercing and the record were lost.
//
// So the move's prose is read into its tiers (utils/move-tiers.js#parseTiersFromProse, the same reading that
// draws the ladder) and each hit tier that deals damage gets the damage button the post-death +Favor rolls
// already use (post-death-actions.js: `stonetop-pd-move-damage`, latched once per card, rolled through
// combat/attack-flow.js#rollOptionDamage at the roller's targets with the printed tags). A 7-9 that is "as a
// 10+" owes the 10+'s damage. HP the move costs its roller ("lose 1d10 HP") is a cost, not the move's damage,
// and gets no button here. Damage the roller takes ("you take 2d4 damage") is aimed at the roller.

import { parseTiersFromProse } from "../../utils/move-tiers.js";
import { readOptionDamage } from "../../utils/damage.js";
import { OWN_HARM_RE } from "../../utils/damage-die.js";
import { stripHtmlToText } from "../../utils/strings.js";
import { format } from "../../utils/i18n.js";
import { cardButton } from "./post-death-card-button.js";

/** The hit tiers a damage button can ride (a 6- is the GM's to say). */
const HIT_TIERS = ["success", "partial"];

/**
 * The damage each hit tier of a move deals, read off its prose: `{success?, partial?}` in readOptionDamage's
 * shape plus `self` (the roller's own harm). PURE.
 *
 * @param {string} description  the move's HTML, as its card prints it
 */
export function arcanumMoveDamage(description) {
	const tiers = parseTiersFromProse(description);
	if (!tiers) return {};
	const text = Object.fromEntries(HIT_TIERS.map(tier => [tier, stripHtmlToText(tiers[tier]?.value ?? "")]));
	const out = {};
	for (const tier of HIT_TIERS) {
		const own = text[tier] ? readOptionDamage(text[tier]) : null;
		const asTen = !own && /^as (?:a )?10\+/i.test(text[tier]) ? readOptionDamage(text.success) : null;
		const dealt = own ?? asTen;
		if (!dealt || dealt.hpLoss) continue;
		const words = own ? text[tier] : text.success;
		// "you take 2d4 damage", "you suffer 2d6+4 messy damage yourself": the roller's own harm.
		out[tier] = { ...dealt, self: OWN_HARM_RE.test(words) };
	}
	return out;
}

/**
 * The tier buttons for those damages, as rollStat's `tierActions`, or null when the move deals none. Each button
 * is the post-death card's own move-damage button, so it is wired and latched there (post-death-actions.js
 * #wirePostDeathMoveCards).
 *
 * @param {string} description  the move's HTML
 * @param {string} moveName  the card's move, which the damage card is titled with
 */
export function arcanumMoveDamageActions(description, moveName) {
	const dealt = arcanumMoveDamage(description);
	const actions = {};
	for (const [tier, d] of Object.entries(dealt)) {
		actions[tier] = cardButton("stonetop-pd-move-damage", {
			key: "move-damage",
			label: format("stonetop.postDeathMoves.moveDamage", { formula: d.formula }),
			icon: "fa-dice-d6",
			data: {
				move: moveName, formula: d.formula, ignores: d.ignoresArmor ? 1 : 0, piercing: d.piercing,
				tags: d.tags.join(","), ...(d.self ? { self: 1 } : {}),
			},
		});
	}
	return Object.keys(actions).length ? actions : null;
}
