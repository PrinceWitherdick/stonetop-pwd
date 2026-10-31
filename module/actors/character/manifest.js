// ── A Ghost's manifestation, as a record ───────────────────────────────────
// Disembodied: "When you manifest a ghostly presence in shadows or darkness, the world becomes clear and
// pick 1. For each additional option you pick, lose 1d4 HP: ... Your touch (or ghostly weapons) can harm
// the living (ignores armor). You remain manifest for as long as you concentrate" (Book I p.148).
//
// The picks are kept on the Ghost (the user's ruling, 2026-10-27, audit GH-6) for as long as they stay
// manifest, because one of them changes the arithmetic of the Ghost's own blows: while the touch option is
// held, a damage card the Ghost rolls opens with its "Ignores armor" box ticked (combat/attack-flow.js), and
// the table can still untick it. The record goes when the manifestation does: the move card's End
// manifestation, a drop to 0 HP or a Tethered dispersal (the preUpdate below), and an insert swap
// (CharacterPostDeath#pruneToInsertUpdateData).

import { STONETOP_SCOPE, StonetopFlags, resolvedFlagProperty } from "./StonetopFlags.js";
import { DEATHS_DOOR_FLAG, DEATHS_DOOR_STATE } from "./deaths-door.js";

/** The key, in the insert's own flag namespace (`postDeathInsert`), the picks are kept under. */
export const MANIFEST_KEY = "manifest";
const MANIFEST_PATH = `postDeathInsert.${MANIFEST_KEY}`;

/**
 * The insert's namespace, for building update fragments only: those builders never touch the actor, so
 * one with none serves every Ghost.
 */
const INSERT_FLAGS = new StonetopFlags(null, "postDeathInsert");

/** The insert whose Disembodied manifests. A record left on any other is stale, never read. */
const MANIFESTING_INSERT = "ghost";

/** The printed option that lets the Ghost's touch harm the living, as the move card's text words it. */
const HARMFUL_TOUCH_RE = /\bharm the living\b/i;

/** The options a character is manifest with now, as the move printed them: [] when none. */
export function manifestedPicks(actor) {
	if (!actor || resolvedFlagProperty(actor, "postDeathInsert.slug") !== MANIFESTING_INSERT) return [];
	const stored = resolvedFlagProperty(actor, MANIFEST_PATH);
	return Array.isArray(stored) ? stored.filter(text => typeof text === "string" && text.trim()) : [];
}

/** Whether a Ghost is manifest with "Your touch (or ghostly weapons) can harm the living (ignores armor)". */
export function manifestsHarmfulTouch(actor) {
	return actor?.type === "character" && manifestedPicks(actor).some(text => HARMFUL_TOUCH_RE.test(text));
}

/** The record as an `actor.update()` fragment, for the manifestation's own write (its HP loss, if any). */
export function manifestUpdateData(picks) {
	return INSERT_FLAGS.updateData(MANIFEST_KEY, [...(picks ?? [])].map(String));
}

/** Its removal as a fragment. */
export function endManifestUpdateData() {
	return INSERT_FLAGS.deletionData(MANIFEST_KEY);
}

/** The states a manifestation cannot outlast: down, dispersed, gone. */
const ENDS_MANIFESTATION = new Set([DEATHS_DOOR_STATE.DYING, DEATHS_DOOR_STATE.OUT_OF_ACTION, DEATHS_DOOR_STATE.DEAD]);

/** Update option: this write ended a manifestation (read by We Happy Few's Keep 1 HP card). */
export const MANIFEST_ENDED_OPTION = "stonetopManifestEnded";

/**
 * preUpdateActor: a write that takes a manifest Ghost to 0 HP, or names a state they cannot hold one in
 * (dying, dispersed by Tethered, out of play), ends the manifestation in that same write, and says so on
 * the options (MANIFEST_ENDED_OPTION). "Pain or shock" short of that is the fiction's to call, with the
 * move card's End manifestation. Never throws: a fault here must not stop the HP being written.
 */
export function onPreUpdateActorManifest(actor, changes, options) {
	try {
		if (actor?.type !== "character") return;
		const insertChanges = foundry.utils.getProperty(changes, `flags.${STONETOP_SCOPE}.postDeathInsert`);
		// A manifestation recorded in this very write: the extra options' 1d4s can be what drops them.
		const recording = !!insertChanges && typeof insertChanges === "object" && MANIFEST_KEY in insertChanges;
		if (!recording && resolvedFlagProperty(actor, MANIFEST_PATH) == null) return;
		const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
		const state = foundry.utils.getProperty(changes, `flags.${STONETOP_SCOPE}.${DEATHS_DOOR_FLAG}`);
		const down = (hp !== undefined && hp !== null && (Number(hp) || 0) <= 0) || ENDS_MANIFESTATION.has(state);
		if (!down) return;
		if (options && typeof options === "object") options[MANIFEST_ENDED_OPTION] = true;
		if (recording) delete insertChanges[MANIFEST_KEY];
		if (resolvedFlagProperty(actor, MANIFEST_PATH) == null) return;
		for (const [key, value] of Object.entries(endManifestUpdateData())) foundry.utils.setProperty(changes, key, value);
	} catch (err) {
		console.error("Stonetop | could not end a manifestation", err);
	}
}
