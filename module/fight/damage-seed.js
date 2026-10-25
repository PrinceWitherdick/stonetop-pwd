// The fight's extra damage, offered to a damage roll before it is rolled.
//
// Book I p.414: "When multiple combatants deal damage to a single foe, roll one combatant's damage
// (usually the best one) and add +1 extra damage for each capable attacker after the first." The fight
// already knows who is attacking whom (engagements.js), so a damage roll against a foe several people
// are fighting opens with that +N filled in and named, and a counter-attack from several foes on one
// character carries it too.
//
// A SEED, NOT A RULING. It is ticked and labelled in the damage window, where the roller can untick it,
// and it is named on the damage card, where whoever presses Apply can leave it off. The book's own
// example waives it ("Didn't I cut the first one down before it could hurt me?" "Good point.", p.415),
// and a table that agrees with that needs one click, not a hand-edited HP box.
//
// ONLY FOR A SINGLE FOE, as the sentence says: a token standing for a crew or a horde is several foes,
// and fighting it is the group rules' business. And only with the Fight tab on: with it off there is
// no fight record to read, and nothing here builds a seed.
//
// GROUP AGAINST GROUP (p.416) gets a seed of its own, on a group token's damage rolled from its sheet
// (a monster fighting as a group, or a crew with a headcount): "If one group outnumbers the other, they
// get a +1 bonus to damage and armor for every multiplier past 1." The bigger group's roll opens with
// +N damage; the smaller group's opens with -N, which is the bigger group's +N armor taken off the roll,
// since a stat block's damage card has nothing that applies armor. Both are counted over the groups in
// the engagement only: "Foes that are engaged by individual PCs aren't really part of a group." And only
// for a blow AT the other side's groups: the same group's blow at a lone hero (or a crew's at a lone
// ogre) in that engagement is a crowd on an individual, not an exchange (groupBlowSeed).
//
// A MONSTER GROUP WITH NO GROUP TO FIGHT piles on like anyone else, with every body it stands for: a
// horde of six on a lone hero is six attackers and +5 (p.414 counts attackers, not tokens), which is
// what the tab's badge and that hero's own counter-blow already say. With the Fight tab on, its stat
// block draws no swarm row (StonetopMonsterSheet), so this is where that number comes from. Any other
// group keeps to the group seed: a follower group's own Swarm die (fight/follower-fight.js) carries its
// pile-on, beside a plain die that is one member's, and a seed on either would count the crew twice or
// undo that split.
//
// THE OTHER ATTACKERS' DICE AND TAGS RIDE ALONG. The book rolls "one combatant's damage (usually the best
// one)" and applies "tags from all the attackers as they make sense" (p.414; p.239 "roll the single highest
// damage die among them... The tags from all the combatants apply"). So a pile-on seed carries every other
// attacker's die (`dice`), which the damage window turns into an offer to roll the best of them in place
// of the roller's own (utils/damage.js#settleBestDie), and their tags and piercing, which the damage card
// adds to the blow's own (combat/attack-flow.js#withSeedTags). A character's die is read off their sheet;
// the tags of whatever weapon they would swing are theirs to say, so only a stat block's are carried.
//
// SEPARATE ROLLS ARE NOT ONE ATTACK. "When multiple PCs and/or followers attack a foe at once, one of them
// rolls Clash or Let Fly and the others Aid" (p.414): the +N is for attacking together. Two characters in
// contact with one foe usually take their swings in turn, each rolling their own damage, and a +1 ticked on
// both is the same extra body counted twice. So when another CHARACTER is among the attackers the seed
// opens unticked, worded as an offer, and the roller ticks it when they are striking together. Followers and
// monsters do not roll their own damage beside the roller's, so a seed made of them opens ticked.
//
// The seed is plain data, carried through the damage window, the roll and the card's flags:
//   { bonus, count, direction: "onFoe"|"onHero", target, names, label, pill, pillLeftOff, cite, applied,
//     dice, tags, piercing, best?, useBest? }

