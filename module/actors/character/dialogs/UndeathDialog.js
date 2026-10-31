import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { attrValue, escHtml } from "../../../utils/strings.js";
import { TIER_LABELS } from "../../../utils/move-results.js";
import { classifyResult } from "../../../utils/roll-engine.js";
import { promptRoll } from "../../../dialogs/RollDialog.js";
import { format, localize } from "../../../utils/i18n.js";
import { DEATHS_DOOR_STATE, FINAL_CONSEQUENCE, resolutionTier, resolvedHp } from "../deaths-door.js";
import { deathsDoorRollMarker, rollMarkerDeletion, setDeathsDoorRollMarker } from "../deaths-door-actor.js";
import { gainableMarks, markableConsequences } from "../post-death-choices.js";
import { loseToUnholyVessel, postOutcomeCard } from "../post-death-outcomes.js";
import { UNDEATH_ROLL_NONCE_PREFIX, isUndeathRollMarker, keptHpUpdate } from "../undeath-return.js";
import { FoundryPostDeathInsertRepository } from "../repositories/FoundryPostDeathInsertRepository.js";
import { confirmOutcome } from "../../../utils/ask-with-buttons.js";
import { DeathsDoorDialog } from "./DeathsDoorDialog.js";

// The roll, once its dice land, is written to the actor as the Death's Door roll marker is
// (deaths-door-actor.js#setDeathsDoorRollMarker), under a nonce of its own kind so neither window
// can take the other's for its own. The marker is what a window opened again (closed, a second
// click, another owner's) resumes from instead of rolling again, and it goes in the write that
// settles the move. Any HP write that moves the state lifts it too (DeathsDoorPrompt's preUpdate),
// so one left by a brush with death that ended some other way never reaches the next one.

/** The Undeath roll this actor's marker holds, landed (a tier), or null. */
function _landedRoll(actor) {
	const marker = deathsDoorRollMarker(actor);
	return isUndeathRollMarker(marker) && marker.tier ? marker : null;
}

// The Undying maiming's own words, so the Revenant -> Ghost swap can find what the body carried. Found by
// its opening, which survives the GM's "how" being written in after the colon.
const _MAIM_PREFIX = "Permanently maimed";
const _MAIM_TEXT = `${_MAIM_PREFIX}: the GM says how`;

/**
 * The 0-HP move of a character who already died once — Undying (Revenant), Tethered (Ghost) or
 * Dark Succor (Thrall). One dialog for all three because they are the same shape: something
 * happens to your HP, and the roll (if there is one) says how many of the move's three costs
 * you have to take.
 *
 * The costs are not free text. "Mark a consequence" and "gain a Mark" tick real options on the
 * insert's own lists, "cross off a Mark" writes a permanent never-again record, and the Thrall's
 * Favor resets to 0 whatever the roll — so the whole move lands on the sheet, the way Death's
 * Door now does, instead of leaving the player a paragraph to apply by hand.
 *
 * What it deliberately does NOT decide: Dark Succor's recovery ("here and now or at a time and
 * place of the GM's choosing") has no number in the book, so no HP is written for it; and the
 * Revenant's maiming is "in some way of the GM's choosing", so it's recorded as a permanent
 * wound for them to fill in rather than invented here.
 */

// The lore sections each effect writes to. Consequences and Marks are ordinary lore options on
// the insert; naming the sections here keeps the slugs out of the effect handlers.
const _CONSEQUENCES = FINAL_CONSEQUENCE.section;
const _MARKS        = "marks";
const _I18N = "stonetop.undeath";

export class UndeathDialog extends StonetopDialog {
	constructor(character, onDone, options = {}) {
		// One window PER CHARACTER — see StonetopDialog.perDocumentOptions. Two undead PCs
		// dropping in one fight is an ordinary evening.
		super(StonetopDialog.perDocumentOptions(
			"stonetop-undeath-dialog", character?._actor?.id, options));
		this._character  = character;
		this._onDone     = onDone;
		this._resolution = character?.zeroHpResolution ?? null;
		this._moveName   = this._resolution?.move ?? "";

		// A move with no roll (Tethered) opens straight on its consequences.
		this._step = this._resolution?.roll ? "roll" : "resolve";
		this._tierKey = this._resolution?.roll ? null : "always";

		this._picked   = new Set();   // effect kinds the player has taken
		this._applied  = false;
		this._forcedMiss = false;     // Revenant: body destroyed → resolve as a 6-
		this._tetherDestroyed = false;
		// Every Consequence already marked, so the move cannot be paid: the GM rules, and may have them
		// mark the Final Consequence instead. Never ticked for them (_unpayable).
		this._owedFinal = false;
		this._choices  = {};          // effect kind → chosen option slug / text
		this._sections = { [_CONSEQUENCES]: [], [_MARKS]: [] };
		// Whether to ask what a Ghost is bound to: decided once, off the SHEET, when the window opens
		// (refreshSections). Read off the draft instead, the box went the moment a letter was typed.
		this._askTether = null;
	}

	/** This window's id for `actorId`, which the sheet opens it under through openOrFocus. */
	static idFor(actorId) {
		return StonetopDialog.perDocumentOptions("stonetop-undeath-dialog", actorId).id;
	}

	// Every tick redraws the window, which drew it back at its top; a redraw of the same step keeps
	// the place.
	get _keptScrollSelector() { return ".undeath-dialog-content"; }
	get _keptPlaceKey() { return this._step; }

