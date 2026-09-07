import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	RELMAP_SIZE_SETTING, getLastSize, rememberSize,
} from "../../module/relmap/relmap-size.js";
import { RELMAP_SIZE_MAX, RELMAP_SIZE_MIN, RELMAP_SIZE_NONE } from "../../module/relmap/relmap-store.js";
import { RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";

// How big a caption a reader last asked for, kept so the next line they draw is set in it.
//
// What this suite is really holding is that the number NEVER reaches a map unchecked. It is
// browser storage, which anything in the page can write, and what it feeds is a field on a
// document every client at the table repaints from -- so every path out of here goes through the
// store's own sanitiser, and a suite that stubbed that would be testing nothing.

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

describe("the size a reader last asked for", () => {
	it("is nothing at all until they say", () => {
		expect(getLastSize()).toBe(RELMAP_SIZE_NONE);
	});

	it("comes back as it was remembered", async () => {
		await rememberSize(18);
		expect(getLastSize()).toBe(18);
		expect(stored[RELMAP_SIZE_SETTING]).toBe(18);
	});

	it("holds a wild number to the bounds rather than dropping it", async () => {
		await rememberSize(500);
		expect(getLastSize()).toBe(RELMAP_SIZE_MAX);
		await rememberSize(1);
		expect(getLastSize()).toBe(RELMAP_SIZE_MIN);
	});

	// The base is stored as the ABSENCE of a size, so a reader who goes back to it stops stamping
	// lines with a number at all. See `readSize`.
	it("records the ordinary size as no size", async () => {
		await rememberSize(18);
		await rememberSize(RELMAP_CAPTION_PX);
		expect(getLastSize()).toBe(RELMAP_SIZE_NONE);
	});

	it("clears on something that is not a size, which is the field emptied", async () => {
		await rememberSize(18);
		await rememberSize("");
		expect(getLastSize()).toBe(RELMAP_SIZE_NONE);
	});

	// A setting write is a localStorage write plus an onChange, and this is called from a control
	// a reader presses repeatedly.
	it("writes nothing when the answer has not moved", async () => {
		await rememberSize(15);
		expect(sets).toHaveLength(1);
		await rememberSize(15);
		expect(sets).toHaveLength(1);
	});

	// Anything in the page could have written this, and what it feeds is a shared document.
	it("sanitises what it reads back, whatever is in there", () => {
		stored[RELMAP_SIZE_SETTING] = "enormous";
		expect(getLastSize()).toBe(RELMAP_SIZE_NONE);
		stored[RELMAP_SIZE_SETTING] = 999;
		expect(getLastSize()).toBe(RELMAP_SIZE_MAX);
		// Rounded to a whole pixel, which is what a `font-size` is written from. Not a fraction of
		// the base, which would come back as no size at all.
		stored[RELMAP_SIZE_SETTING] = 19.6;
		expect(getLastSize()).toBe(20);
	});

	// An unregistered key is an older build or a test, and neither is a reason to take a board down.
	it("survives a settings layer that throws", async () => {
		const boom = () => { throw new Error("not registered"); };
		globalThis.game.settings.get = boom;
		expect(getLastSize()).toBe(RELMAP_SIZE_NONE);
		globalThis.game.settings.set = boom;
		const noise = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(rememberSize(18)).toBeNull();
		expect(noise).toHaveBeenCalled();
		noise.mockRestore();
	});
});
