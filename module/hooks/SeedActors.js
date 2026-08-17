import { BESTIARY_PACK } from "../system-id.js";
import { getSetting, setSetting } from "../settings.js";
import { info, error } from "../utils/logger.js";
import { compendiumRefTail, seededSourceKeys } from "../migration/compat.js";
import { BESTIARY_ROOT_NAME, BESTIARY_FOLDER_COLOR, planBestiaryFolderTree } from "./bestiary-seed-core.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { progressSlice, SEED_FOLDER_PHASE, SEED_BULK_CREATE_FRACTION } from "../utils/progress-slice.js";

// On load, import the system's "Monsters" (stonetop-bestiary) actor compendium into the
// world's Actors sidebar under a single red "Bestiary" folder tree that mirrors the
// compendium's layout — so the GM has every monster sheet ready to drag onto a scene
// without opening a compendium, organised exactly like the Bestiary journal codex and in
// the same brick-red. Companion to SeedCompendiums (which seeds the JOURNAL packs); the
// two are independent, so an established world whose journals were seeded long ago still
// gets the monsters on the first load after this ships.
//
// GM-only and once per world (guarded by the `bestiaryActorsSeeded` world setting). The
// imported actors are stamped ownership NONE, so players never see them in their sidebar —
// matching the GM-only Monsters compendium and the codex's player-spoiler protection.

const BESTIARY_PACK_ID = BESTIARY_PACK;

/**
 * Whether this world still owes the bestiary import. The seed's own guard, lifted out so the
 * first-load setup window (hooks/WorldSetup.js) can list only the work that is really coming
 * without restating the conditions — a row that instantly ticks itself off having done
 * nothing is exactly what that window exists to avoid.
 *
 * Primary GM only: the ~200-actor import is not atomic with the `bestiaryActorsSeeded` flag
 * (set only after it finishes), and idempotency rests on an alreadySeeded set read before
 * createDocuments — so two GMs both entering ready on a fresh world would each seed the full
 * bestiary and double it. Matches ensureStonetopSingleton's guard. A missing pack (a dev
 * build without it) means there is nothing to seed either.
 */
export function needsBestiaryActorSeed() {
	if (!game.user?.isGM || !isPrimaryGM()) return false;
	if (getSetting("bestiaryActorsSeeded")) return false;
	return !!game.packs.get(BESTIARY_PACK_ID);
}

export async function seedBestiaryActorsOnce({ onProgress } = {}) {
	if (!needsBestiaryActorSeed()) return;
	const pack = game.packs.get(BESTIARY_PACK_ID);

	try {
		const created = await importBestiaryActors(pack, { onProgress });
		// Set the flag regardless of how many landed: the import skips actors already
		// present, so a re-run would only ever add genuinely-missing ones — but a latched
		// flag also means a GM who deletes some monsters won't have them re-seeded.
		await setSetting("bestiaryActorsSeeded", true);
		if (created.length) {
			info(`Seeded ${created.length} monster actors into the world Bestiary folder.`);
			ui.notifications?.info(`Stonetop: imported ${created.length} monsters into your Actors sidebar.`);
		}
	} catch (err) {
		error("Failed to seed the bestiary actors into the world:", err);
		// Leave `bestiaryActorsSeeded` unset so the next load retries rather than
		// stranding a half-imported tree.
	}
}

// One-time collapse of the seeded world Bestiary's actor subfolders. The tree was originally
// seeded as Bestiary > section > region > creature > actor, but Foundry won't render folders
// past ~depth 3 (see the folder-render-depth limit), so the deepest monsters were hidden.
// Flatten so every monster sits DIRECTLY under its section (The Makers / Peoples & Folk /
// Primordial & Mythic Powers / Regions): reparent all actors under a section to that section,
// then delete the now-empty subfolders. GM-only, guarded by `bestiaryActorFoldersCollapsed`.
// A fresh world seeded from the already-collapsed compendium has no subfolders, so this is a
// no-op that just records the flag.
export async function collapseBestiaryActorSubfoldersOnce() {
	if (!game.user?.isGM) return;
	if (getSetting("bestiaryActorFoldersCollapsed")) return;

	const root = (game.folders ?? []).find(f => f.type === "Actor" && f.name === BESTIARY_ROOT_NAME && !f.folder);
	if (root) {
		try {
			// parent id -> child Actor folders, so we can walk each section's subtree.
			const childrenOf = new Map();
			for (const f of game.folders ?? []) {
				if (f.type !== "Actor") continue;
				const pid = f.folder?.id ?? null;
				if (!childrenOf.has(pid)) childrenOf.set(pid, []);
				childrenOf.get(pid).push(f);
			}
			const depthOf = (f) => { let d = 0, cur = f; while (cur) { d++; cur = cur.folder; } return d; };

			// Map every folder strictly below a section to that section (subtrees are
			// disjoint, so each folder belongs to exactly one), collecting the folders to
			// delete as we go. Then one pass over the actors reparents each to its section.
			const sectionOfFolder = new Map();
			const foldersToDelete = [];
			for (const section of childrenOf.get(root.id) ?? []) {
				const stack = [...(childrenOf.get(section.id) ?? [])];
				while (stack.length) {
					const f = stack.pop();
					sectionOfFolder.set(f.id, section.id);
					foldersToDelete.push(f);
					for (const c of childrenOf.get(f.id) ?? []) stack.push(c);
				}
			}
			const actorUpdates = [];
			for (const a of game.actors ?? []) {
				const section = a.folder && sectionOfFolder.get(a.folder.id);
				if (section) actorUpdates.push({ _id: a.id, folder: section });
			}

			// Move the monsters up FIRST, so deleting the subfolders never touches an actor.
			if (actorUpdates.length) await Actor.updateDocuments(actorUpdates);
			if (foldersToDelete.length) {
				// Deepest-first so deleting a parent never strands a child mid-batch.
				foldersToDelete.sort((a, b) => depthOf(b) - depthOf(a));
				await Folder.deleteDocuments(foldersToDelete.map(f => f.id));
			}
			info(`Collapsed the world Bestiary: moved ${actorUpdates.length} monsters up, removed ${foldersToDelete.length} subfolder${foldersToDelete.length === 1 ? "" : "s"}.`);
		} catch (err) {
			error("Failed to collapse the world Bestiary actor subfolders:", err);
			return; // leave the flag unset so the next load retries
		}
	}
	await setSetting("bestiaryActorFoldersCollapsed", true);
}

