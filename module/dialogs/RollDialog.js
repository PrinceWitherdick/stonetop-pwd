import { bringDialogToFront } from "../utils/front-on-open.js";
import { localize } from "../utils/i18n.js";
import { escHtml } from "../utils/strings.js";
import { composeDamageFormula, normalizeDamageBonusDice } from "../utils/damage.js";
import { damageRollFormula, rollDamage } from "../utils/roll-engine.js";
import { getAskRollModeEachRollSetting, getPromptRollModifierSetting, getPromptDamageModifierSetting } from "../settings.js";

// Advantage / Normal / Disadvantage, worst to best left to right, so the strip reads as a scale
// rather than a menu — the same order and the same segmented-pill markup the steading's Homefront
// Moves heading wears (see roll-mode-picker.hbs). Literal markup rather than a Handlebars partial
// because a Dialog's content is a plain string built before any template is loaded; the CSS is
// shared, which is what keeps the two looking like one control.
//
// The label and the dice line for each are `stonetop.rollMode.*` in languages/en.json — the same
// strings the sheet controls use, so a translated world keeps its translation, and only the icon
// and the order are decided here.
const ROLL_MODES = [
	{ mode: "dis",    icon: "fa-angles-down" },
	{ mode: "normal", icon: "fa-equals"      },
	{ mode: "adv",    icon: "fa-angles-up"   },
];

// What a roll the window did not ask about goes out as.
export const DEFAULT_ROLL_MODE = "normal";

/**
 * How a roll that was never asked about goes out: Normal, +0.
 *
 * The answer a rollable with nothing to ask about takes — a raw damage die is not a 2d6 move
 * roll, so no mode applies to it and none can be inherited from anywhere either. Exported so
 * that case says it by name rather than writing the pair of defaults out again; spread it,
 * never hand the frozen object on.
 *
 * NOT what a Shift-click answers. Shift skips the WINDOW, not the sheet: see `promptRoll`.
 */
export const UNPROMPTED_ROLL = Object.freeze({ rollMode: DEFAULT_ROLL_MODE, situational: 0 });

/**
 * Anything that is not an explicit advantage or disadvantage is a normal roll.
 *
 * Applied at the entry points that take a mode from a caller rather than trusted, because the
 * mode may arrive from this window's DOM rather than from a validated flag. Lives here, beside
 * `ROLL_MODES` and `DEFAULT_ROLL_MODE`, so the three modes are written down once: both sheets
 * had their own byte-identical copy of this, which is three files to edit for a fourth mode.
 */
export function normalizeRollMode(rollMode) {
	return ROLL_MODES.some(m => m.mode === rollMode) ? rollMode : DEFAULT_ROLL_MODE;
}

function modeButtons(active) {
	return ROLL_MODES.map(({ mode, icon }) => {
		const on = mode === active;
		return `<button type="button"
		        class="stonetop-segmented-picker-option stonetop-roll-mode-btn${on ? " is-active" : ""}"
		        data-roll-mode="${mode}" aria-pressed="${on}">
			<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${localize(`stonetop.rollMode.${mode}`)}</span>
		</button>`;
	}).join("");
}

function diceReadout(mode) {
	const entry = ROLL_MODES.find(m => m.mode === mode) ?? ROLL_MODES[1];
	return localize(`stonetop.rollMode.${entry.mode}Tooltip`);
}

// -- The parts both windows are built from ------------------------------------
//
// The move-roll window and the damage window are the same window with different questions in
// it: the same segmented mode picker, the same ±stepper, the same settle-once promise, the
// same button order and chrome. Written down ONCE here, because the pieces that differ between
// them are small and named, while the pieces that are shared are the ones that quietly drift —
// the `is-active`/`aria-pressed` pair and the stepper's arithmetic are exactly the sort of
// thing that ends up fixed in one copy and not the other.

/** The segmented Advantage/Normal/Disadvantage strip, under its own question. */
function modePickerHtml(prompt, active) {
	return `<p class="stonetop-roll-prompt">${prompt}</p>
				<div class="stonetop-segmented-picker stonetop-roll-mode-picker" role="group"
				     aria-label="${localize("stonetop.rollMode.pickerLabel")}">
					${modeButtons(active)}
				</div>`;
}

