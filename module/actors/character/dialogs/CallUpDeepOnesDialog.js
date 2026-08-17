import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { sign } from "../../../utils/roll-engine.js";
import {
	SERVANT_ASPECTS, SERVANT_TAG_OPTIONS, SERVANT_NUMBER_OPTIONS, SERVANT_SIZE_OPTIONS,
	SERVANT_TRAIT_OPTIONS, SERVANT_MOVE_OPTIONS, resolveServantBatch,
} from "../../../data/servant-of-daagon.js";

// ── CallUpDeepOnesDialog ─────────────────────────────────────────────────────
// The Ring of Daagon's "Call Up the Deep Ones" mystery (Book II, "Mysteries of the
// Ring of Daagon"). A Servant batch is rolled and shaped at summon time: roll five
// d4s, assign each to a DIFFERENT aspect, and the assigned die resolves it. For
// Traits and Moves the die value is HOW MANY to choose from a fixed list.
//
// This is a single reactive page (like OrderFollowersDialog): every change re-renders
// so the live stat preview, the choose-N limits, and the Manifest gate stay honest.
// On Manifest it hands { input, cost } back to the caller (the character sheet), which
// pays the cost (1 Loyalty from the Ring, or mark a consequence) and builds the card.

const _ASPECT_KEYS = SERVANT_ASPECTS.map(a => a.key);

