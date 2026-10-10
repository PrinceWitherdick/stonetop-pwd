import { maybeRemindPotentialForGreatness } from "../actors/character/WouldBeHeroAsterisk.js";
import { WOUND_STATUS_LABEL } from "../actors/character/wound-display.js";
import { normalizeWoundList } from "../actors/character/wound-record.js";
import { escHtml, formatOutcomeDetail, stripHtmlToText, sign } from "./strings.js";
import { pickLimitsFrom } from "./move-picks.js";
import { pickLeadText, TIER_KEYS, TIER_LABELS } from "./move-results.js";
import { markRolledTier, moveTiersHtml, rollCardBody } from "./move-tiers.js";
import { stonetopChatCard, springRollCardBody, rollFormulaChip, rollResultNumber, dieResultsText, multiDieFaces, damageMark, damageBadge, damageKeywordsHtml, pickListItem, descriptionPickTiers, cardNoticeHtml, whisperedAs } from "./chat.js";
import { adjustXp } from "./xp.js";
import {
	XP_MARK_FLAG, XP_MARK_FOR_FLAG, MISS_XP_FLAG, MISS_XP_STATE_FLAG, MISS_XP_ACTOR_FLAG, MISS_XP_BY_CHOICE_FLAG, XP_PER_MISS,
	MISS_XP_CHOICE_LATCHES,
	liveMissReceipt, missReceipts, missXpIsByChoice, missXpMarked, missXpWaived, takeBackXpMark,
} from "./undo-xp-mark.js";
import { inCardTurn } from "./card-queue.js";
import { pressRollCard, registerRollCardAction } from "./roll-card-writer.js";
import { speakerActor } from "./speaker-actor.js";
import { composeDamageFormula, seedBonus, extraTerm } from "./damage.js";
import { SYSTEM_ID } from "../system-id.js";
import { getBooleanSetting } from "../settings.js";
import { privateMessageModeOptions, deletionEntry } from "./foundry-compat.js";
import { CRITICAL_TOTAL, ROLLED_FLAG, rolledRecord, countedNote, cardCountedTier } from "./counted-tier.js";
import { SEASONAL_GAINS } from "../dialogs/spring-burst-data.js";

// What a miss is worth (Book I p.209: "a tick mark that raises your total by 1"). Named because
// the mark and the Undo that takes it back have to agree, and a card stamped by one number and
// reversed by another is a bug that only shows up as a total nobody can account for. Defined with the
// take-back in ./undo-xp-mark.js, which needs the same number.

// Defined in ./counted-tier.js (its tier ladder reads it too), re-exported here where its readers already reach for it.
export { CRITICAL_TOTAL };

const _STAT_LABELS = {
	str: "Strength", dex: "Dexterity", int: "Intelligence",
	wis: "Wisdom", con: "Constitution", cha: "Charisma",
};

/**
 * The dice half of a PbTA roll, for a mode. Advantage rolls three and keeps the best two.
 *
 * Exported because the spring Seasons Change roll is not made here: it is handed to the table
 * as a chat card and rolled on whoever's machine clicks it, from a formula built in stonetop.js.
 * That formula was `2d6` outright, so a roll made at advantage lost it on the way across.
 */
export function pbtaDiceFormula(rollMode) {
	return rollMode === "adv" ? "3d6kh2" : rollMode === "dis" ? "3d6kl2" : "2d6";
}

function _rollFormula(rollMode, modifier = 0) {
	const dice = pbtaDiceFormula(rollMode);
	return modifier !== 0 ? `${dice}+@stat+@mod` : `${dice}+@stat`;
}

/**
 * Classify a 2d6 PbtA total into its tier: success (10+) / partial (7-9) / failure (6-).
 * `key` doubles as the chat-card result CSS class.
 */
export function classifyResult(total) {
	if (total >= 10) return { key: "success", label: "Strong Hit" };
	if (total >= 7)  return { key: "partial", label: "Weak Hit"   };
	return                   { key: "failure", label: "Miss"       };
}

// Defined in ./strings.js, re-exported here because ten modules already reach for it at this name.
export { sign };

// The spring Seasons Change result table (Book I): the rolling PC picks a seasonal
// gain on a 7+. Shared by the Spring Burst walkthrough, the steading's Seasons Change
// flow, and the chat "ask the most hopeful to roll" prompt so all three stay in step.
export const SPRING_SEASONS_RESULT = {
	success: { label: TIER_LABELS.success, line: "Pick <strong>one seasonal gain</strong>." },
	partial: { label: TIER_LABELS.partial, line: "Pick <strong>one seasonal gain</strong>, but a threat to the steading makes itself known or gets worse." },
	failure: { label: TIER_LABELS.failure, line: "<strong>Threats abound</strong> &mdash; and don't mark XP." },
};

/**
 * The six seasonal gains as roll-card options, so the players reading the result can see what
 * they are choosing from rather than asking the GM to read the list out. Name in bold, then its
 * effect, as the book prints them.
 *
 * From the same SEASONAL_GAINS the GM's Seasons Change window ticks off, so the card and the
 * window say the same six things in the same words.
 */
export const SEASONAL_GAIN_PICKS = SEASONAL_GAINS.map(g => ({
	html: `<strong>${escHtml(g.name)}:</strong> ${escHtml(g.text)}`,
}));

/**
 * The gains per tier, for every +Fortunes Seasons Change roll that picks from them (spring,
 * summer, autumn). A 10+ and a 7-9 pick; a 6- picks nothing, so it has no list, and a GM's
 * Shift Up/Down shows or hides the list with the tier. How MANY is the tier's own result line
 * ("pick 2 seasonal gains").
 */
export const SEASONAL_GAIN_POOLS = Object.freeze({
	success: SEASONAL_GAIN_PICKS,
	partial: SEASONAL_GAIN_PICKS,
});

/**
 * The roll-card options that put the gains on a Seasons Change result, spread into rollStat's or
 * rollSeasonsCard's options.
 *
 * A REFERENCE list (pickReference), not a checklist: the players say what they choose and the GM
 * enters it in the Seasons Change window, whose Done is what applies and records the gains. Boxes
 * on the card would be a second place to make the same choice, and one Done never reads.
 */
export const SEASONAL_GAIN_LIST = Object.freeze({
	pickOptions: SEASONAL_GAIN_POOLS,
	pickReference: Object.freeze({ title: "Seasonal gains", hint: "tell the GM what you choose" }),
});

// The Inn's own +Fortunes roll, which is a SECOND roll the season makes and not a variant of the
// one above: "Henceforth, when the Seasons Change, whoever is friendliest rolls +Fortunes: on a
// 10+, ask the GM 3 questions about the wider world; on a 7-9, ask 1 question; on a 6-, ask 1
// question, but the GM describes some trouble that stems from the inn or its guests."
//
// Every season, not just spring — the improvement says "when the Seasons Change" with no season
// named — and handed to the table like spring's is, because "whoever is friendliest" is a player.
const INN_SEASONS_RESULT = {
	success: { label: TIER_LABELS.success, line: "Ask the GM <strong>3 questions</strong> about the wider world." },
	partial: { label: TIER_LABELS.partial, line: "Ask the GM <strong>1 question</strong> about the wider world." },
	failure: { label: TIER_LABELS.failure, line: "Ask <strong>1 question</strong>, but the GM describes some trouble that stems from the inn or its guests." },
};

/**
 * Every roll the Seasons Change hands to the table: what its card SAYS, and the ladder its
 * answer is read against, in one entry apiece.
 *
 * A registry rather than a table passed through the card, because what crosses to the player's
 * machine is HTML: a chat button can carry an id and nothing else. The id is also why the
 * default matters — cards posted before the Inn's roll existed carry no `data-table` at all, and
 * they are all spring cards.
 *
 * The wording lives HERE, beside the ladder, rather than at the call site that posts it: the two
 * halves are keyed by the same id and are useless apart, and a third handed-over roll should be
 * one row added here rather than a row plus four strings somewhere in a season dialog.
 */
export const SEASONS_ROLL_TABLES = {
	spring: {
		lead:    "Spring bursts forth!",
		asks:    "most hopeful",
		tail:    "for the <em>Seasons Change</em>",
		results: SPRING_SEASONS_RESULT,
		picks:   SEASONAL_GAIN_LIST,
	},
	inn: {
		lead:    "Talk at the inn turns to the world beyond.",
		asks:    "friendliest",
		tail:    "for the inn",
		results: INN_SEASONS_RESULT,
	},
};

/** One entry, falling back to spring's for a card that names none. */
function _seasonsRollEntry(id) {
	return SEASONS_ROLL_TABLES[id] ?? SEASONS_ROLL_TABLES.spring;
}

/** The result table a handed-over roll names, falling back to spring's for a card that has none. */
export function seasonsRollTable(id) {
	return _seasonsRollEntry(id).results;
}

/**
 * What a handed-over roll's result card lists to choose from, as options to spread into
 * rollSeasonsCard's (`pickOptions` and `pickReference`); empty when it lists nothing.
 */
export function seasonsRollPicks(id) {
	return _seasonsRollEntry(id).picks ?? {};
}

/** Wrap a list of pre-rendered `<li>` inner-HTML strings in the shared "Results" legend
 *  block, so every result table (roll cards, homestead / season walkthroughs) renders the
 *  same chrome from one place instead of each caller re-emitting the wrapper markup. */
export function resultsLegendHtml(rows) {
	return `<div class="stonetop-homestead-reference">
		<strong>Results</strong>
		<ul>${(rows ?? []).map(r => `<li>${r}</li>`).join("")}</ul>
	</div>`;
}

