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
//
// FOUND BY FLAG, THEN BY NAME. The folder and each journal carry a system flag naming what they
// are, stamped when we create them (and on the first name match, for a world seeded before the
// flag existed), so a GM who renames or moves one keeps it: a lookup by name alone would make a
// fresh copy beside it on the next save.

import { mergeChronicleSections, CHRONICLE_FOLDER_NAME, CHRONICLE_FOLDER_COLOR } from "./chronicle-core.js";
import { SYSTEM_ID } from "../system-id.js";
import { stableStringify } from "../hooks/journal-sync-core.js";
import { replacementEntry } from "./foundry-compat.js";
import { inTurn } from "./turn-queue.js";

// Per-page flag holding the change-detection hash of each prose section's body as WE last
// wrote it (keyed by heading). Lets seedChroniclePages keep a still-pristine section
// syncing with the source while freezing one the GM has edited in the journal.
export const CHRONICLE_PROSE_FLAG = "chronicleProse";

// Per-page flag holding, per Q&A heading, every pair we have written: its stable source key
// mapped to the hash of the text we wrote. A pair in here is never added again, so a pair the GM
// edited or deleted in the journal stays that way (see mergeChronicleSections).
export const CHRONICLE_QA_FLAG = "chronicleQa";

// Per-page flag holding the NAME we last gave the page. A page still wearing it is ours to
// retitle when its source is renamed (a PC, a place, an expedition renamed in the walkthrough);
// one the GM has renamed in the journal no longer matches it, and is left alone: the same
// pristine-or-edited test the prose hashes make for a section's body.
export const CHRONICLE_NAME_FLAG = "chronicleName";

// What the Chronicle folder and its journals are stamped with, so they are found again after a
// rename or a move (see the header).
export const CHRONICLE_FOLDER_FLAG  = "chronicleFolder";
export const CHRONICLE_JOURNAL_FLAG = "chronicleJournal";

// Spacing between the sort values of the pages we create.
const SORT_STEP = 10;

// ── No duplicates when two writers overlap ────────────────────────────────────
// Every Chronicle writer looks a folder, journal or page up and then creates what it did not
// find. Two of them overlapping (the live Introductions sync and a Save pressed during a slow
// write) would both find nothing and both create. Two guards, one per level:
//   • the folder and the journals: createOnce below, so a second ask while the first create is
//     in flight waits for that one;
//   • a journal's pages: withChronicleLock, one page pass per journal at a time.

/**
 * Run `fn` once every page pass queued before it on `journal` has finished. A failure is passed
 * back to its own caller and does not stop the queue. seedChroniclePages takes it itself; a writer
 * that finds and creates pages by hand (the Seasons Change record) takes it around that work.
 * Never call it for the same journal from inside `fn`: the inner call would wait on the outer one.
 */
export function withChronicleLock(journal, fn) {
	return inTurn(`chronicle:${journal?.id ?? ""}`, fn);
}

// A folder or journal being created right now, by what it is, so a second ask for it while the
// first create is in flight waits for that one instead of making another.
const _creating = new Map();
function createOnce(key, make) {
	if (_creating.has(key)) return _creating.get(key);
	const pending = Promise.resolve().then(make).finally(() => _creating.delete(key));
	_creating.set(key, pending);
	return pending;
}

const flagOf = (doc, key) => doc?.getFlag?.(SYSTEM_ID, key) ?? doc?.flags?.[SYSTEM_ID]?.[key];

/**
 * Find (or create) the "The Chronicle" journal folder that holds the introductions,
 * expeditions, Seasons Change and Places of Interest journals.
 */
export async function ensureChronicleFolder() {
	const found = findChronicleFolder();
	if (found) return stampChronicleFolder(found);
	return (await createOnce("folder", () => Folder.create({
		name: CHRONICLE_FOLDER_NAME,
		type: "JournalEntry",
		color: CHRONICLE_FOLDER_COLOR,
		flags: { [SYSTEM_ID]: { [CHRONICLE_FOLDER_FLAG]: true } },
	}))) ?? null;
}

/** Seeded before the flag: stamp the folder now, so a rename after this keeps it. Answers the folder. */
async function stampChronicleFolder(folder) {
	if (folder && !flagOf(folder, CHRONICLE_FOLDER_FLAG) && game.user?.isGM) {
		await folder.setFlag?.(SYSTEM_ID, CHRONICLE_FOLDER_FLAG, true);
	}
	return folder;
}

/**
 * The Chronicle folder if this world has one, or null. Read-only — creates nothing, for the
 * lookups that must not conjure a folder just by asking (a player resolving a map pin's link).
 *
 * The one place this lookup is spelled: every journal that lives in the Chronicle has to find
 * the SAME folder, and a second copy is how the seeding path and the reading path end up
 * disagreeing the day the folder is renamed or nested. The stamped folder wins over one that
 * merely has the name.
 */
