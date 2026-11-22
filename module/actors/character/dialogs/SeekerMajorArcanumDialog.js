import { StonetopDialog } from "../../../utils/stonetop-dialog.js";
import { normalizePlaybookGlyphs, stripHtmlToText } from "../../../utils/strings.js";
import { format, localize } from "../../../utils/i18n.js";
import { majorArcanaImg } from "../../../arcana-icons.js";
import { seekerMajorTrack } from "../seeker-collection.js";

// The Seeker's major arcanum when the background is chosen on the Details tab rather than through
// onboarding (which asks it on its own Major Arcana step): "Your Background grants you 1 major
// arcanum ... mark 1 ○ or □ on the front of its insert." Opened by the sheet's background switch
// (StonetopCharacter#settleSeekerMajorOnBackground says when), one radio per major the background
// lists. A major tracked by ○ takes its first ○; one tracked by □ tasks (the Mindgem, the Twisted
// Spear) asks which task, since the player picks which one was done.
//
// Resolves (StonetopDialog's promise protocol) to `{ major, marks: ["context:index"] }` on "Take
// this one", to `{ other: true }` on "Choose a different arcanum" (offered only with `other`, the
// world's "any major" switch), and to null on "Choose later", Escape or the X.

/**
 * The majors the dialog draws: `cards` are resolved arcana ({ slug, front }). Each carries its
 * mark track (seekerMajorTrack) as radio rows for □ tasks, or its ○ count.
 */
export function seekerMajorChoices(cards = []) {
	return cards.filter(card => card?.slug).map((card, i) => {
		const track = seekerMajorTrack(card.front);
		return {
			slug:     card.slug,
			name:     normalizePlaybookGlyphs(card.front?.title ?? card.slug),
			img:      majorArcanaImg(card.slug),
			summary:  stripHtmlToText(card.front?.description ?? "").slice(0, 240),
			selected: i === 0,
			circles:  track.kind === "circle" ? track.markers.length : 0,
			tasks:    track.kind === "box" ? track.markers.map(m => ({ key: `${m.context}:${m.index}`, label: normalizePlaybookGlyphs(m.label) })) : [],
		};
	});
}

/**
 * The answer for a picked major: its first ○, or the picked □ task. Null when a □ task is still
 * to be picked (or nothing is picked), so the dialog stays open.
 */
export function seekerMajorAnswer(choices, major, task = "") {
	const choice = choices.find(c => c.slug === major);
	if (!choice) return null;
	if (choice.tasks.length) return choice.tasks.some(t => t.key === task) ? { major, marks: [task] } : null;
	return { major, marks: choice.circles ? ["unlock:0"] : [] };
}

export class SeekerMajorArcanumDialog extends StonetopDialog {
	constructor(background, cards, { other = false, ...options } = {}) {
		super(options);
		this._background = background;
		this._choices    = seekerMajorChoices(cards);
		this._other      = !!other;
	}

	/**
	 * Ask for 1 of `cards` (the background's majors) and its mark. Opens only when there is a card.
	 * With `other`, a third button asks for a major off the list instead.
	 * @returns {Promise<{major: string, marks: string[]}|{other: true}|null>}
	 */
	static ask(background, cards, { other = false } = {}) {
		if (!cards?.length) return Promise.resolve(null);
		return new SeekerMajorArcanumDialog(background, cards, { other }).promise();
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:        "stonetop-seeker-major-dialog",
			template:  "systems/stonetop-pwd/templates/dialogs/seeker-major-arcanum.hbs",
			width:     480,
			height:    "auto",
			resizable: true,
			// The background ask's chrome (BackgroundAnswersDialog).
			classes:   ["stonetop", "stonetop-possession-choices-dialog", "stonetop-seeker-major-dialog"],
		});
	}

	get title() {
		const background = stripHtmlToText(this._background?.label ?? "") || this._background?.slug || "";
		return format("stonetop.seekerMajor.title", { background });
	}

	get _autoHeight() { return true; }

	getData() {
		return {
			lead:        localize("stonetop.seekerMajor.lead"),
			choices:     this._choices,
			circlesNote: localize("stonetop.seekerMajor.circles"),
			tasksNote:   localize("stonetop.seekerMajor.tasks"),
			chooseLabel: localize("stonetop.seekerMajor.choose"),
			laterLabel:  localize("stonetop.seekerMajor.later"),
			otherLabel:  this._other ? localize("stonetop.seekerMajor.other") : "",
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		html.find('[data-action="choose"]').on("click", () => {
			const major  = root.querySelector('input[name="seeker-major"]:checked')?.value ?? "";
			const task   = root.querySelector(`input[name="seeker-major-task-${major}"]:checked`)?.value ?? "";
			const answer = seekerMajorAnswer(this._choices, major, task);
			if (answer) this._resolveWith(answer);
			else ui.notifications?.warn?.(localize("stonetop.seekerMajor.pickTask"));
		});
		html.find('[data-action="later"]').on("click", () => this._resolveWith(null));
		if (this._other) html.find('[data-action="other"]').on("click", () => this._resolveWith({ other: true }));
	}
}
