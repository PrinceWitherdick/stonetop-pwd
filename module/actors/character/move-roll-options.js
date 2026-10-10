// What a move adds to its OWN roll card, by name: buttons under a tier, an override of the miss XP, and the
// number rolled for a move that rolls something other than a stat (the Destined's +Omens).
// The generic roll (item/StonetopItem.js#roll) asks this once rather than naming moves itself, the way
// MOVE_USE_EFFECTS and TIER_EFFECTS keep their moves out of the code that runs them.
//
// Each tier's actions are APPENDED after whatever the roll already carries (a Soul on Fire hit note,
// StonetopCharacter#_withHitNote), so no move's buttons silently replace another's.

import { isKnowThings, knowThingsRollOptions } from "./know-things.js";
import { BATTLE_JOY, battleJoyRollOptions } from "./battle-joy.js";
import { WIELDER_OF_THE_WHITE_FLAME } from "./holy-light.js";
import { wielderRollOptions } from "./invoke-consequences.js";
import { WE_HAPPY_FEW, speechRollOptions } from "./inspiration.js";
import { GIVE_ADVANTAGE_MOVES, giveAdvantageRollOptions } from "./give-advantage.js";
import { OMENS_OF_FATE, omensRollOptions } from "./destined.js";

const named = name => moveName => moveName === name;

/**
 * `matches(moveName)`, and `build(actor)` answering `{noXpOnMiss?, statValue?, tierActions?}` or null when this
 * character's roll gets nothing (a move they do not hold learned).
 */
export const MOVE_ROLL_OPTIONS = [
	// Never at a Loss defers a Know Things miss's XP to a choice on the card.
	{ matches: isKnowThings, build: knowThingsRollOptions },
	// Battle Joy's ending roll: "on a 6-, mark a debility but don't mark XP", with the 10+'s 1d4 HP and
	// the 6-'s debility as buttons (combat/battle-joy-offer.js), Auspicious Birth's circle among them when taken.
	{ matches: named(BATTLE_JOY), build: actor => battleJoyRollOptions(actor.typedActor?.debilityMarkChoices ?? []) },
	// "You may Invoke the Sun God right now as if you rolled a 10+" (invoke-consequences.js#wireWielderInvoke).
	{ matches: named(WIELDER_OF_THE_WHITE_FLAME), build: wielderRollOptions },
	// Every tier asks who heard the speech (inspiration-flow.js#wireSpeechCard).
	{ matches: named(WE_HAPPY_FEW), build: speechRollOptions },
	// The Destined's "roll +Omens": the Omens held are the number added, and a 6- marks no XP (destined.js).
	{ matches: named(OMENS_OF_FATE), build: omensRollOptions },
	// "You or an ally gain advantage" on the tiers that print it: Everything Burns' 10+, Work With What
	// You've Got's 7+ (give-advantage-flow.js#wireGiveAdvantage). And on another move's card where the
	// rule says so: Resourceful's hold on Defy Danger's 6-.
	...Object.entries(GIVE_ADVANTAGE_MOVES).filter(([, rule]) => rule.tiers?.length)
		.map(([name, rule]) => ({ matches: named(rule.on ?? name), build: giveAdvantageRollOptions(name) })),
];

/**
 * The options move `moveName` adds to a character's roll, folded over the `tierActions` the roll
 * already has; null when it adds none.
 *
 * @param {string} moveName
 * @param {Actor} actor
 * @param {Record<string, string>|null} [tierActions]
 * @returns {{noXpOnMiss?: boolean, tierActions: Record<string, string>}|null}
 */
export function moveRollOptions(moveName, actor, tierActions = null, table = MOVE_ROLL_OPTIONS) {
	if (actor?.type !== "character") return null;
	const found = table.filter(entry => entry.matches(moveName)).map(entry => entry.build(actor)).filter(Boolean);
	if (!found.length) return null;
	const out = { tierActions: { ...(tierActions ?? {}) } };
	for (const { tierActions: actions, ...rest } of found) {
		Object.assign(out, rest);
		for (const [tier, html] of Object.entries(actions ?? {})) out.tierActions[tier] = `${out.tierActions[tier] ?? ""}${html}`;
	}
	return out;
}
