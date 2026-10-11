import { SYSTEM_ID } from "../system-id.js";
import { adjustXp } from "./xp.js";
import { speakerActor } from "./speaker-actor.js";
import { canRewriteCard } from "./chat.js";
import { cardCountedTier } from "./counted-tier.js";
import { inCardTurn } from "./card-queue.js";
import { pressRollCard, registerRollCardAction } from "./roll-card-writer.js";

// Taking back the XP a miss just marked.
//
// The receipt a miss posts ("+1 XP (16 / 8)") carries an Undo, because the commonest way to mark
// XP wrongly is to roll the wrong move, or to roll it for the wrong character. Before this the
// only remedy was to type the total back into the sheet by hand, which is a second chance to get
// it wrong and leaves the ledger reading as though the XP was earned and then quietly edited
// away rather than never earned at all.
//
// IT TAKES BACK A DELTA, NOT A REMEMBERED TOTAL. Undoing a mark from ten minutes ago must not
// wipe out what has happened since, and `-1` composes with everything in between where restoring
// a snapshot would overwrite it. The write goes through the same per-character queue as every
// other XP change (utils/xp.js), so an undo racing a fresh mark cannot lose either of them.
//
// ONCE, AND ONCE IS ENFORCED ON THE MESSAGE. Disabling the button only stops a second click on
// this screen: the card re-renders on every other client, and again after every reload, and each
// of those would hand back a fresh enabled button. The flag is what makes it stay undone.

/** The message flag stamped at creation, holding how much this card marked. */
export const XP_MARK_FLAG = "xpMark";
/** The latch. Its presence means this card's XP has already been handed back. */
export const XP_UNDONE_FLAG = "xpMarkUndone";
/** On a miss's receipt: the id of the roll card whose miss it marked (roll-engine.js#reconcileMissXp). */
export const XP_MARK_FOR_FLAG = "xpMarkFor";
/** On a roll card: its miss earns XP (a character's roll, and the move does not say otherwise). */
export const MISS_XP_FLAG = "missXp";
/**
 * On a roll card: where its miss XP stands, kept on the CARD so that a deleted receipt, or one its
 * player undid by hand, is still known there. "marked" while the miss's XP is held, "waived" once the
 * player took it back with the receipt's Undo (a later rewrite never marks it again), "none" once a
 * rewrite lifted it off the miss. Absent on a card rolled before this was kept.
 */
export const MISS_XP_STATE_FLAG = "missXpState";
/** On a roll card: whose XP a button marked for its miss (a steading roll's "Mark XP"), so the XP follows the card. */
export const MISS_XP_ACTOR_FLAG = "missXpActor";
/** On a roll card: its miss XP is marked by a button and never on its own (Never at a Loss, a steading roll). */
export const MISS_XP_BY_CHOICE_FLAG = "missXpByChoice";
/**
 * On a roll card: the choice a button row gave its miss XP ("mark" or "decline"), the row's latch (Never
 * at a Loss). Taken off with the XP when a rewrite lifts the card off the miss, so the row asks again.
 */
export const MISS_XP_CHOICE_FLAG = "missXpChoice";
/** The same latch under its old, Know Things-only name, on cards rolled before MISS_XP_CHOICE_FLAG. Read only. */
export const KNOW_THINGS_XP_FLAG = "knowThingsXp";

/**
 * Every latch a button's miss mark puts on a card, taken off together once a rewrite lifts it off the miss
 * (roll-engine.js#reconcileMissXp). The old Know Things latch is among them, so an old card asks again too.
 */
export const MISS_XP_CHOICE_LATCHES = Object.freeze([
	MISS_XP_FLAG, MISS_XP_BY_CHOICE_FLAG, MISS_XP_ACTOR_FLAG, MISS_XP_STATE_FLAG, MISS_XP_CHOICE_FLAG, KNOW_THINGS_XP_FLAG,
]);

/** The choice `card`'s button row gave its miss XP ("mark", "decline"), or null; an old card's is read too. */
export function missXpChoice(card) {
	return card?.getFlag?.(SYSTEM_ID, MISS_XP_CHOICE_FLAG) ?? card?.getFlag?.(SYSTEM_ID, KNOW_THINGS_XP_FLAG) ?? null;
}

/** Whether `card`'s miss XP is marked by a button and never on its own (see MISS_XP_BY_CHOICE_FLAG). */
export function missXpIsByChoice(card) {
	return !!card?.getFlag?.(SYSTEM_ID, MISS_XP_BY_CHOICE_FLAG) || missXpChoice(card) === "mark";
}
/** What one miss marks. */
export const XP_PER_MISS = 1;

/**
 * Every receipt marked for `card`'s miss, undone or not, read off the whole chat log. A reader asking
 * several of the questions below of one card reads it once and hands the list to each (`receipts`), as
 * roll-engine.js#reconcileMissXp does.
 */
