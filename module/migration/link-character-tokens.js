// Relinking the player tokens that carry a private copy of their own character.
//
// THE BUG THIS EXISTS FOR. Foundry's default for a new Actor is `prototypeToken.actorLink:
// false`, and an unlinked token does not point at its Actor — it carries an ActorDelta, a
// private diff that is merged over the world Actor to make a SECOND, token-local copy. For a
// monster that is the whole point: a scene's six goblins are six creatures. For a player
// character it is a duplicate person, and the two halves drift the moment anything writes to
// one of them.
//
// They drift because the two halves are reached by different routes, and nothing in either
// route announces which one it took:
//
//   • a roll writes to whichever Actor the open sheet belongs to (roll-engine's markMissXp
//     takes the sheet's actor), while
//   • every chat-card button resolves its actor back out of the message SPEAKER — and core's
//     ChatMessage.getSpeaker({actor}) does not keep the Actor it was handed: if that Actor has
//     any token on the canvas it rewrites the speaker to point at the TOKEN (see CASE 2 in
//     documents/chat-message.mjs). So the roll marks XP on the character and the Burn Brightly
//     button two seconds later spends it out of the token's copy.
//
//   • and core's own "C" shortcut (game.toggleCharacterSheet) opens the CONTROLLED TOKEN's
//     actor when exactly one token is selected and `game.user.character` when none is — so
//     which of the two copies a player is looking at depends on what they last clicked.
//
// The symptom is a character sheet that disagrees with itself: a miss marks +1 XP and reports
// 16, and the spend a moment later reports 11, because those are two different characters.
//
// StonetopActor._preCreate has stamped `actorLink: true` on new characters for some time, but
// that only ever covered NEW ones, and deliberately yields to creation data that names a link
// of its own — which is exactly what a duplicate or a compendium import carries. So a world
// can still hold unlinked player tokens: any made before that rule, and any duplicated or
// imported since. This sweep is for those.
//
// WHAT IT WILL AND WILL NOT DO ON ITS OWN. Linking a token abandons its delta, so a token that
// has actually drifted holds data that relinking would silently throw away — and it is not
// safe to guess which half is the real one. Both directions are real: the character sheet is
// the copy the player opens from the sidebar, and the token is the copy that was in play. So:
//
//   • a token whose delta is EMPTY is relinked silently. There is nothing to lose: an empty
//     delta means the synthetic Actor is byte-for-byte the world Actor already; and
//   • a token that has drifted is REPORTED, and the GM chooses per character.
//
// Nothing here deletes an Actor or a token. The worst it does is copy one existing copy over
// the other, at the GM's explicit instruction.

import { info, error } from "../utils/logger.js";

/**
 * Keys of an ActorDelta that never count as drift.
 *
 * `_id` is the delta's own identity and `type` is a passthrough of the base Actor's type
 * (see common/documents/actor-delta.mjs) — neither is ever a change somebody made.
 */
const DELTA_IDENTITY_KEYS = new Set(["_id", "type"]);

/**
 * The vitals worth naming when a token has drifted.
 *
 * Not an attempt to describe the whole diff — that is what "and other differences" below is
 * for. These are the four a GM can actually decide on by looking at them, and XP leads
 * because it is the one that surfaces the split: it is written by a roll on one copy and
 * spent by a chat button on the other.
 */
const COMPARED_VITALS = [
	{ path: "system.attributes.xp.value",    label: "XP" },
	{ path: "system.attributes.hp.value",    label: "HP" },
	{ path: "system.attributes.level.value", label: "Level" },
	{ path: "system.attributes.armor.value", label: "Armor" },
];

/** A plain `{}` object — not an array, not a class instance, not null. */
function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Deep value equality over the plain-JSON shapes embedded document data is made of.
 *
 * Local rather than `foundry.utils.objectsEqual` so the sweep can be tested without standing
 * up that half of core: everything it compares here came out of `toObject()` and is therefore
 * already plain data.
 */
