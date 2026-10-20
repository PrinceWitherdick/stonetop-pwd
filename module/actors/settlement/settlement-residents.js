// A settlement's Residents follow each NPC's Home.
//
// HOME IS THE ONE THING SET. An NPC whose Home names a settlement ("Gordin's Delve") is on that
// settlement's Residents table, wherever they were made (the sidebar's Create a Person, Stonetop's
// Neighbors "+ Add", a background's neighbor, the settlement's own Add Resident); an NPC whose Home
// names anywhere else is on none. Changing a Home moves them, and the settlement sheet's own
// controls (a drop, the remove cross) work by changing the Home rather than the table, so the table
// and the NPC's sheet can never say two different things. The user's call, 2026-10-20.
//
// Who writes: the primary GM, from the actor hooks below, so a player's new neighbor reaches a
// settlement they can only read. A connected GM only (isResidentsWriter): with none, isPrimaryGM()
// is true on every client, and each would write whole Residents lists from its own copy. The
// settlement sheet also syncs straight away for its own user, which keeps a GM-less session working
// for an owner; both paths are idempotent and queue through editSettlementList, so running twice
// changes nothing.
//
// A RENAMED SETTLEMENT KEEPS ITS PEOPLE. The rename itself writes the old name into
// `system.formerNames` (onPreUpdateActorForResidents), and a Home that still says a former name
// counts as this settlement's (settlementForHome) until it has been re-homed. The renaming client
// re-homes the NPCs it may write and the primary GM the rest, now or on its next load; a former
// name is forgotten once no Home says it. So a player who renames a sheet whose residents they
// don't own leaves the table as it was, rather than emptying it.
//
// Old worlds, and a settlement made after its people: sweepSettlementResidents, on every load of the
// primary GM and whenever a settlement is created. Stonetop's own Residents and Neighbors rosters
// are not touched here: a Neighbor from the Delve is on both, which is what the two lists mean.
//
// Several settlements with the same name: the first in the world's actor list takes the people. A
// sheet RENAMED onto a name another settlement already goes by keeps its people under its old name
// (settleRenames leaves their Homes alone) until it is given a name of its own.

import { isPrimaryGM } from "../../utils/primary-gm.js";
import { inTurn } from "../../utils/turn-queue.js";
import { isSettlementActor, settlementActors } from "./settlement-type.js";
import { settlementRow } from "./settlement-rows.js";
import { format } from "../../utils/i18n.js";

/** Where a settlement keeps the names it was renamed away from, until its people's Homes catch up. */
export const FORMER_NAMES_PATH = "system.formerNames";

/**
 * A Home or a settlement's name as the two are matched: case, spacing, curly apostrophes and a
 * leading "The" don't count, so "gordin’s delve" is Gordin's Delve and "Steplands" is The Steplands.
 */
