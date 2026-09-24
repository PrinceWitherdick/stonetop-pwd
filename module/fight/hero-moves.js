// Playbook moves that change a blow in a fight, read off the fight on the map.
//
// Most of what a character's moves do in a fight is fiction, and stays the table's. These change a number
// the damage card is about to write, or a die a foe is about to roll, and the fight already knows the
// facts they turn on:
//  • UNDAUNTED (Would-Be Hero): "When you are outnumbered or facing a foe bigger than you, you get +1 armor
//    and deal +1d6 damage." Outnumbered is the fight's count: more than one on them, or more foes than
//    heroes in their engagement. Bigger is the stat block's size, large or huge.
//  • BIG DAMN HERO (Would-Be Hero): "When you Defend, you can spend 1 Readiness to lock eyes with an
//    attacker; they have disadvantage on damage rolls against you and your ward for the rest of the fight."
//    Kept on the hero's combatant, so it ends with the fight. The ward is whoever stands beside the hero:
//    the fight has no record of who a character is protecting, and a Defend is made for the people right
//    there.
//  • DANGEROUS (Heavy): "When you deal your damage, you have advantage." Every roll of the character's own
//    damage, in a fight or not; it meets a strike back's disadvantage and the two cancel.
//  • MUSCLEBOUND (Heavy): "When you make a hand-to-hand or thrown attack, it's forceful and messy."
//  • SOMETHING TO REMEMBER ME BY (Would-Be Hero): "+1d4" on a strike back bought with Readiness.
//  • HUNGRY FLAMES (Lightbearer): "+1d6" whenever the blow is dealt with a holy light.
//  • BIG GAME HUNTER / GIANT SLAYER (Ranger): "+2" / "another +2" at the weak spot of a large or huge
//    creature. The fight knows the size; whether this blow found the weak spot is the table's, so the
//    window opens with the box UNTICKED.
//  • NEMESIS / RELENTLESS (Heavy): both turn on "when you Clash and your foe survives", so both read the
//    same record of the foes this character has Clashed (`clashedWith`). A foe that did NOT survive never
//    comes up again, which is why the record is written at the Clash rather than waiting on the corpse.
//  • PAYBACK (Heavy): "+1d4" against a foe that has harmed this character or an ally. Apply writes who hurt
//    whom on the HARMED character (`harmedBy`), because Apply often runs on a player's client, which cannot
//    write the Combat document.
//  • NEVER GONNA KEEP ME DOWN (Would-Be Hero) at 5 HP or less, UNCANNY REFLEXES (Heavy) unarmored under a
//    light or normal load, and BATTLEFIELD GRACE (Marshal) leading allies: each puts the damage THEY take
//    at disadvantage, like locked eyes from the other side.
// The Defend spends on the damage card (Parry & Riposte, Steadfast Guardian, A Mighty Rampart) are in
// defend-spend.js.

import { SYSTEM_ID } from "../system-id.js";
import { format } from "../utils/i18n.js";
import { ownsLearnedMoveNamed, ownedMove } from "../actors/character/owns-move.js";
import { heldOnTrack } from "../actors/character/MoveResources.js";
import { MELEE_RANGES } from "../data/weapons.js";
import { betterMode, foldModes } from "../utils/roll-mode.js";
import { fightStateActive, STORM_MARKINGS_NAME } from "../actors/character/fight-states.js";
import { BINDING_ARBITRATION, OATHS_FLAG, readOaths, oathIndex, isSwornBy } from "../actors/character/oaths.js";
import { HEROES, touching } from "./engagements.js";
import { fightOnScene, gridOf } from "./fight-state.js";
import { rollerEngagement } from "./damage-seed.js";
import { resolveSync } from "../utils/foundry-compat.js";

