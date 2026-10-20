// The Marshal's SHIELD WALL (Book I p.126): "When you have your crew form a shield wall, they Defend with
// advantage and on a 7+ they hold +2 Readiness (instead of the usual +1 for shields). As long as they
// maintain formation, they can go on the offensive without losing Readiness."
//
// FORMED is kept on the crew (`crew.shieldWall` on the Marshal's flags), written when the crew is ordered to
// Defend: a Defend with Shield Wall's advantage ticked forms the wall, any other Defend is made out of it.
// While formed, the crew keeps its Readiness when it goes on the offense unless its player breaks formation to
// charge (combat/readiness-loss.js#settleFollowerReadinessOnAttack asks, holding the wall by default; breaking
// it loses the Readiness and the wall), and a shield-bearing crew's 7+ Defend holds the +2 on its own.
// Formation only COUNTS while the crew holds Readiness: a wall with nothing held has nothing to keep.
//
// IT BREAKS when the crew breaks formation to charge (above), when it is ordered to do anything other than
// hold the wall (an order that is not a Clash, a Let Fly or a Shield Wall Defend: the crew has left the line
// to do it), when the crew's Readiness is gone,
// and when the fight ends (both cleared by the GM's client, combat/readiness-loss.js#installReadinessLoss).

import { SYSTEM_ID } from "../system-id.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { readinessCount } from "../combat/defend-readiness.js";
import { READINESS_SHIELD_BONUS, READINESS_SHIELD_WALL_BONUS, SHIELD_WALL_MOVE, isOrderedAttack, readinessCap } from "../data/follower-build.js";
import { FOLLOWER_FLAGS } from "../actors/character/follower-roster.js";
import { postMoveNote } from "../utils/chat.js";
import { format, localize } from "../utils/i18n.js";

/** Where the crew's formation is kept, under the system's flags on the Marshal. */
export const SHIELD_WALL_FLAG = "crew.shieldWall";

const KEY = "stonetop.shieldWall";

/** Whether a crew's flags say it stands in a shield wall: formed, and holding Readiness. PURE. */
export function formedInShieldWall(flags) {
	const { getProperty } = foundry.utils;
	return !!getProperty(flags, SHIELD_WALL_FLAG) && readinessCount(getProperty(flags, FOLLOWER_FLAGS.crew.readiness)) > 0;
}

/** Whether this character's crew stands in a shield wall: Shield Wall learned, and formed (formedInShieldWall). */
export function crewInShieldWall(character) {
	if (character?.type !== "character" || !ownsLearnedMoveNamed(character, SHIELD_WALL_MOVE)) return false;
	return formedInShieldWall(readableFlags(character));
}

/**
 * The Readiness a Defend's 7+ adds on its own for the shield wall: +2 for a crew that formed it bearing shields,
 * else none (a plain shield's +1 stays the player's pip). PURE.
 */
export function shieldWallDefendBonus({ shieldWall = false, hasShield = false } = {}) {
	return shieldWall && hasShield ? READINESS_SHIELD_WALL_BONUS : 0;
}

/** The crew's Readiness pips: 3, 4 with shields, 5 with shields while in a shield wall. PURE. */
export function crewReadinessCap({ hasShield = false, formed = false } = {}) {
	return readinessCap(hasShield, formed ? READINESS_SHIELD_WALL_BONUS : READINESS_SHIELD_BONUS);
}

/** Form (true) or break (false) the crew's wall. Answers whether anything was written. */
export async function setShieldWall(character, formed) {
	if (character?.type !== "character" || character.isOwner === false) return false;
	if (!!foundry.utils.getProperty(readableFlags(character), SHIELD_WALL_FLAG) === !!formed) return false;
	await character.update({ [`flags.${SYSTEM_ID}.${SHIELD_WALL_FLAG}`]: !!formed }, { stonetopLedger: true });
	return true;
}

/**
 * The crew is ordered (StonetopCharacterSheet#orderFollower): a Defend forms the wall when Shield Wall's
 * advantage was on it and is made out of formation when not; a Clash or Let Fly is made from the line; any
 * other order leaves it, and the chat says the wall broke. Answers "formed", "broken" or null (no change).
 *
 * @param {Actor} character  the Marshal
 * @param {{moveKey?: ?string, shieldWall?: boolean, followerName?: string}} order  the dialog's result
 */
export async function settleShieldWallOnOrder(character, { moveKey = null, shieldWall = false, followerName = "" } = {}) {
	// The orders a crew can make in formation: the wall goes on the offense without leaving the line.
	if (isOrderedAttack(moveKey)) return null;
	if (moveKey === "defend" && shieldWall) return (await setShieldWall(character, true)) ? "formed" : null;
	const standing = crewInShieldWall(character);
	if (!(await setShieldWall(character, false))) return null;
	// A Defend out of formation says so on its own card; anything else gets a line here, once the wall stood.
	if (moveKey !== "defend" && standing) {
		await postMoveNote(character, localize(`${KEY}.title`), format(`${KEY}.broken`, { name: followerName || localize(`${KEY}.theCrew`) }));
	}
	return "broken";
}

/**
 * Whether an actor update has just emptied a formed crew's Readiness: the wall goes with it
 * (installReadinessLoss clears the flag). PURE apart from reading the actor.
 */
export function shieldWallEmptied(actor, changes = {}) {
	if (actor?.type !== "character") return false;
	const { getProperty } = foundry.utils;
	const flags = readableFlags(actor);
	if (!getProperty(flags, SHIELD_WALL_FLAG)) return false;
	const readiness = FOLLOWER_FLAGS.crew.readiness;
	const touched = getProperty(changes, `flags.${SYSTEM_ID}.${readiness}`) !== undefined
		|| `flags.${SYSTEM_ID}.${readiness}` in (changes ?? {});
	return touched && readinessCount(getProperty(flags, readiness)) <= 0;
}
