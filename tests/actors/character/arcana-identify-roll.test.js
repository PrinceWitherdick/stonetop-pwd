import { beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { promptRoll } from "../../../module/dialogs/RollDialog.js";

// Every move roll opens the pre-roll prompt now — Advantage / Normal / Disadvantage plus a
// one-off modifier, fresh each time (module/dialogs/RollDialog.js). It has its own tests; here
// it is stubbed so the identify ladder under test is what these assertions see, and so the
// `global.Dialog` captures below only ever catch the pickers they were written for.
vi.mock("../../../module/dialogs/RollDialog.js", () => ({
	DEFAULT_ROLL_MODE: "normal",
	promptRoll: vi.fn(async () => ({ rollMode: "normal", modifier: 0 })),
}));

// Identifying an arcanum by Knowing Things about it (Book I, Discoveries p.440):
//   "on a 10+, give them the card and have them read both sides; on a 7-9, have them read the
//    front, and show them the back when they have some time to study it or learn more; on a 6-,
//    either have them read the front and then have something bad happen, or hint at the
//    arcanum's power and tell them how they could learn more."
// The two hits write themselves; the miss deliberately writes nothing, because both of its
// branches are the GM's call (and the GM's own "Give the card" button covers the first).

const KNOW_THINGS = {
	type: "move",
	name: "Know Things",
	system: { moveType: "basic", rollType: "int", description: "<p>When you consult your accumulated knowledge, roll +INT.</p>" },
};

const named = name => ({ type: "move", name, system: { description: `<p>${name} does a thing.</p>` } });

function makeCharacterMock(rollTotal) {
	return {
		onDirectStatRoll:          vi.fn(async () => ({ total: rollTotal })),
		identifyArcanum:           vi.fn(async () => {}),
		identifyAndRevealArcanum:  vi.fn(async () => {}),
		identifyFrontOwedArcanum:  vi.fn(async () => {}),
		revealArcanum:             vi.fn(async () => {}),
		getArcanum:                vi.fn(async () => ({ front: { title: "A Huge Wooden Sphere" } })),
	};
}

// `rollMode` here is what the PLAYER answers the pre-roll prompt with — the base the move's own
// advantage is then applied on top of, which is the pairing p.230 turns on.
function makeSheet({ rollTotal = 10, isEditable = true, items = [KNOW_THINGS], rollMode = "normal" } = {}) {
	promptRoll.mockResolvedValue({ rollMode, modifier: 0 });
	const actor = new FakeActorBuilder().withItems(items).build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = makeCharacterMock(rollTotal);
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return isEditable; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), character: actor.typedActor };
}

beforeEach(() => {
	promptRoll.mockResolvedValue({ rollMode: "normal", modifier: 0 });
	global.game.settings ??= {};
	global.game.settings.get = () => false;
	global.game.user = { isGM: false };
	global.Handlebars = { helpers: { statLabel: k => k.toUpperCase() } };
});

// Capture the picker Dialog and answer it, mimicking Foundry's jQuery-ish `html` argument.
function captureDialog() {
	let data;
	global.Dialog = vi.fn(function (d) { data = d; this.render = vi.fn(); });
	return {
		get data() { return data; },
		press: (key, { advantage = false } = {}) => {
			const root = { querySelector: sel => (sel === ".stonetop-identify-adv" ? { checked: advantage } : null) };
			return data.buttons[key].callback([root]);
		},
	};
}

