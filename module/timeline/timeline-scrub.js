// THE YEAR SCRUBBER: a slider along the bottom of the timeline, one tick per year the record holds
// (user, 2026-10-03: "a scrubber on the bottom that can slide to different years quickly. When
// scrubbed, we should center the timeline in the view").
//
// Sliding it moves the column along the timeline's own axis (across for Horizontal, down for
// Vertical), and puts the timeline back in the middle the other way too: the drag gutter lets a
// reader haul it nearly out of sight, and a scrub is how they get it back. It follows the other way
// as well: drag, throw or zoom the column and the thumb moves to wherever the view is, so it always
// says where the reader is.
//
// NOTHING LOCKS (user, 2026-10-04: "lets make the scrubber not lock to any points at all, it's
// causing issues"). The slider is ONE STRAIGHT LINE from the first year centred in the view to the
// last year centred: a pixel of thumb is the same stretch of column anywhere along it. It used to
// run year to year, a separate blend between each pair, and wherever the column's ends held two
// years to one place the thumb stuck on a tick and jumped. Now the ticks are drawn wherever their
// year falls along that line and the thumb rests wherever the hand leaves it. Nor is the column
// settled afterwards: the column snap that eased the board to a whole column once a pan or a slide
// stopped is gone, since the thumb moved with it, by itself.
// Only the keyboard steps, to the next year's tick, so arrowing along still lands on each one.
//
// ⚠ AN INSTANT JUMP, NOT A GLIDE. The slider fires on every step of the thumb; a smooth scroll per
// step would leave the column chasing the hand, and its in-between scroll events would pull the thumb
// back under it. A video scrubber jumps, and so does this.
//
// Everything is measured off the LIVE layout (`getBoundingClientRect`), so the wheel's zoom, the drag
// gutter and the four shapes need no arithmetic of their own: a year is wherever its `[data-year]`
// elements are drawn.
//
// Measured on the page and spent in layout pixels: a window drawn at a UI scale reports its rects
// scaled, and the scroll offsets they are added to are not (as timeline-menu-room.js).

import { drawnScale } from "../utils/drawn-scale.js";

/** What every element a year occupies is stamped with, in all four shapes. */
export const YEAR_ATTR = "data-year";

/** The slider's top value; its bottom is 0. Fine enough that the thumb never moves in visible steps. */
export const SCRUB_MAX = 1000;

/**
 * How far, in pixels, the column may sit from where the thumb last put it and still be that jump's
 * own echo: reading the place back off it could only nudge the thumb off where the reader's hand put
 * it (a rounded pixel). Any further is the reader moving the column some other way.
 */
const SCRUB_ECHO_PX = 1;

/**
 * The years a scrubber marks, oldest first: one per year with anything shown in it. The undated
 * block has no year and no tick.
 *
 * @param {Array<{year: number, yearLabel: string, undated?: boolean}>} periods  From the view model.
 * @returns {Array<{year: number, label: string}>}
 */
export function yearStops(periods = []) {
	const stops = [];
	for (const period of periods) {
		if (period?.undated || !period?.yearLabel) continue;
		if (stops.at(-1)?.year === period.year) continue;
		stops.push({ year: period.year, label: period.yearLabel });
	}
	return stops;
}

/**
 * Where each year's tick is first drawn along the slider, as a share of the thumb's travel: evenly
 * spread, 0 for the first year and 1 for the last. Only a first guess for the page to open with; once
 * the column is laid out the scrubber moves each tick to where its year really falls (`tickShares`).
 * The stylesheet turns a share into a place on the track (see `.stonetop-timeline-scrub-tick`),
 * allowing for the thumb's width, since the thumb's CENTRE is what passes over a year.
 *
 * @param {Array<{year, label}>} stops  From `yearStops`.
 * @returns {Array<{year: number, at: number}>}
 */
export function scrubTicks(stops = []) {
	const last = stops.length - 1;
	return stops.map((stop, index) => ({ year: stop.year, at: last > 0 ? Number((index / last).toFixed(4)) : 0 }));
}

