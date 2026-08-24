import { describe, it, expect } from "vitest";
import {
	DRAWING_CLASS, PICKING_CLASS, pickPointOnImage, watchPointsOnImage,
} from "../../module/utils/pick-point-on-image.js";

// "Click where it goes", over a picture that may be zoomed, dragged, and covered in other people's
// click handlers.
//
// There is no jsdom in this project, so the DOM is a hand-rolled stand-in for exactly the surface
// this module touches: a listener registry, a class list, and a bounding rect. That is enough to
// pin the four things that would each fail silently in a browser — a placement landing at the end
// of a drag, a click reaching the destination picker underneath, a click in the letterbox around a
// fitted map being read as a spot, and a window closing with the gesture still armed.

/** One element, with the listener registry and the geometry the module asks for. */
function el(rect = { left: 0, top: 0, width: 200, height: 100 }) {
	const listeners = new Map();
	const classes = new Set();
	return {
		classList: {
			add: c => classes.add(c), remove: c => classes.delete(c),
			// `contains` is the DOM's own name and the one the module calls, which is how the
			// standing watch asks whether a one-shot pick has the picture. `has` is this fake's
			// own, for the assertions below.
			contains: c => classes.has(c),
			has: c => classes.has(c),
		},
		getBoundingClientRect: () => rect,
		addEventListener: (type, fn, opts) => {
			const entry = { fn, opts };
			listeners.set(type, [...(listeners.get(type) ?? []), entry]);
			// The module registers everything against one AbortController, which is how it takes
			// the global keydown listener back off. A fake that ignored that would report a
			// listener still live after the gesture ended and prove nothing.
			opts?.signal?.addEventListener?.("abort", () => {
				listeners.set(type, (listeners.get(type) ?? []).filter(e => e !== entry));
			});
		},
		removeEventListener: () => {},
		fire: (type, ev = {}) => {
			const seen = { prevented: 0, stopped: 0 };
			const full = {
				clientX: 0, clientY: 0,
				preventDefault: () => { seen.prevented++; },
				stopPropagation: () => { seen.stopped++; },
				...ev,
			};
			for (const { fn } of [...(listeners.get(type) ?? [])]) fn(full);
			return seen;
		},
		live: type => (listeners.get(type) ?? []).length,
	};
}

/** Arm the gesture on one element, with the global standing in for `window`. */
function arm({ measure = null, signal = null } = {}) {
	const listenOn = el();
	const keys = el();
	const previous = globalThis.addEventListener;
	globalThis.addEventListener = keys.addEventListener;
	const promise = pickPointOnImage({ listenOn, measure: measure ?? listenOn, signal });
	globalThis.addEventListener = previous;
	return { listenOn, keys, promise };
}

/** Press and release at one point, with no travel in between: a click. */
function clickAt(listenOn, x, y) {
	listenOn.fire("pointerdown", { clientX: x, clientY: y });
	return listenOn.fire("click", { clientX: x, clientY: y });
}

describe("waiting for a click on a picture", () => {
	it("answers where the click landed, as a percentage of the measured box", async () => {
		const { listenOn, promise } = arm();
		clickAt(listenOn, 50, 25);
		expect(await promise).toEqual({ left: 25, top: 25 });
	});

	// The box measured is not always the box listened on: over a zoomable map the events arrive at
	// the VIEWPORT (a pan captures the pointer there) while the picture is the overlay inside it,
	// wherever the reader has dragged it to.
	it("measures the box it was given, not the one the events arrived at", async () => {
		const picture = el({ left: 100, top: 40, width: 400, height: 200 });
		const { listenOn, promise } = arm({ measure: picture });
		clickAt(listenOn, 300, 140);
		expect(await promise).toEqual({ left: 50, top: 50 });
	});

	// The map already has delegated handlers above it: the walkthrough's "pick this place as the
	// destination", and the popout's own hotspot delegate. A placement that reached either would
	// also change where the party is bound.
	it("swallows the click so nothing above it also acts", async () => {
		const { listenOn, promise } = arm();
		listenOn.fire("pointerdown", { clientX: 50, clientY: 25 });
		const seen = listenOn.fire("click", { clientX: 50, clientY: 25 });
		expect(seen.stopped).toBe(1);
		expect(seen.prevented).toBe(1);
		await promise;
	});

	// The popout pans on a left-drag, and a pan ends in a click. Placing at the end of every drag
	// would make the map unbrowsable exactly while the reader is hunting for the spot.
	it("ignores the click that ends a drag, and stays armed", async () => {
		const { listenOn, promise } = arm();
		listenOn.fire("pointerdown", { clientX: 20, clientY: 20 });
		listenOn.fire("click", { clientX: 120, clientY: 60 });
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(true);
		// Still waiting, so the next real click is the one that answers.
		clickAt(listenOn, 50, 25);
		expect(await promise).toEqual({ left: 25, top: 25 });
	});

	// A few pixels of travel is a hand on a mouse, not a drag.
	it("allows a click that wobbled", async () => {
		const { listenOn, promise } = arm();
		listenOn.fire("pointerdown", { clientX: 50, clientY: 25 });
		listenOn.fire("click", { clientX: 52, clientY: 26 });
		expect(await promise).toEqual({ left: 26, top: 26 });
	});

	// The letterboxing around a fitted map in the popout, and the strip an edge pin's label hangs
	// into. Not a spot, and not a cancellation either.
	it("ignores a click outside the picture and keeps waiting", async () => {
		const picture = el({ left: 100, top: 40, width: 400, height: 200 });
		const { listenOn, promise } = arm({ measure: picture });
		clickAt(listenOn, 20, 20);
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(true);
		clickAt(listenOn, 300, 140);
		expect(await promise).toEqual({ left: 50, top: 50 });
	});
});

