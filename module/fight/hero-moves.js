// Playbook moves that change a blow in a fight, read off the fight on the map.
//
// Most of what a character's moves do in a fight is fiction, and stays the table's. These change a number
// the damage card is about to write, or a die a foe is about to roll, and the fight already knows the
// facts they turn on:
//  • UNDAUNTED (Would-Be Hero): "When you are outnumbered or facing a foe bigger than you, you get +1 armor
//    and deal +1d6 damage." Outnumbered is the fight's count: more than one on them, or more foes than
//    heroes in their engagement. Bigger is the stat block's size, large or huge. Where the fight does
//    not show it (no fight on the map, the Fight tab off, "bigger than you" no size on the stat block),
//    both halves are offered UNTICKED for the table to call (the user's ruling, 2026-09-27).
//  • BIG DAMN HERO (Would-Be Hero): "When you Defend, you can spend 1 Readiness to lock eyes with an
//    attacker; they have disadvantage on damage rolls against you and your ward for the rest of the fight."
//    Kept on the hero's combatant, so it ends with the fight. The ward is whoever stands beside the hero:
//    the fight has no record of who a character is protecting, and a Defend is made for the people right
//    there. Its first half, "When you first leap into danger to protect someone, don't roll to Defend.
//    Instead, treat it as though you rolled a 10+", is `leapIn`: once per fight, kept on the combatant
//    beside the locked eyes.
//  • TOUGH LOVE (Would-Be Hero): "When you honestly think another PC is in the wrong and call them on it,
//    they have disadvantage on any rolls against you until you two work it out." The hero names the PC
//    (`callOut`) and clears it by hand (`workedItOut`); that PC's rolls aimed at the hero read it
//    (`toughLoveAgainst`), the other side of Binding Arbitration's oathbreaker.
//  • DANGEROUS (Heavy): "When you deal your damage, you have advantage." Every roll of the character's own
//    damage, in a fight or not; it meets a strike back's disadvantage and the two cancel.
//  • MUSCLEBOUND (Heavy): "When you make a hand-to-hand or thrown attack, it's forceful and messy."
//  • SOMETHING TO REMEMBER ME BY (Would-Be Hero): "+1d4" on a strike back bought with Readiness.
//  • SECOND INTENT (Fox): a Parry & Riposte also picks 1 from the Ambush list, and "Deal +1d4 damage" is
//    one of them. Offered UNTICKED on the parry's strike back, since the pick may be another option.
//  • HUNGRY FLAMES (Lightbearer): "+1d6" whenever the blow is dealt with a holy light.
//  • BIG GAME HUNTER / GIANT SLAYER (Ranger): "+2" / "another +2" at the weak spot of a large or huge
//    creature. The fight knows the size; whether this blow found the weak spot is the table's, so the
//    window opens with the box UNTICKED.
//  • NEMESIS / RELENTLESS (Heavy): both turn on "when you Clash and your foe survives", so both read the
//    same record of the foes this character has Clashed (`clashedWith`). A foe that did NOT survive never
//    comes up again, which is why the record is written at the Clash rather than waiting on the corpse.
//  • PAYBACK (Heavy): "+1d4" against a foe that has harmed this character or an ally. Apply writes who hurt
//    whom on the HARMED character (`harmedBy`), because Apply often runs on a player's client, which cannot
//    write the Combat document. A follower is an ally too (the user's ruling): a blow on one is written on
//    the character it follows.
//  • BLOOD-SOAKED PAST (Heavy background): "When you fight to kill without mercy or hesitation, you deal
//    +1d4 damage." Pure fiction, so a standing UNTICKED line, like Predator's.
//  • NEVER GONNA KEEP ME DOWN (Would-Be Hero) at 5 HP or less, UNCANNY REFLEXES (Heavy) unarmored under a
//    light or normal load, and BATTLEFIELD GRACE (Marshal) leading allies: each puts the damage THEY take
//    at disadvantage, like locked eyes from the other side.
//  • FOCUS FIRE (Marshal, Book I p.127): "You can spend 1 Command to order your allies to bring down a foe. If
//    you do, each ally has advantage on their next damage roll against that foe." The order is kept on the
//    Marshal (`focusFire`, one entry per foe named, for the fight it was given in), and each ally's damage roll
//    against that foe reads it as a TICKED advantage line on their damage window (blowOffers) and, taken, marks
//    it answered on THEMSELVES (`focusFireUsed`), the one actor their client may write. Ordered from Focus
//    Fire's posted card (give-advantage-flow.js#wireFocusFire).
//  • SET-UP STRIKE (Marshal, p.126): "When you Clash and get a 7+, you can choose to deal damage with
//    disadvantage." An UNTICKED disadvantage line on the Clash's damage window; the Aid it buys is the Clash
//    card's button (actors/character/give-advantage.js).
// The Defend spends on the damage card (Parry & Riposte, Steadfast Guardian, A Mighty Rampart) are in
// defend-spend.js.

