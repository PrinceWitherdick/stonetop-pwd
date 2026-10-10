import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { sign } from "../../../utils/roll-engine.js";
import { applyGuideRail, guideRailStep } from "../../../utils/guide-rail.js";
import { moveChatCard } from "../../../utils/chat.js";
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
// A left-rail window (the shared .stonetop-guide-* chrome): the dice and their five
// aspects, the traits, the moves, and the batch itself each get a panel, because the
// four stacked made a window taller than the screen. It is still reactive (every
// change re-renders so the live stat line, the choose-N limits and the Manifest gate
// stay honest); the active panel is instance state so a re-render lands on it.
// On Manifest it hands { input, cost } back to the caller (the character sheet), which
// pays the cost (1 Loyalty from the Ring, or mark a consequence) and builds the card.

const _ASPECT_KEYS = SERVANT_ASPECTS.map(a => a.key);

const SECTIONS = [
	{ key: "dice",   title: "Roll & assign", icon: "fa-dice" },
	{ key: "traits", title: "Traits",        icon: "fa-dragon" },
	{ key: "moves",  title: "Moves",         icon: "fa-bolt" },
	{ key: "summon", title: "Call them up",  icon: "fa-fish" },
];

// The five d4s a character has rolled and not yet spent, by actor uuid. "Each time you
// Call Up the Deep Ones, roll five d4s": closing this window and opening it again is the
// same Call Up, not a fresh roll, so the dice wait here until a batch is manifested from
// them. Session memory only. A deliberate re-roll is still offered (a table's ruling is
// its own), but it is announced in chat, so it is never a quiet second chance.
const _pendingDice = new Map();

