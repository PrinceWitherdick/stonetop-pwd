// THE GM'S PLAYBOOK LIBRARY: every homebrew playbook, kept once on the SERVER so every Stonetop world
// on it can have it, the way a kept rulebook PDF is (books/book-store.js, adopt-stored-rulebooks.js).
//
// WHY NOT A COMPENDIUM. A world's own compendium lives inside that world's folder, so no other world
// sees it; the system's packs are replaced by every system update and locked while Foundry runs; and
// a compendium shared between worlds has to belong to a separate module, which Foundry cannot make
// from inside a world. A top-level data folder of bundle files (homebrew-bundle.js, the same JSON an
// Export writes) is readable from every world, survives updates, and works on The Forge through the
// same browse/upload helpers the rulebooks use.
//
// THE RULES (user, 2026-11-11):
//   - Saving a homebrew playbook in any world writes it to the library (`stonetop-playbooks/`).
//   - A world that loads without one of the library's playbooks gets it, with its SLUG, so a
//     character exported from the first world links up to it here.
//   - A world that already has it, and an edit was saved elsewhere since, is OFFERED the newer
//     version (what changed, then Update or Keep mine). Nothing is overwritten unasked.
//   - Deleting a playbook deletes it from THIS world, which remembers (`homebrewLibraryForgotten`),
//     or the next load would bring it straight back. "Stop sharing with my other worlds" is the
//     separate gesture that takes it out of the library. A client cannot delete a file, so that
//     writes a TOMBSTONE in its place, which nothing adopts and no later save overwrites.

import { listDataDir } from "../book2-art/browse.js";
import { book2ArtPrefix } from "../book2-art/art-root.js";
import { ensureDataDir, uploadFile } from "../utils/foundry-compat.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { escHtml, fileNameOf, joinNames, looseName } from "../utils/strings.js";
import { readMarkers, setMarker } from "../utils/marker-setting.js";
import { ITEM_FLAG_SCOPE } from "../system-id.js";
import { normalizeBundle, bundleForExport, diffBundles, BUNDLE_FORMAT, BUNDLE_VERSION } from "./homebrew-bundle.js";
import { homebrewPlaybooks, homebrewPlaybookBySlug, isHomebrewPlaybookItem, HOMEBREW_SLUG_PREFIX } from "./playbook-catalog.js";
import {
	saveHomebrewPlaybook, readHomebrewBundle, setPlaybookLibrary, offerToRefreshCopies,
} from "./homebrew-store.js";

/** The library folder: TOP-LEVEL data, beside `stonetop-books/`, outside every world and system. */
export const LIBRARY_DIR = "stonetop-playbooks";
const FILE_SUFFIX = ".stonetop-playbook.json";

/** World setting (registered in settings.js): the library playbooks this world's GM deleted here, `{ [slug]: true }`. */
export const FORGOTTEN_LIBRARY_SETTING = "homebrewLibraryForgotten";

/** Kept on the world's playbook Item: the library version this world last took or turned down. */
const SYNCED_KEY = "librarySavedAt";
/** Kept on the world's playbook Item: its library file is a tombstone (for the menu's two entries). */
const REMOVED_KEY = "libraryRemoved";

/**
 * A playbook's file in the library, named by its SLUG, which never changes: a rename overwrites the
 * same file instead of leaving the old name behind, for the reason `rulebookFileName` is fixed.
 */
export function libraryFileName(slug) {
	return `${slug}${FILE_SUFFIX}`;
}

/** The slug a listed library file is for, or null for anything else in the folder. */
export function slugOfLibraryFile(path) {
	const name = fileNameOf(path);
	if (!name.endsWith(FILE_SUFFIX)) return null;
	const slug = name.slice(0, -FILE_SUFFIX.length);
	return slug.startsWith(HOMEBREW_SLUG_PREFIX) && slug.length > HOMEBREW_SLUG_PREFIX.length ? slug : null;
}

const time = iso => {
	const t = Date.parse(String(iso ?? ""));
	return Number.isFinite(t) ? t : 0;
};

/**
 * One library file, read. PURE. Null for a file that isn't one of ours or can't be read as one.
 * @returns {null | {slug: string, savedAt: string, removed: boolean, bundle: object|null, path: string}}
 */