export const missReceipts = card => (globalThis.game?.messages?.contents ?? [])
	.filter(m => m.getFlag?.(SYSTEM_ID, XP_MARK_FOR_FLAG) === card.id);

/** The receipt still standing for `card`'s miss: marked for it and not undone. Null when none. */
export function liveMissReceipt(card, receipts = null) {
	if (!card?.id) return null;
	return (receipts ?? missReceipts(card)).findLast(m => !m.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)) ?? null;
}

/**
 * Whether `card`'s miss XP is held right now. A live receipt says so; failing one, the card's own
 * record does, because a receipt can be deleted from the log while its XP stays marked. A card
 * recording "marked" whose receipt is still there but undone was undone by hand (a rewrite's take-back
 * moves the card off "marked" in the same turn), which is a waiver, not a mark.
 */
export function missXpMarked(card, receipts = null) {
	if (!card?.getFlag) return false;
	const state = card.getFlag(SYSTEM_ID, MISS_XP_STATE_FLAG) ?? null;
	if (state === "waived") return false;
	receipts ??= missReceipts(card);
	if (liveMissReceipt(card, receipts)) return true;
	return state === "marked" && receipts.length === 0;
}

/** Whether `card`'s player has given up its miss XP by hand, so no rewrite may mark it again. */
export function missXpWaived(card, receipts = null) {
	const state = card?.getFlag?.(SYSTEM_ID, MISS_XP_STATE_FLAG) ?? null;
	if (state === "waived") return true;
	if (state !== "marked") return false;
	receipts ??= missReceipts(card);
	return !liveMissReceipt(card, receipts) && receipts.length > 0;
}

/**
 * The XP a rewrite of `card` to `newTotal` would take back from its own miss: what Burn Brightly may
 * not count as spendable, since the +1 it buys is what erases it. Zero when the card has no miss XP
 * held, or the new total is still a miss. The card's own flags are asked first: whether the XP is held
 * reads the chat log (missXpMarked), and this runs on every render of a roll card (stonetop.js).
 */
export function missXpTakenByLift(card, newTotal) {
	if (!card?.getFlag?.(SYSTEM_ID, MISS_XP_FLAG)) return 0;
	if (cardCountedTier(card, newTotal, SYSTEM_ID) === "failure") return 0;
	return missXpMarked(card) ? XP_PER_MISS : 0;
}

/**
 * Hand back what a receipt marked, once: latch the card, then take the XP back through the queue.
 * The one write behind the receipt's Undo and behind a rewritten roll that is no longer a miss.
 *
 * Latched BEFORE the write. A failure after the latch releases it, so the card never reads
 * "undone" with the XP still marked; doing it the other way round means a crash between the two
 * hands the same XP back twice.
 *
 * @returns {Promise<{applied: boolean, after: number, max: number}|null>} null when there was
 *          nothing to take back (already undone, or the card marked nothing)
 */
export async function takeBackXpMark(message, actor, { move = "Undo XP" } = {}) {
	const marked = Number(message?.getFlag?.(SYSTEM_ID, XP_MARK_FLAG) ?? 0);
	if (!marked || message.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)) return null;
	await message.setFlag(SYSTEM_ID, XP_UNDONE_FLAG, true);
	try {
		return await adjustXp(actor, -marked, { move });
	} catch (err) {
		await message.unsetFlag(SYSTEM_ID, XP_UNDONE_FLAG)
			.catch(e => console.error("Stonetop | Could not release the XP undo latch:", e));
		throw err;
	}
}

/** The roll card action that undoes a miss's receipt by hand on the card's writer (see undoXpReceipt). */
export const UNDO_MISS_XP_ACTION = "undoMissXp";

async function waiveMissXp(card) {
	try { await card.setFlag(SYSTEM_ID, MISS_XP_STATE_FLAG, "waived"); }
	catch (err) { console.warn("Stonetop | Could not record a waived miss XP on its roll card:", err); }
}

/**
 * Undo an XP receipt by hand (its Undo button).
 *
 * A MISS's receipt is undone on its ROLL CARD's writer, in the card's turn, because that is where every
 * rewrite of the card marks or takes back the same XP (roll-engine.js#reconcileMissXp). Undone here
 * instead, a press racing a rewrite that lifts the card off the miss passes the same unset latch on two
 * clients, and the XP is taken back twice. The card is stamped "waived" in that same turn, so no later
 * rewrite that leaves it on a miss marks the XP again.
 *
 * Any other receipt (an agreed Persuade, In Over Your Head), or a miss's whose card is gone or whose
 * writer did not answer, is undone on this client.
 *
 * @returns {Promise<{applied: boolean, after: number, max: number}|null>} as takeBackXpMark
 */
