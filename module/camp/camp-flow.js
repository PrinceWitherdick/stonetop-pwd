import { SYSTEM_ID } from "../system-id.js";
import { stonetopChatCard } from "../utils/chat.js";
import { escHtml } from "../utils/strings.js";
import { CAMP_STATE } from "./camp-rules.js";
import { campCardClosedText, campJoinCardBody } from "./camp-view.js";
import {
	CAMP_CARD_FLAG, campActors, campRecordOf, canCamp, hostCamp, joinCamp, myCampCharacters,
	openCamps, playsCharacter, refreshCampCards, stateOfCamp,
} from "./camp-store.js";
import { askWithButtons, confirmLeavingOwnCamp } from "./camp-ask.js";
import { openCampWindow } from "./CampWindow.js";

/**
 * THE WAYS INTO A CAMP: the Make Camp move on a character's sheet, and the Join button on the card
 * a new camp posts to chat. Both end in the shared window (CampWindow.js); what they settle first
 * is who is sitting down, and at which fire.
 */

/**
 * Make Camp, from a character's sheet.
 *
 * Opens the camp they are already sitting at. Otherwise, when somebody else is already making
 * camp, asks whether to join them: a split party makes two camps, and the move cannot tell a
 * second fire from a mistake. Otherwise opens a new camp and tells the table about it.
 */
export async function openMakeCamp(actor) {
	if (!canCamp(actor)) {
		ui.notifications?.warn?.(`${actor?.name ?? "This character"} is dead, and cannot make camp.`);
		return null;
	}
	const seated = campRecordOf(actor);
	if (seated && stateOfCamp({ campId: seated.id, hostId: seated.host }) === CAMP_STATE.OPEN) {
		return openCampWindow(seated.id, seated.host);
	}
	if (!actor.isOwner) {
		ui.notifications?.warn?.(`Only ${actor.name}'s player or the GM can bring ${actor.name} to a camp.`);
		return null;
	}
	const others = openCamps().filter(camp => camp.hostId !== actor.id);
	const choice = others.length ? await chooseCamp(actor, others) : { host: true };
	if (!choice) return null;
	if (choice.host) {
		const camp = await hostCamp(actor);
		await postCampJoinCard(actor, camp);
		return openCampWindow(camp.campId, camp.hostId);
	}
	await joinCamp(actor, choice.camp);
	return openCampWindow(choice.camp.campId, choice.camp.hostId);
}

function chooseCamp(actor, camps) {
	const lead = camps.length === 1
		? `<strong>${escHtml(camps[0].hostName)}</strong> is already making camp.`
		: "Other camps are already being made.";
	return askWithButtons({
		title:   "Make Camp",
		content: `<p>${lead} Bring ${escHtml(actor.name)} to ${camps.length === 1 ? "that fire" : "one of them"}, or make a separate camp?</p>`,
		buttons: [
			...camps.map((camp, i) => ({
				key: `join${i}`, icon: "fa-campground", label: `Join ${camp.hostName}'s camp`, value: { camp },
			})),
			{ key: "host", icon: "fa-fire", label: "Make a separate camp", value: { host: true } },
		],
	});
}

function chooseCharacter(candidates) {
	return askWithButtons({
		title:   "Join the camp",
		content: "<p>Who is settling in at this fire?</p>",
		buttons: candidates.map((actor, i) => ({ key: `pc${i}`, icon: "fa-user", label: `Bring ${actor.name}`, value: actor })),
	});
}

/** Tell the table a camp has opened, with the button everyone else joins it by. */
export async function postCampJoinCard(host, { campId, hostId }) {
	if (!globalThis.ChatMessage?.create) return null;
	return ChatMessage.create({
		content: stonetopChatCard("Make Camp", campJoinCardBody(host.name), "stonetop-camp-join-card"),
		speaker: ChatMessage.getSpeaker({ actor: host }),
		flags:   { [SYSTEM_ID]: { [CAMP_CARD_FLAG]: { campId, hostId } } },
	});
}

/**
 * Wire a camp's join card (dispatched from stonetop.js renderChatMessageHTML).
 *
 * The card's stored content always carries a Join button, and this decides at render what the
 * button should be: gone, with a line saying how the camp ended, once the camp is over; "Open the
 * camp" for someone already sitting at it, or a GM with no character of their own; "Join" for
 * everyone else. The camp's state is read live off its host, so a card redrawn later tells the
 * truth, and camp-store.js#refreshCampCards redraws it the moment that changes.
 */
export function wireCampCard(message, html) {
	const camp = message?.getFlag?.(SYSTEM_ID, CAMP_CARD_FLAG);
	if (!camp?.campId) return;
	const root = html?.[0] ?? html;
	const slot = root?.querySelector?.("[data-camp-join]");
	if (!slot) return;
	const state = stateOfCamp(camp);
	if (state !== CAMP_STATE.OPEN) {
		slot.innerHTML = `<p class="stonetop-camp-card-closed">${escHtml(campCardClosedText(state, game.actors?.get(camp.hostId)?.name))}</p>`;
		return;
	}
	const button = slot.querySelector(".stonetop-camp-join");
	if (!button) return;
	const sitting = campActors(camp.campId).some(actor => playsCharacter(actor));
	if (sitting || (game.user?.isGM && !myCampCharacters().length)) {
		button.innerHTML = `<i class="fas fa-campground" aria-hidden="true"></i> Open the camp`;
	}
	button.addEventListener("click", async ev => {
		ev.preventDefault();
		button.disabled = true;
		try {
			await joinFromCard(camp);
		} catch (err) {
			console.error("Stonetop | Make Camp: could not join the camp from its card", err);
			ui.notifications?.error?.("Could not join that camp. Try again, or ask your GM to check your permissions.");
		} finally {
			button.disabled = false;
		}
	});
}

async function joinFromCard(camp) {
	if (stateOfCamp(camp) !== CAMP_STATE.OPEN) {
		ui.notifications?.info?.("That camp is already over.");
		refreshCampCards();
		return null;
	}
	const mine = myCampCharacters();
	const seatedIds = new Set(campActors(camp.campId).map(actor => actor.id));
	if (mine.some(actor => seatedIds.has(actor.id))) return openCampWindow(camp.campId, camp.hostId);
	if (!mine.length) {
		// A GM with no character of their own runs the camp from outside it.
		if (game.user?.isGM) return openCampWindow(camp.campId, camp.hostId);
		ui.notifications?.warn?.("You have no living character to bring to this camp.");
		return null;
	}
	const actor = mine.length === 1 ? mine[0] : await chooseCharacter(mine);
	if (!actor || !(await confirmLeavingOwnCamp(actor, camp.campId))) return null;
	await joinCamp(actor, camp);
	return openCampWindow(camp.campId, camp.hostId);
}
