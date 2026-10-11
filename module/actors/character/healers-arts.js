// Healer's Arts (The Blessed), as it lands on someone else's Recover.
//
// "When someone Recovers under your care, they recover (extra) HP equal to your WIS. If you also
//  spend 1 Stock, they heal an extra 5 HP and their wounds/injuries are stabilized."
//
// The move belongs to the CARER and the Recover to the PATIENT, who may be different characters with
// different players. So the Recover window asks who is tending them, reads the carer's WIS, and offers
// the Stock out of the carer's own purses (StonetopCharacter#stockSources / #spendStock, the one reader
// and the one payer). "Someone" includes the carer: a Blessed can tend their own Recover.
//
// WHO PAYS, AND WHO DECIDES. "If you also spend 1 Stock": the Stock is the CARER's, and so is the
// choice to spend it. When the patient's player is the one who would be asked anyway (carerStockAnswerer:
// the carer's assigned player, the GM with none of the carer's players online, or the only one there),
// they are the one deciding, and the Stock is spent right there (spendsCarerStockDirectly). Merely owning
// the carer is not enough, at a table where everyone owns every sheet. When not, the patient's
// player can only ASK: a User query goes to the carer's own player (hooks/DeathsDoorPrompt.js#
// autoOpenUserId over the carer's non-GM owners), who is shown who is asking and what it costs and
// answers with their own purse, paid by their own StonetopCharacter#spendStock. With none of the
// carer's players online the ask falls back to the primary GM, who gets the same question. The
// answering side checks that the asker owns the PATIENT and that the carer really has Healer's Arts
// learned, and spends nothing else.
//
// A NO IS NOT A FAILURE. A carer who keeps their Stock (or closes the window, or never answers) still
// tends the Recover: it goes ahead with their WIS and without the 5 HP and the stabilizing, and the
// patient's player and the chat card are told so. With nobody at all to ask, the window says so and
// offers the Recover without the Stock.

import { learnedHolders, ownsLearnedMoveNamed } from "./owns-move.js";
import { payableStockSources, mustAskStockSource } from "./stock-cost.js";
import { askStockSource } from "./ask-stock-source.js";
import { queryAsker } from "../../utils/foundry-compat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { autoOpenUserId, ownerUsers } from "../../hooks/DeathsDoorPrompt.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { escHtml } from "../../utils/strings.js";
import { recoveredHpTo } from "./deaths-door-actor.js";

export const HEALERS_ARTS = "Healer's Arts";
/** The move's price: "If you also spend 1 Stock". */
export const HEALERS_ARTS_STOCK = 1;
/** What that Stock buys: "they heal an extra 5 HP". */
export const HEALERS_ARTS_STOCK_HP = 5;
/** The User query a patient's player sends when they do not own the carer (see the header). */
export const HEALERS_ARTS_QUERY = "stonetop.healersArtsStock";
/**
 * How long the patient's player waits for the carer's answer. A person is reading a question, so
 * it is minutes, not the seconds a GM's relay gets; and it has to be SOMETHING, because core's
 * server never answers a query whose recipient has left. No answer in time is read as a no.
 */
export const HEALERS_ARTS_ASK_MS = 120000;
/**
 * The answering side stops spending this long before the asker stops waiting, so a yes pressed at
 * the last moment can never pay for a Recover that has already gone ahead without it.
 */
const LATE_MARGIN_MS = 10000;

/** The characters who can tend a Recover: those with Healer's Arts LEARNED (owns-move.js). */
export function healersArtsCarers(actors) {
	return learnedHolders(actors, HEALERS_ARTS);
}

/** A carer's WIS, as the sheet stores it. */
export function carerWis(actor) {
	return Math.trunc(Number(actor?.system?.stats?.wis?.value) || 0);
}

