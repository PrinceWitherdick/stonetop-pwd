// "Line everyone up": the fights already going on kept exactly as they stand and set side by side
// where everybody already is, and everyone not yet fighting anybody in a column of their own side,
// heroes to the left and foes to the right.
//
// A LINE-UP NEVER BREAKS A FIGHT. Engagements are read off the map (engagements.js), so marching
// everybody into two tidy columns would tell every scrum on the board that it is over. So the
// fighters standing against each other are found first and each such scrum is moved as ONE PIECE:
// every one of its members takes the same step, nobody inside it changes places, and so every
// contact it was built on still holds when it lands. Only the fighters nobody is up against are
// actually lined up.
//
// SCRUMS ARE CONTACT, NOT THE FIGHT TAB'S ENGAGEMENTS. An engagement can also be made by a player
// targeting somebody across the room, and a target survives any move; only standing against
// somebody is a claim a line-up could take away.
//
// AROUND WHERE THEY STAND, NOT THE SCENE'S EDGES. The formation is centred on the middle of the
// fighters' own footprint, so a line-up tidies them up in place instead of marching everybody across
// the map; lining up against the scene's own left and right edges would put the two sides a map
// apart. Only when nobody stands on the map yet (a fight's arrivals) is it centred on the view, as
// deploy-layout.js centres a deploy. The view still sets how tall a column may grow and
// how wide a row of scrums. Pressing it twice moves nobody the second time.
//
// NOBODY NEW STARTS ENGAGED. The scrums stand `gap` whole squares apart from each other and from
// the two columns, and the columns `gap` apart from each other, so a line-up never puts two tokens
// in contact that were not in contact already (engagements.js#touching).
//
// PURE. Positions come back as scene pixels on the grid, measured from the scene rectangle's own
// origin; fight/start-fight.js snaps them through core and moves the tokens.

import { touching, unionFind } from "./engagements.js";

/** A token's footprint in whole squares: a half-square token still takes up a square in a column. */
const squares = n => Math.max(1, Math.ceil(Number(n) || 1));

/** Whether a token said where it stands: a token on its way onto the map has nowhere yet. */
const stands = t => Number.isFinite(Number(t?.x)) && Number.isFinite(Number(t?.y));

/**
 * Stack one side's tokens into columns, each no taller than `rows` squares.
 *
 * @param {Array<{id: string, w?: number, h?: number}>} tokens  in the order to stack them
 * @param {number} rows
 * @returns {Array<{width: number, height: number, items: Array<{id: string, w: number, h: number, row: number}>}>}
 */
function stackColumns(tokens, rows) {
	const columns = [];
	let column = null;
	for (const token of tokens) {
		const w = squares(token.w);
		const h = squares(token.h);
		if (!column || (column.height > 0 && column.height + h > rows)) {
			column = { width: 0, height: 0, items: [] };
			columns.push(column);
		}
		column.items.push({ id: token.id, w, h, row: column.height });
		column.height += h;
		column.width = Math.max(column.width, w);
	}
	return columns;
}

/**
 * Who is already fighting whom: every set of fighters joined by a chain of contact across the two
 * sides. A fighter standing alone, one who is out of the fight, and one with no place on the map
 * yet belongs to no scrum.
 *
 * @returns {Map<string, string[]>}  each scrum's member ids, keyed by one of them
 */
function scrumsOf(heroes, foes, grid) {
	const here = side => side.filter(t => t && !t.out && stands(t));
	const ours = here(heroes);
	const theirs = here(foes);
	const everyone = [...ours, ...theirs];
	// One rect per token, measured once: the hero×foe sweep below would otherwise rebuild the same
	// footprint on every pairing.
	const shapes = new Map(everyone.map(t => [t.id, {
		level: t.level ?? null,
		rect: { x: Number(t.x), y: Number(t.y), w: squares(t.w) * grid.size, h: squares(t.h) * grid.size },
	}]));
	const { find, union } = unionFind(everyone.map(t => t.id));
	for (const hero of ours) {
		for (const foe of theirs) {
			if (touching(shapes.get(hero.id), shapes.get(foe.id), grid)) union(hero.id, foe.id);
		}
	}
	const sets = new Map();
	for (const t of everyone) {
		const root = find(t.id);
		if (!sets.has(root)) sets.set(root, []);
		sets.get(root).push(t.id);
	}
	for (const [root, ids] of [...sets]) if (ids.length < 2) sets.delete(root);
	return sets;
}

/**
 * A scrum as one piece: how big a box it needs, in whole squares, and where each member stands
 * inside that box, in exact pixels, so that moving the box moves every member the same step.
 */
