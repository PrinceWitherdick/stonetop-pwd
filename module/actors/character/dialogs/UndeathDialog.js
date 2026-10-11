import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { escHtml } from "../../../utils/strings.js";
import { TIER_LABELS } from "../../../utils/move-results.js";
import { classifyResult } from "../../../utils/roll-engine.js";
import { promptRoll } from "../../../dialogs/RollDialog.js";
import { format, localize } from "../../../utils/i18n.js";
import { DEATHS_DOOR_STATE, FINAL_CONSEQUENCE, resolutionTier, resolvedHp } from "../deaths-door.js";
import { gainableMarks, markableConsequences } from "../post-death-choices.js";
import { loseToUnholyVessel, postOutcomeCard } from "../post-death-outcomes.js";
import { DeathsDoorDialog } from "./DeathsDoorDialog.js";

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
		this._choices  = {};          // effect kind → chosen option slug / text
		this._sections = { [_CONSEQUENCES]: [], [_MARKS]: [] };
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
		// A move that doesn't roll opens straight on its costs, and Tethered's single cost isn't
		// a choice — tick it up front so the only question left is which consequence.
		if (this._step === "resolve") this._syncForcedPicks();
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

		// What they can actually be made to take. A move can demand more costs than the insert
		// has left to give — every consequence already marked, every Mark held — and asking for
		// three when only two exist would leave the Apply button dead forever.
		const available = effects.filter(e => !e.exhausted).length;
		const pick = Math.min(tier?.pick ?? 0, available);
		// Unholy Vessel: the move demands a Mark and there is none left to gain. Nothing else is asked.
		const unholyVessel = this._isUnholyVessel();
		return {
			moveName:  this._moveName,
			trigger:   this._character?.zeroHpMove?.trigger ?? "",
			isRoll:    this._step === "roll",
			isResolve: this._step === "resolve",
			isDone:    this._step === "done",

			rollLabel:   res?.roll?.label ?? "",
			favor:       res?.roll?.loreCount ? this._character.favor() : null,
			rolledTotal: this._rolledTotal ?? null,
			tierLabel:   TIER_LABELS[this._tierKey] ?? "",

			effects,
			pick,
			pickedCount: this._picked.size,
			// "All 3 apply" is not a choice — say so instead of asking them to tick three boxes.
			allApply:    pick >= available && available > 0,
			canApply:    unholyVessel || (this._picked.size === pick && this._choicesComplete()),
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
			needsTether: !!res?.disperses && !(this._tether ?? this._character.tether),
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
		const res  = this._resolution;
		const tier = resolutionTier(res, this._tierKey);
		const effects = res?.effects ?? [];
		if (!tier || !effects.some(e => e.kind === "mark-gain") || !this._isExhausted("mark-gain")) return false;
		return tier.pick > effects.filter(e => !this._isExhausted(e.kind)).length;
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

		html.find(".undeath-task-input").on("input", (ev) => { this._choices.task = ev.currentTarget.value; });
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
		if (this._rolling) return;
		this._rolling = true;
		try {
			const actor = this._character?._actor ?? null;
			const res   = this._resolution;
			if (!actor || !res?.roll) return;

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
			// Guarded: the 3D dice are several seconds of await, and a window closed during them
			// must not be forced back open. See DeathsDoorDialog._onRoll.
			this.renderIfOpen();
		} finally {
			this._rolling = false;
		}
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
		this._applied = true;

		let done;
		try {
			done = this._isUnholyVessel() ? await this._applyUnholyVessel() : await this._applyTier(tier);
		} catch (err) {
			this._applied = false;
			throw err;
		}

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

		const hp = resolvedHp(tier, this._maxHp ?? 0);
		if (this._tetherDestroyed) {
			// There is nothing left to reform beside. The Final Consequence is the end of them
			// as a player character ("your tenuous connection to humanity is lost and you
			// become a monster under the GM's control"), so they leave play rather than sitting
			// in a state that offers to bring them back.
			add(this._character.finalConsequenceUpdateData());
			lines.after.push("Your tether is destroyed: marked <strong>the Final Consequence</strong>. You pass into the GM's hands.");
		} else {
			// Otherwise they are no longer dying: all three moves avert the death. They're out
			// of the action if the move says so (Undying's second cost), if their essence has
			// dispersed (Tethered), or if the move states no recovery and leaves it to the GM
			// (Dark Succor). "Back on your feet" on the Special Moves card is how they come back.
			const down = this._picked.has("out-of-action") || !!res.disperses || hp === null;
			add(this._character.deathsDoorStateUpdateData(down ? DEATHS_DOOR_STATE.OUT_OF_ACTION : null));
		}

		// The HP the write actually left, not the tier's number: a slow healer (Torment's Blessing)
		// recovers only half of it.
		const raised = await this._write(hp, update);
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
		return loseToUnholyVessel(this._character, this._moveName);
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
				text: "Permanently maimed: the GM says how",
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
	 */
	async _onAlternative(slug) {
		if (this._applied || !slug) return;
		this._applied = true;
		let carried;
		try {
			const held = (await this._character.sectionOptions(_CONSEQUENCES)).filter(o => o.marked).map(o => o.slug);
			carried = { [_CONSEQUENCES]: held };
			await this._character.setPostDeathInsert(slug);
		} catch (err) {
			this._applied = false;
			throw err;
		}
		this._summary = [localize(`${_I18N}.becameGhost`), localize(`${_I18N}.ghostDown`)];
		this._step = "done";
		await this._post(this._summary);
		// Straight on to the Ghost's questions. This window's work is done and its summary is on the
		// chat card, so it gives way rather than standing open beside the next one.
		await this.close();
		await this._openChoices(carried);
	}

	/** The Ghost's questions, in Death's Door's choices step. Its own method so a test can stand in for the window. */
	_openChoices(carried) {
		return DeathsDoorDialog.openChoices(this._character, this._onDone, { carried, taken: "undying" });
	}

	async _post(lines) {
		await postOutcomeCard(this._character, this._moveName, lines);
	}

	async _onFinish() {
		await this.close();
		this._onDone?.();
	}
}

// Labels from utils/move-results.js — see MOVE_TIERS there for why they are not retyped.

/** The effect kinds picked from a list of options, and so the only ones that can run out. */
const _OPTION_KINDS = new Set(["consequence", "mark-gain", "mark-crossoff"]);
