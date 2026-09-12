// Helpers for stepping/comparing polyhedral damage dice (d4 → d12).
export const DIE_ORDER = ["d4", "d6", "d8", "d10", "d12"];

/**
 * Canonical Stonetop damage-die grammar — a die expression like `d8`, `2d6`, `d10+2`, or
 * `d8 - 1` (whitespace around the modifier is tolerated, matching how the transcribed stat
 * blocks print it). Shared by the character Followers tab (_parseFollowerDamage), the monster
 * stat-block parser and the Dangers worksheet, so they all recognise exactly the same grammar
 * instead of drifting apart.
 *
 * IT LIVES HERE, not in utils/damage.js which re-exports it, because this module is the one
 * with no Foundry in it: data/monster-builder.js is deliberately Foundry-free so the book's
 * arithmetic can be tested on its own, and it needs this grammar to keep a hand-typed attack
 * name from smuggling a second die onto the damage line.
 *
 * Stateless (no `g` flag), so it is safe to reuse the single instance across
 * `.test()` / `.match()` calls.
 */
export const DAMAGE_DIE_RE = /\d*d\d+(?:\s*[+-]\s*\d+)?/i;

/** {@link DAMAGE_DIE_RE} anchored, for "is this string ONLY a die expression?". Built once: it is
 *  stateless for the same reason DAMAGE_DIE_RE is, and it is tested on every keystroke in the
 *  damage window's modifier field and in the Dangers worksheet's per-attack die. */
const _WHOLE_DAMAGE_DIE_RE = new RegExp(`^${DAMAGE_DIE_RE.source}$`, "i");

/**
 * True when `str` is a die expression and NOTHING else — "d8", "2d6", "d10+2", "d8 - 1".
 *
 * The question a free-typed die field has to answer before its value reaches a Roll: prose, a bare
 * number, two terms at once and a half-typed "d" all have to come back false, because a rejected
 * entry is a preview that visibly does not change where a thrown Roll is a roll that never happens.
 */
export function isWholeDamageDie(str) {
	return _WHOLE_DAMAGE_DIE_RE.test(String(str ?? "").trim());
}

/**
 * Take EVERY die expression out of `text`, each replaced by a single space.
 *
 * The one-die case is not the case that matters. A hand-typed attack name is free text, so
 * "claws d6 and fangs d10" is a thing a GM types, and a single non-global replace takes the
 * first die and leaves the second standing at the head of the damage line — where every reader
 * of that line picks it up as the creature's die. Stripping one die is therefore not a smaller
 * version of the job; it is the job done in the way that still corrupts the line.
 *
 * Builds its own global copy rather than putting `g` on {@link DAMAGE_DIE_RE}, which is shared
 * and documented as stateless: a `g` flag there would give every `.test()` in the system a
 * `lastIndex` that survives the call.
 */
export function stripDamageDice(text) {
	return String(text ?? "").replace(new RegExp(DAMAGE_DIE_RE.source, "gi"), " ");
}

/**
 * HOW A DAMAGE LINE PUNCTUATES ITS ATTACKS — the writer's half and the reader's half, stated
 * together because they are one grammar and they have to agree.
 *
 * Two blows are joined with " or "; three or more are a comma list with " or " before the last
 * ("iron battleaxe d8 (close, messy), spear d8 (close, thrown), or knife d6 (hand)"). A line
 * joined any other way comes back from the splitter as ONE attack wearing three names, and a line
 * split by a different rule than it was joined by does the same. They lived in two modules — the
 * join in data/monster-builder.js, the pattern in utils/damage.js — with nothing but a pair of
 * comments tying them; here neither can be edited without the other in view.
 *
 * The pattern is STICKY rather than `^`-anchored so the depth-counting scan that uses it can try
 * it at an offset without slicing the rest of the line off first: `lastIndex` is the anchor, which
 * is what `y` means.
 *
 * It is a FACTORY, not a shared instance, because `y` makes `lastIndex` mutable state: a shared
 * sticky regex is a module-level variable that every caller has to remember to reset, and the
 * sibling {@link DAMAGE_DIE_RE} right above it is documented as safe to reuse, which invites
 * exactly the assumption that breaks here. A caller doing a bare `.test()` on a shared instance
 * would get an answer that depends on where the previous scan happened to stop — a damage line
 * that parses one way on one render and another way on the next. One regex per scan costs
 * nothing and cannot be got wrong.
 */
export function attackSeparatorRe() {
	return /(?:\s*,\s*(?:or\s+)?|\s+or\s+)/iy;
}

/** Join printed attacks into one damage line, punctuated the way the books punctuate it. */
export function joinAttackProse(attacks) {
	const printed = (attacks ?? []).map(text => String(text ?? "").trim()).filter(Boolean);
	if (printed.length <= 1) return printed[0] ?? "";
	if (printed.length === 2) return printed.join(" or ");
	return `${printed.slice(0, -1).join(", ")}, or ${printed[printed.length - 1]}`;
}

/** Increase `die` by `steps` sizes, capped at `cap`. Unknown dice pass through. */
export function stepDie(die, steps, cap = "d12") {
	const i = DIE_ORDER.indexOf(die);
	if (i < 0) return die;
	const capIdx = DIE_ORDER.indexOf(cap);
	const max = capIdx < 0 ? DIE_ORDER.length - 1 : capIdx;
	return DIE_ORDER[Math.max(0, Math.min(i + steps, max))];
}

/**
 * Coerce hand-typed text into the canonical "d#" a damage die has to be stored as:
 * "8", "D8", " d8 ", "1d8" all become "d8". Returns null for anything that isn't a
 * single die ("2d6", "d8 (forceful)", "big"), so a caller can reject the edit rather
 * than persist something the roller can't use — a PC has exactly one damage die.
 *
 * The leading "1" is only ever a multiplier when a "d" follows it. Spelled out that way because
 * the obvious `(?:1\s*)?d?` reads the 1 of a BARE two-digit die as the multiplier and then has no
 * reason to give it back: the match succeeds, so there is no backtracking, and the caller is
 * handed a die it never typed. "12" came back as "d2" and was written to the sheet without a
 * warning; "10" and "100" left sides at 0 and were rejected as "not a damage die", so the
 * commonest heavy die could not be entered without its "d" at all.
 */
export function normalizeDamageDie(input) {
	const s = String(input ?? "").trim().toLowerCase();
	if (!s) return null;
	const m = s.match(/^(?:1\s*d|d)?\s*(\d+)$/);
	const sides = m ? Number(m[1]) : NaN;
	if (!Number.isInteger(sides) || sides < 2) return null;
	return `d${sides}`;
}

/** Return the larger of two dice. Unknown dice defer to the other. */
export function maxDie(a, b) {
	const ia = DIE_ORDER.indexOf(a);
	const ib = DIE_ORDER.indexOf(b);
	if (ia < 0) return b ?? a;
	if (ib < 0) return a;
	return DIE_ORDER[Math.max(ia, ib)];
}
