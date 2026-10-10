/**
 * Death's Door's roll in progress, through the primary GM's client (the other half of dialogs/DeathsDoorDialog.js).
 *
 *  1. THE CLAIM (DEATHS_DOOR_CLAIM_QUERY). Every owner of a dying character can open the walkthrough, and the
 *     marker that stands the others down (deaths-door.js#DEATHS_DOOR_ROLLING_FLAG) used to be written by each
 *     window for itself: two owners pressing Roll inside one round trip both read "nobody is rolling", and both
 *     rolled. So a window asks the GM's client first, with the roll's nonce. That client answers one claim at a
 *     time (in turn, per character), reads the stored marker with deathsDoorClaimRuling, writes the marker itself
 *     for a claim it grants, and says who holds the roll for one it refuses. A window whose client IS the primary
 *     GM runs the same handler here, with no query to itself. "Take over" is the same claim, for the roll being
 *     taken: the GM decides whether it is still nobody's to finish, and fills in what it can see of it.
 *
 *     With no GM connected (or none that answered) there is nobody to rule, and the window writes the marker
 *     itself and reads it back (DeathsDoorDialog#_claimRoll). Only then does a narrow race remain: two windows
 *     writing inside one round trip can both roll, though the tier only one of them lands (DeathsDoorDialog#_land
 *     lands nothing for a roll whose marker names someone else's).
 *
 *  2. A BOOST ON A PRIVATE CARD (DEATHS_DOOR_BOOST_QUERY). A self, blind or GM roll's card never reaches the other
 *     owners' clients, so a window that took such a roll over has only the marker's total and tier, and nothing
 *     to rewrite. Burn Brightly and giving it your all then run on the GM's client, which has the card: the same
 *     rewrite (utils/roll-rewrite.js) and the same spend as the window's own, answered as the card's new total and
 *     the tier it counts as. With no GM connected, the window offers Accept only, and says why.
 *
 * Who asked is read as every other relay reads it (foundry-compat.js#queryAsker), so v13's context-less query from
 * a second GM finds nobody and gets no ruling: that window falls back to its own write, as with no GM at all.
 */

import { SYSTEM_ID } from "../../system-id.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { format } from "../../utils/i18n.js";
import { moveChatCard } from "../../utils/chat.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { inTurn } from "../../utils/turn-queue.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { writeCardRoll } from "../../utils/roll-card-writer.js";
import { adjustXp } from "../../utils/xp.js";
import { missXpTakenByLift } from "../../utils/undo-xp-mark.js";
import { characterFullName } from "../../utils/playbook-actors.js";
import { rollRewrite } from "../../utils/roll-rewrite.js";
import {
	DEATHS_DOOR_ROLL_FLAG, DEATHS_DOOR_STATE, deathsDoorCardTier, deathsDoorCardTierShift, deathsDoorClaimRuling,
} from "./deaths-door.js";
import {
	actorDeathsDoorState, deathsDoorRollCard, deathsDoorRollClock, deathsDoorRollMarker, deathsDoorRollPosted,
	setDeathsDoorRollMarker,
} from "./deaths-door-actor.js";
import { BURN_BRIGHTLY_COST, burnBrightlyAffordable } from "./burn-brightly.js";
import { GAVE_IT_ALL_FLAG, IMPETUOUS_YOUTH, giveItAllAtDeathsDoor } from "./impetuous-youth.js";
import { actorTookBackground } from "./took-background.js";

/** Payload `{ actorId, actorUuid, nonce, takeOver, userId }`; answers `{ granted, marker }` or `{ granted: false, holder }`. */
export const DEATHS_DOOR_CLAIM_QUERY = "stonetop.deathsDoorClaim";

/**
 * Payload `{ actorId, actorUuid, nonce, messageId, boost: "burn"|"giveAll", cost, userId }`; answers
 * `{ applied: true, from, total, tier, tierShift }` or `{ applied: false, reason?, spent? }`.
 */
export const DEATHS_DOOR_BOOST_QUERY = "stonetop.deathsDoorBoost";

/** The boosts a marker lists as still on offer, in the order the window's footer shows them. */
export const DEATHS_DOOR_BOOSTS = ["burn", "giveAll"];

