import { StepperDialog } from "../dialogs/StepperDialog.js";
import {
	HAZARD_DAMAGE_DICE, HAZARD_DAMAGE_EFFECTS, HAZARD_DAMAGE_ADVICE, HAZARD_MOVE_PROMPTS,
} from "./hazard-data.js";
import { hazardDamageLine } from "./hazard-view.js";
import { shapeHazardSystem, setHazardName } from "./hazard-store.js";

// ── CreateHazardDialog ───────────────────────────────────────────────────────
// A walkthrough for "Preparing hazards" (Book I, Dangers, pp. 381-389), the
// environmental half of the Dangers chapter (monsters have the Make-a-Monster
// worksheet). It follows the book's own structure as a linear stepper: picture the
// hazard, work out its damage (p. 383's worksheet), write GM moves and an instinct
// (p. 386), an optional impending-doom track (p. 387), and optional custom player
// moves (p. 388). Mirrors CreateFollowerDialog (shared StepperDialog scaffolding
// and .stonetop-cf-* control styles).
//
// Two modes: created without a page it resolves the collected SEED via promise()
// (the steading sheet then calls createHazard); created with `{ page }` it opens
// pre-filled, the final button becomes "Save hazard", and it applies the update to
// the page itself, resolving the page. This doubles as the hazard editor, so there
// is no separate hazard-editor dialog.

const _STEPS = [
	{
		key:   "concept",
		title: "Picture the hazard",
		icon:  "fa-feather-pointed",
		body:  `<p>Hazards are <strong>environmental dangers</strong>: traps, treacherous terrain, weather. They can't be fought with spear and shield; they must be <strong>avoided, endured, thwarted, or overcome</strong>.</p>
				<p>Name it, then think through the specifics: where is it? What does it look like? What triggers it? How does it work? Prep as much or as little as you find valuable.</p>`,
	},
	{
		key:   "damage",
		title: "Work out its damage",
		icon:  "fa-burst",
		body:  `<p>If the hazard deals damage, ask what it could likely do to <strong>a normal person</strong>; the worst plausible outcome sets the die. Then add every effect that applies.</p>`,
	},
	{
		key:   "moves",
		title: "Write its GM moves",
		icon:  "fa-bolt",
		body:  `<p>Write fairly specific GM moves for how the hazard is <strong>foreshadowed</strong>, how it <strong>harms or hinders</strong>, how it <strong>escalates</strong>, and how it might <strong>thwart</strong> attempts to overcome it.</p>
				<p>If it's dynamic and changing (a storm, a wildfire, creeping vines), give it an <strong>instinct</strong> to guide its behavior.</p>`,
	},
	{
		key:   "doom",
		title: "Impending doom (optional)",
		icon:  "fa-hourglass-half",
		body:  `<p><em>Optional.</em> For a hazard that builds to a catastrophe, write 1&ndash;4 <strong>grim portents</strong> (increasingly bad events) that end in a final <strong>impending doom</strong>. To make a portent happen more than once, add it more than once.</p>
				<p>Note what advances the track; the trigger can be fictional ("each time a pillar is struck") or mechanical ("each time someone rolls doubles").</p>`,
	},
	{
		key:   "playermove",
		title: "Custom player move (optional)",
		icon:  "fa-scroll",
		body:  `<p><em>Optional.</em> A player-facing move bakes the stakes right in ("When you fall from the boughs of the tree, take 1d10+3 damage and roll +CON&hellip;"), and suits "weird" hazards: magic that messes with minds or follows strange rules of cause and effect.</p>`,
	},
	{
		key:     "review",
		title:   "Review",
		icon:    "fa-clipboard-check",
		isFinal: true,
		body:    `<p>Look it over. Its card lives on the GM Toolkit beside your threats: drag it onto a scene to pin it to the map, and edit it any time.</p>`,
	},
];

// The free-text scalar fields the generic [data-field] change handler may persist
// onto `_sel`; list-row fields are captured by their own classed handlers.
const _TEXT_FIELDS = new Set(["name", "description", "damageExtra", "instinct", "advanceTrigger"]);

