import { escHtml, stripHtmlToText } from "../utils/strings.js";

// Three basic moves are made BY one character and settled by SOMEONE ELSE:
//
//  • Aid: "When you help someone who has not yet rolled, the GM picks 1: they can accomplish more
//    than they could alone / they gain advantage on their roll. Either way, you are exposed to any
//    risk, cost, or consequence associated with their roll."
//  • Interfere: on a 7+ the PC being foiled picks 1: "do it anyway, but with disadvantage on their
//    (next) roll" or "relent, change course, or otherwise allow their move to be foiled".
//  • Persuade (vs. PCs): on a 7+ "they mark XP if they do what you want"; on a 10+ a refusal must
//    say how you could convince them, and on a 7-9 they may refuse or counter-offer.
//
// So the card the move posts carries the OTHER person's answer: the GM's buttons for Aid, the foiled
// or pressed character's player's for the other two. Whoever answers posts a short card of their
// own (see pc-ask-flow.js), which is what lets a player answer a card another player wrote, since
// Foundry only lets a message's author or a GM change it. The asking card reads its answer off
// that second card every time it is drawn.
//
// Pure: every word, every rule. No Foundry global, no document.

export const AID_MOVE = "Aid";
export const INTERFERE_MOVE = "Interfere";
export const PERSUADE_PC_MOVE = "Persuade (vs. PCs)";

/** On the asking card: `{move, byId, byName, targetId, targetName}` (actor ids and names). */
export const PC_ASK_FLAG = "pcAsk";
/** On the answer card: `{to, choice}`, the asking card's message id and what was picked. */
export const PC_ANSWER_FLAG = "pcAnswer";

/**
 * Each move's question.
 *
 * `chooser` is who answers: "gm" (Aid) or "target" (the other character's player, or a GM standing
 * in for a player who is away; see `mayAnswer`).
 *
 * `options` answer IN THE MOVE'S OWN PRINTED LIST: its bullets become the buttons, where the move
 * prints them, so the choice appears once on the card (the one-list rule). Each is matched to a
 * bullet by the words the bullet opens with, never by position, so a list reordered by an erratum
 * still answers the right way.
 *
 * `tierChoices` is for Persuade, whose outcomes are prose with no list to answer in: its answers are
 * a row of buttons under the result, one row per tier, which the roll card shows and hides with the
 * tier as a GM's Shift Up/Down moves it.
 *
 * `tiers` is which results open the question at all. Aid has no roll, so it is always open.
 */
export const PC_ASKS = {
	[AID_MOVE]: {
		chooser: "gm",
		tiers: null,
		options: [
			{ choice: "more", opens: "they can accomplish more" },
			{ choice: "advantage", opens: "they gain advantage" },
		],
	},
	[INTERFERE_MOVE]: {
		chooser: "target",
		tiers: ["success", "partial"],
		options: [
			{ choice: "anyway", opens: "do it anyway" },
			{ choice: "relent", opens: "relent" },
		],
	},
	[PERSUADE_PC_MOVE]: {
		chooser: "target",
		tiers: ["success", "partial"],
		tierChoices: {
			success: ["agree", "refuse"],
			partial: ["agree", "counter"],
		},
	},
};

/** The question a move asks, or null for a move that asks nobody anything. */
export function pcAskFor(moveName) {
	return PC_ASKS[moveName] ?? null;
}

/**
 * Whether this item is one of the three, as the book prints it. A player's own custom move that
 * happens to share the name acts as itself, the rule the guided moves already follow.
 */
export function isPcAskMove(item) {
	return item?.type === "move" && item.system?.moveType !== "other" && !!pcAskFor(item?.name);
}

/** Whether the question is open at this result. Aid is always open; a 6- asks nothing. */
export function asksAtTier(moveName, tier) {
	const def = pcAskFor(moveName);
	if (!def) return false;
	return !def.tiers || def.tiers.includes(tier);
}

/**
 * Whether a user may answer.
 *
 * ONE side answers at a time. The GM answers for the target only while none of its players is
 * logged in: each answer is its own card and its own effect, with nothing to referee two given at
 * once, so a GM and a player both answering would each hold the disadvantage or mark the XP.
 *
 * @param {object} ask  the asking card's flag
 * @param {{isGM: boolean, ownsTarget: boolean, playerHere: boolean}} who  `playerHere`: a player
 *   who owns the target is logged in
 */
