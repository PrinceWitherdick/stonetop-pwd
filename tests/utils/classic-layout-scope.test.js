import { describe, it, expect, vi } from "vitest";
import { planClassicLayoutAdoption, adoptClassicLayoutScope, CLASSIC_LAYOUT_SETTINGS } from "../../module/settings.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { FakeStorage, settingsStorage } from "../fakes/migration.js";

// The three per-sheet layout boxes moved from client scope to world scope. A world-scoped
// setting is a Setting DOCUMENT and never reads localStorage, so without a carry-over a GM who
// had unticked "Classic Layout: Character Sheets" got the registered default `true` back on
// upgrade and every sheet in the world silently reverted to classic — with the old value still
// sitting in their browser, unread.

const key = (name) => `${SYSTEM_ID}.${name}`;
const CHARACTER = CLASSIC_LAYOUT_SETTINGS[0];

describe("planClassicLayoutAdoption", () => {
	it("carries over a stored value that disagrees with the default", () => {
		const storage = new FakeStorage({ [key(CHARACTER)]: "false" });
		expect(planClassicLayoutAdoption({ storage, worldKeys: new Set() }))
			.toEqual([{ key: CHARACTER, value: false }]);
	});

	// An absent world setting already means "the default", so writing one would say nothing.
	it("ignores a stored value that already agrees with the default", () => {
		const storage = new FakeStorage({ [key(CHARACTER)]: "true" });
		expect(planClassicLayoutAdoption({ storage, worldKeys: new Set() })).toEqual([]);
	});

	// The fossil must never win over a choice made under the new scope.
	it("leaves a key the world has already answered alone", () => {
		const storage = new FakeStorage({ [key(CHARACTER)]: "false" });
		expect(planClassicLayoutAdoption({ storage, worldKeys: new Set([key(CHARACTER)]) })).toEqual([]);
	});

	it("acts only on the two exact JSON booleans a Boolean client setting can hold", () => {
		const storage = new FakeStorage({ [key(CHARACTER)]: "0" });
		expect(planClassicLayoutAdoption({ storage, worldKeys: new Set() })).toEqual([]);
	});

	it("plans nothing for a browser that never held one", () => {
		expect(planClassicLayoutAdoption({ storage: new FakeStorage(), worldKeys: new Set() })).toEqual([]);
	});

	it("tolerates a missing storage", () => {
		expect(planClassicLayoutAdoption({ storage: null, worldKeys: new Set() })).toEqual([]);
	});

	it("covers all three boxes independently", () => {
		const storage = new FakeStorage({
			[key(CLASSIC_LAYOUT_SETTINGS[0])]: "false",
			[key(CLASSIC_LAYOUT_SETTINGS[1])]: "true",
			[key(CLASSIC_LAYOUT_SETTINGS[2])]: "false",
		});
		expect(planClassicLayoutAdoption({ storage, worldKeys: new Set() })).toEqual([
			{ key: CLASSIC_LAYOUT_SETTINGS[0], value: false },
			{ key: CLASSIC_LAYOUT_SETTINGS[2], value: false },
		]);
	});
});

describe("adoptClassicLayoutScope", () => {
	function world({ isGM = true, worldSettings = [], storage = new FakeStorage() } = {}) {
		const set = vi.fn().mockResolvedValue(undefined);
		const game = {
			user: { isGM },
			settings: { storage: settingsStorage(worldSettings), set },
		};
		return { game, storage, set };
	}

	it("writes the carried-over value into the world scope", async () => {
		const { game, storage, set } = world({ storage: new FakeStorage({ [key(CHARACTER)]: "false" }) });

		expect(await adoptClassicLayoutScope({ game, storage })).toEqual({ adopted: 1 });
		expect(set).toHaveBeenCalledWith(SYSTEM_ID, CHARACTER, false);
	});

	it("does nothing for a player", async () => {
		const { game, storage, set } = world({ isGM: false, storage: new FakeStorage({ [key(CHARACTER)]: "false" }) });

		expect(await adoptClassicLayoutScope({ game, storage })).toEqual({ adopted: 0 });
		expect(set).not.toHaveBeenCalled();
	});

	// Second load: the Setting document now exists, so there is nothing left to carry.
	it("is safe to run on every load", async () => {
		const storage = new FakeStorage({ [key(CHARACTER)]: "false" });
		const { game, set } = world({ storage, worldSettings: [{ _id: "s1", key: key(CHARACTER) }] });

		expect(await adoptClassicLayoutScope({ game, storage })).toEqual({ adopted: 0 });
		expect(set).not.toHaveBeenCalled();
	});

	// Without the Setting documents there is no way to tell an unanswered key from an answered
	// one, and guessing would clobber a real choice.
	it("does nothing when the world settings collection cannot be read", async () => {
		const set = vi.fn();
		const game = { user: { isGM: true }, settings: { storage: { get: () => null }, set } };

		expect(await adoptClassicLayoutScope({ game, storage: new FakeStorage({ [key(CHARACTER)]: "false" }) }))
			.toEqual({ adopted: 0 });
		expect(set).not.toHaveBeenCalled();
	});
});
