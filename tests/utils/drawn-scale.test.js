import { describe, it, expect } from "vitest";
import { drawnScale } from "../../module/utils/drawn-scale.js";

const box = (laidW, drawnW) => ({ offsetWidth: laidW, offsetHeight: 0, getBoundingClientRect: () => ({ width: drawnW, height: 0 }) });

describe("drawnScale", () => {
	// offsetWidth is a whole pixel and the rect is not: an unscaled box must still divide by exactly 1.
	it("is exactly 1 for an unscaled box whose rect is fractional", () => {
		expect(drawnScale(box(613, 612.5))).toBe(1);
		expect(drawnScale(box(612, 612.4))).toBe(1);
	});

	it("reads a real scale", () => {
		expect(drawnScale(box(600, 750))).toBe(1.25);
		expect(drawnScale(box(600, 480))).toBe(0.8);
	});

	it("is 1 with nothing to read", () => {
		expect(drawnScale(box(0, 0))).toBe(1);
		expect(drawnScale({ offsetWidth: 10 }, null)).toBe(1);
	});
});
