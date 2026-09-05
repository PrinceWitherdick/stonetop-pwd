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
import {
	RELMAP_BOARD_ASPECT, boardMetrics, clampPct, freeSpot, ringsLayout,
} from "../utils/relmap-geometry.js";
import { RELMAP_KIN_UNSET, readKin } from "../utils/relmap-kin.js";
import { RELMAP_SHAPE_DEFAULT, normalizeShape } from "../utils/relmap-layout.js";

/**
 * Bumped only for a change a stored map cannot be read through.
 *
 * 1 was a map whose whole graph sat on the JournalEntry itself, and one map was one board. 2 is a
 * map whose graph sits on a JournalEntryPage — one page per NAMED BOARD — with the entry above it
 * keeping nothing but this number, as the mark that says it is a map at all.
 *
 * NOTHING MIGRATES IN THE GRAPH, because the graph did not change shape: only which document it
 * hangs off did. A version 1 flag read through `normalizeGraph` is still a perfectly good board,
 * which is what lets relmap-doc.js move it onto a page as ordinary data the first time somebody
 * who may edit the map opens it, rather than as a migration anything has to know about.
 */
export const RELMAP_VERSION = 2;

/**
 * The flag key, under this system's scope, that holds one map's graph.
 *
 * ⚠ THE SAME KEY LIVES ON TWO KINDS OF DOCUMENT AND MEANS TWO DIFFERENT THINGS. On a
 * JournalEntryPage it is a GRAPH — everything below. On the JournalEntry above it, it is the MARK
 * that says "this entry is a relationship map", and holds only a version: `listRelationshipMaps`
 * finds every map in the world by that mark, so it has to stay, and stay truthy.
 *
 * ONE KEY RATHER THAN TWO because a map found by one key and read through another is a map that
 * can be half-recognised — present in the list and unreadable, or readable and unlisted. Only
 * relmap-doc.js knows about the entry-level one; everything in this file is about the page's.
 */
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

/**
 * WHERE A LINE CAME FROM, where it was not somebody's own hand.
 *
 * Only one answer so far, and the empty string for every other line, which is nearly all of them: a
 * line a reader drew, and every line on every map written before this field existed. That second
 * group is the reason this is a stamp on new writes and never a guess at old ones. Nothing on a
 * stored map says which of its lines an import drew, and working it back out from the ratings would
 * mean claiming a line somebody drew by hand is not theirs.
 *
 * ⚠ NOTHING WRITES THIS ANY MORE, AND IT STILL HAS TO STAY. "Pull in ratings" was a button that
 * drew a line for every rating anybody had stored, both ways round, straight into the shared board;
 * a table that filled its sheets in properly during the introductions ended up with the web it drew
 * by hand buried under a hundred imported ones, and the user asked for it to go. What shows that
 * information now is the party view, which derives it on the reader's own machine and stores none
 * of it (see relmap/relmap-intros.js).
 *
 * WHAT THIS MARK IS FOR IS THE BOARDS THAT BUTTON WAS ALREADY PRESSED ON. It is the only thing that
 * can tell one of its lines from one somebody drew, and it drives both ways out: a checkbox that
 * puts them away for one reader, and a tool that rubs them out for everyone. It is a mark on the
 * DATA and not a class on the paint, because the hiding has to reach the geometry: a line the
 * reader has put away must not be routed around, fan a pair apart, or count towards how much room
 * the captions are promised.
 */
export const RELMAP_SRC_HEARTS = "hearts";

/**
 * A line seeded onto the party board from an introduction answer.
 *
 * ⚠ NOT THE SAME KIND OF MARK AS `hearts` ABOVE, though both mean "nobody drew this by hand". That
 * one is a scar: it marks what a removed button wrote all over people's boards, and both controls
 * that read it exist to get RID of those lines. This one is the POINT of a board. "The Party" is
 * seeded from the Chronicle and topped up as the party answer more, and a reader is meant to keep
 * these, arrange them, and edit their captions like any other line.
 *
 * WHAT IT IS FOR is knowing which of one person's answers about another are already drawn, so that
 * opening the map again adds what is new and nothing else. WHICH one is `origin` below; this only
 * says that the seeder wrote the line rather than a reader, which is what keeps a line the table
 * drew by hand between two player characters out of the reckoning entirely.
 */
