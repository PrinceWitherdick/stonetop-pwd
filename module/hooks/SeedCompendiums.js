import { getSetting, setSetting } from "../settings.js";
import { info, error } from "../utils/logger.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { invalidateLocationSummaryIndex } from "../locations/location-tooltips.js";
import { makeRewriter, remapPageData, managedHash, carryOverPageState, planSourceRestamp } from "./journal-sync-core.js";
import { compendiumSourceOf } from "../utils/foundry-compat.js";
import { progressSlice, progressSubSlice } from "../utils/progress-slice.js";
import { makePaintYielder } from "../utils/paint-yield.js";
import { SEEDED_FOLDER_COLORS, rawFolderColor, planSeededFolderColorUpdates, seededFolderColorSignature } from "./seeded-folder-colors.js";
import { isOurCompendiumRef, seededSourceKeys, compendiumRefTail } from "../migration/compat.js";
import { SYSTEM_ID, JOURNAL_PACK } from "../system-id.js";

// On a fresh world, copy the system's "Stonetop" JournalEntry compendium (the
// gazetteer — Locations, Lore, the bundled Journals, and the bestiary codex) into
// the world's Journal sidebar so the GM has it ready to browse and edit without
// manually importing the pack. The bestiary codex (~160 `bestiary`-page reference
// entries) is seeded too, so monsters turn up in the world's journal search and the
// GM can edit their questions in place.
//
// Runs once per world, guarded by the `seedingComplete` world setting, GM-only.
// `importJournalPack` recreates the compendium's folder tree — the four gazetteer
// trees (Lore, Places, Bestiary, Reference) at the sidebar root, keeping their
// organisation. They sit at the top level (not under a wrapper folder) so the deepest
// tree, the Bestiary codex, stays within Foundry's folder-render depth. An older scheme
// grouped them under a "The World" folder; unnestSeededWorldRootOnce migrates those.
//
// Cross-links between the imported journals are then rewritten from their
// `@UUID[Compendium…]` form to point at the freshly-created world copies, so a GM
// browsing the seeded journals stays inside the world. Links that target things we
// do NOT seed — the monster stat-block (Actor) and arcana (Item) compendiums —
// stay pointed at the compendium, where they live.

// The fresh-start orientation journal. Its compendium source is hidden from
// players (`ownership.default: 0`); once seeded we open up the world copy to
// OBSERVER so every player can read it — and `_openSettingOverviewOnce` (in
// hooks/Ready.js) pops it open for each user the first time they connect.
const SETTING_OVERVIEW_NAME = "Setting Overview";

// The name of the retired top-level wrapper folder that older seeds grouped the four
// gazetteer trees under. Kept only so unnestSeededWorldRootOnce can find and remove it in
// worlds seeded under that scheme; new seeds place the trees at the sidebar root.
const WORLD_FOLDER_NAME = "The World";

// Where each phase of the seed sits on the step's overall bar, for the first-load setup
// window (hooks/WorldSetup.js). The import dominates the wall clock; the two per-entry
// passes that follow are the part that can actually report motion, so they get the tail.
// Boundaries rather than widths, so the three visibly tile 0–1 (see progressSlice).
const SEED_PHASES = {
	import: [0, 0.55],
	remap:  [0.55, 0.85],
	stamp:  [0.85, 1],
};

/**
 * Whether this world still owes the gazetteer/journal import. The seed's own guard, lifted
 * out so the first-load setup window (hooks/WorldSetup.js) can list only the work that is
 * really coming without restating the conditions.
 */
export function needsJournalSeed() {
	return !!game.user?.isGM && !getSetting("seedingComplete");
}

