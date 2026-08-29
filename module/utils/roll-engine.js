import { maybeRemindPotentialForGreatness } from "../actors/character/WouldBeHeroAsterisk.js";
import { escHtml, formatOutcomeDetail, stripHtmlToText } from "./strings.js";
import { pickLimitsFrom } from "./move-picks.js";
import { pickLeadText, TIER_KEYS, TIER_LABELS } from "./move-results.js";
import { markRolledTier } from "./move-tiers.js";
import { stonetopCardShell, stonetopChatCard, springRollCardBody, rollFormulaChip, rollResultNumber, damageMark, damageBadge } from "./chat.js";
import { adjustXp } from "./xp.js";
import { composeDamageFormula, normalizeDamageBonusDice } from "./damage.js";
import { SYSTEM_ID } from "../system-id.js";

// What a miss is worth (Book I p.209: "a tick mark that raises your total by 1"). Named because
// the mark and the Undo that takes it back have to agree, and a card stamped by one number and
// reversed by another is a bug that only shows up as a total nobody can account for.
const XP_PER_MISS = 1;

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

export function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

// The spring Seasons Change result table (Book I): the rolling PC picks a seasonal
// gain on a 7+. Shared by the Spring Burst walkthrough, the steading's Seasons Change
// flow, and the chat "ask the most hopeful to roll" prompt so all three stay in step.
export const SPRING_SEASONS_RESULT = {
	success: { label: TIER_LABELS.success, line: "Pick <strong>one seasonal gain</strong>." },
	partial: { label: TIER_LABELS.partial, line: "Pick <strong>one seasonal gain</strong>, but a threat to the steading makes itself known or gets worse." },
	failure: { label: TIER_LABELS.failure, line: "<strong>Threats abound</strong> &mdash; and don't mark XP." },
};

