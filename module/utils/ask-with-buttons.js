import { themedDialogClasses } from "./window-theme.js";

/**
 * Ask a question whose buttons say what they do, and wait for the answer.
 *
 * The house rule for anything that writes: a bare "Yes" under a paragraph says nothing about what
 * it agrees to, so every answer is a verb phrase ("Remove the move" / "Keep it") and the window
 * reads from its footer up. Core's `Dialog.confirm` hard-wires Yes/No, which is why it is not used.
 *
 * Resolves to the pressed button's `value`, or null when the window is closed without one. A
 * `value` that is a FUNCTION is the answer read off the window's form when that button is pressed
 * (a tick box, a text field): it is handed the form, and what it returns is the answer.
 * DialogV2 is read at call time, so a test can put a fake in its place (tests/fakes/confirm.js).
 *
 * @param {object} o
 * @param {string} o.title
 * @param {string|HTMLElement} o.content  HTML already escaped by the caller, or an element (which
 *   core does not sanitize, so a form control's attributes survive)
 * @param {Array<{key: string, label: string, value: *, icon?: string, className?: string}>} o.buttons
 *   affirmative first; `className` is added to that button (the destructive skin, say)
 * @param {string} [o.defaultKey]  the button Enter presses; the first unless the first destroys something
 * @param {string[]} [o.classes]  extra window classes
 * @param {object} [o.position]  the window's position, for one that needs a width of its own
 */
export async function askWithButtons({ title, content, buttons, defaultKey = null, classes = [], position = null }) {
	const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
	if (!DialogV2) return null;
	const chosen  = defaultKey ?? buttons[0]?.key;
	const pressed = await DialogV2.wait({
		// `stonetop-ask` is the question-and-answers shape (stonetop.css): it caps the width a
		// DialogV2 would otherwise take from the viewport, and gives each answer a row of its own.
		classes: themedDialogClasses(...classes, "stonetop-ask"),
		window:  { title },
		...(position ? { position } : {}),
		content,
		buttons: buttons.map(button => ({
			action:  button.key,
			// Plain text: DialogV2 sets it as the button's innerText, so escaping it here would print
			// a name like "Wren's" as "Wren&#x27;s".
			label:   button.label,
			default: button.key === chosen,
			...(button.icon ? { icon: `fas ${button.icon}` } : {}),
			...(button.className ? { class: button.className } : {}),
			// Read on the press, while the form still exists, and wrapped so the answer cannot be
			// mistaken for a button's key.
			...(typeof button.value === "function"
				? { callback: (_event, pressedButton) => new FormAnswer(button.value(pressedButton?.form ?? null)) }
				: {}),
		})),
		// Closing the window answers with no button, rather than throwing.
		rejectClose: false,
	}).catch(err => {
		// So anything caught here is a real failure (a form reader that threw, say). It still
		// answers as a close, which leaves things as they were, but it is not kept quiet.
		console.error(`Stonetop | "${title}" could not be answered:`, err);
		return null;
	});
	if (pressed instanceof FormAnswer) return pressed.value ?? null;
	return buttons.find(button => button.key === pressed && typeof button.value !== "function")?.value ?? null;
}

/** What a form-reading button answered (see askWithButtons). */
class FormAnswer {
	constructor(value) { this.value = value; }
}

/**
 * The two-answer case: go ahead, or don't. True for `yes`, false for `no`, null when the window was
 * closed without either (a caller that needs to tell "no" from "never mind" can).
 *
 * `defaultYes` is off unless asked for: most of these guard something that cannot be undone, and
 * Enter should land on the answer that leaves things as they were.
 *
 * @param {object} o
 * @param {string} o.title
 * @param {string|HTMLElement} o.content  HTML already escaped by the caller, or an element (see askWithButtons)
 * @param {{label: string, icon?: string, className?: string}} o.yes  `className` is added to that
 *   button (the destructive skin, say)
 * @param {{label: string, icon?: string, className?: string}} o.no
 * @param {boolean} [o.defaultYes]
 * @param {string[]} [o.classes]
 * @returns {Promise<boolean|null>}
 */
export function confirmOutcome({ title, content, yes, no, defaultYes = false, classes = [] }) {
	return askWithButtons({
		title, content, classes,
		buttons: [
			{ key: "yes", label: yes.label, icon: yes.icon ?? "fa-check", className: yes.className, value: true },
			{ key: "no",  label: no.label,  icon: no.icon ?? "fa-xmark",  className: no.className,  value: false },
		],
		defaultKey: defaultYes ? "yes" : "no",
	});
}
