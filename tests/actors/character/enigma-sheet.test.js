// The Itinerant Mystic's Enigma on the character sheet (enigma.js): Have What You Need's "Spend 1 Enigma" for an
// item of Value 1 or less, and the Details tab's "Return when needed" and "Back from wandering" buttons.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { lookup } from "../../fakes/i18n.js";

const asked = vi.hoisted(() => ({ askWithButtons: vi.fn(async () => null) }));
vi.mock("../../../module/utils/ask-with-buttons.js", async importOriginal => ({ ...(await importOriginal()), ...asked }));

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");
const { ENIGMA_KEY, ENIGMA_MAX } = await import("../../../module/actors/character/enigma.js");

const SCOPE = "stonetop-pwd";

function makeSheet({ background = "itinerant-mystic", enigma = 2, smallMarks = 0, regularMarks = 0, items = [] } = {}) {
	const resources = { [ENIGMA_KEY]: enigma };
	const actor = {
		id: "ysolde", name: "Ysolde", type: "character", isOwner: true,
		system: { playbook: { name: "The Lightbearer" } },
		flags: { [SCOPE]: { background: { selected: background, setupResources: resources } } },
		items: new Map(items.map(i => [i._id, i])),
		getFlag: () => null,
		update: vi.fn(async () => {}),
	};
	actor.typedActor = {
		background: { setSetupResource: vi.fn(async (key, value) => { resources[key] = value; }) },
		undefinedSmallMarks: smallMarks,
		undefinedRegularMarks: regularMarks,
		supplyPurses: vi.fn(() => ({ eligible: [], ineligible: [], total: 0 })),
		toggleCarriedItem: vi.fn(async () => {}),
	};
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return true; }
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), actor, resources };
}

// One inventory checkbox, as inv-item-*.hbs draws it.
function box({ slug = "rope", weight = 1, loot = false, treasure = false } = {}) {
	return {
		dataset: { slug, weight: String(weight), ...(loot ? { loot: "true" } : {}) },
		closest: sel => (sel === ".stonetop-inv-treasure" ? (treasure ? {} : null) : null),
	};
}

let saved;
beforeEach(() => {
	saved = { ChatMessage: global.ChatMessage, ui: global.ui };
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	asked.askWithButtons.mockReset();
	asked.askWithButtons.mockImplementation(async () => null);
});
afterEach(() => {
	global.ChatMessage = saved.ChatMessage;
	global.ui = saved.ui;
});

describe("Have What You Need: which marks offer an Enigma", () => {
	it("offers it only when the undefined pool can't pay for the mark", () => {
		expect(makeSheet({ smallMarks: 0 }).sheet._enigmaForItemMark(box(), true)).toBe(2);
		expect(makeSheet({ smallMarks: 1 }).sheet._enigmaForItemMark(box(), true)).toBe(0);
		expect(makeSheet({ regularMarks: 1 }).sheet._enigmaForItemMark(box({ weight: 2 }), false)).toBe(2);
		expect(makeSheet({ regularMarks: 2 }).sheet._enigmaForItemMark(box({ weight: 2 }), false)).toBe(0);
	});

	it("never for loot, a treasure, or an item over Value 1", () => {
		const items = [
			{ _id: "w1", system: { note: "<em>fragile</em>, Value 1" } },
			{ _id: "w2", system: { note: "Value 2" } },
		];
		const { sheet } = makeSheet({ items });
		expect(sheet._enigmaForItemMark(box({ loot: true }), true)).toBe(0);
		expect(sheet._enigmaForItemMark(box({ treasure: true }), true)).toBe(0);
		expect(sheet._enigmaForItemMark(box({ slug: "w1" }), true)).toBe(2);
		expect(sheet._enigmaForItemMark(box({ slug: "w2" }), true)).toBe(0);
	});

	it("never for a character who is not an Itinerant Mystic, or holds none", () => {
		expect(makeSheet({ background: "auspicious-birth" }).sheet._enigmaForItemMark(box(), true)).toBe(0);
		expect(makeSheet({ enigma: 0 }).sheet._enigmaForItemMark(box(), true)).toBe(0);
	});
});

