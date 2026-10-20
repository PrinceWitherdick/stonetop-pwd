/**
 * The Inventory tab's "+ Something else (discuss with GM)" (the user's ruling, all playbooks):
 * every playbook's Special possessions ends "______ (discuss with GM)", and the sheet takes one
 * in after onboarding too. The count and the over-limit flag are held in
 * special-possession-mechanics.test.js; this holds the sheet's control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

const typed = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock("../../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	promptForText: vi.fn(async (spec) => { typed.calls.push(spec); return typed.answer; }),
}));

const { createStonetopCharacterSheetClass } = await import("../../../module/actors/character/StonetopCharacterSheet.js");

function makeSheet({ editable = true } = {}) {
	const actor = new FakeActorBuilder().build();
	actor.id = "actor-1";
	actor.isOwner = editable;
	actor.typedActor = { addCustomPossession: vi.fn(async label => ({ slug: "custom-1", label })) };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return editable; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	return { sheet: new Sheet(), character: actor.typedActor };
}

describe("adding a write-in possession from the sheet", () => {
	beforeEach(() => { typed.answer = null; typed.calls.length = 0; });

	it("asks for the text and stores what was written", async () => {
		typed.answer = "A forged writ";
		const { sheet, character } = makeSheet();
		await sheet._onAddCustomPossession({ preventDefault() {} });
		expect(typed.calls).toHaveLength(1);
		expect(character.addCustomPossession).toHaveBeenCalledWith("A forged writ");
	});

	it("stores nothing when the prompt is closed or left empty", async () => {
		for (const answer of [null, ""]) {
			typed.answer = answer;
			const { sheet, character } = makeSheet();
			await sheet._onAddCustomPossession({ preventDefault() {} });
			expect(character.addCustomPossession).not.toHaveBeenCalled();
		}
	});

	it("is the owner's: a sheet that is not editable asks nothing", async () => {
		typed.answer = "A forged writ";
		const { sheet, character } = makeSheet({ editable: false });
		await sheet._onAddCustomPossession({ preventDefault() {} });
		expect(typed.calls).toHaveLength(0);
		expect(character.addCustomPossession).not.toHaveBeenCalled();
	});
});

describe("the control on the Inventory tab", () => {
	const hbs = read("templates/actor/partials/tab-equipment.hbs");
	const block = hbs.slice(hbs.indexOf("tab-section--possessions"));

	it("sits in the Special possessions block, only while the block is being edited", () => {
		expect(block).toMatch(/\{\{#if stonetop\.possessionsEdit\}\}\s*<button type="button" class="stonetop-possession-custom-add">/);
	});

	it("comes before the over-limit notice that an extra write-in raises", () => {
		expect(block.indexOf("stonetop-possession-custom-add")).toBeLessThan(block.indexOf("possessions.isOverLimit"));
	});

	it("has its strings in en.json", () => {
		const gear = JSON.parse(read("languages/en.json")).stonetop.character.gear;
		for (const key of ["addPossession", "addPossessionTitle", "addPossessionButton", "addPossessionPlaceholder"]) {
			expect(gear[key], key).toBeTruthy();
		}
		expect(gear.addPossession).toBe("Something else (discuss with GM)");
	});
});
