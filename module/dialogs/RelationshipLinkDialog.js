// What a line on a relationship map says, and who to draw one to.
//
// Two small windows, together because they are the two halves of one act: pick a person, then say
// what the line between you means.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { StonetopAutocomplete } from "../utils/autocomplete.js";
import { pickPerson } from "./PersonPickerDialog.js";
import { groupPeople, personNote } from "../utils/people-groups.js";
import { documentPortraitFrame, portraitOrNone } from "../utils/portrait-frame.js";
import { format, localize } from "../utils/i18n.js";
import { localizedOnce } from "../utils/localized-once.js";
import {
	RELMAP_DIRS, RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT, RELMAP_LABEL_MAX,
} from "../relmap/relmap-store.js";
import {
	RELMAP_KINS, RELMAP_KIN_DEFAULT, RELMAP_KIN_UNSET, guessKin, normalizeKin, readKin,
} from "../utils/relmap-kin.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/relationship-link.hbs";

/**
 * The eight inks' and four directions' display names.
 *
 * Through `localizedOnce` and not a top-level constant: `game.i18n` does not exist at module
 * evaluation time, so a constant built at import would be a table of untranslated keys forever.
 */
const inkNames = localizedOnce(() => Object.fromEntries(
	RELMAP_INKS.map(key => [key, localize(`stonetop.relmap.inks.${key}`)]),
));
const dirNames = localizedOnce(() => Object.fromEntries(
	RELMAP_DIRS.map(key => [key, localize(`stonetop.relmap.dirs.${key}`)]),
));

/**
 * What each family tie is called, with BOTH PEOPLE'S NAMES in it where they are known.
 *
 * Not through `localizedOnce`, unlike the two above: these depend on who this particular line joins,
 * so there is nothing to cache. "Ordga is Marrec's parent" is a question the reader can answer;
 * "the first is the second's parent" is one they can only answer by remembering which end they drew
 * from, and a tie set backwards leaves no trace in the writing at all.
 */
function kinNames(from, to) {
	const named = from && to;
	return Object.fromEntries(RELMAP_KINS.map(key => [
		key,
		named ? format(`stonetop.relmap.kinsNamed.${key}`, { a: from, b: to })
			: localize(`stonetop.relmap.kins.${key}`),
	]));
}

