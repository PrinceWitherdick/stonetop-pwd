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
// BLOOD IS SPILLED WHEN HP IS LOST, not when damage is rolled: "If the target's armor is equal to or greater
// than the damage, they don't lose any HP" (Book I p.239), and a blow armor stopped spilled nothing. So:
//  - ANOTHER'S BLOOD is their own damage card APPLIED (combat/attack-flow.js#wireApplyDamage writes the rows
//    it applied onto the card): every client sees that write, and the one that answers for the Heavy asks
//    (installBattleJoyOnHurt's updateChatMessage). Only rows whose target really lost HP count. A follower's
//    blow is not theirs, nor a blow struck at them (a counter-attack's card). A roll with nobody to Apply it to
//    asks nothing: the glyph is still there to click.
//  - THEIR OWN is any write that lowers their HP: an enemy's card applied, a move's harm to
//    themselves, a hand-edited box. That write is usually the GM's, so it is spotted where it is made
//    (preUpdateActor, the only place the outgoing HP can be read) and asked on the Heavy's own screen,
//    picked the way Death's Door picks it (hooks/DeathsDoorPrompt.js#autoOpenUserId). Not at 0 HP:
//    that is Death's Door, and nobody down is still fighting, UNLESS Unstoppable keeps them fighting at 0
//    ("When you are reduced to 0 HP in battle, you can keep fighting", p.114): that blood counts.
// ANYWHERE, fight or not (the user's ruling, 2026-11-06, "When you spill blood"). With no fight running, the
// card that says they are lost in it says it ends from the glyph, since no fight's end will come to ask.
// Never of a Heavy who is down, dead, or past death (a Death's Door state, a post-death insert).
//
// AND THE OTHER END: "When the action stops, roll +CON." A fight ending, or the Heavy leaving the
// last fight they were in, with the Battle Joy still on asks that on the same screen, through the
// sheet's own ending (StonetopCharacterSheet#_endBattleJoy), exactly as a click on the lit glyph
// would. Any combat counts, the Fight tab's or core's: the action stopping is not a Fight tab idea.
// A Heavy who is DOWN is not asked to roll (the user's ruling): dropping to 0 HP is when they stopped
// fighting, so the Joy ends there with no roll (hooks/DeathsDoorPrompt.js), unless Unstoppable keeps
// them fighting at 0, in which case it ends with no roll here, and Death's Door follows (actionStops).
//
// And the card: the ending roll's 10+ and 6- are buttons on it (wireBattleJoyResult, at the bottom).

import { SYSTEM_ID } from "../system-id.js";
import {
	BATTLE_JOY, BATTLE_JOY_FLAG, BATTLE_JOY_DROPPED_OPTION, BATTLE_JOY_REGAIN, BATTLE_JOY_REGAIN_CHOICE, battleJoyEndsUnrolled,
} from "../actors/character/battle-joy.js";
import { ownsLearnedMoveNamed } from "../actors/character/owns-move.js";
import { HP_CEILING_OPTION } from "../actors/character/StonetopFlags.js";
import { UNSTOPPABLE } from "../actors/character/deaths-door.js";
import { keepsFightingAtZero, stopFightingUpdate } from "../actors/character/unstoppable.js";
import { inBattle } from "../fight/in-battle.js";
import { resolveSync } from "../utils/foundry-compat.js";
import { damageRowActor } from "../utils/damage.js";
import { UNSTOPPABLE_FIGHTS_ON_OPTION, answersFor, openZeroHpMove } from "../hooks/DeathsDoorPrompt.js";
import { healTo } from "../camp/camp-rules.js";
import { each, onMap, fightStanding } from "../fight/fight-state.js";
import { canRewriteCard, postMoveNote, rolledTotalCard } from "../utils/chat.js";
import { withCardLatch } from "../utils/card-latch.js";
import { speakerActor } from "../utils/speaker-actor.js";
import { askWithButtons } from "../utils/ask-with-buttons.js";
import { contentElement } from "../utils/dialogv2-content.js";
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
	// Nobody down, dead or past death is fighting: dying at 0 HP only while Unstoppable keeps them at it, and no
	// other Death's Door state at all (out of the action, a fate being settled, through the Last Door). A Ghost,
	// a Revenant or a Thrall has died (a post-death insert): their 0-HP road is behind them.
	if (!fightStanding(actor).onTheirFeet) return false;
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
	// "As long as you keep fighting. When the action stops, roll +CON" (p.114): with no fight running, no fight's
	// end will come to ask it, so the card says where it is ended from.
	const entered = format(`${KEY}.entered`, { name: actor.name });
	await postMoveNote(actor, BATTLE_JOY, inBattle(actor) ? entered : `${entered} ${format(`${KEY}.noFight`, { name: actor.name })}`);
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
export function hpLost(oldHp, newHp, { fightsOn = false } = {}) {
	const before = Number(oldHp) || 0;
	const after = Number(newHp);
	if (!Number.isFinite(after)) return 0;
	// Down to 0: Death's Door, and nobody down is still fighting, unless Unstoppable keeps them at it (p.114).
	if (after <= 0 && !fightsOn) return 0;
	return Math.max(0, before - Math.max(0, after));
}

