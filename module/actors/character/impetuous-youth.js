// The Would-Be Hero's Impetuous Youth background:
//
//   "When you make a move and come up short, you can give it your all and turn a 6- into a 7-9, a 7-9 into
//   a 10+, and (if it matters), a 10-11 into a 12+. But if you do, pick 1 (the GM will fill in the details):
//   You get hurt (2d4 damage and an actual injury); You cause collateral damage, endanger others, or
//   otherwise escalate the situation; Something on your person is lost or breaks."
//
// A button on the hero's own move card, beside Burn Brightly, once per card. Pressing it asks the cost
// first (closing the window gives nothing and costs nothing), then lifts the total to the next tier's floor
// through the same rewrite every other lift uses (stonetop.js's _shiftRoll, _shiftRollCardFlavor and
// _resyncRewrittenTotal, handed in as `deps`, so the tier's effects and Potential for Greatness follow it).
// The cost rides on the card (GAVE_IT_ALL_FLAG) and names itself on the spent button; "you get hurt" also
// rolls its 2d4 at the hero on the shared damage card (combat/attack-flow.js#rollOptionDamage, which rolls
// it at disadvantage while Never Gonna Keep Me Down holds). The injury itself is the GM's to describe.
//
// NOT on Death's Door's card: the Door's outcome is settled by its own window when the dice land
// (dialogs/DeathsDoorDialog.js), so a lift on the card would relabel it and change nothing. The window
// offers it instead, before it settles, through giveItAllAtDeathsDoor below.

import { SYSTEM_ID } from "../../system-id.js";
import { escHtml } from "../../utils/strings.js";
import { canRewriteCard, moveChatCard } from "../../utils/chat.js";
import { inCardTurn } from "../../utils/card-queue.js";
import { pressRollCard, writeCardRoll } from "../../utils/roll-card-writer.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { contentElement } from "../../dialogs/content-picker.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { ROLLED_FLAG, countedTier } from "../../utils/counted-tier.js";
import { TIER_LABELS } from "../../utils/move-results.js";
import { actorTookBackground } from "./took-background.js";
import { isBoostableRoll } from "./roll-boosts.js";
import { WBH_PLAYBOOK_NAME } from "./WouldBeHeroAsterisk.js";
import { isDeathsDoorCard } from "./deaths-door.js";
import { format, localize } from "../../utils/i18n.js";

const KEY = "stonetop.wouldBeHero.impetuousYouth";

/** The background, as took-background.js asks it. */
export const IMPETUOUS_YOUTH = { playbook: WBH_PLAYBOOK_NAME, slug: "impetuous-youth", label: "Impetuous Youth" };

/** The card's latch: `{ cost, from, to }`, the cost picked and the totals before and after. */
export const GAVE_IT_ALL_FLAG = "gaveItAll";

/**
 * The card button's press, run on the card's writer (utils/roll-card-writer.js#pressRollCard) as giveItAll for
 * the character speaking the card, `{ cost }` its data. stonetop.js registers it with the rewrite's hands.
 */
export const GIVE_IT_ALL_ACTION = "giveItAll";

// "You get hurt" rolls its 2d4 on the writer's client before the press answers, dice animation and all: longer
// than the 10 seconds a relayed press otherwise waits, which would report a lift that went through as one that did not.
const GIVE_IT_ALL_TIMEOUT_MS = 30000;

/**
 * "Pick 1": each cost's key, its button in the question, what the spent card button says, and the book's
 * words. The words are getters over languages/en.json (`costs.<key>`), so every reader (this card, and the
 * Death's Door window) gets them in the language of the moment it reads them.
 */
export const GIVE_IT_ALL_COSTS = Object.freeze(["hurt", "escalate", "lost"].map(key => Object.freeze({
	key,
	get button() { return localize(`${KEY}.costs.${key}.button`); },
	get spent()  { return localize(`${KEY}.costs.${key}.spent`); },
	get text()   { return localize(`${KEY}.costs.${key}.text`); },
})));