export async function seedCompendiumJournalsOnce({ onProgress } = {}) {
	if (!needsJournalSeed()) return;

	const packs = game.packs.filter(
		p => p.documentName === "JournalEntry"
			&& p.metadata?.packageName === SYSTEM_ID
	);

	// compendium entry uuid → freshly-imported world entry uuid. The generators'
	// cross-links all target whole entries, so an entry-level map is enough and we
	// don't depend on import preserving ids. Entry names are unique within a pack,
	// so name is a safe join key.
	const linkMap = new Map();
	const created = [];

	// Each pack owns an equal slice of the import share, and reports where it is within it.
	const packBounds = progressSubSlice(SEED_PHASES.import, packs.length);

	onProgress?.({ fraction: 0, detail: "Reading the Stonetop compendium" });
	for (const [i, pack] of packs.entries()) {
		try {
			const docs = await importJournalPack(pack, null, {
				onProgress: progressSlice(onProgress, packBounds(i)),
			});
			if (!Array.isArray(docs)) continue;
			await ensurePackIndex(pack.collection);
			const worldUuidByName = new Map(docs.map(d => [d.name, d.uuid]));
			for (const idx of pack.index) {
				const worldUuid = worldUuidByName.get(idx.name);
				if (worldUuid) linkMap.set(`Compendium.${pack.collection}.JournalEntry.${idx._id}`, worldUuid);
			}
			created.push(...docs);
		} catch (err) {
			error(`Failed to seed journals from ${pack.collection}:`, err);
		}
	}

	await remapCrossLinks(created, linkMap, { onProgress: progressSlice(onProgress, SEED_PHASES.remap) });
	// Record the baseline fingerprint of each seeded entry (after the link remap, so
	// it matches what's stored) plus the version it was seeded at. Future loads use
	// this to tell a pristine entry — safe to refresh to a newer shipped version —
	// from one the GM has edited. See updateSeededJournalsOnVersionChange.
	await stampJournalBaselines(created, { onProgress: progressSlice(onProgress, SEED_PHASES.stamp) });
	await setSetting("journalSyncVersion", game.system.version);
	await openSettingOverviewToPlayers(created);

	// The seeded world journals carry the same `flags.stonetop.summary` as their
	// compendium source; drop the cached tooltip index so it rebuilds and the
	// rewritten (world-uuid) cross-links get their hover summaries.
	invalidateLocationSummaryIndex();

	// Set the flag regardless of partial failures: a retry would re-import the
	// packs that already succeeded and duplicate them, which is worse than a gap.
	await setSetting("seedingComplete", true);

	if (created.length) {
		info(`Seeded ${created.length} journal entries from compendiums into the world.`);
		ui.notifications?.info(`Stonetop: imported ${created.length} journal entries into your world.`);
	}
}

// One-time un-nest of the seeded "The World" wrapper. Earlier versions grouped the four
// gazetteer trees (Bestiary, Lore, Places, Reference) under a single top-level "The World"
// JournalEntry folder. That extra level pushed the deepest tree — the Bestiary codex, nested
// The World > Bestiary > section > region > entry — past Foundry's folder-render depth, so
// its region folders and their entries silently stopped showing (in the sidebar AND the
// compendium). We now seed the four trees at the sidebar root instead, one level shallower.
// For worlds seeded under the old scheme, lift each of "The World"'s children up to the root
// and delete the now-empty wrapper. GM-only; guarded by `worldRootUnnested` so it runs once
// and never fights a GM who later makes their own "The World" folder. A fresh world seeded
// under the new scheme has no such folder, so this is a no-op that just records the flag.
export async function unnestSeededWorldRootOnce() {
	if (!game.user?.isGM) return;
	if (getSetting("worldRootUnnested")) return;

	const world = (game.folders ?? []).find(f =>
		f.type === "JournalEntry" && f.name === WORLD_FOLDER_NAME && !f.folder
	);
	if (world) {
		try {
			// Reparent every direct child to the root FIRST, so the wrapper is empty when we
			// delete it — never relying on Foundry's folder-delete content handling.
			const children = (game.folders ?? []).filter(
				f => f.type === "JournalEntry" && (f.folder?.id ?? null) === world.id
			);
			if (children.length) {
				await Folder.updateDocuments(children.map(f => ({ _id: f.id, folder: null })));
			}
			await world.delete();
			info(`Un-nested ${children.length} gazetteer tree${children.length === 1 ? "" : "s"} from the "${WORLD_FOLDER_NAME}" folder.`);
		} catch (err) {
			error(`Failed to un-nest the seeded "${WORLD_FOLDER_NAME}" folder:`, err);
			return; // leave the flag unset so the next load retries
		}
	}
	await setSetting("worldRootUnnested", true);
}

