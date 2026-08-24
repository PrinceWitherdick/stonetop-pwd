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
 * A surface that PRINTS the table can hand in `beforePost` — the roll is settled first, the hook
 * is awaited with the row it landed on, and only then does the card go out. That is the same beat
 * order the GM Moves randomizer keeps (gm-toolkit/gm-move-drawer.js): the light walks the printed
 * list while the answer is already decided, and the card that answers the question waits for the
 * light to land, or a GM reading chat has no reason to watch the table at all. A hook that returns
 * `false` — a walk a later click superseded — posts NOTHING, so one landing is one card.
 *
 * @param {object} [table]  A table from data/fate-tables.js. Omitted → the bare oracle.
 * @param {object} [options]
 * @param {(result: {table: object, row: object, index: number, total: number}) => any}
 *        [options.beforePost]  Awaited between the roll and the card. Return false to post none.
 * @returns {Promise<object|null>}  `{roll, row, index}`, or null when `beforePost` called it off.
 */
export async function rollDieOfFate(fateTable = DEFAULT_FATE_TABLE, { beforePost = null } = {}) {
	const table = Array.isArray(fateTable?.rows) ? fateTable : DEFAULT_FATE_TABLE;
	const roll = await new Roll("1d6").evaluate();
	const row  = fateRowFor(table, roll.total);
	const index = table.rows.indexOf(row);

	if (beforePost && await beforePost({ table, row, index, total: roll.total }) === false) return null;

	// Two cells per row, not a bold run followed by prose: a range and a sentence in one text
	// flow wraps back under the NUMBER, which is what left the table looking ragged. The cells
	// are laid out as a grid in the stylesheet, so a wrapped second line lands under the first
	// word rather than under the die face.
	const legend = table.rows.map(r =>
		`<li class="stonetop-fate-legend-row stonetop-fate--${r.tone}${r === row ? " is-active" : ""}">`
		+ `<strong class="stonetop-fate-legend-range">${fateRangeLabel(r)}</strong>`
		+ `<span class="stonetop-fate-legend-text">${fateRowText(r)}</span></li>`
	).join("");

	// A named table gets a title row, because the alias alone ("Die of Fate") doesn't say
	// WHICH question was asked. The bare oracle has no title: its alias already says it.
	const title = table.title ? `<p class="stonetop-fate-title">${table.title}</p>` : "";
	// The band word is the headline when a row carries one; the sentence sits beneath it,
	// in sentence case (the headline is uppercased in CSS, which mangles a full sentence).
	const label = row.label ? `<span class="stonetop-fate-label">${row.label}</span>` : "";
	const text  = row.text  ? `<span class="stonetop-fate-text">${row.text}</span>`   : "";

	// THE HOUSE ORDER, which this card did not keep: which question, the formula chip, the
	// answer, and the reference table last. Every other Stonetop roll card (a move, damage, the
	// seasons) leads with the chip and puts the big total straight under it; this one opened with
	// the whole table, so the thing the button was pressed for arrived at the bottom.
	//
	// The result block wears `stonetop-roll-result` as well as its own class, so it IS the block
	// those cards use — same total size, same gap, same padding and radius — and the fate rules
	// only add what is genuinely different: the left edge and the wash in the row's own tone.
	const body = `<div class="card-content stonetop-fate">
		${title}
		${rollFormulaChip(roll.formula)}
		<div class="stonetop-fate-result stonetop-roll-result stonetop-fate--${row.tone}">
			<span class="stonetop-roll-result-number">${roll.total}</span>
			<span class="stonetop-roll-result-body">${label}${text}</span>
		</div>
		<ul class="stonetop-fate-legend">${legend}</ul>
	</div>`;

	await roll.toMessage({
		speaker: { alias: "Die of Fate" },
		flavor:  stonetopCardShell(body, "stonetop-fate-card"),
	});
	return { roll, row, index };
}