/** Two numbers' difference, never below 0, or null unless both are numbers. PURE. */
function drop(from, to) {
	if (from === null || from === undefined || to === null || to === undefined) return null;
	const a = Number(from);
	const b = Number(to);
	return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, a - b) : null;
}

/**
 * The HP each row of a damage card's `applied` list really took off its target (p.239: armor that stops it all
 * means "they don't lose any HP"), for the rows not yet in `seen`. A row with the HP before and after says so; a
 * group member's hit says it through `before`/`after`; a row with neither counts what got through. A voided or
 * ignored blow took nothing. PURE.
 *
 * @param {object[]} applied  the card's `damage.applied`
 * @param {Set<string>} [seen]  rows already asked about
 * @returns {{uuid: string, lost: number}[]}
 */
export function bloodDrawn(applied = [], seen = new Set()) {
	const rows = [];
	for (const row of Array.isArray(applied) ? applied : []) {
		if (!row?.uuid || seen.has(row.uuid) || row.ignored) continue;
		const lost = drop(row.oldHp, row.newHp) ?? drop(row.before, row.after) ?? Math.max(0, Number(row.effective) || 0);
		rows.push({ uuid: row.uuid, lost });
	}
	return rows;
}

/**
 * Whose blood a damage card's Apply has just spilled, for Battle Joy: the character whose own blow (or move's harm)
 * the card is. Never a blow struck AT them (`selfHarm`, a counter-attack: their own blood is the hurt path's), nor a
 * follower's. Null for anyone else. PURE apart from resolving the uuid.
 */
export function bloodSpiller(message, { resolve = resolveSync, scope = SYSTEM_ID } = {}) {
	const damage = message?.getFlag?.(scope, "damage");
	if (!damage || damage.selfHarm || message?.getFlag?.(scope, "followerBlow")) return null;
	const striker = damage.attackerUuid ? damageRowActor(resolve(damage.attackerUuid)) : null;
	return striker?.type === "character" ? striker : null;
}

/** The rows of each damage card already asked about on this client (bloodDrawn's `seen`), by message: let go with it. */
const bloodSeen = new WeakMap();

/**
 * A damage card has just been applied (its `applied` list written): offer Battle Joy to the character whose blow it
 * was, on the one client that answers for them, for the rows whose targets really lost HP. Each row asked once.
 * Whether it asked.
 */
export function offerBattleJoyOnApplied(message, applied, { answers = answersFor, resolve = resolveSync, ask = askLoseThemselves } = {}) {
	if (!Array.isArray(applied) || !applied.length) return false;
	const striker = bloodSpiller(message, { resolve });
	if (!striker || !answers(striker)) return false;
	const seen = bloodSeen.get(message) ?? new Set();
	// Never the Heavy's own row (an area blow that caught them): that is their own blood, asked as such.
	const rows = bloodDrawn(applied, seen).filter(row => damageRowActor(resolve(row.uuid)) !== striker);
	for (const row of applied) if (row?.uuid) seen.add(row.uuid);
	bloodSeen.set(message, seen);
	const totals = rows.map(row => row.lost);
	if (!totals.some(n => n > 0)) return false;
	const move = message.getFlag?.(SYSTEM_ID, "damage")?.move ?? "";
	offerBattleJoyOnDamage(striker, move, totals, { ask }).catch(err => console.error("Stonetop | offering Battle Joy failed", err));
	return true;
}

