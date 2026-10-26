// ── A GM relay that ran out of time ─────────────────────────────────────────
// A player's press on a card the GM's client writes goes there as a User query. When no answer comes back in
// time, the GM's client has usually not said no: its write is queued behind other writes to the same card
// (card-queue.js), and it lands a moment later. Read once at the timeout, that write is missed, the button comes
// back, and a second press pays twice. So a press with no answer watches the card for a while longer.

/** What a relay answers when no answer came back (askGMClient's `fallback`), told apart from a no. */
export const NO_ANSWER = Symbol("stonetop.noAnswer");

/** How long a press with no answer waits for the GM's write to show on the card (ms). */
export const RELAY_GRACE_MS = 8000;

/**
 * What a relay's `answer` comes to, the one place every relayed press settles it: no answer (NO_ANSWER) is
 * watched against the card (relayLanded); a refusal is read against the card once more, since the GM's write may
 * have landed and the answer failed after it; anything else is the answer.
 *
 * @param {ChatMessage|null} message
 * @param {*} answer  what the relay answered
 * @param {() => *} landed  reads the card for the press's mark
 * @param {object} [options]  relayLanded's
 * @returns {Promise<*>}  the answer, or whether the press's mark is on the card
 */
export async function relayOutcome(message, answer, landed, options) {
	if (answer === NO_ANSWER) return relayLanded(message, landed, options);
	if (answer) return answer;
	try {
		return landed() ? true : answer;
	} catch {
		return answer;
	}
}

/**
 * Whether the GM's write landed on `message`: `landed()` is read now, then again on every update to that card,
 * until it is true or `grace` ms have passed. No card (one this client cannot read) answers false at once.
 *
 * @param {ChatMessage|null} message
 * @param {() => boolean} landed  reads the card for the press's mark (a count grown, a press id, a stamp)
 * @param {{grace?: number, hooks?: {on: Function, off: Function}}} [options]
 * @returns {Promise<boolean>}
 */
export function relayLanded(message, landed, { grace = RELAY_GRACE_MS, hooks = globalThis.Hooks } = {}) {
	const read = () => {
		try {
			return !!landed();
		} catch {
			return false;
		}
	};
	if (!message) return Promise.resolve(false);
	if (read()) return Promise.resolve(true);
	if (!(grace > 0)) return Promise.resolve(false);
	return new Promise(resolve => {
		let hookId = null;
		let timer = null;
		let settled = false;
		const done = value => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (hookId != null) hooks?.off?.("updateChatMessage", hookId);
			resolve(value);
		};
		hookId = hooks?.on?.("updateChatMessage", doc => {
			if (doc?.id === message.id && read()) done(true);
		}) ?? null;
		timer = setTimeout(() => done(read()), grace);
	});
}