export class CallUpDeepOnesDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   ring    - { id, name, loyalty, hasRing } for the shared-Loyalty pool
	 * @param {Function} onApply - async ({ input, cost }) => void
	 */
	constructor(actor, ring, onApply, options = {}) {
		super(options);
		this._actor       = actor;
		this._ring        = ring ?? {};
		this._onApply     = onApply;

		this._dice   = null;                 // [v0..v4], each 1-4 — null until first roll
		this._assign = {};                   // aspectKey → die index (0-4)
		this._count  = 0;                     // headcount rolled from the No. Appearing formula
		this._traits = [];                    // chosen SERVANT_TRAIT_OPTIONS keys
		this._moves  = [];                    // chosen SERVANT_MOVE_OPTIONS labels
		this._name   = "";
		// Default to spending the Ring's Loyalty when it holds any, else mark a consequence.
		this._costKind = (Number(this._ring.loyalty) || 0) > 0 ? "loyalty" : "consequence";
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-call-up-deep-ones",
			title:     "Call Up the Deep Ones",
			template:  "systems/stonetop-pwd/templates/dialogs/call-up-deep-ones.hbs",
			width:     560,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-call-up-dialog"],
		});
	}

	get _autoHeight() { return true; }

	async _render(force, options) {
		// Roll the five d4s once, on first open, and seed a valid default assignment
		// (die i → aspect i) so the page renders resolved rather than blank.
		if (this._dice === null) await this._rollDice();
		await super._render(force, options);
	}

	// ── Dice ─────────────────────────────────────────────────────────────────
	async _rollDice() {
		const roll = await new Roll("5d4").evaluate();
		this._dice = (roll.dice?.[0]?.results ?? []).map(r => r.result);
		while (this._dice.length < 5) this._dice.push(1);   // defensive: always five
		// Default assignment: die i → aspect i (the player can reshuffle).
		this._assign = Object.fromEntries(_ASPECT_KEYS.map((k, i) => [k, i]));
		this._traits = [];
		this._moves  = [];
		await this._rollCount();
	}

	// The die VALUE assigned to an aspect (1-4), or 0 if unassigned.
	_dieFor(aspectKey) {
		const idx = this._assign[aspectKey];
		return Number.isInteger(idx) ? (this._dice?.[idx] ?? 0) : 0;
	}

	// Roll (or re-roll) the headcount from the No. Appearing formula.
	async _rollCount() {
		const opt = SERVANT_NUMBER_OPTIONS[this._dieFor("number")];
		if (!opt) { this._count = 0; return; }
		const roll = await new Roll(opt.countFormula).evaluate();
		this._count = Math.max(1, roll.total);
	}

	_traitLimit() { return this._dieFor("traits"); }
	_moveLimit()  { return this._dieFor("moves"); }

	// The resolver input for the current selections — drives both the live preview and
	// the final Manifest.
	_resolve() {
		return resolveServantBatch({
			aspectDie: {
				tags:   this._dieFor("tags"),
				number: this._dieFor("number"),
				size:   this._dieFor("size"),
				traits: this._dieFor("traits"),
				moves:  this._dieFor("moves"),
			},
			count:        this._count,
			chosenTraits: this._traits,
			chosenMoves:  this._moves,
			name:         this._name,
		});
	}

	// Manifest is allowed once every die is assigned and the player has chosen exactly
	// as many traits / moves as their assigned dice call for.
	_isComplete() {
		const allAssigned = _ASPECT_KEYS.every(k => Number.isInteger(this._assign[k]));
		return allAssigned
			&& this._traits.length === this._traitLimit()
			&& this._moves.length === this._moveLimit();
	}

	getData() {
		const dice = (this._dice ?? []).map((value, index) => {
			const aspectKey = _ASPECT_KEYS.find(k => this._assign[k] === index) ?? null;
			const aspect    = SERVANT_ASPECTS.find(a => a.key === aspectKey) ?? null;
			return { index, value, label: `Die ${index + 1}`, assignedTo: aspect?.label ?? null };
		});

		const usedIndex = new Set(_ASPECT_KEYS.map(k => this._assign[k]).filter(Number.isInteger));

		const aspects = SERVANT_ASPECTS.map(a => {
			const die   = this._dieFor(a.key);
			const chosenIdx = Number.isInteger(this._assign[a.key]) ? this._assign[a.key] : null;
			const options = (this._dice ?? []).map((value, index) => ({
				index, value,
				label:    `Die ${index + 1} = ${value}`,
				selected: chosenIdx === index,
				// A die used by ANOTHER aspect is unavailable here (assigning it swaps, so
				// we still list it — greyed — to make the conflict visible).
				disabled: usedIndex.has(index) && chosenIdx !== index,
			}));
			return { ...a, die, options, outcome: this._aspectOutcome(a.key, die) };
		});

		const traitLimit = this._traitLimit();
		const moveLimit  = this._moveLimit();
		const traitOptions = SERVANT_TRAIT_OPTIONS.map(t => {
			const checked = this._traits.includes(t.key);
			return { ...t, checked, disabled: !checked && this._traits.length >= traitLimit };
		});
		const moveOptions = SERVANT_MOVE_OPTIONS.map(label => {
			const checked = this._moves.includes(label);
			return { label, checked, disabled: !checked && this._moves.length >= moveLimit };
		});

		const p = this._resolve();
		// The template reads a subset of the resolved batch; only `moves` needs reshaping
		// (newline string -> lines). Spreading keeps this in sync as resolveServantBatch grows.
		const preview = { ...p, moves: (p.moves ? p.moves.split("\n") : []) };

		const ringLoyalty = Math.max(0, Number(this._ring.loyalty) || 0);
		return {
			dice,
			aspects,
			numberFormula: SERVANT_NUMBER_OPTIONS[this._dieFor("number")]?.countFormula ?? "",
			count:      this._count,
			traitLimit, moveLimit,
			traitOptions, moveOptions,
			traitCount: this._traits.length,
			moveCount:  this._moves.length,
			traitsMet:  this._traits.length === traitLimit,
			movesMet:   this._moves.length === moveLimit,
			name:       this._name,
			namePlaceholder: preview.name,
			preview,
			hasRing:      !!this._ring.hasRing,
			ringName:     this._ring.name || "the Ring",
			ringLoyalty,
			costLoyalty:  this._costKind === "loyalty",
			costConsequence: this._costKind === "consequence",
			loyaltyDisabled: ringLoyalty <= 0,
			complete:     this._isComplete(),
		};
	}

	// A short, human description of what a die does on a given aspect.
	_aspectOutcome(key, die) {
		if (!die) return "unassigned";
		if (key === "tags") {
			const o = SERVANT_TAG_OPTIONS[die];
			return o?.tag ? `+${o.tag}` : (o?.label ?? "");
		}
		if (key === "number") {
			const o = SERVANT_NUMBER_OPTIONS[die];
			return `${o.label} (${o.countFormula}): HP ${o.hp}, ${o.die}`;
		}
		if (key === "size") {
			const o = SERVANT_SIZE_OPTIONS[die];
			const parts = [];
			if (o.hpMod)  parts.push(`${sign(o.hpMod)} HP`);
			if (o.dmgMod) parts.push(`${sign(o.dmgMod)} dmg`);
			parts.push(o.ranges.join(", "));
			return `${o.label} (${parts.join(", ")})`;
		}
		if (key === "traits") return `choose ${die} trait${die === 1 ? "" : "s"}`;
		if (key === "moves")  return `choose ${die} move${die === 1 ? "" : "s"}`;
		return "";
	}

	activateListeners(html) {
		super.activateListeners(html);

		html.find(".stonetop-cu-reroll").on("click", async () => { await this._rollDice(); this.render(false); });

		// Assign a die to an aspect. Assigning a die already held by another aspect swaps
		// them, so the five aspects always hold a valid bijection of the five dice.
		html.find(".stonetop-cu-assign").on("change", async ev => {
			const aspectKey = ev.currentTarget.dataset.aspect;
			const newIdx    = Number(ev.currentTarget.value);
			await this._assignDie(aspectKey, newIdx);
			this.render(false);
		});

		html.find(".stonetop-cu-count").on("change", ev => {
			this._count = Math.max(1, Math.trunc(Number(ev.currentTarget.value) || 1));
			this.render(false);
		});
		html.find(".stonetop-cu-reroll-count").on("click", async () => { await this._rollCount(); this.render(false); });

		html.find(".stonetop-cu-trait").on("change", ev => this._toggle(this._traits, ev.currentTarget.value, this._traitLimit()));
		html.find(".stonetop-cu-move").on("change", ev => this._toggle(this._moves, ev.currentTarget.value, this._moveLimit()));

		html.find(".stonetop-cu-name").on("change", ev => { this._name = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-cu-cost-input").on("change", ev => { this._costKind = ev.currentTarget.value; this.render(false); });

		html.find(".stonetop-cu-manifest").on("click", () => this._finish());
		html.find(".stonetop-cu-cancel").on("click", () => this.close());
	}

	// Swap-aware assignment: give `aspectKey` the die at `newIdx`; if another aspect held
	// it, that aspect takes whatever `aspectKey` had (keeping a full bijection). Re-rolls
	// the headcount whenever the No. Appearing die changes.
	async _assignDie(aspectKey, newIdx) {
		const prevIdx = this._assign[aspectKey];
		const holder  = _ASPECT_KEYS.find(k => k !== aspectKey && this._assign[k] === newIdx);
		if (holder) this._assign[holder] = prevIdx;
		this._assign[aspectKey] = newIdx;
		// Assignment changed the trait/move die: trim any now-excess picks.
		this._traits = this._traits.slice(0, this._traitLimit());
		this._moves  = this._moves.slice(0, this._moveLimit());
		if (aspectKey === "number" || holder === "number") await this._rollCount();
	}

	_toggle(list, value, limit) {
		const i = list.indexOf(value);
		if (i >= 0) list.splice(i, 1);
		else if (list.length < limit) list.push(value);
		this.render(false);
	}

	async _finish() {
		// Capture an un-blurred name field.
		const nameEl = this.element?.[0]?.querySelector(".stonetop-cu-name");
		if (nameEl) this._name = nameEl.value;
		if (!this._isComplete()) {
			ui.notifications?.warn?.("Assign all five dice and choose the called-for traits and moves first.");
			return;
		}
		const input = this._resolve();
		const cost  = {
			kind:  this._ring.hasRing ? this._costKind : "none",
			dice:  [...(this._dice ?? [])],
			assign: { ...this._assign },
		};
		await this._onApply?.({ input, cost });
		this.close();
	}
}
