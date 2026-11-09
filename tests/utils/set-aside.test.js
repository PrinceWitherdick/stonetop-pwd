import { describe, it, expect } from "vitest";
import { swapAside } from "../../module/utils/set-aside.js";

// Answers set aside per choice (utils/set-aside.js): Make a Site's Manner and Region, a Thing Below's preset.

describe("swapAside", () => {
	it("keeps what the choice being left held, and gives it back on the way back", () => {
		const store = {};
		expect(swapAside(store, "tomb", "cave", { a: 1 }, () => ({}))).toEqual({});
		expect(store).toEqual({ tomb: { a: 1 } });
		expect(swapAside(store, "cave", "tomb", { b: 2 }, () => ({}))).toEqual({ a: 1 });
		// The answers taken back leave the store; the ones just left are in it.
		expect(store).toEqual({ cave: { b: 2 } });
	});

	it("keeps nothing for null, and starts a choice with nothing kept from its default", () => {
		const store = {};
		expect(swapAside(store, "", "tomb", null, () => "fresh")).toBe("fresh");
		expect(store).toEqual({});
	});

	it("takes only the store's own keys, never one an object inherits", () => {
		expect(swapAside({}, "a", "constructor", null, () => "fresh")).toBe("fresh");
	});
});
