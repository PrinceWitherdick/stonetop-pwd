// Bring the book moves, treasures and gear characters already hold up to what the pack ships now.
//
// A move is copied onto a character when it is taken (StonetopCharacter#addMove: the pack document's
// `toObject()`), a treasure when it is dropped on a sheet or seeded into the Items sidebar, and
// nothing revisits the copy. So a field the pack gains, changes or drops later never reaches a copy
// already in play: Stentorian's track (added 2026-06-09) never filled on joining a fight, Unstoppable
// kept six circles after the pack went to the book's five, Guardian kept a Readiness track the pack
// took away, and a Hard to Kill taken in June still posts June's 7-9. Every rule and every roll card
// reads the held copy (owns-move.js#ownedMove, StonetopItem), while a move's row on the sheet reads
// the pack, so a stale copy shows one text and rolls another.
//
// TWO RULES, and neither can touch an edit:
//  - FILL what the copy lacks and the pack has (a track, a no-XP miss, an outcome block).
//  - CORRECT a value the copy has only when it is one the PACK ITSELF shipped at some earlier commit
//    and no longer ships (superseded-values.js; the list is generated from git history by
//    scripts/gen-superseded-fields.js). A GM who retitled a track or rewrote a description holds a
//    value no release ever shipped, so it is left exactly as it is. A keyed field (a track, the roll
//    outcomes, armor) is judged key by key: a retitled track keeps its title while its size is fixed.
//
// Never written: the name, moveType (a move learned from another playbook is stored as "other"), the
// playbook, or any flag but the made-under stamp below. A player's own move (the custom-move flag), a
// hand-written piece of gear, and gear a special possession granted (possession-grant-repair.js
// owns that) are never touched. Per version, from Ready: a pack only changes with a release.

import { ITEMS_PACK, ITEM_FLAG_SCOPE } from "../system-id.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { isPlayerAuthoredMove } from "../actors/character/owns-move.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { deletionEntry, compendiumSourceOf } from "../utils/foundry-compat.js";
import { isPlainObject } from "../utils/strings.js";
import { WRITEUP_EDITED_FLAG } from "../utils/inventory-item-data.js";
import { MADE_UNDER_FLAG } from "./made-under.js";
import { SweepFailures } from "./sweep-failures.js";
import {
	MOVE_FIELDS, GEAR_FIELDS, SUPERSEDED_FORMAT, fieldsFor, fieldValue, isGear, sameValue, valueHash,
	entryFingerprint, compendiumSourceParts, loadGenerated,
} from "./superseded-values.js";

const INDEX_FIELDS = [...new Set(["system.playbook", "system.moveType", "system.isTreasure", `flags.${ITEM_FLAG_SCOPE}`,
	...[...Object.keys(MOVE_FIELDS), ...Object.keys(GEAR_FIELDS)].map(field => `system.${field}`)])];

/** The pack's moves and gear by name (`name -> entry[]`), several where two playbooks print one name. */
export function packMovesByName(entries = []) {
	const byName = new Map();
	for (const entry of entries) {
		if (entry?.type !== "move" || !entry.name) continue;
		if (!byName.has(entry.name)) byName.set(entry.name, []);
		byName.get(entry.name).push(entry);
	}
	return byName;
}

/**
 * The pack entry a held copy was taken from, or null.
 *
 * Only within its own kind: a move is matched to a move and gear to gear, so a write-in called
 * "Shield" is never read as the catalog's. Then a post-death Consequence's or Mark's move by its lore
 * option, then by playbook where two entries share a name. A copy with no playbook (the post-death
 * moves are made that way) matches a shared name only when every entry of that name is the same
 * move (the Ghost's and the Revenant's Unliving).
 */
export function packEntryFor(item, byName) {
	const gear = isGear(item);
	const entries = (byName.get(item?.name) ?? []).filter(entry => isGear(entry) === gear);
	if (entries.length <= 1) return entries[0] ?? null;
	const lore = item.system?.loreOption;
	if (lore) {
		const byLore = entries.filter(entry => entry.system?.loreOption === lore);
		if (byLore.length === 1) return byLore[0];
	}
	const playbook = item.system?.playbook ?? "";
	const same = entries.filter(entry => (entry.system?.playbook ?? "") === playbook);
	if (same.length === 1) return same[0];
	if (!playbook) {
		const print = entryFingerprint(entries[0]);
		if (entries.every(entry => entryFingerprint(entry) === print)) return entries[0];
	}
	return null;
}

/**
 * Whether a held item is the refresh's to touch at all: never a player's own move, never a piece of
 * hand-written gear (an `inventory-custom` that is not a treasure), never the gear a special
 * possession made (possession-grant-repair.js keeps that in step with the playbook). PURE.
 */
export function refreshable(item) {
	if (item?.type !== "move" || isPlayerAuthoredMove(item)) return false;
	if (item.system?.moveType === "inventory-custom") {
		if (item.system?.sourcePossession) return false;
		return !!(item.system?.isTreasure || item.flags?.[ITEM_FLAG_SCOPE]?.isTreasure);
	}
	return true;
}

