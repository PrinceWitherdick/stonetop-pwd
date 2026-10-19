// A follower's conditions: tags that come and go, apart from the ones they were built with.
//
// DEBILITIES ON FOLLOWERS (Book I p.243): "If you want, assign a debility to a follower as a temporary tag
// (weakened, dazed, or miserable), imposing disadvantage". So a follower carries the three as conditions:
// drawn among their tags with a remove button of their own, outside edit mode too, and offered to Order
// Followers already marked as in the way (p.462: "roll with disadvantage if any of their tags would get in
// the way"), the table still free to say otherwise. Loyal to the End's "injured" on the animal companion
// (companion-bond.js) is the same kind of tag, and its store is the companion's: one list per follower.
//
// Where: the companion's at its old flag (companion-bond.js#COMPANION_CONDITIONS_FLAG), everyone else's
// beside their card's details (follower-roster.js#FOLLOWER_FLAGS `detailBase`), as an array.

import { STONETOP_SCOPE, readableFlags } from "./StonetopFlags.js";
import { COMPANION_CONDITIONS_FLAG } from "./companion-bond.js";
import { followerDetailBase } from "./follower-roster.js";

/** The temporary debilities a follower can be given (p.243), in the book's order. */
export const FOLLOWER_DEBILITIES = Object.freeze(["weakened", "dazed", "miserable"]);

/** Where a follower's conditions are stored, or null for no such follower type. PURE. */
export function followerConditionsPath(ftype, slug = "") {
	if (ftype === "animal-companion") return COMPANION_CONDITIONS_FLAG;
	const base = followerDetailBase(ftype, slug);
	return base ? `${base}.conditions` : null;
}

/** A follower's conditions, each once, off resolved flags. PURE. */
export function followerConditions(flags, ftype, slug = "") {
	const path = followerConditionsPath(ftype, slug);
	const raw = path ? foundry.utils.getProperty(flags, path) : null;
	return [...new Set((Array.isArray(raw) ? raw : []).map(t => String(t ?? "").trim()).filter(Boolean))];
}

/** Add `tag` to a follower's conditions. Answers whether it was added (false: already there). */
export async function addFollowerCondition(actor, ftype, slug, tag) {
	const path = followerConditionsPath(ftype, slug);
	const label = String(tag ?? "").trim();
	const list = followerConditions(readableFlags(actor), ftype, slug);
	if (!path || !label || list.includes(label)) return false;
	await actor.setFlag(STONETOP_SCOPE, path, [...list, label]);
	return true;
}

/** Take `tag` off a follower's conditions. Answers whether it was there. */
export async function removeFollowerCondition(actor, ftype, slug, tag) {
	const path = followerConditionsPath(ftype, slug);
	const list = followerConditions(readableFlags(actor), ftype, slug);
	if (!path || !list.includes(tag)) return false;
	await actor.setFlag(STONETOP_SCOPE, path, list.filter(t => t !== tag));
	return true;
}

/** Toggle one of the debilities. Answers whether it is now held. */
export async function toggleFollowerCondition(actor, ftype, slug, tag) {
	if (await removeFollowerCondition(actor, ftype, slug, tag)) return false;
	return addFollowerCondition(actor, ftype, slug, tag);
}