/**
 * What a Recover heals, with or without someone's care. Pure.
 *
 * THE CARER NEVER TAKES HP AWAY. "(extra) HP equal to your WIS" is written for a Blessed, whose WIS
 * is their best stat; a Versatile or Worldly pick can put the move on a character whose WIS is 0 or
 * less, and reading -1 as "recover one HP fewer" would make being tended worse than being alone.
 * So the WIS adds max(0, WIS). The Stock's 5 is added on top, and the total stops at max HP.
 *
 * @param {object} o
 * @param {number} o.base      4+Prosperity, the Recover's own heal
 * @param {number} o.hp        current HP
 * @param {number} o.max       max HP (the COMPUTED max; see StonetopCharacter#computedMaxHp)
 * @param {number|null} [o.wis]  the carer's WIS, or null when nobody is tending them
 * @param {boolean} [o.stock]  was the carer's Stock spent
 * @param {boolean} [o.slow]   a Thrall with Torment's Blessing (deaths-door-actor.js#slowToHeal), who
 *   recovers only half of all that, rounded up; `halved` then says it cost them anything
 */
export function recoverHeal({ base, hp, max, wis = null, stock = false, slow = false }) {
	const wisBonus = wis === null ? 0 : Math.max(0, Math.trunc(Number(wis) || 0));
	const stockBonus = stock ? HEALERS_ARTS_STOCK_HP : 0;
	const now = Math.trunc(Number(hp) || 0);
	const should = Math.max(now, Math.min(Math.trunc(Number(max) || 0), now + base + wisBonus + stockBonus));
	const newHp = recoveredHpTo(now, should, slow);
	return { base, wis, wisBonus, stockBonus, newHp, gained: newHp - now, halved: newHp < should };
}

/**
 * The readout's breakdown: "4+Prosperity = 4, +2 Healer's Arts (Gwynn's WIS), +5 Healer's Arts
 * (1 Stock)". A WIS that adds nothing says why, so a tended Recover that heals no more reads as the
 * rule rather than as a bug.
 */
export function recoverBreakdown(heal, carerName = "") {
	const parts = [`4+Prosperity = ${heal.base}`];
	if (heal.wis !== null && heal.wis !== undefined) {
		const why = heal.wis < 0 ? ` ${heal.wis}, which never takes HP away` : "";
		parts.push(`+${heal.wisBonus} ${HEALERS_ARTS} (${carerName}'s WIS${why})`);
	}
	if (heal.stockBonus) parts.push(`+${heal.stockBonus} ${HEALERS_ARTS} (${HEALERS_ARTS_STOCK} Stock)`);
	if (heal.halved) parts.push("halved, rounded up (Torment's Blessing)");
	return parts.join(", ");
}

/**
 * Spend the Stock out of `carer`'s purse `sourceKey`, on THIS client. The purse is re-read live, so
 * one emptied since the window opened pays nothing. With no key, a lone purse that is not a Vessel's
 * HP pays, as the sheet's own spend does; a Vessel's HP is only ever taken when it was picked.
 *
 * @returns {Promise<{key: string, label: string, vessel: boolean, lost: number, remaining: number|null}|null>}
 */
async function spendCarerStock(carer, sourceKey) {
	const character = carer?.typedActor;
	if (!character?.stockSources) return null;
	const payable = payableStockSources(await character.stockSources(), HEALERS_ARTS_STOCK);
	const source = payable.find(s => s.key === sourceKey)
		?? (!sourceKey && payable.length === 1 && !payable[0].vessel ? payable[0] : null);
	if (!source) return null;
	const speaker = globalThis.ChatMessage?.getSpeaker?.({ actor: carer });
	const { lost } = await character.spendStock(source, HEALERS_ARTS_STOCK, { moveName: HEALERS_ARTS, speaker });
	return {
		key: source.key, label: source.label, vessel: !!source.vessel, lost,
		remaining: source.vessel ? null : source.remaining - HEALERS_ARTS_STOCK,
	};
}

