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
// The sheet only reads a plan (and ticks its boxes); SteadingPlanDialog.js is where one is written.

import { escHtml } from "../../utils/strings.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";

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

/** The blank a requirement prompt leaves for the GM's words. */
export const PROMPT_BLANK = "___";

/**
 * A requirement with words typed AFTER a picked prompt moved into its first blank: "You must travel to ___
 * the Ruined Tower" is "You must travel to the Ruined Tower". Text that doesn't start with a prompt, or adds
 * nothing to it, comes back as it was (trimmed). PURE.
 */
export function fillPromptBlank(value) {
	const words = text(value).trim();
	for (const prompt of PLAN_REQUIREMENT_PROMPTS) {
		if (!prompt.includes(PROMPT_BLANK) || !words.startsWith(prompt)) continue;
		const extra = words.slice(prompt.length).trim();
		if (extra) return prompt.replace(PROMPT_BLANK, extra);
	}
	return words;
}

/**
 * Select the next blank in `input` at or after `from`, so what is typed next replaces the "___". False
 * when there is none past it: it never wraps round, or Tab would be stuck in a field with a blank behind it.
 */
export function selectBlank(input, from = 0) {
	const at = (input?.value ?? "").indexOf(PROMPT_BLANK, from);
	if (at < 0) return false;
	input.setSelectionRange?.(at, at + PROMPT_BLANK.length);
	return true;
}

/** The content guidelines' four boxes: p.66's three, then p.195's Line. */
export const CONTENT_GUIDELINE_FIELDS = Object.freeze([
	{ key: "excluded", label: "Excluded content", hint: "Won't be part of the game at all, on-camera or off." },
	{ key: "veiled",   label: "Veiled content",   hint: "Can be part of the game, but only off-camera." },
	{ key: "requests", label: "Special requests", hint: "How certain content gets handled (\"Spiders are okay, but please don't describe their legs\")." },
	{ key: "line",     label: "The Line",         hint: "How much the players like being asked to make up details about the world, rather than about their characters." },
]);

const text = v => String(v ?? "");

