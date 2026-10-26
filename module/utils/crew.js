// Group-follower roster arithmetic: how many bodies a crew has, and how many of them are still
// anonymous. Shared because three places have to agree about it — the sheet that draws the roster,
// the Expedition outfit readout, and the portrait store that has to refuse a write aimed past the
// end of the roster (actors/character/roster-portraits.js).

// Does a character's crew meaningfully exist? True when any defining field is set — a name,
// tags, an instinct, a cost, or at least one named individual. Shared by the sheet's follower
// panel and the Expedition outfit readout so the "is there a crew" question is asked one way.
export function crewExists(crew) {
	return !!(crew && (crew.name || crew.tags?.length || crew.instinct || crew.cost || crew.individuals?.length));
}

/**
 * The tag a character's background gives their crew, or null. The Marshal's alone: the Crew insert
 * says "a tag granted by your background" to the Marshal, so a crew borrowed through a learned Crew
 * (StonetopCharacter#crewSource) gets none, whatever its keeper's background is called.
 *
 * @param {object|null} playbookDoc     the character's OWN playbook
 * @param {object|null} crewDef         the Crew insert the crew is drawn from
 * @param {string}      backgroundSlug  the active background
 */
export function crewBackgroundTag(playbookDoc, crewDef, backgroundSlug) {
	if (!playbookDoc?.crew) return null;
	return (crewDef ?? playbookDoc.crew)?.backgroundTags?.[backgroundSlug ?? ""] ?? null;
}

/**
 * How many tags an existing crew is still owed: the insert's picks (2) plus Veteran Crew's "Select 2
 * new tags" (`tagBonus`), less the tags chosen. The background's tag and "group" are never picks.
 * 0 for a crew never set up (the "Create your crew" offer asks for those) or with nothing owed.
 *
 * @param {object|null} crew      the stored crew (flags crew)
 * @param {object|null} crewDef   the Crew insert the crew is drawn from
 * @param {number}      tagBonus  Veteran Crew's extra tag picks
 * @param {string|null} bgTag     the background's tag (crewBackgroundTag)
 */
export function crewTagsOwed(crew, crewDef, tagBonus = 0, bgTag = null) {
	if (!crewDef || !crewExists(crew)) return 0;
	const base = Number.isFinite(crewDef.additionalTagCount) ? crewDef.additionalTagCount : 2;
	const limit = base + Math.max(0, Number(tagBonus) || 0);
	const chosen = (crew.tags ?? []).filter(t => t && t !== bgTag && String(t).toLowerCase() !== "group").length;
	return Math.max(0, limit - chosen);
}

// Hard cap on crew headcount, so a fat-fingered roster size can't build a
// thousand-member anonymous list (and a thousand-die group HP pool).
export const CREW_SIZE_MAX = 99;

/**
 * The crew's real headcount: the stored size, defaulting to the rulebook's half-dozen when unset,
 * and never fewer than the members who have been named. An explicit 0 is honoured, so emptying the
 * roster doesn't spring back to six.
 */
export function effectiveCrewSize(rawSize, namedCount) {
	// `rawSize == null` first, because Number(null) is 0 — so a null size would have read as a
	// deliberate "this crew has nobody in it" and silently emptied the roster, where it means the
	// same thing an absent one does. An explicit 0 still gets through and is still honoured.
	const n = rawSize == null ? NaN : Number(rawSize);
	const base = Number.isFinite(n) ? Math.max(0, n) : 6;
	return Math.max(namedCount, base);
}

/** How many of the crew are still anonymous — the length of the roster's unnamed tail. */
export function crewAnonymousCount(crew) {
	const named = Array.isArray(crew?.individuals) ? crew.individuals.length : 0;
	return Math.max(0, effectiveCrewSize(crew?.size, named) - named);
}

/**
 * A custom GROUP follower's headcount. Two is both the floor and the default: a group of one is a
 * single follower, which is a different card, so a record with no size stored yet still has two
 * members on the roster. Every member of one of these is anonymous — only the crew names its own.
 */