/**
 * Who decides on `carer`'s Stock for `patient`'s Recover, pressed by `asker`: the carer's player, else the
 * primary GM. Null when nobody is there to answer. The answerer may be the asker, who then spends it straight
 * away (spendsCarerStockDirectly).
 *
 * The carer's players are those who PLAY her, not merely own her (playbook-actors.js#playsCharacter): whoever
 * she is assigned to, or with nobody assigned, her owners with no character of their own. The asker is her
 * player outright when assigned to her, when it is her own Recover, or when nobody else plays her. Otherwise
 * one of her other players online is asked (the assigned one first; DeathsDoorPrompt.js#autoOpenUserId), then
 * the GM, and the asker decides only with neither here: at a table where every player owns every sheet and
 * nobody is assigned, owning the carer does not make the patient's player the one who decides on another
 * player's Blessed's Stock (the same rule as asking a PC, pc-ask-flow.js).
 */
export function carerStockAnswerer(carer, users = globalThis.game?.users, { asker = null, patient = null } = {}) {
	if (!carer) return null;
	const userOf = id => users?.get?.(id) ?? null;
	const owners = ownerUsers(carer).filter(u => !u.isGM && u.id !== asker?.id);
	const assigned = owners.filter(u => u.assigned);
	const others = assigned.length ? assigned : owners.filter(u => !userOf(u.id)?.character);
	const askerAssigned = !!asker?.character && asker.character.id === carer.id;
	const askerPlays = !!asker && !asker.isGM
		&& (askerAssigned || (!asker.character && !assigned.length && !!carer.testUserPermission?.(asker, "OWNER")));
	if (askerPlays && (askerAssigned || !patient || patient.id === carer.id || !others.length)) return asker;
	const playerId = autoOpenUserId(others);
	if (playerId) return userOf(playerId);
	return users?.activeGM ?? (askerPlays ? asker : null);
}

/** Can this user get the carer's Stock spent at all: by deciding on it themselves, or by asking whoever does. */
export function canReachCarerStock(carer, { user = globalThis.game?.user, users = globalThis.game?.users, patient = null } = {}) {
	return !!carerStockAnswerer(carer, users, { asker: user, patient });
}

/**
 * Does THIS user decide on the carer's Stock, and so spend it straight from the Recover window? Only when
 * they are the one who would be asked (carerStockAnswerer): owning the carer is not enough, since at a table
 * where every player owns every sheet the patient's player would spend another player's Blessed's Stock
 * unasked. Everyone else asks.
 */
export function spendsCarerStockDirectly(carer, { user = globalThis.game?.user, users = globalThis.game?.users, patient = null } = {}) {
	if (!carer?.isOwner || !user) return false;
	return carerStockAnswerer(carer, users, { asker: user, patient })?.id === user.id;
}

/**
 * Pay Healer's Arts' Stock for `patient`'s Recover out of `carer`'s purse. Here when this user decides
 * for the carer (spendsCarerStockDirectly); otherwise by asking the carer's player, or the GM (HEALERS_ARTS_QUERY, see the header).
 *
 * @returns {Promise<object|null>} the receipt when the Stock was spent; `{declined: true}` when the
 *   carer's side said no or closed the window, plus `unanswered: true` when no answer came at all;
 *   null when it could not be spent (nobody to ask, an empty purse, a refused ask).
 */