	// The box just ticked keeps the keyboard, and its place on screen, through the redraw.
	_focusSelector(el) {
		const kind = el.dataset?.kind;
		for (const cls of ["undeath-effect-check", "undeath-effect-select"]) {
			if (el.classList?.contains(cls) && kind) return `.${cls}[data-kind="${attrValue(kind)}"]`;
		}
		for (const cls of ["undeath-forced-miss", "undeath-tether-destroyed", "undeath-owed-final"]) {
			if (el.classList?.contains(cls)) return `.${cls}`;
		}
		return null;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-undeath-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/undeath.hbs",
			title:     "Undeath",
			width:     640,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-undeath-dialog"],
		});
	}

	get _autoHeight() { return true; }

	async _render(force, options) {
		await super._render(force, options);
		const root = this.element?.[0];
		if (!root) return;
		// Anyone running one of these moves is already through the Last Door, so this window
		// opens in the dark rather than arriving there — it shares Death's Door's --door mood
		// (stonetop.css, "the dark comes in from the edges"). Only the accent answers to the
		// roll: a tier that went well gets its gold back, the rest stay ember.
		root.classList.add("deaths-door-mood--door");
		root.classList.toggle("deaths-door-mood--spared", this._tierKey === "success");
	}

	/**
	 * Build and show one. The insert's consequence / Mark lists come from the compendium, so
	 * they're loaded before the first render — via a factory rather than by overriding `render`,
	 * which AppV1 calls re-entrantly and which must stay synchronous.
	 */
	static async open(character, onDone, options = {}) {
		const dialog = new UndeathDialog(character, onDone, options);
		await dialog.refreshSections();
		dialog.render(true);
		return dialog;
	}

	/** Re-read the insert's option lists (they change as options get marked or crossed off). */
	async refreshSections() {
		this._sections[_CONSEQUENCES] = await this._character.sectionOptions(_CONSEQUENCES);
		this._sections[_MARKS]        = await this._character.sectionOptions(_MARKS);
		// The COMPUTED max, not the stored field — a Thrall's Marks and any move bonuses only
		// exist in the snapshot, and "half your max HP" has to halve the real number.
		this._maxHp = await this._character.computedMaxHp();
		this._askTether ??= !String(this._character.tether ?? "").trim();
		// A roll already landed for this brush with death (this window closed after it, a second click,
		// another owner's window): it stands, so the window opens on its costs rather than on a fresh roll.
		this._resumeLandedRoll();
		// A move that doesn't roll opens straight on its costs, and Tethered's single cost isn't
		// a choice — tick it up front so the only question left is which consequence.
		if (this._step === "resolve") this._syncForcedPicks();
	}

	/**
	 * Pick up the roll the actor's marker says has landed, while they are still dying with it owed. Whether it
	 * did. The tier is taken as it stands: the marker is written once the dice are down (_onRoll), and the card
	 * takes no +1s or Shift afterwards (deaths-door.js#isUndeathCard).
	 */
	_resumeLandedRoll() {
		if (this._step !== "roll" || !this._resolution?.roll) return false;
		if (this._character?.deathsDoorState !== DEATHS_DOOR_STATE.DYING) return false;
		const landed = _landedRoll(this._character?._actor);
		if (!landed || !this._resolution.tiers?.[landed.tier]) return false;
		this._tierKey     = landed.tier;
		this._rolledTotal = landed.total ?? null;
		this._rolledBy    = landed.userId && landed.userId !== globalThis.game?.user?.id ? landed.userName || "" : "";
		this._step        = "resolve";
		return true;
	}

	getData() {
		const res  = this._resolution;
		const tier = resolutionTier(res, this._tierKey);
		const hp   = resolvedHp(tier, this._maxHp ?? 0);

		// Every effect the tier could make them take, with the picker each one needs.
		const effects = (res?.effects ?? []).map(e => ({
			...e,
			picked:  this._picked.has(e.kind),
			options: this._selectableFor(e.kind),
			choice:  this._choices[e.kind] ?? "",
			// A cost with nothing left to spend can't be taken — every consequence already
			// marked, say. Flagged rather than hidden, so the player can see why.
			exhausted: this._isExhausted(e.kind),
		}));

		const available = effects.filter(e => !e.exhausted).length;
		const pick = this._pickCount();
		// Unholy Vessel: the move demands a Mark and there is none left to gain. Nothing else is asked.
		const unholyVessel = this._isUnholyVessel();
		// Every Consequence already marked and the move owing one (_unpayable): said, with the GM's
		// way out offered and never taken for them.
		const unpayable = !unholyVessel && !this._tetherDestroyed && this._unpayable();
		return {
			moveName:  this._moveName,
			trigger:   this._character?.zeroHpMove?.trigger ?? "",
			isRoll:    this._step === "roll",
			isResolve: this._step === "resolve",
			isDone:    this._step === "done",

			rollLabel:   res?.roll?.label ?? "",
			favor:       res?.roll?.loreCount ? this._character.favor() : null,
			rolledTotal: this._rolledTotal ?? null,
			// A roll another owner landed, which this window picked up rather than rolling again.
			rolledBy:    this._rolledBy ? format(`${_I18N}.rolledBy`, { name: this._rolledBy }) : "",
			tierLabel:   TIER_LABELS[this._tierKey] ?? "",

			effects,
			pick,
			pickedCount: this._picked.size,
			// "All 3 apply" is not a choice — say so instead of asking them to tick three boxes.
			allApply:    pick >= available && available > 0,
			canApply:    this._canApply(),
			unpayable:   unpayable ? {
				note:  localize(`${_I18N}.unpayable.note`),
				label: localize(`${_I18N}.unpayable.final`),
				on:    this._owedFinal,
			} : null,
			unholyVessel: unholyVessel ? {
				label:   localize(`${_I18N}.unholyVessel.label`),
				warning: localize(`${_I18N}.unholyVessel.warning`),
			} : null,
			applyLabel:  unholyVessel ? localize(`${_I18N}.unholyVessel.apply`) : "Apply",

			hp,
			// The note rides on the resolution spec, not on a table keyed by the move's display
			// name — renaming the move must not silently leave the player a blank where the
			// recovery should be.
			hpNote:      hp === null ? res?.hpNote ?? null : null,
			disperses:   res?.disperses ? resolvedHp(res.disperses, this._maxHp ?? 0) : null,

			forcedMiss:      res?.forcedMiss ? { ...res.forcedMiss, on: this._forcedMiss } : null,
			tetherDestroyed: res?.tetherDestroyed ? { ...res.tetherDestroyed, on: this._tetherDestroyed } : null,
			// Where they reform. Named here if the sheet hasn't got it yet, since Tethered can't
			// be resolved honestly without knowing what they're bound to.
			tether:      res?.disperses ? (this._tether ?? this._character.tether ?? "") : null,
			needsTether: !!res?.disperses && !!this._askTether,
			alternative:     tier?.alternative ?? null,
			resetsFavor:     !!res?.alwaysResetFavor,
			// A task set by an earlier Dark Succor and never finished: the new one replaces it (the
			// sheet holds one), so the player is told before they write over it.
			standingTask:    this._character?.masterTask
				? format(`${_I18N}.taskStanding`, { task: this._character.masterTask })
				: "",

			applied: this._applied,
			summary: this._summary ?? [],
		};
	}

	/**
	 * The picker a given effect needs, or [] for one that just happens.
	 *
	 * NEVER_CHOSEN_OPTIONS is filtered out of the consequence list rather than left to `blocked`:
	 * THE FINAL CONSEQUENCE carries no `requires` and is marked by nothing until it happens, so it
	 * is never blocked and used to sit in this dropdown between DISTURBING and POLTERGEIST. One
	 * mis-click there ended the character — with no confirmation, and without even setting the
	 * dead state, since only the tether-destroyed branch below does that. It stays reachable the
	 * one way the book inflicts it, and unreachable as a choice.
	 */
	_optionsFor(kind) {
		if (kind === "consequence")   return markableConsequences(this._sections[_CONSEQUENCES]);
		if (kind === "mark-gain")     return gainableMarks(this._sections[_MARKS]);
		// Crossing off is the mirror image: only a Mark you DON'T have can be crossed off.
		if (kind === "mark-crossoff") return this._sections[_MARKS].filter(o => !o.marked && !o.crossedOff);
		return [];
	}

	/**
	 * Only the kinds that spend from a list can run out. A `task` is written, not picked from
	 * anything, so it is never exhausted — and _optionsFor returns [] for it, which is why the
	 * membership test has to come first rather than the emptiness check standing alone.
	 *
	 * Crossing off is counted off what it may actually OFFER (_selectableFor), because the book puts
	 * it second: "Gain a new Mark of the GM's choice", then "Cross off a Mark that you don't have".
	 * With one Mark left and a 6- demanding both, the gain takes it and there is no Mark left that
	 * they don't have, so the cross-off has nothing to spend. Counted off _optionsFor as well, the
	 * two dropdowns both wanted the same last Mark, each hid it from the other, and Apply never
	 * lit (the deadlock, 2026-09-27). Gaining is still counted off everything: a Mark crossed off
	 * first must not talk the gain out of being owed, which is what makes Unholy Vessel.
	 */
	_isExhausted(kind) {
		if (!_OPTION_KINDS.has(kind)) return false;
		return (kind === "mark-crossoff" ? this._selectableFor(kind) : this._optionsFor(kind)).length === 0;
	}

	/**
	 * What a dropdown may actually OFFER: everything the kind has left, less the Mark its opposite
	 * number is spending.
	 *
	 * mark-gain keeps `!o.blocked` and mark-crossoff keeps `!o.marked && !o.crossedOff`, and those
	 * two overlap on every Mark the character neither holds nor has already lost. A 6- on Dark
	 * Succor forces both at once, so the same slug could be gained AND crossed off in one apply,
	 * leaving a Mark that is ticked and struck through together: the tab prints it under "you can
	 * never gain them", the checkbox beside it is disabled so it can never be unticked again, and
	 * its 2 max HP are gone for good.
	 *
	 * The gain comes first (see _isExhausted), so while it is taken the cross-off also leaves alone
	 * the one Mark it could gain when there is only one: that Mark is spoken for before it is chosen.
	 */
	_selectableFor(kind) {
		const options = this._optionsFor(kind);
		if (kind === "mark-gain") {
			const taken = this._choices["mark-crossoff"];
			return taken ? options.filter(o => o.slug !== taken) : options;
		}
		if (kind === "mark-crossoff") {
			const gains = this._optionsFor("mark-gain");
			const reserved = this._choices["mark-gain"]
				|| (this._picked.has("mark-gain") && gains.length === 1 ? gains[0].slug : null);
			return reserved ? options.filter(o => o.slug !== reserved) : options;
		}
		return options;
	}

	/**
	 * Keep the picks honest after anything that moves them: a cost that has run out is no longer
	 * taken (it shows as exhausted, and the tier's `pick` has already stopped counting it), and a
	 * choice its dropdown no longer offers is dropped rather than left to be written. Repeated until
	 * nothing moves, since dropping one choice can put an option back in the other dropdown.
	 */
	_prunePicks() {
		for (let changed = true; changed;) {
			changed = false;
			for (const kind of [...this._picked]) {
				if (this._isExhausted(kind)) {
					this._picked.delete(kind);
					delete this._choices[kind];
					changed = true;
				} else if (_OPTION_KINDS.has(kind) && this._choices[kind]
					&& !this._selectableFor(kind).some(o => o.slug === this._choices[kind])) {
					delete this._choices[kind];
					changed = true;
				}
			}
		}
	}

	/** Take or give back one of the move's costs. */
	_setPicked(kind, on) {
		if (on) this._picked.add(kind);
		else { this._picked.delete(kind); delete this._choices[kind]; }
		this._prunePicks();
	}

	/** Choose the option a cost spends (a Consequence, a Mark), or the task's words. */
	_setChoice(kind, value) {
		this._choices[kind] = value;
		this._prunePicks();
	}

	/**
	 * Unholy Vessel (the Thrall's own move): "When you would gain a Mark but there are none left to gain,
	 * your humanity is utterly lost. You become a threat in the GM's control. Make a new character."
	 *
	 * "Would gain" is the move demanding it: the tier asks for more costs than the others can cover
	 * without the gain (a 6-'s all three, or a 7-9's two with nothing but the task left), and there
	 * is no Mark to gain. A 10+ that can be paid with the task never comes here. Before this, the
	 * exhausted gain was quietly let off (`pick` counts only what is left), so a Thrall who had spent
	 * every Mark simply could not be lost.
	 */
	_isUnholyVessel() {
		return this._owesExhausted("mark-gain");
	}

	/** How many of the move's costs still have something left to spend. */
	_availableCount() {
		return (this._resolution?.effects ?? []).filter(e => !this._isExhausted(e.kind)).length;
	}

	/**
	 * Whether the tier owes cost `kind`, which has nothing left to spend, and the move's other costs cannot cover
	 * it: the shape both Unholy Vessel (_isUnholyVessel) and an unpayable consequence (_unpayable) take.
	 */
	_owesExhausted(kind) {
		const tier = resolutionTier(this._resolution, this._tierKey);
		const effects = this._resolution?.effects ?? [];
		if (!tier || !effects.some(e => e.kind === kind) || !this._isExhausted(kind)) return false;
		return tier.pick > this._availableCount();
	}

	/**
	 * How many costs the tier makes them take, of what there is left. A move can demand more than the
	 * insert has left to give (every consequence already marked, every Mark held), and asking for three
	 * when only two exist would leave the Apply button dead forever.
	 */
	_pickCount() {
		const tier = resolutionTier(this._resolution, this._tierKey);
		return Math.min(tier?.pick ?? 0, this._availableCount());
	}

	/**
	 * Whether Apply is live. Asked by getData and again as the task is typed (activateListeners), which
	 * redraws nothing: the button used to light only on a redraw, and typing the task is not one.
	 */
	_canApply() {
		if (this._isUnholyVessel()) return true;
		return this._picked.size === this._pickCount() && this._choicesComplete();
	}

	/**
	 * Every Consequence is already marked, and the tier owes one that the move's other costs cannot cover
	 * (Tethered's only cost; Undying's 6-, where all three apply). The book says nothing of this case, so
	 * the window says the move can't be paid and leaves it to the GM, who may have them mark the Final
	 * Consequence (the user's ruling, 2026-10-27). Never decided for them.
	 */
	_unpayable() {
		return this._owesExhausted("consequence");
	}

	/** Every picked effect that needs a choice has one, and no Mark is being gained and lost at once. */
	_choicesComplete() {
		for (const kind of this._picked) {
			if (kind === "task") { if (!String(this._choices.task ?? "").trim()) return false; continue; }
			if (this._selectableFor(kind).length && !this._choices[kind]) return false;
		}
		// Behind _selectableFor rather than instead of it: the two selects are independent, so a
		// choice made before its opposite number narrowed the list survives until a re-render, and
		// this is the gate Apply is actually held on.
		const gained = this._choices["mark-gain"];
		if (gained && this._picked.has("mark-gain") && this._picked.has("mark-crossoff")
			&& gained === this._choices["mark-crossoff"]) return false;
		return true;
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Each of the three writing handlers carries a `.catch`, on DeathsDoorDialog's terms (see
		// _onFateFailed there): they roll their latch back and rethrow, and a click is fired and
		// forgotten, so without one the rejection only reaches the console and the player is left
		// looking at a window that appears to have ignored them.
		// Shift skips the pre-roll window, as it does on every other roll (RollDialog.js#promptRoll).
		html.find(".undeath-roll-btn").on("click", (ev) => this._onRoll({ shiftKey: !!ev.shiftKey }).catch(err => this._onApplyFailed(err)));
		html.find(".undeath-apply-btn").on("click", () => this._onApply().catch(err => this._onApplyFailed(err)));
		html.find(".undeath-close-btn").on("click", () => this._onFinish());
		html.find(".undeath-cancel-btn").on("click", () => this.close());
		html.find(".undeath-alternative-btn").on("click", (ev) =>
			this._onAlternative(ev.currentTarget.dataset.insert).catch(err => this._onApplyFailed(err)));

		html.find(".undeath-forced-miss").on("change", (ev) => {
			this._setForcedMiss(ev.currentTarget.checked);
			this.render(true);
		});

		html.find(".undeath-tether-destroyed").on("change", (ev) => {
			this._tetherDestroyed = ev.currentTarget.checked;
			this.render(true);
		});

		html.find(".undeath-effect-check").on("change", (ev) => {
			this._setPicked(ev.currentTarget.dataset.kind, ev.currentTarget.checked);
			this.render(true);
		});

		html.find(".undeath-effect-select").on("change", (ev) => {
			this._setChoice(ev.currentTarget.dataset.kind, ev.currentTarget.value);
			this.render(true);
		});

		html.find(".undeath-owed-final").on("change", (ev) => {
			this._owedFinal = ev.currentTarget.checked;
			this.render(true);
		});

		// Typed without a redraw, which would take the caret away, so Apply is lit (or not) here.
		html.find(".undeath-task-input").on("input", (ev) => {
			this._choices.task = ev.currentTarget.value;
			html.find(".undeath-apply-btn").prop("disabled", !this._canApply());
		});
		html.find(".undeath-tether-input").on("input", (ev) => { this._tether = ev.currentTarget.value; });
	}

	/**
	 * The Revenant's "my body was completely destroyed" tick, which resolves the move as a 6-
	 * with nothing left to roll — and un-ticking it, which puts the roll back. Its own method
	 * rather than the change handler's body so the state it moves through is testable without
	 * a rendered form.
	 */
	_setForcedMiss(on) {
		this._forcedMiss = !!on;
		this._tierKey = this._forcedMiss ? "failure" : null;
		this._step    = this._forcedMiss ? "resolve" : "roll";
		this._syncForcedPicks();
	}

	/** A tier that takes every effect ticks them all, so the summary and the gate agree. */
	_syncForcedPicks() {
		const tier = resolutionTier(this._resolution, this._tierKey);
		// No tier at all — un-ticking "resolve as a 6-" on an insert whose move has no `always`
		// tier drops us back to the roll step. The picks that miss forced have to go with it,
		// or a later 10+ that takes only one of them opens with three already ticked and its
		// Apply button dead (the gate counts picks against the tier's `pick`).
		if (!tier) {
			for (const kind of this._picked) delete this._choices[kind];
			this._picked.clear();
			return;
		}
		if (tier.pick >= (this._resolution.effects?.length ?? 0)) {
			// In the book's order, so the gain is taken before the cross-off asks what is left for it.
			for (const e of this._resolution.effects) if (!this._isExhausted(e.kind)) this._picked.add(e.kind);
		}
		this._prunePicks();
	}

	async _onRoll({ shiftKey = false } = {}) {
		// Only from the Roll step: a window past it (rolled, resumed, or a body destroyed and resolved as
		// a 6-) draws no Roll button, but a stale draw or a direct call must not roll a second time.
		if (this._rolling || this._step !== "roll") return;
		this._rolling = true;
		try {
			const actor = this._character?._actor ?? null;
			const res   = this._resolution;
			if (!actor || !res?.roll) return;
			if (await this._overtaken()) return;

			// The Thrall rolls +Favor, which is a track on its insert rather than a stat; every
			// other insert move rolls a real stat and goes through the debility check like any
			// other roll of it.
			const usesLore  = !!res.roll.loreCount;
			const statValue = usesLore ? this._character.favor() : undefined;

			// The pre-roll window every other roll gets, then the one path every direct roll takes
			// (StonetopCharacter#onDirectStatRoll): the sticky mode or the window's, ongoing, what the next
			// roll is owed (an Aid's advantage, +forward), and the debility a real stat brings. Aimed at nobody.
			const prompted = await promptRoll({ title: this._moveName, shiftKey });
			if (!prompted) return;
			// Asked again: the pre-roll window waits as long as the player does, and another owner may have
			// rolled, or the move been settled, while it was up.
			if (await this._overtaken()) return;
			const roll = await this._character.onDirectStatRoll(usesLore ? "" : res.roll.stat, {
				...prompted,
				targets: [],
				statValue,
				moveName: this._moveName,
				// Undying / Tethered / Dark Succor ARE Death's Door for a character who has already
				// been through it, so they follow the same house rule: no +1 XP on the miss that
				// might end them. See DeathsDoorDialog._onRoll.
				noXpOnMiss: true,
				moveDescription: `<p>${this._character.zeroHpMove.trigger}</p>`,
			});
			if (!roll) return;

			this._rolledTotal = roll.total;
			this._tierKey = classifyResult(roll.total).key;
			this._step    = "resolve";
			this._syncForcedPicks();
			// On the actor, so the roll stands however this window is closed or opened again. Written even
			// when this window was shut while the dice fell: the card is posted, so the roll is spent. Not
			// once they have stopped dying meanwhile (healed, or the GM's "not lethal"): a stamp on a character
			// no longer owing the move would be resumed by the next brush with death.
			if (this._character.deathsDoorState === DEATHS_DOOR_STATE.DYING) await this._stampRoll(actor, roll.total, this._tierKey);
			// Guarded: the 3D dice are several seconds of await, and a window closed during them
			// must not be forced back open. See DeathsDoorDialog._onRoll.
			this.renderIfOpen();
		} finally {
			this._rolling = false;
		}
	}

	/**
	 * Whether the roll this window was about to make has been overtaken, handled here: a roll already landed,
	 * here or in another owner's window since this one drew, stands and is picked up; a move no longer owed
	 * (brought back up, or settled from another window while this one waited) closes the window.
	 */
	async _overtaken() {
		if (this._resumeLandedRoll()) {
			this._syncForcedPicks();
			this.renderIfOpen();
			return true;
		}
		if (this._character.deathsDoorState !== DEATHS_DOOR_STATE.DYING) {
			await this._settledElsewhere();
			return true;
		}
		return false;
	}

	/**
	 * Write the landed roll to the actor (see the note above _landedRoll). A failure is logged and no more: the
	 * roll is on the card and in this window, and only a window opened again would miss it.
	 */
	async _stampRoll(actor, total, tier) {
		const user = globalThis.game?.user ?? null;
		const nonce = `${UNDEATH_ROLL_NONCE_PREFIX}${globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2)}`;
		try {
			await setDeathsDoorRollMarker(actor, {
				userId: user?.id ?? "unknown", userName: user?.name ?? "", nonce, total, tier,
			});
		} catch (err) {
			console.error("Stonetop | could not record the undeath roll on the character", err);
		}
	}

	/**
	 * The move is no longer owed, though this window still offered it: resolved from another owner's
	 * window, or the character was brought back up meanwhile. Said, and the window gives way, so a stale
	 * window can neither roll again nor pay the costs a second time.
	 */
	async _settledElsewhere() {
		globalThis.ui?.notifications?.info?.(format(`${_I18N}.settled`, { name: this._character?._actor?.name ?? "", move: this._moveName }));
		await this.close();
		return false;
	}

	/**
	 * Enact the tier: the HP it restores, each effect the player took, and the state it leaves them
	 * in, as ONE write. It used to be a run of them (the HP, then each cost, then the state), and a
	 * reload between two left a Revenant back up with the costs unpaid, or marked and maimed but
	 * still dying and offered the move again. Each piece is built as an update fragment and the lot
	 * lands together, so a failure writes nothing and the latch rolls back to a clean retry.
	 */
	async _onApply() {
		if (this._applied) return;
		const tier = resolutionTier(this._resolution, this._tierKey);
		if (!tier) return;
		// The gate the button is drawn with, asked again: a stale draw can leave it lit.
		if (!this._canApply()) return;
		// Paid already from another window, or no longer dying: the costs are not paid twice.
		if (this._character?.deathsDoorState !== DEATHS_DOOR_STATE.DYING) return this._settledElsewhere();
		this._applied = true;

		let done;
		try {
			done = this._isUnholyVessel() ? await this._applyUnholyVessel() : await this._applyTier(tier);
		} catch (err) {
			this._applied = false;
			throw err;
		}
		// Every resolution posts its card, even one that paid nothing.
		if (!done.length) done = [localize(`${_I18N}.nothingPaid`)];

		this._summary = done;
		this._step = "done";
		await this._post(done);
		// Guarded: the write and the chat card are server round trips, and a window closed while
		// they were in flight must not pop back open.
		this.renderIfOpen();
	}

	/**
	 * The one write. restoreHp is the seam that lands HP with more of the same decision (`alsoUpdate`),
	 * and it writes that alone when the HP would not rise, so a move that restores nothing (Tethered,
	 * Dark Succor) is handed 0 and still makes exactly one write. Whether the HP rose.
	 */
	async _write(hp, update) {
		return this._character.restoreHp(hp ?? 0, this._moveName, { alsoUpdate: update });
	}

	/** The tier's costs, HP and state, in the one write. Returns the summary lines. */
	async _applyTier(tier) {
		const res    = this._resolution;
		const update = {};
		const add    = (fragment) => { if (fragment) Object.assign(update, fragment); return !!fragment; };
		const lines  = { tether: [], effects: [], after: [] };

		// A tether named here (the Ghost's first Tethered, usually) is theirs from now on.
		const tether = String(this._tether ?? "").trim();
		if (res.disperses && tether && tether !== this._character.tether) {
			add(this._character.tetherUpdateData(tether));
			lines.tether.push(`Bound to <strong>${escHtml(tether)}</strong>.`);
		}

		for (const kind of this._picked) lines.effects.push(...this._effectUpdate(kind, add));

		// "Regardless, reset your Favor to 0."
		if (res.alwaysResetFavor && this._character.favor() > 0) {
			add(this._character.favorUpdateData(0));
			lines.after.push("Favor reset to <strong>0</strong>.");
		}

		// A move that could not be paid (_unpayable), and whether the GM had them mark the Final
		// Consequence for it. Ticked or not, the card says so.
		const unpayable = this._unpayable();
		const owedFinal = unpayable && this._owedFinal;
		if (unpayable && !owedFinal && !this._tetherDestroyed) lines.after.push(localize(`${_I18N}.unpayable.note`));

		const hp = resolvedHp(tier, this._maxHp ?? 0);
		if (this._tetherDestroyed || owedFinal) {
			// There is nothing left to reform beside, or nothing left to pay with. The Final Consequence
			// is the end of them as a player character ("your tenuous connection to humanity is lost and
			// you become a monster under the GM's control"), so they leave play rather than sitting in a
			// state that offers to bring them back, and no HP comes back with it.
			add(this._character.finalConsequenceUpdateData());
			lines.after.push(this._tetherDestroyed
				? "Your tether is destroyed: marked <strong>the Final Consequence</strong>. You pass into the GM's hands."
				: localize(`${_I18N}.unpayable.marked`));
			add(keptHpUpdate(this._character._actor, false));
		} else {
			// Otherwise they are no longer dying: all three moves avert the death. They're out
			// of the action if the move says so (Undying's second cost), if their essence has
			// dispersed (Tethered), or if the move states no recovery and leaves it to the GM
			// (Dark Succor). "Back on your feet" on the Special Moves card is how they come back.
			const down = this._picked.has("out-of-action") || !!res.disperses || hp === null;
			add(this._character.deathsDoorStateUpdateData(down ? DEATHS_DOOR_STATE.OUT_OF_ACTION : null));
			// Undying's own "out of the action until the next sunset": the move has given their HP, so
			// coming back gives none (undeath-return.js). Lifted for every other way out.
			add(keptHpUpdate(this._character._actor, this._picked.has("out-of-action") && !res.disperses && hp !== null));
			// Tethered: where and how they come back, said on the card as the window said it.
			if (res.disperses) {
				const where = escHtml(tether || this._character.tether || "");
				lines.after.push(format(`${_I18N}.${where ? "dispersed" : "dispersedUnbound"}`,
					{ tether: where, hp: resolvedHp(res.disperses, this._maxHp ?? 0) }));
			}
		}
		// The roll is spent with the move that it settles (see the note above _landedRoll).
		if (deathsDoorRollMarker(this._character._actor)) add(rollMarkerDeletion());

		// The HP the write actually left, not the tier's number: a slow healer (Torment's Blessing)
		// recovers only half of it.
		const raised = await this._write(owedFinal ? 0 : hp, update);
		const hpLine = hp !== null && raised ? [`Back to <strong>${this._character.hp} HP</strong>.`] : [];
		return [...lines.tether, ...hpLine, ...lines.effects, ...lines.after];
	}

	/**
	 * Unholy Vessel: the Thrall is lost. Nothing else of the move is paid, since there is no one left
	 * to pay it; the state goes to `dead` (out of play, and the Special Moves card says how) in one
	 * write, and the table is told to make a new character. The tab's "Gain a new Mark" lands the same
	 * write (post-death-outcomes.js#loseToUnholyVessel); here it is attributed to the move.
	 */
	async _applyUnholyVessel() {
		// The roll goes with the move it settled (see the note above _landedRoll), in the same write.
		const spent = deathsDoorRollMarker(this._character._actor) ? rollMarkerDeletion() : null;
		return loseToUnholyVessel(this._character, this._moveName, spent);
	}

	/**
	 * An undeath that could not be written. The latch is already back off (every handler rolls it
	 * back before rethrowing), so this only has to name what failed — StonetopDialog says it and
	 * redraws. The same failure as DeathsDoorDialog#_onFateFailed, one window along.
	 */
	_onApplyFailed(err) { this.reportWriteFailure("undeath resolution", err); }

	/**
	 * One effect, as its part of the one write: `add` takes the fragment (and answers whether there
	 * was one; a model that would refuse, say an option already marked, hands back none). Returns the
	 * lines it contributes to the summary.
	 *
	 * The maiming no longer has to be remembered against a retry: a wound is appended to a list, so
	 * a second attempt used to append a second wound whenever a failure came after it, but a failure
	 * of the one write now leaves nothing behind to append to.
	 */
	_effectUpdate(kind, add) {
		const label = (section, slug) => this._sections[section].find(o => o.slug === slug)?.label ?? slug;

		if (kind === "consequence") {
			const slug = this._choices.consequence;
			if (!slug || !add(this._character.markSectionOptionUpdateData(_CONSEQUENCES, slug))) return [];
			return [`Marked the consequence <strong>${escHtml(label(_CONSEQUENCES, slug))}</strong>.`];
		}
		if (kind === "mark-gain") {
			const slug = this._choices["mark-gain"];
			if (!slug || !add(this._character.markSectionOptionUpdateData(_MARKS, slug))) return [];
			return [`Gained the Mark <strong>${escHtml(label(_MARKS, slug))}</strong>.`];
		}
		if (kind === "mark-crossoff") {
			const slug = this._choices["mark-crossoff"];
			if (!slug || !add(this._character.crossOffMarkUpdateData(slug))) return [];
			return [`Crossed off <strong>${escHtml(label(_MARKS, slug))}</strong>: it can never be gained.`];
		}
		if (kind === "task") {
			const text = String(this._choices.task ?? "").trim();
			if (!text) return [];
			add(this._character.masterTaskUpdateData(text));
			return [`Your master sets a task: <em>${escHtml(text)}</em>. Favor stays at 0 until it's done.`];
		}
		if (kind === "maim") {
			// "…permanently maimed in some way of the GM's choosing" — a permanent wound is
			// exactly the sheet's record for that, and it prompts them to name it.
			add(this._character.addWoundUpdate({
				text: _MAIM_TEXT,
				status: "permanent",
				origin: "wound",
			}).update);
			return ["Recorded a <strong>permanent maiming</strong> on your wound list."];
		}
		if (kind === "out-of-action") return ["Out of the action until the next sunset."];
		return [];
	}

	/**
	 * The Revenant's 6- alternative: give up this insert and become a Ghost instead.
	 *
	 * The swap is one write (StonetopCharacter#setPostDeathInsert): the slug, and out of the action at
	 * 0 HP, since they are dying as they take it. Then they are asked for a FRESH first Consequence,
	 * in the same window every Ghost is asked in (Death's Door's choices step). What the Revenant held
	 * is read before the swap: the prune keeps the Consequences both inserts print, and those do not
	 * answer the Ghost's "choose 1 Consequence".
	 *
	 * Asked first, naming the Consequences the Ghost does not print and so does not keep: the prune
	 * takes them for good. And once it is done, whether the maimings Undying left are healed, since
	 * the body that carried them is gone (the user's ruling, 2026-10-27; yes unless they say not).
	 */
	async _onAlternative(slug) {
		if (this._applied || this._confirming || !slug) return;
		if (this._character?.deathsDoorState !== DEATHS_DOOR_STATE.DYING) return this._settledElsewhere();
		await swapRevenantForGhost(this._character, slug, {
			confirm: async (to, heldOptions) => {
				// Latched while the question is up, so a second press does not stack a second one.
				this._confirming = true;
				try {
					return await this._confirmGhost(await this._lostOnSwap(to, heldOptions));
				} finally {
					this._confirming = false;
				}
			},
			proceed: async () => {
				if (this._applied) return false;
				// Asked again: the question waits as long as they do, and the move may have been settled from
				// another owner's window meanwhile.
				if (this._character?.deathsDoorState !== DEATHS_DOOR_STATE.DYING) {
					await this._settledElsewhere();
					return false;
				}
				this._applied = true;
				return true;
			},
			failed: () => { this._applied = false; },
			swapped: async () => {
				// The roll is spent with the move that it settled (see the note above _landedRoll): the swap's own
				// write lifted its marker (StonetopCharacter#setPostDeathInsert, undeathRecordsLifted).
				this._summary = [localize(`${_I18N}.becameGhost`), localize(`${_I18N}.ghostDown`)];
			},
			askHealMaimings: count => this._askHealMaimings(count),
			moveName: this._moveName,
			healed: () => this._summary.push(localize(`${_I18N}.maimingsHealed`)),
			beforeChoices: async () => {
				this._step = "done";
				await this._post(this._summary);
				// Straight on to the Ghost's questions. This window's work is done and its summary is on the
				// chat card, so it gives way rather than standing open beside the next one.
				await this.close();
			},
			openChoices: carried => this._openChoices(carried),
		});
	}

	/** The Ghost's questions, in Death's Door's choices step. Its own method so a test can stand in for the window. */
	_openChoices(carried) {
		return DeathsDoorDialog.openChoices(this._character, this._onDone, { carried, taken: "undying" });
	}

	/**
	 * See ghostSwapLost. Its own method so a test can hand in the insert repository. Read through the
	 * character's own, whose cache the swap's prune then reads from, when it has one.
	 */
	async _lostOnSwap(slug, heldOptions) {
		this._insertRepo ??= this._character?._postDeathInsertRepo ?? new FoundryPostDeathInsertRepository();
		return ghostSwapLost(slug, heldOptions, this._insertRepo);
	}

	/** See confirmGhostSwap. Its own method for the tests. */
	_confirmGhost(lost) {
		return confirmGhostSwap(lost);
	}

	/** See askHealMaimings. Its own method for the tests. */
	_askHealMaimings(count) {
		return askHealMaimings(count);
	}

	async _post(lines) {
		await postOutcomeCard(this._character, this._moveName, lines);
	}

	async _onFinish() {
		await this.close();
		this._onDone?.();
	}
}