export const HERO_MOVES = Object.freeze({
	PARRY: "Parry & Riposte",
	SECOND_INTENT: "Second Intent",
	STEADFAST: "Steadfast Guardian",
	RAMPART: "A Mighty Rampart",
	BIG_DAMN_HERO: "Big Damn Hero",
	UNDAUNTED: "Undaunted",
	DANGEROUS: "Dangerous",
	MUSCLEBOUND: "Musclebound",
	BERSERKER: "Berserker",
	REMEMBER_ME: "Something to Remember Me By",
	HUNGRY_FLAMES: "Hungry Flames",
	BIG_GAME: "Big Game Hunter",
	GIANT_SLAYER: "Giant Slayer",
	NEMESIS: "Nemesis",
	RELENTLESS: "Relentless",
	PAYBACK: "Payback",
	NEVER_GONNA: "Never Gonna Keep Me Down",
	UNCANNY: "Uncanny Reflexes",
	BATTLEFIELD_GRACE: "Battlefield Grace",
	KNOCKED_DOWN: "I Get Knocked Down",
	UP_AGAIN: "But I Get Up Again",
	ANGER: "Anger is a Gift",
	DOG_WITH_BONE: "Like a Dog with a Bone",
	EVERYTHING_BLEEDS: "Everything Bleeds",
	PREDATOR: "Predator",
});

/**
 * Which `stonetop.fight.heroMoves.<key>` a move's words live under, for the moves the people being hit
 * bring to a blow. Here rather than at the card, so the module that decides a move is offered is the
 * one that says what to call it: a third offered move adds a line to this map and needs no other edit
 * (combat/attack-flow.js#defenderLines).
 */
const DEFENDER_KEYS = Object.freeze({
	[HERO_MOVES.UNCANNY]: "uncanny",
	[HERO_MOVES.BATTLEFIELD_GRACE]: "battlefieldGrace",
});

/** That key, or null for a move with no words of its own. */
export const defenderMoveKey = move => DEFENDER_KEYS[move] ?? null;

/** The foes this character has Clashed with (Nemesis, Relentless), as `{key, name, since}` on the actor. */
export const CLASHED_FLAG = "clashedWith";

/** The foes that have harmed this character (Payback), as keys on the actor. */
export const HARMED_BY_FLAG = "harmedBy";

/** Whoever knocked this character down (But I Get Up Again), as `{key, name}` on the actor. */
export const KNOCKED_DOWN_FLAG = "knockedDownBy";

/**
 * A character's own damage roll's mode once Dangerous has had its say: advantage, or a straight roll
 * where the roll already had disadvantage (a strike back; the two cancel, p.230). Anyone without the
 * move keeps `rollMode` as it was.
 *
 * @param {Actor} actor
 * @param {string|null} rollMode  "adv", "dis", "normal", or empty for the roll's default
 */
export function dangerousMode(actor, rollMode = "") {
	if (!has(actor, HERO_MOVES.DANGEROUS)) return rollMode;
	return betterMode(rollMode);
}

/**
 * A character's own damage roll's mode once THEY have had their say: Dangerous's advantage, and the
 * Marshal's shaken nerves ("disadvantage on all rolls until you share your nerves", We Happy Few's 6-;
 * actors/character/fight-states.js). Folded together, so the two cancel (p.230) rather than stepping
 * one after the other, and neither stacks with the roll's own mode.
 *
 * @param {Actor} actor
 * @param {string|null} rollMode  "adv", "dis", "normal", or empty for the roll's default
 */
export function ownDamageMode(actor, rollMode = "") {
	if (!fightStateActive(actor, "nerves")) return dangerousMode(actor, rollMode);
	return foldModes([has(actor, HERO_MOVES.DANGEROUS) ? "adv" : "", "dis"], rollMode || "normal");
}

/** The foes a hero has locked eyes with (Big Damn Hero), as combatant ids on the hero's combatant. */
export const LOCKED_EYES_FLAG = "lockedEyes";

/** Sizes bigger than a person, as a stat block records them. */
const BIGGER = new Set(["large", "huge"]);

/** Where these moves' words live (languages/en.json). */
const MOVE_KEY = "stonetop.fight.heroMoves";

/** Everyone an engagement entry is fighting, near or far: its melee, who it shoots, and who shoots it. */
const opponentIds = entry => [...new Set([...entry.melee, ...entry.shootingAt, ...entry.shotBy])];

/** A stat block's printed tags, lower-cased and split (the bestiary stores them as one string). */
function systemTags(system) {
	return String(system?.tags ?? "").split(",").map(tag => tag.trim().toLowerCase()).filter(Boolean);
}

