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
 * And, from the 2026-10-16 coverage pass, Seek Insight's own "either way, take advantage on your next
 * move to act on the answers", Danger Sense, Ambush's opportunity, Knowledge is Power, Frosty, Set-Up
 * Strike's Aid, and Stentorian's Command spend (see the table below). Speak Softly's is against one enemy,
 * so its posted card carries a button of its own (speakSoftlyCardHtml).
 *
 * Pressed, it asks who (the giver, or another player character) and holds advantage on that
 * character's next roll through the one store every held advantage uses (StonetopCharacter#
 * holdAdvantage, as Aid's answer does), named for the move. A `selfOnly` move asks nobody: it holds
 * it for the giver. Once per card. The rules and the button are here; the picker, the write and the
 * GM's relay are give-advantage-flow.js's.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { bookMoveName, ownsLearnedBookMoveNamed } from "./owns-move.js";
import { escHtml } from "../../utils/strings.js";
import { localize } from "../../utils/i18n.js";
import { HERO_MOVES } from "../../fight/hero-move-names.js";
import { SET_UP_STRIKE_KEY } from "../../fight/hero-moves.js";
import { ARTIFACT_INSIGHT_QUESTIONS } from "./artifact-identify.js";
import { movePickBonusesFor } from "./move-pick-bonuses.js";

/**
 * Seek Insight's printed questions, which Resourceful's 6- asks one of (pinned against the pack by its
 * test): the one list, which Identify an artifact asks from too (artifact-identify.js).
 */
export const SEEK_INSIGHT_QUESTIONS = ARTIFACT_INSIGHT_QUESTIONS;

/**
 * The questions `actor` could ask when Seeking Insight: the printed list, then what their own moves "add
 * to the list of questions you can ask" (Situational Awareness, Predator, The Natural, Let's Make a Deal),
 * read off the one table that adds them to Seek Insight's card (move-pick-bonuses.js). Frosty and
 * Resourceful ask "a question that you could ask when Seeking Insight", so a Heavy who learned Situational
 * Awareness may ask its three there too (the user's ruling, Heavy re-audit 2026-10-18). PURE apart from
 * reading the actor; the printed list alone for no actor.
 */
export function seekInsightQuestionsFor(actor) {
	const added = movePickBonusesFor(actor, "Seek Insight").flatMap(bonus => bonus.addOptions ?? []);
	return [...SEEK_INSIGHT_QUESTIONS, ...added];
}

/**
 * The Fox's Burgle (Book I p.110): "on a 10+, also pick 2; on a 7-9, also pick 1: ... Ask a Seek Insight
 * question about what you saw." Not a held advantage, only the questions that pick may ask, printed on both
 * hitting tiers of Burgle's own roll card the way Frosty's and Resourceful's leads print them (for
 * move-roll-options.js). Whether that was a pick is the player's to say.
 */
export function burgleRollOptions(actor) {
	const line = `<p class="stonetop-roll-offer-note"><strong>Burgle:</strong> if you picked "Ask a Seek Insight question about what you saw", ask the GM one of: ${seekInsightQuestionsFor(actor).join(" / ")}</p>`;
	return { tierActions: { success: line, partial: line } };
}

/**
 * The moves that give it. `tiers`: the roll card's tiers that carry the button (a move with none
 * carries it on its posted card). `on`: the rolled move whose card that is, when it is not the giving
 * move itself (Resourceful's is Defy Danger's). `othersOnly`: never the giver (Sage Advice: "they get
 * advantage"). `selfOnly`: the giver alone ("gain advantage on your next roll"). `lead`: a line printed
 * before the button, or `(actor) => line` for one that depends on the roller. `label`: the button's own words. `many`: several PCs at once ("PCs get advantage").
 * `spendHeld`: the learned move whose HELD track pays 1 for the press, refused with none held.
 * `gate`: `(message, scope) => "open" | reason`, for a button that waits on something on its own card, greyed
 * out with `${gateKey}.${reason}`'s words beside it until it answers "open" (give-advantage-flow.js#wireGiveAdvantage).
 */