describe("_onArcanumKnowThings — the p.440 identify ladder", () => {
	it("10+ hands over both sides", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(character.identifyAndRevealArcanum).toHaveBeenCalledWith("huge-wooden-sphere", { stonetopMove: "Know Things" });
		expect(character.identifyFrontOwedArcanum).not.toHaveBeenCalled();
		expect(character.identifyArcanum).not.toHaveBeenCalled();
	});

	it("7-9 hands over the front and owes the back", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 8 });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(character.identifyFrontOwedArcanum).toHaveBeenCalledWith("huge-wooden-sphere", { stonetopMove: "Know Things" });
		expect(character.identifyAndRevealArcanum).not.toHaveBeenCalled();
	});

	it("6- turns nothing over — both of its branches are the GM's call", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 5 });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(character.identifyAndRevealArcanum).not.toHaveBeenCalled();
		expect(character.identifyFrontOwedArcanum).not.toHaveBeenCalled();
		expect(character.identifyArcanum).not.toHaveBeenCalled();
		expect(character.onDirectStatRoll).toHaveBeenCalledOnce();   // the roll still happened (and marked XP)
	});

	it("rolls +INT through the normal engine, carrying the arcana-specific outcomes", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		const [stat, options] = character.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("int");
		expect(options.moveName).toBe("Know Things");
		// The "?" toggle shows the character's own copy of the move, not a stub.
		expect(options.moveDescription).toContain("accumulated knowledge");
		// moveResults must be present or a GM Shift Up/Down leaves stale tier text on the card.
		expect(options.moveResults.success.label).toBe("10+");
		expect(options.moveResults.partial.value).toMatch(/read the front/i);
		expect(options.moveResults.failure.value).toMatch(/learn more/i);
	});

	it("falls back to the trigger sentence when the sheet somehow lacks the move", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 11, items: [] });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(character.onDirectStatRoll.mock.calls[0][1].moveDescription).toContain("accumulated knowledge");
	});

	it("does nothing on a non-editable sheet or without a slug", async () => {
		const locked = makeSheet({ rollTotal: 11, isEditable: false });
		await locked.sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(locked.character.onDirectStatRoll).not.toHaveBeenCalled();

		const noSlug = makeSheet({ rollTotal: 11 });
		await noSlug.sheet._onArcanumKnowThings("");
		expect(noSlug.character.onDirectStatRoll).not.toHaveBeenCalled();
	});

	/**
	 * The outcome is committed here, at roll time — but the Logbook ("expend a use … treat the
	 * result as a 10+") and a GM Shift both rewrite the card's tier afterwards. Without the slug on
	 * the message there is nothing left to say WHICH card the new tier is about, so the upgraded
	 * card claimed "You read the card, front and back" over an arcanum still owing its back.
	 */
	it("stamps the arcanum on the card, so a later tier rewrite can finish the job", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 8 });
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		const { messageFlags } = character.onDirectStatRoll.mock.calls[0][1];
		expect(messageFlags["stonetop-pwd"]).toMatchObject({ move: "Know Things", arcanum: "huge-wooden-sphere" });
	});

	/**
	 * Nothing before the first await does more than stop the event, and that first await is a
	 * dialog — so two quick clicks opened two pickers, posted two roll cards and wrote this card's
	 * flags twice, in whichever order the two rolls happened to land.
	 */
	it("latches while a roll is in flight, and re-arms once it lands", async () => {
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		const pending = [];
		character.onDirectStatRoll = vi.fn(() => new Promise(res => pending.push(() => res({ total: 11 }))));

		const first  = sheet._onArcanumKnowThings("huge-wooden-sphere");
		const second = sheet._onArcanumKnowThings("huge-wooden-sphere");
		// A DIFFERENT card is a real second action and must still go through.
		const other  = sheet._onArcanumKnowThings("the-key");
		await second;
		expect(character.onDirectStatRoll).toHaveBeenCalledTimes(2);

		pending.forEach(release => release());
		await Promise.all([first, other]);

		// Landed — so the same card is askable again.
		const after = character.onDirectStatRoll = vi.fn(async () => ({ total: 11 }));
		await sheet._onArcanumKnowThings("huge-wooden-sphere");
		expect(after).toHaveBeenCalledTimes(1);
	});
});

