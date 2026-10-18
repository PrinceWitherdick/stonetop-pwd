// ── The steading's Notes tab: Plans and the content guidelines ──────────────────
//
// MAKE A PLAN (Book I p.530): "When you wish to accomplish some project but don't know how to go about it,
// tell the GM what you hope to achieve. They'll say what's required." And: "Write the requirements down
// with tick boxes next to them. Give the list to the player who's making the plan, or put it somewhere
// public for everyone to see. As they make progress, have them tick the boxes off." So a plan is a name,
// a list of requirements each with a tick box (the same `{text, done}` row a wound's plan keeps, fields.js
// woundsField's planRequirements), and the book's "It'll take days/weeks/months/years (which means ___ will
// go undone)" as a line of its own, since what goes undone is what the table has to live with meanwhile.
// The steading's sheet is the public place; a requirement the GM rephrases is just edited (p.531: "If they
// think of a feasible alternative way to accomplish their goal, update the plan!").
//
// CONTENT GUIDELINES (Book I p.66): "At the beginning of your first session, you and the rest of the group
// will have a discussion about content ... Excluded content ... Veiled content ... Special requests ...
// Record these content guidelines on the second page of the steading playbook. Review the guidelines at the
// start of each session." Plus p.195's Line: some players enjoy making up details about the world and some
// find it takes away from their immersion, so how far the GM's questions should blur the Line is written
// down beside them.
//
// Both live in the steading's flags (`plans`, `contentGuidelines`), written through its turn like every list.

import { escHtml } from "../../utils/strings.js";

/** The requirement prompts Make a Plan lists (Book I p.530), offered as suggestions when adding one. */
export const PLAN_REQUIREMENT_PROMPTS = Object.freeze([
	"You must learn/know/decipher ___",
	"You must find/locate/obtain ___",
	"You must create/design/fix ___",
	"You'll need the help/support/approval of ___",
	"You must wait until/for ___",
	"You must travel to ___",
	"It'll take days/weeks/months/years",
	"The best you can get/do is ___",
	"It will cost ___",
	"You'll risk ___",
	"The steading must Pull Together ___ times, each requiring ___",
]);

/** The content guidelines' four boxes: p.66's three, then p.195's Line. */
export const CONTENT_GUIDELINE_FIELDS = Object.freeze([
	{ key: "excluded", label: "Excluded content", hint: "Won't be part of the game at all, on-camera or off." },
	{ key: "veiled",   label: "Veiled content",   hint: "Can be part of the game, but only off-camera." },
	{ key: "requests", label: "Special requests", hint: "How certain content gets handled (\"Spiders are okay, but please don't describe their legs\")." },
	{ key: "line",     label: "The Line",         hint: "How much the players like being asked to make up details about the world, rather than about their characters (Book I p.195)." },
]);

const text = v => String(v ?? "");

/** One stored plan, tidied for the sheet: its rows, how many are ticked, and whether all are. PURE. */
export function planView(plan = {}) {
	const requirements = (Array.isArray(plan.requirements) ? plan.requirements : [])
		.map(r => ({ text: text(r?.text), done: !!r?.done }));
	const doneCount = requirements.filter(r => r.done).length;
	return {
		id: text(plan.id),
		name: text(plan.name),
		undone: text(plan.undone),
		requirements,
		doneCount,
		total: requirements.length,
		done: requirements.length > 0 && doneCount === requirements.length,
	};
}

/** The stored plans for the sheet, in order. PURE. */
export function plansView(plans) {
	return (Array.isArray(plans) ? plans : []).filter(p => p?.id).map(planView);
}

/** The stored guidelines for the sheet: each box with its words. PURE. */
export function contentGuidelinesView(stored = {}) {
	return CONTENT_GUIDELINE_FIELDS.map(f => ({ ...f, value: text(stored?.[f.key]) }));
}

/** A fresh, empty plan. */
export function newPlan(id = globalThis.foundry?.utils?.randomID?.() ?? `plan${Date.now()}`) {
	return { id, name: "", requirements: [], undone: "" };
}

/** Edit one plan in the steading's turn (StonetopSteading#editList). `edit` changes it in place; false writes nothing. */
function editPlan(steading, planId, edit) {
	return steading.editList("plans", plans => {
		const plan = plans.find(p => p?.id === planId);
		if (!plan) return false;
		plan.requirements = Array.isArray(plan.requirements) ? plan.requirements : [];
		return edit(plan);
	});
}

/** Add an empty plan at the end. The new plan's id. */
export async function addPlan(steading, plan = newPlan()) {
	await steading.editList("plans", plans => { plans.push(plan); });
	return plan.id;
}

/** Remove a plan. */
export function removePlan(steading, planId) {
	return steading.editList("plans", plans => {
		const at = plans.findIndex(p => p?.id === planId);
		if (at < 0) return false;
		plans.splice(at, 1);
	});
}

