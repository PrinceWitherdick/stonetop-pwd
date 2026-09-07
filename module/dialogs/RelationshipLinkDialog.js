// WHO to draw a line on a relationship map to, and who to put on one.
//
// THE OTHER HALF OF THIS FILE IS GONE. It was the window that asked what a line SAYS: its words,
// its colour, which way it is read, whether it is broken, what family tie it is and the notes
// behind it. Six questions in a modal, opened by a click on a line and again by every line drawn,
// on a board a table draws six lines across while they are talking. Four of the six are on the tie
// bar over the line itself now (utils/relmap-tie-bar.js), rubbing a line out is the last press on
// that bar, and the family tie is the "find family ties" tool -- so the window had nothing left to
// ask that was worth a window. A line is drawn the moment it is released and its bar opens over it;
// see `_createLink` in dialogs/RelationshipMapWindow.js.
//
// What is left is the people pickers, which are a different question and still a real one: choosing
// one face out of a whole village is exactly what a window with a search field is for.

import { pickPerson } from "./PersonPickerDialog.js";
import { groupPeople, personNote } from "../utils/people-groups.js";
import { documentPortraitFrame, portraitOrNone } from "../utils/portrait-frame.js";
import { format, localize } from "../utils/i18n.js";

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
 * The button names the person once one is picked, and names the act rather than the press: the
 * line is drawn the moment this window closes, and "Draw a line to Maeve" is the promise it keeps.
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
