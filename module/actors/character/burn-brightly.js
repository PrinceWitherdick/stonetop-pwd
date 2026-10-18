// Burn Brightly: "When you have enough XP to Level Up, you may spend 2 XP after any roll you
// make to add +1 to that roll (max +1 per roll)."
//
// The Would-Be Hero's Driven background loosens the first half: "You always have the option to Burn Brightly;
// you can spend 2 XP after you roll to add +1, even if you don't have enough XP to level." So a Driven hero
// needs only the 2 XP the spend costs, and never goes below 0 for it (adjustXp floors at 0, which would
// otherwise let a hero with 1 XP buy the +1 for 1).
//
// ONE answer for both places that ask: the roll card's button is drawn only when it is affordable, and the
// spend itself is refused inside the XP queue when it no longer is (deaths-door-relay.js#burnBrightlyOnDoorCard,
// the one spend the card's button and the Death's Door window share, with utils/xp.js#adjustXp's `require`).
//
// Pure: no Foundry global is touched.

import { xpRules, xpToLevelUp } from "../../utils/xp.js";
import { actorTookBackground } from "./took-background.js";
import { WBH_PLAYBOOK_NAME } from "./WouldBeHeroAsterisk.js";

/** What Burn Brightly costs. */
export const BURN_BRIGHTLY_COST = 2;

/** The Would-Be Hero's Driven background, as took-background.js asks it. */
export const DRIVEN = { playbook: WBH_PLAYBOOK_NAME, slug: "driven", label: "Driven" };

/** Whether this character burns brightly on the Driven terms (any 2 XP, whatever the level). */
export function burnsBrightlyDriven(actor) {
	return actorTookBackground(actor, DRIVEN);
}

/**
 * Which of the card button's tooltips (stonetop.specialMoves.burnBrightly.*) says the terms this character
 * burns on: Driven's own, the world's "always" rule (p.582), or the move's. `rules`: xpRules(), when already read.
 */
export function burnBrightlyTooltipKey(actor, rules = xpRules()) {
	if (burnsBrightlyDriven(actor)) return "drivenTooltip";
	return rules.alwaysBurn ? "alwaysTooltip" : "tooltip";
}

/**
 * Whether `actor`, holding `xp` at `level`, may Burn Brightly now: at or above the level-up total, or, for a
 * Driven Would-Be Hero, holding the 2 XP it costs.
 *
 * @param {Actor} actor
 * @param {number} xp
 * @param {number} level
 * @param {object} [rules]  xpRules(), when the caller already read them
 */
export function burnBrightlyAffordable(actor, xp, level, rules = xpRules()) {
	const held  = Number(xp) || 0;
	// Book I p.582's optional rule, "Let players always Burn Brightly, even if they lack the XP to
	// Level Up": everyone on the Driven terms.
	if (rules.alwaysBurn || burnsBrightlyDriven(actor)) return held >= BURN_BRIGHTLY_COST;
	return held >= xpToLevelUp(Number(level) || 1, rules);
}
