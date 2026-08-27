import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { driftSummary } from "../migration/link-character-tokens.js";

// ── CharacterTokenLinkDialog ─────────────────────────────────────────────────
// "This token and this character have both been played. Which one is the character?"
//
// The end of the repair in migration/link-character-tokens.js, which handles by itself every
// case where there is nothing to lose and brings the rest here. A row on this list is a player
// token that has been written to independently of the character it stands for, so the two now
// hold different numbers — and linking them, which is the fix, keeps one and abandons the
// other. That is not a choice this system gets to make on a GM's campaign.
//
// NO ROW STARTS ANSWERED, and "Apply" stays disabled until every one is. The two answers are
// each destructive in the opposite direction and there is no defensible default between them:
// the character sheet is the copy the player opens from the sidebar, the token is the copy
// that was in play, and which of those is "the character" is a fact about the table's last few
// sessions that only the GM has. A pre-ticked option would be this system quietly picking, and
// picking wrong is indistinguishable from the bug being repaired.
//
// Resolves (via StonetopDialog's promise protocol) to
// `{applied: true, choices: Map<tokenUuid, "token"|"sheet"|"leave">}` when the GM commits, and
// to `{applied: false, choices: null}` when they dismiss — which the caller reads as "ask me
// again next load" rather than as a decision.

/**
 * The three answers a row can carry.
 *
 * "leave" is a real answer, not a deferral: it says the GM wants that token left as it is, and
 * the sweep closes on it and does not ask again. Deferring is done by dismissing the window,
 * which answers nothing and brings the whole list back next load.
 */
export const LINK_CHOICES = Object.freeze({ TOKEN: "token", SHEET: "sheet", LEAVE: "leave" });

export class CharacterTokenLinkDialog extends StonetopDialog {
	/** @param {Array<{token: object, base: object, scene: object}>} rows */
	constructor(rows = [], options = {}) {
		super(options);
		this._rows = rows;
	}

	/**
	 * Put `rows` to the GM.
	 * @returns {Promise<{applied: boolean, choices: Map<string, string>|null}>}
	 */
	static async ask(rows) {
		if (!rows?.length) return { applied: true, choices: new Map() };
		return (await new CharacterTokenLinkDialog(rows).promise())
			?? { applied: false, choices: null };
	}

	// One row per drifted character, and a world has few — the window takes the height it needs
	// and the CSS max-height catches a table that somehow has many.
	get _autoHeight() { return true; }

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-character-token-link",
			title:     "Player tokens holding their own copy",
			template:  "systems/stonetop-pwd/templates/dialogs/character-token-link.hbs",
			width:     620,
			height:    "auto",
			resizable: true,
			classes:   ["stonetop", "stonetop-token-link-dialog"],
		});
	}

	getData() {
		return {
			choices: LINK_CHOICES,
			rows: this._rows.map((row, index) => {
				const { vitals, other } = driftSummary(row.token, row.base);
				return {
					index,
					name:      row.base?.name ?? row.token?.name ?? "Unnamed character",
					tokenName: row.token?.name ?? "",
					// Only worth printing when the token is called something else: a token wearing
					// the character's own name adds a line saying nothing.
					renamed:   !!row.token?.name && row.token.name !== row.base?.name,
					scene:     row.scene?.name ?? "an unnamed scene",
					vitals,
					other,
					// A drift with nothing in the named vitals is still a real drift — gear, flags,
					// a portrait. The row says so rather than showing an empty table.
					subtleOnly: !vitals.length,
				};
			}),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		html.find('input[type="radio"]').on("change", () => this._refreshApply(root));
		html.find('[data-action="apply"]').on("click", () => {
			if (this._undecided(root).length) return;
			this._resolveWith({ applied: true, choices: this._choices(root) });
		});
		html.find('[data-action="later"]').on("click", () => this._resolveWith({ applied: false, choices: null }));
		this._refreshApply(root);
	}

	/** Indices of rows with no answer yet. */
	_undecided(root) {
		return this._rows
			.map((_row, index) => index)
			.filter(index => !root?.querySelector?.(`input[name="link-${index}"]:checked`));
	}

	/**
	 * Gate "Apply" on a complete answer sheet, and say how many are outstanding — a disabled
	 * button with no reason beside it reads as a broken dialog rather than an unfinished one.
	 */
	_refreshApply(root) {
		const outstanding = this._undecided(root).length;
		const apply = root?.querySelector?.('[data-action="apply"]');
		if (apply) apply.disabled = outstanding > 0;
		const note = root?.querySelector?.(".stonetop-token-link-outstanding");
		if (note) {
			note.textContent = outstanding
				? `Choose for ${outstanding} more ${outstanding === 1 ? "character" : "characters"}.`
				: "";
		}
	}

	/** The answers, keyed by token UUID so the caller can act without trusting row order. */
	_choices(root) {
		const chosen = new Map();
		this._rows.forEach((row, index) => {
			const picked = root?.querySelector?.(`input[name="link-${index}"]:checked`)?.value;
			if (picked && row.token?.uuid) chosen.set(row.token.uuid, picked);
		});
		return chosen;
	}
}