import { SYSTEM_ID } from "../system-id.js";
import { format } from "../utils/i18n.js";
import { ownsLearnedMoveNamed, ownedMove } from "../actors/character/owns-move.js";
import { heldOnTrack, learnedTrack } from "../actors/character/MoveResources.js";
import { characterBehind, followerCardFor } from "../actors/character/follower-masters.js";
import { actorTookBackground } from "../actors/character/took-background.js";
import { BLOOD_SOAKED_PAST } from "../data/alt-stat-grants.js";
import { MELEE_RANGES } from "../data/weapons.js";
import { betterMode, foldModes } from "../utils/roll-mode.js";
import { fightStateActive, STORM_MARKINGS_NAME } from "../actors/character/fight-states.js";
import { BINDING_ARBITRATION, OATHS_FLAG, readOaths, oathIndex, isBoundBy } from "../actors/character/oaths.js";
import { asteriskMoveUsed } from "../actors/character/WouldBeHeroAsterisk.js";
import { HEROES, touching } from "./engagements.js";
import { fightOnScene, gridOf } from "./fight-state.js";
import { rollerEngagement } from "./damage-seed.js";
import { resolveSync } from "../utils/foundry-compat.js";
import { escHtml } from "../utils/strings.js";
import { damageRowActor } from "../utils/damage.js";
import { stonetopChatCard } from "../utils/chat.js";
import { asArray } from "../utils/playbook-actors.js";
import { HERO_MOVES } from "./hero-move-names.js";

export { HERO_MOVES };

// How much Command a Marshal holds: in combat/command-holders.js, which the steading sheet loads without this.
export { commandHeld } from "../combat/command-holders.js";

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

/**
 * Whoever knocked this character down (But I Get Up Again), as `{key, name, roll, blow}` on the actor:
 * `roll` while the advantage on the next roll against them is owed, `blow` while the +1d4 on the next
 * blow is. Each half is spent on its own. A record written before the split (`{key, name}`) owes both.
 */
export const KNOCKED_DOWN_FLAG = "knockedDownBy";

/** The PCs a Would-Be Hero has called on it (Tough Love), as `{id, name}` on the hero. */
export const TOUGH_LOVE_FLAG = "toughLove";

/** Whether a hero has made Big Damn Hero's leap in this fight, on the hero's combatant. */
export const LEAPT_IN_FLAG = "leaptIn";

/** The foes an Alpha's 10+ asserted dominance over (Alpha), as `{key, name}` on the actor. */
export const ALPHA_FLAG = "alphaOver";

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
 * Marshal's shaken nerves ("disadvantage on all rolls until you share your nagging doubts", We Happy Few's 6-;
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

/** A Marshal's Focus Fire orders (see the head of this file), as `{id, key, name, combat}` on the Marshal. */
export const FOCUS_FIRE_FLAG = "focusFire";

/** The Focus Fire orders an ally's damage roll has answered, as their ids on the ally. */
export const FOCUS_FIRE_USED_FLAG = "focusFireUsed";

/**
 * Focus Fire: the Marshal spends 1 Command off Stentorian's track (a hold pool, so 1 comes off what is HELD)
 * and names `foe`. Null, with nothing spent, without the move learned, a foe to name, or Command held.
 *
 * @param {Actor} marshal
 * @param {{uuid: string, name?: string}} foe
 * @returns {Promise<{id: string, key: string, name: string, combat: string|null}|null>}
 */
export async function orderFocusFire(marshal, foe, { now = Date.now(), combat = globalThis.game?.combat ?? null, combats = globalThis.game?.combats } = {}) {
	if (!has(marshal, HERO_MOVES.FOCUS_FIRE)) return null;
	const key = foeKey(foe);
	if (!key) return null;
	const track = learnedTrack(marshal, HERO_MOVES.STENTORIAN);
	if (!track || track.held <= 0) return null;
	const entry = { id: `${marshal.id}.${now}`, key, name: foe?.name ?? "", combat: combat?.id ?? null };
	// An order given in a fight that has since been deleted can never be answered (focusFireAgainst's `live`),
	// so it is let go here rather than kept on the Marshal for good. Only where the fights can be read: with no
	// list to ask, every order is kept as it was.
	const kept = combats?.get ? listFlag(marshal, FOCUS_FIRE_FLAG).filter(order => liveOrder(order, combats)) : listFlag(marshal, FOCUS_FIRE_FLAG);
	// The Command and the order in ONE write, attributed to Stentorian for the ledger as a spend off its track is.
	await marshal.update({
		...track.resources.usesUpdate(HERO_MOVES.STENTORIAN, track.held - 1),
		[`flags.${SYSTEM_ID}.${FOCUS_FIRE_FLAG}`]: [...kept, entry],
	}, { stonetopMove: HERO_MOVES.STENTORIAN });
	return entry;
}

/** Whether a Focus Fire order can still be answered: given outside any fight, or in one that still exists. */
const liveOrder = (order, combats) => !order?.combat || !!combats?.get?.(order.combat);

