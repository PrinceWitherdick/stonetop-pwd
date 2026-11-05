import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	RELMAP_REACH_MAX, RELMAP_REACH_MIN, boardBounds, clampReach, holdTravel,
} from "../../module/utils/relmap-geometry.js";
import { ZoomPanSurface } from "../../module/utils/zoom-pan-surface.js";

// THE SHEET IS NOT A WALL (user, 2026-09-27: "The relationship maps have invisible bounds. So trying
// to move characters around is frustrating when I run out of space for no reason"). A portrait may be
// put down off the sheet; the board frames whoever is on it; and the one limit left is a rail far out
// that nobody arranging people will meet.

describe("where a person may stand", () => {
	it("keeps a coordinate off the sheet where it was put", () => {
		expect(clampReach(140)).toBe(140);
		expect(clampReach(-35.5555)).toBe(-35.56);
	});

	it("holds a coordinate past reach to the rail", () => {
		expect(clampReach(RELMAP_REACH_MAX + 1)).toBe(RELMAP_REACH_MAX);
		expect(clampReach(RELMAP_REACH_MIN - 1)).toBe(RELMAP_REACH_MIN);
	});

	// ⚠ THE `Number(null) === 0` TRAP, which reads "never set" as one particular corner.
	it("answers the middle for anything that is not a number", () => {
		for (const bad of [NaN, null, undefined, "", "x", Infinity]) expect(clampReach(bad)).toBe(50);
	});

	// The rail is well past the sheet on every side: the sheet runs 0 to 100.
	it("puts the rail a long way off the sheet", () => {
		expect(RELMAP_REACH_MIN).toBeLessThanOrEqual(-100);
		expect(RELMAP_REACH_MAX).toBeGreaterThanOrEqual(200);
	});
});

describe("holding a travel at the rail", () => {
	it("leaves a travel that stays inside reach alone", () => {
		expect(holdTravel({ left: 5, top: -3 }, [{ left: 10, top: 10 }])).toEqual({ left: 5, top: -3 });
	});

	it("shortens a travel that would carry somebody past it", () => {
		expect(holdTravel({ left: 50, top: 0 }, [{ left: RELMAP_REACH_MAX - 10, top: 0 }]))
			.toEqual({ left: 10, top: 0 });
		expect(holdTravel({ left: 0, top: -50 }, [{ left: 0, top: RELMAP_REACH_MIN + 5 }]))
			.toEqual({ left: 0, top: -5 });
	});

	// AS A UNIT: whoever is nearest the rail decides how far the whole group goes.
	it("holds a group by whoever is nearest the rail", () => {
		const from = [{ left: RELMAP_REACH_MAX - 10, top: 0 }, { left: RELMAP_REACH_MAX - 40, top: 0 }];
		expect(holdTravel({ left: 30, top: 0 }, from)).toEqual({ left: 10, top: 0 });
	});

	it("holds nothing for nobody", () => {
		expect(holdTravel({ left: 9999, top: 1 }, [])).toEqual({ left: 9999, top: 1 });
	});
});

