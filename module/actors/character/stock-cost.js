/**
 * What a Blessed can pay a Stock cost with, and how much is left in each.
 *
 * Danu's Grasp says "spend 1 Stock and roll +WIS", and a move that charges before it rolls has
 * to be able to answer two questions before the dice: can this character pay, and out of what.
 *
 * TWO PURSES, not one. Rites of the Land ends "Spend Boon in lieu of Stock, 1-for-1", so a
 * Blessed holding Boon and no Stock can still make the move — and a gate that only knew about
 * the pouch would block them from a move the book grants. Boon is only offered to a character
 * who actually owns that move, so nobody else sees a purse they do not have.
 *
 * And a THIRD for a Vessel, whose HP can stand in for a Stock (see VESSEL_BACKGROUND). It has
 * no track at all, so it is never the default and never counted; see defaultStockSource.
 *
 * THE TWO PURSES COUNT IN OPPOSITE DIRECTIONS, and getting that backwards is silent. Both store
 * a single number, but the test that settles which way it reads is the one know-things.js states
 * for the Logbook: a fresh character has no flag at all, and whatever that zero means must be
 * true of a character who has never touched the move.
 *
 *   · The sacred pouch is a CAPACITY. A Blessed starts with it FULL, so zero means nothing spent
 *     and a filled pip is Stock gone: `remaining = max - stored`, and spending INCREMENTS.
 *   · Boon is a POOL. "Once per season, when you oversee the sacred rites, hold 1 Boon" — a
 *     Blessed who has not done so holds NONE, so zero means an empty purse and a filled pip is
 *     Boon held: `remaining = stored`, and spending DECREMENTS.
 *
 * Read the Boon the pouch's way and every Blessed who owns Rites of the Land is handed four Boon
 * they never earned, while one who has actually banked three reads as holding one.
 *
 * Foundry-free: every source is plain numbers plus an `after` that hands back the number to
 * store, so the whole thing is testable without a world.
 */

import { tookBackground } from "./took-background.js";

/** The Blessed's sacred pouch, where Stock lives. Its `max` can be raised (Big Magic). */
export const SACRED_POUCH_SLUG = "sacred-pouch";
export const RITES_OF_THE_LAND = "Rites of the Land";
export const DEFAULT_SACRED_POUCH_MAX = 3;

/**
 * The Blessed's Vessel background: "When you would spend 1 Stock from your sacred pouch, you may
 * choose to lose 2d4 HP instead." A THIRD purse, and the one that is never empty: the user's
 * ruling is that it is offered even when the pouch is, so a Vessel is never locked out of a
 * Stock move. Only a Blessed carries the background, so the playbook is asked as well as the slug.
 */
export const VESSEL_BACKGROUND = "vessel";
export const BLESSED_PLAYBOOK = "The Blessed";
export const VESSEL_PURSE = "hp";

/** Is this character a Vessel? Read off the playbook name and the background's slug. */
export function isVessel({ playbookName = null, backgroundSlug = null } = {}) {
	return tookBackground({ playbook: playbookName, background: backgroundSlug }, { playbook: BLESSED_PLAYBOOK, slug: VESSEL_BACKGROUND });
}

/**
 * What a Vessel throws for a cost of `amount` Stock: 2d4 for EACH Stock. The book's clause is
 * about a single Stock ("would spend 1 Stock… lose 2d4 HP instead"), so a larger cost is that
 * trade made once per Stock. No shipped move costs more than 1, so this is 2d4 in play.
 */
export function vesselHpFormula(amount = 1) {
	return `${2 * Math.max(1, Math.trunc(Number(amount) || 1))}d4`;
}

/**
 * @param {object} snapshot
 * @param {number} snapshot.pouchMax        the pouch's capacity
 * @param {number} snapshot.pouchStored     the number stored on the pouch (pips ticked = Stock SPENT)
 * @param {boolean} snapshot.hasPouch       is the pouch actually one of this character's possessions
 * @param {number|null} snapshot.boonMax    Rites of the Land's capacity, or null when unowned
 * @param {number} snapshot.boonStored      the number stored on that move (pips ticked = Boon HELD)
 * @param {number|null} snapshot.vesselHp   a Vessel's current HP, or null for everyone else
 * @returns {{key: string, label: string, remaining: number, spent: number, max: number}[]}
 *   Every purse this character HAS, empty ones included — an empty pouch is still worth showing,
 *   because "you have 0 Stock" is the sentence that explains why the roll is not offered.
 */
