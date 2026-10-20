// Write or edit one of the steading's plans (Make a Plan, Book I p.530): what the PCs hope to achieve, the
// requirements the GM names, and what goes undone meanwhile. The Notes tab only reads a plan and ticks its
// boxes; this is where one is written (steading-plans.js stores it).
//
// The requirement rows are cloned from a <template> in the .hbs and read back off the live DOM on save, so
// adding or removing one never re-renders the window and loses what was typed (the wound editor's plan
// rows, WoundDialog.js, work the same way). The book's prompts sit under the list as buttons: one drops in
// a new row with its "___" selected, so what is typed next replaces the blank, and Tab steps to the next.
//
// Follows StonetopDialog's result protocol: promise() resolves to the plan as written, or null on cancel.
import { StonetopDialog } from "../../utils/stonetop-dialog.js";
import { PLAN_REQUIREMENT_PROMPTS, PROMPT_BLANK, planView, savePlan, selectBlank } from "./steading-plans.js";

export class SteadingPlanDialog extends StonetopDialog {
	constructor({ plan = null, ownerId = "" } = {}, options = {}) {
		super({ id: SteadingPlanDialog.windowId(plan, ownerId), ...options });
		this._plan = plan;
	}

	/**
	 * A per-plan window id, so editing two plans at once opens two windows rather than two apps
	 * fighting over one DOM id (AppV1 keys the element by `options.id`). Keyed by the steading or
	 * settlement too: every settlement shares this editor, and each has its own "new" plan.
	 */
	static windowId(plan, ownerId = "") {
		return `stonetop-steading-plan-${ownerId ? `${ownerId}-` : ""}${plan?.id || "new"}`;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			title: "Make a Plan",
			template: "systems/stonetop-pwd/templates/dialogs/steading-plan.hbs",
			classes: ["stonetop", "stonetop-steading-plan-dialog"],
			width: 540,
			height: "auto",
			resizable: true,
		});
	}

	/** Content-hugging: a row added or removed re-fits the window. */
	get _autoHeight() { return true; }

	get title() {
		return this._plan ? "Edit Plan" : "Make a Plan";
	}

	getData() {
		const plan = planView(this._plan ?? {});
		return { ...plan, isNew: !this._plan, prompts: PLAN_REQUIREMENT_PROMPTS };
	}

	activateListeners(html) {
		super.activateListeners(html);
		const form = html[0];
		form.addEventListener("submit", ev => { ev.preventDefault(); this._save(form); });
		form.querySelector(".spe-save")?.addEventListener("click", () => this._save(form));
		form.querySelector(".spe-cancel")?.addEventListener("click", () => this.close());
		form.querySelector(".spe-req-add")?.addEventListener("click", () => this._addRow(form));
		form.addEventListener("click", ev => {
			const prompt = ev.target.closest(".spe-prompt");
			if (prompt) return this._addRow(form, prompt.dataset.prompt);
			const remove = ev.target.closest(".spe-req-remove");
			if (remove) { remove.closest(".spe-req")?.remove(); this._fit(form); }
		});
		form.addEventListener("keydown", ev => {
			const row = ev.target.closest?.(".spe-req-text");
			if (!row) return;
			// Tab walks a prompt's blanks before leaving the field.
			if (ev.key === "Tab" && !ev.shiftKey && row.value.includes(PROMPT_BLANK)) {
				if (selectBlank(row, row.selectionEnd ?? 0)) ev.preventDefault();
			}
			// Enter in a requirement starts the next one, the way a list is written, rather than saving.
			if (ev.key === "Enter") {
				ev.preventDefault();
				if (row.value.trim()) this._addRow(form, "", row.closest(".spe-req"));
			}
		});
		this._fit(form);
		if (!this._plan) form.querySelector(".spe-name")?.focus();
	}

	/**
	 * A requirement row, after `after` or at the end, focused. A prompt fills the list's empty last row if
	 * it has one rather than leaving a blank row above it, and lands with its first blank selected.
	 */
	_addRow(form, words = "", after = null) {
		const list = form.querySelector(".spe-req-list");
		const last = list?.querySelector(".spe-req:last-child .spe-req-text");
		let input;
		if (words && last && !last.value.trim()) input = last;
		else {
			const row = form.querySelector(".spe-req-tpl")?.content?.firstElementChild?.cloneNode(true);
			if (!list || !row) return;
			if (after) after.after(row); else list.appendChild(row);
			input = row.querySelector(".spe-req-text");
		}
		input.value = words;
		input.focus();
		if (!selectBlank(input)) input.setSelectionRange?.(words.length, words.length);
		this._fit(form);
	}

	/** Show the empty-list line only while there are no rows, and re-fit the window to them. */
	_fit(form) {
		const list = form.querySelector(".spe-req-list");
		list?.classList.toggle("is-empty", !list.querySelector(".spe-req"));
		if (this.rendered) this.setPosition({ height: "auto" });
	}

	/** The plan as the form holds it; savePlan tidies it. */
	_read(form) {
		return {
			id: this._plan?.id ?? "",
			name: StonetopDialog.readValue(form, ".spe-name"),
			undone: StonetopDialog.readValue(form, ".spe-undone-input"),
			requirements: [...form.querySelectorAll(".spe-req")].map(row => ({
				text: row.querySelector(".spe-req-text")?.value ?? "",
				done: !!row.querySelector(".spe-req-done")?.checked,
				// Which stored row it opened as (steading-plans.js#ticksSince); none for a row added here.
				from: row.dataset.reqFrom ?? null,
			})),
		};
	}

	_save(form) {
		this._resolveWith(this._read(form));
	}
}

/** Open the editor on one of the steading's plans (null for a new one) and store what it returns. */
export async function editSteadingPlan(steading, planId = null) {
	const stored = planId ? (steading._flags?.plans ?? []).find(p => p?.id === planId) : null;
	if (planId && !stored) return false;
	// A copy of the plan as the editor opened on it, so a tick made on the sheet meanwhile is told apart.
	const base = stored ? foundry.utils.deepClone(stored) : null;
	const draft = await new SteadingPlanDialog({ plan: stored, ownerId: steading.actorId ?? "" }).promise();
	return draft ? savePlan(steading, draft, { base }) : false;
}
