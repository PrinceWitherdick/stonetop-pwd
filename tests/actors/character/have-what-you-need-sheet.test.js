// Have What You Need on the character sheet with no undefined ◆ to draw (audit ROAD-2 / ROAD-9, the user's
// rulings E9 and E12): an empty supplies row asks where its food came from, an emptied one is picked up empty,
// an item heavier than the undefined ◆ left asks "Found it out here / Cancel", and a mark that DREW from the
// undefined pool posts a one-line card the table can veto.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const asked = vi.hoisted(() => ({ askWithButtons: vi.fn(async () => null) }));
vi.mock("../../../module/utils/ask-with-buttons.js", async importOriginal => ({ ...(await importOriginal()), ...asked }));

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");

function makeSheet({ regularMarks = 0, smallMarks = 0, supplies = { ask: false, emptied: false } } = {}) {
	const actor = {
		id: "caradoc", name: "Caradoc", type: "character", isOwner: true,
		system: { playbook: { name: "The Heavy" } },
		flags: {},
		items: [],
		getFlag: () => null,
		update: vi.fn(async () => {}),
	};
	actor.typedActor = {
		undefinedSmallMarks: smallMarks,
		undefinedRegularMarks: regularMarks,
		suppliesMarkAsk: vi.fn(() => supplies),
		getUsesPerSupply: () => 5,
	};
	const Base = class {
		get actor() { return actor; }
		get isEditable() { return true; }
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), actor };
}

function box({ slug = "rope", weight = 1, name = "Rope" } = {}) {
	return { dataset: { slug, weight: String(weight), name }, closest: () => null };
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

describe("marking an empty supplies row with no undefined ◆ (E9)", () => {
	it("asks Packed it at home / Bought it, both of which pack it", async () => {
		const { sheet } = makeSheet({ supplies: { ask: true, emptied: false } });
		asked.askWithButtons.mockImplementation(async () => "packed");
		expect(await sheet._markWithoutUndefined(box({ slug: "supplies", name: "Supplies" }))).toBe("packed");
		const { buttons } = asked.askWithButtons.mock.calls[0][0];
		expect(buttons.map(b => b.key)).toEqual(["packed", "bought", "cancel"]);
		expect(buttons.find(b => b.key === "bought").value).toBe("packed");
	});

	it("marks nothing when the ask is closed", async () => {
		const { sheet } = makeSheet({ supplies: { ask: true, emptied: false } });
		expect(await sheet._markWithoutUndefined(box({ slug: "supplies" }))).toBeNull();
	});

	it("picks an emptied row back up empty, says so, and asks nothing", async () => {
		const { sheet } = makeSheet({ supplies: { ask: false, emptied: true } });
		expect(await sheet._markWithoutUndefined(box({ slug: "supplies" }))).toBe("mark");
		expect(asked.askWithButtons).not.toHaveBeenCalled();
		expect(global.ui.notifications.info).toHaveBeenCalled();
	});

	it("never asks a supplies row the found-it question", async () => {
		const { sheet } = makeSheet();
		expect(await sheet._markWithoutUndefined(box({ slug: "more-supplies" }))).toBe("mark");
		expect(asked.askWithButtons).not.toHaveBeenCalled();
	});
});

describe("marking an item heavier than the undefined ◆ left (E12)", () => {
	it("asks Found it out here / Don't mark it", async () => {
		const { sheet } = makeSheet({ regularMarks: 1 });
		asked.askWithButtons.mockImplementation(async () => "found");
		expect(await sheet._markWithoutUndefined(box({ weight: 2 }))).toBe("found");
		expect(asked.askWithButtons.mock.calls[0][0].buttons.map(b => b.key)).toEqual(["found", "cancel"]);
	});

	it("goes ahead unasked while the undefined ◆ cover it", async () => {
		const { sheet } = makeSheet({ regularMarks: 2 });
		expect(await sheet._markWithoutUndefined(box({ weight: 2 }))).toBe("mark");
		expect(asked.askWithButtons).not.toHaveBeenCalled();
	});
});

describe("the Have What You Need card (E12)", () => {
	it("is posted when a mark drew from the undefined pool", () => {
		const { sheet } = makeSheet({ regularMarks: 1 });
		sheet._postHadAllAlong("Rope", 1, false);
		expect(global.ChatMessage.create).toHaveBeenCalledTimes(1);
		const { content } = global.ChatMessage.create.mock.calls[0][0];
		expect(content).toContain("Have What You Need");
		expect(content).toContain("Rope");
	});

	it("is not posted for a mark that drew nothing", () => {
		const { sheet } = makeSheet();
		sheet._postHadAllAlong("Rope", 0, false);
		expect(global.ChatMessage.create).not.toHaveBeenCalled();
	});
});
