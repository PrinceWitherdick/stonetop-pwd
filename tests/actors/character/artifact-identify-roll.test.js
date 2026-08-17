import { beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { ARTIFACT_STATE } from "../../../module/actors/character/artifact-identify.js";

// Identifying artifacts (Book I, Discoveries pp.430-431). Two moves, two different jobs:
//   "If they Know Things about the artifact and get a 7+, then tell them some combo of what it
//    is, what it does, what it's worth… If the artifact has a custom move, then maybe you'd give
//    them some inkling of what it does on a 7-9, and give them the move's full text on a 10+."
//   "If they Seek Insight about the artifact, resolve the move! On a 7+, answer their
//    question(s) honestly and helpfully."
// So Know Things settles the ladder and Seek Insight deliberately does not — the answers are
// the GM's to give at the table, and how much they gave away is theirs to record.

const KNOW_THINGS = {
	type: "move",
	name: "Know Things",
	system: { moveType: "basic", rollType: "int", description: "<p>When you consult your accumulated knowledge, roll +INT.</p>" },
};
const SEEK_INSIGHT = {
	type: "move",
	name: "Seek Insight",
	system: { moveType: "basic", rollType: "wis", description: "<p>When you study a situation or person, looking to the GM for insight, roll +WIS.</p>" },
};

const KNOWLEDGE = {
	id: "item-1", name: "A brass sphere", state: ARTIFACT_STATE.UNKNOWN,
	note: "magical, Value 2", hint: "It is warm to the touch", lore: "", lead: "",
};

function makeCharacterMock(rollTotal, knowledge = KNOWLEDGE) {
	return {
		rollMode: "normal",
		onDirectStatRoll:        vi.fn(async () => ({ total: rollTotal })),
		artifactKnowledge:       vi.fn(() => knowledge),
		setArtifactState:        vi.fn(async () => true),
		updateArtifactKnowledge: vi.fn(async () => true),
	};
}

function makeSheet({ rollTotal = 10, isEditable = true, items = [KNOW_THINGS, SEEK_INSIGHT], knowledge = KNOWLEDGE } = {}) {
	const actor = new FakeActorBuilder().withItems(items).build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = makeCharacterMock(rollTotal, knowledge);
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return isEditable; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	const sheet = new Sheet();
	// The chat cards are Foundry writes; the ladder is what's under test here.
	sheet._postMoveCard = vi.fn(async () => {});
	return { sheet, character: actor.typedActor };
}

// Answer the "which move?" picker with `choice`, then let any later dialog (the stat picker)
// take its default. Returns the captured dialog data for assertions on what was offered.
function captureDialog(choice) {
	const seen = [];
	global.Dialog = vi.fn(function (d) {
		seen.push(d);
		this.render = vi.fn(() => {
			// Only the first dialog is the move picker; a second one would be the stat picker,
			// which this character never triggers (it owns no Well-Read / Polyglot / Naturalist).
			if (seen.length === 1) d.buttons[choice]?.callback?.([{ querySelector: () => null }]);
		});
	});
	return seen;
}

beforeEach(() => {
	global.game.settings ??= {};
	global.game.settings.get = () => false;   // situational-modifier prompt off
	global.game.user = { isGM: false };
	global.Handlebars = { helpers: { statLabel: k => k.toUpperCase() } };
});

describe("_onArtifactIdentify — Know Things about an artifact", () => {
	it("10+ hands over everything, write-up included", async () => {
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArtifactIdentify("item-1");
		expect(character.setArtifactState).toHaveBeenCalledWith("item-1", ARTIFACT_STATE.KNOWN, { upgradeOnly: true });
	});

	it("7-9 hands over the tags and leaves the write-up owed", async () => {
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 8 });
		await sheet._onArtifactIdentify("item-1");
		expect(character.setArtifactState).toHaveBeenCalledWith("item-1", ARTIFACT_STATE.PARTIAL, { upgradeOnly: true });
	});

	it("6- settles nothing but leaves a path forward", async () => {
		// "the GM tells you nothing… but names a path". The item must be untouched — both of
		// p.430's miss branches are the GM's call — yet the table can't be left with silence, so
		// the lead (or p.431's list of ways to make one) goes to chat.
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 5 });
		await sheet._onArtifactIdentify("item-1");
		expect(character.setArtifactState).not.toHaveBeenCalled();
		expect(character.onDirectStatRoll).toHaveBeenCalledOnce();   // the roll happened, and marked XP
		expect(sheet._postMoveCard).toHaveBeenCalledOnce();
		expect(sheet._postMoveCard.mock.calls[0][1]).toMatch(/Make a Plan/);
	});

	it("prints the GM's own lead on a miss when they wrote one", async () => {
		captureDialog("know");
		const { sheet } = makeSheet({
			rollTotal: 5,
			knowledge: { ...KNOWLEDGE, lead: "Old Gorlas knows about the Fae" },
		});
		await sheet._onArtifactIdentify("item-1");
		expect(sheet._postMoveCard.mock.calls[0][1]).toMatch(/Old Gorlas/);
		expect(sheet._postMoveCard.mock.calls[0][1]).not.toMatch(/Make a Plan/);
	});

	it("rolls +INT through the normal engine with the artifact's own tier text", async () => {
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArtifactIdentify("item-1");
		const [stat, options] = character.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("int");
		expect(options.moveName).toBe("Know Things");
		expect(options.moveDescription).toContain("accumulated knowledge");
		// Present, or a GM Shift Up/Down leaves the arcana/generic text on an artifact's card.
		expect(options.moveResults.success.label).toBe("10+");
		expect(options.moveResults.partial.value).toMatch(/inkling|owed/i);
	});

	it("stamps the item on the card so a Logbook spend or a Shift can finish the job", async () => {
		// The outcome commits at roll time; the Logbook's "treat the result as a 10+" and a GM
		// Shift both rewrite the tier afterwards, and without the id there is nothing to say
		// WHICH thing the new tier is about.
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 8 });
		await sheet._onArtifactIdentify("item-1");
		const { messageFlags } = character.onDirectStatRoll.mock.calls[0][1];
		expect(messageFlags["stonetop-pwd"]).toMatchObject({ move: "Know Things", artifact: "item-1" });
	});
});

