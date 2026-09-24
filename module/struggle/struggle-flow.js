import { contentElement } from "../dialogs/content-picker.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { SYSTEM_ID } from "../system-id.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { STRUGGLE_ASK_FLAG, STRUGGLE_FLAG, STRUGGLE_ROLL_FLAG, isLive } from "./struggle-rules.js";
import { askDeclinedNotice, struggleCallView } from "./struggle-view.js";
import {
	askForStruggle, askOf, askTurnedDown, boardFor, currentStruggle, isStruggleHost, liveStruggle, owesARoll, pendingAsks,
	struggleStateChanged, takesPart, touchesFlag,
} from "./struggle-store.js";
import { openStruggleWindow, registerStruggleWindowRestore } from "./StruggleWindow.js";
import { openStruggleSetup } from "./StruggleSetupDialog.js";

/**
 * THE WAYS INTO A STRUGGLE AS ONE, and what every client does when one moves on.
 *
 * Anyone can start one; the GM confirms it (the user's rule, 2026-09-23, and the book's: the GM
 * calls for it and clarifies the danger, p.328). So the move on a sheet does one of three things:
 *  - a struggle is already under way: open it;
 *  - a GM clicked it: open the setup;
 *  - a player clicked it: say what the danger is and ask the GM, whose screen opens the setup with
 *    it filled in.
 */

/**
 * The GM's way in, from any GM screen: open the struggle under way, or set up a new one. `journey`
 * pre-ticks "part of a journey" for a struggle called from the journey itself, which is when Home
 * on the Range and Trailblazer apply ("when a journey requires/causes you to...").
 */
export function callStruggleAsOne({ journey = false } = {}) {
	if (!game.user?.isGM) return null;
	const live = liveStruggle();
	return live ? openStruggleWindow(live.id) : openStruggleSetup({ journey, onClosed: answerNextAsk });
}

/** What a GM screen's button onto the move says right now (struggle-view.js#struggleCallView). */
export function gmStruggleCall() {
	const live = liveStruggle();
	return struggleCallView(live, live ? boardFor(live) : null);
}

/**
 * Rewrite every GM button onto the move in place, wherever it is drawn: the toolkit's Expeditions
 * tab, the walkthrough's journey step. Neither screen redraws when a player rolls, and the
 * walkthrough does not redraw when a struggle is called or ended either, so without this the button
 * went on saying "Call for" over a struggle already under way, and its count never moved. In place
 * rather than by a render: the walkthrough's render rebuilds a route map to change two words.
 */
export function refreshStruggleBars(doc = globalThis.document) {
	if (!game.user?.isGM || !doc?.querySelectorAll) return;
	const bars = doc.querySelectorAll(".stonetop-gm-struggle-bar");
	if (!bars.length) return;
	const view = gmStruggleCall();
	for (const bar of bars) {
		const label = bar.querySelector("[data-struggle-call-label]");
		const hint = bar.querySelector("[data-struggle-call-hint]");
		if (label) label.textContent = view.label;
		if (hint) hint.textContent = view.hint;
	}
}

/** The move, from a character's sheet. */
export async function openStruggleAsOne(actor) {
	if (game.user?.isGM) return callStruggleAsOne();
	const live = liveStruggle();
	if (live) {
		if (takesPart(live)) return openStruggleWindow(live.id);
		ui.notifications?.info?.("A Struggle as One is already under way, and none of your characters is in it.");
		return null;
	}
	if (!actor?.isOwner) {
		ui.notifications?.warn?.(`Only ${actor?.name ?? "this character"}'s player can ask for a Struggle as One for them.`);
		return null;
	}
	if (askOf(actor)) {
		ui.notifications?.info?.("You've already asked. The GM's setting it up.");
		return null;
	}
	const answer = await askTheGmDialog(actor);
	if (!answer) return null;
	const result = await askForStruggle(actor, answer);
	if (!result.ok) {
		ui.notifications?.warn?.("There's no GM connected to call a Struggle as One.");
		return null;
	}
	ui.notifications?.info?.("You've asked the GM to call a Struggle as One.");
	return null;
}

