import { stonetopCardShell, rollFormulaChip } from "./chat.js";
import { DEFAULT_FATE_TABLE, fateRangeLabel, fateRowFor, fateRowText } from "../data/fate-tables.js";

// Stonetop's d6 oracle (weather, the Vellum Scroll's costs, etc.). Rolled bare, results
// read like a traffic light: 1–2 bad, 3–4 mixed, 5–6 good.
//
// The rules also hang authored d6 tables off the same die — a perilous leg's danger, the
// night they Make Camp, the weather they hoped for — and a caller that names one gets THAT
// table's row back instead of the bare band, because "4: point to a looming danger" is the
// answer the GM pressed the button for. The tables live in data/fate-tables.js so the step
// printing one and the card resolving it read the same rows.

/**
 * Roll the Die of Fate and post a colour-coded result card to chat.
 *
 * Anything that is not one of our tables falls back to the bare oracle rather than throwing. This
 * is on `game.stonetop` and behind a hotbar macro, so the argument can be whatever a table's own
 * macro hands it — `rollDieOfFate(6)`, or the jQuery Event from a stray
 * `.on("click", game.stonetop.rollDieOfFate)`. A default parameter only covers `undefined`, and
 * everything past this line reads `table.rows`; the die is evaluated first, so the throw took the
 * roll with it and posted nothing at all.
 *
 * @param {object} [table]  A table from data/fate-tables.js. Omitted → the bare oracle.
 */
export async function rollDieOfFate(fateTable = DEFAULT_FATE_TABLE) {
	const table = Array.isArray(fateTable?.rows) ? fateTable : DEFAULT_FATE_TABLE;
	const roll = await new Roll("1d6").evaluate();
	const row  = fateRowFor(table, roll.total);

	const legend = table.rows.map(r =>
		`<li class="stonetop-fate-legend-row stonetop-fate--${r.tone}${r === row ? " is-active" : ""}"><strong>${fateRangeLabel(r)}</strong> ${fateRowText(r)}</li>`
	).join("");

	// A named table gets a title row, because the alias alone ("Die of Fate") doesn't say
	// WHICH question was asked. The bare oracle has no title: its alias already says it.
	const title = table.title ? `<p class="stonetop-fate-title">${table.title}</p>` : "";
	// The band word is the headline when a row carries one; the sentence sits beneath it,
	// in sentence case (the headline is uppercased in CSS, which mangles a full sentence).
	const label = row.label ? `<span class="stonetop-fate-label">${row.label}</span>` : "";
	const text  = row.text  ? `<span class="stonetop-fate-text">${row.text}</span>`   : "";

	const body = `<div class="card-content stonetop-fate">
		${title}
		<ul class="stonetop-fate-legend">${legend}</ul>
		${rollFormulaChip(roll.formula)}
		<div class="stonetop-fate-result stonetop-fate--${row.tone}">
			<span class="stonetop-fate-number">${roll.total}</span>
			<span class="stonetop-fate-said">${label}${text}</span>
		</div>
	</div>`;

	await roll.toMessage({
		speaker: { alias: "Die of Fate" },
		flavor:  stonetopCardShell(body, "stonetop-fate-card"),
	});
}
