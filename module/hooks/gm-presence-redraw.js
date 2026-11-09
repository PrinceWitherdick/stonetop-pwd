// CARDS REDRAWN WHEN A GM COMES OR GOES.
//
// A chat card decides at render who may press what, off who is connected: the damage card's Apply and its
// Readiness spends route through the primary GM's client when one is online (combat/attack-flow.js's gate,
// fight/defend-spend.js#spendWriter), the suffer card's "Which attack?" is the primary GM's, a roll card's
// rewrites go to the GM (utils/roll-card-writer.js#rollCardRoute). Core draws a card once and redraws it only
// when the message changes, so a card drawn before a GM joined (or while another GM was primary) keeps the
// answer it was drawn with: the GM who is primary now finds Apply disabled ("Another GM will apply this
// damage"), and a player's card drawn with no GM online keeps writing directly beside the GM's relayed writes,
// the two-writer race the relay exists to close (round 1 MOV-7; audit EDG-14, 2026-11-06).
//
// So when a GM's presence changes, every client redraws the system's latest cards. Only cards already in the
// log (`message.logged`): ChatLog#updateMessage POSTS a card it never drew, out of order. A short settle folds
// a burst of connections (a GM reloading) into one pass.

import { SYSTEM_ID } from "../system-id.js";

/** How many of the latest messages are redrawn: the cards still in play sit at the foot of the log. */
export const REDRAW_DEPTH = 30;

/** How long a burst of connections settles before the pass (ms). */
export const REDRAW_SETTLE_MS = 300;

/** Whether a message is one of this system's cards: its flags, or the card markup the chat helpers write. PURE. */
export function isSystemCard(message) {
	if (!message) return false;
	if (message.flags?.[SYSTEM_ID] && Object.keys(message.flags[SYSTEM_ID]).length) return true;
	const markup = `${message.content ?? ""}${message.flavor ?? ""}`;
	return markup.includes("stonetop");
}

/** The latest `depth` messages this client has drawn that are this system's cards, oldest first. PURE. */
export function cardsToRedraw(messages, { depth = REDRAW_DEPTH } = {}) {
	const list = Array.from(messages?.contents ?? messages ?? []);
	return list.slice(-depth).filter(m => m?.logged && isSystemCard(m));
}

/**
 * Listen for a GM connecting or leaving, and redraw. Registered once, from stonetop.js.
 *
 * @param {{hooks?: object, messages?: () => object, chat?: () => object, settle?: number,
 *   timers?: {set: Function, clear: Function}}} [deps]
 * @returns {() => void} stops listening
 */
export function installGmPresenceRedraw({
	hooks = globalThis.Hooks,
	messages = () => globalThis.game?.messages,
	chat = () => globalThis.ui?.chat,
	settle = REDRAW_SETTLE_MS,
	timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
} = {}) {
	let pending = null;
	const redraw = async () => {
		pending = null;
		const log = chat();
		if (typeof log?.updateMessage !== "function") return;
		// All at once: each redraw replaces its own card in place, so none waits on another.
		await Promise.all(cardsToRedraw(messages()).map(async message => {
			try {
				await log.updateMessage(message);
			} catch (err) {
				console.warn("Stonetop | could not redraw a card after a GM came or went", err);
			}
		}));
	};
	const id = hooks.on("userConnected", user => {
		if (!user?.isGM) return;
		if (pending != null) timers.clear(pending);
		pending = timers.set(() => { redraw(); }, settle);
	});
	return () => {
		hooks.off("userConnected", id);
		if (pending != null) timers.clear(pending);
		pending = null;
	};
}
