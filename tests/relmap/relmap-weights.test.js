import { describe, it, expect, beforeEach } from "vitest";
import {
	RELMAP_WEIGHTS, RELMAP_WEIGHT_BASE, RELMAP_WEIGHT_MAX, RELMAP_WEIGHT_MIN,
	RELMAP_WEIGHT_SETTING, RELMAP_WEIGHT_STEP,
	getWeights, readWeight, readWeights, setWeights, weightScales,
} from "../../module/relmap/relmap-weights.js";
import { RELMAP_HEAD_PX, RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";

// How heavily one reader wants a relationship board drawn: the arrowheads, the strokes and the
// writing, each as a percentage.
//
// WHAT THIS SUITE IS REALLY HOLDING is that the number can never be anything but a number in range.
// It is browser storage, which anything in the page can write, and what it feeds is arithmetic that
// places every arrowhead and cuts every hole in every stroke -- so a stray value here is a board
// drawn wrong rather than a setting ignored. Every path in goes through one gate, and a suite that
// stubbed that gate would be testing nothing.

let stored;   // setting key -> value, standing in for this browser's localStorage
let sets;     // every game.settings.set call, to catch a write per press

beforeEach(() => {
	stored = {};
	sets = [];
	globalThis.game = {
		settings: {
			get: (ns, key) => stored[key],
			set: (ns, key, value) => {
				sets.push([key, value]);
				stored[key] = value;
				return Promise.resolve(value);
			},
		},
	};
});

describe("the three weights", () => {
	it("are the strokes, the arrowheads and the writing, in that order", () => {
		// THE ANATOMY OF ONE LINE, in the order a reader meets it: there is a stroke, the stroke
		// has a head on its end, and along it there are words. This is the run of dials along the
		// footer, left to right, and an arrowhead is something a LINE HAS rather than a mark
		// standing on its own -- so its dial follows the dial for the thing it is attached to.
		expect(RELMAP_WEIGHTS).toEqual(["line", "head", "word"]);
	});

	it("start at the sheet's own answer", () => {
		expect(getWeights()).toEqual({ head: 100, line: 100, word: 100 });
		expect(RELMAP_WEIGHT_BASE).toBe(100);
	});

	// ⚠ THE OPPOSITE BARGAIN FROM `readSize`, which stores its base as the ABSENCE of a size. That
	// one is written onto a line on a shared board where nearly every line has none; this is one
	// reader's own record of their own eyes, and a reader who has deliberately come back to 100
	// after a season at 150 has made a choice worth telling from never having asked.
	it("keeps the base as a real number rather than as nothing", async () => {
		await setWeights({ line: 150 });
		await setWeights({ line: RELMAP_WEIGHT_BASE });
		expect(stored[RELMAP_WEIGHT_SETTING].line).toBe(RELMAP_WEIGHT_BASE);
	});
});

describe("reading one back", () => {
	it("comes back as it was written", () => {
		setWeights({ head: 150 });
		expect(getWeights().head).toBe(150);
		expect(stored[RELMAP_WEIGHT_SETTING]).toEqual({ head: 150, line: 100, word: 100 });
	});

	// HELD TO THE BOUNDS RATHER THAN REFUSED, the same way a coordinate two screens off the board
	// is clamped onto it: a reader who arrives at the ceiling wants the ceiling, and handing them
	// the base instead says their press did nothing.
	it("holds a wild number to the bounds rather than dropping it", () => {
		expect(readWeight(9000)).toBe(RELMAP_WEIGHT_MAX);
		expect(readWeight(1)).toBe(RELMAP_WEIGHT_MIN);
	});

	// ⚠ AND A NUMBER THAT IS NOT A PERCENTAGE AT ALL IS NOT CLAMPED, WHICH IS THE OTHER HALF OF
	// THE SAME RULE. One per cent is a real percentage out of range, and a reader who somehow
	// arrives there wants the smallest there is; a negative one is not a smaller weight, it is
	// nonsense, and reading it as the floor would be inventing an answer for it. So it is refused
	// with everything else that is not a weight, which is the base.
	//
	// ZERO IS IN THIS LIST TWICE OVER: written outright, and as what `Number()` makes of null, the
	// empty string and an empty array. All three are things a stored record can honestly contain,
	// and clamped they would silently halve every mark on the board.
	it("reads anything that is not a weight at all as the base", () => {
		for (const junk of [null, undefined, "", "big", NaN, {}, [], 0, -400]) {
			expect(readWeight(junk), String(junk)).toBe(RELMAP_WEIGHT_BASE);
		}
	});

	// ⚠ ROUNDED TO THE STEP, so a value written by an older build with a different step, or by
	// hand, lands somewhere the two arrows can reach. A stored 137 the buttons could only move to
	// 147 and 127 is a setting the reader can never get back to a round number from.
	it("rounds onto the step the buttons move in", () => {
		expect(readWeight(137)).toBe(140);
		expect(readWeight(134)).toBe(130);
		expect(readWeight(150) % RELMAP_WEIGHT_STEP).toBe(0);
	});

	it("fills in a key that is missing rather than leaving a hole", () => {
		expect(readWeights({ line: 200 })).toEqual({ head: 100, line: 200, word: 100 });
		expect(readWeights(null)).toEqual({ head: 100, line: 100, word: 100 });
		expect(readWeights("nonsense")).toEqual({ head: 100, line: 100, word: 100 });
	});

	// The setting is not registered in an older build or in a unit test, and neither is a reason to
	// take a board down.
	it("answers with the base rather than throwing when there is no setting at all", () => {
		globalThis.game = {};
		expect(getWeights()).toEqual({ head: 100, line: 100, word: 100 });
	});
});

describe("writing one", () => {
	it("leaves the other two exactly where they were", () => {
		setWeights({ head: 150 });
		setWeights({ word: 200 });
		expect(getWeights()).toEqual({ head: 150, line: 100, word: 200 });
	});

	it("answers with all three as they now stand", () => {
		expect(setWeights({ line: 130 })).toEqual({ head: 100, line: 130, word: 100 });
	});

	it("writes once per press and to one key", () => {
		setWeights({ line: 130 });
		expect(sets).toHaveLength(1);
		expect(sets[0][0]).toBe(RELMAP_WEIGHT_SETTING);
	});

	// A FAILED WRITE IS NOT WORTH A NOTIFICATION and must not take the press down with it: the
	// board has already been repainted at the new weight by the time this is called, and losing the
	// record costs the reader one re-press. See `setSettingQuietly`.
	it("survives a browser that refuses to store it", () => {
		globalThis.game = { settings: { get: () => ({}), set: () => { throw new Error("nope"); } } };
		expect(() => setWeights({ line: 130 })).not.toThrow();
	});
});

describe("what the board is actually drawn with", () => {
	// ONE PLACE THE DIVISION HAPPENS. Six callers want a multiplier rather than a percentage, and
	// `pct / 100` written six times is five places to write `100 / pct` by accident in a file where
	// every other number is already a share.
	it("turns each percentage into a multiplier", () => {
		expect(weightScales({ head: 150, line: 100, word: 50 }))
			.toEqual({ head: 1.5, line: 1, word: 0.5 });
	});

	it("leaves everything exactly as it was at the base", () => {
		expect(weightScales(getWeights())).toEqual({ head: 1, line: 1, word: 1 });
	});

	it("goes through the same gate a stored value does", () => {
		expect(weightScales({ head: 9000 })).toEqual({
			head: RELMAP_WEIGHT_MAX / 100, line: 1, word: 1,
		});
	});

	// ⚠ THE CEILING IS SET BY THE PORTRAITS AND NOT BY TASTE. A face is 72 board pixels; at the top
	// of the range an arrowhead must still be smaller than the person it points at, or the board is
	// arrowheads with a web behind them.
	it("keeps the biggest arrowhead smaller than a face", () => {
		expect(RELMAP_HEAD_PX * (RELMAP_WEIGHT_MAX / 100)).toBeLessThan(72);
	});

	// AND THE FLOOR IS WHERE THE THREE STOP BEING THEMSELVES. Below half a stroke is under two
	// screen pixels and flickers as the board pans; the writing goes under the size the board stops
	// drawing captions at. A reader who wants less than this wants the thing turned off, which is a
	// different control.
	it("keeps the smallest writing above the legibility floor", () => {
		expect(RELMAP_CAPTION_PX * (RELMAP_WEIGHT_MIN / 100)).toBeGreaterThanOrEqual(8);
	});
});
