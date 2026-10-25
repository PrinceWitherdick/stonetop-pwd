import { escHtml } from "../utils/strings.js";
import { sign, seasonsRollKey, seasonsRollTier } from "../utils/roll-engine.js";
import { TIER_LABELS } from "../utils/move-results.js";
import { ensureChronicleJournal, findChronicleJournal, withChronicleLock } from "../utils/chronicle-journals.js";
import { seasonLabel, SEASON_IDS } from "./seasons-change-reminders.js";
import { SYSTEM_ID } from "../system-id.js";
import { displayYear } from "./campaign-year.js";

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
 *
 * `year` is a STORED year (1 = the first year of play) and the number printed is what the GM
 * said that year is called (`displayYear`, campaign-year.js): "Year 1247" in a world that set its
 * start year, "Year One" in one that never did. A year from before play in a world that never
 * named its start reads "Ten Years Before Year One", never "Year -9".
 */
export function yearLabel(year) {
	const { count, tail } = yearLabelParts(year);
	return tail ? `${count} ${tail}` : count;
}

/**
 * `yearLabel` in its two halves: the COUNT a reader scans for ("Four Years", "Year Seven") and the
 * TAIL that only says which side of play it is on ("Before Year One"; empty for a year of play). The
 * timeline's year chips print the tail small (user, 2026-10-10: the long name took up a lot of
 * room), so they take the halves; everything else reads `yearLabel`, built from these, so the two
 * cannot drift. `tailShort` is the tail cut to "BYO", for the chip in a season's own heading (user,
 * 2026-10-10), where the year sits beside the season's name and room is tightest.
 */
export function yearLabelParts(year) {
	const shown = displayYear(year);
	if (shown >= 1) return { count: `Year ${cardinalWord(shown)}`, tail: "", tailShort: "" };
	const before = 1 - shown;
	return { count: `${cardinalWord(before)} ${before === 1 ? "Year" : "Years"}`, tail: "Before Year One", tailShort: "BYO" };
}