/**
 * The Focus Fire order this character's damage roll at `targets` answers, or null: another character's, with
 * the move still learned, naming the foe every one of `targets` is, given in a fight that is still on (or
 * outside any), and not yet answered by this character. "Each ally": never the Marshal's own blow.
 */
export function focusFireAgainst(actor, targets = [], { actors = globalThis.game?.actors, combats = globalThis.game?.combats } = {}) {
	if (actor?.type !== "character" || !targets?.length) return null;
	const used = new Set(listFlag(actor, FOCUS_FIRE_USED_FLAG));
	const keys = targets.map(foeKey);
	for (const marshal of focusFireMarshals(actor, actors)) {
		const entry = listFlag(marshal, FOCUS_FIRE_FLAG)
			.find(order => order?.id && !used.has(order.id) && liveOrder(order, combats) && keys.every(key => key && key === order.key));
		if (entry) return entry;
	}
	return null;
}

/** The Marshals whose orders `actor` may answer: everyone else with Focus Fire learned. */
function focusFireMarshals(actor, actors) {
	return asArray(actors).filter(marshal => marshal && marshal !== actor && !(marshal.id && marshal.id === actor.id)
		&& has(marshal, HERO_MOVES.FOCUS_FIRE));
}

/**
 * Mark a Focus Fire order answered by this character's damage roll: it was for their NEXT one. The ids of
 * orders that no Marshal still holds live (deleted, or given in a fight since deleted) are let go on the way,
 * since focusFireAgainst could never match them again; only where the fights can be read.
 */
export async function spendFocusFire(actor, entry, { actors = globalThis.game?.actors, combats = globalThis.game?.combats } = {}) {
	if (!entry?.id || typeof actor?.setFlag !== "function") return false;
	const used = listFlag(actor, FOCUS_FIRE_USED_FLAG);
	if (used.includes(entry.id)) return false;
	let kept = used;
	if (combats?.get) {
		const live = new Set(focusFireMarshals(actor, actors)
			.flatMap(marshal => listFlag(marshal, FOCUS_FIRE_FLAG).filter(order => liveOrder(order, combats)).map(order => order?.id)));
		kept = used.filter(id => live.has(id));
	}
	await actor.setFlag(SYSTEM_ID, FOCUS_FIRE_USED_FLAG, [...kept, entry.id]);
	return true;
}

/**
 * Focus Fire as a line on this character's damage window (blowOffers): advantage, TICKED, against the foe a
 * Marshal ordered their allies to bring down. Taking it marks the order answered: it was for the NEXT damage
 * roll against that foe. Unticked, the order stands for the next one, as an unticked But I Get Up Again does.
 * Null when no order is owed.
 */
function focusFireOffer(actor, targets) {
	const order = focusFireAgainst(actor, targets);
	if (!order) return null;
	return {
		key: "focusFire", mode: "adv", applied: true,
		label: format(`${MOVE_KEY}.focusFire.label`, { foe: order.name }),
		pill: format(`${MOVE_KEY}.focusFire.pill`, {}),
		spend: hero => spendFocusFire(hero, order).catch(err => console.warn("Stonetop | could not mark Focus Fire answered", err)),
	};
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

/**
 * Whether Undaunted is the TABLE'S TO CALL right now: the character has the move, and the fight does not
 * show it holding. No fight on the map, the Fight tab off, or a fight that finds them neither outnumbered
 * nor facing a large or huge stat block, which is not the same as not facing someone bigger than them: a
 * Would-Be Hero may be "still a child", and a stat block prints no size for a grown raider. So wherever
 * undauntedNow is null, the table says (the user's ruling, 2026-09-27).
 *
 * @param {Actor} actor
 * @param {object|null} [found]  engagementOf's answer for them, when the caller has it
 */
export function undauntedUnread(actor, found = undefined) {
	return has(actor, HERO_MOVES.UNDAUNTED) && !undauntedNow(actor, found);
}

/**
 * Undaunted's +1d6, as the damage window offers it, or null when the character does not hold the move:
 * TICKED where the fight says it holds, UNTICKED where the fight cannot say (undauntedUnread, which is
 * every other case, so the fight is asked once). Taking it is a use of the starred move
 * (WouldBeHeroAsterisk.js#asteriskMoveUsed).
 */
export function undauntedOffer(actor) {
	if (!has(actor, HERO_MOVES.UNDAUNTED)) return null;
	const why = undauntedNow(actor);
	return {
		key: "undaunted",
		dice: "1d6",
		label: format(`stonetop.fight.heroMoves.undaunted.${why ?? "unread"}`, {}),
		pill: format("stonetop.fight.heroMoves.undaunted.pill", {}),
		applied: !!why,
		spend: hero => asteriskMoveUsed(hero, HERO_MOVES.UNDAUNTED),
	};
}

// -- Remembering a particular foe ---------------------------------------------
//
// Four moves are about ONE foe rather than the fight in front of you: Nemesis and Relentless
// remember whoever survived a Clash, But I Get Up Again remembers whoever knocked you down, and
// Alpha remembers whoever its 10+ cowed. All four key a foe the same way, and it is not always a token: a recurring villain with a
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
 * The record I Get Knocked Down laid (KNOCKED_DOWN_FLAG), with both halves read: an entry written before
 * the split carries neither, and owes both. Null when there is none.
 */
function knockedDownRecord(actor) {
	const held = actor?.getFlag?.(SYSTEM_ID, KNOCKED_DOWN_FLAG);
	if (!held?.key) return null;
	return { key: held.key, name: held.name ?? "", roll: held.roll !== false, blow: held.blow !== false };
}

/** Whether But I Get Up Again still owes `part` ("roll" or "blow") against every one of `targets`. */
function upAgainOwes(actor, targets, part) {
	if (!has(actor, HERO_MOVES.UP_AGAIN) || !targets?.length) return false;
	const record = knockedDownRecord(actor);
	if (!record?.[part]) return false;
	return targets.every(target => foeKey(target) === record.key);
}

/**
 * But I Get Up Again: "you have advantage on your next roll against whatever dealt the damage and your
 * next blow against them does +1d4 damage." Two halves, each spent on its own: this is the ROLL's, asked
 * by every roll aimed at that foe (an attack's through foeAdvantage, any other move's in
 * StonetopCharacter#onRoll) and spent once its dice land (spendUpAgainRoll). Returns the source to name,
 * or null. The record is laid by I Get Knocked Down (fight/defend-spend.js).
 */
export function upAgainAgainst(actor, targets = []) {
	return upAgainOwes(actor, targets, "roll") ? HERO_MOVES.UP_AGAIN : null;
}

/** Spend one half of the record, and let the whole record go once neither is owed. Whether it spent. */
async function spendKnockedDown(actor, part) {
	const record = knockedDownRecord(actor);
	if (!record?.[part]) return false;
	const rest = { ...record, [part]: false };
	await actor.setFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG, rest.roll || rest.blow ? rest : null);
	return true;
}

