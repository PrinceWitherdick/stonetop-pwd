// Bolster's Preparation on a DAMAGE roll (Book I p.525): "Players usually spend Preparation on 2d6 rolls
// for moves, but they can spend it on any damage rolls, rolls for Surplus, or even Die of Fate rolls--as
// long as everyone agrees that the efforts involved with Bolstering would apply to the roll." The move
// cards' button is roll-boosts.js's; a damage card has no hit tier to move, so it gets its own, on the
// terms We Happy Few's +1d6 shares (damage-card-boost.js):
//
//  - the holder's OWN damage card, once per card ("maximum +1 per roll"), plain or results, not yet applied;
//    not a follower's blow posted under their name, a blow they took, a group's blow, or someone else's.
//  - pressed by the holder's player (the GM with none online), and relayed through the GM's client on a
//    card that player cannot write (PREPARATION_DAMAGE_QUERY).
//
// Whether the efforts apply is the table's call (p.525), so pressing the button says they do. The tooltip
// names what the Preparation was laid in for, so the table can judge.

import { SYSTEM_ID } from "../../system-id.js";
import { format, localize } from "../../utils/i18n.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { inSpenderTurn } from "../../utils/spender-queue.js";
import { rollCardRoute } from "../../utils/roll-card-writer.js";
import { isPrimaryGM } from "../../utils/primary-gm.js";
import { askGMClient, queryAsker, resolveSync } from "../../utils/foundry-compat.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { ownerUsers } from "../../hooks/DeathsDoorPrompt.js";
import { actsForHelper, preparationHeld, preparationFor, spendPreparation, refundPreparation } from "./roll-boosts.js";
import {
	damageBoostHolder, openDamageCard, addTermToRoll, writeDamageBoost, damageBoostCard, drawDamageBoostNote,
	appendDamageBoostButton,
} from "./damage-card-boost.js";

const KEY = "stonetop.rollBoosts";

/** Message flag: the Preparation a damage card took, `{by: actorUuid, name}`. */
export const PREPARATION_DAMAGE_FLAG = "preparationDamage";

/** The User query a player's +1 goes through on a damage card they cannot write. */
export const PREPARATION_DAMAGE_QUERY = "stonetop.preparationDamage";

/**
 * Whether this damage card offers `user` a +1 from Preparation, and whose: the speaker's own damage roll,
 * not yet given one, not a follower's blow, a blow they took or a group's blow, not yet applied; the speaker
 * holding Preparation; and `user` the one who presses for them (roll-boosts.js#actsForHelper). PURE apart
 * from reading the actors.
 *
 * @returns {{holder: Actor, held: number, kind: "results"|"plain"}|null}
 */
export function preparationDamageOffer(message, {
	user = globalThis.game?.user, holderOf = speakerActor, ownersOf = ownerUsers, scope = SYSTEM_ID,
} = {}) {
	const card = damageBoostHolder(message, PREPARATION_DAMAGE_FLAG, { holderOf, scope });
	if (!card) return null;
	const held = preparationHeld(card.holder);
	if (held <= 0) return null;
	if (!actsForHelper(user, ownersOf(card.holder))) return null;
	return { holder: card.holder, held, kind: card.kind };
}

/** The +1 onto a plain card's roll, as a term of its own (damage-card-boost.js#addTermToRoll). */
function addOneToRoll(roll) {
	return addTermToRoll(roll, 1, "preparation");
}

/**
 * Add +1 to a damage card: 1 Preparation spent, +1 on every row of a results card or on a plain card's roll
 * and total, and written on the card so the button goes. In the card's turn, so it cannot land twice or
 * behind an Apply, and paid in the holder's spending turn, so two cards cannot both take their last one.
 * The Preparation is given back if the card cannot take the +1. Whether it was added.
 *
 * @param {object} deps
 * @param {(flavor: string, total: number, formula: string) => string} deps.cardFlavor  stonetop.js#_shiftRollCardFlavor
 */
