// Sending a fighter at someone on the other side: a row in the Fight tab (or window) is dragged onto a
// row on the other side, and the dragged one's token steps into the nearest free space touching them.
// It goes either way about, a foe sent at a hero or a hero sent at a foe; the row picked up is always
// the token that moves.
//
// ANYONE IN THE FIGHT. Where a token stands matters little in Stonetop beyond who it is fighting, so a
// player may send anyone in the fight at someone, their own character, another player's, a monster or
// an NPC, and have the target's packmates step aside (`mayMove`). Only a hidden fighter stays put for a
// player: moving it would show where it lies in wait. Core lets a player move only tokens they own, so
// whatever else they send is handed to the active GM's client (`SEND_QUERY`), which checks the asking
// user again (in the fight, not hidden) before it moves anything. With no GM connected, nothing moves.
//
// NOTHING IS RECORDED. The engagement, its line on the map and the foe's place under the hero in the
// tab all follow from the two tokens touching (engagements.js#touching), exactly as if the GM had
// dragged the token across the map by hand.
//
// THE NEAREST FREE SPACE. Every spot whose footprint touches the one dropped on without covering them
// is a candidate; one that would cover another token, or hang off the scene, is not. Of the rest, the
// one closest to where the mover already stands wins, so a foe coming from the east arrives on the
// hero's east side. With no room at all, nothing moves and the GM is told.
//
// ONE FOE, NOT THREE. Engagements come from contact, so a spot that also touches the target's allies
// would pull the mover into a fight with all of them. A spot touching none of them always wins over
// a nearer one that touches some. When every spot touches one (the target stands in a pack of its
// own side), the fewest-touching spot is taken and the allies touching it step aside into the
// nearest free space clear of it (`stepAside`), in the same displace. One hidden from a player stays put.
//
// The candidates are PURE (`spotBeside`); `sendAgainst` reads the documents and moves the token in
// core's "displace" movement, as a line-up does: straight there, through walls, no walk along the way.

import { format } from "../utils/i18n.js";
import { displaceTokens, queryAsker } from "../utils/foundry-compat.js";
import { touching } from "./engagements.js";
import { combatantSide, combatantBodies, gridOf, tokenRect, tokenLevel, sceneRectOf, insideRect, fightOnScene, snapshotFight } from "./fight-state.js";
import { overlapShare, rectCenter } from "./overlay-geometry.js";

/** The User query a player's send goes through when it moves a token they do not own. */
export const SEND_QUERY = "stonetop.sendAgainst";

/** Whether a fighter is hidden from players: its token, or its row in the fight. */
function isHidden(combatant) {
	return !!(combatant?.token?.hidden || combatant?.hidden);
}

/**
 * Whether a reader may send (or step aside) a fighter: anyone in the fight, but a hidden one only for
 * a GM, since moving it would show a player where it lies in wait.
 *
 * @param {{hidden?: boolean, token?: {hidden?: boolean}|null}|null} combatant
 * @param {{isGM?: boolean}|null} [user]
 */
export function mayMove(combatant, user = globalThis.game?.user) {
	return !!combatant && (!!user?.isGM || !isHidden(combatant));
}

/**
 * Who a fighter could be sent at from the Fight tab's "Send at..." (FightTracker#_askSendAt), the path for a
 * reader who cannot drag a row: everyone on the other side of the fight on the canvas scene who is still in it
 * and whom this reader may see (fight-state.js#fighterOf's rule), in the order the tab lists them. Empty for a
 * fighter this reader may not move (`mayMove`), one not on the canvas scene, or a fight on another map.
 *
 * @returns {Array<{id: string, name: string}>}
 */
export function sendAtChoices(combat, mover, { scene = globalThis.canvas?.scene, viewer = globalThis.game?.user } = {}) {
	if (!combat || !mover?.token || !scene || mover.sceneId !== scene.id || !mayMove(mover, viewer)) return [];
	const snapshot = snapshotFight(combat, { scene, viewer });
	const self = snapshot?.fighters.find(f => f.id === mover.id);
	// One out of the fight is not picked up by a drag either (fight-view.js#canPickUp).
	if (!self || self.out) return [];
	return snapshot.fighters
		.filter(f => f.side !== self.side && f.visible !== false && !f.out && f.bodies > 0)
		.map(f => ({ id: f.id, name: f.name }));
}