/** Spend But I Get Up Again's advantage once a roll against `targets` has been made: it was for the NEXT roll. */
export async function spendUpAgainRoll(actor, targets = []) {
	if (!upAgainAgainst(actor, targets)) return false;
	return spendKnockedDown(actor, "roll");
}

/**
 * Binding Arbitration: "If they have broken their word, you gain advantage on all rolls against them
 * until they admit their wrongdoing and suffer an appropriate consequence." The Judge ticks an oath
 * broken in the scales' window (actors/character/oaths.js) and unticks it for the admission, so the
 * tick IS the condition and the advantage is simply applied, named on the card. Every roll aimed at
 * someone asks it (the user's ruling: all rolls, not only attacks; damage rolls aside): an attack at
 * the foes it targets (attackFoeAdvantage), and any other move at the tokens targeted or the player
 * character it is aimed at (StonetopCharacter#onRoll). A roll aimed at nobody offers it as an unticked
 * line instead (StonetopCharacter#rollOffers, off brokenOaths).
 *
 * Matched STRICTLY (oaths.js#isBoundBy): a row linked to an actor binds that actor and its tokens, a
 * row laid on one unlinked token binds that token alone, and only a name-only row is matched by name,
 * against the token's name and its actor's. A second "Guard" who merely shares a linked row's
 * spelling swore nothing. Any of the person's rows ticked broken is enough (one row per oath). Every
 * target has to be an oathbreaker, as for the other grudges here.
 */
export function oathbreakerAgainst(actor, targets = []) {
	if (!targets?.length) return null;
	const broken = brokenOaths(actor);
	if (!broken.length) return null;
	const index = oathIndex(broken);
	const breaker = target => {
		const doc = target?.uuid ? resolveSync(target.uuid) : null;
		const person = damageRowActor(doc);
		return isBoundBy(index, { name: target?.name, id: target?.actorId, uuid: target?.uuid })
			|| (!!person && isBoundBy(index, person));
	};
	return targets.every(breaker) ? BINDING_ARBITRATION : null;
}

/** The oaths this character holds ticked broken, while Binding Arbitration is learned; [] otherwise. */
export function brokenOaths(actor) {
	if (!has(actor, BINDING_ARBITRATION)) return [];
	return readOaths(actor.getFlag?.(SYSTEM_ID, OATHS_FLAG)).filter(oath => oath.broken);
}

// -- Tough Love ---------------------------------------------------------------

/** The PCs this hero has called on it (`{id, name}`), while Tough Love is learned; [] otherwise. */
export function toughLoveHeld(hero) {
	if (!has(hero, HERO_MOVES.TOUGH_LOVE)) return [];
	return listFlag(hero, TOUGH_LOVE_FLAG).filter(entry => entry?.id);
}

