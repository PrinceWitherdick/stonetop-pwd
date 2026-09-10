// WHERE AN ENTRY HAPPENED, offered rather than imposed.
//
// The place on a timeline entry is FREE TEXT, and that is the decision this file serves rather than
// works around. A party names places the book never did -- the ford where Kefta drowned, the burnt
// steading, "the hollow" -- and a picker of the world's known locations would refuse every one of
// them. So the field is an input with a datalist behind it: type anything, and the places this
// world already knows autocomplete.
//
// Two sources, and no more. The steading's own lettered places are what the table says most often,
// and the settlements roster is the gazetteer's own list of somewhere to travel to. Sites and
// bestiary entries were considered and left out: a site is GM prep that players cannot see, and
// offering its name in a player's own datalist leaks it.

import { steadingPlaces } from "../utils/places-chronicle.js";
import { SETTLEMENTS } from "../data/settlements.js";

/**
 * Merge the sources into one offered list: named, deduped case-insensitively, and in the order the
 * sources were given so the steading's own places lead.
 *
 * Pure, so the ordering and the de-duplication are testable without a world.
 *
 * @param {...Array<string>} lists
 * @returns {string[]}
 */
export function mergePlaceNames(...lists) {
	const seen = new Set();
	const out = [];
	for (const list of lists) {
		for (const raw of list ?? []) {
			const name = String(raw ?? "").trim();
			if (!name) continue;
			const key = name.toLocaleLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(name);
		}
	}
	return out;
}

/**
 * Every place name this world can offer, for the entry dialog's datalist.
 *
 * Reads the steading live rather than caching: the lettered places are edited on the steading sheet
 * and a stale list is worse than no list, because a name that has just been typed into the sheet is
 * exactly the one somebody is about to want here.
 */
export function placeSuggestions() {
	const lettered = steadingPlaces().map(p => p.name);
	const settlements = (SETTLEMENTS ?? []).map(s => s.name);
	return mergePlaceNames(lettered, settlements);
}
