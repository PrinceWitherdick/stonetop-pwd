// A chat card's once-only button: Bath of Healing Light, Go Back to the Shadow, the Invoke debility,
// Wielder's "Invoke now", Battle Joy's result. Each is latched on the MESSAGE, FIRST, so a second
// click, a re-render or another owner's client cannot do it twice, and each gives the card back when
// the work is backed out of or fails. The next render reads the flag, not the buttons, so a failure
// has to take the latch back as well as re-enable them.

import { SYSTEM_ID } from "../system-id.js";
import { canRewriteCard } from "./chat.js";
import { belongsToMessage } from "./picked-option-button.js";
import { speakerActor } from "./speaker-actor.js";

/**
 * Disable `buttons`, write `flag` = `value` on the message, then run `work(release)`. `work` answers
 * whether the card's action happened: falsy gives the card back (the flag unset, the buttons enabled
 * again). A throw gives it back too, and is rethrown. `release` is handed to `work` for an action that
 * happened but leaves the card usable again (a roll at nobody).
 *
 * A card ALREADY latched is refused: no write, no work, the buttons left disabled, `false`. The flag is
 * read again here, at the press, because many callers open a window first (a picker, a payment form) and
 * the card may have been settled by another client, or by this one in another window, while it was open.
 * `taken` says what counts as latched, for a flag that holds more than the latch (an Invoke bullet's
 * record) or one this user may take over (their own latch left by a reload); by default, any truthy value.
 * `onTaken(held)` runs on a refusal (to say why), and its answer is returned in place of `false`.
 *
 * @param {ChatMessage} message
 * @param {string} flag  the message flag's key under `scope` (a dotted path is fine)
 * @param {*} value
 * @param {Iterable<HTMLButtonElement>} buttons
 * @param {(release: () => Promise<void>) => Promise<boolean>} work
 * @param {{taken?: (held: *) => boolean, onTaken?: (held: *) => *, scope?: string}} [options]  `scope` defaults to the system's
 * @returns {Promise<boolean>}  whether the action happened (or onTaken's answer on a refusal)
 */
export async function withCardLatch(message, flag, value, buttons, work, { taken = held => !!held, onTaken = null, scope = SYSTEM_ID } = {}) {
	for (const b of buttons) b.disabled = true;
	const held = message?.getFlag?.(scope, flag);
	if (taken(held)) return onTaken ? onTaken(held) : false;
	let latched = false;
	const release = async () => {
		if (latched) await message.unsetFlag(scope, flag);
		latched = false;
		for (const b of buttons) b.disabled = false;
	};
	try {
		await message.setFlag(scope, flag, value);
		latched = true;
		if (await work(release)) return true;
		await release();
		return false;
	} catch (err) {
		await release().catch(e => console.error(`Stonetop | could not release the ${flag} latch`, e));
		throw err;
	}
}

/**
 * withCardLatch for work whose stamp is known only once it is done (a steading card's button, which
 * records what was rolled or which button was pressed). The card is latched with `true` FIRST, so a
 * client that could do the work but not write the card never does it twice; then `work()` runs and
 * answers `{stamp, notice, abort}`. `abort` gives the card back. A `stamp` other than `true` replaces
 * the provisional one; if that second write fails the card stays latched with `true` (the work is
 * done), and a reader of the flag has to cope with `true` anyway, for a render in between. A card
 * already latched runs nothing and answers null, as withCardLatch refuses it (`onTaken` is withCardLatch's).
 *
 * @param {ChatMessage} message
 * @param {string} flag
 * @param {Iterable<HTMLButtonElement>} buttons
 * @param {() => Promise<{stamp?: *, notice?: string, abort?: boolean}|void>} work
 * @param {{onTaken?: (held: *) => *}} [options]
 * @returns {Promise<{stamp: *, notice?: string}|null>}  what the work answered, or null when it aborted or was refused
 */
export async function withLateStampLatch(message, flag, buttons, work, { onTaken = null } = {}) {
	let done = null;
	await withCardLatch(message, flag, true, buttons, async () => {
		const { stamp = true, notice, abort = false } = await work() ?? {};
		if (abort) return false;
		done = { stamp, notice };
		if (stamp !== true) {
			await message.setFlag(SYSTEM_ID, flag, stamp)
				.catch(err => console.warn(`Stonetop | could not record the ${flag} stamp; the card stays latched`, err));
		}
		return true;
	}, { onTaken });
	return done;
}

/**
 * Wire a card's once-only buttons (stonetop.js renderChatMessageHTML): the `selector` buttons of THIS
 * message show as chosen once `flag` is set, are disabled for a client that cannot rewrite the card,
 * and otherwise run `act(actor, btn, buttons)` on click (which latches through withCardLatch). Safe
 * to call on every render: a button is wired once.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery} html
 * @param {{selector: string, flag: string, act: Function, what: string}} opts  `what` names it in the error log
 */
export function wireLatchedButtons(message, html, { selector, flag, act, what }) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(selector) ?? [])].filter(btn => belongsToMessage(btn, message));
	if (!buttons.length) return;
	const actor = speakerActor(message);
	const used = !!message?.getFlag?.(SYSTEM_ID, flag);
	const usable = !used && canRewriteCard(message, actor);
	for (const btn of buttons) {
		btn.classList.toggle("is-chosen", used);
		if (!usable) { btn.disabled = true; continue; }
		if (btn.dataset.latchWired === "1") continue;
		btn.dataset.latchWired = "1";
		btn.addEventListener("click", () => {
			act(actor, btn, buttons).catch(err => console.error(`Stonetop | ${what} failed`, err));
		});
	}
}
