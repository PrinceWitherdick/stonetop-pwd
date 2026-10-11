// WHO TRAVELS WITH THE PARTY: the one reading of a follower's "in the party" toggle, for every kind
// of follower card (the user's ruling of 2026-10-02).
//
// Make Camp feeds "each member of the party" (Book I p.79), and a follower fed at the fire regains HP
// like a PC (p.240). Custom followers have long carried a `party` toggle; the built-in cards (the
// animal companion, the crew, initiates, beasts) now carry the same one. Unset, it reads as each
// kind's default: an animal companion and a crew go where their PC goes, initiates and beasts stay
// home unless ticked. Ticking or unticking stores an explicit boolean beside that type's other flags.
//
// Everything that asks "is this follower with the party?" asks here: the Followers tab's card (and so
// the Struggle as One setup, which reads the card), and, through follower-roster.js's records rather
// than the sheet's cards, the camp's mouths and its heal and the expedition's load rows.

import { readableFlags } from "./StonetopFlags.js";
import { customGroupPresent, groupFollowerMembers } from "../../utils/crew.js";

/** Each follower kind's answer while its toggle has never been touched. */
export const FOLLOWER_PARTY_DEFAULTS = Object.freeze({
	"animal-companion": true,
	"crew":             true,
	"initiate":         false,
	"beast":            false,
	"custom":           false,
});

/** Where a follower's toggle is stored, under the system's flag scope, or null for no such kind. */
export function followerPartyPath(ftype, slug = "") {
	switch (ftype) {
		case "animal-companion": return "animalCompanion.party";
		case "crew":             return "crew.party";
		case "initiate":         return slug ? `initiatesParty.${slug}` : null;
		case "beast":            return slug ? `beastParty.${slug}` : null;
		case "custom":           return slug ? `customFollowers.${slug}.party` : null;
		default:                 return null;
	}
}

/** Whether a follower is with the party, read from the character's resolved flags. PURE. */
export function followerInPartyFlags(flags, ftype, slug = "") {
	const path = followerPartyPath(ftype, slug);
	if (!path) return false;
	const stored = foundry.utils.getProperty(flags ?? {}, path);
	return typeof stored === "boolean" ? stored : !!FOLLOWER_PARTY_DEFAULTS[ftype];
}

/** Whether a follower of `actor` is with the party. */
export function followerInParty(actor, ftype, slug = "") {
	return followerInPartyFlags(readableFlags(actor), ftype, slug);
}

// FOLLOWS THE PARTY AS A WHOLE is a DIFFERENT question from travelling with it (wave 3 audit FOL-6, the
// user's ruling of 2026-10-09). Book I p.464: "As a rule, a follower is tied to one PC, and only that PC
// can pay its cost or spend its Loyalty. But if an NPC follows the party as a whole, then any PC can
// generate or spend that follower's Loyalty." A guide who follows only Blodwen still eats at the fire.
// The custom card carried ONE switch labelled with this rule while the camp read it as travel, so the
// two are split: `party` (above) is travel, `wholeParty` is this. Only a custom follower can follow the
// party as a whole; the built-in ones are each their own PC's by playbook or possession.

/** Where a follower's "follows the party as a whole" switch is stored, or null for a kind that has none. */
export function followerWholePartyPath(ftype, slug = "") {
	return ftype === "custom" && slug ? `customFollowers.${slug}.wholeParty` : null;
}

/** Whether a follower follows the party as a whole (any PC may move its Loyalty). PURE. */
export function followsPartyAsWhole(flags, ftype, slug = "") {
	const path = followerWholePartyPath(ftype, slug);
	return !!path && foundry.utils.getProperty(flags ?? {}, path) === true;
}

/**
 * The followers travelling with the party, alive, out of a list of follower records
 * (follower-roster.js#followerRoster) whose `party` was read here. PURE.
 */
export function partyFollowers(followers) {
	return (Array.isArray(followers) ? followers : []).filter(f => f?.ftype && f.party && !f.dead);
}

/**
 * How many mouths one party follower is: the crew is its roster (a member who is only down still
 * eats), a custom group the members still with it (one marked fallen eats nothing), anyone else one.
 * PURE.
 */
export function followerMouths(flags, follower) {
	if (!follower?.ftype || follower.dead) return 0;
	if (follower.ftype === "crew") return groupFollowerMembers(flags, { ftype: "crew" }, { down: true }).length;
	if (follower.ftype === "custom") {
		const record = flags?.customFollowers?.[follower.slug];
		if (record?.isGroup) return customGroupPresent(record).length;
	}
	return 1;
}

/** Every mouth the party followers on `followers` (partyFollowers) add at a camp. PURE. */
export function partyMouths(flags, followers) {
	return (Array.isArray(followers) ? followers : []).reduce((sum, f) => sum + followerMouths(flags, f), 0);
}
