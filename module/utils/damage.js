/**
 * Canonical Stonetop damage-die grammar — a die expression like `d8`, `2d6`,
 * `d10+2`, or `d8 - 1` (whitespace around the modifier is tolerated, matching how
 * the transcribed stat blocks print it). Shared by the character Followers tab
 * (_parseFollowerDamage) and the monster stat-block parser so the two recognise
 * exactly the same grammar instead of drifting apart.
 *
 * Stateless (no `g` flag), so it is safe to reuse the single instance across
 * `.test()` / `.match()` calls.
 */
import {getStonetopProsperity} from "./world.js";

export const DAMAGE_DIE_RE = /\d*d\d+(?:\s*[+-]\s*\d+)?/i;

/** {@link DAMAGE_DIE_RE} anchored, for "is this string ONLY a die expression?". Built once:
 *  it is stateless for the same reason DAMAGE_DIE_RE is, and it is tested on every keystroke
 *  in the damage window's modifier and extra-dice fields. */
const _WHOLE_DAMAGE_DIE_RE = new RegExp(`^${DAMAGE_DIE_RE.source}$`, "i");

/** The first die expression in a free-text damage string, or null. */
export function dieFromDamage(str) {
	return String(str ?? "").match(DAMAGE_DIE_RE)?.[0] ?? null;
}

/**
 * One extra damage-dice term, cleaned up for concatenation onto a damage formula — the
 * "+1d6" the Storm Markings' Storm's Fury imbues a strike with, the "+1d4" a Blood-Soaked
 * Past deals fighting without mercy, the "1d6" Clash's strike-hard already folds in.
 *
 * Accepts what a player would actually type: a leading `+` or `-`, spaces anywhere, and an
 * optional flat tail (`2d6 + 1`). Returns the term WITHOUT a leading `+` (a `-` is kept, since
 * the sign is part of the term) so the caller decides how to join it, or `""` for anything
 * that is not a single die expression — a blank field, prose, a bare number, two terms at once.
 *
 * DELIBERATELY NARROWER than handing the string to `Roll`: this text comes from a free-typed
 * field that reaches an evaluated formula, and a rejected term is a preview that visibly does
 * not change, where a thrown Roll is a damage roll that never happens.
 */
export function normalizeDamageBonusDice(input) {
	const raw = String(input ?? "").trim();
	if (!raw) return "";
	const negative = raw.startsWith("-");
	const body = raw.replace(/^[+-]\s*/, "");
	if (!_WHOLE_DAMAGE_DIE_RE.test(body)) return "";
	return `${negative ? "-" : ""}${body.replace(/\s+/g, "")}`;
}

/**
 * A damage formula with a one-off adjustment folded in: the base die (already carrying the
 * weapon's own `+N`) plus any extra dice and a flat bonus.
 *
 * Strike-hard's "1d6 extra damage" and a player's own typed dice DO stack, but not through
 * this argument: the attack flow folds the tier's dice into `base` before the damage window
 * opens (damageFormula in combat/attack-flow.js), so what arrives here is the one term the
 * window answered with. `extraDice` still accepts an array for a caller that has several
 * terms in hand at once; no shipped surface passes one today.
 *
 * Terms that don't parse (see {@link normalizeDamageBonusDice}) are dropped, so a half-typed
 * field can never break the roll.
 *
 * Order matters and is not cosmetic: the base die stays FIRST because advantage /
 * disadvantage on damage doubles the formula's first dice term (see `damageRollFormula`),
 * and "roll damage twice, take the higher" means the damage die — not the bonus dice.
 */
export function composeDamageFormula(base, { bonus = 0, extraDice = "" } = {}) {
	const terms = [];
	const first = String(base ?? "").trim();
	if (first) terms.push(first);
	for (const term of (Array.isArray(extraDice) ? extraDice : [extraDice]).map(normalizeDamageBonusDice)) {
		if (term) terms.push(term.startsWith("-") ? term : `+${term}`);
	}
	const flat = Math.trunc(Number(bonus)) || 0;
	if (flat) terms.push(flat > 0 ? `+${flat}` : String(flat));
	// A bonus with no base leaves the leading sign stranded at the head of the formula, which
	// Roll rejects. Nothing at all rolls a flat 0 rather than throwing on an empty formula.
	return terms.join("").replace(/^\+/, "") || "0";
}

/**
 * Resolve a weapon's piercing value. A number is a fixed count of armor points to
 * ignore; the string "prosperity" is the iron-weapon "x piercing" whose value equals
 * the party steading's CURRENT Prosperity — resolved live here so a mid-fight change
 * is honoured and never baked onto the weapon. Anything else → 0.
 */
export function resolvePiercing(piercing) {
	if (typeof piercing === "number") return Math.max(0, piercing);
	if (piercing === "prosperity") return Math.max(0, Number(getStonetopProsperity()) || 0);
	return 0;
}

/**
 * Reduce raw damage by a target's armor, honouring piercing and full-bypass:
 * effective = ignoresArmor ? raw : max(0, raw − max(0, armor − piercing)).
 * `messy` / `forceful` are pure fiction and never enter this math.
 */
export function mitigateDamage(raw, { armor = 0, piercing = 0, ignoresArmor = false } = {}) {
	const dmg = Math.max(0, Math.round(Number(raw) || 0));
	if (ignoresArmor) return dmg;
	const effectiveArmor = Math.max(0, (Number(armor) || 0) - (Number(piercing) || 0));
	return Math.max(0, dmg - effectiveArmor);
}

/**
 * Subtract `amount` HP from an actor, clamped at 0, and return the transition
 * `{ oldHp, newHp }` (null if the actor has no HP attribute). Writes
 * system.attributes.hp.value; the caller must have permission to update the actor
 * (monster targets ⇒ GM; the acting PC ⇒ its owner).
 */
export async function applyDamageToActor(targetActor, amount, updateOptions = {}) {
	const hp = targetActor?.system?.attributes?.hp;
	if (!hp) return null;
	const oldHp = Number(hp.value) || 0;
	const newHp = Math.max(0, oldHp - Math.max(0, Math.round(Number(amount) || 0)));
	if (newHp !== oldHp) await targetActor.update({ "system.attributes.hp.value": newHp }, updateOptions);
	return { oldHp, newHp };
}
