// The arithmetic behind the image-zoom window (utils/image-zoom-window.js).
//
// Kept apart from the Application because the interesting half of a zoom viewer is not the
// window — it is what a wheel notch does to the scroll offset, and that is a pure function of
// four numbers. Split out, it is testable without a DOM, a layout engine, or a Foundry; left
// inside the class it would only ever be exercised by hand, which is how a viewer ends up
// drifting a little further off the cursor with every notch and nobody noticing.

/** Zoom floor and ceiling. A 2000px flowchart at 8x is 16000px wide, which is plenty of nose. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

/**
 * One notch of the wheel. A fifth each way, so a chart goes from fit (~0.3)
 * to legible (~1) in a handful of notches rather than a dozen, and still lands close enough to
 * a wanted size that nobody hunts for it.
 */
export const ZOOM_STEP = 1.2;

/**
 * A usable scale, whatever was asked for. Zero, negative, NaN and undefined all come back as 1
 * rather than as themselves: every one of them would otherwise reach `img.style.width` as a
 * degenerate pixel count and the picture would vanish with no error anywhere.
 */
export function clampZoom(scale) {
	const n = Number(scale);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

/**
 * The scale that fits the whole picture in the viewport — the size the window opens at.
 *
 * Never larger than 1. Fitting UP would blow a small picture across a maximised window and show
 * nothing but its own pixels; the flowcharts this was built for are far larger than any window,
 * so the cap only ever bites on something else.
 *
 * Returns 1 when any measurement is missing, which is the state before the image has loaded and
 * reported its natural size.
 */
export function fitScale({ imageWidth, imageHeight, viewWidth, viewHeight } = {}) {
	if (!(imageWidth > 0 && imageHeight > 0 && viewWidth > 0 && viewHeight > 0)) return 1;
	return clampZoom(Math.min(viewWidth / imageWidth, viewHeight / imageHeight, 1));
}

/** One step in or out (`direction` positive = in), clamped at both ends. */
export function stepZoom(scale, direction) {
	const from = clampZoom(scale);
	if (!direction) return from;
	return clampZoom(from * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

/**
 * How much of the picture must stay inside the window, in pixels of the window.
 *
 * The pan is free (user, 2026-08-16): the picture goes anywhere, including well past every edge,
 * which is what "infinite scroll" means for a flowchart you are reading a corner of. Free is not
 * the same as losable, though, and with no scrollbars there is no evidence left of a picture
 * dragged clean out of the window — so a sliver always stays put. Small enough to be no kind of
 * fence (the reader can still park a diagram almost entirely offscreen), big enough to grab.
 */
export const PAN_MARGIN = 40;

/**
 * The offset that centres the picture in the window — where a fitted picture sits.
 *
 * An OFFSET, not a scroll position: the picture's top-left corner measured from the window's
 * top-left, free to go negative (picture larger than the window, or dragged up and left) in a way
 * a scroll position never could. That freedom is the whole point of the model.
 */
export function centreOffset({ paintedWidth = 0, paintedHeight = 0, viewWidth = 0, viewHeight = 0 } = {}) {
	return {
		x: Math.round((viewWidth - paintedWidth) / 2),
		y: Math.round((viewHeight - paintedHeight) / 2),
	};
}

/**
 * Where the picture has to sit after a zoom, so that the point under the cursor STAYS under the
 * cursor.
 *
 * `pointer - offset` is the distance from the picture's own left/top edge to the cursor at the old
 * scale; scaling that by `to / from` is where the same spot lands at the new one, and taking it
 * back off the cursor's position turns it into an offset again. Do this and the wheel zooms into
 * what the GM is looking at; skip it — set the scale and leave the offset alone — and every notch
 * drifts toward the top-left corner, which is the difference between reading a flowchart and
 * chasing it.
 */
export function anchoredOffset({ offset = 0, pointer = 0, from = 1, to = 1 } = {}) {
	if (!(from > 0) || !(to > 0)) return offset;
	return pointer - (pointer - offset) * (to / from);
}

/**
 * One axis of the pan, held to the sliver above.
 *
 * The bounds are not the usual "no empty space past the edges" clamp a scroll container gives —
 * that one pins a picture bigger than its window to the window, which is exactly the freedom being
 * asked for here. These only stop the last of it leaving: at least `keep` pixels of picture overlap
 * the window at both ends of the travel.
 *
 * `keep` never exceeds the picture or the window, so a tiny picture in a tiny window still has a
 * range rather than a pair of crossed bounds.
 */
export function clampPan({ offset = 0, painted = 0, view = 0 } = {}) {
	const n = Number(offset);
	if (!Number.isFinite(n)) return 0;
	if (!(painted > 0) || !(view > 0)) return n;
	const keep = Math.min(PAN_MARGIN, painted, view);
	return Math.min(view - keep, Math.max(keep - painted, n));
}
