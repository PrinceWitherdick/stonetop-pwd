// WHAT A DEFENDER'S ARCANA DO TO A BLOW THAT LANDS ON THEM (audit EDG-15, 2026-11-06).
//
// Two kinds, each where the damage pipeline already asks such things (combat/attack-flow.js):
//
//  1. THE DAMAGE WINDOW'S LINES, beside the defenders' own moves (attack-flow.js#defenderLines). Both turn on
//     what the blow is made of, which is fiction the sheet cannot see, so each opens UNTICKED for the table to
//     tick when it is fire (the call: "a line where it depends on fiction"):
//       Noruba's Ice Sphere, a Consequence (Book II pp.546-547): "When you take damage from fire, roll twice and
//         take the higher result." A line of advantage on the damage roll.
//       The Redwood Effigy, a Consequence (pp.570-571): "When you suffer damage from heat or fire, you take
//         +1d6 damage." A +1d6 line.
//     Only for a blow at ONE character: the window's dice ride every row of the card, and another target's
//     consequence is not theirs.
//
//  2. THE ARMOR APPLY TAKES OFF: the Demonhide Cloak (pp.544-545), "When you wear the Cloak, its armor applies
//     against demons in all cases, even if their attacks are piercing or ignore armor." The sheet can check it
//     where the striker's stat block calls it a demon (its name, concept, tags or qualities), so it is imposed
//     there: the Cloak's armor becomes a floor piercing and "ignores armor" cannot take (utils/damage.js
//     #mitigateDamage's `unpierceable`). A striker nothing names a demon gets nothing from this.
//
// The cards, their boxes and their lines are data/arcana-rules.js#ARCANA_DEFENCES, each box named by its printed label.

import { format } from "../../utils/i18n.js";
import { resolveSync } from "../../utils/foundry-compat.js";
import { stripHtmlToText } from "../../utils/strings.js";
import { damageRowActor } from "../../utils/damage.js";
import { arcanaOf } from "./arcana-blow-offers.js";
import { holdsArcanum, markedWorn } from "./deaths-door-arcana.js";
import { ARCANA_DEFENCES, ruleMarked } from "../../data/arcana-rules.js";

const KEY = "stonetop.fight.arcanaDefence";


/** Whether a card's back □ is marked: a Consequence stays the bearer's once marked, held or not. */
const marked = (state, rule) => !!state.owned.has?.(rule.slug) && ruleMarked(state.boxes, rule);

/**
 * The damage window's lines for the arcana of the ONE character a blow is aimed at (see the header). Empty for a
 * blow at anyone else, or at several.
 *
 * @param {Array<{uuid: string}>} targets  the card's rows
 * @param {{resolve?: (uuid: string) => object|null}} [deps]
 */
export function arcanaDefenderLines(targets = [], { resolve = resolveSync } = {}) {
	if (!Array.isArray(targets) || targets.length !== 1) return [];
	const actor = damageRowActor(targets[0]?.uuid ? resolve(targets[0].uuid) : null);
	if (actor?.type !== "character") return [];
	const state = arcanaOf(actor);
	const out = [];
	for (const rule of Object.values(ARCANA_DEFENCES)) {
		if (!rule.line || !marked(state, rule)) continue;
		const { key, i18n, mode, dice } = rule.line;
		const words = dice ? { dice } : {};
		out.push({
			key, applied: false, ...(mode ? { mode } : {}), ...(dice ? { dice, tags: [] } : {}),
			label: format(`${KEY}.${i18n}.label`, { name: actor.name ?? "", ...words }),
			pill: format(`${KEY}.${i18n}.pill`, words),
		});
	}
	return out;
}

/** The actor a striker's document stands for (a token's own, for an unlinked monster). */
const actorOf = doc => damageRowActor(doc) ?? doc ?? null;

/** Whether the striker's stat block calls it a demon: its name, concept, creature type, tags or qualities. PURE. */
export function readsAsDemon(striker) {
	const actor = actorOf(striker);
	if (!actor) return false;
	const sys = actor.system ?? {};
	const words = [actor.name, sys.concept, sys.creatureType, sys.tags, stripHtmlToText(String(sys.qualities ?? ""))]
		.map(v => String(v ?? "")).join(" ");
	return /\bdemon(?:s|ic)?\b/i.test(words);
}

/**
 * The armor a defender's Demonhide Cloak holds against this striker whatever the blow's piercing or "ignores
 * armor": the Cloak's 1 when it is held (owned and recovered, not a lead) and worn and the striker reads as a
 * demon, else 0.
 *
 * @param {Actor} defender  the row's actor
 * @param {object|null} striker  who struck (an Actor or a token document), as Apply resolves it
 */
export function demonhideFloor(defender, striker) {
	if (defender?.type !== "character" || !readsAsDemon(striker)) return 0;
	const { slug, armor } = ARCANA_DEFENCES.demonhide;
	return markedWorn(defender.typedActor, slug) && holdsArcanum(defender.typedActor, slug) ? armor : 0;
}
