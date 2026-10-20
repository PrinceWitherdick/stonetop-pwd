// Losing Defend's Readiness (Book I p.216): "When you go on the offense, cease to focus on defense, or
// the threat passes, lose any Readiness that you hold."
//
// GOING ON THE OFFENSE IS THE PLAYER'S TO SAY. An attack is not always one: p.216's own example keeps a
// defender's Readiness through a Clash, "he's fighting, but defensively. (If he'd rushed out to meet
// them, then no, his Readiness would be gone)". So a character holding Readiness who attacks (Clash, Let
// Fly, an attack playbook move, or their own damage die off the sheet or the fight ring) is asked which
// it is, and the chat says what they answered. Closing the window keeps it: nothing is lost by accident.
//
// THE THREAT PASSES when the fight ends, and a character CEASES TO FOCUS ON DEFENSE when they leave the
// fight or go down to 0 HP. The GM's client clears those on its own (installReadinessLoss), once, and
// says so. A character still fighting on another map keeps theirs.
//
// A FOLLOWER ordered to Defend holds Readiness on Defend's terms (p.469), kept on their card on the
// character they follow (fight/follower-readiness.js), and lets it go the same ways: the fight ending,
// their token going down, or going on the offense, asked of their character's player as a character is
// asked (settleFollowerReadinessOnAttack). A crew in the Marshal's shield wall is asked the other way round:
// holding the wall keeps its Readiness, breaking formation to charge loses it and the wall (fight/shield-wall.js).

import { SYSTEM_ID } from "../system-id.js";
import { heldReadiness, READINESS_FLAG } from "./defend-readiness.js";
import { readableFlags } from "../actors/character/StonetopFlags.js";
import { crewInShieldWall, setShieldWall, shieldWallEmptied, SHIELD_WALL_FLAG } from "../fight/shield-wall.js";
import { each, isFight } from "../fight/fight-state.js";
import { clearHarmedBy, clearRapierWit } from "../fight/hero-moves.js";
import { characterBehind, followerCardFor } from "../actors/character/follower-masters.js";
import { keepsFightingAtZero } from "../actors/character/unstoppable.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { postMoveNote } from "../utils/chat.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { cardReadinessRef, followerReadinessRef, readinessHeldBy, readinessOnCard, clearFollowerReadiness } from "../fight/follower-readiness.js";
import { clearFightHolds } from "./battle-holds.js";
import { contentElement } from "../utils/dialogv2-content.js";
import { escHtml, joinNames } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";

const KEY = "stonetop.readiness";

/**
 * Ask whether an attack is going on the offense. Resolves true to lose the Readiness, false to keep it
 * (also when the window is closed, or there is no window to ask with). A follower's is asked of their
 * character's player, naming the follower and the Readiness on their card (`name`, `count`). A crew formed
 * in a shield wall (`shieldWall`) is asked in the wall's words: hold it and keep the Readiness, or break
 * formation to charge and lose it.
 */
export async function askGoingOnOffense(actor, moveName, { name = actor?.name ?? "", count = heldReadiness(actor), shieldWall = false } = {}) {
	const words = shieldWall ? "stonetop.shieldWall" : KEY;
	const answer = await askWithButtons({
		title: format(`${words}.askTitle`, { name, count }),
		content: contentElement(`<p>${escHtml(format(`${words}.ask`, { name, count, move: moveName }))}</p>`),
		// Affirmative first: the rule's own case, the one that costs something. Enter keeps it.
		buttons: [
			{ key: "lose", label: localize(`${words}.lose`), icon: "fa-person-running", value: "lose" },
			{ key: "keep", label: localize(`${words}.keep`), icon: "fa-shield", value: "keep" },
		],
		defaultKey: "keep",
	});
	return answer === "lose";
}

/**
 * A character holding Readiness attacks: ask whether they are going on the offense, clear it if so, and
 * say which in chat. Nothing asked of a character holding none.
 *
 * @param {Actor} actor
 * @param {string} moveName  what they attacked with ("Clash", "Damage")
 * @param {{ask?: typeof askGoingOnOffense}} [deps]
 * @returns {Promise<boolean>} whether the Readiness was lost
 */
export async function settleReadinessOnAttack(actor, moveName, { ask = askGoingOnOffense } = {}) {
	if (actor?.type !== "character") return false;
	const count = heldReadiness(actor);
	if (count <= 0) return false;
	if (!(await ask(actor, moveName))) {
		await postMoveNote(actor, localize(`${KEY}.keptTitle`), format(`${KEY}.kept`, { name: actor.name, move: moveName, count }));
		return false;
	}
	await actor.setFlag(SYSTEM_ID, READINESS_FLAG, 0);
	await postMoveNote(actor, localize(`${KEY}.lostTitle`), format(`${KEY}.lostOffense`, { name: actor.name, move: moveName }));
	return true;
}