/** How much of the smaller footprint two tokens may share before one is standing on the other. */
const CROWDED = 0.25;

/**
 * The spots a footprint could stand in, laid out in whole squares from `origin` over `rows` and `cols`
 * (each `[first, last]`) and pulled onto the grid by `snap`, once each: inside the scene, not on another
 * token, and passing the caller's own `keep`. Each with the spot's centre, for the caller to rank by.
 */
function freeSpots({ footprint, origin, rows, cols, size, snap, sceneRect, others, keep }) {
	const seen = new Set();
	const spots = [];
	for (let row = rows[0]; row <= rows[1]; row += 1) {
		for (let col = cols[0]; col <= cols[1]; col += 1) {
			const snapped = snap({ x: origin.x + col * size, y: origin.y + row * size });
			const at = { x: snapped.x, y: snapped.y, w: footprint.w, h: footprint.h };
			const key = `${at.x},${at.y}`;
			if (seen.has(key)) continue;
			seen.add(key);
			if (!keep(at) || !insideRect(at, sceneRect)) continue;
			if (others.some(other => overlapShare(at, other) > CROWDED)) continue;
			spots.push({ at, center: rectCenter(at) });
		}
	}
	return spots;
}

/**
 * Where a foe should stand to fight a hero: the top-left corner of the free spot touching the hero
 * closest to the foe, or null when every spot is taken.
 *
 * Candidates are laid out in whole squares around the hero's footprint. On a square grid that is
 * every neighbouring position; on a hex grid `snap` pulls each onto a hex and the touching test keeps
 * the ones that really neighbour the hero. "Taken" is a footprint sharing more than a quarter of
 * itself with another token, which tells a neighbouring hex (a sliver of overlap) from the same one.
 *
 * @param {object} p
 * @param {{x: number, y: number, w: number, h: number}} p.mover   the foe's footprint now, in scene pixels
 * @param {{x: number, y: number, w: number, h: number}} p.target  the hero's footprint
 * @param {Array<{x: number, y: number, w: number, h: number}>} [p.others]  every other token's footprint
 * @param {Array<{x: number, y: number, w: number, h: number}>} [p.rivals]  the target's allies in the
 *   fight: a spot touching none of them beats a nearer one touching some, and fewer beats more
 * @param {{size?: number, kind?: string}} [p.grid]
 * @param {{x: number, y: number, w: number, h: number}|null} [p.sceneRect]  spots must lie inside it
 * @param {(point: {x: number, y: number}) => {x: number, y: number}} [p.snap]
 * @returns {{x: number, y: number}|null}
 */
export function spotBeside({ mover, target, others = [], rivals = [], grid = {}, sceneRect = null, snap = point => point }) {
	if (!mover || !target) return null;
	const size = Number(grid.size) > 0 ? Number(grid.size) : 100;
	const across = Math.max(1, Math.round(mover.w / size));
	const down = Math.max(1, Math.round(mover.h / size));
	const targetAcross = Math.max(1, Math.round(target.w / size));
	const targetDown = Math.max(1, Math.round(target.h / size));
	const g = { size, kind: grid.kind };
	const from = rectCenter(mover);

	const spots = freeSpots({
		footprint: mover, origin: target, rows: [-down, targetDown], cols: [-across, targetAcross], size, snap, sceneRect, others,
		keep: at => {
			const onTarget = overlapShare(at, target);
			return !(grid.kind === "hex" ? onTarget > CROWDED : onTarget > 0) && touching({ rect: at }, { rect: target }, g);
		},
	}).map(({ at, center }) => ({
		x: at.x, y: at.y,
		crowd: rivals.filter(rival => touching({ rect: at }, { rect: rival }, g)).length,
		distance: Math.hypot(center.x - from.x, center.y - from.y),
	}));
	spots.sort((a, b) => a.crowd - b.crowd || a.distance - b.distance);
	return spots[0] ? { x: spots[0].x, y: spots[0].y } : null;
}