export function homeKey(text) {
	return String(text ?? "")
		.normalize("NFKC")
		.replace(/[‘’ʼ`]/g, "'")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/^the /, "");
}

/**
 * settlementForHome for many Homes at once: each settlement's names are keyed once, so a sweep over
 * every NPC costs one lookup per Home rather than a pass over every settlement's names.
 */
export function settlementResolver(settlements = settlementActors()) {
	const byName = new Map(), byFormer = new Map();
	for (const s of settlements) {
		const key = homeKey(s.name);
		if (key && !byName.has(key)) byName.set(key, s);
		for (const former of s.system?.formerNames ?? []) {
			const fk = homeKey(former);
			if (fk && !byFormer.has(fk)) byFormer.set(fk, s);
		}
	}
	return home => {
		const key = homeKey(home);
		return key ? byName.get(key) ?? byFormer.get(key) ?? null : null;
	};
}

/**
 * The settlement a Home names, or null (blank is Stonetop, which is not a settlement). A settlement's
 * current name first; failing that, one that was renamed away from it and still has people there.
 */
export function settlementForHome(home, settlements = settlementActors()) {
	return settlementResolver(settlements)(home);
}

/** Whether a settlement's own name finds it, rather than an earlier settlement of the same name. */
export function ownsItsName(settlement, settlements = settlementActors()) {
	return settlementForHome(settlement?.name, settlements) === settlement;
}

/**
 * Whether this client files Residents from the hooks and the load sweep: the primary GM, and only a
 * GM, since isPrimaryGM() answers true on every client when no GM is connected.
 */
export const isResidentsWriter = () => !!globalThis.game?.user?.isGM && isPrimaryGM();

/** A world NPC: not a compendium's, not a token's synthetic copy. */
export function isWorldNpc(actor) {
	return actor?.type === "npc" && !actor.pack && !actor.isToken && !!actor.uuid;
}

const residentRow = (settlement, npc) => (settlement?.system?.residents ?? []).find(r => r?.uuid === npc.uuid) ?? null;
const listsNpc = (settlement, npc) => !!residentRow(settlement, npc);

// ── Writing a list ───────────────────────────────────────────────────────────────

/**
 * Read one of a settlement's lists, change it, write it whole; `edit` returning false skips the
 * write. The rows are deep copies, so an edit may change a row's own nested rows (a plan's
 * requirements) without touching the document's data before the write. Resolves to whether it wrote. The writes take turns per settlement (utils/turn-queue.js):
 * the document only takes a write in when the server answers, so a second edit read while the first
 * was still out would start from the old rows and write the first one away. The sheet's own list
 * edits come through here too, so a hook's write and a click's write never interleave.
 */
export function editSettlementList(settlement, list, edit) {
	return inTurn(`settlement:${settlement.uuid ?? settlement.id}`, async () => {
		const rows = foundry.utils.deepClone(settlement.system?.[list] ?? []);
		if (edit(rows) === false) return false;
		await settlement.update({ [`system.${list}`]: rows });
		return true;
	});
}

// ── Keeping them in step ─────────────────────────────────────────────────────────

/**
 * Put one NPC on the Residents table their Home names, and off every other, their row carrying the
 * name they go by now (the row's cached name is what the table shows once the NPC is gone). Only
 * settlements this user may write are touched. Resolves to whether anything was written.
 */
export async function syncResidentHome(npc, { settlements = settlementActors() } = {}) {
	if (!isWorldNpc(npc)) return false;
	const home = settlementForHome(npc.system?.home, settlements);
	let wrote = false;
	for (const settlement of settlements) {
		if (settlement === home || !settlement.isOwner || !listsNpc(settlement, npc)) continue;
		wrote = await editSettlementList(settlement, "residents", rows => {
			const kept = rows.filter(r => r?.uuid !== npc.uuid);
			if (kept.length === rows.length) return false;
			rows.splice(0, rows.length, ...kept);
		}) || wrote;
	}
	const listed = home ? residentRow(home, npc) : null;
	if (home?.isOwner && (!listed || listed.name !== npc.name)) {
		wrote = await editSettlementList(home, "residents", rows => {
			const row = rows.find(r => r?.uuid === npc.uuid);
			if (!row) return void rows.push(settlementRow("residents", { uuid: npc.uuid, name: npc.name }));
			if (row.name === npc.name) return false;
			row.name = npc.name;
		}) || wrote;
	}
	return wrote;
}

/**
 * `settlement`'s Residents `rows` as the world's Homes say they should be, or null when they already
 * are. Pure. A row whose NPC is gone keeps its place (the table shows its cached name, as Stonetop's
 * does), as does one whose uuid is in `keep` (a Home the sweep could not write), and the rows
 * already there keep their order and ids, each taking its NPC's name now; newcomers go on the end. `homeOf`, each NPC's uuid to the
 * settlement its Home names, is built here when not given.
 */
export function plannedResidents(rows, settlement, npcs, settlements, { homeOf = null, keep = null } = {}) {
	const byUuid = new Map(npcs.map(npc => [npc.uuid, npc]));
	if (!homeOf) {
		const resolve = settlementResolver(settlements);
		homeOf = new Map(npcs.map(npc => [npc.uuid, resolve(npc.system?.home)]));
	}
	const belongs = npc => homeOf.get(npc.uuid) === settlement;
	const kept = rows.filter(row => {
		const npc = byUuid.get(row?.uuid);
		return !npc || keep?.has(npc.uuid) || belongs(npc);
	});
	const listed = new Set(kept.map(r => r?.uuid));
	const added = npcs.filter(npc => belongs(npc) && !listed.has(npc.uuid))
		.map(npc => settlementRow("residents", { uuid: npc.uuid, name: npc.name }));
	const renamed = kept.some(r => { const npc = byUuid.get(r?.uuid); return npc && r.name !== npc.name; });
	if (!added.length && !renamed && kept.length === rows.length) return null;
	return [...kept.map(r => {
		const npc = byUuid.get(r?.uuid);
		return npc ? { ...r, name: npc.name } : { ...r };
	}), ...added];
}

/**
 * A renamed settlement's people, re-homed: every NPC whose Home still says one of its former names
 * takes its name now, as far as this user may write them. A former name is forgotten once no Home
 * says it, or once another settlement goes by it (whose people they then are). Resolves to whether
 * any former name is still waiting on someone this user could not write. Nobody moves while an
 * earlier settlement goes by this one's new name: their Homes would name that one, and this sheet
 * would empty, so they keep the old name (which still finds this sheet) until it has its own.
 */
export async function settleRenames(settlement, { actors = globalThis.game?.actors } = {}) {
	const former = settlement?.system?.formerNames ?? [];
	if (!former.length) return false;
	const settlements = settlementActors(actors);
	if (!ownsItsName(settlement, settlements)) return true;
	const npcs = actors?.filter?.(isWorldNpc) ?? [];
	const here = homeKey(settlement.name);
	const left = [];
	for (const name of former) {
		const key = homeKey(name);
		if (!key || key === here || settlements.some(s => homeKey(s.name) === key)) continue;
		let stuck = false;
		for (const npc of npcs.filter(n => homeKey(n.system?.home) === key)) {
			const moved = npc.isOwner && await npc.update({ "system.home": settlement.name }).then(() => true, err => {
				console.warn("Stonetop | Could not move the Home of", npc.name, err);
				return false;
			});
			if (!moved) stuck = true;
		}
		if (stuck) left.push(name);
	}
	if (left.length !== former.length && settlement.isOwner) {
		await settlement.update({ [FORMER_NAMES_PATH]: left })
			.catch(err => console.warn("Stonetop | Could not forget the former names of", settlement.name, err));
	}
	return left.length > 0;
}

/**
 * Bring every settlement (or just `only`) into step with the world's Homes, one write per
 * settlement that needs one. First, on a full sweep, the people of a renamed settlement are
 * re-homed (settleRenames). Then an NPC listed on a settlement with a BLANK Home (linked before
 * Homes were the rule) takes that settlement's name, so a sweep files them where they were rather
 * than taking them off. `adoptHomes`, once per world: the same for a listed NPC whose Home names no
 * settlement at all ("Stonetop", "North Manmarch"), since the old sheet listed people without
 * touching a Home already written. Resolves to how many settlements were written.
 */
export async function sweepSettlementResidents({ actors = globalThis.game?.actors, only = null, adoptHomes = false } = {}) {
	const settlements = settlementActors(actors);
	if (!settlements.length) return 0;
	const targets = only ? [only] : settlements;
	if (!only) {
		for (const settlement of settlements) {
			await settleRenames(settlement, { actors })
				.catch(err => console.warn("Stonetop | Could not re-home the people of", settlement.name, err));
		}
	}
	const npcs = (actors?.filter?.(isWorldNpc) ?? []);
	const resolveBefore = settlementResolver(settlements);
	// A listed NPC whose Home could not be given the table's name keeps their row, rather than being
	// taken off for a Home that still names nowhere: a failed write, or a table whose name an earlier
	// settlement goes by (that Home would file them there).
	const keep = new Set();
	for (const npc of npcs) {
		if (!npc.isOwner) continue;
		const home = String(npc.system?.home ?? "").trim();
		if (home && !(adoptHomes && !resolveBefore(home))) continue;
		const listing = targets.find(s => listsNpc(s, npc));
		if (!listing) continue;
		if (resolveBefore(listing.name) !== listing) { keep.add(npc.uuid); continue; }
		const moved = await npc.update({ "system.home": listing.name }).then(() => true, err => {
			console.warn("Stonetop | Could not set the resident's Home for", npc.name, err);
			return false;
		});
		if (!moved) keep.add(npc.uuid);
	}
	const resolve = settlementResolver(settlements);
	const homeOf = new Map(npcs.map(npc => [npc.uuid, resolve(npc.system?.home)]));
	let wrote = 0;
	for (const settlement of targets) {
		if (!settlement.isOwner) continue;
		const did = await editSettlementList(settlement, "residents", rows => {
			const planned = plannedResidents(rows, settlement, npcs, settlements, { homeOf, keep });
			return planned ? void rows.splice(0, rows.length, ...planned) : false;
		}).catch(err => { console.warn("Stonetop | Could not file the residents of", settlement.name, err); return false; });
		if (did) wrote++;
	}
	return wrote;
}

/**
 * A settlement renamed: its residents' Homes say the new name, so they stay where they are, and
 * anyone whose Home already said the new name joins them. In that order: a sweep run first would
 * see the old name's people as this settlement's only because of `formerNames`, and re-homing first
 * lets that name be forgotten.
 */
async function rehomeOnRename(settlement) {
	await settleRenames(settlement);
	await sweepSettlementResidents({ only: settlement });
}

// ── Hooks ────────────────────────────────────────────────────────────────────────

/**
 * `preUpdateActor`: a settlement being renamed remembers the name it had, in the same write, so no
 * client ever sees the new name while its people's Homes still say only the old one.
 */
export function onPreUpdateActorForResidents(actor, changed) {
	if (!isSettlementActor(actor) || typeof changed?.name !== "string") return;
	const from = homeKey(actor.name), to = homeKey(changed.name);
	if (!from || from === to) return;
	const seen = new Set([to]);
	const kept = [...(actor.system?.formerNames ?? []), actor.name].filter(name => {
		const key = homeKey(name);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	globalThis.foundry?.utils?.setProperty?.(changed, FORMER_NAMES_PATH, kept);
}

/** `createActor`: a new NPC goes on the table its Home names; a new settlement gathers its people. */
export function onCreateActorForResidents(actor) {
	if (!isResidentsWriter()) return;
	const run = isWorldNpc(actor) ? syncResidentHome(actor)
		: isSettlementActor(actor) ? sweepSettlementResidents({ only: actor })
		: null;
	run?.catch(err => console.error("Stonetop | settlement residents failed", err));
}

/**
 * `updateActor`: a Home changed moves the NPC, and a name changed follows onto their row; a settlement renamed keeps its people, re-homed by
 * the renaming client (for a GM-less session) and by the primary GM (for the NPCs a player can't
 * write). Both are idempotent. A rename onto a name an earlier settlement goes by tells the renaming
 * user why its people have not moved to the new name.
 */
export function onUpdateActorForResidents(actor, changed, _options, userId) {
	const has = globalThis.foundry?.utils?.hasProperty;
	if (!has) return;
	const mine = userId === globalThis.game?.user?.id;
	let run = null;
	if (isWorldNpc(actor) && (has(changed, "system.home") || typeof changed?.name === "string") && isResidentsWriter()) run = syncResidentHome(actor);
	else if (isSettlementActor(actor) && typeof changed?.name === "string" && (mine || isResidentsWriter())) {
		if (mine && !ownsItsName(actor)) {
			globalThis.ui?.notifications?.warn?.(format("stonetop.settlement.renameSharedName", { place: actor.name }));
		}
		run = rehomeOnRename(actor);
	}
	run?.catch(err => console.error("Stonetop | settlement residents failed", err));
}