export function libraryEntry(raw, path = "") {
	if (!raw || typeof raw !== "object" || raw.format !== BUNDLE_FORMAT) return null;
	const fromFile = slugOfLibraryFile(path);
	const claimed = String(raw.slug ?? raw.playbook?.slug ?? "");
	const slug = claimed.startsWith(HOMEBREW_SLUG_PREFIX) ? claimed : fromFile;
	if (!slug) return null;
	const savedAt = String(raw.savedAt ?? "");
	if (raw.removed) return { slug, savedAt, removed: true, bundle: null, path };
	const { bundle } = normalizeBundle(raw);
	if (!bundle) return null;
	bundle.playbook.slug = slug;
	return { slug, savedAt, removed: false, bundle, path };
}

/** What a library file holds for a playbook: the shared export plus its slug and when it was saved. */
export function libraryFileData(bundle, slug, savedAt, systemVersion = "") {
	const data = bundleForExport(bundle, { systemVersion });
	data.playbook = { ...data.playbook, slug };
	return { ...data, slug, savedAt };
}

/** A tombstone: the playbook is no longer shared with other worlds. */
export function tombstoneData(slug, savedAt) {
	return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, slug, removed: true, savedAt };
}

/**
 * Do two bundles hold the same playbook? "Show to players" and the slug are left out: whether
 * players see it is each world's own call, and a save that changed nothing else should not have
 * every other world asked about it.
 */
export function sameContent(a, b) {
	const key = bundle => {
		const clean = normalizeBundle(bundle).bundle;
		if (!clean) return null;
		clean.playbook.published = false;
		clean.playbook.slug = "";
		clean.moves = [...clean.moves].sort((x, y) => x.name.localeCompare(y.name));
		return JSON.stringify(clean);
	};
	const ka = key(a);
	return ka !== null && ka === key(b);
}


/**
 * What a world should do about the library. PURE.
 *
 * @param {object} o
 * @param {Array} o.library   libraryEntry()s
 * @param {Array<{slug, name, librarySavedAt, bundle, item?}>} o.world  this world's homebrew playbooks
 * @param {object} [o.forgotten]  `{ [slug]: true }`
 * @param {Iterable<string>} [o.unreadable]  slugs whose library file is LISTED but couldn't be read:
 *   never backfilled, since the file there may be a newer edit or a tombstone
 * @returns {{add: Array, offer: Array, settle: Array, backfill: Array}}
 *   add:      library playbooks this world should get
 *   offer:    `{here, entry}` where a newer, DIFFERENT version was saved in another world
 *   settle:   `{here, entry}` where a newer save changed nothing that matters: just note it
 *   backfill: this world's playbooks with no library file at all (made before the library existed)
 */
export function planAdoption({ library = [], world = [], forgotten = {}, unreadable = [] } = {}) {
	// One entry per slug: a hosted listing can name the same file twice (two spellings).
	const latest = new Map();
	for (const entry of library) {
		if (!entry?.slug) continue;
		const prior = latest.get(entry.slug);
		if (!prior || time(entry.savedAt) > time(prior.savedAt)) latest.set(entry.slug, entry);
	}
	const bySlug = new Map(world.map(w => [w.slug, w]));
	const names = new Set(world.map(w => looseName(w.name)));
	const add = [], offer = [], settle = [];
	for (const entry of latest.values()) {
		if (entry.removed || !entry.bundle) continue;
		const here = bySlug.get(entry.slug);
		if (!here) {
			if (forgotten?.[entry.slug]) continue;
			// The same playbook imported here by hand gets a slug of its own; adding the library's
			// copy beside it would put two of it in the picker.
			const name = looseName(entry.bundle.playbook.name);
			if (names.has(name)) continue;
			names.add(name);
			add.push(entry);
			continue;
		}
		if (time(entry.savedAt) <= time(here.librarySavedAt)) continue;
		(sameContent(here.bundle, entry.bundle) ? settle : offer).push({ here, entry });
	}
	const unread = new Set(unreadable);
	const backfill = world.filter(w => !latest.has(w.slug) && !unread.has(w.slug));
	return { add, offer, settle, backfill };
}

// ---- Foundry: reading and writing the folder ------------------------------------------------

/**
 * Fetch a file as JSON, never from the browser cache (another world may have just saved it).
 * `missing` only for a plain 404, the one answer that says the file isn't there; any other failure
 * is `error`, which says nothing either way.
 * @returns {Promise<{state: "ok", data: any} | {state: "missing"} | {state: "error"}>}
 */
async function fetchFile(path) {
	const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
	const clean = String(path).replace(/^\/+/, "");
	const url = isUrl ? path : (globalThis.foundry?.utils?.getRoute?.(clean) ?? `/${clean}`);
	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) return { state: res.status === 404 ? "missing" : "error" };
		return { state: "ok", data: await res.json() };
	} catch (err) {
		console.warn(`Stonetop | Couldn't read ${path} from the playbook library.`, err);
		return { state: "error" };
	}
}

