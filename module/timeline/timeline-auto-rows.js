// WHAT THE SYSTEM ALREADY WROTE DOWN, ON THE TIMELINE.
//
// The change ledger is a timeline in all but presentation: it already knows that Kefta reached
// level 4, that three moves were learned, that somebody went past the Last Door. What it does not
// know is WHEN in the campaign any of that happened, because a ledger entry carries a wall-clock
// timestamp. `timeline-seasons.js` supplies the missing half, and this turns the pair into rows.
//
// ⚠ DERIVED AT RENDER TIME AND NEVER STORED. That is what makes these free to toggle off, free to
// change our minds about which categories are worth showing, and impossible to leave stale behind a
// ledger entry the GM has since deleted. It also means they cannot be edited or reordered, which is
// correct: they are a view of another record, not entries in this one.
//
// NOT EVERY LEDGER ENTRY, and the filter is the whole design. The ledger records every HP tick and
// every armour change, because its job is an audit trail; a timeline that folded those in would
// bury the one line somebody actually wrote about that season under forty rows of bookkeeping. What
// is kept is the handful of things a reader would have written down themselves.

import { getLedgerEntries } from "../utils/ledger-core.js";
import { seasonForTimestamp } from "./timeline-seasons.js";
import { derivedEntryId } from "./timeline-core.js";

/**
 * The ledger categories worth a place on a timeline.
 *
 * `leveling` is levels and XP thresholds; `moves` is what was learned or lost; `character` is the
 * lore, the instinct and the post-death inserts, which is where a death shows up. Deliberately NOT
 * `stats` (every point of HP), `inventory` (every tick of a supply), `relations`, `notes` or
 * `followers`: each of those changes many times a session.
 */
export const TIMELINE_LEDGER_CATEGORIES = ["leveling", "moves", "character"];

/**
 * Wounds are worth a row and live under `stats`, which as a whole is not.
 *
 * Matched on the action text rather than by adding a category, because the ledger's categories are
 * stamped from the changed PATH and a category invented for the timeline's benefit would have to be
 * threaded through `CharacterLedger` for no other reader. The strings come from
 * `woundLedgerEntries`, which prefixes every one of them this way.
 */
const WOUND_PREFIX = "Wound ";

/** Is this ledger entry one a timeline should show? */
export function isTimelineWorthy(entry) {
	if (!entry) return false;
	if (TIMELINE_LEDGER_CATEGORIES.includes(entry.category)) return true;
	return entry.category === "stats" && String(entry.action ?? "").startsWith(WOUND_PREFIX);
}

/**
 * Ledger entries as timeline cards, dated by the season log.
 *
 * Pure: both the entries and the log are passed in, so which rows appear and where they land is
 * decided in one testable place with no world in sight.
 *
 * ⚠ THE IDS ARE PREFIXED, and must be. A card's id is what the panel's delegated listener reads back
 * off a click to decide which entry to edit or remove, and a ledger id that happened to equal a
 * stored entry's would point an edit at the wrong record. A stored id is a `randomID`, which is
 * alphanumeric, so a colon puts these in a namespace the other cannot reach. The panel refuses a
 * write against one of these anyway, but two ids meaning two things is not a thing to leave resting
 * on a second guard.
 *
 * @param {Array} ledger  Entries as `getLedgerEntries` returns them, newest first.
 * @param {Array} log     The season log, as `readSeasonLog` returns it.
 * @returns {Array} entries in `timeline-core`'s own shape, ready to merge with the stored ones.
 */
export function ledgerTimelineRows(ledger = [], log = []) {
	const rows = [];
	for (const entry of ledger) {
		if (!isTimelineWorthy(entry)) continue;
		const when = seasonForTimestamp(log, entry.timestamp);
		rows.push({
			id:        derivedEntryId("ledger", entry.id),
			// A moment before the log begins has no season anybody knows, so it is left undated and
			// the timeline gathers it into its own "Before the record" block. Guessing at the first
			// logged season would file a whole campaign's history under one spring.
			season:    when?.season ?? "",
			year:      when?.year ?? 1,
			// Ordered among themselves by when they happened, which `sortEntries` then breaks ties
			// on by `createdAt` anyway. Left at 0 so a typed entry, which is given a real slot when
			// it is added, always sorts above the bookkeeping of the same season.
			order:     0,
			title:     _title(entry),
			place:     "",
			body:      "",
			source:    "ledger",
			createdAt: Number(entry.timestamp) || 0,
			authorId:  entry.userId ?? "",
		});
	}
	return rows;
}

/**
 * The line a row prints.
 *
 * The ledger's `action` is already written to be read by a person ("Moves learned (3): Aid, Clash,
 * Defend"), so it is used as it stands rather than re-worded here. What is added is the move that
 * caused it, where one was recorded: a bare "XP changed from 4 to 5" does not say why, and naming
 * the move is what makes the row worth a place. This mirrors how the ledger dialog itself prints
 * that attribution, and reads the same field.
 */
function _title(entry) {
	const action = String(entry?.action ?? "").trim();
	const move = String(entry?.move ?? "").trim();
	return move ? `${action} (via ${move})` : action;
}

/**
 * One track's ledger rows, read off its actor.
 *
 * The steading has a ledger of its own (Fortunes, Surplus, the debilities), and it is deliberately
 * NOT drawn here: its seasonal movement is already recorded on the steading's timeline as a proper
 * entry by the Seasons Change, and folding the raw ledger in as well would print the same season
 * twice in two voices.
 */
export function autoRowsForTrack(track, log) {
	if (!track?.actor || track.trackKind !== "character") return [];
	return ledgerTimelineRows(getLedgerEntries(track.actor), log);
}
