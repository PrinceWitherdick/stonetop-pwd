// A TICKED OPTION THAT OWES SOMETHING, AND THE BUTTON IT GROWS.
//
// Two moves' worth of bullets work this way and there will be more. A Forage option that says "gain
// 1d4+1 uses of provisions" grows a die to throw for it; an option that says "suffer painful burns
// (2d4 damage, ignores armor)" grows a button that rolls onto the shared damage card. The bullet is
// the same shape either way: text somebody wrote in a move, a checkbox beside it, and a thing that
// is owed once the box is ticked.
//
// This was written out twice before it was written once, and the duplication had already leaked into
// the stylesheet, where the two button classes had to be `:is()`-grouped. The parts worth having in
// one place are the ones that are quietly easy to get wrong:
//
//   • OURS COME OUT BEFORE THE ROW IS READ. The button says "Roll 2d4 damage" and the readout says
//     "6 damage", and on a re-render both are lines the option reader would happily match. The
//     option's own words come first in the row and would win on word order alone -- but "would win"
//     is a coincidence to lean a damage roll on.
//   • THE LATCH IS ON THE MESSAGE, not on the element. Stamped as a flag keyed by the checkbox's
//     index, so every client shows the same result and two players cannot press it twice.
//   • THE CHANGE LISTENER IS BOUND ONCE PER ELEMENT. A message re-renders whenever its flag is
//     written and Foundry may patch the log in place, so an unguarded binding stacks up a listener
//     per render.
//   • THE BUTTON IS HIDDEN, NOT ABSENT, while its option is unticked -- so ticking a box shows it
//     without a re-render.
//
// What does NOT belong here is the rule about WHICH bullets qualify. That is read off each option's
// own printed words by the caller's own reader, so a move a world wrote gets the same treatment
// with nobody wiring it up by hand.

import { SYSTEM_ID } from "../system-id.js";
import { deletionEntry } from "./foundry-compat.js";
import { canUserWriteCard } from "./chat.js";
import { claimedCard, defineGmClaim } from "./gm-claim.js";

/**
 * Is this element part of the card being wired?
 *
 * The chat log holds every message at once and a render hook is handed the whole of it in some
 * paths, so an unfiltered `querySelectorAll` would wire another card's bullets onto this message.
 * An element with no `data-message-id` above it is taken as ours: that is the single-card render,
 * where the wrapper has not been stamped yet.
 */
export function belongsToMessage(el, message) {
	const owner = el.closest("[data-message-id]");
	return !owner || owner.dataset.messageId === message.id;
}

/** An option's own words: its label's text, not whatever a wire has hung on the row since. */
export function optionLabelText(item) {
	return (item.querySelector("label > span") ?? item.querySelector("label") ?? item).textContent ?? "";
}

/**
 * Wire every option on one card whose own words `matches` (optionLabelText): a one-line readout under
 * it, redrawn on every render, and a change listener on its checkbox, bound once per element. The
 * tick-to-act options (option-debility.js, censure-enraged.js) share this; a button that pays out
 * once is wirePickedOptionButton below.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root  The rendered card.
 * @param {object} spec
 * @param {(text: string) => boolean} spec.matches  Whether an option's words are one of these.
 * @param {string} spec.readoutClass  Class for the readout line.
 * @param {string} spec.wiredKey      `dataset` key marking a checkbox that is already bound.
 * @param {(box: HTMLInputElement) => string|null} spec.readout  The readout's words, or null for none.
 * @param {(box: HTMLInputElement) => any} spec.onChange
 */
export function wireOptionTicks(message, root, { matches, readoutClass, wiredKey, readout, onChange }) {
	const rows = [...root.querySelectorAll(".stonetop-picklist-item")]
		.filter(item => belongsToMessage(item, message) && matches(optionLabelText(item)));
	if (!rows.length) return;
	const doc = root.ownerDocument ?? globalThis.document;
	for (const item of rows) {
		const box = item.querySelector(".stonetop-picklist-check");
		if (!box) continue;
		// Ours out first: a re-render patches the same row.
		item.querySelectorAll(`.${readoutClass}`).forEach(el => el.remove());
		const words = readout(box);
		if (words != null) {
			const note = doc.createElement("p");
			note.className = readoutClass;
			note.textContent = words;
			item.appendChild(note);
		}
		// Bound once per element: a message re-renders whenever its flag is written.
		if (box.dataset[wiredKey] === "1") continue;
		box.dataset[wiredKey] = "1";
		box.addEventListener("change", () => onChange(box));
	}
}