/**
 * The scroll offset along one axis that puts a span in the middle of the view.
 *
 * A YEAR longer than the view cannot be centred and still be read from its start, so it is laid
 * against the view's near edge instead (less `inset`, the breathing room the column keeps at its
 * top): the year's opening season is what the reader slid to. `fromStart: false` turns that off,
 * for Horizontal's cross axis, where the timeline is centred top to bottom however big the zoom has
 * made it (user, 2026-10-03).
 *
 * All positions are in layout pixels, the scroll offset's own unit: `yearTargets` and `scrubTo` bring
 * what `getBoundingClientRect` gives them back from any UI scale first.
 *
 * @param {{scroll: number, viewStart: number, viewSize: number, spanStart: number, spanSize: number, inset?: number, fromStart?: boolean}} at
 * @returns {number}  The new scroll offset (unclamped; the browser clamps).
 */
export function centredScroll({ scroll = 0, viewStart = 0, viewSize = 0, spanStart = 0, spanSize = 0, inset = 0, fromStart = true } = {}) {
	if (fromStart && spanSize > viewSize) return Math.round(scroll + spanStart - viewStart - inset);
	return Math.round(scroll + (spanStart + spanSize / 2) - (viewStart + viewSize / 2));
}

/**
 * The slider's two ends as scroll offsets: the first and last years that are drawn. Null when
 * fewer than one is.
 *
 * @param {Array<number|null>} targets  One scroll offset per year, from `yearTargets`.
 * @returns {{from: number, to: number}|null}
 */
function line(targets) {
	const known = targets.filter(Number.isFinite);
	if (!known.length) return null;
	return { from: known[0], to: known.at(-1) };
}

/**
 * The scroll offset for a slider value: a straight share of the way from the first year's offset to
 * the last's, wherever the years between fall.
 *
 * @param {Array<number|null>} targets  One scroll offset per year, from `yearTargets`.
 * @param {number} value  0 to `SCRUB_MAX`.
 * @returns {number|null}  Null when no year is drawn.
 */
export function scrollForValue(targets = [], value = 0) {
	const ends = line(targets);
	if (!ends) return null;
	const share = Math.min(1, Math.max(0, value / SCRUB_MAX));
	return Math.round(ends.from + (ends.to - ends.from) * share);
}

/**
 * The slider value for a scroll offset: the inverse of `scrollForValue`, held to the slider's ends.
 * -1 when no year is drawn; 0 when the first and last years sit at one offset (there is nowhere to
 * slide).
 *
 * @param {Array<number|null>} targets  One scroll offset per year, from `yearTargets`.
 * @param {number} offset  The column's scroll along the timeline's axis.
 */
export function valueForScroll(targets = [], offset = 0) {
	const ends = line(targets);
	if (!ends) return -1;
	if (ends.to === ends.from) return 0;
	const share = (offset - ends.from) / (ends.to - ends.from);
	return Math.min(1, Math.max(0, share)) * SCRUB_MAX;
}

/**
 * Where each year's tick belongs along the slider, as a share of the thumb's travel (0 to 1): the
 * thumb on a tick is that year in the middle of the view. Null for a year with nothing drawn.
 *
 * @param {Array<number|null>} targets  One scroll offset per year, from `yearTargets`.
 * @returns {Array<number|null>}
 */
export function tickShares(targets = []) {
	const ends = line(targets);
	return targets.map((offset) => {
		if (!ends || !Number.isFinite(offset)) return null;
		if (ends.to === ends.from) return 0;
		return Number(((offset - ends.from) / (ends.to - ends.from)).toFixed(4));
	});
}

/**
 * The year a slider value is nearest, for the readout: the tick closest to the thumb. Two years the
 * column's end has held to one place share a tick; on the first half of the slider the earlier of
 * them is named, on the second half the later, so each end names the year that is actually there.
 *
 * @param {Array<number|null>} targets  One scroll offset per year, from `yearTargets`.
 * @param {number} value  0 to `SCRUB_MAX`.
 * @returns {number}  An index into the years; -1 when none is drawn.
 */
