// THE AGES: named runs of years the GM lays over the timeline ("The Age of Embers", 1180 to 1246),
// drawn as coloured bands along the foot of the view (user, 2026-10-07: "Group ranges of years
// together into a named Age. Kind of like how D&D does that").
//
// Entirely optional: a world with no Ages draws nothing, and a reader can turn the bands off in the
// Filter menu. GM only to write (a world setting, settings.js `timelineAges`), as the campaign's
// year and the kinds' colours are: an Age is how the whole table reads its history.
//
// ⚠ STORED YEARS, NOT DISPLAYED ONES. `from` and `to` count from the first year of play, as every
// timeline row does (seasons/campaign-year.js). A GM who renames the years later moves every Age
// with everything else, and nothing here is rewritten.
//
// AGES MAY OVERLAP (user's call): an "Age of Storms" inside "The Third Age" takes a second row of
// the strip (`stackAges`), so both stay readable.
//
// Pure, no Foundry: the window builds its strip from these, the tests drive them directly.
// ⚠ NO IMPORT FROM timeline-core.js, for the reason timeline-colours.js gives: settings.js imports
// this file, and timeline-core reaches back into settings.

import { hslToRgb, normalizeHex, parseColour, rgbToHex, rgbToHsl } from "../relmap/relmap-ink.js";
import { historyYear, typedYear } from "../seasons/campaign-year.js";
import { clipText } from "../utils/strings.js";

/** Fired on every client when the world's Ages change (the setting's onChange), so windows repaint. */
export const AGES_CHANGED_HOOK = "stonetop.timelineAgesChanged";

/** The longest name an Age keeps. A strip label, not a paragraph. */
export const AGE_NAME_MAX = 60;

/** One Age's name, cleaned: one line, spaces collapsed, capped. "" for nothing at all. */
export function cleanAgeName(name) {
	return clipText(String(name ?? "").replace(/\s+/g, " ").trim(), AGE_NAME_MAX).trim();
}

/** A stored year, or null for a blank or unreadable one (an Age's end left open). */
function yearOrNull(value) {
	const year = typedYear(value);
	return year === null ? null : historyYear(year);
}

/**
 * One Age as stored, cleaned, or null when it cannot be drawn: no name, no start, or no colour.
 * An end before the start is the two typed the wrong way round, and is swapped rather than refused.
 * `to: null` is an Age still running: it reaches the last year the timeline shows.
 *
 * @returns {{id: string, name: string, from: number, to: number|null, colour: string}|null}
 */
export function normalizeAge(raw, id = raw?.id) {
	if (!raw || typeof raw !== "object") return null;
	const name = cleanAgeName(raw.name);
	const from = yearOrNull(raw.from);
	const colour = normalizeHex(raw.colour);
	const key = String(id ?? "").trim();
	if (!key || !name || from === null || !colour) return null;
	let to = yearOrNull(raw.to);
	let start = from;
	if (to !== null && to < start) [start, to] = [to, start];
	return { id: key, name, from: start, to, colour };
}

/**
 * The world's Ages, cleaned and in order: earliest start first, a running Age after a closed one
 * that starts the same year, then by name. Takes the stored shape (keyed by id) or a list.
 *
 * ⚠ THE GATE between the world's data and the page: what comes out of here is printed in the strip
 * and its colour written into a style attribute.
 */
export function normalizeAges(raw) {
	if (!raw || typeof raw !== "object") return [];
	const pairs = Array.isArray(raw) ? raw.map(age => [age?.id, age]) : Object.entries(raw);
	const seen = new Set();
	const ages = [];
	for (const [id, value] of pairs) {
		const age = normalizeAge(value, id);
		if (!age || seen.has(age.id)) continue;
		seen.add(age.id);
		ages.push(age);
	}
	return ages.sort((a, b) => a.from - b.from
		|| (a.to ?? Infinity) - (b.to ?? Infinity)
		|| a.name.localeCompare(b.name));
}

/** A list of Ages in the stored shape, keyed by id. */
export function agesToStored(ages) {
	return Object.fromEntries(normalizeAges(ages).map(age => [age.id, age]));
}

/**
 * The Ages the timeline can draw, each with the stretch of it that is SHOWN: the first and last of
 * the years on screen (the scrubber's stops, oldest first) that fall inside it. An Age none of whose
 * years is shown is left out of the strip; the editor still lists it.
 *
 * @param {Array} ages   From `normalizeAges`.
 * @param {Array<{year: number}>} stops  timeline-scrub.js#yearStops.
 * @returns {Array<{...age, first: number, last: number, start: number, end: number}>}
 *          `first`/`last` the shown years, `start`/`end` their places among the stops.
 */
export function agesInView(ages = [], stops = []) {
	const shown = [];
	for (const age of ages) {
		let start = -1;
		let end = -1;
		stops.forEach((stop, index) => {
			if (stop.year < age.from || (age.to !== null && stop.year > age.to)) return;
			if (start < 0) start = index;
			end = index;
		});
		if (start < 0) continue;
		shown.push({ ...age, first: stops[start].year, last: stops[end].year, start, end });
	}
	return shown;
}