/**
 * A FOLLOWER holding Readiness attacks (the Marshal's user ruling, 2026-10-18: "followers too"): ordered to
 * Clash or Let Fly, or dealing their blow off their card or their token. Asked as a character is, of their
 * character's player, over the Readiness on their card; cleared (attributed to the move, on the ledger) if
 * they rushed in. A crew standing in a SHIELD WALL is asked whether it holds the wall: "As long as they
 * maintain formation, they can go on the offensive without losing Readiness" (p.126, fight/shield-wall.js),
 * so holding it (the default, and a closed window) keeps the Readiness, and breaking formation to charge
 * loses it and the wall in one write. The chat says which.
 * A strike back never comes here: it spends its own Readiness. Nothing asked by a client that cannot write
 * the character, or of a follower holding none.
 *
 * @param {Actor} character  whose follower
 * @param {{ftype: string, slug?: string, name?: string}} follower  their card, and the name the windows use
 * @param {string} moveName  what they attacked with ("Clash", "Damage")
 * @param {{ask?: typeof askGoingOnOffense}} [deps]
 * @returns {Promise<boolean>} whether the Readiness was lost
 */
export async function settleFollowerReadinessOnAttack(character, { ftype = "", slug = "", name = "" } = {}, moveName, { ask = askGoingOnOffense } = {}) {
	if (character?.type !== "character" || character.isOwner === false) return false;
	const ref = cardReadinessRef(character, ftype, slug);
	if (!ref) return false;
	const { path } = ref;
	const count = readinessOnCard(ref);
	if (count <= 0) return false;
	const who = String(name ?? "").trim() || localize(`${KEY}.follower`);
	if (ftype === "crew" && crewInShieldWall(character)) {
		const wall = { name: who, move: moveName, count };
		if (!(await ask(character, moveName, { name: who, count, shieldWall: true }))) {
			await postMoveNote(character, localize("stonetop.shieldWall.title"), format("stonetop.shieldWall.kept", wall));
			return false;
		}
		await character.update({ [`flags.${SYSTEM_ID}.${path}`]: 0, [`flags.${SYSTEM_ID}.${SHIELD_WALL_FLAG}`]: false }, { stonetopMove: moveName });
		await postMoveNote(character, localize("stonetop.shieldWall.title"), format("stonetop.shieldWall.charged", wall));
		return true;
	}
	if (!(await ask(character, moveName, { name: who, count }))) {
		await postMoveNote(character, localize(`${KEY}.keptTitle`), format(`${KEY}.kept`, { name: who, move: moveName, count }));
		return false;
	}
	await character.update({ [`flags.${SYSTEM_ID}.${path}`]: 0 }, { stonetopMove: moveName });
	await postMoveNote(character, localize(`${KEY}.lostTitle`), format(`${KEY}.lostOffense`, { name: who, move: moveName }));
	return true;
}

/** settleFollowerReadinessOnAttack for a follower's token in a fight: their card read off the token's actor. */
export async function settleFollowerTokenReadinessOnAttack(actor, moveName, { cardFor = followerCardFor, ask = askGoingOnOffense } = {}) {
	const card = actor?.type === "npc" ? cardFor(actor) : null;
	if (!card?.character) return false;
	return settleFollowerReadinessOnAttack(card.character, { ftype: card.ftype, slug: card.slug, name: actor.name }, moveName, { ask });
}

/**
 * The ids of every actor with a token in a fight, leaving out one combat or one combatant. `actorOf` maps
 * each token's actor to the one whose id is kept (a follower to their character, say), or to none.
 */
function fightingActorIds(combats, { exceptCombat = null, exceptCombatant = null, actorOf = actor => actor } = {}) {
	const ids = new Set();
	for (const combat of each(combats)) {
		if (!isFight(combat) || (exceptCombat && combat.id === exceptCombat.id)) continue;
		for (const c of each(combat.combatants)) {
			const who = c.actor && c.id !== exceptCombatant?.id ? actorOf(c.actor) : null;
			if (who) ids.add(who.id);
		}
	}
	return ids;
}

/**
 * The characters behind a fight's tokens (`actorOf`, as fightingActorIds) who fight in no other, once each,
 * and of those the ones `keeps` picks.
 */
function charactersLeftBy(combat, combats, { actorOf = actor => actor, keeps = () => true } = {}) {
	const stillFighting = fightingActorIds(combats, { exceptCombat: combat, actorOf });
	const left = new Map();
	for (const c of each(combat?.combatants)) {
		const who = c.actor ? actorOf(c.actor) : null;
		if (who?.type === "character" && !stillFighting.has(who.id) && keeps(who)) left.set(who.id, who);
	}
	return [...left.values()];
}

