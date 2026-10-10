/**
 * The Marshal's WE HAPPY FEW, the half its allies carry:
 *
 *   "When you give an inspiring speech to your allies before facing a dire threat, roll +CHA: on a
 *    10+, each ally holds 2 Inspiration; on a 7-9, each ally holds 1 Inspiration; on a 6-, each ally
 *    holds 1, but you have disadvantage on all rolls until you share your nagging doubts with someone
 *    else. Once battle is joined, your allies can spend their Inspiration at any time, 1-for-1 to:
 *     - Act fearlessly in the face of terror or overwhelming odds
 *     - Keep 1 HP instead of being reduced to 0 HP
 *     - Add 1d6 to a damage roll they just made"
 *
 * Built on Piety's Blessing (roll-boosts.js), which is the same shape: one character's move hands a
 * hold to the others, who spend it on their own cards. The 6-'s nerves are fight-states.js's.
 *
 * WHERE IT LIVES: a count on each ALLY's own character (flag `inspiration`), not on the Marshal. The
 * Marshal holds none of their own ("your allies"), and followers are not asked about.
 *
 * A FRESH SPEECH REPLACES UPWARD, never stacks: an ally holds the new amount, or what they still hold
 * if that is more (heldAfterSpeech). Two speeches before one fight are one speech's worth, as a second
 * worship is one Blessing; and a 7-9 after a 10+ does not take away an Inspiration nobody has spent.
 *
 * KEPT UNTIL SPENT. "Once battle is joined ... at any time": the book gives the hold no end, so a
 * fight ending does not clear it; it goes when it is spent, and is replaced by the next speech.
 *
 * "ONCE BATTLE IS JOINED" is read as the holder standing in a combat (inBattle): any Combat in the
 * world with a combatant for this character, the Fight tab's or core's tracker's. The two spends the
 * sheet OFFERS (the damage die, the 1 HP) wait for it; acting fearlessly is fiction, spent from the
 * header chip whenever the player says so.
 *
 * Kept free of Foundry globals apart from reading the world's combats, so it tests with plain objects;
 * the chat cards and the GM relay are inspiration-flow.js's.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { resolvedFlagProperty } from "./StonetopFlags.js";
import { DEATHS_DOOR_FLAG, canFaceDeathsDoor, effectiveDeathsDoorState } from "./deaths-door.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { WE_HAPPY_FEW } from "./fight-states.js";
import { inBattle } from "../../fight/in-battle.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

export { WE_HAPPY_FEW };

const KEY = "stonetop.inspiration";

/** The character flag an ally's Inspiration is counted on. */
export const INSPIRATION_FLAG = "inspiration";

/** How much each ally holds for a We Happy Few tier: 2 on a 10+, 1 on a 7-9, and 1 on a 6- too. PURE. */
export function inspirationForTier(tier) {
	switch (tier) {
		case "critical":
		case "success": return 2;
		case "partial":
		case "failure": return 1;
		default: return 0;
	}
}

/**
 * How much Inspiration a character holds: a whole number, 0 for anything unreadable (a test fake's
 * flags answer `{}`, which Number reads as NaN).
 */
