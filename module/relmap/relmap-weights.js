// How heavily this reader wants a relationship board drawn: the arrowheads, the strokes and the
// writing, each as a percentage of what the stylesheet sets.
//
// WHY THREE NUMBERS AND NOT ONE ZOOM. The board already zooms, and zooming answers a different
// question: it magnifies everything at once, so the web that was too dense to read is still too
// dense to read and there is simply less of it in the window. What a reader actually runs out of is
// one THING at a time. The arrowheads are 22 pixels on a sheet that grows with the cast, and on a
// board of forty they are a speck at the end of a line. The strokes are three and a half pixels in
// screen space, which is fine at 1:1 and gone under a magnifier. The captions are sixteen, which is
// the one of the three a reader could already do something about, and only one line at a time. So
// there are three, each moving one of those and nothing else.
//
// ⚠ PER CLIENT, NEVER PER WORLD, AND NEVER ON THE BOARD. This is the same bargain relmap-size.js
// strikes and it is worth restating here rather than pointing at: what a line MEANS is the map's
// and everybody at the table shares it (its colour, its stroke, what it says, how big its own
// caption is set). How heavily that map has to be PAINTED for one pair of eyes is not a fact about
// the map at all. There is a reader at this table on a screen magnifier who wants every stroke at
// half again, and a GM at 1:1 on a large monitor who does not; stored on the board, one of them
// would be rewriting the other's window every time they reached for it, and the undo button would
// be offering to take it back.
//
// ⚠ AND NOT NESTED UNDER THE WORLD ID, for the reason relmap-size.js is not: what nests is a record
// holding an ID, because "the board I had open" means nothing in a world that has no such page.
// These are three numbers, and how heavily somebody needs their diagrams drawn is the same fact in
// every world they open. A reader who set the strokes to 180% last night should not have to find
// the dials again in this evening's game.
//
// ⚠ AND THE CLEARANCE ROUND A PORTRAIT IS DELIBERATELY NOT ONE OF THEM.
// `RELMAP_LABEL_CLEAR_PX` is the paper kept between the last letter of a caption and the face at
// that end of its line, and it looks like a fourth thing that ought to grow with the writing. It is
// not: what it protects is the PORTRAIT, whose size has not changed, and the room a caption gets is
// already its line's length less that clearance -- so heavier writing on the same line simply fits
// FEWER words, cut with an ellipsis, rather than reaching any nearer the faces. Scaled, it would
// take room away from a caption to protect a face from words that were never going to arrive.
//
// ⚠ WHAT THE PERCENTAGES ARE OF IS THE SHEET AND NOT EACH OTHER. Each is applied where its own
// measurement is made and nowhere else, so a board at 100/100/100 is drawn by exactly the
// declarations it was drawn by before any of this existed -- which is the state every reader starts
// in and nearly all of them stay in. See `weightScales`, which is the one place a percentage
// becomes a multiplier.

import { getObjectSetting, setSettingQuietly } from "../settings.js";

export const RELMAP_WEIGHT_SETTING = "relmapWeights";

/**
 * The three, in the order they are offered and the order they are read.
 *
 * ⚠ THE ORDER IS THE RUN OF DIALS ALONG THE FOOTER, LEFT TO RIGHT, and it is not alphabetical or
 * arbitrary: it is the anatomy of ONE LINE on the board, in the order a reader meets it. There is a
 * stroke; the stroke has a head on its end saying which way it points; and along the stroke there
 * are words. Each dial is one part of that, taken in that order (user, 2026-09-09).
 *
 * IT USED TO RUN SMALLEST MARK FIRST -- a speck, then a hair, then words -- which is a true
 * ordering of the three and the wrong one to offer, because nothing a reader is looking at is
 * sorted that way. What they are looking at is a line, and on it the arrowhead is something the
 * LINE has rather than a mark standing on its own; the dial for it belongs after the dial for the
 * thing it is attached to.
 *
 * KEYS AND NOT LABELS. What each is called is `languages/en.json`'s business, as everywhere else in
 * this feature; what it is called in the DOM is one of these, because that is what the button
 * carries in a `data-` attribute and what the stylesheet's custom property is named after.
 */
export const RELMAP_WEIGHTS = Object.freeze(["line", "head", "word"]);

/**
 * A hundred per cent is the sheet's own answer, and it is stored as a real number rather than as
 * the absence of one.
 *
 * ⚠ THE OPPOSITE OF `readSize`, WHICH STORES ITS BASE AS NOTHING, and the difference is worth the
 * paragraph because the two look like the same decision. A caption's size is written onto A LINE,
 * on a shared board, where nearly every line has none and never will: nothing is the honest record
 * there, and it is what lets the base be retuned under a board drawn years ago. This is a record of
 * one reader's own eyes in their own browser, there are exactly three of them, and a reader who has
 * deliberately set the arrowheads back to 100 after a season at 150 has made a choice. Storing that
 * as an absence would make it indistinguishable from never having asked.
 */
export const RELMAP_WEIGHT_BASE = 100;

