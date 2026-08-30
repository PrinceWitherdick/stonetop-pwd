/**
 * What a Blessed can pay a Stock cost with, and how much is left in each.
 *
 * Danu's Grasp says "spend 1 Stock and roll +WIS", and a move that charges before it rolls has
 * to be able to answer two questions before the dice: can this character pay, and out of what.
 *
 * TWO PURSES, not one. Rites of the Land ends "Spend Favor in lieu of Stock, 1-for-1", so a
 * Blessed holding Favor and no Stock can still make the move — and a gate that only knew about
 * the pouch would block them from a move the book grants. Favor is only offered to a character
 * who actually owns that move, so nobody else sees a purse they do not have.
 *
 * THE TWO PURSES COUNT IN OPPOSITE DIRECTIONS, and getting that backwards is silent. Both store
 * a single number, but the test that settles which way it reads is the one know-things.js states
 * for the Logbook: a fresh character has no flag at all, and whatever that zero means must be
 * true of a character who has never touched the move.
 *
 *   · The sacred pouch is a CAPACITY. A Blessed starts with it FULL, so zero means nothing spent
 *     and a filled pip is Stock gone: `remaining = max - stored`, and spending INCREMENTS.
 *   · Favor is a POOL. "Once per season, when you oversee the sacred rites, hold 1 Favor" — a
 *     Blessed who has not done so holds NONE, so zero means an empty purse and a filled pip is
 *     Favor held: `remaining = stored`, and spending DECREMENTS.
 *
 * Read Favor the pouch's way and every Blessed who owns Rites of the Land is handed four Favor
 * they never earned, while one who has actually banked three reads as holding one.
 *
 * Foundry-free: every source is plain numbers plus an `after` that hands back the number to
 * store, so the whole thing is testable without a world.
 */

/** The Blessed's sacred pouch, where Stock lives. Its `max` can be raised (Big Magic). */
export const SACRED_POUCH_SLUG = "sacred-pouch";
export const RITES_OF_THE_LAND = "Rites of the Land";
export const DEFAULT_SACRED_POUCH_MAX = 3;

/**
 * @param {object} snapshot
 * @param {number} snapshot.pouchMax        the pouch's capacity
 * @param {number} snapshot.pouchStored     the number stored on the pouch (pips ticked = Stock SPENT)
 * @param {boolean} snapshot.hasPouch       is the pouch actually one of this character's possessions
 * @param {number|null} snapshot.favorMax   Rites of the Land's capacity, or null when unowned
 * @param {number} snapshot.favorStored     the number stored on that move (pips ticked = Favor HELD)
 * @returns {{key: string, label: string, remaining: number, spent: number, max: number}[]}
 *   Every purse this character HAS, empty ones included — an empty pouch is still worth showing,
 *   because "you have 0 Stock" is the sentence that explains why the roll is not offered.
 */
export function stockSources({ pouchMax = DEFAULT_SACRED_POUCH_MAX, pouchStored = 0, hasPouch = true, favorMax = null, favorStored = 0 } = {}) {
	const purse = (key, label, max, stored, countsHeld) => {
		const cap = Math.max(0, Math.trunc(Number(max) || 0));
		const have = Math.min(cap, Math.max(0, Math.trunc(Number(stored) || 0)));
		return {
			key, label, max: cap, stored: have, countsHeld,
			remaining: countsHeld ? have : Math.max(0, cap - have),
			// What to WRITE BACK after spending. The two purses move in opposite directions, so
			// this is asked of the purse rather than worked out at each spend site — the arithmetic
			// is the one thing about them that differs, and the one thing easy to get backwards.
			after: amount => {
				const n = Math.max(0, Math.trunc(Number(amount) || 0));
				return countsHeld ? Math.max(0, have - n) : Math.min(cap, have + n);
			},
		};
	};
	const out = [];
	// The pouch is a CAPACITY: a Blessed starts with it full, so a filled pip is Stock spent.
	if (hasPouch) out.push(purse("stock", "Stock", pouchMax, pouchStored, false));
	// Favor is a POOL: "once per season… hold 1 Favor" — a Blessed who has not overseen the rites
	// holds none, so a filled pip is Favor HELD and an empty track is an empty purse. Reading it
	// the pouch's way handed four Favor to every Blessed who owns the move and had never used it.
	if (favorMax) out.push(purse("favor", "Favor", favorMax, favorStored, true));
	return out;
}

/** Can any one purse cover the cost on its own? Costs are not split across purses. */
export function canPayStock(sources, amount = 1) {
	return sources.some(s => s.remaining >= amount);
}

/**
 * Which purse to spend from when the player has not said. The pouch first — Favor is the
 * substitute the move offers ("in lieu of Stock"), not the default.
 */
export function defaultStockSource(sources, amount = 1) {
	return sources.find(s => s.key === "stock" && s.remaining >= amount)
		?? sources.find(s => s.remaining >= amount)
		?? null;
}

/**
 * Does this move's own printed text say it costs Stock, and how much?
 *
 * Read off the move rather than kept in a list: eleven shipped moves charge Stock and they run
 * the whole length of the Blessed playbook, so a hand-kept roll-call would be a second copy to
 * drift from the book. Potent Workings says "1 ADDITIONAL Stock" and means the same thing here
 * (one more pip off the pouch), so the word is allowed and then ignored.
 *
 * @returns {{amount: number, label: string}|null}
 */
export function stockCostFromDescription(html) {
	const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
	// TWO phrasings, because the book uses two. Most moves "spend 1 Stock"; the Blessed's marks
	// say what the Stock BUYS instead — "mark another with 1 Stock", "mark a beast with 1 Stock" —
	// and reading only the first left Barkskin and Shared Souls with a cost and no way to pay it.
	const m = /\bspends?\s+(\d+)\s+(?:additional\s+)?Stock\b/i.exec(text)
		?? /\bwith\s+(\d+)\s+Stock\b/i.exec(text);
	return m ? { amount: Math.max(1, Number(m[1]) || 1), label: "Stock" } : null;
}

/**
 * The purses, read straight off an Actor's stored flags.
 *
 * ONE reader for two callers that must never disagree: the sheet's dialog, which decides
 * whether a move may roll at all, and the chat card's Spend button, which debits after the
 * move has been made. Two readers would eventually differ about what `uses` counts, and a
 * Blessed would pay twice or not at all. Takes the raw flag bags rather than a
 * StonetopCharacter, so a chat handler holding nothing but an Actor can ask the same question.
 */
export function stockSourcesForFlags({ possessions = {}, moveResources = {}, ritesMax = null } = {}) {
	const selected = possessions.selected ?? [];
	return stockSources({
		hasPouch:   [...selected].includes(SACRED_POUCH_SLUG),
		pouchMax:   possessions.maxUses?.[SACRED_POUCH_SLUG] ?? DEFAULT_SACRED_POUCH_MAX,
		pouchStored: possessions.uses?.[SACRED_POUCH_SLUG] ?? 0,
		favorMax:   ritesMax,
		favorStored: moveResources?.[RITES_OF_THE_LAND] ?? 0,
	});
}
