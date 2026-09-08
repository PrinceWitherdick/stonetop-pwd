// Everybody in a world, sorted into the lists this table already thinks in: the player
// characters, the people of Stonetop, and the people whose home is somewhere else.
//
// WHY THIS IS SHARED AND NOT A LINE IN THE ONE CHOOSER THAT NEEDED IT. "Players / Residents /
// Neighbors" is not a grouping invented for a picker; it is how the steading sheet lists the
// village, how the Add Member worksheet asks, and how the two people folders are named. A window
// that bucketed by its own rule would be a second opinion about who counts as a neighbour, and the
// two would drift the first time somebody's Home was typed in.
//
// ⚠ IT ASKS THREE THINGS IN ORDER, AND THE ORDER IS THE POINT.
//  1. The steading's own rosters. Somebody filed on the Residents or Neighbors list IS one, whatever
//     their sheet says, because that list is the answer a person at this table gave on purpose.
//  2. The people folder they live in. A row can be taken off the sheet while the NPC stays, and a
//     person's folder is what filed them there in the first place (see createPersonNpc).
//  3. Their Home. A blank Home is the village itself, which is the rule the field is WRITTEN under
//     (see npcHome / HOME_STONETOP) rather than a guess made here.
//
// A person who answers none of it lands in "Everyone else", which is a real answer: a name on a
// map with no sheet behind it, or a monster somebody has been talking to.

import {
	HOME_STONETOP, npcHome, personFolderList, personListIndex,
} from "../actors/steading/steading-people.js";
import { playbookTitle } from "./playbook-actors.js";
import { localize } from "./i18n.js";

/** The lists, in the order a rail should offer them. */
export const PEOPLE_GROUP_PLAYERS = "players";
export const PEOPLE_GROUP_RESIDENTS = "residents";
export const PEOPLE_GROUP_NEIGHBORS = "neighbors";
export const PEOPLE_GROUP_OTHERS = "others";

export const PEOPLE_GROUPS = [
	PEOPLE_GROUP_PLAYERS, PEOPLE_GROUP_RESIDENTS, PEOPLE_GROUP_NEIGHBORS, PEOPLE_GROUP_OTHERS,
];

// One glyph each, and each one is the thing itself rather than a category: a crowd for the table,
// a roof for the village, a signpost for the road somebody came in on.
const GROUP_ICONS = {
	[PEOPLE_GROUP_PLAYERS]:   "fa-users",
	[PEOPLE_GROUP_RESIDENTS]: "fa-house-chimney",
	[PEOPLE_GROUP_NEIGHBORS]: "fa-signs-post",
	[PEOPLE_GROUP_OTHERS]:    "fa-user",
};

/**
 * Which list one person belongs on.
 *
 * @param {Actor|null} actor    the live actor, or null for somebody with no sheet at all.
 * @param {Map<string,string>|null} [rosters]  actor id -> roster, from `personListIndex`. Optional
 *        so this can be asked about a single person; a caller sorting a whole world hands one in
 *        rather than making every call re-read the steading.
 * @returns {string}  one of PEOPLE_GROUPS.
 */
export function peopleGroupOf(actor, rosters = null) {
	if (!actor) return PEOPLE_GROUP_OTHERS;
	if (actor.type === "character") return PEOPLE_GROUP_PLAYERS;
	if (actor.type !== "npc") return PEOPLE_GROUP_OTHERS;
	const filed = rosters?.get?.(actor.id) || personFolderList(actor);
	if (filed) return filed;
	return npcHome(actor) === HOME_STONETOP ? PEOPLE_GROUP_RESIDENTS : PEOPLE_GROUP_NEIGHBORS;
}

/**
 * Who somebody is, in the few words a list of names has room for.
 *
 * WHY A LIST OF PEOPLE NEEDS ONE AT ALL. A village names its children after each other: "Maelis"
 * and "Maeve" and "Maeve the Elder" are three rows a reader cannot tell apart from the names, and
 * the answer they are actually looking for is "the smith" or "the one from Marshedge". It is the
 * same line the steading roster's own columns carry, said in one breath.
 *
 * A home is only worth saying when it is NOT the village: on the Residents list every line would
 * otherwise end in "Stonetop", which is the one thing the list already told them.
 */
export function personNote(actor) {
	if (!actor) return "";
	if (actor.type === "character") return playbookTitle(actor);
	if (actor.type !== "npc") return "";
	const occupation = String(actor.system?.occupation ?? "").trim();
	const home = npcHome(actor);
	const elsewhere = home === HOME_STONETOP ? "" : home;
	return [occupation, elsewhere].filter(Boolean).join(", ");
}

/**
 * Sort people into their lists, dropping the lists nobody is on.
 *
 * EMPTY LISTS ARE NOT RENDERED. A rail offering "Neighbors (0)" on a world that has never left the
 * village is a tab that can only disappoint, and the reader has no way to tell it from a list whose
 * contents are simply filtered out of sight.
 *
 * Each person keeps whatever fields they arrived with (a portrait, a note, the id the caller means
 * to get back); only `actor` is read here, and only to decide the bucket.
 *
 * @param {Array<{id: string, name: string, actor?: Actor|null}>} people
 * @param {object} [options]
 * @param {Actor|null} [options.steading]  whose rosters to consult; the world's by default.
 * @returns {Array<{key: string, label: string, hint: string, icon: string, people: Array}>}
 */
export function groupPeople(people, { steading = null } = {}) {
	const rosters = personListIndex(steading);
	const buckets = new Map(PEOPLE_GROUPS.map(key => [key, []]));
	for (const person of people ?? []) {
		buckets.get(peopleGroupOf(person?.actor ?? null, rosters)).push(person);
	}
	return PEOPLE_GROUPS
		.filter(key => buckets.get(key).length)
		.map(key => ({
			key,
			label: localize(`stonetop.people.groups.${key}`),
			hint: localize(`stonetop.people.groupHints.${key}`),
			icon: GROUP_ICONS[key],
			// By name, then by id: two people can share a name, and a list whose order depends on
			// the order the world happens to hold its actors in is a list you have to read all of.
			people: [...buckets.get(key)].sort(byName),
		}));
}

const byName = (a, b) => {
	const an = String(a?.name ?? "");
	const bn = String(b?.name ?? "");
	return an === bn
		? String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
		: an.localeCompare(bn);
};