/**
 * HOW FAR EITHER WAY, and both ends are load-bearing rather than tidy.
 *
 * THE FLOOR IS HALF, because below that the three things stop being what they are. A stroke at
 * 40% is 1.4 screen pixels, which on any display that is not exactly 1:1 is a line that flickers
 * in and out of existence as the board pans; an arrowhead at 40% is eight pixels, which is a smudge
 * rather than a direction. Half is the smallest any of the three is still ITSELF at, and a reader
 * who wants less than that wants the thing turned off, which is a different control (the captions
 * have one, and lines and arrowheads mean too much to have one).
 *
 * THE CEILING IS TRIPLE, and it is set by the portraits rather than by taste. A face is 72 board
 * pixels (`RELMAP_NODE_PX`); at 300% an arrowhead is 66 of them, which is a triangle _almost_ the
 * size of the person it points at, and past that the board is arrowheads with a web behind them.
 * The strokes reach ten and a half pixels at the same setting, which is thicker than the gap two
 * neighbouring lines are fanned apart by. Generous on purpose: there is a reader at this table on a
 * screen magnifier, and a ceiling set where it looked tasteful on a designer's monitor is a ceiling
 * they hit and cannot pass.
 *
 * THE STEP IS A TENTH, so a press is a change a reader can SEE. Steps of five took two presses to
 * do anything visible and turned the dials into something to be held down.
 */
export const RELMAP_WEIGHT_MIN = 50;
export const RELMAP_WEIGHT_MAX = 300;
export const RELMAP_WEIGHT_STEP = 10;

/**
 * One stored percentage as a number this board can paint at.
 *
 * ⚠ THE ONE GATE, and it has two callers that are not each other: the setting, which is browser
 * storage any script in the page could have written, and the dials' own buttons, which do
 * arithmetic on what they read back. Held to the bounds rather than refused, for the reason
 * `readSize` gives: a reader who arrives at the ceiling wants the ceiling, and handing them 100
 * instead says their press did nothing.
 *
 * ROUNDED TO THE STEP, so that a value written by an older build with a different step, or by
 * hand, lands where the buttons can reach it. A stored 137 that the buttons could only move to 147
 * and 127 is a setting the reader can never get back to a round number.
 */
export function readWeight(value) {
	const pct = Number(value);
	// ⚠ AND ZERO IS NOT A WEIGHT, WHICH IS NOT THE PEDANTRY IT LOOKS LIKE. `Number()` answers 0
	// for `null`, for the empty string and for an empty array, all of which are things a stored
	// record can honestly contain -- and a 0 that reached the clamp below would come back as the
	// FLOOR, so a key written as null would silently halve the arrowheads on every board this
	// reader opens. Refused with everything else that is not a number, which is the base.
	if (!Number.isFinite(pct) || pct <= 0) return RELMAP_WEIGHT_BASE;
	const stepped = Math.round(pct / RELMAP_WEIGHT_STEP) * RELMAP_WEIGHT_STEP;
	return Math.min(RELMAP_WEIGHT_MAX, Math.max(RELMAP_WEIGHT_MIN, stepped));
}

/** All three, from anything at all. Missing is the base, which is what a reader who has never
 * touched the dials has and what a key added after this shipped will read as. */
export function readWeights(raw) {
	const said = raw && typeof raw === "object" ? raw : {};
	const out = {};
	for (const key of RELMAP_WEIGHTS) out[key] = readWeight(said[key]);
	return out;
}

/**
 * What this reader has asked every board to be drawn at.
 *
 * Tolerant of an absent setting rather than throwing, for the reason `getObjectSetting` is: a key
 * that is not registered is an older build or a unit test, and neither is a reason to take a board
 * down.
 */
export function getWeights() {
	return readWeights(getObjectSetting(RELMAP_WEIGHT_SETTING));
}

/**
 * Write one or more of them, and answer with all three as they now stand.
 *
 * THE WHOLE RECORD IS REWRITTEN because it is three numbers in one client setting: there is no
 * concurrency here to lose (a browser has one of these, and one window at a time changing it), so
 * the leaf-path discipline the shared graph is written with buys nothing and would cost a reader
 * their other two settings the first time a dotted key was expanded.
 *
 * QUIETLY, because losing the record costs this reader one re-press of a footer button and nothing
 * else: the board is already painted at the new weight by the time this is called. See
 * `setSettingQuietly`.
 */
export function setWeights(patch) {
	const next = readWeights({ ...getWeights(), ...(patch ?? {}) });
	setSettingQuietly(RELMAP_WEIGHT_SETTING, next, "Stonetop | relationship map weights:");
	return next;
}

/**
 * The three percentages as the MULTIPLIERS everything downstream actually wants.
 *
 * ONE PLACE THE DIVISION HAPPENS, and that is the whole point of this function existing beside a
 * record that is already three numbers. Six callers want a scale rather than a percentage (the
 * stylesheet's three custom properties, the arrowhead's pixel size, the caption's own size, the
 * held caption's read size), and `pct / 100` written six times is five places to write `100 / pct`
 * by accident in a file where every other number is already a share.
 */
export function weightScales(weights = getWeights()) {
	const said = readWeights(weights);
	const out = {};
	for (const key of RELMAP_WEIGHTS) out[key] = said[key] / RELMAP_WEIGHT_BASE;
	return out;
}
