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

/**
 * A printed option that DEALS damage, read out of the option's own words.
 *
 * Danu's Grasp's 7-9 is "roots, vines, and earth pull at them, and they pick 1", and one of the
 * two things they may pick is "They take 2d4 damage (ignores armor)". That is a whole damage
 * roll the move owes, stated in the move's own text and nowhere else: no weapon, no damage die,
 * no attack flow. Until this, the only way to pay it was to open a calculator, roll a d4 twice in
 * your head, and hand-edit the target's HP, which leaves no record on any card.
 *
 * TEXT-MATCHED, not declared, for the same reason `provisions.js#readProvisionsYield` is: the
 * line IS the book's own wording, it appears on a move card, on an arcanum's back and in a
 * treasure's list of outcomes, and a table that has reworded any of them (or written a homebrew
 * move that burns someone for 1d6) gets the same button without anyone wiring it up one at a time.
 *
 * WHAT IT REFUSES, and why each refusal matters:
 *
 * A BONUS ON A ROLL YOU ARE ALREADY MAKING. "Deal +1d4 damage" (Ambush), "Deal +1d6 damage" (The
 * Hammer and the Book), "for 1d6 extra damage" (Clash), "Ignore armor or deal +1d4 damage" (Call
 * the Shot), "Add 1d6 to a damage roll they just made" (We Happy Few), "you take +1d6 damage"
 * (the Redwood Effigy). None of those is a roll of its own: the five attack moves already fold
 * theirs into the one Confirm button their card carries (combat/attack-flow.js#PICK_EFFECTS), and
 * offering a second button beside the bullet would be the two-list miscount all over again, in
 * dice this time. The `+` and the word "extra" are what the book uses to say "on top of", so they
 * are what is read.
 *
 * A NUMBER THAT IS NOT BEING DEALT TO ANYONE. The Ring of Daagon's summoning table prints
 * "1 = horde (2d6, HP 3, d6 damage)", and the Mindgem's "its damage becomes 1d10+5" is a weapon
 * being rewritten. Both name a die beside the word damage and neither is a blow anybody is
 * striking now, so a VERB is required as well: someone has to take, suffer, deal or lose it.
 *
 * WHO TAKES IT is read off the pronouns, because it decides which side of the table the card
 * points at. "They take 2d4 damage" is the foe you just bound; "take 2d4 damage (ignores armor)
 * and mark weakened" (the cracked femur), sitting in a sentence about YOUR heat being sucked
 * away, is you. Nothing is applied on the strength of that reading alone: the card names whose
 * HP it is aimed at and waits for a second, deliberate click before a point of it moves.
 *
 * @param {string} text  one printed option's plain text
 * @returns {{formula: string, isRoll: boolean, self: boolean, ignoresArmor: boolean,
 *            piercing: number, tags: string[]}|null}
 *   null when the line deals no damage of its own. `formula` is always something Foundry's Roll
 *   accepts (a flat "3" is as valid a formula as "2d4"), and `isRoll` says whether there is
 *   really a die to throw, which is the difference between a button that offers to roll and one
 *   that just deals the number.
 */

// The die (or flat count) immediately before the word "damage": "2d4 damage", "1d10+2 damage",
// "3 points of damage". Anchored on "damage" rather than scanning for a die anywhere in the line,
// so an option that mentions a foe's HP, a debility count or a Value in the same breath cannot
// have one of those numbers read as the blow.
const OPTION_DAMAGE_RE = /(\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(?:points?\s+of\s+)?damage\b/i;

// Someone has to be taking it. A roll-call of the verbs the books actually use, not a wildcard:
// what this keeps out is a stat line that names a damage die without anybody striking with it.
const DAMAGE_VERB_RE = /\b(?:takes?|taking|suffers?|suffering|deals?|dealing|inflicts?|inflicting|loses?|losing|burns?|hurts?)\b/i;

// "1d6 extra damage", "add 1d6 to a damage roll": a number that rides another roll rather than
// being one, said in words. The other half of that rule is the SIGN, and it is not read here but
// against what sits immediately before the match (see below), because a sign inside the die
// expression itself is not a bonus at all: "d10+2 damage" is one number, and a pattern scanning
// the raw line for a signed damage term finds its "+2" and throws the whole blow away.
const BONUS_DAMAGE_RE = /\bextra\s+damage\b|\badds?\b[^.;]*\bdamage\s+roll\b/i;

// The armor clauses the books print beside a damage number, in the two forms the flow already
// knows how to apply (utils/damage.js#mitigateDamage): a full bypass, and a count of armor points
// pierced. Read here so a "(ignores armor)" on the bullet reaches the card that applies it.
const IGNORES_ARMOR_RE = /\bignores?\s+armou?r\b/i;
const PIERCING_RE = /\b(\d+)\s+piercing\b/i;

// The two flavour tags that only live in the fiction, and so are the two the damage card reminds
// the table about (combat/attack-flow.js#TAG_REMINDERS). `+N damage` and piercing ride the
// numbers and need no reminder.
const FICTION_TAG_RE = /\b(messy|forceful)\b/gi;

export function readOptionDamage(text) {
	const line = String(text ?? "");
	if (!line || BONUS_DAMAGE_RE.test(line)) return null;
	if (!DAMAGE_VERB_RE.test(line)) return null;
	const match = OPTION_DAMAGE_RE.exec(line);
	if (!match) return null;

	// A SIGN IN FRONT OF THE NUMBER means it is being added to something else, and the something
	// else is not on this card: "Deal +1d4 damage" (Ambush) is a die the attack's own Confirm
	// folds in, and "small (-2 HP, -2 damage, hand)" is a beast being sized on a summoning table.
	// Read off what precedes the MATCH rather than off the line, so the "+2" inside "d10+2
	// damage" (which the pattern above has already taken as part of the die) is left alone.
	const before = line.slice(0, match.index).trimEnd();
	if (before.endsWith("+") || before.endsWith("-")) return null;

	// Foundry's Roll wants "1d6", not "d6" or "2d4 + 1".
	const formula = match[1].replace(/\s+/g, "").replace(/^d/i, "1d");
	// "They" wins over "you" wherever both appear: "they take 2d4 damage" in a move whose trigger
	// is written at you is the foe's damage, and the trigger is in the same string.
	const them = /\b(?:they|them|their|its|the\s+target)\b/i.test(line);
	return {
		formula,
		isRoll: /d/i.test(formula),
		self: !them && /\byou(?:r|rself)?\b/i.test(line),
		ignoresArmor: IGNORES_ARMOR_RE.test(line),
		piercing: Number(PIERCING_RE.exec(line)?.[1]) || 0,
		tags: Array.from(new Set(Array.from(line.matchAll(FICTION_TAG_RE), m => m[1].toLowerCase()))),
	};
}
