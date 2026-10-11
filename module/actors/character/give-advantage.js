/**
 * "You or an ally gain advantage on your next roll": a button that holds it (the user's ruling of
 * 2026-09-26, Seeker audit A13). Four Seeker moves print it:
 *
 *  - Countermeasures: "You or an ally gain advantage on your next roll to act on the answer." No roll,
 *    so the button is on the card its text posts.
 *  - Sage Advice: "When another PC asks you for guidance, they get advantage on their next roll to
 *    follow your advice." No roll either, and another PC only.
 *  - Everything Burns, 10+: "you or an ally also gain advantage to act on the info." On that tier of
 *    the roll card (move-roll-options.js).
 *  - Work With What You've Got, 7+: "Create an opportunity that grants you or an ally advantage on the
 *    next roll to exploit it." On both hitting tiers: whether that option was the one picked is the
 *    player's to judge.
 *
 * And three of the Would-Be Hero's:
 *
 *  - Voice of Experience: "When another PC comes to you for advice and you tell them what you think is
 *    best, they have advantage on their first roll to follow your advice." Sage Advice's shape. Its free
 *    Seek Insight question is move-pick-bonuses.js's.
 *  - Inquiring Minds: "When you seek out and receive honest advice, gain advantage on your next roll to
 *    follow that advice." The hero's own, on its posted card.
 *  - Resourceful: "When you Defy Danger and roll a 6-, ask the GM a question from Seek Insight after they
 *    describe what happens. Gain advantage on your next roll to act on the answer." The hero's own, on
 *    Defy Danger's 6- row, under a line listing Seek Insight's questions.
 *
 * Pressed, it asks who (the giver, or another player character) and holds advantage on that
 * character's next roll through the one store every held advantage uses (StonetopCharacter#
 * holdAdvantage, as Aid's answer does), named for the move. A `selfOnly` move asks nobody: it holds
 * it for the giver. Once per card. The rules and the button are here; the picker, the write and the
 * GM's relay are give-advantage-flow.js's.
 */

import { bookMoveName, ownsLearnedBookMoveNamed } from "./owns-move.js";
import { escHtml } from "../../utils/strings.js";
import { ARTIFACT_INSIGHT_QUESTIONS } from "./artifact-identify.js";

/**
 * Seek Insight's printed questions, which Resourceful's 6- asks one of (pinned against the pack by its
 * test): the one list, which Identify an artifact asks from too (artifact-identify.js).
 */
export const SEEK_INSIGHT_QUESTIONS = ARTIFACT_INSIGHT_QUESTIONS;

/**
 * The moves that give it. `tiers`: the roll card's tiers that carry the button (a move with none
 * carries it on its posted card). `on`: the rolled move whose card that is, when it is not the giving
 * move itself (Resourceful's is Defy Danger's). `othersOnly`: never the giver (Sage Advice: "they get
 * advantage"). `selfOnly`: the giver alone ("gain advantage on your next roll"). `lead`: a line printed
 * before the button.
 */
export const GIVE_ADVANTAGE_MOVES = {
	"Countermeasures":           { tiers: null,                     othersOnly: false },
	"Sage Advice":               { tiers: null,                     othersOnly: true },
	"Everything Burns":          { tiers: ["success"],              othersOnly: false },
	"Work With What You've Got": { tiers: ["success", "partial"],   othersOnly: false },
	"Voice of Experience":       { tiers: null,                     othersOnly: true },
	"Inquiring Minds":           { tiers: null,                     othersOnly: false, selfOnly: true },
	"Resourceful":               { tiers: ["failure"], on: "Defy Danger", othersOnly: false, selfOnly: true,
		lead: `<strong>Resourceful:</strong> once the GM describes what happens, ask them one of Seek Insight's questions: ${SEEK_INSIGHT_QUESTIONS.join(" / ")} You gain advantage on your next roll to act on the answer.` },
};

function buttonHtml(moveName) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	const label = rule?.selfOnly ? `Hold advantage (${moveName})`
		: rule?.othersOnly ? "Give advantage to another PC..." : "Give advantage to...";
	const lead = rule?.lead ? `<p class="stonetop-give-advantage-lead">${rule.lead}</p>` : "";
	return `${lead}<button type="button" class="stonetop-give-advantage" data-move="${escHtml(moveName)}"><i class="fas fa-angles-up"></i> ${escHtml(label)}</button>`;
}

/**
 * The roll card's button, for move-roll-options.js: on the tiers that give advantage, for a character
 * holding the move learned. Null for anyone else, and for a move whose button is on its posted card.
 */
export function giveAdvantageRollOptions(moveName) {
	return actor => {
		const tiers = GIVE_ADVANTAGE_MOVES[moveName]?.tiers;
		if (!tiers?.length || actor?.type !== "character" || !ownsLearnedBookMoveNamed(actor, moveName)) return null;
		return { tierActions: Object.fromEntries(tiers.map(tier => [tier, buttonHtml(moveName)])) };
	};
}

/**
 * The button for a move whose card is its posted text (Countermeasures, Sage Advice), for the
 * sheet's and the hotbar's description-only posts: "" for any other move, or one not held learned.
 * `item` is the move being posted, when there is one: a move a player wrote under the book's name acts
 * as itself and gives nothing (owns-move.js#bookMoveName), nor does the book's own learned copy count
 * for it.
 */
export function giveAdvantageCardHtml(actor, moveName, item = null) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	if (!rule || rule.tiers || actor?.type !== "character") return "";
	if (item && bookMoveName(item, moveName) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, moveName)) return "";
	return `<div class="card-buttons stonetop-roll-actions stonetop-give-advantage-row">${buttonHtml(moveName)}</div>`;
}

/** The held advantage's label: the move, and whose it was when it is someone else's. PURE. */
export function givenSource(moveName, giver, target) {
	return target?.id && giver?.id && target.id !== giver.id ? `${giver.name}'s ${moveName}` : moveName;
}

/**
 * Who can be given it, out of `others` (the other player characters): the giver too, unless the move
 * says another PC; the giver alone for a `selfOnly` move. PURE.
 */
export function advantageRecipients(giver, moveName, others = []) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	if (rule?.selfOnly) return [giver].filter(Boolean);
	const rest = (others ?? []).filter(a => a?.type === "character" && a.id !== giver?.id);
	return rule?.othersOnly ? rest : [giver, ...rest].filter(Boolean);
}

/** Whether `moveName` may give it to `target`: another PC only, or the giver only, as its rule says. PURE. */
export function mayReceive(giver, target, moveName) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	const self = !!target?.id && target.id === giver?.id;
	if (rule?.othersOnly && self) return false;
	if (rule?.selfOnly && !self) return false;
	return true;
}
