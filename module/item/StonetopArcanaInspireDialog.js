import { StonetopDialog } from "../utils/stonetop-dialog.js";
import {
	ORIGINS, NATURES, FORM_FIELDS, detailFieldsForNature,
	rollOnTable, seedDescriptionHtml,
} from "../data/artifact-creation-tables.js";

// Ordered step keys. The detail step's fields depend on the chosen nature, but the step
// is always present (every nature opens at least one detail table).
const STEPS = ["origin", "nature", "detail", "form", "review"];

const STEP_TITLES = {
	origin:  "Origin & theme",
	nature:  "Nature",
	detail:  "Details",
	form:    "Form",
	review:  "Review & create",
};

// Font Awesome glyph for each step, shown in the left-rail table of contents and the
// banner (mirrors Run an Expedition / Make a Monster).
const STEP_ICONS = {
	origin:  "fa-compass",
	nature:  "fa-hand-sparkles",
	detail:  "fa-magnifying-glass",
	form:    "fa-gem",
	review:  "fa-clipboard-check",
};

// Origin and nature must be picked before advancing (nature branches the detail step). The
// same warning shows whether you click Next or jump ahead on the rail, so it lives once here.
const PICK_WARN = {
	origin: "Pick or roll an origin first.",
	nature: "Pick or roll a nature first.",
};

/**
 * The Artifact Creation inspiration wizard. Walks the Book II pick-or-roll tables
 * (origin → nature → detail → form), then builds a homebrew arcanum pre-filled with the
 * rolled results. The dialog is data-driven from artifact-creation-tables.js and stays
 * agnostic of how the card is created: it hands the choices to an `onCreate` callback.
 */
