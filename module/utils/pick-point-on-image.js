// "Click where it goes": one gesture, over any picture this system draws pins on.
//
// TWO SURFACES, ONE GESTURE. The route step draws its map inline at the width of a dialog column,
// and the "See the whole map" window draws the same map at 300 dpi with a wheel-zoom and a drag on
// it. Placing a site has to mean the same thing in both, and the arithmetic is the same either way
// (where the click landed, as a percentage of the picture's own box), so the only thing that
// differs is which element listens and which element is measured. Those are the two parameters.
//
// WHY IT MEASURES A DIFFERENT ELEMENT THAN IT LISTENS ON. In the popout the picture is positioned
// inside a viewport it is usually larger than and often dragged past the edge of; the overlay is
// the box sized onto the painted picture exactly, and it is the one whose percentages mean
// anything. The viewport is where the events arrive, because the pan handler takes a POINTER
// CAPTURE on it and every later event from that press is retargeted there. Listening on the
// overlay would work right up until the reader dragged the map, and then stop.
//
// WHY IT SWALLOWS THE CLICK IN THE CAPTURE PHASE. The maps already have delegated click handlers
// above them: the dialog's own "pick this place as the destination", and the popout's overlay
// hotspot delegate. A placement click that reached either would ALSO change where the party is
// bound, from a gesture that said nothing about the destination. Stopping it on the way DOWN, at
// the element the caller nominated, means it never reaches the pin under the cursor nor the root
// above it.
//
// A DRAG IS NOT A CLICK. The popout pans on a left-drag, and a pan ends in a `click` at whatever
// the pointer was captured to. Placing a site at the end of every drag would make the map
// unbrowsable exactly when the reader is hunting for the spot, so the press position is
// remembered and a click that travelled is ignored, leaving the mode armed: a reader who was
// dragging has not chosen anything yet. Zooming and panning stay live throughout, which is the
// whole reason the popout is worth placing from.
//
// TWO SHAPES, ONE ARITHMETIC. `pickPointOnImage` waits for ONE click and resolves — put this site
// there, and we are done. `watchPointsOnImage` stays armed and reports every click until it is
// stopped, which is what drawing a route by hand is: a run of marks, laid one at a time, with a
// right-click taking the last of them back. They differ in how long they live and in what a
// right-click means, and in nothing else, so they share everything below the handlers.
//
// AND THEY ARE NOT BOTH ARMED AT ONCE. A one-shot pick takes the click in the CAPTURE phase and
// swallows it; the watcher listens in the bubble phase and stands down while the picking class is
// on the element. So a GM who is drawing a route and then presses "put a site on the map" gets the
// site placement for that one click, and their line back afterwards — rather than one click doing
// both things, which is the only way two gestures over one picture can go wrong.

/** How far the pointer may travel between press and release and still count as a click, in px. */
const DRAG_SLOP = 4;

/** The class the listening element wears while it is waiting for ONE click. Styled in stonetop.css. */
export const PICKING_CLASS = "stonetop-picking";

/** And the one it wears while it is armed for as many as the reader cares to make. */
export const DRAWING_CLASS = "stonetop-drawing";

/**
 * Where a pointer event landed inside a box, as percentages of it, or null for outside.
 *
 * Outside is the letterboxing around a fitted map in the popout, or the strip an edge pin's label
 * hangs into. Not a spot — and not a cancellation either, which is why this answers null rather
 * than clamping to the edge: a mark clamped onto the border is a mark nobody put there.
 */
export function pointPercent(ev, measure) {
	const rect = measure?.getBoundingClientRect?.();
	if (!rect?.width || !rect?.height) return null;
	const left = ((ev.clientX - rect.left) / rect.width) * 100;
	const top = ((ev.clientY - rect.top) / rect.height) * 100;
	if (left < 0 || left > 100 || top < 0 || top > 100) return null;
	return { left, top };
}

/** Did the pointer travel far enough between press and release to have been a drag? */
const travelled = (pressed, ev) =>
	!!pressed && Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > DRAG_SLOP;

/**
 * Wait for the reader to click a point on a picture.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.listenOn   where the events arrive, and what wears the crosshair
 * @param {HTMLElement} [opts.measure]  the box the percentages are OF; defaults to `listenOn`
 * @param {AbortSignal} [opts.signal]   cancels the wait from outside. What a window closing with
 *                                      the mode still armed uses: without it the promise never
 *                                      settles and the keydown listener below outlives the picture
 *                                      it was watching for.
 * @returns {Promise<{left: number, top: number}|null>}  percentages of `measure`, or null if the
 *          reader cancelled with Escape or a right-click, or the wait was aborted.
 */
