// Which side of a fight somebody is on, and how many bodies their token stands for.
//
// PURE: plain values in, plain values out. fight-state.js reads them off documents.

import { groupCasualties } from "../data/follower-build.js";
import { HEROES, FOES } from "./engagements.js";
import { PERSON_ACTOR_TYPES } from "../utils/actor-types.js";

/** Core's TOKEN_DISPOSITIONS.FRIENDLY, which a pure module cannot reach through CONST. */
const FRIENDLY = 1;

/**
 * The side a combatant starts on when nobody has said otherwise, and the list the start window
 * shows them in.
 *
 * DISPOSITION IS NOT THE SIDE. Characters and ordinary NPCs are created with core's default
 * disposition, which is HOSTILE, so reading sides off disposition would put the whole party on the
 * monsters' side. It counts only where something set it on purpose: a follower's token is made
 * FRIENDLY, and a GM who marks an NPC friendly means it.
 *
 *  • a character, or anything a player owns ................ heroes
 *  • a follower made from a character's card, or FRIENDLY ... heroes
 *  • a monster .............................................. foes
 *  • any other NPC .......................................... foes, but listed apart as "others":
 *                                                             a bystander is not ticked into a
 *                                                             fight just for being on the map
 *  • anything that is not a person (utils/actor-types.js): . never a combatant (null)
 *    the steading, a settlement, the GM Toolkit, and any
 *    type a module adds
 *
 * NO type at all (a token whose actor is gone, a caller that knows none) is still a body on the
 * map, so it falls through to the rules below and classifies as an NPC would.
 *
 * @param {{type?: string, hasPlayerOwner?: boolean, isFollower?: boolean, disposition?: number}} info
 * @returns {{side: "heroes"|"foes", list: "heroes"|"foes"|"others"}|null}
 */
export function classifySide({ type = "", hasPlayerOwner = false, isFollower = false, disposition = null } = {}) {
	if (type && !PERSON_ACTOR_TYPES.has(type)) return null;
	if (type === "character" || hasPlayerOwner) return { side: HEROES, list: HEROES };
	if (isFollower || Number(disposition) === FRIENDLY) return { side: HEROES, list: HEROES };
	if (type === "monster") return { side: FOES, list: FOES };
	return { side: FOES, list: "others" };
}

/** The side opposite `side`. */
export function otherSide(side) {
	return side === HEROES ? FOES : HEROES;
}

/**
 * At 0 of a real HP pool, a maximum above 0: "reduced to 0 HP" (Book I p.240). The ONE reading of it, for
 * the fight's bodies, a character's standing (fight-state.js#fightStanding) and a follower card (follower-order-attack.js
 * #followerIsDown). No hit points recorded is not 0. PURE.
 */
export function atZeroOf(hp) {
	const value = Number(hp?.value);
	return Math.trunc(Number(hp?.max) || 0) > 0 && Number.isFinite(value) && value <= 0;
}

/** Whether a monster is fought as one group (p.416): its "Group fight" switch on a group or a horde. */
export function fightsAsGroup({ type = "", fightAsGroup = false, organization = "" } = {}) {
	return type === "monster" && !!fightAsGroup && (organization === "group" || organization === "horde");
}

