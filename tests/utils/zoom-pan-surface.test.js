import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZoomPanSurface } from "../../module/utils/zoom-pan-surface.js";
import { ZOOM_STEP } from "../../module/utils/image-zoom.js";

// PAN COALESCING, and only that. The arithmetic this class does is utils/image-zoom.js's and is
// tested there; what is measured here is the one thing that is this file's own — that a pan reaches
// `apply` once per PAINTED FRAME rather than once per pointer event.
//
// WHY IT IS WORTH A TEST OF ITS OWN. A 125Hz mouse delivers roughly twice as many pointermoves as
// the browser paints, and every surplus one costs the whole `onChange` chain hanging off `apply` —
// on the relationship map that is a board query and a class sweep, on a board this feature has a
// measured raster budget for. The batching is invisible: dropped, everything still WORKS, just at
// twice the cost. So the assertions count calls rather than checking the board ends up in the right
// place, which the offset arithmetic already covers.

/** The smallest element a surface will attach to: listeners it can record, and a style bag. */
function fakeEl({ w = 400, h = 300 } = {}) {
	const listeners = new Map();
	return {
		style: {},
		clientWidth: w,
		clientHeight: h,
		classList: { add() {}, remove() {} },
		setPointerCapture() {},
		releasePointerCapture() {},
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type) { listeners.delete(type); },
		closest: () => null,
		emit(type, ev = {}) { listeners.get(type)?.({ preventDefault() {}, ...ev }); },
		has: type => listeners.has(type),
	};
}

describe("ZoomPanSurface pan batching", () => {
	let frames;
	let surface;
	let view;

	beforeEach(() => {
		frames = [];
		// A QUEUE rather than an inline call, for the reason tests/fakes/pointer-board.js gives: a
		// requestAnimationFrame that ran its callback at once would make every pointermove paint
		// synchronously, and a test written against that would pass over a rewrite that dropped the
		// batching entirely.
		globalThis.requestAnimationFrame = fn => frames.push(fn);
		globalThis.cancelAnimationFrame = id => { frames[id - 1] = null; };

		// A CLOCK THAT LEAPS, so that none of these presses reads as a THROW. Every event here
		// arrives in the same microsecond of real time, which on the true clock is a hand moving at
		// several hundred pixels per millisecond, and the release would fling the board and paint
		// frames of its own on top of the ones being counted. A second between events makes every
		// drag below a slow, deliberate placement, which is what these tests are about. The glide
		// has its own describe at the bottom of the file.
		let clock = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => (clock += 1000));

		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800,
		}).attach();
	});

	afterEach(() => {
		surface?.destroy();
		vi.restoreAllMocks();
		delete globalThis.requestAnimationFrame;
		delete globalThis.cancelAnimationFrame;
	});

	/** Run every frame the surface has asked for, as the browser would. */
	const paint = () => {
		const pending = frames.splice(0, frames.length);
		for (const fn of pending) fn?.();
	};

	const pan = (moves) => {
		view.emit("pointerdown", { pointerId: 1, button: 0, clientX: 0, clientY: 0, target: view });
		for (const [x, y] of moves) {
			view.emit("pointermove", { pointerId: 1, clientX: x, clientY: y });
		}
	};

	it("paints once for a burst of pointer moves, not once each", () => {
		const apply = vi.spyOn(surface, "apply");
		pan([[10, 0], [20, 0], [30, 0], [40, 0], [50, 0]]);

		// Nothing painted yet: five moves have asked for ONE frame between them.
		expect(apply).not.toHaveBeenCalled();
		expect(frames.filter(Boolean)).toHaveLength(1);

		paint();
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("paints the LAST position of the burst, not the first", () => {
		pan([[10, 0], [90, 0]]);
		paint();
		expect(surface.offset.x).toBe(surface._pan.offsetX + 90);
	});

	it("asks for a new frame once the pending one has been painted", () => {
		pan([[10, 0]]);
		paint();
		view.emit("pointermove", { pointerId: 1, clientX: 20, clientY: 0 });
		expect(frames.filter(Boolean)).toHaveLength(1);
	});

	it("paints where the pointer was let go rather than leaving a frame owing", () => {
		const apply = vi.spyOn(surface, "apply");
		pan([[10, 0], [70, 0]]);
		const from = surface._pan.offsetX;
		view.emit("pointerup", { pointerId: 1 });

		// Painted at once on release, and the queued frame dropped, so the board cannot be left a
		// few pixels behind where the reader let it go.
		expect(apply).toHaveBeenCalledTimes(1);
		expect(surface.offset.x).toBe(from + 70);
		paint();
		expect(apply).toHaveBeenCalledTimes(1);
	});

	it("does not paint on a frame that arrives after the surface is torn down", () => {
		pan([[10, 0]]);
		const apply = vi.spyOn(surface, "apply");
		surface.destroy();
		paint();
		expect(apply).not.toHaveBeenCalled();
	});

	it("paints synchronously where the host has no requestAnimationFrame to schedule against", () => {
		delete globalThis.requestAnimationFrame;
		const apply = vi.spyOn(surface, "apply");
		pan([[10, 0]]);
		expect(apply).toHaveBeenCalledTimes(1);
	});
});

