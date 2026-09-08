// The arithmetic behind a THROWN board: how fast the pointer was travelling when it was let go,
// and how far the board keeps sliding afterwards.
//
// WHY IT IS NOT IN utils/image-zoom.js. That file is the arithmetic two zoom viewers share, and one
// of them (utils/image-zoom-window.js, the travel maps and the book reader) does not throw: it
// moves a picture inside a real scroll container, where the browser's own momentum is already in
// the box. A board moved by a CSS transform has no such thing, so the glide has to be spelled out,
// and spelling it out in the shared file would put a hundred lines nothing over there ever calls in
// front of every reader of it. Kept here, ZoomPanSurface imports it and nothing else has to know.
//
// PURE, for the reason the whole utils/ shelf is: a decay curve is four numbers and a multiply, and
// left inside the requestAnimationFrame loop it could only ever be checked by throwing a board
// across a screen and squinting. Which is how a glide ends up either chasing the cursor for two
// seconds or stopping dead the instant it is let go, with nobody able to say which line did it.

/**
 * How much of the END of a drag the throw is read from, in milliseconds.
 *
 * ⚠ AND IT IS MEASURED BACK FROM THE RELEASE, not from the last pointermove. A reader who drags the
 * board somewhere, PAUSES to look at it, and then lets go has thrown nothing, and the pause is
 * exactly what says so: no move events arrive while the pointer sits still, so by the time the
 * button comes up there is at most ONE sample left inside the window and the velocity below is
 * zero. Measured from the last move instead, that same careful placement would fling the board off
 * at whatever speed it happened to be doing before the pause, which is the worst way to get this
 * wrong: it only bites the reader who was being careful.
 *
 * Long enough to average out the jitter of a hand and a 125Hz mouse, short enough that what is
 * measured is the last flick of the wrist rather than the whole journey.
 */
export const GLIDE_WINDOW_MS = 80;

/** One frame at 60Hz, the rate the friction below is quoted per. */
const FRAME_MS = 1000 / 60;

/**
 * What is left of the speed after one 60Hz frame.
 *
 * 0.94 gives a throw a total run of roughly its speed times 280ms and settles it inside a second,
 * which is the difference between a board that glides and a board that has to be caught. Higher and
 * a firm flick sails half a screen past what the reader was aiming at; much lower and the slide is
 * over before the eye has followed it, which reads as a stutter rather than a nicety.
 */
export const GLIDE_FRICTION = 0.94;

/**
 * Below this, in window pixels per millisecond, there is no throw: a release is just a release.
 *
 * Read twice: once at the release, to decide whether the board slides at all, and again on every
 * frame, to decide when it has stopped. 0.05px/ms is three pixels in a frame, which is under the
 * threshold a portrait drag lifts at. At that speed the board is being placed, not thrown.
 */
export const GLIDE_MIN_SPEED = 0.05;

/**
 * The fastest throw the board will take, in window pixels per millisecond.
 *
 * A hand cannot really do 4px/ms (a quarter of a 1920px screen in a tenth of a second), but a
 * pointer that JUMPS can hand us one sample pair that says it did: a screen share catching up, a
 * pen lifted and put down somewhere else, a browser delivering a backlog of moves with fresh
 * timestamps. Uncapped, that one bad pair throws the board clean off the far edge and leaves the
 * reader staring at blank paper wondering what they did.
 */
export const GLIDE_MAX_SPEED = 4;

/** The longest step a single glide frame may take, however long the browser was actually away. */
const GLIDE_LONGEST_FRAME_MS = 64;

/** The same direction, at no more than GLIDE_MAX_SPEED. */
function capped({ x, y }) {
	const speed = Math.hypot(x, y);
	if (!(speed > GLIDE_MAX_SPEED)) return { x, y };
	const scale = GLIDE_MAX_SPEED / speed;
	return { x: x * scale, y: y * scale };
}

/**
 * How fast the pointer was going when it was let go, from the trail of samples the drag kept.
 *
 * The ENDS of the window rather than an average of the pairs inside it: the two are the same number
 * when the samples are evenly spaced, which they nearly are, and one subtraction over 80ms cannot
 * be thrown by a single event arriving a millisecond after the one before it. That happens all the
 * time on a fast mouse, and divided into a distance it makes a hand look like it moved at 30px/ms.
 *
 * @param {Array<{t: number, x: number, y: number}>} samples  In the order they arrived.
 * @param {number} now  When the pointer came up, on the same clock as the samples' own t.
 * @returns {{x: number, y: number}} Window pixels per millisecond. Zero for anything unreadable: an
 *                                   empty trail, a single sample, a pause before the release.
 */
export function throwVelocity(samples = [], now = 0) {
	const recent = samples.filter(s => now - s.t <= GLIDE_WINDOW_MS);
	if (recent.length < 2) return { x: 0, y: 0 };
	const first = recent[0];
	const last = recent[recent.length - 1];
	const span = last.t - first.t;
	if (!(span > 0)) return { x: 0, y: 0 };
	return capped({ x: (last.x - first.x) / span, y: (last.y - first.y) / span });
}

/** Is this velocity still worth a frame? Asked at the release, and again on every one after it. */
export function worthGliding({ x = 0, y = 0 } = {}) {
	return Math.hypot(x, y) >= GLIDE_MIN_SPEED;
}

/**
 * One frame of the slide: how far the board travels this frame, and what is left of the throw.
 *
 * ⚠ FRICTION PER MILLISECOND, NOT PER FRAME, which is the only reason `dt` is here. Multiplying the
 * velocity by 0.94 once per callback would send the glide FURTHER on a 144Hz monitor than on a 60Hz
 * one and further again than on a 30Hz laptop, so the same flick would land somewhere different for
 * every player at the table. Raising the per-frame figure to the power of the frame's real length
 * gives all of them the same curve in seconds.
 *
 * The step is capped as well. A browser that was away for half a second (a backgrounded tab, a long
 * paint elsewhere) comes back with a `dt` that would teleport the board most of a screen in one
 * jump. Better to lose that travel than to paint a journey nobody saw.
 */
export function glideStep({ velocity = { x: 0, y: 0 }, dt = 0 } = {}) {
	const step = Math.min(Math.max(Number(dt) || 0, 0), GLIDE_LONGEST_FRAME_MS);
	const left = Math.pow(GLIDE_FRICTION, step / FRAME_MS);
	return {
		dx: velocity.x * step,
		dy: velocity.y * step,
		velocity: { x: velocity.x * left, y: velocity.y * left },
	};
}
