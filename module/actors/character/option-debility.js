/**
 * A move option that says "(mark a debility)", ticked on its card, has its character mark one: the Heavy's
 * Mighty Thews, "When you perform a feat of extraordinary strength ..., you do it (OH YEAH!) but pick 1: It
 * takes a while / You cause unwanted damage or harm / It takes a toll (mark a debility)". Ticking the toll
 * marked nothing. The tick now opens the same pick-one window Unfettered opens
 * (will-and-restraint.js#pickDebilityToMark); picked, the debility is marked, once per option, latched on the
 * message, and the option says what it marked. Closing the window marks nothing. Unticking never un-marks:
 * the debility is the character's now, cleared the way any debility is.
 *
 * Which options qualify is read off their own words, as a Forage bullet's provisions are
 * (picked-option-button.js), so a move a world wrote gets the same: an option whose text ENDS in "(mark a
 * debility)". Not "You adapt to the new form quickly (else, mark a debility)" (an arcanum's draught), where
 * ticking the option is what spares the debility, nor a sentence with "(mark a debility)" in its middle
 * (Forage's 6-, which is no option at all).
 */

import { SYSTEM_ID } from "../../system-id.js";
import { canRewriteCard, cardMoveName } from "../../utils/chat.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { wireOptionTicks } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { format, localize } from "../../utils/i18n.js";
import { pickDebilityToMark } from "./will-and-restraint.js";

/** Message flag: what each such option marked, `{key, name}`, keyed by its box's `data-index`. */
export const OPTION_DEBILITY_FLAG = "optionDebility";

const STRINGS = "stonetop.willAndRestraint.optionDebility";
const READOUT = "stonetop-option-debility-marked";

/** Whether an option's text has its character mark a debility (see the head of this file). */
export function optionMarksDebility(text) {
	const words = String(text ?? "");
	// Every match holds the word, and the squeeze below never touches it: a cheap no for most options.
	return /debility/i.test(words) && /\(mark a debility\)\.?$/i.test(words.replace(/\s+/g, " ").trim());
}

/** What the option at `index` already marked on this card, or null. */
function markedFor(message, index) {
	return message?.getFlag?.(SYSTEM_ID, OPTION_DEBILITY_FLAG)?.[index] ?? null;
}

/**
 * The tick of one such option: open the window, and mark through the card's latch, so a second window (an
 * untick and re-tick while the first is still open) or another owner's client cannot mark twice. Whether the
 * window was opened: not for an option that has marked already.
 *
 * @param {ChatMessage} message
 * @param {Actor} actor
 * @param {{index: string, moveName: string}} option
 * @param {{pick?: Function, note?: Function}} [deps]  as pickDebilityToMark's
 */
export function markDebilityForOption(message, actor, { index, moveName }, deps = {}) {
	if (markedFor(message, index)) return false;
	return pickDebilityToMark(actor, {
		moveName, strings: STRINGS,
		latch: (picked, mark) => (markedFor(message, index) ? false
			: withCardLatch(message, `${OPTION_DEBILITY_FLAG}.${index}`, { key: picked.id, name: picked.label }, [], mark)),
	}, deps);
}

/**
 * Wire a card's "(mark a debility)" options (stonetop.js renderChatMessageHTML, after the picks pass that
 * restores each box's tick). Whoever can write both the card and the character acts on a tick
 * (chat.js#canRewriteCard); everyone sees what was marked.
 */
export function wireOptionDebility(message, html) {
	const root = html?.[0] ?? html;
	if (!root?.querySelectorAll) return;
	wireOptionTicks(message, root, {
		matches:      optionMarksDebility,
		readoutClass: READOUT,
		wiredKey:     "optionDebilityWired",
		readout:      box => {
			const marked = markedFor(message, box.dataset.index);
			return marked ? format(`${STRINGS}.marked`, { debility: marked.name ?? marked.key ?? "" }) : null;
		},
		onChange:     box => {
			if (!box.checked) return;
			const actor = speakerActor(message);
			if (!canRewriteCard(message, actor)) return;
			try {
				markDebilityForOption(message, actor, { index: box.dataset.index, moveName: cardMoveName(message, root, localize(`${STRINGS}.apply`)) });
			} catch (err) {
				console.error("Stonetop | marking an option's debility failed", err);
			}
		},
	});
}