/**
 * Tough Love, from the other side: "they have disadvantage on any rolls against you until you two work it
 * out." The reverse of oathbreakerAgainst. Asked by the ROLLER's roll: every one of `targets` has to be a
 * Would-Be Hero holding Tough Love against this roller, as every grudge here asks of every target. Returns
 * the source to name on the card, or null. Damage rolls aside, as for Binding Arbitration.
 *
 * A target is a token (an attack's, or one this user targeted) or the character an Interfere or a
 * Persuade (vs. PCs) was aimed at (`Actor.<id>`, StonetopCharacter#_rollTargets).
 *
 * @param {Actor} roller
 * @param {Array<{uuid: string, actorId?: string}>} targets
 */
export function toughLoveAgainst(roller, targets = [], { resolve = resolveSync, actors = globalThis.game?.actors } = {}) {
	if (roller?.type !== "character" || !roller.id || !targets?.length) return null;
	const calledOn = target => {
		const doc = target?.uuid ? resolve(target.uuid) : null;
		const hero = damageRowActor(doc) ?? (target?.actorId ? actors?.get?.(target.actorId) ?? null : null);
		return !!hero && hero.id !== roller.id && toughLoveHeld(hero).some(entry => entry.id === roller.id);
	};
	return targets.every(calledOn) ? HERO_MOVES.TOUGH_LOVE : null;
}

/**
 * The hero calls `pc` on it (Tough Love), and the table is told on a card. Several may be held at once.
 * Whether it was written.
 */
export async function callOut(hero, pc) {
	if (!has(hero, HERO_MOVES.TOUGH_LOVE) || pc?.type !== "character" || !pc.id || pc.id === hero.id) return false;
	const held = listFlag(hero, TOUGH_LOVE_FLAG);
	if (held.some(entry => entry?.id === pc.id)) return false;
	await hero.setFlag(SYSTEM_ID, TOUGH_LOVE_FLAG, [...held, { id: pc.id, name: pc.name ?? "" }]);
	await postToughLove(hero, "called", pc.name ?? "");
	return true;
}

/**
 * "Until you two work it out": the hero lets the PC with this actor id go, and says so on a card. Whether
 * anything changed.
 */
export async function workedItOut(hero, pcId) {
	const held = listFlag(hero, TOUGH_LOVE_FLAG);
	const gone = held.find(entry => entry?.id === pcId);
	if (!gone) return false;
	await hero.setFlag(SYSTEM_ID, TOUGH_LOVE_FLAG, held.filter(entry => entry?.id !== pcId));
	await postToughLove(hero, "workedOut", gone.name ?? "");
	return true;
}

/** Tough Love's card: `said` is "called" or "workedOut", in the move's own words (languages/en.json). */
function postToughLove(hero, said, other) {
	return globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.TOUGH_LOVE, `<div class="card-content"><p>${escHtml(format(`${MOVE_KEY}.toughLove.${said}`, { name: hero.name, other }))}</p></div>`, "stonetop-tough-love-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: hero }),
	});
}

/**
 * Alpha: "on a 10+, you also have advantage on your next roll against them." Returns the source to
 * name, or null. The record is laid by the Alpha roll's 10+ (actors/character/tier-effects.js), one
 * entry per foe it was aimed at, and spent by the next roll aimed at them (spendAlphaOver). Every
 * target has to be one of them, as for the other grudges here.
 */
export function alphaAgainst(actor, targets = []) {
	if (!has(actor, HERO_MOVES.ALPHA) || !targets?.length) return null;
	const known = new Set(listFlag(actor, ALPHA_FLAG).map(entry => entry?.key));
	return targets.every(target => known.has(foeKey(target))) ? HERO_MOVES.ALPHA : null;
}

/**
 * Remember the foes (`{key, name}`, keyed by foeKey) an Alpha's 10+ asserted dominance over. A foe
 * already there is written again rather than twice. Whether anything was written.
 */
export async function recordAlphaOver(actor, foes = []) {
	if (!has(actor, HERO_MOVES.ALPHA)) return false;
	const fresh = (foes ?? []).filter(foe => foe?.key);
	if (!fresh.length) return false;
	const keys = new Set(fresh.map(foe => foe.key));
	const kept = listFlag(actor, ALPHA_FLAG).filter(entry => !keys.has(entry?.key));
	await actor.setFlag(SYSTEM_ID, ALPHA_FLAG, [...kept, ...fresh.map(({ key, name }) => ({ key, name: name ?? "" }))]);
	return true;
}

/** Forget the Alpha entries under these foe keys: a roll against them spent it, or a Shift took the 10+ back. */
export async function forgetAlphaOver(actor, keys = []) {
	const drop = new Set(keys ?? []);
	const held = listFlag(actor, ALPHA_FLAG);
	const kept = held.filter(entry => !drop.has(entry?.key));
	if (kept.length === held.length) return false;
	await actor.setFlag(SYSTEM_ID, ALPHA_FLAG, kept);
	return true;
}