/** The −/number/+ stepper. `ariaLabel` names the GROUP: the window may hold two clusters of
 *  buttons around a number, and its own buttons say only "Decrease" and "Increase", so a
 *  shared name here would leave one of them unnamed to a screen reader. */
function stepperHtml(ariaLabel) {
	return `<div class="stonetop-roll-modifier-stepper" role="group" aria-label="${ariaLabel}">
						<button type="button" class="stonetop-roll-modifier-step" data-step="-1" aria-label="Decrease">&minus;</button>
						<input type="number" name="modifier" value="0" step="1" inputmode="numeric" autocomplete="off">
						<button type="button" class="stonetop-roll-modifier-step" data-step="1" aria-label="Increase">+</button>
					</div>`;
}

/** The picker's live answer, read off the DOM rather than a closure: the `.is-active` class we
 *  stamp on click IS the state, so reading it there is one source of truth. */
function readActiveMode(root) {
	return normalizeRollMode(
		root?.querySelector?.(".stonetop-roll-mode-btn.is-active")?.dataset?.rollMode);
}

/** The stepper's live answer. Anything unparseable reads as 0. */
function readModifier(root) {
	return Math.trunc(Number(root?.querySelector?.('[name="modifier"]')?.value)) || 0;
}

/** Buttons rather than the radios a segmented strip is normally built around: the pill has to
 *  repaint the instant it is clicked and there is no document write behind it to re-render off
 *  (the choice lives and dies with this window), so the fill hangs off a class we move. */
function wireModePicker(root, onChange) {
	const options = root.querySelectorAll(".stonetop-roll-mode-btn");
	options.forEach(btn => {
		btn.addEventListener("click", () => {
			options.forEach(other => {
				const on = other === btn;
				other.classList.toggle("is-active", on);
				other.setAttribute("aria-pressed", String(on));
			});
			onChange(btn.dataset.rollMode);
		});
	});
}

/** Wire the ± buttons, and land focus in the number they step. Returns the input, which is the
 *  field both windows focus on open: Enter still fires the default button from there. */
function wireStepper(root, onChange) {
	const input = root.querySelector('[name="modifier"]');
	root.querySelectorAll(".stonetop-roll-modifier-step").forEach(btn => {
		btn.addEventListener("click", () => {
			input.value = String((Math.trunc(Number(input.value)) || 0) + Number(btn.dataset.step));
			input.focus();
			onChange();
		});
	});
	return input;
}

/** Resolve-once plumbing: the window can settle from its buttons OR from being dismissed, and
 *  only the first of those is the answer. */
function settler(resolve) {
	let settled = false;
	return value => { if (!settled) { settled = true; resolve(value); } };
}

/** Affirmative on the left, cancel on the right (Foundry button order). */
function rollDialogButtons(rollLabel, settle, readAnswer) {
	return {
		roll: { label: rollLabel, callback: html => settle(readAnswer(html[0] ?? html)) },
		cancel: { label: "Cancel", callback: () => settle(null) },
	};
}