describe("the part of the board with anything on it", () => {
	const sheet = { width: 1200, height: 960 };

	// ⚠ THE SHEET IS ALWAYS INSIDE IT: every seat the board picks for itself is on the sheet.
	it("is the sheet when everybody is on it", () => {
		expect(boardBounds([{ x: 50, y: 50 }], sheet)).toEqual({ left: 0, top: 0, right: 1200, bottom: 960 });
		expect(boardBounds([], sheet)).toEqual({ left: 0, top: 0, right: 1200, bottom: 960 });
	});

	it("grows to take in somebody standing off the sheet, face, name and all", () => {
		const box = boardBounds([{ x: -20, y: 150 }], sheet);
		// 20% of 1200 is 240px left of the sheet, and a margin past the face beyond that.
		expect(box.left).toBeLessThan(-240 - 36);
		// 150% of 960 is 1440px down, and the name hangs under the face past that.
		expect(box.bottom).toBeGreaterThan(1440 + 36 + 20);
		expect(box.right).toBe(1200);
		expect(box.top).toBe(0);
	});

	it("frames the label under somebody's name too", () => {
		const plain = boardBounds([{ x: 50, y: 150 }], sheet);
		const labelled = boardBounds([{ x: 50, y: 150, subtitle: "Iron Knight" }], sheet);
		expect(labelled.bottom).toBeGreaterThan(plain.bottom);
	});

	it("skips a person with no place at all rather than framing nowhere", () => {
		expect(boardBounds([{ x: NaN, y: 3 }], sheet)).toEqual({ left: 0, top: 0, right: 1200, bottom: 960 });
	});

	// AUDIT 2026-11-03 (O8): a fan of ten lines between one pair bows about a quarter of the sheet off
	// the straight run, and a frame worked out from the faces alone cut the outer ones off.
	describe("and the lines on it", () => {
		const nodes = [{ x: 40, y: 2 }, { x: 60, y: 2 }];
		// A line along the top edge bowed up: its control is 40% above the sheet, so the stroke's own
		// highest point is half that, 20% of 960 = 192px above it.
		const bowed = { curve: { from: { left: 40, top: 2 }, control: { left: 50, top: -38 }, to: { left: 60, top: 2 } } };

		it("frames exactly what it always did when given no lines", () => {
			expect(boardBounds(nodes, sheet, [], [])).toEqual(boardBounds(nodes, sheet));
			expect(boardBounds(nodes, sheet, [], undefined)).toEqual(boardBounds(nodes, sheet));
		});

		it("takes in the outermost bow at the stroke's true extreme, not at its control point", () => {
			const box = boardBounds(nodes, sheet, [], [bowed]);
			const peak = ((2 - 0.5 * 40) / 100) * 960; // the curve's top at t = 0.5
			expect(box.top).toBeLessThan(peak);
			// Never framed out as far as the control point, which is twice the bow.
			expect(box.top).toBeGreaterThan((-38 / 100) * 960);
			expect(box.left).toBe(0);
			expect(box.right).toBe(1200);
		});

		it("takes in a caption, turned, round its anchor", () => {
			// 50% of the sheet wide in flat units (600px), on a line far below the sheet.
			const line = {
				curve: { from: { left: 45, top: 150 }, control: { left: 50, top: 150 }, to: { left: 55, top: 150 } },
				anchor: { left: 50, top: 150, angle: 90 },
				size: { w: 50, h: 2 },
			};
			const box = boardBounds([], sheet, [], [line]);
			// Turned upright, the 600px chip reaches 300px below its anchor at 1440px.
			expect(box.bottom).toBeGreaterThan(1440 + 300);
			// Lying flat, it reaches only half its own height down.
			const flatBox = boardBounds([], sheet, [], [{ ...line, anchor: { ...line.anchor, angle: 0 } }]);
			expect(flatBox.bottom).toBeLessThan(1440 + 300);
		});

		it("skips a line with no curve or no numbers in it", () => {
			const plain = boardBounds(nodes, sheet);
			expect(boardBounds(nodes, sheet, [], [null, {}, { curve: null }, { curve: { from: { left: NaN, top: 1 }, control: {}, to: {} } }]))
				.toEqual(plain);
		});
	});
});

/** The smallest element a surface will attach to, as zoom-pan-surface.test.js builds it. */
function fakeEl({ w = 400, h = 300 } = {}) {
	const listeners = new Map();
	return {
		style: {},
		clientWidth: w,
		clientHeight: h,
		classList: { add() {}, remove() {} },
		setPointerCapture: vi.fn(),
		releasePointerCapture() {},
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type) { listeners.delete(type); },
		closest: () => null,
		emit(type, ev = {}) { listeners.get(type)?.({ preventDefault() {}, ...ev }); },
	};
}