export function pickPointOnImage({ listenOn, measure = listenOn, signal = null } = {}) {
	if (!listenOn || !measure) return Promise.resolve(null);
	if (signal?.aborted) return Promise.resolve(null);

	return new Promise(resolve => {
		// Every listener below is registered against this, so one abort takes the lot off again —
		// including the one on the global, which is the only one that would outlive the element.
		const off = new AbortController();
		const bind = { capture: true, signal: off.signal };
		// Where the last press landed, so the click it produces can be told from the end of a drag.
		let pressed = null;

		const finish = (answer) => {
			off.abort();
			listenOn.classList.remove(PICKING_CLASS);
			resolve(answer);
		};

		// NOT swallowed: the popout pans on this, and a reader hunting for the right valley has to
		// be able to drag and zoom the map while the mode is armed.
		listenOn.addEventListener("pointerdown", ev => {
			pressed = { x: ev.clientX, y: ev.clientY };
		}, bind);

		listenOn.addEventListener("click", ev => {
			// Every click over the picture belongs to this gesture while it is armed, whether or
			// not it turns out to be a placement: see the header for what it would otherwise reach.
			ev.preventDefault();
			ev.stopPropagation();

			// The tail of a drag. Still armed, because the reader was moving the map, not choosing.
			if (travelled(pressed, ev)) return;

			const at = pointPercent(ev, measure);
			if (at) finish(at);
		}, bind);

		// The other way out, for a reader whose hands are on the mouse. Swallowed so the canvas
		// behind a dialog does not open its own menu on the way past.
		listenOn.addEventListener("contextmenu", ev => {
			ev.preventDefault();
			ev.stopPropagation();
			finish(null);
		}, bind);

		globalThis.addEventListener?.("keydown", ev => {
			if (ev.key !== "Escape") return;
			// Swallowed for the same reason: Escape is what closes the dialog the map is drawn in,
			// and cancelling a placement should not also shut the walkthrough out from under it.
			ev.preventDefault();
			ev.stopPropagation();
			finish(null);
		}, bind);

		signal?.addEventListener?.("abort", () => finish(null), { once: true, signal: off.signal });

		listenOn.classList.add(PICKING_CLASS);
	});
}

/**
 * Stay armed over a picture and report every click on it, until told to stop.
 *
 * WHAT A ROUTE DRAWN BY HAND IS. The one-shot gesture above is the right shape for "this site
 * stands there": one answer, and the mode is over. Laying out a way is not one answer — it is a
 * run of them, each judged against the line the last one made, with the freedom to take one back.
 * So this reports rather than resolves, and it is the caller who decides when the drawing is done.
 *
 * THE THREE GESTURES, and they are the whole of the vocabulary:
 *   click          a point on the way
 *   shift-click    another point, kept on top of the last rather than replacing it
 *   right-click    take the last one back
 * The shift key is not read here — it rides along on the event, because what "another leg" means
 * is the caller's business and this module only knows where the pointer was.
 *
 * IT LISTENS IN THE BUBBLE PHASE, which is the opposite of the pick above and is what lets the two
 * live over one picture. A one-shot pick swallows its click on the way DOWN, so while one is armed
 * nothing here ever runs; and on the one path where both would see the same event — a click whose
 * target IS the listening element, where capture and bubble both fire — the picking class stands
 * this one down explicitly.
 *
 * `ignore` IS WHAT KEEPS THE PINS ALIVE. The marks on these maps already mean things: a place pin
 * chooses that place, a site pin opens its write-up. A click that landed on one of those is not a
 * click on open map, and swallowing it would kill every control on the picture the moment the mode
 * came on. Left alone, it carries on up to the delegates that own it.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.listenOn      where the events arrive, and what wears the crosshair
 * @param {HTMLElement} [opts.measure]     the box the percentages are OF; defaults to `listenOn`
 * @param {Function} [opts.onPoint]        `({left, top}, ev)` — a click on open picture
 * @param {Function} [opts.onUndo]         `(ev)` — a right-click on it
 * @param {string} [opts.ignore]           selector for marks whose own click meaning wins
 * @param {string} [opts.undoIgnore]       the same for right-clicks, which some marks also claim
 * @param {AbortSignal} [opts.signal]      stops the watch from outside
 * @returns {Function} stop watching. Idempotent, so a caller may both call it and abort the signal.
 */
export function watchPointsOnImage({
	listenOn, measure = listenOn, onPoint = null, onUndo = null,
	ignore = "", undoIgnore = "", signal = null,
} = {}) {
	if (!listenOn || !measure || signal?.aborted) return () => {};

	const off = new AbortController();
	const bind = { signal: off.signal };
	// Where the last press landed, so the click it produces can be told from the end of a drag.
	let pressed = null;

	const stop = () => {
		off.abort();
		listenOn.classList.remove(DRAWING_CLASS);
	};
	// A one-shot placement is armed over this same picture and owns the next click outright.
	const yielded = () => listenOn.classList.contains(PICKING_CLASS);
	const claimed = (ev, selector) => !!selector && !!ev.target?.closest?.(selector);

	listenOn.addEventListener("pointerdown", ev => {
		pressed = { x: ev.clientX, y: ev.clientY };
	}, bind);

	listenOn.addEventListener("click", ev => {
		if (!onPoint || yielded() || claimed(ev, ignore)) return;
		// The tail of a pan. The reader was moving the map, not putting a mark on it.
		if (travelled(pressed, ev)) return;
		const at = pointPercent(ev, measure);
		if (!at) return;
		// Only once it IS a mark: a click that fell outside the picture, or that ended a drag, has
		// to go on meaning whatever it meant before this mode came on.
		ev.preventDefault();
		ev.stopPropagation();
		onPoint(at, ev);
	}, bind);

	listenOn.addEventListener("contextmenu", ev => {
		if (!onUndo || yielded() || claimed(ev, undoIgnore)) return;
		// Swallowed whether or not there is anything left to undo, so the browser's own menu never
		// opens over a map the reader is drawing on. An empty path simply has nothing to take back.
		ev.preventDefault();
		ev.stopPropagation();
		onUndo(ev);
	}, bind);

	signal?.addEventListener?.("abort", stop, { once: true, signal: off.signal });

	listenOn.classList.add(DRAWING_CLASS);
	return stop;
}
