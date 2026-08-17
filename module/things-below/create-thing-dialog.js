import { StepperDialog } from "../dialogs/StepperDialog.js";
import { escHtml } from "../utils/strings.js";
import {
	THEMES, ASPECTS, INSTINCTS,
	rollDistinct, rollOnTable, rollThingName, themeLabels, aspectTexts,
	themeCheckboxes, aspectCheckboxes,
} from "../data/things-below-tables.js";
import { THINGS_BELOW, thingBelowPreset, presetFullName } from "../data/things-below-presets.js";
import { threatType, THREAT_PROXIMITIES } from "../threats/threat-types.js";

// ── CreateThingDialog ────────────────────────────────────────────────────────
// A walkthrough for "Creating a Thing" (Book II, The Things Below, pp. 416-418): start
// from scratch or one of the six established Things, combine 2+ themes with 2+ aspects,
// choose an instinct, and name it with grandiose titles. It's written up as a THREAT
// (a magical entity), so the wizard resolves a threat SEED via promise(); the content
// picker turns that into a draggable card the GM drops onto a steading's Threats tab.
// Mirrors CreateHazardDialog (shared StepperDialog scaffolding + .stonetop-cf-* styles).

const THING_TYPE = "magicalEntity";

const _STEPS = [
	{
		key:   "concept",
		title: "Name your Thing",
		icon:  "fa-eye",
		body:  `<p>The <strong>Things Below</strong> are primordial entities of darkness, chaos, and corruption, bound within the earth. Start from scratch, or flesh out one of the six already whispered of.</p>
				<p>Give it a name (crude approximations of the unpronounceable) and one or more <strong>grandiose titles</strong>.</p>`,
	},
	{
		key:   "themes",
		title: "Choose its themes",
		icon:  "fa-fire",
		body:  `<p>Pick <strong>two or more themes</strong>. Combine them and see where they take you; the associated imagery flavors your descriptions.</p>`,
	},
	{
		key:   "aspects",
		title: "Choose its aspects",
		icon:  "fa-dragon",
		body:  `<p>Pick <strong>two or more aspects</strong>. The Things Below are not bound by biology, physics, or reality, so make their aspects impossible and weird, things of fever-dream and drug-fueled vision.</p>`,
	},
	{
		key:   "instinct",
		title: "Give it an instinct",
		icon:  "fa-brain",
		body:  `<p>Choose or roll an <strong>instinct</strong>, or invent your own. Tweak it to reflect your growing understanding of this particular Thing.</p>`,
	},
	{
		key:   "moves",
		title: "Its GM moves",
		icon:  "fa-bolt",
		body:  `<p>An ongoing Thing is written up as a threat (a magical entity). Pick the GM moves it makes, and add your own.</p>`,
	},
	{
		key:     "review",
		title:   "Review",
		icon:    "fa-clipboard-check",
		isFinal: true,
		body:    `<p>Look it over. Its card goes to the homebrew Threats journal; drag it onto the GM Toolkit's Threats tab to make it a live threat.</p>`,
	},
];