import { outnumberBonus, pileOnBonus } from "../data/follower-build.js";
import { hardestAttackIndex, foeAttacks, resolvePiercing, IGNORES_ARMOR_RE, PIERCING_RE } from "../utils/damage.js";
import { isFightTabEnabled } from "../settings.js";
import { format, localize } from "../utils/i18n.js";
import { HEROES, FOES, opponentsOf } from "./engagements.js";
import { engagementFor, engagementOf, fightOnScene, combatantBodies, combatantSide, controlledTokenIds, sideInfoFor } from "./fight-state.js";
import { classifySide } from "./fight-sides.js";
import { namesPhrase } from "./fight-copy.js";
import { resolveSync } from "../utils/foundry-compat.js";

const KEY = "stonetop.fight.seed";

/**
 * A seed's words, built once when it is made so every client shows the same sentence.
 *
 * @param {object} p
 * @param {number} p.count        attackers (bodies) on the target, the roller included
 * @param {"onFoe"|"onHero"} p.direction  a party hitting a foe, or foes hitting a party member
 * @param {string} p.target       who is being hit
 * @param {string[]} p.names      who is doing the hitting
 * @param {Array<{name: string, formula: string}>} [p.dice]  the OTHER attackers' dice
 * @param {string[]} [p.tags]     the other attackers' tags
 * @param {number} [p.piercing]   the most piercing among the other attackers' blows
 * @param {boolean} [p.together]  false when another character rolls their own damage (see the note)
 */
export function makeSeed({ count, direction, target, names, dice = [], tags = [], piercing = 0, together = true }) {
	const bonus = pileOnBonus(count).bonus;
	if (bonus < 1) return null;
	const who = namesPhrase(names, format);
	const said = direction === "onHero"
		? format(`${KEY}.onHero`, { bonus, target, names: who })
		: format(`${KEY}.${count === 2 ? "onFoeTwo" : "onFoe"}`, { bonus, target, names: who });
	const label = together ? said : format(`${KEY}.together`, { label: said });
	const pill = format(`${KEY}.${direction === "onHero" ? "pillOnHero" : "pillOnFoe"}`, { bonus, count });
	return {
		bonus, count, direction, target, names: [...names],
		label,
		pill,
		pillLeftOff: format(`${KEY}.leftOff`, { pill }),
		cite: localize(`${KEY}.cite`),
		applied: !!together,
		dice: dice.filter(d => d?.formula).map(d => ({ name: String(d.name ?? ""), formula: String(d.formula) })),
		tags: [...new Set(tags.filter(Boolean).map(String))],
		piercing: Math.max(0, Math.trunc(Number(piercing) || 0)),
	};
}

/**
 * What one attacker brings to a pile-on besides their body: their damage die, their blow's tags and its
 * piercing. A character's die is the one on their sheet (their weapon's tags are theirs to say); anyone
 * else's is their hardest-hitting printed attack.
 *
 * @param {object} combatant
 * @returns {{name: string, formula: string, tags: string[], piercing: number, character: boolean}}
 */
function attackerProfile(combatant) {
	const actor = combatant?.actor ?? null;
	const name = combatant?.name || actor?.name || "";
	if (actor?.type === "character") {
		const formula = String(actor.system?.attributes?.damage?.value ?? "").replace(/\s+/g, "");
		return { name, formula, tags: [], piercing: 0, character: true };
	}
	const attacks = foeAttacks(actor);
	const best = attacks[hardestAttackIndex(attacks)] ?? null;
	const fallback = String(actor?.system?.attributes?.damage?.rollFormula ?? "").replace(/\s+/g, "");
	return {
		name,
		formula: best?.formula ?? fallback,
		tags: (best?.tags ?? []).filter(tag => !PIERCING_RE.test(String(tag)) && !IGNORES_ARMOR_RE.test(String(tag))),
		piercing: resolvePiercing(best?.piercing ?? 0),
		character: false,
	};
}

/** The seed fields the other attackers bring: their dice, tags, piercing, and whether any rolls their own. */
function othersOf(found, ids) {
	const profiles = ids.map(id => found.combatants?.get?.(id)).filter(Boolean).map(attackerProfile);
	return {
		dice: profiles.map(p => ({ name: p.name, formula: p.formula })),
		tags: profiles.flatMap(p => p.tags),
		piercing: Math.max(0, ...profiles.map(p => p.piercing)),
		together: !profiles.some(p => p.character),
	};
}