export function customGroupSize(follower) {
	return Math.max(2, Math.min(CREW_SIZE_MAX, Math.trunc(Number(follower?.size) || 0) || 2));
}

/**
 * Whether a roster slot's stored HP leaves that member standing, on the sheet's own terms
 * (`_clampHp`): nothing stored is full HP, and anything that reads as a number counts at that number.
 */
function memberStanding(raw) {
	return raw == null || !Number.isFinite(Number(raw)) || Number(raw) > 0;
}

/**
 * How many of a group follower's members are still standing, read off the character's flags: the
 * crew (named individuals, then the anonymous tail) or a custom GROUP follower. Null for any other
 * follower, or a custom one that is not a group.
 *
 * @param {object} flags  the character's system flags
 * @param {{ftype: string, slug?: string}} which  the card, as a follower actor's `followerOrigin` names it
 * @returns {{standing: number, size: number}|null}
 */
/** How many of the first `count` HP entries are a member still standing. */
function countStanding(hp, count) {
	let standing = 0;
	for (let i = 0; i < count; i += 1) if (memberStanding(hp[i])) standing += 1;
	return standing;
}

export function groupFollowerStanding(flags, { ftype, slug = "" } = {}) {
	if (ftype === "crew") {
		const crew = flags?.crew;
		if (!crew) return null;
		const named = Array.isArray(crew.individuals) ? crew.individuals.length : 0;
		const size = effectiveCrewSize(crew.size, named);
		const individualsHp = crew.individualsHp ?? {};
		const memberHp = Array.isArray(crew.memberHp) ? crew.memberHp : [];
		return { standing: countStanding(individualsHp, named) + countStanding(memberHp, size - named), size };
	}
	if (ftype === "custom") {
		const follower = flags?.customFollowers?.[slug];
		if (!follower?.isGroup) return null;
		const size = customGroupSize(follower);
		const memberHp = Array.isArray(follower.memberHp) ? follower.memberHp : [];
		// A member marked fallen is down whatever their HP slot says (customMemberFallen).
		let fallen = 0;
		for (let i = 0; i < size; i += 1) if (customMemberFallen(follower, i) && memberStanding(memberHp[i])) fallen += 1;
		return { standing: countStanding(memberHp, size) - fallen, size };
	}
	return null;
}

/**
 * Whether a custom GROUP's member at `index` is marked dead: the fate dialog's "Dead" for a group at its
 * two-member floor, which cannot strike them off the roster (customGroupSize), so they keep their slot
 * at 0 HP with this mark, `customFollowers.<id>.memberDead`, an array parallel to `memberHp` (true for
 * the fallen, null for the rest), written whole as memberHp is. Cleared when the row's HP box is set
 * above 0 by hand (follower-fate.js#followerReviveUpdate); a fallen member is never standing, and a heal
 * does not reach them (Bath of Healing Light, invocation-apply.js).
 */
export function customMemberFallen(follower, index) {
	return Array.isArray(follower?.memberDead) && !!follower.memberDead[Number(index)];
}

/**
 * The roster slots of a custom GROUP's members who are still with it: every member but the ones marked
 * fallen (customMemberFallen). A member at 0 HP is down, not gone, and is still here: they eat at the
 * fire and can be sent to Have What They Need. The indices are the roster's own, so a label made from
 * one (customGroupMemberLabel) names the same row. Empty for a follower that is not a group.
 */
export function customGroupPresent(follower) {
	if (!follower?.isGroup) return [];
	return Array.from({ length: customGroupSize(follower) }, (_, i) => i).filter(i => !customMemberFallen(follower, i));
}

/** A named crew member's own tags: their extra tag and their traits, as the card's own Order button counts them. */
function ownTags(individual) {
	const traits = Array.isArray(individual?.traits) ? individual.traits : [];
	return [individual?.tag, ...traits].map(t => String(t ?? "").trim()).filter(Boolean);
}