/**
 * How many capable bodies a token stands for (Book I p.414 counts "each capable attacker").
 *
 *  • Marked out of the fight (core's defeated) ................ none, out
 *  • Out of the action at Death's Door, whatever their HP ..... none, out, unless it `keepsFighting`.
 *    A Death's Door 7-9 leaves a character "out of the action" (Book I p.245), a Revenant's Undying
 *    7-9 does at half HP, a 6- is the Last Door, and a character who has left play is gone
 *    (`outOfAction`, fight-state.js#fightStanding's `doorOut`)
 *  • A group or horde monster fighting as a group (p.416) ..... the members still standing,
 *    read off its HP pool as casualties; routed at 0 HP is out; a group with no headcount
 *    recorded stands for one, as the monster sheet's rows do
 *  • Anything else at 0 HP (with an HP maximum to be at 0 of) . none, out, unless it `keepsFighting`:
 *    a Heavy's Unstoppable ("reduced to 0 HP in battle, you can keep fighting") until they roll
 *    Death's Door (actors/character/unstoppable.js#keepsFightingAtZero)
 *  • A group follower (the crew, a custom group) .............. the members its character's roster
 *    has still standing, and never more than its token's pool leaves standing: a group's blows on the
 *    crew land on that pool (fight/group-hits.js), and p.416 reads them as casualties ("If one group
 *    loses half its HP, then about half that group's numbers are out the action. Adjust the bonuses
 *    to damage and armor accordingly!"). None left, or the pool at 0, is routed
 *  • Anything else ............................................ the headcount the GM set on the
 *    combatant (a warband of plain NPCs), falling as its HP does like a monster group's (its HP is one
 *    member's; routed at 0), else one
 *
 * @param {object} info
 * @param {boolean} [info.defeated]
 * @param {string}  [info.type]          the actor type
 * @param {boolean} [info.fightAsGroup]  a monster's "Group fight" switch
 * @param {string}  [info.organization]  a monster's organization
 * @param {{value?: number, max?: number}} [info.hp]
 * @param {number}  [info.count]         a monster's group size
 * @param {number}  [info.headcount]     the combatant's own headcount
 * @param {{standing: number, size: number}|null} [info.roster]  a group follower's roster
 * @param {boolean} [info.keepsFighting]  fighting on at 0 HP (Unstoppable), or making Death's Door's
 *   last move (fight/in-battle.js#makingLastMove): wins over `outOfAction` and 0 HP alike
 * @param {boolean} [info.outOfAction]   a character's Death's Door state puts them out of the action
 * @param {number}  [info.startSize]     the size a monster group started at before lone blows dropped
 *   members (fight/group-hits.js#GROUP_SIZE_FLAG); only the `size` it reports reads it
 * @returns {{bodies: number, out: boolean, group: boolean, standing: number|null, size: number|null, routed: boolean}}
 */
export function bodiesFor({
	defeated = false, type = "", fightAsGroup = false, organization = "", hp = {}, count = 0, headcount = null, roster = null, startSize = 0,
	keepsFighting = false, outOfAction = false,
} = {}) {
	const none = { bodies: 0, out: true, group: false, standing: null, size: null, routed: false };
	if (defeated) return none;
	if (outOfAction && !keepsFighting) return none;

	const max = Math.max(0, Math.trunc(Number(hp?.max) || 0));
	const value = Number(hp?.value);

	const rosterSize = Math.max(0, Math.trunc(Number(roster?.size) || 0));
	if (rosterSize > 0) {
		const onRoster = Math.max(0, Math.min(rosterSize, Math.trunc(Number(roster.standing) || 0)));
		// The pool's casualties, the same reading the crew card's casualty line makes (follower-build.js#casualtyNote).
		const pool = max > 0 && Number.isFinite(value) ? groupCasualties({ hpMax: max, hpCurrent: value, count: rosterSize }) : null;
		// Held at one while the pool has any HP left, as a monster group's is below: only 0 HP routs them.
		const standing = pool && !pool.routed ? Math.min(onRoster, Math.max(1, pool.standing)) : onRoster;
		if (standing === 0 || pool?.routed) return { ...none, group: rosterSize > 1, standing: 0, size: rosterSize, routed: true };
		return { bodies: standing, out: false, group: rosterSize > 1, standing, size: rosterSize, routed: false };
	}

	if (fightsAsGroup({ type, fightAsGroup, organization })) {
		const size = Math.max(0, Math.trunc(Number(count) || 0));
		if (size > 0 && max > 0) {
			const { standing, routed } = groupCasualties({ hpMax: max, hpCurrent: Number.isFinite(value) ? value : max, count: size });
			// Said as "5 of 6": the size it started at, when lone blows have dropped some (never less than now).
			const shown = Math.max(size, Math.trunc(Number(startSize) || 0));
			if (routed) return { ...none, group: true, standing: 0, size: shown, routed: true };
			return { bodies: Math.max(1, standing), out: false, group: true, standing, size: shown, routed: false };
		}
	}

	const set = Math.trunc(Number(headcount) || 0);
	// A headcount the GM set falls as its HP does, read the way a monster group's is (the user's ruling on
	// p.416, "Damage represents casualties... Adjust the bonuses"): the token's HP is ONE member's, and the
	// members still standing are the share of it left, to the nearest body. At 0 HP the lot are routed.
	if (set > 1 && max > 0) {
		const { standing, routed } = groupCasualties({ hpMax: max, hpCurrent: Number.isFinite(value) ? value : max, count: set });
		if (routed) return { ...none, group: true, standing: 0, size: set, routed: true };
		return { bodies: Math.max(1, standing), out: false, group: true, standing, size: set, routed: false };
	}

	if (atZeroOf(hp) && !keepsFighting) return none;

	return { bodies: set > 1 ? set : 1, out: false, group: set > 1, standing: null, size: set > 1 ? set : null, routed: false };
}