/**
 * Where a token should step to stop touching `clear`: the top-left corner of the nearest free spot,
 * within `reach` squares, touching neither `clear` nor anything in `avoid`, or null when none is.
 *
 * @param {object} p
 * @param {{x: number, y: number, w: number, h: number}} p.token  the footprint that steps aside
 * @param {{x: number, y: number, w: number, h: number}} p.clear  what it must stop touching
 * @param {Array<{x: number, y: number, w: number, h: number}>} [p.avoid]  more it must not touch (the
 *   other side's fighters it is not already fighting, so stepping aside starts no new fight)
 * @param {Array<{x: number, y: number, w: number, h: number}>} [p.others]  footprints it must not cover
 * @param {{size?: number, kind?: string}} [p.grid]
 * @param {{x: number, y: number, w: number, h: number}|null} [p.sceneRect]
 * @param {(point: {x: number, y: number}) => {x: number, y: number}} [p.snap]
 * @param {number} [p.reach]
 * @returns {{x: number, y: number}|null}
 */
function stepAside({ token, clear, avoid = [], others = [], grid = {}, sceneRect = null, snap = point => point, reach = 3 }) {
	if (!token || !clear) return null;
	const size = Number(grid.size) > 0 ? Number(grid.size) : 100;
	const g = { size, kind: grid.kind };
	const from = rectCenter(token);
	const away = rectCenter(clear);
	const spots = freeSpots({
		footprint: token, origin: token, rows: [-reach, reach], cols: [-reach, reach], size, snap, sceneRect, others,
		keep: at => ![clear, ...avoid].some(rect => touching({ rect: at }, { rect }, g)),
	}).map(({ at, center }) => ({
		x: at.x, y: at.y,
		// Nearest first; of two as near, the one further from the newcomer, so it backs off.
		distance: Math.hypot(center.x - from.x, center.y - from.y),
		back: -Math.hypot(center.x - away.x, center.y - away.y),
	}));
	spots.sort((a, b) => a.distance - b.distance || a.back - b.back);
	return spots[0] ? { x: spots[0].x, y: spots[0].y } : null;
}

/**
 * Move one fighter's token up against a fighter on the other side: anyone in the fight, a hidden one
 * only for a GM (`mayMove`), and only on the scene on the canvas, where the move can be seen.
 *
 * @returns {Promise<"moved"|"already"|"noRoom"|false>}  false for anything that could not be tried
 */
