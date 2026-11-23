import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import Handlebars from "handlebars";
import { readRepo as read } from "../../fakes/css.js";
import { characterPlanStore } from "../../../module/actors/character/character-plans.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { plansView, removePlan, savePlan, setRequirementDone } from "../../../module/actors/steading/steading-plans.js";

// A character keeps plans of their own (Make a Plan, Book I p.530: "Give the list to the player who's making
// the plan, or put it somewhere public for everyone to see"): Stonetop's Plans section on the Notes tab, the
// same partial and the same code, kept in the character's `plans` flag. Asked for after a GM's first session
// (2026-11-22): the Blessed made a plan and there was nowhere on the sheet to tick its requirements off.

/** A character whose flag updates land where getFlag reads them, as the document's would. */
function character(plans) {
	const flags = plans === undefined ? {} : { plans: structuredClone(plans) };
	const actor = {
		id: "c1", uuid: "Actor.c1",
		getFlag: (scope, key) => (scope === STONETOP_SCOPE ? flags[key] : undefined),
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) flags[key.replace(`flags.${STONETOP_SCOPE}.`, "")] = value;
		}),
	};
	return { actor, flags };
}

const plan = (over = {}) => ({ id: "p1", name: "Cleanse the corrupted tree", undone: "", requirements: [], ...over });

describe("a character's plans", () => {
	it("are written, ticked and removed through Stonetop's plan code, into the plans flag", async () => {
		const { actor, flags } = character();
		const store = characterPlanStore(actor);
		expect(store._flags.plans).toEqual([]);
		await savePlan(store, { id: "p1", name: " Cleanse the corrupted tree ", requirements: [{ text: "Find what lies below" }], undone: "" });
		expect(flags.plans).toEqual([plan({ requirements: [{ text: "Find what lies below", done: false }] })]);
		expect(store._flags.plans).toBe(flags.plans);
		// Whose plans they are, so the editor's window for a new one is this character's own.
		expect(store.actorId).toBe("c1");

		await setRequirementDone(store, "p1", 0, true);
		expect(flags.plans[0].requirements).toEqual([{ text: "Find what lies below", done: true }]);

		await removePlan(store, "p1");
		expect(flags.plans).toEqual([]);
		expect(actor.update).toHaveBeenCalledTimes(3);
		expect(Object.keys(actor.update.mock.calls[0][0])).toEqual([`flags.${STONETOP_SCOPE}.plans`]);
	});

	it("never changes the stored rows in place before the write", async () => {
		const { actor, flags } = character([plan({ requirements: [{ text: "Find what lies below", done: false }] })]);
		const before = flags.plans;
		actor.update.mockImplementation(async () => {});
		await setRequirementDone(characterPlanStore(actor), "p1", 0, true);
		expect(before[0].requirements[0].done).toBe(false);
		expect(actor.update.mock.calls[0][0][`flags.${STONETOP_SCOPE}.plans`][0].requirements[0].done).toBe(true);
	});

	it("writes nothing when nothing changed", async () => {
		const { actor } = character([plan({ requirements: [{ text: "Find what lies below", done: true }] })]);
		expect(await setRequirementDone(characterPlanStore(actor), "p1", 0, true)).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});

	// Read inside the turn: two ticks pressed before the first write lands both stay ticked.
	it("lands two quick ticks, each starting from the other's rows", async () => {
		const { actor, flags } = character([plan({ requirements: [{ text: "a", done: false }, { text: "b", done: false }] })]);
		const store = characterPlanStore(actor);
		await Promise.all([setRequirementDone(store, "p1", 0, true), setRequirementDone(store, "p1", 1, true)]);
		expect(flags.plans[0].requirements.map(r => r.done)).toEqual([true, true]);
		expect(actor.update).toHaveBeenCalledTimes(2);
	});
});

