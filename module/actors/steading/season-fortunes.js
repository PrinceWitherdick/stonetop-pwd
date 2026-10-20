// ── When the Seasons Change: each season's +Fortunes roll, as data (Book I pp.516-517, 520) ──────
// ONE table for what each result says and which results call for a threat, read by the Seasons Change
// window's roll step, the roll card's ladder (StonetopSteadingSheet.js) and the window's Threats step
// (season-threats.js). Nothing in here imports anything, so the GM-only threats module, loaded lazily,
// pulls in no more than this.
//
// `threat` tags the results p.520 names: "On a 7-9 in spring or autumn, or a 6- in summer, either introduce
// a new threat to the steading or have an existing threat advance towards impending doom" ("known"), and
// "Threats abound: on a 6- in spring, autumn, or winter" ("abound").
//
// `result` is the book's line in lower case with no closing stop; `noXp` is its "don't mark XP". The
// card and the window punctuate it each their own way (seasonResultLine / seasonLadderText). Winter's
// lines take the second bite's dice, `winterAgain`, as THIS steading rolls it.

/** @typedef {{tier: "success"|"partial"|"failure", result: string|function({winterAgain: string}): string, noXp?: boolean, threat?: "known"|"abound"}} SeasonResultRow */

const SPRING_AUTUMN = [
	{ tier: "success", result: "pick 1 seasonal gain" },
	{ tier: "partial", result: "pick 1 seasonal gain, but a threat makes itself known or gets worse", threat: "known" },
	{ tier: "failure", result: "threats abound", noXp: true, threat: "abound" },
];

/** Per season: who rolls, and the result rows in tier order. */
export const SEASON_FORTUNES = Object.freeze({
	spring: { who: "most hopeful", rows: SPRING_AUTUMN },
	summer: {
		who: "most content",
		rows: [
			{ tier: "success", result: "pick 2 seasonal gains" },
			{ tier: "partial", result: "pick 1 seasonal gain" },
			{ tier: "failure", result: "a threat makes itself known or gets worse", noXp: true, threat: "known" },
		],
	},
	autumn: { who: "most determined", rows: SPRING_AUTUMN },
	winter: {
		who: "weariest",
		rows: [
			{ tier: "success", result: "winter is relatively mild; each player names a local NPC with whom their relationship improves" },
			{ tier: "partial", result: ({ winterAgain }) => `the steading must consume ${winterAgain} more Surplus before winter ends, or suffer the consequences again` },
			{ tier: "failure", result: "as 7-9, plus threats abound", noXp: true, threat: "abound" },
		],
	},
});

/** A season's rows; an unknown season reads as spring's (the card's old default). */
export function seasonFortunesRows(seasonId) {
	return (SEASON_FORTUNES[seasonId] ?? SEASON_FORTUNES.spring).rows;
}

const _result = (row, winterAgain) => typeof row.result === "function" ? row.result({ winterAgain }) : row.result;

/** The row as the roll card words it: "threats abound; don't mark XP." */
export function seasonResultLine(row, { winterAgain = "1d4+Population" } = {}) {
	return `${_result(row, winterAgain)}${row.noXp ? "; don't mark XP" : ""}.`;
}

/** The row as the Seasons Change window words it: "Threats abound. Don't mark XP." */
export function seasonLadderText(row, { winterAgain = "1d4+Population" } = {}) {
	const text = _result(row, winterAgain);
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.${row.noXp ? " Don't mark XP." : ""}`;
}

/** The window's tier labels, typeset: an en dash and a true minus. */
export const SEASON_TIER_LABELS = Object.freeze({ success: "10+", partial: "7–9", failure: "6−" });
