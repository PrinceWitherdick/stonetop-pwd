// Was the blow a character's OWN, and was the one it just felled a FOE? Asked by two readers of the same
// applied card, which must agree: the kill tally (timeline/timeline-watch.js, a foe felled goes on the
// striker's timeline) and Terror on the Field's line on the applied damage card (combat/attack-flow.js).
// A follower's swing is neither's to credit, and a Berserker's area blow that drops an ally is neither a
// kill to count nor a foe to terrify. The kill tally's rules (timeline/timeline-kills.js) hand these on.

import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { characterBehind } from "../actors/character/follower-masters.js";
import { classifySide } from "./fight-sides.js";
import { combatantSide, fightOnScene, sideInfoFor } from "./fight-state.js";
import { rollerCombatant } from "./damage-seed.js";
import { FOES } from "./engagements.js";

/**
 * Can this card's blows be credited to anybody at all? Asked once per card, since every row on it was
 * struck by the same hand: a character's own blow, never a follower's (a crew's swing, an off-map
 * follower blow, which arrives carrying its character as the attacker but is flagged `followerBlow`),
 * and never a card the character TOOK (a `selfHarm` card names the character who was hit as its attacker).
 *
 * @param {{attackerType?: string, selfHarm?: boolean, followerBlow?: boolean}} card
 */
export function creditsKills({ attackerType = "", selfHarm = false, followerBlow = false } = {}) {
	return attackerType === "character" && !selfHarm && !followerBlow;
}

/**
 * creditsKills, asked of a damage card: the character whose own blow its rows are, or null.
 *
 * @param {ChatMessage} message  the damage card, whose flag says whether a follower struck
 * @param {object} damage        its damage flag (`selfHarm`)
 * @param {Actor|null} attacker  the actor its `attackerUuid` names
 */
export function creditedStriker(message, damage, attacker) {
	return creditsKills({
		attackerType: attacker?.type, selfHarm: !!damage?.selfHarm,
		followerBlow: !!message?.getFlag?.(STONETOP_SCOPE, "followerBlow"),
	}) ? attacker : null;
}

/**
 * Is the target on the other side of the fight, by the fight's own side rules (fight-sides.js)?
 *
 * @param {{type?: string, hasPlayerOwner?: boolean, isFollower?: boolean, disposition?: number}} target
 */
export function isFoe(target = {}) {
	return classifySide(target)?.side === FOES;
}

/**
 * Was a struck target on the other side, AS THE FIGHT PLACES IT? A side the Fight tab stamped on the
 * target's combatant wins (`combatantSide`), so an NPC the GM moved across counts for the side it
 * was moved to. Outside a fight, the side the actor implies, with the disposition the card saw.
 *
 * ⚠ NEVER A CHARACTER OR A FOLLOWER, WHATEVER THE STAMP SAYS (the user's ruling: a kill on your own
 * people is not a kill to count). The follower test is the wider of the two the system has: the
 * fight's own `followerOrigin` flag (`sideInfoFor`), or a character behind the NPC (`characterBehind`).
 *
 * @param {Actor} target             the struck row's actor (utils/damage.js#damageRowActor)
 * @param {number} [cardDisposition] the token's disposition as the damage card froze it
 */
export function struckFoe(target, cardDisposition) {
	const info = sideInfoFor(target, target.token ?? null);
	if (info.type === "character" || info.hasPlayerOwner) return false;
	if (info.isFollower || (target.type === "npc" && characterBehind(target))) return false;
	const scene = target.token?.parent ?? globalThis.canvas?.scene ?? null;
	const combatant = rollerCombatant(fightOnScene(scene), scene, target);
	if (combatant) return combatantSide(combatant) === FOES;
	return isFoe({ ...info, disposition: cardDisposition ?? info.disposition });
}
