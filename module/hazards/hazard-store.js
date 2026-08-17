// CRUD for hazards. Deliberately the same architecture as threats (see threat-store.js
// for the full rationale): every hazard is a `hazard` page of ONE hidden JournalEntry
// named "<Steading> Hazards", pointed at by the steading flag `steading.hazardsEntryId`.
// Hazards are pure GM prep — never shared with players — so the entry stays NONE-owned
// and a single many-page journal leaks nothing.
//
// The entry/list/create/rename CRUD is shared with threats through makeGmPrepPageStore;
// the doom-track helpers (setPortentDone / setDoomDone) and the delete helper in
// threat-store are page-shape generic, so hazards reuse them directly.
import { makeGmPrepPageStore } from "../journal/gm-prep-page-store.js";

/** Normalize a creator/editor payload into the hazard page's system data. */
export function shapeHazardSystem(seed = {}) {
	return {
		description: String(seed.description ?? ""),
		damageDie: seed.damageDie ?? "",
		damageEffects: (seed.damageEffects ?? []).map(String),
		damageExtra: String(seed.damageExtra ?? ""),
		certainDeath: !!seed.certainDeath,
		instinct: String(seed.instinct ?? ""),
		gmMoves: (seed.gmMoves ?? []).map(String),
		advanceTrigger: String(seed.advanceTrigger ?? ""),
		grimPortents: (seed.grimPortents ?? []).map(p => ({ text: String(p?.text ?? ""), done: !!p?.done })),
		impendingDoom: { text: String(seed.impendingDoom?.text ?? ""), done: !!seed.impendingDoom?.done },
		customPlayerMoves: (seed.customPlayerMoves ?? []).map(m => ({ label: String(m?.label ?? ""), text: String(m?.text ?? "") })),
	};
}

const _store = makeGmPrepPageStore({
	pageType: "hazard",
	entryFlag: "hazard",
	entryFlagId: "hazardsEntryId",
	entrySuffix: "Hazards",
	defaultName: "New Hazard",
	shapeSystem: shapeHazardSystem,
});

/** The id of the steading's Hazards journal, if one has been created. */
export const hazardsEntryId = _store.entryId;
/** Resolve the steading's Hazards journal, or null. Never creates. */
export const getHazardsEntry = _store.getEntry;
/** Resolve a `hazard` page from an entry/page id pair (as a scene Note links it), or null. */
export const hazardPageById = _store.pageById;
/** The steading's hazard pages, in order. */
export const listHazardPages = _store.listPages;
/** Resolve the steading's Hazards journal, creating it (GM-only) on first use. */
export const ensureHazardsEntry = _store.ensureEntry;
/** Create a new hazard as a page on the steading's Hazards journal. */
export const createHazard = _store.create;
/** Rename a hazard everywhere its name is its identity: the page and its scene pins. */
export const setHazardName = _store.setName;

// No `deleteHazard`. Deleting carries no hazard-specific logic — it removes a page, its scene
// pins and an emptied journal — so it is `deleteGmPrepPage` in gm-prep-page-store.js, which is
// where callers reach it. An alias here would be a second name for one behaviour, offered from
// the one module a caller with a hazard in hand would find first.
