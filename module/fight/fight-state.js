// A fight's documents, read into engagements.js's plain input, for whoever is looking.
//
// THE ONLY PLACE THAT TOUCHES DOCUMENTS for the fight's arithmetic: the Fight tab, the map overlay
// and the damage pre-fill all come through here, so they cannot disagree about who is fighting whom.
//
// THE RECORD IS CORE'S. A fight is a Combat; its Combatants carry three flags of ours: `side`
// ("heroes"|"foes", stamped when they join), `count` (a headcount the GM set on a token standing for
// several plain NPCs; a follower group's bodies come from its character's roster instead) and `shots`
// (who a fighter last rolled damage at from range, fight-shots.js). Melee is never stored: it is worked
// out from where the tokens stand.
//
// Three things about the documents that are easy to get wrong:
//  • A TOKEN MID-ANIMATION IS NOT WHERE IT IS GOING. Core merges each animation frame into the token
//    document itself, so `tokenDoc.x` walks across the map for a second after every move. Contact is
//    read from `_source`, the position the move saved, or the engagements would flicker frame by frame.
//  • MONSTER TOKENS ARE UNLINKED. Their HP, group size and "fight as a group" switch live on the
//    token's own actor (`combatant.actor` is `token.actor`), never on the sidebar actor.
//  • A PLAYER'S TARGETS ONLY EXIST ON THE CANVAS SCENE. Core keeps every user's targets in sync, but
//    only for the scene on screen, so a scene nobody is looking at has melee and recorded shots only.

import { SYSTEM_ID } from "../system-id.js";
import { each } from "./in-battle.js";
import { engage, HEROES, FOES } from "./engagements.js";
import { classifySide, bodiesFor } from "./fight-sides.js";
import { followerRoster } from "./fight-vitals.js";
import { keepsFightingAtZero } from "../actors/character/unstoppable.js";

export const FIGHT_FLAG = "fight";
export const SIDE_FLAG = "side";
export const COUNT_FLAG = "count";
/** The combatant ids a fighter was last seen shooting at (fight-shots.js). */
export const SHOTS_FLAG = "shots";

/**
 * The flag holding how many the group was before lone blows began dropping its members. A member going
 * down lowers `system.count`, which is the group's size for every rule that counts it; this keeps the
 * number it started at, so the Fight tab can say "5 of 6 standing" rather than "5 of 5".
 */
export const GROUP_SIZE_FLAG = "groupSize";

/** The size a group started at, as kept on its token's actor, or 0 when none is kept. */
export const groupStartSize = actor => Math.max(0, Math.trunc(Number(actor?.flags?.[SYSTEM_ID]?.[GROUP_SIZE_FLAG]) || 0));

/** Core's OWNER ownership level, which a module read in tests cannot reach through CONST. */
const OWNER = 3;

const ours = doc => doc?.flags?.[SYSTEM_ID] ?? {};
// A collection as an array (in-battle.js, a leaf, so the character rules can share it).
export { each };

/** Whether a Combat was started (or claimed) as a Stonetop fight. */
export function isFight(combat) {
	return !!ours(combat)[FIGHT_FLAG];
}

/** Whether a combat is fought on this scene: linked to it, or unlinked with someone standing on it. */
export function combatTouchesScene(combat, scene) {
	if (!combat || !scene) return false;
	if (combat.scene) return combat.scene.id === scene.id;
	return each(combat.combatants).some(c => c.sceneId === scene.id);
}

/**
 * The combat on a scene: the one the tab is showing when it is fought here, else the active one, else
 * the most recently changed. `counts` decides which Combats are worth looking at at all.
 *
 * ⚠ THE TAB CAN BE SHOWING A COMBAT THAT IS OVER. Core takes a deleted Combat out of `game.combats`
 * before the delete hooks run, but the tab only lets go of it when its redraw lands, a render later.
 * Anything asking in between (the Fight window closing at the end of a fight) would be handed the
 * fight that just ended, so the tab's choice counts only while the world still holds it.
 *
 * @param {Scene|null} scene
 * @param {(combat: Combat) => boolean} [counts]  which Combats count; fights, by default
 */
export function combatOnScene(scene, counts = isFight) {
	if (!scene) return null;
	const viewed = globalThis.ui?.combat?.viewed ?? null;
	const combats = globalThis.game?.combats;
	const stillHeld = typeof combats?.get !== "function" || combats.get(viewed?.id) === viewed;
	if (viewed && counts(viewed) && stillHeld && combatTouchesScene(viewed, scene)) return viewed;
	const here = each(globalThis.game?.combats).filter(c => counts(c) && combatTouchesScene(c, scene));
	here.sort((a, b) => (Number(!!b.active) - Number(!!a.active))
		|| ((b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0)));
	return here[0] ?? null;
}