/**
 * A `{ label, line }` result table as the move card's own tier ladder, with the rung the dice
 * landed on marked: the same `ul.stonetop-move-tiers` a move's description carries on its roll
 * card, so a handed-over Seasons Change reads like any other move rather than wearing a boxed
 * legend of its own under the result. The lines are markup (a bold phrase) and the ladder prints
 * plain text, so they are flattened here; the result block above keeps the bold.
 */
function _resultTableLadder(resultTable, tier) {
	const moveResults = Object.fromEntries(TIER_KEYS
		.filter(key => resultTable?.[key])
		.map(key => [key, { label: resultTable[key].label, value: stripHtmlToText(resultTable[key].line) }]));
	return markRolledTier(moveTiersHtml(moveResults), tier);
}

// The title row's "?" that reveals a hidden move description, shared by every card that carries one.
const DESC_TOGGLE_HTML = `<button class="stonetop-roll-card-desc-toggle" type="button" title="Show move description"><i class="fas fa-question-circle"></i></button>`;

// The die-faces readouts live with the card pieces (utils/chat.js); re-exported for the callers that
// have always taken them from here.
export { dieResultsText, multiDieFaces };

/**
 * Roll a Seasons-Change-style omen card (Spring Burst's first spring, the
 * Expedition's Requisition): evaluate `formula`, classify the tier, post a
 * `stonetop-spring-card` to chat, and hand back `{ total, tier, label }` so the
 * walkthrough can highlight the matching outcome. `resultTable` maps each tier
 * key to `{ label, line }`. Keeps the two cards in lockstep by construction.
 *
 * Speaker/title: pass `title` to head the card with it (like a stat roll's
 * "Dexterity") and speak the card as whoever made the roll (ChatMessage.getSpeaker) —
 * used by the chat "Roll +Fortunes" button, so the result is spoken by the player who
 * clicked it. Pass `alias` instead to speak the card under a fixed name, which then
 * heads it too (the Expedition Requisition card).
 */
export async function rollSeasonsCard({ formula, title = "", alias = "", resultTable, resultLegend = "", missCountsAsPartial = "", countsAsMiss = "", conditionNotes = [], pickOptions = null, pickReference = null, tierActions = null, actor = null } = {}) {
	const roll = await new Roll(formula).evaluate();
	const rolled = classifyResult(roll.total).key;
	// As rollStat's option of the same name: a 6- that a rule counts as a 7-9, said on the card.
	const counted = missCountsAsPartial && rolled === "failure";
	// And the other way: a roll a rule makes "automatically a 6-" (Book II's storm curse on the
	// next Seasons Change roll). Still rolled, so the card shows what the dice would have said.
	const forced = countsAsMiss && rolled !== "failure";
	const tier = forced ? "failure" : counted ? "partial" : rolled;
	const result = resultTable[tier];
	// And rollStat's `pickOptions` + `pickReference`: what the tier chooses from, listed to READ
	// under the legend (spring's seasonal gains). Only ever a reference list here: nothing rolled
	// from this card has a checklist of its own.
	const reference = pickReference ? pickReferenceHtml(normalizePickPools(pickOptions), tier, pickReference) : "";
	// The 10+ / 7-9 / 6- ladder sits where a move card's description does: under the title and above
	// the result, with the landed rung lit. A caller's own `resultLegend` still goes below instead.
	const ladder = resultLegend ? "" : _resultTableLadder(resultTable, tier);
	const description = ladder ? `<div class="stonetop-roll-card-description">${ladder}</div>` : "";
	const body = description + springRollCardBody(
		roll.total,
		tier,
		result.label,
		forced ? `${result.line} <em>(Counted as a 6-: ${escHtml(countsAsMiss)}.)</em>`
			: counted ? `${result.line} <em>(Rolled a 6-, counted as a 7-9: ${escHtml(missCountsAsPartial)}.)</em>`
			: result.line,
		roll.formula,
		multiDieFaces(roll),
		resultLegend + reference,
	// And rollStat's `conditionNotes`, in its pills: what put the roll at advantage (a held Rites
	// of the Land advantage, say), so this card says why as a stat roll's does.
	) + conditionsRowHtml(conditionNotePills(conditionNotes))
		// And rollStat's `tierActions`, for the tier landed on only (this card has no Shift to reveal
		// another): the Expedition Requisition's 6- cost button.
		+ (tierActions?.[tier]
			? `<div class="card-buttons stonetop-roll-tier-actions" data-active-tier="${escHtml(tier)}"><div class="stonetop-roll-tier-action" data-tier="${escHtml(tier)}">${tierActions[tier]}</div></div>`
			: "");
	// Titled even when spoken under an alias: the title row is what carries the "?" that brings a
	// hidden description back, and without it a table that hides descriptions would lose the ladder.
	// `actor` rides an aliased speaker so a card button can find what it acts on (speakerActor).
	await roll.toMessage({
		speaker: alias ? { alias, ...(actor?.id ? { actor: actor.id } : {}) } : ChatMessage.getSpeaker(),
		flavor:  stonetopChatCard(title || alias, body, "stonetop-spring-card", description ? DESC_TOGGLE_HTML : ""),
	});
	return { total: roll.total, tier, label: result.label };
}

/**
 * Post a chat card asking the most hopeful character's player to make the spring
 * Seasons Change roll (+Fortunes). The card carries a button anyone at the table can
 * click to roll it (wired in stonetop.js `_chatWireSeasonsRoll`, which rolls the carried
 * dice + Fortunes against SPRING_SEASONS_RESULT). `hopeful` is the recorded
 * "most hopeful" note, if any; `fortunes` is the steading's +Fortunes modifier.
 *
 * `rollMode` and `why` carry the roll's CONDITIONS across, because this is the one roll in the
 * system that is decided in one place and made in another. Spring's Seasons Change is only ever
 * handed to the table — the window offers no roll button of its own — so a Blessed who
 * sacrificed Surplus for "advantage on the steading's next +Fortunes roll" (Rites of the Land)
 * had bought a thing that could not be spent on the very roll it names. The GM's side reads and
 * clears the hold and stamps the answer here; the button is then only a trigger, which is right,
 * since the player who clicks it may not own the steading and could not read the hold anyway.
 *
 * `modifier` and `countsAsMiss` cross the same way, for what the GM settled in the pre-roll prompt:
 * Preparation spent from Bolstering for the season (Book I p. 516 lets it be spent on this roll),
 * or Book II's storm curse, which makes the next Seasons Change roll "automatically a 6-". The
 * other seasons' rolls take both from the prompt and their card's Shift buttons; this one has
 * neither on its card, so without them it was the one Seasons Change roll nothing could adjust.
 *
 * @param {string} [rollMode]  "adv" | "dis" | "normal" — NOT core's public/gmroll/blind.
 * @param {string} [why]       What bought the advantage, named on the card so the table can see
 *   the sacrifice land rather than reading two extra dice and wondering.
 * @param {number} [modifier]  a one-off plus or minus on top of Fortunes
 * @param {string} [countsAsMiss]  why the roll is a 6- whatever the dice say, or "" for no such rule
 * @returns {Promise<ChatMessage>|undefined} the card being posted, so a caller spending the hold
 *   can wait until it is up
 */
export function postSeasonsRollPrompt({
	alias = "Seasons Change: Spring",
	hopeful = "",
	fortunes = 0,
	rollMode = "normal",
	why = "",
	modifier = 0,
	countsAsMiss = "",
	// WHICH handed-over roll this is. Everything that differs between them — the opening line,
	// who is asked, what the roll is for, and the ladder the answer is read against — comes off
	// its entry in SEASONS_ROLL_TABLES, so a caller names the roll and nothing else.
	table = "spring",
} = {}) {
	if (!globalThis.ChatMessage) return;
	const { lead, asks, tail } = _seasonsRollEntry(table);
	const who = hopeful ? `<strong>${escHtml(hopeful)}</strong>` : `Whoever is <strong>${escHtml(asks)}</strong>`;
	// One plain line rather than the roll card's pill row: this is a small ask-card, and what a
	// player needs before clicking is a sentence, not a badge. It names the source when there is
	// one, because two extra dice with nothing explaining them is a table wondering whether the
	// button is broken.
	const named = rollMode === "adv" ? "advantage" : rollMode === "dis" ? "disadvantage" : "";
	const conditions = (named
		? `<p class="stonetop-seasons-prompt-mode"><em>Rolled with <strong>${named}</strong>${why ? `: ${escHtml(why)}` : ""}.</em></p>`
		: "")
		+ (countsAsMiss
			? `<p class="stonetop-seasons-prompt-mode"><em>Counts as a <strong>6-</strong> whatever the dice say: ${escHtml(countsAsMiss)}.</em></p>`
			: "");
	const mod = Math.trunc(Number(modifier)) || 0;
	const plus = mod ? ` ${sign(mod)}` : "";
	const body = `<div class="card-content stonetop-seasons-prompt">
		<p class="stonetop-seasons-prompt-text">${lead} ${who}, roll <strong>+Fortunes</strong> (${sign(fortunes)})${plus} ${tail}.</p>
		${conditions}
		<div class="card-buttons stonetop-card-buttons">
			<button type="button" class="stonetop-seasons-roll-btn" data-fortunes="${fortunes}" data-mod="${mod}" data-counts-as-miss="${escHtml(countsAsMiss)}" data-alias="${escHtml(alias)}" data-roll-mode="${escHtml(rollMode)}" data-table="${escHtml(table)}">
				<i class="fas fa-dice-d6"></i> Roll +Fortunes (${sign(fortunes)})${plus}
			</button>
		</div>
	</div>`;
	return ChatMessage.create({
		speaker: { alias },
		content: stonetopChatCard(alias, body, "stonetop-seasons-prompt-card"),
	});
}