// Well-Read, Polyglot and Naturalist all bend a Know Things roll, and all three trigger on
// fiction the system can't see, so the player is asked rather than told.
describe("the moves that bend the identify roll", () => {
	it("does not interrupt a character who owns none of them", async () => {
		const dialog = captureDialog();
		const { sheet, character } = makeSheet({ rollTotal: 11 });
		await sheet._onArcanumKnowThings("the-key");
		expect(global.Dialog).not.toHaveBeenCalled();
		expect(dialog.data).toBeUndefined();
		expect(character.onDirectStatRoll.mock.calls[0][0]).toBe("int");
	});

	it("offers Well-Read's +WIS alongside +INT, and rolls whichever is picked", async () => {
		const dialog = captureDialog();
		const { sheet, character } = makeSheet({ rollTotal: 11, items: [KNOW_THINGS, named("Well-Read")] });
		const pending = sheet._onArcanumKnowThings("the-key");
		expect(Object.keys(dialog.data.buttons)).toEqual(["int", "wis", "cancel"]);
		expect(dialog.data.content).toContain("Well-Read does a thing.");   // the move is quoted
		await dialog.press("wis");
		await pending;
		expect(character.onDirectStatRoll.mock.calls[0][0]).toBe("wis");
	});

	it("takes Polyglot's advantage only when the player claims it", async () => {
		for (const [claimed, expected] of [[true, "adv"], [false, "normal"]]) {
			const dialog = captureDialog();
			const { sheet, character } = makeSheet({ rollTotal: 11, items: [KNOW_THINGS, named("Polyglot")] });
			const pending = sheet._onArcanumKnowThings("the-key");
			await dialog.press("int", { advantage: claimed });
			await pending;
			expect(character.onDirectStatRoll.mock.calls[0][1].rollMode).toBe(expected);
		}
	});

	// The player answered the pre-roll prompt with Disadvantage; Naturalist's advantage cancels
	// it rather than replacing it, which is the whole of p.230.
	it("cancels advantage against disadvantage instead of overriding it (p.230)", async () => {
		const dialog = captureDialog();
		const { sheet, character } = makeSheet({ rollTotal: 11, rollMode: "dis", items: [KNOW_THINGS, named("Naturalist")] });
		const pending = sheet._onArcanumKnowThings("the-key");
		await dialog.press("int", { advantage: true });
		await pending;
		expect(character.onDirectStatRoll.mock.calls[0][1].rollMode).toBe("normal");
	});

	it("aborts the whole roll when the picker is cancelled", async () => {
		const dialog = captureDialog();
		const { sheet, character } = makeSheet({ rollTotal: 11, items: [KNOW_THINGS, named("Polyglot")] });
		const pending = sheet._onArcanumKnowThings("the-key");
		await dialog.press("cancel");
		await pending;
		expect(character.onDirectStatRoll).not.toHaveBeenCalled();
		expect(character.identifyAndRevealArcanum).not.toHaveBeenCalled();
	});
});

describe("_onArcanumGiveCard — the GM's no-roll hand-over", () => {
	it("is inert for a player", () => {
		const { sheet, character } = makeSheet();
		global.Dialog = vi.fn(function () { this.render = vi.fn(); });
		sheet._onArcanumGiveCard("huge-wooden-sphere");
		expect(global.Dialog).not.toHaveBeenCalled();
		expect(character.identifyAndRevealArcanum).not.toHaveBeenCalled();
	});

	it("offers the GM front-and-back or front-only, writing the matching tier", async () => {
		global.game.user = { isGM: true };
		const { sheet, character } = makeSheet();
		let captured;
		global.Dialog = vi.fn(function (data) { captured = data; this.render = vi.fn(); });
		sheet._onArcanumGiveCard("huge-wooden-sphere");

		await captured.buttons.both.callback();
		expect(character.identifyAndRevealArcanum).toHaveBeenCalledWith("huge-wooden-sphere", { stonetopMove: "Give the card" });

		await captured.buttons.front.callback();
		expect(character.identifyArcanum).toHaveBeenCalledWith("huge-wooden-sphere", { stonetopMove: "Give the card" });
	});
});

describe("_onArcanumStudyBack — settling the 7-9's owed back", () => {
	it("reveals the back outright when the GM clicks it", async () => {
		global.game.user = { isGM: true };
		const { sheet, character } = makeSheet();
		await sheet._onArcanumStudyBack("huge-wooden-sphere");
		expect(character.revealArcanum).toHaveBeenCalledWith("huge-wooden-sphere", { stonetopMove: "Study it" });
	});

	it("only asks, when the owner clicks it — the reveal stays the GM's to make", async () => {
		const { sheet, character } = makeSheet();
		const posted = vi.spyOn(sheet, "_postMoveCard").mockResolvedValue(undefined);
		await sheet._onArcanumStudyBack("huge-wooden-sphere");
		expect(character.revealArcanum).not.toHaveBeenCalled();
		expect(posted).toHaveBeenCalledOnce();
		expect(posted.mock.calls[0][1]).toContain("A Huge Wooden Sphere");
	});
});
