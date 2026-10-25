// A SEASONS CHANGE, ON STONETOP'S OWN TIMELINE.
//
// The "Seasons Change" journal already holds the full record: a page per year, a block per season,
// the gains and the Fortunes and the Surplus movement written out. This is the one LINE that
// belongs on the timeline beside what the table wrote down themselves, so that a reader scanning
// the campaign sees the seasons turning between the things that happened in them.
//
// ⚠ STORED, NOT DERIVED, unlike the ledger rows. Two reasons, and the second is the real one:
//   • the season page's own content is HTML built for reading, and parsing it back out to date a
//     row would be a second, fragile reader of a format nothing else reads; and
//   • what happened in a season is the table's OWN history. A GM must be able to rewrite the line
//     or delete it, and nothing derived allows that.
// So it goes in as an ordinary entry wearing `source: "season"`, which is what makes it render
// quietly without making it untouchable.
//
// ONE ROW PER SEASON, replaced rather than repeated: the Seasons Change can be re-recorded to
// correct its journal entry, and a second line for the same season would be the correction sitting
// underneath the thing it corrects.

import { addEntry, isShortfallRow, patchEntry, sortEntries, TIMELINE_SHORTFALL_KEY_PREFIX } from "./timeline-core.js";
import { mutateTrack, trackForActor } from "./timeline-store.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { seasonLabel } from "../seasons/seasons-change-reminders.js";
import { sign } from "../utils/roll-engine.js";
import { escHtml, normaliseEditorText } from "../utils/strings.js";
import { hashString } from "../hooks/journal-sync-core.js";
import { TIER_LABELS } from "../utils/move-results.js";
import { seasonStamp } from "../seasons/campaign-year.js";

/**
 * The line a season prints on the timeline.
 *
 * Kept to what a reader would actually have written down: which season it was, how its +Fortunes
 * roll went, what the steading put its season into, and whether the stores went up or down. The roll
 * is its TIER, not its dice (user, 2026-10-10: it was left out as "a die result", and asked back):
 * a 6- is the season that went badly, which is a thing that happened.
 */
export function seasonEntryBody({ gainNames = [], surplusChange = 0, notes = "", fortunesTier = null } = {}) {
	const parts = [];
	const tierLabel = TIER_LABELS[fortunesTier];
	if (tierLabel) parts.push(`<p><strong>Fortunes roll:</strong> ${tierLabel}</p>`);
	if (gainNames.length) {
		parts.push(`<p><strong>Seasonal gain${gainNames.length > 1 ? "s" : ""}:</strong> ${gainNames.map(escHtml).join(", ")}</p>`);
	}
	if (Number.isFinite(surplusChange) && surplusChange !== 0) {
		parts.push(`<p><strong>Surplus:</strong> ${sign(surplusChange)}</p>`);
	}
	const trimmed = String(notes ?? "").trim();
	// Plain text the GM typed, escaped as the Seasons Change journal's own block escapes it.
	if (trimmed) parts.push(`<p>${escHtml(trimmed).replace(/\n/g, "<br>")}</p>`);
	return parts.join("");
}

/**
 * Find the row a previous run of this season left, if there is one.
 *
 * Matched on the SEASON AND YEAR rather than on an id we made up, because the fact being recorded
 * is "this is what that season was", and a season is identified by when it was. An id would have to
 * be stored somewhere else and kept in step.
 */
function existingSeasonRow(entries, seasonId, year) {
	// Never the shortfall: that is a second note in the same heading (seasonShortfallKey), and
	// re-recording the season must not write its summary over it.
	return entries.find(e => e.source === "season" && !isShortfallRow(e) && e.season === seasonId && e.year === year) ?? null;
}

/**
 * The change-detection hash of a season row's title and body, spelled-out entities and runs of
 * whitespace evened out first, so an editor re-saving the same words does not read as an edit.
 */
export function seasonRowHash(row) {
	return hashString(`${normaliseEditorText(row?.title)}\n${normaliseEditorText(row?.body)}`);
}

