// An ordered Clash or Let Fly carries on into the follower's damage, as the character's own attack does.
//
// ORDER FOLLOWERS (Book I p.462): "When you direct your follower to do something that would trigger a player
// move, and they do it, they trigger the move." So a follower ordered to Clash or Let Fly who hits deals
// their damage, and a Clash at 7-9 or 6- suffers the enemy's attack (p.215). The order's card carries a
// button on its hit tiers that rolls the follower's own card damage (StonetopCharacterSheet
// #_rollOrderedFollowerDamage), pressed once the player has made the move's picks: Let Fly's 7-9 may halve
// it. A Clash's 7-9 then strikes the counter-blow; its 6- is struck the moment the dice land (the sheet's
// orderFollower). Once per card, latched as every card button is, and only while the card still reads as
// a hit: a Shift or a +1 may have moved it since.

import { SYSTEM_ID } from "../system-id.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { wireLatchedButtons, withCardLatch } from "../utils/card-latch.js";
import { cardTierNow } from "../utils/counted-tier.js";

const KEY = "stonetop.character.followers.order";
export const ORDER_DAMAGE_FLAG = "followerOrderDamage";
const SELECTOR = ".stonetop-follower-order-damage";

/**
 * The button the order's card carries on a hit. PURE.
 *
 * @param {{ftype: string, slug?: string, name?: string, move: "clash"|"let-fly"}} attack
 */
export function orderedAttackButton({ ftype, slug = "", name = "", move }) {
	return `<button type="button" class="stonetop-follower-order-damage" data-ftype="${escHtml(ftype)}" data-slug="${escHtml(slug ?? "")}" data-move="${escHtml(move)}">`
		+ `<i class="fas fa-dice-d6"></i> ${escHtml(format(`${KEY}.damageButton`, { name: name || "their" }))}</button>`;
}

/** The card's tier actions: the damage button on a 10+ and a 7-9, nothing on a miss. PURE. */
export function orderedAttackTierActions(attack) {
	const button = orderedAttackButton(attack);
	return { success: button, partial: button };
}

/** Wire the button (stonetop.js renderChatMessageHTML), once per card. */
export function wireFollowerOrderDamage(message, html) {
	wireLatchedButtons(message, html, {
		selector: SELECTOR, flag: ORDER_DAMAGE_FLAG, what: "rolling an ordered follower's damage",
		act: (actor, btn, buttons) => {
			const tier = cardTierNow(message, SYSTEM_ID);
			if (tier !== "success" && tier !== "partial") {
				globalThis.ui?.notifications?.warn?.(localize(`${KEY}.tierMoved`));
				return Promise.resolve(false);
			}
			const sheet = actor?.sheet;
			if (typeof sheet?._rollOrderedFollowerDamage !== "function") return Promise.resolve(false);
			const { ftype = "", slug = "", move = "" } = btn.dataset;
			return withCardLatch(message, ORDER_DAMAGE_FLAG, true, buttons, () => sheet._rollOrderedFollowerDamage(ftype, slug, {
				move,
				// Clash at 7-9: "you deal your damage but suffer the enemy's attack".
				counter: move === "clash" && tier === "partial",
			}));
		},
	});
}