export const GIVE_ADVANTAGE_MOVES = {
	"Countermeasures":           { tiers: null,                     othersOnly: false },
	"Sage Advice":               { tiers: null,                     othersOnly: true },
	"Everything Burns":          { tiers: ["success"],              othersOnly: false },
	"Work With What You've Got": { tiers: ["success", "partial"],   othersOnly: false },
	"Voice of Experience":       { tiers: null,                     othersOnly: true },
	"Inquiring Minds":           { tiers: null,                     othersOnly: false, selfOnly: true },
	"Resourceful":               { tiers: ["failure"], on: "Defy Danger", othersOnly: false, selfOnly: true,
		lead: actor => `<strong>Resourceful:</strong> once the GM describes what happens, ask them one of Seek Insight's questions: ${seekInsightQuestionsFor(actor).join(" / ")} You gain advantage on your next roll to act on the answer.` },
	// Coverage pass (2026-10-16). A basic move first: Seek Insight (Book I pp.73, 228), "on a 10+, ask the GM 3
	// questions ...; on a 7-9, ask 1; either way, take advantage on your next move to act on the answers."
	// Asked of an artifact too (artifact-identify.js), whose roll card carries the same button
	// (StonetopCharacter#onDirectStatRoll).
	"Seek Insight":              { tiers: ["success", "partial"],   othersOnly: false, selfOnly: true },
	// The Fox's Danger Sense (p.110): "on a 10+, ask the GM both ...; on a 7-9, ask 1; either way, gain
	// advantage on your next roll to act on the answer(s)."
	"Danger Sense":              { tiers: ["success", "partial"],   othersOnly: false, selfOnly: true },
	// The Fox's Ambush (p.110), 7+: "Create an opportunity; you or an ally gains advantage on the next move to
	// act on it." On both hitting tiers, as Work With What You've Got's: whether it was the pick is the player's.
	"Ambush":                    { tiers: ["success", "partial"],   othersOnly: false },
	// The Judge's Knowledge is Power (p.118): "When you roll 10+ to Know Things, you or an ally gain advantage
	// on the next roll to act on what you learn."
	"Knowledge is Power":        { tiers: ["success"], on: "Know Things", othersOnly: false },
	// The Heavy's Frosty (p.114): "When you Defy Danger by keeping calm and carrying on, on a 10+ you can also
	// ask the GM a question that you could ask when Seeking Insight. You have advantage on your next move to
	// act on the answer." Resourceful's shape on the 10+; whether they kept calm is the player's to say.
	"Frosty":                    { tiers: ["success"], on: "Defy Danger", othersOnly: false, selfOnly: true,
		lead: actor => `<strong>Frosty:</strong> if you kept calm and carried on, also ask the GM one of Seek Insight's questions: ${seekInsightQuestionsFor(actor).join(" / ")} You have advantage on your next move to act on the answer.` },
	// The Heavy's Sheriff background, Bark an Order (p.114): "On a 10+, you can sense which one they're about to do
	// and act first if you like; gain advantage if you do." The giver's own, on the 10+; whether they act first is
	// theirs to say, so the button holds it only when pressed.
	"Bark an Order":             { tiers: ["success"],              othersOnly: false, selfOnly: true,
		lead: "<strong>Bark an Order:</strong> you sense which one they're about to do. If you act first, gain advantage." },
	// The Marshal's Read the Land (p.126): "When you first take a moment to survey the terrain, ask the GM one of
	// the following; gain advantage on your next roll to act on the answer." No roll: its posted card.
	"Read the Land":             { tiers: null,                     othersOnly: false, selfOnly: true },
	// The Marshal's Shake It Off (p.126): "on a 7-9, a PC gets advantage to do it; an NPC will do it, but ..."
	// The ally ordered, never the Marshal; on the 7-9 alone.
	"Shake It Off":              { tiers: ["partial"],              othersOnly: true },
	// The Marshal's Set-Up Strike (p.126): "When you Clash and get a 7+, you can choose to deal damage with
	// disadvantage. If you do, you create an opening for an ally to act on, as if you provided Aid." The
	// disadvantage is a line in the Clash's damage window (fight/hero-moves.js#blowOffers); this is the Aid,
	// which waits on that damage being dealt with it (setUpStrikeGate).
	"Set-Up Strike":             { tiers: ["success", "partial"], on: "Clash", othersOnly: true,
		gate: setUpStrikeGate, gateKey: "stonetop.heldAdvantage.setUpStrike",
		lead: "<strong>Set-Up Strike:</strong> if you dealt your damage with disadvantage, you created an opening for an ally, as if you provided Aid: the GM picks whether they can accomplish more than they could alone or gain advantage on their roll, and you are exposed to its risks." },
	// The Marshal's Stentorian (p.127): "Spend 1 Command to shout an order or warning and pick 1: PCs get
	// advantage on their next roll to do as you say". Its posted card's button spends the Command (`spendHeld`,
	// the track counts what is HELD) and asks which PCs heard (`many`). Its other pick, advantage to Order
	// Followers, is a box in that window (dialogs/OrderFollowersDialog.js).
	"Stentorian":                { tiers: null,                     othersOnly: true, many: true, spendHeld: HERO_MOVES.STENTORIAN,
		label: "Spend 1 Command: PCs get advantage to do as you say..." },
};