/**
 * Is there a library file for this slug, asked for by name (for when the folder couldn't be
 * listed)? Both spellings a host may serve it under. "absent" only when every ask was a 404.
 * @returns {Promise<{state: "absent" | "present" | "unknown", entry?: object|null}>}
 */
async function probeLibraryFile(slug) {
	const rel = `${LIBRARY_DIR}/${libraryFileName(slug)}`;
	const prefix = book2ArtPrefix();
	const paths = [rel, ...(prefix ? [`${prefix}${rel}`] : [])];
	const answers = await Promise.all(paths.map(fetchFile));
	const found = answers.findIndex(a => a.state === "ok");
	if (found >= 0) return { state: "present", entry: libraryEntry(answers[found].data, paths[found]) };
	return { state: answers.every(a => a.state === "missing") ? "absent" : "unknown" };
}

/**
 * What the library holds for ONE slug, for a write to weigh: `entries` as readLibrary gives them,
 * or null when that can't be told (the file is there and unreadable, or nothing could be asked).
 */
async function libraryEntriesFor(slug) {
	const { entries, listed, unreadable } = await readLibrary({ only: slug });
	if (unreadable.includes(slug)) return null;
	if (listed) return entries;
	const probe = await probeLibraryFile(slug);
	if (probe.state === "absent") return [];
	return probe.entry ? [probe.entry] : null;
}

/**
 * Every playbook in the library, read. None when the folder couldn't be listed at all (it doesn't
 * exist yet, which is the ordinary first-time case, or the host refused): `listed` says which.
 * @param {object} [opts]
 * @param {string} [opts.only]  read only this slug's file (a save checks its own file, nothing else)
 * @returns {Promise<{entries: Array, listed: boolean, unreadable: string[]}>}
 *   unreadable: slugs whose file is listed but couldn't be read as one of ours
 */
export async function readLibrary({ only = null } = {}) {
	const listing = await listDataDir(LIBRARY_DIR);
	const paths = (listing?.files ?? []).filter(path => {
		const slug = slugOfLibraryFile(path);
		return slug && (!only || slug === only);
	});
	const read = await Promise.all(paths.map(async path => {
		const got = await fetchFile(path);
		return got.state === "ok" ? libraryEntry(got.data, path) : null;
	}));
	const entries = [], unreadable = [];
	read.forEach((entry, i) => {
		if (entry) return entries.push(entry);
		unreadable.push(slugOfLibraryFile(paths[i]));
		console.warn(`Stonetop | ${paths[i]} in the playbook library couldn't be read as a playbook this system knows; skipped.`);
	});
	return { entries, listed: !!listing, unreadable };
}

// The folder is made once a load, not before every write (a backfill writes several in a row).
let _dirMade = null;

async function writeFile(slug, data) {
	await (_dirMade ??= ensureDataDir(LIBRARY_DIR));
	const file = new File([JSON.stringify(data, null, 2)], libraryFileName(slug), { type: "application/json" });
	return uploadFile("data", LIBRARY_DIR, file);
}

const itemFlag = (item, key) => item?.flags?.[ITEM_FLAG_SCOPE]?.homebrew?.[key];
const flagUpdate = patch => Object.fromEntries(Object.entries(patch).map(([k, v]) => [`flags.${ITEM_FLAG_SCOPE}.homebrew.${k}`, v]));
const setItemFlags = (item, patch) => item.update(flagUpdate(patch));

/**
 * Write a world playbook to the library, unless its file there is a tombstone (it was taken out of
 * sharing: a later save in any world keeps it out). Records on the Item which version that was.
 * @returns {Promise<{savedAt?: string, removed?: boolean} | null>}  null when the upload was refused
 */
export async function writeToLibrary(item, { known = null } = {}) {
	const slug = item?.system?.slug;
	if (!isHomebrewPlaybookItem(item) || !slug) return null;
	// A backfill already knows the playbook has no file there, so it skips the read. A file that
	// can't be read could be a tombstone, so nothing is written over it.
	const entries = known ?? await libraryEntriesFor(slug);
	if (!entries) return null;
	if (entries.some(e => e.removed)) {
		if (!itemFlag(item, REMOVED_KEY)) await setItemFlags(item, { [REMOVED_KEY]: true });
		return { removed: true };
	}
	const savedAt = await _writeEntry(item);
	return savedAt ? { savedAt } : null;
}