/** Whether a stat block is bigger than a person: large or huge, by its size or its tags. */
function isBiggerSystem(system) {
	if (BIGGER.has(String(system?.size ?? "").toLowerCase())) return true;
	return systemTags(system).some(tag => BIGGER.has(tag));
}

/** Whether a combatant's actor is bigger than a person: a large or huge stat block. */
function isBigger(combatant) {
	return isBiggerSystem(combatant?.actor?.system);
}

/**
 * Whether Undaunted is on for this character right now, and why: "outnumbered" or "bigger". Null when
 * they do not have the move, are not in a fight on the map, or neither holds. PURE apart from the fight.
 *
 * @param {Actor} actor
 * @param {object|null} [found]  engagementOf's answer for them, when the caller has it
 * @returns {null|"outnumbered"|"bigger"}
 */
export function undauntedNow(actor, found = undefined) {
	if (!has(actor, HERO_MOVES.UNDAUNTED)) return null;
	const place = found === undefined ? rollerEngagement(actor) : found;
	if (!place) return null;
	const { entry, result, combatant } = place;
	const bodiesOf = id => place.fighters.find(f => f.id === id)?.bodies ?? 0;
	const cluster = result.clusters.find(c => c.heroIds.includes(combatant.id));
	const heroes = (cluster?.heroIds ?? []).reduce((n, id) => n + bodiesOf(id), 0);
	const foes = (cluster?.foeIds ?? []).reduce((n, id) => n + bodiesOf(id), 0);
	if (entry.attackerBodies >= 2 || (cluster && foes > heroes)) return "outnumbered";
	return opponentIds(entry).some(id => isBigger(place.combatants.get(id))) ? "bigger" : null;
}

/** Undaunted's +1d6, as the damage window offers it, or null when it is not on. */
export function undauntedOffer(actor) {
	const why = undauntedNow(actor);
	if (!why) return null;
	return {
		key: "undaunted",
		dice: "1d6",
		label: format(`stonetop.fight.heroMoves.undaunted.${why}`, {}),
		pill: format("stonetop.fight.heroMoves.undaunted.pill", {}),
		applied: true,
	};
}

// -- Remembering a particular foe ---------------------------------------------
//
// Three moves are about ONE foe rather than the fight in front of you: Nemesis and Relentless
// remember whoever survived a Clash, and But I Get Up Again remembers whoever knocked you down.
// All three key a foe the same way, and it is not always a token: a recurring villain with a
// linked actor is the SAME foe next session on another map, while an unlinked crinwin is only
// ever that token. So a linked token keys by its actor, everything else by the token itself.

/**
 * How a foe is remembered: its world actor when the token is linked, else the token itself.
 *
 * Takes a damage-row target, a Token or an Actor, because the two ends of every one of these moves
 * arrive differently — a blow is aimed at a row carrying a TOKEN uuid, while the blow that landed on
 * you names its striker as the token's own ACTOR. Both have to key the same, or a foe would be
 * remembered under one name and looked up under another.
 */
export function foeKey(target) {
	const uuid = target?.uuid ?? "";
	if (!uuid) return "";
	const doc = target?.documentName ? target : resolveSync(uuid);
	if (!doc) return uuid;
	// An unlinked token's actor belongs to that token and nowhere else: key it by the token.
	if (doc.documentName === "Actor") return doc.token?.uuid ?? doc.uuid;
	return doc.actorLink && doc.actor?.uuid ? doc.actor.uuid : (doc.uuid ?? uuid);
}

const listFlag = (actor, flag) => {
	const held = actor?.getFlag?.(SYSTEM_ID, flag);
	return Array.isArray(held) ? held : [];
};

/** Whether this character has a move to act on, and still has it switched on. */
const has = (actor, name) => actor?.type === "character" && ownsLearnedMoveNamed(actor, name);

/** That move as the Item itself, for the ones that carry a track (Anger is a Gift's Resolve). */
const ownedLearned = (actor, name) => (has(actor, name) ? ownedMove(actor, name) ?? null : null);