// Import every entry in a journal pack into the world, recreating the folder
// subtree the entries use so the world mirrors the compendium's layout. The trees
// seed at the sidebar root (`rootParentId` is null). Folder resolution is best-effort
// — anything it can't place falls back to that root rather than failing the whole
// seed. Returns the created entries.
async function importJournalPack(pack, rootParentId = null, { onProgress } = {}) {
	const seed = await pack.getDocuments();
	if (!seed.length) return [];

	const packFolders = new Map();
	for (const f of pack.folders ?? []) packFolders.set(f.id, f);

	// Recreate a compendium folder (and its ancestors) in the world, memoised.
	// A null parent (compendium top-level folder, or an entry filed loose) maps
	// to `rootParentId` (the sidebar root), so the trees land at the top level.
	const worldFolderId = new Map();
	async function resolveFolder(cf) {
		const id = cf?.id ?? null; // `cf` is a Folder doc (or null)
		if (!id) return rootParentId;
		if (worldFolderId.has(id)) return worldFolderId.get(id);
		const folder = packFolders.get(id);
		if (!folder) return rootParentId;
		const parentId = await resolveFolder(folder.folder);
		// Reuse an existing world folder of the same name/parent (e.g. from an
		// earlier partial seed) instead of creating a duplicate.
		const existing = (game.folders ?? []).find(f =>
			f.type === "JournalEntry" && f.name === folder.name && (f.folder?.id ?? null) === parentId
		);
		const wf = existing ?? await Folder.create({
			name: folder.name, type: "JournalEntry", folder: parentId,
			sort: folder.sort ?? 0, color: rawFolderColor(folder),
		});
		worldFolderId.set(id, wf.id);
		return wf.id;
	}

	// Skip entries already present in the world (matched on the compendium source
	// `fromCompendium` stamps), so the seed is idempotent: if an earlier run only
	// imported some packs/entries — e.g. a partial failure — re-running imports just
	// the missing ones rather than duplicating what's already there. Matched without the
	// package id, so a world seeded under an older system id is not re-imported wholesale.
	const alreadySeeded = seededSourceKeys(game.journal);

	// fromCompendium prepares each doc for world creation (drops the id, stamps
	// `_stats.compendiumSource`) exactly as core's importAll does; we keep sort so
	// the seeded entries retain their authored order, and place them by folder.
	const data = [];
	for (const [i, d] of seed.entries()) {
		if (alreadySeeded.has(compendiumRefTail(d.uuid))) continue;
		const obj = game.journal.fromCompendium(d, { clearSort: false });
		obj.folder = await resolveFolder(d.folder);
		data.push(obj);
		// Folder resolution is the awaited part of this loop, so this is where the pack's
		// slice actually advances. The bulk create that follows is one round trip and
		// reports as the slice's last tick.
		onProgress?.({ fraction: (i + 1) / seed.length, detail: `Preparing ${data.length} journal entries` });
	}
	if (!data.length) return [];
	onProgress?.({ fraction: 1, detail: `Creating ${data.length} journal entries` });
	return JournalEntry.createDocuments(data);
}

// Grant players read access to the seeded Setting Overview journal so the
// fresh-start auto-open (hooks/Ready.js) can show it to them. Edits the world
// copy only; the compendium source stays GM-only.
async function openSettingOverviewToPlayers(entries) {
	const overview = entries.find(e => e.name === SETTING_OVERVIEW_NAME);
	if (!overview) return;
	const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
	if (overview.ownership?.default >= observer) return;
	try {
		await overview.update({ "ownership.default": observer });
	} catch (err) {
		error(`Failed to grant players access to "${SETTING_OVERVIEW_NAME}":`, err);
	}
}

// Rewrite @UUID links that target a seeded journal so they open the world copy.
// Links to documents we didn't import (bestiary, arcana) aren't in `linkMap`, so
// the replacer leaves them as compendium links.
async function remapCrossLinks(entries, linkMap, { onProgress } = {}) {
	if (!linkMap.size) return;
	const rewrite = makeRewriter(linkMap);
	for (const [i, entry] of entries.entries()) {
		onProgress?.({ fraction: i / entries.length, detail: `Linking cross-references (${i + 1} of ${entries.length})` });
		const updates = [];
		for (const page of entry.pages ?? []) {
			// Structured "location" pages keep their cross-links in system.sections
			// (prose bodies, Q&A, and grouped Dangers), not text.content; text pages in
			// text.content. `remapPageData` rewrites both in place — clone first, then
			// only write back the pages it actually changed.
			const obj = page.toObject();
			const before = JSON.stringify(page.type === "location" ? obj.system : obj.text);
			remapPageData(obj, rewrite);
			const after = JSON.stringify(page.type === "location" ? obj.system : obj.text);
			if (after === before) continue;
			updates.push(page.type === "location"
				? { _id: page.id, "system.sections": obj.system.sections }
				: { _id: page.id, "text.content": obj.text.content });
		}
		if (updates.length) {
			try { await entry.updateEmbeddedDocuments("JournalEntryPage", updates); }
			catch (err) { error(`Failed to remap cross-links in "${entry.name}":`, err); }
		}
	}
}

