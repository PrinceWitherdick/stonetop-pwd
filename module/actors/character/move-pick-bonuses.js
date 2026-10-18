/**
 * Moves (and backgrounds) that change how many options a roller may take off ANOTHER move's
 * printed list, or add to that list: the Fox's Perceptive ("When you Seek Insight, you may ask 1
 * additional question. Even on a 6-, you can ask 1 question"), the Ranger's Survivalist ("When
 * you Forage, pick 1 extra choice (even on a 6-, pick 1) and add ... to the list of options"), the
 * Fox's The Natural ("add 'What opportunity does no one else see?' to the list of possible
 * questions").
 *
 * The caps themselves are read off the move's own prose and stamped on its tickable list
 * (utils/chat.js#pickableMoveDescription), which is a reading of the MOVE and knows nothing of who
 * rolled it. So a Perceptive Fox's 4th question on a 10+ quietly let go of her 1st, and her 6-
 * showed no list at all. This is the per-roller half, laid over that stamp where the roll card is
 * built and the roller is known (item/StonetopItem.js#roll).
 *
 * The "you can always ask X for free, even on a 6-" moves (Hound of Aratis, Vision Unclouded, Sniff
 * Out Corruption, Attuned, Voice of Experience, Expert Tracker) are here too, as a row of their own
 * shape: `freeQuestion`. They grant ONE named question OUTSIDE the count, which a capped list cannot
 * say, so they never touch the list or its stamp. Each is a line of its own under the list
 * (`freeQuestionLines`), shown on every tier, the 6- included, where the list itself is hidden.
 * So are the Seeker's Deep Insight (one question "not limited to the list", about something magical)
 * and Well Versed (a follow-up of your choice on Know Things about one of your topics): their question
 * is the roller's own, so the line names what it may be rather than quoting it, and Well Versed's
 * lands at the end of a Know Things card, which prints no list.
 */

import { ownsLearnedMoveNamed } from "./owns-move.js";
import { INVOKE_THE_SUN_GOD, EMPOWERED_INVOCATIONS } from "./holy-light.js";
import { THE_NATURAL } from "../../data/alt-stat-grants.js";
import { actorTookBackground } from "./took-background.js";
import { pickListItem, pickListStampAttrs, readPickListStamp } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { TIER_KEYS } from "../../utils/move-results.js";
import { format, localize } from "../../utils/i18n.js";

/**
 * `move` is the move whose list changes. The row applies when the roller has `ownsLearned`
 * LEARNED, or took `background` (`{ playbook, slug, label }`).
 *
 * `plus` raises every tier that already reaches the list; `missFloor` opens the 6- with that many.
 * `addOptions` are appended to the list, in the granting text's own words (pinned against the pack
 * by tests/actors/character/move-pick-bonuses.test.js, so a reworded source fails a test rather
 * than drifting).
 *
 * `freeQuestion` is a question the roller may always ask on top of whatever the tier allows, on
 * every tier: it is not an option on the list and not one of its count. `when` is the granting
 * move's own narrower trigger, where it has one (Expert Tracker's is Seek Insight "by searching
 * for or studying the signs left by passing creatures"). The card cannot tell how the roller
 * studied, so the line says the condition and the table honours it.
 *
 * `capTo` LOWERS a tier's cap (`{partial: 1}`), for a move that takes a chooser away rather than
 * adding a choice. `rollOption` gates a row on something decided for THIS roll rather than owned,
 * read from the roll's pick context (StonetopCharacter#withPickContext): an Invocation empowered
 * before the dice. `detailKey` replaces the note's generated "N more on a hit" with the move's own
 * words, where the count alone would misdescribe it. Rows apply in table order, which matters for
 * Invoke the Sun God: Glorious Servant's 7-9 of 1 is set before Empowered's +1 lands on it.
 */
