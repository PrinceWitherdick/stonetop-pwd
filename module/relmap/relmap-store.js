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
	RELMAP_BOARD_ASPECT, RELMAP_CAPTION_FLOOR_PX, RELMAP_CAPTION_PX, boardMetrics, clampPct,
	freeSpot, ringsLayout,
} from "../utils/relmap-geometry.js";
import { normalizeHex } from "./relmap-ink.js";

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
	"rose", "green", "ochre", "indigo", "plum", "rust", "crimson", "slate",
]);
export const RELMAP_INK_DEFAULT = "slate";

/**
 * THE TWO KEYS THAT ARE NO LONGER OFFERED, and what a line drawn in one of them is read as now.
 *
 * "sage" and "teal" were two greens a stroke's width apart on a board read at the zoom a
 * forty-person map is read at, and a table that cannot tell two of eight colours apart has seven.
 * They are gone, and the one green that replaces them is a green anybody would call green; the
 * eighth colour is a red, which is the one a table kept reaching for and did not have.
 *
 * ⚠ READ RATHER THAN MIGRATED, which is the difference between a world that opens and a world that
 * has to be visited. Every board already drawn carries these keys, and the sanitiser is the ONE
 * gate everything reads a map through -- so an old line comes back green wherever it is read, on
 * every client, with nothing written anywhere. The next edit to that line stores the new key by
 * itself; a line nobody ever edits keeps the old one and goes on being read the same way forever.
 * The alternative was a migration that would have had to find every JournalEntry in every world to
 * change what a colour is called.
 */
export const RELMAP_INK_WAS = Object.freeze({ sage: "green", teal: "green" });

/**
 * One stored ink as something this board can draw: one of the eight, or a colour of the reader's own.
 *
 * THE NINTH ANSWER IS A HEX, and it is the same field rather than a second one beside it. A colour
 * and "which of the eight" are one question with one answer, and two fields holding it would be two
 * fields that can disagree -- a line with both, and nothing anywhere saying which wins.
 *
 * ⚠ WHAT IS CHECKED HERE IS THE SHAPE AND NOT THE CONTRAST. This runs on every read of every map,
 * with no document to measure a colour against, and it is the gate between stored data and a `style`
 * attribute -- so it refuses anything that is not exactly `#rrggbb` and does no arithmetic at all.
 * Whether a colour can be FOLLOWED is settled where it is chosen, by `deepenInk`; see relmap-ink.js,
 * which says plainly that a hex written by some other route is a hex nobody vetted.
 */
export function readInk(value) {
	const key = RELMAP_INK_WAS[value] ?? value;
	if (RELMAP_INKS.includes(key)) return key;
	return normalizeHex(key) || RELMAP_INK_DEFAULT;
}

/**
 * Which way a link is read. `none` is the default and the ordinary case: most ties between people
 * run both ways, and a board where every line has arrows at both ends says less than one with none.
 */
export const RELMAP_DIRS = Object.freeze(["none", "a-b", "b-a", "both"]);
export const RELMAP_DIR_DEFAULT = "none";

/**
 * WHETHER THE STROKE IS BROKEN, as a key, and it is a mark the reader made rather than a rendering.
 *
 * The eight inks each already carry a dash pattern (the tokens at the top of the stylesheet), and
 * that pattern is painted ONLY under the high-contrast skin, where its whole job is to say which of
 * eight colours a line is to somebody who cannot resolve the colours. This is a different question
 * that happens to have the same answer shape, and the two have to be kept apart: an ink's pattern
 * is the colour said a second time, while this is a distinction somebody drew on purpose -- the
 * rumour against the fact, the tie a table suspects against the one they know.
 *
 * SO A DELIBERATE "dotted" WINS UNDER THE HIGH-CONTRAST SKIN TOO, and that is a real cost said out
 * loud rather than left to be discovered: a line the reader has dotted stops carrying its ink's
 * pattern there, so its colour is the only thing left saying which ink it is. Both alternatives
 * were worse. Letting the ink's pattern win means the one mark the reader made by hand is silently
 * not drawn for the one reader at this table who most needs marks to be drawn at all; giving dotted
 * lines eight more patterns of their own, each distinguishable from all eight, means sixteen
 * patterns nobody could tell apart.
 *
 * A LINE LEFT "solid" IS UNTOUCHED BY ANY OF THIS and still carries its ink's pattern under that
 * skin, which is every line on every board written before this field existed.
 *
 * THREE AND NOT TWO, AND THE MIDDLE ONE IS THE ONE A TABLE REACHES FOR MOST. Dotted was the whole
 * of "not solid" for a while, and it is the FAINTEST a stroke gets: at the resting weight it is a
 * row of specks, which is exactly right for the tie nobody is sure of and wrong for the one that is
 * merely qualified -- the thing that was, the thing that runs one way in practice, the thing the
 * table has agreed to come back to. "dashed" is that middle answer: a stroke plainly broken and
 * still plainly a stroke. They are ordered here the way they are offered and the way they read --
 * whole, broken, barely -- and that order is what the chooser prints.
 *
 * ⚠ ANYTHING NOT IN THIS LIST FALLS BACK TO SOLID rather than being kept, which is what makes
 * adding to it safe and taking away from it a decision: a board written by a newer version and read
 * by an older one draws its dashed lines whole, which says nothing false about them.
 */