export class CreateThingDialog extends StepperDialog {
	constructor(options = {}) {
		super(options);
		this._preset = "";
		this._name = "";
		this._titlesText = "";
		this._proximity = "distant"; // Things Below are cosmic; usually a distant threat
		this._themeIds = new Set();
		this._aspectIds = new Set();
		this._instinctId = null;
		this._instinctCustom = "";
		this._selectedMoves = new Set();
		this._customMoves = [""];
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-create-thing",
			template:  "systems/stonetop-pwd/templates/dialogs/create-thing.hbs",
			width:     580,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-thing-dialog"],
		});
	}

	get title() { return "Create a Thing Below"; }
	get _steps() { return _STEPS; }
	get _autoHeight() { return true; }

	// The union of moves offered as a checklist: the magical-entity type's suggested moves,
	// the chosen preset's moves, and any already-selected move (so a switch never drops a pick).
	_moveOptions() {
		const type = threatType(THING_TYPE);
		const preset = thingBelowPreset(this._preset);
		const all = [...type.suggestedMoves, ...(preset?.moves ?? []), ...this._selectedMoves];
		const seen = new Set();
		const out = [];
		for (const m of all) {
			const t = String(m).trim();
			if (!t || seen.has(t)) continue;
			seen.add(t);
			out.push(t);
		}
		return out;
	}

	_titles() {
		return this._titlesText.split(/[\n]+/).map(s => s.trim()).filter(Boolean);
	}

	_effectiveInstinct() {
		const custom = this._instinctCustom.trim();
		if (custom) return custom;
		const entry = INSTINCTS.find(i => i.id === this._instinctId);
		return entry ? entry.text : "";
	}

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const ctx  = { ...nav };

		if (step.key === "concept") {
			ctx.presets = [
				{ slug: "", label: "From scratch", selected: this._preset === "" },
				...THINGS_BELOW.map(p => ({ slug: p.slug, label: presetFullName(p), selected: this._preset === p.slug })),
			];
			ctx.name = this._name;
			ctx.titlesText = this._titlesText;
			ctx.proximities = THREAT_PROXIMITIES.map(p => ({ id: p.id, label: p.label, selected: p.id === this._proximity }));
		}
		if (step.key === "themes") {
			ctx.themes = themeCheckboxes(this._themeIds);
			ctx.themeCount = this._themeIds.size;
		}
		if (step.key === "aspects") {
			ctx.aspects = aspectCheckboxes(this._aspectIds);
			ctx.aspectCount = this._aspectIds.size;
		}
		if (step.key === "instinct") {
			ctx.instincts = INSTINCTS.map(i => ({ id: i.id, label: i.text, selected: this._instinctId === i.id && !this._instinctCustom.trim() }));
			ctx.instinctCustom = this._instinctCustom;
		}
		if (step.key === "moves") {
			ctx.moveOptions = this._moveOptions().map(text => ({ text, checked: this._selectedMoves.has(text) }));
			ctx.customMoveRows = this._customMoves.map((text, index) => ({ index, text }));
		}
		if (step.isFinal) ctx.preview = this._previewCard();
		return ctx;
	}

	_previewCard() {
		return {
			name:     this._name.trim() || "Unnamed Thing",
			titles:   this._titles(),
			themes:   themeLabels(this._themeIds),
			aspects:  aspectTexts(this._aspectIds),
			instinct: this._effectiveInstinct(),
			gmMoves:  this._effectiveMoves(),
		};
	}

	_effectiveMoves() {
		const options = this._moveOptions().filter(m => this._selectedMoves.has(m));
		const custom = this._customMoves.map(s => String(s).trim()).filter(Boolean);
		const seen = new Set();
		const out = [];
		for (const m of [...options, ...custom]) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
		return out;
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		html.find(".stonetop-tb-create").on("click", () => this._finish());

		// Concept step: preset choice, name/titles, proximity, roll-a-name.
		html.find(".stonetop-tb-preset").on("change", ev => { this._capture(html); this._applyPreset(ev.currentTarget.value); this.render(false); });
		html.find("[data-field='name']").on("change", ev => { this._name = ev.currentTarget.value; });
		html.find("[data-field='titles']").on("change", ev => { this._titlesText = ev.currentTarget.value; });
		html.find(".stonetop-tb-proximity").on("change", ev => { this._proximity = ev.currentTarget.value; });
		html.find(".stonetop-tb-roll-name").on("click", () => {
			this._capture(html);
			const themes = [...this._themeIds].map(id => THEMES.find(t => t.id === id)).filter(Boolean);
			const { name, titles } = rollThingName(Math.random, themes);
			this._name = name;
			this._titlesText = titles.join("\n");
			this.render(false);
		});

		// Theme / aspect checkboxes + their roll buttons.
		html.find(".stonetop-tb-theme").on("change", ev => this._toggleInSet(this._themeIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-themes").on("click", () => { this._addIds(this._themeIds, rollDistinct(THEMES, 2, Math.random, this._themeIds)); this.render(false); });
		html.find(".stonetop-tb-aspect").on("change", ev => this._toggleInSet(this._aspectIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-aspects").on("click", () => { this._addIds(this._aspectIds, rollDistinct(ASPECTS, 2, Math.random, this._aspectIds)); this.render(false); });

		// Instinct radio + custom text + roll.
		html.find(".stonetop-tb-instinct").on("change", ev => { this._instinctId = Number(ev.currentTarget.value); this._instinctCustom = ""; });
		html.find("[data-field='instinctCustom']").on("change", ev => { this._instinctCustom = ev.currentTarget.value; });
		html.find(".stonetop-tb-roll-instinct").on("click", () => { this._instinctId = rollOnTable(INSTINCTS)?.id ?? null; this._instinctCustom = ""; this.render(false); });

		// Move checklist + custom rows.
		html.find(".stonetop-tb-move").on("change", ev => {
			const v = ev.currentTarget.value;
			if (ev.currentTarget.checked) this._selectedMoves.add(v); else this._selectedMoves.delete(v);
		});
		html.find(".stonetop-tb-move-add").on("click", () => { this._captureCustomMoves(); this._customMoves.push(""); this.render(false); });
		html.find(".stonetop-tb-move-remove").on("click", ev => {
			this._captureCustomMoves();
			this._customMoves.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});
	}

	// Overwrite name/titles/themes/instinct/moves from a preset (empty slug = from scratch,
	// which leaves the GM's own edits untouched).
	_applyPreset(slug) {
		this._preset = slug;
		const preset = thingBelowPreset(slug);
		if (!preset) return;
		this._name = preset.name;
		this._titlesText = (preset.titles ?? []).join("\n");
		this._themeIds = new Set(preset.themeIds ?? []);
		this._instinctCustom = preset.instinct ?? "";
		this._instinctId = null;
		this._selectedMoves = new Set(preset.moves ?? []);
	}

	_onBeforeStepChange() { this._capture(this.element); this._captureCustomMoves(); }

	// Snapshot the focused-but-unblurred scalar fields on the active step.
	_capture(html) {
		const root = html?.jquery ? html[0] : (html ?? this.element?.[0]);
		if (!root?.querySelector) return;
		const name = root.querySelector("[data-field='name']");
		if (name) this._name = name.value;
		const titles = root.querySelector("[data-field='titles']");
		if (titles) this._titlesText = titles.value;
		const custom = root.querySelector("[data-field='instinctCustom']");
		if (custom) this._instinctCustom = custom.value;
		const prox = root.querySelector(".stonetop-tb-proximity:checked");
		if (prox) this._proximity = prox.value;
	}

	_captureCustomMoves() {
		this._captureRowInputs(this.element, ".stonetop-tb-move-input", this._customMoves);
	}

	// Build the threat seed the store shapes into a magical-entity threat page.
	_seed() {
		const titles = this._titles();
		const preset = thingBelowPreset(this._preset);
		const descParts = [];
		if (titles.length) descParts.push(`<p><em>${titles.map(escHtml).join(", ")}</em></p>`);
		if (preset?.blurb) descParts.push(`<p>${escHtml(preset.blurb)}</p>`);
		const seeAlso = preset?.seeAlso ?? [];
		if (seeAlso.length) descParts.push(`<p><strong>See also:</strong> ${seeAlso.map(escHtml).join(", ")}.</p>`);

		return {
			name: this._name.trim() || "New Thing Below",
			type: THING_TYPE,
			proximity: this._proximity,
			instinct: this._effectiveInstinct(),
			themes:  themeLabels(this._themeIds),
			aspects: aspectTexts(this._aspectIds),
			gmMoves: this._effectiveMoves(),
			description: descParts.join(""),
		};
	}

	_finish() {
		this._capture(this.element);
		this._captureCustomMoves();
		this._resolveWith(this._seed());
	}
}