// Stamp each seeded entry with the fingerprint + version of the content we wrote, so
// later loads can tell a pristine entry from a GM-edited one (see managedHash).
async function stampJournalBaselines(entries, { onProgress } = {}) {
	const version = game.system.version;
	for (const [i, entry] of entries.entries()) {
		onProgress?.({ fraction: i / entries.length, detail: `Fingerprinting journals (${i + 1} of ${entries.length})` });
		try { await entry.setFlag(SYSTEM_ID, "journalSync", { hash: managedHash(entry.toObject()), version }); }
		catch (err) { error(`Failed to fingerprint seeded journal "${entry.name}":`, err); }
	}
}

// Tint the seeded gazetteer's four top-level trees (Bestiary, Lore, Places, Reference)
// so they read apart at a glance in the Journal sidebar. Only folders still at the default
// (uncoloured) are touched, so a GM who has recoloured one keeps their choice — the "unless
// the user changed it from the default" guard. Fresh worlds don't need this: the seed copies
// the compendium folder colours as it imports (resolveFolder), so those already match. This
// path is for worlds seeded before the colours shipped.
//
// GM-only; a no-op until the world has been seeded. Re-runs whenever the shipped colour
// scheme changes (guarded by the `seededFolderColorsSignature` world setting) so newly
// added or re-tinted categories reach already-seeded worlds — safe to repeat because it
// only ever colours still-default folders.
export async function syncSeededFolderColors() {
	if (!game.user?.isGM) return;
	if (!getSetting("seedingComplete")) return;
	// The recolour below matches each category by its TOP-LEVEL name, so it can only find the
	// gazetteer trees once unnestSeededWorldRootOnce has lifted them out of the retired "The
	// World" wrapper. That migration runs just before this in the ready chain but swallows its
	// own failures, so on a load where it did not complete the trees are still nested: a run
	// here would match nothing yet stamp the signature below, freezing the old colours in for
	// good (the next load's un-nest succeeds, but this early-returns on the matching signature).
	// Wait for the un-nest to record success; it retries next load on failure, and this follows.
	if (!getSetting("worldRootUnnested")) return;
	const signature = seededFolderColorSignature();
	const previous = getSetting("seededFolderColorsSignature");
	if (previous === signature) return;

	// Colours we applied under the previous scheme (parsed from the stored "Name=#hex|…"
	// signature): a folder still holding one of these is ours to re-tint; any other
	// non-default colour is the GM's own and left alone.
	const ownedColors = new Set(
		String(previous ?? "").split("|").map(part => part.split("=")[1]).filter(Boolean)
	);
	const updates = planSeededFolderColorUpdates(game.folders, SEEDED_FOLDER_COLORS, ownedColors);
	if (updates.length) {
		try {
			await Folder.updateDocuments(updates);
			info(`Coloured ${updates.length} seeded gazetteer folder${updates.length === 1 ? "" : "s"}.`);
		} catch (err) {
			error("Failed to colour seeded gazetteer folders:", err);
			return; // leave the signature unstamped so the next load retries
		}
	}
	await setSetting("seededFolderColorsSignature", signature);
}

// The merged journal compendium every seeded/imported world entry originates from.
const JOURNAL_PACK_ID = JOURNAL_PACK;

// Restore the `_stats.compendiumSource` stamp on world journals imported from our pack
// without it — a GM who deleted the world journals and re-imported the compendium another
// way (dropping the compiled pack's documents straight in) ends up with un-stamped copies.
// The render-time enhancers already recognise these by their baked `flags.stonetop` (see
// isStonetopJournalEntry), but the managed update channel + cross-link remap still key on
// the source stamp, so put it back. `compendiumSource` is a writable (non-server-managed)
// `_stats` field, so a plain update sticks. GM-only; idempotent — a no-op once every entry
// is stamped, so it's safe to run every load ahead of updateSeededJournalsOnVersionChange.
export async function restampSeededJournalSources() {
	if (!game.user?.isGM) return;
	const pack = game.packs.get(JOURNAL_PACK_ID);
	if (!pack) return;
	let updates;
	try {
		updates = planSourceRestamp(
			game.journal ?? [], (await ensurePackIndex(pack.collection))?.index ?? [], pack.collection);
	} catch (err) {
		error("Failed to index the journal pack for re-stamping:", err);
		return;
	}
	if (!updates.length) return;
	try {
		await JournalEntry.updateDocuments(updates);
		info(`Restored the compendium-source stamp on ${updates.length} imported journal${updates.length === 1 ? "" : "s"}.`);
	} catch (err) {
		error("Failed to restamp imported journal sources:", err);
	}
}