/**
 * Add to `update` a deletion for every key `stored` has at `path`, at any depth, that `value` does
 * not: a merge would otherwise keep it. Arrays are replaced whole by a merge, so are not descended. PURE
 * but for the deletion-key helper.
 */
export function deleteStaleKeys(update, path, stored, value) {
	if (!isPlainObject(stored) || !isPlainObject(value)) return;
	for (const [key, was] of Object.entries(stored)) {
		if (value[key] === undefined) {
			const [k, v] = deletionEntry(`${path}.${key}`);
			update[k] = v;
		} else deleteStaleKeys(update, `${path}.${key}`, was, value[key]);
	}
}

/**
 * The value a held field should take, or `undefined` to leave it. PURE.
 *
 * @param {*} held      the copy's value
 * @param {*} now       the pack's value
 * @param {object} spec the field's spec
 * @param {(path: string, hash: string) => boolean} wasShipped  whether `hash` is a former value at `path`
 * @param {string} field
 */
export function refreshedValue(held, now, spec, wasShipped, field, { strictFill = false } = {}) {
	if (sameValue(held, now)) return undefined;
	// FILL: the copy has none and the pack has one. Strict (gear) only where the pack itself once
	// shipped none: the treasure dialog lets a GM clear armor, a shield or a track, and an emptied
	// field must not be filled back in.
	if (!spec.has(held)) {
		if (strictFill && !wasShipped(field, valueHash(held))) return undefined;
		return spec.has(now) ? structuredClone(now) : undefined;
	}
	if (spec.fillOnly) return undefined;
	// CORRECT, whole: the copy holds exactly a value the pack once shipped.
	if (wasShipped(field, valueHash(held))) return spec.has(now) ? structuredClone(now) : structuredClone(spec.empty);
	// CORRECT, key by key: each key that still holds a shipped value takes the pack's, and a key the
	// GM changed keeps theirs. The pack having dropped the field altogether is only acted on whole.
	if (!spec.keys || !isPlainObject(held) || !isPlainObject(now)) return undefined;
	const out = structuredClone(held);
	let changed = false;
	for (const key of new Set([...Object.keys(held), ...Object.keys(now)])) {
		if (sameValue(held[key], now[key], { top: false })) continue;
		if (!wasShipped(`${field}.${key}`, valueHash(held[key], { top: false }))) continue;
		if (now[key] === undefined) delete out[key];
		else out[key] = structuredClone(now[key]);
		changed = true;
	}
	return changed ? out : undefined;
}

// A pack entry's former values as Sets, built once per entry: every character holding the move asks.
const FORMER_SETS = new WeakMap();
function formerSets(former) {
	if (!former || typeof former !== "object") return new Map();
	let sets = FORMER_SETS.get(former);
	if (!sets) {
		sets = new Map(Object.entries(former).map(([path, hashes]) => [path, new Set(hashes)]));
		FORMER_SETS.set(former, sets);
	}
	return sets;
}

/**
 * What refreshing one held copy writes, or null: `{ update, trackMax }`, where `update` is the
 * embedded-document update and `trackMax` is the new size of a track that was corrected smaller (the
 * stored pips are clamped to it). PURE but for the update-key helper.
 *
 * @param {object} item       the held copy
 * @param {object} entry      its pack entry (packEntryFor)
 * @param {object} [former]   that entry's former values, `{ [path]: hash[] }` (SUPERSEDED[entry._id])
 */
export function heldRefresh(item, entry, former = {}) {
	if (!entry || !refreshable(item) || isGear(entry) !== isGear(item)) return null;
	const spec = fieldsFor(item);
	const sets = formerSets(former);
	const wasShipped = (path, hash) => !!sets.get(path)?.has(hash);
	const mirrored = item.flags?.[ITEM_FLAG_SCOPE] ?? {};
	const update = {};
	// An object is MERGED into what is stored, at every depth, so a key the new value no longer has
	// (armor's old `modifier`, a field gone from inside one outcome tier) is deleted explicitly, the
	// way possession-grants.js#grantRepair deletes armor keys on these same embedded items.
	const write = (path, value, stored) => {
		update[path] = value;
		deleteStaleKeys(update, path, stored, value);
	};
	let trackMax = null;
	for (const [field, fieldSpec] of Object.entries(spec)) {
		// A write-up the GM wrote or edited is theirs (inventory-item-data.js WRITEUP_EDITED_FLAG).
		if (field === "artifactLore" && mirrored[WRITEUP_EDITED_FLAG]) continue;
		const held = fieldValue(item, field, spec);
		const value = refreshedValue(held, fieldValue(entry, field, spec), fieldSpec, wasShipped, field, { strictFill: isGear(item) });
		if (value === undefined) continue;
		write(`system.${field}`, value, item.system?.[field]);
		if (fieldSpec.mirror && field in mirrored) write(`flags.${ITEM_FLAG_SCOPE}.${field}`, value, mirrored[field]);
		if (field === "resource") {
			const was = Number(held?.max) || 0;
			const max = Number(value?.max) || 0;
			if (max && max < was) trackMax = max;
		}
	}
	if (!Object.keys(update).length) return null;
	// The release this copy was made under, kept before the write restamps it: the grandfather
	// sweeps ask it (made-under.js), and the server stamps `_stats.systemVersion` on any write to
	// `system`. Only the first refresh records it; later ones leave the original, even an empty one
	// (a copy older than `_stats`, which madeAtOrBefore reads as made before any release).
	if (item.flags?.[STONETOP_SCOPE]?.[MADE_UNDER_FLAG] == null) {
		update[`flags.${STONETOP_SCOPE}.${MADE_UNDER_FLAG}`] = String(item._stats?.systemVersion ?? "");
	}
	return { update: { _id: item._id ?? item.id, ...update }, trackMax };
}

