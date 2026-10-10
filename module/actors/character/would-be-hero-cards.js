/**
 * The Would-Be Hero's buttons on chat cards, and the one roll hook its asterisk waits on.
 *
 *  - Speak Truth to Power: "When you demand that someone does what is clearly good and right, you have
 *    advantage to Persuade. If they refuse, gain +1 Resolve." The advantage is a roll-window line
 *    (StonetopCharacter.js's FICTION_ROLL_OFFERS); taken, the Persuade card carries a "They refused:
 *    +1 Resolve" button on every tier, since any of them can end in a refusal. Resolve is CAPPED at 2
 *    (the user's ruling): pressed while holding 2, the +1 is lost, and the button's tooltip says so.
 *  - In Over Your Head: "When another PC rescues you from danger, mark XP." A Mark XP button on the
 *    move's posted card, marked through roll-engine.js#markXpReceipt as an agreed Persuade is.
 *  - A Force to Be Reckoned With: "When you Defy Danger against something trying to harm or constrain
 *    you, on a 12+ you turn the tables on them." A roll-window line whose note prints on a 12+ alone
 *    (roll-engine.js `criticalActions`); `forceTurnedTables` is called when it does, and crosses off
 *    "Would-be" the first time (a starred move, WouldBeHeroAsterisk.js).
 *  - Voice of Experience: its free Seek Insight question gets an "Ask it" button, which is the starred
 *    move's use and crosses off "Would-be" the first time.
 *  - Anger is a Gift: the righteous angers picked on the Details tab ("What makes you burn with
 *    righteous anger?"), named under the move on the Moves tab.
 *
 * Each button is once per card, latched on the message (card-latch.js), and pressed only by whoever can
 * write the card and the hero (the hero's player, or the GM).
 */

import { SYSTEM_ID } from "../../system-id.js";
import { bookMoveName, ownsLearnedBookMoveNamed } from "./owns-move.js";
import { learnedTrack } from "./MoveResources.js";
import { asteriskMoveUsed, asteriskUseCounts } from "./WouldBeHeroAsterisk.js";
import { markXpReceipt } from "../../utils/roll-engine.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { canRewriteCard } from "../../utils/chat.js";
import { belongsToMessage } from "../../utils/picked-option-button.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

export const ANGER_IS_A_GIFT = "Anger is a Gift";
export const SPEAK_TRUTH_TO_POWER = "Speak Truth to Power";
export const IN_OVER_YOUR_HEAD = "In Over Your Head";
export const A_FORCE_TO_BE_RECKONED_WITH = "A Force to Be Reckoned With";
export const VOICE_OF_EXPERIENCE = "Voice of Experience";

/** The Details tab's lore section the righteous angers are picked in (the playbook's "Fear & Anger"). */
export const RIGHTEOUS_ANGER_LORE = "fear-and-anger-anger";

/** Message flag: Speak Truth to Power's refusal was answered on this card. */
export const REFUSED_FLAG = "speakTruthRefused";
/** Message flag: In Over Your Head's XP was marked off this card. */
export const RESCUED_FLAG = "inOverYourHeadXp";
/**
 * Message flag: this Defy Danger turned the tables (A Force to Be Reckoned With's 12+), a use of the
 * starred move (forceTurnedTables).
 */
export const FORCE_TURNED_TABLES_FLAG = "forceTurnedTables";
/** Message flag: Voice of Experience's free question was asked off this card (a use of the starred move). */
export const VOICE_ASKED_FLAG = "voiceOfExperienceAsked";

/**
 * Speak Truth to Power's refusal button, for every tier of a Persuade where its line was taken (the
 * roll-window line's `tierActions`, StonetopCharacter#onRoll).
 */
export function speakTruthRefusedActions() {
	const button = `<button type="button" class="stonetop-speak-truth-refused" data-tooltip="${escHtml(localize("stonetop.wouldBeHero.refusedTooltip"))}" data-tooltip-direction="UP">`
		+ `<i class="fas fa-fire"></i> ${escHtml(localize("stonetop.wouldBeHero.refusedButton"))}</button>`;
	return { success: button, partial: button, failure: button };
}