/** Spend Alpha's advantage once a roll against `targets` has been made: it was for the NEXT roll only. */
export async function spendAlphaOver(actor, targets = []) {
	if (!alphaAgainst(actor, targets)) return false;
	return forgetAlphaOver(actor, targets.map(foeKey));
}

/** Whichever remembered foe gives this attack roll advantage, or null. One name, for the card's pill. */
export function foeAdvantage(actor, targets = [], { clash = false } = {}) {
	return (clash ? relentlessAgainst(actor, targets) : null)
		?? upAgainAgainst(actor, targets)
		?? alphaAgainst(actor, targets)
		?? oathbreakerAgainst(actor, targets);
}

/**
 * Spend But I Get Up Again's +1d4, once the blow that answered it is rolled. The advantage half is left
 * as it was: it is the next ROLL's (spendUpAgainRoll), and a Clash that missed never gets to a blow.
 */
export async function spendUpAgainBlow(actor) {
	return spendKnockedDown(actor, "blow");
}

/**
 * Remember who knocked this character down (I Get Knocked Down), for But I Get Up Again: both halves
 * owed afresh, whatever the last knock-down left.
 */
export async function recordKnockedDownBy(actor, attacker) {
	if (!has(actor, HERO_MOVES.UP_AGAIN)) return false;
	const key = foeKey(attacker);
	if (!key) return false;
	await actor.setFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG, { key, name: attacker?.name ?? "", roll: true, blow: true });
	return true;
}

/**
 * Payback: remember a foe that has harmed this character. Written on the HARMED character by whoever
 * applied the damage, which is the one client guaranteed to be allowed to write something here — a
 * player taking a blow owns their own actor, and nobody but a GM may write a Combat.
 *
 * A FOLLOWER's harm is written on the character it follows: "one of your allies" takes in the Heavy's
 * followers and every ally's (the user's ruling), and the character's flag is the one the fight's end
 * already clears (combat/readiness-loss.js). An NPC who follows nobody is left alone.
 *
 * @param {Actor} actor     who took the blow
 * @param {Actor} attacker  who dealt it
 * @param {object} [options]
 * @param {Function} [options.cardFor]  follower-masters.js#followerCardFor (injectable for tests)
 */
export async function recordHarmedBy(actor, attacker, { cardFor = followerCardFor } = {}) {
	const holder = characterBehind(actor, cardFor);
	if (holder?.type !== "character" || typeof holder.setFlag !== "function") return false;
	const key = foeKey(attacker);
	if (!key) return false;
	const held = listFlag(holder, HARMED_BY_FLAG);
	if (held.includes(key)) return false;
	await holder.setFlag(SYSTEM_ID, HARMED_BY_FLAG, [...held, key]);
	return true;
}

/** Forget who has harmed a character: the fight they were hurt in is over (fight/fight-boot.js). */
export async function clearHarmedBy(actor) {
	if (!listFlag(actor, HARMED_BY_FLAG).length) return false;
	await actor.setFlag(SYSTEM_ID, HARMED_BY_FLAG, []);
	return true;
}

/**
 * The heroes whose grudges Payback may draw on: this character, and their allies in this fight. A
 * follower fighting here brings the character it follows, whose flag holds the follower's grudges
 * (see recordHarmedBy), even when that character is not in the fight themselves.
 */
function paybackParty(actor, { cardFor = followerCardFor } = {}) {
	const party = [actor];
	const place = rollerEngagement(actor);
	for (const fighter of place?.fighters ?? []) {
		if (fighter.side !== HEROES) continue;
		const ally = place.combatants.get(fighter.id)?.actor ?? null;
		const hero = characterBehind(ally, cardFor);
		if (hero?.type === "character" && !party.includes(hero)) party.push(hero);
	}
	return party;
}

