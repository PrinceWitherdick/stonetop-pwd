// Three minor arcana whose stored counts changed meaning with the 2026-11-04 arcana audit.
//
// • A mummified hand (Book II p.536): "on three separate nights, soak a different piece of red
//   crystal" prints □□□, so its `soak-crystal` unlock step now counts to 3. It used to count to 1,
//   so a stored 1 was the whole step done, and it is raised to 3 so the card stays unlocked.
// • A rusty steel blade (p.534) prints "Blaze: ☑nil, ○1d4, ○1d6, ○1d8, ○1d10" and a treasure map's
//   Silver Branch (p.538) "☑fresh, ○fading, ○bare": the first state comes ticked. The tracks used
//   to carry it as their first pip (nil / fresh at 1); now 0 is nil / fresh and the pips are the
//   steps after it, so a stored count n > 0 becomes n - 1.
//
// A count cannot say which reading it was written under, so each character records, by marker, the
// changes its counts already follow (`arcana.auditSettles`), in the SAME update that moves them:
// settling again, from any client, in any order, finds the markers and does nothing. A character
// with nothing to move is stamped as well, because a count it writes later is a new-card count
// that must never be moved. Characters made from now on are stamped (or, for an old export coming
// in, settled) on the way in, by the preCreateActor hook below.
//
// Runs like the box-layout settle (tulpa-move-boxes.js): the primary GM across every character once
// per version, each player across their own characters on load. Removing a card leaves the markers
// alone (removeArcanum clears only "<slug>:" keys of its own maps), so a card dropped and drawn
// again is never settled twice.
//
// The same write settles a card's back-item uses under one key (MNB-2 / HB-12): the Arcana tab used
// to keep them under "<slug>:item" on a card with no back-power track, where every other reader looks
// under the bare slug (StonetopCharacter#arcanumResourceKeysUpdate). Nothing writes that key for such
// a card any more, so once moved a repeat finds nothing. It needs the cards, so a player's load skips
// it once the GM's sweep has run this version.
//
// Quiet in the ledger, and kept off the timeline: raising the hand's count to 3 completes its unlock
// under the new card, but the character unlocked it long ago, so it is not a milestone.

import { StonetopFlags } from "../actors/character/StonetopFlags.js";
import { BEFORE_OPTION } from "../timeline/timeline-watch.js";
import { sweepCharacters } from "./sweep-characters.js";

/** The oncePerVersion key of the GM's sweep. */
export const ARCANA_AUDIT_1104_SWEEP = "arcanaAudit1104";

/** The `arcana` flag key holding a character's settled markers. */
export const AUDIT_SETTLES_KEY = "auditSettles";

/** Update option marking a write as this settle (the preUpdateActor hook below reads it). */
export const ARCANA_AUDIT_1104_OPTION = "stonetopArcanaAudit1104";

/**
 * Each change: `unlock` rows raise a stored unlock count of exactly `from` to `to`; `resource`
 * rows move a stored track count of more than 0 down by one.
 */
export const ARCANA_AUDIT_1104_SETTLES = Object.freeze([
	Object.freeze({ marker: "mummified-hand:soak-crystal:3", kind: "unlock", key: "mummified-hand:soak-crystal", from: 1, to: 3 }),
	Object.freeze({ marker: "rusty-steel-blade:blaze:nil-ticked", kind: "resource", key: "rusty-steel-blade" }),
	Object.freeze({ marker: "treasure-map:silver-branch:fresh-ticked", kind: "resource", key: "treasure-map" }),
]);

function count(value) {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) ? n : 0;
}

/**
 * The update that brings one character's counts up to the cards (with the markers), or null when
 * every marker is already there. PURE apart from reading the actor's flags, so the preCreate hook
 * can apply it to a document that is not saved yet.
 *
 * @param {object} actor  a character Actor (saved or pending)
 * @returns {object|null} an `actor.update()` / `updateSource()` fragment
 */
export function arcanaAudit1104Update(actor) {
	const arcana = new StonetopFlags(actor, "arcana");
	const inventory = new StonetopFlags(actor, "inventory");
	const done = arcana.getFlag(AUDIT_SETTLES_KEY) ?? {};
	const todo = ARCANA_AUDIT_1104_SETTLES.filter(change => !done[change.marker]);
	if (!todo.length) return null;

	let unlock = null;
	const resources = {};
	const storedResources = inventory.getFlag("resources") ?? {};
	for (const change of todo) {
		if (change.kind === "unlock") {
			const stored = unlock ?? arcana.getFlag("unlock") ?? {};
			if (change.key in stored && count(stored[change.key]) === change.from) unlock = { ...stored, [change.key]: change.to };
		} else if (change.kind === "resource") {
			const n = count(storedResources[change.key]);
			// One sub-key per track, as every resources write is, so the back-item key settle can
			// share the update (settleArcanaAudit1104).
			if (change.key in storedResources && n > 0) Object.assign(resources, inventory.subKeyData("resources", change.key, n - 1));
		}
	}

	const markers = Object.fromEntries(todo.map(change => [change.marker, true]));
	return {
		...arcana.updateData(AUDIT_SETTLES_KEY, { ...done, ...markers }),
		...(unlock ? arcana.updateData("unlock", unlock) : {}),
		...resources,
	};
}

/**
 * Settle one character's counts and, unless `resourceKeys` is false, its back-item keys, in ONE
 * update. Safe to repeat.
 *
 * @returns {Promise<boolean>} whether anything was written
 */
export async function settleArcanaAudit1104(actor, { resourceKeys = true } = {}) {
	if (actor?.type !== "character") return false;
	const counts = arcanaAudit1104Update(actor);
	const keys = resourceKeys ? await actor.typedActor?.arcanumResourceKeysUpdate?.() : null;
	if (!counts && !keys) return false;
	// The counts' option keeps their write off the timeline; the keys alone are a plain quiet write.
	await actor.update({ ...counts, ...keys }, { stonetopLedger: true, ...(counts ? { [ARCANA_AUDIT_1104_OPTION]: true } : {}) });
	return true;
}

/**
 * The primary GM's sweep, across every character.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function settleAllArcanaAudit1104({ actors } = {}) {
	return sweepCharacters(actor => settleArcanaAudit1104(actor), { actors });
}

/** The characters this user can write, settled: a player's own client, on load. */
export async function settleOwnArcanaAudit1104({ actors, resourceKeys = true } = {}) {
	return sweepCharacters(actor => settleArcanaAudit1104(actor, { resourceKeys }), { actors, own: true });
}

/** preCreateActor: a new character starts stamped; an old export coming in is settled first. */
export function onPreCreateActorAudit1104(actor) {
	if (actor?.type !== "character") return;
	const data = arcanaAudit1104Update(actor);
	if (data) actor.updateSource?.(data);
}

/**
 * preUpdateActor, registered after the timeline's own (stonetop.js wires that at load): this
 * settle's write drops the timeline's before-snapshot, so it records no milestone.
 */
export function onPreUpdateActorAudit1104(_actor, _changed, options) {
	if (options?.[ARCANA_AUDIT_1104_OPTION]) delete options[BEFORE_OPTION];
}

/** Wire both hooks. Called once, from the ready hook. */
export function registerArcanaAudit1104Hooks() {
	Hooks.on("preCreateActor", onPreCreateActorAudit1104);
	Hooks.on("preUpdateActor", onPreUpdateActorAudit1104);
}