export class RelationshipLinkDialog extends StonetopDialog {
	constructor({ edge = null, from = "", to = "", suggestions = [] } = {}, options = {}) {
		super(options);
		this._edge = edge;
		this._from = from;
		this._to = to;
		this._suggestions = suggestions;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-relmap-link",
			classes: ["stonetop", "stonetop-relmap-link-app"],
			template: TEMPLATE,
			width: 460,
			title: localize("stonetop.relmap.linkTitle"),
		});
	}

	/** Content-hugging: the ink row wraps differently at different font scales. */
	get _autoHeight() { return true; }

	getData() {
		const edge = this._edge ?? {};
		const ink = RELMAP_INKS.includes(edge.ink) ? edge.ink : RELMAP_INK_DEFAULT;
		const dir = RELMAP_DIRS.includes(edge.dir) ? edge.dir : RELMAP_DIR_DEFAULT;
		// AN EXISTING LINE SHOWS WHAT IT STORES, and is never re-guessed at from its own writing.
		// A reader who has looked at a line that says "smothered her" and answered "not a family
		// tie" must not find that answer quietly overturned every time they open it again. The
		// guess is offered on a line being DRAWN (where there is nothing to overturn) and while the
		// words are being typed, which is where it saves the reader something rather than fighting
		// them. Everything already written is caught instead by "find family ties", which says out
		// loud how many lines it marked.
		const kin = this._edge ? normalizeKin(edge.kin) : guessKin(edge.label);
		const kinSaid = kinNames(this._from, this._to);
		return {
			edge: { label: edge.label ?? "", note: edge.note ?? "" },
			between: this._from && this._to
				? format("stonetop.relmap.between", { a: this._from, b: this._to })
				: localize("stonetop.relmap.betweenUnknown"),
			suggestions: this._suggestions,
			maxLength: RELMAP_LABEL_MAX,
			placeholder: localize("stonetop.relmap.labelPlaceholder"),
			labelLabel: localize("stonetop.relmap.labelField"),
			inkLabel: localize("stonetop.relmap.inkField"),
			dirLabel: localize("stonetop.relmap.dirField"),
			kinLabel: localize("stonetop.relmap.kinField"),
			kinHint: localize("stonetop.relmap.kinHint"),
			noteLabel: localize("stonetop.relmap.noteField"),
			notePlaceholder: localize("stonetop.relmap.notePlaceholder"),
			inks: RELMAP_INKS.map(key => ({ key, name: inkNames()[key], checked: key === ink })),
			dirs: RELMAP_DIRS.map(key => ({ key, name: dirNames()[key], checked: key === dir })),
			kins: RELMAP_KINS.map(key => ({ key, name: kinSaid[key], checked: key === kin })),
			canDelete: !!this._edge,
			saveLabel: localize(this._edge ? "stonetop.relmap.saveLink" : "stonetop.relmap.drawLink"),
			deleteLabel: localize("stonetop.relmap.deleteLink"),
			cancelLabel: localize("stonetop.relmap.cancel"),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		// Swap the label field’s native <datalist> popup for ours, as every other combo field in
		// the system does: Chromium’s native popup has no scrollbar, and the suggestions here are
		// every label already used on this map — exactly the long list that needs one.
		StonetopAutocomplete.upgradeAll(html);
		root.querySelectorAll("[data-relmap-link]").forEach(button => {
			button.addEventListener("click", ev => this._onButton(ev, root));
		});
		this._followLabel(root);
		root.querySelector("#relmap-link-label")?.focus();
	}

	/**
	 * Move the family tie along with the words, until the reader says otherwise.
	 *
	 * Typing "her mother" and having the tie select itself is the whole of what makes the tree
	 * something a table ends up with rather than something they would have to go back and mark up
	 * afterwards. It is a suggestion made IN FRONT OF THEM, on a control they can see move, which is
	 * the difference between this and reading the tie off the caption behind their back.
	 *
	 * IT STOPS THE MOMENT THEY TOUCH THE CONTROL, for good, and it never moves a tie that somebody
	 * else put there — the reader's own pick, or the answer a line being edited was opened with: a
	 * reader who has chosen an answer has answered, and a guess that overrules them is worse than no
	 * guess at all. Its OWN last guess is the one thing it may replace, which is what lets it keep
	 * up with a caption still being written.
	 *
	 * ⚠ AND "NOT A FAMILY TIE" IS ONE OF THOSE ANSWERS, which is the half the radios cannot show. It
	 * stores as `none`, and so does a line nobody has been asked about and a line being drawn, so the
	 * keystroke guard below — which can only see which radio is checked — read all three the same and
	 * re-guessed at the one that had been answered. That is the exact case this promises not to
	 * touch: a line captioned "smothered her at the mill", deliberately marked as no family tie, and
	 * then reopened to fix a word in its caption. Asked of the EDGE instead, once, where `readKin`
	 * still keeps a stored `none` apart from no answer at all.
	 */
	_followLabel(root) {
		const field = root.querySelector("#relmap-link-label");
		if (!field) return;
		// FOUND ONCE. The set of radios is fixed for the life of the dialog, and what runs on every
		// keystroke below is the guess itself -- not two more sweeps of the form to find the same
		// four inputs it found when it was wired up.
		const radios = [...root.querySelectorAll("input[name='kin']")];
		let touched = readKin(this._edge?.kin) !== RELMAP_KIN_UNSET;
		for (const radio of radios) radio.addEventListener("change", () => { touched = true; });
		// THE LAST THING THIS GUESSED, remembered so that the guess can tell its own work from the
		// reader's. Setting `checked` from script fires no `change`, so `touched` alone cannot see
		// the difference -- and without this the FIRST guess locked the guessing out: it moved the
		// radio off the default, and the next keystroke read a non-default answer and stood down.
		// Retyping "her mother" as "his wife" then saved a `parent` tie for a spouse, which is
		// exactly the backwards tie the whole feature warns about.
		let guessed = null;
		field.addEventListener("input", () => {
			if (touched) return;
			const chosen = radios.find(input => input.checked)?.value;
			// An answer the READER put there is an answer, and is never overruled. Its own previous
			// guess is not one, and is replaced as freely as it was made.
			if (chosen && chosen !== RELMAP_KIN_DEFAULT && chosen !== guessed) return;
			const want = guessKin(field.value);
			const radio = radios.find(input => input.value === want);
			if (!radio) return;
			radio.checked = true;
			guessed = radio.value;
		});
	}

	_onButton(ev, root) {
		const action = ev.currentTarget.dataset.relmapLink;
		if (action === "cancel") return this._resolveWith(null);
		if (action === "delete") return this._resolveWith({ deleted: true });
		this._resolveWith({
			label: StonetopDialog.readValue(root, "#relmap-link-label").trim(),
			note: StonetopDialog.readValue(root, "#relmap-link-note").trim(),
			ink: root.querySelector("input[name='ink']:checked")?.value ?? RELMAP_INK_DEFAULT,
			dir: root.querySelector("input[name='dir']:checked")?.value ?? RELMAP_DIR_DEFAULT,
			kin: root.querySelector("input[name='kin']:checked")?.value ?? RELMAP_KIN_DEFAULT,
		});
	}
}