/**
 * Write down the foes a Clash left standing, for Nemesis ("all of your future attacks against them do
 * +1d6") and Relentless ("advantage the next time you Clash with them").
 *
 * RECORDED AT THE CLASH, not after the foe's HP is read. "Your foe survives" decides whether the move
 * ever matters again, and a foe that went down has no future attacks aimed at them to sharpen — so
 * recording every Clash and letting the dead ones sit unread is the same rule with nothing to wait for.
 * `since` is what keeps Nemesis off the very Clash that earned it: a damage roll is only sharpened when
 * the card it answers is younger than the record (see `nemesisOffer`).
 *
 * An entry already there is left alone, so `since` stays the moment this foe first survived.
 */
export async function recordClash(actor, targets = [], { now = Date.now() } = {}) {
	if (!has(actor, HERO_MOVES.NEMESIS) && !has(actor, HERO_MOVES.RELENTLESS)) return false;
	const held = listFlag(actor, CLASHED_FLAG);
	const known = new Set(held.map(entry => entry?.key));
	const fresh = [];
	for (const target of targets ?? []) {
		const key = foeKey(target);
		if (!key || known.has(key)) continue;
		known.add(key);
		fresh.push({ key, name: target.name ?? "", since: now });
	}
	if (!fresh.length) return false;
	await actor.setFlag(SYSTEM_ID, CLASHED_FLAG, [...held, ...fresh]);
	return true;
}

/** Whether every one of `targets` is a foe this character has Clashed before (Relentless). */
export function clashedBefore(actor, targets = []) {
	if (!targets?.length) return false;
	const known = new Set(listFlag(actor, CLASHED_FLAG).map(entry => entry?.key));
	return targets.every(target => known.has(foeKey(target)));
}

/**
 * Relentless: "When you Clash and your foe survives, you gain advantage the next time you Clash with
 * them." Returns what the roll card should NAME as the source of the advantage, or null.
 */
export function relentlessAgainst(actor, targets = []) {
	if (!has(actor, HERO_MOVES.RELENTLESS) || !clashedBefore(actor, targets)) return null;
	return HERO_MOVES.RELENTLESS;
}

/**
 * But I Get Up Again: "advantage on your next roll against whatever dealt the damage". Returns the
 * source to name, or null. The record is laid by I Get Knocked Down (fight/defend-spend.js).
 */
function upAgainAgainst(actor, targets = []) {
	if (!has(actor, HERO_MOVES.UP_AGAIN)) return null;
	const key = actor.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)?.key ?? "";
	if (!key || !targets?.length) return null;
	return targets.every(target => foeKey(target) === key) ? HERO_MOVES.UP_AGAIN : null;
}

/**
 * Binding Arbitration: "If they have broken their word, you gain advantage on all rolls against them
 * until they admit their wrongdoing and suffer an appropriate consequence." The Judge ticks an oath
 * broken in the scales' window (actors/character/oaths.js) and unticks it for the admission, so the
 * tick IS the condition and the advantage is simply applied, named on the card. Only rolls aimed at
 * someone reach here, which in practice is the attack moves.
 *
 * Matched the way the roster matches anyone: a row's actor, or its name, against the token's name and
 * its actor's. Every target has to be an oathbreaker, as for the other grudges here.
 */
export function oathbreakerAgainst(actor, targets = []) {
	if (!has(actor, BINDING_ARBITRATION) || !targets?.length) return null;
	const broken = readOaths(actor.getFlag?.(SYSTEM_ID, OATHS_FLAG)).filter(oath => oath.broken);
	if (!broken.length) return null;
	const index = oathIndex(broken);
	const breaker = target => {
		const doc = target?.uuid ? resolveSync(target.uuid) : null;
		const person = doc?.documentName === "Actor" ? doc : doc?.actor;
		return isSwornBy(index, { name: target?.name, id: target?.actorId, uuid: target?.uuid })
			|| (!!person && isSwornBy(index, person));
	};
	return targets.every(breaker) ? BINDING_ARBITRATION : null;
}

