// Send Them Back, the Ring of Daagon's dismissal (Book II p.561): "When you send them back whence they
// came, roll +CHA: on a 10+, they go, now; on a 7-9, they go, but take their time and likely do some harm
// on their way; on a 6-, spend their Loyalty or mark a consequence and they'll eventually go (as on a 7-9);
// otherwise, this batch breaks free of your control and are no longer followers."
//
// The roll is an ordinary +CHA roll (the sheet sends it through StonetopCharacter#onDirectStatRoll, so the
// sticky mode, ongoing, what the next roll is owed and the debilities all reach it). What the result DOES
// is settled on the CARD, not in a window opened when the dice land: each tier's row carries its own
// buttons, a GM's Shift or a Burn Brightly shows the row of the tier the card moves to (stonetop.js), and a
// click re-reads the card's counted tier before it acts. So the batch goes, or pays, or breaks free by the
// result the card ends on. Once per card.

import { SYSTEM_ID } from "../../system-id.js";
import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { cardTierNow } from "../../utils/counted-tier.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { deletionEntry } from "../../utils/foundry-compat.js";
import { escHtml } from "../../utils/strings.js";
import { postMoveNote } from "../../utils/chat.js";
import { findRingFollower } from "../../data/servant-of-daagon.js";
import { markArcanumConsequence, RING_OF_DAAGON } from "./arcana-seeker-moves.js";

export const SEND_THEM_BACK = "Send Them Back";
/** Message flag: the card's result has been acted on (the act taken). */
export const SEND_BACK_FLAG = "sendThemBackSettled";

const SELECTOR = ".stonetop-send-back-act";
const TIER_LABEL = { success: "10+", partial: "7-9", failure: "6-" };

const button = (slug, tier, act, icon, label) =>
	`<button type="button" class="stonetop-send-back-act" data-tier="${tier}" data-act="${act}" data-slug="${escHtml(slug)}">`
	+ `<i class="fas ${icon}"></i> ${escHtml(label)}</button>`;

/** Each tier's buttons, for rollStat's `tierActions` (only the card's current tier's row shows). */
export function sendBackTierActions(slug) {
	return {
		success: button(slug, "success", "depart", "fa-user-minus", "They go, now: take them off your Followers"),
		partial: button(slug, "partial", "depart", "fa-user-minus", "They go, in their own time: take them off your Followers"),
		failure: button(slug, "failure", "loyalty", "fa-hand-holding-heart", "Spend 1 of the Ring's Loyalty")
			+ button(slug, "failure", "consequence", "fa-triangle-exclamation", "Mark a consequence")
			+ button(slug, "failure", "free", "fa-skull-crossbones", "They break free"),
	};
}

/** What the roll is handed besides the stat: the move's words, its outcomes, and the tier buttons. */
export function sendBackRollOptions(slug) {
	return {
		moveName:        SEND_THEM_BACK,
		moveDescription: `<p>When you <strong><em>send them back whence they came</em></strong>, roll +CHA.</p>`,
		moveResults: {
			success: { value: "They go, now." },
			partial: { value: "They go, but take their time and likely do some harm on their way." },
			failure: { value: "Spend their Loyalty or mark a consequence and they'll eventually go (as on a 7-9); otherwise, this batch breaks free of your control and are no longer followers." },
		},
		tierActions: sendBackTierActions(slug),
	};
}

/** The tier a Send Them Back card counts as NOW (after any Shift or rewrite), or null with no roll. */
export function sendBackCardTier(message) {
	return cardTierNow(message, SYSTEM_ID);
}

/** Take the batch off the Followers tab, through the sheet's own removal when there is a sheet. */
function removeBatch(actor, slug) {
	const sheet = actor?.sheet;
	if (typeof sheet?._removeCustomFollower === "function") {
		return sheet._removeCustomFollower(slug, { stonetopMove: SEND_THEM_BACK });
	}
	const [key, val] = deletionEntry(`flags.${STONETOP_SCOPE}.customFollowers.${slug}`);
	return actor.update({ [key]: val }, { stonetopMove: SEND_THEM_BACK });
}

/**
 * Do what one button says. Answers whether it was done (false releases the card's latch).
 * @param {{markConsequence?: Function}} [o]  stand-in for markArcanumConsequence, for tests
 */
export async function runSendBack(actor, slug, act, { markConsequence = markArcanumConsequence } = {}) {
	const followers = actor.getFlag?.(STONETOP_SCOPE, "customFollowers") ?? {};
	const batch = followers[slug];
	if (!batch) {
		globalThis.ui?.notifications?.info?.("That batch of servants is no longer on the Followers tab.");
		return false;
	}
	const who = batch.name || "The servants of Daagon";
	if (act === "depart") {
		await removeBatch(actor, slug);
		return true;
	}
	if (act === "loyalty") {
		const ring = findRingFollower(followers);
		if (!ring.id || ring.loyalty <= 0) {
			globalThis.ui?.notifications?.warn?.(`${ring.name} holds no Loyalty: mark a consequence, or they break free.`);
			return false;
		}
		await actor.update({ [`flags.${STONETOP_SCOPE}.customFollowers.${ring.id}.loyalty`]: ring.loyalty - 1 },
			{ stonetopMove: SEND_THEM_BACK });
		await postMoveNote(actor, SEND_THEM_BACK,
			`${actor.name} spends 1 Loyalty from ${ring.name} (now ${ring.loyalty - 1}). ${who} will eventually go.`);
		await removeBatch(actor, slug);
		return true;
	}
	if (act === "consequence") {
		if (!(await markConsequence(actor, RING_OF_DAAGON))) return false;
		await postMoveNote(actor, SEND_THEM_BACK, `${who} will eventually go.`);
		await removeBatch(actor, slug);
		return true;
	}
	if (act === "free") {
		await actor.update({ [`flags.${STONETOP_SCOPE}.customFollowers.${slug}.brokenFree`]: true },
			{ stonetopMove: SEND_THEM_BACK });
		await postMoveNote(actor, SEND_THEM_BACK, `${who} break free of your control. They are no longer your followers.`);
		return true;
	}
	return false;
}

/**
 * One button pressed: re-read the card's tier, refuse a row the card no longer reads, then act once.
 * @param {{buttons?: HTMLElement[], markConsequence?: Function}} [o]
 */
export async function settleSendBack(message, actor, btn, { buttons = [], markConsequence } = {}) {
	const { tier, act, slug } = btn?.dataset ?? {};
	if (!actor || !slug || !act || message?.getFlag?.(SYSTEM_ID, SEND_BACK_FLAG)) return false;
	const now = sendBackCardTier(message);
	if (now !== tier) {
		globalThis.ui?.notifications?.warn?.(`This card now reads ${TIER_LABEL[now] ?? "another result"}: use that result's buttons.`);
		return false;
	}
	return withCardLatch(message, SEND_BACK_FLAG, act, buttons, () => runSendBack(actor, slug, act, { markConsequence }));
}

/** Wire a Send Them Back card's buttons (stonetop.js renderChatMessageHTML). */
export function wireSendBackCard(message, html) {
	wireLatchedButtons(message, html, { selector: SELECTOR, flag: SEND_BACK_FLAG, what: SEND_THEM_BACK,
		act: (actor, btn, buttons) => settleSendBack(message, actor, btn, { buttons }) });
}