/**
 * A Revenant gives up their insert and becomes a Ghost. The one flow for both ways it happens: Undying's 6-
 * alternative (UndeathDialog#_onAlternative) and the Ghost insert dropped on a Revenant's sheet, the way the
 * Pale Hunter's "linger on (gain the Ghost insert)" is taken (audit GM-3).
 *
 * Asked first, naming the Consequences the Ghost does not print: the prune takes them for good, and a no writes
 * nothing. The swap is one write (StonetopCharacter#setPostDeathInsert). Then whether the maimings Undying left
 * are healed, since the body that carried them is gone (the user's ruling, 2026-10-27; yes unless they say not).
 * Then the Ghost's FRESH first Consequence, in Death's Door's choices step, with what the Revenant held carried
 * (the Consequences both inserts print do not answer the Ghost's "choose 1 Consequence").
 *
 * `steps` stands in for any part (the dialog latches its window around them); the rest is the plain flow.
 * `steps.moveName` is the move the maimings' healing is written as, when the swap is one's alternative.
 * Whether the swap was made.
 */
export async function swapRevenantForGhost(character, slug = "ghost", steps = {}) {
	const {
		confirm = async (to, held) => confirmGhostSwap(await ghostSwapLost(to, held, character?._postDeathInsertRepo)),
		proceed = async () => true,
		failed = () => {},
		swapped = async () => {},
		maimings = () => undyingMaimings(character),
		askHealMaimings: askHeal = askHealMaimings,
		moveName = null,
		healMaimings: heal = list => healMaimings(character, list, moveName),
		healed = () => {},
		beforeChoices = async () => {},
		openChoices = carried => DeathsDoorDialog.openChoices(character, null, { carried, taken: "undying" }),
	} = steps;
	const heldOptions = (await character.sectionOptions(_CONSEQUENCES)).filter(o => o.marked);
	if (!await confirm(slug, heldOptions)) return false;
	if (!await proceed()) return false;
	const carried = { [_CONSEQUENCES]: heldOptions.map(o => o.slug) };
	try {
		await character.setPostDeathInsert(slug);
	} catch (err) {
		failed(err);
		throw err;
	}
	await swapped();
	const maimed = maimings();
	if (maimed.length && await askHeal(maimed.length)) {
		await heal(maimed);
		healed();
	}
	await beforeChoices();
	await openChoices(carried);
	return true;
}