export function stockSources({ pouchMax = DEFAULT_SACRED_POUCH_MAX, pouchStored = 0, hasPouch = true, boonMax = null, boonStored = 0, vesselHp = null } = {}) {
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
	// The Boon is a POOL: "once per season… hold 1 Boon" — a Blessed who has not overseen the
	// rites holds none, so a filled pip is Boon HELD and an empty track is an empty purse. Reading
	// it the pouch's way handed four Boon to every Blessed who owns the move and never used it.
	if (boonMax) out.push(purse("boon", "Boon", boonMax, boonStored, true));
	// The Vessel's body. It has no count to run out of, so `remaining` is unbounded while there
	// is HP to lose, and every "can this pay?" question answers yes without a special case. At
	// 0 HP there is nothing left to give. It writes nothing back (`after` is null): paying it is
	// a roll and an HP loss, done by StonetopCharacter#spendStock, not a number on a track.
	if (vesselHp != null) {
		out.push({
			key: VESSEL_PURSE, label: "HP", max: 0, stored: 0, countsHeld: false, vessel: true,
			remaining: Number(vesselHp) > 0 ? Infinity : 0,
			after: () => null,
		});
	}
	return out;
}

/** Can any one purse cover the cost on its own? Costs are not split across purses. */
export function canPayStock(sources, amount = 1) {
	return sources.some(s => s.remaining >= amount);
}

/**
 * Which purse to spend from when the player has not said. The pouch first — the Boon is the
 * substitute the move offers ("in lieu of Stock"), not the default.
 *
 * NEVER the Vessel's HP. The book says a Vessel "may choose" to bleed instead, so it is only
 * ever spent when the player picks it: with nothing else that can pay, this answers null and
 * the caller has to ask.
 */
export function defaultStockSource(sources, amount = 1) {
	return sources.find(s => s.key === "stock" && s.remaining >= amount)
		?? sources.find(s => !s.vessel && s.remaining >= amount)
		?? null;
}

/** The purses that can cover `amount` on their own, in the order they are offered. */
export function payableStockSources(sources, amount = 1) {
	return sources.filter(s => s.remaining >= amount);
}

/**
 * Must the player be ASKED which purse pays? When more than one can, and always when one of
 * them is the Vessel's HP, because that one is only ever taken by choice.
 */
export function mustAskStockSource(payable) {
	return payable.length > 1 || payable.some(s => s.vessel);
}

/** How a purse reads as a choice: "Stock (2 left)", or "Lose 2d4 HP instead". */
export function stockSourceChoiceLabel(source, amount = 1) {
	return source.vessel
		? `Lose ${vesselHpFormula(amount)} HP instead`
		: `${source.label} (${source.remaining} left)`;
}

/**
 * What a paid cost says afterwards, on a card or a notification: "Spent 1 Stock", or for a
 * Vessel "Lost 5 HP in place of 1 Stock". `lost` is the HP the Vessel's roll took.
 */
export function stockReceipt(source, amount = 1, lost = 0) {
	return source?.vessel
		? `Lost ${lost} HP in place of ${amount} Stock`
		: `Spent ${amount} ${source?.label ?? "Stock"}`;
}

/**
 * The line a cross-playbook picker shows under a move that costs Stock, for a character with no
 * sacred pouch to pay it from. DISPLAY ONLY: the book lets them pick it, so it is never filtered.
 */
export const NO_POUCH_STOCK_NOTE = "Costs Stock; you have no sacred pouch.";

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
 *
 * `hasPouch` is the caller's answer when it has one (StonetopCharacter#holdsPossession, which
 * counts the playbook's PRESELECTED pouch too). The Blessed's pouch is preselected, so it is
 * often never written to `possessions.selected` at all, and reading that list alone left such a
 * Blessed with no purse while the gear tab and Forage both said they carried it.
 */
export function stockSourcesForFlags({ possessions = {}, moveResources = {}, ritesMax = null, pouchMax = null, hasPouch = null, vesselHp = null } = {}) {
	const selected = possessions.selected ?? [];
	return stockSources({
		hasPouch:   hasPouch ?? [...selected].includes(SACRED_POUCH_SLUG),
		// `pouchMax` is the derived max (even levels, Big Magic), which no flag stores; the
		// flag fallback is only a printed-3 floor for a caller that has no snapshot to ask.
		pouchMax:   pouchMax ?? possessions.maxUses?.[SACRED_POUCH_SLUG] ?? DEFAULT_SACRED_POUCH_MAX,
		pouchStored: possessions.uses?.[SACRED_POUCH_SLUG] ?? 0,
		boonMax:    ritesMax,
		boonStored: moveResources?.[RITES_OF_THE_LAND] ?? 0,
		vesselHp,
	});
}