/**
 * A group's seed in a group-against-group exchange, or null when neither side outnumbers the other.
 *
 * @param {object} p
 * @param {number} p.yours   bodies in the roller's side's groups
 * @param {number} p.theirs  bodies in the other side's groups
 */
function makeGroupSeed({ yours, theirs }) {
	const ahead = outnumberBonus(yours, theirs).bonus;
	const behind = outnumberBonus(theirs, yours).bonus;
	if (ahead < 1 && behind < 1) return null;
	const data = { yours, theirs };
	const direction = ahead > 0 ? "groupAhead" : "groupBehind";
	const bonus = ahead > 0 ? ahead : -behind;
	const pill = format(`${KEY}.${direction === "groupAhead" ? "pillAhead" : "pillBehind"}`, { ...data, bonus: Math.abs(bonus) });
	return {
		bonus, count: yours, direction, target: "", names: [],
		label: format(`${KEY}.${direction}`, { ...data, bonus: Math.abs(bonus) }),
		pill,
		pillLeftOff: format(`${KEY}.leftOff`, { pill }),
		cite: localize(`${KEY}.citeGroups`),
		applied: true,
	};
}

/** The group-against-group exchange a fighter's engagement is, or null when it is not one. */
function exchangeOf(found, self) {
	const cluster = found?.result?.clusters?.find(c => c.heroIds.includes(self.id) || c.foeIds.includes(self.id));
	return cluster?.groups ?? null;
}

/**
 * Which seed a GROUP's blow takes (a fighter standing for more than one body), by WHO IT IS AIMED AT:
 *  • "exchange": the group-against-group seed (p.416), when the group is in an exchange and every one it
 *    is aimed at is a group on the other side of that engagement;
 *  • "pileOn": the p.414 pile-on, for a monster group's blow at anyone else (a lone hero, a follower);
 *  • "none": no seed, for any other group's blow at anyone else (a follower group's own Swarm die is its
 *    pile-on, see the note at the top).
 *
 * BY THE TARGET, NOT BY THE ENGAGEMENT. "Foes that are engaged by individual PCs aren't really part of a
 * group" (p.416): a horde trading blows with the Marshal's crew AND swinging at the Heavy who waded into it
 * is fighting the Heavy as a crowd of individuals, not as a group. Read off the engagement alone, the
 * horde's blow at the Heavy took the groups' +N (or, as the smaller group, the crew's +N ARMOR on the
 * Heavy), while the Heavy's own badge and counter-blow said +7 for the crowd round them.
 *
 * @param {object} found     the group's engagementOf
 * @param {object} self      the group's fighter
 * @param {Actor} actor      the group's actor
 * @param {Array<string|null>} aimedAt  the combatant ids it is aimed at (null for one not in the fight)
 * @returns {"exchange"|"pileOn"|"none"}
 */
function groupBlowSeed(found, self, actor, aimedAt) {
	const exchange = !!exchangeOf(found, self);
	const atGroups = aimedAt.length > 0 && aimedAt.every(id => {
		const fighter = id ? fighterIn(found, id) : null;
		return !!fighter && fighter.side !== self.side && fighter.bodies > 1;
	});
	if (exchange && atGroups) return "exchange";
	return actor?.type === "monster" ? "pileOn" : "none";
}

/**
 * A linked actor's one token on `scene`, or, of several, the one this reader has selected when exactly one
 * of them is (as rollerCombatant settles it). Null when there is no telling.
 */
function onlyTokenHere(actor, scene, { controlled = globalThis.canvas?.tokens?.controlled } = {}) {
	const here = (actor?.getActiveTokens?.(false, true) ?? []).filter(t => t?.parent?.id === scene?.id);
	return theOneSelected(here, t => t.id, controlled);
}

/** The one of `list`, or of several the one whose token (`tokenIdOf`) this reader has selected when exactly one is. */
function theOneSelected(list, tokenIdOf, controlled) {
	if (list.length <= 1) return list[0] ?? null;
	const selected = new Set(controlledTokenIds(controlled));
	const chosen = list.filter(item => selected.has(tokenIdOf(item)));
	return chosen.length === 1 ? chosen[0] : null;
}