/** Write the playbook's library file and note the version on its Item. The savedAt, or null when refused. */
async function _writeEntry(item) {
	const slug = item.system.slug;
	const bundle = readHomebrewBundle(item);
	if (!bundle) return null;
	const savedAt = new Date().toISOString();
	const stored = await writeFile(slug, libraryFileData(bundle, slug, savedAt, game.system?.version ?? ""));
	if (!stored) return null;
	await setItemFlags(item, { [SYNCED_KEY]: savedAt, [REMOVED_KEY]: false });
	return savedAt;
}

/** Take a playbook out of the library (a tombstone). Worlds that already have it keep theirs. */
export async function removeFromLibrary(item) {
	const slug = item?.system?.slug;
	if (!slug) return false;
	const stored = await writeFile(slug, tombstoneData(slug, new Date().toISOString()));
	if (!stored) return false;
	await setItemFlags(item, { [REMOVED_KEY]: true });
	return true;
}

/** Share a playbook that was taken out of the library again: the tombstone is overwritten. */
export async function shareInLibrary(item) {
	if (!item?.system?.slug) return false;
	return !!(await _writeEntry(item));
}

/** Is this playbook taken out of sharing (as this world last saw)? For the Items menu. */
export function isRemovedFromLibrary(item) {
	return !!itemFlag(item, REMOVED_KEY);
}

// ---- Forgotten here --------------------------------------------------------------------------

export function forgottenSlugs() {
	return readMarkers(FORGOTTEN_LIBRARY_SETTING);
}

async function markForgotten(slug, forgotten) {
	if (!slug || !globalThis.game?.user?.isGM) return;
	await setMarker(FORGOTTEN_LIBRARY_SETTING, slug, forgotten);
}

// ---- Adopting what the library holds ---------------------------------------------------------

function worldPlaybooks() {
	return homebrewPlaybooks().map(item => {
		let bundle;
		return {
			item,
			slug: item.system.slug,
			name: item.name,
			librarySavedAt: itemFlag(item, SYNCED_KEY) ?? "",
			// Read only for a playbook a newer library save is weighed against (planAdoption).
			get bundle() { return bundle ??= readHomebrewBundle(item); },
		};
	});
}

/**
 * Add one library playbook to this world under its own slug, without writing it back. Hidden from
 * players, whatever the world it was saved in showed: no GM here has looked at it yet.
 */
export async function adoptLibraryEntry(entry) {
	const bundle = structuredClone(entry.bundle);
	bundle.playbook.published = false;
	const { item } = await saveHomebrewPlaybook(bundle, {
		slug: entry.slug, source: "library", fromLibrary: entry.savedAt,
	});
	return item;
}

/** Ask about one playbook edited in another world: show what changed, then Update or Keep mine. */
async function offerUpdate({ here, entry }) {
	const { lines } = diffBundles(here.bundle, entry.bundle);
	const list = lines.length
		? `<ul>${lines.map(l => `<li>${escHtml(l)}</li>`).join("")}</ul>`
		: "<p>Some of its details changed.</p>";
	const answer = await askWithButtons({
		title: `A newer ${here.name}`,
		content: `<p><strong>${escHtml(here.name)}</strong> was changed and saved in another of your worlds. What's different from this world's copy:</p>${list}`
			+ "<p>Update this world to match? Keep yours, and this world keeps its own version until it changes again somewhere else.</p>",
		buttons: [
			{ key: "update", label: `Update ${here.name}`, icon: "fa-rotate", value: "update" },
			{ key: "keep", label: "Keep mine", icon: "fa-hand", value: "keep" },
		],
		defaultKey: false,
	});
	if (answer === "update") {
		const bundle = structuredClone(entry.bundle);
		// Whether players see it is this world's call, not the other world's.
		bundle.playbook.published = !!here.bundle?.playbook?.published;
		const { item } = await saveHomebrewPlaybook(bundle, { existing: here.item, source: "library", fromLibrary: entry.savedAt });
		ui.notifications?.info?.(`Updated ${item.name} from your playbook library.`);
		await offerToRefreshCopies(item);
	} else if (answer === "keep") {
		await setItemFlags(here.item, { [SYNCED_KEY]: entry.savedAt });
	}
	// Closed without an answer: asked again next load.
}

/**
 * The library run, once per load: add what this world is missing, offer what was changed elsewhere,
 * and put this world's older playbooks in the library. Primary GM only (it writes world Items and a
 * file). Not awaited by the caller; one browse, and one fetch per library file.
 * @param {object} [opts]
 * @param {() => void} [opts.afterAdding]  run ONCE, whatever happens (the run skipped or failed
 *   too), once the missing playbooks are added and before any update is offered: the "characters
 *   play a playbook this world doesn't have" notice, which would otherwise name characters whose
 *   playbook is about to arrive
 * @returns {Promise<{added: string[], offered: number, backfilled: number}>}
 */