/**
 * Watch every character's HP for their own blood being spilled, and every damage card's Apply for another's.
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
				// HP taken down to a max that fell (a soul-wound, a Thrall's Mark) or a typed number capped at
				// it: no blood spilled, so nothing to offer (StonetopFlags.js#HP_CEILING_OPTION).
				if (options?.[HP_CEILING_OPTION]) return;
				// The HP test first: most character updates touch no HP, and it costs nothing to ask.
				const raw = globalThis.foundry?.utils?.getProperty?.(changes, "system.attributes.hp.value");
				if (raw === undefined || !ownsLearnedMoveNamed(actor, BATTLE_JOY)) return;
				// Every point taken, a drop to 0 included: whether blood spilled on the way down counts is
				// Unstoppable's, and that is asked once the write commits (below).
				const lost = hpLost(actor.system?.attributes?.hp?.value, raw, { fightsOn: true });
				if (lost > 0 && options) options[HP_LOST_OPTION] = lost;
			} catch (err) {
				console.error("Stonetop | reading HP lost for Battle Joy failed", err);
			}
		})],
		// Every client, once committed; the Heavy's own screen answers.
		["updateActor", hooks.on("updateActor", (actor, _changes, options, userId) => {
			// Dropped to 0 HP while raging, which ended it in the same write (hooks/DeathsDoorPrompt.js):
			// said once, by whoever made the change, as the dying card is.
			if (options?.[BATTLE_JOY_DROPPED_OPTION] && (!userId || userId === globalThis.game?.user?.id)) {
				Promise.resolve(postMoveNote(actor, BATTLE_JOY, format(`${KEY}.endedDropped`, { name: actor.name })))
					.catch(err => console.error("Stonetop | saying Battle Joy ended failed", err));
			}
			const lost = Number(options?.[HP_LOST_OPTION]) || 0;
			if (lost <= 0 || actor?.type !== "character") return;
			// Down to 0 HP, the blood counts only for a Heavy Unstoppable keeps fighting (p.114). The Death's Door
			// hook decides that in this write's preUpdate and says so on the options; every preUpdate has run by
			// the time the write commits, so this reads its answer whichever hook was registered first.
			if (!(Number(actor.system?.attributes?.hp?.value) > 0) && !options?.[UNSTOPPABLE_FIGHTS_ON_OPTION]) return;
			if (!answersFor(actor)) return;
			offerBattleJoyOnHurt(actor, lost).catch(err => console.error("Stonetop | offering Battle Joy failed", err));
		})],
		// ANOTHER'S BLOOD: a damage card's Apply writing the rows it applied (combat/attack-flow.js#wireApplyDamage),
		// seen on every client; the one that answers for the Heavy asks (offerBattleJoyOnApplied).
		["updateChatMessage", hooks.on("updateChatMessage", (message, changes) => {
			try {
				offerBattleJoyOnApplied(message, globalThis.foundry?.utils?.getProperty?.(changes, `flags.${SYSTEM_ID}.damage.applied`));
			} catch (err) {
				console.error("Stonetop | reading blood spilled for Battle Joy failed", err);
			}
		})],
	];
	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}

/**
 * Is this character still in some combat other than the one going (or the combatant leaving)? Only a combatant
 * with a TOKEN counts (fight/in-battle.js#onMap), as inBattle counts one: a world that ran the old Character
 * Introductions still holds that window's tokenless roster Combat with every PC in it, and counted, it had every
 * Heavy "still fighting" for good, so no fight's end ever asked Battle Joy's +CON or Unstoppable's Death's Door.
 */
export function stillFighting(actor, combats, { exceptCombat = null, exceptCombatant = null } = {}) {
	for (const combat of each(combats)) {
		if (exceptCombat && combat.id === exceptCombat.id) continue;
		for (const c of each(combat.combatants)) {
			if (exceptCombatant && c.id === exceptCombatant.id) continue;
			if (!onMap(c)) continue;
			if (c.actor?.id === actor?.id) return true;
		}
	}
	return false;
}

function isRaging(actor) {
	return actor?.type === "character" && !!actor.getFlag?.(SYSTEM_ID, BATTLE_JOY_FLAG);
}

