// ── Chronicle journal plumbing ─────────────────────────────────────────────────
// Find-or-create for the shared "The Chronicle" folder, for a journal inside it, and the
// seed-and-top-up pass that turns compiled `{key, name, sections}` pages into real
// JournalEntryPages.
//
// Four things now build journals in that folder — the Player Introductions / Expeditions
// compiler (utils/chronicle.js), the Seasons Change record (seasons/seasons-chronicle.js),
// the Places of Interest pages (utils/places-chronicle.js) and the threat seed cards — and
// they must all find the SAME folder rather than each growing a lookup of its own. These
// used to live in chronicle.js, which made every one of them import the introductions
// compiler to create a folder; splitting them out is also what lets places-chronicle.js
// feed back into that compiler without an import cycle.

import { mergeChronicleSections, CHRONICLE_FOLDER_NAME, CHRONICLE_FOLDER_COLOR } from "./chronicle-core.js";
import { SYSTEM_ID } from "../system-id.js";

// Per-page flag holding the change-detection hash of each prose section's body as WE last
// wrote it (keyed by heading). Lets seedChroniclePages keep a still-pristine section
// syncing with the source while freezing one the GM has edited in the journal.
export const CHRONICLE_PROSE_FLAG = "chronicleProse";

/**
 * Find (or create) the "The Chronicle" journal folder that holds the introductions,
 * expeditions, Seasons Change and Places of Interest journals.
 */
export async function ensureChronicleFolder() {
	return findChronicleFolder()
		?? await Folder.create({ name: CHRONICLE_FOLDER_NAME, type: "JournalEntry", color: CHRONICLE_FOLDER_COLOR })
		?? null;
}

/**
 * The Chronicle folder if this world has one, or null. Read-only — creates nothing, for the
 * lookups that must not conjure a folder just by asking (a player resolving a map pin's link).
 *
 * The one place this lookup is spelled: every journal that lives in the Chronicle has to find
 * the SAME folder, and a second copy is how the seeding path and the reading path end up
 * disagreeing the day the folder is renamed or nested.
 */
export function findChronicleFolder() {
	return (game.folders?.contents ?? [])
		.find(f => f.type === "JournalEntry" && f.name === CHRONICLE_FOLDER_NAME) ?? null;
}

/**
 * Find (or create) a journal named `name` inside `folder`. `ensureObserver` opens a
 * pre-existing GM-only entry to players (the introductions and places journals); the
 * expeditions journal is left at whatever ownership the GM set.
 */
export async function ensureChronicleJournal(name, folderId, defaultOwnership, { ensureObserver = false } = {}) {
	const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
	let entry = (game.journal?.contents ?? []).find(j => j.folder?.id === folderId && j.name === name) ?? null;
	if (!entry) {
		entry = await JournalEntry.create({ name, folder: folderId, ownership: { default: defaultOwnership } });
	} else if (ensureObserver && (entry.ownership?.default ?? 0) < OBSERVER) {
		await entry.update({ "ownership.default": OBSERVER });
	}
	return entry;
}

/**
 * Seed + top up: create the pages whose key isn't present yet (appended after the
 * journal's current pages), and for an already-seeded page fold in only content recorded
 * since — new sections, and new Q&A pairs (see mergeChronicleSections) — so a part-way or
 * later-session save isn't silently dropped. Existing/edited sections are preserved, so
 * inline edits still survive re-saves. Returns { created, updated } counts.
 */
export async function seedChroniclePages(entry, pages, { adoptLegacyKeys = null } = {}) {
	if (!entry || !pages.length) return { created: 0, updated: 0 };
	const existingByKey = new Map();
	let maxSort = 0;
	for (const page of entry.pages ?? []) {
		const key = page.getFlag?.(SYSTEM_ID, "chronicleKey");
		if (key) existingByKey.set(key, page);
		maxSort = Math.max(maxSort, Number(page.sort) || 0);
	}
	const toCreate = [];
	const toUpdate = [];
	let sort = maxSort;
	for (const page of pages) {
		const existing = existingByKey.get(page.key);
		if (existing) {
			// Already seeded — merge in any sections/pairs recorded since, and refresh
			// still-pristine prose to the latest source (so a player's introduction fills in
			// live as they type; a hand-edited section is left alone — see
			// mergeChronicleSections). toObject() gives plain data the merge can spread and
			// the update can store back; the per-heading prose hashes ride in a page flag.
			const current = existing.toObject().system?.sections ?? [];
			const proseManaged = existing.getFlag?.(SYSTEM_ID, CHRONICLE_PROSE_FLAG) ?? {};
			// A page in `adoptLegacyKeys` is being authored live right now, so its untracked
			// (pre-hash) prose may be taken over by the current text — see mergeChronicleSections.
			const adoptLegacy = adoptLegacyKeys ? adoptLegacyKeys.has(page.key) : false;
			const merged = mergeChronicleSections(current, page.sections, { proseManaged, adoptLegacy });
			if (merged.added) toUpdate.push({
				_id: existing.id,
				"system.sections": merged.sections,
				[`flags.${SYSTEM_ID}.${CHRONICLE_PROSE_FLAG}`]: merged.proseManaged,
			});
			continue;
		}
		sort += 10;
		// Stamp the initial prose hashes so subsequent saves can tell this seed from a
		// later hand edit (merge with an empty page fingerprints every prose section).
		const { proseManaged } = mergeChronicleSections([], page.sections);
		toCreate.push({
			name:   page.name,
			type:   "chronicle",
			sort,
			system: { sections: page.sections },
			flags:  { [SYSTEM_ID]: { chronicleKey: page.key, [CHRONICLE_PROSE_FLAG]: proseManaged } },
		});
	}
	if (toCreate.length) await entry.createEmbeddedDocuments("JournalEntryPage", toCreate);
	if (toUpdate.length) await entry.updateEmbeddedDocuments("JournalEntryPage", toUpdate);
	return { created: toCreate.length, updated: toUpdate.length };
}
