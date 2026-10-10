// Bring the monsters seeded into the world up to the bestiary pack.
//
// SeedActors.js copies every stat block into the Actors sidebar once, when the world is set up, and
// nothing revisits the copies. Two readers then PREFER the world copy over the pack: Deploy and Start
// a Fight reuse it (utils/deployable-actor.js), and the monster browser lets it hide the pack's row
// (dialogs/catalog/MonsterSource.js). So a correction to a stat block never reached a seeded world:
// 90 monster moves kept a core icon that does not exist (fixed in the pack 2026-08-16), the Specter
// kept "lacks vitals", and any later fix to HP, armor or damage would have been hidden the same way.
//
// THE SAME RULE AS THE HELD MOVES (move-refresh.js): a field is brought up to date only while it
// still holds a value the pack itself shipped at some earlier commit (listed by
// scripts/gen-superseded-fields.js from git history), so a GM's edit to a monster is never touched.
// A monster is matched to its pack entry by the compendium source the seed stamped on it, and its
// moves by id (the seed keeps them), else by name. Moves are only corrected: one the GM deleted is
// not put back, and one they added is never matched. The one exception is a move the pack RETIRED
// because the book never printed it (RETIRED_BESTIARY_MOVES), taken off a copy still holding it as shipped. Current HP is play, not the stat block: it moves
// with max HP only on a monster that is unhurt.

import { BESTIARY_PACK } from "../system-id.js";
import { compendiumSourceOf } from "../utils/foundry-compat.js";
import {
	valueHash, sameValue, valueAt as at, compendiumSourceParts, loadGenerated, SUPERSEDED_FORMAT,
} from "./superseded-values.js";
import { hashString, stableStringify } from "../hooks/journal-sync-core.js";
import { SweepFailures } from "./sweep-failures.js";

/** The stat-block fields refreshed on a monster. Not `hp.value`, which is play (see above). */
export const MONSTER_PATHS = [
	"system.attributes.hp.max", "system.attributes.armor.value", "system.attributes.armor.source",
	"system.attributes.damage.value", "system.attributes.damage.rollFormula", "system.attributes.instinct.value",
	"system.concept", "system.organization", "system.size", "system.tags", "system.qualities", "system.count",
	"system.entry", "system.notes", "system.creatureType",
];

/** The fields refreshed on each of a monster's moves. */
export const MONSTER_MOVE_PATHS = ["name", "img", "system.description", "system.rollFormula"];

/** A value's hash, exactly: 0 and false are values on a stat block, not absences. PURE. */
export const statHash = value => valueHash(value, { top: false });

/**
 * The updates bringing one document's fields up to `entry`, as `{ path: value }`, or null. PURE.
 *
 * @param {object} held      the world's copy
 * @param {object} entry     the pack's
 * @param {string[]} paths   the fields to compare
 * @param {object} [former]  `{ [path]: hash[] }`, every earlier shipped value
 */
export function fieldRefresh(held, entry, paths, former = {}) {
	const update = {};
	for (const path of paths) {
		const was = at(held, path);
		const now = at(entry, path);
		if (sameValue(was, now, { top: false })) continue;
		if (former?.[path]?.includes(statHash(was))) update[path] = structuredClone(now ?? null);
	}
	return Object.keys(update).length ? update : null;
}

/** The pack id a world monster was seeded from, or null. PURE. */
export function bestiarySourceId(actor) {
	const source = compendiumSourceParts(compendiumSourceOf(actor));
	return source?.pack === BESTIARY_PACK.split(".").pop() && source.type === "Actor" ? source.id : null;
}

/**
 * Moves the pack once shipped and no longer does, because the book never printed them, by pack _id:
 * each `{ _id, name }` as it shipped. A seeded copy still holding one under that id AND that name is
 * a copy nobody touched, and loses it; a renamed one is the GM's and stays.
 *
 * The Crinwin's "Choke with sinewy fingers" was written for the hand-made reference Crinwin. Its
 * printed moves are three: mimic noises, hide or vanish, snatch and dart away (Book I p.390,
 * Book II p.61), and its choking is already its Damage line ("claws, rocks, choking d6 (hand)").
 */
export const RETIRED_BESTIARY_MOVES = {
	F0SuxRtw6dqB6Nvh: [{ _id: "HwT4Rew3fxkzRx6m", name: "Choke with sinewy fingers" }],
};

/**
 * What refreshing one seeded monster writes: `{ actor, items }`, the actor update and the embedded
 * move updates, plus `deletes` (move ids) when a retired move is still held as shipped; or null. PURE.
 *
 * @param {object} held     the world monster
 * @param {object} entry    its pack entry, items included
 * @param {object} former   SUPERSEDED_BESTIARY[entry._id]: `{ paths, items: { [itemId]: paths } }`
 * @param {Array<{_id: string, name: string}>} [retired]  RETIRED_BESTIARY_MOVES[entry._id]
 */
