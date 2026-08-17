import { StepperDialog } from "../dialogs/StepperDialog.js";
import { creatureTypeIcon } from "../bestiary/creature-types.js";
import { invalidateMonsterRefIndex } from "../bestiary/monster-ref-index.js";
import { formatCustomMoveDescription } from "../utils/custom-move-text.js";
import { buildMonsterActorData } from "../data/monster-builder.js";
import { THEMES, ASPECTS, EMANATION_ORIGINS, rollOnTable, rollDistinct, themeLabels, aspectTexts, themeCheckboxes, aspectCheckboxes } from "../data/things-below-tables.js";
import { GIFTS, MARKS, EMANATION_BASE, applyCorruption } from "../data/corruption-tables.js";

// ── CorruptBeingDialog ───────────────────────────────────────────────────────
// The lighter "corruption layer" wizard for two Book II flows:
//   • Corrupted being (p. 432): start with an existing NPC/monster's stats, add themes/
//     aspects/instinct + up to 3 gifts + up to 3 marks + the "corrupted" tag.
//   • Emanation (p. 436): a Thing's discharge given form — same layer plus an origin, atop
//     a chosen source OR a solitary emanation template.
// It doesn't reopen the full Make-a-Monster worksheet; it reads a source monster's derived
// stats, folds the picks with applyCorruption(), and creates a new `monster` Actor (the
// same terminal as CreateMonsterDialog). `mode` = "being" | "emanation".

const _STEP_DEFS = {
	source: {
		key:   "source",
		title: "Starting point",
		icon:  "fa-dna",
	},
	origin: {
		key:   "origin",
		title: "Its origin",
		icon:  "fa-hurricane",
		body:  `<p>An <strong>emanation</strong> is not truly part of a Thing Below &mdash; it is discharge, leavings, spawn, with a will and purpose of its own. How did it form?</p>`,
	},
	essence: {
		key:   "essence",
		title: "Themes, aspects & instinct",
		icon:  "fa-fire",
		body:  `<p>Identify the <strong>themes</strong>, <strong>aspects</strong>, and <strong>instinct</strong> of the Thing responsible. How has corruption changed the being &mdash; are they merely a conduit for their master's instinct, or do they struggle to keep their own?</p>`,
	},
	gifts: {
		key:   "gifts",
		title: "Gifts",
		icon:  "fa-gift",
		body:  `<p>Corruption makes them <em>more</em> than they were. Pick or roll <strong>up to 3 gifts</strong>.</p>`,
	},
	marks: {
		key:   "marks",
		title: "Marks",
		icon:  "fa-splotch",
		body:  `<p>Corruption also makes them <em>less</em>. Pick or roll <strong>up to 3 marks</strong>.</p>`,
	},
	review: {
		key:     "review",
		title:   "Review",
		icon:    "fa-clipboard-check",
		isFinal: true,
		body:    `<p>Look it over, then create the stat block. Open its sheet afterward to tweak anything: corruption often reshapes tags, qualities, and moves in ways worth revising.</p>`,
	},
};

const _MAX_PICKS = 3;

