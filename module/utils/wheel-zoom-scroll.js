// Wheel-zoom for a REAL scroll box: the wheel makes what is in it bigger or smaller about the point
// under the cursor, the way the relationship map's board zooms (user, 2026-10-01: "scrolling should
// zoom in and out on the timeline instead of scroll up and down - match the relationship maps
// behavior"). The drag still moves it about (utils/drag-scroll.js); this only takes the wheel.
//
// WHY NOT utils/zoom-pan-surface.js, for the same reason drag-scroll.js gives: that class scales a
// board with a TRANSFORM inside a window that does not scroll. A transform leaves the layout box
// where it was, so a native scrollport would go on scrolling the unzoomed size, and the timeline's
// sticky season and thread heads would pin in the wrong coordinate space. CSS `zoom` instead scales
// the LAYOUT: the scroll extent grows and shrinks with the picture, the sticky heads still pin to the
// column's edge, and the type is laid out again at the new size rather than resampled, so it stays
// sharp. What this shares with the board is the arithmetic of a notch (utils/image-zoom.js), imported
// whole, so a trackpad nudge is the same fraction of a step here as there.
//
// THE HOST'S STYLESHEET SPENDS THE SCALE, through `ZOOM_VAR` on the scroll box, because only the host
// knows which element is the picture and which is the empty room round it.

import { stepZoom, wheelNotches } from "./image-zoom.js";
import { drawnScale } from "./drawn-scale.js";

/** The custom property the scale is handed to the stylesheet through, unitless. */
export const ZOOM_VAR = "--wheel-zoom";

/**
 * Where the box has to be scrolled to after a zoom, so the speck of content under the cursor STAYS
 * under the cursor. One axis; all in the box's scroll coordinates.
 *
 * The picture's top-left corner (`origin`) is measured before AND after, rather than assumed fixed:
 * a picture narrower than its column may be centred in it, and then that corner moves with the size.
 *
 * @param {object} a
 * @param {number} a.scroll        The offset before the zoom.
 * @param {number} a.pointer       The cursor, from the box's visible top-left.
 * @param {number} a.originBefore  The picture's corner, in scroll coordinates, before.
 * @param {number} a.originAfter   The same corner after.
 * @param {number} a.from          The scale before.
 * @param {number} a.to            The scale after.
 */
export function anchoredScroll({ scroll = 0, pointer = 0, originBefore = 0, originAfter = 0, from = 1, to = 1 } = {}) {
	if (!(from > 0) || !(to > 0)) return scroll;
	const unzoomed = (scroll + pointer - originBefore) / from;
	return originAfter + unzoomed * to - pointer;
}

/** A scale inside the host's range; nonsense comes back as 1. */
export function clampScale(scale, min, max) {
	const n = Number(scale);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.min(max, Math.max(min, n));
}

/**
 * Wire wheel-zoom onto a scroll box.
 *
 * The scale is OWNED BY THE HOST, read through `get` and written back through `set`, so it outlives
 * the box: a repaint replaces the box wholesale, and the reader must not be thrown back to 1 by
 * somebody else's entry landing.
 *
 * @param {HTMLElement} el  The element that scrolls.
 * @param {object} opts
 * @param {string}   opts.content  Selector, inside `el`, for the element the scale is put on: its
 *                                 corner is what the anchoring measures.
 * @param {() => number} [opts.get]  The current scale.
 * @param {(scale: number) => void} [opts.set]  Told each new scale.
 * @param {number} [opts.step]  What one wheel notch multiplies the scale by.
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @returns {() => void}  Takes the listener back off.
 */
export function wireWheelZoom(el, { content, get = () => 1, set = () => {}, step, min = 0.25, max = 4 } = {}) {
	if (!el?.addEventListener) return () => {};

	const paint = (scale) => el.style?.setProperty?.(ZOOM_VAR, String(scale));
	// Put the scale the host already has on the fresh box at once, BEFORE StonetopDialog gives the
	// reader their scroll offset back: an offset restored onto an unzoomed picture would be clamped.
	paint(clampScale(get(), min, max));

	// The picture's corner in the box's scroll coordinates. Read off the layout, not worked out from
	// the gutter and the padding, so nothing here has to know how the host spaces its content. Rects
	// are on screen and scroll offsets laid out, so the distance is divided by the box's scale `s`.
	const originOf = (target, box, s) => {
		const r = target?.getBoundingClientRect?.();
		if (!r) return { x: 0, y: 0 };
		return {
			x: (r.left - box.left) / s - (el.clientLeft || 0) + el.scrollLeft,
			y: (r.top - box.top) / s - (el.clientTop || 0) + el.scrollTop,
		};
	};

	// ⚠ ONE ZOOM PER PAINTED FRAME, however many wheel events arrive in it. A new scale lays the
	// whole picture out again (that is what `zoom` is for), and a trackpad sends its fractional
	// notches sixty-plus times a second; applied one by one, a pinch on a long campaign stutters.
	// So the notches are summed and the cursor remembered, and the frame spends them once.
	let notchesHeld = 0;
	let cursor = { x: 0, y: 0 };
	let frame = null;

	const apply = () => {
		frame = null;
		const notches = notchesHeld;
		notchesHeld = 0;
		const from = clampScale(get(), min, max);
		const to = clampScale(stepZoom(from, notches, step), min, max);
		if (to === from) return;

		const target = content ? el.querySelector?.(content) : null;
		const box = el.getBoundingClientRect?.() ?? { left: 0, top: 0 };
		// The UI scale, not the wheel's: the zoom is on the content, so the box is drawn as big after.
		const s = drawnScale(el, box);
		const pointer = {
			x: (cursor.x - box.left) / s - (el.clientLeft || 0),
			y: (cursor.y - box.top) / s - (el.clientTop || 0),
		};
		const before = originOf(target, box, s);
		const scroll = { x: el.scrollLeft, y: el.scrollTop };

		set(to);
		paint(to);

		// ⚠ MEASURED AFTER THE NEW SCALE IS ON, which forces the layout. Every number below is in
		// scroll coordinates read in one state, so a nudge scroll anchoring makes during that layout
		// is already counted in rather than added twice.
		const boxAfter = el.getBoundingClientRect?.() ?? box;
		const after = originOf(target, boxAfter, s);
		el.scrollLeft = anchoredScroll({
			scroll: scroll.x, pointer: pointer.x, originBefore: before.x, originAfter: after.x, from, to,
		});
		el.scrollTop = anchoredScroll({
			scroll: scroll.y, pointer: pointer.y, originBefore: before.y, originAfter: after.y, from, to,
		});
	};

	const onWheel = (ev) => {
		// Sideways only (Shift+wheel, a trackpad swiped across) is not a zoom: that one still scrolls.
		const notches = wheelNotches(ev);
		if (!notches) return;
		ev.preventDefault();
		notchesHeld += notches;
		cursor = { x: ev.clientX, y: ev.clientY };
		if (frame !== null) return;
		// No frames to wait for (a test, a headless page): spend it now.
		if (typeof globalThis.requestAnimationFrame !== "function") return apply();
		frame = globalThis.requestAnimationFrame(apply);
	};

	el.addEventListener("wheel", onWheel, { passive: false });
	return () => {
		el.removeEventListener("wheel", onWheel, { passive: false });
		// A repaint replaces the box: a frame still owed to the old one must not zoom it.
		if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
		frame = null;
	};
}