describe("backing out", () => {
	it("takes Escape as a no, without letting it close the dialog behind it", async () => {
		const { listenOn, keys, promise } = arm();
		const seen = keys.fire("keydown", { key: "Escape" });
		expect(await promise).toBeNull();
		expect(seen.prevented).toBe(1);
		expect(seen.stopped).toBe(1);
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(false);
	});

	it("ignores every other key", async () => {
		const { keys, promise } = arm();
		keys.fire("keydown", { key: "a" });
		let settled = false;
		promise.then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		keys.fire("keydown", { key: "Escape" });
		expect(await promise).toBeNull();
	});

	it("takes a right-click as a no, and eats the context menu", async () => {
		const { listenOn, promise } = arm();
		const seen = listenOn.fire("contextmenu", {});
		expect(await promise).toBeNull();
		expect(seen.prevented).toBe(1);
	});

	// What a window closing mid-gesture uses. Without it the caller awaits a promise that can
	// never settle, and the keydown listener outlives the picture it was watching for.
	it("settles and lets go when the wait is aborted from outside", async () => {
		const off = new AbortController();
		const { listenOn, keys, promise } = arm({ signal: off.signal });
		expect(keys.live("keydown")).toBe(1);
		off.abort();
		expect(await promise).toBeNull();
		expect(keys.live("keydown")).toBe(0);
		expect(listenOn.live("click")).toBe(0);
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(false);
	});

	it("never arms at all against a signal that is already spent", async () => {
		const off = new AbortController();
		off.abort();
		const { listenOn, promise } = arm({ signal: off.signal });
		expect(await promise).toBeNull();
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(false);
	});

	// A caller with no picture to click on. The route step draws no map until the GM has imported
	// the book art, so this is the ordinary state of a fresh world rather than a mistake.
	it("answers null with nothing to listen on", async () => {
		expect(await pickPointOnImage({})).toBeNull();
	});
});

describe("once it has answered", () => {
	it("lets every listener go, including the one on the global", async () => {
		const { listenOn, keys, promise } = arm();
		clickAt(listenOn, 50, 25);
		await promise;
		expect(listenOn.live("click")).toBe(0);
		expect(listenOn.live("pointerdown")).toBe(0);
		expect(listenOn.live("contextmenu")).toBe(0);
		expect(keys.live("keydown")).toBe(0);
		expect(listenOn.classList.has(PICKING_CLASS)).toBe(false);
	});
});

// ── Staying armed: laying out a route by hand ────────────────────────────────
//
// The one-shot gesture above is the right shape for "this site stands there". Drawing a way is not
// one answer but a run of them, each judged against the line the last one made — so this stays
// armed, reports rather than resolves, and gives the right-click a different meaning: take the
// last mark back, rather than give up.

/** Arm the standing watch, and collect what it reports. */
function watch(over = {}) {
	const listenOn = el();
	const points = [];
	const undos = [];
	const stop = watchPointsOnImage({
		listenOn,
		onPoint: (at, ev) => points.push({ ...at, shift: !!ev.shiftKey }),
		onUndo: () => undos.push(true),
		...over,
	});
	return { listenOn, points, undos, stop };
}

