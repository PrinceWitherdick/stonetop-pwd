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
 * WHOSE HIT POINTS A LINE SPENDS: one grammar for HP lost or paid by the line's own speaker, and for
 * damage the speaker takes. Three readers ask it: a PC's move option (utils/damage.js#readOptionDamage's
 * "lose 2d4 HP"), a monster's move ("costs 1d4 HP", stripped from its blow), and an arcanum's move
 * ("you take 2d4 damage", aimed at the roller). They kept three subject lists of their own, which
 * disagreed on who "the foe" or "the victim" was.
 *
 * A bare loss is the speaker's own. One with another subject right in front of it is somebody else's:
 * "they lose 1d6 HP" is a blow. "You" is somebody else only to a monster, whose move is written at the
 * PC it is aimed at; a PC's move is written at its reader.
 */
const OTHER_SUBJECTS = ["they", "it", "target", "foe", "victim", "enemy"];
const othersTo = speaker => (speaker === "monster" ? [...OTHER_SUBJECTS, "you"] : OTHER_SUBJECTS);

/** The verbs of an HP change: a loss, or (for a monster's move) a loss, a price or a gain. */
const HP_VERBS = {
	loss: ["lose", "loses", "losing"],
	cost: ["costs?", "lose", "loses", "losing", "gains?", "gaining"],
};

/** A die in prose, spaces tolerated inside it ("2d4", "1 d 6 + 1"). */
const PROSE_DIE = String.raw`\d*\s*d\s*\d+(?:\s*[+-]\s*\d+)?`;

/**
 * HP the speaker loses or pays: "lose 2d4 HP", "costs 1d4 HP", "but lose 1d4 HP". The amount is the
 * `amount` group. A new regex per call, so a global one carries no `lastIndex` between callers.
 *
 * @param {object} o
 * @param {"pc"|"monster"} o.speaker  whose move it is (who "you" is)
 * @param {"loss"|"cost"} o.verbs     loss: forms of "lose"; cost: those, "costs" and "gains" too
 * @param {boolean} [o.count]         a flat count too ("lose 1 HP"), not only a die
 * @param {string} [o.flags]
 */
export function ownHpChangeRe({ speaker, verbs, count = false, flags = "i" }) {
	const others = othersTo(speaker).join("|");
	const amount = count ? `${PROSE_DIE}|\\d+` : PROSE_DIE;
	return new RegExp(String.raw`(?<!\b(?:${others})\s+)\b(?:but\s+)?(?:${HP_VERBS[verbs].join("|")})\s+(?<amount>${amount})\s*HP\b`, flags);
}

/** Damage a PC's move does to its own roller: "you take 2d4 damage", "you suffer 2d6", "damage yourself". */
export const OWN_HARM_RE = /\b(?:you|yourself)\s+(?:take|suffer)\b|\bdamage\s+yourself\b/i;

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

/**
 * Fold a flat bonus INTO a damage formula's own modifier: "d8+1" +2 → "d8+3", "d6" +2 → "d6+2",
 * "d8 - 1" +1 → "d8", "d10+2" -2 → "d10".
 *
 * Appending a second term would roll the same total, so this is not about arithmetic — it is about
 * what the GM reads off the stat block. The group-fight tools rewrite the damage line live as the
 * counts change, and a line that grows a term per keystroke ("d8+1+2", then "d8+1+3") stops looking
 * like a damage value and starts looking like a log of the edits. One modifier, always.
 *
 * A formula that is NOT a single die expression — prose, or a stat block's " or " list of two blows
 * — is left whole with the bonus appended, because rewriting a term inside something we did not
 * parse is how a damage line gets corrupted; appending is at worst ugly and still rolls correctly.
 */
export function addDamageBonus(base, bonus) {
	const formula = String(base ?? "").trim() || "d6";
	const n = Math.trunc(Number(bonus) || 0);
	if (!n) return formula;
	const m = formula.match(/^(\d*d\d+)\s*(?:([+-])\s*(\d+))?$/i);
	if (!m) return `${formula}${n > 0 ? `+${n}` : n}`;
	const total = (m[2] === "-" ? -Number(m[3]) : Number(m[3] ?? 0)) + n;
	return `${m[1]}${total > 0 ? `+${total}` : total < 0 ? `${total}` : ""}`;
}
