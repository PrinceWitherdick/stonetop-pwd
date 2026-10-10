// CRUD for threats. Every threat is a `threat` page of ONE hidden JournalEntry named
// "<Steading> Threats"; the steading actor holds a pointer flag to that entry
// (`steading.threatsEntryId`).
//
// Threats are pure GM prep: they are never shared with players (there is no per-threat
// "reveal"), so the entry's `ownership.default` stays NONE and the whole "Threats &
// Dangers" tab, its scene pins, and the canvas overlay are GM-only. That is why a single
// many-page journal is fine here: Foundry v14 broadcasts a whole JournalEntry to any
// client that can observe any page in it, but since no page is ever observable to a
// player, nothing leaks (see reference_foundry-world-docs-broadcast). Dropped scene pins
// are GM-only markers for the same reason.
//
// The entry/list/create/rename CRUD is shared with hazards through makeGmPrepPageStore;
// the doom-tick and delete helpers below are page-shape generic, so hazards reuse them
// directly rather than duplicating.
import { makeGmPrepPageStore } from "../journal/gm-prep-page-store.js";
import { inTurn } from "../utils/turn-queue.js";
import { DEFAULT_THREAT_TYPE, DEFAULT_PROXIMITY, normalizeThreatSeedExtras } from "./threat-types.js";

/** Normalize a creation seed into the threat page's system data. The plain threat creator
 *  only supplies type / instinct / proximity / gmMoves; every other field is left to the
 *  model's own defaults and authored in the editor. The Things-Below wizards (Book II) seed
 *  richer fields — themes / aspects / cleansing / a pre-built doom track / prose — which are
 *  copied through only when present, so an ordinary threat seed is unaffected. */
function _shapeSeed(seed) {
	return {
		type: seed.type ?? DEFAULT_THREAT_TYPE,
		instinct: String(seed.instinct ?? ""),
		proximity: seed.proximity ?? DEFAULT_PROXIMITY,
		gmMoves: (seed.gmMoves ?? []).map(String),
		...normalizeThreatSeedExtras(seed),
	};
}

const _store = makeGmPrepPageStore({
	pageType: "threat",
	entryFlag: "threat",
	entryFlagId: "threatsEntryId",
	entrySuffix: "Threats",
	defaultName: "New Threat",
	shapeSystem: _shapeSeed,
});

/** The id of the steading's Threats journal, if one has been created. */
export const threatsEntryId = _store.entryId;
/** Resolve the steading's Threats journal, or null. Never creates. */
export const getThreatsEntry = _store.getEntry;
/** Resolve a `threat` page from an entry/page id pair (as a scene Note links it), or null. */
export const threatPageById = _store.pageById;
/** The steading's threat pages, in order. */
export const listThreatPages = _store.listPages;
/** Resolve the steading's Threats journal, creating it (GM-only) on first use. */
export const ensureThreatsEntry = _store.ensureEntry;
/** Create a new threat as a page on the steading's Threats journal. */
export const createThreat = _store.create;
/** Rename a threat everywhere its name is its identity: the page and its scene pins. */
export const setThreatName = _store.setName;

// Doom-track writes take turns, per page (turn-queue.js#inTurn). A portent tick replaces the WHOLE
// array (see below), so two ticks fired inside one server round trip would each start from the same
// stale copy and the second would silently untick the first. Taking turns makes every write start
// only once the one before it has landed, and each one reads the array fresh at that moment rather
// than when its click happened.
function _queueDoomWrite(page, write) {
	return inTurn(`doom:${page.uuid ?? page.id ?? ""}`, write);
}

/** Tick / untick a grim portent's "come to pass" checkbox (full-array replace, since
 *  dotted array-index updates are unreliable on DataModel ArrayFields). Queued per page and
 *  rebuilt from the page as it stands when the write runs. */
export async function setPortentDone(page, index, done) {
	if (!page) return;
	if (!Number.isInteger(index) || index < 0) return;
	return _queueDoomWrite(page, async () => {
		const arr = foundry.utils.deepClone(page.system?.grimPortents ?? []);
		if (index >= arr.length) return;
		if (!!arr[index]?.done === !!done) return;
		arr[index] = { ...arr[index], done: !!done };
		await page.update({ "system.grimPortents": arr });
	});
}

/** Tick / untick the impending-doom checkbox. Queued behind any portent write on the same page. */
export async function setDoomDone(page, done) {
	if (page) return _queueDoomWrite(page, () => page.update({ "system.impendingDoom.done": !!done }));
}

/**
 * Delete a threat: its page, and any scene Note pins linked to it.
 *
 * Nothing threat-specific about it — deleting is page-shaped, so it is `deleteGmPrepPage` in the
 * store factory, beside the rest of the CRUD all three families share. Kept as a name here for
 * the callers that have a threat in hand and read better saying so.
 */
export { deleteGmPrepPage as deleteThreat } from "../journal/gm-prep-page-store.js";