/** Payback: has every one of `targets` harmed this character or one of their allies (followers too)? */
export function paybackEarned(actor, targets = [], { cardFor = followerCardFor } = {}) {
	if (!has(actor, HERO_MOVES.PAYBACK) || !targets?.length) return false;
	const grudges = new Set(paybackParty(actor, { cardFor }).flatMap(ally => listFlag(ally, HARMED_BY_FLAG)));
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

/**
 * Is this character lost in their Battle Joy, with Berserker to spend it on? Battle Joy itself must
 * still be learned: a rage left on the sheet after the move was un-learned is no Battle Joy.
 */
export function berserkNow(actor) {
	return has(actor, HERO_MOVES.BERSERKER) && has(actor, "Battle Joy")
		&& !!actor?.getFlag?.(SYSTEM_ID, "battleJoy");
}

/** One line of the damage window, worded from the move's own `heroMoves.<key>` strings. */
function offerLine(key, move, dice, { applied = true, tags = [], spend = null } = {}) {
	return {
		key, dice, applied, tags, ...(spend ? { spend } : {}),
		label: format(`${MOVE_KEY}.${key}.label`, { dice }),
		pill: format(`${MOVE_KEY}.${key}.pill`, { dice, move }),
	};
}

/**
 * What the character's moves add to damage dealt WITH A HOLY LIGHT: Hungry Flames' "When you deal damage
 * with a holy light, you deal +1d6 damage", ticked. A holy-light blow gets it through blowOffers; an
 * Invocation's own damage, which is dealt with the light but is no weapon's blow (Go Back to the Shadow,
 * actors/character/invocation-apply.js), asks for it here, so the line is the same line either way.
 */
export function holyLightOffers(actor) {
	return has(actor, HERO_MOVES.HUNGRY_FLAMES) ? [offerLine("hungryFlames", HERO_MOVES.HUNGRY_FLAMES, "1d6")] : [];
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
 * @param {boolean} [options.parry]      that strike back is the one a Parry & Riposte bought, rather than
 *   the plain Defend option the fight ring's Strike back spends on (Second Intent rides only this one)
 * @param {number} [options.attackAt]    when the card this answers was written (see recordClash)
 * @param {string} [options.moveKey]     the attack move's key ("clash": Set-Up Strike rides its damage)
 * @returns {Array<{key: string, dice: string, label: string, pill: string, applied?: boolean, tags?: string[], spend?: Function}>}
 */
export function blowOffers(actor, { targets = [], weapon = null, strikeBack = false, parry = false, attackAt = Date.now(), moveKey = "" } = {}) {
	if (actor?.type !== "character") return [];
	const offers = [];
	const undaunted = undauntedOffer(actor);
	if (undaunted) offers.push(undaunted);
	const add = (key, move, dice, options) => offers.push(offerLine(key, move, dice, options));
	// Set-Up Strike: the damage of a Clash's 7+ (the attack card's Confirm), dealt with disadvantage by choice.
	// A mode line, as the defenders' are, UNTICKED: whether they set the strike up is theirs to say.
	if (moveKey === "clash" && !strikeBack && has(actor, HERO_MOVES.SET_UP_STRIKE)) {
		offers.push({
			key: "setUpStrike", mode: "dis", applied: false,
			label: format(`${MOVE_KEY}.setUpStrike.label`, {}),
			pill: format(`${MOVE_KEY}.setUpStrike.pill`, {}),
		});
	}
	// Focus Fire: a Marshal's order to bring this foe down, advantage on this ally's next damage roll at it.
	const focus = focusFireOffer(actor, targets);
	if (focus) offers.push(focus);
	if (strikeBack && has(actor, HERO_MOVES.REMEMBER_ME)) add("rememberMe", HERO_MOVES.REMEMBER_ME, "1d4");
	// Second Intent: "When you Defend and spend 1 Readiness to Parry & Riposte, also pick 1 option from the
	// Ambush list", and "Deal +1d4 damage" is on it. UNTICKED: the pick is the player's, and may be another
	// option. Whether they took it here is what the Second Intent card then says (defend-spend.js).
	if (strikeBack && parry && has(actor, HERO_MOVES.SECOND_INTENT)) add("secondIntent", HERO_MOVES.SECOND_INTENT, "1d4", { applied: false });
	if (isHolyLight(weapon)) offers.push(...holyLightOffers(actor));
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
	// unticks it, because a blow they chose not to sharpen is not the blow the move was owed. Its own half
	// of the record: the advantage on the next roll is spent by that roll, and neither waits on the other.
	if (upAgainOwes(actor, targets, "blow")) add("upAgain", HERO_MOVES.UP_AGAIN, "1d4", { spend: spendUpAgainBlow });
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
		if (has(actor, HERO_MOVES.DOG_WITH_BONE) && targets.every(isCorruptedFoe)) {
			add("dogWithBone", HERO_MOVES.DOG_WITH_BONE, "1d6");
		}
		if (has(actor, HERO_MOVES.EVERYTHING_BLEEDS) && targets.every(isUnnaturalFoe)) {
			add("everythingBleeds", HERO_MOVES.EVERYTHING_BLEEDS, "1d6", { applied: false });
		}
	}
	if (has(actor, HERO_MOVES.PREDATOR)) add("predator", HERO_MOVES.PREDATOR, "1d4", { applied: false });
	// Blood-Soaked Past: "When you fight to kill without mercy or hesitation, you deal +1d4 damage." Nothing
	// on the map says how this blow was meant, so it is a standing unticked line, as Predator's is.
	if (actorTookBackground(actor, BLOOD_SOAKED_PAST)) add("withoutMercy", BLOOD_SOAKED_PAST.label, "1d4", { applied: false });
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

/** Is this target a large or huge creature (Big Game Hunter's quarry)? Reads the stat block. */
function isBigQuarry(target) {
	return isBiggerSystem(targetSystem(target));
}

// "Tainted by chaos" and "unnatural" as the bestiary writes them. A stat block says `corrupted` of
// the chaos-touched; the unnatural are everything that is not simply a beast or a person.
const CORRUPTED_TAGS = new Set(["corrupted", "chaos", "chaos-tainted"]);
const UNNATURAL_TAGS = new Set(["corrupted", "spirit", "magical", "undead", "construct", "fae", "primordial", "amorphous", "emanation"]);
// The stat block's creature type says the same thing (bestiary/creature-types.js). The user's ruling
// (2026-09-26 Seeker audit): every type but these three is unnatural, the Makers and the unknown included.
const NATURAL_CREATURE_TYPES = new Set(["human-individual", "human-group", "natural-beast"]);

/** A stat block's creature type slug, or "" for one that names none. */
function creatureTypeOf(system) {
	return String(system?.creatureType ?? "").trim().toLowerCase();
}

/** Like a Dog with a Bone's quarry: typed Corrupted, or tagged as the chaos-touched are. */
function isCorruptedFoe(target) {
	const system = targetSystem(target);
	return creatureTypeOf(system) === "corrupted" || systemTags(system).some(tag => CORRUPTED_TAGS.has(tag));
}

/** Everything Bleeds' "unnatural foe": typed as anything but a person or a beast, or tagged unnatural. */
function isUnnaturalFoe(target) {
	const system = targetSystem(target);
	const type = creatureTypeOf(system);
	return (!!type && !NATURAL_CREATURE_TYPES.has(type)) || systemTags(system).some(tag => UNNATURAL_TAGS.has(tag));
}

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

/**
 * The foes in the fight a character could lock eyes with: whoever they are fighting, near or far.
 *
 * @param {Actor} actor
 * @param {object|null} [found]  engagementOf's answer for them, when the caller has it
 */
export function lockEyesCandidates(actor, found = undefined) {
	const place = found === undefined ? rollerEngagement(actor) : found;
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
	await asteriskMoveUsed(actor, HERO_MOVES.BIG_DAMN_HERO);
	return true;
}

/**
 * Whether Big Damn Hero's leap is still there to make: "When you FIRST leap into danger to protect someone,
 * don't roll to Defend." Once per fight, kept on the hero's combatant beside the locked eyes, so it comes
 * back with the next fight. With no fight on the map to keep it on (the Fight tab off, or nobody fighting),
 * it is always offered and its card says whose count it is (leapIn), as the table keeps the fight then.
 */
export function leapInOpen(actor, found = undefined) {
	if (!has(actor, HERO_MOVES.BIG_DAMN_HERO)) return false;
	const place = found === undefined ? rollerEngagement(actor) : found;
	return !place?.combatant?.flags?.[SYSTEM_ID]?.[LEAPT_IN_FLAG];
}

/**
 * Big Damn Hero's leap: no roll, and Defend's 10+ applied as if it had been rolled (the Readiness it
 * holds, shield and Guardian included: StonetopCharacter#settleDefendReadinessTier), with a card naming
 * the move. Marked on the hero's combatant when there is one. Whether the leap was made.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {StonetopCharacter} [options.character]  the actor's character model (default `actor.typedActor`)
 */
export async function leapIn(actor, { character = actor?.typedActor } = {}) {
	if (!has(actor, HERO_MOVES.BIG_DAMN_HERO)) return false;
	const mine = rollerEngagement(actor)?.combatant ?? null;
	if (mine?.flags?.[SYSTEM_ID]?.[LEAPT_IN_FLAG]) return false;
	if (mine) await mine.update({ [`flags.${SYSTEM_ID}.${LEAPT_IN_FLAG}`]: true });
	const said = `<p>${escHtml(format(`${MOVE_KEY}.leapIn.said`, { name: actor.name }))}</p>`;
	const count = mine ? "" : `<p>${escHtml(format(`${MOVE_KEY}.leapIn.noFight`, {}))}</p>`;
	await globalThis.ChatMessage?.create?.({
		content: stonetopChatCard(HERO_MOVES.BIG_DAMN_HERO, `<div class="card-content">${said}${count}</div>`, "stonetop-leap-in-card"),
		speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
	});
	await character?.settleDefendReadinessTier?.("success");
	await asteriskMoveUsed(actor, HERO_MOVES.BIG_DAMN_HERO);
	return true;
}

/**
 * The heroes whose locked eyes put a foe's damage roll at disadvantage against these targets: a target who
 * locked eyes with the roller, or who stands beside a hero who did. Empty when none.
 *
 * EVERY TARGET MUST BE ONE OF THEM, as for every other mode on a damage roll (combat/attack-flow.js
 * #incomingMode): one roll is made per card, and a blow at the hero and at someone across the field
 * cannot roll twice over for the one of them the hero is guarding.
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
		const guarding = hitFighter ? lockers.filter(hero => hero.id === hitFighter.id || touching(hero, hitFighter, grid)) : [];
		// One target nobody guards is a target the roll is not at disadvantage against, so none is.
		if (!guarding.length) return [];
		for (const hero of guarding) {
			if (!names.includes(hero.name)) names.push(hero.name);
		}
	}
	return names;
}