/** Whichever remembered foe gives this attack roll advantage, or null. One name, for the card's pill. */
export function foeAdvantage(actor, targets = [], { clash = false } = {}) {
	return (clash ? relentlessAgainst(actor, targets) : null)
		?? upAgainAgainst(actor, targets)
		?? oathbreakerAgainst(actor, targets);
}

/** Forget whoever knocked this character down, once the blow that answered it is rolled. */
export async function clearKnockedDownBy(actor) {
	if (!actor?.getFlag?.(SYSTEM_ID, KNOCKED_DOWN_FLAG)) return false;
	await actor.setFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG, null);
	return true;
}

/** Remember who knocked this character down (I Get Knocked Down), for But I Get Up Again. */
export async function recordKnockedDownBy(actor, attacker) {
	if (!has(actor, HERO_MOVES.UP_AGAIN)) return false;
	const key = foeKey(attacker);
	if (!key) return false;
	await actor.setFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG, { key, name: attacker?.name ?? "" });
	return true;
}

/**
 * Payback: remember a foe that has harmed this character. Written on the HARMED character by whoever
 * applied the damage, which is the one client guaranteed to be allowed to write something here — a
 * player taking a blow owns their own actor, and nobody but a GM may write a Combat.
 */
export async function recordHarmedBy(actor, attacker) {
	if (actor?.type !== "character" || typeof actor.setFlag !== "function") return false;
	const key = foeKey(attacker);
	if (!key) return false;
	const held = listFlag(actor, HARMED_BY_FLAG);
	if (held.includes(key)) return false;
	await actor.setFlag(SYSTEM_ID, HARMED_BY_FLAG, [...held, key]);
	return true;
}

/** Forget who has harmed a character: the fight they were hurt in is over (fight/fight-boot.js). */
export async function clearHarmedBy(actor) {
	if (!listFlag(actor, HARMED_BY_FLAG).length) return false;
	await actor.setFlag(SYSTEM_ID, HARMED_BY_FLAG, []);
	return true;
}

/** The heroes whose grudges Payback may draw on: this character, and their allies in this fight. */
function paybackParty(actor) {
	const party = [actor];
	const place = rollerEngagement(actor);
	for (const fighter of place?.fighters ?? []) {
		if (fighter.side !== HEROES) continue;
		const ally = place.combatants.get(fighter.id)?.actor ?? null;
		if (ally?.type === "character" && !party.includes(ally)) party.push(ally);
	}
	return party;
}

/** Payback: has every one of `targets` harmed this character or one of their allies? */
export function paybackEarned(actor, targets = []) {
	if (!has(actor, HERO_MOVES.PAYBACK) || !targets?.length) return false;
	const grudges = new Set(paybackParty(actor).flatMap(ally => listFlag(ally, HARMED_BY_FLAG)));
	return targets.every(target => grudges.has(foeKey(target)));
}

// -- What a blow adds --------------------------------------------------------

/**
 * Musclebound: "When you make a hand-to-hand or thrown attack, it's forceful and messy. If it would
 * already be forceful and/or messy, it's even more so."
 *
 * The weapon's own range says which attacks those are — melee (hand, close, reach) or thrown — and a
 * blow with nothing in hand is hand-to-hand by definition. A bow is neither, so it keeps its own tags.
 * Returns the weapon with the tags on, or the weapon it was given.
 */
export function muscleboundWeapon(actor, weapon) {
	if (!has(actor, HERO_MOVES.MUSCLEBOUND)) return weapon;
	const range = weapon?.range ?? ["hand"];
	if (!range.some(r => MELEE_RANGES.has(r) || r === "thrown")) return weapon;
	const base = weapon ?? { name: "", range: ["hand"] };
	const own = Array.isArray(base.tags) ? base.tags : [];
	if (own.includes("forceful") && own.includes("messy")) return base;
	return { ...base, tags: [...new Set([...own, "forceful", "messy"])] };
}

/** Whether a blow is dealt with a holy light (Hungry Flames). */
const isHolyLight = weapon => weapon?.slug === "purifying-flames-holy-light";

/** Is this character lost in their Battle Joy, with Berserker to spend it on? */
export function berserkNow(actor) {
	return has(actor, HERO_MOVES.BERSERKER) && !!actor?.getFlag?.(SYSTEM_ID, "battleJoy");
}