/**
 * A card's "choose from this list" options, in ONE shape however they were declared.
 *
 * An ARRAY is a single pool every tier draws from (a love letter: one list, the tier only says
 * how many to take). An OBJECT names a pool per tier, for a move whose lists genuinely differ —
 * Deploy picks its 10+/7-9 outcome from one list and its 6- consequences from another.
 *
 * Returns `{ shared, byTier }`. `shared` is the array form's one list (null for the per-tier
 * form), and `byTier` always names all three tiers either way, so callers can ask "does this
 * tier have a pool" without a null check.
 */
export function normalizePickPools(pickOptions) {
	const clean = list => (Array.isArray(list) ? list.filter(Boolean) : []);
	const shared = Array.isArray(pickOptions) ? clean(pickOptions) : null;
	return {
		shared,
		byTier: Object.fromEntries(TIER_KEYS.map(tier => [tier, shared ?? clean(pickOptions?.[tier])])),
	};
}

/**
 * How many each tier lets the player take, from whichever of the two ways a move says so.
 *
 * DECLARED, when the move authored a number: a love letter's builder asks "How many to pick" per
 * tier and stores it (move-results.js#buildMoveTierResults), and the card's outcome line is
 * composed FROM that number ("Pick 2 from the list below").
 *
 * READ FROM THE PROSE otherwise: the homefront moves state their count inside the tier's own
 * result text — "the job gets done, but pick 1", "the GM chooses 2 consequences" — with no
 * separate field, deliberately, so the sentence a player reads and the count are one thing. That
 * sentence is read by the same timid reader a printed move's lead-in goes through
 * (utils/move-picks.js), which returns nothing rather than guess, so a tier whose wording it
 * cannot place stays uncapped and its tally simply shows no denominator.
 *
 * Read PER TIER, against that tier's line alone. `pickLimitsFrom` can answer with an object when
 * the text it was given names tiers of its own; a single tier's line should not, but if it does,
 * only that tier's own answer is taken — never another's.
 */
export function tierPickCounts(moveResults) {
	const countFor = (tier) => {
		const row = moveResults?.[tier];
		const declared = Math.trunc(Number(row?.pick)) || 0;
		if (declared > 0) return declared;
		const read = pickLimitsFrom(stripHtmlToText(String(row?.value ?? "")));
		return (typeof read === "number" ? read : Math.trunc(Number(read?.[tier])) || 0) || 0;
	};
	return Object.fromEntries(TIER_KEYS.map(tier => [tier, countFor(tier)]));
}

/**
 * The checklist(s) under a roll card's result. Each item is a checkbox wired up on the client
 * (see _chatWireLoveLetterPicks); `data-index` runs across the WHOLE card so the persisted
 * checked-state array lines up whichever lists are on it.
 *
 * A shared pool renders once. Per-tier pools render one list per tier that has one, all but the
 * rolled tier hidden — the same `data-active-tier` / `data-tier` dance the tier actions do, so a
 * GM Shift Up/Down reveals the list matching the new tier. The hide MUST use the VALUED
 * `hidden="hidden"`: see the note on the tier actions in {@link _rollCard}.
 *
 * `picks` is how many each tier lets the player take — the same numbers the result line says in
 * words ("Pick 2 from the list below"), stamped on the list as the `data-pick-max*` a printed
 * move's list already carries (chat.js#pickableMoveDescription). One attribute, read by one
 * reader in stonetop.js, which both caps the ticking and gives the tally above the list its
 * denominator ("1/2 options selected") — so a count stated in the card's prose and the count the
 * boxes enforce cannot disagree.
 *
 * A SHARED pool is stamped per tier, not flat: one list serves all three, and the cap has to move
 * with a GM's Shift Up/Down exactly as the wording above it does. A per-tier list is stamped flat,
 * because it is only ever shown on the one tier it belongs to.
 */
/**
 * Which tiers show their options as ticked boxes under the card, from the same pools
 * {@link pickListsHtml} renders. A shared pool serves every tier; a per-tier pool serves the
 * tier it belongs to. The result block reads this to decide whether to reprint the tier's
 * options inside itself: when the boxes below already list them, it prints the lead-in alone
 * ("...and pick 1:") rather than saying the same three options twice, once unclickable.
 */
export function pickedTiers(pools) {
	return TIER_KEYS.filter(tier => pools.byTier[tier].length);
}

// One pick option's row markup. An option is plain text, escaped here, or `{ html }` for a row
// that is already markup (the seasonal gains, whose names are bold as the book prints them).
const _pickOptionHtml = option => (typeof option === "string" ? escHtml(option) : String(option?.html ?? ""));

export function pickListsHtml(pools, activeTier, picks = null) {
	let index = 0;
	// Rows through the shared emitter (utils/chat.js), so this surface and a move's own printed
	// list cannot drift apart on the class names the tally and cap wiring keys off.
	const list = (options, limitAttrs = "") => `<ul class="stonetop-picklist"${limitAttrs}>${
		options.map(option => pickListItem(_pickOptionHtml(option), index++)).join("")}</ul>`;
	// A tier that states no count of its own (a homefront move's 6- consequences, whose result
	// text already says how many) stamps nothing and ticks freely, same as an unreadable move.
	const cap = tier => (Math.trunc(Number(picks?.[tier])) || 0);

	if (pools.shared) {
		if (!pools.shared.length) return "";
		return list(pools.shared, TIER_KEYS.map(t => (cap(t) ? ` data-pick-max-${t}="${cap(t)}"` : "")).join(""));
	}

	const tiers = TIER_KEYS.filter(tier => pools.byTier[tier].length);
	if (!tiers.length) return "";
	return `<div class="stonetop-roll-tier-picklists" data-active-tier="${escHtml(activeTier)}">
		${tiers.map(tier =>
			`<div class="stonetop-roll-tier-picklist" data-tier="${escHtml(tier)}"${tier === activeTier ? "" : ` hidden="hidden"`}>${list(pools.byTier[tier], cap(tier) ? ` data-pick-max="${cap(tier)}"` : "")}</div>`
		).join("")}
	</div>`;
}

/**
 * The same pools as {@link pickListsHtml}, as a list to READ rather than tick: for a choice the
 * players say aloud and the GM records somewhere else (the seasonal gains, entered in the Seasons
 * Change window). No checkbox, no cap and no tally, so none of the pick wiring in stonetop.js
 * finds anything to bind; spiral bullets instead, in the titled box the Results legend above it
 * wears (`.stonetop-homestead-reference`), because it is read the same way the legend is.
 *
 * Per tier like a checklist, with the same `data-active-tier` / `data-tier` wrappers and the same
 * VALUED `hidden="hidden"`, so a GM's Shift Up/Down shows the list on the tier that picks and hides
 * it on the one that does not (see _shiftRollCardFlavor in stonetop.js).
 *
 * @param {{shared: Array|null, byTier: object}} pools  from normalizePickPools
 * @param {string} activeTier  the tier the roll landed on
 * @param {{title?: string, hint?: string}} [reference]  the box's heading, and a quieter note
 *   beside it saying what to do with the list
 */
export function pickReferenceHtml(pools, activeTier, { title = "", hint = "" } = {}) {
	const heading = (title ? `<strong>${escHtml(title)}</strong>` : "")
		+ (hint ? ` <span class="stonetop-roll-reference-hint">(${escHtml(hint)})</span>` : "");
	const box = options => `<div class="stonetop-homestead-reference stonetop-roll-reference">${heading}<ul>${
		options.map(option => `<li>${_pickOptionHtml(option)}</li>`).join("")}</ul></div>`;

	if (pools.shared) return pools.shared.length ? box(pools.shared) : "";

	const tiers = pickedTiers(pools);
	if (!tiers.length) return "";
	return `<div class="stonetop-roll-tier-picklists" data-active-tier="${escHtml(activeTier)}">
		${tiers.map(tier =>
			`<div class="stonetop-roll-tier-picklist" data-tier="${escHtml(tier)}"${tier === activeTier ? "" : ` hidden="hidden"`}>${box(pools.byTier[tier])}</div>`
		).join("")}
	</div>`;
}