/**
 * Ask what a link says.
 *
 * Resolves to the link's fields, to `{deleted: true}`, or to null when the reader backed out —
 * which every exit does, including Escape and the X, so a caller is never left awaiting.
 */
export function openLinkEditor({ edge = null, from = "", to = "", suggestions = [] } = {}) {
	return new RelationshipLinkDialog({ edge, from, to, suggestions }).promise();
}

/**
 * Ask which person on the map this is about.
 *
 * THE PEOPLE CHOOSER rather than the system's one-of-N radio list. This question is asked about a
 * whole world of people at once, and the radio list is built for a handful of kinds: on a village
 * of two dozen it came out as one alphabetical column taller than the screen, with no way to tell
 * a player character from a neighbour and nothing to type into. See dialogs/PersonPickerDialog.js
 * for the rest of that reasoning, and utils/people-groups.js for who lands on which list.
 *
 * IT USED TO ANSWER TWO QUESTIONS -- "draw a line to whom" and "whose web should this show" -- and
 * a `selected` row for the second, which knew a sensible default. The focus view asks with a
 * dropdown on its own bar now (walking the party one player at a time is what that view is for, and
 * a modal between each of them is a modal in the way), so this is left with the one question it was
 * written for. It stays a named function rather than folding into its caller because "pick a face
 * off this map by name" is a shape the window will want again.
 *
 * A ROW CARRIES ITS ACTOR, where there is one. That is what sorts the lists, and it is also the
 * face on the row: this window is about people, and a column of names with a picture beside each is
 * read at a glance where a column of identical figures has to be read a line at a time. A person
 * with no actor behind them (a name somebody typed onto a board) is still offered, under "Everyone
 * else", which is where they belong rather than a hole in the list.
 */
export function pickPersonOnMap({
	options = [], title = "", buttonLabel = "", formatLabel = null, icon = "",
} = {}) {
	const people = options.map(option => {
		const actor = option.actor ?? null;
		const portrait = portraitOrNone(actor?.img ?? "", documentPortraitFrame(actor));
		return {
			id: option.id,
			name: option.name,
			// What a caller said about this person if it said anything, and otherwise the line
			// their own sheet gives: their trade, or where they are from. See personNote.
			hint: option.hint || personNote(actor),
			actor,
			img: portrait.src ?? "",
			imgStyle: portrait.style ?? "",
		};
	});
	return pickPerson({
		title: title || localize("stonetop.relmap.linkPickTitle"),
		buttonLabel: buttonLabel || localize("stonetop.relmap.choose"),
		formatLabel, icon,
		groups: groupPeople(people),
	});
}

/**
 * Ask which person on the map to draw a line to.
 *
 * The button names the person once one is picked, and names the act it is about to start rather
 * than the press: this window does not draw the line, it hands on to the editor that asks what the
 * line says, and "Draw a line to Maeve" is the promise that window keeps.
 */
export function pickPersonToLink({ from = "", options = [] } = {}) {
	return pickPersonOnMap({
		options,
		title: from
			? format("stonetop.relmap.linkFromTitle", { name: from })
			: localize("stonetop.relmap.linkPickTitle"),
		icon: "fa-pen-nib",
		formatLabel: name => format("stonetop.relmap.linkToNamed", { name }),
	});
}

/**
 * Ask who goes on the map.
 *
 * Its own function beside the one above rather than a flag on it: the two questions are asked of
 * different lists (everybody in the world, against everybody already on this board) and answered
 * with different words, and a shared one that told them apart by which arguments were missing was
 * how the add flow came to press a button that said "Add" over a list of people to draw lines to.
 */
export function pickPersonToAdd({ options = [] } = {}) {
	return pickPersonOnMap({
		options,
		title: localize("stonetop.relmap.addTitle"),
		buttonLabel: localize("stonetop.relmap.choose"),
		icon: "fa-user-plus",
		formatLabel: name => format("stonetop.relmap.addNamed", { name }),
	});
}
