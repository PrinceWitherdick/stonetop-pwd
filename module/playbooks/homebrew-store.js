// THE FOUNDRY HALF OF HOMEBREW PLAYBOOKS: write a bundle (homebrew-bundle.js) into the world as
// a playbook Item and its move Items, read them back, delete them, and save or load the JSON a
// table shares. Everything about the SHAPE lives in homebrew-bundle.js (pure, tested); this file
// only creates, updates and deletes documents, so a test fakes `Item`, `Folder` and `game.items`.

import {
	normalizeBundle, bundleToItemData, itemsToBundle, bundleForExport, writeInsTurnedToTicks,
} from "./homebrew-bundle.js";
import {
	homebrewPlaybookBySlug, homebrewMoveSlug, mintHomebrewSlug, playbookNameProblem,
	invalidatePlaybookCatalog, isHomebrewPlaybookItem, homebrewMovesOfSlug, HOMEBREW_SLUG_PREFIX,
	HOMEBREW_INSERT_FLAG,
} from "./playbook-catalog.js";
import { SYSTEM_ID, ITEM_FLAG_SCOPE } from "../system-id.js";
import { STONETOP_SCOPE, HOMEBREW_PLAYBOOK_COPY_FLAG, StonetopFlags } from "../actors/character/StonetopFlags.js";
import { CharacterLore } from "../actors/character/CharacterLore.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { carriedCopyOf } from "./homebrew-missing.js";
import { ownershipLevels, deletionEntry } from "../utils/foundry-compat.js";
import { escHtml, looseName, slugify } from "../utils/strings.js";

/**
 * The playbook library (playbook-library.js) hooks in here rather than being imported, so this file
 * stays the plain document writer its tests fake, and the library can import it without a cycle.
 * Unset in a test: a save then writes the world and nothing else.
 */
let _library = null;
export function setPlaybookLibrary(library) { _library = library ?? null; }

/** The sidebar folder every homebrew playbook's own folder sits in. */
export const HOMEBREW_ROOT_FOLDER = "Homebrew Playbooks";

const OBSERVER = () => ownershipLevels().OBSERVER;

/** Every world move Item belonging to the homebrew playbook `slug`, whatever its name says. */
export function movesOfHomebrew(slug, items) {
	return homebrewMovesOfSlug(slug, items);
}

/**
 * The characters holding the homebrew playbook `slug`: committed (system.playbook.slug), or still
 * choosing it (onboardingProgress names it). A rename or a delete has to think about them.
 */
export function holdersOfHomebrew(slug, name, actors = game.actors) {
	return [...(actors ?? [])].filter(a => {
		if (a?.type !== "character") return false;
		if (a.system?.playbook?.slug === slug) return true;
		const progress = a.flags?.[STONETOP_SCOPE]?.onboardingProgress;
		return !!name && progress?.playbook === name;
	});
}

async function _folder(name, parent = null) {
	const existing = game.folders?.find(f => f.type === "Item" && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));
	if (existing) return existing;
	return Folder.create({ name, type: "Item", folder: parent?.id ?? null, sorting: "a" });
}

/** The playbook's own folder ("Homebrew Playbooks/<Name>"), made if missing. */
async function _playbookFolder(name) {
	const root = await _folder(HOMEBREW_ROOT_FOLDER);
	return _folder(name, root);
}

/**
 * Why this bundle cannot be saved over `existing` (or as a new playbook), or null.
 * @returns {null | {code: string, message: string}}
 */
export function saveProblem(bundle, existing = null) {
	const name = bundle?.playbook?.name ?? "";
	const ownSlug = existing?.system?.slug ?? null;
	const nameIssue = playbookNameProblem(name, { ownSlug });
	if (nameIssue === "empty") return { code: "empty", message: "Give the playbook a name before saving it." };
	if (nameIssue === "shipped") return { code: "shipped", message: `"${name.trim()}" is one of the book's playbooks. Give yours a different name.` };
	if (nameIssue === "taken") return { code: "taken", message: `Another homebrew playbook in this world is already called "${name.trim()}". Give this one a different name.` };
	return null;
}

// ---- Characters who play a homebrew playbook ------------------------------------------------

const LEDGER_QUIET = { stonetopLedger: true };

/**
 * A homebrew playbook was renamed: every place a character keeps its NAME follows (the slug, which
 * links them, never changes). Their playbook record, an unfinished creation's pick, and their own
 * copies of its moves, whose `system.playbook` is how a move is known to be the playbook's. Quiet
 * in the character's ledger: nothing about the character changed.
 */
