import { themedDialogClasses } from "../utils/window-theme.js";
import { escHtml } from "../utils/strings.js";
import { CAMP_STATE } from "./camp-rules.js";
import { breakCamp, campActors, campRecordOf, stateOfCamp } from "./camp-store.js";

/**
 * Ask a question whose buttons say what they do, and wait for the answer.
 *
 * Every question the camp asks has more in it than yes or no (which camp, which character, break
 * the camp up or keep it), and a bare "Yes" under a paragraph says nothing about what it agrees
 * to. Resolves to the pressed button's `value`, or null when the window is closed without one.
 *
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.content  HTML, already escaped by the caller
 * @param {Array<{key: string, label: string, value: *, icon?: string}>} o.buttons  affirmative first
 * @param {string} [o.defaultKey]  the button Enter presses; the first unless the first destroys something
 */
export async function askWithButtons({ title, content, buttons, defaultKey = null }) {
	const chosen  = defaultKey ?? buttons[0]?.key;
	const pressed = await foundry.applications.api.DialogV2.wait({
		// `stonetop-ask` is the question-and-answers shape (stonetop.css): it caps the width a
		// DialogV2 would otherwise take from the viewport, and gives each answer a row of its own.
		classes: themedDialogClasses("stonetop-camp-ask", "stonetop-ask"),
		window:  { title },
		content,
		buttons: buttons.map(button => ({
			action:  button.key,
			// Plain text: DialogV2 sets it as the button's innerText, so escaping it here would print
			// a name like "Wren's" as "Wren&#x27;s".
			label:   button.label,
			default: button.key === chosen,
			...(button.icon ? { icon: `fas ${button.icon}` } : {}),
		})),
		// Closing the window answers with no button, rather than throwing.
		rejectClose: false,
	});
	return buttons.find(button => button.key === pressed)?.value ?? null;
}

/**
 * A host walking away from their own open camp takes it with them, so when other people are
 * sitting at it, say so first and let the host stay.
 *
 * Asked on both ways a character can be moved to another fire: a player joining from a camp's card,
 * and a GM bringing somebody over from the camp window. Either would otherwise break the other camp
 * up without a word to anybody sitting at it.
 *
 * @returns {Promise<boolean>} whether to go ahead; on yes, the camp being left is already broken up
 */
export async function confirmLeavingOwnCamp(actor, campId) {
	const record = campRecordOf(actor);
	if (!record || record.id === campId || record.host !== actor.id) return true;
	if (stateOfCamp({ campId: record.id, hostId: actor.id }) !== CAMP_STATE.OPEN) return true;
	const company = campActors(record.id).filter(a => a.id !== actor.id);
	if (!company.length) return true;
	const breakUp = await askWithButtons({
		title:   "Break up a camp?",
		content: `<p>${escHtml(actor.name)} opened a camp that ${company.length === 1 ? `${escHtml(company[0].name)} is` : `${company.length} others are`} sitting at. Joining this one breaks that camp up: nobody there eats, and nothing there is spent.</p>`,
		buttons: [
			{ key: "leave", icon: "fa-person-walking", label: "Break it up and join this camp", value: true },
			{ key: "stay", label: `Stay at ${actor.name}'s camp`, value: false },
		],
		defaultKey: "stay",
	});
	if (!breakUp) return false;
	await breakCamp(actor);
	return true;
}