export const MOVE_PICK_BONUSES = [
	{ move: "Seek Insight", ownsLearned: "Perceptive", plus: 1, missFloor: 1 },
	{ move: "Seek Insight", background: THE_NATURAL,
		addOptions: ["What opportunity does no one else see?"] },
	// The Heavy's Situational Awareness. Its "when a fight breaks out, ask the GM 1 question" half
	// is the table's to honour: nothing is rolled there to hang a list on.
	{ move: "Seek Insight", ownsLearned: "Situational Awareness",
		addOptions: ["Who or what here is the biggest threat?", "What is my enemy's true position?", "What here can I use as a weapon?"] },
	// The Ranger's Predator. Its "deal an extra 1d4 damage" when acting on either answer rides the
	// damage roll (fight/hero-moves.js), not this list.
	{ move: "Seek Insight", ownsLearned: "Predator",
		addOptions: ["Who or what here is the easiest prey?", "How is ________ weak or vulnerable?"] },
	{ move: "Forage", ownsLearned: "Survivalist", plus: 1, missFloor: 1,
		addOptions: ["Find or fashion some useful item or supply (GM can veto)"] },
	// Free questions, even on a 6-. Two of them are already on Seek Insight's printed list (Expert
	// Tracker's, Voice of Experience's): the move makes that one free, it does not add it.
	{ move: "Seek Insight", ownsLearned: "Hound of Aratis",      freeQuestion: "What here is tainted by chaos?" },
	{ move: "Seek Insight", ownsLearned: "Vision Unclouded",     freeQuestion: "What here is hidden by illusion or magic?" },
	{ move: "Seek Insight", ownsLearned: "Sniff Out Corruption", freeQuestion: "What here stinks of the unnatural?" },
	{ move: "Seek Insight", ownsLearned: "Attuned",              freeQuestion: "What here is infused with magic?" },
	{ move: "Seek Insight", ownsLearned: "Voice of Experience",  freeQuestion: "What is about to happen?" },
	{ move: "Seek Insight", ownsLearned: "Expert Tracker",       freeQuestion: "What happened here recently?",
		when: "Seek Insight by searching for or studying the signs left by passing creatures" },
	// The Seeker's. Let's Make a Deal's Persuade half is a roll-window line (StonetopCharacter.js's
	// FICTION_ROLL_OFFERS); Deep Insight and Well Versed are free questions of the roller's own choosing.
	{ move: "Seek Insight", ownsLearned: "Let's Make a Deal",
		addOptions: ["What do they really want or need?"] },
	{ move: "Seek Insight", ownsLearned: "Deep Insight",         freeQuestion: "one additional question, not limited to the list",
		when: "Seek Insight about something magical" },
	{ move: "Know Things",  ownsLearned: "Well Versed",          freeQuestion: "a follow-up question of your choice",
		when: "Know Things about one of your topics" },
	// The Marshal's Like an Open Book (Book I p.127): "When you Take the Measure of someone who fears or respects
	// you, your second question can be anything you want. The GM might ask how you could possibly know this; tell
	// them or ask something else." Not an extra question but the second one opened up, so its line says so
	// (`lineKey`). Take the Measure is posted unrolled, so this rides its posted card.
	{ move: "Take the Measure", ownsLearned: "Like an Open Book", freeQuestion: "your second question can be anything you want",
		when: "Take the Measure of someone who fears or respects you", lineKey: "stonetop.pickBonus.openQuestion" },
	// The Lightbearer's consequence list. Glorious Servant: "on a 10+, you need not choose a
	// consequence; on a 7-9, you choose a consequence but the GM does not", so the 7-9's "you and
	// the GM each choose 1" (2) is 1, and the 10+'s 1 stands as the most, taken or not. Empowered
	// Invocations: "choose an extra consequence before you roll", on whichever tier comes up.
	{ move: INVOKE_THE_SUN_GOD, ownsLearned: "Glorious Servant", capTo: { partial: 1 },
		detailKey: "stonetop.invocations.pickGloriousServant" },
	{ move: INVOKE_THE_SUN_GOD, ownsLearned: EMPOWERED_INVOCATIONS, rollOption: "empowered", plus: 1,
		label: "Empowered", detailKey: "stonetop.invocations.pickEmpowered" },
];

/**
 * The MOVE_PICK_BONUSES rows `actor` brings to a roll of `moveName`, in table order. A character's
 * alone: a monster or NPC rolling a move brings nothing to it. `context` is the roll's pick context
 * (`{empowered, burnTwice}`, see StonetopCharacter#withPickContext): a `rollOption` row needs its
 * key set there as well as its move learned.
 */
export function movePickBonusesFor(actor, moveName, context = null) {
	if (actor?.type !== "character" || !moveName) return [];
	const rows = MOVE_PICK_BONUSES.filter(b => b.move === moveName);
	if (!rows.length) return [];
	return rows.filter(b => {
		if (b.rollOption && !context?.[b.rollOption]) return false;
		return b.background
			? actorTookBackground(actor, b.background)
			: ownsLearnedMoveNamed(actor, b.ownsLearned);
	});
}

const _OPEN_RE = /<ul class="stonetop-picklist"([^>]*)>([\s\S]*?)<\/ul>/i;

/**
 * `html` (a card body whose FIRST tickable list is the move's own) with `bonuses` laid over that
 * list's stamp and rows. Unchanged when there is no list or nothing to lay.
 *
 * The caps go per tier, since a miss that opens with a floor of 1 must not also lift a 10+ to its
 * cap: a flat `data-pick-max` is spread over the tiers first. A tier the move left uncapped stays
 * uncapped. Added options go on the END, because `data-index` is positional and a message's saved
 * ticks must still land on the options they were put on.
 */
