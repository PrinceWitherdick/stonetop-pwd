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
 * store, so the whole thing is testable without a world. Each also says how it is paid and how it
 * reads, so no caller branches on which kind of purse it holds:
 *
 *   · `pay(payer, amount)` pays the cost through `payer`, the character's writes for the move
 *     being paid for (StonetopCharacter#spendStock hands them over), and answers `{lost}`, the HP
 *     it took.
 *   · `choiceLabel(amount)` is the purse as a choice in the "Spend from" picker.
 *   · `receipt(amount, lost)` is what the paid cost says afterwards.
 */

import { tookBackground } from "./took-background.js";
import { localize } from "../../utils/i18n.js";
import { capitalizeFirst } from "../../utils/strings.js";

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

/** A purse's "(from Witchcraft)" tail, naming the move a stand-in is from. */
const viaMove = from => (from ? ` (${from})` : "");

/**
 * @param {object} snapshot
 * @param {number} snapshot.pouchMax        the pouch's capacity
 * @param {number} snapshot.pouchStored     the number stored on the pouch (pips ticked = Stock SPENT)
 * @param {boolean} snapshot.hasPouch       is the pouch actually one of this character's possessions
 * @param {number|null} snapshot.boonMax    Rites of the Land's capacity, or null when unowned
 * @param {number} snapshot.boonStored      the number stored on that move (pips ticked = Boon HELD)
 * @param {number|null} snapshot.vesselHp   a Vessel's current HP, or null for everyone else
 * @param {object[]} snapshot.standIns      what a move lets this character pay INSTEAD of Stock
 *   (move-words.js#stockStandInsFrom, each with `from`, the move's name): a debility, some HP, a
 *   price the table settles. Purses that never run dry, offered only by choice, as the Vessel's HP.
 * @param {{key: string, name: string}[]} snapshot.openDebilities  the debilities not yet marked
 * @param {number} snapshot.hp              the character's HP now (an HP stand-in needs some)
 * @returns {{key: string, label: string, remaining: number, spent: number, max: number}[]}
 *   Every purse this character HAS, empty ones included — an empty pouch is still worth showing,
 *   because "you have 0 Stock" is the sentence that explains why the roll is not offered.
 */
export function stockSources({ pouchMax = DEFAULT_SACRED_POUCH_MAX, pouchStored = 0, hasPouch = true, boonMax = null, boonStored = 0, vesselHp = null, standIns = [], openDebilities = [], hp = 0 } = {}) {
	const purse = (key, label, max, stored, countsHeld) => {
		const cap = Math.max(0, Math.trunc(Number(max) || 0));
		const have = Math.min(cap, Math.max(0, Math.trunc(Number(stored) || 0)));
		const remaining = countsHeld ? have : Math.max(0, cap - have);
		// What to WRITE BACK after spending. The two purses move in opposite directions, so
		// this is asked of the purse rather than worked out at each spend site — the arithmetic
		// is the one thing about them that differs, and the one thing easy to get backwards.
		const after = amount => {
			const n = Math.max(0, Math.trunc(Number(amount) || 0));
			return countsHeld ? Math.max(0, have - n) : Math.min(cap, have + n);
		};
		return {
			key, label, max: cap, stored: have, countsHeld, remaining, after,
			// The Boon is Rites of the Land's track, the ledger naming the move; the pouch is a possession's.
			pay: async (payer, amount) => {
				if (countsHeld) await payer.setBoonHeld(after(amount));
				else await payer.setPouchSpent(after(amount));
				return { lost: 0 };
			},
			choiceLabel: () => `${label} (${remaining} left)`,
			receipt: amount => `Spent ${amount} ${label}`,
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
			// A visible 2d4 roll per Stock, and the HP it throws is lost (provisions.js#loseHpForStock).
			pay: async (payer, amount) => {
				const { lost } = await payer.loseVesselHp(amount);
				return { lost };
			},
			choiceLabel: amount => `Lose ${vesselHpFormula(amount)} HP instead`,
			receipt: (amount, lost = 0) => `Lost ${lost} HP in place of ${amount} Stock`,
		});
	}
	out.push(...standInPurses(standIns, openDebilities, hp));
	return out;
}

/**
 * The stand-in purses (stockSources' `standIns`): one per debility still open for a "mark a debility",
 * so the choice of which is the purse picked; one for an HP loss while there is HP to lose; one for a
 * price the table settles. Like the Vessel's HP they write back nothing (`after` null) and are paid by
 * StonetopCharacter#spendStock; `standIn` says how.
 */