export async function undoXpReceipt(message, actor, { messages = globalThis.game?.messages } = {}) {
	const forCard = message?.getFlag?.(SYSTEM_ID, XP_MARK_FOR_FLAG);
	const card = forCard ? messages?.get?.(forCard) ?? null : null;
	if (card) {
		const relayed = await pressRollCard(card, UNDO_MISS_XP_ACTION, { receiptId: message.id });
		if (relayed) return relayed.already ? null : relayed;
	}
	const out = await takeBackXpMark(message, actor);
	if (out && card) await waiveMissXp(card);
	return out;
}

registerRollCardAction(UNDO_MISS_XP_ACTION, ({ message: card, user, data }) => {
	const receipt = globalThis.game?.messages?.get?.(data?.receiptId) ?? null;
	if (!receipt || receipt.getFlag?.(SYSTEM_ID, XP_MARK_FOR_FLAG) !== card?.id) return null;
	const actor = speakerActor(receipt);
	// Only for whoever plays the character the receipt marked, as every other press on a card.
	if (actor?.type !== "character" || !actor.testUserPermission?.(user, "OWNER")) return null;
	return inCardTurn(card, async () => {
		const out = await takeBackXpMark(receipt, actor);
		if (!out) return { already: true };
		await waiveMissXp(card);
		return { applied: out.applied, after: out.after, max: out.max };
	});
});

/**
 * The card's spent state.
 *
 * Both halves matter. The button says what happened and stops being a control; the card stops
 * asserting a total that is no longer true. Without the second, "+1 XP (16 / 8)" goes on sitting
 * in the log as a fact, which is the thing the undo was for.
 */
export function markCardUndone(btn) {
	btn.disabled = true;
	btn.innerHTML = `<i class="fas fa-rotate-left"></i> Undone`;
	// Found from the BUTTON rather than from the message element: the render hook is handed the
	// whole message on some paths and the card on others, and `closest` is right either way.
	btn.closest(".stonetop-xp-mark-card")?.classList.add("is-xp-undone");
}

/**
 * Wire the Undo on an XP receipt. A no-op on every other card.
 *
 * @param {object} message  the ChatMessage
 * @param {HTMLElement} html  its rendered element
 */
export function wireUndoXpMark(message, html) {
	const btn = html?.querySelector?.(".stonetop-xp-undo");
	if (!btn) return;

	const marked = Number(message.getFlag(SYSTEM_ID, XP_MARK_FLAG) ?? 0);
	const actor  = speakerActor(message);
	// Nothing to take back, or not this user's to take. The control goes away rather than sitting
	// there dead: a player looking at somebody else's receipt is not being denied anything, so
	// there is nothing to explain to them.
	if (!marked || !canRewriteCard(message, actor)) { btn.remove(); return; }

	if (message.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)) { markCardUndone(btn); return; }

	// Three guards, because the flag alone is not enough and neither is the button.
	//
	// `inFlight` is the one that actually stops a double click. Writing the flag is itself an
	// await, so two presses landing in the same tick BOTH get past a flag check and BOTH write
	// it, each believing it was first — the flag records that an undo happened, it cannot decide
	// which press owns it. `btn.disabled` does not cover this either: a browser will not fire a
	// disabled button, but a re-entrant call is not a browser.
	let inFlight = false;

	btn.addEventListener("click", async () => {
		if (inFlight) return;
		// Another client may have undone this while the button was on screen, with their
		// re-render not yet here. Cheap to ask, and it turns a doomed write into the right paint.
		if (message.getFlag(SYSTEM_ID, XP_UNDONE_FLAG)) { markCardUndone(btn); return; }

		inFlight = true;
		btn.disabled = true;
		try {
			// takeBackXpMark latches first and releases the latch if the write fails, so a failure
			// never leaves the card reading "undone" with the XP still marked. A miss's receipt goes
			// through its roll card's writer (undoXpReceipt).
			const out = await undoXpReceipt(message, actor);
			// Already at zero: the XP has been spent on a level since, so there is nothing left to
			// hand back. The card is still marked undone, because the mark IS withdrawn, but
			// saying so out loud beats a button that looks like it did nothing.
			if (out) {
				globalThis.ui?.notifications?.info(out.applied
					? `Took back ${marked} XP from ${actor.name}. Now ${out.after} / ${out.max}.`
					: `${actor.name} had no XP left to take back.`);
			}

			markCardUndone(btn);
		} catch (err) {
			console.error("Stonetop | Error undoing a marked XP:", err);
			// The latch is released by now. Re-enabling the button lets the GM try again; the next
			// render reads the flag, not the DOM, and the flag is clear.
			btn.disabled = false;
		} finally {
			// Cleared on both paths. After a success the flag check at the top is what refuses
			// the next press; after a failure this is what lets the GM try again.
			inFlight = false;
		}
	});
}
