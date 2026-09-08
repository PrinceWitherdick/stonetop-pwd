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
//
// SOME QUESTIONS TAKE MORE THAN ONE ANSWER (`multiple`), and "who goes on the map" is the first of
// them: a table setting a board up is putting a household on it, not a person, and asking that
// question once per name meant reopening this window, re-finding the list and re-typing into the
// find box for every one of them. Ticking is the only difference the reader sees — the rail, the
// find box and Enter all work as they do above — plus two things the single question does not need:
//  • THE PICKS ARE ON SCREEN, as a row of names under the find box, each one a press away from
//    being unticked. Picks survive moving between lists, which for one pick the button's own label
//    covers; for six of them spread over three lists, nothing else would say who is going.
//  • ENTER TICKS AND CLEARS THE FIND BOX rather than moving to the button, so the next name can be
//    typed straight after the last. It still adds nobody: the confirm is its own press, on a
//    button that by then says how many people it is about.
//  • A TICK-ALL AT THE TOP OF EACH LIST, which is about what the list is SHOWING rather than what
//    it holds: with the find box, "everyone from Marshedge" is two keystrokes and one press
//    instead of six. Per list and not per window, because a board is set up one household or one
//    village at a time, and it reads back as well as sets — part of a list ticked leaves it
//    part-way rather than claiming everyone is going.