/** Whether the action stopping asks anything of this character: a Battle Joy, or Unstoppable at 0 HP. */
function stopsSomething(actor) {
	// The stamp laid at the drop outlives the combat, which is gone from the world by deleteCombat.
	return isRaging(actor) || keepsFightingAtZero(actor);
}

/**
 * A raging Heavy who is down (0 HP, or with Death's Door dying, owed or behind them) comes out of it
 * with NO roll: they stopped fighting when they dropped (battle-joy.js#battleJoyEndsUnrolled). Said in
 * chat. Also the sheet's own ending, for the glyph clicked on a downed Heavy.
 *
 * @returns {Promise<boolean>} whether it ended anything
 */
export async function endBattleJoyUnrolled(actor) {
	if (!isRaging(actor)) return false;
	await actor.unsetFlag(SYSTEM_ID, BATTLE_JOY_FLAG);
	await postMoveNote(actor, BATTLE_JOY, format(`${KEY}.endedDown`, { name: actor.name }));
	return true;
}

/**
 * The action has stopped for this character, in the order the moves ask it:
 *
 *  1. Battle Joy ends: roll +CON through the sheet's own ending (a Heavy still standing), or, for one
 *     who is down, with no roll at all (endBattleJoyUnrolled).
 *  2. Unstoppable: "When you stop fighting, roll for Death's Door." A Heavy fighting on at 0 HP
 *     (unstoppable.js#keepsFightingAtZero, off the stamp laid at the drop: the combat is gone by now) is
 *     told so, the stamp is lifted (they have stopped fighting), and they are handed the walkthrough,
 *     AFTER the Joy is over, so their debilities count on that roll again.
 */
export async function actionStops(actor, { endBattleJoy, openDeathsDoor = openZeroHpMove } = {}) {
	if (isRaging(actor)) {
		if (battleJoyEndsUnrolled(actor)) await endBattleJoyUnrolled(actor);
		else await endBattleJoy?.(actor);
	}
	if (keepsFightingAtZero(actor)) {
		// keepsFightingAtZero reads the stamp, so there is always one to lift here.
		await actor.update(stopFightingUpdate(actor), { stonetopMove: UNSTOPPABLE });
		await postMoveNote(actor, UNSTOPPABLE, format("stonetop.unstoppable.stopsFighting", { name: actor.name }));
		await openDeathsDoor(actor);
	}
}

/** Whoever's action just stopped: see actionStops. On their own screen only. */
function stopIfFighting(actor, deps) {
	if (!stopsSomething(actor) || !answersFor(actor)) return;
	actionStops(actor, deps).catch(err => console.error("Stonetop | the action stopping failed", err));
}

/**
 * Once the fight is over for them: ask a Heavy still in their Battle Joy to roll +CON, and a Heavy
 * fighting on at 0 HP on Unstoppable's word to roll Death's Door (actionStops).
 *
 * @param {{hooks?: object, endBattleJoy?: (actor: Actor) => Promise<void>, openDeathsDoor?: (actor: Actor) => Promise<void>}} [deps]
 * @returns {() => void} stops listening
 */
export function installBattleJoyEnd({
	hooks = globalThis.Hooks,
	endBattleJoy = actor => actor.sheet?._endBattleJoy?.(),
	openDeathsDoor = openZeroHpMove,
} = {}) {
	const deps = { endBattleJoy, openDeathsDoor };
	const listening = [
		["deleteCombat", hooks.on("deleteCombat", combat => {
			const seen = new Set();
			for (const c of each(combat?.combatants)) {
				const actor = c.actor;
				if (!actor || seen.has(actor.id)) continue;
				seen.add(actor.id);
				// Their state first: scanning every combat is for the rare actor it could matter to.
				if (!stopsSomething(actor) || stillFighting(actor, globalThis.game?.combats, { exceptCombat: combat })) continue;
				stopIfFighting(actor, deps);
			}
		})],
		["deleteCombatant", hooks.on("deleteCombatant", combatant => {
			const combat = combatant?.parent;
			// The whole fight going is deleteCombat's to say.
			if (!combat || !globalThis.game?.combats?.get?.(combat.id)) return;
			const actor = combatant.actor;
			if (!stopsSomething(actor) || stillFighting(actor, globalThis.game?.combats, { exceptCombatant: combatant })) return;
			stopIfFighting(actor, deps);
		})],
	];
	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}