function sameData(a, b) {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((entry, index) => sameData(entry, b[index]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameData(a[key], b[key]));
	}
	return false;
}

/**
 * The parts of `delta` that actually say something, with the schema's many ways of saying
 * "nothing" collapsed away.
 *
 * An ActorDelta is not sparse the way a plain diff is: its schema always materialises every
 * key, so an untouched delta still arrives as `{_id, name: null, type: null, img: null,
 * system: {}, items: [], effects: [], flags: {}}`. `null` is the initial for the nullable
 * passthrough fields (name/img/ownership) and means "inherit"; an empty object or array is an
 * untouched ObjectField or EmbeddedCollectionDeltaField. Reading emptiness off `Object.keys`
 * alone therefore reports every token in the world as drifted.
 *
 * @param {object|{toObject: Function}} delta  an ActorDelta document or its source data
 * @returns {object} only the keys carrying a change
 */
export function deltaChanges(delta) {
	const source = typeof delta?.toObject === "function" ? delta.toObject() : (delta ?? {});
	const changes = {};
	for (const [key, value] of Object.entries(source ?? {})) {
		if (DELTA_IDENTITY_KEYS.has(key)) continue;
		if (value === null || value === undefined) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		if (isPlainObject(value) && Object.keys(value).length === 0) continue;
		changes[key] = value;
	}
	return changes;
}

/** Has anyone written to this token's private copy? */
export function hasDrifted(delta) {
	return Object.keys(deltaChanges(delta)).length > 0;
}

/**
 * The world Actor a token stands for, or null when it stands for nothing (a token whose Actor
 * was deleted out from under it — left strictly alone; there is no character to link it to).
 */
function baseActorOf(token) {
	return token?.baseActor ?? (token?.actorId ? game.actors?.get(token.actorId) : null) ?? null;
}

/**
 * Every placed token that stands for a character but is not linked to it.
 *
 * Scans the Scenes rather than the canvas: the bug lives in stored data and the fix has to
 * reach the twelve scenes nobody has open, not just the one being looked at.
 *
 * @param {Iterable} [scenes]  defaults to the world's Scenes
 * @returns {Array<{token: object, base: object, scene: object, drifted: boolean}>}
 */
export function findUnlinkedCharacterTokens(scenes = game.scenes ?? []) {
	const found = [];
	for (const scene of scenes) {
		for (const token of (scene.tokens ?? [])) {
			if (token.actorLink) continue;
			const base = baseActorOf(token);
			if (base?.type !== "character") continue;
			found.push({ token, base, scene, drifted: hasDrifted(token.delta) });
		}
	}
	return found;
}

/**
 * A GM-readable account of how a token's copy and its character differ.
 *
 * The named vitals first, then one catch-all line for everything else, because the rest of a
 * delta (gear, flags, effects) is not summarisable in a row of a dialog and pretending
 * otherwise would be worse than admitting there is more.
 *
 * @returns {{vitals: Array<{label: string, token: *, sheet: *}>, other: string[]}}
 */
export function driftSummary(token, base) {
	const tokenActor = token.actor ?? null;
	const vitals = [];
	for (const { path, label } of COMPARED_VITALS) {
		const onToken = foundry.utils.getProperty(tokenActor, path);
		const onSheet = foundry.utils.getProperty(base, path);
		if (onToken === undefined && onSheet === undefined) continue;
		if (onToken === onSheet) continue;
		// A value one half has and the other does not is still a difference worth showing, and
		// spelling the absence out beats a dash the reader has to interpret.
		vitals.push({ label, token: onToken ?? "not set", sheet: onSheet ?? "not set" });
	}

	const changes = deltaChanges(token.delta);
	const other = [];
	// `items`/`effects` on a delta hold only the entries that differ, so a length is a count of
	// changes and not of the character's gear — worth saying plainly, since "3 items" over a
	// character carrying thirty otherwise reads as a loss.
	if (changes.items?.length)   other.push(`${changes.items.length} item(s) differ`);
	if (changes.effects?.length) other.push(`${changes.effects.length} effect(s) differ`);
	if (changes.flags && Object.keys(changes.flags).length) other.push("marks, holds or other flags differ");
	if (changes.name) other.push(`named "${changes.name}" on the token`);
	if (changes.img)  other.push("a different portrait on the token");
	// Anything in `system` that the named vitals above did not already account for.
	if (changes.system && !vitals.length) other.push("other sheet values differ");
	return { vitals, other };
}

