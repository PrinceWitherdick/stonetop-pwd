// When the fight on the map may have changed, and what to redraw.
//
// Core already redraws the tab when a Combat or Combatant changes. What it cannot know is that a
// TOKEN moving next to another one, a player targeting a foe, or a horde losing HP changes who is
// fighting whom. This listens for exactly those, folds a burst of them into one recompute per
// animation frame, and hands two different jobs to two callbacks:
//  • `onEngagement`: something that can change who is engaged or how many bodies count. The tab
//    redraws only if the engagements actually changed (fight-state's signature).
//  • `onGeometry`: something that changes only where things are drawn (a token sliding across the
//    map mid-animation, the canvas zooming). The overlay redraws; the tab does not care.

import { coalesceFrame } from "../utils/coalesce.js";
import { changedKeys } from "../utils/foundry-compat.js";
import { SYSTEM_ID } from "../system-id.js";
import { READINESS_FLAG } from "../combat/defend-readiness.js";
import { DEATHS_DOOR_FLAG, UNSTOPPABLE_FIGHTING_FLAG } from "../actors/character/deaths-door.js";
import { LEFT_PLAY_FLAG } from "../campaign/left-play.js";

/** Token fields that can change contact, visibility or which actor stands behind the token. */
const TOKEN_KEYS = ["x", "y", "width", "height", "hidden", "elevation", "level", "shape", "actorId", "actorLink", "disposition"];

/**
 * Actor fields that change how many bodies a token stands for, or the numbers a row shows: HP, armor,
 * a character's crew and custom followers, whose rosters say how many of a group are standing, and a
 * character's Defend Readiness, and the gear tags and typed reminders a character's row carries
 * (actors/character/gear-reminders.js). And a character's brush with death, which can put them out of the
 * fight with no hit point changing (fight-state.js#fightStanding's `doorOut`): their Death's Door state, Unstoppable's
 * "fighting on" stamp, the post-death insert that answers a fate, and having left play.
 */
const ACTOR_PATHS = [
	"system.attributes.hp", "system.attributes.armor", "system.count", "system.fightAsGroup", "system.organization",
	"system.attributes.gearTags", "system.reminders",
	`flags.${SYSTEM_ID}.crew`, `flags.${SYSTEM_ID}.customFollowers`, `flags.${SYSTEM_ID}.${READINESS_FLAG}`,
	...[DEATHS_DOOR_FLAG, UNSTOPPABLE_FIGHTING_FLAG, "postDeathInsert", LEFT_PLAY_FLAG].map(key => `flags.${SYSTEM_ID}.${key}`),
];

/** ACTOR_PATHS as a set, built once: it is read on every actor update on every client. */
const ACTOR_PATH_SET = new Set(ACTOR_PATHS);

/** Whether `key` is one of ACTOR_PATHS or lies under one: each of its own leading paths, looked up in the set. */
function keyCountsBodies(key) {
	for (let dot = key.indexOf("."); dot !== -1; dot = key.indexOf(".", dot + 1)) {
		if (ACTOR_PATH_SET.has(key.slice(0, dot))) return true;
	}
	return ACTOR_PATH_SET.has(key);
}

/**
 * Whether an actor update changed anything that decides bodies or a row's numbers. The keys are read back to plain
 * paths once (foundry-compat.js#changedKeys), so a stamp LIFTED is heard as well as one laid.
 */
export function actorChangeCountsBodies(changes = {}) {
	return changedKeys(changes).some(keyCountsBodies);
}

/** Whether a token update changed anything that decides engagements. */
export function tokenChangeCountsContact(changes = {}) {
	return TOKEN_KEYS.some(key => key in changes);
}

/**
 * Listen for everything that can change the fight on the map.
 *
 * @param {object} p
 * @param {() => void} [p.onEngagement]
 * @param {() => void} [p.onGeometry]
 * @param {object} [p.hooks]  core's Hooks (injectable for tests)
 * @returns {() => void} a function that stops listening
 */
export function installFightWatcher({ onEngagement = () => {}, onGeometry = () => {}, hooks = globalThis.Hooks } = {}) {
	const engagement = coalesceFrame(() => { onEngagement(); onGeometry(); }, "Stonetop | fight engagements:");
	const geometry = coalesceFrame(onGeometry, "Stonetop | fight overlay:");
	const listening = [];
	const on = (name, fn) => listening.push([name, hooks.on(name, fn)]);

	on("updateToken", (_doc, changes) => { if (tokenChangeCountsContact(changes)) engagement(); });
	on("createToken", engagement);
	on("deleteToken", engagement);
	for (const name of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) {
		on(name, engagement);
	}
	on("updateActor", (_actor, changes) => { if (actorChangeCountsBodies(changes)) engagement(); });
	// A GM's targets never count (fight-state.js#userFighterId), so only a player's change matters.
	on("targetToken", user => { if (!user?.isGM) engagement(); });
	on("updateUser", (_user, changes) => { if ("character" in (changes ?? {})) engagement(); });
	on("userConnected", engagement);
	on("canvasReady", engagement);

	on("refreshToken", (_token, flags) => {
		if (flags?.refreshPosition || flags?.refreshSize || flags?.refreshVisibility || flags?.refreshState) geometry();
	});
	on("sightRefresh", geometry);
	// The overlay is drawn in scene space, so a pan moves it along for free; only a zoom changes the
	// on-screen floor its line widths are held to.
	let zoom = NaN;
	on("canvasPan", (_canvas, view) => {
		if (view?.scale === zoom) return;
		zoom = view?.scale;
		geometry();
	});

	return () => {
		for (const [name, id] of listening) hooks.off(name, id);
		listening.length = 0;
	};
}