// Import every monster sheet from `pack` into the world, recreating the pack's folder
// subtree under a red "Bestiary" root. Idempotent: reuses an existing world "Bestiary"
// tree (folder match on name+parent) and skips actors already imported (matched on
// compendiumSource), so a partial run — or a reload mid-import — recovers on the next load
// without duplicating. Returns the created actors.
async function importBestiaryActors(pack, { onProgress } = {}) {
	onProgress?.({ fraction: 0, detail: "Reading the Monsters compendium" });
	const docs = await pack.getDocuments();
	if (!docs.length) return [];

	// Realise the folder plan: create (or reuse) each folder in order, recording
	// pack-folder-id -> world-folder-id so actors can be filed against it below.
	const packFolders = Array.from(pack.folders ?? []).map(f => ({
		id: f.id, name: f.name, parentId: f.folder?.id ?? null, sort: f.sort ?? 0,
	}));
	const plan = planBestiaryFolderTree(packFolders, { rootName: BESTIARY_ROOT_NAME, color: BESTIARY_FOLDER_COLOR });

	const rootId = await ensureActorFolder(BESTIARY_ROOT_NAME, null, plan.root.color);
	const worldFolderId = new Map(); // packFolderId -> worldFolderId
	const reportFolder = progressSlice(onProgress, SEED_FOLDER_PHASE);
	for (const [i, f] of plan.folders.entries()) {
		const parentId = f.parentPackId ? worldFolderId.get(f.parentPackId) : rootId;
		worldFolderId.set(f.packId, await ensureActorFolder(f.name, parentId, f.color, f.sort));
		// The folders are created one at a time, so this is the only part of the import with
		// per-item motion to report; it owns the head of the step's bar (see FOLDER_PHASE).
		reportFolder?.({ fraction: (i + 1) / plan.folders.length, detail: "Building the Bestiary folders" });
	}
	// A collapsed pack "Bestiary" wrapper (rebuilt compendium) maps onto the world root, so
	// actors filed directly under it still resolve to the root rather than to nothing.
	for (const id of plan.collapsedIds) worldFolderId.set(id, rootId);

	// Actors already carried into the world (by an earlier seed, or a GM drag from the
	// compendium) are matched on their compendium source and left alone — no duplicates.
	// Matched without the package id, so a world seeded under an older system id is not
	// re-imported wholesale.
	const alreadySeeded = seededSourceKeys(game.actors);

	const data = [];
	for (const d of docs) {
		if (alreadySeeded.has(compendiumRefTail(d.uuid))) continue;
		// fromCompendium prepares the doc for world creation (drops the id, stamps
		// `_stats.compendiumSource`); keep sort so the authored order is preserved.
		const obj = game.actors.fromCompendium(d, { clearSort: false });
		const pf = d.folder?.id ?? null;
		obj.folder = (pf && worldFolderId.has(pf)) ? worldFolderId.get(pf) : rootId;
		// GM-only content: players must not find the monster sheets in their Actors sidebar.
		obj.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
		data.push(obj);
	}
	if (!data.length) return [];
	onProgress?.({ fraction: SEED_BULK_CREATE_FRACTION, detail: `Creating ${data.length} monster sheets` });
	return Actor.createDocuments(data);
}

// Find-or-create a world Actor folder by name+parent, tinting it. Reuses an existing match
// (from an earlier partial seed, or a GM-made folder of the same name in the same place)
// rather than duplicating. Returns the folder id, or null if creation fails — in which case
// the caller falls back to the parent/root, so a single failure never aborts the import.
async function ensureActorFolder(name, parentId, color, sort = 0) {
	const existing = (game.folders ?? []).find(f =>
		f.type === "Actor" && f.name === name && (f.folder?.id ?? null) === (parentId ?? null)
	);
	if (existing) return existing.id;
	try {
		const created = await Folder.create({ name, type: "Actor", folder: parentId ?? null, color, sort });
		return created?.id ?? null;
	} catch (err) {
		error(`Failed to create the "${name}" actor folder:`, err);
		return null;
	}
}