/** The one Readiness pool a follower's token stands over (their character and card path), or null. */
function readinessPool(actor, cardFor) {
	const ref = followerReadinessRef(actor, { cardFor });
	return ref ? `${ref.character.id}:${ref.path}` : null;
}

/**
 * The characters in a fight who hold Readiness and fight in no other: whose Readiness goes when this
 * fight ends. PURE apart from reading the actors.
 *
 * @param {Combat} combat  the fight that ended
 * @param {Iterable<Combat>} [combats]  every combat still in the world
 * @returns {Actor[]}
 */
export function holdersLeft(combat, combats = globalThis.game?.combats, { cardFor = followerCardFor } = {}) {
	const stillFighting = fightingActorIds(combats, { exceptCombat: combat });
	// A follower's pool is still fighting while any token over it stands in another fight.
	const poolsFighting = fightingActorIds(combats, { exceptCombat: combat, actorOf: actor => {
		const pool = readinessPool(actor, cardFor);
		return pool ? { id: pool } : null;
	} });
	const holders = [];
	// A group follower can stand as several tokens over ONE pool on its card: named once.
	const pools = new Set();
	for (const c of each(combat?.combatants)) {
		const actor = c.actor;
		if (actor?.type === "character") {
			if (heldReadiness(actor) <= 0 || stillFighting.has(actor.id) || holders.includes(actor)) continue;
			holders.push(actor);
			continue;
		}
		const ref = followerReadinessRef(actor, { cardFor });
		if (readinessOnCard(ref) <= 0) continue;
		const pool = readinessPool(actor, cardFor);
		if (pools.has(pool) || poolsFighting.has(pool)) continue;
		pools.add(pool);
		holders.push(actor);
	}
	return holders;
}

/**
 * The characters in a fight who fight in no other, once each: whose battle holds (Command, Presence, Surprise:
 * battle-holds.js#FIGHT_HOLD_MOVES) go when this fight ends. PURE apart from reading the actors.
 *
 * @param {Combat} combat  the fight that ended
 * @param {Iterable<Combat>} [combats]  every combat still in the world
 * @returns {Actor[]}
 */
export function charactersLeft(combat, combats = globalThis.game?.combats) {
	return charactersLeftBy(combat, combats);
}

/**
 * The Marshals whose crew stood formed in a shield wall (fight/shield-wall.js) in a fight that ended, the
 * Marshal or the crew's token in it, and neither fighting in another: the wall goes with the fight. PURE
 * apart from reading the actors.
 *
 * @param {Combat} combat  the fight that ended
 * @param {Iterable<Combat>} [combats]  every combat still in the world
 * @returns {Actor[]}
 */
export function shieldWallsLeft(combat, combats = globalThis.game?.combats, { cardFor = followerCardFor } = {}) {
	return charactersLeftBy(combat, combats, {
		actorOf: actor => characterBehind(actor, cardFor),
		keeps: holder => !!foundry.utils.getProperty(readableFlags(holder), SHIELD_WALL_FLAG),
	});
}

/** Whether an actor update writes the actor's HP value, nested or as a dotted key. */
function hpValueTouched(changes) {
	const hp = changes?.system?.attributes?.hp;
	return (hp && typeof hp === "object" && "value" in hp) || "system.attributes.hp.value" in (changes ?? {});
}

/**
 * Whether an actor update has just put a follower holding Readiness on 0 HP: they have stopped defending,
 * as a character who drops has. The HP is checked first: their card is only looked up for a follower who fell.
 */
export function followerDroppedHoldingReadiness(actor, changes = {}, { cardFor = followerCardFor } = {}) {
	if (actor?.type !== "npc" || !hpValueTouched(changes) || !(Number(actor.system?.attributes?.hp?.value) <= 0)) return false;
	return readinessHeldBy(actor, { cardFor }) > 0;
}

/**
 * Whether an actor update has just put a character holding Readiness on 0 HP. Not one who fights on
 * at 0 on Unstoppable's word (actors/character/unstoppable.js): they have not stopped defending.
 */
export function droppedHoldingReadiness(actor, changes = {}) {
	if (actor?.type !== "character" || heldReadiness(actor) <= 0) return false;
	if (keepsFightingAtZero(actor)) return false;
	return hpValueTouched(changes) && Number(actor.system?.attributes?.hp?.value) <= 0;
}