function _rollCard({ header, result = "", resultClass = "", resultDetail = "", keywords = "", resultOutcomes = null, resultLegend = "", pickList = "", pickTiers = [], tierActions = null, conditionsHtml = "", noticesHtml = "", buttons = false, actions = "", total = null, formula = "", description = "", dieResults = "", badge = "", sectionClass = "", damage = false, countsAs = null }) {
	// Stash every tier's outcome on the row so a GM Shift Up/Down can swap the
	// detail line to match the new tier (see _shiftRollCardFlavor in stonetop.js).
	const outcomeAttrs = resultOutcomes
		? ` data-outcome-success="${escHtml(resultOutcomes.success ?? "")}"`
			+ ` data-outcome-partial="${escHtml(resultOutcomes.partial ?? "")}"`
			+ ` data-outcome-failure="${escHtml(resultOutcomes.failure ?? "")}"`
		: "";
	// ...and which of those tiers has its options offered below, so the shift keeps printing
	// the lead-in alone on a tier whose list is already on the card (see `detailHtml`).
	const pickedAttr = pickTiers.length ? ` data-picked-tiers="${escHtml(pickTiers.join(" "))}"` : "";
	// ...and the bends the roll carried, each by the rule's name, whether or not it fired: a rewrite reads
	// them back (utils/counted-tier.js#rolledRecord takes this dataset as is) so a 7-9 lifted to an 8 on a
	// Let's Make a Deal roll is still the 10+ it counts as, and says why.
	const countsAsAttrs = [["miss-counts-as-partial", countsAs?.missCountsAsPartial],
		["partial-counts-as-success", countsAs?.partialCountsAsSuccess]]
		.filter(([, why]) => why).map(([name, why]) => ` data-${name}="${escHtml(why)}"`).join("");
	// The tier's own options are reprinted inside the result block ONLY when nothing below lists
	// them -- neither the checklist nor the tier controls. A card that offers them as boxes shows
	// the lead-in here and the boxes there, so one choice is stated once.
	const detailHtml = formatOutcomeDetail(resultDetail, { introOnly: pickTiers.includes(resultClass) });
	// The die formula gets its own chip above the result, mirroring Foundry's vanilla
	// dice-formula placement. We hide Foundry's auto-rendered dice block in CSS, so
	// this is the only place the formula appears. The chip carries the individual die
	// faces ("2, 4") as a hover tooltip — hovering "2d6" to see what the d6s came up is
	// the intuitive spot (the total below carries the same readout for discoverability).
	const formulaHtml = formula ? rollFormulaChip(formula, dieResults) : "";

	// One left-edge result block: the rolled total plus (for move / Death's-Door rolls)
	// the hit tier and its per-tier outcome, colour-coded down the left edge. Replaces
	// the old separate centred readout + boxed "Weak Hit" label. Cards without a roll
	// (e.g. the "+1 XP on a miss" follow-up) pass no total and just show the label.
	// A damage roll has no hit tier to colour the block, so its total wears the red burst
	// mark instead — the same one the attack flow's per-target damage rows use.
	const resultNumberHtml = damage ? damageMark(total, dieResults) : rollResultNumber(total, dieResults);
	const resultBlockHtml = (total != null || result)
		? `<div class="stonetop-roll-result ${resultClass}"${outcomeAttrs}${pickedAttr}${countsAsAttrs}>
			${total != null ? resultNumberHtml : ""}
			<div class="stonetop-roll-result-body">
				${result ? `<span class="stonetop-roll-result-label">${result}</span>` : ""}
				<span class="stonetop-roll-result-details">${detailHtml}</span>
				${keywords ? `<span class="stonetop-roll-result-details stonetop-damage-keywords">${damageKeywordsHtml(keywords)}</span>` : ""}
			</div>
		</div>`
		: "";
	const bodyHtml = (formulaHtml || resultBlockHtml)
		? `<div class="card-content">${formulaHtml}${resultBlockHtml}</div>`
		: "";
	// Emit an action row for EVERY tier that defines one (not just the rolled tier), hiding
	// all but the active tier, so a GM Shift Up/Down can reveal the matching action — e.g. the
	// Requisition miss-cost button when a card is shifted down into a miss. _shiftRollCardFlavor
	// toggles these rows by data-tier; if only the rolled tier's row exists it has nothing to show.
	// The hide MUST use hidden="hidden" (valued), not a bare `hidden`: flavor is an HTMLField that
	// Foundry v14 runs through sanitize-html, which strips valueless boolean attributes — a bare
	// `hidden` vanishes server-side and every tier renders visible (see _shiftRollCardFlavor).
	const tierActionEntries = Object.entries(tierActions ?? {}).filter(([, html]) => html);
	const tierActionsHtml = tierActionEntries.length
		? `<div class="card-buttons stonetop-roll-tier-actions" data-active-tier="${escHtml(resultClass)}">
			${tierActionEntries.map(([tier, html]) =>
				`<div class="stonetop-roll-tier-action" data-tier="${escHtml(tier)}"${tier === resultClass ? "" : ` hidden="hidden"`}>${html}</div>`
			).join("")}
		</div>`
		: "";
	const resultLegendHtml = resultLegend
		? `<div class="stonetop-roll-card-results">${resultLegend}</div>`
		: "";
	// The "choose from this list" checklist(s) — see pickListsHtml, which builds them, and
	// _chatWireLoveLetterPicks, which wires the boxes up client-side.
	const pickListHtml = pickList
		? `<div class="stonetop-roll-card-picklist">${pickList}</div>`
		: "";
	const descriptionHtml = description
		? `<div class="stonetop-roll-card-description">${description}</div>`
		: "";
	const descToggleHtml = description ? DESC_TOGGLE_HTML : "";
	const buttonsHtml = buttons
		? `<div class="card-buttons stonetop-card-buttons">
			<button data-action="shiftDown"><i class="fas fa-arrow-down"></i> Shift Down</button>
			<button data-action="shiftUp"><i class="fas fa-arrow-up"></i> Shift Up</button>
		</div>`
		: "";
	// A row of the card's OWN controls, deliberately not the `.stonetop-card-buttons` row above.
	// That one is shared property: roll-shifting injects into it and Burn Brightly appends to it,
	// and both find it by that exact class. A card that rendered its own buttons there would be
	// offering a Burn Brightly on a receipt with no roll behind it.
	const actionsHtml = actions
		? `<div class="card-buttons stonetop-roll-actions">${actions}</div>`
		: "";

	return `<section class="pbta-chat-card stonetop-roll-card${sectionClass ? ` ${sectionClass}` : ""}">
		<div class="cell cell--chat">
			<div class="chat-title row flexrow">
				<h2 class="cell__title">${escHtml(header)}</h2>
				${badge}
				${descToggleHtml}
			</div>
			${descriptionHtml}
			${bodyHtml}
			${noticesHtml}
			${resultLegendHtml}
			${pickListHtml}
			${tierActionsHtml}
			${conditionsHtml}
			${actionsHtml}
			${buttonsHtml}
		</div>
	</section>`;
}

// A lasting-injury reminder for the move being rolled: any non-healed wound that
// carries a mechanicalTag and is set to remind on this move (or on "*", all rolls).
// A reminder only — it never changes the roll; the GM/player applies it in the fiction.
function _woundReminderHtml(actor, moveName) {
	// Read as the sheet reads them (wound-record.js), so a record the sheet shows is one this sees.
	const wounds = normalizeWoundList(actor?.system?.attributes?.wounds);
	if (!wounds.length) return "";
	// "Ask" moves (Defy Danger/Interfere) and fixed moves rolled with an alternate stat
	// arrive here as "<Name> with <STAT>" (see StonetopItem.roll), but the reminder picker
	// stores the bare move name — so compare against the base so a reminder on "Defy Danger"
	// still fires whether it's rolled +WIS or +CON, and "Clash" fires for +STR or +DEX.
	const baseName = typeof moveName === "string"
		? moveName.replace(/ with (?:STR|DEX|CON|INT|WIS|CHA)$/, "")
		: moveName;
	const matches = wounds.filter(w =>
		w && !w.healed && w.mechanicalTag &&
		(w.reminderMove === "*" || (baseName && w.reminderMove === baseName)),
	);
	return cardNoticeHtml({
		className: "stonetop-roll-wound-notice",
		icon: "fa-triangle-exclamation",
		title: "Lasting injury",
		items: matches.map(w => `<li>${escHtml(w.mechanicalTag)}</li>`),
	});
}

// Which wound statuses can still explain a bad roll. `problematic` is the book's own name for a
// wound with live fictional consequences, and `permanent` is one that can never be dealt with --
// the book's own example, a severed hand, is both. `stabilized` is the one that HAS been tended
// (Recover: "the GM will say it's taken care of"), so it is waiting on time rather than
// complicating anything, and naming it here would turn the prompt into a list of old scars.
const JUSTIFYING_WOUND_STATUSES = new Set(["problematic", "permanent"]);

// Book I p.243, "Problematic wounds in play": incorporate problematic wounds into the fiction and
// into your GM moves, and when a player rolls a 7-9 or a 6-, maybe use the wound to justify the
// result. The book's rule, our wording -- and one line that has to read true at BOTH tiers, since
// a 7-9 is a success that costs rather than a failure.
const WOUND_JUSTIFY_LEAD = "Maybe one of these explains the result. Bring the injury to the front "
	+ "of the story, or let it complicate what happens next.";

// The tiers that prompt is for, in TIER_KEYS order so the rows come out the way every other
// per-tier block on the card does. Deliberately NOT `success`: a 10+ is the move working, and a
// card that offered the wound as an explanation there would be inviting a GM move off a hit.
const WOUND_JUSTIFY_TIERS = TIER_KEYS.filter(tier => tier !== "success");

// The prompt's own body: the advice, then which injuries are actually in play, so a GM reaching
// for one does not have to open the sheet to remember what they wrote down.
//
// Separate from the `Lasting injury` notice above, and both can sit on one card: that one echoes
// what a wound DOES (its mechanical tag, on the move it was keyed to), this one asks what a wound
// MEANS for the result just rolled. They name a wound by different strings for that reason -- the
// tag there, the wound as written here -- so the same injury appearing in both is not the same
// line said twice.
function _woundJustifyNotice(actor) {
	// Normalized as the sheet reads them: a record stored with a blank status shows there as
	// problematic, so it is one here too.
	const wounds = normalizeWoundList(actor?.system?.attributes?.wounds);
	if (!wounds.length) return "";
	const items = wounds
		.filter(w => w && !w.healed && JUSTIFYING_WOUND_STATUSES.has(w.status))
		// The wound as the player wrote it, falling back to its mechanical tag for one entered as a
		// bare rule. A wound with neither is a stub nobody can narrate, so it drops out -- and if
		// every wound is a stub, `cardNoticeHtml` prints no block at all.
		.map(w => ({ label: String(w.text || w.mechanicalTag || "").trim(), status: w.status }))
		.filter(w => w.label)
		.map(w => {
			const tip = WOUND_STATUS_LABEL[w.status] ?? "";
			return `<li${tip ? ` data-tooltip="${escHtml(tip)}"` : ""}>${escHtml(w.label)}</li>`;
		});
	return cardNoticeHtml({
		className: "stonetop-roll-wound-justify-notice",
		icon: "fa-droplet",
		title: items.length === 1 ? "Problematic wound" : "Problematic wounds",
		lead: WOUND_JUSTIFY_LEAD,
		items,
	});
}

