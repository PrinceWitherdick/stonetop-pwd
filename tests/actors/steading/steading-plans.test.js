import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import Handlebars from "handlebars";
import {
	PLAN_REQUIREMENT_PROMPTS, CONTENT_GUIDELINE_FIELDS, plansView, contentGuidelinesView, removePlan, savePlan,
	tidyPlan, setRequirementDone, setContentGuideline, wireSteadingNotesTab, fillPromptBlank, selectBlank,
} from "../../../module/actors/steading/steading-plans.js";
import { SteadingPlanDialog } from "../../../module/actors/steading/SteadingPlanDialog.js";
import { stubConfirm } from "../../fakes/confirm.js";

// Make a Plan (Book I p.530): "Write the requirements down with tick boxes next to them ... As they make
// progress, have them tick the boxes off", with "It'll take days/weeks/months/years (which means ___ will go
// undone)". And the content guidelines (Book I p.66: excluded, veiled, special requests; p.195: the Line).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "templates/actor/partials/steading-tab-notes.hbs"), "utf8");
const PLANS_PARTIAL = fs.readFileSync(path.join(ROOT, "templates/actor/partials/steading-plans.hbs"), "utf8");
const DIALOG_TEMPLATE = fs.readFileSync(path.join(ROOT, "templates/dialogs/steading-plan.hbs"), "utf8");
const SHEET_JS = fs.readFileSync(path.join(ROOT, "module/actors/steading/StonetopSteadingSheet.js"), "utf8");

/** A steading whose list writes land in its flags, in order, as StonetopSteading#editList does. */
function steading(flags = {}) {
	const s = {
		_flags: structuredClone(flags),
		editList: vi.fn(async (list, edit) => {
			const arr = structuredClone(s._flags[list] ?? []);
			if (edit(arr) === false) return false;
			s._flags[list] = arr;
			return true;
		}),
		setFlags: vi.fn(async updates => { Object.assign(s._flags, updates); }),
	};
	return s;
}

const plan = (over = {}) => ({ id: "p1", name: "A palisade", undone: "", requirements: [], ...over });

describe("a plan", () => {
	it("is written whole from the editor: trimmed, empty rows dropped, new ones at the end", async () => {
		const s = steading({ plans: [plan()] });
		await savePlan(s, {
			id: "", name: " Lay down a perimeter of sanctified marks ", undone: " the autumn harvest ",
			requirements: [{ text: "  You'll need to obtain two-dozen good stones ", done: false }, { text: "   ", done: true }],
		});
		expect(s._flags.plans).toHaveLength(2);
		expect(s._flags.plans[1]).toEqual({
			id: expect.any(String), name: "Lay down a perimeter of sanctified marks", undone: "the autumn harvest",
			requirements: [{ text: "You'll need to obtain two-dozen good stones", done: false }],
		});
	});

	it("rewrites a stored plan in place, and writes nothing for an unchanged or empty one", async () => {
		const s = steading({ plans: [plan({ requirements: [{ text: "a", done: true }] }), plan({ id: "p2" })] });
		await savePlan(s, { id: "p1", name: "A palisade", undone: "", requirements: [{ text: "Persuade Elios", done: true }] });
		expect(s._flags.plans.map(p => p.id)).toEqual(["p1", "p2"]);
		expect(s._flags.plans[0].requirements).toEqual([{ text: "Persuade Elios", done: true }]);
		expect(await savePlan(s, { id: "p1", name: "A palisade", requirements: [{ text: "Persuade Elios", done: true }] })).toBe(false);
		expect(await savePlan(s, { id: "", name: " ", requirements: [{ text: "" }], undone: "" })).toBe(false);
		expect(s._flags.plans).toHaveLength(2);
	});

	// The editor reads its boxes off the window it opened, so the plan as it is now decides the ones it never touched.
	it("keeps a box ticked on the sheet while the editor was open", async () => {
		const base = plan({ requirements: [{ text: "Persuade Elios", done: false }, { text: "Find stone", done: true }] });
		const s = steading({ plans: [structuredClone(base)] });
		await setRequirementDone(s, "p1", 0, true);
		await setRequirementDone(s, "p1", 1, false);
		await savePlan(s, {
			id: "p1", name: "A stone palisade", undone: "",
			requirements: [
				{ text: "Persuade Elios", done: false, from: "0" },
				{ text: "Find stone", done: true, from: "1" },
				{ text: "Dig a ditch", done: false, from: null },
			],
		}, { base });
		expect(s._flags.plans[0].name).toBe("A stone palisade");
		expect(s._flags.plans[0].requirements).toEqual([
			{ text: "Persuade Elios", done: true }, { text: "Find stone", done: false }, { text: "Dig a ditch", done: false },
		]);
	});

	it("still writes a tick the editor itself changed", async () => {
		const base = plan({ requirements: [{ text: "Persuade Elios", done: false }] });
		const s = steading({ plans: [structuredClone(base)] });
		await savePlan(s, { ...base, requirements: [{ text: "Persuade Elios", done: true, from: "0" }] }, { base });
		expect(s._flags.plans[0].requirements).toEqual([{ text: "Persuade Elios", done: true }]);
	});

	it("ticks requirements off and says when all are met", async () => {
		const s = steading({ plans: [plan({ requirements: [{ text: "Wait until summer", done: false }, { text: "20 workers", done: false }] })] });
		await setRequirementDone(s, "p1", 0, true);
		expect(plansView(s._flags.plans)[0]).toMatchObject({ doneCount: 1, total: 2, done: false });
		await setRequirementDone(s, "p1", 1, true);
		expect(plansView(s._flags.plans)[0].done).toBe(true);
		await removePlan(s, "p1");
		expect(s._flags.plans).toEqual([]);
	});

	it("puts words typed after a picked prompt into its blank, stored or shown", () => {
		expect(fillPromptBlank("You must travel to ___ the Ruined Tower")).toBe("You must travel to the Ruined Tower");
		expect(fillPromptBlank("You must wait until/for ___Night")).toBe("You must wait until/for Night");
		expect(fillPromptBlank("The steading must Pull Together ___ times, each requiring ___ 3"))
			.toBe("The steading must Pull Together 3 times, each requiring ___");
		expect(fillPromptBlank("You must travel to ___")).toBe("You must travel to ___");
		expect(fillPromptBlank("It'll take days/weeks/months/years and more")).toBe("It'll take days/weeks/months/years and more");
		expect(fillPromptBlank(" Persuade Elios ")).toBe("Persuade Elios");
		expect(tidyPlan({ requirements: [{ text: "It will cost ___ 2 Surplus" }] }).requirements[0].text).toBe("It will cost 2 Surplus");
		// A row stored before the fill existed reads filled on the sheet too.
		expect(plansView([plan({ requirements: [{ text: "You must wait until/for ___Night" }] })])[0].requirements[0].text)
			.toBe("You must wait until/for Night");
	});

	it("offers the book's requirement prompts", () => {
		expect(PLAN_REQUIREMENT_PROMPTS).toContain("You must find/locate/obtain ___");
		expect(PLAN_REQUIREMENT_PROMPTS).toContain("The steading must Pull Together ___ times, each requiring ___");
	});
});

