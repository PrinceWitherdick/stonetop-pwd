// A one-shot highlight that puts itself out — "this is the one that just happened" — and the
// walk that leads up to it.
//
// Written for the GM Toolkit's move randomizer. A click draws a move, `spinHighlight` runs a light
// down the section's entries and decelerates onto the one drawn, and `flashHighlight` then holds
// it lit while it fades. The whisper to chat waits for the landing, so the card never answers the
// question the walk is still asking.
//
// The light has to go out on its own. A highlight that stays reads as a selection, and this is not
// one — nothing was chosen, nothing was stored, and a row still lit ten minutes later would have
// the sheet claiming a state it does not have.
//
// The FADE itself is CSS (a keyframe hung on the class); this file only puts the class on and
// takes it off again. Two consequences worth knowing:
//
//  • The duration lives in BOTH places and the two have to agree. Too short an animation leaves a
//    faded-out row sat there until the timer catches up; too long a one is cut off mid-fade. The
//    GM Toolkit's test pins its animation against `FLASH_MS`.
//  • A re-render inside the window drops the highlight along with the element it was on. That is
//    deliberate: re-applying it after a render would re-light the row on every unrelated
//    re-render, and the GM Toolkit re-renders on every prep-page write in the world.

/** How long a flash lasts, from lit to gone. Must match the animation in stonetop.css. */
export const FLASH_MS = 5000;

/** The class the CSS hangs its keyframes off. */
export const FLASH_CLASS = "stonetop-flash";

/** The class a row wears while the walk is passing OVER it — see `spinHighlight`. */
export const SPIN_CLASS = "stonetop-spin";

/**
 * The walk's first and last intervals in ms, and the fewest steps it takes.
 *
 * The interval is eased from one to the other, so the light leaves fast and arrives slowly —
 * that deceleration is the whole effect. Both ends measured against the lists it was written for
 * (7 to 13 entries): 40ms is about as fast as a row can light and still register as a row rather
 * than a flicker, and 240ms is a beat long enough that the last two or three steps are read
 * individually, which is where the suspense is.
 *
 * The floor on steps is what stops the seven-entry Exploration list from being over before it has
 * started; below about a dozen it reads as a stutter rather than as a spin.
 */
export const SPIN_MIN_MS = 40;
export const SPIN_MAX_MS = 240;
export const SPIN_MIN_STEPS = 12;

// The flashes still burning, so a second one can put the first out. WEAK, keyed by element: these
// sheets re-render under us, and a plain Map would hold on to every row ever lit for the life of
// the page.
const timers = new WeakMap();

/**
 * Light `el` up and let it fade.
 *
 * Re-flashing an element that is already lit restarts it, which is the case that matters: the
 * randomizer's whole job is being clicked again.
 *
 * @param {HTMLElement|null|undefined} el  The element to light. A missing one is a no-op, so the
 *                                         caller need not care whether its row is on screen.
 * @param {object}  [options]
 * @param {ParentNode} [options.scope]     Anything already lit INSIDE this is put out first, so a
 *                                         surface can guarantee only one flash at a time.
 * @param {string}  [options.className]
 * @param {number}  [options.duration]     Milliseconds. Must match the CSS animation.
 */
export function flashHighlight(el, { scope = null, className = FLASH_CLASS, duration = FLASH_MS } = {}) {
	if (!el?.classList) return;

	// Anything still burning in this scope goes out first — including `el` itself, which is what
	// arms the restart below.
	douseAll(scope, className);
	douse(el, className);

	// Read a layout property between off and on. Both writes land in one task otherwise, the
	// browser coalesces them into no change at all, and a second click on the same row leaves the
	// animation running where it already was instead of starting it over.
	void el.offsetWidth;

	el.classList.add(className);
	timers.set(el, setTimeout(() => {
		timers.delete(el);
		el.classList.remove(className);
	}, duration));
}

/**
 * Walk a light down `rows` and land it on `rows[target]`, slowing as it goes.
 *
 * The pick is already made before this starts — the walk is theatre over a decided answer, the
 * way a rolled die is. What it buys is a moment of attention on the list itself: the eye follows
 * the light past the entries the draw did NOT give, which is the reading of the list the GM was
 * never going to do on their own mid-sentence.
 *
 * The caller does not have to check whether a walk is worth making. A list of one, a target that
 * is not on the page, a row inside a folded section, a user who has asked for less motion — each
 * lands immediately with `done` already resolved, so a caller that awaits the walk before doing
 * the real work (posting the card) is never held up by an animation nobody can watch.
 *
 * @param   {ArrayLike<HTMLElement>} rows   The list to walk, in reading order. Walked in a loop.
 * @param   {number} target                 Index in `rows` to land on.
 * @param   {object} [options]
 * @param   {ParentNode} [options.scope]    Anything lit inside this is put out before the walk
 *                                          starts — the previous draw's flash, most of all.
 * @param   {string} [options.className]
 * @param   {number} [options.from]         Index to set off from; the first step lands on the one
 *                                          after it. Defaults to the top of the list.
 * @param   {number} [options.minMs]
 * @param   {number} [options.maxMs]
 * @param   {number} [options.minSteps]
 * @returns {{done: Promise<boolean>, cancel: () => void}}  `done` resolves true when the light
 *          lands (wearing NOTHING — the caller's flash takes over), false if it was cancelled.
 */