/**
 * The pre-roll prompt for a 2d6 move/stat roll: how to roll it (Advantage / Normal /
 * Disadvantage) and a one-off situational modifier — a held bonus, a GM-granted +1, a
 * circumstantial penalty. Resolves to an object ready to spread straight into a roll call, or
 * `null` when the player cancels or dismisses the window so the caller can abort.
 *
 * WHICH HALVES IT ASKS IS THE SETTING, and the answer's SHAPE follows from it:
 *
 *   · "Ask How to Roll Each Time" on  →  the mode picker (and the stepper with it). Both fields
 *     start fresh every time, and the answer carries `rollMode`, which is the caller's mode.
 *   · off                            →  advantage lives on the sheet instead, as the sticky
 *     Roll Modifier selector (roll-mode-radios.hbs / roll-mode-picker.hbs), and the answer
 *     carries NO `rollMode` key at all — so a caller spreading it leaves the actor's flag to
 *     decide, which is the whole point of the selector still being there.
 *   · "Prompt for Roll Modifier" on   →  the stepper, whatever the above says.
 *   · neither                         →  no window opens and the answer is `{ situational: 0 }`.
 *
 * An absent key rather than a normal-shaped default is what keeps the two modes from fighting:
 * `{ rollMode: "normal" }` spread over a roll would silently overwrite the Advantage a player
 * set on their sheet, every roll, which is exactly the bug the setting exists to let them avoid.
 *
 * The modifier flows on through the roll engine as its existing "situational" modifier and shows
 * a Situational pill on the result card; the mode is the engine's `rollMode`, which paints an
 * Advantage/Disadvantage condition pill. A marked debility can still cancel an advantage or
 * force disadvantage AFTER this — see StonetopCharacter#applyDebilityRollMode — which is why the
 * pill on the card is the honest record of how the dice actually went, not this choice.
 *
 * Holding Shift on the originating click skips the window — and that skip is HANDLED HERE rather
 * than by each caller, so "Shift means the dice and nothing else" is one rule in one place. Every
 * roll surface passes its `shiftKey` straight through. Skipping does not force Normal: it answers
 * exactly as "nothing was asked" answers, so a sheet selector still applies to a Shift-click.
 *
 * @param {object} [opts]
 * @param {string} [opts.title]        Dialog title — usually the move or stat being rolled.
 * @param {boolean} [opts.shiftKey]    Skip the window entirely.
 * @param {boolean} [opts.askMode]     Override the "Ask How to Roll Each Time" setting (tests).
 * @param {boolean} [opts.askModifier] Override the "Prompt for Roll Modifier" setting (tests).
 * @returns {Promise<{rollMode?: string, situational: number}|null>}
 */
export function promptRoll({
	title = "Roll",
	shiftKey = false,
	askMode = getAskRollModeEachRollSetting(),
	askModifier = askMode || getPromptRollModifierSetting(),
} = {}) {
	// Nothing to ask, or told not to ask: answer as if the window had opened and been left
	// alone. No Dialog is constructed at all — one that opened and closed itself would still
	// steal focus from whatever the player was doing.
	if (shiftKey || (!askMode && !askModifier)) {
		return Promise.resolve(askMode ? { rollMode: DEFAULT_ROLL_MODE, situational: 0 } : { situational: 0 });
	}
	return new Promise(resolve => {
		const settle = settler(resolve);

		// The answer's SHAPE follows from what was asked: no picker, no `rollMode` key, so a
		// sheet selector is not overruled by a window that never put the question.
		const readAnswer = root => (askMode
			? { rollMode: readActiveMode(root), situational: readModifier(root) }
			: { situational: readModifier(root) });

		// This window's readout is the dice line ("Roll 3d6 and keep the highest two"), which is
		// the mode picker's own answer restated. The damage window replaces it with a formula
		// preview, because that sentence would be a lie there.
		const modeSection = askMode ? `
				${modePickerHtml("How are you rolling this?", DEFAULT_ROLL_MODE)}
				<p class="stonetop-roll-dice" aria-live="polite">${diceReadout(DEFAULT_ROLL_MODE)}</p>` : "";

		const dialog = new Dialog({
			title,
			content: `<form class="stonetop-roll-form">${modeSection}
				<p class="stonetop-roll-prompt">Add a one-off modifier (a held bonus, a GM-granted +1, a penalty&hellip;).</p>
				${stepperHtml(localize("stonetop.rollMode.modifierLabel"))}
			</form>`,
			buttons: rollDialogButtons("Roll", settle, readAnswer),
			default: "roll",
			close: () => settle(null),
			render: html => {
				bringDialogToFront(html);
				const root = html[0] ?? html;

				const readout = root.querySelector(".stonetop-roll-dice");
				wireModePicker(root, mode => {
					if (readout) readout.textContent = diceReadout(mode);
				});
				const input = wireStepper(root, () => {});
				// Focus the modifier, not the picker: Normal is already the answer to the picker's
				// question, so the field that might need typing into is the one to land in, and
				// Enter still fires the default Roll button from there.
				input?.focus();
				input?.select?.();
			},
		}, { classes: ["dialog", "stonetop", "stonetop-roll-dialog"], width: 380 });

		dialog.render(true);
	});
}