describe("the content guidelines", () => {
	it("are p.66's three categories and p.195's Line", () => {
		expect(CONTENT_GUIDELINE_FIELDS.map(f => f.key)).toEqual(["excluded", "veiled", "requests", "line"]);
	});

	it("keep each box's words, writing only what changed", async () => {
		const s = steading({ contentGuidelines: { excluded: "harm to children" } });
		expect(await setContentGuideline(s, "veiled", "torture")).toBe(true);
		expect(s._flags.contentGuidelines).toEqual({ excluded: "harm to children", veiled: "torture" });
		expect(await setContentGuideline(s, "veiled", "torture")).toBe(false);
		expect(await setContentGuideline(s, "nonsense", "x")).toBe(false);
		expect(contentGuidelinesView(s._flags.contentGuidelines).map(g => g.value)).toEqual(["harm to children", "torture", "", ""]);
	});
});

describe("the Notes tab", () => {
	it("draws the plans, then the free notes, then the guidelines, the plans as text with no fields, and the sheet wires the editor", () => {
		const call = '{{> "stonetop.steading-plans" plans=stonetop.plans canEdit=stonetop.canEdit';
		expect(TEMPLATE.indexOf(call)).toBeGreaterThan(-1);
		expect(TEMPLATE.indexOf("steading-notes-editor")).toBeGreaterThan(TEMPLATE.indexOf(call));
		expect(TEMPLATE.indexOf("data-guideline")).toBeGreaterThan(TEMPLATE.indexOf("steading-notes-editor"));
		expect(PLANS_PARTIAL).not.toContain('type="text"');
		expect(PLANS_PARTIAL).toContain('data-plan-action="edit-plan"');
		expect(SHEET_JS).toContain("context.stonetop.plans = plansView(notesFlags.plans);");
		expect(SHEET_JS).toContain("editPlan: planId => editSteadingPlan(this._stonetopSteading, planId)");
	});

	it("ticks from the sheet, opens the editor from the pencil and New plan, and removes only on a yes", async () => {
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = `<section class="steading-notes">
			<textarea data-guideline="excluded"></textarea>
			<article data-plan-id="p1">
				<button data-plan-action="edit-plan"></button><button data-plan-action="remove-plan"></button>
				<li data-req-index="0"><input type="checkbox" data-plan-tick></li>
			</article>
			<button data-plan-action="add-plan"></button>
		</section>`;
		const s = steading({ plans: [plan({ requirements: [{ text: "x", done: false }] })] });
		const editPlan = vi.fn();
		wireSteadingNotesTab(root, s, { editPlan });
		const tick = root.querySelector("[data-plan-tick]");
		tick.checked = true;
		tick.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
		const box = root.querySelector("[data-guideline]");
		box.value = "spiders";
		box.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
		await vi.waitFor(() => expect(s._flags.plans[0].requirements).toEqual([{ text: "x", done: true }]));
		expect(s._flags.contentGuidelines).toEqual({ excluded: "spiders" });

		root.querySelector('[data-plan-action="edit-plan"]').click();
		root.querySelector('[data-plan-action="add-plan"]').click();
		expect(editPlan.mock.calls).toEqual([["p1"], [null]]);

		stubConfirm(false);
		root.querySelector('[data-plan-action="remove-plan"]').click();
		await new Promise(r => setTimeout(r, 0));
		expect(s._flags.plans).toHaveLength(1);
		const asked = stubConfirm(true);
		root.querySelector('[data-plan-action="remove-plan"]').click();
		await vi.waitFor(() => expect(s._flags.plans).toEqual([]));
		expect(asked.mock.calls[0][0].content).toContain("A palisade");
	});

	// The Plans partial reads its `canEdit` param inside two `each` blocks. Foundry compiles without
	// compat mode, so a bare name there would read off the plan and render nothing: rendered here the
	// same way, a fresh Handlebars with default options.
	it("gives an editor the pencil, trash, New plan and live ticks, and a reader none of them", () => {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.steading-plans", PLANS_PARTIAL);
		const render = canEdit => {
			const doc = new Window().document;
			doc.body.innerHTML = hb.compile('{{> "stonetop.steading-plans" plans=plans canEdit=canEdit titleId="t1"}}')({
				canEdit,
				plans: plansView([plan({ requirements: [{ text: "Cut timber", done: true }, { text: "Dig the ditch", done: false }], undone: "the harvest" })]),
			});
			return doc.body;
		};
		const editor = render(true);
		expect(editor.querySelector("section.steading-plans").getAttribute("aria-labelledby")).toBe("t1");
		expect(editor.querySelector("h3").id).toBe("t1");
		expect(editor.querySelectorAll('[data-plan-action="edit-plan"], [data-plan-action="remove-plan"], [data-plan-action="add-plan"]')).toHaveLength(3);
		expect([...editor.querySelectorAll("[data-plan-tick]")].map(t => [t.checked, t.disabled])).toEqual([[true, false], [false, false]]);
		expect(editor.querySelector(".steading-plan-progress").textContent).toBe("1/2");
		expect(editor.querySelector(".steading-plan-undone").textContent).toContain("the harvest");

		const reader = render(false);
		expect(reader.querySelectorAll("[data-plan-action]")).toHaveLength(0);
		expect([...reader.querySelectorAll("[data-plan-tick]")].every(t => t.disabled)).toBe(true);
	});
});

