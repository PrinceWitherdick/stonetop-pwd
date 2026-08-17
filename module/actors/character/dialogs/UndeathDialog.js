import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { stonetopChatCard } from "../../../utils/chat.js";
import { escHtml } from "../../../utils/strings.js";
import { classifyResult, rollStat } from "../../../utils/roll-engine.js";
import { DEATHS_DOOR_STATE, resolutionTier, resolvedHp } from "../deaths-door.js";
import { NEVER_CHOSEN_OPTIONS } from "../post-death-choices.js";

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
const _CONSEQUENCES = "consequences";
const _MARKS        = "marks";
const _FINAL_CONSEQUENCE = "final-consequence";

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
		this._maimed   = false;       // set once the maiming is on the wound list; see _applyEffect
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
		return {
			moveName:  this._moveName,
			trigger:   this._character?.zeroHpMove?.trigger ?? "",
			isRoll:    this._step === "roll",
			isResolve: this._step === "resolve",
			isDone:    this._step === "done",

			rollLabel:   res?.roll?.label ?? "",
			favor:       res?.roll?.loreCount ? this._character.favor() : null,
			rolledTotal: this._rolledTotal ?? null,
			tierLabel:   _TIER_LABELS[this._tierKey] ?? "",

			effects,
			pick,
			pickedCount: this._picked.size,
			// "All 3 apply" is not a choice — say so instead of asking them to tick three boxes.
			allApply:    pick >= available && available > 0,
			canApply:    this._picked.size === pick && this._choicesComplete(),

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
		if (kind === "consequence") {
			return this._sections[_CONSEQUENCES]
				.filter(o => !o.blocked && !NEVER_CHOSEN_OPTIONS.includes(o.slug));
		}
		if (kind === "mark-gain")     return this._sections[_MARKS].filter(o => !o.blocked);
		// Crossing off is the mirror image: only a Mark you DON'T have can be crossed off.
		if (kind === "mark-crossoff") return this._sections[_MARKS].filter(o => !o.marked && !o.crossedOff);
		return [];
	}

	/**
	 * Only the kinds that spend from a list can run out. A `task` is written, not picked from
	 * anything, so it is never exhausted — and _optionsFor returns [] for it, which is why the
	 * membership test has to come first rather than the emptiness check standing alone.
	 */
	_isExhausted(kind) {
		return _OPTION_KINDS.has(kind) && this._optionsFor(kind).length === 0;
	}

	/**
	 * What a dropdown may actually OFFER: everything the kind has left, less the Mark its opposite
	 * number is already spending.
	 *
	 * mark-gain keeps `!o.blocked` and mark-crossoff keeps `!o.marked && !o.crossedOff`, and those
	 * two overlap on every Mark the character neither holds nor has already lost. A 6- on Dark
	 * Succor forces both at once, so the same slug could be gained AND crossed off in one apply,
	 * leaving a Mark that is ticked and struck through together: the tab prints it under "you can
	 * never gain them", the checkbox beside it is disabled so it can never be unticked again, and
	 * its 2 max HP are gone for good.
	 *
	 * Deliberately NOT folded into _optionsFor, which answers the different question _isExhausted
	 * counts by — "has this cost anything left to spend at all". One dropdown's pick declaring the
	 * other exhausted would drop the tier's `available`, and with it the number of costs the move
	 * is allowed to demand.
	 */
	_selectableFor(kind) {
		const opposite = kind === "mark-gain" ? "mark-crossoff" : kind === "mark-crossoff" ? "mark-gain" : null;
		const taken = opposite ? this._choices[opposite] : null;
		const options = this._optionsFor(kind);
		return taken ? options.filter(o => o.slug !== taken) : options;
	}

	/** Every picked effect that needs a choice has one, and no Mark is being gained and lost at once. */
	_choicesComplete() {
		for (const kind of this._picked) {
			if (kind === "task") { if (!String(this._choices.task ?? "").trim()) return false; continue; }
			if (this._optionsFor(kind).length && !this._choices[kind]) return false;
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
		html.find(".undeath-roll-btn").on("click", () => this._onRoll().catch(err => this._onApplyFailed(err)));
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
			const kind = ev.currentTarget.dataset.kind;
			if (ev.currentTarget.checked) this._picked.add(kind);
			else { this._picked.delete(kind); delete this._choices[kind]; }
			this.render(true);
		});

		html.find(".undeath-effect-select").on("change", (ev) => {
			this._choices[ev.currentTarget.dataset.kind] = ev.currentTarget.value;
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
			for (const e of this._resolution.effects) if (!this._isExhausted(e.kind)) this._picked.add(e.kind);
		}
	}

	async _onRoll() {
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
			const options   = usesLore
				? { rollMode: "normal" }
				: (this._character.applyDebilityRollMode?.(res.roll.stat, { rollMode: "normal" }) ?? { rollMode: "normal" });

			const roll = await rollStat(usesLore ? "" : res.roll.stat, actor, {
				...options,
				statValue,
				moveName: this._moveName,
				// Undying / Tethered / Dark Succor ARE Death's Door for a character who has already
				// been through it, so they follow the same house rule: no +1 XP on the miss that
				// might end them. See DeathsDoorDialog._onRoll.
				noXpOnMiss: true,
				moveDescription: `<p>${this._character.zeroHpMove.trigger}</p>`,
			});

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

	/** Enact the tier: the HP it restores, then each effect the player took. */
	async _onApply() {
		if (this._applied) return;
		const res  = this._resolution;
		const tier = resolutionTier(res, this._tierKey);
		if (!tier) return;
		this._applied = true;

		const done = [];
		try {
			// A tether named here (the Ghost's first Tethered, usually) is theirs from now on.
			const tether = String(this._tether ?? "").trim();
			if (res.disperses && tether && tether !== this._character.tether) {
				await this._character.setTether(tether);
				done.push(`Bound to <strong>${escHtml(tether)}</strong>.`);
			}

			const hp = resolvedHp(tier, this._maxHp ?? 0);
			if (hp !== null && await this._character.restoreHp(hp, this._moveName)) done.push(`Back to <strong>${hp} HP</strong>.`);

			for (const kind of this._picked) done.push(...await this._applyEffect(kind));

			// "Regardless, reset your Favor to 0."
			if (res.alwaysResetFavor && this._character.favor() > 0) {
				await this._character.setFavor(0);
				done.push("Favor reset to <strong>0</strong>.");
			}

			if (this._tetherDestroyed) {
				// There is nothing left to reform beside. The Final Consequence is the end of them
				// as a player character — "your tenuous connection to humanity is lost and you
				// become a monster under the GM's control" — so they leave play rather than sitting
				// in a state that offers to bring them back.
				await this._character.markSectionOption(_CONSEQUENCES, _FINAL_CONSEQUENCE);
				await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.DEAD);
				done.push("Your tether is destroyed: marked <strong>the Final Consequence</strong>. You pass into the GM's hands.");
			} else {
				// Otherwise they are no longer dying — all three moves avert the death. They're out
				// of the action if the move says so (Undying's second cost), if their essence has
				// dispersed (Tethered), or if the move states no recovery and leaves it to the GM
				// (Dark Succor). Clearing that state is how they come back.
				const down = this._picked.has("out-of-action") || !!res.disperses || hp === null;
				await this._character.setDeathsDoorState(down ? DEATHS_DOOR_STATE.OUT_OF_ACTION : null);
			}
		} catch (err) {
			this._applied = false;
			throw err;
		}

		this._summary = done;
		this._step = "done";
		await this._post(done);
		// Guarded: everything above is server round trips (the HP write, each effect, the chat
		// card), and a window closed part-way through them must not pop back open.
		this.renderIfOpen();
	}

	/**
	 * An undeath that could not be written. The latch is already back off (every handler rolls it
	 * back before rethrowing), so this only has to name what failed — StonetopDialog says it and
	 * redraws. The same failure as DeathsDoorDialog#_onFateFailed, one window along.
	 */
	_onApplyFailed(err) { this.reportWriteFailure("undeath resolution", err); }

	/** One effect, applied. Returns the lines it contributes to the summary. */
	async _applyEffect(kind) {
		const label = (section, slug) => this._sections[section].find(o => o.slug === slug)?.label ?? slug;

		if (kind === "consequence") {
			const slug = this._choices.consequence;
			if (!slug || !await this._character.markSectionOption(_CONSEQUENCES, slug)) return [];
			return [`Marked the consequence <strong>${escHtml(label(_CONSEQUENCES, slug))}</strong>.`];
		}
		if (kind === "mark-gain") {
			const slug = this._choices["mark-gain"];
			if (!slug || !await this._character.markSectionOption(_MARKS, slug)) return [];
			return [`Gained the Mark <strong>${escHtml(label(_MARKS, slug))}</strong>.`];
		}
		if (kind === "mark-crossoff") {
			const slug = this._choices["mark-crossoff"];
			if (!slug || !await this._character.crossOffMark(slug)) return [];
			return [`Crossed off <strong>${escHtml(label(_MARKS, slug))}</strong>: it can never be gained.`];
		}
		if (kind === "task") {
			const text = String(this._choices.task ?? "").trim();
			if (!text) return [];
			await this._character.setMasterTask(text);
			return [`Your master sets a task: <em>${escHtml(text)}</em>. Favor stays at 0 until it's done.`];
		}
		if (kind === "maim") {
			// Remembered, because this is the ONE effect here that is not idempotent on its own.
			// The others all ask the model to mark something already marked and are told no
			// (markSectionOption, crossOffMark) or overwrite a single field (setMasterTask); a
			// wound is appended to a list, so a second attempt appends a second wound. _onApply
			// rolls its latch back on a failure precisely so the player CAN click again — which
			// turned one maiming into two whenever the failure came after this line.
			if (this._maimed) return [];
			// "…permanently maimed in some way of the GM's choosing" — a permanent wound is
			// exactly the sheet's record for that, and it prompts them to name it.
			await this._character.addWound({
				text: "Permanently maimed: the GM says how",
				status: "permanent",
				origin: "wound",
			});
			this._maimed = true;
			return ["Recorded a <strong>permanent maiming</strong> on your wound list."];
		}
		if (kind === "out-of-action") return ["Out of the action until the next sunset."];
		return [];
	}

	/** The Revenant's 6- alternative: give up this insert and become a Ghost instead. */
	async _onAlternative(slug) {
		if (this._applied || !slug) return;
		this._applied = true;
		try {
			await this._character.setPostDeathInsert(slug);
			// This fork restores no HP — the body they were clinging to is given up. They're not
			// dying any more, but they're not up either; the GM says when the spirit is present.
			await this._character.setDeathsDoorState(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		} catch (err) {
			this._applied = false;
			throw err;
		}
		this._summary = [
			"Gave up the Revenant insert and became a <strong>Ghost</strong>. Choose your Terrible Purpose and your first Consequence on the Post-Death tab.",
			"Your body is given up, so no HP comes back — you're out of the action until the GM says otherwise.",
		];
		this._step = "done";
		await this._post(this._summary);
		// Guarded, like _onApply: setPostDeathInsert alone is a prune and several writes.
		this.renderIfOpen();
	}

	async _post(lines) {
		if (!lines.length) return;
		const actor = this._character?._actor ?? null;
		await ChatMessage.create({
			speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
			content: stonetopChatCard(this._moveName, `<div class="card-content">
				<ul class="stonetop-undeath-summary">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
			</div>`, "stonetop-dying-card"),
		});
	}

	async _onFinish() {
		await this.close();
		this._onDone?.();
	}
}

const _TIER_LABELS = { success: "10+", partial: "7-9", failure: "6-" };

/** The effect kinds picked from a list of options, and so the only ones that can run out. */
const _OPTION_KINDS = new Set(["consequence", "mark-gain", "mark-crossoff"]);
