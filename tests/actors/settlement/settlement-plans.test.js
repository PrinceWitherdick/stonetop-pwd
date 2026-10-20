import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { settlementPlanStore } from "../../../module/actors/settlement/settlement-plans.js";
import { removePlan, savePlan, setRequirementDone } from "../../../module/actors/steading/steading-plans.js";

// Every other settlement's Notes tab carries Stonetop's Plans (Make a Plan, Book I p.530): the same
// partial and the same code, kept in the settlement's `system.plans` (the user's ask, 2026-10-20).

/** A settlement whose updates land in its system data, as the document's would. */
function settlement(plans = []) {
	const actor = {
		uuid: "Actor.s1",
		system: { plans: structuredClone(plans) },
		update: vi.fn(async changes => {
			for (const [key, value] of Object.entries(changes)) actor.system[key.replace(/^system\./, "")] = value;
		}),
	};
	return actor;
}

const plan = (over = {}) => ({ id: "p1", name: "A palisade", undone: "", requirements: [], ...over });

describe("a settlement's plans", () => {
	it("are written, ticked and removed through Stonetop's plan code, into system.plans", async () => {
		const actor = settlement();
		const store = settlementPlanStore(actor);
		await savePlan(store, { id: "p1", name: " A palisade ", requirements: [{ text: "Cut timber" }], undone: "" });
		expect(actor.system.plans).toEqual([plan({ requirements: [{ text: "Cut timber", done: false }] })]);
		expect(store._flags.plans).toBe(actor.system.plans);

		await setRequirementDone(store, "p1", 0, true);
		expect(actor.system.plans[0].requirements).toEqual([{ text: "Cut timber", done: true }]);

		await removePlan(store, "p1");
		expect(actor.system.plans).toEqual([]);
		expect(actor.update).toHaveBeenCalledTimes(3);
	});

	it("never changes the stored rows in place before the write", async () => {
		const actor = settlement([plan({ requirements: [{ text: "Cut timber", done: false }] })]);
		const before = actor.system.plans;
		actor.update.mockImplementation(async () => {});
		await setRequirementDone(settlementPlanStore(actor), "p1", 0, true);
		expect(before[0].requirements[0].done).toBe(false);
		expect(actor.update.mock.calls[0][0]["system.plans"][0].requirements[0].done).toBe(true);
	});

	it("writes nothing when nothing changed", async () => {
		const actor = settlement([plan({ requirements: [{ text: "Cut timber", done: true }] })]);
		expect(await setRequirementDone(settlementPlanStore(actor), "p1", 0, true)).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("draws Stonetop's Plans partial on the Notes tab, live for anyone who may write, and the sheet wires it", () => {
		const notes = read("templates/actor/settlement/settlement-notes.hbs");
		expect(notes).toMatch(/\{\{> "stonetop\.steading-plans" plans=plans canEdit=canWrite /);
		expect(notes.indexOf("stonetop.steading-plans")).toBeLessThan(notes.indexOf("steading-notes-editor"));
		const sheet = read("module/actors/settlement/StonetopSettlementSheet.js");
		expect(sheet).toContain("plans: plansView(system.plans),");
		expect(sheet).toContain("wireSteadingNotesTab(root, store, { editPlan: planId => editSteadingPlan(store, planId) });");
		expect(read("stonetop.js")).toContain('"stonetop.steading-plans":');
		expect(read("module/data-models/SettlementModel.js")).toMatch(/plans: new fields\.ArrayField/);
	});
});