function standInPurses(standIns, openDebilities, hp) {
	const out = [];
	(standIns ?? []).forEach((s, i) => {
		const base = { max: 0, stored: 0, countsHeld: false, after: () => null, remaining: Infinity };
		const via = viaMove(s?.from);
		if (s?.kind === "debility") {
			for (const d of openDebilities ?? []) {
				out.push({
					...base, key: `instead-debility-${d.key}`, label: d.name,
					standIn: { kind: "debility", key: d.key, name: d.name, from: s.from ?? "" },
					// The debility the player picked: the purse IS the choice of which.
					pay: async (payer) => {
						await payer.markDebility(d.key);
						return { lost: 0 };
					},
					choiceLabel: () => `Mark ${d.name} instead${via}`,
					receipt: amount => `Marked ${d.name} in place of ${amount} Stock`,
				});
			}
		} else if (s?.kind === "hp") {
			out.push({
				...base, key: `instead-hp-${i}`, label: "HP", remaining: Number(hp) > 0 ? Infinity : 0,
				standIn: { kind: "hp", amount: s.amount, from: s.from ?? "" },
				// The HP the move names, per Stock: never rolled, unlike the Vessel's.
				pay: async (payer, amount) => {
					const lost = s.amount * Math.max(1, Math.trunc(Number(amount) || 1));
					await payer.loseHp(lost);
					return { lost };
				},
				choiceLabel: amount => `Lose ${s.amount * Math.max(1, amount)} HP instead${via}`,
				receipt: (amount, lost = 0) => `Lost ${lost} HP in place of ${amount} Stock`,
			});
		} else if (s?.text) {
			out.push({
				...base, key: `instead-other-${i}`, label: s.text,
				standIn: { kind: "other", text: s.text, from: s.from ?? "" },
				// A price the table settles: nothing to write, and the receipt names it.
				pay: async () => ({ lost: 0 }),
				choiceLabel: () => `${capitalizeFirst(s.text)} instead${via}`,
				receipt: amount => `In place of ${amount} Stock: ${s.text}`,
			});
		}
	});
	return out;
}

/** A purse that is a price paid in place of Stock (the Vessel's HP, a stand-in), not a count of it. */
export function paidInPlaceOfStock(source) {
	return !!(source?.vessel || source?.standIn);
}

/** What is left in a purse after paying, for a receipt: " (2 left)", or "" for a price paid in place of Stock. */
export function purseLeftNote(source, amount = 1) {
	return paidInPlaceOfStock(source) ? "" : ` (${source.remaining - amount} left)`;
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
		?? sources.find(s => !paidInPlaceOfStock(s) && s.remaining >= amount)
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
	return payable.length > 1 || payable.some(paidInPlaceOfStock);
}

/** How a purse reads as a choice: "Stock (2 left)", or "Lose 2d4 HP instead" (the purse's choiceLabel). */
export function stockSourceChoiceLabel(source, amount = 1) {
	return source?.choiceLabel ? source.choiceLabel(amount) : `${source?.label} (${source?.remaining} left)`;
}

/**
 * What a paid cost says afterwards, on a card or a notification: "Spent 1 Stock", or for a
 * Vessel "Lost 5 HP in place of 1 Stock" (the purse's receipt). `lost` is the HP the purse took.
 * A purse with no receipt of its own (a stamp from before the Vessel purse existed) was a count.
 */
export function stockReceipt(source, amount = 1, lost = 0) {
	return source?.receipt ? source.receipt(amount, lost) : `Spent ${amount} ${source?.label ?? "Stock"}`;
}

/**
 * The lines a cross-playbook picker shows under a move for a character with no sacred pouch
 * (languages/en.json `stonetop.stockCost`): one that costs Stock, and one that works on the pouch
 * itself (Big Magic grows it, Borrow Power stores in it). DISPLAY ONLY: the book lets them pick
 * it, so it is never filtered.
 */
const NO_POUCH_NOTE_KEYS = Object.freeze({
	stock: "stonetop.stockCost.noPouch",
	pouch: "stonetop.stockCost.noPouchForPouch",
});

/** Does this move's printed text work on a sacred pouch ("your sacred pouch", "your pouch")? */
export function pouchMoveFromDescription(html) {
	const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
	return /\bpouch\b/i.test(text);
}

/**
 * The note for a move offered to someone with NO sacred pouch, or null: Stock first (a move that
 * spends Stock and stores in the pouch, like Suck the Poison Out, is a Stock move), then the pouch.
 * `kind` (noPouchNoteKind) lets the sheet word its own cue; `note` is the picker row's line.
 *
 * @returns {{kind: "stock"|"pouch", note: string}|null}
 */
export function noPouchNote(html) {
	const kind = noPouchNoteKind(html);
	return kind ? { kind, note: localize(NO_POUCH_NOTE_KEYS[kind]) } : null;
}

/** Which note noPouchNote says: "stock", "pouch", or null. */
export function noPouchNoteKind(html) {
	if (stockCostFromDescription(html)) return "stock";
	if (pouchMoveFromDescription(html)) return "pouch";
	return null;
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
 *
 * `hasPouch` is the caller's answer when it has one (StonetopCharacter#holdsPossession, which
 * counts the playbook's PRESELECTED pouch too). The Blessed's pouch is preselected, so it is
 * often never written to `possessions.selected` at all, and reading that list alone left such a
 * Blessed with no purse while the gear tab and Forage both said they carried it.
 */
export function stockSourcesForFlags({ possessions = {}, moveResources = {}, ritesMax = null, pouchMax = null, hasPouch = null, vesselHp = null, standIns = [], openDebilities = [], hp = 0 } = {}) {
	const selected = possessions.selected ?? [];
	return stockSources({
		hasPouch:   hasPouch ?? [...selected].includes(SACRED_POUCH_SLUG),
		// `pouchMax` is the derived max (even levels, Big Magic), which no flag stores; the
		// flag fallback is only a printed-3 floor for a caller that has no snapshot to ask.
		pouchMax:   pouchMax ?? possessions.maxUses?.[SACRED_POUCH_SLUG] ?? DEFAULT_SACRED_POUCH_MAX,
		pouchStored: possessions.uses?.[SACRED_POUCH_SLUG] ?? 0,
		boonMax:    ritesMax,
		boonStored: moveResources?.[RITES_OF_THE_LAND] ?? 0,
		vesselHp, standIns, openDebilities, hp,
	});
}