/** The player's half of asking: the danger and the approach as they see it, both optional. */
async function askTheGmDialog(actor) {
	const content = contentElement(`
		<div class="stonetop stonetop-struggle-ask">
			<p>The GM calls the struggle and says who rolls what. Tell them what you're up against, if you like.</p>
			<label class="stonetop-struggle-field"><span>The danger</span>
				<textarea name="danger" rows="2" placeholder="Getting stuck in the mire before nightfall."></textarea>
			</label>
			<label class="stonetop-struggle-field"><span>How the party goes about it</span>
				<textarea name="approach" rows="2" placeholder="We rope together and take turns breaking trail."></textarea>
			</label>
		</div>`);
	const read = form => ({
		danger: String(form?.elements?.namedItem("danger")?.value ?? "").trim(),
		approach: String(form?.elements?.namedItem("approach")?.value ?? "").trim(),
	});
	return askWithButtons({
		title: `Struggle as One: ${actor.name}`,
		position: { width: 460 },
		content,
		buttons: [
			{ key: "ask", label: "Ask the GM to call it", icon: "fa-people-group", value: read },
			{ key: "cancel", label: "Cancel", value: null },
		],
	});
}

/** A player's ask, on the one GM client that answers them. */
function answerAsk(actor) {
	const ask = askOf(actor);
	if (!ask || !isPrimaryGM() || !game.user?.isGM) return;
	openStruggleSetup({ ask, askActor: actor, only: null, onClosed: answerNextAsk });
}

/**
 * The oldest ask still waiting, once nothing is in the way of it: a setup closing, a struggle ending,
 * a reload. One behind another, each answered in turn. Not while a struggle is under way, which is the
 * setup's own refusal ("already under way") and would only open a setup that cannot call anything.
 */
export function answerNextAsk() {
	if (!game.user?.isGM || !isPrimaryGM() || liveStruggle()) return;
	const first = pendingAsks()[0];
	if (first) answerAsk(first.actor);
}

/**
 * Every client, window or not: open the window when the GM calls a struggle or shares its results,
 * on each client in it; answer a player's ask on the GM's; and tell a player when the GM passed.
 */
export function onUpdateActorStruggle(actor, changes) {
	// Everything below answers one of the system's struggle flags.
	if (!changes?.flags?.[SYSTEM_ID]) return;
	if (isStruggleHost(actor)) {
		if (!touchesFlag(changes, STRUGGLE_FLAG)) return;
		refreshStruggleBars();
		if (!struggleStateChanged(changes)) return;
		const struggle = currentStruggle();
		// Called, or shared: both are the moment everyone in it needs the window in front of them. An
		// ended struggle is redrawn by the windows already open, and pops nothing.
		if (isLive(struggle) && takesPart(struggle)) {
			openStruggleWindow(struggle.id);
		}
		// Ended or called off: an ask that waited behind it gets its turn.
		if (!isLive(struggle)) answerNextAsk();
		return;
	}
	if (actor?.type !== "character") return;
	// A roll landing moves the GM buttons' "N of M have rolled".
	if (touchesFlag(changes, STRUGGLE_ROLL_FLAG)) refreshStruggleBars();
	if (!touchesFlag(changes, STRUGGLE_ASK_FLAG)) return;
	if (askTurnedDown(actor, changes)) ui.notifications?.info?.(askDeclinedNotice(actor.name));
	answerAsk(actor);
}

/**
 * After a reload: the window comes back through window-restore when it was open, but a client that
 * still owes a roll gets it regardless; and asks made while no GM was looking are answered now.
 */
function onReady() {
	const live = liveStruggle();
	if (live && owesARoll(live)) openStruggleWindow(live.id);
	answerNextAsk();
}

/** Registered once, at module scope in stonetop.js. */
export function registerStruggleHooks() {
	Hooks.on("updateActor", onUpdateActorStruggle);
	Hooks.once("ready", onReady);
	registerStruggleWindowRestore();
}