/**
 * Wire every ticked-option button on one chat card.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html  The rendered card.
 * @param {object} spec
 * @param {string} spec.flagKey       Message flag holding what has already been paid out, by index.
 * @param {string} spec.wiredKey      `dataset` key marking a row whose checkbox is already bound.
 * @param {string} spec.buttonClass   Class for the button this adds.
 * @param {string} spec.readoutClass  Class for the static readout that replaces it.
 * @param {(text: string) => object|null} spec.read
 *        What this option owes, read off its own words. Null for a bullet that owes nothing.
 * @param {(pick: object) => string} spec.icon    Font Awesome classes for the button's glyph.
 * @param {(pick: object) => string} spec.label   The button's words. It NAMES ITS OUTCOME.
 * @param {(paid: object) => HTMLElement} spec.readout  The static readout, from the stamped record.
 * @param {(btn: HTMLElement, index: string, pick: object) => any} spec.onPress
 * @param {boolean} [spec.usable]  Whether this viewer may press it at all (a payout stamped on the card
 *        wants someone who can rewrite the card). False draws no button; a paid readout still shows.
 */
export function wirePickedOptionButton(message, html, spec) {
	const { flagKey, wiredKey, buttonClass, readoutClass, read, icon, label, readout, onPress, usable = true } = spec;

	const items = [...html.querySelectorAll(".stonetop-picklist-item")]
		.filter(item => belongsToMessage(item, message));
	if (!items.length) return;

	const done = message.getFlag(SYSTEM_ID, flagKey) ?? {};

	for (const item of items) {
		const box = item.querySelector(".stonetop-picklist-check");
		// Ours out first, then read; see the head of this file.
		item.querySelectorAll(`.${buttonClass}, .${readoutClass}`).forEach(el => el.remove());
		const pick = read(item.textContent);
		if (!box || !pick) continue;
		const index = box.dataset.index;

		// Already paid out: the card carries the result, not a second chance at it.
		const paid = pickedOptionRecord(message, flagKey, index, done);
		if (paid) {
			item.appendChild(readout(paid));
			continue;
		}
		if (!usable) continue;

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = buttonClass;
		const glyph = document.createElement("i");
		glyph.className = icon(pick);
		btn.append(glyph, label(pick));
		btn.hidden = !box.checked;
		item.appendChild(btn);

		if (item.dataset[wiredKey] !== "1") {
			item.dataset[wiredKey] = "1";
			box.addEventListener("change", () => {
				const live = item.querySelector(`.${buttonClass}`);
				if (live) live.hidden = !box.checked;
			});
		}

		btn.addEventListener("click", () => onPress(btn, index, pick));
	}
}

// ── The latch, written in the right order ─────────────────────────────────────
// CLAIM, PAY, SETTLE. The latch used to be stamped AFTER the payout landed, so a press that could
// pay but not stamp (a player who owns the character but not the card: the GM rolled it for them,
// and a chat message is "the GM, or whoever authored it") paid out, failed to stamp, and on the
// next render offered the same button again. Claiming first means a client that cannot write the
// card pays nothing, and a second press finds the claim. A payout that then fails RELEASES the
// claim, so the retry the old order protected is still there.

// A claim names its user (`{pending, by}`). The claims this client holds are kept here, from the claim
// until it is settled or released, so one of this user's own that is NOT held here was left by a reload
// (the damage window or the pouch question open) and is theirs to press again. A claim whose payout
// landed but whose settle write failed stays held here, so this client never offers it twice.
const _held = new Set();
const heldKey = (message, flagKey, index) => `${message?.id}:${flagKey}:${index}`;
const currentUserId = () => globalThis.game?.user?.id ?? "";

/**
 * What option `index` stands at on the card: its stamped record, or null when it may be pressed (never
 * claimed, or claimed by this user on a client since reloaded).
 *
 * @param {ChatMessage} message
 * @param {string} flagKey
 * @param {string} index
 * @param {object} [done]  the flag, when already read
 * @returns {object|null}
 */
export function pickedOptionRecord(message, flagKey, index, done = message?.getFlag?.(SYSTEM_ID, flagKey) ?? {}) {
	const record = done?.[index];
	if (!record) return null;
	const stale = record.pending && record.by && record.by === currentUserId() && !_held.has(heldKey(message, flagKey, index));
	return stale ? null : record;
}

/** The User query a player's client sends the GM's to claim an option's payout (gm-claim.js). */
export const PICKED_OPTION_CLAIM_QUERY = "stonetop.pickedOptionClaim";

/**
 * An option's payout, claimed on the GM's client (gm-claim.js). Two clients that read "unclaimed" at once used
 * to both write a claim and both pay (audit ROAD-15); here the GM's client reads the card and writes the claim
 * in one turn, so the second asker finds the first one's claim. The GM writes it only for a user who could
 * write the card themselves, which is what a claim written by the asker always required. A claim this user
 * left behind by a reload is theirs to take again: their own client has already said it is not one it holds.
 */