export function nearestStop(targets = [], value = 0) {
	const shares = tickShares(targets);
	const at = value / SCRUB_MAX;
	const late = at > 0.5;
	let best = -1;
	let gap = Infinity;
	shares.forEach((share, index) => {
		if (share === null) return;
		const d = Math.abs(share - at);
		if (d < gap || (late && d === gap)) { best = index; gap = d; }
	});
	return best;
}

/**
 * The on-screen extent of each year, as one rectangle per year: every element stamped with it, read
 * in ONE pass over the column (this runs every scroll frame). A year with nothing drawn is absent.
 * Also what the Ages' bands are laid under (timeline-ages-band.js).
 *
 * @returns {Map<string, {left, top, right, bottom}>}  keyed by the attribute's text
 */
export function yearRects(scroll) {
	const rects = new Map();
	for (const el of scroll.querySelectorAll(`[${YEAR_ATTR}]`)) {
		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) continue;
		const year = el.getAttribute(YEAR_ATTR);
		const rect = rects.get(year);
		rects.set(year, rect
			? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
			: { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
	}
	return rects;
}

/**
 * Where the timeline itself is drawn, on screen: what the picture HOLDS, not the picture's box.
 *
 * ⚠ THE AXIS'S BOX IS THE WINDOW'S HEIGHT. The sideways single track (`.stonetop-timeline-htrack`)
 * is stretched to `min-height: 100%` and centres its band of cards inside, so its own box is as tall
 * as the view whatever it holds, and centring THAT centres nothing. Its children are the band.
 *
 * A child PINNED by `position: sticky` (the swimlanes' season heads, the board's thread names) is
 * drawn where it is stuck, not where it lies, and would drag the extent to the view's edge; a
 * picture with pinned children is one sized to its content anyway, so its own box is the answer.
 */
export function pictureRect(picture) {
	if (!picture?.getBoundingClientRect) return null;
	const own = picture.getBoundingClientRect();
	const view = picture.ownerDocument?.defaultView;
	let rect = null;
	for (const child of picture.children ?? []) {
		if (view?.getComputedStyle?.(child)?.position === "sticky") return own;
		const r = child.getBoundingClientRect();
		if (!r.width && !r.height) continue;
		rect = rect
			? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
			: { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
	}
	if (!rect) return own;
	return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

/**
 * The view's own rectangle, on screen: the column's padding box less its scrollbars, which is what
 * the reader actually sees through. `scale` is how much bigger the window is drawn than it is laid
 * out (1 unscaled): divide an on-screen distance by it to get one a scroll offset can take.
 */
function viewRect(scroll) {
	const r = scroll.getBoundingClientRect();
	const scale = drawnScale(scroll, r);
	const left = r.left + (scroll.clientLeft || 0) * scale;
	const top = r.top + (scroll.clientTop || 0) * scale;
	const width = scroll.clientWidth ? scroll.clientWidth * scale : r.width;
	const height = scroll.clientHeight ? scroll.clientHeight * scale : r.height;
	return { left, top, width, height, scale };
}

/**
 * `centredScroll` for a view and a span measured on screen: both brought back to layout pixels first,
 * so the offset is right at any UI scale.
 */
function centredOnScreen(view, { viewStart, viewSize, spanStart, spanSize, ...at }) {
	const s = view.scale;
	return centredScroll({ ...at, viewStart: viewStart / s, viewSize: viewSize / s, spanStart: spanStart / s, spanSize: spanSize / s });
}

/**
 * The scroll offset, along the timeline's axis, that centres each year: null for a year with
 * nothing drawn. Each is held to the column's real scroll range, so the slider's ends are offsets
 * the column can actually reach, and the thumb read back off a clamped edge sits at the slider's end
 * rather than short of it.
 *
 * @param {HTMLElement} scroll  The column that scrolls.
 * @param {Array<{year}>} stops
 * @param {{horizontal: boolean, inset?: number}} opts
 * @returns {Array<number|null>}
 */
export function yearTargets(scroll, stops, { horizontal, inset = 0 } = {}) {
	const view = viewRect(scroll);
	const offset = horizontal ? scroll.scrollLeft : scroll.scrollTop;
	const room = horizontal ? scroll.scrollWidth - scroll.clientWidth : scroll.scrollHeight - scroll.clientHeight;
	const spans = yearRects(scroll);
	return stops.map(({ year }) => {
		const span = spans.get(String(year));
		if (!span) return null;
		const target = horizontal
			? centredOnScreen(view, { scroll: offset, viewStart: view.left, viewSize: view.width, spanStart: span.left, spanSize: span.right - span.left })
			: centredOnScreen(view, { scroll: offset, viewStart: view.top, viewSize: view.height, spanStart: span.top, spanSize: span.bottom - span.top, inset });
		const low = Math.max(0, target);
		return room > 0 ? Math.min(room, low) : low;
	});
}

/**
 * Move the column to a slider value along the timeline's axis, and the timeline into the middle the
 * other way (user, 2026-10-03): Horizontal is centred top to bottom whatever the zoom; Vertical is
 * centred side to side when it FITS, and laid against the left edge when it does not. A board of
 * sixteen threads is four windows wide, and its middle is four characters nobody asked for with the
 * seasons off-screen; from the left it opens on the seasons and the first threads.
 *
 * @param {HTMLElement} scroll  The column that scrolls.
 * @param {Array<{year}>} stops
 * @param {number} value  0 to `SCRUB_MAX`.
 * @param {{horizontal: boolean, picture?: HTMLElement|null, inset?: number, targets?: Array<number|null>}} opts
 *        `picture` is the timeline itself (the canvas's one child), centred on the cross axis;
 *        `targets` the years' offsets when the caller has just measured them.
 */
export function scrubTo(scroll, stops, value, { horizontal, picture = null, inset = 0, targets = null } = {}) {
	const main = scrollForValue(targets ?? yearTargets(scroll, stops, { horizontal, inset }), value);
	if (main === null) return false;
	const view = viewRect(scroll);
	const whole = pictureRect(picture);
	const across = !whole ? null : horizontal
		? { scroll: scroll.scrollTop, viewStart: view.top, viewSize: view.height, spanStart: whole.top, spanSize: whole.height, fromStart: false }
		: { scroll: scroll.scrollLeft, viewStart: view.left, viewSize: view.width, spanStart: whole.left, spanSize: whole.width, inset };
	const cross = across ? centredOnScreen(view, across) : null;
	if (horizontal) {
		scroll.scrollLeft = main;
		if (cross !== null) scroll.scrollTop = cross;
	} else {
		scroll.scrollTop = main;
		if (cross !== null) scroll.scrollLeft = cross;
	}
	return true;
}

/** The keys that step the thumb a whole year, and which way. */
const YEAR_KEYS = { ArrowRight: 1, ArrowUp: 1, PageUp: 1, ArrowLeft: -1, ArrowDown: -1, PageDown: -1 };

/**
 * Wire a scrubber to its column.
 *
 * @param {HTMLElement} scroll  The column that scrolls.
 * @param {HTMLElement} bar     The scrubber's own element: holds the range input, its year ticks
 *                              (`.stonetop-timeline-scrub-tick`, one per year in order) and the
 *                              year readout.
 * @param {object} opts
 * @param {Array<{year, label}>} opts.stops  From `yearStops`.
 * @param {boolean} opts.horizontal
 * @param {string}  [opts.picture]  Selector, inside the column, of the timeline itself.
 * @param {number}  [opts.inset]    Breathing room kept at the column's top (or left) when a year (or a
 *                                  Vertical board) is too long to centre.
 * @returns {() => void}  Takes every listener back off.
 */
export function wireYearScrubber(scroll, bar, { stops = [], horizontal = true, picture = "", inset = 0 } = {}) {
	const range = bar?.querySelector?.("input[type='range']");
	if (!scroll?.addEventListener || !range || stops.length < 2) return () => {};
	const readout = bar.querySelector("output");
	const ticks = [...bar.querySelectorAll(".stonetop-timeline-scrub-tick")];
	// Where the thumb's own jump left the column, until the column is moved some other way.
	let wrote = null;
	let frame = 0;

	const measure = () => yearTargets(scroll, stops, { horizontal, inset });

	// Each tick to where its year falls along the slider, which the zoom and the layout move.
	const placeTicks = (targets) => {
		tickShares(targets).forEach((share, index) => {
			const tick = ticks[index];
			if (!tick) return;
			tick.hidden = share === null;
			if (share === null) return;
			const at = String(share);
			if (tick.style.getPropertyValue("--at") !== at) tick.style.setProperty("--at", at);
		});
	};

	// The readout and the screen reader name the year the thumb is nearest.
	const show = (value, targets) => {
		range.value = String(Number(value.toFixed(1)));
		const stop = stops[nearestStop(targets, value)];
		if (!stop) return;
		range.setAttribute("aria-valuetext", stop.label);
		if (readout) readout.textContent = stop.label;
	};

	// `targets` when the caller has just measured the years itself (a year key), so the layout is
	// not read a second time for the same press.
	const go = (value, targets = measure()) => {
		// The column moved before the readout is written, so the layout is read once, not twice.
		scrubTo(scroll, stops, value, {
			horizontal, inset, targets, picture: picture ? scroll.querySelector(picture) : null,
		});
		show(value, targets);
		// Read back rather than kept from the write: the column clamps and rounds what it is given.
		wrote = { left: scroll.scrollLeft, top: scroll.scrollTop };
	};

	// The scroll is the thumb's own jump, not the reader moving the column.
	const isEcho = () => !!wrote
		&& Math.abs(scroll.scrollLeft - wrote.left) <= SCRUB_ECHO_PX
		&& Math.abs(scroll.scrollTop - wrote.top) <= SCRUB_ECHO_PX;

	const onInput = () => go(Math.min(SCRUB_MAX, Math.max(0, Number(range.value) || 0)));

	// The keyboard steps a WHOLE year, from wherever the thumb was left: to the next tick along, never
	// a hair of the way to it. Years that share a tick are one step.
	const onKeydown = (event) => {
		const dir = YEAR_KEYS[event.key];
		if (event.key !== "Home" && event.key !== "End" && !dir) return;
		event.preventDefault();
		if (event.key === "Home") return go(0);
		if (event.key === "End") return go(SCRUB_MAX);
		const value = Number(range.value) || 0;
		const targets = measure();
		const marks = tickShares(targets).filter(s => s !== null).map(s => s * SCRUB_MAX);
		const next = dir > 0
			? marks.find(m => m > value + 0.5) ?? SCRUB_MAX
			: marks.findLast(m => m < value - 0.5) ?? 0;
		go(next, targets);
	};

	const follow = () => {
		frame = 0;
		// The thumb's own jump moved nothing the ticks hang on, so an echo measures nothing.
		if (scroll.isConnected === false || isEcho()) return;
		const targets = measure();
		placeTicks(targets);
		wrote = null;
		const value = valueForScroll(targets, horizontal ? scroll.scrollLeft : scroll.scrollTop);
		if (value >= 0 && Math.abs(value - Number(range.value)) > 0.05) show(value, targets);
	};

	// One read of the layout per frame however many scroll events the frame brought.
	const onScroll = () => {
		if (frame || typeof globalThis.requestAnimationFrame !== "function") return;
		frame = globalThis.requestAnimationFrame(follow);
	};

	range.addEventListener("input", onInput);
	range.addEventListener("keydown", onKeydown);
	scroll.addEventListener("scroll", onScroll, { passive: true });
	// Once now the column has its kept place back, so the thumb and the ticks open where the view is.
	onScroll();

	return () => {
		range.removeEventListener("input", onInput);
		range.removeEventListener("keydown", onKeydown);
		scroll.removeEventListener("scroll", onScroll);
		if (frame) globalThis.cancelAnimationFrame?.(frame);
		frame = 0;
	};
}
