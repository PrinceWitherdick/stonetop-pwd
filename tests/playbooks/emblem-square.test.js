import { describe, it, expect } from "vitest";
import { squareAround, defaultSquare, cutPlan } from "../../module/playbooks/pdf/emblem-square.js";

// The emblem cutter's square (PlaybookEmblemCut.js), on a landscape letter page (792 x 612 points).
const W = 792, H = 612;
const sideInPoints = r => [(r[2] - r[0]) * W, (r[3] - r[1]) * H];

describe("the square the emblem cutter starts on", () => {
	it("is square in points round a found emblem, padded, centred on it", () => {
		const r = squareAround({ x0: 700, y0: 10, x1: 760, y1: 80 }, W, H);
		const [w, h] = sideInPoints(r);
		expect(w).toBeCloseTo(h, 6);
		expect(w).toBeCloseTo(70 * 1.16, 6);
		expect(((r[0] + r[2]) / 2) * W).toBeCloseTo(730, 6);
		expect(((r[1] + r[3]) / 2) * H).toBeCloseTo(45, 6);
	});

	it("stays on the page when the emblem sits at its edge", () => {
		const r = squareAround({ x0: 760, y0: 0, x1: 792, y1: 40 }, W, H);
		expect(r[0]).toBeGreaterThanOrEqual(0);
		expect(r[1]).toBeGreaterThanOrEqual(0);
		expect(r[2]).toBeLessThanOrEqual(1 + 1e-9);
		expect(r[3]).toBeLessThanOrEqual(1 + 1e-9);
		const [w, h] = sideInPoints(r);
		expect(w).toBeCloseTo(h, 6);
	});

	it("is nothing for no box, an empty box or no page", () => {
		expect(squareAround(null, W, H)).toBeNull();
		expect(squareAround({ x0: 5, y0: 5, x1: 5, y1: 9 }, W, H)).toBeNull();
		expect(squareAround({ x0: 0, y0: 0, x1: 9, y1: 9 }, 0, H)).toBeNull();
	});

	it("starts at the top right with nothing found, a sixth of the page across", () => {
		const r = defaultSquare(W, H);
		const [w, h] = sideInPoints(r);
		expect(w).toBeCloseTo(W / 6, 6);
		expect(h).toBeCloseTo(W / 6, 6);
		expect(r[2]).toBeLessThan(1);
		expect(r[0]).toBeGreaterThan(0.5);
		expect(r[1]).toBeLessThan(0.1);
	});
});

describe("cutting the chosen square", () => {
	it("renders at least twice the picture's pixels across the square", () => {
		const plan = cutPlan(squareAround({ x0: 700, y0: 10, x1: 760, y1: 80 }, W, H), W, H, 512);
		expect(plan.side).toBeCloseTo(81.2, 6);
		expect(plan.px).toBeGreaterThanOrEqual(1024);
		expect(plan.x0).toBeCloseTo(730 - 40.6, 6);
	});

	it("caps the scale for a tiny square and keeps a floor for a large one", () => {
		expect(cutPlan([0, 0, 1 / W, 1 / H], W, H).scale).toBe(24);
		expect(cutPlan([0, 0, 0.75, 0.75 * W / H], W, H).scale).toBe(2);
		expect(cutPlan(null, W, H)).toBeNull();
		expect(cutPlan([0.5, 0, 0.5, 0], W, H)).toBeNull();
	});
});

import { nudgeBox, resizeBox, SQ_MIN } from "../../module/utils/portrait-frame.js";

describe("the cutter's smaller smallest square (a whole page, not a portrait)", () => {
	const box = { side: 20, left: 100, top: 100 };
	it("lets - shrink below the portrait framer's floor when asked, and keeps that floor by default", () => {
		// A 600px-tall stage: the framer stops at 8% (48px), the cutter at 2% (12px).
		expect(nudgeBox({ side: 50, left: 100, top: 100 }, "-", {}, 800, 600).side).toBe(600 * SQ_MIN);
		expect(nudgeBox(box, "-", {}, 800, 600, 0.02).side).toBe(18);
		expect(nudgeBox({ side: 13, left: 100, top: 100 }, "-", {}, 800, 600, 0.02).side).toBe(12);
	});
	it("moves by 2px with an arrow, 10 with Shift", () => {
		expect(nudgeBox(box, "ArrowRight", {}, 800, 600, 0.02)).toMatchObject({ left: 102, top: 100 });
		expect(nudgeBox(box, "ArrowUp", { shift: true }, 800, 600, 0.02)).toMatchObject({ left: 100, top: 90 });
	});
	it("lets a corner drag make a small square too", () => {
		expect(resizeBox("se", box, 115, 115, 800, 600).side).toBe(600 * SQ_MIN);
		expect(resizeBox("se", box, 115, 115, 800, 600, 0.02).side).toBe(15);
	});
});
