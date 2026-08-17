// Replaces the useless default "Journal Entry" hover tooltip on cross-links into
// the Stonetop journal pack with that entry's one-line summary.
//
// The summary is authored as a `flags.stonetop.summary` on each journal (by the
// gazetteer generators) and read here from the pack's compendium index — no
// documents are loaded. The index is built lazily and cached; render hooks
// (registered in stonetop.js) call applyLocationTooltips() on the rendered HTML.

import { isInJournalEditor } from "../utils/journal-editor-guard.js";
import { JOURNAL_PACK } from "../system-id.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { getHoverDescriptionSetting } from "../settings.js";
import { restrictContentLinks } from "../journal/restrict-content-links.js";

// Where the resolved summary is recorded regardless of the hover setting. The hover
// itself is `data-tooltip`, which we only stamp when the user wants hovers; but
// restrict-content-links.js needs to know a link HAS a player-safe summary to decide
// whether a de-linked cross-link keeps its text as a hoverable span or flattens to
// plain text. Keying that decision off `data-tooltip` alone would have meant switching
// hover descriptions off silently changed what players can read.
const SUMMARY_DATA_KEY = "stonetopSummary";

// Packs that carry hover summaries. The locations, lore, and bestiary-codex
// generators all stamp `flags.stonetop.summary`; they now ship in one merged pack.
const SUMMARY_PACKS = [JOURNAL_PACK];

let _indexPromise = null;

/**
 * Build (or return the cached) Map<uuid, summary> across every summary pack.
 * Caches the promise so concurrent callers share one in-flight build. Call once
 * on ready to warm the cache so the first hover is instant.
 */
export function ensureLocationSummaryIndex() {
	return _indexPromise ??= (async () => {
		const map = new Map();
		for (const packId of SUMMARY_PACKS) await _indexPackSummaries(map, packId);
		// Also index world journals carrying the summary flag — e.g. the copies
		// seeded into the world on first load (SeedCompendiums.js), whose
		// cross-links are rewritten to world uuids and so wouldn't match the
		// compendium-keyed entries above.
		for (const entry of game.journal ?? []) {
			const summary = entry.flags?.stonetop?.summary;
			if (summary) map.set(entry.uuid, summary);
		}
		return map;
	})();
}

/** Drop the cached summary index so the next lookup rebuilds it — call after
 *  world journals carrying summaries are added (e.g. compendium seeding). */
export function invalidateLocationSummaryIndex() {
	_indexPromise = null;
}

/** Index every summarized entry of one compendium pack into `map`, keyed by uuid
 *  (falling back to a constructed Compendium uuid for indexes that omit it). */
async function _indexPackSummaries(map, packId) {
	const pack = await ensurePackIndex(packId, ["flags.stonetop.summary"]);
	if (!pack) return;
	for (const entry of pack.index) {
		const summary = entry.flags?.stonetop?.summary;
		if (summary) map.set(entry.uuid ?? `Compendium.${pack.collection}.JournalEntry.${entry._id}`, summary);
	}
}

/**
 * Record the entry summary on every content-link in `root` that points at a summarized
 * Stonetop journal, and stamp it as `data-tooltip` (the hover itself) unless the user has
 * switched cross-link hovers off. Safe to call repeatedly.
 *
 * Always resolves — the summary bookkeeping runs whether or not hovers are wanted, so
 * {@link applyTooltipsThenRestrict} still classifies links correctly with hovers off
 * (see SUMMARY_DATA_KEY).
 * @param {HTMLElement|jQuery} root
 */
export async function applyLocationTooltips(root) {
	const el = root?.jquery ? root[0] : root;
	if (!el?.querySelectorAll) return;
	const links = el.querySelectorAll("a.content-link[data-uuid]");
	if (!links.length) return;

	const showHover = getHoverDescriptionSetting("hoverDescriptionsJournalLinks");
	const map = await ensureLocationSummaryIndex();
	for (const a of links) {
		// Skip links inside a live editor so the stamped tooltip can't ride into the
		// saved source on the next save (see journal-editor-guard.js).
		if (isInJournalEditor(a)) continue;
		const summary = map.get(a.dataset.uuid);
		if (!summary) continue;
		a.dataset[SUMMARY_DATA_KEY] = summary;
		if (showHover) a.dataset.tooltip = summary;
		// Re-runs are idempotent, and the setting can flip between them (the menu
		// re-renders sheets), so clear a tooltip left by an earlier pass.
		else delete a.dataset.tooltip;
	}
}

/**
 * Stamp the cross-link tooltips, then de-link what this reader may not see.
 *
 * ORDER IS THE POINT, and it was restated (with its own copy of this comment) at all three call
 * sites — the journal render hook, the actor-sheet render hook, and the Setting Overview dialog.
 * restrictContentLinks carries the just-stamped summary onto the de-linked span, so a player
 * still gets the hover description for Locations & Lore while the GM-only bestiary codex
 * flattens to plain text. It is a no-op for GMs, who keep every link — including broken ones,
 * which is how a dangling reference stays visible to the person who can fix it.
 *
 * The tooltip index is async, hence the chain; the catch is here so one failed pack index can't
 * leave a player looking at links that should have been restricted with nothing logged.
 *
 * @param {HTMLElement|jQuery} root
 */
export async function applyTooltipsThenRestrict(root) {
	try {
		await applyLocationTooltips(root);
	} catch (err) {
		console.error("Stonetop | cross-link tooltips failed; restricting links anyway", err);
	}
	restrictContentLinks(root);
}