// Find (or create) the "Seasons Change" journal in the Chronicle folder. Player-readable
// (OBSERVER) like the introductions journal.
function ensureSeasonsJournal() {
	return ensureChronicleJournal(SEASONS_JOURNAL_NAME, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
}

// One season's block within a year page: a heading for the season — carrying the
// matching season glyph, the same as the location journals (see .stonetop-season-entry
// in stonetop.css) — then the seasonal gains chosen, the Fortunes rolled against, any
// net Surplus change (the harvest/bounty or winter consumption), and any notes. Wrapped
// in a `<section data-season>` marker so re-recording a season can find and replace its
// block rather than appending a duplicate (see mergeSeasonBlock).
function _seasonBlock(seasonId, gainNames, fortunes, surplusChange, notes, fortunesTier = null) {
	// CSS modifier matches the location pages' season classes ("autumn" art is "fall").
	const seasonClass = `stonetop-season--${seasonId === "autumn" ? "fall" : seasonId}`;
	const gainsHtml = gainNames.length
		? `<p><strong>Seasonal gain${gainNames.length > 1 ? "s" : ""}:</strong> ${gainNames.map(escHtml).join(", ")}</p>`
		: `<p><em>No seasonal gain.</em></p>`;
	// How the roll went, when its card can be found (seasonsRollTier): "7-9 on +Fortunes (+1)".
	const tierLabel = TIER_LABELS[fortunesTier] ?? "";
	const fortunesHtml = Number.isFinite(fortunes)
		? `<p><strong>Rolled:</strong> ${tierLabel ? `${tierLabel} on ` : ""}+Fortunes (${sign(fortunes)})</p>`
		: (tierLabel ? `<p><strong>Rolled:</strong> ${tierLabel} on +Fortunes</p>` : "");
	const surplusHtml = Number.isFinite(surplusChange) && surplusChange !== 0
		? `<p><strong>Surplus change:</strong> ${sign(surplusChange)}</p>`
		: "";
	const notesHtml = notes?.trim() ? `<div>${escHtml(notes.trim()).replace(/\n/g, "<br>")}</div>` : "";
	// The tier rides on the block as well as in its prose, so a re-record whose roll card has left
	// the chat log can carry it forward (recordedSeasonTier) instead of dropping it.
	const tierAttr = tierLabel ? ` data-fortunes-tier="${escHtml(fortunesTier)}"` : "";
	return `<section class="stonetop-season-block" data-season="${seasonId}"${tierAttr}>`
		+ `<h2 class="stonetop-season-entry ${seasonClass}">${escHtml(seasonLabel(seasonId))}</h2>`
		+ `${gainsHtml}${fortunesHtml}${surplusHtml}${notesHtml}</section>`;
}

// One season block, however the journal's editor has since spelled its opening tag (attributes
// reordered, more classes added). Each block is a `<section>` with no nested </section>, so the
// non-greedy match pulls out one whole block at a time.
const SEASON_BLOCK_RE = /<section\b[^>]*\bstonetop-season-block\b[^>]*>[\s\S]*?<\/section>/g;

// Which season a block records: its `data-season` marker, else (an editor that dropped the
// attribute) the season class on its heading, which _seasonBlock writes as well.
function blockSeason(blockHtml) {
	const marked = (blockHtml.match(/data-season="([^"]+)"/) ?? [])[1];
	if (marked) return marked;
	const cls = (blockHtml.match(/stonetop-season--(spring|summer|fall|autumn|winter)\b/) ?? [])[1];
	return cls === "fall" ? "autumn" : (cls ?? null);
}

// Every season block on a page, where it sits and which season it is.
function seasonBlocks(html) {
	return [...String(html ?? "").matchAll(SEASON_BLOCK_RE)].map(m => ({
		start:  m.index,
		end:    m.index + m[0].length,
		html:   m[0],
		season: blockSeason(m[0]),
	}));
}

/**
 * The Fortunes tier an earlier recording of this season wrote onto its block, or null. Read only
 * off the block's own `data-fortunes-tier` marker (_seasonBlock), never off its prose.
 */
export function recordedSeasonTier(html = "", seasonId) {
	for (const found of seasonBlocks(html)) {
		if (found.season !== seasonId) continue;
		const open = found.html.slice(0, found.html.indexOf(">") + 1);
		const tier = (open.match(/data-fortunes-tier="([^"]+)"/) ?? [])[1];
		return TIER_LABELS[tier] ? tier : null;
	}
	return null;
}

/**
 * Merge one season's block into a year page's existing HTML, leaving everything else on the page
 * exactly as it was: a season already recorded has its block replaced where it stands (so
 * re-running a season overwrites rather than duplicates it); a new one goes in before the first
 * block of a later season, so a year still reads Spring to Winter, else at the end. Whatever the
 * GM wrote around the blocks stays, byte for byte. Pure, so the tests can drive it.
 */
export function mergeSeasonBlock(existingHtml = "", seasonId, block) {
	const html  = String(existingHtml ?? "");
	const found = seasonBlocks(html);
	const same  = found.find(b => b.season === seasonId);
	if (same) return html.slice(0, same.start) + block + html.slice(same.end);
	const rank  = SEASON_IDS.indexOf(seasonId);
	const later = found.find(b => SEASON_IDS.indexOf(b.season) > rank);
	if (later) return html.slice(0, later.start) + block + html.slice(later.start);
	return html + block;
}

/**
 * Has this season of this year been recorded in the Seasons Change journal? Read-only.
 */
export function hasRecordedSeason(seasonId, year = 1) {
	const journal = findChronicleJournal(SEASONS_JOURNAL_NAME);
	const page = (journal?.pages ?? []).find(p => Number(p.getFlag?.(SYSTEM_ID, "chronicleYear")) === year) ?? null;
	return !!page && seasonBlocks(page.text?.content ?? "").some(b => b.season === seasonId);
}

// Per-year-page flag: the hash of the timeline row each season last wrote, so a re-record
// replaces that row only while it still says what we wrote (timeline-season-entry.js).
const SEASON_TIMELINE_FLAG = "seasonTimeline";

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
 * @param {string|null}   [opts.fortunesTier] How the season's +Fortunes roll went ("success" /
 *   "partial" / "failure"). Read off the season's own roll card when not given (seasonsRollTier);
 *   null when no card was stamped for it, which leaves the line as it always read.
 * @returns {Promise<JournalEntry|null>}
 */