function blobOf(ids, byId, grid) {
	const members = ids.map(id => byId.get(id));
	const left = Math.min(...members.map(m => Number(m.x)));
	const top = Math.min(...members.map(m => Number(m.y)));
	const right = Math.max(...members.map(m => Number(m.x) + squares(m.w) * grid));
	const bottom = Math.max(...members.map(m => Number(m.y) + squares(m.h) * grid));
	return {
		key: ids[0],
		w: Math.max(1, Math.ceil((right - left) / grid)),
		h: Math.max(1, Math.ceil((bottom - top) / grid)),
		items: members.map(m => ({
			id: m.id,
			dx: Number(m.x) - left,
			dy: Number(m.y) - top,
			w: squares(m.w) * grid,
			h: squares(m.h) * grid,
		})),
	};
}

/** The box around some rects in scene pixels, as its left, right, top and bottom edges. */
function boundsOf(items) {
	return {
		x0: Math.min(...items.map(i => i.x)), x1: Math.max(...items.map(i => i.x + i.w)),
		y0: Math.min(...items.map(i => i.y)), y1: Math.max(...items.map(i => i.y + i.h)),
	};
}

/** Stand the scrums side by side in rows no wider than `cols` squares, `space` squares apart. */
function shelve(blobs, cols, space) {
	const shelves = [];
	let shelf = null;
	for (const blob of blobs) {
		if (!shelf || (shelf.width > 0 && shelf.width + space + blob.w > cols)) {
			shelf = { width: 0, height: 0, items: [] };
			shelves.push(shelf);
		}
		const at = shelf.width ? shelf.width + space : 0;
		shelf.items.push({ blob, col: at });
		shelf.width = at + blob.w;
		shelf.height = Math.max(shelf.height, blob.h);
	}
	return shelves;
}

/**
 * Where everybody goes.
 *
 * @param {object} p
 * @param {{x: number, y: number, w: number, h: number}} p.view       the part of the scene in view, in scene pixels
 * @param {number} p.size                                              the grid size, in pixels
 * @param {{x: number, y: number, w: number, h: number}} p.sceneRect  the scene rectangle (tokens stay inside it)
 * @param {Array<{id: string, w?: number, h?: number, x?: number, y?: number, level?: string|null, out?: boolean}>} [p.heroes]
 *   width and height in squares, in stacking order. `x`/`y` are where the token stands NOW, in scene
 *   pixels, which is what says who is already fighting whom; a token not on the map yet has neither,
 *   and `out` marks one who is no longer in the fight, so neither joins a scrum.
 * @param {Array<{id: string, w?: number, h?: number, x?: number, y?: number, level?: string|null, out?: boolean}>} [p.foes]
 * @param {number} [p.gap=3]     empty squares between the two sides, and around each scrum
 * @param {number} [p.margin=1]  squares left clear around the edge of the view
 * @param {"square"|"hex"|"gridless"} [p.gridKind="square"]  how contact is measured
 * @returns {Map<string, {x: number, y: number, group: string|null}>}  each token's top-left corner
 *   in scene pixels, and the scrum it moved with, if any: everyone sharing a `group` took the same
 *   step, so the caller must not snap them to the grid apart from one another.
 */