// ...wrapped so it shows on a 7-9 and a 6- and nowhere else. One copy per prompted tier inside a
// `data-active-tier` group, which is the card's established shape for anything it holds one of
// per tier (the Requisition miss-cost button, the homefront pick lists): a GM's Shift Up/Down
// swaps the group's active tier and the matching row alone survives, so a card shifted up onto a
// 10+ takes the prompt back off rather than leaving a stale one under a hit.
//
// The hide MUST be `hidden="hidden"` (valued) for the reason _rollCard gives: Foundry v14's
// sanitize-html strips valueless boolean attributes off the flavor HTMLField.
function _woundJustifyHtml(actor, resultClass) {
	// Read tolerantly and default ON: a world one build behind the one that registered the key,
	// and a unit test that never called registerSettings, both still get the prompt rather than a
	// thrown lookup that would take the whole card down with it.
	if (!getBooleanSetting("chatWoundPrompt", true)) return "";
	const notice = _woundJustifyNotice(actor);
	if (!notice) return "";
	return `<div class="stonetop-roll-wound-justify" data-active-tier="${escHtml(resultClass)}">
		${WOUND_JUSTIFY_TIERS.map(tier =>
			`<div data-tier="${escHtml(tier)}"${tier === resultClass ? "" : ` hidden="hidden"`}>${notice}</div>`
		).join("")}
	</div>`;
}

/**
 * The pill saying a bend fired ("Rolled a 7-9, counted as a 10+ (Let's Make a Deal)", utils/counted-tier.js
 * #countedNote). Its own class beside the note's, so a rewrite of the card's total can take it off or put it
 * back as the tier it counts as moves (stonetop.js#_shiftRollCardFlavor). Text, never markup.
 */
export function countedNotePill(note) {
	return `<li class="stonetop-condition-note stonetop-condition-counted">${escHtml(note)}</li>`;
}

/**
 * Put a rewritten card's bend pill in step with `note` ("" for none), inside `root` (the card's flavor,
 * parsed). A card whose only pill it was loses the "Conditions Applied" row; one that had no row gains it
 * where rollStat draws it, above the card's own controls.
 */
export function syncCountedNotePill(root, note) {
	for (const pill of root.querySelectorAll(".stonetop-roll-card .stonetop-condition-counted")) pill.remove();
	const list = root.querySelector(".stonetop-roll-card .stonetop-roll-conditions ul");
	if (note && list) {
		list.insertAdjacentHTML("beforeend", countedNotePill(note));
	} else if (note) {
		const cell = root.querySelector(".stonetop-roll-card .cell--chat");
		const row = root.ownerDocument.createElement("div");
		row.innerHTML = conditionsRowHtml([countedNotePill(note)]);
		const before = cell?.querySelector(":scope > .stonetop-roll-actions, :scope > .stonetop-card-buttons") ?? null;
		if (cell && row.firstElementChild) cell.insertBefore(row.firstElementChild, before);
	} else if (list && !list.children.length) {
		list.closest(".stonetop-roll-conditions")?.remove();
	}
}

/** A caller's own named conditions, one pill each. Text, never markup (see rollStat). */
function conditionNotePills(notes) {
	return (Array.isArray(notes) ? notes : []).filter(Boolean)
		.map(note => `<li class="stonetop-condition-note">${escHtml(note)}</li>`);
}

/**
 * The "Conditions Applied:" row a roll card wears under its result — the Advantage /
 * Forward / Situational pills.
 *
 * Exported because the attack flow's damage
 * results card is built by hand rather than by `_rollCard`, and a hand-written copy of this
 * row is a second place for the heading, the class names and the empty case to drift.
 */
export function conditionsRowHtml(conditions) {
	if (!conditions.length) return "";
	const localized = game.i18n?.localize("PBTA.ConditionsApplied");
	const label = localized && localized !== "PBTA.ConditionsApplied" && localized !== "PBTA.CONDITIONSAPPLIED"
		? localized
		: "Conditions Applied:";
	return `<div class="row row--border conditions stonetop-roll-conditions">
		<h3 class="cell__subtitle">${label}</h3>
		<ul>${conditions.join("")}</ul>
	</div>`;
}

// The card each rollStat roll was posted as, for a caller that has to write on it after the dice (the
// tier effects a roll applied: actors/character/tier-effects.js). Weak, so a roll let go of lets go of it.
const ROLL_MESSAGES = new WeakMap();

/** The chat message rollStat posted this roll as, or null for a roll it did not post. */
export function messageOfRoll(roll) {
	return (roll && typeof roll === "object" && ROLL_MESSAGES.get(roll)) || null;
}

/**
 * Roll 2d6+stat for a character move or direct stat roll.
 *
 * @param {string} statKey   - One of str/dex/int/wis/con/cha
 * @param {Actor}  actor
 * @param {object} options
 * @param {string} [options.rollMode]                  - "adv" | "dis" | "normal". NOT Foundry's
 *   core rollMode (public/gmroll/blind/self) — that is read separately from the client setting
 *   when the message is built. Anything other than "adv"/"dis" is coerced to "normal"; a "def"
 *   value was documented here for a while and never implemented, so a caller trusting it got a
 *   flat 2d6.
 * @param {number} [options.modifier]                  - Total numeric modifier (forward + ongoing + situational)
 * @param {number} [options.forward]                   - Forward portion (shown separately in card)
 * @param {number} [options.ongoing]                   - Ongoing portion (shown separately in card)
 * @param {number} [options.statValue]                 - Explicit stat value, for nonstandard actor data
 * @param {string} [options.moveName]                  - Display name for the roll header
 * @param {string} [options.resultLegend]              - Optional visible result legend HTML
 * @param {object} [options.tierActions]               - Optional HTML actions keyed by result tier
 * @param {string} [options.criticalActions]           - HTML added to the 10+ row only when the total
 *   is 12 or more (A Force to Be Reckoned With: "on a 12+ you turn the tables on them")
 * @param {string}  [options.stonetopDebility]          - Debility name for annotation
 * @param {string}  [options.stonetopDebilityTooltip]
 * @param {string}  [options.stonetopDebilityIgnored]      - What is cancelling a marked debility
 *   (the Heavy's Battle Joy). Mutually exclusive with stonetopDebility: either the debility bit,
 *   or something is ignoring it.
 * @param {string}  [options.stonetopDebilityIgnoredName]  - Which debility is being ignored
 * @param {boolean} [options.noXpOnMiss]               - Skip the automatic +1 XP on a miss (for moves that replace it)
 * @param {string}  [options.missCountsAsPartial]      - Why a 6- counts as a 7-9 on this roll, named on
 *   the card; absent for an ordinary roll
 * @param {string}  [options.partialCountsAsSuccess]   - Why a 7-9 counts as a 10+ on this roll, named the
 *   same way
 * @param {string[]} [options.whisper]                  - Post the card privately, to these user ids (the
 *   author always sees it too); absent for a card that follows the table's own chat mode
 * @param {string[]|{success?: string[], partial?: string[], failure?: string[]}} [options.pickOptions]
 *   "Choose from this list" options, rendered as a checklist on the card. An array is one pool
 *   shared by every tier (love letters); an object names a pool per tier (the homefront moves,
 *   whose 6- consequences are a different list from their 10+/7-9 options).
 * @param {{title?: string, hint?: string}} [options.pickReference] - List `pickOptions` to READ,
 *   in a titled box under the legend, rather than as a checklist (pickReferenceHtml): for a
 *   choice made aloud and recorded elsewhere, like the seasonal gains.
 * @param {boolean} [options.pickable]  false keeps the move's printed list as prose, for a list someone
 *   other than the roller answers (Interfere aimed at a PC)
 * @returns {Promise<Roll>}
 */
