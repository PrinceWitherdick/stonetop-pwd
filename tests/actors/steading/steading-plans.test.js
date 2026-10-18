import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import {
	PLAN_REQUIREMENT_PROMPTS, CONTENT_GUIDELINE_FIELDS, plansView, contentGuidelinesView, addPlan, removePlan,
	setPlanField, addRequirement, setRequirementDone, setRequirementText, removeRequirement, setContentGuideline,
	wireSteadingNotesTab, newPlan,
} from "../../../module/actors/steading/steading-plans.js";

// Make a Plan (Book I p.530): "Write the requirements down with tick boxes next to them ... As they make
// progress, have them tick the boxes off", with "It'll take days/weeks/months/years (which means ___ will go
// undone)". And the content guidelines (Book I p.66: excluded, veiled, special requests; p.195: the Line).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "templates/actor/partials/steading-tab-notes.hbs"), "utf8");
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
	it("is made empty, named, and given requirements that start unticked", async () => {
		const s = steading();
		await addPlan(s, newPlan("p1"));
		await setPlanField(s, "p1", "name", "Lay down a perimeter of sanctified marks");
		await addRequirement(s, "p1", "  You'll need to obtain two-dozen good stones ");
		await addRequirement(s, "p1", "   ");
		await setPlanField(s, "p1", "undone", "the autumn harvest");
		expect(s._flags.plans).toEqual([{
			id: "p1", name: "Lay down a perimeter of sanctified marks", undone: "the autumn harvest",
			requirements: [{ text: "You'll need to obtain two-dozen good stones", done: false }],
		}]);
	});

	it("ticks requirements off and says when all are met", async () => {
		const s = steading({ plans: [plan({ requirements: [{ text: "Wait until summer", done: false }, { text: "20 workers", done: false }] })] });
		await setRequirementDone(s, "p1", 0, true);
		expect(plansView(s._flags.plans)[0]).toMatchObject({ doneCount: 1, total: 2, done: false });
		await setRequirementDone(s, "p1", 1, true);
		expect(plansView(s._flags.plans)[0].done).toBe(true);
	});

	it("rewords a requirement, drops one emptied or removed, and removes a plan", async () => {
		const s = steading({ plans: [plan({ requirements: [{ text: "a", done: false }, { text: "b", done: true }, { text: "c", done: false }] })] });
		await setRequirementText(s, "p1", 0, "Persuade Elios");
		await setRequirementText(s, "p1", 1, "");
		await removeRequirement(s, "p1", 1);
		expect(s._flags.plans[0].requirements).toEqual([{ text: "Persuade Elios", done: false }]);
		await removePlan(s, "p1");
		expect(s._flags.plans).toEqual([]);
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
	it("draws the guidelines and the plans above the free notes, and the sheet feeds and wires them", () => {
		expect(TEMPLATE.indexOf("data-guideline")).toBeGreaterThan(-1);
		expect(TEMPLATE.indexOf("data-plan-tick")).toBeGreaterThan(TEMPLATE.indexOf("data-guideline"));
		expect(TEMPLATE.indexOf("steading-notes-editor")).toBeGreaterThan(TEMPLATE.indexOf("data-plan-tick"));
		expect(SHEET_JS).toContain("context.stonetop.plans = plansView(notesFlags.plans);");
		expect(SHEET_JS).toContain("wireSteadingNotesTab(html[0], this._stonetopSteading);");
	});

	it("writes a tick, a requirement added with Enter, and a guideline from the tab's controls", async () => {
		const doc = new Window().document;
		const root = doc.body.appendChild(doc.createElement("div"));
		root.innerHTML = `<section class="steading-notes">
			<textarea data-guideline="excluded"></textarea>
			<article data-plan-id="p1">
				<li data-req-index="0"><input type="checkbox" data-plan-tick></li>
				<input data-plan-new-req>
			</article>
		</section>`;
		const s = steading({ plans: [plan({ requirements: [{ text: "x", done: false }] })] });
		wireSteadingNotesTab(root, s);
		const tick = root.querySelector("[data-plan-tick]");
		tick.checked = true;
		tick.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
		const add = root.querySelector("[data-plan-new-req]");
		add.value = "It will cost 1 Surplus";
		add.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		const box = root.querySelector("[data-guideline]");
		box.value = "spiders";
		box.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
		await vi.waitFor(() => expect(s._flags.plans[0].requirements).toEqual([
			{ text: "x", done: true }, { text: "It will cost 1 Surplus", done: false },
		]));
		expect(s._flags.contentGuidelines).toEqual({ excluded: "spiders" });
	});
});