// A boost can roll "you get hurt"'s 2d4 on the GM's client before it answers, dice animation and all: longer than
// the 10 seconds every other relay waits, which would report a lift that went through as one that did not.
const BOOST_TIMEOUT_MS = 30000;

/** The character a query names: by uuid where it resolves, else the world actor of that id. */
function actorOf(data, { actors, resolve }) {
	return (data?.actorUuid ? resolve(data.actorUuid) : null) ?? actors?.get?.(data?.actorId) ?? null;
}

/**
 * The boosts still on offer at the Door, by key (`burn`, `giveAll`): each unspent (`burned`, `gaveAll`), and
 * affordable (Burn Brightly: burn-brightly.js, so a Driven hero needs only the 2 XP) or taken (Impetuous Youth);
 * nothing at all on a 10+ (`tier`), the top of this move. One reading for the window (DeathsDoorDialog#_boostsLeft,
 * off its own latches) and for the GM's client (off the card).
 */
export function deathsDoorBoostsLeft(actor, tier, { burned = false, gaveAll = false } = {}) {
	if (tier === "success") return { burn: false, giveAll: false };
	const xp    = actor?.system?.attributes?.xp?.value ?? 0;
	const level = actor?.system?.attributes?.level?.value ?? 1;
	return {
		burn:    !burned && burnBrightlyAffordable(actor, xp, level),
		giveAll: !gaveAll && actorTookBackground(actor, IMPETUOUS_YOUTH),
	};
}

/** The boosts still on offer for a card, read off the card and the character, as a marker lists them. */
function boostsLeftOnCard(card, actor, tier) {
	if (!card) return [];
	const left = deathsDoorBoostsLeft(actor, tier, {
		burned:  !!card.getFlag?.(SYSTEM_ID, "burnBrightly"),
		gaveAll: !!card.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG),
	});
	return DEATHS_DOOR_BOOSTS.filter(key => left[key]);
}

/**
 * Put a query to the primary GM's client, or run its handler here when this client is that GM. Null when there is
 * no GM, or it could not answer: the caller then acts without a ruling.
 */
async function askPrimaryGM(query, handler, data, { what, timeout }) {
	const game = globalThis.game;
	const gm   = game?.users?.activeGM ?? null;
	if (!gm) return null;
	const asked = { ...data, userId: game.user?.id ?? null };
	if (gm.id === game.user?.id) {
		try {
			return await handler(asked, { user: game.user });
		} catch (err) {
			console.error(`Stonetop | could not ${what}`, err);
			return null;
		}
	}
	return askGMClient(gm, query, asked, { fallback: null, what, timeout });
}

/**
 * Ask the primary GM for the character's roll: a fresh one under `nonce`, or (`takeOver`) the roll of that nonce
 * left behind by another owner. The GM's ruling, or null when there is nobody to rule (see the header).
 */
export function askDeathsDoorClaim(actor, { nonce, takeOver = false }) {
	return askPrimaryGM(DEATHS_DOOR_CLAIM_QUERY, handleDeathsDoorClaimQuery, {
		actorId: actor?.id ?? null, actorUuid: actor?.uuid ?? null, nonce, takeOver: !!takeOver,
	}, { what: "claim the Death's Door roll" });
}

/** Ask the primary GM's client to spend a boost on a card this client cannot read. Its answer, or null. */
export function askDeathsDoorBoost(actor, { nonce, messageId, boost, cost = null }) {
	return askPrimaryGM(DEATHS_DOOR_BOOST_QUERY, handleDeathsDoorBoostQuery, {
		actorId: actor?.id ?? null, actorUuid: actor?.uuid ?? null, nonce, messageId, boost, cost,
	}, { what: "change the Death's Door card", timeout: BOOST_TIMEOUT_MS });
}

/**
 * The GM's side of DEATHS_DOOR_CLAIM_QUERY, for the primary GM only, and for an asker who owns the character.
 * Claims on one character are ruled in turn (the ruling reads the marker, and the write that grants one has to land
 * before the next is read), with the stored marker, its holder's presence and the server's clock
 * (deaths-door.js#deathsDoorClaimRuling). A granted claim's marker is written here: a fresh roll's bare, a
 * taken-over roll's under the taker's name, with the card, total, tier and boosts this client can see of it (a
 * private card, which the taker's client was never sent).
 *
 * Null for a claim it cannot rule on (not the primary GM, an asker it cannot name, a character they do not own).
 */