/**
 * The fight on a scene. Only a Combat stamped as a fight counts: a world that ran the old
 * Introductions still has its active, tokenless roster Combat, and that is nobody's fight.
 */
export function fightOnScene(scene) {
	return combatOnScene(scene, isFight);
}

/** What classifySide needs to know about an actor and its token. */
export function sideInfoFor(actor, tokenDoc = null) {
	return {
		type: actor?.type ?? "",
		hasPlayerOwner: !!actor?.hasPlayerOwner,
		isFollower: !!actor?.flags?.[SYSTEM_ID]?.followerOrigin,
		disposition: tokenDoc?._source?.disposition ?? tokenDoc?.disposition ?? null,
	};
}

/** The side a combatant fights on: the one stamped on it, else the one its actor implies. */
export function combatantSide(combatant) {
	const stamped = ours(combatant)[SIDE_FLAG];
	if (stamped === HEROES || stamped === FOES) return stamped;
	return classifySide(sideInfoFor(combatant?.actor, combatant?.token))?.side ?? null;
}

/** How many capable bodies a combatant's token stands for. See fight-sides.js#bodiesFor. */
export function combatantBodies(combatant) {
	const actor = combatant?.actor;
	const system = actor?.system ?? {};
	return bodiesFor({
		defeated: !!combatant?.isDefeated,
		type: actor?.type ?? "",
		fightAsGroup: !!system.fightAsGroup,
		organization: system.organization ?? "",
		hp: system.attributes?.hp ?? {},
		count: system.count ?? 0,
		headcount: ours(combatant)[COUNT_FLAG] ?? null,
		roster: followerRoster(combatant),
		startSize: groupStartSize(actor),
		keepsFighting: keepsFightingAtZero(actor),
	});
}

/** The scene's grid, as engagements.js#touching reads it. */
export function gridOf(scene) {
	const grid = scene?.grid ?? {};
	const types = globalThis.CONST?.GRID_TYPES ?? { GRIDLESS: 0, SQUARE: 1 };
	const type = Number(grid.type ?? types.SQUARE);
	const kind = type === types.GRIDLESS ? "gridless" : type === types.SQUARE ? "square" : "hex";
	return { size: Number(grid.size) > 0 ? Number(grid.size) : 100, kind };
}

/** A token's footprint in scene pixels, from its SAVED position and size (see the note at the top). */
export function tokenRect(tokenDoc) {
	const src = tokenDoc?._source ?? tokenDoc ?? {};
	const width = Number(src.width) || 1;
	const height = Number(src.height) || 1;
	const size = typeof tokenDoc?.getSize === "function"
		? tokenDoc.getSize({ width, height })
		: { width: width * 100, height: height * 100 };
	return { x: Number(src.x) || 0, y: Number(src.y) || 0, w: size.width, h: size.height };
}

/** The level a token stands on, from its saved data, or null on a map without levels. */
export const tokenLevel = tokenDoc => tokenDoc?._source?.level ?? null;

/** The canvas's scene rectangle, as `{x, y, w, h}`, or null. */
export function sceneRectOf(canvas) {
	const rect = canvas?.dimensions?.sceneRect ?? canvas?.dimensions?.rect ?? null;
	return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
}

/** Whether rectangle `at` lies wholly inside `bounds`; anything does when there are no bounds. */
export function insideRect(at, bounds) {
	return !bounds || (at.x >= bounds.x && at.y >= bounds.y
		&& at.x + at.w <= bounds.x + bounds.w && at.y + at.h <= bounds.y + bounds.h);
}

/**
 * One combatant as a fighter on `scene`, or null when their token is not on it.
 *
 * VISIBILITY IS THE TRACKER'S OWN RULE, not the canvas's line of sight: a GM counts everyone; a player
 * counts a combatant core's tracker would show them (`combatant.visible`) whose token is not hidden.
 * Sight would make a player's numbers change as their token turns a corner, and would differ between
 * a scene they are looking at and one they are not.
 */
export function fighterOf(combatant, { scene, viewer = globalThis.game?.user } = {}) {
	const token = combatant?.token;
	if (!token || !scene || combatant.sceneId !== scene.id) return null;
	const side = combatantSide(combatant);
	if (!side) return null;
	const { bodies, out } = combatantBodies(combatant);
	const visible = !!viewer?.isGM || (combatant.visible !== false && !token.hidden);
	return {
		id: combatant.id,
		side,
		name: combatant.name || token.name || combatant.actor?.name || "",
		rect: tokenRect(token),
		level: tokenLevel(token),
		bodies,
		out,
		visible,
	};
}

/**
 * Which fighter a player's targets shoot from: the token of their assigned character, else the one
 * hero they own outright. Null for a GM, whose targets are bookkeeping for whichever creature they
 * happen to be running, and for a player with several heroes and no character assigned, where
 * there is no telling which of them is doing the shooting.
 */
