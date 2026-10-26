// ── One writer for a roll card's dice ───────────────────────────────────────
// A posted roll card's dice are rewritten from half a dozen places: the GM's Shift Up/Down, a Judge's or a
// Lightbearer's +1 (actors/character/roll-boosts.js), Burn Brightly, Impetuous Youth's "give it your all", a
// Seeker's Logbook or Books & Scrolls, and We Happy Few's Inspiration die on a damage card. Each reads the
// card's `rolls` and `flavor`, lifts the total, and writes both back WHOLE. Two clients doing that at once
// each write from their own copy, and whichever lands second erases the other's +1.
//
// So every rewrite keeps two rules, both kept here:
//
//  1. ONE CLIENT PER CARD (rollCardRoute). While a GM is connected, the primary GM's client writes every
//     player's rewrite of every card: each press is relayed there, to this file's ROLL_CARD_QUERY or to the
//     relay its own module already had (roll-boosts.js BOOST_QUERY, inspiration-flow.js INSPIRATION_QUERY,
//     deaths-door-relay.js DEATHS_DOOR_BOOST_QUERY). With no GM connected, only a card's author can write it
//     (a chat message is "the GM, or whoever authored it"), so that client is the one writer anyway. A GM's
//     own press is written on their own client: v13 names no asker for a GM's query (foundry-compat.js
//     #queryAsker), so a second GM could not be relayed, and two GMs pressing the same card at once is the
//     one race left.
//
//  2. ONE AT A TIME ON THAT CLIENT (writeCardRoll, called in the card's turn, utils/card-queue.js). The roll
//     is read when the turn comes, lifted on a COPY, and written with its redrawn flavor in one update, so a
//     write that is refused leaves the card's own roll as it was for the next press.

import { canUserWriteCard } from "./chat.js";
import { isPrimaryGM } from "./primary-gm.js";
import { askGMClient, queryAsker } from "./foundry-compat.js";

/**
 * Payload `{ action, messageId, userId, ...what the action needs }`; answers what the action answers, or null
 * when it was refused. The rewrites that had no relay of their own: Burn Brightly and giving it your all on a
 * roll card, and the Know Things upgrades (stonetop.js registers each with registerRollCardAction).
 */
export const ROLL_CARD_QUERY = "stonetop.rollCard";

/**
 * Where `user`'s rewrite of this card is written: `local` on this client (a GM, or a player who may write the
 * card with no GM connected), `relay` on the primary GM's (any player while a GM is connected, even on a card
 * they wrote), or null when nobody could (a player on another's card with no GM). PURE but for its defaults.
 *
 * @param {ChatMessage} message
 * @param {User} [user]
 * @param {User|null} [activeGM]
 * @returns {"local"|"relay"|null}
 */
export function rollCardRoute(message, user = globalThis.game?.user, activeGM = globalThis.game?.users?.activeGM ?? null) {
	if (activeGM && !user?.isGM) return "relay";
	return canUserWriteCard(message, user, { whenUnknown: !!user?.isGM }) ? "local" : null;
}

/** A copy of a card's roll to lift: a Roll through its own class, anything else (a plain record) by value. */
function copyRoll(roll) {
	const Class = roll?.constructor;
	if (typeof Class?.fromData === "function" && typeof roll.toJSON === "function") return Class.fromData(roll.toJSON());
	return { ...roll, terms: [...(roll?.terms ?? [])] };
}

/**
 * THE write of a card's new dice, for a caller already in the card's turn on the card's writer (see the
 * header): the card's roll read now, lifted on a copy by `lift(roll)` (through the rewrite's `shiftRoll`, or
 * a term of its own), then written in ONE update with the flavor redrawn for the new total and whatever else
 * the same rewrite owes (`update`: its latch flag, a re-stamped speaker; or a function of the lifted roll,
 * for a latch that records where it landed). `afterShift` then hears the new total. Answers the lifted roll.
 *
 * @param {ChatMessage} message
 * @param {(roll: Roll) => Promise<void>} lift
 * @param {object} rewrite  utils/roll-rewrite.js's hands
 * @param {(flavor: string, total: number, formula: string) => string} rewrite.cardFlavor
 * @param {(message: ChatMessage, total: number) => Promise<void>} [rewrite.afterShift]
 * @param {object|((roll: Roll) => object)} [update]  more of the same write (flags, speaker)
 * @returns {Promise<Roll>}
 */
export async function writeCardRoll(message, lift, { cardFlavor, afterShift = null } = {}, update = {}) {
	const roll = copyRoll(message.rolls.at(0));
	await lift(roll);
	await message.update({
		...(typeof update === "function" ? update(roll) : update),
		rolls:  [roll, ...message.rolls.slice(1)],
		flavor: cardFlavor(message.flavor, roll.total, roll.formula),
	});
	await afterShift?.(message, roll.total);
	return roll;
}

// ── The relay for the rewrites that had none ───────────────────────────────

const _actions = new Map();

/**
 * Name what one relayed rewrite does on the card's writer: `run({message, user, data})`, which checks `user`
 * may (their character, the spend, the card still offering it) and writes in the card's turn. It answers
 * something JSON-able, since a relayed press hears it through the query.
 */
export function registerRollCardAction(action, run) {
	_actions.set(action, run);
}

/**
 * Press `action` on a card: run here when this client is the card's writer, else on the primary GM's. `data`
 * is what the action needs beyond the card (a cost, a source), plain values only. Answers the action's own
 * answer, or null when nobody could write the card, or `noAnswer` (null by default) when the GM's client did not answer.
 *
 * @param {ChatMessage} message
 * @param {string} action
 * @param {object} [data]
 * @param {{user?: User, gm?: User|null, timeout?: number, noAnswer?: *}} [options]
 */
export async function pressRollCard(message, action, data = {}, {
	user = globalThis.game?.user, gm = globalThis.game?.users?.activeGM ?? null, timeout, noAnswer = null,
} = {}) {
	const route = rollCardRoute(message, user, gm);
	if (route === "local") return (await _actions.get(action)?.({ message, user, data })) ?? null;
	if (route !== "relay") return null;
	return askGMClient(gm, ROLL_CARD_QUERY, { ...data, action, messageId: message.id, userId: user?.id ?? null },
		{ fallback: noAnswer, what: "rewrite a roll card", ...(timeout ? { timeout } : {}) });
}

/**
 * The GM's side of ROLL_CARD_QUERY, for the primary GM only: the named action on the named card, for the player
 * who asked (foundry-compat.js#queryAsker). Null for anything it cannot place.
 */
export async function handleRollCardQuery(data, context = {}, {
	messages = globalThis.game?.messages, users = globalThis.game?.users,
} = {}) {
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return null;
	const user = queryAsker(data, context, users);
	const message = messages?.get?.(data?.messageId);
	const run = _actions.get(data?.action);
	if (!user || !message || !run) return null;
	return (await run({ message, user, data })) ?? null;
}
