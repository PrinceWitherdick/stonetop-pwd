// Grab-and-throw for a REAL scroll box: press anywhere that is not a control, drag, let go, and the
// box slides on a little the way the relationship map's board does (user, 2026-10-01: "we should
// be able to drag and slide around inside the timeline like we can for the relationship map").
//
// WHY IT IS NOT utils/zoom-pan-surface.js. That class moves a board with a CSS transform inside a
// window that does not scroll, and owns zoom, fit and bounds besides. The timeline is ordinary
// flowing markup in an ordinary scrollport: the wheel, the scrollbar, the keyboard and StonetopDialog's
// kept place all already speak `scrollLeft`/`scrollTop`, so the drag has to speak it too rather than
// stand a second coordinate system up beside them. What the two DO share is the hand: how fast a
// release was thrown and how a throw dies away, which is utils/pan-glide.js and is imported whole.
//
// THE ONE THING THIS DOES DIFFERENTLY FROM THE BOARD, and why. The board captures the pointer on the
// press, and so has to refuse every press on a control (capture retargets the click). Here the
// capture waits until the press has actually TRAVELLED (`LIFT_PX`), so a click that never moved is
// never captured and lands exactly where it was aimed. That is what lets a left drag start on a
// card's own words, which is most of a timeline, instead of only on the thin gutters between cards.
// Controls are still refused outright for a LEFT press: a button a hand wobbles on must still be a
// button. A RIGHT drag goes from anywhere, as on the board.
//
// Touch is left alone: the browser already scrolls a finger natively, momentum and all.
//
// The hand is measured on screen and the box scrolls in layout pixels: in a window drawn at a UI
// scale the pointer's travel is divided by the scale (utils/drawn-scale.js), or the board would run
// faster or slower than the hand and slide out from under it.

import { GLIDE_WINDOW_MS, glideStep, throwVelocity, worthGliding } from "./pan-glide.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { drawnScale } from "./drawn-scale.js";

/** How far a press must travel, in window pixels, before it is a drag rather than a click. */
export const LIFT_PX = 4;

/** What a LEFT press never pans from: anything a reader aims at rather than grabs. */
export const DRAG_SCROLL_CONTROLS = [
	"a", "button", "input", "select", "textarea", "summary", "label", "[contenteditable]",
	"[draggable='true']", "[role='button']",
].join(", ");

/** Worn while a drag is moving the box, for the grabbing cursor and to stop text selecting. */
export const PANNING_CLASS = "stonetop-drag-scroll--panning";
/** Worn while the box has somewhere to go, so the grab cursor only promises what it can do. */
export const PANNABLE_CLASS = "stonetop-drag-scroll--pannable";

/**
 * The custom properties a GUTTER is handed to the stylesheet through, in pixels: how much empty room
 * the content wants on each side. The host's CSS spends them (as padding round its content), since
 * only the host knows which element is the content.
 */
export const GUTTER_X_VAR = "--drag-scroll-gutter-x";
/** The room BELOW the content: 0 when the host pins its bottom (`pinBottom`). */
export const GUTTER_Y_VAR = "--drag-scroll-gutter-y";
/**
 * The room ABOVE the content, on its own: the same as the y gutter unless the host pins its top
 * (`pinTop`), when it is 0, or its bottom (`pinBottom`), when the y gutter is.
 */
export const GUTTER_TOP_VAR = "--drag-scroll-gutter-top";
/**
 * The room LEFT of the content, on its own: the same as the x gutter unless the host pins its left
 * (`pinLeft`), when it is 0. The x gutter is then the room to the right only.
 */
export const GUTTER_LEFT_VAR = "--drag-scroll-gutter-left";

/**
 * The empty room round the content, from the size of the box it is seen through.
 *
 * WHY THERE IS ANY (user, 2026-10-01: "drag further off the timeline down, to the left, right and
 * above it"). A real scroll box stops dead at its content's edges, which is the opposite of the
 * relationship map's board: that one goes off any side until only a sliver is left. The only way to
 * give a native scrollport that reach is real room to scroll INTO, so the content is padded on every
 * side by `share` of the window it is seen through, and the box opens scrolled past the top and left
 * gutters so the content still starts where it always did.
 *
 * ⚠ CAPPED BY THE BROWSER WINDOW as well as measured off the box. A host whose box grew to fit its
 * content would otherwise grow the gutter, which grows the content, which grows the box: the cap
 * is what makes that loop stop at a screenful instead of never.
 *
 * @param {{width: number, height: number}} box   The box's client size.
 * @param {{width: number, height: number}} [screen]  The browser window's inner size.
 * @param {number} share  Of the box, per side.
 */
