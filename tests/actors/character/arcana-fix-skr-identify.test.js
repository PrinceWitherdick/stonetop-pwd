import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { applyArcanumIdentifyWrite, arcanumIdentifyState, arcanumIdentifyWrite, identifyArcanumAtTier } from "../../../module/actors/character/arcana-identify.js";
import { messageOfRoll } from "../../../module/utils/roll-engine.js";

// Arcana audit 2026-11-04, fixer SKR: SKR-5 (an identifying roll settles from the tier its card COUNTS as
// once the dice land, not the raw total, and owes no back for a card already revealed) and SKR-6 (nothing is
// written for a card the character no longer holds).

vi.mock("../../../module/dialogs/RollDialog.js", () => ({
	DEFAULT_ROLL_MODE: "normal",
	promptRoll: vi.fn(async () => ({ rollMode: "normal", modifier: 0 })),
}));
vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	messageOfRoll: vi.fn(() => null),
}));

const SLUG = "huge-wooden-sphere";
const KNOW_THINGS = { type: "move", name: "Know Things", system: { moveType: "basic", rollType: "int", description: "<p>Consult.</p>" } };

function character({ rollTotal, owned = [SLUG], identified = [], revealed = [], backOwed = [] }) {
	return {
		onDirectStatRoll:         vi.fn(async () => ({ total: rollTotal })),
		identifyArcanum:          vi.fn(async () => {}),
		identifyAndRevealArcanum: vi.fn(async () => {}),
		identifyFrontOwedArcanum: vi.fn(async () => {}),
		getArcanum:               vi.fn(async () => ({ front: { title: "A Huge Wooden Sphere" } })),
		ownedArcanaSlugs:         new Set(owned),
		identifiedArcanaSlugs:    new Set(identified),
		revealedArcanaSlugs:      new Set(revealed),
		backOwedArcanaSlugs:      new Set(backOwed),
	};
}

function sheetFor(char) {
	const actor = new FakeActorBuilder().withItems([KNOW_THINGS]).build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}

beforeEach(() => {
	messageOfRoll.mockReturnValue(null);
	global.game.settings ??= {};
	global.game.settings.get = () => false;
	global.game.user = { isGM: false };
	global.Handlebars = { helpers: { statLabel: k => k.toUpperCase() } };
});

describe("arcanumIdentifyWrite: what an identifying tier writes", () => {
	const fresh = { owned: true, identified: false, revealed: false, backOwed: false };

	it("follows p.440's ladder for a face-down card", () => {
		expect(arcanumIdentifyWrite("success", fresh)).toBe("reveal");
		expect(arcanumIdentifyWrite("critical", fresh)).toBe("reveal");
		expect(arcanumIdentifyWrite("partial", fresh)).toBe("owed");
		expect(arcanumIdentifyWrite("failure", fresh)).toBeNull();
	});

	it("owes no back for a 7-9 on a card whose back is readable already (SKR-5)", () => {
		expect(arcanumIdentifyWrite("partial", { ...fresh, revealed: true })).toBe("front");
		expect(arcanumIdentifyWrite("partial", { ...fresh, identified: true, revealed: true })).toBeNull();
	});

	it("only ever upgrades", () => {
		expect(arcanumIdentifyWrite("partial", { ...fresh, identified: true, backOwed: true })).toBeNull();
		expect(arcanumIdentifyWrite("success", { ...fresh, identified: true, backOwed: true })).toBe("reveal");
		expect(arcanumIdentifyWrite("success", { ...fresh, identified: true, revealed: true })).toBeNull();
	});

	it("writes nothing for a card the character no longer holds (SKR-6)", () => {
		expect(arcanumIdentifyWrite("success", { ...fresh, owned: false })).toBeNull();
		expect(arcanumIdentifyWrite("partial", { ...fresh, owned: false })).toBeNull();
	});

	it("reads the state off the character and makes the write", async () => {
		const char = character({ rollTotal: 0, revealed: [SLUG] });
		expect(arcanumIdentifyState(char, SLUG)).toEqual({ owned: true, identified: false, revealed: true, backOwed: false });
		expect(await applyArcanumIdentifyWrite(char, SLUG, "front", { stonetopMove: "Know Things" })).toBe(true);
		expect(char.identifyArcanum).toHaveBeenCalledWith(SLUG, { stonetopMove: "Know Things" });
		expect(await applyArcanumIdentifyWrite(char, SLUG, null)).toBe(false);
		// The three in one: a 7-9 on a card whose back is readable writes the front only.
		char.identifyArcanum.mockClear();
		expect(await identifyArcanumAtTier(char, SLUG, "partial", { stonetopMove: "Know Things" })).toBe(true);
		expect(char.identifyArcanum).toHaveBeenCalledWith(SLUG, { stonetopMove: "Know Things" });
		expect(await identifyArcanumAtTier(char, SLUG, "failure")).toBe(false);
	});
});

describe("the Identify button settles from the card as it counts once the dice land", () => {
	const card = total => ({ rolls: [{ total }], getFlag: () => null });

	it("a 7-9 lifted to a 10+ while the dice rolled reads as the 10+, not a back owed", async () => {
		const char = character({ rollTotal: 8 });
		messageOfRoll.mockReturnValue(card(10));
		await sheetFor(char)._onArcanumKnowThings(SLUG);
		expect(char.identifyAndRevealArcanum).toHaveBeenCalledWith(SLUG, { stonetopMove: "Know Things" });
		expect(char.identifyFrontOwedArcanum).not.toHaveBeenCalled();
	});

	it("a 10+ taken down to a 9 meanwhile reads as the 7-9", async () => {
		const char = character({ rollTotal: 10 });
		messageOfRoll.mockReturnValue(card(9));
		await sheetFor(char)._onArcanumKnowThings(SLUG);
		expect(char.identifyFrontOwedArcanum).toHaveBeenCalled();
		expect(char.identifyAndRevealArcanum).not.toHaveBeenCalled();
	});

	it("a 7-9 on a card already revealed reads the front only, owing nothing", async () => {
		const char = character({ rollTotal: 8, revealed: [SLUG] });
		await sheetFor(char)._onArcanumKnowThings(SLUG);
		expect(char.identifyArcanum).toHaveBeenCalledWith(SLUG, { stonetopMove: "Know Things" });
		expect(char.identifyFrontOwedArcanum).not.toHaveBeenCalled();
	});

	it("writes nothing when the card was removed before the dice landed", async () => {
		const char = character({ rollTotal: 11, owned: [] });
		await sheetFor(char)._onArcanumKnowThings(SLUG);
		expect(char.identifyAndRevealArcanum).not.toHaveBeenCalled();
		expect(char.identifyArcanum).not.toHaveBeenCalled();
	});
});