export async function payHealersArtsStock({ carer, patient, sourceKey = null }) {
	if (!carer) return null;
	if (spendsCarerStockDirectly(carer, { patient })) return spendCarerStock(carer, sourceKey);
	const answerer = carerStockAnswerer(carer, globalThis.game?.users, { asker: globalThis.game?.user ?? null, patient });
	if (!answerer || answerer.id === globalThis.game?.user?.id) return null;
	globalThis.ui?.notifications?.info?.(
		`Asking ${answerer.isGM ? "the GM" : answerer.name} whether ${carer.name} spends ${HEALERS_ARTS_STOCK} Stock on ${patient?.name ? `${patient.name}'s` : "this"} Recover.`);
	try {
		// Who asked rides in the data: v14 names the asker in the query's context, v13 does not.
		// No purse is sent: which one pays is the carer's side's to choose.
		return (await answerer.query(HEALERS_ARTS_QUERY, {
			carerId: carer.id, patientId: patient?.id ?? null,
			userId: globalThis.game?.user?.id ?? null,
		}, { timeout: HEALERS_ARTS_ASK_MS })) ?? null;
	} catch (err) {
		// Out of time, or they left: nobody said yes, so nothing was spent, and the Recover goes on.
		console.warn("Stonetop | no answer came to Healer's Arts' Stock", err);
		return { declined: true, unanswered: true };
	}
}

/**
 * The answering side of HEALERS_ARTS_QUERY, on the carer's player's client (or the GM's, when none of
 * them is online): for a player who owns the PATIENT, and a carer who really has Healer's Arts
 * learned, ASK whether to spend the Stock, and out of which purse when there is a choice, then pay
 * through the carer's own StonetopCharacter#spendStock. A GM answers only as the primary GM, so two
 * GMs are never both asked.
 *
 * WHO ASKED is foundry-compat.js#queryAsker's business: v13 names nobody in the context, so the id in
 * the data is read instead, and never taken for a GM's.
 *
 * @returns {Promise<object|null>} as payHealersArtsStock
 */
export async function handleHealersArtsQuery(data, context = {}, { actors = globalThis.game?.actors, users = globalThis.game?.users } = {}) {
	const me = globalThis.game?.user;
	if (me?.isGM && !isPrimaryGM()) return null;
	const user = queryAsker(data, context, users);
	const carer = actors?.get?.(data?.carerId);
	const patient = actors?.get?.(data?.patientId);
	if (!user || !carer || !patient) return null;
	if (!carer.isOwner) return null;
	if (!patient.testUserPermission?.(user, "OWNER")) return null;
	if (!ownsLearnedMoveNamed(carer, HEALERS_ARTS)) return null;

	const asked = Date.now();
	const late = () => Date.now() - asked > HEALERS_ARTS_ASK_MS - LATE_MARGIN_MS;
	const yes = await confirmOutcome({
		title: `${HEALERS_ARTS}: ${patient.name}`,
		content: `<p>${escHtml(user.name ?? "A player")} asks: <strong>${escHtml(patient.name)}</strong> is Recovering under `
			+ `<strong>${escHtml(carer.name)}</strong>'s care. Spend ${HEALERS_ARTS_STOCK} of ${escHtml(carer.name)}'s Stock so `
			+ `${escHtml(patient.name)} heals ${HEALERS_ARTS_STOCK_HP} more HP and their wounds are stabilized?</p>`
			+ `<p>Kept, the Recover still goes ahead with ${escHtml(carer.name)}'s WIS.</p>`
			+ (me?.isGM ? `<p>None of ${escHtml(carer.name)}'s players is here, so the GM answers.</p>` : ""),
		yes: { label: `Spend ${HEALERS_ARTS_STOCK} Stock on ${patient.name}`, icon: "fa-mortar-pestle" },
		no:  { label: me?.isGM ? `Keep ${carer.name}'s Stock` : "Keep my Stock" },
	});
	if (!yes) return { declined: true };

	// Which purse, asked exactly as the chat card's Spend button asks it: only when there is a choice,
	// and always when a Vessel's HP is one of them. Leaving it unpaid there is a no as well.
	const payable = payableStockSources((await carer.typedActor?.stockSources?.()) ?? [], HEALERS_ARTS_STOCK);
	if (!payable.length) {
		globalThis.ui?.notifications?.warn?.(`${carer.name} has no Stock left to spend.`);
		return null;
	}
	const source = mustAskStockSource(payable) ? await askStockSource(payable, HEALERS_ARTS_STOCK, HEALERS_ARTS) : payable[0];
	if (!source) return { declined: true };
	if (late()) {
		globalThis.ui?.notifications?.warn?.(`Too late: ${patient.name}'s Recover has already gone ahead without the Stock.`);
		return { declined: true };
	}
	return spendCarerStock(carer, source.key);
}