// -- The damage window --------------------------------------------------------

/**
 * What a damage roll the window did not ask about goes out as: the mode it was handed, and
 * nothing added.
 *
 * NOT the shape {@link UNPROMPTED_ROLL} has, and the difference is deliberate. A 2d6 move roll
 * has a SECOND home for advantage — the sticky selector on the sheet — so its unprompted answer
 * must omit `rollMode` entirely or it would overrule that selector (see promptRoll). Damage has
 * no such selector: the only mode a damage roll can carry is the one its caller already knows
 * (a monster stat block's "icy touch d6 w/disadvantage"), so passing it straight back through is
 * the correct answer rather than a default that erases it.
 */
function unpromptedDamage(rollMode) {
	return { rollMode: normalizeRollMode(rollMode), bonus: 0, extraDice: "" };
}

/** The composed formula a set of answers would actually roll, for the window's preview line. */
function previewFormula(base, { rollMode, bonus, extraDice }) {
	return damageRollFormula(composeDamageFormula(base, { bonus, extraDice }), rollMode);
}

/**
 * The pre-roll prompt for a DAMAGE roll: how to roll it (Stonetop's "roll damage twice, take
 * the higher/lower") and what to add to it — a flat modifier and/or extra dice.
 *
 * This is the seam for every damage bonus the system cannot know about from the sheet, because
 * the fiction is what turns it on: the Storm Markings' "when you roil with anger, you do +1
 * damage until you calm down", a Blood-Soaked Past's +1d4 for fighting without mercy, a spent
 * Fury's "+1d6, forceful, loud", a GM's ruling. Nothing here is enforced or remembered — it is
 * one roll's worth of adjustment, said out loud on the card as a pill so the table can see it
 * was added rather than wondering where an 11 came from on a d10.
 *
 * Resolves to `{ rollMode, bonus, extraDice }`, ready to spread into {@link rollDamage}, or
 * `null` when the player cancels so the caller can abort without rolling. The window opens only
 * while the "Adjust Damage Before Rolling" client setting is on, and Shift on the originating
 * click skips it — the same bargain promptRoll strikes, so a table that wants the dice and
 * nothing else never sees either window.
 *
 * @param {object} [opts]
 * @param {string}  [opts.title]     Dialog title — usually the move and weapon being rolled.
 * @param {string}  [opts.formula]   The base damage formula, shown in the live preview.
 * @param {string}  [opts.rollMode]  Mode to start on (a stat block's noted advantage).
 * @param {boolean} [opts.shiftKey]  Skip the window entirely.
 * @param {boolean} [opts.ask]       Override the client setting (tests).
 * @returns {Promise<{rollMode: string, bonus: number, extraDice: string}|null>}
 */