export const RELMAP_DASH_DOTTED = "dotted";
export const RELMAP_DASH_DASHED = "dashed";
export const RELMAP_DASHES = Object.freeze(["solid", RELMAP_DASH_DASHED, RELMAP_DASH_DOTTED]);
export const RELMAP_DASH_DEFAULT = "solid";

/**
 * One stored stroke as something this board can draw, which for anything unrecognised is solid.
 *
 * ONE GATE, the way `readInk` and `readSize` are one apiece. This rule was written out by hand in
 * `normalizeGraph` and again in `edgePatch`, and it has a third caller now (the pen a map draws its
 * next line with, relmap/relmap-pen.js) -- three copies of "unknown reads as solid" is three places
 * for the fourth caller not to look, and a stroke key that got through unchecked would be written
 * into a class name on the board.
 */
export function readDash(value) {
	return RELMAP_DASHES.includes(value) ? value : RELMAP_DASH_DEFAULT;
}

/**
 * HOW BIG THE WRITING ON A LINE IS SET, in board pixels, and nothing at all on nearly every line.
 *
 * ⚠ A NUMBER AND NOT A KEY, WHICH IS THE OPPOSITE OF THE COLOUR ABOVE, and the difference is worth
 * a paragraph because the two questions look identical from the bar: a short list of answers, plus
 * one the reader supplies. An ink is a key because what "rose" RESOLVES to is the stylesheet's
 * business -- it is one colour under the ordinary skin and a darker one under the high-contrast
 * skin, and a stored hex would be the one thing on the board that did not change with it. A size
 * resolves to nothing. Twelve board pixels is twelve board pixels under every skin, it is the unit
 * the whole of relmap-geometry.js already measures in (a portrait is 72 of them), and it is the
 * number the caption has to be MEASURED at to know where to cut the sentence and how big a hole to
 * open in the stroke underneath it. Stored as a key, every one of those sums would have to go
 * through a table to find out what the reader actually asked for.
 *
 * ⚠ AND ZERO IS THE ANSWER ON ALMOST EVERY LINE, which is not a missing value. It says "whatever
 * the sheet sets", it is what every line on every board drawn before this field existed reads as,
 * and it stays true when `RELMAP_CAPTION_PX` is retuned -- where a line stamped with the base of
 * the day would sit at yesterday's size for ever. It HAS been retuned once, from twelve to
 * sixteen, and every ordinary caption on every board moved with it because none of them carried a
 * number. So the chooser offers the base as a real answer and it is stored as the absence of one;
 * see `readSize`.
 *
 * THE STEPS ARE NAMED WHERE WORDS ARE, WHICH IS NOT HERE. This is the vocabulary -- what a reader
 * is offered and in what order -- and the render prints the name beside each one, exactly as it
 * does for the inks and the strokes. They step by about a fifth each so that two of them side by
 * side are plainly different sizes rather than a difference a reader has to measure.
 *
 * ⚠ AND THEY ARE HUNG OFF THE BASE RATHER THAN OFF NOTHING. The ladder used to run
 * 10/12/15/18/24 around a twelve-pixel base; the base is sixteen now, and the same ladder in the
 * same proportions is 13/16/20/24/32. Retuned together on purpose: steps that stayed where they
 * were would have put "Small" and "Normal" a pixel apart and left three of the five below the
 * size an untouched line is already drawn at, so most of the chooser would have been ways to make
 * the writing smaller.
 *
 * ⚠ THE BOUNDS ARE NOT TASTE. The floor IS the size below which the board stops drawing captions
 * at all, taken from that constant rather than spelled again here, so that raising one for
 * legibility cannot leave the other offering sizes a reader could choose and then never see. The
 * ceiling is a board's worth of room: a caption is cut to the room
 * its own line has, and past about this size a line between two neighbouring portraits carries two
 * words and an ellipsis, which is the state the whole caption arrangement exists to avoid.
 */