/** Set a plan's name or its "goes undone" line. */
export function setPlanField(steading, planId, field, value) {
	if (!["name", "undone"].includes(field)) return Promise.resolve(false);
	return editPlan(steading, planId, plan => {
		if (plan[field] === value) return false;
		plan[field] = value;
	});
}

/** Add a requirement, unticked. Blank text adds nothing. */
export function addRequirement(steading, planId, value) {
	const words = text(value).trim();
	if (!words) return Promise.resolve(false);
	return editPlan(steading, planId, plan => { plan.requirements.push({ text: words, done: false }); });
}

/** Tick or untick one requirement. */
export function setRequirementDone(steading, planId, index, done) {
	return editPlan(steading, planId, plan => {
		const row = plan.requirements[index];
		if (!row || !!row.done === !!done) return false;
		row.done = !!done;
	});
}

/** Reword one requirement (p.531: "update the plan!"). Emptied, it is removed. */
export function setRequirementText(steading, planId, index, value) {
	return editPlan(steading, planId, plan => {
		const row = plan.requirements[index];
		if (!row) return false;
		const words = text(value).trim();
		if (!words) plan.requirements.splice(index, 1);
		else if (row.text === words) return false;
		else row.text = words;
	});
}

/** Remove one requirement. */
export function removeRequirement(steading, planId, index) {
	return editPlan(steading, planId, plan => {
		if (!plan.requirements[index]) return false;
		plan.requirements.splice(index, 1);
	});
}

/** Write one content guideline box. */
export async function setContentGuideline(steading, key, value) {
	if (!CONTENT_GUIDELINE_FIELDS.some(f => f.key === key)) return false;
	const current = steading._flags?.contentGuidelines ?? {};
	if (text(current[key]) === text(value)) return false;
	await steading.setFlags({ contentGuidelines: { ...current, [key]: text(value) } });
	return true;
}

// The prompts are frozen, so each id's datalist is built once and handed back on every render after.
const _promptsDatalists = new Map();

/** The `<datalist>` of the book's requirement prompts, once per sheet. PURE. */
export function planPromptsDatalistHtml(id = "steading-plan-prompts") {
	let html = _promptsDatalists.get(id);
	if (html === undefined) {
		html = `<datalist id="${id}">${PLAN_REQUIREMENT_PROMPTS.map(p => `<option value="${escHtml(p)}"></option>`).join("")}</datalist>`;
		_promptsDatalists.set(id, html);
	}
	return html;
}

/**
 * Wire the Notes tab's Plans and guidelines (the sheet's activateListeners, for a user who can edit the
 * steading). Delegated on the tab, so a re-render needs nothing re-bound per row. Each write re-renders the
 * sheet through the actor update.
 */
export function wireSteadingNotesTab(root, steading) {
	const tab = root?.querySelector?.(".steading-notes");
	if (!tab) return;
	const planOf = el => el.closest("[data-plan-id]")?.dataset.planId;
	const rowOf = el => Number(el.closest("[data-req-index]")?.dataset.reqIndex);
	tab.addEventListener("click", ev => {
		const btn = ev.target.closest?.("[data-plan-action]");
		if (!btn) return;
		ev.preventDefault();
		const planId = planOf(btn);
		switch (btn.dataset.planAction) {
			case "add-plan": return addPlan(steading);
			case "remove-plan": return planId && removePlan(steading, planId);
			case "remove-req": return planId && removeRequirement(steading, planId, rowOf(btn));
			case "add-req": {
				const input = btn.closest("[data-plan-id]")?.querySelector("[data-plan-new-req]");
				return planId && addRequirement(steading, planId, input?.value);
			}
		}
	});
	tab.addEventListener("keydown", ev => {
		const input = ev.target.closest?.("[data-plan-new-req]");
		if (!input || ev.key !== "Enter") return;
		ev.preventDefault();
		addRequirement(steading, planOf(input), input.value);
	});
	tab.addEventListener("change", ev => {
		const el = ev.target;
		const planId = planOf(el);
		if (el.matches?.("[data-guideline]")) {
			ev.stopPropagation();
			return setContentGuideline(steading, el.dataset.guideline, el.value);
		}
		if (!planId) return;
		if (el.matches?.("[data-plan-field]")) { ev.stopPropagation(); return setPlanField(steading, planId, el.dataset.planField, el.value); }
		if (el.matches?.("[data-plan-tick]")) { ev.stopPropagation(); return setRequirementDone(steading, planId, rowOf(el), el.checked); }
		if (el.matches?.("[data-plan-req-text]")) { ev.stopPropagation(); return setRequirementText(steading, planId, rowOf(el), el.value); }
	});
}
