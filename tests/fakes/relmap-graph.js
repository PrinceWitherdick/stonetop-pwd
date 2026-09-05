// A relationship map's graph, in the shape `readGraph` hands one back.
//
// ⚠ ONE SPELLING OF THE STORED SHAPE, shared by every suite that builds a board to test against.
// There were four, and they had already drifted: `kin` and `src` were added to a node and an edge
// and only one of the four copies learned about `src`, so three suites were quietly asserting
// against a document shape the system no longer produces. A fixture that is a little out of date
// still passes — it just stops proving what its file says it proves.
//
// The per-suite ERGONOMICS are deliberately not shared. Each file names its edges the way its own
// subject reads best (a tie, a tie and a caption, a bare pair), so each keeps a two-line adapter
// over this and only the SHAPE lives here.

/** The board's aspect: a board is wider than it is tall, so a vertical percentage is worth less
 * than a horizontal one. Every distance assertion has to divide by it or it is measuring the
 * numbers rather than the picture. */
export const ASPECT = 1.25;

/**
 * How far apart two seats are in FLAT space — the space a portrait is round in.
 *
 * ONE spelling, for the same reason the graph is: a suite measuring clearance in raw percentages
 * would call two portraits well clear that visibly overlap on a board.
 */
export const apart = (a, b) => Math.hypot(a.left - b.left, (a.top - b.top) / ASPECT);

/** One person on the board, whole, so a fixture is never missing a field the reader guards on. */
const NODE = { uuid: null, name: "", img: "", x: 50, y: 50, note: "" };

/** One line, whole, and with every field a stored edge actually carries. */
const EDGE = { a: "", b: "", label: "", ink: "slate", dir: "none", kin: "", src: "", note: "" };

/**
 * A graph from a list of people and a list of links.
 *
 * `people` may be plain ids — which become uuid-less, name-only people parked in the middle of the
 * board, which is what an unplaced board actually looks like — or `[id, {...overrides}]` pairs.
 * `links` are `[a, b]` or `[a, b, {...overrides}]`.
 */
export function graphOf(people = [], links = []) {
	const nodes = {};
	for (const person of people) {
		const [id, over] = Array.isArray(person) ? person : [person, {}];
		nodes[id] = { ...NODE, name: id, ...over };
	}
	const edges = {};
	links.forEach(([a, b, over], i) => {
		edges[`e${String(i).padStart(2, "0")}`] = { ...EDGE, a, b, ...over };
	});
	return { version: 1, shape: "ring", nodes, edges };
}