/** The combatant ids of a snapshot standing on the tokens a roll is aimed at, null for one not in it. */
function aimedIds(found, targets) {
	const byUuid = new Map([...(found?.combatants?.values?.() ?? [])].map(c => [c.token?.uuid, c.id]));
	return targets.map(t => byUuid.get(t?.uuid) ?? null);
}

/** The group-against-group seed for a fighter in a snapshot, or null. See the note at the top. */
function groupSeedFor(found, self) {
	const groups = exchangeOf(found, self);
	if (!groups) return null;
	const [yours, theirs] = self.side === HEROES
		? [groups.heroGroupBodies, groups.foeGroupBodies]
		: [groups.foeGroupBodies, groups.heroGroupBodies];
	return makeGroupSeed({ yours, theirs });
}

/** The fighter a snapshot has for a combatant id, or null. */
const fighterIn = (snapshot, id) => snapshot?.fighters?.find(f => f.id === id) ?? null;

/** Names over fighter ids, from a snapshot. */
const namesOf = (snapshot, ids) => ids.map(id => fighterIn(snapshot, id)?.name).filter(Boolean);

/**
 * The combatant standing for an actor in a fight, matched as a linked token is: by actor id. Of several,
 * the one rollerCombatant settles on (the reader's selected token), else the first.
 */
function combatantForActor(combat, scene, actor) {
	if (!combat || !scene || !actor) return null;
	const tokenId = actor.token?.id ?? null;
	return rollerCombatant(combat, scene, actor)
		?? [...(combat.combatants ?? [])].find(c => c.sceneId === scene.id
			&& (tokenId ? c.tokenId === tokenId : c.actorId === actor.id)) ?? null;
}

/**
 * The ONE combatant a roller stands as on `scene`, or null.
 *
 * An unlinked token's actor is its token's combatant. Any other actor is the combatant for that actor,
 * when there is exactly one. With SEVERAL (a linked actor with two tokens in the fight), the one whose
 * token this reader has selected, when exactly one of them is: the fight ring only comes up on a token
 * its reader has just selected, so a button pressed there rolls from that token. With none or several of
 * them selected, there is no telling, and guessing would aim a roll from the wrong place.
 *
 * @param {Combat} combat
 * @param {Scene} scene
 * @param {Actor} actor
 * @param {{controlled?: Iterable<object>}} [options]  the tokens this reader has selected
 */
export function rollerCombatant(combat, scene, actor, { controlled = globalThis.canvas?.tokens?.controlled } = {}) {
	if (!combat || !scene || !actor) return null;
	const here = [...(combat.combatants ?? [])].filter(c => c.sceneId === scene.id);
	const tokenId = actor.token?.id ?? null;
	if (tokenId) return here.find(c => c.tokenId === tokenId) ?? null;
	return theOneSelected(here.filter(c => c.actorId === actor.id), c => c.tokenId, controlled);
}

/** A roller's place in the fight on `scene` (the canvas scene by default), as engagementOf gives it, or null. */
export function rollerEngagement(actor, { scene = globalThis.canvas?.scene ?? null } = {}) {
	if (!isFightTabEnabled() || !actor || !scene) return null;
	const combat = fightOnScene(scene);
	return engagementOf(combat, scene, rollerCombatant(combat, scene, actor));
}

/**
 * Everyone else attacking one fighter, and the roller: the p.414 pile-on on that one target.
 *
 * The roller counts whether or not their own token is in contact (a Clash rolled from the sheet with a
 * foe targeted is still an attack on that foe): once, or as every body a monster group stands for. A
 * target fought by nobody else gets no seed.
 *
 * @param {object} p
 * @param {Actor} p.attacker
 * @param {{uuid: string}} p.target  the one target, as the card froze it
 * @param {"heroes"|"foes"} p.against  the side the target has to be on
 */
function pileOnSeed({ attacker, target, against }) {
	const tokenDoc = resolveSync(target.uuid);
	if (tokenDoc?.documentName !== "Token") return null;
	const found = engagementFor(tokenDoc);
	if (!found) return null;
	const victim = fighterIn(found, found.combatant.id);
	if (victim?.side !== against || victim.bodies !== 1) return null;

	const roller = combatantForActor(found.combat, found.scene, attacker);
	const attackers = found.entry.attackers;
	const rollerIn = roller && attackers.includes(roller.id);
	const rollerBodies = (roller && fighterIn(found, roller.id)?.bodies) || 1;
	// The engagement's own count, held to how many can reach the target (engagements.js#reachAround).
	const count = found.entry.attackerBodies + (rollerIn ? 0 : rollerBodies);
	if (count < 2) return null;
	const names = namesOf(found, attackers);
	if (!rollerIn) names.unshift(attacker.name);
	const others = othersOf(found, attackers.filter(id => id !== roller?.id));
	return makeSeed({ count, direction: against === HEROES ? "onHero" : "onFoe", target: victim.name, names, ...others });
}

