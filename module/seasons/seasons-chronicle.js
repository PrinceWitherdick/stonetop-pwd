import { escHtml } from "../utils/strings.js";
import { sign } from "../utils/roll-engine.js";
import { ensureChronicleFolder, ensureChronicleJournal } from "../utils/chronicle-journals.js";
import { seasonLabel, SEASON_IDS } from "./seasons-change-reminders.js";
import { SYSTEM_ID } from "../system-id.js";

// ── Seasons Change chronicle ───────────────────────────────────────────────────
// Records each Seasons Change move (the steading flow's "Done") into a "Seasons Change"
// journal inside the shared "The Chronicle" folder. There's one page per year — "Year One",
// "Year Two", … — typed into the season picker's year field (which opens on the campaign's
// current year, and advances when a Winter is completed). Each season folds into its year's
// page, under a heading, so a year reads top to bottom: Spring, Summer, Autumn, Winter.

const SEASONS_JOURNAL_NAME = "Seasons Change";

const _CARDINAL_WORDS = [
	"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
	"Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
	"Eighteen", "Nineteen", "Twenty",
];

/**
 * A small positive integer as a word: 1 → "One", 2 → "Two", … up to 20, then the numeral
 * itself ("21") for longer-running campaigns. Twenty is where the words stop earning their
 * keep — past it they are longer to read than the digits and the counting is the point.
 */
export function cardinalWord(n) {
	return _CARDINAL_WORDS[n] ?? String(n);
}

/**
 * What a campaign year is CALLED, everywhere it is named.
 *
 * Three surfaces show this string and they have to agree: the Chronicle page title in the
 * journal sidebar (below), the season picker's year chip, and the steading header's clock.
 * Nothing checks that they match at runtime, because `recordSeasonsChange` finds its page by
 * the `chronicleYear` flag rather than by name, so three hand-built copies could drift apart
 * silently and only show up as the sidebar disagreeing with the sheet.
 *
 * "Year One", not "First Year". The count leads, which is how the surfaces that show it are
 * read: the header's clock and the picker's chip are both a season next to a NUMBER, and the
 * journal sidebar is a column of years to scan down. An ordinal buries the digit behind a
 * word that changes shape every entry ("Fourth", "Twelfth"), so the eye has to read each
 * title to place it; "Year …" puts the constant first and the varying part where it can be
 * scanned. It also survives the fall-off past twenty without changing form — "Year 21" reads
 * as one of these, where "21st Year" reads as a different naming scheme.
 *
 * Pages named the old way are renamed on load — see module/migration/season-year-page-names.js.
 * That sweep reads THIS function, so the two cannot drift.
 */
export function yearLabel(year) {
	return `Year ${cardinalWord(year)}`;
}