export function promptDamage({
	title = "Damage",
	formula = "",
	rollMode = DEFAULT_ROLL_MODE,
	shiftKey = false,
	ask = getPromptDamageModifierSetting(),
} = {}) {
	const start = normalizeRollMode(rollMode);
	if (shiftKey || !ask) return Promise.resolve(unpromptedDamage(start));

	return new Promise(resolve => {
		const settle = settler(resolve);

		const readAnswer = root => ({
			rollMode: readActiveMode(root),
			bonus: readModifier(root),
			// Normalized on the way OUT, not just in the preview: a half-typed "1d" must reach
			// the roll as nothing at all rather than as a formula that throws.
			extraDice: normalizeDamageBonusDice(root?.querySelector?.('[name="extraDice"]')?.value),
		});

		const dialog = new Dialog({
			title,
			content: `<form class="stonetop-roll-form stonetop-damage-form">
				${modePickerHtml("How are you rolling this damage?", start)}
				<p class="stonetop-roll-prompt">Add to the damage (an arcanum's +1, a move's extra dice, a GM's call).</p>
				<!-- Two labels then two controls, in that order: the row is a 2x2 grid, so the labels
				     share a line and the controls share a line whatever either one measures. The
				     labels are spans with matching aria-labels on the controls, rather than real
				     label elements, because two of these windows can be open at once (two sheets,
				     two clicks) and the id a label points at would then be in the document twice. -->
				<div class="stonetop-damage-adjust">
					<span class="stonetop-damage-field-label">Damage</span>
					<span class="stonetop-damage-field-label">Extra dice</span>
					${stepperHtml("Damage")}
					<input type="text" name="extraDice" class="stonetop-damage-extra-dice" value="" placeholder="1d6"
					       aria-label="Extra dice" autocomplete="off" spellcheck="false">
				</div>
				<p class="stonetop-damage-preview" aria-live="polite">Rolling <strong>${escHtml(previewFormula(formula, unpromptedDamage(start)))}</strong></p>
			</form>`,
			buttons: rollDialogButtons("Roll damage", settle, readAnswer),
			default: "roll",
			close: () => settle(null),
			render: html => {
				bringDialogToFront(html);
				const root = html[0] ?? html;

				// The preview is the readout, and it replaces the mode tooltips promptRoll shows:
				// "Roll 3d6 and keep the highest two" is a 2d6 move roll's answer and would be a
				// lie here, where advantage doubles the DAMAGE die. Showing the formula that is
				// about to be rolled says it correctly for any die, any bonus, any extra dice —
				// and is the only place a typo in the dice field is visibly ignored.
				const preview = root.querySelector(".stonetop-damage-preview strong");
				const extra   = root.querySelector('[name="extraDice"]');
				const repaint = () => {
					const answer = readAnswer(root);
					if (preview) preview.textContent = previewFormula(formula, answer);
					// Said, not swallowed: a field holding text the roll will drop looks exactly
					// like one that worked, and the player finds out when the damage is short.
					const typed = String(extra?.value ?? "").trim();
					extra?.classList?.toggle("is-invalid", Boolean(typed) && !answer.extraDice);
				};

				wireModePicker(root, repaint);
				const input = wireStepper(root, repaint);
				input?.addEventListener("input", repaint);
				extra?.addEventListener("input", repaint);
				// Painted once from the rendered controls as well as baked into the content
				// above, so the line is always what THIS DOM would roll rather than a seed that
				// could drift from the fields beside it.
				repaint();

				// Land on the stepper: a flat +1 is the common adjustment, and Enter still fires
				// the default Roll damage button from there.
				input?.focus();
				input?.select?.();
			},
		}, { classes: ["dialog", "stonetop", "stonetop-roll-dialog", "stonetop-damage-dialog"], width: 380 });

		dialog.render(true);
	});
}

/**
 * Offer the damage window, then roll what it answered - or roll nothing if it was dismissed.
 *
 * The whole "ask, then roll, and abort on cancel" sequence, which three damage surfaces (the
 * monster sheet, the NPC sheet, and a character move's damage button) had written out
 * identically. Bundled because the two halves are only correct TOGETHER: calling `rollDamage`
 * directly silently skips the window, and forgetting the cancel guard rolls a roll the player
 * just backed out of. Neither mistake shows up as anything but a wrong number on a card.
 *
 * The attack flow deliberately does NOT use this: it has to ask BEFORE it latches the attack
 * card and spends ammo, so it keeps the two halves apart on purpose (see askDamageAdjustment
 * in combat/attack-flow.js).
 *
 * @param {string} formula         the damage formula, already carrying the weapon's own +N
 * @param {Actor} actor
 * @param {object} opts
 * @param {string} opts.label      what the card calls this damage
 * @param {string} [opts.rollMode] a mode the SOURCE already notes (a stat block's "w/
 *   disadvantage"), which SEEDS the window rather than being replaced by it - so skipping the
 *   window still rolls the way the source says.
 * @param {boolean} [opts.shiftKey] skip the window
 * @returns {Promise<boolean>} whether damage was actually rolled
 */
export async function rollDamagePrompted(formula, actor, { label, rollMode, shiftKey = false } = {}) {
	const adjust = await promptDamage({ title: label, formula, ...(rollMode ? { rollMode } : {}), shiftKey });
	if (!adjust) return false;
	await rollDamage(formula, actor, { label, ...adjust });
	return true;
}
