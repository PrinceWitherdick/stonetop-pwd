// An ordered Clash or Let Fly carries on into the follower's damage, as the character's own attack does.
//
// ORDER FOLLOWERS (Book I p.462): "When you direct your follower to do something that would trigger a player
// move, and they do it, they trigger the move." So a follower ordered to Clash or Let Fly who hits deals
// their damage, and a Clash at 7-9 or 6- suffers the enemy's attack (p.215). The order's card carries a
// button on its hit tiers that rolls the follower's own card damage (StonetopCharacterSheet
// #_rollOrderedFollowerDamage), pressed once the player has made the move's picks. A Clash's 7-9 (or a
// 10+ that strikes hard) then strikes the counter-blow; its 6- is struck the moment the dice land (the
// sheet's orderFollower). Once per card, latched as every card button is, and only while the card still
// reads as a hit: a Shift or a +1 may have moved it since.
//
// WHAT THE CARD'S OWN PICKS DO (audit FOE-4). The order's card prints the move's own tickable list, and Clash's
// 10+ "Strike hard and fast, for 1d6 extra damage, but suffer your enemy's attack" (p.215) is read off it at
// the press through the same table a character's Clash uses (combat/attack-flow.js#pickedEffects): the 1d6
// goes on the follower's die and the counter-blow follows.
//
// A WHOLE GROUP AT ONE FOE (FOE-3): "roll one attacker's damage, +1 for each additional attacker" (p.473;
// p.463 "1d6+1 ... because there are two of them shooting"). One member ordered on their own (FOE-5) is one
// attacker: their own name, no +N, and a lone blow on a group token.
//
// LET FLY'S 7-9 "Deal your damage, but deplete your ammo" (FOE-10) gets a button of its own, for a follower whose
// card tracks ammo, which marks the card's next status (low ammo, then all out).
//
// THE COUNTER-BLOW IS STRUCK ONCE PER CARD (round-2 audit FOE-1), as a character's own Clash's is
// (combat/attack-flow.js#reconcileClashCounter). The order's card carries who was ordered (ORDER_FLAG) and
// is latched the moment the blow is struck (ORDER_COUNTERED_FLAG), from the 6- at the roll, the 7-9 or strike
// hard at the press, or a Shift: a 6- lifted onto a 7-9 keeps the blow it already took, and a card moved DOWN
// onto a 6- (or onto a 7-9 after its damage was dealt) suffers the one it never took (reconcileOrderedClashCounter,
// run from stonetop.js#_resyncRewrittenTotal). One member ordered on their own takes it themselves: the
// counter-blow's card names the order card (`counterOf`) and the member (`memberKey`), whom Apply lands it on.

import { SYSTEM_ID } from "../system-id.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";
import { wireLatchedButtons, withCardLatch } from "../utils/card-latch.js";
import { cardCountedTier, cardTierNow, outcomeTier } from "../utils/counted-tier.js";
import { AMMO_MAX, ammoStatusLabel, pickedEffects, pickedOptionLabels } from "../combat/attack-flow.js";
import { pileOnBonus } from "../data/follower-build.js";
import { FOLLOWER_FLAGS, fillFollowerSlug } from "../actors/character/follower-roster.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { foeBodiesAt } from "./follower-fight.js";
import { atZeroOf } from "./fight-sides.js";

const KEY = "stonetop.character.followers.order";
export const ORDER_DAMAGE_FLAG = "followerOrderDamage";
export const ORDER_DEPLETE_FLAG = "followerOrderDeplete";
/** Who an ordered attack's card is for: `{move, ftype, slug, name, member, memberName}`. */
export const ORDER_FLAG = "followerOrder";
/** Set once the enemy's attack has been struck for an ordered Clash, so it is struck once (FOE-1). */
export const ORDER_COUNTERED_FLAG = "followerOrderCountered";
const SELECTOR = ".stonetop-follower-order-damage";
const DEPLETE_SELECTOR = ".stonetop-follower-order-deplete";

/** `data-*` attributes naming the card, and the member ordered on their own, if any. PURE. */
function cardAttrs({ ftype, slug = "", member = "", memberName = "" }) {
	return `data-ftype="${escHtml(ftype)}" data-slug="${escHtml(slug ?? "")}"`
		+ (member ? ` data-member="${escHtml(member)}" data-member-name="${escHtml(memberName ?? "")}"` : "");
}

/**
 * The button the order's card carries on a hit. PURE.
 *
 * @param {{ftype: string, slug?: string, name?: string, move: "clash"|"let-fly", member?: string, memberName?: string}} attack
 *   `member`: the roster key of one member of a group ordered on their own, `memberName` theirs
 */
export function orderedAttackButton({ ftype, slug = "", name = "", move, member = "", memberName = "" }) {
	return `<button type="button" class="stonetop-follower-order-damage" ${cardAttrs({ ftype, slug, member, memberName })} data-move="${escHtml(move)}">`
		+ `<i class="fas fa-dice-d6"></i> ${escHtml(format(`${KEY}.damageButton`, { name: name || "their" }))}</button>`;
}