/**
 * The Consequences held now that the insert `slug` does not print, by label: what the swap's prune takes
 * for good. Read off the incoming insert's own lists, as the prune reads them (CharacterPostDeath#pruneToInsert).
 * An insert that cannot be read names none, as the prune then keeps everything.
 */
export async function ghostSwapLost(slug, heldOptions, insertRepo = null) {
	let data = null;
	try {
		data = await (insertRepo ?? new FoundryPostDeathInsertRepository()).findBySlug(slug);
	} catch (err) {
		console.warn("Stonetop | could not read the insert the swap goes to", err);
	}
	if (!data) return [];
	const printed = new Set((data.lore ?? []).filter(e => e.slug === _CONSEQUENCES)
		.flatMap(e => (e.options ?? []).map(o => o.slug)));
	return heldOptions.filter(o => !printed.has(o.slug)).map(o => o.label ?? o.slug);
}

/** "Give up this insert and gain the Ghost insert instead?", naming what will not carry over. */
export function confirmGhostSwap(lost) {
	const body = lost.length
		? format(`${_I18N}.becomeGhostLost`, { lost: lost.map(l => `<strong>${escHtml(l)}</strong>`).join(", ") })
		: localize(`${_I18N}.becomeGhostBody`);
	return confirmOutcome({
		title:   localize(`${_I18N}.becomeGhostTitle`),
		content: `<p>${body}</p>`,
		yes:     { label: localize(`${_I18N}.becomeGhostYes`), icon: "fa-ghost" },
		no:      { label: localize(`${_I18N}.becomeGhostNo`) },
	});
}

