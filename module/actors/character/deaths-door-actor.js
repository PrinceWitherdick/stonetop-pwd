import { STONETOP_SCOPE, readableFlags, resolvedFlagProperty } from "./StonetopFlags.js";
import { deletionEntry, serverNow } from "../../utils/foundry-compat.js";
import {
	DEATHS_DOOR_FLAG, DEATHS_DOOR_ROLL_FLAG, DEATHS_DOOR_ROLLING_FLAG, DEATHS_DOOR_STATE, NEVER_GONNA_KEEP_ME_DOWN,
	effectiveDeathsDoorState, pastDeathKind,
} from "./deaths-door.js";
import { hasLeftPlay } from "../../campaign/left-play.js";
import { THRALL_MARK, hasThrallMark } from "./thrall-marks.js";

// How far back through the chat log a roll's card is looked for by its nonce, when the marker never got as far
// as naming it (the page went away while the dice were still in the air). The card is always among the latest.
const CARD_SEARCH_DEPTH = 100;

// The marker is written and cleared with `render: false`. No sheet draws from it, and one roll writes it several
// times (the claim, the dice, each boost, the end), each of which would otherwise redraw every open sheet of the
// character on every client. The Death's Door windows that follow it hear `updateActor`, which core calls all the
// same (dialogs/DeathsDoorDialog.js#_listen).

/**
 * The Death's Door roll in progress on this actor (deaths-door.js#DEATHS_DOOR_ROLLING_FLAG), or null. Read so it
 * never throws: every Death's Door window asks on every draw, including over the stand-ins a sheet is tested with.
 */
export function deathsDoorRollMarker(actor) {
	const marker = actor ? readableFlags(actor)?.[DEATHS_DOOR_ROLLING_FLAG] : null;
	return marker && typeof marker === "object" && marker.userId && marker.nonce ? marker : null;
}

/**
 * The clock a marker's `at` is written and read against: the server's, so two tables' machines a minute apart
 * agree on how long a roll has been sitting.
 */
export const deathsDoorRollClock = serverNow;

/**
 * Write the marker whole. Every key goes out, nulls included: a flag update MERGES into what is stored, so a
 * marker written over an older one would otherwise keep that one's card and total. False, writing nothing, for
 * an actor that cannot be updated or a marker with nobody's name on it.
 */
export async function setDeathsDoorRollMarker(actor, marker) {
	if (typeof actor?.update !== "function" || !marker?.userId || !marker?.nonce) return false;
	await actor.update({ [`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_ROLLING_FLAG}`]: {
		userId:    marker.userId,
		userName:  marker.userName ?? "",
		at:        marker.at ?? deathsDoorRollClock(),
		nonce:     marker.nonce,
		messageId: marker.messageId ?? null,
		total:     marker.total ?? null,
		tier:      marker.tier ?? null,
		// An array, which a flag update replaces rather than merges.
		boosts:    Array.isArray(marker.boosts) ? [...marker.boosts] : null,
	} }, { render: false });
	return true;
}

/**
 * Whether a roll in progress reached the table: its card is here to read, or its marker carries a result (the
 * dice's total, or the tier of a 10+ taken without them). Such a roll is spent: whoever picks it up accepts it
 * rather than rolling again.
 */
export function deathsDoorRollPosted(marker, card = null) {
	return !!card || marker?.total != null || marker?.tier != null;
}

/**
 * The character's Death's Door state as it should be read (deaths-door.js#effectiveDeathsDoorState), off the actor
 * alone: for the GM's client ruling on a claim, which has no character model to hand.
 */
export function actorDeathsDoorState(actor) {
	const flags = actor ? readableFlags(actor) : null;
	return effectiveDeathsDoorState({
		state:      flags?.[DEATHS_DOOR_FLAG] ?? null,
		insertSlug: flags?.postDeathInsert?.slug ?? null,
	});
}

/**
 * The marker's deletion as an update fragment, for a write that lifts it alongside other changes. Built on each
 * call: the deletion's shape depends on the running core generation (foundry-compat.js#deletionEntry).
 */
export function rollMarkerDeletion() {
	return Object.fromEntries([deletionEntry(`flags.${STONETOP_SCOPE}.${DEATHS_DOOR_ROLLING_FLAG}`)]);
}

/**
 * Clear the marker, but only while it still names roll `nonce`: a roll taken over since, or a newer one, is not
 * this caller's to clear. Whether it wrote anything.
 */
export async function clearDeathsDoorRollMarker(actor, nonce) {
	const marker = deathsDoorRollMarker(actor);
	if (!marker || (nonce && marker.nonce !== nonce) || typeof actor?.update !== "function") return false;
	await actor.update(rollMarkerDeletion(), { render: false });
	return true;
}

/**
 * The card a roll in progress was posted as: the one its marker names, else the latest carrying its nonce (the
 * card is stamped before the dice animate, the marker only after), else null, which is also the answer on a
 * client the card was never sent to (a private roll).
 */
export function deathsDoorRollCard(marker, messages = globalThis.game?.messages) {
	if (!marker || !messages) return null;
	const named = marker.messageId ? messages.get?.(marker.messageId) : null;
	if (named) return named;
	if (!marker.nonce) return null;
	const all = messages.contents ?? [];
	for (let i = all.length - 1; i >= Math.max(0, all.length - CARD_SEARCH_DEPTH); i--) {
		if (all[i]?.getFlag?.(STONETOP_SCOPE, DEATHS_DOOR_ROLL_FLAG) === marker.nonce) return all[i];
	}
	return null;
}