export async function cascadeRename(slug, oldName, newName, actors = game.actors) {
	// Each character is its own document, so they are written side by side.
	const holders = holdersOfHomebrew(slug, oldName, actors);
	await Promise.all(holders.map(async actor => {
		const update = {};
		if (actor.system?.playbook?.slug === slug) update["system.playbook.name"] = newName;
		if (actor.flags?.[STONETOP_SCOPE]?.onboardingProgress?.playbook === oldName) update[`flags.${STONETOP_SCOPE}.onboardingProgress.playbook`] = newName;
		const moves = [...(actor.items ?? [])].filter(i => homebrewMoveSlug(i) === slug && i.system?.playbook === oldName);
		if (Object.keys(update).length) await actor.update(update, LEDGER_QUIET);
		if (moves.length) await actor.updateEmbeddedDocuments("Item", moves.map(i => ({ _id: i.id, "system.playbook": newName })), LEDGER_QUIET);
	}));
	return holders.length;
}

/** The fields a held copy of a homebrew move is refreshed in: what the move does, never what it holds. */
const REFRESHED_FIELDS = ["description", "rollType", "moveResults", "requirement", "repeatMax", "cap", "markOptions", "markBudget", "resource", "isStartingMove"];

const INSERT_FLAG_PATH = `flags.${SYSTEM_ID}.${HOMEBREW_INSERT_FLAG}`;
const _insertFlag = item => item?.flags?.[SYSTEM_ID]?.[HOMEBREW_INSERT_FLAG] ?? null;

/**
 * Bring `item`'s insert flag to `want`'s, into `update`. An update MERGES flags, so a move taken out
 * of an insert needs the flag deleted outright, or it would stay filed under the insert.
 */
function _syncInsertFlag(update, item, want) {
	const have = _insertFlag(item);
	const next = _insertFlag(want);
	if (JSON.stringify(have) === JSON.stringify(next)) return;
	if (next) update[INSERT_FLAG_PATH] = { ...next };
	else if (have) {
		const [key, value] = deletionEntry(INSERT_FLAG_PATH);
		update[key] = value;
	}
}


/**
 * Characters' copies of a homebrew playbook's moves that no longer match the playbook's own: a
 * character keeps the copy they took, so an edit in the builder reaches them only when the GM
 * says so. Matched by the homebrew flag AND the name, never by name alone, so a book move of the
 * same name is never touched. What the copy HOLDS (its track's pips, its marks) is kept by name on
 * the character, not on the copy, so a refresh leaves it.
 * @returns {Array<{actor: Actor, item: Item, update: object}>}
 */
export function staleHeldCopies(slug, { actors = game.actors, items = game.items } = {}) {
	const source = new Map(movesOfHomebrew(slug, items).map(m => [looseName(m.name), m]));
	const out = [];
	for (const actor of actors ?? []) {
		if (actor?.type !== "character") continue;
		for (const item of actor.items ?? []) {
			if (homebrewMoveSlug(item) !== slug) continue;
			const now = source.get(looseName(item.name));
			if (!now) continue;
			const update = {};
			for (const key of REFRESHED_FIELDS) {
				const want = now.system?.[key] ?? null;
				if (JSON.stringify(item.system?.[key] ?? null) !== JSON.stringify(want)) update[`system.${key}`] = want;
			}
			_syncInsertFlag(update, item, now);
			if (Object.keys(update).length) out.push({ actor, item, update });
		}
	}
	return out;
}

/** Bring every stale held copy up to the playbook's current moves. How many copies changed. */
export async function refreshHeldCopies(slug, opts = {}) {
	const stale = staleHeldCopies(slug, opts);
	const byActor = new Map();
	for (const s of stale) {
		const list = byActor.get(s.actor) ?? [];
		list.push({ _id: s.item.id, ...s.update });
		byActor.set(s.actor, list);
	}
	for (const [actor, updates] of byActor) await actor.updateEmbeddedDocuments("Item", updates, LEDGER_QUIET);
	return stale.length;
}

/**
 * Keep a copy of the homebrew playbook on a character who plays it: an exported character taken to
 * another world (or a world where the playbook was deleted) carries what it needs to bring the
 * playbook back (restoreCarriedPlaybook). Written whenever the playbook is saved and when a
 * character takes it. Quiet in the ledger.
 */
export async function carryPlaybookCopy(actor, bundle) {
	if (!actor?.update || !bundle) return;
	const copy = exportData(bundle);
	// A save that changed nothing this character carries writes nothing (no broadcast, no re-render).
	if (JSON.stringify(actor.flags?.[STONETOP_SCOPE]?.[HOMEBREW_PLAYBOOK_COPY_FLAG] ?? null) === JSON.stringify(copy)) return;
	await actor.update({ [`flags.${STONETOP_SCOPE}.${HOMEBREW_PLAYBOOK_COPY_FLAG}`]: copy }, LEDGER_QUIET);
}

