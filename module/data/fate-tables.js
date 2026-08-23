// ── Die of Fate tables ────────────────────────────────────────────────────────
// Stonetop's d6 oracle and the authored d6 tables the rules hang off it. Kept free of
// Foundry globals so the roller (utils/die-of-fate.js), which posts the chat card, and
// the walkthroughs, which PRINT the same table into a step body, can both import it.
//
// One table is one source: the list a step shows the GM and the row the chat card lights
// up come from the same rows here. A table restated in a step's prose meant the oracle
// could tell the GM something the page beside it didn't say.
//
// A row's `faces` are the d6 results it covers, `tone` is the traffic-light band it reads
// as (bad / mixed / good), `label` is a short word for it (used in an inline phrase and as
// the result card's headline), and `text` is the full authored sentence. Both are trusted
// authored HTML (entities, no tags); consumers render them without escaping.

/** The bare oracle, rolled when nothing names a table: 1–2 bad, 3–4 mixed, 5–6 good. */
export const DEFAULT_FATE_TABLE = {
	key:  "oracle",
	rows: [
		{ faces: [1, 2], tone: "bad",   label: "Bad" },
		{ faces: [3, 4], tone: "mixed", label: "Neutral / mixed" },
		{ faces: [5, 6], tone: "good",  label: "Good" },
	],
};

/**
 * The expedition chapter's tables (Book I p.301–343), keyed by the `fate` value on the step
 * that prints them (see dialogs/ExpeditionDialog.js).
 *
 * `weather` is the exception: its step is gone from the walkthrough (the seasonal picker is a
 * window of its own, and the step was one of eleven on a rail that had grown into a chore), so
 * nothing prints it today. It stays because `rollDieOfFate` takes any table here by name and
 * this is still the book's answer to "did they get the weather they hoped for?"
 */
export const FATE_TABLES = {
	// Running the journey — how hard to come down on a perilous leg.
	perilous: {
		key:   "perilous",
		title: "A perilous leg",
		rows:  [
			{ faces: [1],    tone: "bad",   text: "A danger springs on them, unavoidable." },
			{ faces: [2, 3], tone: "bad",   text: "Introduce a danger, right in front of them." },
			{ faces: [4, 5], tone: "mixed", text: "Point to a looming danger." },
			{ faces: [6],    tone: "good",  text: "Point to a looming danger, but also present a discovery." },
		],
	},
	// Player moves on the road — whether the night they Make Camp stays quiet.
	camp: {
		key:   "camp",
		title: "Making camp",
		rows:  [
			{ faces: [1],    tone: "bad",   text: "Something dangerous approaches, inclined to harm." },
			{ faces: [2],    tone: "bad",   text: "Something dangerous approaches, curious but not aggressive." },
			{ faces: [3],    tone: "mixed", text: "Something annoying happens (critters, rain, an argument)." },
			{ faces: [4, 5], tone: "mixed", text: "The night passes uneventfully." },
			{ faces: [6],    tone: "good",  text: "A small boon, or an uneventful night." },
		],
	},
	// Weather & the Die of Fate — whether they get the weather they were hoping for.
	weather: {
		key:   "weather",
		title: "The weather they hoped for",
		rows:  [
			{ faces: [1, 2], tone: "bad",   label: "nope",                  text: "The weather goes against what they were hoping for." },
			{ faces: [3, 4], tone: "mixed", label: "partway",               text: "They get part of what they were hoping for." },
			{ faces: [5, 6], tone: "good",  label: "just what they wanted", text: "The weather is exactly what they were hoping for." },
		],
	},
};

/** A row's faces as a printed range: [1] → "1", [2, 3] → "2–3". */
export function fateRangeLabel(row) {
	const faces = row.faces;
	return faces.length > 1 ? `${faces[0]}&ndash;${faces[faces.length - 1]}` : `${faces[0]}`;
}

/** The row a d6 result lands on, or the last row if a table somehow leaves a face uncovered. */
export function fateRowFor(table, total) {
	return table.rows.find(r => r.faces.includes(total)) ?? table.rows[table.rows.length - 1];
}

/** A row's full sentence, falling back to its short label (the bare oracle has only labels). */
export function fateRowText(row) {
	return row.text ?? row.label ?? "";
}

/**
 * The table as a step body's inline reference list — the `<ul>` a walkthrough prints under
 * the paragraph that reaches for the die.
 */
export function fateTableList(table) {
	const rows = table.rows
		.map(r => `<li><strong>${fateRangeLabel(r)}</strong>: ${fateRowText(r)}</li>`)
		.join("\n\t\t\t\t\t");
	return `<ul class="stonetop-exp-fatetable">\n\t\t\t\t\t${rows}\n\t\t\t\t</ul>`;
}

/** The table as a parenthetical phrase: "1–2 nope, 3–4 partway, 5–6 just what they wanted".
 *  The short form, for a table named in running prose rather than listed under it. No step
 *  prints one this way since the weather step went; kept as the pair to fateTableList. */
export function fateInlinePhrase(table) {
	return table.rows.map(r => `${fateRangeLabel(r)} ${r.label ?? fateRowText(r)}`).join(", ");
}
