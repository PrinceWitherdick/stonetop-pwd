import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZoomPanSurface } from "../../module/utils/zoom-pan-surface.js";

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

		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800,
		}).attach();
	});

	afterEach(() => {
		surface?.destroy();
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
