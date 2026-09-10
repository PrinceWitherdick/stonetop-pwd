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

import { addEntry, patchEntry, sortEntries, TIMELINE_TRACK_STEADING } from "./timeline-core.js";
import { mutateTrack, trackForActor } from "./timeline-store.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { seasonLabel } from "../seasons/seasons-change-reminders.js";
import { sign } from "../utils/roll-engine.js";

/**
 * The line a season prints on the timeline.
 *
 * Kept to what a reader would actually have written down: which season it was, what the steading
 * put its season into, and whether the stores went up or down. The Fortunes roll is deliberately
 * left out -- it is a die result rather than a thing that happened, and the season page has it.
 */
export function seasonEntryBody({ gainNames = [], surplusChange = 0, notes = "" } = {}) {
	const parts = [];
	if (gainNames.length) {
		parts.push(`<p><strong>Seasonal gain${gainNames.length > 1 ? "s" : ""}:</strong> ${gainNames.join(", ")}</p>`);
	}
	if (Number.isFinite(surplusChange) && surplusChange !== 0) {
		parts.push(`<p><strong>Surplus:</strong> ${sign(surplusChange)}</p>`);
	}
	const trimmed = String(notes ?? "").trim();
	if (trimmed) parts.push(`<p>${trimmed.replace(/\n/g, "<br>")}</p>`);
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
	return entries.find(e => e.source === "season" && e.season === seasonId && e.year === year) ?? null;
}

/**
 * Put one Seasons Change on the steading's thread, replacing the row a re-record left.
 *
 * GM-only in practice, since only a GM reaches the move that calls it. Answers null rather than
 * throwing on a world with no steading or no page it may write, so its caller can treat this as the
 * footnote it is.
 */
export async function recordSeasonOnTimeline({ seasonId, year, gainNames = [], surplusChange = 0, notes = "" } = {}) {
	const steading = getStonetopSteadingActor();
	if (!steading) return null;

	const track = trackForActor(steading) ?? { trackId: TIMELINE_TRACK_STEADING, trackKind: "steading", name: steading.name };
	const body = seasonEntryBody({ gainNames, surplusChange, notes });
	const title = seasonLabel(seasonId);

	// Through the store's own write path, which reads the page, skips a write that moves nothing,
	// and mints the page when the steading has no thread yet. This used to be spelled out here, and
	// a second copy of "read, mutate, no-op, write" is how the season line and the hand-typed one
	// come to behave differently.
	const done = await mutateTrack(track, (stored) => {
		const entries = sortEntries(stored);
		const already = existingSeasonRow(entries, seasonId, year);
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

	return done?.page ?? null;
}