/**
 * Set-Up Strike (Book I p.126): "When you Clash and get a 7+, you can choose to deal damage with disadvantage.
 * If you do, you create an opening for an ally to act on, as if you provided Aid." Its Aid button sits on the
 * Clash's own roll card, which is also the card whose Confirm rolls that damage and stamps whether the
 * damage window came back with Set-Up Strike's line ticked (combat/attack-flow.js#resolveAttackTier). So:
 *  - "open": the damage was dealt with it; or the card cannot say, which is a card with no attack record (a
 *    roll from before attacks were carded) or one resolved before the stamp existed. Those keep the button
 *    live, as they always had it: refusing an Aid the player may well have earned is worse than trusting them.
 *  - "unrolled": the Clash's damage is not rolled yet.
 *  - "declined": the damage was rolled without it.
 * PURE apart from reading the card.
 */
export function setUpStrikeGate(message, scope = SYSTEM_ID) {
	const attack = message?.getFlag?.(scope, "attack");
	if (!attack || typeof attack !== "object") return "open";
	if (!attack.resolved) return "unrolled";
	// The attack flag's key (combat/attack-flow.js#SET_UP_STRIKE_STAMP): read off hero-moves.js, so this file
	// does not load the attack flow.
	if (!(SET_UP_STRIKE_KEY in attack)) return "open";
	return attack[SET_UP_STRIKE_KEY] ? "open" : "declined";
}

/**
 * A giving move's button, for a card that is neither its roll card nor its posted card: Second Intent's
 * Ambush pick, "Create an opportunity; you or an ally gains advantage" (fight/defend-spend.js).
 */
export function giveAdvantageButtonHtml(moveName) {
	return GIVE_ADVANTAGE_MOVES[moveName] ? buttonHtml(moveName) : "";
}

function buttonHtml(moveName, actor = null) {
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	const label = rule?.label ?? (rule?.selfOnly ? `Hold advantage (${moveName})`
		: rule?.othersOnly ? "Give advantage to another PC..." : "Give advantage to...");
	const line = typeof rule?.lead === "function" ? rule.lead(actor) : rule?.lead;
	const lead = line ? `<p class="stonetop-give-advantage-lead">${line}</p>` : "";
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
		return { tierActions: Object.fromEntries(tiers.map(tier => [tier, buttonHtml(moveName, actor)])) };
	};
}

/**
 * The posted-card buttons that are NOT a held advantage on a next roll, by move: each `(actor, item) =>
 * html`, "" where it does not apply. Drawn on the same description-only posts as the giving moves' buttons
 * (giveAdvantageCardHtml), and each wired on its own in stonetop.js's renderChatMessageHTML.
 */
const POSTED_CARD_BUTTONS = {
	[HERO_MOVES.FOCUS_FIRE]: focusFireCardHtml,
	[HERO_MOVES.RAPIER_WIT]: rapierWitCardHtml,
	[HERO_MOVES.TRUTH]: truthCardHtml,
	[HERO_MOVES.SPEAK_SOFTLY]: speakSoftlyCardHtml,
};

/**
 * The button for a move whose card is its posted text (Countermeasures, Sage Advice), for the
 * sheet's and the hotbar's description-only posts: "" for any other move, or one not held learned.
 * `item` is the move being posted, when there is one: a move a player wrote under the book's name acts
 * as itself and gives nothing (owns-move.js#bookMoveName), nor does the book's own learned copy count
 * for it. A move with a button of its own kind (POSTED_CARD_BUTTONS) draws that instead.
 */
export function giveAdvantageCardHtml(actor, moveName, item = null) {
	const own = POSTED_CARD_BUTTONS[moveName];
	if (own) return own(actor, item);
	const rule = GIVE_ADVANTAGE_MOVES[moveName];
	if (!rule || rule.tiers || actor?.type !== "character") return "";
	if (item && bookMoveName(item, moveName) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, moveName)) return "";
	return `<div class="card-buttons stonetop-roll-actions stonetop-give-advantage-row">${buttonHtml(moveName, actor)}</div>`;
}

