// "Give me one" — the randomizer beside each GM Moves heading. Picks a move out of that
// section's list, and whispers it to the GM once the sheet's light has landed on it
// (StonetopGmToolkitSheet `_spinToDrawnMove`).
//
// The paper playbook's lists are for reading down when there is time. This is for the other
// case: the table has just handed the GM a golden opportunity, everyone is looking at them,
// and the list has gone to soup. One move, named, with its gloss, is something to react to in
// a way that thirty of them is not.
//
// WHISPERED, never public, and that is not a preference. A GM move lands when it arrives as
// fiction — "the bridge gives" — so posting the mechanical name of the move to the table
// announces the trick before it is played, and hands the players the move the GM has not made
// yet. Public would break the thing this is meant to help with.
//
// The pick is a pure function over an injectable `rng`, the way every other random pick in
// this system is written (pickRandomPortrait, rollOnTable, rollTerrain), so the tests pin the
// roll rather than hoping for one.
import { gmMoveSection } from "./gm-moves.js";
import { bookPageRef } from "./book-ref.js";
import { pickRandomExcluding } from "../utils/arrays.js";
import { stonetopChatCard, moveChatCard } from "../utils/chat.js";
import { escHtml } from "../utils/strings.js";
import { localize } from "../utils/i18n.js";

/**
 * One move out of a section's list, at random.
 *
 * Prefers a move OTHER than `exclude` — the caller passes the last one it drew for this
 * section, so clicking twice always moves on. A randomizer that says "Hurt someone" twice in a
 * row reads as broken rather than random, and with seven moves in the shortest list that is a
 * one-in-seven event, not a curiosity. Falls back to the whole list when excluding would leave
 * nothing, which is only a one-move section.
 *
 * @param   {string} sectionKey  "basic" | "exploration" | "homefront"
 * @param   {object} [options]
 * @param   {() => number} [options.rng]  Injectable for the tests.
 * @param   {string} [options.exclude]    Name of the move to avoid repeating.
 * @returns {import("./gm-moves.js").GmMove|null}  null for an unknown section key.
 */
export function randomGmMove(sectionKey, { rng = Math.random, exclude = "" } = {}) {
	const moves = gmMoveSection(sectionKey)?.moves ?? [];
	return pickRandomExcluding(moves, { exclude, rng, keyOf: m => m?.name ?? m });
}

/**
 * The card's body: our gloss, then the book's own material for this move.
 *
 * ONE example, not all of them. The card is read mid-sentence with the table waiting, and three
 * quoted paragraphs is a page to skim rather than a line to say; the sheet's own row expands to
 * show the rest. Drawn at random so a GM who draws the same move next session gets a different
 * one of its examples, which is also why `rng` is injectable.
 *
 * The example is a QUOTATION from Book I, marked up as one, and the page is printed under it.
 * That matters twice over: it is the book's voice and not ours (it names the book's sample cast,
 * so a GM reading "Rhianna" needs to know why), and it is the pointer to the full entry.
 *
 * Everything here goes through escHtml. `moveChatCard` renders its description RAW, because its
 * usual caller passes move text that was escaped at storage; this text is plain prose out of
 * module source and several lines of it carry quote marks.
 */
function gmMoveCardBody(move, rng) {
	const parts = [`<p class="stonetop-gm-move-card-gloss">${escHtml(move.gloss)}</p>`];

	const example = pickRandomExcluding(move.examples ?? [], { rng });
	if (example) {
		parts.push(`<blockquote class="stonetop-gm-move-card-example">${escHtml(example)}</blockquote>`);
	}
	if (move.hardness) {
		parts.push(`<p class="stonetop-gm-move-card-hardness">${escHtml(move.hardness)}</p>`);
	}
	const pageRef = bookPageRef(move);
	if (pageRef) parts.push(`<p class="stonetop-gm-move-card-page">${escHtml(pageRef)}</p>`);
	return parts.join("");
}

/**
 * Whisper a drawn move to the GMs. Returns the move posted; null when nothing went out.
 *
 * Takes the move rather than drawing one, because the two are separated by the walk: the sheet
 * draws first (it needs the answer to know which row to land the light on), spins, and posts when
 * the light arrives. A card that went out at the click would answer the question the animation is
 * in the middle of asking.
 *
 * @param   {string} sectionKey
 * @param   {import("./gm-moves.js").GmMove|null} move
 * @param   {object} [options]
 * @param   {object} [options.speaker]  ChatMessage speaker data.
 * @param   {() => number} [options.rng]  Which of the move's examples to quote.
 * @returns {Promise<import("./gm-moves.js").GmMove|null>}
 */
export async function postGmMove(sectionKey, move, { speaker, rng } = {}) {
	// Resolved for its `titleKey` — the card's one title line.
	const section = gmMoveSection(sectionKey);
	if (!move || !section) return null;
	if (!globalThis.ChatMessage?.create) return null;

	await ChatMessage.create({
		// The section's own name and nothing else — "GM Moves", "Exploration", "Homefront".
		// This row is the card's FRAME; the move under it is the subject, and the frame earns
		// one line at most. A prompt ("Make a GM move") only says what the card already is, and
		// the section's note ("Any time you owe the table a move") is a rule about when to reach
		// for the list, which is not what a GM reads a drawn move for.
		content: stonetopChatCard(
			localize(section.titleKey),
			moveChatCard(move.name, gmMoveCardBody(move, rng)),
			"stonetop-gm-move-chat-card",
		),
		// All GMs, which is what "GM only" means here: a second GM at the table is running the
		// same fiction and is not who this is being hidden from. Players are.
		whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
		speaker,
	});
	return move;
}