/**
 * A blow's own extra dice, as the damage window offers them: the move's name on each line, and ticked
 * where the rule leaves nothing to decide. `targets`, `weapon` and `strikeBack` are what the moves
 * below read; a follower's blow passes none of this and gets none of it.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {object[]} [options.targets]   who the blow is aimed at
 * @param {object|null} [options.weapon] the weapon in hand
 * @param {boolean} [options.strikeBack] a Defend strike back (p.216)
 * @param {number} [options.attackAt]    when the card this answers was written (see recordClash)
 * @returns {Array<{key: string, dice: string, label: string, pill: string, applied?: boolean, tags?: string[], spend?: Function}>}
 */
export function blowOffers(actor, { targets = [], weapon = null, strikeBack = false, attackAt = Date.now() } = {}) {
	if (actor?.type !== "character") return [];
	const offers = [];
	const undaunted = undauntedOffer(actor);
	if (undaunted) offers.push(undaunted);
	const add = (key, move, dice, { applied = true, tags = [], spend = null } = {}) => offers.push({
		key, dice, applied, tags, ...(spend ? { spend } : {}),
		label: format(`${MOVE_KEY}.${key}.label`, { dice }),
		pill: format(`${MOVE_KEY}.${key}.pill`, { dice, move }),
	});
	if (strikeBack && has(actor, HERO_MOVES.REMEMBER_ME)) add("rememberMe", HERO_MOVES.REMEMBER_ME, "1d4");
	if (isHolyLight(weapon) && has(actor, HERO_MOVES.HUNGRY_FLAMES)) add("hungryFlames", HERO_MOVES.HUNGRY_FLAMES, "1d6");
	// Nemesis rides every attack after the Clash that earned it — never the Clash's own damage, which is
	// what `since` against the card's age settles.
	if (has(actor, HERO_MOVES.NEMESIS) && targets.length) {
		const known = new Map(listFlag(actor, CLASHED_FLAG).map(entry => [entry?.key, entry]));
		const earned = targets.every(target => {
			const entry = known.get(foeKey(target));
			return entry && Number(entry.since) < attackAt;
		});
		if (earned) add("nemesis", HERO_MOVES.NEMESIS, "1d6");
	}
	if (paybackEarned(actor, targets)) add("payback", HERO_MOVES.PAYBACK, "1d4");
	// Storm Markings: "When you roil with anger, you do +1 damage until you calm down." The player says
	// when they roil and when they calm (the header's storm cloud), so while it is on the +1 is ticked.
	if (fightStateActive(actor, "roiling")) add("roiling", STORM_MARKINGS_NAME, "1");
	// Spent when it is taken: "your NEXT blow against them does +1d4". Left standing when the player
	// unticks it, because a blow they chose not to sharpen is not the blow the move was owed.
	if (upAgainAgainst(actor, targets)) add("upAgain", HERO_MOVES.UP_AGAIN, "1d4", { spend: clearKnockedDownBy });
	// Anger is a Gift: "Strike hard (+1d4 damage, forceful)" is one of five things a Would-Be Hero's
	// Resolve buys, so it opens UNTICKED with the cost in its label, and the pip comes off the move's own
	// track only once the window comes back with it ticked. That track counts Resolve HELD
	// (actors/character/MoveResources.js): "hold 2 Resolve" ticks two, and a spend unticks one.
	const anger = ownedLearned(actor, HERO_MOVES.ANGER);
	const angerMax = Number(anger?.system?.resource?.max) || 0;
	const resources = actor.typedActor?.moveResources;
	if (anger && angerMax && resources) {
		const held = heldOnTrack(resources, HERO_MOVES.ANGER, angerMax);
		if (held > 0) {
			add("anger", HERO_MOVES.ANGER, "1d4", {
				applied: false, tags: ["forceful"],
				spend: hero => hero.typedActor?.moveResources?.setUses(HERO_MOVES.ANGER, held - 1, { stonetopMove: HERO_MOVES.ANGER }),
			});
		}
	}
	// THE FICTION-GATED BONUSES. Each names a kind of foe the stat block can be read for, and a piece of
	// fiction it cannot: whether this Judge KNOWS the thing is corrupted, whether this blow EXPLOITED the
	// weakness, whether the Ranger is acting on what they learned. So the kind of foe decides whether the
	// line is drawn at all, and the player decides whether it is ticked — except Like a Dog with a Bone,
	// whose whole condition is the tag the stat block prints.
	if (targets.length) {
		if (has(actor, HERO_MOVES.DOG_WITH_BONE) && targets.every(t => targetTags(t).some(tag => CORRUPTED_TAGS.has(tag)))) {
			add("dogWithBone", HERO_MOVES.DOG_WITH_BONE, "1d6");
		}
		if (has(actor, HERO_MOVES.EVERYTHING_BLEEDS) && targets.every(t => targetTags(t).some(tag => UNNATURAL_TAGS.has(tag)))) {
			add("everythingBleeds", HERO_MOVES.EVERYTHING_BLEEDS, "1d6", { applied: false });
		}
	}
	if (has(actor, HERO_MOVES.PREDATOR)) add("predator", HERO_MOVES.PREDATOR, "1d4", { applied: false });
	// The Ranger's weak spot: the fight knows the creature is large or huge, and the player says whether
	// this blow found the spot — so these open UNTICKED.
	if (has(actor, HERO_MOVES.BIG_GAME) && targets.length && targets.every(isBigQuarry)) {
		const both = has(actor, HERO_MOVES.GIANT_SLAYER);
		add("bigGame", both ? HERO_MOVES.GIANT_SLAYER : HERO_MOVES.BIG_GAME, both ? "4" : "2", { applied: false });
	}
	return offers;
}

