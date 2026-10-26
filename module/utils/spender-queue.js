// ── One spend at a time out of one character's pool ────────────────────────
// A card's presses take turns on the card (card-queue.js), so two presses on ONE card never both spend the
// same pip. Two presses on two DIFFERENT cards are in two different lines, though, and both can draw on the
// same purse: a defender's last Readiness halving two blows, a Judge's last Diligence lifting two rolls. Each
// reads "1 held", each writes "0", and one point buys two.
//
// So the read and the write of a spender's pool take turns on the spender, too. One line per actor, on this
// client, inside the card's turn (always card first, then spender, never the other way round), and around the
// pool's own read and write only: the card's write and anything it sets off run after the spender's turn is
// over, so nothing in it can wait on another card while holding the spender.

import { inTurn } from "./turn-queue.js";

/**
 * Run `work` (a pool's read-then-write) in `actor`'s spending turn on this client. With no actor, run it as is.
 *
 * @template T
 * @param {{uuid?: string, id?: string}|null} actor
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export function inSpenderTurn(actor, work) {
	const key = actor?.uuid ?? actor?.id;
	if (!key) return Promise.resolve().then(work);
	return inTurn(`spender:${key}`, work);
}
