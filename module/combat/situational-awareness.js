// The Heavy's Situational Awareness (Book I p.114): "When you Seek Insight, add the following to the list of
// questions you can ask: Who or what here is the biggest threat? / What is my enemy's true position? / What
// here can I use as a weapon? When a fight breaks out, ask the GM 1 question that you could ask when Seeking
// Insight."
//
// The first half rides Seek Insight's own card (actors/character/move-pick-bonuses.js). This is the second:
// a fight breaking out is the character joining one (the Fight tab starting it or adding them, or core's
// tracker), the same moment battle-holds.js reads as going into battle. Nothing is rolled there to hang a
// list on, so the reminder is a card of its own: whispered to the GM and whoever plays the character, since
// the question and its answer are theirs, listing every question this character could ask when Seeking
// Insight (give-advantage.js#seekInsightQuestionsFor, the one reading of that list), the move's own three
// among them. A reminder, not a gate: which question, and whether it is asked, is the table's.
//
// ONE CARD. Posted on the one client that answers for the character (DeathsDoorPrompt.js#answersFor: their
// player, else another owner, else a GM), as battle-holds.js asks. Not the primary GM's: that guard is
// false on every client when no GM is connected, and a card that reaches the player is the point. And once
// per character per fight: a second token of the same character joining the same Combat is the same Heavy
// already told, so each client keeps which characters each Combat has reminded (marked on every client, not
// only the one that posts, so an answerer who changes mid-fight still knows), forgotten when the Combat is
// deleted. The record is in memory: a client reloaded mid-fight that is then sent a second token for the
// same character reminds them again, which costs one repeated card and no state.

import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { seekInsightQuestionsFor } from "../actors/character/give-advantage.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { moveChatCard } from "../utils/chat.js";
import { whisperFor } from "../utils/playbook-actors.js";
import { escHtml } from "../utils/strings.js";
import { localize } from "../utils/i18n.js";

const KEY = "stonetop.situationalAwareness";

export const SITUATIONAL_AWARENESS = "Situational Awareness";

/** Which characters each Combat has reminded, by Combat id: this client's record. */
const REMINDED = new Map();

/**
 * Whether `actor` joining `combat` should be reminded: a character holding the move LEARNED, not yet
 * reminded in this Combat (`reminded`, Combat id to a Set of actor ids). PURE apart from reading the actor.
 */
export function shouldRemindSituationalAwareness(actor, combat, reminded = REMINDED) {
	if (actor?.type !== "character" || !actor.id || !combat?.id) return false;
	if (reminded.get(combat.id)?.has(actor.id)) return false;
	return ownsLearnedMoveNamed(actor, SITUATIONAL_AWARENESS);
}

/** The card: the move's fight-start line, then every question this character could ask when Seeking Insight. */
export function situationalAwarenessCardHtml(actor) {
	const questions = seekInsightQuestionsFor(actor).map(question => `<li>${escHtml(question)}</li>`).join("");
	return moveChatCard(localize(`${KEY}.title`), `<p>${escHtml(localize(`${KEY}.lead`))}</p><ul>${questions}</ul>`);
}

/** Post it, spoken as the character, to the GM and whoever plays them (playbook-actors.js#whisperFor). */
export function postSituationalAwareness(actor, { users = globalThis.game?.users } = {}) {
	return globalThis.ChatMessage?.create?.({
		content: situationalAwarenessCardHtml(actor),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
		whisper: whisperFor(actor, users),
	});
}

/**
 * Remind a character with Situational Awareness, joining a fight, of the question it lets them ask.
 *
 * @param {{hooks?: object, post?: typeof postSituationalAwareness, answers?: typeof answersFor,
 *   reminded?: Map<string, Set<string>>}} [deps]
 * @returns {() => void} stops listening
 */
export function installSituationalAwareness({
	hooks = globalThis.Hooks, post = postSituationalAwareness, answers = answersFor, reminded = REMINDED,
} = {}) {
	const created = hooks.on("createCombatant", combatant => {
		const actor = combatant?.actor;
		const combat = combatant?.parent ?? combatant?.combat;
		if (!shouldRemindSituationalAwareness(actor, combat, reminded)) return;
		// Marked before the post, and on every client: two tokens joining together are one card.
		if (!reminded.has(combat.id)) reminded.set(combat.id, new Set());
		reminded.get(combat.id).add(actor.id);
		if (!answers(actor)) return;
		Promise.resolve(post(actor))
			.catch(err => console.error("Stonetop | the Situational Awareness reminder failed", err));
	});
	const deleted = hooks.on("deleteCombat", combat => { reminded.delete(combat?.id); });
	return () => {
		hooks.off("createCombatant", created);
		hooks.off("deleteCombat", deleted);
	};
}
