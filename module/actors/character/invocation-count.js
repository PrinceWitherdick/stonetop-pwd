/**
 * How many Invocations a character should know at their level, for the Invocations tab's "N of M"
 * cue. A cue, never a block (stats and picks are FLAGGED on this sheet, not refused): short shows the
 * blue "still to choose", over shows the gold caution.
 *
 * The Lightbearer: "you start knowing 2 Invocations. Each time you reach an even-numbered level,
 * learn 1 new Invocation" (the insert, p.146), so 2 + floor(level / 2).
 *
 * Anyone else with Invoke the Sun God (a Would-be Hero through Versatile) starts knowing none and
 * learns one at each even level from the one they took the move at (Level Up step 5: "If you are the
 * Lightbearer (or have Invoke the Sun God) and your new level is even, choose a new invocation"). That
 * level is stamped when the move is taken (StonetopCharacter#_applyForeignMoveChoice); a taker with
 * no stamp (one who took it before the stamp existed) gets no cue rather than a wrong one.
 *
 * Never more than the list holds: there are ten, and a 20th-level Lightbearer cannot owe an eleventh.
 *
 * Pure: no Foundry global.
 */
import { STONETOP_SCOPE } from "./StonetopFlags.js";

/** Where the off-playbook taker's grant level is kept (under the `invocations` flag object). */
export const INVOCATIONS_GRANTED_AT_FLAG = "invocations.grantedAtLevel";

/**
 * The count arguments (for expectedInvocationCount / invocationCountCue) read off `actor` against an
 * Invocation `list` ({options, startingCount}, StonetopCharacter#invocationSource), the one way the
 * level-up and the Invocations tab both read them. `known` counts only the list's own slugs, so a
 * stale slug left in `invocations.selected` by an older list does not count.
 *
 * @param {object} actor
 * @param {object} list
 * @param {object} [opts]
 * @param {boolean} [opts.borrowed]  the list is the Lightbearer's, drawn on through Invoke the Sun God
 * @param {number} [opts.level]      the level weighed against (default: the actor's own)
 */
export function invocationCountArgs(actor, list, { borrowed = false, level = actor?.system?.attributes?.level?.value ?? 1 } = {}) {
	const options = list?.options ?? [];
	const selected = new Set(actor?.getFlag?.(STONETOP_SCOPE, "invocations.selected") ?? []);
	return {
		known:          options.filter(o => selected.has(o.slug)).length,
		optionCount:    options.length,
		startingCount:  borrowed ? 0 : (list?.startingCount ?? 2),
		level,
		borrowed,
		grantedAtLevel: actor?.getFlag?.(STONETOP_SCOPE, INVOCATIONS_GRANTED_AT_FLAG) ?? null,
	};
}

// How many even levels lie in [from, to], inclusive.
function evenLevelsBetween(from, to) {
	if (to < from) return 0;
	return Math.floor(to / 2) - Math.floor((from - 1) / 2);
}

/**
 * The expected count, or null when there is nothing to expect (no list, or an unstamped borrower).
 *
 * @param {object} args
 * @param {number} args.optionCount    how many Invocations the list offers
 * @param {number} args.startingCount  the playbook's starting count (0 for a borrower)
 * @param {number} args.level          the character's level
 * @param {boolean} [args.borrowed]    the list is the Lightbearer's, drawn on through Invoke the Sun God
 * @param {number|null} [args.grantedAtLevel]  the borrower's stamped grant level
 */
export function expectedInvocationCount({ optionCount, startingCount, level, borrowed = false, grantedAtLevel = null } = {}) {
	const options = Number(optionCount) || 0;
	if (options <= 0) return null;
	const lvl = Math.max(1, Math.floor(Number(level) || 1));
	let expected;
	if (borrowed) {
		const from = Number(grantedAtLevel);
		if (grantedAtLevel == null || !Number.isFinite(from)) return null;
		expected = evenLevelsBetween(Math.max(1, Math.floor(from)), lvl);
	} else {
		expected = (Number(startingCount) || 0) + Math.floor(lvl / 2);
	}
	return Math.min(options, expected);
}

/**
 * The cue itself: `{known, expected, shortfall, overage}`, or null when there is nothing to say
 * (no expectation, or the count is right).
 */
export function invocationCountCue({ known, ...args } = {}) {
	const expected = expectedInvocationCount(args);
	if (expected == null) return null;
	const have = Math.max(0, Number(known) || 0);
	if (have === expected) return null;
	return {
		known: have,
		expected,
		shortfall: Math.max(0, expected - have),
		overage: Math.max(0, have - expected),
	};
}