describe("Have What You Need: a small item past the allotment, paid in Enigma", () => {
	const column = (allotment, ticked) => ({ dataset: { smallAllotment: String(allotment) }, querySelectorAll: () => ({ length: ticked }) });

	it("adds a Spend 1 Enigma answer, which spends one and posts it", async () => {
		asked.askWithButtons.mockImplementation(async () => "enigma");
		const { sheet, resources } = makeSheet({ enigma: 2 });
		expect(await sheet._haveExtraSmallItem(column(4, 5), "Pocket mirror", 2)).toBe("enigma");
		const { buttons } = asked.askWithButtons.mock.calls[0][0];
		expect(buttons.map(b => b.key)).toContain("enigma");
		expect(resources[ENIGMA_KEY]).toBe(1);
		expect(global.ChatMessage.create).toHaveBeenCalled();
	});

	it("leaves the answer out with no Enigma to offer", async () => {
		const { sheet } = makeSheet();
		await sheet._haveExtraSmallItem(column(4, 5), "Pocket mirror", 0);
		expect(asked.askWithButtons.mock.calls[0][0].buttons.map(b => b.key)).not.toContain("enigma");
	});
});

describe("Details tab: Return when needed", () => {
	it("spends 1 Enigma, says so, and opens the Outfit window", async () => {
		const { sheet, resources } = makeSheet({ enigma: 2 });
		sheet._onOutfitOpen = vi.fn(async () => {});
		await sheet._onEnigmaReturn();
		expect(resources[ENIGMA_KEY]).toBe(1);
		expect(global.ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(sheet._onOutfitOpen).toHaveBeenCalled();
	});

	it("does nothing with none held", async () => {
		const { sheet } = makeSheet({ enigma: 0 });
		sheet._onOutfitOpen = vi.fn(async () => {});
		await sheet._onEnigmaReturn();
		expect(sheet._onOutfitOpen).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalled();
	});
});

describe("Details tab: Back from wandering", () => {
	it("asks days / weeks / months and adds 1 / 2 / 3", async () => {
		asked.askWithButtons.mockImplementation(async () => "weeks");
		const { sheet, resources } = makeSheet({ enigma: 2 });
		await sheet._onEnigmaWander();
		expect(asked.askWithButtons.mock.calls[0][0].buttons.map(b => b.value)).toEqual(["days", "weeks", "months", null]);
		expect(resources[ENIGMA_KEY]).toBe(4);
		expect(global.ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("caps the gain at the track's size", async () => {
		asked.askWithButtons.mockImplementation(async () => "months");
		const { sheet, resources } = makeSheet({ enigma: ENIGMA_MAX - 1 });
		await sheet._onEnigmaWander();
		expect(resources[ENIGMA_KEY]).toBe(ENIGMA_MAX);
	});

	it("changes nothing when the window is closed", async () => {
		const { sheet, resources } = makeSheet({ enigma: 2 });
		await sheet._onEnigmaWander();
		expect(resources[ENIGMA_KEY]).toBe(2);
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("the Enigma strings", () => {
	it("every key the buttons and windows read is in en.json", () => {
		const keys = [
			"title", "none",
			"knowThings.button", "knowThings.empty", "knowThings.tooltip", "knowThings.spent",
			"item.title", "item.body", "item.smallMarks", "item.regularMarks", "item.spend", "item.skip", "item.receipt",
			"return.button", "return.tooltip", "return.chat",
			"wander.button", "wander.tooltip", "wander.title", "wander.body", "wander.days", "wander.weeks", "wander.months",
			"wander.cancel", "wander.lengths.days", "wander.lengths.weeks", "wander.lengths.months", "wander.chat", "wander.capped",
		];
		for (const key of keys) expect(typeof lookup(`stonetop.lightbearer.enigma.${key}`), key).toBe("string");
	});
});