/** A damage row's stat block, or an empty one. */
function targetSystem(target) {
	const doc = resolveSync(target?.uuid ?? "");
	return (doc?.actor ?? doc)?.system ?? {};
}

/** Its printed tags, lower-cased. */
function targetTags(target) {
	return systemTags(targetSystem(target));
}

/** Is this target a large or huge creature (Big Game Hunter's quarry)? Reads the stat block. */
function isBigQuarry(target) {
	return isBiggerSystem(targetSystem(target));
}

// "Tainted by chaos" and "unnatural" as the bestiary writes them. A stat block says `corrupted` of
// the chaos-touched; the unnatural are everything that is not simply a beast or a person.
const CORRUPTED_TAGS = new Set(["corrupted", "chaos", "chaos-tainted"]);
const UNNATURAL_TAGS = new Set(["corrupted", "spirit", "magical", "undead", "construct", "fae", "primordial", "amorphous"]);

// -- What a character's own skin adds ----------------------------------------

/**
 * The moves that put the damage a CHARACTER TAKES at disadvantage, split by whether the table gets a
 * say. (Big Damn Hero's locked eyes lives in eyesLockedAgainst, on the attacker's side.)
 *
 *  • IMPOSED — Never Gonna Keep Me Down: "When you have 5 or fewer current HP, you impose disadvantage
 *    on any damage you take." No clause, no question: the HP box is the whole condition.
 *  • OFFERED — Uncanny Reflexes' "any damage you take THAT YOU COULD DODGE OR ROLL WITH" and
 *    Battlefield Grace's "WHILE LEADING YOUR ALLIES in battle". The sheet knows the state each needs
 *    (unarmored under a light load; allies of theirs still up), but not whether this blow is one of
 *    them — so each is a ticked box on the damage window, for the table to untick when the fiction
 *    says otherwise (combat/attack-flow.js#defenderOffers). Ticked, because the clause is the ordinary
 *    case; a blow rolled with no window keeps them for the same reason.
 *
 * ASYNC for one of the three: a load is a whole inventory build, so it is only ever asked of a
 * character who has taken Uncanny Reflexes.
 *
 * @returns {Promise<{imposed: string[], offered: string[]}>}
 */