export async function handleDeathsDoorClaimQuery(data, context = {}, deps = {}) {
	const game = globalThis.game;
	const { users = game?.users, actors = game?.actors, messages = game?.messages, resolve = resolveSync } = deps;
	if (!game?.user?.isGM || !isPrimaryGM()) return null;
	const user  = queryAsker(data, context, users);
	const actor = actorOf(data, { actors, resolve });
	if (!user || !actor?.testUserPermission?.(user, "OWNER") || !data?.nonce) return null;
	return inTurn(`deaths-door:${actor.uuid ?? actor.id}`, async () => {
		const marker = deathsDoorRollMarker(actor);
		const card   = marker ? deathsDoorRollCard(marker, messages) : null;
		const now    = deathsDoorRollClock();
		const ruling = deathsDoorClaimRuling({
			marker,
			state:        actorDeathsDoorState(actor),
			userId:       user.id,
			nonce:        data.nonce,
			takeOver:     !!data.takeOver,
			holderActive: !!(marker && users?.get?.(marker.userId)?.active),
			posted:       deathsDoorRollPosted(marker, card),
			now,
		});
		if (!ruling.granted) return { granted: false, holder: ruling.holder };
		const total = card?.rolls?.at?.(0)?.total ?? marker?.total ?? null;
		const tier  = card && total != null ? deathsDoorCardTier(card, total) : marker?.tier ?? null;
		const roll  = data.takeOver
			? {
				...marker,
				messageId: card?.id ?? marker?.messageId ?? null,
				total,
				tier,
				boosts:    card ? boostsLeftOnCard(card, actor, tier) : marker?.boosts ?? null,
			}
			: { messageId: null, total: null, tier: null, boosts: null };
		const claimed = { ...roll, userId: user.id, userName: user.name ?? "", at: now, nonce: data.nonce };
		await setDeathsDoorRollMarker(actor, claimed);
		return { granted: true, marker: claimed };
	});
}

/**
 * Burn Brightly's spend on a roll card: THE one, for the roll card's own button (stonetop.js#_chatWireBurnBrightly,
 * on the card's writer: utils/roll-card-writer.js) and for the Door's window, which settles the tier itself. The
 * 2 XP go through the XP queue with the `require` the button was drawn on (burn-brightly.js), so a spend that is no
 * longer affordable is refused there; then the card takes its +1 through the same rewrite a GM's Shift makes. At
 * the Door, run by the window when its client is the card's writer, and by the GM's client otherwise (the header,
 * 2). `onSpent` hears the moment the XP is gone, so a rewrite that fails after it never takes the 2 XP twice.
 *
 * All of it in the card's turn, so the card is read as unburned by at most one spend: two owners pressing at once
 * pay once.
 *
 * @returns {Promise<{from: number, to: number}|null>}  the card's totals, or null when the XP was not there or the
 *   card was burned already
 */
export function burnBrightlyOnDoorCard(message, actor, { shiftRoll, cardFlavor, afterShift = null } = {}, { onSpent = null } = {}) {
	return inCardTurn(message, async () => {
		if (message.getFlag?.(SYSTEM_ID, "burnBrightly")) return null;
		// Read before the update, so the re-stamped alias is the one the card was created with rather than whatever
		// the actor has become mid-click.
		const fullName = characterFullName(actor);
		// Affordability is checked INSIDE the write queue rather than at the click. Checking it at click time was
		// right for one spend and wrong for two: a second Burn Brightly queued behind the first tested a total the
		// first had not yet reduced, so a character with 9 XP could buy two +1s and end on 5, below the threshold
		// that made either of them legal.
		//
		// Nor does it count the XP this card's own miss marked when the +1 lifts it off the miss: the burn takes
		// that XP back (roll-engine.js#reconcileMissXp), so it was never there to spend. Counted, a hero one short
		// bought the threshold with the miss, and a Driven hero with 1 XP paid 1 for the +1 (the take-back floored
		// at 0). Without it, what is left after the take-back is never below 0.
		const owedBack = missXpTakenByLift(message, (Number(message.rolls?.at?.(0)?.total) || 0) + 1);
		const { applied, after: newXp, max: maxXp } = await adjustXp(actor, -BURN_BRIGHTLY_COST, {
			move: "Burn Brightly",
			require: (xp, level) => burnBrightlyAffordable(actor, xp - owedBack, level),
		});
		if (!applied) return null;
		onSpent?.();
		await ChatMessage.create({
			content: moveChatCard("Burn Brightly", `<p>${format("stonetop.specialMoves.burnBrightly.spent", { cost: BURN_BRIGHTLY_COST, xp: newXp, max: maxXp })}</p>`),
			speaker: ChatMessage.getSpeaker({ actor }),
		});
		const from = message.rolls?.at?.(0)?.total ?? null;
		const speakerUpdate = fullName !== actor.name ? { alias: fullName } : {};
		const lifted = await writeCardRoll(message, roll => shiftRoll(roll, 1), { cardFlavor, afterShift }, {
			speaker: { ...message.speaker, ...speakerUpdate },
			flags:   { [SYSTEM_ID]: { burnBrightly: true } },
		});
		return { from, to: lifted.total };
	});
}