// Find (or create) the "Seasons Change" journal in the Chronicle folder, reusing the
// shared folder/journal find-or-create so all of the Chronicle journals are built the
// same way. Player-readable (OBSERVER) like the introductions journal.
async function ensureSeasonsJournal() {
	const folder = await ensureChronicleFolder();
	if (!folder) return null;
	return ensureChronicleJournal(SEASONS_JOURNAL_NAME, folder.id, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
}

// One season's block within a year page: a heading for the season — carrying the
// matching season glyph, the same as the location journals (see .stonetop-season-entry
// in stonetop.css) — then the seasonal gains chosen, the Fortunes rolled against, any
// net Surplus change (the harvest/bounty or winter consumption), and any notes. Wrapped
// in a `<section data-season>` marker so re-recording a season can find and replace its
// block rather than appending a duplicate (see mergeSeasonBlock).
function _seasonBlock(seasonId, gainNames, fortunes, surplusChange, notes) {
	// CSS modifier matches the location pages' season classes ("autumn" art is "fall").
	const seasonClass = `stonetop-season--${seasonId === "autumn" ? "fall" : seasonId}`;
	const gainsHtml = gainNames.length
		? `<p><strong>Seasonal gain${gainNames.length > 1 ? "s" : ""}:</strong> ${gainNames.map(escHtml).join(", ")}</p>`
		: `<p><em>No seasonal gain.</em></p>`;
	const fortunesHtml = Number.isFinite(fortunes) ? `<p><strong>Rolled:</strong> +Fortunes (${sign(fortunes)})</p>` : "";
	const surplusHtml = Number.isFinite(surplusChange) && surplusChange !== 0
		? `<p><strong>Surplus change:</strong> ${sign(surplusChange)}</p>`
		: "";
	const notesHtml = notes?.trim() ? `<div>${escHtml(notes.trim()).replace(/\n/g, "<br>")}</div>` : "";
	return `<section class="stonetop-season-block" data-season="${seasonId}">`
		+ `<h2 class="stonetop-season-entry ${seasonClass}">${escHtml(seasonLabel(seasonId))}</h2>`
		+ `${gainsHtml}${fortunesHtml}${surplusHtml}${notesHtml}</section>`;
}

// Merge one season's block into a year page's existing HTML: if that season was already
// recorded, replace its block (so re-running a season overwrites rather than duplicates
// it); otherwise add it. Either way the result is re-emitted in canonical season order.
// Each block is a `<section data-season>` with no nested </section>, so the non-greedy
// match below pulls out one whole block at a time. Pure, so the tests can drive it.
export function mergeSeasonBlock(existingHtml = "", seasonId, block) {
	const blocks = {};
	const re = /<section class="stonetop-season-block"[\s\S]*?<\/section>/g;
	for (const m of (existingHtml.match(re) ?? [])) {
		const season = (m.match(/data-season="([^"]+)"/) ?? [])[1];
		if (season) blocks[season] = m;
	}
	blocks[seasonId] = block;
	// SEASON_IDS is the canonical Spring→Winter order, so a year page always reads in
	// order regardless of the order the GM happened to record the seasons in.
	return SEASON_IDS.map(s => blocks[s]).filter(Boolean).join("");
}

/**
 * Record one Seasons Change into the "Seasons Change" journal and return the journal
 * (so the caller can open it). One page per year — "Year One", "Year Two", … — tagged
 * with a `chronicleYear` flag. The caller picks the `year` (from the season picker's
 * year field, which opens on the campaign's current year); the season's
 * block is merged into that year's page (replacing an earlier block for the same
 * season rather than duplicating it), creating the page the first time. Records the seasonal
 * gains chosen, the Fortunes rolled against, the net Surplus change, and any notes the
 * GM jotted. GM-only.
 * @param {object}        opts
 * @param {string}        opts.seasonId       A SEASON_IDS key (spring/summer/autumn/winter).
 * @param {number}        [opts.year]         The campaign year this season belongs to (1+).
 * @param {string[]}      [opts.gainNames]    The seasonal gains chosen, by display name.
 * @param {number|null}   [opts.fortunes]     The +Fortunes value at the time (for context).
 * @param {number}        [opts.surplusChange] Net Surplus change over the season (0 = omit).
 * @param {string}        [opts.notes]        Free-text notes (the omen, threat, or hook).
 * @returns {Promise<JournalEntry|null>}
 */
export async function recordSeasonsChange({ seasonId, year = 1, gainNames = [], fortunes = null, surplusChange = 0, notes = "" } = {}) {
	if (!game.user?.isGM) {
		ui.notifications?.warn?.("Only the GM can record a Seasons Change.");
		return null;
	}
	const journal = await ensureSeasonsJournal();
	if (!journal) return null;

	const yr       = Number.isInteger(year) && year >= 1 ? year : 1;
	const yearName = yearLabel(yr);
	const block    = _seasonBlock(seasonId, gainNames, fortunes, surplusChange, notes);

	const page = (journal.pages ?? []).find(p => Number(p.getFlag?.(SYSTEM_ID, "chronicleYear")) === yr) ?? null;
	if (page) {
		await page.update({ "text.content": mergeSeasonBlock(page.text?.content ?? "", seasonId, block) });
	} else {
		const maxSort = (journal.pages ?? []).reduce((m, p) => Math.max(m, Number(p.sort) || 0), 0);
		await journal.createEmbeddedDocuments("JournalEntryPage", [{
			name:  yearName,
			type:  "text",
			sort:  maxSort + 10,
			text:  { content: block, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
			flags: { [SYSTEM_ID]: { chronicleYear: yr } },
		}]);
	}

	ui.notifications?.info?.(`Recorded ${seasonLabel(seasonId)} in “${yearName}” of the Seasons Change journal.`);
	return journal;
}