/**
 * The fight's +N for a damage roll about to hit `targets`, whichever side is rolling it, or null.
 *
 * A GROUP TOKEN in a group-against-group exchange takes that seed (p.416) when its blow is aimed at the
 * other side's groups, exactly as its sheet does (see sheetSeed and groupBlowSeed); with nothing aimed,
 * by the opponents it is engaged with. Aimed at anyone else, a monster group piles on with every body it
 * stands for, and any other group gets nothing (see the note at the top). Anyone else gets the
 * pile-on (p.414) against ONE target: a foe for a hero, a hero for a foe. Several targets get none,
 * because the damage against each is rolled separately and one card carries one +N.
 *
 * @param {object} p
 * @param {Actor} p.attacker
 * @param {Array<{uuid: string, hasActor?: boolean}>} p.targets  who the roll hits
 * @returns {object|null}
 */
export function seedForRoll({ attacker, targets = [] }) {
	if (!isFightTabEnabled() || !attacker) return null;
	const scene = globalThis.canvas?.scene ?? null;
	const combat = fightOnScene(scene);
	const roller = rollerCombatant(combat, scene, attacker);
	const applyable = (targets ?? []).filter(t => t?.hasActor !== false && t?.uuid);
	// A group token's own engagement and who it is aimed at say whether it takes the group seed (FGT-1,
	// groupBlowSeed). Everyone else's seed, a monster group's pile-on included, reads the target's.
	if (roller && combatantBodies(roller).bodies > 1) {
		const found = engagementOf(combat, scene, roller);
		const self = fighterIn(found, roller.id);
		if (self) {
			const aimedAt = applyable.length ? aimedIds(found, applyable) : opponentsOf(found?.entry);
			const seed = groupBlowSeed(found, self, attacker, aimedAt);
			if (seed === "exchange") return groupSeedFor(found, self);
			if (seed === "none") return null;
		}
	}
	if (applyable.length !== 1) return null;
	// Someone outside the fight rolls as the side they would join on: a character as a hero.
	const side = roller ? combatantSide(roller) : classifySide(sideInfoFor(attacker))?.side ?? null;
	return pileOnSeed({ attacker, target: applyable[0], against: side === FOES ? HEROES : FOES });
}

/**
 * Foes striking one party member: every foe in contact with them, and every one with a shot on record at
 * them (fight-shots.js). The foe the character clashed with is in contact already, and its blow is the
 * one rolled, so the others' tags and piercing ride on it (p.414 "Apply tags from all the attackers").
 *
 * @param {object} p
 * @param {Actor} p.pc
 * @param {object|null} [p.found]  pcEngagement(pc), when the caller already has it
 * @returns {object|null}
 */
export function incomingSeed({ pc, found = pcEngagement(pc) }) {
	if (!found) return null;
	const hero = fighterIn(found, found.combatant.id);
	if (hero?.side !== HEROES || hero.bodies !== 1) return null;
	const count = found.entry.attackerBodies;
	if (count < 2) return null;
	const { tags, piercing } = othersOf(found, found.entry.attackers);
	const seed = makeSeed({ count, direction: "onHero", target: hero.name, names: namesOf(found, found.entry.attackers), tags, piercing });
	if (!seed) return null;
	// Which foe struck is not known until the blow is picked, so each foe's share is kept by token: the
	// striker's own is taken back out then (seedWithoutStriker).
	seed.sources = found.entry.attackers
		.map(id => found.combatants?.get?.(id))
		.filter(c => c?.token?.uuid)
		.map(c => { const { tags, piercing } = attackerProfile(c); return { uuid: c.token.uuid, tags, piercing }; });
	return seed;
}