export async function rollStat(statKey, actor, options = {}) {
	const statValue  = options.statValue ?? actor.system?.stats?.[statKey]?.value ?? 0;
	const statLabel  = _STAT_LABELS[statKey] ?? statKey.toUpperCase();
	const rollMode   = options.rollMode ?? "normal";
	const moveName   = options.moveName ?? null;
	const modifier   = options.modifier ?? 0;
	const forward    = options.forward  ?? 0;
	const ongoing    = options.ongoing  ?? 0;

	// The move's text as a roll card lays it out, ladder and all, whether the caller built it or
	// handed over raw prose (move-tiers.js#rollCardBody). Its printed list is ticked only when the
	// roll declares no pool of its own, which would be the card's checklist instead, and only when
	// the caller has not said its list is someone else's to answer (`pickable: false`, Interfere
	// aimed at a PC: StonetopItem#roll). A body with no ladder in it is laid out again here, so the
	// caller's word has to reach this call too, not only the one that built the body.
	const declaresPool = TIER_KEYS.some(tier => normalizePickPools(options.pickOptions).byTier[tier].length);
	const moveDescription = rollCardBody(options.moveDescription ?? "", options.moveResults ?? null,
		{ pickable: options.pickable !== false && !declaresPool });

	const rollData    = modifier !== 0 ? { stat: statValue, mod: modifier } : { stat: statValue };
	const rollOptions = {
		stonetopDebility:        options.stonetopDebility        ?? null,
		stonetopDebilityTooltip: options.stonetopDebilityTooltip ?? null,
	};

	const roll   = await new Roll(_rollFormula(rollMode, modifier), rollData, rollOptions).evaluate();
	const total  = roll.total;
	// A rule that turns a miss into a weak hit (Herd of Horses: "When you Requisition half the
	// herd or less, treat a 6- as a 7-9") is applied to the TIER, so every tier-keyed part of the
	// card (outcome, pick list, buttons, the ladder's mark) reads as the 7-9 it counts as.
	const missCountsAsPartial = String(options.missCountsAsPartial ?? "").trim();
	// And one that turns a weak hit into a strong one, the same way (the Seeker's Let's Make a Deal:
	// "When you Persuade by offering them something that you know they want or need, treat a 7-9 as a 10+").
	const partialCountsAsSuccess = String(options.partialCountsAsSuccess ?? "").trim();
	const rolled = classifyResult(total);
	const result = missCountsAsPartial && rolled.key === "failure" ? classifyResult(7)
		: partialCountsAsSuccess && rolled.key === "partial" ? classifyResult(10)
		: rolled;

	// Surface the move's own per-tier outcome (10+/7-9/6-) on the result card. Some
	// moves (e.g. the Blessed's Borrow Power, Suck the Poison Out) keep their outcomes
	// only in moveResults and omit them from the description, so this is the only place
	// a player would otherwise see them.
	const moveResults    = options.moveResults ?? null;
	// The "choose from this list" pools. A love letter draws every tier from ONE list and tells
	// the player how many to take ("Pick N from the list below", kept in the outcome string —
	// not a separate element — so the GM Shift Up/Down flow surfaces the right count for
	// whatever tier it lands on). A homefront move names a list PER TIER instead: Deploy's 6-
	// consequences are a different pool from its 10+/7-9 options, and its result text already
	// says how many, so those tiers carry no count.
	const pickPools = normalizePickPools(options.pickOptions);
	// English literals on purpose: this string is persisted in the chat card (shared across
	// clients) and parsed by the GM Shift Up/Down flow, so it must not vary by locale.
	const pickLead = (n, tier) =>
		pickLeadText(n, pickPools.byTier[tier].length > 0, { pick: "Pick", fromList: "from the list below" });
	const composeOutcome = (tier) => {
		const prose = String(moveResults?.[tier]?.value ?? "").trim();
		const lead  = pickLead(moveResults?.[tier]?.pick, tier);
		if (lead && prose) return `${lead}. ${prose}`;
		return lead || prose;
	};
	const resultOutcomes = moveResults
		? {
			success: composeOutcome("success"),
			partial: composeOutcome("partial"),
			failure: composeOutcome("failure"),
		}
		: null;
	const resultDetail = resultOutcomes?.[result.key] ?? "";

	// A pool the caller marked as a REFERENCE is listed to read under the legend instead (the
	// seasonal gains: said aloud, entered by the GM in the Seasons Change window).
	const pickReference = options.pickReference ?? null;
	const pickListHtml = pickReference ? "" : pickListsHtml(pickPools, result.key, tierPickCounts(moveResults));
	const pickReferenceList = pickReference ? pickReferenceHtml(pickPools, result.key, pickReference) : "";
	// Two ways a tier's options can already be on the card as BOXES, and either one keeps the
	// result block from reprinting them in prose: the checklist `pickListHtml` just built from a
	// declared pool, and -- for a move like Clash, whose options live in its own text rather than
	// in `system.pickOptions` -- the tickable list inside the description above
	// (utils/chat.js#descriptionPickTiers, reading back the stamp pickableMoveDescription wrote).
	// Merged in TIER_KEYS order, not concatenation order: the two sources can each answer for a
	// different tier, and `data-picked-tiers` is read back by a GM's Shift Up/Down.
	const pickedTierSet = new Set([
		// (A reference list counts too: the options are on the card either way.)
		...((pickListHtml || pickReferenceList) ? pickedTiers(pickPools) : []),
		...descriptionPickTiers(moveDescription),
	]);
	const pickedTierKeys = TIER_KEYS.filter(tier => pickedTierSet.has(tier));

	const header = moveName ?? statLabel;

	// Build condition pills
	const conditions = advDisConditionPills(rollMode);
	if (forward !== 0) {
		conditions.push(`<li class="stonetop-condition-forward">Forward ${sign(forward)}</li>`);
	}
	if (ongoing !== 0) {
		conditions.push(`<li class="stonetop-condition-ongoing">Ongoing ${sign(ongoing)}</li>`);
	}
	const situational = modifier - forward - ongoing;
	if (situational !== 0) {
		conditions.push(`<li class="stonetop-condition-situational">Situational ${sign(situational)}</li>`);
	}
	// A debility that is marked and doing nothing (the Heavy's Battle Joy). Said out loud, because
	// the alternative is a player seeing no Disadvantage pill on a roll their ticked box should
	// have spoiled and reading the tracker as broken.
	if (options.stonetopDebilityIgnored) {
		const ignored = String(options.stonetopDebilityIgnoredName ?? "").trim();
		const tip = ignored
			? `${options.stonetopDebilityIgnored}: you ignore the effects of debilities (${ignored.toLowerCase()}) as long as you keep fighting.`
			: `${options.stonetopDebilityIgnored}: you ignore the effects of debilities as long as you keep fighting.`;
		conditions.push(`<li class="stonetop-condition-debility-ignored" data-tooltip="${escHtml(tip)}">`
			+ `${escHtml(options.stonetopDebilityIgnored)}</li>`);
	}

	// A caller's own named condition — "Sacrifice at the sacred rites" beside the Advantage pill,
	// so a roll that is at advantage for a reason settled seasons ago says which reason. Text, not
	// markup: the pill's chrome belongs to this card, and a caller passing HTML would be styling
	// someone else's card from a long way off.
	conditions.push(...conditionNotePills(options.conditionNotes));
	const counted = countedNote(total, rolledRecord(statKey, { missCountsAsPartial, partialCountsAsSuccess }));
	if (counted) conditions.push(countedNotePill(counted));

	const conditionsHtml = conditionsRowHtml(conditions);

	// A 12+'s own line rides the 10+ row, and only a total that reached 12 carries it: a 10 or 11 is
	// the same tier and says nothing more.
	const critical = String(options.criticalActions ?? "");
	const tierActions = critical && roll.total >= CRITICAL_TOTAL
		? { ...(options.tierActions ?? {}), success: `${options.tierActions?.success ?? ""}${critical}` }
		: options.tierActions ?? null;

	const flavor = _rollCard({
		header,
		result: result.label,
		resultClass: result.key,
		resultDetail,
		resultOutcomes,
		resultLegend: (options.resultLegend ?? "") + pickReferenceList,
		pickList: pickListHtml,
		pickTiers: pickedTierKeys,
		countsAs: { missCountsAsPartial, partialCountsAsSuccess },
		tierActions,
		conditionsHtml,
		// The wounds are the rolling CHARACTER's: a follower's roll (Order Followers, a Struggle as One
		// follower row) is made on the PC's actor, but the PC's injuries neither hinder nor explain it.
		noticesHtml: statKey === "follower" ? ""
			: _woundReminderHtml(actor, moveName) + _woundJustifyHtml(actor, result.key),
		buttons: true,
		total: roll.total,
		formula: roll.formula,
		dieResults: dieResultsText(roll),
		// The move's own ladder, with the rung the dice landed on marked. The result block above
		// it already states that one outcome; what the mark adds is WHERE it sits among the other
		// two, which is the reading that says whether a 7-9 was a near miss or a near hit.
		description: markRolledTier(moveDescription, result.key),
	});

	// A roll meant for its player and the GM only: Struggle as One keeps each result quiet until the
	// GM shares them all (Book I p.329). The author always sees their own message, so the list names
	// the GMs and anyone else who plays the character.
	const whisper = Array.isArray(options.whisper) ? options.whisper.filter(Boolean) : [];
	// What was rolled, on the card, for whatever reads its tier again after a rewrite (utils/counted-tier.js):
	// Potential for Greatness asks the stat, and a 7-9 this roll treats as a 10+ still counts as one.
	const priorFlags = options.messageFlags ?? {};
	// Whether this card's miss earns XP, kept on it so a rewrite of its total can mark or take back
	// that XP as the new total says (reconcileMissXp).
	const earnsMissXp = actor?.type === "character" && !options.noXpOnMiss;
	const messageFlags = {
		...priorFlags,
		[SYSTEM_ID]: {
			...(priorFlags[SYSTEM_ID] ?? {}),
			[ROLLED_FLAG]: rolledRecord(statKey, { moveName, missCountsAsPartial, partialCountsAsSuccess }),
			...(earnsMissXp ? { [MISS_XP_FLAG]: true } : {}),
		},
	};
	const resultMessage = await roll.toMessage({
		speaker:  ChatMessage.getSpeaker({ actor }),
		flavor,
		flags:    messageFlags,
		rollMode: game.settings.get("core", "rollMode"),
		...(whisper.length ? { whisper } : {}),
	}, whisper.length ? privateMessageModeOptions() : {});
	if (resultMessage && typeof resultMessage === "object") ROLL_MESSAGES.set(roll, resultMessage);

	// Wait for the Dice So Nice 3D animation (if installed) to finish before
	// posting any follow-up cards, so the Miss/XP card doesn't reveal the result
	// while the dice are still rolling. Guard the wait: if DSN rejects (lookup race,
	// internal error), we still must mark the miss XP below, not bail out of rollStat.
	if (resultMessage?.id) {
		try {
			await game.dice3d?.waitFor3DAnimationByMessageID(resultMessage.id);
		} catch (_err) { /* animation wait failed — proceed to the follow-up cards */ }
	}

	if (result.key === "failure" && earnsMissXp) {
		const card = resultMessage?.id ? game.messages?.get?.(resultMessage.id) : null;
		const rollMode = game.settings.get("core", "rollMode");
		if (!card) await markMissXp(actor, moveName, { rollMode });
		else {
			// Marked on the card's WRITER, in the card's turn, where every rewrite of it runs: the dice
			// animation is long enough for a Burn Brightly or a Shift to land first, and only one client
			// lining both up decides which came first. The writer reads the card as it is by then.
			const done = await pressRollCard(card, MISS_XP_ACTION, { rollMode });
			// The GM's client did not answer: mark it here on the same reading rather than lose the XP. The mark
			// is recorded on the card first (MISS_XP_STATE_FLAG), so a GM's turn that still lands later finds it
			// marked and marks nothing. On the character the CARD speaks for, as the GM's turn would mark: the
			// sheet's own actor can be an unlinked token's private copy (utils/speaker-actor.js).
			if (done === null) {
				const speaker = speakerActor(card);
				await inCardTurn(card, () => reconcileMissXp(card, card.rolls?.at?.(0)?.total ?? roll.total,
					{ actor: speaker?.type === "character" ? speaker : actor, rollMode }));
			}
		}
	}

	// The COUNTED tier: a 7-9 this roll treats as a 10+ is a 10+ to Potential for Greatness too. The reminder
	// goes where the roll went (a Struggle as One whisper stays one), and latches on the card so a later
	// rewrite of it does not ask twice (WouldBeHeroAsterisk.js#remindPotentialForGreatnessOnCard).
	await maybeRemindPotentialForGreatness(actor, statKey, total, {
		tier: result.key,
		whisper,
		rollMode: game.settings.get("core", "rollMode"),
		message: resultMessage && typeof resultMessage === "object" ? resultMessage : null,
	});

	return roll;
}