// compendium-entry uuid → world-entry uuid, drawn from journals already seeded into
// the world (each stamped with its `compendiumSource`). Mirrors the map the seed
// builds during import, so the update path rewrites new content's links the same way.
function buildWorldLinkMap() {
	const map = new Map();
	for (const j of game.journal ?? []) {
		const src = compendiumSourceOf(j);
		if (isOurCompendiumRef(src)) map.set(src, j.uuid);
	}
	return map;
}

/**
 * Whether the journal update channel has anything to do this load. The sync's own guard,
 * lifted out for the same reason needsJournalSeed is: the first-load setup window
 * (hooks/WorldSetup.js) decides whether to open on it, and a second copy of these conditions
 * would be a second thing to keep in step.
 *
 * Deliberately NOT folded into pendingSetupWork(): that reports the one-time content IMPORTS
 * a world still owes, and this is per-version maintenance an already-seeded world does
 * forever. They answer different questions and are gated separately.
 */
export function needsJournalSync() {
	return !!game.user?.isGM
		&& !!getSetting("seedingComplete")
		&& getSetting("journalSyncVersion") !== game.system?.version;
}

// Every entry the journal pack ships, keyed by its package-id-free identity so a world seeded
// under an older system id still matches its source (see compendiumRefTail).
//
// One bulk read in place of a `fromUuid` per world entry. The sync walks ~240 seeded entries
// on the GM's first load after EVERY version bump, including the majority of releases that
// change no journal content at all, and it does it on the awaited ready path. Returning an
// empty map on failure is not a silent loss: the caller falls back to resolving that entry's
// source on its own, which is what this replaced.
async function shippedJournalsByTail() {
	const pack = game.packs.get(JOURNAL_PACK_ID);
	if (!pack) return new Map();
	try {
		const docs = await pack.getDocuments();
		return new Map(docs.map(doc => [compendiumRefTail(doc.uuid), doc]).filter(([tail]) => tail));
	} catch (err) {
		error("Failed to read the journal pack for the version sync:", err);
		return new Map();
	}
}

// One entry's baseline stamp as update data, so a few hundred of them can go in a single
// call. A DOTTED key, which is what makes this equivalent to setFlag: it merges into the
// entry's existing flags rather than replacing the whole `flags` object and taking the
// reader's checkbox state (`flags.stonetop.checks`) with it. The hyphen in the scope is safe
// here because this is a string key, not a property access.
function stampUpdate(entry, hash, version) {
	return { _id: entry.id, [`flags.${SYSTEM_ID}.journalSync`]: { hash, version } };
}

