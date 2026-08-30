import { SEASON_IDS, seasonLabel } from "./seasons-change-reminders.js";
import { yearLabel } from "./seasons-chronicle.js";
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";

// ── The steading's clock ──────────────────────────────────────────────────────
// The Seasons Change move is the campaign's calendar: each run names the season that
// is beginning and the year it belongs to. Both are stamped onto the steading when the
// move completes — by the steading flow's Done and by the opening spring of the
// session-zero walkthrough — and the steading sheet's header reads them back, so the
// sheet says which season and year the table is playing in.
//
// ONE flag holding both halves of the STAMP, not two, because the year on its own is
// ambiguous: `seasonsCurrentYear` advances the moment a Winter is completed (it is the season
// picker's default for NEXT time), so pairing a stamped season with it would read
// "Winter · Year Two" for the whole of the first year's winter. The pair written
// together is a season and the year that season actually belongs to.
//
// The picker's year is still a second flag, because it is a HIGH-WATER MARK rather than a
// function of the stamp: re-recording an older season to fix its journal entry must not walk
// it back. What does NOT belong to the callers is keeping the two in step, so there is one
// writer for both (`recordCurrentSeason`) and no way to write half the clock.

/** Flag key on the steading actor holding `{ season, year }`. */
export const CURRENT_SEASON_KEY = "seasonsCurrent";

/** Flag key holding the year the season picker defaults to (advanced by each Winter). */
export const CURRENT_YEAR_KEY = "seasonsCurrentYear";

/** A campaign year as stored: a whole number, never below 1. */
function campaignYear(value) {
	return Math.max(1, Math.trunc(Number(value)) || 1);
}

/**
 * The campaign year the season picker defaults to. Advanced by one each time a Winter is
 * completed, so it can sit a year ahead of the stamped season — see the header note above.
 */
export function readCurrentYear(actor) {
	return campaignYear(actor?.getFlag?.(STONETOP_SCOPE, CURRENT_YEAR_KEY));
}

/**
 * Would moving the picker's default year to `year` be a step FORWARD?
 *
 * The never-rewind rule: recording an out-of-order older Winter must not walk the count
 * backwards, and the picker only ever offers years up to this value.
 */
function advancesYear(actor, year) {
	return campaignYear(year) > readCurrentYear(actor);
}

/**
 * A season+year as one comparable number, so "is this later than what's stamped?" is a
 * single `>=`. Four seasons to a year in SEASON_IDS order, so Winter of the first year
 * (3) sorts below Spring of the second (4).
 * @param {{season: string, year: number}|null} stamp
 * @returns {number} -1 for nothing stamped, so any real season outranks it.
 */
export function seasonRank(stamp) {
	const index = SEASON_IDS.indexOf(stamp?.season);
	if (index < 0) return -1;
	return (campaignYear(stamp.year) - 1) * SEASON_IDS.length + index;
}

/**
 * Read the stamped season off a steading actor.
 * @returns {{season: string, year: number}|null} null when no Seasons Change has been
 *   recorded yet (a fresh world, or one last played before this readout shipped).
 */
export function readCurrentSeason(actor) {
	const stamped = actor?.getFlag?.(STONETOP_SCOPE, CURRENT_SEASON_KEY);
	if (!SEASON_IDS.includes(stamped?.season)) return null;
	return { season: stamped.season, year: campaignYear(stamped.year) };
}

/**
 * The season the clock is in, as the "<year>:<season>" key every once-per-season marker on
 * the steading is stored under — the season steps, Tor's blessing, the muster, winter's debt.
 *
 * THE YEAR HERE IS THE STAMP'S, and that is the whole reason this exists. `readCurrentYear` is
 * a different number: it is the picker's high-water count, and Done on a WINTER advances it to
 * `year + 1` while stamping the season as `{winter, year}`, because a completed winter closes
 * the year out. The two agree for three seasons in four and disagree for the whole of a
 * winter, so a reader that paired `readCurrentYear()` with `stamp.season` spent every winter
 * asking for a key nothing had ever written. That cost, silently: a winter debt vanished the
 * moment the window that rolled it was closed (so the glyph and its settle window were
 * unreachable in the only season they exist for), a Tor's blessing granted in winter expired
 * as it was granted, and the watch's and the herd's glyphs re-lit having just been settled.
 *
 * The pair written together is the fact. `readCurrentYear` answers a different question — what
 * year should the picker open on — and belongs only to the picker.
 *
 * @param {{season: string, year: number}|null} stamp  From readCurrentSeason.
 * @returns {string} "" when nothing is stamped, which no stored marker can equal.
 */
export function seasonStampKey(stamp) {
	return stamp?.season ? `${campaignYear(stamp.year)}:${stamp.season}` : "";
}

/**
 * The same pair, unjoined: the season the clock is in and the year to file it under, for the
 * readers that need the two halves separately rather than as a key (the muster's hold, the
 * holds tray, the Inn's gathering).
 *
 * The pairing is the whole point, and it is why this is one call rather than two: the year MUST
 * be the stamp's, and falls back to the picker's count only when nothing has been stamped at
 * all. Written out at each site, that fallback is a line anyone could reasonably rewrite as
 * `readCurrentYear(actor)` — which is the bug described above, and which cost a winter debt,
 * a Tor's blessing and two re-lit glyphs the last time it was made.
 *
 * @param {Actor} actor  the steading
 * @returns {{seasonId: string, year: number}}  seasonId is "" when nothing is stamped
 */
