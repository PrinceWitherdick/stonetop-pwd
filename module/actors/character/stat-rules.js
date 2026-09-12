// What the rules as written allow a character's six stats to be, and how to say what is off
// about one that sits outside them.
//
// The stat boxes take any number anyone types, on purpose: a table may be running a variant,
// converting a character in from another game, or handing out something the book never
// printed. Nothing here blocks a write or changes one. It works out what the book would have
// made the number and hands the sheet a sentence for the stats that disagree, which the stat
// block shows as a caution highlight while its section is being edited (actor-stats.hbs).
//
// Two rules, and they are the two the book actually pins down:
//
//  1. The RANGE, which holds whatever the playbook and whatever was earned. The lowest score
//     any playbook assigns is -1 and nothing in play lowers a stat (a debility gives
//     disadvantage instead); Superior Stat is the only advance that reaches +3 and nothing
//     goes past it.
//  2. The SCORE ITSELF, which is the creation assignment plus every +1 earned since: the
//     Improved / Superior Stat picks recorded in `improvedStatChoices`, and the stat slots of
//     a marking move (the Would-Be Hero's Potential for Greatness). Two ways to check it,
//     because two kinds of character reach the sheet:
//       - Onboarding recorded what it assigned (`onboardingStats`), so each stat is checked
//         against its OWN base and the message can name the one value it should read.
//       - A character built by hand or imported has no such record. Take each stat's earned
//         increases back off and the six starting scores come back, which are checked as a SET
//         against the playbook's printed array. A set check can only ever say "too many stats
//         start here", never which of them is the wrong one, so the message names them all,
//         offers the scores the array has not given out, and leaves the choice to the reader.
//
// Deliberately NOT modelled: the per-pick cap (+2 on Improved Stat, +3 on Superior). The
// pickers only ever offer a stat below the move's cap, so every recorded pick is worth its
// full +1, and counting them is both simpler and safe in the one direction that matters. An
// over-count would under-report, never accuse a legal sheet.

import {STAT_KEYS} from "../../utils/roll-types.js";
import {joinNames, sign} from "../../utils/strings.js";

/** A stat score as the book prints it: "+2", "+0", "-1". The system-wide signed-number
 *  formatter, named for what a stat score is so the prose below reads as what it prints. */
export const statScoreLabel = sign;

/** The range every score sits in, both ends inclusive. */
export const STAT_FLOOR   = -1;
export const STAT_CEILING = 3;

// What eight of the nine playbooks assign. A playbook's own note is read where there is one;
// this is the fallback for a playbook carrying none (the Would-Be Hero prints its own, lower
// array, so this is a default and never an override).
export const DEFAULT_STAT_ARRAY = [2, 1, 1, 0, 0, -1];

/**
 * The scores a playbook hands out, read off its printed note ("Assign these scores to your
 * stats: +2, +1, +1, +0, +0, -1"). Null when there is no note, or when what it reads off is
 * not one score per stat: a note we can't parse into six has to fall back to a playable
 * default rather than demand an assignment nobody can make.
 * @param {string|null} note
 * @returns {number[]|null}
 */
export function parseStatArray(note) {
	const matches = String(note ?? "").match(/[+-]?\d+/g);
	return matches?.length === STAT_KEYS.length ? matches.map(Number) : null;
}

/**
 * How many +1s each stat has been given since creation, counted off the actor's own flags.
 * Two sources, both keyed by what made the pick rather than by the stat, so both are counted
 * the same way: `improvedStatChoices` (one entry per Improved / Superior Stat instance) and
 * the stat slots inside `moves.moveMarks` (where the ledger writes them; the two sources sit
 * at DIFFERENT depths in the flag bag). A count-style mark stores `{ stat: "", level }`, so
 * "names a stat" is exactly what tells a stat slot apart from every other kind of mark.
 * @param {object} flags the actor's resolved Stonetop flag bag
 * @returns {Record<string, number>} every stat key, 0 where nothing was earned
 */
export function earnedStatIncreases(flags = {}) {
	const counts = Object.fromEntries(STAT_KEYS.map(key => [key, 0]));
	for (const statKey of Object.values(flags?.improvedStatChoices ?? {})) {
		if (statKey in counts) counts[statKey] += 1;
	}
	for (const options of Object.values(flags?.moves?.moveMarks ?? {})) {
		for (const entries of Object.values(options ?? {})) {
			if (!Array.isArray(entries)) continue;
			for (const entry of entries) {
				if (entry?.stat && entry.stat in counts) counts[entry.stat] += 1;
			}
		}
	}
	return counts;
}

/**
 * Every stat whose stored value the rules as written can't account for.
 * @param {object} args
 * @param {object} args.stats the actor's `system.stats` ({ str: { value }, ... })
 * @param {object} args.flags the actor's resolved Stonetop flag bag
 * @param {string|null} args.statsNote the playbook's printed stat-assignment note
 * @returns {Record<string, {value: number, expected: number|null, message: string}>}
 *   keyed by stat; a stat that checks out is simply absent.
 */