// -- The roll card's buttons ------------------------------------------------------------------------
//
// "On a 10+, that was a rush, regain 1d4 HP; ... on a 6-, mark a debility but don't mark XP." Both
// write to the sheet, so both are buttons on the Battle Joy roll card (battle-joy.js
// #battleJoyTierActions puts them there). ONE use per card: the choice latches on the message, written
// FIRST, so a second click, a re-render or a reload cannot heal twice or mark two debilities.

/** Message flag holding what the card was settled with: "regain", or the debility's key. */
export const BATTLE_JOY_RESULT_FLAG = "battleJoyResult";

/**
 * Wire a Battle Joy roll card's buttons (dispatched from stonetop.js renderChatMessageHTML). Pressed by
 * whoever can write both the card and the character (chat.js#canRewriteCard): the Heavy's player on
 * their own roll, and the GM. Everyone else, and everyone once it is settled, sees them disabled, with
 * the one that was used marked.
 */
export function wireBattleJoyResult(message, html) {
	const root = html?.[0] ?? html;
	const buttons = [...(root?.querySelectorAll?.(".stonetop-battle-joy-result") ?? [])];
	if (!buttons.length) return;
	const actor = speakerActor(message);
	const settled = message?.getFlag?.(SYSTEM_ID, BATTLE_JOY_RESULT_FLAG) ?? null;
	const usable = !settled && canRewriteCard(message, actor);
	for (const btn of buttons) {
		btn.classList.toggle("is-chosen", !!settled && btn.dataset.choice === settled);
		if (!usable) { btn.disabled = true; continue; }
		btn.addEventListener("click", () => {
			settleBattleJoyResult(message, actor, btn.dataset.choice, { buttons })
				.catch(err => console.error("Stonetop | settling the Battle Joy roll failed", err));
		});
	}
}

/**
 * Do what the card's button says, once. Returns whether it did.
 *
 * @param {ChatMessage} message  the Battle Joy roll card
 * @param {Actor} actor  the Heavy who rolled it
 * @param {string} choice  "regain", or a debility key
 * @param {{buttons?: HTMLButtonElement[]}} [options]  the card's buttons, disabled while it runs
 */
export async function settleBattleJoyResult(message, actor, choice, { buttons = [] } = {}) {
	if (!choice || !actor || message?.getFlag?.(SYSTEM_ID, BATTLE_JOY_RESULT_FLAG)) return false;
	return withCardLatch(message, BATTLE_JOY_RESULT_FLAG, choice, buttons, async () => {
		if (choice === BATTLE_JOY_REGAIN_CHOICE) {
			await regainBattleJoyHp(actor);
			return true;
		}
		// Marked since the card was posted: nothing to write, and the other buttons are still good.
		if (!(await actor.typedActor?.markDebility?.(choice, { moveName: BATTLE_JOY }))) {
			globalThis.ui?.notifications?.warn?.(localize(`${KEY}.debilityTaken`));
			return false;
		}
		const name = actor.typedActor?.debilityMarkChoices?.find(d => d.key === choice)?.name ?? choice;
		await postMoveNote(actor, BATTLE_JOY, format(`${KEY}.debilityMarked`, { name: actor.name, debility: name }));
		return true;
	});
}

/**
 * The 10+: roll 1d4 and regain that much, capped at max HP, through the character's own HP restore.
 * The roll goes to chat as a roll, so the die is seen landing.
 */
async function regainBattleJoyHp(actor) {
	const character = actor.typedActor;
	const roll = await new Roll(BATTLE_JOY_REGAIN).evaluate();
	const hp = Number(actor.system?.attributes?.hp?.value) || 0;
	const to = healTo(hp, roll.total, await character.computedMaxHp());
	if (to > hp) await character.restoreHp(to, BATTLE_JOY);
	// The card says what the sheet now holds, read back after the write: the restore can land on less
	// than asked (a Thrall's Torment's Blessing halves every heal, deaths-door-actor.js#recoveredHpTo).
	const now = Number(actor.system?.attributes?.hp?.value) || 0;
	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor:  rolledTotalCard(roll, BATTLE_JOY, localize(`${KEY}.regainedLabel`), format(`${KEY}.regainedLine`, { from: hp, to: Math.max(hp, now) })),
	});
}