export function mayAnswer(ask, { isGM = false, ownsTarget = false, playerHere = false } = {}) {
	const def = pcAskFor(ask?.move);
	if (!def) return false;
	if (def.chooser === "gm") return !!isGM;
	return isGM ? !playerHere : !!ownsTarget;
}

/** Which of a move's printed options a bullet is, by the words it opens with. Null for none. */
export function choiceForOption(moveName, text) {
	const def = pcAskFor(moveName);
	const said = String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
	if (!def?.options || !said) return null;
	return def.options.find(option => said.startsWith(option.opens))?.choice ?? null;
}

/** Whether a choice is one this move offers at this tier. */
export function offersChoice(moveName, choice, tier) {
	const def = pcAskFor(moveName);
	if (!def || !asksAtTier(moveName, tier)) return false;
	if (def.options) return def.options.some(option => option.choice === choice);
	return (def.tierChoices?.[tier] ?? []).includes(choice);
}

/**
 * The answer to a card, from the chat log: the first message whose answer flag points at it.
 *
 * @param {Iterable<object>|{contents: object[]}} messages  the chat log, or any list of messages
 * @param {string} askId  the asking card's message id
 * @param {(message: object) => object|null} readAnswer  reads a message's answer flag
 * @returns {{message: object, choice: string}|null}
 */
