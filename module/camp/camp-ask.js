import { askWithButtons as askWithButtonsShared } from "../utils/ask-with-buttons.js";
import { escHtml } from "../utils/strings.js";
import { CAMP_STATE } from "./camp-rules.js";
import { breakCamp, campActors, campRecordOf, stateOfCamp } from "./camp-store.js";

/**
 * Ask a question whose buttons say what they do, and wait for the answer.
 *
 * Every question the camp asks has more in it than yes or no (which camp, which character, break
 * the camp up or keep it). The shared helper in utils/ask-with-buttons.js, wearing the camp's own
 * window class. Resolves to the pressed button's `value`, or null when the window is closed.
 */
export function askWithButtons(o) {
	return askWithButtonsShared({ ...o, classes: ["stonetop-camp-ask", ...(o.classes ?? [])] });
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