export function seasonStampParts(actor) {
	const stamp = readCurrentSeason(actor);
	return { seasonId: stamp?.season ?? "", year: stamp?.year ?? readCurrentYear(actor) };
}

/**
 * Does this `updateActor` diff touch the season clock?
 *
 * Lives here beside the reader and the writer because it is the same knowledge: where on the
 * document the clock is kept. A sheet that wants to redraw when the clock moves used to build
 * `flags.<scope>.<key>` itself and read the diff with `getProperty`, which made it a second
 * place that knew the storage — and a key or scope that moved would leave that filter compiling
 * fine, matching nothing, and the readout silently stale.
 *
 * Plain property reads rather than a dotted path: EVERY actor update in the world reaches a
 * hook that asks this, every HP tick on every character, so the discriminator that decides
 * whether to do any real work should not be building a string and splitting it first.
 *
 * @param   {object} changed  The diff Foundry hands `updateActor`.
 * @returns {boolean} true when the stamp is part of this update.
 */
export function isCurrentSeasonChange(changed) {
	return changed?.flags?.[STONETOP_SCOPE]?.[CURRENT_SEASON_KEY] !== undefined;
}

/**
 * Record that a season has begun: the stamp AND the picker's year, in one write.
 *
 * The one writer for the whole clock, and the reason is that the clock is two flags. It used
 * to be recorded by calling a stamp function and then a year function, which made every
 * caller responsible for remembering both in the right order — and one of the three (the
 * session-zero spring) remembered only the first. Two fields for one fact with nothing
 * enforcing the pair is a header reading Winter of one year while the picker offers years up
 * to another, silently, showing up only as a wrong default next time somebody opens it.
 *
 * One `update()` rather than two `setFlag`s for the same reason the GM Toolkit assignment is
 * one write: two writes to the same document is a round trip and a re-render more than the
 * job needs, and if the second fails the pair is already broken.
 *
 * @param {Actor}   actor
 * @param {string}  season   A SEASON_IDS key; anything else is a no-op.
 * @param {number}  year     The campaign year that season belongs to (1+).
 * @param {object}  [opts]
 * @param {boolean} [opts.advanceOnly=false]  Skip the stamp when `season`/`year` is EARLIER
 *   than what's already stamped. The season picker lets the GM re-record an older season to
 *   correct its journal entry; that correction shouldn't rewind the header's clock.
 * @param {number}  [opts.pickerYear]  The year the picker should offer up to. Defaults to
 *   `year`; a completed Winter passes `year + 1`, because it has closed the year out. Never
 *   walks the count backwards, so passing a year already behind is simply a no-op.
 */
export async function recordCurrentSeason(actor, season, year, { advanceOnly = false, pickerYear } = {}) {
	if (!actor || !SEASON_IDS.includes(season)) return;
	const next  = { season, year: campaignYear(year) };
	const flags = {};
	if (!(advanceOnly && seasonRank(next) < seasonRank(readCurrentSeason(actor)))) {
		flags[CURRENT_SEASON_KEY] = next;
	}
	const wantYear = campaignYear(pickerYear ?? next.year);
	if (advancesYear(actor, wantYear)) flags[CURRENT_YEAR_KEY] = wantYear;
	if (!Object.keys(flags).length) return;
	await actor.update({ flags: { [STONETOP_SCOPE]: flags } });
}

/**
 * The season the header shows before any Seasons Change has been recorded.
 *
 * Not a guess: the campaign opens in Spring of the First Year, which is exactly what the
 * session-zero walkthrough stamps (SpringBurstDialog records `spring`/1). A world that has
 * not turned a season yet is in the season it started in, so naming it is the truth and
 * leaving the line blank was the thing that read wrong.
 */
export const DEFAULT_SEASON = "spring";

/**
 * The header readout for the steading's clock: the season plus the year it belongs to,
 * as the two labels the template paints. No icon — the header names its season in that
 * season's own ink instead, off the SEASON_IDS key returned here.
 *
 * Pure, so the tests drive it directly. The un-stamped case falls back on both halves —
 * `fallbackYear` (usually the picker's year) and DEFAULT_SEASON — so the header always
 * names a full clock rather than half of one.
 *
 * The fallback is a DISPLAY default and stops here. `readCurrentSeason` still returns null
 * for an un-stamped world, so `seasonRank` still ranks it below every real season and the
 * first actual Seasons Change lands under `advanceOnly` instead of being refused by a
 * Spring nobody recorded.
 *
 * @param {{season: string, year: number}|null} stamp        From readCurrentSeason.
 * @param {number} [fallbackYear=1]                          Usually seasonsCurrentYear.
 */
export function currentSeasonView(stamp, fallbackYear = 1) {
	const year   = stamp ? campaignYear(stamp.year) : campaignYear(fallbackYear);
	const season = stamp?.season ?? DEFAULT_SEASON;
	return {
		season,
		year,
		label:     seasonLabel(season),
		yearLabel: yearLabel(year),
		stamped:   Boolean(stamp),
	};
}