/** The embedded update filling and correcting a held copy from its pack entry, or null. PURE. */
export function moveRefreshUpdate(item, entry, former) {
	return heldRefresh(item, entry, former)?.update ?? null;
}

/**
 * The world's Items-sidebar copy of a pack entry: by the compendium it came from where it says, else
 * by name. PURE.
 */
export function worldEntryFor(item, byName, byId) {
	const source = compendiumSourceParts(compendiumSourceOf(item));
	if (source) {
		// Copied from some other pack, it is not this pack's to refresh, whatever its name.
		if (source.pack !== ITEMS_PACK.split(".").pop()) return null;
		const entry = byId.get(source.id);
		if (entry) return isGear(entry) === isGear(item) ? entry : null;
	}
	return packEntryFor(item, byName);
}

/**
 * Refresh every character's held moves and gear, and the Items sidebar's treasures and gear. Throws
 * when the pack cannot be read, so the once-per-version gate retries on the next load instead of
 * stamping a sweep that never looked.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @param {Iterable} [options.items]       the Items sidebar
 * @param {object[]} [options.entries]     the pack's index (tests)
 * @param {object}   [options.superseded]  the former values (tests); the generated data otherwise
 * @param {boolean}  [options.dryRun]      plan only: return what would be written
 * @returns {Promise<number|object[]>}  how many characters (and the sidebar) were written to, or the plan
 */
export async function refreshHeldMoves({
	actors = globalThis.game?.actors ?? [], items = globalThis.game?.items ?? [],
	entries = null, superseded = null, dryRun = false,
} = {}) {
	let index = entries;
	if (!index) {
		const pack = await ensurePackIndex(ITEMS_PACK, INDEX_FIELDS);
		if (!pack) throw new Error(`the ${ITEMS_PACK} pack is not available`);
		index = [...pack.index];
	}
	const former = superseded ?? await loadGenerated(() => import("./data/superseded-move-fields.js"), {
		formatKey: "SUPERSEDED_FORMAT", expected: SUPERSEDED_FORMAT, exportName: "SUPERSEDED",
		stale: "the superseded-values data is out of date; held copies are only filled, not corrected",
	});
	const byName = packMovesByName(index);
	const byId = new Map(index.filter(e => e?.type === "move").map(e => [e._id, e]));
	const formerOf = entry => former[entry?._id] ?? {};
	const plan = [];
	const failures = new SweepFailures("refreshing held moves");

	for (const actor of actors) {
		if (actor?.type !== "character") continue;
		const refreshed = [];
		for (const item of actor.items ?? []) {
			const entry = packEntryFor(item, byName);
			const r = heldRefresh(item, entry, formerOf(entry));
			if (r) refreshed.push({ item, ...r });
		}
		if (!refreshed.length) continue;
		plan.push({ where: actor.name, updates: refreshed.map(r => r.update) });
		if (dryRun) continue;
		await failures.attempt(actor.name, async () => {
			// Quiet in the ledger: the pack's text refreshed, not an edit anybody made.
			await actor.updateEmbeddedDocuments("Item", refreshed.map(r => r.update), { stonetopLedger: true });
			// A track the pack made smaller keeps no more pips than it now has.
			const clamp = actor.typedActor?.heldTrackClampData?.(refreshed
				.filter(r => r.trackMax != null)
				.map(r => ({ item: r.item, max: r.trackMax })));
			if (clamp) await actor.update(clamp, { stonetopLedger: true });
		});
	}

	const sidebar = [];
	for (const item of items ?? []) {
		const entry = worldEntryFor(item, byName, byId);
		const r = heldRefresh(item, entry, formerOf(entry));
		if (r) sidebar.push(r.update);
	}
	if (sidebar.length) {
		plan.push({ where: "the Items sidebar", updates: sidebar });
		if (!dryRun) await failures.attempt("the Items sidebar", () => globalThis.Item.updateDocuments(sidebar));
	}
	failures.throwIfAny();
	return dryRun ? plan : plan.length;
}
