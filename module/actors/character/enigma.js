// The Lightbearer's Itinerant Mystic background (Book I, the Lightbearer's backgrounds):
//
//   "When you go off a-wandering, hold 1 Enigma if you're gone for days, 2 if you're gone for weeks, or 3 if
//   you're gone for months. At the very start of play, hold 3 Enigma. Spend Enigma 1-for-1 to: return from
//   your wandering exactly when and where you are needed, fully Outfitted; Know Things as if you rolled a
//   10+, drawing on what you learned while away; or Have What You Need to produce an oddly specific yet
//   mundane item of Value 1 or less."
//
// The Enigma held is the background's setup track (`setup.resources`, key "enigma"), the circles the Details
// tab draws and a hand click writes (CharacterBackgrounds#setSetupResource). Every spend and gain here goes
// through that same store, so the circles and the buttons can never disagree. The three spends are wired
// where their moves already are: the Know Things card's upgrade buttons (stonetop.js), the sheet's Have What
// You Need ask, and the Details tab's "Return when needed" beside the track, which opens the Outfit window.

import { resolvedFlagProperty } from "./StonetopFlags.js";
import { writeSetupResource } from "./background-tracks.js";
import { actorTookBackground } from "./took-background.js";
import { clampInt } from "../../utils/custom-move-data.js";
import { splitInventoryNote } from "../../utils/inventory-item-data.js";

export const ENIGMA_KEY   = "enigma";
/** The track's size, as the playbook data prints it (the-lightbearer.json, `max`). */
export const ENIGMA_MAX   = 9;
/** "At the very start of play, hold 3 Enigma": the track's `value`, which the Details tab shows until one is stored. */
export const ENIGMA_START = 3;
/** "Hold 1 Enigma if you're gone for days, 2 if you're gone for weeks, or 3 if you're gone for months." */
export const WANDERING_ENIGMA = Object.freeze({ days: 1, weeks: 2, months: 3 });
/** "An oddly specific yet mundane item of Value 1 or less." */
export const ENIGMA_ITEM_MAX_VALUE = 1;

/** The Lightbearer's Itinerant Mystic background, as took-background.js asks it. */
export const ITINERANT_MYSTIC = Object.freeze({ playbook: "The Lightbearer", slug: "itinerant-mystic" });

/** Whether this character took the Itinerant Mystic background. */
export function isItinerantMystic(actor) {
	return actorTookBackground(actor, ITINERANT_MYSTIC);
}

/**
 * The Enigma this character holds, 0 to ENIGMA_MAX: the stored track, or the 3 of the start of play while
 * nothing is stored (what the Details tab's circles show, StonetopCharacter's setupResources snapshot).
 * 0 for anyone who is not an Itinerant Mystic, whatever an old background left on the track.
 */
export function enigmaHeld(actor) {
	if (!isItinerantMystic(actor)) return 0;
	const stored = resolvedFlagProperty(actor, "background.setupResources")?.[ENIGMA_KEY];
	return clampInt(stored ?? ENIGMA_START, 0, ENIGMA_MAX);
}

/** Whether this character can spend an Enigma now: an Itinerant Mystic holding at least 1. */
export function canSpendEnigma(actor) {
	return enigmaHeld(actor) > 0;
}

/** The Enigma held after gaining `amount`, capped at the track's size. PURE. */
export function enigmaAfterGain(held, amount, max = ENIGMA_MAX) {
	return clampInt(clampInt(held, 0, max) + clampInt(amount, 0, max), 0, max);
}

/** The Enigma a wandering of `length` ("days", "weeks", "months") gives, or 0 for anything else. PURE. */
export function wanderingEnigma(length) {
	return WANDERING_ENIGMA[length] ?? 0;
}

/**
 * Whether Have What You Need may produce this item with an Enigma: "an oddly specific yet mundane item of
 * Value 1 or less". `value` is the item's Value read off its tag line (inventory-item-data.js
 * #splitInventoryNote), null when it prints none: the Inventory insert's gear and a write-in with no Value
 * are mundane things and count. A treasure is not mundane, whatever its Value. PURE.
 */
export function enigmaPaysForItem({ value = null, treasure = false } = {}) {
	if (treasure) return false;
	if (value === null || value === undefined || value === "") return true;
	const n = Number(value);
	return Number.isFinite(n) && n <= ENIGMA_ITEM_MAX_VALUE;
}

/**
 * The Enigma Have What You Need can spend on this item, or 0 when it can't: an Itinerant Mystic holding
 * some, and an item enigmaPaysForItem allows. `note` is the item's stored tag line, whose last clause
 * may be its "Value N".
 */
export function enigmaForItem(actor, { note = "", treasure = false } = {}) {
	const held = enigmaHeld(actor);
	if (held <= 0) return 0;
	return enigmaPaysForItem({ value: splitInventoryNote(note).value, treasure }) ? held : 0;
}

/**
 * What the Know Things card's upgrade button reads (stonetop.js#_knowThingsUpgradeSources), in the shape a
 * use track answers: `{left, max, spent}`. Enigma is a HELD count, so `left` is what is held and `spent` is
 * what the track lacks of its size. Null for a character who is not an Itinerant Mystic, so the button is
 * never drawn for them.
 */
export function enigmaUses(actor) {
	if (!isItinerantMystic(actor)) return null;
	const left = enigmaHeld(actor);
	return { left, max: ENIGMA_MAX, spent: ENIGMA_MAX - left };
}

/**
 * Spend 1 Enigma, read live. The Enigma held after the spend, or null when there was none to spend (or the
 * character is not an Itinerant Mystic): nothing is written then.
 */
export async function spendEnigma(actor) {
	const held = enigmaHeld(actor);
	if (held <= 0) return null;
	await writeSetupResource(actor, ENIGMA_KEY, held - 1);
	return held - 1;
}

/**
 * Gain `amount` Enigma, capped at the track's size. `{before, after}`, or null for a character who is not an
 * Itinerant Mystic. Nothing is written when the track is already full.
 */
export async function gainEnigma(actor, amount) {
	if (!isItinerantMystic(actor)) return null;
	const before = enigmaHeld(actor);
	const after  = enigmaAfterGain(before, amount);
	if (after !== before) await writeSetupResource(actor, ENIGMA_KEY, after);
	return { before, after };
}