/** One stored plan, tidied for the sheet: its rows, how many are ticked, and whether all are. PURE. */
export function planView(plan = {}) {
	const requirements = (Array.isArray(plan.requirements) ? plan.requirements : [])
		.map(r => ({ text: fillPromptBlank(r?.text), done: !!r?.done }));
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

/**
 * A plan as the editor hands it back, tidied for storing: names and the undone line trimmed, each
 * requirement's blank filled (fillPromptBlank) and the emptied ones dropped. PURE.
 */
export function tidyPlan(draft = {}) {
	return {
		id: text(draft.id),
		name: text(draft.name).trim(),
		requirements: (Array.isArray(draft.requirements) ? draft.requirements : [])
			.map(r => ({ text: fillPromptBlank(r?.text), done: !!r?.done }))
			.filter(r => r.text),
		undone: text(draft.undone).trim(),
	};
}

/**
 * The editor's rows with every tick it left alone read off the plan as it is now (`current`), so a box
 * ticked or unticked on the Notes tab while the editor was open survives its save. A row is matched to the
 * one it was opened from (`from`, its index in `base`, the plan the editor opened on) while that row still
 * says the same; a tick the editor itself changed, and a row it added, keep the editor's. PURE.
 */
export function ticksSince(rows, base, current) {
	return (Array.isArray(rows) ? rows : []).map(row => {
		const from = row?.from == null || row.from === "" ? -1 : Number(row.from);
		const was = base?.requirements?.[from];
		const now = current?.requirements?.[from];
		if (!was || !now || text(now.text) !== text(was.text) || !!row.done !== !!was.done) return row;
		return { ...row, done: !!now.done };
	});
}

/**
 * Write a plan from the editor: over the stored one with its id, or at the end when it is new. A new plan
 * with nothing written in it writes nothing. `base` is the plan as the editor opened on it (ticksSince).
 */
export function savePlan(steading, draft, { base = null } = {}) {
	const id = text(draft?.id) || newPlan().id;
	return steading.editList("plans", plans => {
		const at = plans.findIndex(p => p?.id === id);
		const plan = tidyPlan({ ...draft, id, requirements: ticksSince(draft?.requirements, base, plans[at]) });
		if (at >= 0) {
			if (JSON.stringify(plans[at]) === JSON.stringify(plan)) return false;
			plans[at] = plan;
		} else if (plan.name || plan.requirements.length || plan.undone) plans.push(plan);
		else return false;
	});
}

/** Remove a plan. */
export function removePlan(steading, planId) {
	return steading.editList("plans", plans => {
		const at = plans.findIndex(p => p?.id === planId);
		if (at < 0) return false;
		plans.splice(at, 1);
	});
}

/** Tick or untick one requirement, from the sheet. */
export function setRequirementDone(steading, planId, index, done) {
	return steading.editList("plans", plans => {
		const row = plans.find(p => p?.id === planId)?.requirements?.[index];
		if (!row || !!row.done === !!done) return false;
		row.done = !!done;
	});
}

/** Ask before removing a plan, naming it; the plan goes only on a yes. */
export async function confirmRemovePlan(steading, planId) {
	const plan = (steading._flags?.plans ?? []).find(p => p?.id === planId);
	if (!plan) return false;
	const name = text(plan.name).trim();
	const yes = await confirmOutcome({
		title: "Remove this plan?",
		content: `<p>Remove ${name ? `<strong>${escHtml(name)}</strong>` : "this plan"} and its requirements from the steading's plans?</p>`,
		yes: { label: "Remove the plan", icon: "fa-trash" },
		no: { label: "Keep it" },
	});
	return yes ? removePlan(steading, planId) : false;
}

/** Write one content guideline box. */
export async function setContentGuideline(steading, key, value) {
	if (!CONTENT_GUIDELINE_FIELDS.some(f => f.key === key)) return false;
	const current = steading._flags?.contentGuidelines ?? {};
	if (text(current[key]) === text(value)) return false;
	await steading.setFlags({ contentGuidelines: { ...current, [key]: text(value) } });
	return true;
}

/**
 * Wire the Notes tab's Plans and guidelines (the sheet's activateListeners, for a user who can edit the
 * steading). Delegated on the tab, so a re-render needs nothing re-bound per row. A plan is read on the
 * sheet and written in its editor: `editPlan(planId)` opens it (null for a new plan). Only the tick boxes
 * write from the sheet itself, since ticking them off is the book's whole use of the list (p.530). Each
 * write re-renders the sheet through the actor update.
 */
export function wireSteadingNotesTab(root, steading, { editPlan = null } = {}) {
	const tab = root?.querySelector?.(".steading-notes");
	if (!tab) return;
	const planOf = el => el.closest("[data-plan-id]")?.dataset.planId;
	tab.addEventListener("click", ev => {
		const btn = ev.target.closest?.("[data-plan-action]");
		if (!btn) return;
		ev.preventDefault();
		const planId = planOf(btn);
		switch (btn.dataset.planAction) {
			case "add-plan": return editPlan?.(null);
			case "edit-plan": return planId && editPlan?.(planId);
			case "remove-plan": return planId && confirmRemovePlan(steading, planId);
		}
	});
	tab.addEventListener("change", ev => {
		const el = ev.target;
		if (el.matches?.("[data-guideline]")) {
			ev.stopPropagation();
			return setContentGuideline(steading, el.dataset.guideline, el.value);
		}
		if (el.matches?.("[data-plan-tick]")) {
			ev.stopPropagation();
			const planId = planOf(el);
			return planId && setRequirementDone(steading, planId, Number(el.closest("[data-req-index]")?.dataset.reqIndex), el.checked);
		}
	});
}