/**
 * The GM's side of DEATHS_DOOR_BOOST_QUERY, for the primary GM only: Burn Brightly (`burn`) or giving it your all
 * (`giveAll`, at `cost`) on the card of the roll the asker holds, while the character is still dying and the card
 * counts as less than a 10+. The card must be that roll's (its nonce), and the boost still unspent on it. The spend,
 * the rewrite and what the new total owes are this client's, exactly as the window's own; the answer is the card's
 * new total, the tier it counts as and who shifts it, for the asking window to carry on from.
 *
 * `spent` on a refusal says the boost is gone from the card all the same (spent before, or spent and then the
 * rewrite failed), so the window stops offering it. `reason: "xp"` is Burn Brightly with the XP no longer there.
 */
export async function handleDeathsDoorBoostQuery(data, context = {}, deps = {}) {
	const game = globalThis.game;
	const {
		users = game?.users, actors = game?.actors, messages = game?.messages, resolve = resolveSync, rewrite = rollRewrite(),
	} = deps;
	if (!game?.user?.isGM || !isPrimaryGM()) return null;
	const user  = queryAsker(data, context, users);
	const actor = actorOf(data, { actors, resolve });
	if (!user || !actor?.testUserPermission?.(user, "OWNER") || !rewrite) return null;
	const marker  = deathsDoorRollMarker(actor);
	const message = data?.messageId ? messages?.get?.(data.messageId) : null;
	const held = actorDeathsDoorState(actor) === DEATHS_DOOR_STATE.DYING && !!marker && marker.nonce === data?.nonce
		&& marker.userId === user.id && message?.getFlag?.(SYSTEM_ID, DEATHS_DOOR_ROLL_FLAG) === marker.nonce;
	if (!held) return { applied: false };
	const from = message.rolls?.at?.(0)?.total;
	if (from == null || deathsDoorCardTier(message, from) === "success") return { applied: false };
	let spent = false;
	try {
		if (data.boost === "burn") {
			if (message.getFlag?.(SYSTEM_ID, "burnBrightly")) return { applied: false, spent: true };
			const burned = await burnBrightlyOnDoorCard(message, actor, rewrite, { onSpent: () => { spent = true; } });
			// Burned by another press while this one waited its turn, or the XP no longer there.
			if (!burned) return message.getFlag?.(SYSTEM_ID, "burnBrightly") ? { applied: false, spent: true } : { applied: false, reason: "xp" };
		} else if (data.boost === "giveAll") {
			if (message.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG)) return { applied: false, spent: true };
			if (!actorTookBackground(actor, IMPETUOUS_YOUTH)) return { applied: false };
			if (!(await giveItAllAtDeathsDoor(message, actor, data.cost, rewrite))) return { applied: false };
		} else {
			return { applied: false };
		}
	} catch (err) {
		console.error("Stonetop | could not change a Death's Door card for another client", err);
		return { applied: false, spent };
	}
	const total = message.rolls.at(0).total;
	return { applied: true, from, total, tier: deathsDoorCardTier(message, total), tierShift: deathsDoorCardTierShift(message) };
}