export function gutterFor(box, screen = {}, share = 0) {
	const side = (n, cap) => {
		const size = Math.min(Number(n) || 0, Number.isFinite(cap) && cap > 0 ? cap : Infinity);
		return Math.max(0, Math.round(size * (Number(share) || 0)));
	};
	return { x: side(box?.width, screen?.width), y: side(box?.height, screen?.height) };
}

/**
 * Wire grab-and-throw onto a scroll box.
 *
 * @param {HTMLElement} el  The element that scrolls.
 * @param {object} [opts]
 * @param {string} [opts.controls]  Selector a LEFT press must not pan from.
 * @param {number} [opts.gutter]    Empty room past the content on every side, as a share of the
 *                                  box (see `gutterFor`). Zero, the default, for none: then the
 *                                  host's CSS need not spend the gutter properties at all.
 * @param {boolean} [opts.pinTop]   No gutter ABOVE the content, for a host whose top row is a sticky
 *                                  header: with nothing to scroll up into, the header stays against
 *                                  the box's top edge (user, 2026-10-03: "you can't scroll up above
 *                                  the column name"). The other three sides keep theirs.
 * @param {boolean} [opts.pinLeft]  No gutter LEFT of the content, for a host whose left column is a
 *                                  sticky header (user, 2026-10-03: "we shouldn't be able to scroll to
 *                                  the left past the left edge of the player column names").
 * @param {boolean} [opts.pinBottom]  No gutter BELOW the content: the box stops at its foot, as a
 *                                  page does (user, 2026-10-05, the timeline).
 * @returns {() => void}  Takes every listener back off and stops any glide.
 */
