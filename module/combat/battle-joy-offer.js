// The Heavy's Battle Joy, offered the moment they spill blood: "When you spill blood (yours or
// another's) and lose yourself in battle, you ignore fear, pain, mind-control, and the effects of
// debilities as long as you keep fighting."
//
// SPILLING BLOOD IS THE HP; LOSING YOURSELF IS THE PLAYER'S TO SAY. So a Heavy who deals damage, or
// loses hit points, is asked, and a yes ticks the same flag the header glyph does
// (actors/character/battle-joy.js), which greys the debilities and switches Berserker on exactly as a
// click on the glyph would. A no, or a closed window, leaves them as they were: nothing starts raging
// by accident.
//
// Asked of a Heavy who owns the move, has it switched on, and is not already raging.
//
//  - ANOTHER'S BLOOD is their own damage card (combat/attack-flow.js): asked on the roller's client,
//    straight after the card posts. A follower's blow is not theirs.
//  - THEIR OWN is any write that lowers their HP: an enemy's card applied, a move's harm to
//    themselves, a hand-edited box. That write is usually the GM's, so it is spotted where it is made
//    (preUpdateActor, the only place the outgoing HP can be read) and asked on the Heavy's own screen,
//    picked the way Death's Door picks it (hooks/DeathsDoorPrompt.js#autoOpenUserId). Not at 0 HP:
//    that is Death's Door, and nobody down is still fighting.
//
// AND THE OTHER END: "When the action stops, roll +CON." A fight ending, or the Heavy leaving the
// last fight they were in, with the Battle Joy still on asks that on the same screen, through the
// sheet's own ending (StonetopCharacterSheet#_endBattleJoy), exactly as a click on the lit glyph
// would. Any combat counts, the Fight tab's or core's: the action stopping is not a Fight tab idea.

import { SYSTEM_ID } from "../system-id.js";
import { BATTLE_JOY, BATTLE_JOY_FLAG } from "../actors/character/battle-joy.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { answersFor } from "../hooks/DeathsDoorPrompt.js";
import { each } from "../fight/fight-state.js";
import { postMoveNote } from "../utils/chat.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../dialogs/content-picker.js";
import { escHtml } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";

const KEY = "stonetop.battleJoy";

/**
 * Update option carrying the HP a write just took off a character, from the preUpdate half (which can
 * read the old value) to the update half on every client (which cannot).
 */
export const HP_LOST_OPTION = "stonetopHpLost";

/**
 * Whether spilling this blood asks the Battle Joy question. PURE apart from reading the actor.
 *
 * @param {Actor} actor  the Heavy
 * @param {number[]} totals  what was dealt, per target (or the one plain total), or the HP they lost
 */
export function offersBattleJoy(actor, totals = []) {
	if (actor?.type !== "character") return false;
	if (!ownsLearnedMoveNamed(actor, BATTLE_JOY)) return false;
	if (actor.getFlag?.(SYSTEM_ID, BATTLE_JOY_FLAG)) return false;
	// Only whoever can write the flag is asked: a GM relaying a player's card has no business answering.
	if (actor.isOwner === false) return false;
	// No blood spilled on a blow that came to nothing.
	return totals.some(n => Number(n) > 0);
}

/**
 * Ask whether they lose themselves in battle. Resolves true only on the yes button.
 *
 * @param {Actor} actor
 * @param {string} why  the sentence saying what just happened
 */
export async function askLoseThemselves(actor, why) {
	const answer = await askWithButtons({
		title: format(`${KEY}.askTitle`, { name: actor.name }),
		content: contentElement(`<p>${escHtml(`${why} ${format(`${KEY}.ask`, { name: actor.name })}`)}</p>`),
		// Affirmative first. Enter keeps their head: a stray keypress should not silence their debilities.
		buttons: [
			{ key: "rage", label: localize(`${KEY}.askEnter`), icon: "fa-fire", value: "rage" },
			{ key: "calm", label: localize(`${KEY}.askDecline`), icon: "fa-hand", value: "calm" },
		],
		defaultKey: "calm",
	});
	return answer === "rage";
}

// Whose question is open on this client. A blow dealt and a blow taken can land together (a Clash's
// 7-9), and two windows asking the same thing is one too many.
const asking = new Set();

async function offer(actor, totals, why, ask) {
	if (!offersBattleJoy(actor, totals) || asking.has(actor.id)) return false;
	asking.add(actor.id);
	try {
		if (!(await ask(actor, why))) return false;
		// Answered while another write may have got there first.
		if (actor.getFlag?.(SYSTEM_ID, BATTLE_JOY_FLAG)) return false;
		await actor.setFlag(SYSTEM_ID, BATTLE_JOY_FLAG, true);
	} finally {
		asking.delete(actor.id);
	}
	await postMoveNote(actor, BATTLE_JOY, format(`${KEY}.entered`, { name: actor.name }));
	return true;
}

/**
 * A character has just dealt damage: offer the Battle Joy, and on a yes enter it and say so in chat.
 *
 * @param {Actor} actor
 * @param {string} moveName  what the damage was dealt with ("Clash", "Damage")
 * @param {number[]} totals  the card's totals
 * @param {{ask?: typeof askLoseThemselves}} [deps]
 * @returns {Promise<boolean>} whether they entered it
 */