export function applyPickBonuses(html, bonuses = []) {
	const src = String(html ?? "");
	// A free question is none of the list's business (freeQuestionLines).
	if (!bonuses.some(b => b.plus || b.missFloor || b.capTo || b.addOptions?.length)) return src;
	const open = _OPEN_RE.exec(src);
	if (!open) return src;
	const attrs = open[1];

	const { caps, tiers: stampedTiers } = readPickListStamp(attrs);
	// An unstamped list reaches every tier (utils/pick-tally.js#tierOffersPicks).
	const reaches = new Set(stampedTiers.length ? stampedTiers : TIER_KEYS);

	for (const b of bonuses) {
		for (const t of TIER_KEYS) {
			// Only ever DOWN, and only on a tier that already has a cap to lower.
			if (b.capTo?.[t] != null && reaches.has(t) && caps[t] > 0) caps[t] = Math.min(caps[t], b.capTo[t]);
			if (b.plus && reaches.has(t) && caps[t] > 0) caps[t] += b.plus;
		}
		if (b.missFloor && !reaches.has("failure")) {
			reaches.add("failure");
			caps.failure = b.missFloor;
		}
	}

	const kept = attrs
		.replace(/\sdata-pick-max(?:-[a-z]+)?="[^"]*"/gi, "")
		.replace(/\sdata-pick-tiers="[^"]*"/gi, "");
	const stamp = pickListStampAttrs(
		Object.fromEntries(TIER_KEYS.filter(t => caps[t] > 0).map(t => [t, caps[t]])),
		stampedTiers.length ? TIER_KEYS.filter(t => reaches.has(t)) : []);

	const start = (open[2].match(/<li\b/gi) ?? []).length;
	const added = bonuses.flatMap(b => b.addOptions ?? []).map((text, i) => pickListItem(escHtml(text), start + i)).join("");

	const rebuilt = `<ul class="stonetop-picklist"${kept}${stamp}>${open[2]}${added}</ul>`;
	return src.slice(0, open.index) + rebuilt + src.slice(open.index + open[0].length);
}

/**
 * The line a card carries under the list, naming what changed its count, so a "0/4 selected" over
 * a move that prints "ask 3" says where the 4th came from. Empty for a row that only adds options:
 * the added option is on the list itself, and says so.
 */
export function pickBonusNotes(bonuses = []) {
	return bonuses.filter(b => b.plus || b.missFloor || b.capTo).map(b => {
		const detail = b.detailKey ? localize(b.detailKey) : [
			b.plus      ? format("stonetop.pickBonus.plus",      { n: b.plus }) : null,
			b.missFloor ? format("stonetop.pickBonus.missFloor", { n: b.missFloor }) : null,
		].filter(Boolean).join(localize("stonetop.pickBonus.joiner"));
		const source = b.label ?? b.ownsLearned ?? b.background?.label ?? "";
		return `<p class="stonetop-pick-bonus-note"><em>${escHtml(format("stonetop.pickBonus.note", { source, detail }))}</em></p>`;
	}).join("");
}

/**
 * One line per free question: "Free question (Hound of Aratis): What here is tainted by chaos?".
 * Not a box on the list, because a box there would be one of its count, and a 10+ must still ask
 * its 3 besides. Not tier-hidden either, as the list is on a 6-: the move says "even on a 6-".
 *
 * Each line carries its granting move as `data-free-question`, for a card handler that has to know
 * the question was there to ask (Voice of Experience's is one of the Would-Be Hero's asterisk uses).
 */
export function freeQuestionLines(bonuses = []) {
	return bonuses.filter(b => b.freeQuestion).map(b => {
		const source = b.when ? format("stonetop.pickBonus.freeWhen", { source: b.ownsLearned, when: b.when }) : b.ownsLearned;
		const text = format(b.lineKey ?? "stonetop.pickBonus.freeQuestion", { source, question: b.freeQuestion });
		return `<p class="stonetop-free-question" data-free-question="${escHtml(b.ownsLearned ?? "")}"><em>${escHtml(text)}</em></p>`;
	}).join("");
}

/**
 * `applyPickBonuses` and its note, for `actor` rolling `moveName`: the one call a card builder makes.
 * The free questions go straight under the move's list, beside the questions they sit outside of,
 * or at the end of a card that has no list.
 */
export function withMovePickBonuses(html, actor, moveName, context = null) {
	const src = String(html ?? "");
	const bonuses = movePickBonusesFor(actor, moveName, context);
	if (!bonuses.length) return src;
	const applied = applyPickBonuses(src, bonuses);
	// No list to lay them over, no note: it would name a count nothing on the card shows.
	const notes = applied === src ? "" : pickBonusNotes(bonuses);
	const free = freeQuestionLines(bonuses);
	const list = free ? _OPEN_RE.exec(applied) : null;
	const withFree = list
		? applied.slice(0, list.index + list[0].length) + free + applied.slice(list.index + list[0].length)
		: applied + free;
	return withFree + notes;
}
