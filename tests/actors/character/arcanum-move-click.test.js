import { beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

// A mystery on an arcanum's back is a move, and the arcana tab now treats it as one: clicking
// its name posts it to chat, or opens the same dialog a playbook move's name opens. These cover
// the fork that click takes — which is the whole of the behaviour a player sees.

const FIRST_LIGHT = {
	slug: "first-light",
	name: "FIRST LIGHT",
	boxIndex: 0,
	description: "<p>When you <em>strike the flint</em>, roll +CON.</p><ul><li>It burns bright</li></ul>",
	listHtml: "<ul><li>It burns bright</li></ul>",
	roll: "con",
	picks: ["It burns bright"],
	picksLabel: "Choose:",
	cardTitle: "Mysteries of the Card",
	learned: true,
};

const EMBER = {
	slug: "ember",
	name: "EMBER",
	boxIndex: 1,
	description: "<p>The coals stay warm until morning.</p>",
	listHtml: "",
	roll: null,
	picks: [],
	picksLabel: "",
	cardTitle: "Mysteries of the Card",
	learned: true,
};

function makeSheet({ move = FIRST_LIGHT, isEditable = true } = {}) {
	const getArcanumMove = vi.fn(async () => move);
	const actor = { name: "Corvin", typedActor: { getArcanumMove } };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return isEditable; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	return { sheet, getArcanumMove };
}

beforeEach(() => {
	global.ui = { notifications: { warn: vi.fn() } };
	global.ChatMessage = {
		create: vi.fn(async data => data),
		getSpeaker: vi.fn(() => ({ alias: "Corvin" })),
	};
});

describe("_arcanumMoveGuide", () => {
	it("shows the move's own text and offers its options as ticks", () => {
		const { sheet } = makeSheet();
		const guide = sheet._arcanumMoveGuide(FIRST_LIGHT);
		expect(guide.picks).toEqual(["It burns bright"]);
		expect(guide.picksLabel).toBe("Choose:");
		expect(guide.bodyHtml).toContain("strike the flint");
		// The list renders as ticks below, so the printed copy of it is dropped from the body.
		expect(guide.bodyHtml).not.toContain("<li>It burns bright</li>");
		// …but the card that gets posted keeps the move exactly as the card prints it.
		expect(guide.card).toBe(FIRST_LIGHT.description);
	});

	it("carries the move's roll once its □ is marked", () => {
		const { sheet } = makeSheet();
		expect(sheet._arcanumMoveGuide(FIRST_LIGHT).roll).toBe("con");
	});

	it("withholds the roll from a mystery not yet learned", () => {
		const { sheet } = makeSheet();
		expect(sheet._arcanumMoveGuide({ ...FIRST_LIGHT, learned: false }).roll).toBeNull();
	});

	it("withholds the roll from an observer, who may still read and post it", () => {
		const { sheet } = makeSheet({ isEditable: false });
		const guide = sheet._arcanumMoveGuide(FIRST_LIGHT);
		expect(guide.roll).toBeNull();
		expect(guide.post).toBeTruthy();
	});
});

describe("_onArcanumMoveName", () => {
	it("opens the move's dialog when there is something to roll or choose", async () => {
		const { sheet, getArcanumMove } = makeSheet();
		sheet._openGuidedCharacterMove = vi.fn();
		await sheet._onArcanumMoveName("mystery-card", "first-light");
		expect(getArcanumMove).toHaveBeenCalledWith("mystery-card", "first-light");
		expect(sheet._openGuidedCharacterMove).toHaveBeenCalledOnce();
		const [{ name, guide }, rollable] = sheet._openGuidedCharacterMove.mock.calls[0];
		expect(name).toBe("FIRST LIGHT");
		expect(guide.roll).toBe("con");
		// An arcanum move has no owned Item behind it, so it rolls through the guide's own stat.
		expect(rollable).toBeNull();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("posts straight to chat when the move is pure text", async () => {
		const { sheet } = makeSheet({ move: EMBER });
		sheet._openGuidedCharacterMove = vi.fn();
		await sheet._onArcanumMoveName("mystery-card", "ember");
		expect(sheet._openGuidedCharacterMove).not.toHaveBeenCalled();
		expect(ChatMessage.create).toHaveBeenCalledOnce();
		const { content } = ChatMessage.create.mock.calls[0][0];
		expect(content).toContain("EMBER");
		expect(content).toContain("The coals stay warm until morning.");
	});

	it("still opens the dialog for an unlearned mystery that has options to read", async () => {
		const { sheet } = makeSheet({ move: { ...FIRST_LIGHT, learned: false } });
		sheet._openGuidedCharacterMove = vi.fn();
		await sheet._onArcanumMoveName("mystery-card", "first-light");
		expect(sheet._openGuidedCharacterMove).toHaveBeenCalledOnce();
		expect(sheet._openGuidedCharacterMove.mock.calls[0][0].guide.roll).toBeNull();
	});

	it("warns rather than throwing when the move is gone from the card", async () => {
		const { sheet } = makeSheet({ move: null });
		sheet._openGuidedCharacterMove = vi.fn();
		await sheet._onArcanumMoveName("mystery-card", "vanished");
		expect(ui.notifications.warn).toHaveBeenCalledOnce();
		expect(sheet._openGuidedCharacterMove).not.toHaveBeenCalled();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});
});

describe("_postGuidedCharacterMove — an arcanum move posts as a move card", () => {
	// The suite runs without a DOM, so the dialog's form stands in as the two things the
	// method actually asks of it: a root that can find it, and its ticked entries.
	function formHtml(checked = []) {
		const entries = checked.map((value, i) => [`pick.${i}`, value]);
		global.FormData = class { constructor(form) { this._entries = form.entries; }
			[Symbol.iterator]() { return this._entries[Symbol.iterator](); } };
		return [{ querySelector: () => ({ entries }) }];
	}

	it("posts the move's printed text, with what was ticked beneath it", async () => {
		const { sheet } = makeSheet();
		const guide = sheet._arcanumMoveGuide(FIRST_LIGHT);
		await sheet._postGuidedCharacterMove("FIRST LIGHT", guide, formHtml(["It burns bright"]));
		const { content } = ChatMessage.create.mock.calls[0][0];
		expect(content).toContain("FIRST LIGHT");
		expect(content).toContain("strike the flint");
		expect(content).toContain("<li>It burns bright</li>");
	});

	it("posts the move alone when nothing was ticked", async () => {
		const { sheet } = makeSheet();
		const guide = sheet._arcanumMoveGuide(FIRST_LIGHT);
		await sheet._postGuidedCharacterMove("FIRST LIGHT", guide, formHtml());
		const { content } = ChatMessage.create.mock.calls[0][0];
		expect(content).toContain("strike the flint");
		expect(content).not.toContain("stonetop-arcanum-move-picks");
	});
});
