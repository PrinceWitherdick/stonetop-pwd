// WHAT THE CAMPAIGN'S YEARS ARE CALLED.
//
// Every year this system STORES is counted from the first year of play: stored year 1 is the year
// the table started in, whatever the GM calls it. A GM who says play opens in the year 1247 sets
// ONE world setting, `campaignStartYear`, and every label reads off it -- the clock, the time
// banner, the steading header, the Seasons Change journal, the timeline.
//
// AN OFFSET, NOT A REWRITE, because the years are also stored inside strings: the "<year>:<season>"
// key every once-per-season marker is filed under (season steps, Tor's blessing, winter's debt, the
// weather's stamp), a site visit's milestone key. Rewriting those to follow a new start year would
// re-open every marker the table had already settled. With the offset, a GM who changes their mind
// changes one number and everything recorded -- history included -- moves with it, keeping its
// distance from now.
//
// HISTORY is stored years below 1: stored 0 is the year before play began, stored -9 ten years
// before it. Only the timeline holds such years (`historyYear`); the clock never goes below 1
// (`campaignYear` in current-season.js).
import { SYSTEM_ID } from "../system-id.js";

/** The world setting naming stored year 1. */
export const START_YEAR_SETTING = "campaignStartYear";

/**
 * Called on every client when the start year changes (the setting's onChange), so whatever names a
 * year can repaint. A hook rather than a call because settings.js cannot import the banner or the
 * windows back.
 */
export const START_YEAR_CHANGED_HOOK = "stonetop.campaignStartYearChanged";

/** The highest year a GM may say play began in. A typo guard, like MAX_CAMPAIGN_YEAR. */
export const MAX_START_YEAR = 99999;

/**
 * The earliest stored year the timeline will hold: ten thousand years before play. Nothing in the
 * game caps how far back a table's history reaches; this only stops a slipped keystroke from
 * filing an entry somewhere no scrubber could reach.
 */
export const MIN_HISTORY_YEAR = -9999;

/** A start year as stored: a whole number from 1 to MAX_START_YEAR, 1 for anything unreadable. */
export function normalizeStartYear(value) {
	const year = Math.trunc(Number(value));
	if (!Number.isFinite(year) || year < 1) return 1;
	return Math.min(MAX_START_YEAR, year);
}

/**
 * The last start year read, and the settings it was read from. Every year label reads it (a
 * timeline names each of its periods), and a world `get` scans the world's settings and, for a
 * never-saved one, builds a fresh Setting document. Dropped by the setting's onChange.
 */
let cached = null;

/** What stored year 1 is called. 1 (the old "Year One") wherever the setting is not registered. */
export function startYear() {
	const settings = globalThis.game?.settings;
	if (cached && cached.settings === settings) return cached.year;
	let year;
	try {
		year = normalizeStartYear(settings?.get?.(SYSTEM_ID, START_YEAR_SETTING));
	} catch {
		return 1;
	}
	cached = { settings, year };
	return year;
}

/** Forget the cached start year: the setting changed. */
export function forgetStartYear() {
	cached = null;
}

/** The number a year field's text holds, or null when it is empty or not a number. Not truncated. */
export function typedYear(value) {
	const raw = String(value ?? "").trim();
	const year = Number(raw);
	return raw && Number.isFinite(year) ? year : null;
}

/** A whole stored year, 1 for anything unreadable. */
function whole(value) {
	const year = Math.trunc(Number(value));
	return Number.isFinite(year) ? year : 1;
}

/** The year a stored year is CALLED: stored 1 is the start year. */
export function displayYear(stored, start = startYear()) {
	return start + whole(stored) - 1;
}

/** The stored year a displayed year means: the inverse of `displayYear`. */
export function storedYear(display, start = startYear()) {
	return whole(display) - start + 1;
}

/** A timeline entry's stored year: whole, no floor of 1, no earlier than MIN_HISTORY_YEAR. */
export function historyYear(value) {
	return Math.max(MIN_HISTORY_YEAR, whole(value));
}

/** How many years before `now` a stored year is (both stored), never negative. */
export function yearsAgo(stored, now) {
	return Math.max(0, whole(now) - whole(stored));
}

/**
 * The start year that makes the stored year `nowStored` read as `typedNow`: what a GM's answer to
 * "what year is it now?" sets. Null when that answer would put play itself before year 1 (typing
 * 3 in the campaign's fifth year), which the dialog refuses rather than clamping.
 */
export function startYearFor(typedNow, nowStored) {
	const start = whole(typedNow) - whole(nowStored) + 1;
	return start >= 1 && start <= MAX_START_YEAR ? start : null;
}

/** Name stored year 1 for the whole world. GM only: the setting is world-scoped. */
export function setStartYear(value) {
	return globalThis.game?.settings?.set?.(SYSTEM_ID, START_YEAR_SETTING, normalizeStartYear(value));
}
