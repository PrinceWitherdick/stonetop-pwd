import { bringDialogToFront } from "../utils/front-on-open.js";
import { localize } from "../utils/i18n.js";
import { getAskRollModeEachRollSetting, getPromptRollModifierSetting } from "../settings.js";

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
		let settled = false;
		const settle = value => { if (!settled) { settled = true; resolve(value); } };

		// Both read back off the rendered DOM the buttons hand us rather than from a closure
		// variable: the picker's live state is the `.is-active` we stamp on click, so reading it
		// there is one source of truth with nothing to keep in step.
		const readMode = root =>
			root?.querySelector?.(".stonetop-roll-mode-btn.is-active")?.dataset?.rollMode ?? DEFAULT_ROLL_MODE;
		const readMod = root => {
			const n = Math.trunc(Number(root?.querySelector?.('[name="modifier"]')?.value));
			return Number.isFinite(n) ? n : 0;
		};
		const readAnswer = root => (askMode
			? { rollMode: readMode(root), situational: readMod(root) }
			: { situational: readMod(root) });

		// The window holds up to TWO clusters of buttons around a number, so each carries its own
		// group label. They used to share one key, `rollMode.label` ("Roll modifier"), which
		// names the stepper while sitting on the mode picker: a screen reader heard the two
		// controls transposed, and the stepper — whose own buttons say only "Decrease" and
		// "Increase" — went unnamed. One key per group, so neither can borrow the other's name.
		const modeSection = askMode ? `
				<p class="stonetop-roll-prompt">How are you rolling this?</p>
				<div class="stonetop-segmented-picker stonetop-roll-mode-picker" role="group"
				     aria-label="${localize("stonetop.rollMode.pickerLabel")}">
					${modeButtons(DEFAULT_ROLL_MODE)}
				</div>
				<p class="stonetop-roll-dice" aria-live="polite">${diceReadout(DEFAULT_ROLL_MODE)}</p>` : "";

		const dialog = new Dialog({
			title,
			content: `<form class="stonetop-roll-form">${modeSection}
				<p class="stonetop-roll-prompt">Add a one-off modifier (a held bonus, a GM-granted +1, a penalty&hellip;).</p>
				<div class="stonetop-roll-modifier-stepper" role="group"
				     aria-label="${localize("stonetop.rollMode.modifierLabel")}">
					<button type="button" class="stonetop-roll-modifier-step" data-step="-1" aria-label="Decrease">&minus;</button>
					<input type="number" name="modifier" value="0" step="1" inputmode="numeric" autocomplete="off">
					<button type="button" class="stonetop-roll-modifier-step" data-step="1" aria-label="Increase">+</button>
				</div>
			</form>`,
			// Affirmative on the left, cancel on the right (Foundry button order).
			buttons: {
				roll: {
					label: "Roll",
					callback: html => settle(readAnswer(html[0] ?? html)),
				},
				cancel: { label: "Cancel", callback: () => settle(null) },
			},
			default: "roll",
			close: () => settle(null),
			render: html => {
				bringDialogToFront(html);
				const root = html[0] ?? html;

				// Buttons rather than the radios the segmented strip is normally built around: the
				// pill has to repaint the instant it is clicked and there is no document write
				// behind it to re-render off (the choice lives and dies with this window), so the
				// fill hangs off a class we move ourselves.
				const readout = root.querySelector(".stonetop-roll-dice");
				const options = root.querySelectorAll(".stonetop-roll-mode-btn");
				options.forEach(btn => {
					btn.addEventListener("click", () => {
						options.forEach(other => {
							const on = other === btn;
							other.classList.toggle("is-active", on);
							other.setAttribute("aria-pressed", String(on));
						});
						if (readout) readout.textContent = diceReadout(btn.dataset.rollMode);
					});
				});

				const input = root.querySelector('[name="modifier"]');
				root.querySelectorAll(".stonetop-roll-modifier-step").forEach(btn => {
					btn.addEventListener("click", () => {
						input.value = String((Math.trunc(Number(input.value)) || 0) + Number(btn.dataset.step));
						input.focus();
					});
				});
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