/**
 * Add Speak Truth to Power's +1 to Anger is a Gift's Resolve, held at its max (2). What happened:
 * `{added, held, max}`, `added` 0 when already holding the max, or null with no learned Anger is a Gift.
 */
export async function gainRefusedResolve(actor) {
	const track = learnedTrack(actor, ANGER_IS_A_GIFT);
	if (!track) return null;
	const held = Math.min(track.max, track.held + 1);
	if (held === track.held) return { added: 0, held, max: track.max };
	await track.resources.setUses(ANGER_IS_A_GIFT, held, { stonetopMove: SPEAK_TRUTH_TO_POWER });
	return { added: held - track.held, held, max: track.max };
}

/**
 * In Over Your Head's button, for the move's posted card: "" for any other move, or one not held learned.
 * `item` is the move being posted, when there is one: a move a player wrote under the book's name acts as
 * itself and marks nothing (owns-move.js#bookMoveName), nor does the book's own learned copy count for it,
 * as giveAdvantageCardHtml beside it on the same posts.
 */
export function inOverYourHeadCardHtml(actor, moveName, item = null) {
	if (moveName !== IN_OVER_YOUR_HEAD || actor?.type !== "character") return "";
	if (item && bookMoveName(item, moveName) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, IN_OVER_YOUR_HEAD)) return "";
	return `<div class="card-buttons stonetop-roll-actions"><button type="button" class="stonetop-in-over-your-head-xp" `
		+ `data-tooltip="${escHtml(localize("stonetop.wouldBeHero.rescuedTooltip"))}" data-tooltip-direction="UP">`
		+ `<i class="fas fa-star"></i> ${escHtml(localize("stonetop.wouldBeHero.rescuedButton"))}</button></div>`;
}

/** Mark In Over Your Head's XP and post the receipt (with its Undo), as a miss's is posted. */
export async function markRescuedXp(actor, { create = (...args) => globalThis.ChatMessage.create(...args) } = {}) {
	const receipt = await markXpReceipt(actor, {
		header: IN_OVER_YOUR_HEAD,
		move: IN_OVER_YOUR_HEAD,
		description: localize("stonetop.wouldBeHero.rescuedDescription"),
	});
	await create({
		content: receipt.content,
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
		flags: { [SYSTEM_ID]: receipt.flags },
	});
	return true;
}

/**
 * A Force to Be Reckoned With turned the tables: a Defy Danger with its line taken came up 12+
 * (StonetopCharacter#onRoll). Stamps the card with FORCE_TURNED_TABLES_FLAG and answers true.
 *
 * THE ASTERISK SEAM for this move: its first use crosses off "Would-be" (the user's ruling), for a
 * Would-Be Hero holding it learned (WouldBeHeroAsterisk.js#asteriskMoveUsed).
 */
export async function forceTurnedTables(actor, message) {
	await message?.setFlag?.(SYSTEM_ID, FORCE_TURNED_TABLES_FLAG, true);
	await asteriskMoveUsed(actor, A_FORCE_TO_BE_RECKONED_WITH);
	return true;
}

/**
 * The righteous angers picked in `loreSections` (the playbook's lore) by `counts` (CharacterLore's
 * `lore:option` counts), in the book's order, as printed without the closing full stop. PURE.
 */
export function righteousAngers(loreSections = [], counts = {}) {
	const section = (loreSections ?? []).find(s => s?.slug === RIGHTEOUS_ANGER_LORE);
	return (section?.options ?? [])
		.filter(o => Number(counts?.[`${RIGHTEOUS_ANGER_LORE}:${o.slug}`]) > 0)
		.map(o => String(o.description ?? "").trim().replace(/\.$/, ""))
		.filter(Boolean);
}

