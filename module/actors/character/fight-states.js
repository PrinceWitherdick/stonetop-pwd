/**
 * Three on/off states a character carries through a fight, each drawn as a header glyph beside the
 * Heavy's Battle Joy and on the same terms (actors/character/battle-joy.js): one flag, flipped, with
 * a read-only face for a viewer who cannot write.
 *
 *  - NERVES, the Marshal's We Happy Few 6-: "each ally holds 1, but you have disadvantage on all rolls
 *    until you share your nerves with someone". Switched on by the 6- itself (a stated consequence is
 *    not an offer), and off by a click once they have. Enforced: every roll the character makes
 *    (StonetopCharacter#applyDebilityRollMode, and their damage through `ownDamageMode` in
 *    fight/hero-moves.js), named on the card.
 *  - ROILING, the Storm Markings arcanum: "When you roil with anger, you do +1 damage until you calm
 *    down." Switched by the player either way; while on, the damage window offers the +1, ticked.
 *  - UNSEEN, the Fox's Catlike and the Ranger's Stalker: "you remain unseen until you draw attention
 *    to yourself, move positions, or attack". Switched on by the player; the ATTACK ends it on its own
 *    (`revealOnAttack`), and the other two are theirs to click.
 *
 * Each passes the bar a header glyph has to clear: it outlives the roll that made it, only its owner
 * ends it, and nothing else on the sheet holds it. Shown to a character who has the move (or card),
 * and to anyone the state is still ON for, so a state stranded by a playbook swap can be put out.
 *
 * Kept free of Foundry globals apart from the one chat note, so the predicates test with plain objects.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { ownsMoveNamed, ownsLearnedMoveNamed } from "./owns-move.js";
import { StonetopFlags } from "./StonetopFlags.js";
import { postMoveNote } from "../../utils/chat.js";
import { format } from "../../utils/i18n.js";

export const WE_HAPPY_FEW   = "We Happy Few";
export const STORM_MARKINGS = "storm-markings";
export const STORM_MARKINGS_NAME = "Storm Markings";
export const UNSEEN_MOVES   = ["Catlike", "Stalker"];

/** The arcana this character holds, by slug (CharacterArcana#ownedSlugs, read without the class). */
function arcanaOwned(actor) {
	if (!actor?.getFlag) return [];
	const owned = new StonetopFlags(actor, "arcana").getFlag("owned");
	return Array.isArray(owned) ? owned : [];
}

function hasStormMarkings(actor) {
	return arcanaOwned(actor).includes(STORM_MARKINGS);
}

/**
 * The three states, keyed as the sheet and the language file key them.
 *
 *   flag     where the state lives on the actor
 *   stem     the glyph's base class; its icon is `<stem>-icon`
 *   onClass  the modifier worn while it is on
 *   owns     whether this character has what makes the state (the glyph's `show`, with `on`)
 *   applies  whether it still does anything: a RULE asks this, so an un-learned move stops biting
 */
export const FIGHT_STATES = {
	nerves: {
		flag: "shakenNerves", stem: "stonetop-nerves", onClass: "is-shaken",
		owns:    actor => ownsMoveNamed(actor, WE_HAPPY_FEW),
		applies: () => true,
	},
	roiling: {
		flag: "roiling", stem: "stonetop-roiling", onClass: "is-roiling",
		owns:    hasStormMarkings,
		applies: hasStormMarkings,
	},
	unseen: {
		flag: "unseen", stem: "stonetop-unseen", onClass: "is-unseen",
		owns:    actor => UNSEEN_MOVES.some(name => ownsMoveNamed(actor, name)),
		applies: () => true,
	},
};

/** The key a glyph's stem class belongs to, for the sheet's one click handler. */
export function fightStateForStem(stem) {
	return Object.keys(FIGHT_STATES).find(key => FIGHT_STATES[key].stem === stem) ?? null;
}

/** Is this state on for this character? */
export function fightStateOn(actor, key) {
	const def = FIGHT_STATES[key];
	return !!def && actor?.getFlag?.(SYSTEM_ID, def.flag) === true;
}

/** Is it on AND still doing something? What the roll path and the damage window ask. */
export function fightStateActive(actor, key) {
	return actor?.type === "character" && fightStateOn(actor, key) && FIGHT_STATES[key].applies(actor);
}

/** Switch it. Returns true only when the flag actually changed, so a caller can skip a re-render. */
export async function setFightState(actor, key, on) {
	const def = FIGHT_STATES[key];
	if (!def || !actor) return false;
	const next = !!on;
	if (next === fightStateOn(actor, key)) return false;
	if (next) await actor.setFlag(SYSTEM_ID, def.flag, true);
	else      await actor.unsetFlag(SYSTEM_ID, def.flag);
	return true;
}

/**
 * What the header draws for one state: whether it shows, whether it is on, and which of its six
 * sentences apply (on or off, crossed with writable or read-only). The sentences live under
 * `stonetop.<key>` in the language file.
 */
export function fightStateGlyph(actor, key, { editable = false } = {}) {
	const def = FIGHT_STATES[key];
	const on = fightStateOn(actor, key);
	const state = on ? "On" : "Off";
	return {
		show: !!def.owns(actor) || on,
		on,
		stem: def.stem,
		onClass: def.onClass,
		labelKey: `stonetop.${key}.${on ? "onLabel" : "offLabel"}`,
		tooltipKey: `stonetop.${key}.${editable ? `${on ? "on" : "off"}Tooltip` : `readOnly${state}`}`,
	};
}

/** Every state's glyph, in the order the header draws them. */
export function fightStateGlyphs(actor, { editable = false } = {}) {
	return Object.fromEntries(Object.keys(FIGHT_STATES).map(key => [key, fightStateGlyph(actor, key, { editable })]));
}

/** Post a one-line note about a state, in the move-card shape the other fight notes use. */
function postNote(actor, title, key, data = {}) {
	return postMoveNote(actor, title, format(key, { name: actor.name, ...data }));
}

/**
 * We Happy Few rolled a 6-: "you have disadvantage on all rolls until you share your nerves with
 * someone". Stated flatly, so it is simply switched on, and the chat says so.
 *
 * @returns {Promise<boolean>} whether it was switched on just now
 */
export async function shakeNervesOnMiss(actor, item, tier) {
	if (item?.name !== WE_HAPPY_FEW || tier !== "failure") return false;
	if (!ownsLearnedMoveNamed(actor, WE_HAPPY_FEW)) return false;
	if (!(await setFightState(actor, "nerves", true))) return false;
	await postNote(actor, WE_HAPPY_FEW, "stonetop.nerves.shaken");
	return true;
}

/**
 * The character attacks: an unseen Fox or Ranger is seen. "You remain unseen until you draw attention
 * to yourself, move positions, or attack." Called where an attack is made (an attack move's roll, and
 * a damage roll of their own), and says so when it ends something.
 *
 * @param {Actor} actor
 * @param {string} moveName  what they attacked with
 * @returns {Promise<boolean>} whether they were unseen until now
 */
export async function revealOnAttack(actor, moveName) {
	if (actor?.type !== "character" || !fightStateOn(actor, "unseen")) return false;
	if (actor.isOwner === false) return false;
	if (!(await setFightState(actor, "unseen", false))) return false;
	await postNote(actor, format("stonetop.unseen.revealedTitle"), "stonetop.unseen.revealed", { move: moveName });
	return true;
}
