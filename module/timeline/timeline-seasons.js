// WHEN EACH SEASON BEGAN, IN REAL TIME.
//
// THE PROBLEM THIS SOLVES. The timeline's auto rows are drawn from the per-actor change ledger --
// levels gained, moves learned, wounds taken -- and a ledger entry carries a wall-clock
// `timestamp` and no in-game date at all. There is no way to place "Kefta reached level 4" in a
// season from the entry alone.
//
// TWO WAYS TO FIX THAT, and the one not taken is worth writing down. The obvious one is to stamp
// the season onto each ledger entry as it is written, which means resolving the steading (an
// unindexed `game.actors` scan) on the hot path of every HP tick in the world, and leaves every
// entry recorded before the feature shipped unplaceable for ever. The other is to record when each
// season BEGAN, once, and look a timestamp up against that. `recordCurrentSeason` is the single
// writer of the clock, so this is one call site rather than a change to the ledger at all -- and it
// places old entries as well as new ones, because a log written today still says which season the
// campaign was in last March.
//
// The lookup is pure, so which season a given moment falls in is decided in one testable place.

import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { SEASON_IDS } from "../seasons/seasons-change-reminders.js";
import { campaignYear, seasonStampKey } from "../seasons/current-season.js";

/** Flag key on the steading holding the log: `[{ key, year, season, at }]`, oldest first. */
export const SEASON_LOG_KEY = "seasonsLog";

/**
 * How many turnings to keep.
 *
 * A flag is not a table and this one rides on the steading, which is written on constantly. Sixty
 * is fifteen years of play, well past any campaign this will see, and an entry older than the
 * oldest row simply falls into that row's season, which is the same answer it would have got.
 */
export const SEASON_LOG_MAX = 60;

/**
 * The log, normalised and oldest first.
 *
 * Sorted on read rather than trusted: the log is appended to in campaign order, but a GM correcting
 * the clock records an OLDER season after a newer one, which is a real and supported thing to do
 * (see `advanceOnly`). Sorting by `at` keeps the lookup below a simple walk either way.
 */
export function readSeasonLog(actor) {
	const raw = actor?.getFlag?.(STONETOP_SCOPE, SEASON_LOG_KEY);
	if (!Array.isArray(raw)) return [];
	return raw
		.filter(row => SEASON_IDS.includes(row?.season) && Number.isFinite(Number(row?.at)))
		.map(row => ({
			key:    String(row.key ?? seasonStampKey(row)),
			year:   campaignYear(row.year),
			season: row.season,
			at:     Number(row.at),
		}))
		.sort((a, b) => a.at - b.at);
}

/**
 * Add one turning to a log. Pure, so the trimming and the first-wins rule are testable.
 *
 * ⚠ A SEASON ALREADY IN THE LOG IS LEFT ALONE, and the rule is FIRST WINS rather than last. The
 * question this log answers is when a season BEGAN, and a GM re-recording a Seasons Change three
 * weeks later to fix its journal entry has not moved when that season started: they were already
 * playing it. Taking the later timestamp would push every ledger entry recorded in those three
 * weeks back into the previous season.
 *
 * It also makes re-recording a genuine no-op, which is what lets the clock's writer keep skipping
 * the document write when nothing has actually changed.
 */
export function appendSeasonLog(log, { season, year, at }) {
	if (!SEASON_IDS.includes(season) || !Number.isFinite(Number(at))) return log ?? [];
	const key = seasonStampKey({ season, year });
	const rows = log ?? [];
	if (rows.some(row => row.key === key)) return rows;
	const next = [...rows, { key, year: campaignYear(year), season, at: Number(at) }];
	next.sort((a, b) => a.at - b.at);
	return next.slice(-SEASON_LOG_MAX);
}

/**
 * Which season the campaign was in at a given moment.
 *
 * A walk from the newest turning backwards: the season a moment belongs to is the last one that had
 * begun by then.
 *
 * ⚠ ANSWERS NULL FOR A MOMENT BEFORE THE LOG BEGINS, and that is the honest answer rather than a
 * shortcoming. Every world that was in play before this shipped has a ledger going back further
 * than its log does, and filing those under the first recorded season would be inventing a date for
 * them. The timeline gathers them into its own "Before the record" block instead, which says what
 * is actually known.
 *
 * @returns {{year: number, season: string}|null}
 */
export function seasonForTimestamp(log, timestamp) {
	const at = Number(timestamp);
	if (!Number.isFinite(at)) return null;
	const rows = Array.isArray(log) ? log : [];
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].at <= at) return { year: rows[i].year, season: rows[i].season };
	}
	return null;
}

/**
 * The update fragment that adds one turning, or NULL when this season is already logged.
 *
 * Handed back rather than written here so `recordCurrentSeason` stays the one writer of the whole
 * clock: the stamp, the picker's year and this log all move in one `actor.update()`, and there is
 * no ordering for a caller to get wrong. Null rather than an unchanged fragment so that writer can
 * still skip the document write entirely when nothing has moved, which is what keeps a re-recorded
 * season from re-rendering every open sheet to no effect.
 *
 * ⚠ THE WHOLE ARRAY, ALWAYS. Foundry's update merge treats an array as one atomic value, so there
 * is no such thing as appending to one through a dotted path.
 */
export function seasonLogUpdate(actor, { season, year, at = Date.now() }) {
	const before = readSeasonLog(actor);
	const after = appendSeasonLog(before, { season, year, at });
	return after === before ? null : { [SEASON_LOG_KEY]: after };
}