export function findChronicleFolder() {
	const folders = (game.folders?.contents ?? []).filter(f => f.type === "JournalEntry");
	return folders.find(f => flagOf(f, CHRONICLE_FOLDER_FLAG))
		?? folders.find(f => f.name === CHRONICLE_FOLDER_NAME)
		?? null;
}

/**
 * The Chronicle journal called `name` (by its stamp, wherever the GM has since moved or renamed
 * it; else by that name inside the Chronicle folder), or null. Read-only.
 */
export function findChronicleJournal(name, folderId = findChronicleFolder()?.id) {
	const journals = game.journal?.contents ?? [];
	return journals.find(j => flagOf(j, CHRONICLE_JOURNAL_FLAG) === name)
		?? (folderId ? journals.find(j => j.folder?.id === folderId && j.name === name) : null)
		?? null;
}

/**
 * Find (or create) the Chronicle journal named `name`: by its stamp wherever the GM keeps it, else
 * by name in the Chronicle folder, else a new one in that folder (made only now, when a journal
 * has to be). `defaultOwnership` is what a NEW journal opens with (OBSERVER for the ones players
 * read). An existing journal keeps whatever ownership the GM has given it since: a save never
 * opens a journal the GM closed. Null when the folder could not be made.
 */
export async function ensureChronicleJournal(name, defaultOwnership) {
	const found = findChronicleJournal(name);
	if (found) {
		if (flagOf(found, CHRONICLE_JOURNAL_FLAG) !== name && game.user?.isGM) {
			await found.setFlag?.(SYSTEM_ID, CHRONICLE_JOURNAL_FLAG, name);
		}
		// The folder it was found in by name (or any existing one) is stamped too; none is made just for this.
		await stampChronicleFolder(findChronicleFolder());
		return found;
	}
	return (await createOnce(`journal:${name}`, async () => {
		const folder = await ensureChronicleFolder();
		if (!folder) return null;
		return JournalEntry.create({
			name,
			folder: folder.id,
			ownership: { default: defaultOwnership },
			flags: { [SYSTEM_ID]: { [CHRONICLE_JOURNAL_FLAG]: name } },
		});
	})) ?? null;
}

/**
 * Seed + top up: create the pages whose key isn't present yet, and for an already-seeded page
 * merge in what changed since (see mergeChronicleSections: new sections and answers land,
 * still-pristine text follows its source, cleared text that is still ours goes, and anything
 * the GM edited or deleted in the journal stays as they left it). Returns
 * `{ created, updated, kept }`: pages created, pages visibly changed (a record or name stamp
 * nobody can see is not counted), and sections left as the GM edited them although the source
 * has moved on.
 *
 * A new page is placed in `pages` order: before the next page of the list the journal already
 * holds, when there is room between its neighbours' sort values, else at the end. Pages the GM
 * has already arranged are never moved.
 *
 * A page with no sections (`buildChroniclePages`'s `withEmpty`) is never created; it is there
 * so an existing page can lose what its source cleared.
 *
 * `pages` may be a function returning the list: it is called once this journal's turn in the
 * page queue comes (withChronicleLock), so a pass that waited behind another reads its source then.
 *
 * `followNames` opts a journal's pages into following their source's NAME as well (a renamed
 * PC or place). Only while the page still wears the name we last gave it (CHRONICLE_NAME_FLAG):
 * a page the GM renamed is theirs. `renamePrefix` does the same and also takes a page seeded
 * before that flag existed as ours while its name still starts with the prefix, which every
 * generated expedition name does and a GM's own title almost never will.
 */
export async function seedChroniclePages(entry, pages, options = {}) {
	if (!entry) return { created: 0, updated: 0, kept: 0 };
	// One pass per journal at a time: two at once would both miss a page and both create it.
	return withChronicleLock(entry, () => seedPagesNow(entry, typeof pages === "function" ? pages() : pages, options));
}