export function lineUpPositions({ view, size, sceneRect, heroes = [], foes = [], gap = 3, margin = 1, gridKind = "square" } = {}) {
	const positions = new Map();
	const grid = Number(size) > 0 ? Number(size) : 100;
	const scene = sceneRect ?? { x: 0, y: 0, w: grid * 20, h: grid * 20 };
	const seen = view ?? scene;
	if (!heroes.length && !foes.length) return positions;

	// Everything below works in whole squares counted from the scene rectangle's corner, around the
	// middle of where the fighters stand now, or of the view when none of them stands anywhere yet.
	const standing = [...heroes, ...foes].filter(stands).map(t => ({
		x: Number(t.x), y: Number(t.y), w: squares(t.w) * grid, h: squares(t.h) * grid,
	}));
	const footprint = standing.length ? boundsOf(standing) : null;
	const middle = footprint
		? { x: (footprint.x0 + footprint.x1) / 2, y: (footprint.y0 + footprint.y1) / 2 }
		: { x: seen.x + seen.w / 2, y: seen.y + seen.h / 2 };
	const midCol = Math.round((middle.x - scene.x) / grid);
	const midRow = Math.round((middle.y - scene.y) / grid);
	const clear = Math.max(0, margin);
	const rows = Math.max(1, Math.floor(seen.h / grid) - 2 * clear);
	const cols = Math.max(1, Math.floor(seen.w / grid) - 2 * clear);
	const space = Math.max(1, Math.round(gap));

	const everyone = [...heroes, ...foes];
	const byId = new Map(everyone.map(t => [t.id, t]));
	const order = new Map(everyone.map((t, i) => [t.id, i]));
	const sets = scrumsOf(heroes, foes, { size: grid, kind: gridKind });
	const inScrum = new Set([...sets.values()].flat());

	// The scrums take the middle, each as it stands, left to right in the order the
	// fight lists their first member.
	const blobs = [...sets.values()]
		.map(ids => [...ids].sort((a, b) => order.get(a) - order.get(b)))
		.sort((a, b) => order.get(a[0]) - order.get(b[0]))
		.map(ids => blobOf(ids, byId, grid));
	const shelves = shelve(blobs, cols, space);
	const units = [];
	// Only read on the `shelves.length` branch below, which is also the only branch that sets them.
	let scrumLeft = Infinity;
	let scrumRight = -Infinity;
	if (shelves.length) {
		const tall = shelves.reduce((total, shelf) => total + shelf.height, 0) + space * (shelves.length - 1);
		let top = midRow - Math.floor(tall / 2);
		for (const shelf of shelves) {
			const left = midCol - Math.floor(shelf.width / 2);
			scrumLeft = Math.min(scrumLeft, left);
			scrumRight = Math.max(scrumRight, left + shelf.width);
			for (const { blob, col } of shelf.items) {
				const x = scene.x + (left + col) * grid;
				const y = scene.y + (top + Math.floor((shelf.height - blob.h) / 2)) * grid;
				units.push(blob.items.map(m => ({ id: m.id, x: x + m.dx, y: y + m.dy, w: m.w, h: m.h, group: blob.key })));
			}
			top += shelf.height + space;
		}
	}

	// The columns stand `space` squares clear of the scrums, or of each other when there are none.
	// Further columns open OUTWARD, so that gap never shrinks.
	const heroEdge = shelves.length ? scrumLeft - space : midCol - Math.ceil(space / 2);
	const foeEdge = shelves.length ? scrumRight + space : heroEdge + space;
	const place = (columns, outward) => {
		let edge = outward < 0 ? heroEdge : foeEdge;
		for (const column of columns) {
			const left = outward < 0 ? edge - column.width : edge;
			const top = midRow - Math.floor(column.height / 2);
			for (const item of column.items) {
				units.push([{
					id: item.id,
					x: scene.x + left * grid, y: scene.y + (top + item.row) * grid,
					w: item.w * grid, h: item.h * grid, group: null,
				}]);
			}
			edge = outward < 0 ? left : left + column.width;
		}
	};
	const waiting = side => side.filter(t => !inScrum.has(t.id));
	place(stackColumns(waiting(heroes), rows), -1);
	place(stackColumns(waiting(foes), rows), 1);
	if (!units.length) return positions;

	// A formation built around the fighters is centred on them exactly, to the nearest square: laying
	// it out on `midCol`/`midRow` alone can land it half a square off, and pressing the button again
	// would then walk everybody a square further every time. A half square is no reason to move, so
	// a tie leaves it where it is.
	if (footprint) {
		const built = boundsOf(units.flat());
		const toward = v => Math.sign(v) * Math.ceil(Math.abs(v) - 0.5);
		const sx = toward((middle.x - (built.x0 + built.x1) / 2) / grid) * grid;
		const sy = toward((middle.y - (built.y0 + built.y1) / 2) / grid) * grid;
		for (const unit of units) for (const i of unit) { i.x += sx; i.y += sy; }
	}

	// Slide the whole formation back onto the scene if it hangs off an edge (it keeps its shape
	// whenever it fits), then hold each lone token, and each scrum WHOLE, inside on its own.
	const nudge = (lo, hi, min, max) => {
		if (lo < min) return Math.ceil((min - lo) / grid) * grid;
		if (hi > max) return -Math.min(Math.ceil((hi - max) / grid), Math.max(0, Math.floor((lo - min) / grid))) * grid;
		return 0;
	};
	const whole = boundsOf(units.flat());
	const dx = nudge(whole.x0, whole.x1, scene.x, scene.x + scene.w);
	const dy = nudge(whole.y0, whole.y1, scene.y, scene.y + scene.h);
	for (const unit of units) {
		const moved = unit.map(i => ({ ...i, x: i.x + dx, y: i.y + dy }));
		const box = boundsOf(moved);
		const ux = nudge(box.x0, box.x1, scene.x, scene.x + scene.w);
		const uy = nudge(box.y0, box.y1, scene.y, scene.y + scene.h);
		for (const i of moved) positions.set(i.id, { x: i.x + ux, y: i.y + uy, group: i.group });
	}
	return positions;
}