export const RELMAP_SRC_INTROS = "intros";

export const RELMAP_SRC_NONE = "";
export const RELMAP_SRCS = Object.freeze([RELMAP_SRC_HEARTS, RELMAP_SRC_INTROS]);

/**
 * WHICH ANSWER a seeded line was drawn from, as an opaque key.
 *
 * ⚠ AN IDENTITY AND NOT A COUNT, and the difference is a real bug it fixed. The party board used to
 * decide what to add by how many of a pair's lines were already drawn, against a list grouped by
 * introduction step -- so an answer that became visible LATER (a "Bonds & ties" answer somebody
 * pointed at a person with "Match answers to people") was inserted in the MIDDLE of that list, and
 * the tail the board added was a second copy of a line it already had while the new answer was
 * never drawn at all. With a key on the line, an answer is recognised wherever it lands.
 *
 * ⚠ AND STILL NEVER THE WORDS. The caption and the note on a seeded line are the table's to rewrite
 * -- that is the whole reason the board is a page rather than a computed view -- so what identifies
 * the answer has to be something no reader ever edits. This is written once, at the moment the line
 * is drawn, and nothing in the editor touches it.
 *
 * OPAQUE HERE ON PURPOSE. What a key is made of is relmap/relmap-intros.js's business (the writer,
 * the slot, the index); this file only knows it is a short string, so that the store does not have
 * to be edited when the Chronicle grows a round.
 *
 * The empty string means "no key", which is every line on every board drawn before this existed and
 * every line a reader drew themselves. relmap/relmap-party.js says what it does with those.
 *
 * The constant is the only thing there IS to declare about it here: a bound, because this is world
 * data any owner of the map could have written and nothing else about the shape is ours to check.
 * Generous enough that no real key comes near it, exactly as the caption's bound is a trim on the
 * way out rather than a refusal.
 */
export const RELMAP_ORIGIN_MAX = 120;

/** A stored source, made safe. Anything unrecognised reads as "somebody drew this". */
export function readSrc(src) {
	return RELMAP_SRCS.includes(src) ? src : RELMAP_SRC_NONE;
}

/** Was this line written by the "Pull in ratings" button that used to exist, rather than by a
 * reader? Only ever true on a board somebody pressed it on before it was removed. */
export function isImportedEdge(edge) {
	return readSrc(edge?.src) === RELMAP_SRC_HEARTS;
}

/** Was this line seeded onto the party board from an introduction answer? */
export function isIntroEdge(edge) {
	return readSrc(edge?.src) === RELMAP_SRC_INTROS;
}

/**
 * How long a caption on a line may be, and it is HALF WHAT IT WAS (120), at the user's request
 * after a season of using the board.
 *
 * A CAPTION IS A PHRASE AND NOT A SENTENCE, and the room it has to say its piece in is the gap
 * between two faces — where `captionRoomPx` lets it run to its own line's full length. So a caption
 * long enough to be prose is one that reaches right across everybody else's lines to say something
 * the reader would have opened the line to read anyway. Sixty characters is about one clause:
 * "has never forgiven her for the business at the mill" fits whole, and a paragraph does not.
 *
 * THE REST IS NOT LOST. `RELMAP_NOTE_MAX` below is four times this and is where the story goes;
 * the line's own editor shows both, and the caption's tooltip carries the whole of what it says.
 * And this is a TRIM ON THE WAY IN, never a refusal: silently losing the end of a sentence is
 * kinder than rejecting a save and losing all of it.
 *
 * ⚠ IT TRIMS ON THE WAY OUT TOO, in `normalizeGraph`, which is the whole of how the change reaches
 * maps written before it. A stored label of a hundred characters is DRAWN at sixty from the moment
 * this number changed, and is only shortened in the document when somebody next saves that line —
 * so nothing is destroyed, and nothing has to migrate.
 */
export const RELMAP_LABEL_MAX = 60;

/**
 * How long a person's stored name may be, which is NOT the caption's bound and never was the same
 * question.
 *
 * It shared `RELMAP_LABEL_MAX` until that was shortened, and the sharing was the quiet hazard: a
 * name is a proper noun the reader has to recognise, it is drawn under its own portrait where
 * nothing competes with it for room, and cutting "Ordga of the Long Water" short to tidy the
 * captions up is a change nobody asked for on a surface that was fine.
 */