describe("_onArtifactIdentify — Seek Insight about an artifact", () => {
	it("rolls +WIS and posts the question list, without settling the ladder", async () => {
		captureDialog("seek");
		const { sheet, character } = makeSheet({ rollTotal: 10 });
		await sheet._onArtifactIdentify("item-1");
		const [stat, options] = character.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("wis");
		expect(options.moveName).toBe("Seek Insight");
		expect(character.setArtifactState).not.toHaveBeenCalled();
		expect(sheet._postMoveCard).toHaveBeenCalledOnce();
		expect(sheet._postMoveCard.mock.calls[0][1]).toMatch(/not what it appears to be/);
	});

	it("posts no questions on a miss", async () => {
		// "You're interrupted or surprised as you study" — there are no answers to ask for.
		captureDialog("seek");
		const { sheet } = makeSheet({ rollTotal: 4 });
		await sheet._onArtifactIdentify("item-1");
		expect(sheet._postMoveCard).not.toHaveBeenCalled();
	});
});

describe("_onArtifactIdentify — guards", () => {
	it("does nothing on a non-editable sheet or without an item", async () => {
		captureDialog("know");
		const locked = makeSheet({ rollTotal: 11, isEditable: false });
		await locked.sheet._onArtifactIdentify("item-1");
		expect(locked.character.onDirectStatRoll).not.toHaveBeenCalled();

		const noId = makeSheet({ rollTotal: 11 });
		await noId.sheet._onArtifactIdentify("");
		expect(noId.character.onDirectStatRoll).not.toHaveBeenCalled();
	});

	it("does nothing when the item has gone", async () => {
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 11, knowledge: null });
		await sheet._onArtifactIdentify("item-1");
		expect(character.onDirectStatRoll).not.toHaveBeenCalled();
	});

	it("ignores a second click while the first roll is still in flight", async () => {
		// The first await is a DIALOG, so an unlatched handler opened two pickers and posted two
		// rolls whose writes landed in whichever order the dice happened to settle.
		captureDialog("know");
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await Promise.all([sheet._onArtifactIdentify("item-1"), sheet._onArtifactIdentify("item-1")]);
		expect(character.onDirectStatRoll).toHaveBeenCalledOnce();
	});

	it("cancels cleanly when the player closes the move picker", async () => {
		global.Dialog = vi.fn(function (d) { this.render = vi.fn(() => d.close?.()); });
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArtifactIdentify("item-1");
		expect(character.onDirectStatRoll).not.toHaveBeenCalled();
	});
});

describe("_onArtifactGmControl — the GM's hand-over", () => {
	beforeEach(() => { global.game.user = { isGM: true }; });

	it("is refused to a player", async () => {
		global.game.user = { isGM: false };
		const { sheet, character } = makeSheet();
		await sheet._onArtifactGmControl("item-1");
		expect(character.updateArtifactKnowledge).not.toHaveBeenCalled();
	});

	// Every declared DialogV1 button closes the window, so the form has to be harvested by the
	// Save button rather than written as it's edited. `form` maps field name -> typed value.
	function pressSave(form) {
		global.Dialog = vi.fn(function (d) {
			this.render = vi.fn(() => d.buttons.save.callback([{
				querySelector: sel => ({ value: form[sel.match(/"(\w+)"/)[1]] ?? "" }),
			}]));
		});
	}

	it("writes the state and the three text fields together", async () => {
		const typed = { hint: "It thrums", lore: "It opens doors", lead: "Ask Gorlas" };
		pressSave({ ...typed, state: ARTIFACT_STATE.KNOWN });
		const { sheet, character } = makeSheet();
		await sheet._onArtifactGmControl("item-1");
		expect(character.updateArtifactKnowledge).toHaveBeenCalledWith("item-1", {
			...typed, state: ARTIFACT_STATE.KNOWN,
		});
	});

	it("can hide an artifact that nobody has hidden yet", async () => {
		pressSave({ state: ARTIFACT_STATE.UNKNOWN });
		const { sheet, character } = makeSheet({ knowledge: { ...KNOWLEDGE, state: "" } });
		await sheet._onArtifactGmControl("item-1");
		expect(character.updateArtifactKnowledge.mock.calls[0][1].state).toBe(ARTIFACT_STATE.UNKNOWN);
	});

	it("can take an artifact back to ordinary gear", async () => {
		// "Don't imply that there might be more to discover if there really isn't" (p.430) — the
		// way out of a "?" the GM put on the wrong thing.
		pressSave({ state: ARTIFACT_STATE.NONE });
		const { sheet, character } = makeSheet();
		await sheet._onArtifactGmControl("item-1");
		expect(character.updateArtifactKnowledge.mock.calls[0][1].state).toBe(ARTIFACT_STATE.NONE);
	});

	it("offers the current state as the selected rung", async () => {
		let data;
		global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
		const { sheet } = makeSheet({ knowledge: { ...KNOWLEDGE, state: ARTIFACT_STATE.PARTIAL } });
		await sheet._onArtifactGmControl("item-1");
		expect(data.content).toMatch(/<option value="partial" selected>/);
		// And the concealed tags are shown to the GM, since that's what they're deciding about.
		expect(data.content).toMatch(/magical, Value 2/);
	});
});