// The Inn's own +Fortunes roll, which is a SECOND roll the season makes and not a variant of the
// one above: "Henceforth, when the Seasons Change, whoever is friendliest rolls +Fortunes: on a
// 10+, ask the GM 3 questions about the wider world; on a 7-9, ask 1 question; on a 6-, ask 1
// question, but the GM describes some trouble that stems from the inn or its guests."
//
// Every season, not just spring — the improvement says "when the Seasons Change" with no season
// named — and handed to the table like spring's is, because "whoever is friendliest" is a player.
export const INN_SEASONS_RESULT = {
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

/** Wrap a list of pre-rendered `<li>` inner-HTML strings in the shared "Results" legend
 *  block, so every result table (roll cards, homestead / season walkthroughs) renders the
 *  same chrome from one place instead of each caller re-emitting the wrapper markup. */
export function resultsLegendHtml(rows) {
	return `<div class="stonetop-homestead-reference">
		<strong>Results</strong>
		<ul>${(rows ?? []).map(r => `<li>${r}</li>`).join("")}</ul>
	</div>`;
}

function _resultTableLegend(resultTable) {
	if (!resultTable) return "";
	const rows = TIER_KEYS
		.map(key => resultTable[key])
		.filter(Boolean)
		.map(result => `<strong>${result.label}:</strong> ${result.line}`);
	return resultsLegendHtml(rows);
}

/**
 * Pull the individual die faces out of an evaluated Roll, e.g. a 2d6 that came up
 * 2 and 3 yields "2, 3". Discarded dice (the dropped die on adv/dis) are flagged with
 * a strike-through so the hover readout still shows what was rolled. Returns "" when
 * the roll has no dice terms.
 */
export function dieResultsText(roll) {
	const dice = roll?.dice ?? [];
	const faces = dice.flatMap(term =>
		(term.results ?? []).map(r => (r.active === false || r.discarded ? `(${r.result})` : `${r.result}`))
	);
	return faces.join(", ");
}

/** Die faces for a *multi*-die roll ("2, 4"), or "" for a single die — the readout
 *  only helps when more than one die contributed (a 1d6 just echoes its total). */
export function multiDieFaces(roll) {
	const faces = dieResultsText(roll);
	return faces.includes(",") ? faces : "";
}

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
 * clicked it. Pass `alias` instead to speak the card under a fixed name with no header
 * (the Expedition Requisition card).
 */
export async function rollSeasonsCard({ formula, title = "", alias = "", resultTable, resultLegend = "" } = {}) {
	const roll = await new Roll(formula).evaluate();
	const tier = classifyResult(roll.total).key;
	const result = resultTable[tier];
	const body = springRollCardBody(
		roll.total,
		tier,
		result.label,
		result.line,
		roll.formula,
		multiDieFaces(roll),
		resultLegend || _resultTableLegend(resultTable),
	);
	await roll.toMessage({
		speaker: alias ? { alias } : ChatMessage.getSpeaker(),
		flavor:  title
			? stonetopChatCard(title, body, "stonetop-spring-card")
			: stonetopCardShell(body, "stonetop-spring-card"),
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
 * @param {string} [rollMode]  "adv" | "dis" | "normal" — NOT core's public/gmroll/blind.
 * @param {string} [why]       What bought the advantage, named on the card so the table can see
 *   the sacrifice land rather than reading two extra dice and wondering.
 */
export function postSeasonsRollPrompt({
	alias = "Seasons Change: Spring",
	hopeful = "",
	fortunes = 0,
	rollMode = "normal",
	why = "",
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
	const conditions = named
		? `<p class="stonetop-seasons-prompt-mode"><em>Rolled with <strong>${named}</strong>${why ? `: ${escHtml(why)}` : ""}.</em></p>`
		: "";
	const body = `<div class="card-content stonetop-seasons-prompt">
		<p class="stonetop-seasons-prompt-text">${lead} ${who}, roll <strong>+Fortunes</strong> (${sign(fortunes)}) ${tail}.</p>
		${conditions}
		<div class="card-buttons stonetop-card-buttons">
			<button type="button" class="stonetop-seasons-roll-btn" data-fortunes="${fortunes}" data-alias="${escHtml(alias)}" data-roll-mode="${escHtml(rollMode)}" data-table="${escHtml(table)}">
				<i class="fas fa-dice-d6"></i> Roll +Fortunes (${sign(fortunes)})
			</button>
		</div>
	</div>`;
	ChatMessage.create({
		speaker: { alias },
		content: stonetopChatCard(alias, body, "stonetop-seasons-prompt-card"),
	});
}

// The three result tiers a pick pool can be hung off, in card order.
const _PICK_TIERS = TIER_KEYS;

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
		byTier: Object.fromEntries(_PICK_TIERS.map(tier => [tier, shared ?? clean(pickOptions?.[tier])])),
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
	return Object.fromEntries(_PICK_TIERS.map(tier => [tier, countFor(tier)]));
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
	return _PICK_TIERS.filter(tier => pools.byTier[tier].length);
}

export function pickListsHtml(pools, activeTier, picks = null) {
	let index = 0;
	const list = (options, limitAttrs = "") => `<ul class="stonetop-picklist"${limitAttrs}>${options.map(option =>
		`<li class="stonetop-picklist-item"><label><input type="checkbox" class="stonetop-check stonetop-picklist-check" data-index="${index++}"><span>${escHtml(option)}</span></label></li>`
	).join("")}</ul>`;
	// A tier that states no count of its own (a homefront move's 6- consequences, whose result
	// text already says how many) stamps nothing and ticks freely, same as an unreadable move.
	const cap = tier => (Math.trunc(Number(picks?.[tier])) || 0);

	if (pools.shared) {
		if (!pools.shared.length) return "";
		return list(pools.shared, _PICK_TIERS.map(t => (cap(t) ? ` data-pick-max-${t}="${cap(t)}"` : "")).join(""));
	}

	const tiers = _PICK_TIERS.filter(tier => pools.byTier[tier].length);
	if (!tiers.length) return "";
	return `<div class="stonetop-roll-tier-picklists" data-active-tier="${escHtml(activeTier)}">
		${tiers.map(tier =>
			`<div class="stonetop-roll-tier-picklist" data-tier="${escHtml(tier)}"${tier === activeTier ? "" : ` hidden="hidden"`}>${list(pools.byTier[tier], cap(tier) ? ` data-pick-max="${cap(tier)}"` : "")}</div>`
		).join("")}
	</div>`;
}

function _rollCard({ header, result = "", resultClass = "", resultDetail = "", resultOutcomes = null, resultLegend = "", pickList = "", pickTiers = [], tierActions = null, conditionsHtml = "", noticesHtml = "", buttons = false, actions = "", total = null, formula = "", description = "", dieResults = "", badge = "", sectionClass = "", damage = false }) {
	// Stash every tier's outcome on the row so a GM Shift Up/Down can swap the
	// detail line to match the new tier (see _shiftRollCardFlavor in stonetop.js).
	const outcomeAttrs = resultOutcomes
		? ` data-outcome-success="${escHtml(resultOutcomes.success ?? "")}"`
			+ ` data-outcome-partial="${escHtml(resultOutcomes.partial ?? "")}"`
			+ ` data-outcome-failure="${escHtml(resultOutcomes.failure ?? "")}"`
		: "";
	// ...and which of those tiers has its options ticked off below, so the shift keeps printing
	// the lead-in alone on a tier whose list is already on the card (see `detailHtml`).
	const pickedAttr = pickTiers.length ? ` data-picked-tiers="${escHtml(pickTiers.join(" "))}"` : "";
	// The tier's own options are reprinted inside the result block ONLY when nothing below lists
	// them. A card that shows them as checkboxes shows the lead-in here and the boxes there.
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
		? `<div class="stonetop-roll-result ${resultClass}"${outcomeAttrs}${pickedAttr}>
			${total != null ? resultNumberHtml : ""}
			<div class="stonetop-roll-result-body">
				${result ? `<span class="stonetop-roll-result-label">${result}</span>` : ""}
				<span class="stonetop-roll-result-details">${detailHtml}</span>
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
	const descToggleHtml = description
		? `<button class="stonetop-roll-card-desc-toggle" type="button" title="Show move description"><i class="fas fa-question-circle"></i></button>`
		: "";
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
	const wounds = actor?.system?.attributes?.wounds;
	if (!Array.isArray(wounds) || !wounds.length) return "";
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
	if (!matches.length) return "";
	const items = matches.map(w => `<li>${escHtml(w.mechanicalTag)}</li>`).join("");
	return `<div class="row row--border stonetop-roll-wound-notice">
		<h3 class="cell__subtitle"><i class="fas fa-triangle-exclamation"></i> Lasting injury</h3>
		<ul>${items}</ul>
	</div>`;
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
 * @param {string}  [options.stonetopDebility]          - Debility name for annotation
 * @param {string}  [options.stonetopDebilityTooltip]
 * @param {string}  [options.stonetopDebilityIgnored]      - What is cancelling a marked debility
 *   (the Heavy's Battle Joy). Mutually exclusive with stonetopDebility: either the debility bit,
 *   or something is ignoring it.
 * @param {string}  [options.stonetopDebilityIgnoredName]  - Which debility is being ignored
 * @param {boolean} [options.noXpOnMiss]               - Skip the automatic +1 XP on a miss (for moves that replace it)
 * @param {string[]|{success?: string[], partial?: string[], failure?: string[]}} [options.pickOptions]
 *   "Choose from this list" options, rendered as a checklist on the card. An array is one pool
 *   shared by every tier (love letters); an object names a pool per tier (the homefront moves,
 *   whose 6- consequences are a different list from their 10+/7-9 options).
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

	const moveDescription = options.moveDescription ?? "";

	const rollData    = modifier !== 0 ? { stat: statValue, mod: modifier } : { stat: statValue };
	const rollOptions = {
		stonetopDebility:        options.stonetopDebility        ?? null,
		stonetopDebilityTooltip: options.stonetopDebilityTooltip ?? null,
	};

	const roll   = await new Roll(_rollFormula(rollMode, modifier), rollData, rollOptions).evaluate();
	const total  = roll.total;
	const result = classifyResult(total);

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

	const pickListHtml = pickListsHtml(pickPools, result.key, tierPickCounts(moveResults));

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
	for (const note of (Array.isArray(options.conditionNotes) ? options.conditionNotes : []).filter(Boolean)) {
		conditions.push(`<li class="stonetop-condition-note">${escHtml(note)}</li>`);
	}

	const conditionsHtml = conditionsRowHtml(conditions);

	const flavor = _rollCard({
		header,
		result: result.label,
		resultClass: result.key,
		resultDetail,
		resultOutcomes,
		resultLegend: options.resultLegend ?? "",
		pickList: pickListHtml,
		pickTiers: pickListHtml ? pickedTiers(pickPools) : [],
		tierActions: options.tierActions ?? null,
		conditionsHtml,
		noticesHtml: _woundReminderHtml(actor, moveName),
		buttons: true,
		total: roll.total,
		formula: roll.formula,
		dieResults: dieResultsText(roll),
		// The move's own ladder, with the rung the dice landed on marked. The result block above
		// it already states that one outcome; what the mark adds is WHERE it sits among the other
		// two, which is the reading that says whether a 7-9 was a near miss or a near hit.
		description: markRolledTier(moveDescription, result.key),
	});

	const resultMessage = await roll.toMessage({
		speaker:  ChatMessage.getSpeaker({ actor }),
		flavor,
		flags:    options.messageFlags ?? undefined,
		rollMode: game.settings.get("core", "rollMode"),
	});

	// Wait for the Dice So Nice 3D animation (if installed) to finish before
	// posting any follow-up cards, so the Miss/XP card doesn't reveal the result
	// while the dice are still rolling. Guard the wait: if DSN rejects (lookup race,
	// internal error), we still must mark the miss XP below, not bail out of rollStat.
	if (resultMessage?.id) {
		try {
			await game.dice3d?.waitFor3DAnimationByMessageID(resultMessage.id);
		} catch (_err) { /* animation wait failed — proceed to the follow-up cards */ }
	}

	if (result.key === "failure" && actor?.type === "character" && !options.noXpOnMiss) {
		await markMissXp(actor, moveName);
	}

	await maybeRemindPotentialForGreatness(actor, statKey, total);

	return roll;
}

/**
 * Mark the +1 XP a miss earns (Book I p.209: "On a 6 or less, it's a miss. That means: They mark
 * XP") and post the receipt card. Normally fired automatically from rollStat, but exported so a
 * move that defers the choice can suppress it with `noXpOnMiss` and then mark it later from a
 * chat-card button (Never at a Loss) — the two paths must write the same thing, so they share
 * this one. `moveName` attributes the write in the character ledger.
 *
 * XP is deliberately not capped: xpToLevelUp is a level-up threshold, not a ceiling.
 *
 * The write goes through adjustXp (utils/xp.js), which queues it behind anything else changing
 * this character's XP and reads the total inside that queue. The card then reports the number
 * that actually landed rather than one computed from a total read before the write — which is
 * how a mark and a spend firing together came to print two totals that could not both be true.
 */
export async function markMissXp(actor, moveName) {
	// Attribute the marked XP to the move that missed, so the ledger reads "via <move>".
	const { after: newXp, max: maxXp } = await adjustXp(actor, XP_PER_MISS, { move: moveName });
	const xpCard = _rollCard({
		header: "Miss",
		result: `+1 XP (${newXp} / ${maxXp})`,
		resultClass: "success",
		sectionClass: "stonetop-xp-mark-card",
		description: `<p>On a <strong>miss</strong> (a total of 6 or less), you <strong>mark XP</strong>, a tick mark that raises your total by 1, unless the move says otherwise.</p>`,
		actions: `<button type="button" class="stonetop-xp-undo" data-action="undoXpMark"><i class="fas fa-rotate-left"></i> Undo XP Gain</button>`,
	});
	await ChatMessage.create({
		content:  xpCard,
		speaker:  ChatMessage.getSpeaker({ actor }),
		rollMode: game.settings.get("core", "rollMode"),
		// How much this card marked, stamped at creation so the Undo button takes back exactly
		// what was given rather than a number read off the card's own text. Its presence is also
		// what identifies the card to the wiring — a card with no `xpMark` has nothing to undo,
		// so an ordinary roll card can never grow the button. Free: it rides on the create.
		flags: { [SYSTEM_ID]: { xpMark: XP_PER_MISS } },
	});
}

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
export function damageConditionPills({ rollMode = "normal", bonus = 0, extraDice = "" } = {}) {
	const pills = advDisConditionPills(rollMode);
	const flat = Math.trunc(Number(bonus)) || 0;
	if (flat !== 0) pills.push(`<li class="stonetop-condition-situational">Damage ${sign(flat)}</li>`);
	for (const term of (Array.isArray(extraDice) ? extraDice : [extraDice]).map(normalizeDamageBonusDice)) {
		if (term) pills.push(`<li class="stonetop-condition-situational">Extra ${escHtml(term.startsWith("-") ? term : `+${term}`)}</li>`);
	}
	return pills;
}

// `xpToLevelUp` used to live here. It now lives in utils/xp.js with the rest of what a
// character's XP total needs — the curve, the per-Actor write queue, and the one function that
// applies a delta — because how much XP a level costs is no more a dice engine's business than
// the queue is. Both importers moved with it; there is no re-export, so nothing is left pointing
// at the old home for a reader to mistake for the real one.

/**
 * Apply advantage/disadvantage to a damage formula by doubling its first dice
 * term and keeping the better/worse half — Stonetop "roll damage twice, take the
 * higher/lower" (e.g. "d6" with disadvantage → "2d6kl1", "d8+2" → "2d8kl1+2").
 * Non-adv/dis modes and dieless formulas pass through unchanged.
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
		return `${n * 2}d${faces}${keep}${n}`;
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
 * @returns {Promise<Roll>}
 */
export async function rollDamage(formula, actor, options = {}) {
	const rollMode = options.rollMode ?? "normal";
	const bonus     = Math.trunc(Number(options.bonus)) || 0;
	const extraDice = options.extraDice ?? "";
	const adjusted  = composeDamageFormula(formula, { bonus, extraDice });
	const roll = await new Roll(damageRollFormula(adjusted, rollMode)).evaluate();
	const label = options.label ?? "Damage";

	const conditions = damageConditionPills({ rollMode, bonus, extraDice });

	await roll.toMessage({
		speaker:  ChatMessage.getSpeaker({ actor }),
		flavor:   _rollCard({ header: label, buttons: true, total: roll.total, formula: roll.formula, dieResults: dieResultsText(roll), conditionsHtml: conditionsRowHtml(conditions), badge: damageBadge(), sectionClass: "stonetop-damage-roll-card", damage: true }),
		rollMode: game.settings.get("core", "rollMode"),
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