export const RELMAP_NAME_MAX = 120;

/** How long the notes behind a line or a person may be. Where the prose that will not fit on the
 * board goes, so it is generous: nothing on the board is measured against it. */
export const RELMAP_NOTE_MAX = RELMAP_NAME_MAX * 4;

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
	return { version: RELMAP_VERSION, shape: RELMAP_SHAPE_DEFAULT, nodes: {}, edges: {} };
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
	// The shape Tidy up last put this board into. An older map has none and reads as the ring,
	// which is what every board built before the shapes existed actually is, so nothing migrates.
	graph.shape = normalizeShape(raw.shape);

	for (const [id, node] of Object.entries(raw.nodes ?? {})) {
		if (!isSafeId(id) || !node || typeof node !== "object") continue;
		graph.nodes[id] = {
			uuid: node.uuid ? str(node.uuid) : null,
			name: str(node.name, RELMAP_NAME_MAX),
			img: str(node.img),
			x: clampPct(node.x),
			y: clampPct(node.y),
			note: str(node.note, RELMAP_NOTE_MAX),
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
			// WHAT FAMILY TIE THIS IS, if any, and it is a stored KEY rather than something read
			// back out of the caption for the same reason the ink is: prose is somebody's own
			// sentence and must not have to be phrased a particular way for a feature to work.
			// Absent stays ABSENT rather than becoming "not a family tie", which is a distinction
			// `readKin` explains at length: both draw as nothing, but only one of them is an answer
			// somebody gave, and "find family ties" must leave an answer alone. Every map written
			// before the tree existed is therefore a map nobody has been asked about yet, and
			// nothing migrates. See utils/relmap-kin.js.
			kin: readKin(edge.kin),
			// Who drew it: a reader, or the ratings import. See RELMAP_SRC_HEARTS.
			src: readSrc(edge.src),
			// WHICH answer it was seeded from, where it was seeded at all. See RELMAP_ORIGIN_MAX.
			origin: str(edge.origin, RELMAP_ORIGIN_MAX),
			note: str(edge.note, RELMAP_NOTE_MAX),
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
	if ("name" in clean) clean.name = str(clean.name, RELMAP_NAME_MAX);
	if ("note" in clean) clean.note = str(clean.note, RELMAP_NOTE_MAX);
	return leafPatch("nodes", id, clean);
}

/**
 * Re-seat the WHOLE board in one write, and remember the shape it was put into.
 *
 * ONE UPDATE, not one per person. Several would be several broadcasts, and every other client at
 * the table would watch the portraits walk to their places one at a time over a second or two,
 * with the lines whipping about between them.
 *
 * THE SHAPE RIDES ALONG in the same write for the same reason `dropNodePatch` takes a person and
 * their lines together: a board that has been re-seated but has forgotten what into is a board
 * whose next Tidy up silently does something else.
 *
 * Still leaf paths, so it merges with somebody else's concurrent drag rather than replacing the
 * `nodes` object out from under it. Last write wins for one portrait, which is the honest outcome
 * of two people arranging the same board in the same second.
 *
 * @param {Record<string, {left: number, top: number}>} seats  where each person goes, by node id.
 * @param {string} shape  what to record this board as, from `RELMAP_SHAPES`.
 */
export function tidyPatch(seats, shape) {
	const patch = { [relmapPath("shape")]: normalizeShape(shape) };
	for (const [id, spot] of Object.entries(seats ?? {})) {
		// A person the layout had no seat for is LEFT WHERE THEY ARE. Writing them anyway would
		// hand `clampPct` nothing and move them to the middle of the board, which looks exactly
		// like the layout deciding that is where they belong.
		if (!spot) continue;
		Object.assign(patch, nodePatch(id, { x: spot.left, y: spot.top }) ?? {});
	}
	return patch;
}

/** Change one link. Same rules, same reasons. */
export function edgePatch(id, fields = {}) {
	const clean = { ...fields };
	if ("label" in clean) clean.label = str(clean.label, RELMAP_LABEL_MAX);
	if ("note" in clean) clean.note = str(clean.note, RELMAP_NOTE_MAX);
	if ("ink" in clean && !RELMAP_INKS.includes(clean.ink)) clean.ink = RELMAP_INK_DEFAULT;
	if ("dir" in clean && !RELMAP_DIRS.includes(clean.dir)) clean.dir = RELMAP_DIR_DEFAULT;
	// Through `readKin` and not `normalizeKin`, so that "nobody has been asked" can still be
	// written as what it is. The two differ on the empty string alone, and that one is the whole of
	// what keeps "find family ties" from overruling a reader who answered "not a family tie".
	if ("kin" in clean) clean.kin = readKin(clean.kin);
	if ("src" in clean) clean.src = readSrc(clean.src);
	if ("origin" in clean) clean.origin = str(clean.origin, RELMAP_ORIGIN_MAX);
	return leafPatch("edges", id, clean);
}

/** Put somebody on the map. Every field written, so the node is whole from its first write. */
export function addNodePatch(id, { uuid = null, name = "", img = "", x = 50, y = 50, note = "" } = {}) {
	return nodePatch(id, { uuid, name, img, x, y, note });
}

/**
 * Draw a link.
 *
 * THE FAMILY TIE DEFAULTS TO UNANSWERED and not to "not a family tie", because a caller that says
 * nothing about it has not asked anybody. The link editor always says something (whichever radio is
 * chosen, including the first), so a line a reader drew carries their answer; a line the ratings
 * import drew in bulk carries none, and is one "find family ties" may still offer a guess at.
 */
export function addEdgePatch(id, {
	a, b, label = "", ink = RELMAP_INK_DEFAULT, dir = RELMAP_DIR_DEFAULT,
	kin = RELMAP_KIN_UNSET, src = RELMAP_SRC_NONE, origin = "", note = "",
} = {}) {
	if (!isSafeId(a) || !isSafeId(b) || a === b) return null;
	return edgePatch(id, { a, b, label, ink, dir, kin, src, origin, note });
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

/**
 * Seat arriving people on a board, and hand back the nodes that would put them there.
 *
 * ONE spelling of the seating rule, shared by every board that seeds itself (relmap-party.js and
 * relmap-village.js). This is the FILLING half of the pair `takenSpots` above is the reading half
 * of, and that function's warning applies twice over here: a seeder that sized the sheet
 * differently, or laid a ring where the other reached for `freeSpot`, is how a newcomer lands on
 * top of somebody on one board and not on the other.
 *
 * ⚠ THE SHEET IS MEASURED FOR THE BOARD THESE PEOPLE ARE ABOUT TO MAKE, not the one they are
 * arriving at: the sheet grows with its cast, so a portrait is smaller on the fuller board and the
 * clearance between seats has to be measured against that.
 *
 * ⚠ A RING ONLY WHEN THE BOARD IS EMPTY, which is the first open and nothing else. After that people
 * are dropped into whatever space is left, because seating the whole cast again would move everybody
 * the table has already placed -- and these boards exist to be arranged.
 *
 * @param {object} graph  the board as it stands, normalized.
 * @param {Array<{uuid, name, img}>} people  who to seat, in the order they should be seated. WHO IS
 *        WANTED IS THE CALLER'S QUESTION, not this one's -- everybody handed over gets a seat.
 * @param {Function} newId  id minter, injected so the result is testable.
 * @returns {{nodes: object, seated: string[]}}  the new nodes, and the identity of everybody
 *          actually given a seat, in seating order.
 */
export function seatArrivals(graph, people = [], newId = () => foundry.utils.randomID()) {
	const nodes = {};
	const seated = [];
	const arriving = (people ?? []).filter(person => person?.uuid);
	if (!arriving.length) return { nodes, seated };

	const standing = Object.keys(graph?.nodes ?? {}).length;
	const room = { r: boardMetrics(standing + arriving.length).r };
	const seats = standing
		? null
		: ringsLayout(arriving.length, { r: room.r, aspect: RELMAP_BOARD_ASPECT });
	const taken = takenSpots(graph);

	arriving.forEach((person, index) => {
		const id = newId();
		if (!isSafeId(id)) return;
		const spot = seats?.[index] ?? freeSpot(taken, room);
		nodes[id] = {
			uuid: person.uuid, name: person.name ?? "", img: person.img ?? "",
			x: spot.left, y: spot.top, note: "",
		};
		taken.push(spot);
		seated.push(nodeIdentity(person));
	});

	return { nodes, seated };
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