/**
 * A group follower's members who are still standing, in roster order, as someone ordering one of them
 * picks them: a key, the name their roster row carries, and the tags that are theirs alone.
 *
 * The book lets a group be split this way: "When a PC directs an individual member of a group, they can
 * trigger moves as if they were a follower themselves. The group's tags and moves apply, plus any unique
 * tags or moves they have as an individual" (Book I p.471). So `tags` here is only the member's OWN; the
 * group's are the caller's to add. A member at 0 HP is out of the action (p.469) and is not offered.
 *
 * Named by the same labellers the roster rows use, so "Crew member 4" here is the row that says so. The
 * character sheet's `_followerMemberNames` walks the same roster for Have What They Need, where a downed
 * member still counts and a fallen one does not (customGroupPresent). `down` lists the members at 0 HP too, in the same order, for a heal that can raise
 * them (Bath of Healing Light, invocation-apply.js).
 *
 * @param {object} flags  the character's system flags
 * @param {{ftype: string, slug?: string}} which  the card
 * @param {{down?: boolean}} [options]
 * @returns {Array<{key: string, name: string, tags: string[], dead?: boolean}>}  empty for anyone but a
 *   group; `dead` on a custom group's member marked fallen (customMemberFallen), listed only with `down`
 */
export function groupFollowerMembers(flags, { ftype, slug = "" } = {}, { down = false } = {}) {
	const members = [];
	const listed = raw => down || memberStanding(raw);
	if (ftype === "crew") {
		const crew = flags?.crew;
		if (!crew) return members;
		const named = Array.isArray(crew.individuals) ? crew.individuals : [];
		const individualsHp = crew.individualsHp ?? {};
		named.forEach((individual, i) => {
			if (!listed(individualsHp[i])) return;
			const name = String(individual?.name ?? "").trim() || crewIndividualLabel(i);
			members.push({ key: `named:${i}`, name, tags: ownTags(individual) });
		});
		const memberHp = Array.isArray(crew.memberHp) ? crew.memberHp : [];
		const anonymous = crewAnonymousCount(crew);
		for (let i = 0; i < anonymous; i += 1) {
			if (listed(memberHp[i])) members.push({ key: `anon:${i}`, name: crewAnonMemberLabel(named.length, i), tags: [] });
		}
		return members;
	}
	if (ftype === "custom") {
		const follower = flags?.customFollowers?.[slug];
		if (!follower?.isGroup) return members;
		const memberHp = Array.isArray(follower.memberHp) ? follower.memberHp : [];
		const size = customGroupSize(follower);
		for (let i = 0; i < size; i += 1) {
			// A member marked fallen is listed only with the down, and says so (`dead`).
			const fallen = customMemberFallen(follower, i);
			if (fallen ? !down : !listed(memberHp[i])) continue;
			members.push({ key: `member:${i}`, name: customGroupMemberLabel(i), tags: [], ...(fallen ? { dead: true } : {}) });
		}
	}
	return members;
}

/**
 * What to call the Nth ANONYMOUS crew member — the unnamed tail that starts where the named
 * individuals stop, so the roster numbers read straight down past them.
 *
 * Lives here, beside the arithmetic it depends on, because the sheet draws this label and the
 * ledger has to recognise it: `utils/ledger-categories.js` files these entries by matching
 * "Crew member" at the head of the string, so the wording is a contract, not a caption.
 */
export function crewAnonMemberLabel(namedCount, index) {
	return `Crew member ${Number(namedCount ?? 0) + Number(index) + 1}`;
}

/**
 * What to call a NAMED individual who has not been given a name yet. They sit inside the named
 * block, so they number from the top of the roster — unlike the anonymous tail above.
 */
export function crewIndividualLabel(index) {
	return `Crew member ${Number(index) + 1}`;
}

/**
 * What to call the Nth member of a custom GROUP follower, every one of whom is anonymous. The
 * roster rows and the Have What They Need picker both print it, and the picker writes it into
 * saved gear ("litter (Member 2)"), so the two must not word it differently.
 */
export function customGroupMemberLabel(index) {
	return `Member ${Number(index) + 1}`;
}
