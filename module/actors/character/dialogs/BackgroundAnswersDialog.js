import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizePlaybookGlyphs, stripHtmlToText } from "../../../utils/strings.js";
import { format, localize } from "../../../utils/i18n.js";
import { wellVersedTopicSummary } from "./well-versed-topics.js";

// What a background asks of a move when the background is chosen on the Details tab rather than
// through onboarding (which asks it on its own background step): the Seeker's Witch Hunter is
// "Well Versed in (pick 1) the Fae, the Things Below, or the Last Door and what lies beyond".
// Also opened from the card's cue while such an answer is still empty.
//
// Self-contained: the caller hands over `asks` (StonetopCharacter#backgroundAnswerAsks) and writes
// what comes back (StonetopCharacter#setBackgroundAnswer). One radio group per ask, the answer held
// now pre-picked.
//
// The same window asks a background's SETUP choices on a Details-tab switch (askSetup): A Life of
// Crime's "either Burgle or Light Fingers (your choice) as an extra move, and either burglar tools or
// a hidden stash (your choice) as an additional special possession". There an option is a
// `{ value, label }` pair, as the playbook stores it, rather than a bare string.
//
// Resolves (StonetopDialog's promise protocol) to `{ [askKey]: value }` on "Choose this", and to
// null on "Choose later", Escape or the X.

/** The radio groups the dialog draws, one per ask, each option `selected` when it is the held answer. */
export function backgroundAnswerGroups(asks = []) {
	return asks.map(ask => ({
		key:   ask.key,
		label: normalizePlaybookGlyphs(ask.label ?? ask.key),
		options: (ask.options ?? []).map(option => {
			const value = typeof option === "object" && option ? String(option.value ?? "") : option;
			const label = typeof option === "object" && option ? String(option.label ?? option.value ?? "") : option;
			return {
				value,
				label:    normalizePlaybookGlyphs(label),
				summary:  wellVersedTopicSummary(value) ?? "",
				selected: ask.value === value,
			};
		}),
	}));
}

/**
 * The asks a background's `setup.choices` make, for askSetup: one per choice, its options as the
 * playbook prints them, the pick held now (`held`, keyed by choice key) pre-picked when it is still
 * on offer. Empty for a background with none.
 */
export function backgroundSetupAsks(background, held = {}) {
	return (background?.setup?.choices ?? []).filter(choice => choice?.key && choice.options?.length).map(choice => {
		const options = choice.options.map(o => ({ value: String(o?.value ?? ""), label: String(o?.label ?? o?.value ?? "") }));
		const value = held?.[choice.key];
		return { key: choice.key, label: choice.label ?? choice.key, options, value: options.some(o => o.value === value) ? value : null };
	});
}

export class BackgroundAnswersDialog extends StonetopDialog {
	constructor(background, asks, options = {}) {
		super(options);
		this._background = background;
		this._asks       = asks ?? [];
		// The setup ask's own words (askSetup); the answers ask's when absent.
		this._wording    = options.wording ?? null;
	}

	/**
	 * Ask `asks` for `background`. Opens only when there is something to ask.
	 * @returns {Promise<Record<string, string>|null>}
	 */
	static ask(background, asks) {
		if (!asks?.length) return Promise.resolve(null);
		return new BackgroundAnswersDialog(background, asks).promise();
	}

	/**
	 * Ask `background`'s setup choices (backgroundSetupAsks), worded as the setup's own ask rather
	 * than a move's answer. Opens only when there is something to ask.
	 * @returns {Promise<Record<string, string>|null>}
	 */
	static askSetup(background, asks) {
		if (!asks?.length) return Promise.resolve(null);
		return new BackgroundAnswersDialog(background, asks, { wording: "setup" }).promise();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-background-answers-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/background-answers.hbs",
			width:     440,
			height:    "auto",
			resizable: true,
			// The possession-choices editor's chrome, as the neighbors ask wears it.
			classes:   ["stonetop", "stonetop-possession-choices-dialog", "stonetop-background-answers-dialog"],
		});
	}

	get title() {
		const background = stripHtmlToText(this._background?.label ?? "") || this._background?.slug || "";
		if (this._wording === "setup") return format("stonetop.backgroundSetup.title", { background });
		return format("stonetop.backgroundAnswers.title", { background, label: this._asks[0]?.label ?? "" });
	}

	get _autoHeight() { return true; }

	getData() {
		const setup = this._wording === "setup";
		return {
			lead:        localize(setup ? "stonetop.backgroundSetup.lead" : "stonetop.backgroundAnswers.lead"),
			groups:      backgroundAnswerGroups(this._asks),
			chooseLabel: localize("stonetop.backgroundAnswers.choose"),
			laterLabel:  localize(setup ? "stonetop.backgroundSetup.later" : "stonetop.backgroundAnswers.later"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		html.find('[data-action="choose"]').on("click", () => this._resolveWith(this._picks(root)));
		html.find('[data-action="later"]').on("click", () => this._resolveWith(null));
	}

	/** The picked value of each group, by ask key; a group left unpicked is absent. */
	_picks(root) {
		const picks = {};
		root.querySelectorAll("[data-background-answer]").forEach(group => {
			const picked = group.querySelector('input[type="radio"]:checked');
			if (picked) picks[group.dataset.backgroundAnswer] = picked.value;
		});
		return picks;
	}
}