/** The damage "you get hurt" costs, in the shape a move option's damage reads (utils/damage.js#readOptionDamage). */
export const HURT_DAMAGE = Object.freeze({ formula: "2d4", isRoll: true, self: true, ignoresArmor: false, piercing: 0, tags: [] });

const costOf = key => GIVE_IT_ALL_COSTS.find(c => c.key === key) ?? null;

// Each counted tier's next floor: a 6- to a 7-9, a 7-9 to a 10+, a 10-11 to a 12+. Nothing above a 12+.
const NEXT_FLOOR = { failure: 7, partial: 10, success: 12 };
// The printed tiers (move-results.js), and the 12+ a lift can reach.
const TIER_NAMES = { ...TIER_LABELS, critical: "12+" };

/**
 * The total giving it your all lifts `total` to, on a card carrying `record` (its ROLLED_FLAG): the floor of
 * the tier above the one it COUNTS as. Null on a 12+, which has nowhere to go.
 */
export function giveItAllTarget(total, record = null) {
	const floor = NEXT_FLOOR[countedTier(total, record)];
	return floor == null ? null : Math.max(floor, (Number(total) || 0) + 1);
}

/**
 * Whether `actor` may give it their all on this card now: they took Impetuous Youth, it is their own move
 * or stat roll (a hit tier, not a damage card; they can write it), not Death's Door, not already given, and
 * below a 12+.
 */
export function offersGiveItAll(message, actor) {
	if (!actorTookBackground(actor, IMPETUOUS_YOUTH)) return false;
	// Asked here, not left to isBoostableRoll: that one opens a Door card to a +1 while its window waits,
	// and the Door's give it your all is its window's own (giveItAllAtDeathsDoor).
	if (isDeathsDoorCard(message) || !isBoostableRoll(message)) return false;
	if (message.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG)) return false;
	if (!canRewriteCard(message, actor)) return false;
	const record = message.getFlag?.(SYSTEM_ID, ROLLED_FLAG) ?? null;
	return giveItAllTarget(message.rolls.at(0)?.total, record) != null;
}

/** Ask which cost, affirmative first; resolves to a cost's key, or null when the window is closed or refused. */
export function askGiveItAllCost(actor) {
	return askWithButtons({
		title: IMPETUOUS_YOUTH.label,
		content: contentElement(`<p>${escHtml(format(`${KEY}.ask`, { name: actor?.name ?? localize(`${KEY}.askYou`) }))}</p>`),
		buttons: [
			...GIVE_IT_ALL_COSTS.map(c => ({ key: c.key, label: c.button, value: c.key })),
			{ key: "cancel", label: localize(`${KEY}.cancel`), value: null },
		],
	});
}

/**
 * Give it your all: lift the card to the next tier's floor and record the cost. Run in the card's turn and
 * read again there, so two presses cannot both land. Whether it was given.
 *
 * @param {ChatMessage} message
 * @param {Actor} actor
 * @param {string} costKey  one of GIVE_IT_ALL_COSTS
 * @param {object} deps
 * @param {(roll: Roll, shift: number) => Promise<void>} deps.shiftRoll  stonetop.js#_shiftRoll
 * @param {(flavor: string, total: number, formula: string) => string} deps.cardFlavor  stonetop.js#_shiftRollCardFlavor
 * @param {(message: ChatMessage, total: number) => Promise<void>} [deps.afterShift]  stonetop.js#_resyncRewrittenTotal
 * @param {(actor: Actor) => Promise<*>} [deps.hurt]  rolls the 2d4 at the hero (attack-flow.js#rollOptionDamage)
 * @returns {Promise<boolean>}
 */
export function giveItAll(message, actor, costKey, deps = {}) {
	return liftInCardTurn(message, actor, costKey, deps, () => offersGiveItAll(message, actor));
}

/**
 * Give it your all at Death's Door, from its own window before it settles the tier
 * (dialogs/DeathsDoorDialog.js#_onGiveItAll): the same lift, cost card and 2d4 as giveItAll, on the Door's
 * card, which the card's own button never offers (see the header). Asked again in the card's turn whether it
 * is still unspent and has somewhere to go; whether the hero may is the window's to ask. Whether it was given.
 */