export function userFighterId(user, combat, scene) {
	if (!user || user.isGM || !combat || !scene) return null;
	const here = each(combat.combatants).filter(c => c.sceneId === scene.id && c.token);
	const character = user.character ?? null;
	if (character) {
		const mine = here.find(c => c.actorId === character.id);
		if (mine) return mine.id;
	}
	const owned = here.filter(c => combatantSide(c) === HEROES && (c.actor?.ownership?.[user.id] ?? 0) >= OWNER);
	return owned.length === 1 ? owned[0].id : null;
}

/**
 * Every shot on this scene: each player's live targets, from their fighter, and every shot a fighter
 * has on record (SHOTS_FLAG, fight-shots.js), marked `recorded`.
 *
 * A player's targets only exist on the canvas scene (see the note at the top). A recorded shot is on
 * the combatant itself, so it holds on any scene and for any fighter: a crew loosing a volley, a
 * monster spitting at a character, anyone whose shots nobody is aiming with T.
 */
export function rangedPairs(combat, scene, { users = globalThis.game?.users, canvasScene = globalThis.canvas?.scene } = {}) {
	if (!combat || !scene) return [];
	const here = each(combat.combatants).filter(c => c.sceneId === scene.id);
	const ids = new Set(here.map(c => c.id));
	const pairs = [];
	for (const combatant of here) {
		const shots = ours(combatant)[SHOTS_FLAG];
		for (const to of Array.isArray(shots) ? shots : []) {
			if (typeof to === "string" && to !== combatant.id && ids.has(to)) pairs.push({ from: combatant.id, to, recorded: true });
		}
	}
	if (canvasScene?.id !== scene.id) return pairs;
	const byToken = new Map(here.map(c => [c.tokenId, c]));
	for (const user of each(users)) {
		if (!user?.active || user.isGM) continue;
		const from = userFighterId(user, combat, scene);
		if (!from) continue;
		for (const target of each(user.targets)) {
			const combatant = byToken.get(target?.document?.id ?? target?.id);
			if (combatant && combatant.id !== from) pairs.push({ from, to: combatant.id });
		}
	}
	return pairs;
}

/**
 * The whole fight on one scene, for one viewer.
 *
 * @returns {null|{combat, scene, fighters: object[], combatants: Map<string, object>,
 *   elsewhere: object[], result: ReturnType<typeof engage>}}
 *   `elsewhere` holds the combatants this viewer may see whose token is not on this scene.
 */
export function snapshotFight(combat, { scene, viewer = globalThis.game?.user, users, canvasScene } = {}) {
	if (!combat || !scene) return null;
	const fighters = [];
	const combatants = new Map();
	const elsewhere = [];
	for (const combatant of each(combat.combatants)) {
		const fighter = fighterOf(combatant, { scene, viewer });
		if (fighter) {
			fighters.push(fighter);
			combatants.set(combatant.id, combatant);
		// The SAME two-part rule fighterOf applies, for the same reason: core's tracker flag and the
		// token's own hidden switch. Checking only the first showed a player a HUD-hidden ambusher
		// waiting on another scene, which is the one thing hiding it was meant to prevent.
		} else if (viewer?.isGM || (combatant.visible !== false && !combatant.token?.hidden)) {
			elsewhere.push(combatant);
		}
	}
	// Heroes listed first, each side in the order they joined, so engagements read left to right.
	fighters.sort((a, b) => (a.side === b.side ? 0 : a.side === HEROES ? -1 : 1));
	const result = engage({
		fighters,
		grid: gridOf(scene),
		ranged: rangedPairs(combat, scene, { users, canvasScene }),
	});
	return { combat, scene, fighters, combatants, elsewhere, result };
}

/**
 * The fight a token is in, from that token's point of view, or null when it is in none: its fight,
 * its combatant, and its entry in the engagements.
 */
export function engagementFor(tokenDoc, options = {}) {
	const scene = tokenDoc?.parent ?? null;
	const combat = fightOnScene(scene);
	if (!combat) return null;
	const combatant = each(combat.combatants).find(c => c.tokenId === tokenDoc.id && c.sceneId === scene.id);
	return engagementOf(combat, scene, combatant, options);
}

/** One combatant's place in a fight on `scene`: the snapshot, the combatant and its entry, or null. */
export function engagementOf(combat, scene, combatant, { viewer = globalThis.game?.user, users, canvasScene } = {}) {
	if (!combatant) return null;
	const snapshot = snapshotFight(combat, { scene, viewer, users, canvasScene });
	const entry = snapshot?.result.byFighter[combatant.id];
	return entry ? { ...snapshot, combatant, entry } : null;
}