/** The copy a character carries of the playbook they play, as a bundle, or null (homebrew-missing.js#carriedCopyOf). */
export function carriedPlaybook(actor) {
	const raw = carriedCopyOf(actor);
	return raw ? normalizeBundle(raw).bundle : null;
}

/**
 * Bring back the homebrew playbook a character plays, from the copy they carry, under its own slug
 * so the character (and anyone else holding it) links to it again. A homebrew playbook already
 * using the name takes the restored one a "(restored)" suffix, followed onto every character on
 * this slug. It comes back HIDDEN from players, whatever the world it came from showed: that is
 * this world's GM's call (the sheet says so when it's restored).
 * @returns {Promise<Item|null>}
 */
export async function restoreCarriedPlaybook(actor, actors = game.actors) {
	const slug = actor?.system?.playbook?.slug;
	const bundle = carriedPlaybook(actor);
	if (!slug || !bundle || homebrewPlaybookBySlug(slug)) return null;
	bundle.playbook.published = false;
	const was = bundle.playbook.name;
	if (playbookNameProblem(was) === "taken") bundle.playbook.name = `${was} (restored)`;
	const { item } = await saveHomebrewPlaybook(bundle, { slug, source: bundle.playbook.source ?? "json" });
	if (item.name !== was) {
		// Only characters on THIS slug: an unfinished creation that picked "was" by name picked the
		// other playbook already called that, and stays on it.
		const onSlug = [...(actors ?? [])].filter(a => a?.system?.playbook?.slug === slug);
		if (!onSlug.includes(actor)) onSlug.push(actor);
		await cascadeRename(slug, was, item.name, onSlug);
	}
	return item;
}

/**
 * Write a bundle into the world. A new playbook gets a fresh slug and folder; an existing one is
 * updated IN PLACE (its uuid and slug stay, so every character holding it stays linked), and its
 * moves are matched by name: changed ones updated, new ones created, ones no longer in the bundle
 * deleted. A character's copy of a move is its own and is not touched.
 *
 * @param {object} bundle  a bundle (normalized here again; the caller may hand the builder's state)
 * @param {object} [opts]
 * @param {Item|null} [opts.existing]  the homebrew playbook Item being saved over
 * @param {string} [opts.source]       "builder" | "json" | "pdf" | "library", kept on the playbook
 * @param {string} [opts.slug]         keep this slug for a NEW playbook (a restore, or one from the library)
 * @param {string} [opts.fromLibrary]  the library version this save came from (it isn't written back)
 * @param {object} [opts.importBase]   the playbook AS READ from the PDF or file this save follows,
 *   before the GM changed anything: the next import of a newer version compares against it, so
 *   what the GM fixed by hand is kept wherever the PDF itself didn't change (mergeReimport)
 * @returns {Promise<{item: Item, created: number, updated: number, deleted: number}>}
 */