export function statRuleIssues({ stats = {}, flags = {}, statsNote = null } = {}) {
	const values    = Object.fromEntries(STAT_KEYS.map(key => [key, Number(stats?.[key]?.value ?? 0)]));
	const increases = earnedStatIncreases(flags);
	const issues    = {};

	for (const key of STAT_KEYS) {
		const value = values[key];
		if (!Number.isFinite(value)) continue;
		if (value > STAT_CEILING)    issues[key] = { value, expected: null, message: _ceilingMessage(value) };
		else if (value < STAT_FLOOR) issues[key] = { value, expected: null, message: _floorMessage(value) };
	}

	const bases = _recordedBases(flags?.onboardingStats);
	if (bases) {
		for (const key of STAT_KEYS) {
			if (issues[key]) continue;
			const expected = bases[key] + increases[key];
			if (values[key] === expected) continue;
			issues[key] = {
				value:    values[key],
				expected,
				message:  _budgetMessage(key, bases[key], increases[key], expected),
			};
		}
		return issues;
	}

	const array = parseStatArray(statsNote);
	if (!array) return issues;
	return _arrayIssues({ array, values, increases, issues });
}

// The creation assignment onboarding recorded, or null when it didn't record a whole one. All
// six or none: a half-filled record would check some stats exactly and leave the rest to a set
// check they can no longer be part of, and the two would then contradict each other.
function _recordedBases(onboardingStats) {
	const recorded = onboardingStats ?? {};
	const bases = {};
	for (const key of STAT_KEYS) {
		const value = Number(recorded[key]);
		if (!Number.isFinite(value)) return null;
		bases[key] = value;
	}
	return bases;
}

// The set check, for a character whose creation assignment was never recorded. Each stat's
// starting score comes back by taking its earned increases off, and a score held by more stats
// than the array assigns it to flags every stat holding it.
function _arrayIssues({ array, values, increases, issues }) {
	const allowed = new Map();
	for (const score of array) allowed.set(score, (allowed.get(score) ?? 0) + 1);

	const holders = new Map();
	for (const key of STAT_KEYS) {
		const score = values[key] - increases[key];
		holders.set(score, [...(holders.get(score) ?? []), key]);
	}

	// What the array still has to give out, once every stat legitimately on a score has taken
	// it. This is what a flagged stat could be instead, and it is the only "allowed value" a
	// set check is ever in a position to offer.
	const spare = [];
	for (const [score, count] of allowed) {
		const taken = Math.min(count, holders.get(score)?.length ?? 0);
		for (let i = taken; i < count; i++) spare.push(score);
	}
	spare.sort((a, b) => b - a);

	for (const [score, keys] of holders) {
		const allow = allowed.get(score) ?? 0;
		if (keys.length <= allow) continue;
		for (const key of keys) {
			if (issues[key]) continue;
			issues[key] = {
				value:    values[key],
				expected: null,
				message:  _arrayMessage({ key, keys, score, allow, array, spare, taken: increases[key], value: values[key] }),
			};
		}
	}
	return issues;
}

const _abbr = key => key.toUpperCase();

const _rangeTail = `A score runs from ${statScoreLabel(STAT_FLOOR)} to ${statScoreLabel(STAT_CEILING)}.`;

function _ceilingMessage(value) {
	return `${statScoreLabel(value)} is past what the rules reach: Superior Stat is the only advance that gets a stat `
	     + `to ${statScoreLabel(STAT_CEILING)}, and nothing takes one further. ${_rangeTail}`;
}

function _floorMessage(value) {
	return `${statScoreLabel(value)} is below what the rules reach: ${statScoreLabel(STAT_FLOOR)} is the lowest score any `
	     + `playbook assigns, and nothing in play lowers a stat (a debility gives disadvantage instead). ${_rangeTail}`;
}

function _increaseClause(count) {
	if (count === 0) return "no stat increase has been taken since";
	return count === 1 ? "one stat increase has been taken since" : `${count} stat increases have been taken since`;
}

function _budgetMessage(key, base, taken, expected) {
	return `${_abbr(key)} should read ${statScoreLabel(expected)}: creation assigned ${statScoreLabel(base)} and `
	     + `${_increaseClause(taken)}.`;
}

function _timesClause(count) {
	if (count === 1) return "once";
	return count === 2 ? "twice" : `${count} times`;
}

function _arrayMessage({ key, keys, score, allow, array, spare, taken, value }) {
	const worksOut = taken > 0
		? `${_abbr(key)} starts at ${statScoreLabel(score)} (${statScoreLabel(value)} now, less `
		  + `${taken === 1 ? "one stat increase" : `${taken} stat increases`})`
		: `${_abbr(key)} starts at ${statScoreLabel(score)}`;
	const others = keys.filter(k => k !== key).map(_abbr);
	const clash  = allow === 0
		? ", which this playbook's array never assigns."
		: `${others.length === 1 ? `, and so does ${others[0]}` : `, and so do ${joinNames(others)}`}, `
		  + `but the array assigns ${statScoreLabel(score)} ${_timesClause(allow)}.`;
	const offer = spare.length
		? ` Still unassigned: ${spare.map(statScoreLabel).join(", ")}.`
		: "";
	return `${worksOut}${clash} Array: ${array.map(statScoreLabel).join(", ")}.${offer}`;
}