export const RELMAP_SIZE_NONE = 0;
export const RELMAP_SIZE_MIN = RELMAP_CAPTION_FLOOR_PX;
export const RELMAP_SIZE_MAX = 48;
export const RELMAP_SIZES = Object.freeze([
	{ key: "small", px: 13 },
	{ key: "normal", px: RELMAP_CAPTION_PX },
	{ key: "large", px: 20 },
	{ key: "veryLarge", px: 24 },
	{ key: "huge", px: 32 },
]);

/**
 * One stored size as a number this board can set type in: a size of its own, or nothing.
 *
 * ⚠ THE BASE COMES BACK AS NOTHING, and that is the one surprising line in here. A reader who
 * picks "Normal" has chosen the size the sheet already sets, and the honest record of that choice
 * is no record: it keeps the field empty on the overwhelming majority of lines, it keeps a board
 * of ordinary captions following the stylesheet if that number is ever retuned, and it means the
 * paint has one question to ask rather than two ("has this line a size of its own?").
 *
 * ROUNDED TO A WHOLE PIXEL, because this is what a `font-size` is written from and a caption set
 * in 14.37 pixels is measured, cut and gapped at a precision no reader asked for.
 *
 * ⚠ HELD TO THE BOUNDS RATHER THAN REFUSED, which is what `clampPct` does to a coordinate two
 * screens off the board and is the right answer for the same reason: a reader who types 500 into
 * the custom field wants the biggest caption there is, and giving them the ordinary twelve says
 * their answer was thrown away. The one thing that comes back as nothing is a value that is not a
 * size at all.
 *
 * ⚠ AND IT IS THE ONE GATE. This runs on every read of every map, and it is also what the custom
 * field on the tie bar goes through and what the remembered default goes through
 * (relmap/relmap-size.js) -- world data, browser storage and a number somebody typed, all held to
 * the same shape in one place.
 */
export function readSize(value) {
	const px = Math.round(Number(value));
	if (!Number.isFinite(px) || px <= 0) return RELMAP_SIZE_NONE;
	const held = Math.min(RELMAP_SIZE_MAX, Math.max(RELMAP_SIZE_MIN, px));
	return held === RELMAP_CAPTION_PX ? RELMAP_SIZE_NONE : held;
}

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
 * information now is the board called "The Party", which seats the party by itself and draws only
 * what they actually answered about each other (see relmap/relmap-intros.js).
 *
 * WHAT THIS MARK IS FOR IS THE BOARDS THAT BUTTON WAS ALREADY PRESSED ON. It is the only thing that
 * can tell one of its lines from one somebody drew, and it drives both ways out: a checkbox that
 * puts them away for one reader, and a tool that rubs them out for everyone. It is a mark on the
 * DATA and not a class on the paint, because the hiding has to reach the geometry: a line the
 * reader has put away must not be routed around, fan a pair apart, or shoulder another line's
 * caption off the middle of its own stroke.
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
 * between two faces: `captionRoomPx` lets it run the whole of its own line, and no further. So a caption
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
	// ⚠ A `shape` AND A `kin` PER LINE MAY STILL BE IN THE FLAG, and both are simply not read. They
	// belonged to "Tidy up" and to the family tree, which are gone; leaving the stored keys where
	// they are costs a table nothing and spares every world a migration for two fields nothing asks
	// about. A board reads exactly as it was left.

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
			ink: readInk(edge.ink),
			dir: RELMAP_DIRS.includes(edge.dir) ? edge.dir : RELMAP_DIR_DEFAULT,
			// Solid unless somebody broke it by hand. Unknown and absent both read as solid, which
			// is every line on every board drawn before this existed. See RELMAP_DASHES.
			dash: readDash(edge.dash),
			// How big the writing on it is set, and zero on nearly every line: the size the sheet
			// sets. See RELMAP_SIZES.
			size: readSize(edge.size),
			// Who drew it: a reader, or the ratings import. See RELMAP_SRC_HEARTS.
			src: readSrc(edge.src),
			// WHICH answer it was seeded from, where it was seeded at all. See RELMAP_ORIGIN_MAX.
			origin: str(edge.origin, RELMAP_ORIGIN_MAX),
			note: str(edge.note, RELMAP_NOTE_MAX),
		};
	}
	return graph;
}

/**
 * The flag path to one part of ANY of this system's map flags. The ONE place these are built.
 *
 * Not only the graph's: a board that seats itself keeps its own ledger under its own flag, and that
 * path was being spelled out by hand at the one call site that needed it. A flag path assembled in
 * two places is how one of them ends up wrong -- and the wrong one writes somewhere nothing reads,
 * silently, which is the hardest way to find out.
 */