export function inspirationHeld(actor, scope = SYSTEM_ID) {
	const raw = Math.trunc(Number(actor?.getFlag?.(scope, INSPIRATION_FLAG)));
	return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** What an ally holds after a speech worth `amount`: the more of the two, never the sum. PURE. */
export function heldAfterSpeech(current, amount) {
	const now = Math.max(0, Math.trunc(Number(current) || 0));
	return Math.max(now, Math.max(0, Math.trunc(Number(amount) || 0)));
}

/**
 * Hold a speech's Inspiration: `amount`, or what they already hold if that is more. Whether anything
 * was written (nothing is, for a character already holding as much).
 */
export async function holdInspiration(actor, amount, scope = SYSTEM_ID) {
	if (actor?.type !== "character") return false;
	const current = inspirationHeld(actor, scope);
	const next = heldAfterSpeech(current, amount);
	if (next <= current) return false;
	await actor.setFlag(scope, INSPIRATION_FLAG, next);
	return true;
}

/** Spend 1 Inspiration. The flag goes altogether at 0. Whether there was one to spend. */
export async function spendInspiration(actor, scope = SYSTEM_ID) {
	const held = inspirationHeld(actor, scope);
	if (held <= 0) return false;
	if (held > 1) await actor.setFlag(scope, INSPIRATION_FLAG, held - 1);
	else await actor.unsetFlag(scope, INSPIRATION_FLAG);
	return true;
}

/** Give back 1 Inspiration spent on something that then did not happen. */
export async function refundInspiration(actor, scope = SYSTEM_ID) {
	await actor.setFlag(scope, INSPIRATION_FLAG, inspirationHeld(actor, scope) + 1);
}

// "Once battle is joined": whether this character stands in any combat in the world (fight/in-battle.js).
export { inBattle };

/** The character's hit points, as the sheet reads them. */
function hpOf(actor) {
	return Number(actor?.system?.attributes?.hp?.value) || 0;
}

/**
 * Whether "Keep 1 HP instead of being reduced to 0 HP" is on offer now: they hold Inspiration, are in a
 * fight, and have just been reduced to 0 (dying, not yet through their 0-HP move). A character already
 * past the Door, or one who came back up, has nothing to keep.
 */
export function canKeepOneHp(actor, { combats = globalThis.game?.combats, scope = SYSTEM_ID } = {}) {
	if (actor?.type !== "character" || inspirationHeld(actor, scope) <= 0) return false;
	const state = effectiveDeathsDoorState({
		state:      resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null,
		insertSlug: resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null,
	});
	if (!canFaceDeathsDoor({ hp: hpOf(actor), state })) return false;
	return inBattle(actor, combats);
}

/**
 * The buttons a We Happy Few roll card carries, one per tier (roll-engine's tierActions): each asks who
 * heard the speech, and gives them that tier's Inspiration (inspiration-flow.js#wireSpeechCard). For a
 * character with the move learned; null otherwise.
 */
export function speechRollOptions(actor) {
	if (actor?.type !== "character" || !ownsLearnedMoveNamed(actor, WE_HAPPY_FEW)) return null;
	const button = tier => {
		const amount = inspirationForTier(tier);
		return `<button type="button" class="stonetop-inspire-allies" data-amount="${amount}"><i class="fas fa-bullhorn"></i> `
			+ `${escHtml(format(`${KEY}.inspireButton`, { amount }))}</button>`;
	};
	return { tierActions: { success: button("success"), partial: button("partial"), failure: button("failure") } };
}

/**
 * The header chip for a character holding Inspiration: shown only while they hold some, with the count
 * in its words (a count glyph with no words would say nothing to a player who cannot see it well).
 * Pressed where the sheet is editable to act fearlessly (the one spend with no card of its own).
 */
export function inspirationChip(actor, { editable = false, scope = SYSTEM_ID } = {}) {
	const count = inspirationHeld(actor, scope);
	return {
		show:    count > 0,
		count,
		label:   format(`${KEY}.chipLabel`, { count }),
		tooltip: format(`${KEY}.${editable ? "chipTooltip" : "chipReadOnly"}`, { count }),
	};
}

/** The words the fearless spend's question and chat line use, for the sheet. */
export function fearlessWords(actor, scope = SYSTEM_ID) {
	const held = inspirationHeld(actor, scope);
	return {
		title:  format(`${KEY}.fearlessTitle`, { name: actor?.name ?? "" }),
		ask:    format(`${KEY}.fearlessAsk`, { name: actor?.name ?? "", held }),
		spend:  localize(`${KEY}.fearlessSpend`),
		keep:   localize(`${KEY}.fearlessKeep`),
	};
}