export async function saveHomebrewPlaybook(bundle, { existing = null, source = "builder", slug: wantedSlug = null, fromLibrary = null, importBase = null } = {}) {
	const { bundle: clean } = normalizeBundle(bundle);
	if (!clean) throw new Error("Not a homebrew playbook bundle.");
	const problem = saveProblem(clean, existing);
	if (problem) throw Object.assign(new Error(problem.message), { code: problem.code });
	const name = clean.playbook.name.trim();
	clean.playbook.name = name;
	const oldName = existing?.name ?? null;

	// A restore keeps the slug its characters link to (restoreCarriedPlaybook); anything else new
	// gets a fresh one.
	const reusable = wantedSlug && String(wantedSlug).startsWith(HOMEBREW_SLUG_PREFIX) && !homebrewPlaybookBySlug(wantedSlug);
	const slug = existing?.system?.slug ?? (reusable ? wantedSlug : mintHomebrewSlug(name));
	const { playbook, moves } = bundleToItemData(clean, { slug, source: existing ? (existing.flags?.stonetop?.homebrew?.source ?? source) : source });
	// One string, so an update replaces it whole: as an object, a key the old base had and the new one
	// doesn't would survive the merge. Left out, the base the playbook already has stays.
	const base = importBase ? normalizeBundle(importBase).bundle : null;
	if (base) playbook.flags[ITEM_FLAG_SCOPE].homebrew.importBase = JSON.stringify({ playbook: base.playbook, moves: base.moves });
	const folder = await _playbookFolder(name);
	// Read before the update replaces them: the write-ins this save makes ticks of.
	const turned = existing ? writeInsTurnedToTicks(existing.flags?.[ITEM_FLAG_SCOPE], playbook.flags[ITEM_FLAG_SCOPE]) : null;

	let item;
	if (existing) {
		// Every key the writer emits is always present, and its lists are arrays (replaced whole by
		// an update), so a plain update cannot leave a stale key behind.
		const { type: _type, ...changes } = playbook;
		await existing.update({ ...changes, folder: folder.id, img: playbook.img ?? existing.img });
		item = existing;
		// The folder follows the name. An emptied old folder is left for the GM to tidy.
	} else {
		// Players can see a draft in the Items sidebar (the user's call: no harm in it). Taking one is
		// what's gated, by the picker and the sheet's drop.
		item = await Item.create({ ...playbook, folder: folder.id, ownership: { default: OBSERVER() } });
	}

	const held = movesOfHomebrew(slug);
	const byName = new Map(held.map(m => [m.name.toLowerCase(), m]));
	const keep = new Set();
	const toCreate = [];
	const toUpdate = [];
	for (const data of moves) {
		const prior = byName.get(data.name.toLowerCase());
		if (prior) {
			keep.add(prior.id);
			const update = { _id: prior.id, name: data.name, folder: folder.id, system: data.system, flags: data.flags };
			// The insert flag is merged in with `flags` when it's set; one the move no longer has is deleted.
			if (!_insertFlag(data) && _insertFlag(prior)) _syncInsertFlag(update, prior, data);
			toUpdate.push(update);
		} else {
			toCreate.push({ ...data, folder: folder.id, ownership: { default: OBSERVER() } });
		}
	}
	const toDelete = held.filter(m => !keep.has(m.id)).map(m => m.id);
	if (toUpdate.length) await Item.updateDocuments(toUpdate);
	if (toCreate.length) await Item.createDocuments(toCreate);
	if (toDelete.length) await Item.deleteDocuments(toDelete);
	invalidatePlaybookCatalog();

	if (turned?.moves.length) await tickAnsweredWriteIns(slug, turned.moves);
	// A rename follows onto every character who plays it (their name for it, their moves' link).
	if (oldName && oldName !== name) await cascadeRename(slug, oldName, name);
	// Everyone who plays it carries the saved version to other worlds.
	// The playbook as read back from the world (its slug, its round-tripped text), the same shape a
	// drop or onboarding carries (StonetopCharacterSheet#_carryHomebrewCopy), so carryPlaybookCopy's
	// "only on a change" holds and no holder is rewritten by a save that changed nothing of theirs.
	const carried = readHomebrewBundle(item);
	await Promise.all(holdersOfHomebrew(slug, name)
		.filter(actor => actor.system?.playbook?.slug === slug)
		.map(actor => carryPlaybookCopy(actor, carried)));
	// And to the GM's other worlds (playbook-library.js). Its own failures are its own to report: the
	// world save above has happened either way.
	if (_library?.afterSave) {
		try { await _library.afterSave(item, { fromLibrary }); }
		catch (err) { console.error("Stonetop | The playbook library couldn't take that save.", err); }
	}
	return { item, created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
}

/**
 * A character keeps the copy of a move they took, so a changed move reaches them only when the GM
 * says so: after a save, name who holds an older copy, and offer to bring them up to date. What a
 * copy holds (pips, marks) is kept on the character, not the copy, so it survives. After a builder
 * Save and after an update from the playbook library.
 */
export async function offerToRefreshCopies(item) {
	const stale = staleHeldCopies(item.system.slug);
	if (!stale.length) return;
	const who = [...new Set(stale.map(s => s.actor.name))];
	const moves = [...new Set(stale.map(s => s.item.name))];
	const answer = await askWithButtons({
		title: "Update the characters' copies?",
		content: `<p><strong>${escHtml(who.join(", "))}</strong> ${who.length === 1 ? "holds" : "hold"} an older copy of ${moves.length === 1 ? "a move" : `${moves.length} moves`} you changed: ${escHtml(moves.join(", "))}.</p>`
			+ "<p>Update their copies to match? What they hold on those moves (filled pips, ticked options) stays as it is. Leave them, and their sheets keep the old wording.</p>",
		buttons: [{ key: "update", label: "Update their copies", icon: "fa-rotate", value: true }],
		defaultKey: false,
	});
	if (answer !== true) return;
	const n = await refreshHeldCopies(item.system.slug);
	ui.notifications.info(`Updated ${n} ${n === 1 ? "copy" : "copies"} of ${item.name}'s moves.`);
}

/**
 * A character who typed an answer into a write-in that is now a tick with a blank
 * (writeInsTurnedToTicks) keeps it as that tick: ticked, with their words in its blank. Without this
 * the words sat in an unticked option, read nowhere and counted as no pick. One write per character.
 */
export async function tickAnsweredWriteIns(slug, moves, actors = game.actors) {
	const writes = [];
	for (const actor of [...(actors ?? [])]) {
		if (actor?.type !== "character" || actor.system?.playbook?.slug !== slug) continue;
		const update = {};
		for (const { store, from, to } of moves) {
			const flags = new StonetopFlags(actor, store);
			const lore = new CharacterLore(flags);
			const words = String(lore.texts[from] ?? "").trim();
			if (!words || (lore.counts[to] ?? 0) > 0) continue;
			Object.assign(update, flags.subKeyData("counts", to, 1));
			if (to !== from) Object.assign(update, flags.subKeyData("texts", to, lore.texts[from]));
		}
		if (Object.keys(update).length) writes.push(actor.update(update));
	}
	await Promise.all(writes);
}

/**
 * What saving `item` as it is would turn from a write-in into a tick with a blank (writeInsAsBlanks),
 * as a notice for the builder: a playbook saved before write-ins became ticks changes on its next save.
 */
export function writeInsChangedOnSave(item) {
	const bundle = readHomebrewBundle(item);
	if (!bundle) return [];
	const { playbook } = bundleToItemData(bundle, { slug: item.system.slug, source: "builder" });
	return writeInsTurnedToTicks(item.flags?.[ITEM_FLAG_SCOPE], playbook.flags[ITEM_FLAG_SCOPE]).labels;
}

/** A homebrew playbook Item and its moves, as a bundle (for the builder, or an export). */
export function readHomebrewBundle(item) {
	if (!isHomebrewPlaybookItem(item)) return null;
	return itemsToBundle(item, movesOfHomebrew(item.system.slug));
}

/**
 * The playbook as it was last READ from a PDF or file, before the GM's own changes (stored by
 * saveHomebrewPlaybook's `importBase`), or null for one never imported or saved before this was kept.
 */
export function readImportBase(item) {
	const raw = item?.flags?.[ITEM_FLAG_SCOPE]?.homebrew?.importBase;
	if (typeof raw !== "string" || !raw) return null;
	try { return normalizeBundle({ format: "stonetop-homebrew-playbook", version: 1, ...JSON.parse(raw) }).bundle; }
	catch { return null; }
}

/** Delete a homebrew playbook and every move Item that belongs to it (characters' copies stay). */
export async function deleteHomebrewPlaybook(item) {
	if (!isHomebrewPlaybookItem(item)) return;
	const moveIds = movesOfHomebrew(item.system.slug).map(m => m.id);
	if (moveIds.length) await Item.deleteDocuments(moveIds);
	await item.delete();
	invalidatePlaybookCatalog();
}

/** A bundle as the JSON a GM shares (a file, a character's carried copy), stamped with this system's version. */
export function exportData(bundle) {
	return bundleForExport(bundle, { systemVersion: game.system?.version ?? "" });
}

/** Save the playbook as a JSON file the GM can share. */
export function exportHomebrewPlaybook(item) {
	const bundle = readHomebrewBundle(item);
	if (bundle) downloadBundle(bundle);
}

/** Save a bundle as `<its slug or name>.stonetop-playbook.json`: the Items menu's export and the builder's. */
export function downloadBundle(bundle) {
	const data = exportData(bundle);
	const named = String(bundle.playbook.slug || bundle.playbook.name || "");
	const base = slugify(named.startsWith(HOMEBREW_SLUG_PREFIX) ? named.slice(HOMEBREW_SLUG_PREFIX.length) : named) || "playbook";
	foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `${base}.stonetop-playbook.json`);
}

/**
 * Read a picked JSON file into a bundle.
 * @returns {Promise<{bundle: object|null, issues: object[]}>}
 */
export async function readBundleFile(file) {
	let raw;
	try {
		raw = JSON.parse(await foundry.utils.readTextFromFile(file));
	} catch {
		return { bundle: null, issues: [{ severity: "error", message: "That file isn't valid JSON, so it can't be a shared playbook." }] };
	}
	return normalizeBundle(raw);
}

/** The homebrew playbook an imported bundle would collide with (same slug), or null. */
export function importCollision(bundle) {
	const slug = bundle?.playbook?.slug;
	return slug ? homebrewPlaybookBySlug(slug) : null;
}

