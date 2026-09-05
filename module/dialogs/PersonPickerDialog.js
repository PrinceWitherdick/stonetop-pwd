// "Who goes on the map?": one person, off a list as long as the world is.
//
// WHY IT IS NOT `pickContentOption`, WHICH IS THE SYSTEM'S ONE-OF-N CHOOSER. That window is right
// for a handful of KINDS: four rows, an icon and a sentence each, all of them on screen at once.
// It was answering this question too, and a world with two dozen people in it turned it into a
// single alphabetical column taller than the screen, with the confirm button somewhere below the
// desk. Nothing on screen said where in the village anybody lived, so finding one name meant
// reading all of them.
//
// SO IT IS THE GUIDE RAIL, the same left-rail-and-panel chrome the Welcome guide and the monster
// worksheet wear (`.stonetop-guide-*`), holding the lists this table already thinks in: the
// players, the people of Stonetop, the people from somewhere else. See utils/people-groups.js,
// which decides who goes on which list, and which is shared with the steading sheet's own rosters
// so this window cannot form a second opinion about who counts as a neighbour.
//
// THREE THINGS MAKE IT QUICK, and each of them was a complaint about the list it replaced:
//  • A FIXED HEIGHT with the names scrolling inside it. The window is the size of the window
//    whether the world holds four people or four hundred.
//  • A FIND BOX, which takes the focus the moment the window opens. Typing narrows every list at
//    once and the rail keeps saying how many are left in each, so a name in a list you are not
//    looking at is still visible as a count going up.
//  • THE BUTTON NAMES THE PERSON. "Add Aerin", not "Add" — which matters more here than usual,
//    because a pick made on one list stays picked while you browse another, and a button that
//    still said "Add" would be a window that had quietly decided something for you.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail } from "../utils/guide-rail.js";
import { localize } from "../utils/i18n.js";

// A plain literal, not built from SYSTEM_ID, for the reason RelationshipMapWindow gives: the
// precache map in stonetop.js is checked against the source by finding this PATH in it, and an
// interpolated one appears nowhere for that check to find.
const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/person-picker.hbs";