describe("a surface that frames its bounds rather than its board", () => {
	let surface;
	let view;
	beforeEach(() => {
		globalThis.requestAnimationFrame = fn => { fn(); return 1; };
		globalThis.cancelAnimationFrame = () => {};
	});
	afterEach(() => {
		surface?.destroy();
		delete globalThis.requestAnimationFrame;
		delete globalThis.cancelAnimationFrame;
	});

	/** A 1000x800 board in a 400x300 window. */
	const make = (spec = {}) => {
		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800, ...spec,
		}).attach();
		return surface;
	};

	it("frames the board itself when it is given no bounds", () => {
		make();
		// min(400/1000, 300/800) = 0.375: the height decides.
		expect(surface.scale).toBeCloseTo(0.375, 6);
	});

	// Somebody a whole board's width to the left: the fit takes them in, and the board sits right of
	// the middle to make room.
	it("frames everybody, including somebody standing off the board", () => {
		make({ bounds: { left: -1000, top: 0, right: 1000, bottom: 800 } });
		// min(400/2000, 300/800) = 0.2, and the box, 400x160, centred.
		expect(surface.scale).toBeCloseTo(0.2, 6);
		expect(surface.offset).toEqual({ x: 200, y: 70 });
	});

	// ⚠ A SLIVER OF THE BOUNDS STAYS IN THE WINDOW, NOT A SLIVER OF THE BOARD. Held to the board, the
	// pan would refuse to bring somebody standing off it into the middle of the window.
	it("holds the pan to the bounds, so somebody off the board can be brought into view", () => {
		make({ bounds: { left: -1000, top: 0, right: 1000, bottom: 800 } });
		surface._offset = { x: 5000, y: 70 };
		surface.apply();
		// The box's left edge stops 40px short of the window's right edge, and the board is a
		// thousand board pixels (200 window pixels) right of that.
		expect(surface.offset.x).toBe(360 + 200);
	});

	// ⚠ A DROP ON PAPER THE READER COULD SEE DOES NOT SHRINK THE BOARD UNDER THEM. Re-fitting after
	// every drop past the sheet would be the map fighting the hand arranging it.
	it("keeps a fitted view where it is when the new bounds are still in sight", () => {
		make();
		const before = { scale: surface.scale, offset: surface.offset };
		surface.setNaturalSize(1000, 800, { left: 0, top: 0, right: 1010, bottom: 800 });
		expect(surface.scale).toBe(before.scale);
		expect(surface.offset).toEqual(before.offset);
	});

	it("re-fits a fitted view when somebody lands out of sight", () => {
		make();
		surface.setNaturalSize(1000, 800, { left: 0, top: 0, right: 2000, bottom: 800 });
		expect(surface.scale).toBeCloseTo(0.2, 6);
	});

	// A reader who has placed the board themselves keeps their corner, whatever arrives.
	it("never re-fits a view the reader has placed", () => {
		make();
		surface.zoomTo(1);
		surface.setNaturalSize(1000, 800, { left: 0, top: 0, right: 5000, bottom: 800 });
		expect(surface.scale).toBe(1);
	});

	// A caller that only knows the size must not throw away bounds another call set.
	it("keeps its bounds when only the size is said", () => {
		make({ bounds: { left: -1000, top: 0, right: 1000, bottom: 800 } });
		surface.setNaturalSize(1000, 800);
		expect(surface.scale).toBeCloseTo(0.2, 6);
	});

	it("takes a box with no area as no bounds at all", () => {
		make({ bounds: { left: 5, top: 5, right: 5, bottom: 5 } });
		expect(surface.scale).toBeCloseTo(0.375, 6);
	});
});

describe("a surface that stands aside for a press", () => {
	let surface;
	let view;
	afterEach(() => surface?.destroy());

	it("starts no pan, and takes no capture, on a press it yields", () => {
		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800, yields: ev => !!ev.shiftKey,
		}).attach();
		const before = surface.offset;
		view.emit("pointerdown", { pointerId: 1, button: 0, shiftKey: true, clientX: 0, clientY: 0, target: view });
		view.emit("pointermove", { pointerId: 1, clientX: 80, clientY: 40 });
		expect(view.setPointerCapture).not.toHaveBeenCalled();
		expect(surface.offset).toEqual(before);
	});

	// The right button drags the board from anywhere; standing aside is only ever for the left.
	it("still pans on a right press, whatever it would say about a left one", () => {
		globalThis.requestAnimationFrame = fn => { fn(); return 1; };
		view = fakeEl();
		surface = new ZoomPanSurface({
			view, content: fakeEl(), naturalWidth: 1000, naturalHeight: 800, yields: () => true,
		}).attach();
		view.emit("pointerdown", { pointerId: 1, button: 2, clientX: 0, clientY: 0, target: view });
		expect(view.setPointerCapture).toHaveBeenCalled();
		delete globalThis.requestAnimationFrame;
	});
});