export class CorruptBeingDialog extends StepperDialog {
	/** @param {{ mode?: "being"|"emanation", folder?: string|null }} [config] */
	constructor({ mode = "being", folder = null } = {}, options = {}) {
		super(options);
		this._mode = mode === "emanation" ? "emanation" : "being";
		// Set when launched from a folder in the Actors sidebar, so the stat block lands
		// where the GM asked for it rather than at the root.
		this._folder = folder;
		this._sourceId = "";
		this._name = "";
		this._themeIds = new Set();
		this._aspectIds = new Set();
		this._instinct = "";
		this._originText = "";
		this._giftIds = new Set();
		this._markIds = new Set();
		this._submitting = false;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-corrupt-being",
			template:  "systems/stonetop-pwd/templates/dialogs/corrupt-being.hbs",
			width:     600,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-thing-dialog"],
		});
	}

	get title() { return this._mode === "emanation" ? "Create an Emanation" : "Corrupt a Being"; }

	get _steps() {
		const order = this._mode === "emanation"
			? ["source", "origin", "essence", "gifts", "review"]
			: ["source", "essence", "gifts", "marks", "review"];
		return order.map(k => _STEP_DEFS[k]);
	}
	get _autoHeight() { return true; }

	// The monster actors a GM can corrupt (world actors of type "monster").
	_sourceMonsters() {
		return (globalThis.game?.actors?.filter?.(a => a.type === "monster") ?? [])
			.map(a => ({ id: a.id, name: a.name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	// Read the source monster's derived stats into the applyCorruption() base shape. For an
	// emanation with no source, fall back to the solitary emanation template.
	_base() {
		const src = this._sourceId ? globalThis.game?.actors?.get?.(this._sourceId) : null;
		if (!src) return this._mode === "emanation" ? { ...EMANATION_BASE, _src: null } : null;
		const sys = src.system ?? {};
		const attr = sys.attributes ?? {};
		return {
			hp: Number(attr.hp?.max ?? attr.hp?.value ?? 0),
			armorValue: Number(attr.armor?.value ?? 0),
			armorSource: String(attr.armor?.source ?? ""),
			damageValue: String(attr.damage?.value ?? ""),
			rollFormula: String(attr.damage?.rollFormula ?? ""),
			tags: String(sys.tags ?? ""),
			qualities: String(sys.qualities ?? ""),
			instinct: String(attr.instinct?.value ?? ""),
			concept: String(sys.concept ?? ""),
			organization: String(sys.organization ?? ""),
			size: String(sys.size ?? ""),
			count: Number(sys.count ?? 1),
			_src: src,
		};
	}

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const ctx  = { ...nav, mode: this._mode, isEmanation: this._mode === "emanation" };

		if (step.key === "source") {
			ctx.sources = [
				{ id: "", label: this._mode === "emanation" ? "From scratch (solitary emanation)" : "(choose a monster to corrupt)", selected: this._sourceId === "" },
				...this._sourceMonsters().map(m => ({ id: m.id, label: m.name, selected: m.id === this._sourceId })),
			];
			ctx.name = this._name;
			ctx.needsSource = this._mode === "being";
		}
		if (step.key === "origin") {
			ctx.origins = EMANATION_ORIGINS.map(o => ({ text: o.text, selected: o.text === this._originText }));
			ctx.originText = this._originText;
		}
		if (step.key === "essence") {
			ctx.themes = themeCheckboxes(this._themeIds);
			ctx.aspects = aspectCheckboxes(this._aspectIds);
			ctx.instinct = this._instinct;
		}
		if (step.key === "gifts") {
			ctx.gifts = GIFTS.map(g => ({ id: g.id, label: g.label, checked: this._giftIds.has(g.id) }));
			ctx.pickCount = this._giftIds.size;
			ctx.atMax = this._giftIds.size >= _MAX_PICKS;
		}
		if (step.key === "marks") {
			ctx.marks = MARKS.map(m => ({ id: m.id, label: m.label, checked: this._markIds.has(m.id) }));
			ctx.pickCount = this._markIds.size;
			ctx.atMax = this._markIds.size >= _MAX_PICKS;
		}
		if (step.isFinal) {
			const base = this._base();
			ctx.preview = this._previewCard(base);
			ctx.canCreate = !!base;
		}
		return ctx;
	}

	_previewCard(base = this._base()) {
		if (!base) return { missing: true };
		const r = applyCorruption(base, { gifts: [...this._giftIds], marks: [...this._markIds], addEmanation: this._mode === "emanation" });
		return {
			name:      this._effectiveName(base),
			hp:        r.hp,
			armor:     r.armorSource ? `${r.armorValue} (${r.armorSource})` : String(r.armorValue),
			damage:    r.damageValue || "—",
			tags:      r.tags.join(", "),
			qualities: r.qualities,
			instinct:  this._effectiveInstinct(base),
			moves:     r.moves.map(m => m.name),
			notes:     r.notes,
		};
	}

	_effectiveName(base) {
		const typed = this._name.trim();
		if (typed) return typed;
		if (base?._src?.name) return `Corrupted ${base._src.name}`;
		return this._mode === "emanation" ? "New Emanation" : "Corrupted Being";
	}

	_effectiveInstinct(base) {
		return this._instinct.trim() || String(base?.instinct ?? "");
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		html.find(".stonetop-tb-create").on("click", () => this._finish());

		html.find(".stonetop-tb-source").on("change", ev => { this._sourceId = ev.currentTarget.value; this.render(false); });
		html.find("[data-field='name']").on("change", ev => { this._name = ev.currentTarget.value; });

		html.find(".stonetop-tb-origin").on("change", ev => { this._originText = ev.currentTarget.value; });
		html.find(".stonetop-tb-roll-origin").on("click", () => { this._originText = rollOnTable(EMANATION_ORIGINS)?.text ?? ""; this.render(false); });

		html.find(".stonetop-tb-theme").on("change", ev => this._toggleInSet(this._themeIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-themes").on("click", () => { this._onBeforeStepChange(); this._addIds(this._themeIds, rollDistinct(THEMES, 2, Math.random, this._themeIds)); this.render(false); });
		html.find(".stonetop-tb-aspect").on("change", ev => this._toggleInSet(this._aspectIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-aspects").on("click", () => { this._onBeforeStepChange(); this._addIds(this._aspectIds, rollDistinct(ASPECTS, 2, Math.random, this._aspectIds)); this.render(false); });
		html.find("[data-field='instinct']").on("change", ev => { this._instinct = ev.currentTarget.value; });

		html.find(".stonetop-tb-gift").on("change", ev => this._toggleCapped(this._giftIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-gifts").on("click", () => { this._rollPicks(this._giftIds, GIFTS); this.render(false); });
		html.find(".stonetop-tb-mark").on("change", ev => this._toggleCapped(this._markIds, Number(ev.currentTarget.value), ev.currentTarget.checked));
		html.find(".stonetop-tb-roll-marks").on("click", () => { this._rollPicks(this._markIds, MARKS); this.render(false); });
	}

	// Cap a pick set at 3: silently ignore a check past the cap (re-render un-ticks it).
	_toggleCapped(set, id, on) {
		if (on) {
			if (set.size >= _MAX_PICKS) { this.render(false); return; }
			set.add(id);
		} else set.delete(id);
	}

	// Roll up to (cap - current) distinct new picks into the set.
	_rollPicks(set, table) {
		const room = _MAX_PICKS - set.size;
		if (room <= 0) return;
		for (const e of rollDistinct(table, room, Math.random, set)) {
			if (set.size >= _MAX_PICKS) break;
			set.add(e.id);
		}
	}

	_onBeforeStepChange() {
		const root = this.element?.[0];
		if (!root) return;
		const name = root.querySelector("[data-field='name']");
		if (name) this._name = name.value;
		const instinct = root.querySelector("[data-field='instinct']");
		if (instinct) this._instinct = instinct.value;
	}

	// Assemble the corrupted-monster actor data (mirrors CreateMonsterDialog._buildActorData).
	_buildActorData() {
		const base = this._base();
		if (!base) return null;
		const r = applyCorruption(base, { gifts: [...this._giftIds], marks: [...this._markIds], addEmanation: this._mode === "emanation" });

		const creatureType = this._mode === "emanation" ? "emanation" : "corrupted";
		const img = creatureTypeIcon(creatureType) ?? undefined;
		const name = this._effectiveName(base);
		const instinct = this._effectiveInstinct(base);

		const themes  = themeLabels(this._themeIds);
		const aspects = aspectTexts(this._aspectIds);
		const noteLines = [];
		if (themes.length)  noteLines.push(`Themes: ${themes.join("; ")}.`);
		if (aspects.length) noteLines.push(`Aspects: ${aspects.join("; ")}.`);
		if (this._originText.trim()) noteLines.push(`Origin: ${this._originText.trim()}.`);
		for (const n of r.notes) noteLines.push(`Mark: ${n}.`);

		// Carry the source monster's existing moves, then append the gift/mark moves.
		const srcMoves = (base._src?.items?.contents ?? base._src?.items ?? [])
			.filter(i => i?.type === "monsterMove")
			.map(i => ({ name: i.name || "Move", type: "monsterMove", system: { description: String(i.system?.description ?? ""), rollFormula: String(i.system?.rollFormula ?? "") } }));
		const giftMoves = r.moves.map(m => ({
			name: m.name || "New move",
			type: "monsterMove",
			system: { description: formatCustomMoveDescription(m.description), rollFormula: "" },
		}));

		return buildMonsterActorData({
			name,
			img,
			folder:       this._folder,
			creatureType,
			hp:           r.hp,
			armorValue:   r.armorValue,
			armorSource:  r.armorSource,
			damageValue:  r.damageValue,
			rollFormula:  r.rollFormula,
			instinct,
			concept:      base.concept ?? "",
			organization: base.organization || "solitary",
			size:         base.size ?? "",
			tags:         r.tags.join(", "),
			qualities:    r.qualities.join("; "),
			notes:        noteLines.join(" "),
			count:        base.count || 1,
			items:        [...srcMoves, ...giftMoves],
		});
	}

	async _finish() {
		if (this._submitting) return;
		this._onBeforeStepChange();
		const actorData = this._buildActorData();
		if (!actorData) {
			globalThis.ui?.notifications?.warn?.("Pick a monster to corrupt first.");
			return;
		}
		this._submitting = true;
		let created;
		try {
			created = await Actor.create(actorData, { stonetopMonsterBuilt: true });
		} catch (err) {
			console.error("Stonetop | failed to create corrupted being", err);
			globalThis.ui?.notifications?.error?.("Could not create the stat block. See the console for details.");
			this._submitting = false;
			return;
		}
		invalidateMonsterRefIndex();
		created?.sheet?.render(true);
		this._resolveWith(created ?? null);
	}
}