export function addPreparationToDamage(message, holder, { cardFlavor = f => f, addOne = addOneToRoll, scope = SYSTEM_ID } = {}) {
	return inCardTurn(message, async () => {
		const open = holder ? openDamageCard(message, PREPARATION_DAMAGE_FLAG, scope) : null;
		if (!open) return false;
		if (!(await inSpenderTurn(holder, () => spendPreparation(holder)))) return false;
		const record = { by: holder.uuid, name: holder.name };
		try {
			await writeDamageBoost(message, {
				damage: open.damage, amount: 1, flag: PREPARATION_DAMAGE_FLAG, record, addTerm: addOne, cardFlavor, scope,
			});
		} catch (err) {
			await inSpenderTurn(holder, () => refundPreparation(holder))
				.catch(e => console.error("Stonetop | could not give back the Preparation", e));
			throw err;
		}
		return true;
	});
}

/** The words a card prints for the +1 it took: "+1 Preparation (Wren)". PURE apart from the localization. */
export function preparationDamageNote(record) {
	return format(`${KEY}.note.preparation`, { name: record?.name ?? "" });
}

/** The button's tooltip: what the Preparation was for, when the player wrote it down. */
function buttonTip(offer) {
	const purpose = preparationFor(offer.holder);
	return purpose
		? format(`${KEY}.tip.preparationFor`, { name: offer.holder.name, held: offer.held, purpose })
		: format(`${KEY}.tip.preparation`, { name: offer.holder.name, held: offer.held });
}

/**
 * Put the Preparation button on a damage card, and name the +1 once taken. Drawn every render from the
 * flag (damage-card-boost.js).
 */
export function wirePreparationDamage(message, html, deps = {}, { user = globalThis.game?.user } = {}) {
	const scope = deps.scope ?? SYSTEM_ID;
	const card = damageBoostCard(message, html, scope);
	if (!card) return;
	const record = message.getFlag(scope, PREPARATION_DAMAGE_FLAG);
	if (record) {
		drawDamageBoostNote(message, card, { noteClass: "stonetop-preparation-note", text: preparationDamageNote(record), scope });
		return;
	}
	if (!card.row) return;
	const offer = preparationDamageOffer(message, { user, scope, ...(deps.holderOf ? { holderOf: deps.holderOf } : {}) });
	if (!offer) return;
	const route = rollCardRoute(message, user);
	if (!route) return;
	appendDamageBoostButton(card, {
		className: "stonetop-preparation-damage-btn",
		label: localize(`${KEY}.button.preparation`),
		tip: buttonTip(offer),
		refused: localize(`${KEY}.bolster.damageRefused`),
		failure: "adding Preparation to the damage failed",
		press: async () => (route === "relay"
			? !!(await askGMClient(globalThis.game?.users?.activeGM, PREPARATION_DAMAGE_QUERY, {
				messageId: message.id, holderUuid: offer.holder.uuid, userId: user?.id ?? null,
			}, { fallback: false, what: "add a +1 from Preparation" }))
			: addPreparationToDamage(message, offer.holder, deps)),
	});
}

/**
 * The GM's side of PREPARATION_DAMAGE_QUERY, for the primary GM only: the +1 on a damage card the asker's
 * client cannot write, if the asker plays the holder and the card still offers it to them. Who asked is read
 * as roll-boosts.js reads it (foundry-compat.js#queryAsker). Whether it was added.
 */
export async function handlePreparationDamageQuery(data, context = {}, deps = {}) {
	const { users = globalThis.game?.users, resolve = resolveSync, messages = globalThis.game?.messages,
		scope = SYSTEM_ID } = deps;
	if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return false;
	const user = queryAsker(data, context, users);
	const message = messages?.get?.(data?.messageId);
	const holder = data?.holderUuid ? resolve(data.holderUuid) : null;
	if (!user || !message || !holder?.testUserPermission?.(user, "OWNER")) return false;
	const offer = preparationDamageOffer(message, { ...deps, user, scope });
	if (offer?.holder?.id !== holder.id) return false;
	return addPreparationToDamage(message, holder, deps);
}
