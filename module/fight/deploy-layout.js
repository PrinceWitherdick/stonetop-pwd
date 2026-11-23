// Where the GM Toolkit's Deploy puts things: the party on the LEFT, what was deployed against them on
// the RIGHT (the user's rule, 2026-11-23). Read by gm-bundle-tab.js#deploy, so the Encounters and
// Expeditions cards and "Deploy and fight" all lay a scene out the same way.
//
// THE SAME FORMATION "START A FIGHT" DROPS ITS ARRIVALS IN (line-up.js#lineUpPositions): heroes in
// columns left of the middle of the view, foes in columns right of it, `gap` squares apart, so a
// deploy followed by "Line everyone up" moves nobody a second time.
//
// THE PARTY IS MOVED, NOT ONLY THE NEWCOMERS. A deploy puts the encounter in front of the GM, and the
// player characters' tokens, wherever on this map they stood, are lined up on the left facing it. Their
// followers come with them (follower-masters.js). Anyone already in a fight on this map is left
// exactly where they stand: moving them would end whatever engagement they are in (line-up.js says
// why), and "Deploy and fight" asks before it touches a running fight at all.
//
// CENTRED ON THE VIEW, NOT ON THE PARTY. The party's tokens are handed to the line-up WITHOUT their
// positions, so the formation is built round the middle of what the GM is looking at (as a deploy
// always was) and none of them counts as standing against anyone.
//
// EXCEPT ROUND A FIGHT ALREADY GOING ON HERE ("Add them to this fight", or a plain Deploy mid-fight).
// Its combatants go to the line-up WITH their positions, as the Fight tab's "Line everyone up" hands
// them, so the formation is built round the fight and the newcomers' columns open clear of its
// scrums: dropped round the middle of the view, they landed in among the fighters and joined
// already engaged. The fighters themselves are not moved; their places in the answer are ignored.
//
// WHICH SIDE AN ARRIVAL IS ON is the fight's own reading of its actor (fight-sides.js#classifySide):
// a follower or a FRIENDLY prototype joins the party's column; everything else in an encounter,
// a plain NPC included, is something to be faced, and goes on the right.

import { lineUpPositions } from "./line-up.js";
import { HEROES, FOES } from "./engagements.js";
import { classifySide } from "./fight-sides.js";
import { combatantBodies, combatantSide, each, fightOnScene, gridOf, sceneRectOf, sideInfoFor, tokenLevel } from "./fight-state.js";
import { viewRectWorld } from "./start-fight.js";
import { followerMasterIndex } from "../actors/character/follower-masters.js";

/** The side an actor not yet on the map would fight on, read off its prototype token. */
export function arrivalSide(actor) {
	const info = sideInfoFor(actor, { disposition: actor?.prototypeToken?.disposition ?? null });
	return classifySide(info)?.side === HEROES ? HEROES : FOES;
}

/**
 * The tokens on `scene` that line up on the party's side: every player character's, and their
 * followers', less anyone already in a fight here. In reading order (top to bottom, then left to
 * right), so the column keeps the order they stood in.
 */
export function partyTokensOn(scene) {
	if (!scene) return [];
	const tokens = each(scene.tokens).filter(t => t?.actor);
	const fighting = new Set(each(fightOnScene(scene)?.combatants).filter(c => c.sceneId === scene.id).map(c => c.tokenId));
	const characters = [...new Map(tokens.filter(t => t.actor.type === "character").map(t => [t.actor.id, t.actor])).values()];
	if (!characters.length) return [];
	const masters = followerMasterIndex({ characters, actors: tokens.map(t => t.actor) });
	const at = t => t._source ?? t;
	return tokens
		.filter(t => !fighting.has(t.id) && (t.actor.type === "character" || masters.has(t.actor.id)))
		.sort((a, b) => (at(a).y - at(b).y) || (at(a).x - at(b).x));
}

/**
 * The running fight's combatants on `scene`, as the line-up takes standing fighters: where they
 * stand, which side, and whether they are out of it. Empty with no fight here.
 */
export function fightersOn(scene) {
	if (!scene) return [];
	return each(fightOnScene(scene)?.combatants)
		.filter(c => c.sceneId === scene.id && c.token)
		.map(c => {
			const src = c.token._source ?? c.token;
			return {
				id: `fighting:${c.token.id}`, side: combatantSide(c),
				w: src.width ?? 1, h: src.height ?? 1, x: src.x, y: src.y,
				level: tokenLevel(c.token), out: combatantBodies(c).out,
			};
		})
		.filter(f => f.side === HEROES || f.side === FOES);
}

/**
 * Where each deployed actor goes, and where the party's tokens move to.
 *
 * @param {object} p
 * @param {Canvas} [p.canvas]
 * @param {Actor[]} p.actors     the world actors about to be placed, in order
 * @param {boolean} [p.moveParty]  false leaves the party where it stands (a deploy by a player, who
 *   cannot move other players' tokens)
 * @returns {{points: Array<{x: number, y: number}|null>, moves: Array<{id: string, x: number, y: number}>}}
 *   `points[i]` is the i-th actor's CENTRE before snapping, which is what core's drop takes (null when
 *   the line-up had no place for it); `moves` are snapped top-left corners for displaceTokens, with
 *   anyone already standing there left out
 */
export function deployLayout({ canvas = globalThis.canvas, actors = [], moveParty = true } = {}) {
	const scene = canvas?.scene ?? null;
	const size = canvas?.dimensions?.size ?? canvas?.grid?.size ?? 100;
	const arrivals = actors.map((actor, i) => ({
		id: `arrival:${i}`,
		side: arrivalSide(actor),
		w: actor?.prototypeToken?.width ?? 1,
		h: actor?.prototypeToken?.height ?? 1,
	}));
	const party = moveParty ? partyTokensOn(scene) : [];
	const fighting = fightersOn(scene);
	const positions = lineUpPositions({
		view: viewRectWorld(canvas),
		size,
		sceneRect: sceneRectOf(canvas),
		gridKind: gridOf(scene).kind,
		heroes: [
			...fighting.filter(f => f.side === HEROES),
			...party.map(t => ({ id: t.id, w: (t._source ?? t).width ?? 1, h: (t._source ?? t).height ?? 1 })),
			...arrivals.filter(a => a.side === HEROES),
		],
		foes: [...fighting.filter(f => f.side === FOES), ...arrivals.filter(a => a.side !== HEROES)],
	});
	const points = arrivals.map(a => {
		const at = positions.get(a.id);
		return at ? { x: at.x + (a.w * size) / 2, y: at.y + (a.h * size) / 2 } : null;
	});
	const moves = [];
	for (const token of party) {
		const target = positions.get(token.id);
		if (!target) continue;
		const fixed = typeof token.getSnappedPosition === "function" ? token.getSnappedPosition({ x: target.x, y: target.y }) : target;
		const src = token._source ?? token;
		if (fixed.x === src.x && fixed.y === src.y) continue;
		moves.push({ id: token.id, x: fixed.x, y: fixed.y });
	}
	return { points, moves };
}