describe("the plan editor", () => {
	/** The real template, rendered and wired by the dialog's own listeners. */
	function open(stored = null) {
		const win = new Window();
		const doc = win.document;
		Application.prototype.activateListeners ??= function () {};
		const dialog = new SteadingPlanDialog({ plan: stored });
		dialog._frontOnOpen = { start() {}, stop() {} };
		doc.body.innerHTML = Handlebars.compile(DIALOG_TEMPLATE)(dialog.getData());
		const form = doc.querySelector("form");
		dialog.activateListeners([form]);
		return { dialog, form, doc, win };
	}

	it("adds a book prompt as a row with its blank selected, and Tab walks to the next blank", () => {
		const { form, win } = open();
		const prompt = [...form.querySelectorAll(".spe-prompt")].find(b => b.dataset.prompt.startsWith("The steading must Pull"));
		prompt.click();
		const row = form.querySelector(".spe-req-list .spe-req-text");
		expect(row.value).toBe("The steading must Pull Together ___ times, each requiring ___");
		expect([row.selectionStart, row.selectionEnd]).toEqual([32, 35]);
		row.value = "The steading must Pull Together 3 times, each requiring ___";
		row.setSelectionRange(33, 33);
		row.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
		expect([row.selectionStart, row.selectionEnd]).toEqual([56, 59]);
		// Past the last blank, Tab leaves the field as usual rather than wrapping back.
		expect(selectBlank(row, 59)).toBe(false);
	});

	it("reads the plan back off the form, rows the player added and removed included", () => {
		const { dialog, form } = open(plan({ name: "A palisade", requirements: [{ text: "Wait until summer", done: true }, { text: "Cut 200 logs", done: false }] }));
		form.querySelectorAll(".spe-req-remove")[1].click();
		form.querySelector(".spe-req-add").click();
		form.querySelectorAll(".spe-req-text")[1].value = "You must travel to ___ the Ruined Tower";
		form.querySelector(".spe-undone-input").value = "the harvest";
		const read = dialog._read(form);
		expect(read).toEqual({
			id: "p1", name: "A palisade", undone: "the harvest",
			requirements: [{ text: "Wait until summer", done: true, from: "0" }, { text: "You must travel to ___ the Ruined Tower", done: false, from: null }],
		});
		expect(tidyPlan(read).requirements[1].text).toBe("You must travel to the Ruined Tower");
	});
});