async function seedPagesNow(entry, pages, { adoptLegacyKeys = null, renamePrefix = null, followNames = false }) {
	if (!pages?.length) return { created: 0, updated: 0, kept: 0 };
	const follow = followNames || renamePrefix != null;
	const existingByKey = new Map();
	const sortOf = new Map();
	// Every page's sort, ours or the GM's, so a new page is never given one a GM's page already holds.
	const allSorts = [];
	let maxSort = 0;
	for (const page of entry.pages ?? []) {
		allSorts.push(Number(page.sort) || 0);
		const key = page.getFlag?.(SYSTEM_ID, "chronicleKey");
		if (key) {
			existingByKey.set(key, page);
			sortOf.set(key, Number(page.sort) || 0);
		}
		maxSort = Math.max(maxSort, Number(page.sort) || 0);
	}
	const toCreate = [];
	const toUpdate = [];
	let updated = 0;
	let kept = 0;
	pages.forEach((page, index) => {
		const existing = existingByKey.get(page.key);
		if (existing) {
			// toObject() gives plain data the merge can spread and the update can store back;
			// the per-heading prose hashes and the written Q&A pairs ride in page flags.
			const current      = existing.toObject().system?.sections ?? [];
			const proseManaged = existing.getFlag?.(SYSTEM_ID, CHRONICLE_PROSE_FLAG) ?? {};
			const qaManaged    = existing.getFlag?.(SYSTEM_ID, CHRONICLE_QA_FLAG) ?? {};
			// A page in `adoptLegacyKeys` is being authored live right now, so its untracked
			// (pre-hash) prose may be taken over by the current text — see mergeChronicleSections.
			const adoptLegacy = adoptLegacyKeys ? adoptLegacyKeys.has(page.key) : false;
			const merged = mergeChronicleSections(current, page.sections, {
				proseManaged, qaManaged, adoptLegacy, cleared: page.cleared ?? [],
			});
			kept += merged.kept;
			const change = {};
			let visible = false;
			if (merged.added) {
				change["system.sections"] = merged.sections;
				visible = true;
			}
			// The records are REPLACED, not merged into: a heading or pair we took away has to
			// leave the record too, and an update merges objects key by key.
			if (stableStringify(merged.proseManaged) !== stableStringify(proseManaged)) {
				const [k, v] = replacementEntry(`flags.${SYSTEM_ID}.${CHRONICLE_PROSE_FLAG}`, merged.proseManaged);
				change[k] = v;
			}
			if (stableStringify(merged.qaManaged) !== stableStringify(qaManaged)) {
				const [k, v] = replacementEntry(`flags.${SYSTEM_ID}.${CHRONICLE_QA_FLAG}`, merged.qaManaged);
				change[k] = v;
			}
			if (follow && page.name) {
				const given = existing.getFlag?.(SYSTEM_ID, CHRONICLE_NAME_FLAG);
				if (existing.name !== page.name) {
					const ours = given
						? existing.name === given
						: (renamePrefix != null && String(existing.name ?? "").startsWith(renamePrefix));
					if (ours) {
						change.name = page.name;
						change[`flags.${SYSTEM_ID}.${CHRONICLE_NAME_FLAG}`] = page.name;
						visible = true;
					}
				} else if (given !== page.name) {
					// A page wearing our name without the record (seeded before it existed) gets
					// it now, so a GM's retitle after this is theirs, even one that keeps the prefix.
					change[`flags.${SYSTEM_ID}.${CHRONICLE_NAME_FLAG}`] = page.name;
				}
			}
			if (Object.keys(change).length) toUpdate.push({ _id: existing.id, ...change });
			if (visible) updated += 1;
			return;
		}
		if (!page.sections?.length) return;
		const sort = newPageSort(pages, index, sortOf, maxSort, allSorts);
		sortOf.set(page.key, sort);
		allSorts.push(sort);
		maxSort = Math.max(maxSort, sort);
		// Stamp the initial records so later saves can tell this seed from a hand edit (a merge
		// into an empty page fingerprints every section, and strips what a page does not store).
		const seeded = mergeChronicleSections([], page.sections);
		toCreate.push({
			name:   page.name,
			type:   "chronicle",
			sort,
			system: { sections: seeded.sections },
			flags:  { [SYSTEM_ID]: {
				chronicleKey: page.key,
				[CHRONICLE_PROSE_FLAG]: seeded.proseManaged,
				[CHRONICLE_QA_FLAG]: seeded.qaManaged,
				[CHRONICLE_NAME_FLAG]: page.name,
			} },
		});
	});
	if (toCreate.length) await entry.createEmbeddedDocuments("JournalEntryPage", toCreate);
	if (toUpdate.length) await entry.updateEmbeddedDocuments("JournalEntryPage", toUpdate);
	return { created: toCreate.length, updated, kept };
}

// Where a new page goes so the journal reads in `pages` order: just before the next page of the list
// it already holds, above every page (of the list or the GM's own) that sits below that one, when
// their sort values leave room; else after everything. A page the GM placed is never tied or jumped.
function newPageSort(pages, index, sortOf, maxSort, allSorts = []) {
	let next = null;
	for (let j = index + 1; j < pages.length && next == null; j++) if (sortOf.has(pages[j].key)) next = sortOf.get(pages[j].key);
	if (next != null) {
		// The highest sort below `next`: the list's previous page, or a GM's page between the two.
		const below = allSorts.filter(sort => sort < next);
		if (!below.length) return next - SORT_STEP;
		const lo = Math.max(...below);
		if (next - lo >= 2) return Math.floor((lo + next) / 2);
	}
	return maxSort + SORT_STEP;
}
