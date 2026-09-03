// The relationship map's data: what a map holds, how it is read back safely, and the only place in
// the feature that writes a flag path string.
//
// WHY THE PATHS ARE ALL IN ONE FILE. Every write this feature makes is a DOTTED PATH TO A LEAF, and
// that is not a style preference — it is the whole concurrency story. Two players dragging two
// different portraits write `...nodes.a.x` and `...nodes.b.x`; the server merges both and both
// survive. Write the `nodes` object instead, or spread-and-replace it, and the second write lands
// on a copy read before the first and silently throws it away. Scattering the path strings across
// the window, the drag layer and the toolkit tab is how one of them ends up doing that.
//
// ⚠ AND NO ID MAY CONTAIN A DOT. Foundry expands dotted keys INSIDE a flag object, so an id like
// `Actor.7d2` would be written as `{Actor: {7d2: ...}}` and match nothing on the way back out —
// see module/data/follower-actor.js, which records the same trap costing a feature. `isSafeId` is
// the guard, every builder below refuses anything else, and a test holds it there.

import { SYSTEM_ID } from "../system-id.js";
import { deletionEntry } from "../utils/foundry-compat.js";
import { clampPct } from "../utils/relmap-geometry.js";

/** Bumped only for a change a stored map cannot be read through. Nothing migrates on 1. */
export const RELMAP_VERSION = 1;

/** The flag key, under this system's scope, that holds one map's graph. */
export const RELMAP_FLAG = "relationshipMap";

/**
 * The eight line colours, as KEYS rather than values.
 *
 * Never a hex in stored data. The board has to work under the high-contrast skin and beside a
 * reader on a magnifier, so what a colour resolves to is the stylesheet's business and has to stay
 * retunable without rewriting every world's maps. A test holds this list and the CSS custom
 * properties to the same set, because nothing else would notice them drifting apart.
 */
export const RELMAP_INKS = Object.freeze([
	"rose", "sage", "ochre", "indigo", "plum", "rust", "teal", "slate",
]);
export const RELMAP_INK_DEFAULT = "slate";

/**
 * Which way a link is read. `none` is the default and the ordinary case: most ties between people
 * run both ways, and a board where every line has arrows at both ends says less than one with none.
 */
export const RELMAP_DIRS = Object.freeze(["none", "a-b", "b-a", "both"]);
export const RELMAP_DIR_DEFAULT = "none";

/** Long enough for "has never forgiven her for the business at the mill", short enough that one
 * link cannot paper over the board. Trimmed on the way in, not refused: silently losing the end of
 * a sentence is kinder than rejecting a save and losing all of it. */
export const RELMAP_LABEL_MAX = 120;

/**
 * An id this feature will store.
 *
 * THE DOT IS THE POINT. The character rule is what stops a future "let us just key nodes by their
 * actor uuid" from destroying data with no error anywhere. `foundry.utils.randomID()` already
 * satisfies this.
 *
 * The length bound is only a sanity rail, and it is deliberately loose at the bottom: a one
 * character id is perfectly safe to store, and a floor set where it felt tidy rather than where the
 * danger is would reject data this file has no business rejecting.
 */