export function relmapFlagPath(flag, ...parts) {
	return [`flags.${SYSTEM_ID}.${flag}`, ...parts].join(".");
}

/** The flag path to one part of the graph, which is the flag nearly every caller wants. */
export function relmapPath(...parts) {
	return relmapFlagPath(RELMAP_FLAG, ...parts);
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
 * WHAT EACH FIELD IS PUT THROUGH ON ITS WAY INTO WORLD DATA, as a table rather than a ladder of
 * `if ("x" in fields)` lines - the shape `relmap-pen.js` already keeps its three through.
 *
 * A field with no gate is written as it arrives (`uuid`, `img`, `a`, `b`): those are ids and paths,
 * and `leafPatch` is what vets them. A table is what makes it possible to SEE that `dir` is gated
 * and `img` is not; spelled as a ladder, the odd one out was `dir`, which had its check written
 * inline instead of beside its three siblings.
 */
const NODE_GATES = Object.freeze({
	x: clampPct,
	y: clampPct,
	name: v => str(v, RELMAP_NAME_MAX),
	note: v => str(v, RELMAP_NOTE_MAX),
});

const EDGE_GATES = Object.freeze({
	label: v => str(v, RELMAP_LABEL_MAX),
	note: v => str(v, RELMAP_NOTE_MAX),
	origin: v => str(v, RELMAP_ORIGIN_MAX),
	ink: readInk,
	dash: readDash,
	size: readSize,
	src: readSrc,
	dir: v => (RELMAP_DIRS.includes(v) ? v : RELMAP_DIR_DEFAULT),
});

/**
 * The fields a caller actually named, each through its gate. Only PRESENT keys are visited, which is
 * what the `in` tests bought: a patch that says nothing about `note` must not go on to write one.
 */
function gated(gates, fields) {
	const clean = {};
	for (const [key, value] of Object.entries(fields ?? {})) {
		clean[key] = gates[key] ? gates[key](value) : value;
	}
	return clean;
}

/**
 * Move one portrait, or change one of its fields.
 *
 * Leaves only, so this is the write two people dragging at once can both make. Coordinates are
 * clamped and shortened here rather than at the call site, because this is the boundary the numbers
 * cross on their way into world data and there is exactly one of it.
 */
export function nodePatch(id, fields = {}) {
	return leafPatch("nodes", id, gated(NODE_GATES, fields));
}

/** Change one link. Same rules, same reasons. */
export function edgePatch(id, fields = {}) {
	return leafPatch("edges", id, gated(EDGE_GATES, fields));
}

/** Put somebody on the map. Every field written, so the node is whole from its first write. */
export function addNodePatch(id, { uuid = null, name = "", img = "", x = 50, y = 50, note = "" } = {}) {
	return nodePatch(id, { uuid, name, img, x, y, note });
}

/**
 * A whole seating as one patch: every person in `nodes`, folded into the leaf paths that put them
 * on the board.
 *
 * ONE WRITE is the point, and it is why this is a fold rather than a loop of writes: leaf paths
 * merge with somebody else's concurrent drag instead of replacing the `nodes` object out from under
 * it. Three callers were spelling the fold out by hand -- the two seating passes and the window's
 * own "add these people" -- and a fourth would have been the one that forgot the `?? {}`.
 *
 * @param {Record<string, object>} nodes  id -> the fields `addNodePatch` takes.
 */
export function addNodesPatch(nodes = {}) {
	const patch = {};
	for (const [id, node] of Object.entries(nodes ?? {})) Object.assign(patch, addNodePatch(id, node) ?? {});
	return patch;
}

/** Draw a link. Every field written, so the line is whole from its first write. */
export function addEdgePatch(id, {
	a, b, label = "", ink = RELMAP_INK_DEFAULT, dir = RELMAP_DIR_DEFAULT,
	dash = RELMAP_DASH_DEFAULT, size = RELMAP_SIZE_NONE, src = RELMAP_SRC_NONE,
	origin = "", note = "",
} = {}) {
	if (!isSafeId(a) || !isSafeId(b) || a === b) return null;
	return edgePatch(id, { a, b, label, ink, dir, dash, size, src, origin, note });
}

/** The line half of {@link addNodesPatch}: every link in `edges`, folded into one patch. */
export function addEdgesPatch(edges = {}) {
	const patch = {};
	for (const [id, edge] of Object.entries(edges ?? {})) Object.assign(patch, addEdgePatch(id, edge) ?? {});
	return patch;
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