/** Let Fly's 7-9 deplete button, for a follower whose card tracks ammo. PURE. */
export function orderedDepleteButton({ ftype, slug = "", name = "" }) {
	return `<button type="button" class="stonetop-follower-order-deplete" ${cardAttrs({ ftype, slug })} data-name="${escHtml(name ?? "")}">`
		+ `<i class="fas fa-arrow-down-short-wide"></i> ${escHtml(format(`${KEY}.depleteButton`, { name: name || "their" }))}</button>`;
}

/**
 * The card's tier actions: the damage button on a 10+ and a 7-9, nothing on a miss, and on an ordered Let Fly's
 * 7-9 the deplete button too when the follower's card tracks ammo (`usesAmmo`). PURE.
 */
export function orderedAttackTierActions(attack) {
	const button = orderedAttackButton(attack);
	const deplete = attack?.move === "let-fly" && attack?.usesAmmo ? orderedDepleteButton(attack) : "";
	return { success: button, partial: button + deplete };
}

/** Whether a follower's card tracks ammo (the card's "uses ammo" toggle). PURE. */
export function followerUsesAmmo(flags, ftype, slug = "") {
	const base = fillFollowerSlug(FOLLOWER_FLAGS[ftype]?.detailBase, slug ?? "");
	return !!(base && foundry.utils.getProperty(flags ?? {}, `${base}.usesAmmo`));
}

/**
 * How many foes an ordered group's blow is aimed at (follower-fight.js#foeBodiesAt, the same count the token's
 * swarm die asks): the roller's targets, else who the follower's token (or their character) is fighting, never
 * one inside a group-against-group exchange (p.416). 1 when nothing says otherwise.
 *
 * @param {object} o
 * @param {Actor} o.character
 * @param {Actor|null} [o.fighter]  the follower's own token actor in the fight, if any
 * @param {Iterable<Token>} [o.targets]  this user's targets
 * @param {Function} [o.engagement]  damage-seed.js#rollerEngagement (for the tests)
 */
export function orderedFoeBodies({ character, fighter = null, targets, engagement } = {}) {
	return foeBodiesAt(fighter ?? character, { targets, engagement });
}

/**
 * The die an ordered blow rolls (PURE): a whole group of `standing` at ONE foe rolls one attacker's die +1 for each
 * other (p.473), anything else the die as printed; then the picks' extra dice (Clash's strike hard).
 */
export function orderedBlowFormula(die, { standing = 1, foes = 1, member = false, extraDice = [] } = {}) {
	let formula = String(die ?? "").trim();
	if (!member && standing > 1 && foes <= 1) formula = pileOnBonus(standing).rollFor(formula);
	for (const extra of extraDice ?? []) if (extra) formula += `+${String(extra).replace(/^\+/, "")}`;
	return formula;
}

/**
 * What an ordered Clash's or Let Fly's damage press does, from the tier and the ticked picks. PURE.
 *
 * @returns {{counter: boolean, extraDice: string[]}}
 */
export function orderedPress(move, tier, labels = []) {
	const picked = tier === "success" ? pickedEffects(move, labels) : { extraDice: [], counter: false };
	return {
		// Clash at 7-9: "you deal your damage but suffer the enemy's attack"; at 10+, strike hard's "but suffer
		// your enemy's attack".
		counter: move === "clash" && (tier === "partial" || picked.counter),
		extraDice: [...picked.extraDice],
	};
}

/**
 * The order card's flags for an ordered Clash or Let Fly (rollStat's `messageFlags`): who was ordered, so a
 * Shift that moves the card later can still strike their counter-blow, and Apply can land it on the one member
 * who was sent. PURE.
 */
export function orderCardFlags({ ftype = "", slug = "", name = "", member = "", memberName = "" } = {}, move = "") {
	return { [SYSTEM_ID]: { [ORDER_FLAG]: { move: String(move ?? ""), ftype, slug: slug ?? "", name: name ?? "", member: member ?? "", memberName: memberName ?? "" } } };
}

/**
 * Whether a REWRITTEN ordered Clash now owes the enemy's attack it never took (PURE): Clash's 6- "suffer the
 * enemy's attack" (p.215), and a 7-9 ("you deal your damage but suffer the enemy's attack") on a card whose
 * damage was already dealt from a 10+, which has no button left to strike it from. Never twice.
 */
export function rewriteOwesCounter({ move, tier, countered = false, pressed = false } = {}) {
	if (move !== "clash" || countered) return false;
	return tier === "failure" || (tier === "partial" && pressed);
}

/**
 * Strike an ordered Clash's counter-blow once (FOE-1): latch the card, then the sheet strikes it on the
 * follower's own token (StonetopCharacterSheet#_followerSuffersCounter), naming the card so Apply lands it on a
 * member ordered alone. Answers whether it was struck from here (false: already struck, or no sheet to strike it).
 *
 * @param {ChatMessage|null} message  the order's card
 * @param {Actor} character  the follower's leader
 * @param {{ftype: string, slug?: string, name?: string, member?: string, memberName?: string}} order
 */