// On a system-version bump, roll newly-shipped journal content into the world — but
// only for entries the GM hasn't touched. An entry is "pristine" when its current
// content fingerprint still equals the baseline we stamped when we last wrote it; a
// mismatch means the GM edited it, so we leave it and just point them at the
// compendium for the latest. Pristine entries whose shipped content actually changed
// are refreshed in place; the rest only have their version stamp bumped.
//
// Runs GM-only, once per version (guarded by the `journalSyncVersion` setting). Does
// nothing until the world has been seeded — fresh installs go through the seed path.
//
// Reports `{ fraction, detail }` per entry so the setup window can show a row for it. Worth a
// row on its own: on a settled world this is the ONLY thing running, and it used to be a
// silent multi-second stall on the first load after every update.
//
// Returns `{ stamped }`. False means the pass deliberately left this version unrecorded so the
// next load retries it, which the caller has to know about: a row that ticks itself off green
// after a write that did not land is worse than no row.
//
// @returns {Promise<{stamped: boolean}>}
export async function updateSeededJournalsOnVersionChange({ onProgress } = {}) {
	if (!needsJournalSync()) return { stamped: true };
	const version = game.system.version;

	const rewrite = makeRewriter(buildWorldLinkMap());
	const shipped = await shippedJournalsByTail();
	const entries = (game.journal ?? []).filter(e => isOurCompendiumRef(compendiumSourceOf(e)));
	const updated = [], skipped = [];
	// Entries whose content is already right and only need their version stamp moved on. This
	// is the overwhelming majority on a release that changed no journals, and it is the whole
	// reason the pass was slow: one awaited setFlag each, which is one server round trip and
	// one sidebar re-render broadcast per entry.
	const stamps = [];
	// Batching the stamps and prefetching the pack took every await out of the common path,
	// which is the point of both, but it also means this loop would hold the main thread from
	// the first entry to the last and the row above could never draw a frame. The yield goes at
	// the TOP of the body because four of the branches below `continue`, and those are exactly
	// the cheap-and-common ones a bottom-of-body yield would skip. See paint-yield.js.
	const yieldToPaint = makePaintYielder();

	for (const [index, entry] of entries.entries()) {
		onProgress?.({
			fraction: (index + 1) / entries.length,
			detail: `Checking ${index + 1} of ${entries.length}`,
		});
		await yieldToPaint();
		const src = compendiumSourceOf(entry);
		const source = shipped.get(compendiumRefTail(src)) ?? await fromUuid(src);
		if (!source) continue; // entry dropped from the pack this version — leave the world copy

		const worldHash = managedHash(entry.toObject());
		const baseline = entry.getFlag(SYSTEM_ID, "journalSync");
		// GM-edited: fingerprint drifted from what we last wrote. Hands off.
		if (baseline?.hash && baseline.hash !== worldHash) { skipped.push(entry.name); continue; }

		// The newly-shipped content, with its links remapped to this world's copies.
		const srcData = source.toObject();
		const newPages = (srcData.pages ?? []).map(p => remapPageData(p, rewrite));
		const newHash = managedHash({ pages: newPages });

		// No baseline yet (seeded before this feature shipped): only adopt one if the
		// world copy still matches the shipped content — otherwise we can't tell an edit
		// from version drift, so we never risk clobbering it.
		if (!baseline?.hash) {
			if (worldHash === newHash) stamps.push(stampUpdate(entry, newHash, version));
			else skipped.push(entry.name);
			continue;
		}

		// Pristine. If the shipped content is unchanged, just bump the version stamp.
		if (newHash === worldHash) { stamps.push(stampUpdate(entry, newHash, version)); continue; }

		// Pristine and the shipped version differs → refresh the entry's pages in place,
		// carrying over reader state (checkbox ticks) the content hash doesn't track so
		// updating the content doesn't wipe a player's progress.
		//
		// This branch keeps its own inline stamp rather than joining the batch: it has just
		// rewritten the entry's pages, and a baseline that lands separately from the content
		// it describes would read as a GM edit on the next load and freeze the entry out of
		// the update channel for good.
		try {
			const oldPageIds = entry.pages.map(p => p.id);
			const pagesToCreate = carryOverPageState(newPages, entry.toObject().pages)
				.map(({ _id, ...rest }) => rest);
			await entry.createEmbeddedDocuments("JournalEntryPage", pagesToCreate, { keepId: false });
			if (oldPageIds.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", oldPageIds);
			if (entry.name !== srcData.name) await entry.update({ name: srcData.name });
			await entry.setFlag(SYSTEM_ID, "journalSync", { hash: newHash, version });
			updated.push(entry.name);
		} catch (err) {
			error(`Failed to refresh seeded journal "${entry.name}":`, err);
			skipped.push(entry.name);
		}
	}

	// Report and invalidate BEFORE the stamp write, because these describe work the loop above
	// has already done and committed: pages recreated, links remapped, edits kept. The stamps are
	// only baselines for the NEXT run, so whether they land says nothing about any of it — and
	// failing to invalidate would leave the cached summaries pointing at page data that no longer
	// exists for the rest of the session, which is a wrong tooltip rather than a retryable one.
	if (updated.length || skipped.length) {
		invalidateLocationSummaryIndex(); // links/summaries may have moved
		const parts = [];
		if (updated.length) parts.push(`updated ${updated.length} journal${updated.length === 1 ? "" : "s"}`);
		if (skipped.length) parts.push(`kept your edits in ${skipped.length} (latest is in the compendium)`);
		ui.notifications?.info(`Stonetop: ${parts.join("; ")}.`);
		info(`Journal sync → v${version}. Updated: [${updated.join(", ")}]. Skipped (edited): [${skipped.join(", ")}].`);
	}

	if (stamps.length) {
		try {
			await JournalEntry.updateDocuments(stamps);
		} catch (err) {
			// Leave journalSyncVersion unstamped so the next load retries the whole pass, the
			// same contract every other seed here keeps. Re-running is free: the entries that
			// did land re-hash to the same value and simply get stamped again.
			error("Failed to stamp seeded journal baselines:", err);
			return { stamped: false };
		}
	}

	await setSetting("journalSyncVersion", version);
	return { stamped: true };
}