export async function recordSeasonsChange({ seasonId, year = 1, gainNames = [], fortunes = null, surplusChange = 0, notes = "", fortunesTier } = {}) {
	if (!game.user?.isGM) {
		ui.notifications?.warn?.("Only the GM can record a Seasons Change.");
		return null;
	}
	const journal = await ensureSeasonsJournal();
	if (!journal) return null;
	// In the journal's page queue: two recordings at once would both find no year page and both make one.
	return withChronicleLock(journal, () => recordSeasonsChangeNow(journal, { seasonId, year, gainNames, fortunes, surplusChange, notes, fortunesTier }));
}

async function recordSeasonsChangeNow(journal, { seasonId, year, gainNames, fortunes, surplusChange, notes, fortunesTier }) {

	const yr       = Number.isInteger(year) && year >= 1 ? year : 1;
	const yearName = yearLabel(yr);
	const yearPage = () => (journal.pages ?? []).find(p => Number(p.getFlag?.(SYSTEM_ID, "chronicleYear")) === yr) ?? null;
	const page     = yearPage();
	// The roll's card first (a roll made again is the one the table went with); when the card has
	// left the chat log, what the last recording of this season wrote, so a re-record to fix a note
	// does not quietly drop how the roll went from the journal and the timeline both.
	const tier     = fortunesTier !== undefined
		? fortunesTier
		: (seasonsRollTier(seasonsRollKey(yr, seasonId)) ?? recordedSeasonTier(page?.text?.content ?? "", seasonId));
	const block    = _seasonBlock(seasonId, gainNames, fortunes, surplusChange, notes, tier);

	if (page) {
		await page.update({ "text.content": mergeSeasonBlock(page.text?.content ?? "", seasonId, block) });
	} else {
		const maxSort = (journal.pages ?? []).reduce((m, p) => Math.max(m, Number(p.sort) || 0), 0);
		await journal.createEmbeddedDocuments("JournalEntryPage", [{
			name:  yearName,
			type:  "text",
			sort:  maxSort + 10,
			text:  { content: block, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
			// The name it was given, so a later start year can tell it from one a GM typed
			// (migration/season-year-page-names.js#YEAR_PAGE_NAME_FLAG).
			flags: { [SYSTEM_ID]: { chronicleYear: yr, yearPageName: yearName } },
		}]);
	}

	// AND ONE ROW ON STONETOP'S OWN TIMELINE.
	//
	// The season page above is the full record, written the way the move itself is played; this is
	// the line a reader scanning the campaign sees. A STORED entry rather than a derived one, unlike
	// the ledger rows: what happened in a season is the table's own history and a GM should be able
	// to edit or delete it, which nothing derived allows.
	//
	// Best-effort, and deliberately after the notification: a world that cannot write the timeline
	// (no Chronicle folder rights, a deleted journal) has still recorded its Seasons Change, and
	// failing the move over its own footnote would be the wrong trade.
	//
	// IMPORTED AT CALL TIME, and not for laziness: a static import here closes a cycle. This module
	// owns `yearLabel`, which `seasons/current-season.js` imports; the timeline's core imports the
	// clock for `seasonRank`; and the timeline entry writer imports that core. Statically, the four
	// form a ring, and the symptom is not a warning but a const read before its initializer runs,
	// in whichever of them the loader happens to enter first.
	//
	// A row the GM has rewritten since we last wrote it stays theirs: the hash of what we wrote rides
	// on the year page, and the row is replaced only while it still matches.
	try {
		const { recordSeasonOnTimeline } = await import("../timeline/timeline-season-entry.js");
		const target   = yearPage();
		const lastHash = target?.getFlag?.(SYSTEM_ID, SEASON_TIMELINE_FLAG)?.[seasonId];
		const written  = await recordSeasonOnTimeline({ seasonId, year: yr, gainNames, surplusChange, notes, fortunesTier: tier, lastHash });
		if (target && written?.hash && written.hash !== lastHash) {
			await target.update({ [`flags.${SYSTEM_ID}.${SEASON_TIMELINE_FLAG}.${seasonId}`]: written.hash });
		}
	} catch (err) {
		console.error("Stonetop | could not add this season to the timeline", err);
	}

	ui.notifications?.info?.(`Recorded ${seasonLabel(seasonId)} in “${yearName}” of the Seasons Change journal.`);
	return journal;
}