export class StonetopArcanaInspireDialog extends StonetopDialog {
	/**
	 * @param {object}   [opts]
	 * @param {Function} opts.onCreate - async ({ name, major, front }) → Item. Creates the
	 *                                    card and wires it to wherever the wizard was opened.
	 */
	constructor({ onCreate } = {}, options = {}) {
		super(options);
		this._onCreate = onCreate;
		this._step  = "origin";
		// Chosen entry index per field key (origin / nature / detail fields / size / form).
		this._picks = {};
		this._name  = "";
		this._major = false;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-arcana-inspire-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/arcana-inspire.hbs",
			title:     "Arcana: Inspire me",
			// Wider than a plain stepper to seat the jump-to-step rail beside the content.
			width:     620,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-arcana-inspire-dialog"],
		});
	}

	// Re-center on the previous step's center when a step change resizes the window, so
	// the modal grows/shrinks in place rather than jumping (mirrors LevelUpDialog).
	get _autoHeight() { return true; }

	async _render(force, options) {
		const p = this.position;
		const prevCenter = [p?.left, p?.top, p?.width, p?.height].every(Number.isFinite)
			? { x: p.left + p.width / 2, y: p.top + p.height / 2 }
			: null;
		await super._render(force, options);
		if (prevCenter) {
			this.setPosition({
				left: prevCenter.x - this.position.width / 2,
				top:  prevCenter.y - this.position.height / 2,
			});
		}
	}

	_natureKey() {
		const idx = this._picks.nature;
		return Number.isInteger(idx) ? NATURES[idx]?.key : null;
	}

	// The fields shown on a given step (detail branches on the chosen nature).
	_fieldsForStep(step) {
		if (step === "origin") return [{ key: "origin", label: "Origin / theme", table: ORIGINS }];
		if (step === "nature") return [{ key: "nature", label: "Nature", table: NATURES }];
		if (step === "detail") return detailFieldsForNature(this._natureKey());
		if (step === "form")   return FORM_FIELDS;
		return [];
	}

	// Every field in display order, used to assemble the seed and review list.
	_orderedFields() {
		return [
			...this._fieldsForStep("origin"),
			...this._fieldsForStep("nature"),
			...this._fieldsForStep("detail"),
			...this._fieldsForStep("form"),
		];
	}

	// The chosen result lines ({ label, text }) for every field that has a pick.
	_chosenLines() {
		return this._orderedFields()
			.map(f => {
				const idx = this._picks[f.key];
				const entry = Number.isInteger(idx) ? f.table[idx] : null;
				return entry ? { label: f.label, text: entry.text } : null;
			})
			.filter(Boolean);
	}

	getData() {
		const stepIdx  = STEPS.indexOf(this._step);
		const isReview = this._step === "review";
		const data = {
			step:      this._step,
			stepTitle: STEP_TITLES[this._step],
			stepIcon:  STEP_ICONS[this._step],
			stepNum:   stepIdx + 1,
			stepTotal: STEPS.length,
			// Left-rail table of contents (shared guide-toc partial): one entry per step,
			// with the active one highlighted. `index` is 0-based (read back by _goToStep).
			steps: STEPS.map((key, i) => ({
				index:    i,
				title:    STEP_TITLES[key],
				icon:     STEP_ICONS[key],
				isActive: key === this._step,
			})),
			isReview,
			isFirst:   stepIdx === 0,
			isLast:    isReview,
		};

		if (isReview) {
			data.name  = this._name;
			data.major = this._major;
			data.lines = this._chosenLines();
			return data;
		}

		data.fields = this._fieldsForStep(this._step).map(f => ({
			key:   f.key,
			label: f.label,
			options: f.table.map((entry, i) => ({
				value:    String(i),
				label:    entry.text,
				selected: this._picks[f.key] === i,
			})),
			chosen: Number.isInteger(this._picks[f.key]),
		}));
		return data;
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Field selects → remember the pick (no re-render; the value is already shown).
		root.querySelectorAll("[data-inspire-field]").forEach(sel =>
			sel.addEventListener("change", () => {
				const v = sel.value;
				this._picks[sel.dataset.inspireField] = v === "" ? undefined : Number(v);
			}));

		// Per-field roll (the randomizer button beside each dropdown).
		root.querySelectorAll(".stonetop-inspire-roll").forEach(btn =>
			btn.addEventListener("click", () => this._rollField(btn.dataset.field)));

		// Review-step inputs.
		root.querySelector("[name=arcName]")?.addEventListener("input", ev => { this._name = ev.target.value; });
		root.querySelectorAll("[name=arcTier]").forEach(r =>
			r.addEventListener("change", ev => { this._major = ev.target.value === "major"; }));

		// Navigation.
		root.querySelector(".stonetop-inspire-back")?.addEventListener("click", () => this._goBack());
		root.querySelector(".stonetop-inspire-next")?.addEventListener("click", () => this._goNext());
		root.querySelector(".stonetop-inspire-create")?.addEventListener("click", () => this._create());
		root.querySelector(".stonetop-inspire-cancel")?.addEventListener("click", () => this.close());

		// Left-rail table of contents: jump straight to a step (gated like Next so origin
		// and nature stay required before the branches that depend on them).
		root.querySelectorAll(".stonetop-guide-toc-btn").forEach(btn =>
			btn.addEventListener("click", () => this._goToStep(Number(btn.dataset.stepIndex))));
	}

	// Jump to a step from the rail. Going back is always allowed; jumping forward past
	// origin/nature still requires those picks (the detail step branches on nature), so
	// clicking ahead without them warns instead, mirroring the Next button's gate.
	_goToStep(index) {
		if (!Number.isInteger(index) || index < 0 || index >= STEPS.length) return;
		const current = STEPS.indexOf(this._step);
		if (index === current) return;
		if (index > current) {
			if (index >= STEPS.indexOf("nature")     && !Number.isInteger(this._picks.origin)) {
				ui.notifications?.warn(PICK_WARN.origin);
				return;
			}
			if (index >= STEPS.indexOf("detail")     && !Number.isInteger(this._picks.nature)) {
				ui.notifications?.warn(PICK_WARN.nature);
				return;
			}
		}
		this._step = STEPS[index];
		this.render(false);
	}

	_rollField(key) {
		const field = this._fieldsForStep(this._step).find(f => f.key === key);
		if (!field) return;
		const entry = rollOnTable(field.table);
		this._picks[key] = field.table.indexOf(entry);
		this.render(false);
	}

	// Origin and nature must be chosen before moving on (nature branches the detail step).
	_requirePickToAdvance() {
		if ((this._step === "origin" || this._step === "nature") && !Number.isInteger(this._picks[this._step])) {
			ui.notifications?.warn(PICK_WARN[this._step]);
			return false;
		}
		return true;
	}

	_goBack() {
		const idx = STEPS.indexOf(this._step);
		if (idx > 0) { this._step = STEPS[idx - 1]; this.render(false); }
	}

	_goNext() {
		if (!this._requirePickToAdvance()) return;
		const idx = STEPS.indexOf(this._step);
		if (idx < STEPS.length - 1) { this._step = STEPS[idx + 1]; this.render(false); }
	}

	async _create() {
		const name = this._name.trim();
		if (!name) {
			ui.notifications?.warn("Name your arcanum first.");
			this.element[0]?.querySelector("[name=arcName]")?.focus();
			return;
		}
		const description = seedDescriptionHtml(this._chosenLines());
		await this._onCreate?.({ name, major: this._major, front: description ? { description } : undefined });
		this.close();
	}
}