/**
 * An incoming seed with the striking foe's own tags and piercing taken back out: they are its hardest
 * attack's, not the blow it made, and only the OTHER attackers' ride on that blow (p.414). A seed with no
 * per-foe record, or a striker not among them, is returned as it was.
 *
 * @param {object|null} seed      incomingSeed
 * @param {string} strikerUuid    the striking foe's token uuid
 */
export function seedWithoutStriker(seed, strikerUuid) {
	if (!seed || !strikerUuid || !Array.isArray(seed.sources)) return seed;
	if (!seed.sources.some(s => s?.uuid === strikerUuid)) return seed;
	const rest = seed.sources.filter(s => s?.uuid !== strikerUuid);
	return {
		...seed,
		tags: [...new Set(rest.flatMap(s => s.tags ?? []).filter(Boolean).map(String))],
		piercing: Math.max(0, ...rest.map(s => Math.trunc(Number(s.piercing) || 0))),
	};
}

/** A character's place in the fight on the canvas scene, or null. */
export function pcEngagement(pc) {
	if (!isFightTabEnabled() || !pc) return null;
	const scene = globalThis.canvas?.scene ?? null;
	const combat = fightOnScene(scene);
	return engagementOf(combat, scene, combatantForActor(combat, scene, pc));
}

/**
 * A combatant as a roll's target, in the shape a hand target is frozen in (combat/attack-flow.js).
 * The one reader of that shape: attack-flow.js#snapshotTargets, #rollDamageAt and fight-shots.js all
 * key off its uuid/hasActor, so the counter-attack path and the "who does this hit?" path must build
 * the same record for the same combatant.
 */
export function asTarget(combatant) {
	return {
		uuid: combatant.token.uuid,
		name: combatant.name || combatant.token.name || "",
		actorId: combatant.actorId ?? null,
		disposition: combatant.token.disposition ?? 0,
		hasActor: !!combatant.actor,
	};
}

/**
 * The foes a character is in contact with, as tokens: who "your enemy" is when a counter-attack
 * comes with nothing targeted.
 *
 * @returns {Array<{uuid: string, name: string, actorId: string|null, disposition: number, hasActor: boolean}>}
 */
export function engagedFoeTargets(pc, found = pcEngagement(pc)) {
	if (!found) return [];
	return found.entry.melee
		.map(id => found.combatants.get(id))
		.filter(c => c?.token)
		.map(asTarget);
}

/**
 * A monster's or NPC's damage, rolled from its token's sheet, when that token is fighting exactly one
 * opponent: the other fighters on its side attacking that same opponent, and itself (every body of a
 * monster group). A token standing for a group gets the group-against-group seed instead when its
 * engagement is one, and a group that is not a monster's never gets a pile-on (see the note at the top).
 *
 * @param {object} p
 * @param {Actor} p.actor  the sheet's actor (a token's own actor, for an unlinked token)
 * @returns {object|null}
 */
export function sheetSeed({ actor }) {
	if (!isFightTabEnabled() || !actor) return null;
	const scene = globalThis.canvas?.scene ?? null;
	const tokenDoc = actor.token ?? onlyTokenHere(actor, scene);
	if (!tokenDoc) return null;
	const found = engagementFor(tokenDoc);
	if (!found) return null;
	const self = fighterIn(found, found.combatant.id);
	const opponents = opponentsOf(found?.entry);
	// A group's blow at the other side's groups in its exchange takes that rule's seed, and never a
	// pile-on's; at anyone else, a monster group piles on and any other group takes nothing (groupBlowSeed).
	if (self?.bodies > 1) {
		const seed = groupBlowSeed(found, self, actor, opponents);
		if (seed === "exchange") return groupSeedFor(found, self);
		if (seed === "none") return null;
	}
	if (!self || opponents.length !== 1) return null;
	const opponent = fighterIn(found, opponents[0]);
	if (!opponent || opponent.bodies !== 1) return null;
	const { attackers, attackerBodies: count } = found.result.byFighter[opponent.id];
	if (count < 2) return null;
	return makeSeed({
		count,
		direction: opponent.side === HEROES ? "onHero" : "onFoe",
		target: opponent.name,
		names: namesOf(found, attackers),
		...othersOf(found, attackers.filter(id => id !== found.combatant.id)),
	});
}