// THE WHEEL. The zoom arithmetic is utils/image-zoom.js's and is tested there; what is measured
// here is that this surface hands it the two things a reader can feel -- HOW MUCH of a notch the
// event was, rather than merely which way it pointed, and the step the CALLER asked for rather than
// the flowchart default. Both are invisible when they break: the board still zooms, just in leaps
// past whatever size the reader was aiming for.
describe("ZoomPanSurface wheel", () => {
	let view;

	/** A surface over a 400x300 window, fitted, with an optional step of its own. */
	const surfaceWith = (zoomStep = 0) => {
		view = fakeEl();
		return new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800, zoomStep,
		}).attach();
	};

	const wheel = (surface, ev) => {
		const from = surface.scale;
		view.emit("wheel", { clientX: 0, clientY: 0, deltaY: 0, deltaMode: 0, ...ev });
		return surface.scale / from;
	};

	it("zooms a gentler step where the caller asked for one", () => {
		const gentle = surfaceWith(1.08);
		expect(wheel(gentle, { deltaY: -100 })).toBeCloseTo(1.08, 10);
		gentle.destroy();

		const plain = surfaceWith();
		expect(wheel(plain, { deltaY: -100 })).toBeCloseTo(ZOOM_STEP, 10);
		plain.destroy();
	});

	// The trackpad. Ten of these used to be ten whole steps.
	it("zooms a fraction of a step for a fraction of a notch", () => {
		const surface = surfaceWith(1.08);
		const moved = wheel(surface, { deltaY: -10 });
		expect(moved).toBeGreaterThan(1);
		expect(moved).toBeCloseTo(1.08 ** 0.1, 10);
		surface.destroy();
	});

	it("leaves the board alone when the wheel reports no travel", () => {
		const surface = surfaceWith(1.08);
		expect(wheel(surface, { deltaY: 0 })).toBe(1);
		surface.destroy();
	});
});