/**
 * The Marshal's Focus Fire (Book I p.127): "You can spend 1 Command to order your allies to bring down a foe.
 * If you do, each ally has advantage on their next damage roll against that foe." Not a held advantage on a
 * next roll but one on damage against one foe, so its posted card carries a button of its own, pressed at the
 * foe the Marshal has targeted (give-advantage-flow.js#wireFocusFire; the order is fight/hero-moves.js's).
 */
function focusFireCardHtml(actor, item) {
	if (actor?.type !== "character") return "";
	if (item && bookMoveName(item, HERO_MOVES.FOCUS_FIRE) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, HERO_MOVES.FOCUS_FIRE)) return "";
	return `<div class="card-buttons stonetop-roll-actions stonetop-focus-fire-row"><button type="button" class="stonetop-focus-fire"><i class="fas fa-crosshairs"></i> ${escHtml(localize("stonetop.fight.heroMoves.focusFire.button"))}</button></div>`;
}

/**
 * The Fox's Rapier Wit: "When you pierce an NPC's pride with a well-placed quip, they must do 1 (their
 * choice): Attack, doing +1d4 damage if they hit but giving you advantage on your next roll against them".
 * The other two choices are fiction; this one changes two rolls, so its posted card carries a button for it,
 * pressed once the NPC chooses to attack (give-advantage-flow.js#wireRapierWit; the record is
 * fight/hero-moves.js's).
 */
function rapierWitCardHtml(actor, item) {
	if (actor?.type !== "character") return "";
	if (item && bookMoveName(item, HERO_MOVES.RAPIER_WIT) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, HERO_MOVES.RAPIER_WIT)) return "";
	return `<div class="card-buttons stonetop-roll-actions stonetop-rapier-wit-row"><button type="button" class="stonetop-rapier-wit"><i class="fas fa-face-angry"></i> ${escHtml(localize("stonetop.fight.heroMoves.rapierWit.button"))}</button></div>`;
}

/**
 * The Judge's Truth or Consequences (Book I p.119): "If the answer is 'Yes,' you have advantage on your next
 * roll against them. When you lie or otherwise deceive someone through words, you have disadvantage on your
 * next roll against them." No roll, so its posted card carries a button for each half, each asking whom
 * (give-advantage-flow.js#wireTruthOrConsequences; the record is fight/hero-moves.js's). Pressed as often as
 * the fiction calls for: a second press at the same person replaces their entry.
 */
function truthCardHtml(actor, item) {
	if (actor?.type !== "character") return "";
	if (item && bookMoveName(item, HERO_MOVES.TRUTH) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, HERO_MOVES.TRUTH)) return "";
	const button = (mode, icon) => `<button type="button" class="stonetop-truth" data-truth="${mode}"><i class="fas ${icon}"></i> ${escHtml(localize(`stonetop.fight.heroMoves.truth.${mode}Button`))}</button>`;
	return `<div class="card-buttons stonetop-roll-actions stonetop-truth-row">${button("adv", "fa-eye")}${button("dis", "fa-masks-theater")}</div>`;
}

/**
 * The Marshal's Speak Softly (Book I p.127): "When you offer peace but your enemy refuses, gain advantage on your
 * next roll against them." Not a held advantage on whatever roll comes next but one against that enemy, so its
 * posted card carries a button of its own, pressed once they refuse: it asks who (the one targeted, else a foe
 * in the fight, else a name) and records them on the Marshal (give-advantage-flow.js#wireSpeakSoftly; the
 * record is fight/hero-moves.js's).
 */
function speakSoftlyCardHtml(actor, item) {
	if (actor?.type !== "character") return "";
	if (item && bookMoveName(item, HERO_MOVES.SPEAK_SOFTLY) == null) return "";
	if (!ownsLearnedBookMoveNamed(actor, HERO_MOVES.SPEAK_SOFTLY)) return "";
	return `<div class="card-buttons stonetop-roll-actions stonetop-speak-softly-row"><button type="button" class="stonetop-speak-softly"><i class="fas fa-dove"></i> ${escHtml(localize("stonetop.fight.heroMoves.speakSoftly.button"))}</button></div>`;
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
