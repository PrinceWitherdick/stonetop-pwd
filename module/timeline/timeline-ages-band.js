// THE AGES' STRIP: each Age a band laid OVER the timeline's foot (Across) or its right edge (Down),
// under exactly the years it covers (user, 2026-10-07: "display along the bottom of the timeline
// (over content in the timeline)").
//
// The strip is not part of the scrolling picture. It sits in the same grid cell as the column, over
// it, and every band is moved to wherever its years are DRAWN, read off the live layout the way the
// year scrubber reads them (timeline-scrub.js#yearRects): the wheel's zoom, the drag gutter and the
// four shapes need no arithmetic of their own. One read of the layout per frame, however many scroll
// events the frame brought, and a band whose place has not changed is not written.
//
// THE NAME STAYS ON SCREEN. A long Age scrolled half out of the view keeps its name at the visible
// edge of the band, so the reader always knows which Age they are in.
//
// NOTHING SETTLES (user, 2026-10-04, see timeline-scrub.js): the bands follow the column; they never
// move it.

import { yearRects } from "./timeline-scrub.js";

/** Worn by a band with nothing to cover on screen (and by every band until it is first placed). */
export const OFF_ATTR = "data-off";

/** The breathing room, in pixels, between a band's visible edge and its name. */
const NAME_PAD = 8;

/**
 * Where one band goes along the strip, and how far its name is slid in to stay on screen. Pure, so
 * the tests drive it; every length is in pixels along the strip's own axis.
 *
 * @param {object} at
 * @param {number} at.start      The band's near edge (its first year's), from the strip's start.
 * @param {number} at.end       Its far edge (its last year's).
 * @param {number} at.size       The strip's length.
 * @param {number} [at.clip]     How much of the strip's start a pinned column covers: a name is
 *                               never slid under it.
 * @param {number} [at.name]     The name's own length.
 * @returns {{hidden: boolean, pos: number, length: number, shift: number}}
 */
export function bandPlacement({ start, end, size, clip = 0, name = 0 }) {
	const length = Math.max(0, end - start);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= clip || start >= size || !length) {
		return { hidden: true, pos: 0, length: 0, shift: 0 };
	}
	// The visible stretch of the band, and the name slid to its near end, held inside the band.
	const visibleStart = Math.max(start, clip);
	const room = Math.max(0, length - name - 2 * NAME_PAD);
	const shift = Math.min(room, Math.max(0, visibleStart - start));
	return { hidden: false, pos: Math.round(start), length: Math.round(length), shift: Math.round(shift) };
}

/** Write a style property only when it says something new: a repaint per frame costs a restyle. */
function put(el, prop, value) {
	if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/**
 * Wire the strip to its column.
 *
 * @param {HTMLElement} scroll  The column that scrolls.
 * @param {HTMLElement} layer   The strip (`.stonetop-timeline-ages`), holding one
 *                              `.stonetop-timeline-age` per Age, each stamped `data-age-first` and
 *                              `data-age-last` with the stored years it runs between on screen.
 * @param {object} opts
 * @param {boolean} opts.horizontal  Across (the strip along the foot) or Down (along the right).
 * @param {string}  [opts.pinned]    Selector, inside the column, of a header pinned at the strip's
 *                                   start (the swimlanes' thread names, the board's lane names): the
 *                                   bands are hidden under it, not drawn over it.
 * @returns {() => void}  Takes every listener back off.
 */
export function wireAgeBands(scroll, layer, { horizontal = true, pinned = "" } = {}) {
	if (!scroll?.addEventListener || !layer) return () => {};
	const bands = [...layer.querySelectorAll(".stonetop-timeline-age")]
		.map(band => ({ band, nameEl: band.querySelector(".stonetop-timeline-age-name") }));
	if (!bands.length) return () => {};
	let frame = 0;

	const place = () => {
		frame = 0;
		if (scroll.isConnected === false) return;
		// READS first, all of them, then the writes: one layout per frame.
		const spans = yearRects(scroll);
		const strip = layer.getBoundingClientRect();
		const origin = horizontal ? strip.left : strip.top;
		const size = horizontal ? strip.width : strip.height;
		const head = pinned ? scroll.querySelector(pinned)?.getBoundingClientRect?.() : null;
		const clip = head ? Math.max(0, (horizontal ? head.right : head.bottom) - origin) : 0;
		// The column's own scrollbar, where it shows one, is kept clear: the strip sits above it.
		const bar = horizontal
			? Math.max(0, scroll.offsetHeight - scroll.clientHeight - (scroll.clientTop || 0) * 2)
			: Math.max(0, scroll.offsetWidth - scroll.clientWidth - (scroll.clientLeft || 0) * 2);
		const placed = bands.map(({ band, nameEl }) => {
			const first = spans.get(band.dataset.ageFirst);
			const last = spans.get(band.dataset.ageLast);
			const name = nameEl ? (horizontal ? nameEl.offsetWidth : nameEl.offsetHeight) : 0;
			if (!first || !last) return { band, at: { hidden: true } };
			return {
				band,
				at: bandPlacement({
					start: (horizontal ? first.left : first.top) - origin,
					end:   (horizontal ? last.right : last.bottom) - origin,
					size, clip, name,
				}),
			};
		});

		put(layer, "--timeline-ages-clip", `${Math.round(clip)}px`);
		put(layer, "--timeline-ages-bar", `${Math.round(bar)}px`);
		for (const { band, at } of placed) {
			// `data-off` (visibility, not display), so a band off screen still has a name to measure.
			if (band.hasAttribute(OFF_ATTR) !== !!at.hidden) band.toggleAttribute(OFF_ATTR, !!at.hidden);
			if (at.hidden) continue;
			put(band, "--age-pos", `${at.pos}px`);
			put(band, "--age-length", `${at.length}px`);
			put(band, "--age-shift", `${at.shift}px`);
		}
	};

	const onScroll = () => {
		if (frame || typeof globalThis.requestAnimationFrame !== "function") return;
		frame = globalThis.requestAnimationFrame(place);
	};

	scroll.addEventListener("scroll", onScroll, { passive: true });
	// A resized window, and a picture the wheel zoomed or a repaint regrew, move the years without a
	// scroll.
	const watch = typeof globalThis.ResizeObserver === "function" ? new globalThis.ResizeObserver(onScroll) : null;
	watch?.observe(scroll);
	const canvas = scroll.firstElementChild;
	if (canvas) watch?.observe(canvas);
	const picture = canvas?.firstElementChild;
	if (picture) watch?.observe(picture);
	// Once now, so the bands open under their years.
	onScroll();

	return () => {
		scroll.removeEventListener("scroll", onScroll);
		watch?.disconnect();
		if (frame) globalThis.cancelAnimationFrame?.(frame);
		frame = 0;
	};
}