export function findPcAnswer(messages, askId, readAnswer) {
	if (!askId) return null;
	// Walked in place: `contents` copies the whole log, and this runs every time an asking card is drawn.
	const list = messages?.[Symbol.iterator] ? messages : messages?.contents ?? [];
	for (const message of list) {
		const answer = readAnswer(message);
		if (answer?.to === askId && answer.choice) return { message, choice: answer.choice };
	}
	return null;
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────
// English on purpose, like the camp's and the struggle's: the answer card is persisted in the chat
// log, and the words drawn over the asking card have to agree with it.

const name = (value, fallback) => String(value ?? "").trim() || fallback;
const namesOf = ask => ({ by: name(ask?.byName, "Someone"), target: name(ask?.targetName, "they") });

/** What promised the held mode, as the roll card's pill and the sheet's tooltip name it. */
export function heldSource(ask) {
	const { by } = namesOf(ask);
	return ask?.move === INTERFERE_MOVE ? `Interfered with by ${by}` : `${by}'s Aid`;
}

/** The label on each of Persuade's buttons, spoken to the player pressing it. */
export function choiceLabel(ask, choice) {
	const { by } = namesOf(ask);
	switch (choice) {
		case "agree":   return "Do it, and mark XP";
		case "refuse":  return `Refuse, and say how ${by} could convince you`;
		case "counter": return "Refuse, or make a counter-offer";
		default:        return choice;
	}
}

/** The sentence an answer makes: on the answer card, and in place of the buttons it answered. */
export function answerSentence(ask, choice) {
	const { by, target } = namesOf(ask);
	const exposed = `${by} is exposed to any risk, cost, or consequence of it.`;
	switch (choice) {
		case "more":      return `With ${by}'s help, ${target} can accomplish more than they could alone. ${exposed}`;
		case "advantage": return `${target} gains advantage on their roll, from ${by}'s help. ${exposed}`;
		case "anyway":    return `${target} does it anyway, with disadvantage on their next roll.`;
		case "relent":    return `${target} relents, and ${by} foils their action.`;
		case "agree":     return `${target} does what ${by} wanted, and marks XP.`;
		case "refuse":    return `${target} refuses, and says how ${by} could convince them.`;
		case "counter":   return `${target} refuses, or makes a counter-offer.`;
		default:          return "";
	}
}

/** What a reader who cannot answer is told while the question is open. */
export function waitingSentence(ask) {
	const def = pcAskFor(ask?.move);
	const { target } = namesOf(ask);
	if (def?.chooser === "gm") return "The GM picks 1.";
	return def?.options ? `${target} picks 1.` : `${target} decides.`;
}

/** Aid's opening line on its card, naming who is helping whom. */
export function aidLead(ask) {
	const { by, target } = namesOf(ask);
	return `${by} helps ${target}.`;
}

/** The pill a rolled ask wears beside the roll's other conditions, naming whom it is aimed at. */
export function askPill(ask) {
	const { target } = namesOf(ask);
	switch (ask?.move) {
		case INTERFERE_MOVE:   return `Foiling ${target}`;
		case PERSUADE_PC_MOVE: return `Pressing ${target}`;
		default:               return "";
	}
}

/** The "who?" window's words, per move. */
export function pickerText(moveName) {
	switch (moveName) {
		case AID_MOVE: return {
			title: "Aid: who are you helping?",
			hint: "Someone who has not yet rolled. The GM picks how your help lands, and you share whatever comes of their roll.",
			icon: "fa-handshake-angle",
			button: target => `Help ${target}`,
		};
		case INTERFERE_MOVE: return {
			title: "Interfere: whose action are you foiling?",
			hint: "Only when neither of you backs down. On a hit, they pick whether to go ahead with disadvantage or to relent.",
			icon: "fa-hand",
			button: target => `Interfere with ${target}`,
		};
		case PERSUADE_PC_MOVE: return {
			title: "Persuade: whom are you pressing?",
			hint: "Ask their player first: “Could I possibly get you to do this, yes or no?” On a no, let it drop and don't roll.",
			icon: "fa-comments",
			button: target => `Persuade ${target}`,
		};
		default: return null;
	}
}

// ── Markup ───────────────────────────────────────────────────────────────────────────────────────

const status = text => `<p class="stonetop-pc-ask-status">${escHtml(text)}</p>`;

/**
 * The move's printed list, as the one place its question is answered.
 *
 * Returns null where the list should be left exactly as printed: a tier that asks nothing (an
 * Interfere 6-), or a list none of whose bullets is one of the move's options.
 *
 * @param {object} p
 * @param {object} p.ask            the asking card's flag
 * @param {string[]} p.items        each bullet's inner HTML, as printed
 * @param {string|null} p.tier      the card's result tier (null for Aid)
 * @param {string|null} p.answered  the choice already made, if any
 * @param {boolean} p.canAnswer     whether this reader may answer
 */
export function answerListHtml({ ask, items = [], tier = null, answered = null, canAnswer = false }) {
	if (!asksAtTier(ask?.move, tier)) return null;
	const choices = items.map(inner => choiceForOption(ask.move, stripHtmlToText(inner)));
	if (!choices.some(Boolean)) return null;
	const open = !answered && canAnswer;
	const rows = items.map((inner, index) => {
		const choice = choices[index];
		const state = !answered ? "" : choice === answered ? " is-chosen" : " is-passed";
		const body = open && choice
			? `<button type="button" class="stonetop-pc-answer" data-pc-answer="${escHtml(choice)}">${inner}</button>`
			: `<span class="stonetop-pc-answers-text">${inner}</span>`;
		return `<li class="stonetop-pc-answers-item${state}">${body}</li>`;
	}).join("");
	const line = answered ? answerSentence(ask, answered) : open ? "" : waitingSentence(ask);
	return `<div class="stonetop-pc-answers"><ul>${rows}</ul>${line ? status(line) : ""}</div>`;
}

/**
 * Persuade's row of answers for one tier: its buttons, the answer once given, or who is deciding.
 * Also what the roll card is posted with (as a reader who cannot answer would see it), so a card
 * drawn anywhere this wiring does not reach still says who decides.
 */
export function answerRowHtml({ ask, tier, answered = null, canAnswer = false }) {
	const def = pcAskFor(ask?.move);
	const choices = def?.tierChoices?.[tier] ?? [];
	if (!choices.length) return "";
	if (answered) return status(answerSentence(ask, answered));
	if (!canAnswer) return status(waitingSentence(ask));
	return choices.map(choice =>
		`<button type="button" class="stonetop-pc-answer" data-pc-answer="${escHtml(choice)}">${escHtml(choiceLabel(ask, choice))}</button>`,
	).join("");
}

/** The tier rows a Persuade roll card is posted with, keyed by tier (roll-engine's tierActions). */
export function persuadeTierActions(ask) {
	const def = pcAskFor(ask?.move);
	return Object.fromEntries(Object.keys(def?.tierChoices ?? {}).map(tier =>
		[tier, `<div class="stonetop-pc-ask" data-pc-ask-tier="${escHtml(tier)}">${answerRowHtml({ ask, tier })}</div>`],
	));
}

/** The answer card's body: the sentence, spoken as the character who answered for. */
export function answerCardBody(ask, choice) {
	return `<p>${escHtml(answerSentence(ask, choice))}</p>`;
}