/** The maimings Undying recorded (UndeathDialog#_effectUpdate's "maim") that are not healed yet. */
export function undyingMaimings(character) {
	return (character?.woundRecords?.() ?? [])
		.filter(w => !w.healed && w.status === "permanent" && String(w.text ?? "").startsWith(_MAIM_PREFIX));
}

/** Whether to mark them healed now the body is gone. Yes unless they say not. */
export function askHealMaimings(count) {
	return confirmOutcome({
		title:   localize(`${_I18N}.maimingsTitle`),
		content: `<p>${escHtml(format(`${_I18N}.maimingsBody`, { count }))}</p>`,
		yes:     { label: localize(`${_I18N}.maimingsYes`), icon: "fa-bandage" },
		no:      { label: localize(`${_I18N}.maimingsNo`) },
		defaultYes: true,
	});
}

/** Mark `maimings` healed in one write, kept as scars as every healed wound is. */
export async function healMaimings(character, maimings, moveName = null) {
	const ids = new Set(maimings.map(w => w.id));
	const wounds = character.woundRecords().map(w => (ids.has(w.id) ? { ...w, healed: true } : w));
	await character.applyUpdate({ "system.attributes.wounds": wounds }, moveName);
}

// Labels from utils/move-results.js — see MOVE_TIERS there for why they are not retyped.

/** The effect kinds picked from a list of options, and so the only ones that can run out. */
const _OPTION_KINDS = new Set(["consequence", "mark-gain", "mark-crossoff"]);