/** Anger is a Gift's subtitle on the Moves tab, or null with none picked. */
export function righteousAngerSubtitle(loreSections, counts) {
	const angers = righteousAngers(loreSections, counts);
	return angers.length ? format("stonetop.wouldBeHero.angers", { list: angers.join("; ") }) : null;
}

/**
 * Voice of Experience's free question on a Seek Insight card (move-pick-bonuses.js#freeQuestionLines):
 * asking it is a use of the starred move, so its line gets an "Ask it" button that crosses off
 * "Would-be" (WouldBeHeroAsterisk.js#asteriskMoveUsed). Added at render, for whoever can write the card
 * and the hero only, while the hero is still Would-be; once pressed, latched on the card and shown
 * chosen. A card rolled before the button existed gets one too.
 */
function wireVoiceOfExperience(message, html) {
	const root = html?.[0] ?? html;
	const line = [...(root?.querySelectorAll?.(`.stonetop-free-question[data-free-question="${VOICE_OF_EXPERIENCE}"]`) ?? [])]
		.find(el => belongsToMessage(el, message));
	if (!line) return;
	const actor = speakerActor(message);
	if (!canRewriteCard(message, actor)) return;
	const asked = !!message?.getFlag?.(SYSTEM_ID, VOICE_ASKED_FLAG);
	if (!asked && !asteriskUseCounts(actor, VOICE_OF_EXPERIENCE)) return;
	if (!line.querySelector(".stonetop-voice-asked")) {
		const doc = line.ownerDocument ?? globalThis.document;
		const btn = doc.createElement("button");
		btn.type = "button";
		btn.className = "stonetop-inline-btn stonetop-voice-asked";
		btn.dataset.tooltip = localize("stonetop.wouldBeHero.voiceAskTooltip");
		btn.dataset.tooltipDirection = "UP";
		btn.textContent = localize("stonetop.wouldBeHero.voiceAskButton");
		line.append(" ", btn);
	}
	wireLatchedButtons(message, html, {
		selector: ".stonetop-voice-asked",
		flag: VOICE_ASKED_FLAG,
		what: "Voice of Experience's question",
		// Asked is asked: the card is done even when "Would-be" was crossed off some other way meanwhile.
		act: (hero, _btn, buttons) => withCardLatch(message, VOICE_ASKED_FLAG, true, buttons, async () => {
			await asteriskMoveUsed(hero, VOICE_OF_EXPERIENCE);
			return true;
		}),
	});
}

/**
 * Wire a card's Would-Be Hero buttons (stonetop.js renderChatMessageHTML): Speak Truth to Power's
 * refusal, In Over Your Head's XP, and Voice of Experience's "Ask it". Safe on every render.
 */
export function wireWouldBeHeroCards(message, html, { notify = globalThis.ui?.notifications, create } = {}) {
	wireVoiceOfExperience(message, html);
	wireLatchedButtons(message, html, {
		selector: ".stonetop-speak-truth-refused",
		flag: REFUSED_FLAG,
		what: "Speak Truth to Power's +1 Resolve",
		act: (actor, _btn, buttons) => withCardLatch(message, REFUSED_FLAG, true, buttons, async () => {
			const gained = await gainRefusedResolve(actor);
			if (!gained) {
				notify?.warn?.(format("stonetop.wouldBeHero.refusedNoTrack", { name: actor?.name ?? "" }));
				return false;
			}
			// Lost at the cap is still the refusal answered: the card is done either way.
			if (gained.added) notify?.info?.(format("stonetop.wouldBeHero.refusedGained", { name: actor.name, held: gained.held, max: gained.max }));
			else notify?.info?.(format("stonetop.wouldBeHero.refusedLost", { name: actor.name, max: gained.max }));
			return true;
		}),
	});
	wireLatchedButtons(message, html, {
		selector: ".stonetop-in-over-your-head-xp",
		flag: RESCUED_FLAG,
		what: "In Over Your Head's XP",
		act: (actor, _btn, buttons) => withCardLatch(message, RESCUED_FLAG, true, buttons,
			() => markRescuedXp(actor, create ? { create } : {})),
	});
}