const pickedOptionClaim = defineGmClaim({
	query:   PICKED_OPTION_CLAIM_QUERY,
	what:    "claim a card's payout",
	subject: claimedCard,
	key:     message => message.uuid ?? message.id,
	may:     (message, asker, data) => typeof data?.flagKey === "string" && typeof data?.index === "string"
		&& canUserWriteCard(message, asker, { whenUnknown: false }),
	async grant(message, { flagKey, index }, asker) {
		const record = message.getFlag(SYSTEM_ID, flagKey)?.[index];
		if (record && !(record.pending && record.by === asker.id)) return false;
		try {
			await message.setFlag(SYSTEM_ID, flagKey, { [index]: { pending: true, by: asker.id } });
			return true;
		} catch (err) {
			console.warn("Stonetop | Could not claim a card's payout:", err);
			return false;
		}
	},
});

/** Register the GM's side of claimPickedOption (stonetop.js, at init). */
export function registerPickedOptionClaimQuery(queries = globalThis.CONFIG?.queries) {
	pickedOptionClaim.register(queries);
}

/**
 * Claim option `index` before paying it out. False, having written nothing, when it is already
 * claimed or paid, or when this client may not write the card.
 *
 * The active GM's client decides (pickedOptionClaim), at once and in the order the claims reach it. With no
 * GM connected, or none answering, this client writes its own claim and settles a crossing one by waiting
 * `settleMs` (see below); that wait still lets two clients both pay over a round trip longer than it.
 *
 * @param {ChatMessage} message
 * @param {string} flagKey
 * @param {string} index
 * @param {{settleMs?: number, game?: object, ask?: Function}} [options]  `game` and `ask` for the tests
 * @returns {Promise<boolean>}
 */
export async function claimPickedOption(message, flagKey, index, { settleMs = CLAIM_SETTLE_MS, game, ask } = {}) {
	const done = message.getFlag(SYSTEM_ID, flagKey) ?? {};
	if (pickedOptionRecord(message, flagKey, index, done)) return false;
	const key = heldKey(message, flagKey, index);
	// A second press on this client while its first claim is still out: the first one decides.
	if (_held.has(key)) return false;
	_held.add(key);
	const decided = await pickedOptionClaim.ask({ messageUuid: message.uuid, flagKey, index: String(index) }, { game, ask, local: message })
		.catch(err => { console.warn("Stonetop | Could not ask the GM's client for a card's payout:", err); return null; });
	if (decided === true) return true;
	if (decided === false) {
		_held.delete(key);
		return false;
	}
	return claimHere(message, flagKey, index, key, done, settleMs);
}

/** claimPickedOption with nobody to decide: this client writes its own claim, then waits out a crossing one. */
async function claimHere(message, flagKey, index, key, done, settleMs) {
	try {
		await message.setFlag(SYSTEM_ID, flagKey, { ...done, [index]: { pending: true, by: currentUserId() } });
	} catch (err) {
		_held.delete(key);
		console.warn("Stonetop | Could not claim a card's payout:", err);
		return false;
	}
	// Two clients that read "unclaimed" at once both write a claim. The server applies them in order and
	// broadcasts each, so the LAST one stands: wait a moment for a crossing claim to arrive, then pay only while
	// the claim on the card is still this user's. The other stands down, paying nothing, and its card already
	// shows the winner's "Being taken…".
	if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs));
	const standing = message.getFlag(SYSTEM_ID, flagKey)?.[index];
	if (standing && standing.by !== currentUserId()) {
		_held.delete(key);
		return false;
	}
	return true;
}

/**
 * How long a claim made with no GM to decide it waits for a crossing claim from another client before it pays
 * (claimPickedOption): about one round trip to the server and back.
 */
export const CLAIM_SETTLE_MS = 300;

/** Stamp what a claimed option paid (`record`, which the readout reads), ending the claim. */
export async function settlePickedOption(message, flagKey, index, record) {
	// Merged over the claim, so `pending` is written false rather than left behind.
	await message.setFlag(SYSTEM_ID, flagKey, { [index]: { ...record, pending: false } });
	_held.delete(heldKey(message, flagKey, index));
}

/** Take a claim back when nothing was paid, so the option can be pressed again. */
export async function releasePickedOption(message, flagKey, index) {
	// Let go here first: nothing was paid, so even a release that fails to write leaves it pressable.
	_held.delete(heldKey(message, flagKey, index));
	const [path, value] = deletionEntry(`flags.${SYSTEM_ID}.${flagKey}.${index}`);
	await message.update({ [path]: value });
}