export async function defenderDisadvantage(actor) {
	const modes = { imposed: [], offered: [] };
	if (actor?.type !== "character") return modes;
	const hp = Number(actor.system?.attributes?.hp?.value);
	if (has(actor, HERO_MOVES.NEVER_GONNA) && Number.isFinite(hp) && hp <= 5) modes.imposed.push(HERO_MOVES.NEVER_GONNA);
	if (has(actor, HERO_MOVES.BATTLEFIELD_GRACE) && leadingAllies(actor)) modes.offered.push(HERO_MOVES.BATTLEFIELD_GRACE);
	if (has(actor, HERO_MOVES.UNCANNY) && await unarmoredAndLight(actor)) modes.offered.push(HERO_MOVES.UNCANNY);
	return modes;
}

/** Battlefield Grace: is this character leading allies in this fight — is anyone else on their side up? */
function leadingAllies(actor) {
	const place = rollerEngagement(actor);
	if (!place) return false;
	return place.fighters.some(f => f.side === HEROES && f.id !== place.combatant.id && !f.out);
}

/** Uncanny Reflexes: unarmored, carrying a light or normal load. A whole inventory build, so asked rarely. */
async function unarmoredAndLight(actor) {
	const snapshot = await Promise.resolve(actor.typedActor?.buildSnapshot?.()).catch(() => null);
	if (!snapshot) return false;
	if (Number(snapshot.vitals?.wornArmor) > 0) return false;
	const load = snapshot.inventory?.outfit?.load ?? snapshot.inventory?.load ?? null;
	return ["light", "normal"].includes(String(load?.selected ?? ""));
}

/** The foes in the fight a character could lock eyes with: whoever they are fighting, near or far. */
export function lockEyesCandidates(actor) {
	const place = rollerEngagement(actor);
	if (!place) return [];
	const locked = new Set(place.combatant.flags?.[SYSTEM_ID]?.[LOCKED_EYES_FLAG] ?? []);
	return opponentIds(place.entry).filter(id => !locked.has(id)).map(id => place.combatants.get(id)).filter(Boolean);
}

/**
 * Lock eyes with a foe: the hero's combatant keeps its id, and the foe rolls damage against the hero and
 * their ward with disadvantage from now on. Returns whether it was written.
 */
export async function lockEyes(actor, foeCombatantId) {
	const mine = rollerEngagement(actor)?.combatant;
	if (!mine || !foeCombatantId) return false;
	const had = mine.flags?.[SYSTEM_ID]?.[LOCKED_EYES_FLAG] ?? [];
	if (had.includes(foeCombatantId)) return false;
	await mine.update({ [`flags.${SYSTEM_ID}.${LOCKED_EYES_FLAG}`]: [...had, foeCombatantId] });
	return true;
}

/**
 * The heroes whose locked eyes put a foe's damage roll at disadvantage against these targets: a target who
 * locked eyes with the roller, or who stands beside a hero who did. Empty when none.
 *
 * @param {Actor} foe  the roller
 * @param {Array<{uuid: string}>} targets
 * @returns {string[]} the heroes' names
 */
export function eyesLockedAgainst(foe, targets = []) {
	if (!targets?.length) return [];
	// Asked on every aimed damage roll, by anyone: the fight is only worked out once somebody in it has
	// locked eyes with a foe.
	const combatants = [...(fightOnScene(globalThis.canvas?.scene ?? null)?.combatants ?? [])];
	if (!combatants.some(c => c.flags?.[SYSTEM_ID]?.[LOCKED_EYES_FLAG]?.length)) return [];
	const place = rollerEngagement(foe);
	if (!place) return [];
	const byUuid = new Map([...place.combatants.values()].map(c => [c.token?.uuid, c]));
	const fighter = id => place.fighters.find(f => f.id === id);
	const grid = gridOf(place.scene);
	const lockers = place.fighters.filter(f => f.side === HEROES
		&& (place.combatants.get(f.id)?.flags?.[SYSTEM_ID]?.[LOCKED_EYES_FLAG] ?? []).includes(place.combatant.id));
	const names = [];
	for (const target of targets) {
		const hit = byUuid.get(target?.uuid);
		const hitFighter = hit ? fighter(hit.id) : null;
		if (!hitFighter) continue;
		for (const hero of lockers) {
			if (hero.id === hitFighter.id || touching(hero, hitFighter, grid)) {
				if (!names.includes(hero.name)) names.push(hero.name);
			}
		}
	}
	return names;
}
