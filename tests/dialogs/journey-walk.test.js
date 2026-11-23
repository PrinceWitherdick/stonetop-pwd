// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// The party mark walking the route line on an off-canvas map (module/dialogs/journey-walk.js).
// The sampling is pure; the walk is driven here by a hand-cranked requestAnimationFrame, and has
// to end exactly where the template stood the mark, and not move at all for a reader who asked
// for less motion.

const { walkPoints, walkPartyMarker, walkSeconds, walkTrack, cancelWalk } = await import("../../module/dialogs/journey-walk.js");

const leg = (a, b) => ({ from: a, to: b, control: { left: (a.left + b.left) / 2, top: (a.top + b.top) / 2 + 5 } });
const A = { left: 10, top: 10 }, B = { left: 50, top: 20 }, C = { left: 90, top: 60 };
const LEGS = [leg(A, B), leg(B, C)];

describe("walkPoints", () => {
	it("starts where the party was and ends where it is", () => {
		const points = walkPoints(LEGS, 0, 2, 8);
		expect(points[0]).toEqual(A);
		expect(points.at(-1)).toEqual(C);
		expect(points).toHaveLength(17);
	});

	it("moves steadily forward", () => {
		const points = walkPoints(LEGS, 0, 2, 8);
		for (let i = 1; i < points.length; i++) expect(points[i].left).toBeGreaterThan(points[i - 1].left);
	});

	it("walks the same line backwards when stepping back", () => {
		expect(walkPoints(LEGS, 2, 0, 8)).toEqual(walkPoints(LEGS, 0, 2, 8).reverse());
		expect(walkPoints(LEGS, 2, 1, 8)[0]).toEqual(C);
		expect(walkPoints(LEGS, 2, 1, 8).at(-1)).toEqual(B);
	});

	it("has nothing to walk for no move or no legs", () => {
		expect(walkPoints(LEGS, 1, 1)).toEqual([]);
		expect(walkPoints([], 0, 1)).toEqual([]);
	});
});

// The pace both marks keep: the off-canvas one here and the canvas one (ExpeditionRouteOverlay.js).
describe("walkTrack and walkSeconds", () => {
	it("starts on the first point, ends on the last, and never steps back", () => {
		const points = walkPoints(LEGS, 0, 2, 8);
		const track = walkTrack(points);
		expect(track(0)).toEqual(A);
		expect(track(1).left).toBeCloseTo(C.left, 6);
		expect(track(1).top).toBeCloseTo(C.top, 6);
		let last = -Infinity;
		for (let t = 0; t <= 1; t += 0.05) {
			const at = track(t).left;
			expect(at).toBeGreaterThanOrEqual(last);
			last = at;
		}
	});

	it("clamps time outside 0..1", () => {
		const track = walkTrack(walkPoints(LEGS, 0, 1, 4));
		expect(track(-1)).toEqual(track(0));
		expect(track(2)).toEqual(track(1));
	});

	it("lasts 0.9s a leg, never past 1.6s, either way", () => {
		expect(walkSeconds(0, 1)).toBeCloseTo(0.9);
		expect(walkSeconds(2, 1)).toBeCloseTo(0.9);
		expect(walkSeconds(0, 5)).toBe(1.6);
		expect(walkSeconds(1, 1)).toBe(0);
	});
});

describe("walkPartyMarker", () => {
	let frames, root, mark;
	beforeEach(() => {
		frames = [];
		globalThis.requestAnimationFrame = fn => frames.push(fn);
		globalThis.cancelAnimationFrame = () => {};
		globalThis.matchMedia = () => ({ matches: false });
		root = document.createElement("div");
		root.innerHTML = `<span class="stonetop-journey-party" style="left:90%;top:60%"></span>`;
		document.body.append(root);
		mark = root.querySelector(".stonetop-journey-party");
	});
	afterEach(() => {
		root.remove();
		document.documentElement.classList.remove("stonetop-reduce-motion");
	});
	const crank = (...times) => { for (const t of times) frames.shift()?.(t); };

	it("starts at the old stop and ends exactly where the template put the mark", () => {
		expect(walkPartyMarker(root, { legs: LEGS, reach: [0, 1, 2], from: 0, to: 2 })).toBe(true);
		expect(mark.style.left).toBe("10.00%");
		crank(0, 800);
		expect(parseFloat(mark.style.left)).toBeGreaterThan(10);
		expect(parseFloat(mark.style.left)).toBeLessThan(90);
		crank(5000);
		expect(mark.style.left).toBe("90%");
		expect(mark.style.top).toBe("60%");
		expect(frames).toHaveLength(0);
	});

	it("reads route legs through reach, so a bend is walked inside its leg", () => {
		walkPartyMarker(root, { legs: LEGS, reach: [0, 2], from: 0, to: 1 });
		expect(mark.style.left).toBe("10.00%");
	});

	it("does not move for a reader who asked for less motion", () => {
		document.documentElement.classList.add("stonetop-reduce-motion");
		expect(walkPartyMarker(root, { legs: LEGS, reach: [0, 1, 2], from: 0, to: 2 })).toBe(false);
		expect(mark.style.left).toBe("90%");
		expect(frames).toHaveLength(0);
		globalThis.matchMedia = () => ({ matches: true });
		document.documentElement.classList.remove("stonetop-reduce-motion");
		expect(walkPartyMarker(root, { legs: LEGS, reach: [0, 1, 2], from: 0, to: 2 })).toBe(false);
	});

	it("does nothing without a mark", () => {
		mark.remove();
		expect(walkPartyMarker(root, { legs: LEGS, reach: [0, 1, 2], from: 0, to: 2 })).toBe(false);
	});

	it("puts the mark back where it stands when cancelled", () => {
		walkPartyMarker(root, { legs: LEGS, reach: [0, 1, 2], from: 0, to: 2 });
		crank(0, 300);
		cancelWalk(root);
		expect(mark.style.left).toBe("90%");
	});
});