export async function adoptLibraryPlaybooks({ afterAdding = null } = {}) {
	let told = false;
	const tell = () => { if (!told) { told = true; afterAdding?.(); } };
	try { return await _adoptRun(tell); }
	finally { tell(); }
}

async function _adoptRun(afterAdding) {
	const none = { added: [], offered: 0, backfilled: 0 };
	if (!game.user?.isGM || !isPrimaryGM()) return none;
	const { entries, listed, unreadable } = await readLibrary();
	const plan = planAdoption({ library: entries, world: worldPlaybooks(), forgotten: forgottenSlugs(), unreadable });

	const added = [];
	for (const entry of plan.add) {
		try {
			// Asked again as it is written: another window may have made it while the browse was out.
			if (homebrewPlaybookBySlug(entry.slug)) continue;
			added.push((await adoptLibraryEntry(entry)).name);
		} catch (err) {
			console.error(`Stonetop | Couldn't add ${entry.bundle?.playbook?.name} from the playbook library.`, err);
		}
	}
	if (added.length) {
		ui.notifications?.info?.(`Added ${joinNames(added)} from your playbook library, the homebrew playbooks you saved in your other worlds. They're in the Items sidebar under Homebrew Playbooks, hidden from players' picker until you tick "Show to players" in the Playbook Builder.`);
	}
	// Before the offers below, which wait on the GM: what the world is still missing is known now.
	afterAdding();
	if (plan.settle.length) {
		await Item.updateDocuments(plan.settle.map(({ here, entry }) => ({ _id: here.item.id, ...flagUpdate({ [SYNCED_KEY]: entry.savedAt }) })));
	}
	let backfilled = 0;
	for (const w of plan.backfill) {
		// "No file for it" is only known from a listing. When the folder couldn't be listed (absent,
		// or the host refused), ask for the file by name and write only on a clear 404: never over a
		// file that may be a newer edit from another world, or a tombstone.
		if (!listed && (await probeLibraryFile(w.slug)).state !== "absent") continue;
		if ((await writeToLibrary(w.item, { known: [] }))?.savedAt) backfilled++;
	}
	for (const pair of plan.offer) {
		try { await offerUpdate(pair); }
		catch (err) { console.error(`Stonetop | Couldn't update ${pair.here.name} from the playbook library.`, err); }
	}
	return { added, offered: plan.offer.length, backfilled };
}

/** Library playbooks this world doesn't have (forgotten ones included), for "Add from my library". */
export async function libraryPlaybooksNotHere() {
	const { entries } = await readLibrary();
	const here = new Set(homebrewPlaybooks().map(i => i.system.slug));
	const seen = new Set();
	return entries
		.filter(e => !e.removed && e.bundle && !here.has(e.slug) && !seen.has(e.slug) && seen.add(e.slug))
		.sort((a, b) => a.bundle.playbook.name.localeCompare(b.bundle.playbook.name));
}

// ---- Wiring ---------------------------------------------------------------------------------

/**
 * The store's hook after every save: write it to the library (or, when the save came FROM the
 * library, note which version it was, so it isn't written straight back as a "new" edit that every
 * other world would then be asked about). A save in this world un-forgets it here. A refused upload
 * warns and never undoes the save.
 */
async function afterSave(item, { fromLibrary = null } = {}) {
	await markForgotten(item.system.slug, false);
	if (fromLibrary) {
		await setItemFlags(item, { [SYNCED_KEY]: fromLibrary });
		return;
	}
	let wrote = null;
	try { wrote = await writeToLibrary(item); }
	catch (err) { console.error("Stonetop | Couldn't write to the playbook library.", err); }
	if (!wrote) ui.notifications?.warn?.(`${item.name} is saved in this world, but it couldn't be copied to your playbook library, so your other worlds won't get it. Check that you can upload files.`);
}

/** A homebrew playbook deleted from this world stays out of it: the library won't bring it back. */
function onDeleteItem(item, _options, userId) {
	if (userId !== game.user?.id || item?.parent || !isHomebrewPlaybookItem(item)) return;
	markForgotten(item.system.slug, true).catch(err => console.error("Stonetop | Couldn't note a deleted homebrew playbook.", err));
}

/** Call once, in init. */
export function registerPlaybookLibrary() {
	setPlaybookLibrary({ afterSave });
	Hooks.on("deleteItem", onDeleteItem);
}
