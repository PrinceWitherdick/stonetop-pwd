// "Who did they mean?": every introduction answer, and who at this table it is about.
//
// The window a table opens once, on a world that ran its session zero before the answer step
// learned to ask. It reads out every answer anybody recorded, offers the name-match beside each
// one, and writes the reader's choices onto the answers themselves so the party board can point
// its arrows. See relmap/relmap-intro-match.js, which does the reading and the working out.
//
// ⚠ IT SHOWS EVERY ANSWER, including the ones about people outside the party. A list that hid what
// it could not guess at would leave the reader wondering what it had decided for them, and "my
// sister Maeve" is the commonest answer in the book. Those simply sit on "Nobody at this table",
// which is a real answer and the default.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { format, localize } from "../utils/i18n.js";

// A plain literal, not built from SYSTEM_ID, for the reason RelationshipMapWindow gives: the
// precache map in stonetop.js is checked against the source by finding this PATH in it, and an
// interpolated one appears nowhere for that check to find.
const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/intro-match.hbs";

export class IntroMatchDialog extends StonetopDialog {
	constructor({ rows = [], pcs = [] } = {}, options = {}) {
		super(options);
		this._rows = rows;
		this._pcs = pcs;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-intro-match",
			classes: ["stonetop", "stonetop-intro-match-app"],
			template: TEMPLATE,
			width: 620,
			height: 640,
			resizable: true,
			// Every answer at the table is a long read, and the reader works down it in one pass.
			scrollY: [".stonetop-intro-match-body"],
			title: localize("stonetop.relmap.match.title"),
		});
	}

	getData() {
		// GROUPED BY WHO WROTE THEM, because that is how the reader can hold the question in their
		// head: everything on screen at once is one person's account of the others, and the name of
		// the person answering is the context every row below it is read in.
		const groups = [];
		for (const row of this._rows) {
			const group = groups.at(-1)?.writerId === row.writerId
				? groups.at(-1)
				: groups[groups.push({ writerId: row.writerId, writerName: row.writerName, rows: [] }) - 1];
			group.rows.push({
				key: row.key,
				prompt: row.prompt,
				answer: row.answer,
				// SAID OUT LOUD WHEN IT IS A GUESS. What the reader is being asked for is a
				// confirmation, and a pre-filled control that does not say where its value came from
				// is asking them to confirm something they were never told.
				guessed: !!row.guess,
				options: this._pcs
					.filter(pc => pc.id !== row.writerId)
					.map(pc => ({ id: pc.id, name: pc.name, selected: pc.id === row.target })),
				noneSelected: !row.target,
			});
		}

		return {
			groups,
			hasRows: this._rows.length > 0,
			intro: localize("stonetop.relmap.match.intro"),
			guessedLabel: localize("stonetop.relmap.match.guessed"),
			noneLabel: localize("stonetop.relmap.match.none"),
			aboutLabel: localize("stonetop.relmap.match.about"),
			countLine: format("stonetop.relmap.match.count", { count: this._rows.length }),
			saveLabel: localize("stonetop.relmap.match.save"),
			cancelLabel: localize("stonetop.relmap.cancel"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		root.querySelectorAll("[data-intro-match]").forEach(button => {
			button.addEventListener("click", () => this._onButton(button.dataset.introMatch, root));
		});
	}

	/**
	 * Save what is on screen, as picks against the rows this window was opened with.
	 *
	 * ⚠ ONLY WHAT CHANGED. A row left exactly as it was found is not a pick: writing every row back
	 * would turn every guess this window offered into a recorded fact whether or not the reader
	 * ever looked at it, which is the one thing the guess must never do by itself.
	 */
	_onButton(action, root) {
		if (action !== "save") return this._resolveWith(null);
		// READ IN ONE SWEEP and looked up by key, rather than one query per row: a table of nine
		// characters is seventy-odd rows, and a selector built out of a row key would have to be
		// escaped as one too.
		const chosen = new Map(
			[...root.querySelectorAll("select[data-row-key]")].map(el => [el.dataset.rowKey, el.value ?? ""]),
		);
		const picks = [];
		for (const row of this._rows) {
			const value = chosen.get(row.key) ?? "";
			if (value === row.who) continue;
			picks.push({ writerId: row.writerId, at: row.at, who: value, answer: row.answer, step: row.step });
		}
		this._resolveWith(picks);
	}
}

/**
 * Ask who each recorded answer is about.
 *
 * Resolves to the picks that differ from what is stored, or to null when the reader backed out --
 * which every exit does, including Escape and the X, so a caller is never left awaiting.
 */
export function openIntroMatch({ rows = [], pcs = [] } = {}) {
	return new IntroMatchDialog({ rows, pcs }).promise();
}