export function giveItAllAtDeathsDoor(message, actor, costKey, deps = {}) {
	return liftInCardTurn(message, actor, costKey, deps, () => {
		if (!isDeathsDoorCard(message) || message.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG)) return false;
		return giveItAllTarget(message.rolls.at(0)?.total, message.getFlag?.(SYSTEM_ID, ROLLED_FLAG) ?? null) != null;
	});
}

// The lift itself, for both of the above: `allowed` is asked in the card's turn, so two presses cannot both land.
function liftInCardTurn(message, actor, costKey, { shiftRoll, cardFlavor, afterShift = null, hurt = null } = {}, allowed) {
	const cost = costOf(costKey);
	if (!cost) return Promise.resolve(false);
	return inCardTurn(message, async () => {
		if (!allowed()) return false;
		const record = message.getFlag?.(SYSTEM_ID, ROLLED_FLAG) ?? null;
		const from = message.rolls.at(0).total;
		const target = giveItAllTarget(from, record);
		const fromTier = countedTier(from, record);
		const lift = async roll => { while (roll.total < target) await shiftRoll(roll, 1); };
		const roll = await writeCardRoll(message, lift, { cardFlavor, afterShift }, lifted => ({
			flags: { [SYSTEM_ID]: { [GAVE_IT_ALL_FLAG]: { cost: cost.key, from, to: lifted.total } } },
		}));
		await globalThis.ChatMessage?.create?.({
			content: moveChatCard(IMPETUOUS_YOUTH.label,
				`<p>${format(`${KEY}.note`, { name: escHtml(actor.name), from: TIER_NAMES[fromTier], to: TIER_NAMES[countedTier(roll.total, record)] })}</p>`
				+ `<p>${format(`${KEY}.noteCost`, { cost: escHtml(cost.text) })}</p>`),
			speaker: globalThis.ChatMessage.getSpeaker?.({ actor }),
			...(Array.isArray(message.whisper) && message.whisper.length ? { whisper: [...message.whisper] } : {}),
		});
		if (cost.key === "hurt") await hurt?.(actor);
		return true;
	});
}

/**
 * The button on a roll card, drawn every render: "Give it your all" while it is on offer, and once given, a
 * spent button naming the cost (for everyone who can see the card). Pressed on the card's writer
 * (GIVE_IT_ALL_ACTION), the GM's client while one is connected.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function wireImpetuousYouth(message, html) {
	const row = html?.querySelector?.(".stonetop-roll-card .stonetop-card-buttons");
	if (!row) return;
	const given = message?.getFlag?.(SYSTEM_ID, GAVE_IT_ALL_FLAG);
	const actor = speakerActor(message);
	if (!given && !offersGiveItAll(message, actor)) return;

	const button = globalThis.document.createElement("button");
	button.type = "button";
	button.className = "stonetop-give-it-all-btn";
	button.dataset.tooltipDirection = "UP";
	row.appendChild(button);
	row.style.display = "flex";
	if (given) {
		button.disabled = true;
		button.textContent = format(`${KEY}.given`, { cost: costOf(given.cost)?.spent ?? given.cost });
		button.dataset.tooltip = costOf(given.cost)?.text ?? "";
		return;
	}
	button.textContent = localize(`${KEY}.button`);
	button.dataset.tooltip = localize(`${KEY}.tooltip`);
	button.addEventListener("click", async () => {
		if (button.disabled) return;
		button.disabled = true;
		try {
			const cost = await askGiveItAllCost(actor);
			const given = cost && await pressRollCard(message, GIVE_IT_ALL_ACTION, { cost }, { timeout: GIVE_IT_ALL_TIMEOUT_MS });
			if (!given) button.disabled = false;
		} catch (err) {
			console.error("Stonetop | giving it your all failed", err);
			button.disabled = false;
		}
	});
}
