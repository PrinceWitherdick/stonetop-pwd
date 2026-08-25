// ── Load levels ──────────────────────────────────────────────────────────────
// Load weight caps (Book I p.87) and the bucketing that turns a count of marked ◇
// into a load tier. Shared by the character model (buildSnapshot), the inventory
// snapshot defaults, and the Outfit dialog so the thresholds can never drift.

import { joinNames } from "./strings.js";

// Maximum number of regular ◇ at each load level.
export const LOAD_LEVEL_LIMITS = { light: 3, normal: 6, heavy: 9 };

// Raise every cap by a flat bonus. A move can grant one via its `loadBonus` field
// (the Ranger's Pack Horse sets it to 1 → light 4, normal 7, heavy 10); bonuses
// from multiple moves just stack. Zero returns the base caps unchanged.
export function loadLimitsFor(loadBonus = 0) {
	const b = Number(loadBonus) || 0;
	if (b <= 0) return LOAD_LEVEL_LIMITS;
	return {
		light:  LOAD_LEVEL_LIMITS.light  + b,
		normal: LOAD_LEVEL_LIMITS.normal + b,
		heavy:  LOAD_LEVEL_LIMITS.heavy  + b,
	};
}

// Bucket a count of marked ◇ into a load level. Anything past the heavy cap is
// "overloaded" — still heavy, but now risking exhaustion/injury.
export function deriveLoadLevel(totalWeight, loadLimits = LOAD_LEVEL_LIMITS) {
	if (totalWeight <= 0)                 return null;
	if (totalWeight <= loadLimits.light)  return "light";
	if (totalWeight <= loadLimits.normal) return "normal";
	if (totalWeight <= loadLimits.heavy)  return "heavy";
	return "overloaded";
}

// The "how many ◆" caption for each tier under the caps in effect: 3 / 4–6 / 7–9 by
// default, 4 / 5–7 / 8–10 with a +1 load bonus. One source for where a band starts, so
// the Outfit dialog's badges and the sheet's load lines can never disagree.
export function loadBandLabels(limits = LOAD_LEVEL_LIMITS) {
	return {
		light:  `${limits.light}`,
		normal: `${limits.light + 1}–${limits.normal}`,
		heavy:  `${limits.normal + 1}–${limits.heavy}`,
	};
}

// Name the move (or moves) whose loadBonus raised the caps, for the notes that explain
// why this character carries more than the printed 3/6/9. The Ranger's Pack Horse is the
// one in the book, but a custom or world-authored move can carry a loadBonus just as
// well, so nothing downstream hard-codes a move name. Returns "" when nothing granted one.
//
// Joined by `joinNames`, which is the system's one list-joiner: this caption sits on the
// Outfit readout beside the deploy toast, the off-map refusal and the encounter skip list,
// and a second joiner written here is what made this one line read "A and B" while every
// other list on the screen read "A & B". The trim stays, because a move name is authored
// text and may arrive padded.
export function loadBonusLabel(names = []) {
	return joinNames((names ?? []).map(n => String(n ?? "").trim()));
}