export function offerBattleJoyOnDamage(actor, moveName, totals, { ask = askLoseThemselves } = {}) {
	return offer(actor, totals, format(`${KEY}.dealt`, { name: actor?.name, move: moveName }), ask);
}

/**
 * A character has just lost hit points: the same offer, for their own blood.
 *
 * @param {Actor} actor
 * @param {number} lost  how many
 * @param {{ask?: typeof askLoseThemselves}} [deps]
 * @returns {Promise<boolean>} whether they entered it
 */
export function offerBattleJoyOnHurt(actor, lost, { ask = askLoseThemselves } = {}) {
	return offer(actor, [lost], format(`${KEY}.taken`, { name: actor?.name, amount: lost }), ask);
}

/**
 * How much HP this write takes off a character who stays on their feet, or 0. PURE.
 *
 * @param {number} oldHp
 * @param {*} newHp  the raw value in the change
 */
export function hpLost(oldHp, newHp) {
	const before = Number(oldHp) || 0;
	const after = Number(newHp);
	if (!Number.isFinite(after) || after <= 0) return 0;
	return Math.max(0, before - after);
}

/**
 * Watch every character's HP for their own blood being spilled.
 *
 * @returns {() => void} stops listening
 */
export function installBattleJoyOnHurt({ hooks = globalThis.Hooks } = {}) {
	const listening = [
		// The applier's client, where the outgoing HP is still on the document. Never throws: a fault in
		// a preUpdate hook would stop the damage being written at all.
		["preUpdateActor", hooks.on("preUpdateActor", (actor, changes, options) => {
			try {
				if (actor?.type !== "character") return;
				// The HP test first: most character updates touch no HP, and it costs nothing to ask.
				const raw = globalThis.foundry?.utils?.getProperty?.(changes, "system.attributes.hp.value");
				if (raw === undefined || !ownsLearnedMoveNamed(actor, BATTLE_JOY)) return;
				const lost = hpLost(actor.system?.attributes?.hp?.value, raw);
				if (lost > 0 && options) options[HP_LOST_OPTION] = lost;
			} catch (err) {
				console.error("Stonetop | reading HP lost for Battle Joy failed", err);
			}
		})],
		// Every client, once committed; the Heavy's own screen answers.
		["updateActor", hooks.on("updateActor", (actor, _changes, options) => {
			const lost = Number(options?.[HP_LOST_OPTION]) || 0;
			if (lost <= 0 || actor?.type !== "character") return;
			if (!answersFor(actor)) return;
			offerBattleJoyOnHurt(actor, lost).catch(err => console.error("Stonetop | offering Battle Joy failed", err));
		})],
	];
	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}

/** Is this character still in some combat other than the one going (or the combatant leaving)? */
export function stillFighting(actor, combats, { exceptCombat = null, exceptCombatant = null } = {}) {
	for (const combat of each(combats)) {
		if (exceptCombat && combat.id === exceptCombat.id) continue;
		for (const c of each(combat.combatants)) {
			if (exceptCombatant && c.id === exceptCombatant.id) continue;
			if (c.actor?.id === actor?.id) return true;
		}
	}
	return false;
}

function isRaging(actor) {
	return actor?.type === "character" && !!actor.getFlag?.(SYSTEM_ID, BATTLE_JOY_FLAG);
}

/** A raging Heavy whose action just stopped: roll +CON, or come out of it. On their own screen only. */
function endIfRaging(actor, endBattleJoy) {
	if (!isRaging(actor) || !answersFor(actor)) return;
	Promise.resolve(endBattleJoy(actor)).catch(err => console.error("Stonetop | ending Battle Joy failed", err));
}

/**
 * Ask a Heavy still in their Battle Joy to roll +CON once the fight is over for them.
 *
 * @param {{hooks?: object, endBattleJoy?: (actor: Actor) => Promise<void>}} [deps]
 * @returns {() => void} stops listening
 */
export function installBattleJoyEnd({ hooks = globalThis.Hooks, endBattleJoy = actor => actor.sheet?._endBattleJoy?.() } = {}) {
	const listening = [
		["deleteCombat", hooks.on("deleteCombat", combat => {
			const seen = new Set();
			for (const c of each(combat?.combatants)) {
				const actor = c.actor;
				if (!actor || seen.has(actor.id)) continue;
				seen.add(actor.id);
				// Raging first: scanning every combat is for the rare actor it could matter to.
				if (!isRaging(actor) || stillFighting(actor, globalThis.game?.combats, { exceptCombat: combat })) continue;
				endIfRaging(actor, endBattleJoy);
			}
		})],
		["deleteCombatant", hooks.on("deleteCombatant", combatant => {
			const combat = combatant?.parent;
			// The whole fight going is deleteCombat's to say.
			if (!combat || !globalThis.game?.combats?.get?.(combat.id)) return;
			const actor = combatant.actor;
			if (!isRaging(actor) || stillFighting(actor, globalThis.game?.combats, { exceptCombatant: combatant })) return;
			endIfRaging(actor, endBattleJoy);
		})],
	];
	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}