/**
 * Put one Seasons Change on the steading's thread, replacing the row a re-record left.
 *
 * GM-only in practice, since only a GM reaches the move that calls it. Answers null rather than
 * throwing on a world with no steading or no page it may write, so its caller can treat this as the
 * footnote it is.
 *
 * `lastHash` is the seasonRowHash of the row as the last recording wrote it. When it is given and
 * the row no longer matches it, the GM has rewritten the row and it is left as they wrote it.
 * Without it (a row recorded before the hash was kept) the row is replaced, as it always was.
 *
 * @returns {Promise<{page: object|null, hash: string|null}|null>}  `hash` is what the row now
 *   holds as we wrote it, or null when a GM's row was left alone.
 */
export async function recordSeasonOnTimeline({ seasonId, year, gainNames = [], surplusChange = 0, notes = "", fortunesTier = null, lastHash } = {}) {
	const track = trackForActor(getStonetopSteadingActor());
	if (!track) return null;

	const body = seasonEntryBody({ gainNames, surplusChange, notes, fortunesTier });
	const title = seasonLabel(seasonId);
	let leftAlone = false;

	// Through the store's own write path, which reads the page, skips a write that moves nothing,
	// and mints the page when the steading has no thread yet. This used to be spelled out here, and
	// a second copy of "read, mutate, no-op, write" is how the season line and the hand-typed one
	// come to behave differently.
	const done = await mutateTrack(track, (stored) => {
		const entries = sortEntries(stored);
		const already = existingSeasonRow(entries, seasonId, year);
		if (already && typeof lastHash === "string" && seasonRowHash(already) !== lastHash) {
			leftAlone = true;
			return { entries, changed: null };
		}
		return already
			? patchEntry(entries, already.id, { title, body })
			: addEntry(entries, {
				season: seasonId,
				year,
				title,
				body,
				source: "season",
				createdAt: Date.now(),
				authorId: game.user?.id ?? "",
			}, foundry.utils.randomID);
	}, { create: true });

	return { page: done?.page ?? null, hash: leftAlone ? null : seasonRowHash({ title, body }) };
}

// A SEASON'S SHORTFALL, ON ITS OWN LINE (user, 2026-10-10).
//
// A winter the steading could not feed, or a harvest that failed, is the worst news a season can
// carry, and it used to reach the timeline only as whatever the GM typed. It is written HERE, when
// it is suffered, rather than folded into the season's summary at Record the season: a winter's
// debt refused in the next spring belongs to that winter, long after its summary was written, and
// the Meet with Disaster pick it can lead to is a window closed some time later still.
//
// So it is a SECOND season note in the same heading: `source: "season"` (it prints in the heading,
// never as a card), keyed per season so each thing suffered APPENDS a line to it, and titled for
// what happened, which the heading prints because it is not the season's name.

/** The key a season's shortfall note is filed under: one per season, a line per thing suffered. */
export function seasonShortfallKey(seasonId, year) {
	return `${TIMELINE_SHORTFALL_KEY_PREFIX}${seasonStamp(year, seasonId)}`;
}

/** One line of a shortfall note, as it is stored: a paragraph of escaped plain text. */
export function shortfallParagraph(line) {
	return `<p>${escHtml(String(line ?? "").trim())}</p>`;
}

/**
 * Add one line to a season's shortfall note, minting the note on the first.
 *
 * Best-effort like the season's own row: null on a world with no steading or no page it may write,
 * and the caller treats it as the footnote it is.
 *
 * @param {object} opts
 * @param {string} opts.seasonId  The season suffered in.
 * @param {number} opts.year      Its year.
 * @param {string} opts.title     The note's title when it is minted ("Winter's shortfall").
 * @param {string} opts.line      Plain text, escaped here.
 */
export async function noteSeasonShortfall({ seasonId, year, title = "", line = "" } = {}) {
	const text = String(line ?? "").trim();
	if (!seasonId || !Number.isFinite(Number(year)) || !text) return null;
	const track = trackForActor(getStonetopSteadingActor());
	if (!track) return null;
	const key = seasonShortfallKey(seasonId, Number(year));
	const para = shortfallParagraph(text);
	const done = await mutateTrack(track, (stored) => {
		const entries = sortEntries(stored);
		const already = entries.find(e => e.key === key);
		return already
			? patchEntry(entries, already.id, { body: `${already.body ?? ""}${para}` })
			: addEntry(entries, {
				season: seasonId,
				year:   Number(year),
				title,
				body:   para,
				source: "season",
				key,
				createdAt: Date.now(),
				authorId: game.user?.id ?? "",
			}, foundry.utils.randomID);
	}, { create: true });
	return done?.page ?? null;
}
