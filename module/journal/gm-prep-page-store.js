// Factory for the CRUD shared by the "GM-prep page" families: threats, hazards and sites.
// Each family stores ALL of a steading's items as pages of ONE hidden JournalEntry
// (named "<Steading> Threats" / "<Steading> Hazards" / "<Steading> Sites"); the steading
// points at that entry via a flag. See threat-store.js for the full rationale: in short,
// these are pure GM prep that is never shared with players, so a single many-page journal
// is safe (there is no per-item "reveal", hence no whole-entry-broadcast leak to guard).
//
// All three families share this entire surface and differ only in the config constants
// below plus the seed->system shaper, so the CRUD lives once here. Deleting is shared too and
// lives at the bottom of this file; the doom-tick is threat-only and stays in threat-store.
import { STONETOP_SCOPE, resolvedFlagProperty } from "../actors/character/StonetopFlags.js";

// Looked up lazily (not at module load) so callers import cleanly outside Foundry.
const OWN = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;
// Spacing between successive page sort values, so new pages append after existing ones.
const SORT_STEP = 100000;

/**
 * @param {object} cfg
 * @param {string} cfg.pageType     JournalEntryPage type ("threat" | "hazard" | "site").
 * @param {string} cfg.entryFlag    Boolean flag marking the entry as ours (flags.<scope>.<entryFlag>).
 * @param {string} cfg.entryFlagId  Steading flag holding the entry id (e.g. "threatsEntryId").
 * @param {string} cfg.entrySuffix  Journal name suffix (e.g. "Threats" -> "<Steading> Threats").
 * @param {string} cfg.defaultName  Fallback name for a nameless page (e.g. "New Threat").
 * @param {(seed:object)=>object} cfg.shapeSystem  Creation/edit seed -> page.system data.
 * @returns {{entryId,getEntry,listPages,pageById,ensureEntry,create,setName}}
 */
export function makeGmPrepPageStore({ pageType, entryFlag, entryFlagId, entrySuffix, defaultName, shapeSystem }) {
	/** The id of the steading's single entry for this page family, if one has been created. */
	const entryId = (steadingActor) => resolvedFlagProperty(steadingActor, "steading")?.[entryFlagId] ?? null;

	/** Resolve the steading's single entry, or null. Never creates. */
	const getEntry = (steadingActor) => {
		const id = entryId(steadingActor);
		return id ? (game.journal?.get(id) ?? null) : null;
	};

	/** The steading's pages of this family, in sort order. */
	const listPages = (steadingActor) => {
		const entry = getEntry(steadingActor);
		if (!entry) return [];
		return entry.pages
			.filter(p => p.type === pageType)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
	};

	/** Resolve a page from an entry/page id pair (as a scene Note links it), or null. */
	const pageById = (id, pageId) => {
		if (!id || !pageId) return null;
		const page = game.journal?.get(id)?.pages?.get(pageId);
		return page?.type === pageType ? page : null;
	};

	/** Resolve the steading's single entry, creating it (GM-only) on first use. */
	const ensureEntry = async (steadingActor) => {
		const existing = getEntry(steadingActor);
		if (existing) return existing;
		if (!game.user?.isGM) return null;

		const entry = await JournalEntry.create({
			name: `${steadingActor.name} ${entrySuffix}`,
			ownership: { default: OWN().NONE },
			flags: { [STONETOP_SCOPE]: { [entryFlag]: true } },
		});
		await steadingActor.typedActor.setFlags({ [entryFlagId]: entry.id });
		return entry;
	};

	/** Create a new item as a page appended to the steading's single (GM-only) entry. */
	const create = async (steadingActor, seed = {}) => {
		const entry = await ensureEntry(steadingActor);
		if (!entry) return null;

		const name = String(seed.name ?? "").trim() || defaultName;
		const maxSort = entry.pages.reduce((m, p) => Math.max(m, p.sort ?? 0), 0);
		const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
			type: pageType,
			name,
			sort: maxSort + SORT_STEP,
			system: shapeSystem(seed),
		}]);
		return page ?? null;
	};

	/** Rename everywhere the name is identity: the page and any placed scene Note pins
	 *  (siblings share one entry, so the pin match keys on pageId too). The entry keeps its
	 *  "<Steading> <Suffix>" name. */
	const setName = async (page, name) => {
		const clean = String(name ?? "").trim() || defaultName;
		if (!page) return;
		if (page.name !== clean) await page.update({ name: clean });
		const entry = page.parent;
		if (game.user?.isGM && game.scenes && entry) {
			for (const scene of game.scenes) {
				const updates = scene.notes
					.filter(n => n.entryId === entry.id && n.pageId === page.id && n.text !== clean)
					.map(n => ({ _id: n.id, text: clean }));
				if (updates.length) await scene.updateEmbeddedDocuments("Note", updates).catch(() => {});
			}
		}
	};

	return { entryId, getEntry, listPages, pageById, ensureEntry, create, setName };
}

/**
 * Delete a GM-prep page of ANY kind: the page, its scene Note pins, and the journal entry behind
 * it once nothing is left in it.
 *
 * Notes link back via `entryId` + `pageId`; siblings share the entry, so the pin match keys on
 * both. When the last page goes, the now-empty journal is removed too so no bare
 * "<Steading> Threats" entry lingers. GM-only (all three families are GM prep).
 *
 * ONE function with ONE name. This work is page-shaped, not kind-shaped — it names no flag and no
 * store — and it used to live in threat-store with `deleteHazard` and `deleteSite` re-exporting it
 * from there. Three names for one behaviour meant a caller had to pick a kind it did not care
 * about, and the kind-neutral module imported its shared behaviour out of one kind's store: had
 * `deleteThreat` ever grown something threat-only (a doom-track flag, a board notification) sites
 * and hazards would silently have inherited it. It belongs here, beside the CRUD it is the other
 * half of.
 */
export async function deleteGmPrepPage(page) {
	const entry = page?.parent;
	if (!entry) return;
	const entryId = entry.id;
	const pageId = page.id;
	if (game.user?.isGM && game.scenes) {
		for (const scene of game.scenes) {
			const noteIds = scene.notes.filter(n => n.entryId === entryId && n.pageId === pageId).map(n => n.id);
			if (noteIds.length) await scene.deleteEmbeddedDocuments("Note", noteIds).catch(() => {});
		}
	}
	await page.delete();
	// Tidy up: once the last page is gone, drop the empty journal (a later create re-mints it).
	if (!entry.pages?.size) await entry.delete().catch(() => {});
}
