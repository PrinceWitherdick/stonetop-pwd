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

import { SYSTEM_ID } from "../system-id.js";
import { heldReadiness, READINESS_FLAG } from "./defend-readiness.js";
import { each, isFight } from "../fight/fight-state.js";
import { clearHarmedBy } from "../fight/hero-moves.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { postMoveNote } from "../utils/chat.js";
import { themedDialogClasses } from "../utils/window-theme.js";
import { contentElement } from "../dialogs/content-picker.js";
import { escHtml, joinNames } from "../utils/strings.js";
import { format, localize } from "../utils/i18n.js";

const KEY = "stonetop.readiness";

/**
 * Ask whether an attack is going on the offense. Resolves true to lose the Readiness, false to keep it
 * (also when the window is closed, or there is no window to ask with).
 */
export async function askGoingOnOffense(actor, moveName, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
	if (!DialogV2) return false;
	const count = heldReadiness(actor);
	const answer = await DialogV2.wait({
		// `stonetop-ask` carries the window's measure and a row per answer: a DialogV2 is auto-width,
		// so this paragraph would otherwise open as one very long line (stonetop.css).
		classes: themedDialogClasses("stonetop-ask"),
		window: { title: format(`${KEY}.askTitle`, { name: actor.name, count }) },
		content: contentElement(`<p>${escHtml(format(`${KEY}.ask`, { name: actor.name, count, move: moveName }))}</p>`),
		// Affirmative first: the rule's own case, the one that costs something.
		buttons: [
			{ action: "lose", label: localize(`${KEY}.lose`), icon: "fa-solid fa-person-running", callback: () => "lose" },
			{ action: "keep", label: localize(`${KEY}.keep`), icon: "fa-solid fa-shield", default: true, callback: () => "keep" },
		],
		rejectClose: false,
	}).catch(() => null);
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

/** The ids of every actor with a token in a fight, leaving out one combat or one combatant. */
function fightingActorIds(combats, { exceptCombat = null, exceptCombatant = null } = {}) {
	const ids = new Set();
	for (const combat of each(combats)) {
		if (!isFight(combat) || (exceptCombat && combat.id === exceptCombat.id)) continue;
		for (const c of each(combat.combatants)) if (c.actor && c.id !== exceptCombatant?.id) ids.add(c.actor.id);
	}
	return ids;
}

/**
 * The characters in a fight who hold Readiness and fight in no other: whose Readiness goes when this
 * fight ends. PURE apart from reading the actors.
 *
 * @param {Combat} combat  the fight that ended
 * @param {Iterable<Combat>} [combats]  every combat still in the world
 * @returns {Actor[]}
 */
export function holdersLeft(combat, combats = globalThis.game?.combats) {
	const stillFighting = fightingActorIds(combats, { exceptCombat: combat });
	const holders = [];
	for (const c of each(combat?.combatants)) {
		const actor = c.actor;
		if (actor?.type !== "character" || heldReadiness(actor) <= 0) continue;
		if (stillFighting.has(actor.id) || holders.includes(actor)) continue;
		holders.push(actor);
	}
	return holders;
}

/** Whether an actor update has just put a character holding Readiness on 0 HP. */
export function droppedHoldingReadiness(actor, changes = {}) {
	if (actor?.type !== "character" || heldReadiness(actor) <= 0) return false;
	const hp = changes?.system?.attributes?.hp;
	const touched = (hp && typeof hp === "object" && "value" in hp) || "system.attributes.hp.value" in (changes ?? {});
	return touched && Number(actor.system?.attributes?.hp?.value) <= 0;
}

/** Clear these characters' Readiness and post one note saying why. */
async function loseAll(actors, noteKey) {
	if (!actors.length) return;
	await Promise.all(actors.map(actor => actor.setFlag(SYSTEM_ID, READINESS_FLAG, 0)));
	const names = joinNames(actors.map(a => a.name));
	await postMoveNote(actors.length === 1 ? actors[0] : null, localize(`${KEY}.lostTitle`), format(`${KEY}.${noteKey}`, { name: names, names }));
}

/**
 * The GM's client lets Readiness go when the threat passes or a character stops defending: the fight
 * ends, they leave it, or they drop to 0 HP. Only the primary GM writes, so it happens once.
 *
 * @returns {() => void} stops listening
 */
export function installReadinessLoss({ hooks = globalThis.Hooks } = {}) {
	const listening = [];
	const on = (name, fn) => listening.push([name, hooks.on(name, (...args) => {
		if (!globalThis.game?.user?.isGM || !isPrimaryGM()) return;
		Promise.resolve(fn(...args)).catch(err => console.error("Stonetop | letting go of Readiness failed", err));
	})]);

	on("deleteCombat", async combat => {
		if (!isFight(combat)) return;
		// The grudges a fight leaves behind go with it: Payback's "a foe that has harmed you" is about the
		// blow that just landed, and a list of dead tokens would follow a character forever
		// (fight/hero-moves.js#clearHarmedBy). Nemesis is deliberately NOT here: the book says "all of your
		// future attacks against them", and a nemesis who walked away is the point of the move.
		// One write each, together: a character with two tokens in the fight is one sheet, not two.
		const harmed = new Map();
		for (const combatant of combat.combatants ?? []) {
			if (combatant.actor?.type === "character") harmed.set(combatant.actor.id, combatant.actor);
		}
		await Promise.all([...harmed.values()].map(clearHarmedBy));
		return loseAll(holdersLeft(combat), "lostFightOver");
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
		if (!droppedHoldingReadiness(actor, changes)) return;
		return loseAll([actor], "lostDown");
	});

	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}