// THE RIGHT BUTTON, which exists because the left one is not enough (user, 2026-09-06). A left press
// steps aside for every control on the board, and on the relationship map the controls are lines
// laid clear across the diagram: aim at open paper, land a few pixels onto a stroke, and the board
// will not move at all. What is measured here is the pair of rules that fixes it -- a right press
// pans from a control, and it does not pan from a `menus` child -- plus the browser menu being held
// shut, since a right-drag that opened a menu over the board on every press would be no better.
describe("ZoomPanSurface right-drag", () => {
	let view;
	let surface;

	/**
	 * A press target that answers `closest` for the selectors it was given.
	 *
	 * The surface hands `closest` a whole list at a time, so the fake asks whether the list names
	 * this element rather than whether it equals it -- which is what a browser would answer, and
	 * what lets one element be a control AND a menu, as the tie bar on the real board is.
	 */
	const on = (...selectors) =>
		({ closest: sel => (selectors.some(s => sel.includes(s)) ? {} : null) });

	/** A press, with a `preventDefault` that can be asked whether it was called. */
	const press = (type, ev) => {
		const prevented = vi.fn();
		view.emit(type, { pointerId: 1, clientX: 0, clientY: 0, preventDefault: prevented, ...ev });
		return prevented;
	};

	beforeEach(() => {
		globalThis.requestAnimationFrame = () => 1;
		globalThis.cancelAnimationFrame = () => {};
		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800,
			// The menu child is a control as well, which is how the real board has it: the tie bar
			// is named in both lists, and only the second of them is what makes it keep its menu.
			controls: ".control, .menu", menus: ".menu",
		}).attach();
	});

	afterEach(() => {
		surface?.destroy();
		delete globalThis.requestAnimationFrame;
		delete globalThis.cancelAnimationFrame;
	});

	it("pans from a control that a left press would have left alone", () => {
		press("pointerdown", { button: 0, buttons: 1, target: on(".control") });
		expect(surface._pan).toBeNull();

		press("pointerdown", { button: 2, buttons: 2, target: on(".control") });
		expect(surface._pan).not.toBeNull();
	});

	it("moves the board on a right drag as a left one does", () => {
		press("pointerdown", { button: 2, buttons: 2, target: on(".control") });
		const from = surface._pan.offsetX;
		view.emit("pointermove", { pointerId: 1, clientX: 60, clientY: 0 });
		view.emit("pointerup", { pointerId: 1 });
		expect(surface.offset.x).toBe(from + 60);
	});

	it("leaves the chrome standing over the board alone, on either button", () => {
		press("pointerdown", { button: 0, buttons: 1, target: on(".menu") });
		expect(surface._pan).toBeNull();
		press("pointerdown", { button: 2, buttons: 2, target: on(".menu") });
		expect(surface._pan).toBeNull();
	});

	it("shuts the browser's menu over the board and opens it on a menu child", () => {
		expect(press("contextmenu", { target: on(".control") })).toHaveBeenCalled();
		expect(press("contextmenu", { target: on(".menu") })).not.toHaveBeenCalled();
	});

	it("refuses a right press made while another button is already down", () => {
		// A portrait mid-drag under the left button: panning the board out from under it would
		// leave the two gestures fighting over the one pointer.
		press("pointerdown", { button: 2, buttons: 3, target: on() });
		expect(surface._pan).toBeNull();
	});

	it("does not restart a pan already under way", () => {
		press("pointerdown", { button: 2, buttons: 2, clientX: 40, target: on() });
		// A second finger arriving mid-pan is a different pointer with a button count of its own,
		// so the guard above cannot catch it: the pan already running has to.
		press("pointerdown", { pointerId: 2, button: 0, buttons: 1, clientX: 90, target: on() });
		expect(surface._pan.id).toBe(1);
		expect(surface._pan.x).toBe(40);
	});
});