export function isSafeId(id) {
	return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** A map with nobody on it yet. */
export function emptyGraph() {
	return { version: RELMAP_VERSION, nodes: {}, edges: {} };
}

const str = (v, max = 0) => {
	const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
	return max ? s.slice(0, max) : s;
};

/**
 * A stored graph, made safe to render.
 *
 * Everything here comes out of a world flag that any owner of the map could have written, through
 * however many versions of this system, so nothing is trusted: unknown fields are dropped, ids that
 * could not have been written by `isSafeId` are dropped with everything hanging off them, and
 * coordinates are clamped onto the board.
 *
 * DANGLING EDGES ARE DROPPED. A link whose end is not on the map has nothing to draw between, and
 * it can happen honestly: one player deleting a portrait while another is drawing a line to it. The
 * delete takes the edges it knows about with it in the same write, and this catches the race.
 */
export function normalizeGraph(raw) {
	const graph = emptyGraph();
	if (!raw || typeof raw !== "object") return graph;

	for (const [id, node] of Object.entries(raw.nodes ?? {})) {
		if (!isSafeId(id) || !node || typeof node !== "object") continue;
		graph.nodes[id] = {
			uuid: node.uuid ? str(node.uuid) : null,
			name: str(node.name, RELMAP_LABEL_MAX),
			img: str(node.img),
			x: clampPct(node.x),
			y: clampPct(node.y),
			note: str(node.note, RELMAP_LABEL_MAX * 4),
		};
	}

	for (const [id, edge] of Object.entries(raw.edges ?? {})) {
		if (!isSafeId(id) || !edge || typeof edge !== "object") continue;
		const a = str(edge.a);
		const b = str(edge.b);
		// A link to nobody, or from somebody to themselves: neither has a line to draw.
		if (!graph.nodes[a] || !graph.nodes[b] || a === b) continue;
		graph.edges[id] = {
			a,
			b,
			label: str(edge.label, RELMAP_LABEL_MAX),
			ink: RELMAP_INKS.includes(edge.ink) ? edge.ink : RELMAP_INK_DEFAULT,
			dir: RELMAP_DIRS.includes(edge.dir) ? edge.dir : RELMAP_DIR_DEFAULT,
			note: str(edge.note, RELMAP_LABEL_MAX * 4),
		};
	}
	return graph;
}

/** The flag path to one part of the graph. The ONE place this string is built. */
export function relmapPath(...parts) {
	return [`flags.${SYSTEM_ID}.${RELMAP_FLAG}`, ...parts].join(".");
}

function leafPatch(kind, id, fields) {
	if (!isSafeId(id)) return null;
	const patch = {};
	for (const [key, value] of Object.entries(fields ?? {})) {
		// A field name is part of a path too, so it is held to the same rule for the same reason.
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
		patch[relmapPath(kind, id, key)] = value;
	}
	return Object.keys(patch).length ? patch : null;
}

/**
 * Move one portrait, or change one of its fields.
 *
 * Leaves only, so this is the write two people dragging at once can both make. Coordinates are
 * clamped and shortened here rather than at the call site, because this is the boundary the numbers
 * cross on their way into world data and there is exactly one of it.
 */
export function nodePatch(id, fields = {}) {
	const clean = { ...fields };
	if ("x" in clean) clean.x = clampPct(clean.x);
	if ("y" in clean) clean.y = clampPct(clean.y);
	if ("name" in clean) clean.name = str(clean.name, RELMAP_LABEL_MAX);
	if ("note" in clean) clean.note = str(clean.note, RELMAP_LABEL_MAX * 4);
	return leafPatch("nodes", id, clean);
}

/** Change one link. Same rules, same reasons. */
export function edgePatch(id, fields = {}) {
	const clean = { ...fields };
	if ("label" in clean) clean.label = str(clean.label, RELMAP_LABEL_MAX);
	if ("note" in clean) clean.note = str(clean.note, RELMAP_LABEL_MAX * 4);
	if ("ink" in clean && !RELMAP_INKS.includes(clean.ink)) clean.ink = RELMAP_INK_DEFAULT;
	if ("dir" in clean && !RELMAP_DIRS.includes(clean.dir)) clean.dir = RELMAP_DIR_DEFAULT;
	return leafPatch("edges", id, clean);
}

/** Put somebody on the map. Every field written, so the node is whole from its first write. */
export function addNodePatch(id, { uuid = null, name = "", img = "", x = 50, y = 50, note = "" } = {}) {
	return nodePatch(id, { uuid, name, img, x, y, note });
}

/** Draw a link. */
export function addEdgePatch(id, { a, b, label = "", ink = RELMAP_INK_DEFAULT, dir = RELMAP_DIR_DEFAULT, note = "" } = {}) {
	if (!isSafeId(a) || !isSafeId(b) || a === b) return null;
	return edgePatch(id, { a, b, label, ink, dir, note });
}

/**
 * Take somebody off the map, AND every link that touched them, in one update.
 *
 * One write rather than two, so there is one broadcast and one repaint, and so a client watching
 * never sees the half-second in which the portrait is gone and its lines are still hanging in the
 * air pointing at nothing.
 *
 * Through `deletionEntry` (utils/foundry-compat.js) because the two live cores disagree about how a
 * key is removed, and a nested ForcedDeletion inside an object-typed flag is silently ignored on
 * v13 — which is the shape this would naturally have been written in.
 */
export function dropNodePatch(graph, id) {
	if (!isSafeId(id)) return null;
	const entries = [deletionEntry(relmapPath("nodes", id))];
	for (const edgeId of edgesTouching(graph, id)) {
		entries.push(deletionEntry(relmapPath("edges", edgeId)));
	}
	return Object.fromEntries(entries);
}

/** Rub out one link. */
export function dropEdgePatch(id) {
	if (!isSafeId(id)) return null;
	return Object.fromEntries([deletionEntry(relmapPath("edges", id))]);
}

/**
 * Where the portraits already sit, in the shape `freeSpot` and `ringsLayout` want.
 *
 * ONE spelling, shared by the window and the importer: a seat that reads the occupied list
 * differently from the one that fills it is how a newcomer lands on top of somebody.
 */
export function takenSpots(graph) {
	return Object.values(graph?.nodes ?? {}).map(n => ({ left: n.x, top: n.y }));
}

/**
 * How a person on the board is recognised: by their actor where they have one, else by name.
 *
 * ONE rule for stored nodes and for incoming rows alike. Two spellings of it is how "already on
 * the board" comes to mean something different on each side and an import stops being idempotent.
 */
export function nodeIdentity(person) {
	return person?.uuid || `name:${person?.name}`;
}

/** Every link with `id` at one end of it. */
export function edgesTouching(graph, id) {
	return Object.entries(graph?.edges ?? {})
		.filter(([, edge]) => edge.a === id || edge.b === id)
		.map(([edgeId]) => edgeId)
		.sort();
}

/** The two ends of a link as one key, whichever order they were drawn in. */
export function pairKey(a, b) {
	return [a, b].sort().join("|");
}

/**
 * Which links run between the same two people, in a STABLE order.
 *
 * Stable because the order is what decides how the fan spreads (see `fanBow`). Object key order
 * survives a JSON round trip but not a flag merge, so a repaint that read them in whatever order
 * they arrived would re-deal the fan on every write and lines the reader was not touching would
 * jump. Sorted by id: arbitrary, and the same arbitrary answer on every client every time.
 */
export function edgesBetween(graph, a, b) {
	const key = pairKey(a, b);
	return Object.entries(graph?.edges ?? {})
		.filter(([, edge]) => pairKey(edge.a, edge.b) === key)
		.map(([id]) => id)
		.sort();
}

/** Each link's place in its own pair's fan, worked out once for a whole repaint. */
export function fanIndexes(graph) {
	const seen = new Map();
	const out = {};
	for (const id of Object.keys(graph?.edges ?? {}).sort()) {
		const edge = graph.edges[id];
		const key = pairKey(edge.a, edge.b);
		const next = seen.get(key) ?? 0;
		out[id] = next;
		seen.set(key, next + 1);
	}
	return out;
}
