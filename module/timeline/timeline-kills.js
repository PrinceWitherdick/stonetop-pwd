// WHO STRUCK THE FINAL BLOW, AND HOW MANY FELL TO IT.
//
// Pure rules for the kill tally (the table's ask: a player who lands the blow that drops a foe gets
// it on their timeline, dated, and counted). The Apply-damage step in combat/attack-flow.js says
// only what HAPPENED: each applied row on the card carries how many bodies its blow felled
// (fight/group-hits.js#killsFromHit). Who that is credited to is the timeline's question, asked by
// timeline-watch.js when the card's applied rows change, which hands the names to
// timeline-record.js#recordKills in ONE write per Apply.
//
// WHAT COUNTS (the user's rulings, 2026-10-01):
//  • The character's OWN blow. Not a follower's (a crew's swing, an off-map follower blow, which
//    arrives carrying its character as the attacker but is flagged `followerBlow`), and never the
//    card a character TOOK (a `selfHarm` card names the character who was hit as its attacker).
//  • A FOE: a monster, or an NPC the fight puts on the other side. Never another character, never
//    a follower -- the fight's own answer to that question is reused rather than restated: the side
//    stamped on the target's combatant, else `classifySide`, because disposition alone reads every
//    character as hostile (fight/struck-foe.js#struckFoe).
//  • The blow that took it from standing to down. A foe already at 0 is not killed again.
//
// Only blows applied through the card count. A GM typing 0 into a monster's HP box, or core's skull
// toggle, carries no attacker, and guessing one would credit the wrong player.

// Whose blow counts (creditsKills) and who is a foe (isFoe) are the fight's own rules, shared with Terror on
// the Field's line on the damage card, which may not load the timeline.
export { creditsKills, isFoe } from "../fight/struck-foe.js";

/**
 * A foe as the table saw it: the TOKEN's name, with the number core or a split appended taken off
 * ("Crinwin (3)" fell as a Crinwin). The token name and not the actor's, because the token is what
 * was on the map -- a GM who hid a monster's true name behind "The Thing in the Reeds" has not
 * agreed to the timeline printing it.
 */
export function foeName(name) {
	return String(name ?? "").replace(/\s*\(\d+\)$/, "").trim();
}

/**
 * How many bodies an applied damage row says its blow felled.
 *
 *  • A lone blow into a group (`member`) drops one member, or none.
 *  • Anything else carries `felled`, written when the HP was (combat/attack-flow.js).
 *  • NOTHING for a row on a follower's roster (the heroes' side, by definition), a row a Defend
 *    stand-in took in a ward's place (`by`: the blow fell on a defender, never a foe), or a blow
 *    ignored outright.
 */
export function felledBy(row) {
	if (!row || row.by || row.roster || row.ignored) return 0;
	if (row.member) return row.down ? 1 : 0;
	return Math.max(0, Math.trunc(Number(row.felled) || 0));
}

/** The applied rows an update added: those whose target was not among `beforeUuids`. */
export function newlyApplied(applied, beforeUuids = []) {
	const had = new Set(beforeUuids);
	return (Array.isArray(applied) ? applied : []).filter(row => row?.uuid && !had.has(row.uuid));
}
