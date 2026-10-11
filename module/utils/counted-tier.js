// What a 2d6 roll card COUNTS as, read again whenever its total is rewritten after the dice.
//
// A roll's tier is its total's, unless a rule bends it: "treat a 6- as a 7-9" (Herd of Horses, Destined's
// Death's Door) or "treat a 7-9 as a 10+" (the Seeker's Let's Make a Deal). rollStat applies those at the
// roll (utils/roll-engine.js), and stamps what it rolled on the card (`ROLLED_FLAG`) so a reader after a
// Shift, a +1, Burn Brightly or Impetuous Youth can ask the same question of the new total: the stat that
// was rolled (Potential for Greatness asks it), and which bends the roll carried.
//
// Pure: no Foundry global is touched, and no import, so roll-engine.js and the readers it already imports
// (WouldBeHeroAsterisk.js) can both use it without a cycle.

/** The card flag rollStat stamps: `{ stat, move, missCountsAsPartial, partialCountsAsSuccess, ...Why }`. */
export const ROLLED_FLAG = "rolled";

/**
 * The record rollStat stamps for one roll. `move` is the card's heading (the move's name, or the stat's),
 * the two bends are booleans: whether the roll carried them, not whether they fired. Each bend's `...Why`
 * is the rule that bent it ("Let's Make a Deal"), so a rewrite can name it as the roll's own card did.
 *
 * Also read back off a card's result block, whose `data-miss-counts-as-partial` and
 * `data-partial-counts-as-success` (roll-engine.js#_rollCard) are these options by name in its dataset.
 */
export function rolledRecord(statKey, { moveName = null, missCountsAsPartial = "", partialCountsAsSuccess = "" } = {}) {
	const missWhy = String(missCountsAsPartial ?? "").trim();
	const partialWhy = String(partialCountsAsSuccess ?? "").trim();
	return {
		stat: String(statKey ?? ""),
		move: moveName ?? null,
		missCountsAsPartial: !!missWhy,
		partialCountsAsSuccess: !!partialWhy,
		missCountsAsPartialWhy: missWhy,
		partialCountsAsSuccessWhy: partialWhy,
	};
}

/**
 * The lowest total a "12+" clause answers to (A Force to Be Reckoned With). Here, with no import, so
 * roll-engine.js (which re-exports it) and totalTier below read the one number.
 */
export const CRITICAL_TOTAL = 12;

/** A total's own tier: "critical" (12+), "success" (10-11), "partial" (7-9) or "failure" (6-). */
export function totalTier(total) {
	const n = Number(total) || 0;
	if (n >= CRITICAL_TOTAL) return "critical";
	if (n >= 10) return "success";
	if (n >= 7) return "partial";
	return "failure";
}

/**
 * The tier a total COUNTS as on a card carrying `record` (ROLLED_FLAG; none bends nothing). A 6- the roll
 * treats as a 7-9 is "partial"; a 7-9 it treats as a 10+ is "success". Never "critical" by a bend: a 12+
 * is a number, not a tier a rule can hand out.
 */
export function countedTier(total, record = null) {
	const tier = totalTier(total);
	if (tier === "failure" && record?.missCountsAsPartial) return "partial";
	if (tier === "partial" && record?.partialCountsAsSuccess) return "success";
	return tier;
}

/**
 * The tier a posted roll card COUNTS as at `total`, read off the record rollStat stamped on it under `scope`
 * (the system's flag scope). A card with no record (rolled before it was kept, or not by rollStat) bends
 * nothing, so it reads as its total always has. For whatever the card's tier moves once it is rewritten:
 * identification, the tier's effects on the roller (stonetop.js#_resyncRewrittenTotal).
 */
export function cardCountedTier(message, total, scope) {
	return countedTier(total, message?.getFlag?.(scope, ROLLED_FLAG) ?? null);
}

/** A tier as a move's outcomes are keyed (roll-engine.js#classifyResult): a 12+ is its 10+. */
export function outcomeTier(tier) {
	return tier === "critical" ? "success" : tier;
}

/** The total a posted roll card shows NOW (after any Shift or rewrite), or null when it carries no roll. */
export function cardTotal(message) {
	const total = Number(message?.rolls?.at?.(0)?.total);
	return Number.isFinite(total) ? total : null;
}

/**
 * The tier a posted roll card counts as NOW (after any Shift or rewrite), as a move's outcomes are keyed
 * (a 12+ is its 10+), or null with no roll. `scope` as cardCountedTier's.
 */
export function cardTierNow(message, scope) {
	const total = cardTotal(message);
	return total == null ? null : outcomeTier(cardCountedTier(message, total, scope));
}

/** Whether a counted tier is a 10+ (a 12+ is one too). */
export function isStrongHit(tier) {
	return tier === "success" || tier === "critical";
}

/**
 * The line a card says when a bend fired at `total`, as rollStat's pill words it ("Rolled a 7-9, counted
 * as a 10+ (Let's Make a Deal)"); "" when the total counts as itself. Plain text: the caller escapes it.
 */
export function countedNote(total, record = null) {
	const rolled = totalTier(total);
	if (countedTier(total, record) === rolled) return "";
	const why = rolled === "failure" ? record?.missCountsAsPartialWhy : record?.partialCountsAsSuccessWhy;
	const said = rolled === "failure" ? "Rolled a 6-, counted as a 7-9" : "Rolled a 7-9, counted as a 10+";
	return why ? `${said} (${why})` : said;
}

// A rewritten card's result label per counted tier. A 12+ says so: a Shift that lands one there is a number
// the table can see, and the label has always followed it (stonetop.js#_shiftRollCardFlavor).
const COUNTED_LABELS = { critical: "12+ Strong Hit", success: "Strong Hit", partial: "Weak Hit", failure: "Miss" };

/**
 * What a roll card reads as once its total is rewritten to `total` (a Shift, a +1, Burn Brightly, Impetuous
 * Youth): the tier it COUNTS as (`key`), that tier's label, and the bend's note, or "" when none fired.
 * A 7-9 lifted to an 8 on a Let's Make a Deal roll is still a Strong Hit, and still says why.
 */
export function countedResult(total, record = null) {
	const key = countedTier(total, record);
	return { key, label: COUNTED_LABELS[key], note: countedNote(total, record) };
}
