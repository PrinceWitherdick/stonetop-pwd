// The Would-Be Hero's Destined background (Book I p.137):
//
//   "At the start of a session, roll +Omens: on a 7+, lose all Omens and the GM will describe a vision or
//   portent that points toward your fate and/or clarifies your current situation; also, on a 10+, ask the GM a
//   follow-up question and get a clear, helpful answer; on a 6-, don't mark XP, hold +1 Omen, and tell us of
//   your recent nightmares or a troubling vision, and how your fears play into them.
//   Until your destiny is fulfilled, treat a 6- on Death's Door as a 7-9, and a 7-9 as a 10+."
//
// Both halves live on the background's setup tracks (`setup.resources`, background-tracks.js): the Omens a
// 3-circle track (the book prints three), and the destiny a 1-circle "Destiny fulfilled" box the player
// ticks when the story says so. A change of background empties both (StonetopCharacter#settleBackgroundResources),
// so a hero who comes back to Destined starts with no Omens and a destiny still ahead of them.
//
// The roll itself is a background move, Omens of Fate, given the way the Sheriff is given Bark an Order
// (`requirement.background`): its Omens held stand in for the stat (move-roll-options.js), and what its tier
// does to the track is settled like any other tier effect (tier-effects.js), so a Shift or a +1 moves it too.

import { resolvedFlagProperty } from "./StonetopFlags.js";
import { writeSetupResource } from "./background-tracks.js";
import { actorTookBackground } from "./took-background.js";
import { WBH_PLAYBOOK_NAME } from "./WouldBeHeroAsterisk.js";
import { clampInt } from "../../utils/custom-move-data.js";

export const DESTINED_BACKGROUND    = "destined";
export const OMENS_OF_FATE          = "Omens of Fate";
export const OMENS_KEY              = "omens";
export const OMENS_MAX              = 3;
export const DESTINY_FULFILLED_KEY  = "destiny-fulfilled";
/** What Death's Door's card names as the reason its tier moved. */
export const DESTINED_LABEL         = "Destined";

const count = (value, max = OMENS_MAX) => clampInt(value, 0, max);

/** The Would-Be Hero's Destined background, as took-background.js asks it. */
const DESTINED = { playbook: WBH_PLAYBOOK_NAME, slug: DESTINED_BACKGROUND };

/** Whether this character took the Destined background. */
export function isDestined(actor) {
	return actorTookBackground(actor, DESTINED);
}

/** The Omens this character holds, 0 to 3. */
export function omensHeld(actor) {
	return count(resolvedFlagProperty(actor, "background.setupResources")?.[OMENS_KEY]);
}

/**
 * Whether Death's Door is bent for this character: Destined, with the "Destiny fulfilled" box unticked. PURE,
 * over the background as StonetopCharacter keeps it (`{ backgroundSlug, setupResources }`), so deaths-door.js
 * can ask it without a document.
 */
export function destinyUnfulfilled({ backgroundSlug = "", setupResources = {} } = {}) {
	return backgroundSlug === DESTINED_BACKGROUND && !(Number(setupResources?.[DESTINY_FULFILLED_KEY]) > 0);
}

/**
 * What Omens of Fate adds to its own roll (move-roll-options.js): "roll +Omens", so the Omens held are the
 * number added, and "on a 6-, don't mark XP". Null for a character who is not Destined: the move is theirs
 * only through the background, and a copy left behind rolls nothing it could explain.
 */
export function omensRollOptions(actor) {
	if (!isDestined(actor)) return null;
	return { statValue: omensHeld(actor), noXpOnMiss: true };
}

/**
 * Roll a hero's Omens of Fate from outside their sheet (the start-of-session reminder's button): the
 * same ladder a click on the move's title walks (StonetopCharacterSheet#rollMoveByName). A Destined hero
 * from before the move shipped is given it first, the way their background would have
 * (StonetopCharacter#ensureStartingMoves). Whether a roll was asked for.
 */
export async function rollOmensOfFate(actor) {
	if (!actor?.isOwner || !isDestined(actor)) return false;
	const held = () => actor.items?.some?.(i => i.type === "move" && i.name === OMENS_OF_FATE);
	if (!held()) await actor.typedActor?.ensureStartingMoves?.();
	if (!held() || !actor.sheet?.rollMoveByName) return false;
	// The sheet answers `false` when the player backed out of the roll's own windows.
	return (await actor.sheet.rollMoveByName(OMENS_OF_FATE)) !== false;
}

/** The Omens a tier asks for, from those held before the roll: a 7+ loses all, a 6- holds +1 (to 3). PURE. */
export function omensForTier(tier, prior, max = OMENS_MAX) {
	return tier === "failure" ? Math.min(max, count(prior, max) + 1) : 0;
}

/**
 * Bring the Omens to what `tier` asks of an Omens of Fate roll (tier-effects.js). `done` is this card's
 * record so far, `{prior, set}`: the Omens held before the dice and what its tier last asked for; null at
 * the roll itself. Only the DIFFERENCE between what the old tier and the new one ask is applied, so an Omen
 * ticked or spent by hand since the roll is left alone. Undefined (nothing to record) for a character who
 * is not Destined.
 */
export async function settleOmensTier(actor, tier, done = null, character = actor?.typedActor) {
	if (!isDestined(actor)) return undefined;
	const current = omensHeld(actor);
	const prior   = done ? count(done.prior) : current;
	const was     = done ? count(done.set) : current;
	const set     = omensForTier(tier, prior);
	const next    = count(current + (set - was));
	if (next !== current) await writeSetupResource(actor, OMENS_KEY, next, character);
	return { prior, set };
}