/**
 * Point a token at its character. The delta is left in place rather than cleared: core does
 * the same when the Token Config checkbox is ticked, `isLinked` makes it unreachable, and
 * blanking an EmbeddedCollectionDeltaField by hand is a good deal more likely to go wrong
 * than a few unread keys are to do harm.
 */
export async function linkToken(token) {
	await token.update({ actorLink: true });
}

/**
 * Bring `base`'s embedded documents of `type` into line with `wanted`, preserving ids.
 *
 * Ids are load-bearing here and cannot be allowed to churn: a level-up records which move
 * instance raised which stat against the ITEM's id (see _applyStatIncreaseChoice), so a
 * delete-and-recreate that minted fresh ones would leave those choices pointing at nothing.
 * Hence `keepId` on creation and a per-id reconcile rather than a wholesale replace.
 */
async function reconcileEmbedded(base, type, wanted = []) {
	const collection = type === "Item" ? base.items : base.effects;
	const wantedById = new Map(wanted.map(data => [data._id, data]));

	const deletions = [];
	for (const existing of (collection ?? [])) {
		if (!wantedById.has(existing.id)) deletions.push(existing.id);
	}

	const creations = [], updates = [];
	for (const [id, data] of wantedById) {
		const existing = collection?.get?.(id);
		if (!existing) { creations.push(data); continue; }
		if (!sameData(existing.toObject(), data)) updates.push(data);
	}

	if (deletions.length) await base.deleteEmbeddedDocuments(type, deletions);
	// `diff: false` because these ARE the whole documents, already reconciled by id — letting
	// Foundry diff them again would drop a key the token's copy deliberately cleared.
	if (updates.length)   await base.updateEmbeddedDocuments(type, updates, { diff: false, recursive: false });
	if (creations.length) await base.createEmbeddedDocuments(type, creations, { keepId: true });
}

/**
 * Copy the token's private copy onto the character it stands for, then link them.
 *
 * The token's synthetic Actor is a COMPLETE Actor — the base merged with the delta — so its
 * `system`, `flags` and item list are the whole truth for that copy and are written wholesale
 * (`recursive: false`) rather than merged. Merging would keep values on the character that
 * the token's copy had deliberately cleared, which is neither half's version of events.
 *
 * `ownership` and `folder` are deliberately NOT copied: who may see a character and where it
 * files in the sidebar are properties of the shared character, not of a token standing on a
 * map, and a delta that carries an ownership override does so for that token alone.
 */
export async function adoptTokenCopy(token) {
	const base = baseActorOf(token);
	const tokenActor = token.actor;
	if (!base || !tokenActor) return;
	const source = tokenActor.toObject();
	await base.update(
		{ name: source.name, img: source.img, system: source.system, flags: source.flags },
		{ diff: false, recursive: false },
	);
	await reconcileEmbedded(base, "Item", source.items);
	await reconcileEmbedded(base, "ActiveEffect", source.effects);
	await linkToken(token);
}

/** Discard the token's private copy and point it at its character. */
export async function keepSheetCopy(token) {
	await linkToken(token);
}

/**
 * Stamp `prototypeToken.actorLink` on characters that never got it, so the NEXT token dragged
 * out is linked. Separate from the placed-token pass on purpose: a world can perfectly well
 * have a character with an unlinked prototype and no tokens down yet, and that character is
 * one drag away from the same split.
 *
 * @returns {Promise<number>} how many characters were stamped
 */