import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { applyGuideRail } from "../utils/guide-rail.js";
import { format, localize } from "../utils/i18n.js";

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
	 * @param {boolean} [p.multiple]   take more than one answer; settles on an array of ids.
	 * @param {Function|null} [p.formatManyLabel]  `(count) => string`, what the button says once
	 *                                 several are picked. Only reached when `multiple`.
	 */
	constructor({
		title = "", groups = [], buttonLabel = "", formatLabel = null, icon = "", hint = "",
		multiple = false, formatManyLabel = null,
	} = {}, options = {}) {
		// The title arrives as text rather than as a key (each caller phrases its own question, and
		// some of them put a name in it). AppV1 runs `this.options.title` through `localize`, which
		// hands back anything that is not a key unchanged, so passing it through options is safe and
		// saves overriding the getter.
		super({ ...options, title });
		this._groups = groups;
		this._buttonLabel = buttonLabel || localize("stonetop.people.choose");
		this._formatLabel = typeof formatLabel === "function" ? formatLabel : null;
		this._formatManyLabel = typeof formatManyLabel === "function" ? formatManyLabel : null;
		this._multiple = !!multiple;
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
			multiple: this._multiple,
			// One name each or as many as the reader ticks. The NAME stays `person` either way, so
			// every selector in here reads one control whichever question is being asked; what the
			// type decides is whether ticking a second row unticks the first.
			inputType: this._multiple ? "checkbox" : "radio",
			// Skinned apart, so the class follows the type: the checkbox is on the system's SVG
			// master block in stonetop.css and the radio is pinned to slate beside it.
			inputClass: this._multiple ? "stonetop-person-picker-check" : "stonetop-person-picker-radio",
			chosenLabel: localize("stonetop.people.chosen"),
			selectAllLabel: localize("stonetop.people.selectAll"),
			selectAllHint: localize("stonetop.people.selectAllHint"),
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
		root.querySelectorAll("input[name='person']").forEach(box => {
			box.addEventListener("change", () => this._syncChoice(root));
		});
		// "Select all", one per list. Only rendered on the several-answers question.
		root.querySelectorAll(".stonetop-person-picker-all-check").forEach(box => {
			box.addEventListener("change", () => this._toggleAll(root, box.dataset.allFor, box.checked));
		});
		// A double click on a name is "that one", which is how a reader answers a list of names
		// when nobody has taught them otherwise. The label's own click has already checked the
		// radio by the time this runs, so there is nothing to select first.
		//
		// ⚠ ONE ANSWER ONLY. On a question taking several, a double press is two ticks — the second
		// undoing the first — and confirming on it would settle the window with that person left
		// off, which is the opposite of what the gesture means anywhere else.
		if (!this._multiple) {
			root.querySelectorAll(".stonetop-person-picker-row").forEach(row => {
				row.addEventListener("dblclick", () => this._choose(root));
			});
		}
		// The picks under the find box. Delegated, because the chips are rebuilt on every tick.
		root.querySelector(".stonetop-person-picker-chosen-list")?.addEventListener("click", ev => {
			const chip = ev.target?.closest?.("[data-unpick]");
			if (chip) this._unpick(root, chip.dataset.unpick);
		});
		root.querySelectorAll("[data-person-picker]").forEach(button => {
			button.addEventListener("click", () => this._onButton(button.dataset.personPicker, root));
		});

		const find = root.querySelector(".stonetop-person-picker-find-input");
		find?.addEventListener("input", () => this._applyFilter(root));
		// ⚠ ENTER PICKS BUT DOES NOT ADD. It marks the first name still showing and moves the focus
		// onto the confirm button, so the second Enter is pressed on a button that says who it is
		// about. Confirming outright would let three quick keystrokes put the wrong person on the
		// map without their name ever having been on screen. On a question taking several answers
		// it stays in the find box and empties it instead, so the next name follows the last.
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
		// The tick-all box speaks about what is SHOWING, so narrowing the list is a thing it has
		// to answer to: "everyone" over four names is a different offer than it was over forty.
		this._syncAll(root);
	}

	/** The rows a list is showing, as their controls. What "Select all" is about. */
	_shownBoxes(section) {
		return [...(section.querySelectorAll(".stonetop-person-picker-item") ?? [])]
			.filter(item => !item.hidden)
			.map(item => item.querySelector("input[name='person']"))
			.filter(Boolean);
	}

	/**
	 * Tick or untick every name one list is showing.
	 *
	 * ⚠ SHOWING, NOT HOLDING, and only this list. A find box that has narrowed Residents to the
	 * three people from one household is how the reader says which three, and a tick-all that
	 * reached past it — or across into the lists they are not looking at — would put names on the
	 * board that were never on screen, which is the thing the chip strip and the button's own label
	 * were both written to prevent.
	 */
	_toggleAll(root, key, on) {
		const section = [...(root.querySelectorAll(".stonetop-person-picker-group") ?? [])]
			.find(part => part.dataset?.group === key);
		if (!section) return;
		for (const box of this._shownBoxes(section)) box.checked = !!on;
		this._syncChoice(root);
	}

	/**
	 * Put back into each tick-all box what its list actually says.
	 *
	 * IT IS A READOUT AS WELL AS A CONTROL, which is why this runs on every tick and every
	 * keystroke and not only when the box itself is pressed: a reader who ticks four of six names
	 * by hand, or narrows a list they had ticked whole, must not be left looking at a box claiming
	 * everyone is going. Part-way is `indeterminate` — the master block paints its own bar for it,
	 * since `appearance: none` hides the browser's.
	 */
	_syncAll(root) {
		for (const section of root.querySelectorAll(".stonetop-person-picker-group") ?? []) {
			const all = section.querySelector(".stonetop-person-picker-all-check");
			if (!all) continue;
			const boxes = this._shownBoxes(section);
			const ticked = boxes.filter(box => box.checked).length;
			all.checked = boxes.length > 0 && ticked === boxes.length;
			all.indeterminate = ticked > 0 && ticked < boxes.length;
			// A list narrowed to nobody has nothing to offer, and a live box over it would tick
			// nothing while looking like it had.
			all.disabled = boxes.length === 0;
		}
	}

	/** Mark the first name still showing on the list in front of the reader, and offer the button. */
	_takeFirstMatch(root) {
		const showing = this._visibleGroup(root);
		const first = showing?.querySelector(".stonetop-person-picker-item:not([hidden]) input[name='person']");
		if (!first) return;
		first.checked = true;
		this._syncChoice(root);
		if (!this._multiple) {
			root.querySelector("[data-person-picker='choose']")?.focus();
			return;
		}
		// Cleared and left focused: the reader is part way through a list of names, and a find box
		// still holding the last one is a box they have to empty by hand before typing the next.
		// The name just ticked is on screen as a chip, so nothing about it is lost by clearing.
		const find = root.querySelector(".stonetop-person-picker-find-input");
		if (!find) return;
		find.value = "";
		this._applyFilter(root);
		find.focus?.();
	}

	/** The list on screen. `hidden` is what the rail toggles, so it is what this reads. */
	_visibleGroup(root) {
		return root.querySelector(".stonetop-person-picker-group:not([hidden])");
	}

	/**
	 * Who is ticked, in the order the lists are drawn in.
	 *
	 * ONE ROUTE for both questions, so nothing downstream has to know which was asked. A radio
	 * group answers `:checked` with the one row that is picked; a column of checkboxes answers with
	 * every one, wherever their list is and whether or not the find box is hiding it — a name
	 * narrowed off the screen is still a name the reader ticked.
	 */
	_picked(root) {
		if (!this._multiple) {
			const one = root.querySelector("input[name='person']:checked");
			return one ? [one.value] : [];
		}
		return [...(root.querySelectorAll("input[name='person']:checked") ?? [])].map(box => box.value);
	}

	/** What the button says about what is ticked: nothing, a name, or how many. */
	_chooseLabel(picked) {
		if (!picked.length) return this._buttonLabel;
		if (picked.length === 1) {
			const name = this._names.get(picked[0]);
			return name && this._formatLabel ? this._formatLabel(name) : this._buttonLabel;
		}
		return this._formatManyLabel
			? this._formatManyLabel(picked.length)
			: format("stonetop.people.chosenCount", { count: picked.length });
	}

	/** Put the pick in the button: whether it can be pressed, and whose name is on it. */
	_syncChoice(root) {
		const picked = this._picked(root);
		const button = root.querySelector("[data-person-picker='choose']");
		if (button) {
			button.disabled = !picked.length;
			const slot = button.querySelector(".stonetop-person-picker-choose-label");
			if (slot) slot.textContent = this._chooseLabel(picked);
		}
		this._paintChosen(root, picked);
		this._syncAll(root);
	}

	/**
	 * The picks, spelled out under the find box.
	 *
	 * WHY A LIST OF NAMES AND NOT A NUMBER. A pick survives moving between lists and survives the
	 * find box hiding its row, which is the whole point of both — and it means that by the fourth
	 * name, every row the reader ticked can be off screen. "Add 4 people" over a list showing none
	 * of them is the window deciding four things in secret, which is the same complaint the button's
	 * own label was written to answer. Each chip unticks its person, so the list is a correction as
	 * well as a receipt.
	 *
	 * Nothing at all on the one-answer question: the button names that person already.
	 */
	_paintChosen(root, picked) {
		const box = root.querySelector(".stonetop-person-picker-chosen");
		const list = root.querySelector(".stonetop-person-picker-chosen-list");
		if (!box || !list) return;
		box.hidden = !picked.length;
		list.replaceChildren(...picked.map(id => {
			const name = this._names.get(id) ?? "";
			const drop = format("stonetop.people.unpick", { name });
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "stonetop-person-picker-chip";
			chip.dataset.unpick = id;
			chip.dataset.tooltip = drop;
			chip.setAttribute("aria-label", drop);
			const text = document.createElement("span");
			text.className = "stonetop-person-picker-chip-name";
			text.textContent = name;
			const glyph = document.createElement("i");
			glyph.className = "fas fa-xmark";
			glyph.setAttribute("aria-hidden", "true");
			chip.append(text, glyph);
			const item = document.createElement("li");
			item.append(chip);
			return item;
		}));
	}

	/** Take one person back off the picks, from their chip. */
	_unpick(root, id) {
		const box = root.querySelector(`input[name='person'][value="${id}"]`);
		if (!box) return;
		box.checked = false;
		this._syncChoice(root);
	}

	_onButton(action, root) {
		if (action !== "choose") return this._resolveWith(null);
		return this._choose(root);
	}

	/** Settle on whoever is picked. Nobody picked is not an answer, so it does nothing. */
	_choose(root) {
		const picked = this._picked(root);
		if (!picked.length) return;
		this._resolveWith(this._multiple ? picked : picked[0]);
	}
}

/**
 * Ask which person, off a rail of lists.
 *
 * Resolves to the chosen id — or, when `multiple`, to an ARRAY of them in list order — and to null
 * when the reader backed out, which every exit does (Cancel, Escape and the X all settle through
 * StonetopDialog), so a caller is never left awaiting. Null and not an empty array on either
 * question: "never mind" is a thing a caller may want to tell apart from an answer, and a window
 * that cannot be confirmed with nobody ticked will never hand one back. A call with nobody to offer
 * resolves to null rather than opening an empty window.
 */
export function pickPerson({
	title = "", groups = [], buttonLabel = "", formatLabel = null, icon = "", hint = "",
	multiple = false, formatManyLabel = null,
} = {}) {
	if (!groups.some(group => group.people?.length)) return Promise.resolve(null);
	return new PersonPickerDialog({
		title, groups, buttonLabel, formatLabel, icon, hint, multiple, formatManyLabel,
	}).promise();
}