export function spinHighlight(rows, target, {
	scope = null,
	className = SPIN_CLASS,
	from = -1,
	minMs = SPIN_MIN_MS,
	maxMs = SPIN_MAX_MS,
	minSteps = SPIN_MIN_STEPS,
} = {}) {
	const list = [...(rows ?? [])];

	// The previous draw goes out as this one sets off, rather than being left to fade under a
	// light that is walking towards its replacement.
	douseAll(scope, FLASH_CLASS);
	douseAll(scope, className);

	if (list.length < 2 || !list[target]?.classList || !isVisible(list[target]) || prefersReducedMotion()) {
		return { done: Promise.resolve(true), cancel: () => {} };
	}

	const total = stepsFor(list.length, from, target, minSteps);
	let index = from >= 0 && from < list.length ? from : list.length - 1;
	let step = 0;
	let timer = null;
	let finished = false;
	let settle;
	const done = new Promise(resolve => { settle = resolve; });

	const stop = (landed) => {
		if (finished) return;
		finished = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
		// The landing row is handed over BARE: the caller puts its own flash on in the same task,
		// so the swap never paints a frame with nothing lit.
		list[index]?.classList.remove(className);
		settle(landed);
	};

	const tick = () => {
		list[index]?.classList.remove(className);
		index = (index + 1) % list.length;
		list[index].classList.add(className);
		if (++step >= total) return stop(true);
		timer = setTimeout(tick, minMs + (maxMs - minMs) * (step / total) ** 3);
	};

	// The first step is taken NOW, not on a timer: a die that waits 40ms before doing anything
	// reads as a click that missed.
	tick();
	return { done, cancel: () => stop(false) };
}

/**
 * One surface's walk, and the cancel token that lets a later click supersede it.
 *
 * The BEAT is the thing worth having in one place: cancel whatever is still running, walk the
 * light, wait for it to land, and only then flash the row it landed on. Every surface that draws
 * from a printed list wants exactly that order, and each one that wrote it out for itself wrote
 * the same five statements — so a fix to the order (or to what "superseded" means) reached one
 * caller and not the others.
 *
 * Hold ONE of these per list that can be drawn from. Two lights on one screen — the expedition's
 * fate table and the exploration rail beside it — are two tracks, so that a draw on one does not
 * cancel the other's walk; they are kept apart on screen by their `scope` for the same reason.
 *
 * NOT for a walk that lands on a lasting selection (WeatherDialog's picked row): that one holds
 * its answer instead of letting it fade, which is a different ending and deliberately not here.
 */
export class SpinTrack {
	/**
	 * Walk the light down `rows` onto `rows[target]` and flash it there.
	 *
	 * A target that is not in `rows` is not an error and makes no walk — the row may simply not be
	 * on the page. The caller still gets `true`, because whatever the walk was theatre FOR (the card
	 * it posts) must still happen.
	 *
	 * @param   {ArrayLike<HTMLElement>} rows  The list to walk, in reading order.
	 * @param   {number} target                Index in `rows` to land on.
	 * @param   {object} [options]             Passed through to `spinHighlight`; `scope` also bounds
	 *                                         the flash, so the landing is put out by the same
	 *                                         surface that douses the walk.
	 * @returns {Promise<boolean>}  false if a later click superseded this walk — the caller's cue to
	 *          post nothing. True when the light landed, and true when there was no walk to make.
	 */
	async landOn(rows, target, options = {}) {
		if (!rows?.[target]) return true;

		this._spin?.cancel();
		const spin = spinHighlight(rows, target, options);
		this._spin = spin;

		if (!await spin.done) return false;
		flashHighlight(rows[target], { scope: options.scope ?? null });
		return true;
	}

	/** Put out a walk still running — for a surface closing under one. */
	cancel() {
		this._spin?.cancel();
	}
}

/**
 * How many steps to walk, given where the light starts and where it has to end up.
 *
 * Always at least one full lap when the target is where the walk began, and topped up by whole
 * laps until it is long enough to read as a spin — laps, so it still lands on the target.
 */
function stepsFor(length, from, target, minSteps) {
	const start = from >= 0 && from < length ? from : length - 1;
	let steps = ((target - start) % length + length) % length || length;
	while (steps < minSteps) steps += length;
	return steps;
}

/** Take the class off now, and drop the timer that was going to. */
function douse(el, className) {
	const timer = timers.get(el);
	if (timer !== undefined) {
		clearTimeout(timer);
		timers.delete(el);
	}
	el.classList.remove(className);
}

/** Everything wearing `className` inside `scope`, put out. */
function douseAll(scope, className) {
	for (const lit of scope?.querySelectorAll?.(`.${className}`) ?? []) douse(lit, className);
}

/**
 * Is this element on the page at all? A folded section is `display: none` (stonetop.css
 * `.stonetop-section-folded`), which nulls `offsetParent` — and spinning a light down a list
 * nobody can see would do nothing but delay what the click was for.
 *
 * Reads as visible where there is no layout to ask (a test's stand-in element), which is the
 * right way round: the walk is what those callers are testing.
 */
function isVisible(el) {
	return el.offsetParent !== null;
}

/** Has this user asked for less motion? No `matchMedia` (a test, a headless run) means no. */
function prefersReducedMotion() {
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}
