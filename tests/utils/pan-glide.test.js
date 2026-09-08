import { describe, expect, it } from "vitest";
import {
	GLIDE_MAX_SPEED, GLIDE_MIN_SPEED, GLIDE_WINDOW_MS, glideStep, throwVelocity, worthGliding,
} from "../../module/utils/pan-glide.js";

// THE THROW, in numbers. Everything here is the half of the glide that has no DOM in it: how fast
// the hand was going, and what is left of that a frame later. The wiring around it (which press
// stops a slide, which click it swallows) is in tests/utils/zoom-pan-surface.test.js.
//
// WHY THE SPLIT IS WORTH IT. A momentum curve is the kind of code that is only ever checked by
// throwing something across a screen and going "hm, about right", and the two ways it goes wrong
// are both invisible that way: a board that reads a careful placement as a flick, and a board whose
// slide is twice as long on a 144Hz monitor as on the laptop next to it. Both are one assertion
// each here.

describe("throwVelocity", () => {
	it("reads the speed off the end of the drag", () => {
		// 60px in 60ms, straight right.
		const marks = [
			{ t: 0, x: 0, y: 0 },
			{ t: 30, x: 30, y: 0 },
			{ t: 60, x: 60, y: 0 },
		];
		expect(throwVelocity(marks, 60)).toEqual({ x: 1, y: 0 });
	});

	it("throws nothing when the pointer was parked before it was let go", () => {
		// The gesture that must NOT fling: hauled the board across at speed, stopped to look at it,
		// let go. Every sample is outside the window measured back from the release, so the only
		// thing the trail says about the last instant is that nothing happened in it.
		const marks = [
			{ t: 0, x: 0, y: 0 },
			{ t: 40, x: 200, y: 0 },
			{ t: 80, x: 400, y: 0 },
		];
		expect(throwVelocity(marks, 80 + GLIDE_WINDOW_MS + 1)).toEqual({ x: 0, y: 0 });
	});

	it("ignores the part of the journey that is older than the window", () => {
		// Fast for a long while, then slow for the last stretch. What is thrown is the slow part.
		const marks = [
			{ t: 0, x: 0, y: 0 },
			{ t: 500, x: 5000, y: 0 },
			{ t: 540, x: 5020, y: 0 },
			{ t: 580, x: 5040, y: 0 },
		];
		expect(throwVelocity(marks, 580)).toEqual({ x: 0.5, y: 0 });
	});

	it("reads a trail with nothing to measure as a dead stop", () => {
		expect(throwVelocity([], 0)).toEqual({ x: 0, y: 0 });
		expect(throwVelocity([{ t: 0, x: 0, y: 0 }], 0)).toEqual({ x: 0, y: 0 });
		// Two samples in the same millisecond: a distance over no time is an infinity, and an
		// infinite offset paints nothing at all.
		expect(throwVelocity([{ t: 5, x: 0, y: 0 }, { t: 5, x: 90, y: 0 }], 5)).toEqual({ x: 0, y: 0 });
	});

	it("caps a pointer that jumped, keeping the direction it jumped in", () => {
		// One pair saying the hand crossed 4000px in 40ms. A pen put down somewhere else, a screen
		// share catching up; whatever it was, honouring it would fire the board off the far edge.
		const marks = [{ t: 0, x: 0, y: 0 }, { t: 40, x: 4000, y: 4000 }];
		const v = throwVelocity(marks, 40);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(GLIDE_MAX_SPEED, 6);
		expect(v.x).toBeCloseTo(v.y, 6);
	});
});

describe("worthGliding", () => {
	it("tells a throw from a placement", () => {
		expect(worthGliding({ x: GLIDE_MIN_SPEED * 2, y: 0 })).toBe(true);
		expect(worthGliding({ x: GLIDE_MIN_SPEED / 2, y: 0 })).toBe(false);
		expect(worthGliding({ x: 0, y: 0 })).toBe(false);
		expect(worthGliding()).toBe(false);
	});

	it("measures the speed and not one axis of it", () => {
		// A diagonal drift that is under the threshold on both axes is still over it as a throw.
		const each = GLIDE_MIN_SPEED * 0.8;
		expect(worthGliding({ x: each, y: each })).toBe(true);
	});
});

describe("glideStep", () => {
	it("moves the board and takes some of the throw away", () => {
		const { dx, dy, velocity } = glideStep({ velocity: { x: 2, y: -1 }, dt: 16 });
		expect(dx).toBeCloseTo(32, 6);
		expect(dy).toBeCloseTo(-16, 6);
		expect(Math.hypot(velocity.x, velocity.y)).toBeLessThan(Math.hypot(2, -1));
	});

	/** Pay a throw out for a second at a given frame length, and report how far it travelled. */
	const runFor = (dt) => {
		let velocity = { x: 2, y: 0 };
		let travelled = 0;
		for (let t = 0; t < 1000; t += dt) {
			const step = glideStep({ velocity, dt });
			travelled += step.dx;
			velocity = step.velocity;
		}
		return travelled;
	};

	it("slides the same distance whatever the monitor's refresh rate", () => {
		// ⚠ THE ONE THAT MATTERS. Decay applied per CALLBACK instead of per millisecond passes every
		// other test in this file and still sends the same flick twice as far on a 30Hz laptop as on
		// a 60Hz desktop, which is a board that behaves differently for every player at the table.
		const sixty = runFor(1000 / 60);
		const thirty = runFor(1000 / 30);
		const gaming = runFor(1000 / 144);
		for (const other of [thirty, gaming]) {
			expect(Math.abs(other - sixty) / sixty).toBeLessThan(0.05);
		}
	});

	it("refuses to teleport the board after the browser was away", () => {
		// A backgrounded tab comes back with a frame gap of half a second or more. The travel it
		// would have made is lost on purpose: nobody watched it, and painting it as one jump would
		// land the reader somewhere they never saw the board go.
		const long = glideStep({ velocity: { x: 1, y: 0 }, dt: 1000 });
		const absurd = glideStep({ velocity: { x: 1, y: 0 }, dt: 60000 });
		expect(long.dx).toBeLessThan(100);
		expect(absurd.dx).toBe(long.dx);
	});

	it("stands still for a frame of no time, and for nonsense", () => {
		expect(glideStep({ velocity: { x: 3, y: 3 }, dt: 0 }).dx).toBe(0);
		expect(glideStep({ velocity: { x: 3, y: 3 }, dt: -50 }).dx).toBe(0);
		expect(glideStep().dx).toBe(0);
	});
});
