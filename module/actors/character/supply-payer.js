// SOMEONE ELSE'S SUPPLIES. Recover: "Each character who regains HP must expend 1 use of supplies, or
// someone else must expend a use on their behalf" (Book I p.246). And when the GM asks for a use of
// supplies to tend a debility (p.78, p.247), whoever tends it may be the one paying.
//
// WHO PAYS, AND WHO DECIDES. The supplies are the PAYER's, and so is the choice to spend them, the same
// rule Healer's Arts keeps for a carer's Stock (healers-arts.js#carerStockAnswerer, reused here): when
// this user is the one who would be asked anyway (the payer's assigned player, or the only one there),
// the use is spent right here; merely owning the payer is not enough at a table where everyone owns every
// sheet. Otherwise this user ASKS: a User query to the payer's player, or the primary GM with none of
// them online, who sees who is asking and what it costs, and pays out of the payer's own purse. Nothing
// is spent for a "no", a closed window or an answer that never comes, and the move then writes nothing.
//
// The write is camp-rules.js#purseSpendUpdate's, the one rule that takes food out of a pack: an absolute
// count from what the purse holds at the moment of paying, so a use eaten elsewhere since the window
// opened is not eaten twice. A character paying out of their OWN purse instead folds the uses into the
// move's one write (ownSupplySpend), as Recover and tending a debility do.

import { SUPPLY_PURPOSE, defaultSupplyPurse, otherSupplyPayers } from "./supply-cost.js";
import { purseSpendUpdate } from "../../camp/camp-rules.js";
import { carerStockAnswerer } from "./healers-arts.js";
import { isOutOfPlaySafe } from "./deaths-door-actor.js";
import { OWNER_ASK_MS, spendOrAskOwner, answerOwnerAsk, tooLate, gmAnswersNote } from "../../utils/owner-ask.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { escHtml } from "../../utils/strings.js";

/** The User query a patient's player sends when someone else decides on the payer's supplies. */
export const SUPPLY_PAY_QUERY = "stonetop.supplyPay";
/** How long the asker waits for that answer (utils/owner-ask.js, shared with healers-arts.js). No answer reads as a no. */
export const SUPPLY_PAY_ASK_MS = OWNER_ASK_MS;

const PURPOSES = new Set(Object.values(SUPPLY_PURPOSE));

/** "1 use", "3 uses". */
const usesText = n => (n === 1 ? "1 use" : `${n} uses`);

/**
 * The other characters who could pay for `patient`, alive, that this user can reach: each with its
 * purses. Whether this user then spends straight away or asks is payOthersSupplies' question. The
 * Recover card and the Recover window both ask this, so the card never lights for a payer the window
 * then leaves out.
 */
export function supplyPayersFor(patient, purpose = SUPPLY_PURPOSE.RECOVER, {
	actors = globalThis.game?.actors, user = globalThis.game?.user, users = globalThis.game?.users,
} = {}) {
	return otherSupplyPayers(patient, actors, purpose)
		.filter(p => !isOutOfPlaySafe(p.actor) && !!carerStockAnswerer(p.actor, users, { asker: user ?? null, patient }));
}

/**
 * `n` uses out of a character's OWN purse `slug`, read live, as the write a caller folds into its one
 * actor update (Recover and tending a debility each write once, the supplies with the HP or the
 * debility) and the chat row that says so. Null when that purse no longer holds `n`.
 *
 * @param {object} character  the StonetopCharacter paying
 * @returns {{update: object, left: number, row: {label: string, value: string}}|null}
 */
export function ownSupplySpend(character, { slug, n = 1, purpose = SUPPLY_PURPOSE.RECOVER } = {}) {
	const live = character?.supplyPurses?.(purpose)?.eligible?.find(p => p.slug === slug && p.remaining >= n) ?? null;
	if (!live) return null;
	const left = live.remaining - n;
	return { update: character.inventoryResourceData(live.slug, left), left, row: { label: live.label, value: `Expended ${usesText(n)} (${left} left)` } };
}

/**
 * The purse `n` uses come out of: `slug` when one is named; otherwise the first eligible purse that holds
 * `n`, falling back to the table-order default (supply-cost.js#defaultSupplyPurse) when none does, so
 * a short first purse never refuses a spend another purse could pay. Null with none eligible.
 */
function payerPurse(purses, slug, n) {
	if (slug) return purses?.eligible?.find(p => p.slug === slug) ?? null;
	return purses?.eligible?.find(p => p.remaining >= n) ?? defaultSupplyPurse(purses);
}

/** The chat row for uses another character paid on `patientName`'s behalf, from payOthersSupplies' receipt. */
export function behalfSpendRow(payerName, receipt, patientName) {
	return {
		label: `${payerName}'s ${String(receipt.label ?? "").toLowerCase()}`,
		value: `Expended ${usesText(receipt.spent)} on ${patientName}'s behalf (${receipt.left} left)`,
	};
}