export class CallUpDeepOnesDialog extends StonetopDialog {
	/**
	 * @param {Actor}    actor
	 * @param {object}   ring    - { id, name, loyalty, hasRing } for the shared-Loyalty pool
	 * @param {Function} onApply - async ({ input, cost }) => void
	 */
	constructor(actor, ring, onApply, options = {}) {
		// One window per character, not one per client: a GM running two Ring-bearers gets two
		// windows with two DOM ids rather than two windows fighting over one (perDocumentOptions).
		super(StonetopDialog.perDocumentOptions("stonetop-call-up-deep-ones", actor?.id, options));
		this._actor       = actor;
		this._ring        = ring ?? {};
		this._onApply     = onApply;

		this._dice   = null;                 // [v0..v4], each 1-4 — null until first roll
		this._assign = {};                   // aspectKey → die index (0-4)
		this._traits = [];                    // chosen SERVANT_TRAIT_OPTIONS keys
		this._moves  = [];                    // chosen SERVANT_MOVE_OPTIONS labels
		this._name   = "";
		this._activeTab = SECTIONS[0].key;
		// Default to spending the Ring's Loyalty when it holds any, else mark a consequence.
		this._costKind = (Number(this._ring.loyalty) || 0) > 0 ? "loyalty" : "consequence";
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			title:     "Call Up the Deep Ones",
			template:  "systems/stonetop-pwd/templates/dialogs/call-up-deep-ones.hbs",
			// Rail + panel, at a fixed height so switching panels never resizes the
			// frame; the panel column scrolls if one runs long.
			width:     660,
			height:    520,
			resizable: true,
			classes:   ["stonetop", "stonetop-spring-dialog", "stonetop-call-up-dialog"],
		});
	}

	get _keptScrollSelector() { return ".stonetop-cu-main"; }
	get _focusKeyAttribute()  { return "data-cu-focus"; }

	get _pendingKey() { return this._actor?.uuid ?? this._actor?.id ?? ""; }

	async _render(force, options) {
		// Seed the five d4s on first open (reusing an unspent roll) with a valid default
		// assignment (die i → aspect i), so the page renders resolved rather than blank.
		if (this._dice === null) await this._rollDice();
		await super._render(force, options);
	}

	// ── Dice ─────────────────────────────────────────────────────────────────
	async _rollDice() {
		let dice = _pendingDice.get(this._pendingKey);
		if (!dice) {
			const roll = await new Roll("5d4").evaluate();
			dice = (roll.dice?.[0]?.results ?? []).map(r => r.result);
			while (dice.length < 5) dice.push(1);   // defensive: always five
			_pendingDice.set(this._pendingKey, dice);
		}
		this._dice = [...dice];
		// Default assignment: die i → aspect i (the player can reshuffle).
		this._assign = Object.fromEntries(_ASPECT_KEYS.map((k, i) => [k, i]));
		this._traits = [];
		this._moves  = [];
	}

	// Throw the unspent dice away and roll five fresh d4s, telling the table: the old and
	// new values go to chat, so a re-roll is a visible ruling rather than a private redo.
	async _reroll() {
		const before = [...(this._dice ?? [])];
		_pendingDice.delete(this._pendingKey);
		await this._rollDice();
		await ChatMessage.create({
			content: moveChatCard("Call Up the Deep Ones",
				`<p>Re-rolled the five d4s: ${before.join(", ")} &rarr; <strong>${this._dice.join(", ")}</strong>.</p>`),
			speaker: ChatMessage.getSpeaker({ actor: this._actor }),
		});
		this.render(false);
	}

	// The die VALUE assigned to an aspect (1-4), or 0 if unassigned.
	_dieFor(aspectKey) {
		const idx = this._assign[aspectKey];
		return Number.isInteger(idx) ? (this._dice?.[idx] ?? 0) : 0;
	}

	_traitLimit() { return this._dieFor("traits"); }
	_moveLimit()  { return this._dieFor("moves"); }

	// The resolver input for the current selections. `count` is absent until Manifest:
	// how many turn up is rolled as they appear, so the preview reads the formula.
	_resolve(count) {
		return resolveServantBatch({
			aspectDie: {
				tags:   this._dieFor("tags"),
				number: this._dieFor("number"),
				size:   this._dieFor("size"),
				traits: this._dieFor("traits"),
				moves:  this._dieFor("moves"),
			},
			count,
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

	// What still stands between the player and Manifest, as a phrase ("2 traits, 1 move"),
	// or "" when nothing does.
	_stillToChoose() {
		const parts = [];
		const t = this._traitLimit() - this._traits.length;
		const m = this._moveLimit()  - this._moves.length;
		if (t > 0) parts.push(`${t} more trait${t === 1 ? "" : "s"}`);
		if (m > 0) parts.push(`${m} more move${m === 1 ? "" : "s"}`);
		return parts.join(" and ");
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
		const numOpt = SERVANT_NUMBER_OPTIONS[this._dieFor("number")];
		const solitary = numOpt?.key === "solitary";
		// The template reads a subset of the resolved batch; only `moves` needs reshaping
		// (newline string -> lines). Spreading keeps this in sync as resolveServantBatch grows.
		const preview = {
			...p,
			moves:     p.moves ? p.moves.split("\n") : [],
			typeLabel: solitary ? "deep one" : "deep ones",
			// Not yet rolled: a horde or group shows its formula until it appears.
			strength:  solitary ? "" : `${numOpt?.label ?? "group"} of ${numOpt?.countFormula ?? "?"}`,
		};

		const activeIndex = Math.max(0, SECTIONS.findIndex(s => s.key === this._activeTab));
		const tabCount = { traits: `${this._traits.length}/${traitLimit}`, moves: `${this._moves.length}/${moveLimit}` };

		const ringLoyalty = Math.max(0, Number(this._ring.loyalty) || 0);
		return {
			activeTab: this._activeTab,
			tabs: SECTIONS.map((s, i) => ({ ...s, count: tabCount[s.key], selected: i === activeIndex })),
			active: SECTIONS[activeIndex],
			atFirst: activeIndex === 0,
			atLast:  activeIndex === SECTIONS.length - 1,
			statLine: this._statLine(preview),
			dice,
			aspects,
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
			stillToChoose: this._stillToChoose(),
		};
	}

	// The batch as it stands, in one line, for the banner under every panel's title: the
	// numbers a trait or a size die changes, visible while that choice is being made.
	_statLine(preview) {
		const hp = `HP ${preview.hp}${preview.strength ? " each" : ""}`;
		return [preview.strength, hp, `Armor ${preview.armor}`, preview.damage].filter(Boolean).join(" · ");
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
			const qty = o.key === "solitary" ? "" : `${o.countFormula}, `;
			return `${o.label} (${qty}HP ${o.hp}, ${o.die})`;
		}
		if (key === "size") {
			const o = SERVANT_SIZE_OPTIONS[die];
			const parts = [];
			if (o.hpMod)  parts.push(`${sign(o.hpMod)} HP`);
			if (o.dmgMod) parts.push(`${sign(o.dmgMod)} damage`);
			parts.push(o.ranges.join(", "));
			return `${o.label} (${parts.join(", ")})`;
		}
		if (key === "traits") return `choose ${die} trait${die === 1 ? "" : "s"}`;
		if (key === "moves")  return `choose ${die} move${die === 1 ? "" : "s"}`;
		return "";
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];

		// Rail + Back/Next: client-side, like every other rail window (see utils/guide-rail.js).
		root.querySelectorAll(".stonetop-cu-tab").forEach(btn =>
			btn.addEventListener("click", () => this._selectTab(btn.dataset.tab)));
		root.querySelector(".stonetop-cu-back")?.addEventListener("click", () => this._step(-1));
		root.querySelector(".stonetop-cu-next")?.addEventListener("click", () => this._step(1));

		// Assign a die to an aspect. Assigning a die already held by another aspect swaps
		// them, so the five aspects always hold a valid bijection of the five dice.
		html.find(".stonetop-cu-assign").on("change", ev => {
			this._assignDie(ev.currentTarget.dataset.aspect, Number(ev.currentTarget.value));
			this.render(false);
		});

		html.find(".stonetop-cu-trait").on("change", ev => this._toggle(this._traits, ev.currentTarget.value, this._traitLimit()));
		html.find(".stonetop-cu-move").on("change", ev => this._toggle(this._moves, ev.currentTarget.value, this._moveLimit()));

		html.find(".stonetop-cu-name").on("change", ev => { this._name = ev.currentTarget.value; this.render(false); });
		html.find(".stonetop-cu-cost-input").on("change", ev => { this._costKind = ev.currentTarget.value; this.render(false); });

		html.find(".stonetop-cu-reroll").on("click", ev => this._guardBusy(ev, () => this._reroll()));
		// Latched: Manifest awaits a roll and the sheet's write before it closes, and a second
		// click in that gap would call up a second batch.
		html.find(".stonetop-cu-manifest").on("click", ev => this._guardBusy(ev, () => this._finish()));
		html.find(".stonetop-cu-cancel").on("click", () => this.close());
	}

	_step(delta) {
		const next = guideRailStep(SECTIONS, this._activeTab, delta);
		if (next) this._selectTab(next.key);
	}

	// Show one panel and light its rail entry, with the banner and Back/Next to match.
	// Purely DOM; `_activeTab` is what the next reactive re-render lands on.
	_selectTab(key) {
		const index = SECTIONS.findIndex(s => s.key === key);
		if (index < 0) return;
		this._activeTab = key;
		const active = SECTIONS[index];
		applyGuideRail(this.element?.[0], {
			key, dataKey: "tab",
			tabSelector:     ".stonetop-cu-tab",
			sectionSelector: ".stonetop-cu-panel",
			iconSelector:    ".stonetop-cu-banner-icon", icon: active.icon, iconExtraClass: "stonetop-cu-banner-icon",
			mainSelector:    ".stonetop-cu-main",
			titleSelector:   ".stonetop-cu-banner-title", title: active.title,
			backSelector:    ".stonetop-cu-back", nextSelector: ".stonetop-cu-next",
			index, total: SECTIONS.length,
		});
	}

	// Swap-aware assignment: give `aspectKey` the die at `newIdx`; if another aspect held
	// it, that aspect takes whatever `aspectKey` had (keeping a full bijection).
	_assignDie(aspectKey, newIdx) {
		const prevIdx = this._assign[aspectKey];
		const holder  = _ASPECT_KEYS.find(k => k !== aspectKey && this._assign[k] === newIdx);
		if (holder) this._assign[holder] = prevIdx;
		this._assign[aspectKey] = newIdx;
		// Assignment changed the trait/move die: trim any now-excess picks.
		this._traits = this._traits.slice(0, this._traitLimit());
		this._moves  = this._moves.slice(0, this._moveLimit());
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
			ui.notifications?.warn?.(`Choose ${this._stillToChoose()} first.`);
			this._selectTab(this._traits.length < this._traitLimit() ? "traits" : "moves");
			return;
		}
		// They appear: a horde or group rolls how many, once, now.
		const numOpt = SERVANT_NUMBER_OPTIONS[this._dieFor("number")];
		let count = 1;
		let countRoll = null;
		if (numOpt && numOpt.key !== "solitary") {
			const roll = await new Roll(numOpt.countFormula).evaluate();
			count = Math.max(1, roll.total);
			countRoll = { formula: numOpt.countFormula, total: count };
		}
		const input = this._resolve(count);
		const cost  = {
			kind:  this._ring.hasRing ? this._costKind : "none",
			dice:  [...(this._dice ?? [])],
			assign: { ...this._assign },
			countRoll,
		};
		// Spent: the next Call Up rolls afresh.
		_pendingDice.delete(this._pendingKey);
		await this._onApply?.({ input, cost });
		this.close();
	}
}