export class CreateHazardDialog extends StepperDialog {
	/** @param {{ page?: JournalEntryPage|null }} [config] pass a hazard page to edit it in place. */
	constructor({ page = null } = {}, options = {}) {
		// Editing gets a per-page window id so two hazards can be open side by side;
		// creation keeps the fixed id (one "Make a Hazard" at a time).
		super(page ? foundry.utils.mergeObject({ id: `stonetop-create-hazard-${page.id}` }, options) : options);
		this._page = page;
		this._sel = page ? this._seedFromPage(page) : {
			name: "", description: "",
			damageDie: "", damageEffects: [], damageExtra: "", certainDeath: false,
			instinct: "", gmMoves: [""],
			advanceTrigger: "", grimPortents: [], impendingDoom: { text: "", done: false },
			playerMoves: [],
		};
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-create-hazard",
			template:  "systems/stonetop-pwd/templates/dialogs/create-hazard.hbs",
			width:     560,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-create-hazard-dialog"],
		});
	}

	get title() { return this._page ? `Hazard: ${this._page.name}` : "Make a Hazard"; }

	get _steps() { return _STEPS; }
	get _autoHeight() { return true; }

	// Working state seeded from an existing page (edit mode). Doom-track `done` states
	// ride along invisibly so saving an edit never un-ticks a portent that came to pass.
	_seedFromPage(page) {
		const sys = page.system ?? {};
		const gmMoves = (sys.gmMoves ?? []).map(String);
		return {
			name: page.name ?? "",
			description: String(sys.description ?? ""),
			damageDie: sys.damageDie ?? "",
			damageEffects: [...(sys.damageEffects ?? [])],
			damageExtra: String(sys.damageExtra ?? ""),
			certainDeath: !!sys.certainDeath,
			instinct: String(sys.instinct ?? ""),
			gmMoves: gmMoves.length ? gmMoves : [""],
			advanceTrigger: String(sys.advanceTrigger ?? ""),
			grimPortents: (sys.grimPortents ?? []).map(p => ({ text: String(p?.text ?? ""), done: !!p?.done })),
			impendingDoom: { text: String(sys.impendingDoom?.text ?? ""), done: !!sys.impendingDoom?.done },
			playerMoves: (sys.customPlayerMoves ?? []).map(m => ({ label: String(m?.label ?? ""), text: String(m?.text ?? "") })),
		};
	}

	// The damage line as it will read on the card, kept live as picks are toggled.
	get _damagePreview() {
		const sel = this._sel;
		const line = hazardDamageLine({
			damageDie: sel.damageDie,
			damageEffects: sel.damageEffects,
			damageExtra: sel.damageExtra,
			certainDeath: sel.certainDeath,
		});
		return line || "no damage";
	}

	getData() {
		const nav  = this._stepNav();
		const step = nav.step;
		const sel  = this._sel;
		const ctx  = {
			...nav,
			sel,
			isEdit: !!this._page,
		};

		if (step.key === "damage") {
			ctx.damageDice = HAZARD_DAMAGE_DICE.map(d => ({
				...d, selected: sel.damageDie === d.id, value: d.id || "no roll",
			}));
			ctx.damageEffects = HAZARD_DAMAGE_EFFECTS.map(e => ({
				...e, checked: sel.damageEffects.includes(e.id),
			}));
			ctx.certainDeath = sel.certainDeath;
			ctx.damageAdvice = HAZARD_DAMAGE_ADVICE;
			ctx.damagePreview = this._damagePreview;
		}
		if (step.key === "moves") {
			ctx.moveRows = sel.gmMoves.map((text, index) => ({
				index, text,
				placeholder: `${HAZARD_MOVE_PROMPTS[index % HAZARD_MOVE_PROMPTS.length]}…`,
			}));
		}
		if (step.key === "doom") {
			ctx.portentRows = sel.grimPortents.map((p, index) => ({ index, text: p.text }));
		}
		if (step.key === "playermove") {
			ctx.playerMoveRows = sel.playerMoves.map((m, index) => ({ index, label: m.label, text: m.text }));
		}
		if (step.isFinal) ctx.preview = this._previewCard();
		return ctx;
	}

	// A compact summary of the hazard-to-be, shown on the final step.
	_previewCard() {
		const sel = this._sel;
		const clean = list => list.map(s => String(s).trim()).filter(Boolean);
		return {
			name:           sel.name.trim() || "Unnamed hazard",
			damage:         this._damagePreview,
			instinct:       sel.instinct.trim(),
			description:    sel.description.trim(),
			gmMoves:        clean(sel.gmMoves),
			advanceTrigger: sel.advanceTrigger.trim(),
			portents:       clean(sel.grimPortents.map(p => p.text)),
			impendingDoom:  sel.impendingDoom.text.trim(),
			playerMoves:    sel.playerMoves.filter(m => m.label.trim() || m.text.trim()),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._bindStepNav(html);

		html.find(".stonetop-ch-create").on("click", () => this._finish());

		// Scalar text fields persist on blur (no re-render, so focus survives typing);
		// the damage extras re-render for the live damage line.
		html.find("[data-field]").on("change", ev => {
			const el = ev.currentTarget;
			if (!_TEXT_FIELDS.has(el.dataset.field)) return;
			this._sel[el.dataset.field] = el.value;
			if (el.dataset.field === "damageExtra") this.render(false);
		});

		// Damage worksheet picks re-render to keep the damage line live.
		html.find(".stonetop-ch-damage-die").on("change", ev => { this._sel.damageDie = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-ch-damage-effect").on("change", () => {
			this._sel.damageEffects = html.find(".stonetop-ch-damage-effect:checked").toArray().map(el => el.value);
			this.render(false);
		});
		html.find(".stonetop-ch-certain-death").on("change", ev => { this._sel.certainDeath = ev.currentTarget.checked; this.render(false); });

		// GM move / portent / player-move row inputs don't re-render, so their typed values
		// are read back by _captureLiveFields (run before every step change, row add/remove,
		// and finish) — no per-input change handler needed. Only the add/remove buttons wire up.
		html.find(".stonetop-ch-move-add").on("click", () => { this._captureLiveFields(); this._sel.gmMoves.push(""); this.render(false); });
		html.find(".stonetop-ch-move-remove").on("click", ev => {
			this._captureLiveFields();
			this._sel.gmMoves.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});

		// Grim portent rows.
		html.find(".stonetop-ch-portent-add").on("click", () => { this._captureLiveFields(); this._sel.grimPortents.push({ text: "", done: false }); this.render(false); });
		html.find(".stonetop-ch-portent-remove").on("click", ev => {
			this._captureLiveFields();
			this._sel.grimPortents.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});
		// Player move rows.
		html.find(".stonetop-ch-pm-add").on("click", () => { this._captureLiveFields(); this._sel.playerMoves.push({ label: "", text: "" }); this.render(false); });
		html.find(".stonetop-ch-pm-remove").on("click", ev => {
			this._captureLiveFields();
			this._sel.playerMoves.splice(Number(ev.currentTarget.dataset.index), 1);
			this.render(false);
		});
	}

	// Capture any focused-but-unblurred field before leaving the step (Back/Next/jump)
	// or mutating a row list, so a just-typed value isn't lost.
	_onBeforeStepChange() {
		this._captureLiveFields();
	}

	_captureLiveFields() {
		const root = this.element?.[0];
		if (!root) return;
		root.querySelectorAll("[data-field]").forEach(el => {
			if (_TEXT_FIELDS.has(el.dataset.field)) this._sel[el.dataset.field] = el.value;
		});
		this._captureRowInputs(root, ".stonetop-ch-move-input", this._sel.gmMoves);
		root.querySelectorAll(".stonetop-ch-portent-input").forEach(el => {
			const i = Number(el.dataset.index);
			if (this._sel.grimPortents[i]) this._sel.grimPortents[i].text = el.value;
		});
		const doomFinal = root.querySelector(".stonetop-ch-doom-final");
		if (doomFinal) this._sel.impendingDoom.text = doomFinal.value;
		root.querySelectorAll(".stonetop-ch-pm-label, .stonetop-ch-pm-text").forEach(el => {
			const i = Number(el.dataset.index);
			const row = this._sel.playerMoves[i];
			if (row) row[el.classList.contains("stonetop-ch-pm-label") ? "label" : "text"] = el.value;
		});
	}

	// The collected seed, in the shape shapeHazardSystem / createHazard expect.
	_seed() {
		const sel = this._sel;
		return {
			name: sel.name.trim() || "New Hazard",
			description: sel.description,
			damageDie: sel.damageDie,
			damageEffects: sel.damageEffects,
			damageExtra: sel.damageExtra,
			certainDeath: sel.certainDeath,
			instinct: sel.instinct.trim(),
			gmMoves: sel.gmMoves.map(s => String(s).trim()).filter(Boolean),
			advanceTrigger: sel.advanceTrigger.trim(),
			grimPortents: sel.grimPortents.filter(p => String(p.text).trim()),
			impendingDoom: sel.impendingDoom,
			customPlayerMoves: sel.playerMoves.filter(m => m.label.trim() || m.text.trim()),
		};
	}

	async _finish() {
		this._captureLiveFields();
		const seed = this._seed();
		if (this._page) {
			// Edit mode: apply in place. The name is the hazard's identity across the page,
			// its entry, and its scene pins, so it routes through setHazardName.
			await this._page.update({ system: shapeHazardSystem(seed) });
			await setHazardName(this._page, seed.name);
			this._resolveWith(this._page);
		} else {
			this._resolveWith(seed);
		}
	}

}