/**
 * Spend `n` uses out of `payer`'s purse `slug` (their first eligible one holding `n` with none named), on THIS client,
 * read live: a purse that no longer holds `n` pays nothing.
 *
 * @returns {Promise<{slug: string, label: string, spent: number, left: number}|null>}
 */
export async function spendPayerSupplies(payer, { slug = null, n = 1, purpose = SUPPLY_PURPOSE.RECOVER, moveName = null } = {}) {
	const character = payer?.typedActor;
	const purses = character?.supplyPurses?.(purpose);
	if (!purses) return null;
	const uses = Math.max(1, Math.trunc(Number(n) || 1));
	const purse = payerPurse(purses, slug, uses);
	if (!purse || purse.remaining < uses) return null;
	const { update } = purseSpendUpdate([{ slug: purse.slug, n: uses }], {
		resources: character.spendablePurseResources?.({ carriedOnly: false }) ?? {},
		resourceData: (s, count) => character.inventoryResourceData(s, count),
	});
	await payer.update(update, moveName ? { stonetopMove: moveName } : {});
	return { slug: purse.slug, label: purse.label, spent: uses, left: purse.remaining - uses };
}

/**
 * Pay `n` uses of `payer`'s supplies for `patient` (see the header): here when this user decides for the
 * payer, else by asking whoever does (utils/owner-ask.js#spendOrAskOwner).
 *
 * @returns {Promise<object|null>} the receipt (spendPayerSupplies) when paid; `{declined: true}` when the
 *   payer's side said no or closed the window, plus `unanswered: true` when no answer came; null when it
 *   could not be paid (nobody to ask, a purse that no longer holds enough, a refused ask)
 */
export async function payOthersSupplies({ payer, patient, slug = null, n = 1, purpose = SUPPLY_PURPOSE.RECOVER, moveName = null }) {
	if (!payer || !patient) return null;
	return spendOrAskOwner({
		owner: payer,
		answerer: carerStockAnswerer(payer, globalThis.game?.users, { asker: globalThis.game?.user ?? null, patient }),
		spend: () => spendPayerSupplies(payer, { slug, n, purpose, moveName }),
		query: SUPPLY_PAY_QUERY,
		data: { payerId: payer.id, patientId: patient.id, slug, n, purpose, moveName },
		whether: `${payer.name} spends ${n === 1 ? "a use" : `${n} uses`} of supplies on ${patient.name}'s ${moveName ?? "move"}.`,
		what: "spending someone's supplies",
	});
}

/**
 * The answering side of SUPPLY_PAY_QUERY, on the payer's player's client (or the primary GM's;
 * utils/owner-ask.js#answerOwnerAsk): for an asker who owns the PATIENT, ask whether to spend, then pay
 * out of the payer's own purse.
 *
 * @returns {Promise<object|null>} as payOthersSupplies
 */
export async function handleSupplyPayQuery(data, context = {}, { actors = globalThis.game?.actors, users = globalThis.game?.users, confirm = confirmOutcome } = {}) {
	const payer = actors?.get?.(data?.payerId);
	const patient = actors?.get?.(data?.patientId);
	const n = Math.trunc(Number(data?.n) || 0);
	const purpose = PURPOSES.has(data?.purpose) ? data.purpose : SUPPLY_PURPOSE.RECOVER;
	const moveName = typeof data?.moveName === "string" && data.moveName ? data.moveName : "Recover";
	const slug = typeof data?.slug === "string" && data.slug ? data.slug : null;
	let purse = null;
	return answerOwnerAsk(data, context, {
		users, confirm,
		question: (user, me) => {
			if (!payer || !patient || payer.id === patient.id) return null;
			if (!payer.isOwner || !patient.testUserPermission?.(user, "OWNER")) return null;
			// No cap beyond the purse itself: one that cannot hold `n` is said, never asked about.
			if (n < 1) return null;
			purse = payerPurse(payer.typedActor?.supplyPurses?.(purpose), slug, n);
			if (!purse || purse.remaining < n) {
				globalThis.ui?.notifications?.warn?.(purse
					? `${payer.name}'s ${purse.label} holds ${purse.remaining}, not the ${usesText(n)} asked for.`
					: `${payer.name} has no supplies left to spend.`);
				return null;
			}
			const uses = usesText(n);
			return {
				title: `${moveName}: ${patient.name}`,
				content: `<p>${escHtml(user.name ?? "A player")} asks: spend <strong>${uses}</strong> of `
					+ `<strong>${escHtml(payer.name)}</strong>'s ${escHtml(purse.label)} (${purse.remaining} left) on `
					+ `<strong>${escHtml(patient.name)}</strong>'s ${escHtml(moveName)}?</p>`
					+ gmAnswersNote(me, payer.name),
				yes: { label: `Spend ${uses} on ${patient.name}`, icon: "fa-basket-shopping" },
				no:  { label: me?.isGM ? `Keep ${payer.name}'s supplies` : "Keep my supplies" },
			};
		},
		settle: async late => late()
			? tooLate(`Too late: ${patient.name}'s ${moveName} has already gone ahead without it.`)
			: spendPayerSupplies(payer, { slug: purse.slug, n, purpose, moveName }),
	});
}