export function wireDragScroll(el, { controls = DRAG_SCROLL_CONTROLS, gutter: gutterShare = 0, pinTop = false, pinLeft = false, pinBottom = false } = {}) {
	if (!el?.addEventListener) return () => {};

	let press = null;        // { id, button, x, y, left, top, lifted }
	let scale = 1;           // the box's UI scale, taken at the press; the throw after it spends it too
	let marks = [];          // the trail a throw is read from
	let glide = null;        // { velocity, at }
	let glideId = 0;
	let swallowClick = false;
	let swallowMenu = false;

	const now = () => globalThis.performance?.now?.() ?? Date.now();

	const mark = (ev) => {
		if (!Number.isFinite(ev?.clientX) || !Number.isFinite(ev?.clientY)) return;
		const t = now();
		marks.push({ t, x: ev.clientX, y: ev.clientY });
		while (marks.length > 2 && t - marks[0].t > GLIDE_WINDOW_MS) marks.shift();
	};

	const stopGlide = () => {
		const running = glide !== null;
		if (glideId) globalThis.cancelAnimationFrame?.(glideId);
		glideId = 0;
		glide = null;
		return running;
	};

	const glideFrame = () => {
		glideId = 0;
		// A repaint replaces the whole box; a glide on the one it threw away has nothing to move.
		if (!glide || el.isConnected === false) { stopGlide(); return; }
		const t = now();
		const { dx, dy, velocity } = glideStep({ velocity: glide.velocity, dt: t - glide.at });
		glide.at = t;
		glide.velocity = velocity;
		// The content follows the hand, so the scroll offset runs the OTHER way.
		const wantLeft = el.scrollLeft - dx / scale;
		const wantTop = el.scrollTop - dy / scale;
		el.scrollLeft = wantLeft;
		el.scrollTop = wantTop;
		// An axis the box could not go any further on is done (see ZoomPanSurface#_glideFrame).
		if (Math.abs(el.scrollLeft - wantLeft) >= 1) glide.velocity.x = 0;
		if (Math.abs(el.scrollTop - wantTop) >= 1) glide.velocity.y = 0;
		if (worthGliding(glide.velocity)) askFrame();
		else stopGlide();
	};

	const askFrame = () => {
		if (typeof globalThis.requestAnimationFrame !== "function") { stopGlide(); return; }
		glideId = globalThis.requestAnimationFrame(glideFrame);
	};

	const startGlide = (velocity) => {
		if (!worthGliding(velocity) || prefersReducedMotion()) return;
		if (typeof globalThis.requestAnimationFrame !== "function") return;
		glide = { velocity: { ...velocity }, at: now() };
		askFrame();
	};

	// A press on the box's OWN scrollbar is the reader dragging the thumb, which already scrolls;
	// panning as well would run the content the other way under it.
	const onScrollbar = (ev, box, s) => {
		if (ev.target !== el || !box) return false;
		return ev.clientX >= box.left + ((el.clientLeft || 0) + el.clientWidth) * s
			|| ev.clientY >= box.top + ((el.clientTop || 0) + el.clientHeight) * s;
	};

	const onDown = (ev) => {
		// A hand put down on a sliding box stops it, whatever it landed on and with any button; a
		// left press that did only that opens nothing either.
		const caught = stopGlide();
		swallowClick = caught && ev.button === 0;
		if (press || ev.pointerType === "touch") return;
		const right = ev.button === 2;
		if (ev.button !== 0 && !right) return;
		if (ev.buttons > 2) return;
		if (!right && controls && ev.target?.closest?.(controls)) return;
		// One read of the box serves both the scrollbar test and the press's scale.
		const box = el.getBoundingClientRect?.();
		const s = drawnScale(el, box);
		if (onScrollbar(ev, box, s)) return;
		scale = s;
		press = {
			id: ev.pointerId, button: ev.button, x: ev.clientX, y: ev.clientY,
			left: el.scrollLeft, top: el.scrollTop, lifted: false,
		};
		marks = [{ t: now(), x: ev.clientX, y: ev.clientY }];
	};

	const onMove = (ev) => {
		if (!press || ev.pointerId !== press.id) return;
		const dx = ev.clientX - press.x;
		const dy = ev.clientY - press.y;
		if (!press.lifted) {
			if (Math.hypot(dx, dy) < LIFT_PX) return;
			// NOW it is a drag. Capture so a drag that leaves the window keeps going, and take back
			// whatever the browser had started selecting under the press.
			press.lifted = true;
			el.setPointerCapture?.(ev.pointerId);
			el.classList?.add(PANNING_CLASS);
			el.ownerDocument?.defaultView?.getSelection?.()?.removeAllRanges?.();
		}
		ev.preventDefault?.();
		// From where the drag STARTED plus the travel, so a clamped edge cannot make it creep.
		el.scrollLeft = press.left - dx / scale;
		el.scrollTop = press.top - dy / scale;
		mark(ev);
	};

	const finish = (ev, released) => {
		if (!press || ev?.pointerId !== press.id) return;
		const { lifted, button } = press;
		press = null;
		if (!lifted) { marks = []; return; }
		el.releasePointerCapture?.(ev.pointerId);
		el.classList?.remove(PANNING_CLASS);
		if (released) {
			// The release a drag ends in derives a click (left) or a menu (right); neither was asked for.
			if (button === 0) swallowClick = true;
			else swallowMenu = true;
			mark(ev);
			startGlide(throwVelocity(marks, now()));
		}
		marks = [];
	};

	const onUp = (ev) => finish(ev, true);
	// A cancel, or the box being replaced under the drag, is the platform taking the gesture away:
	// not a throw, and no click follows it to swallow.
	// ⚠ ONLY WHILE A PRESS IS LIVE. `lostpointercapture` also fires after every ordinary release,
	// BETWEEN the pointerup and the click, and clearing the swallow there would let that click through.
	const onCancel = (ev) => {
		if (!press || ev?.pointerId !== press.id) return;
		swallowClick = false;
		finish(ev, false);
	};

	const onClick = (ev) => {
		if (!swallowClick) return;
		swallowClick = false;
		ev.preventDefault();
		ev.stopPropagation();
		ev.stopImmediatePropagation?.();
	};

	const onMenu = (ev) => {
		if (!swallowMenu) return;
		swallowMenu = false;
		ev.preventDefault();
		ev.stopPropagation();
	};

	// The wheel is the reader taking hold of the box too.
	const onWheel = () => { stopGlide(); };

	// Asked as the pointer comes in rather than once at wiring: the content grows and shrinks with
	// every repaint, the Filter menu and the window's own size.
	const onEnter = () => {
		const room = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
		el.classList?.toggle?.(PANNABLE_CLASS, room);
	};

	const listeners = [
		["pointerdown", onDown],
		["pointermove", onMove],
		["pointerup", onUp],
		["pointercancel", onCancel],
		["lostpointercapture", onCancel],
		["pointerenter", onEnter],
		["wheel", onWheel, { passive: true }],
		["click", onClick, { capture: true }],
		["contextmenu", onMenu, { capture: true }],
	];
	for (const [type, fn, opts] of listeners) el.addEventListener(type, fn, opts);

	// THE GUTTER, sized now and again whenever the box changes size. Every change moves the scroll
	// offset by the same amount, so the content stays exactly where the reader left it on screen: on
	// the first sizing that is what opens the box at the content's top-left corner rather than out in
	// the empty room; on a resize it is what stops the timeline jumping. A box sized while hidden (a
	// sheet tab not yet shown) measures zero, gets no gutter, and is put right when it is shown.
	//
	// ⚠ A SHIFT THE BOX COULD NOT TAKE IS KEPT, not lost. AppV1 wires a window's listeners BEFORE
	// `setPosition` gives it a size, so the first sizing can land on a box still sized to its content,
	// with no room to scroll: the offset clamps to 0 and the gutter's shift is gone. `owed` holds what
	// was asked for and what the box gave, and the next sizing starts from what was asked for -- but
	// only while the box still sits where it was clamped, so a reader (or a restore) who has moved it
	// since is never pulled back.
	//
	// Only the gutters BEFORE the content (left, top) move the offset; with `pinTop` there is no top
	// one, with `pinLeft` no left one.
	let gutter = { x: 0, y: 0, top: 0, left: 0 };
	let owed = { x: null, y: null };
	const from = (axis, now) => (owed[axis] && owed[axis].got === now ? owed[axis].want : now);
	const settle = (want, got) => (got === want ? null : { want, got });
	const sizeGutter = () => {
		if (el.isConnected === false) return;
		const win = el.ownerDocument?.defaultView ?? globalThis.window;
		// The box's size is laid out and the browser window's is on screen: the cap is brought into
		// the box's own pixels, so a scaled window's gutter still stops at a screenful.
		const s = drawnScale(el);
		const measured = gutterFor(
			{ width: el.clientWidth, height: el.clientHeight },
			{ width: win?.innerWidth / s, height: win?.innerHeight / s },
			gutterShare,
		);
		const next = { ...measured, y: pinBottom ? 0 : measured.y, top: pinTop ? 0 : measured.y, left: pinLeft ? 0 : measured.x };
		const dx = next.left - gutter.left;
		const dy = next.top - gutter.top;
		const grew = next.y !== gutter.y || next.x !== gutter.x;
		// The same gutter can still owe a shift the last box was too small to take.
		if (!dx && !dy && !grew && !owed.x && !owed.y) return;
		// ⚠ READ BEFORE THE GUTTER MOVES, WRITTEN AS A SUM AFTER, never `+=` afterwards. Chrome's
		// scroll anchoring sees the padding change and nudges the offset itself during the layout
		// the next read forces, so `+=` would add the shift twice and the timeline would jump.
		const left = from("x", el.scrollLeft);
		const top = from("y", el.scrollTop);
		gutter = next;
		el.style?.setProperty?.(GUTTER_X_VAR, `${next.x}px`);
		el.style?.setProperty?.(GUTTER_Y_VAR, `${next.y}px`);
		el.style?.setProperty?.(GUTTER_TOP_VAR, `${next.top}px`);
		el.style?.setProperty?.(GUTTER_LEFT_VAR, `${next.left}px`);
		el.scrollLeft = left + dx;
		el.scrollTop = top + dy;
		owed = { x: settle(left + dx, el.scrollLeft), y: settle(top + dy, el.scrollTop) };
	};
	let resizes = null;
	if (gutterShare > 0) {
		sizeGutter();
		if (typeof globalThis.ResizeObserver === "function") {
			resizes = new globalThis.ResizeObserver(() => sizeGutter());
			resizes.observe(el);
		}
	}

	return () => {
		stopGlide();
		press = null;
		resizes?.disconnect();
		resizes = null;
		for (const [type, fn, opts] of listeners) el.removeEventListener(type, fn, opts);
	};
}