/** Clear these characters' (and followers') Readiness and post one note saying why. */
async function loseAll(actors, noteKey, { cardFor = followerCardFor } = {}) {
	if (!actors.length) return;
	await Promise.all(actors.map(actor => (actor.type === "character"
		? actor.setFlag(SYSTEM_ID, READINESS_FLAG, 0)
		: clearFollowerReadiness(actor, { cardFor }))));
	const names = joinNames(actors.map(a => a.name));
	await postMoveNote(actors.length === 1 ? actors[0] : null, localize(`${KEY}.lostTitle`), format(`${KEY}.${noteKey}`, { name: names, names }));
}

/**
 * The GM's client lets Readiness go when the threat passes or a character stops defending: the fight
 * ends, they leave it, or they drop to 0 HP. Only the primary GM writes, so it happens once.
 *
 * @param {object} [deps]
 * @param {Function} [deps.cardFor]  follower-masters.js#followerCardFor (injectable for tests)
 * @returns {() => void} stops listening
 */
export function installReadinessLoss({ hooks = globalThis.Hooks, cardFor = followerCardFor } = {}) {
	const listening = [];
	const on = (name, fn) => listening.push([name, hooks.on(name, (...args) => {
		if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return;
		Promise.resolve(fn(...args)).catch(err => console.error("Stonetop | letting go of Readiness failed", err));
	})]);

	on("deleteCombat", async combat => {
		// The mooks' grudges a fight leaves behind go with it: Payback's grudge against an unlinked token
		// can never be matched again once its token is gone, and a list of dead tokens would follow a
		// character forever. A NAMED foe's (a linked actor) is remembered: the villain who hurt you is
		// still owed Payback in the next fight (the user's ruling, 2026-10-18; fight/hero-moves.js#clearHarmedBy).
		// Nemesis is deliberately NOT here at all: the book says "all of your future attacks against them",
		// and a nemesis who walked away is the point of the move.
		// One write each, together: a character with two tokens in the fight is one sheet, not two.
		// A follower's harm is kept on the character it follows (hero-moves.js#recordHarmedBy), who
		// need not have fought here, so each follower in the fight brings that character's flag too.
		const harmed = new Map();
		for (const combatant of combat.combatants ?? []) {
			const holder = characterBehind(combatant.actor, cardFor);
			if (holder?.type === "character") harmed.set(holder.id, holder);
		}
		// The Fox's Rapier Wit records (fight/hero-moves.js#clearRapierWit) follow the same rule: a quip at an
		// unlinked token goes with it, one at a named foe is kept until it is used. Each holder's two writes
		// go one after the other, so neither lands over the other.
		await Promise.all([...harmed.values()].map(async holder => {
			await clearHarmedBy(holder);
			await clearRapierWit(holder);
		}));
		// The grudges are let go at the end of ANY Combat, since Payback and Rapier Wit record them in a plain
		// core Combat too (the GM's Fight tab off, or a Combat begun from core's tracker). Readiness and the
		// holds below are the Fight's own.
		if (!isFight(combat)) return;
		// The Marshal's holds were for this battle (the user's ruling, 2026-10-18): Stentorian's Command, Front
		// Line Leader's Presence and Prepare a Welcome's Surprise go with it, one write per character, unless
		// they still fight elsewhere (the same rule as Readiness).
		await Promise.all(charactersLeft(combat).map(clearFightHolds));
		// And the crew's shield wall (fight/shield-wall.js): read before the Readiness goes, written after the
		// holds, so the two writes to one Marshal do not race.
		const walls = shieldWallsLeft(combat, undefined, { cardFor });
		await Promise.all(walls.map(marshal => setShieldWall(marshal, false)));
		return loseAll(holdersLeft(combat, undefined, { cardFor }), "lostFightOver", { cardFor });
	});
	on("deleteCombatant", combatant => {
		const combat = combatant?.parent;
		// The whole fight going is deleteCombat's to say.
		if (!isFight(combat) || !globalThis.game?.combats?.get?.(combat.id)) return;
		const actor = combatant.actor;
		if (actor?.type !== "character" || heldReadiness(actor) <= 0) return;
		// Still in this fight as another token, or in another fight.
		if (fightingActorIds(globalThis.game?.combats, { exceptCombatant: combatant }).has(actor.id)) return;
		return loseAll([actor], "lostLeftFight");
	});
	on("updateActor", (actor, changes) => {
		// A crew whose Readiness is gone (spent, lost, or cleared) has no wall left to keep it in.
		if (shieldWallEmptied(actor, changes)) setShieldWall(actor, false).catch(err => console.error("Stonetop | breaking the shield wall failed", err));
		if (followerDroppedHoldingReadiness(actor, changes, { cardFor })) return loseAll([actor], "lostDown", { cardFor });
		if (!droppedHoldingReadiness(actor, changes)) return;
		return loseAll([actor], "lostDown");
	});

	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}