/**
 * Mark XP, and build the receipt that says so, with its Undo (utils/undo-xp-mark.js). A miss posts
 * one; so does a character who does what another PC Persuaded them to (pc-asks/pc-ask-flow.js).
 * The caller posts it, with whatever else its card carries.
 *
 * The write goes through adjustXp (utils/xp.js), which queues it behind anything else changing
 * this character's XP and reads the total inside that queue. The card then reports the number
 * that actually landed rather than one computed from a total read before the write — which is
 * how a mark and a spend firing together came to print two totals that could not both be true.
 *
 * `flags` are the card's own (under SYSTEM_ID): how much it marked, stamped at creation so the Undo
 * takes back exactly what was given rather than a number read off the card's own text. Their
 * presence is also what identifies the card to the wiring — a card without them has nothing to
 * undo, so an ordinary roll card can never grow the button. Free: they ride on the create.
 *
 * @returns {Promise<{content: string, flags: object}>}
 */
export async function markXpReceipt(actor, { header, description = "", move, amount = XP_PER_MISS }) {
	// Attributed to the move, so the ledger reads "via <move>".
	const { after, max } = await adjustXp(actor, amount, { move });
	return {
		content: _rollCard({
			header,
			result: `+${amount} XP (${after} / ${max})`,
			resultClass: "success",
			sectionClass: "stonetop-xp-mark-card",
			description,
			actions: `<button type="button" class="stonetop-xp-undo" data-action="undoXpMark"><i class="fas fa-rotate-left"></i> Undo XP Gain</button>`,
		}),
		flags: { [XP_MARK_FLAG]: amount },
	};
}

/**
 * Mark the +1 XP a miss earns (Book I p.209: "On a 6 or less, it's a miss. That means: They mark
 * XP") and post the receipt card. Normally fired automatically from rollStat, but exported so a
 * move that defers the choice can suppress it with `noXpOnMiss` and then mark it later from a
 * chat-card button (Never at a Loss) — the two paths must write the same thing, so they share
 * this one. `moveName` attributes the write in the character ledger.
 *
 * XP is deliberately not capped: xpToLevelUp is a level-up threshold, not a ceiling.
 */
export async function markMissXp(actor, moveName, { forCard = null, rollMode = game.settings.get("core", "rollMode"), author = null } = {}) {
	const receipt = await markXpReceipt(actor, {
		header: "Miss",
		move: moveName,
		description: `<p>On a <strong>miss</strong> (a total of 6 or less), you <strong>mark XP</strong>, a tick mark that raises your total by 1, unless the move says otherwise.</p>`,
	});
	const messageData = {
		content:  receipt.content,
		speaker:  ChatMessage.getSpeaker({ actor }),
		// The roller's, when the GM's client writes it: a chat message is "the GM, or whoever authored it"
		// to modify, and the receipt's Undo is the player's (undo-xp-mark.js#wireUndoXpMark).
		...(author ? { author } : {}),
		flags:    { [SYSTEM_ID]: { ...receipt.flags, ...(forCard ? { [XP_MARK_FOR_FLAG]: forCard } : {}) } },
	};
	// Where the roll went: the roll card's own whisper (and blindness), else the chat mode applied the way
	// core does it, so a Blind or Private GM miss does not announce itself to the whole table on its receipt.
	const card = forCard ? globalThis.game?.messages?.get?.(forCard) ?? null : null;
	return ChatMessage.create(whisperedAs(messageData, card, rollMode));
}

/**
 * A roll card's miss XP, made to match its total after a rewrite (a Shift, Burn Brightly, a +1 on the
 * card, giving it your all). "On a miss, mark XP" (Book I p.209) is about the result the card ends on:
 * lifted off a 6-, the miss's XP is taken back and its receipt reads Undone; brought down into one, the
 * XP is marked with a receipt of its own. The user's ruling, 2026-09-30.
 *
 * Only on a card whose miss earns XP (MISS_XP_FLAG, stamped by rollStat): a move that says no XP on a
 * miss, a non-character's roll and a card rolled before the flag existed are left as they are. The tier
 * is the one the card COUNTS as, so a 6- a rule treats as a 7-9 marks nothing, as at the roll.
 *
 * Run by the card's writer, in the card's turn: after a rewrite (stonetop.js#_resyncRewrittenTotal), and for
 * the roll's own miss (MISS_XP_ACTION). `rollMode` is the roller's, for a receipt written on the GM's client.
 *
 * Whether the XP is held is read off the card as well as its receipt (undo-xp-mark.js#missXpMarked): a
 * receipt deleted from the log still has its XP taken back on a lift, and is not marked a second time by a
 * rewrite that leaves the card on a miss. A miss its player undid by hand stays undone (missXpWaived).
 *
 * A card whose miss XP a BUTTON marks (MISS_XP_BY_CHOICE_FLAG: Never at a Loss, a steading roll's "Mark
 * XP") is never marked here, only taken back; lifted off the miss, its latches come off with the XP
 * (undo-xp-mark.js#MISS_XP_CHOICE_LATCHES), so a card brought back down offers the choice again. Its XP is the character the button named
 * (MISS_XP_ACTOR_FLAG) where it named one, since a steading roll is spoken by the steading.
 */
export async function reconcileMissXp(card, total, { actor = null, rollMode = undefined } = {}) {
	if (!card?.getFlag?.(SYSTEM_ID, MISS_XP_FLAG)) return;
	const markedFor = card.getFlag(SYSTEM_ID, MISS_XP_ACTOR_FLAG);
	if (markedFor) actor = globalThis.game?.actors?.get?.(markedFor) ?? null;
	if (actor?.type !== "character") return;
	// The chat log read once, for every question asked of the card's receipts below.
	const receipts = missReceipts(card);
	if (missXpWaived(card, receipts)) return;
	const miss = cardCountedTier(card, total, SYSTEM_ID) === "failure";
	const marked = missXpMarked(card, receipts);
	const byChoice = missXpIsByChoice(card);
	const move = card.getFlag(SYSTEM_ID, ROLLED_FLAG)?.move ?? null;
	const author = card.author?.id ?? null;
	if (miss && !marked && !byChoice) {
		// Recorded on the card BEFORE the mark, and taken off again if the mark fails: a second writer
		// arriving meanwhile (a GM's turn landing after the roller's fallback) reads it and marks nothing.
		await card.setFlag(SYSTEM_ID, MISS_XP_STATE_FLAG, "marked");
		try {
			await markMissXp(actor, move, { forCard: card.id, author, ...(rollMode ? { rollMode } : {}) });
		} catch (err) {
			await card.unsetFlag(SYSTEM_ID, MISS_XP_STATE_FLAG)
				.catch(e => console.error("Stonetop | Could not release a miss XP record:", e));
			throw err;
		}
	} else if (!miss && marked) {
		const takeBack = move ? `${move} (no longer a miss)` : "No longer a miss";
		const live = liveMissReceipt(card, receipts);
		// No receipt left to latch (it was deleted): the XP the card records is taken back all the same.
		if (live) await takeBackXpMark(live, actor, { move: takeBack });
		else await adjustXp(actor, -XP_PER_MISS, { move: takeBack });
		if (byChoice) await card.update(Object.fromEntries(MISS_XP_CHOICE_LATCHES.map(key => deletionEntry(`flags.${SYSTEM_ID}.${key}`))));
		else await card.setFlag(SYSTEM_ID, MISS_XP_STATE_FLAG, "none");
	}
}

/**
 * Mark a miss's XP from a BUTTON on its card (Never at a Loss's "Mark XP", a steading roll's), tied to the
 * card as a roll's own mark is: the card is stamped as a miss that earned XP, marked by choice, and (for a
 * steading roll, spoken by the steading) whose XP it was, so a rewrite that lifts it off the miss takes the
 * XP back and opens the choice again (reconcileMissXp). The receipt is the ordinary one, Undo and all, and
 * goes where the roll card went. Stamped BEFORE the mark and taken off again if the mark fails.
 *
 * @param {ChatMessage} card   the roll card the button is on
 * @param {Actor} actor        the character marking XP
 * @param {string} moveName    for the ledger
 * @param {object} [options]
 * @param {boolean} [options.naming]  record `actor` on the card as the one whose XP follows it
 */
export async function markMissXpByChoice(card, actor, moveName, { naming = false } = {}) {
	const stamps = {
		[MISS_XP_FLAG]: true,
		[MISS_XP_BY_CHOICE_FLAG]: true,
		[MISS_XP_STATE_FLAG]: "marked",
		...(naming ? { [MISS_XP_ACTOR_FLAG]: actor.id } : {}),
	};
	const flagPath = key => `flags.${SYSTEM_ID}.${key}`;
	await card.update(Object.fromEntries(Object.entries(stamps).map(([key, value]) => [flagPath(key), value])));
	try {
		// A card with no whisper went to everyone, so its receipt does too, whatever this client's chat mode.
		return await markMissXp(actor, moveName, { forCard: card.id, author: card.author?.id ?? null, rollMode: "publicroll" });
	} catch (err) {
		await card.update(Object.fromEntries(Object.keys(stamps).map(key => deletionEntry(flagPath(key)))))
			.catch(e => console.error("Stonetop | Could not release a miss XP mark:", e));
		throw err;
	}
}