export async function linkCharacterPrototypes(actors = game.actors ?? []) {
	const updates = [];
	for (const actor of actors) {
		if (actor.type !== "character") continue;
		if (actor.prototypeToken?.actorLink) continue;
		updates.push({ _id: actor.id, "prototypeToken.actorLink": true });
	}
	if (updates.length) await Actor.updateDocuments(updates);
	return updates.length;
}

/**
 * The whole repair: link what is safe to link, hand back what is not.
 *
 * Deliberately does no asking of its own. The caller owns the conversation with the GM,
 * because whether an undecided token should be raised again next load is a question about the
 * sweep's own bookkeeping and not about the tokens (see Ready.js).
 *
 * @returns {Promise<Array>} the drifted rows, untouched, for the caller to put to the GM
 */
export async function repairCharacterTokenLinks() {
	const stamped = await linkCharacterPrototypes();
	if (stamped) info(`linked the prototype token of ${stamped} character(s)`);

	const unlinked = findUnlinkedCharacterTokens();
	if (!unlinked.length) return [];

	// ONE TOKEN AT A TIME, deliberately, and NOT batched per scene the way
	// `linkCharacterPrototypes` above batches per world. Batching is faster — a round trip and a
	// canvas refresh per token, on the primary GM's `ready` — but a scene-wide
	// `updateEmbeddedDocuments` fails as a unit, so one token the server refuses would take
	// every other token on its scene down with it. This loop is a one-off migration (it is
	// oncePerVersion-gated by its caller), so the round trips are paid once and the isolation is
	// worth more than the speed: a sweep that repairs what it can and reports what it cannot is
	// the point of it.
	const clean = unlinked.filter(row => !row.drifted);
	for (const row of clean) {
		try { await linkToken(row.token); }
		catch (err) { error(`could not link ${row.base?.name}'s token on ${row.scene?.name}`, err); }
	}
	if (clean.length) info(`linked ${clean.length} unchanged player token(s)`);

	return unlinked.filter(row => row.drifted);
}

/**
 * Carry out the GM's answers from CharacterTokenLinkDialog.
 *
 * Sequential rather than parallel: each answer is several document writes against the same
 * Actor (system, then items, then effects, then the token), and letting a dozen of those
 * interleave is how one character's gear ends up half-written under another's update.
 *
 * `left` and `failed` are counted apart because they mean opposite things to the caller. A row
 * answered "leave" is an instruction to do nothing and is a complete answer — the GM has said
 * they want that token as it is. A row that THREW is an unanswered question wearing the same
 * shape, and the sweep has to come back to it. Rolling the two together would either nag a GM
 * about a token they have already ruled on, or quietly drop a write that failed.
 *
 * @param {Array<{token: object, base: object, scene: object}>} rows
 * @param {Map<string, string>} choices  token UUID → "token" | "sheet" | "leave"
 * @returns {Promise<{linked: number, left: number, failed: number}>}
 */
export async function applyLinkChoices(rows, choices) {
	let linked = 0, left = 0, failed = 0;
	for (const row of rows) {
		const choice = choices?.get?.(row.token?.uuid);
		try {
			if (choice === "token")      { await adoptTokenCopy(row.token); linked++; }
			else if (choice === "sheet") { await keepSheetCopy(row.token);  linked++; }
			else if (choice === "leave") { left++; }
			// No answer at all. The dialog will not let this happen — Apply is gated on a complete
			// answer sheet — so it can only arrive from a caller of its own, and the safe reading
			// of "nobody said" is not "do nothing forever".
			else failed++;
		} catch (err) {
			error(`could not relink ${row.base?.name}'s token on ${row.scene?.name}`, err);
			failed++;
		}
	}
	return { linked, left, failed };
}