describe("watching a picture for as many clicks as it takes", () => {
	it("reports every click, not just the first", () => {
		const { listenOn, points } = watch();
		clickAt(listenOn, 50, 25);
		clickAt(listenOn, 100, 50);
		expect(points).toEqual([{ left: 25, top: 25, shift: false }, { left: 50, top: 50, shift: false }]);
	});

	// The modifier is half of what the click said — move the far end, or add a leg — and this
	// module has no business deciding which, so the event goes back up with the position.
	it("hands the modifier back with the position", () => {
		const { listenOn, points } = watch();
		listenOn.fire("pointerdown", { clientX: 50, clientY: 25 });
		listenOn.fire("click", { clientX: 50, clientY: 25, shiftKey: true });
		expect(points[0].shift).toBe(true);
	});

	it("takes the last mark back on a right-click, and stays armed", () => {
		const { listenOn, points, undos } = watch();
		listenOn.fire("contextmenu", { clientX: 10, clientY: 10 });
		clickAt(listenOn, 50, 25);
		expect(undos).toEqual([true]);
		expect(points).toHaveLength(1);
	});

	// Swallowed whether or not there was anything to undo, so the browser's own menu never opens
	// over a map the reader is drawing on.
	it("swallows the right-click either way", () => {
		const { listenOn } = watch();
		const seen = listenOn.fire("contextmenu", { clientX: 10, clientY: 10 });
		expect(seen.prevented).toBe(1);
		expect(seen.stopped).toBe(1);
	});

	// The popout pans on a left-drag, and a pan ends in a click. Laying a mark at the end of every
	// drag would make the map unusable exactly when the reader is hunting for the right valley.
	it("ignores the click at the end of a pan", () => {
		const { listenOn, points } = watch();
		listenOn.fire("pointerdown", { clientX: 20, clientY: 20 });
		listenOn.fire("click", { clientX: 120, clientY: 20 });
		expect(points).toEqual([]);
	});

	// The letterboxing around a fitted map, or the strip an edge pin's label hangs into. Not a
	// spot — and the click has to go on meaning whatever it meant before the mode came on.
	it("leaves a click outside the picture alone", () => {
		const { listenOn, points } = watch();
		const seen = clickAt(listenOn, 400, 25);
		expect(points).toEqual([]);
		expect(seen.stopped).toBe(0);
	});

	// The marks on these maps already mean things: a place pin chooses that place, a site pin opens
	// its write-up. Swallowing those would kill every control on the picture the moment the mode
	// came on.
	it("leaves the pins their own clicks", () => {
		const { listenOn, points } = watch({ ignore: "[data-slug]" });
		const pin = { closest: sel => (sel === "[data-slug]" ? {} : null) };
		listenOn.fire("pointerdown", { clientX: 50, clientY: 25 });
		const seen = listenOn.fire("click", { clientX: 50, clientY: 25, target: pin });
		expect(points).toEqual([]);
		expect(seen.stopped).toBe(0);
	});

	// A site pin lifts back off the map with a right-click, which is a meaning it had first.
	it("leaves a right-click alone where a mark claims it", () => {
		const { listenOn, undos } = watch({ undoIgnore: "[data-site-uuid]" });
		const pin = { closest: sel => (sel === "[data-site-uuid]" ? {} : null) };
		listenOn.fire("contextmenu", { clientX: 50, clientY: 25, target: pin });
		expect(undos).toEqual([]);
	});

	// A one-shot placement is armed over this same picture and owns the next click outright: the
	// GM pressed "put a site on the map" in the middle of drawing, and that click is the site's.
	it("stands down while a one-shot pick is armed over the same picture", () => {
		const { listenOn, points, undos } = watch();
		listenOn.classList.add(PICKING_CLASS);
		clickAt(listenOn, 50, 25);
		listenOn.fire("contextmenu", { clientX: 50, clientY: 25 });
		expect(points).toEqual([]);
		expect(undos).toEqual([]);

		// And has its picture back once that gesture is over.
		listenOn.classList.remove(PICKING_CLASS);
		clickAt(listenOn, 50, 25);
		expect(points).toHaveLength(1);
	});

	it("wears the crosshair while it is armed, and takes it off when it stops", () => {
		const { listenOn, stop } = watch();
		expect(listenOn.classList.has(DRAWING_CLASS)).toBe(true);
		stop();
		expect(listenOn.classList.has(DRAWING_CLASS)).toBe(false);
	});

	// A watch can be armed over a picture that is not being drawn on yet: the expedition's route
	// step listens for the shift-click that would START a way, and a plain click there still means
	// what it always meant. A cursor promising that every click lands a point would be lying.
	it("goes bare-headed when the caller asks it to", () => {
		const { listenOn, points } = watch({ crosshair: false });
		expect(listenOn.classList.has(DRAWING_CLASS)).toBe(false);
		// Still watching, though — the cursor is the only thing that changed.
		clickAt(listenOn, 50, 25);
		expect(points).toHaveLength(1);
	});

	// Its listeners are on markup that goes with the next render, and it holds a class on one of
	// those nodes. Left alone it would swallow clicks on a picture nobody can see.
	it("reports nothing once it has been stopped", () => {
		const { listenOn, points, stop } = watch();
		stop();
		clickAt(listenOn, 50, 25);
		expect(points).toEqual([]);
		expect(listenOn.live("click")).toBe(0);
	});

	it("stops when the caller's signal is aborted, and is safe to stop twice", () => {
		const off = new AbortController();
		const { listenOn, points, stop } = watch({ signal: off.signal });
		off.abort();
		clickAt(listenOn, 50, 25);
		expect(points).toEqual([]);
		expect(() => stop()).not.toThrow();
	});

	it("is a no-op with nothing to listen on", () => {
		expect(() => watchPointsOnImage({ listenOn: null })()).not.toThrow();
	});
});