/** The roll card action that marks a roll's own miss XP on the card's writer (see rollStat). */
const MISS_XP_ACTION = "missXp";
registerRollCardAction(MISS_XP_ACTION, ({ message, user, data }) => {
	const actor = speakerActor(message);
	// Only for whoever plays the character speaking the card, as every other press on it.
	if (actor?.type !== "character" || !actor.testUserPermission?.(user, "OWNER")) return null;
	return inCardTurn(message, async () => {
		await reconcileMissXp(message, message.rolls?.at?.(0)?.total, { actor, rollMode: data?.rollMode });
		return { done: true };
	});
});

// The Advantage / Disadvantage condition pill(s) for a roll mode — shared by the stat and
// damage cards so a class rename or label change lands in one place.
function advDisConditionPills(rollMode) {
	if (rollMode === "adv") return [`<li class="stonetop-condition-advantage">Advantage</li>`];
	if (rollMode === "dis") return [`<li class="stonetop-condition-disadvantage">Disadvantage</li>`];
	return [];
}

/**
 * The pills that say how a damage roll went out and what was added to it before it did.
 *
 * The formula chip above them already shows the arithmetic; what it cannot show is that the
 * "+1" was a one-off the player declared rather than part of their weapon, which is the whole
 * question a table asks when a d10 comes back as an 11. The bonus pills wear the same class
 * the move card's one-off modifier does, because they ARE the same thing on the other kind of
 * roll.
 *
 * Exported for the attack flow, which rolls once per target and builds its own results card;
 * both surfaces report an adjusted damage roll in the same words.
 */
export function damageConditionPills({ rollMode = "normal", bonus = 0, extraDice = "", seed = null } = {}) {
	const pills = advDisConditionPills(rollMode);
	const flat = Math.trunc(Number(bonus)) || 0;
	if (flat !== 0) pills.push(`<li class="stonetop-condition-situational">Damage ${sign(flat)}</li>`);
	for (const entry of (Array.isArray(extraDice) ? extraDice : [extraDice])) {
		const term = extraTerm(entry);
		// A move's own extra dice (Undaunted) are named for the move; typed ones say only what they add.
		const named = entry && typeof entry === "object" && entry.pill;
		// A line that added no number but changed the ROLL still says so: "Uncanny Reflexes" beside the
		// Disadvantage pill is what tells the table whose move put it there.
		if (!term) {
			if (named) pills.push(`<li class="stonetop-condition-situational">${escHtml(named)}</li>`);
			continue;
		}
		pills.push(`<li class="stonetop-condition-situational">${escHtml(named || `Extra ${term.startsWith("-") ? term : `+${term}`}`)}</li>`);
	}
	// The fight's +N for several attackers, or a group's for outnumbering (fight/damage-seed.js), named
	// apart from the roller's own bonus, and still named when it was left off, so the card says what
	// was waived.
	if (seedBonus(seed) !== 0) {
		const leftOff = seed.applied === false;
		pills.push(`<li class="stonetop-condition-situational stonetop-condition-numbers${leftOff ? " is-left-off" : ""}">${escHtml(leftOff ? seed.pillLeftOff : seed.pill)}</li>`);
		// The other attacker's die, when it was rolled in place of the roller's own (p.414 "usually the
		// best one"). It stays named if the +N is left off later: the die is already on the table.
		if (seed.useBest && seed.best?.pill) pills.push(`<li class="stonetop-condition-situational">${escHtml(seed.best.pill)}</li>`);
	}
	return pills;
}

// `xpToLevelUp` used to live here. It now lives in utils/xp.js with the rest of what a
// character's XP total needs — the curve, the per-Actor write queue, and the one function that
// applies a delta — because how much XP a level costs is no more a dice engine's business than
// the queue is. Both importers moved with it; there is no re-export, so nothing is left pointing
// at the old home for a reader to mistake for the real one.

/**
 * Apply advantage/disadvantage to a damage formula by rolling its first dice term
 * twice and keeping the better/worse ROLL: Stonetop "roll damage twice, take the
 * higher/lower" (Book I p.21, p.399). One die is two of it, keeping one ("d6" with
 * disadvantage → "2d6kl1", "d8+2" → "2d8kl1+2"). Several dice are two whole ROLLS of
 * them, keeping the better or worse total ("2d4" with disadvantage → "{2d4,2d4}kl"),
 * never the best or worst dice picked one by one out of the four, which is a
 * different (and kinder) number. Non-adv/dis modes and dieless formulas pass through
 * unchanged.
 *
 * Exported because the attack flow evaluates its own Rolls (one per target) rather than
 * going through {@link rollDamage}, and a mode that only applied on the single-target path
 * would be a control that silently does nothing the moment a second foe is targeted.
 */
export function damageRollFormula(formula, rollMode) {
	if (rollMode !== "adv" && rollMode !== "dis") return formula;
	return String(formula).replace(/(\d*)d(\d+)/i, (match, count, faces) => {
		const n = Number(count || 1);
		const keep = rollMode === "adv" ? "kh" : "kl";
		return n > 1 ? `{${n}d${faces},${n}d${faces}}${keep}` : `2d${faces}${keep}1`;
	});
}

/**
 * Roll a character or monster damage formula using the same Stonetop chat card
 * shell as stat rolls.
 *
 * `bonus` and `extraDice` are the one-off adjustment from the pre-roll damage window
 * (module/dialogs/RollDialog.js) — the Storm Markings' "+1 damage until you calm down", a
 * spent Fury's "+1d6", a GM's call. They are folded in HERE rather than by each caller so the
 * formula on the card and the pills that explain it are built in one place; a caller that has
 * nothing to add passes nothing and rolls exactly what it always did.
 *
 * @param {string} formula
 * @param {Actor} actor
 * @param {object} options
 * @param {string} [options.label]
 * @param {string} [options.rollMode]  - "adv" | "dis" | "normal" (advantage/disadvantage on the damage die)
 * @param {number} [options.bonus]     - Flat one-off damage modifier
 * @param {string|string[]} [options.extraDice] - One-off extra damage dice ("1d6")
 * @param {object} [options.seed] - The fight's +N for several attackers (fight/damage-seed.js), added
 *   while it is applied and named on the card either way
 * @param {string} [options.keywords] - What the card prints beside the total: a stat block attack's
 *   tags, its name alone being the title (utils/damage.js#damageCardText). Plain text, escaped here;
 *   known tags print bold with their meaning on hover (utils/chat.js#damageKeywordsHtml).
 * @param {string} [options.description] - HTML for the card's description, behind the same toggle a
 *   move roll's card has: a monster move rolled as an attack carries its own text (item/StonetopItem.js).
 * @param {string} [options.notices] - Ready-made HTML for the card's notice slot: the fiction a
 *   weapon's tags owe the table (combat/attack-flow.js#tagNoticesHtml). Passed in rather than
 *   built here because this card is the NO-TARGET half of a pair, and the targeted half builds
 *   its own body; one source for the HTML is what keeps the two from wording a blow differently.
 * @returns {Promise<Roll>}
 */
export async function rollDamage(formula, actor, options = {}) {
	const rollMode = options.rollMode ?? "normal";
	const bonus     = Math.trunc(Number(options.bonus)) || 0;
	const extraDice = options.extraDice ?? "";
	const seed      = options.seed ?? null;
	const adjusted  = composeDamageFormula(formula, { bonus, extraDice, seed });
	const roll = await new Roll(damageRollFormula(adjusted, rollMode)).evaluate();
	const label = options.label ?? "Damage";

	const conditions = damageConditionPills({ rollMode, bonus, extraDice, seed });

	await roll.toMessage({
		speaker:  ChatMessage.getSpeaker({ actor }),
		// Never below 0: a group's -N for the bigger side's armor (fight/damage-seed.js) can take a d4 under it.
		// The Roll itself keeps the dice's arithmetic, so a caller reading its total clamps it the same way
		// (combat/attack-flow.js#rollAndPostDamage).
		flavor:   _rollCard({ header: label, buttons: true, total: Math.max(0, roll.total), formula: roll.formula, dieResults: dieResultsText(roll), conditionsHtml: conditionsRowHtml(conditions), noticesHtml: options.notices ?? "", keywords: options.keywords ?? "", description: options.description ?? "", badge: damageBadge(), sectionClass: "stonetop-damage-roll-card", damage: true }),
		rollMode: game.settings.get("core", "rollMode"),
		// What a caller needs the card to say about itself: a follower's blow posted under their
		// character's name (combat/attack-flow.js#rollDamageAt), which is not the character's roll.
		...(options.messageFlags ? { flags: options.messageFlags } : {}),
	});

	return roll;
}

/**
 * Roll a generic formula using the Stonetop chat card shell.
 *
 * @param {string} formula
 * @param {Actor} actor
 * @param {object} options
 * @param {string} [options.label]
 * @returns {Promise<Roll>}
 */
export async function rollFormula(formula, actor, options = {}) {
	const roll = await new Roll(formula).evaluate();
	const label = options.label ?? formula;
	const description = options.description ?? "";

	await roll.toMessage({
		speaker:  ChatMessage.getSpeaker({ actor }),
		flavor:   _rollCard({ header: label, total: roll.total, formula, buttons: true, dieResults: dieResultsText(roll), description }),
		rollMode: game.settings.get("core", "rollMode"),
	});

	return roll;
}