describe("the character's Notes tab", () => {
	const TAB = read("templates/actor/partials/tab-notes.hbs");
	const PARTIAL = read("templates/actor/partials/steading-plans.hbs");
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");

	/** The tab as Foundry compiles it: no compat mode, the system's partial, `concat` and `localize`. */
	function render(stonetop) {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.steading-plans", PARTIAL);
		hb.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
		hb.registerHelper("localize", key => key);
		const doc = new Window().document;
		doc.body.innerHTML = hb.compile(TAB)({ actor: { id: "c1" }, stonetop: { notes: "", enrichedNotes: "", ...stonetop } });
		return doc.body;
	}

	it("draws the plans above the notes editor, which keeps the class its save handler and theme key on", () => {
		expect(TAB).toMatch(/\{\{> "stonetop\.steading-plans" plans=stonetop\.plans canEdit=stonetop\.canEdit /);
		expect(TAB.indexOf("stonetop.steading-plans")).toBeLessThan(TAB.indexOf("character-notes-editor"));
		const tab = render({ canEdit: true, plans: plansView([plan({ requirements: [{ text: "Find what lies below", done: false }] })]) });
		expect(tab.querySelector(".character-notes > .steading-plans")).not.toBeNull();
		expect(tab.querySelector("h3.steading-notes-heading").id).toBe("character-plans-title-c1");
		expect(tab.querySelector(".steading-plan-name").textContent).toBe("Cleanse the corrupted tree");
		expect(tab.querySelectorAll('[data-plan-action="edit-plan"], [data-plan-action="remove-plan"], [data-plan-action="add-plan"]')).toHaveLength(3);
		expect(tab.querySelector("prose-mirror.character-notes-editor")).not.toBeNull();
	});

	it("shows an empty list and New plan to an owner, and a reader the plans with no controls", () => {
		const owner = render({ canEdit: true, plans: [] });
		expect(owner.querySelector(".steading-plans-empty").textContent).toBe("No plans yet.");
		expect(owner.querySelector('[data-plan-action="add-plan"]')).not.toBeNull();
		const reader = render({ canEdit: false, plans: plansView([plan({ requirements: [{ text: "a", done: true }] })]) });
		expect(reader.querySelectorAll("[data-plan-action]")).toHaveLength(0);
		expect(reader.querySelector("[data-plan-tick]").disabled).toBe(true);
	});

	it("points at the steading's plans only when the world has a steading", () => {
		const pointer = render({ canEdit: false, plans: [], steadingName: "Stonetop" }).querySelector("[data-open-steading-plans]");
		expect(pointer.textContent.trim()).toBe("Stonetop's plans");
		expect(pointer.classList.contains("stonetop-inline-btn")).toBe(true);
		expect(render({ canEdit: true, plans: [], steadingName: "" }).querySelector("[data-open-steading-plans]")).toBeNull();
	});

	it("is filled and wired by the sheet: plans from the flag, the editor for writers, the pointer for all", () => {
		expect(SHEET).toContain("context.stonetop.plans = plansView(characterPlanStore(this.actor)._flags.plans);");
		expect(SHEET).toContain("context.stonetop.steadingName = getStonetopSteadingActor()?.name ?? \"\";");
		const wired = SHEET.indexOf('wireSteadingNotesTab(html[0], store, { within: ".character-notes", editPlan: planId => editSteadingPlan(store, planId) });');
		expect(wired).toBeGreaterThan(-1);
		expect(SHEET.slice(wired - 120, wired)).toContain("if (this.isEditable) {");
		expect(SHEET).toContain('html[0].querySelector("[data-open-steading-plans]")?.addEventListener("click", () => openSteadingPlans());');
	});

	// Using the move IS making the plan: the GM's requirements need writing down with tick boxes (p.530).
	it("opens the plan editor when Make a Plan or a learned Arcane Adept is used, for whoever may write", () => {
		expect(SHEET).toContain('const MAKE_A_PLAN = "Make a Plan";');
		expect(SHEET).toContain('const ARCANE_ADEPT = "Arcane Adept";');
		expect(SHEET).toContain("[MAKE_A_PLAN]:        sheet => sheet.isEditable && editSteadingPlan(characterPlanStore(sheet.actor)),");
		expect(SHEET).toContain("[ARCANE_ADEPT]:       sheet => sheet.isEditable && ownsLearnedMoveNamed(sheet.actor, ARCANE_ADEPT) && editSteadingPlan(characterPlanStore(sheet.actor)),");
		const table = SHEET.slice(SHEET.indexOf("const MOVE_USE_EFFECTS = {"), SHEET.indexOf("const MOVE_ROLL_EFFECTS = {"));
		expect(table).toContain("[MAKE_A_PLAN]:");
		expect(table).toContain("[ARCANE_ADEPT]:");
		// The names the moves really carry.
		expect(read("packs/src/stonetop-items/homefront-moves/make-a-plan.json")).toMatch(/"name":\s*"Make a Plan"/);
		expect(read("data/playbook-moves.json")).toMatch(/"name":\s*"Arcane Adept"/);
	});
});