/**
 * Give each band a row of the strip, so two that share a year never lie on top of each other:
 * greedy, earliest first, each into the lowest row whose last band has ended. Back-to-back Ages
 * share a row; one inside another takes the next.
 *
 * @param {Array<{start: number, end: number}>} items  Inclusive places along the axis.
 * @returns {{items: Array<{row: number}>, rows: number}}
 */
export function stackAges(items = []) {
	const order = items.map((item, index) => ({ item, index }))
		.sort((a, b) => a.item.start - b.item.start || b.item.end - a.item.end || a.index - b.index);
	const ends = [];
	const rows = new Array(items.length);
	for (const { item, index } of order) {
		let row = ends.findIndex(end => end < item.start);
		if (row < 0) row = ends.length;
		ends[row] = item.end;
		rows[index] = row;
	}
	return { items: items.map((item, index) => ({ ...item, row: rows[index] })), rows: ends.length };
}

/**
 * The years the timeline must show for every Age to be drawn: each Age's first year, and its last
 * if it has ended. The view gives any of them with nothing written in it a bare year of its own
 * (timeline-view.js#withAgeMarks), so an Age the record has nothing in still has a band.
 *
 * @param {Array} ages  From `normalizeAges`.
 * @returns {number[]}  Stored years, oldest first, each once.
 */
export function ageMarkYears(ages = []) {
	const years = new Set();
	for (const age of ages) {
		years.add(age.from);
		if (age.to !== null) years.add(age.to);
	}
	return [...years].sort((x, y) => x - y);
}

/**
 * The strip the timeline draws: the Ages with a year on screen, each given its row.
 *
 * @param {Array} ages   From `normalizeAges`.
 * @param {Array<{year: number}>} stops  timeline-scrub.js#yearStops.
 * @returns {{bands: Array, rows: number}}
 */
export function ageStrip(ages = [], stops = []) {
	const { items, rows } = stackAges(agesInView(ages, stops));
	return { bands: items, rows };
}

/* ── Colours ────────────────────────────────────────────────────────────── */

/** Where the hue walk starts: a warm ochre, at home on the parchment. */
const HUE_SEED = 28;

/** The golden angle: each step lands as far as it can from every hue before it. */
const HUE_STEP = 137.508;

/** How near, in degrees, a new Age's hue may come to one the world already wears. */
const HUE_CLEARANCE = 18;

/** How many steps the walk will take looking for a clear hue before it settles for the next. */
const HUE_TRIES = 40;

/**
 * Two lightness/saturation steps the walk alternates between, so neighbouring hues differ in depth
 * too. Both are the LIGHT page's colour, deep enough to read on parchment; the other skins get theirs
 * from timeline-colours.js#kindColourSet, as a custom tag's do.
 */
const TONES = Object.freeze([{ s: 0.55, l: 0.36 }, { s: 0.45, l: 0.44 }]);

/** `#rrggbb` for an HSL colour (hue in degrees, s and l 0..1). */
export function hslHex(h, s, l) {
	return rgbToHex(hslToRgb(h, s, l));
}

/** A colour's hue in degrees, or null for a grey (no hue to keep clear of) or a non-colour. */
export function hexHue(hex) {
	const rgb = parseColour(normalizeHex(hex) ?? "");
	if (!rgb) return null;
	const [h, s, l] = rgbToHsl(rgb);
	// The chroma (max - min, 0..1): under 0.04 the colour is a grey, whatever its nominal hue.
	return s * (1 - Math.abs(2 * l - 1)) < 0.04 ? null : h;
}

/** The distance round the colour wheel between two hues. */
function hueGap(a, b) {
	const d = Math.abs(a - b) % 360;
	return Math.min(d, 360 - d);
}

/** The colour the walk's step `seq` lands on. */
export function ageColourAt(seq) {
	const n = Math.max(0, Math.trunc(Number(seq) || 0));
	const tone = TONES[n % TONES.length];
	return hslHex((HUE_SEED + n * HUE_STEP) % 360, tone.s, tone.l);
}

/**
 * The colour a NEW Age is given, and where the walk stands after it.
 *
 * ⚠ NEVER AN OLD COLOUR (user, 2026-10-07): the walk's place is kept in the world
 * (`timelineAgeColourSeq`) and only ever moves on, so a colour once handed out is never handed out
 * again, even after its Age is deleted. Each step also stays clear of the hues the world's Ages
 * wear now, a GM's own picks included; after `HUE_TRIES` crowded steps it takes the next one anyway.
 *
 * @param {{seq?: number, inUse?: string[]}} at
 * @returns {{hex: string, seq: number}}  `seq` is the walk's next place, to be stored.
 */
export function nextAgeColour({ seq = 0, inUse = [] } = {}) {
	const hues = inUse.map(hexHue).filter(hue => hue !== null);
	let n = Math.max(0, Math.trunc(Number(seq) || 0));
	for (let tries = 0; tries < HUE_TRIES; tries++, n++) {
		const hex = ageColourAt(n);
		const hue = hexHue(hex);
		if (hue === null || hues.every(used => hueGap(used, hue) >= HUE_CLEARANCE)) return { hex, seq: n + 1 };
	}
	return { hex: ageColourAt(n), seq: n + 1 };
}