export async function sendAgainst(combat, moverId, targetId, { scene = globalThis.canvas?.scene, notify = globalThis.ui?.notifications, users = globalThis.game?.users } = {}) {
	const canvas = globalThis.canvas;
	if (!combat || !scene || canvas?.scene?.id !== scene.id || moverId === targetId) return false;
	const mover = combat.combatants?.get?.(moverId);
	const target = combat.combatants?.get?.(targetId);
	if (!mover?.token || !target?.token || mover.sceneId !== scene.id || target.sceneId !== scene.id) return false;
	if (!mayMove(mover)) return false;
	const moverSide = combatantSide(mover);
	const targetSide = combatantSide(target);
	if (!moverSide || !targetSide || moverSide === targetSide) return false;

	const grid = gridOf(scene);
	const moverRect = tokenRect(mover.token);
	const targetRect = tokenRect(target.token);
	const level = tokenLevel(target.token);
	if (touching({ rect: moverRect, level: tokenLevel(mover.token) }, { rect: targetRect, level }, grid)) return "already";

	const others = [...(scene.tokens ?? [])]
		.filter(token => token.id !== mover.token.id && token.id !== target.token.id && tokenLevel(token) === level)
		.map(token => ({ id: token.id, rect: tokenRect(token) }));
	// Everyone else in this fight on this level who can still fight, by side.
	const fighters = [...(combat.combatants ?? [])].filter(c => c !== mover && c !== target
		&& c.token && c.sceneId === scene.id && tokenLevel(c.token) === level && !combatantBodies(c).out);
	const rivals = fighters.filter(c => combatantSide(c) === targetSide);
	const friends = fighters.filter(c => combatantSide(c) === moverSide).map(c => tokenRect(c.token));
	const snapFor = token => point => (typeof token.getSnappedPosition === "function" ? token.getSnappedPosition(point) : point);
	const sceneRect = sceneRectOf(canvas);
	const spot = spotBeside({
		mover: moverRect,
		target: targetRect,
		others: others.map(o => o.rect),
		rivals: rivals.map(c => tokenRect(c.token)),
		grid,
		sceneRect,
		snap: snapFor(mover.token),
	});
	if (!spot) {
		notify?.warn?.(format("stonetop.fight.send.noRoom", { name: target.name ?? "" }));
		return "noRoom";
	}

	// The target's allies the mover would also touch there step aside, those the reader may move. A hidden
	// one a player cannot see stays put: moving it would show them where it lies in wait.
	const landing = { x: spot.x, y: spot.y, w: moverRect.w, h: moverRect.h };
	const moves = [{ id: mover.token.id, x: spot.x, y: spot.y }];
	const taken = new Map(others.map(o => [o.id, o.rect]));
	for (const rival of rivals) {
		const rect = tokenRect(rival.token);
		if (!mayMove(rival) || !touching({ rect }, { rect: landing }, grid)) continue;
		taken.delete(rival.token.id);
		const to = stepAside({
			token: rect,
			clear: landing,
			avoid: friends.filter(r => !touching({ rect }, { rect: r }, grid)),
			others: [...taken.values(), landing, moverRect, targetRect],
			grid,
			sceneRect,
			snap: snapFor(rival.token),
		});
		taken.set(rival.token.id, to ? { ...rect, x: to.x, y: to.y } : rect);
		if (to) moves.push({ id: rival.token.id, x: to.x, y: to.y });
	}

	// All the reader's own: move them here. Anything else: the GM's client moves the lot, in one go.
	const owned = new Set([mover, ...rivals].filter(c => c.isOwner).map(c => c.token.id));
	if (moves.every(m => owned.has(m.id))) {
		await displaceTokens(scene, moves);
		return "moved";
	}
	const gm = users?.activeGM;
	if (!gm) {
		notify?.warn?.(format("stonetop.fight.send.noGM", { name: mover.name ?? "" }));
		return false;
	}
	// Who asked rides in the data: v14 names the asker in the query's context, v13 does not (handleSendQuery).
	const asker = globalThis.game?.user?.id ?? null;
	let count = 0;
	try {
		count = Number(await gm.query(SEND_QUERY, { sceneId: scene.id, moves, userId: asker }, { timeout: 10000 })) || 0;
	} catch (err) {
		console.warn("Stonetop | the GM's client could not move a send", err);
	}
	if (count > 0) return "moved";
	notify?.warn?.(format("stonetop.fight.send.refused", { name: mover.name ?? "" }));
	return false;
}

/**
 * The GM's side of `SEND_QUERY`: move the tokens a player's send asked for, each one checked against
 * the ASKING user by the same rule (`mayMove`): fighting on that scene, and not hidden from them.
 *
 * WHO ASKED is foundry-compat.js#queryAsker's business. It never takes a claimed id for a GM's: a
 * player claiming to be one would otherwise move a hidden fighter.
 *
 * @param {{sceneId: string, moves: Array<{id: string, x: number, y: number}>, userId?: string}} data
 * @param {{user?: object}} context  core's query context, naming who asked (v14 only)
 * @returns {Promise<number>}  how many tokens moved
 */
export async function handleSendQuery(data, context = {}, { scenes = globalThis.game?.scenes, users = globalThis.game?.users, fightOn = fightOnScene } = {}) {
	const scene = scenes?.get?.(data?.sceneId);
	const user = queryAsker(data, context, users);
	if (!scene || !user) return 0;
	// Only a token fighting on this scene: the send moves fighters, not whatever else stands on the map.
	const combat = fightOn(scene);
	const fighting = new Map([...(combat?.combatants ?? [])].filter(c => c.sceneId === scene.id && c.tokenId).map(c => [c.tokenId, c]));
	const moves = (Array.isArray(data?.moves) ? data.moves : []).filter(m => {
		const token = scene.tokens?.get?.(m?.id);
		if (!token || !fighting.has(token.id) || !Number.isFinite(Number(m.x)) || !Number.isFinite(Number(m.y))) return false;
		// Nor a hidden token, for a player: its move would give it away.
		return mayMove({ hidden: fighting.get(token.id).hidden, token }, user);
	}).map(m => ({ id: m.id, x: Number(m.x), y: Number(m.y) }));
	if (moves.length) await displaceTokens(scene, moves);
	return moves.length;
}