/**
 * Never Gonna Keep Me Down: "Once per session, when you are at Death's Door, don't roll. You get a
 * 10+." The move's one circle is marked when the Death's Door window takes the 10+, and a new session
 * gives the use back: End of Session clears it on every character it walks. How many were cleared.
 * A character with the circle already clear costs no write.
 *
 * @param {Iterable<Actor>} actors
 */
export async function resetNeverGonnaKeepMeDown(actors = []) {
	let cleared = 0;
	for (const actor of actors ?? []) {
		const resources = actor?.typedActor?.moveResources;
		if (!(Number(resources?.getMoveResources?.()?.[NEVER_GONNA_KEEP_ME_DOWN]) > 0)) continue;
		await resources.setUses(NEVER_GONNA_KEEP_ME_DOWN, 0, { stonetopMove: "End of Session" });
		cleared += 1;
	}
	return cleared;
}

/**
 * What an actor is past the Door — their insert slug ("revenant"/"ghost"/"thrall"), "dead" for
 * one who stepped through the Last Door, or null for the living.
 *
 * The rule itself lives in deaths-door.js, which is deliberately Foundry-free so it can be read
 * and tested without a document; this is the one place that knows where the two answers it needs
 * are STORED. Both are read through `resolvedFlagProperty` so a sheet written before the
 * system-id rename still reports its death (see StonetopFlags).
 *
 * Anything that shows a character's death rather than ruling on it goes through here: the chat
 * drip's stamp, and the expedition Outfit readout, which drops the dead from the party list and
 * darkens whoever came back.
 */
export function actorPastDeathKind(actor) {
	if (!actor) return null;
	return pastDeathKind({
		state:      resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null,
		insertSlug: resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null,
	});
}

/**
 * Whether a character has left play: `dead`, WHATEVER insert they wear. The test every party list asks
 * (who can camp, who a move can be aimed at, who the GM can call on for a Struggle, who sets out on an
 * expedition).
 *
 * Not `actorPastDeathKind(actor) === "dead"`, which is the question for how a sheet LOOKS and lets the
 * insert win: a Ghost who marked the Final Consequence reads "ghost" there, and so went on counting as a
 * live party member while their sheet said they had become a monster under the GM's control. The same
 * for a Thrall lost to Unholy Vessel, and for a Ghost or Revenant who fulfilled their Terrible Purpose and
 * passed through the Last Door.
 *
 * Or alive and gone: retired, left Stonetop, or become a threat (Book I p.584; campaign/left-play.js). They
 * are out of every party list the same as the dead, though nothing about their sheet says they died.
 */
export function isOutOfPlay(actor) {
	return !!actor && (resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) === DEATHS_DOOR_STATE.DEAD || hasLeftPlay(actor));
}

/** `isOutOfPlay` for a roster read that must never throw: a sheet that can't say is not dead. */
export function isOutOfPlaySafe(actor) {
	try { return isOutOfPlay(actor); } catch { return false; }
}

/**
 * The post-death inserts whose Unliving move reads "You need not eat nor drink nor sleep ... You
 * gain no benefit from magical healing, Make Camp, Recover or Convalesce." A Thrall eats, sleeps and
 * heals like anyone else.
 */
export const UNLIVING_KINDS = Object.freeze(["ghost", "revenant"]);

/**
 * A Ghost or a Revenant: magical healing, Make Camp, Recover and Convalesce do them no good. Their
 * own moves' healing is another matter (a Terrible Purpose fulfilled, a Ghost reforming at their
 * tether), which is why StonetopCharacter#restoreHp does not ask this.
 */
export function isUnliving(actor) {
	return UNLIVING_KINDS.includes(actorPastDeathKind(actor));
}

// The Thrall Marks this file's rules turn on, and whether a character holds one: thrall-marks.js, which
// the roll engine reads too.
export { THRALL_MARK, hasThrallMark };

/**
 * Torment's Blessing: "Your wounds are slow to heal. When you recover HP, recover only half the
 * amount that you should."
 */
export function slowToHeal(actor) {
	return hasThrallMark(actor, THRALL_MARK.TORMENTS_BLESSING);
}

/**
 * Where HP that should go from `from` to `to` actually lands: at `to`, or, for one who is slow to
 * heal (Torment's Blessing), `from` plus half the gain, rounded up (halves round up). Halved ONCE, on
 * the whole amount a move recovers, however many parts it is made of: a night at the fire's half max
 * HP, bedroll and Break Bread are one recovery, not three roundings up. Never a loss: damage is not
 * recovery, and a `to` at or below `from` is returned as it is.
 *
 * THE ONE RULE for every way HP is recovered (restoreHp, receiveHealing, Recover, Convalesce, Make
 * Camp), so none of them rounds it differently.
 */
export function recoveredHpTo(from, to, slow) {
	const start = Math.trunc(Number(from) || 0);
	const end = Math.trunc(Number(to) || 0);
	if (!slow || end <= start) return end;
	return start + Math.ceil((end - start) / 2);
}