// THE GLIDE (user, 2026-09-06: "it slides a bit depending on velocity"). The curve itself is
// tests/utils/pan-glide.test.js's; what is measured here is everything the curve is wired to. Which
// releases throw and which do not, what stops a board that is already sliding, and the click that
// stopping it costs.
//
// EVERY ONE OF THESE IS A GESTURE THAT LOOKS FINE UNTIL IT ISN'T. A board that flings on a careful
// placement, one that cannot be caught, one that opens a portrait for whoever was sailing past when
// the reader reached out to stop it: none of them throws, none of them shows up in a screenshot,
// and all three make the map feel broken in a way nobody can quite name.
describe("ZoomPanSurface glide", () => {
	let view;
	let surface;
	let clock;
	let frames;
	let nextFrame;

	/**
	 * Frames by ID, rather than the array the batching tests use.
	 *
	 * A glide asks for its next frame from inside the one being run, so the queue is written to
	 * while it is being drained. Ids in a Map survive that; indices into a spliced array do not,
	 * and a cancel against a stale index would silently kill somebody else's frame.
	 */
	const paint = (ms = 16) => {
		clock += ms;
		const due = [...frames.values()];
		frames.clear();
		for (const fn of due) fn();
	};

	/** A drag of `steps` even hops, each `dx`/`dy` pixels `ms` apart. Returns where it ended. */
	const drag = (steps, { dx = 8, dy = 0, ms = 16 } = {}) => {
		let x = 0;
		let y = 0;
		view.emit("pointerdown", { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, target: view });
		for (let i = 0; i < steps; i++) {
			clock += ms;
			x += dx;
			y += dy;
			view.emit("pointermove", { pointerId: 1, clientX: x, clientY: y });
		}
		return { x, y };
	};

	/** Let go, optionally after holding still for a while first. */
	const release = (at, { after = 0, type = "pointerup" } = {}) => {
		clock += after;
		view.emit(type, { pointerId: 1, type, clientX: at.x, clientY: at.y });
	};

	beforeEach(() => {
		clock = 0;
		frames = new Map();
		nextFrame = 0;
		globalThis.requestAnimationFrame = (fn) => { frames.set(++nextFrame, fn); return nextFrame; };
		globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock);

		view = fakeEl();
		surface = new ZoomPanSurface({
			// A control, so that the press which catches the board can be one that is not allowed
			// to pan it. See "is caught by a press" below.
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800, controls: ".control",
		}).attach();
	});

	afterEach(() => {
		surface?.destroy();
		vi.restoreAllMocks();
		delete globalThis.requestAnimationFrame;
		delete globalThis.cancelAnimationFrame;
		delete globalThis.matchMedia;
	});

	it("keeps the board moving after the pointer has gone, by less each frame", () => {
		release(drag(5));
		const seen = [surface.offset.x];
		for (let i = 0; i < 3; i++) {
			paint();
			seen.push(surface.offset.x);
		}
		const steps = seen.slice(1).map((x, i) => x - seen[i]);
		expect(steps[0]).toBeGreaterThan(0);
		expect(steps[1]).toBeLessThan(steps[0]);
		expect(steps[2]).toBeLessThan(steps[1]);
	});

	it("settles, rather than drifting on for ever", () => {
		release(drag(5));
		let painted = 0;
		while (frames.size && painted < 500) {
			paint();
			painted += 1;
		}
		// Under two seconds of frames, and stopped of its own accord rather than by running out of
		// patience: a glide that never ends is a board that cannot be read.
		expect(painted).toBeLessThan(120);
		expect(frames.size).toBe(0);
	});

	it("throws nothing when the reader held still before letting go", () => {
		// The gesture the whole velocity window exists for: hauled across at speed, stopped to look,
		// released. A board that flings here is a board that punishes the careful reader.
		release(drag(5, { dx: 40 }), { after: 250 });
		const settled = surface.offset.x;
		expect(frames.size).toBe(0);
		paint();
		expect(surface.offset.x).toBe(settled);
	});

	it("throws nothing on a gesture the platform took away", () => {
		const at = drag(5, { dx: 40 });
		release(at, { type: "pointercancel" });
		expect(frames.size).toBe(0);
	});

	it("stops where it was let go for a reader who asked for less motion", () => {
		globalThis.matchMedia = q => ({ matches: q.includes("reduce") });
		release(drag(5, { dx: 40 }));
		expect(frames.size).toBe(0);
	});

	it("is caught by a press, wherever on the board that press lands", () => {
		release(drag(5));
		paint();
		const caughtAt = surface.offset.x;
		// ON A CONTROL, which is the press a left drag refuses to pan from. Catching a board is not
		// panning it, and a slide that could only be stopped by finding a patch of bare paper on a
		// map webbed with lines would be a board that ignores the reader.
		view.emit("pointerdown", {
			pointerId: 2, button: 0, buttons: 1, clientX: 0, clientY: 0,
			target: { closest: sel => (sel.includes(".control") ? {} : null) },
		});
		expect(surface._pan).toBeNull();
		expect(frames.size).toBe(0);
		paint();
		expect(surface.offset.x).toBe(caughtAt);
	});

	it("takes the click away from the press that caught it, and only that one", () => {
		release(drag(5));
		paint();
		view.emit("pointerdown", { pointerId: 2, button: 0, buttons: 1, clientX: 0, clientY: 0, target: view });
		const caught = vi.fn();
		view.emit("click", { stopImmediatePropagation: caught });
		expect(caught).toHaveBeenCalled();

		// The next click is nobody's business but the board's: a reader who has stopped the slide
		// and then clicks a portrait opens that portrait.
		const after = vi.fn();
		view.emit("click", { stopImmediatePropagation: after });
		expect(after).not.toHaveBeenCalled();
	});

	it("leaves the click alone after a press on a board that was not moving", () => {
		view.emit("pointerdown", { pointerId: 1, button: 0, buttons: 1, clientX: 0, clientY: 0, target: view });
		const untouched = vi.fn();
		view.emit("click", { stopImmediatePropagation: untouched });
		expect(untouched).not.toHaveBeenCalled();
	});

	// ⚠ A RIGHT PRESS STOPS THE BOARD AND TAKES NO CLICK FOR IT, because it derives none: what a
	// right press derives is the `contextmenu` this surface shuts. Armed anyway, the flag was left
	// standing with nothing coming to spend it on, and the next click to arrive without a press of
	// its own in front of it -- which is what a portrait or a button reached by the KEYBOARD is --
	// was eaten in its place: a dead press on a face, a line, or "Add someone".
	it("catches a sliding board on a right press without taking a click for it", () => {
		release(drag(5));
		paint();
		const caughtAt = surface.offset.x;
		view.emit("pointerdown", {
			pointerId: 2, button: 2, buttons: 2, clientX: 0, clientY: 0, target: view,
		});
		expect(frames.size).toBe(0);
		paint();
		expect(surface.offset.x).toBe(caughtAt);

		const untouched = vi.fn();
		view.emit("click", { stopImmediatePropagation: untouched });
		expect(untouched).not.toHaveBeenCalled();
	});

	// ⚠ THE ANSWER THE CLICK SWALLOW CANNOT GIVE. The flag above speaks for the left button only,
	// because only a left press derives the click it is spent on -- but "this press meant stop and
	// nothing else" is true of every button, and utils/relmap-drag.js reads a RIGHT press that
	// stayed put as the reader pointing at a portrait. A right press made to catch a board stayed
	// put by definition, on whichever portrait was gliding under the cursor at the time, so without
	// this a delete button appears on somebody the reader never aimed at.
	it("says a press caught the board whichever button made it", () => {
		release(drag(5));
		paint();
		view.emit("pointerdown", { pointerId: 2, button: 2, buttons: 2, clientX: 0, clientY: 0, target: view });
		expect(surface.caughtGlide).toBe(true);
	});

	it("says a press on a still board caught nothing, and clears the last one that did", () => {
		release(drag(5));
		paint();
		view.emit("pointerdown", { pointerId: 2, button: 2, buttons: 2, clientX: 0, clientY: 0, target: view });
		expect(surface.caughtGlide).toBe(true);
		// The board is standing still now, so the next press catches nothing -- and the answer is
		// about THIS press, not about any press ever having caught anything.
		view.emit("pointerup", { pointerId: 2, type: "pointerup", clientX: 0, clientY: 0 });
		view.emit("pointerdown", { pointerId: 3, button: 2, buttons: 2, clientX: 0, clientY: 0, target: view });
		expect(surface.caughtGlide).toBe(false);
	});

	// ⚠ A CANCELLED PRESS DERIVES NO CLICK, so the flag it armed has nothing coming to spend it on
	// and would sit waiting -- and the next click to arrive with no press in front of it is a
	// KEYBOARD activation of a portrait or a swatch. Not cleared on the ordinary `pointerup`, which
	// is followed by the very click the flag exists for.
	it("drops a caught press the platform took away, rather than leaving it armed", () => {
		release(drag(5));
		paint();
		view.emit("pointerdown", {
			pointerId: 2, button: 0, buttons: 1, clientX: 0, clientY: 0,
			// On a control, so the press was never a pan: `_onPanEnd` returns at its first line for
			// it, which is why the clearing cannot live there.
			target: { closest: sel => (sel.includes(".control") ? {} : null) },
		});
		view.emit("pointercancel", { pointerId: 2, type: "pointercancel", clientX: 0, clientY: 0 });
		expect(surface.caughtGlide).toBe(false);

		const untouched = vi.fn();
		view.emit("click", { stopImmediatePropagation: untouched });
		expect(untouched).not.toHaveBeenCalled();
	});

	it("still takes the click from a caught press that was let go of normally", () => {
		release(drag(5));
		paint();
		view.emit("pointerdown", { pointerId: 2, button: 0, buttons: 1, clientX: 0, clientY: 0, target: view });
		view.emit("pointerup", { pointerId: 2, type: "pointerup", clientX: 0, clientY: 0 });
		const caught = vi.fn();
		view.emit("click", { stopImmediatePropagation: caught });
		expect(caught).toHaveBeenCalled();
	});

	it("gives up the axis that has run out of board, and keeps the other", () => {
		// Hurled right, hard enough that the drag itself has already pinned the board at the end of
		// its travel, and gently downwards at the same time.
		release(drag(6, { dx: 100, dy: 6 }));
		const wall = surface.offset.x;
		const from = surface.offset.y;
		paint();
		const first = surface.offset.y;
		paint();

		expect(surface.offset.x).toBe(wall);
		expect(first).toBeGreaterThan(from);
		expect(surface.offset.y).toBeGreaterThan(first);
	});

	it("drops the slide when the reader takes hold of the board another way", () => {
		release(drag(5));
		surface._onWheel({ deltaY: -100, preventDefault() {}, clientX: 0, clientY: 0 });
		expect(frames.size).toBe(0);

		release(drag(5));
		surface.fit();
		expect(frames.size).toBe(0);
	});

	it("paints no frame of a glide that outlived its surface", () => {
		release(drag(5));
		const apply = vi.spyOn(surface, "apply");
		surface.destroy();
		paint();
		expect(apply).not.toHaveBeenCalled();
	});
});