export function monsterRefresh(held, entry, former = {}, retired = RETIRED_BESTIARY_MOVES[entry?._id] ?? []) {
	if (!held || !entry) return null;
	const actor = fieldRefresh(held, entry, MONSTER_PATHS, former.paths) ?? {};
	// An unhurt monster stays unhurt at its new size; a hurt one keeps its wounds, and only comes down
	// to a smaller max it would otherwise sit above (MonsterModel does not clamp).
	const maxPath = "system.attributes.hp.max";
	if (maxPath in actor) {
		const hp = Number(at(held, "system.attributes.hp.value"));
		const max = Number(actor[maxPath]);
		if (hp === Number(at(held, maxPath)) || hp > max) actor["system.attributes.hp.value"] = max;
	}
	const packMoves = entry.items ?? [];
	const items = [];
	const deletes = [];
	for (const move of held.items ?? []) {
		const id = move._id ?? move.id;
		const gone = retired.find(r => r._id === id && r.name === move.name);
		if (gone && !packMoves.some(m => m._id === id)) { deletes.push(id); continue; }
		const source = packMoves.find(m => m._id === id) ?? packMoves.find(m => m.name === move.name);
		if (!source) continue;
		const update = fieldRefresh(move, source, MONSTER_MOVE_PATHS, former.items?.[source._id]);
		if (update) items.push({ _id: id, ...update });
	}
	if (!Object.keys(actor).length && !items.length && !deletes.length) return null;
	return { actor: Object.keys(actor).length ? actor : null, items, ...(deletes.length ? { deletes } : {}) };
}

/**
 * Refresh every monster seeded from the bestiary pack. Per version, from Ready. Throws when the pack
 * cannot be read, so the gate retries on the next load.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @param {(ids: string[]) => Promise<object[]>} [options.getEntries]  the pack's documents (tests)
 * @param {object} [options.superseded]  the former values (tests); the generated data otherwise
 * @returns {Promise<number>} how many monsters were written to
 */
export async function refreshSeededMonsters({ actors = globalThis.game?.actors ?? [], getEntries = null, superseded = null } = {}) {
	// Monsters only: an actor of another kind carrying a bestiary source (an NPC built off a stat
	// block) has a schema of its own, and is not a seeded copy of the pack's.
	const seeded = [...actors].filter(actor => actor?.type === "monster")
		.map(actor => ({ actor, id: bestiarySourceId(actor) })).filter(s => s.id);
	if (!seeded.length) return 0;
	const former = superseded ?? await loadGenerated(() => import("./data/superseded-bestiary.js"), {
		formatKey: "SUPERSEDED_FORMAT", expected: SUPERSEDED_FORMAT, exportName: "SUPERSEDED_BESTIARY",
		stale: "the superseded-bestiary data is out of date; seeded monsters are left as they are",
	});
	const ids = [...new Set(seeded.map(s => s.id))].filter(id => former[id] || RETIRED_BESTIARY_MOVES[id]);
	if (!ids.length) return 0;
	const entries = await (getEntries ?? readPack)(ids);
	const byId = new Map(entries.map(e => [e._id, e]));
	let written = 0;
	const failures = new SweepFailures("refreshing seeded monsters");
	for (const { actor, id } of seeded) {
		const r = monsterRefresh(actor, byId.get(id), former[id] ?? {});
		if (!r) continue;
		await failures.attempt(actor.name, async () => {
			if (r.actor) await actor.update(r.actor);
			if (r.items.length) await actor.updateEmbeddedDocuments("Item", r.items);
			if (r.deletes?.length) await actor.deleteEmbeddedDocuments("Item", r.deletes);
			written += 1;
		});
	}
	failures.throwIfAny();
	return written;
}

async function readPack(ids) {
	const pack = globalThis.game?.packs?.get(BESTIARY_PACK);
	if (!pack) throw new Error(`the ${BESTIARY_PACK} pack is not available`);
	const docs = await pack.getDocuments({ _id__in: ids });
	return docs.map(d => d.toObject());
}

/**
 * A fingerprint of everything refreshed on a stat block, as the generator saw it, so a pack edit
 * made since the data was generated is caught (tests/migration/superseded-data-fresh.test.js). PURE.
 */
export function monsterFingerprint(entry) {
	const fields = Object.fromEntries(MONSTER_PATHS.map(p => [p, statHash(at(entry, p))]));
	const moves = (entry.items ?? []).map(m => [m._id, ...MONSTER_MOVE_PATHS.map(p => statHash(at(m, p)))]);
	return hashString(stableStringify({ fields, moves }));
}