export async function strikeOrderCounter(message, character, order = {}) {
	if (!character || message?.getFlag?.(SYSTEM_ID, ORDER_COUNTERED_FLAG)) return false;
	const sheet = character.sheet;
	if (typeof sheet?._followerSuffersCounter !== "function") return false;
	if (message?.setFlag) {
		try {
			await message.setFlag(SYSTEM_ID, ORDER_COUNTERED_FLAG, true);
		} catch (err) {
			console.warn("Stonetop | could not latch the ordered Clash's counter-blow on its card", err);
		}
	}
	await sheet._followerSuffersCounter({ ftype: order.ftype ?? "", slug: order.slug ?? "" }, {
		member: order.member ?? "", name: order.memberName || order.name || "", counterOf: message?.id ?? "",
	});
	return true;
}

/**
 * A rewritten order card (stonetop.js#_resyncRewrittenTotal): an ordered Clash moved onto a tier that suffers
 * the enemy's attack it never took strikes it now (rewriteOwesCounter). Run on the card's writer. Answers whether
 * a counter-blow was struck.
 */
export async function reconcileOrderedClashCounter(message, actor, total) {
	const order = message?.getFlag?.(SYSTEM_ID, ORDER_FLAG);
	if (!order || !actor || !Number.isFinite(Number(total))) return false;
	const owed = rewriteOwesCounter({
		move: order.move,
		tier: outcomeTier(cardCountedTier(message, Number(total), SYSTEM_ID)),
		countered: !!message.getFlag(SYSTEM_ID, ORDER_COUNTERED_FLAG),
		pressed: !!message.getFlag(SYSTEM_ID, ORDER_DAMAGE_FLAG),
	});
	return owed ? strikeOrderCounter(message, actor, order) : false;
}

/**
 * Whether a follower about to be ordered is down (PURE): a group with nobody standing (`roster`, utils/crew.js
 * #groupFollowerStanding), else a one-body follower whose card reads 0 HP. "When a follower is reduced to 0 HP
 * ... they're out of the action" (Book I p.469). Never for one `member` picked from the roster, who is standing.
 *
 * @param {{hp?: {value?: number, max?: number}}|null} card  the follower's finished card (_followerCardSnapshot)
 * @param {{standing: number, size: number}|null} roster
 */
export function followerIsDown(card, roster = null, { member = "" } = {}) {
	if (member) return false;
	if (roster && Number(roster.size) > 0) return Number(roster.standing) <= 0;
	return atZeroOf(card?.hp);
}

/**
 * Mark the next status on a follower card's ammo track (0 full, 1 low ammo, 2 all out), worded as a character's
 * weapon track is (combat/attack-flow.js#ammoStatusLabel). Answers the status marked, or null when there was none
 * left to mark.
 */
export async function depleteFollowerAmmo(character, { ftype, slug = "", name = "" } = {}) {
	const path = fillFollowerSlug(FOLLOWER_FLAGS[ftype]?.ammo, slug ?? "");
	if (!character || !path) return null;
	const held = Math.max(0, Math.min(AMMO_MAX, Math.trunc(Number(foundry.utils.getProperty(readableFlags(character) ?? {}, path)) || 0)));
	if (held >= AMMO_MAX) {
		globalThis.ui?.notifications?.warn?.(format(`${KEY}.depleteAllOut`, { name: name || character.name || "" }));
		return null;
	}
	await character.update({ [`flags.${SYSTEM_ID}.${path}`]: held + 1 }, { stonetopMove: "Let Fly" });
	const status = ammoStatusLabel(held + 1);
	globalThis.ui?.notifications?.info?.(format(`${KEY}.depleteMarked`, { name: name || character.name || "", status }));
	return status;
}

/** Wire the buttons (stonetop.js renderChatMessageHTML), once per card. */
export function wireFollowerOrderDamage(message, html) {
	const root = html?.[0] ?? html;
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
			const { ftype = "", slug = "", move = "", member = "", memberName = "" } = btn.dataset;
			const press = orderedPress(move, tier, pickedOptionLabels(btn.closest?.(".chat-message, .message") ?? root));
			// A counter-blow already struck for this card (a 6- lifted onto this tier) is not struck again (FOE-1).
			const counter = press.counter && !message.getFlag?.(SYSTEM_ID, ORDER_COUNTERED_FLAG);
			return withCardLatch(message, ORDER_DAMAGE_FLAG, true, buttons, () => sheet._rollOrderedFollowerDamage(ftype, slug, {
				move, ...press, counter, member, memberName, message,
			}));
		},
	});
	wireLatchedButtons(message, html, {
		selector: DEPLETE_SELECTOR, flag: ORDER_DEPLETE_FLAG, what: "depleting an ordered follower's ammo",
		act: (actor, btn, buttons) => {
			if (cardTierNow(message, SYSTEM_ID) !== "partial") {
				globalThis.ui?.notifications?.warn?.(localize(`${KEY}.depleteTierMoved`));
				return Promise.resolve(false);
			}
			const { ftype = "", slug = "", name = "" } = btn.dataset;
			return withCardLatch(message, ORDER_DEPLETE_FLAG, true, buttons,
				async () => !!(await depleteFollowerAmmo(actor, { ftype, slug, name })));
		},
	});
}