export class PersonPickerDialog extends StonetopDialog {
	/**
	 * @param {object} p
	 * @param {string} p.title         window title, already localized.
	 * @param {Array} p.groups         the lists, from `groupPeople`; each `{key, label, hint, icon,
	 *                                 people: [{id, name, hint, img, imgStyle}]}`.
	 * @param {string} p.buttonLabel   what the confirm button says before anybody is picked.
	 * @param {Function|null} [p.formatLabel]  `(name) => string`, what it says once somebody is.
	 * @param {string} [p.icon]        the confirm button's glyph.
	 * @param {string} [p.hint]        a line above the list, if the question needs one.
	 */
	constructor({ title = "", groups = [], buttonLabel = "", formatLabel = null, icon = "", hint = "" } = {}, options = {}) {
		// The title arrives as text rather than as a key (each caller phrases its own question, and
		// some of them put a name in it). AppV1 runs `this.options.title` through `localize`, which
		// hands back anything that is not a key unchanged, so passing it through options is safe and
		// saves overriding the getter.
		super({ ...options, title });
		this._groups = groups;
		this._buttonLabel = buttonLabel || localize("stonetop.people.choose");
		this._formatLabel = typeof formatLabel === "function" ? formatLabel : null;
		this._icon = icon || "fa-check";
		this._hint = hint;
		// Which list is showing. Switched in the DOM and never by re-rendering, so a typed filter
		// and a pick already made survive moving between lists.
		this._group = groups[0]?.key ?? "";
		// id -> name, for the button's label. Read from here rather than out of the row's markup:
		// the pick that button is about may be on a list that is not on screen.
		this._names = new Map(groups.flatMap(g => (g.people ?? []).map(p => [p.id, p.name])));
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-person-picker",
			classes: ["stonetop", "stonetop-person-picker-app"],
			template: TEMPLATE,
			width: 520,
			// A HEIGHT, DELIBERATELY, and not `auto`. This window is a list of everybody, so
			// content-sizing it means a window as tall as the world is populous: the one this
			// replaced opened at 1300px on a village of two dozen, with its own confirm button off
			// the bottom of the screen. Resizable, so a reader who wants more of it can have it.
			height: 520,
			resizable: true,
			scrollY: [".stonetop-person-picker-body"],
		});
	}

	getData() {
		return {
			hint: this._hint,
			// One list needs no rail: a column of tabs with a single tab in it is chrome that
			// cannot be used, and it costs the names 168px of the window they are read in.
			single: this._groups.length < 2,
			findLabel: localize("stonetop.people.find"),
			findAria: localize("stonetop.people.findAria"),
			listsAria: localize("stonetop.people.listsAria"),
			noMatches: localize("stonetop.people.noMatches"),
			chooseLabel: this._buttonLabel,
			chooseIcon: this._icon,
			cancelLabel: localize("stonetop.people.cancel"),
			groups: this._groups.map(group => ({
				key: group.key,
				label: group.label,
				hint: group.hint ?? "",
				icon: group.icon ?? "fa-user",
				count: (group.people ?? []).length,
				selected: group.key === this._group,
				people: (group.people ?? []).map(person => ({
					id: person.id,
					name: person.name,
					hint: person.hint ?? "",
					img: person.img ?? "",
					imgStyle: person.imgStyle ?? "",
					// What the find box matches against, folded once here rather than per keystroke
					// per row. The note is searchable too, so "Marshedge" finds everybody from it.
					search: `${person.name ?? ""} ${person.hint ?? ""}`.toLowerCase(),
				})),
			})),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0] ?? html;

		root.querySelectorAll(".stonetop-person-picker-tab").forEach(tab => {
			tab.addEventListener("click", () => this._showGroup(tab.dataset.group));
		});
		root.querySelectorAll("input[name='person']").forEach(radio => {
			radio.addEventListener("change", () => this._syncChoice(root));
		});
		// A double click on a name is "that one", which is how a reader answers a list of names
		// when nobody has taught them otherwise. The label's own click has already checked the
		// radio by the time this runs, so there is nothing to select first.
		root.querySelectorAll(".stonetop-person-picker-row").forEach(row => {
			row.addEventListener("dblclick", () => this._choose(root));
		});
		root.querySelectorAll("[data-person-picker]").forEach(button => {
			button.addEventListener("click", () => this._onButton(button.dataset.personPicker, root));
		});

		const find = root.querySelector(".stonetop-person-picker-find-input");
		find?.addEventListener("input", () => this._applyFilter(root));
		// ⚠ ENTER PICKS BUT DOES NOT ADD. It marks the first name still showing and moves the focus
		// onto the confirm button, so the second Enter is pressed on a button that says who it is
		// about. Confirming outright would let three quick keystrokes put the wrong person on the
		// map without their name ever having been on screen.
		find?.addEventListener("keydown", ev => {
			if (ev.key !== "Enter") return;
			ev.preventDefault();
			this._takeFirstMatch(root);
		});

		this._syncChoice(root);
		// The find box, not the list: this window opens on a question whose answer is a name, and
		// typing it is faster than reading for it however short the list turns out to be.
		find?.focus();
	}

	/** Show one list and light its rail entry. Purely DOM, so nothing on screen is thrown away. */
	_showGroup(key) {
		if (!this._groups.some(group => group.key === key)) return;
		this._group = key;
		const root = this.element?.[0];
		if (!root) return;
		applyGuideRail(root, {
			key, dataKey: "group",
			tabSelector: ".stonetop-person-picker-tab",
			sectionSelector: ".stonetop-person-picker-group",
			mainSelector: ".stonetop-person-picker-body",
		});
	}

	/**
	 * Narrow every list to what was typed, and say on the rail how many each has left.
	 *
	 * EVERY LIST AND NOT THE ONE SHOWING, which is the whole reason the counts are on the rail: a
	 * reader looking for Maeve under Residents can see that the one Maeve in this world is a
	 * neighbour without having to go and check each list by hand.
	 */
	_applyFilter(root) {
		const text = (root.querySelector(".stonetop-person-picker-find-input")?.value ?? "")
			.trim().toLowerCase();
		for (const section of root.querySelectorAll(".stonetop-person-picker-group")) {
			let showing = 0;
			for (const item of section.querySelectorAll(".stonetop-person-picker-item")) {
				const match = !text || (item.dataset.search ?? "").includes(text);
				item.hidden = !match;
				if (match) showing++;
			}
			const none = section.querySelector(".stonetop-person-picker-none");
			if (none) none.hidden = showing > 0;
			const count = root.querySelector(`[data-count-for="${section.dataset.group}"]`);
			if (count) count.textContent = String(showing);
		}
	}

	/** Mark the first name still showing on the list in front of the reader, and offer the button. */
	_takeFirstMatch(root) {
		const showing = this._visibleGroup(root);
		const first = showing?.querySelector(".stonetop-person-picker-item:not([hidden]) input[name='person']");
		if (!first) return;
		first.checked = true;
		this._syncChoice(root);
		root.querySelector("[data-person-picker='choose']")?.focus();
	}

	/** The list on screen. `hidden` is what the rail toggles, so it is what this reads. */
	_visibleGroup(root) {
		return root.querySelector(".stonetop-person-picker-group:not([hidden])");
	}

	/** Put the pick in the button: whether it can be pressed, and whose name is on it. */
	_syncChoice(root) {
		const chosen = root.querySelector("input[name='person']:checked");
		const button = root.querySelector("[data-person-picker='choose']");
		if (!button) return;
		button.disabled = !chosen;
		const name = chosen ? this._names.get(chosen.value) : "";
		const label = name && this._formatLabel ? this._formatLabel(name) : this._buttonLabel;
		const slot = button.querySelector(".stonetop-person-picker-choose-label");
		if (slot) slot.textContent = label;
	}

	_onButton(action, root) {
		if (action !== "choose") return this._resolveWith(null);
		return this._choose(root);
	}

	/** Settle on whoever is picked. Nobody picked is not an answer, so it does nothing. */
	_choose(root) {
		const chosen = root.querySelector("input[name='person']:checked");
		if (!chosen) return;
		this._resolveWith(chosen.value);
	}
}

/**
 * Ask which person, off a rail of lists.
 *
 * Resolves to the chosen id, or to null when the reader backed out, which every exit does
 * (Cancel, Escape and the X all settle through StonetopDialog), so a caller is never left
 * awaiting. A call with nobody to offer resolves to null rather than opening an empty window.
 */
export function pickPerson({ title = "", groups = [], buttonLabel = "", formatLabel = null, icon = "", hint = "" } = {}) {
	if (!groups.some(group => group.people?.length)) return Promise.resolve(null);
	return new PersonPickerDialog({ title, groups, buttonLabel, formatLabel, icon, hint }).promise();
}
