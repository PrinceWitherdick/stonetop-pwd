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
import { deletionEntry, deletionUpdate } from "../utils/foundry-compat.js";
import { clipText } from "../utils/strings.js";
import {
	RELMAP_BOARD_ASPECT, RELMAP_CAPTION_FLOOR_PX, RELMAP_CAPTION_PX, boardMetrics, chipLayout, clampReach,
	freeSpot, personReach, readGroupGrow, ringsLayout, underReach,
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
 * ⚠ HELD TO THE BOUNDS RATHER THAN REFUSED, which is what `clampReach` does to a coordinate many
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

/**
 * WHERE ALONG ITS OWN LINE A CAPTION SITS, as a share of the curve, and nothing at all on nearly
 * every line.
 *
 * ⚠ ZERO IS "WHEREVER THE BOARD PUTS IT", not the start of the line, and that is the whole shape of
 * this field. A caption is placed by the spreader (`spreadLabels`, utils/relmap-geometry.js), which
 * walks the board putting each one at the stop nearest the middle of its own line that is clear of
 * everything already down — and that arrangement is what a board with eighty lines on it needs, so
 * it stays the answer for every line nobody has moved by hand. What this records is a reader
 * OVERRULING it on one line: they dragged the words along the stroke, and there the words stay.
 *
 * A SHARE OF THE CURVE'S PARAMETER, which is what every placer in the geometry already takes
 * (`edgeLabelAnchor`, `curveWithGap`), so a stored seat goes straight in where the spreader's own
 * stop would have gone and nothing downstream learns a second vocabulary for the same number.
 *
 * ⚠ AND IT IS HELD OFF THE VERY ENDS. Both ends of a line run under the portraits it joins, and a
 * caption slid all the way there is words sitting on somebody's face — which is what the spreader
 * keeps every caption clear of by `RELMAP_LABEL_CLEAR_PX`. A hand seat is allowed far nearer than
 * the spreader would ever choose, because a reader who dragged the words there chose it; it is not
 * allowed off the end of the stroke.
 *
 * THREE DECIMALS, which on the longest line a board this size can hold is about a pixel. Two would
 * be six, and six is a caption that visibly does not land where it was dropped.
 */
export const RELMAP_SEAT_AUTO = 0;
export const RELMAP_SEAT_MIN = 0.02;
export const RELMAP_SEAT_MAX = 0.98;

/**
 * One stored seat as a share this board can place a caption at, or nothing.
 *
 * The same bargain `readSize` strikes, for the same reason: what comes back as nothing is every
 * line on every board drawn before a caption could be dragged, and every line since that nobody has
 * dragged — which is nearly all of them. Held to the bounds rather than refused, because a seat out
 * past the end is a gesture that went too far rather than a gesture that meant nothing.
 */
export function readSeat(value) {
	const t = value === null || value === undefined || value === "" ? NaN : Number(value);
	if (!Number.isFinite(t) || t <= 0) return RELMAP_SEAT_AUTO;
	const held = Math.min(RELMAP_SEAT_MAX, Math.max(RELMAP_SEAT_MIN, t));
	return Math.round(held * 1000) / 1000;
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

/**
 * How long the label under a person's name may be ("Iron Knight", "Deceased", "Acolyte of the
 * Celebrated Seer"). It belongs to the person ON THIS MAP, never to the actor, so one face can be
 * "Squire" on one board and "Deceased" on another. Drawn at most two lines deep under the name, so it
 * is a title and not a biography; the note is where the story goes.
 */
export const RELMAP_SUBTITLE_MAX = 80;

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

/**
 * THE TWO OUTLINES A GROUP CAN BE DRAWN AS. A key, never a measurement: the outline itself is worked
 * out from where its members stand on every paint (`groupOutline` in relmap-geometry.js), so the
 * only thing stored is which of the two the table chose.
 */
export const RELMAP_GROUP_SHAPES = Object.freeze(["box", "oval"]);
export const RELMAP_GROUP_SHAPE_DEFAULT = "box";

/** One stored group shape, read safely. Unknown and absent both read as a box. */
export function readGroupShape(value) {
	return RELMAP_GROUP_SHAPES.includes(value) ? value : RELMAP_GROUP_SHAPE_DEFAULT;
}

/**
 * THE TWO STROKES A GROUP'S OUTLINE CAN BE DRAWN WITH: whole, or broken into dashes. Two and not the
 * line's three (RELMAP_DASHES): a group is a region of paper and not a tie, so "the tie nobody is
 * sure of" has no meaning for it, and dots round a box read as a ruled-off margin. The same KEYS as
 * the line's, so a stroke means one word wherever it is stored.
 *
 * SOLID BY DEFAULT, which every group drawn before this existed reads as: they were all dashed, and
 * the table asked for whole outlines unless somebody chose otherwise.
 */
export const RELMAP_GROUP_DASHES = Object.freeze(["solid", RELMAP_DASH_DASHED]);
export const RELMAP_GROUP_DASH_DEFAULT = "solid";

/** One stored group stroke, read safely. Unknown and absent both read as solid. */
export function readGroupDash(value) {
	return RELMAP_GROUP_DASHES.includes(value) ? value : RELMAP_GROUP_DASH_DEFAULT;
}

/**
 * TAG CHIPS: short marks worn by a person on this board ("Dead", "Noble"), each a word, a colour and
 * an optional icon. Defined once per board in `graph.chips` and worn by id, one leaf per chip per
 * person (`nodes.<id>.chips.<chip>`), so two players tagging one person at once both keep theirs.
 *
 * Shared between maps by id: a chip made on one board is offered on every board (relmap-chips.js), and
 * wearing it on a board that has never seen it copies the definition there under the same id.
 */
export const RELMAP_CHIP_NAME_MAX = 24;

/** The icons a chip may wear: Font Awesome solid glyphs, checked against the FA build of v13 and v14. */
export const RELMAP_CHIP_ICONS = Object.freeze([
	"fa-skull", "fa-heart", "fa-heart-crack", "fa-crown", "fa-shield-halved", "fa-hand-fist", "fa-star",
	"fa-eye", "fa-eye-slash", "fa-mask", "fa-ghost", "fa-coins", "fa-scroll", "fa-book-open", "fa-hammer",
	"fa-wheat-awn", "fa-leaf", "fa-paw", "fa-dove", "fa-fire", "fa-droplet", "fa-link", "fa-lock", "fa-key",
	"fa-question", "fa-exclamation", "fa-user-secret", "fa-hourglass-half", "fa-handshake", "fa-gavel",
	"fa-house", "fa-ring", "fa-baby", "fa-moon", "fa-sun",
]);

/**
 * Chips every board offers before anyone has made one. The name is localized when it is offered and
 * stored as that text when first worn, so from then on it is an ordinary chip the table can recolour.
 */
export const RELMAP_CHIP_PRESETS = Object.freeze([
	Object.freeze({ id: "dead", nameKey: "stonetop.relmap.chips.dead", icon: "fa-skull", ink: "crimson" }),
]);

/** One stored chip icon, read safely. Anything not on the list is no icon. */
export function readChipIcon(value) {
	return RELMAP_CHIP_ICONS.includes(value) ? value : "";
}

/**
 * ONE ORDER FOR A PERSON'S CHIPS everywhere they are drawn: the presets first, in their own order
 * ("Dead" leads), then by name. A stored order would be one more thing two players could write at once.
 *
 * @returns {Array<{id: string, name: string, icon: string, ink: string}>}
 */
export function chipsWorn(node, graph) {
	return Object.keys(node?.chips ?? {})
		.map(id => (graph?.chips?.[id] ? { id, ...graph.chips[id] } : null))
		.filter(Boolean)
		.sort(compareChips);
}

/** The order chips are listed in: presets first, then by name, then by id so it is total. */
export function compareChips(a, b) {
	const rank = chip => {
		const at = RELMAP_CHIP_PRESETS.findIndex(preset => preset.id === chip.id);
		return at < 0 ? RELMAP_CHIP_PRESETS.length : at;
	};
	return rank(a) - rank(b)
		|| String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })
		|| String(a.id).localeCompare(String(b.id));
}

/** A chip's name, trimmed: one of only spaces is no name. */
export const chipNameOf = v => str(v, RELMAP_CHIP_NAME_MAX).trim();

/** A map with nobody on it yet. */
export function emptyGraph() {
	return { version: RELMAP_VERSION, nodes: {}, edges: {}, groups: {}, chips: {} };
}

const str = (v, max = 0) => {
	const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
	// A whole character, never half of an emoji's pair: this is what every stored name, caption and note
	// is cut to, and half a pair written here is a broken character broadcast to the table for good.
	return max ? clipText(s, max) : s;
};

/**
 * A label under a name, TRIMMED: one of only spaces is no label. Kept, it drew a blank chip where
 * "Add a label" belongs and made every outline round that person reach for words nobody can see.
 */
const subtitleOf = v => str(v, RELMAP_SUBTITLE_MAX).trim();

/** The chips one person wears, as `{chipId: true}`, keeping only ids `defined` holds. */
function wornChips(raw, defined) {
	const worn = {};
	if (!raw || typeof raw !== "object") return worn;
	for (const [chipId, on] of Object.entries(raw)) {
		if (on && isSafeId(chipId) && defined[chipId]) worn[chipId] = true;
	}
	return worn;
}

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

	// CHIPS FIRST, because a person's chips are read against them. A chip with no name has nothing to
	// say and is not on the board; nobody wearing it is fine (it is still offered).
	for (const [id, chip] of Object.entries(raw.chips ?? {})) {
		if (!isSafeId(id) || !chip || typeof chip !== "object") continue;
		const name = chipNameOf(chip.name);
		if (!name) continue;
		graph.chips[id] = { name, icon: readChipIcon(chip.icon), ink: readInk(chip.ink) };
	}

	for (const [id, node] of Object.entries(raw.nodes ?? {})) {
		if (!isSafeId(id) || !node || typeof node !== "object") continue;
		// ⚠ NOBODY AT ALL: no actor, no name, no picture. Nothing puts a person down like that (every
		// arrival brings an actor's uuid and name), so it is the RACE: a move, a nudge or a label written
		// by one reader landing on the server just after another took that person off, which makes the
		// node again out of that one field. Kept, the whole table saw a blank "Someone" appear. The
		// window's `onto` guard catches the case it can see; this is the one it cannot, since the write
		// had already left. The stray leaf stays in the flag, unread, as a removed person's groups do.
		if (!node.uuid && !node.name && !node.img) continue;
		graph.nodes[id] = {
			uuid: node.uuid ? str(node.uuid) : null,
			name: str(node.name, RELMAP_NAME_MAX),
			img: str(node.img),
			// ⚠ `clampReach` AND NOT `clampPct`: a person may stand off the sheet now, and reading
			// them back through the sheet's own edge would put them on it at every repaint.
			x: clampReach(node.x),
			y: clampReach(node.y),
			note: str(node.note, RELMAP_NOTE_MAX),
			// ⚠ EMITTED ON EVERY NODE, EMPTY OR NOT. The undo stack records a field only when it can read
			// the old value off this read (relmap-history.js `describeWrite`), so a label absent here is a
			// label nobody can take back. Absent on every person put down before it existed: no migration.
			subtitle: subtitleOf(node.subtitle),
			// Emitted on every node for the same reason, and only chips this board defines: a deleted
			// chip's leaf stays in the flag, unread, so undoing the deletion brings it back on everyone.
			chips: wornChips(node.chips, graph.chips),
		};
		// DERIVED, NEVER STORED (`storableGraph` strips them): this person's chips laid out in the rows
		// they are drawn in (`chipLaid`, which the window paints), and how many rows that is
		// (`chipRows`, which every outline and frame reaches round: relmap-geometry.js `underReach`).
		// Worked out once per read here rather than again on every paint. Only on somebody wearing any.
		const laid = chipLayout(chipsWorn(graph.nodes[id], graph));
		if (laid.rows.length) Object.assign(graph.nodes[id], { chipRows: laid.rows.length, chipLaid: laid });
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
			// Where along the stroke its caption was dragged to, and zero on nearly every line:
			// wherever the spreader puts it. See RELMAP_SEAT_AUTO.
			seat: readSeat(edge.seat),
			// Who drew it: a reader, or the ratings import. See RELMAP_SRC_HEARTS.
			src: readSrc(edge.src),
			// WHICH answer it was seeded from, where it was seeded at all. See RELMAP_ORIGIN_MAX.
			origin: str(edge.origin, RELMAP_ORIGIN_MAX),
			note: str(edge.note, RELMAP_NOTE_MAX),
		};
	}

	// GROUPS: a name, a shape, a stroke, an ink, and WHO IS IN IT. Every field is emitted on every group, even an
	// empty one, because the undo stack can only reverse a field it can read the old value of.
	for (const [id, group] of Object.entries(raw.groups ?? {})) {
		if (!isSafeId(id) || !group || typeof group !== "object") continue;
		const members = {};
		for (const [nodeId, on] of Object.entries(group.members ?? {})) {
			// ⚠ ONLY PEOPLE WHO ARE STANDING ON THE BOARD. Taking somebody off the map deliberately
			// leaves their membership keys where they are (`dropNodePatch` does not touch groups), so
			// an undo that puts them back under the same id puts them back in their groups too, with
			// no bookkeeping. This read is what keeps the stale key from drawing anything meanwhile.
			if (on && isSafeId(nodeId) && graph.nodes[nodeId]) members[nodeId] = true;
		}
		// ⚠ AND A GROUP WITH NOBODY LEFT STANDING IS NOT ON THE BOARD AT ALL. Its last member taken off,
		// it has no outline to draw, so nothing could select or rub it out, and its colour still counted
		// as worn (`_makeGroup`) and as already on the map (`_inksInUse`). Skipped here, on the READ: the
		// stored group stays, so the undo that puts its people back puts it back with them. An outline
		// round nobody is nothing, which is also why taking the last people out rubs a group out.
		if (!Object.keys(members).length) continue;
		graph.groups[id] = {
			name: str(group.name, RELMAP_LABEL_MAX),
			shape: readGroupShape(group.shape),
			dash: readGroupDash(group.dash),
			ink: readInk(group.ink),
			// Extra room past its people, per side. Nothing on every group drawn before it could be resized.
			grow: readGroupGrow(group.grow),
			members,
		};
	}
	return graph;
}

/** What `normalizeGraph` works out for a person and never stores. */
const DERIVED_NODE_FIELDS = Object.freeze(["chipRows", "chipLaid"]);

/**
 * A normalized graph made fit to write WHOLE (a new page's flag), without the fields the read derives.
 * A copy: the graph handed in is the caller's.
 */
export function storableGraph(graph) {
	const nodes = {};
	for (const [id, node] of Object.entries(graph?.nodes ?? {})) {
		const kept = { ...node };
		for (const field of DERIVED_NODE_FIELDS) delete kept[field];
		nodes[id] = kept;
	}
	return { ...graph, nodes };
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
	x: clampReach,
	y: clampReach,
	name: v => str(v, RELMAP_NAME_MAX),
	note: v => str(v, RELMAP_NOTE_MAX),
	subtitle: subtitleOf,
});

const EDGE_GATES = Object.freeze({
	label: v => str(v, RELMAP_LABEL_MAX),
	note: v => str(v, RELMAP_NOTE_MAX),
	origin: v => str(v, RELMAP_ORIGIN_MAX),
	ink: readInk,
	dash: readDash,
	size: readSize,
	seat: readSeat,
	src: readSrc,
	dir: v => (RELMAP_DIRS.includes(v) ? v : RELMAP_DIR_DEFAULT),
});

// ⚠ `members` IS NOT A FIELD THIS TABLE WILL WRITE. Membership goes one leaf per person through
// `groupMembersPatch`, never as an object here: a whole `members` object written by one player
// replaces the one another player wrote a moment before, and the person they added vanishes.
const GROUP_GATES = Object.freeze({
	name: v => str(v, RELMAP_LABEL_MAX),
	shape: readGroupShape,
	dash: readGroupDash,
	ink: readInk,
	// ALL FOUR SIDES IN ONE OBJECT, written whole every time, so a step of the undo can put a resize
	// back with one field: the corner dragged moves two sides at once.
	grow: readGroupGrow,
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
export function addNodePatch(id, {
	uuid = null, name = "", img = "", x = 50, y = 50, note = "", subtitle = "", chips = {},
} = {}) {
	// The label and chips too: undoing a removal puts the person back through here, label and all.
	const patch = nodePatch(id, { uuid, name, img, x, y, note, subtitle });
	if (!patch) return null;
	const worn = Object.keys(chips ?? {}).filter(chipId => chips[chipId]);
	return { ...patch, ...(nodeChipsPatch(id, worn) ?? {}) };
}

// ⚠ `chips` IS NOT A FIELD `nodePatch` WRITES. A person's chips go one leaf each through
// `nodeChipsPatch`, for the reason group members do: a whole object written by one player replaces
// the one another player wrote a moment before.
const CHIP_GATES = Object.freeze({
	name: chipNameOf,
	icon: readChipIcon,
	ink: readInk,
});

/** Rename, recolour or re-icon one chip on this board. */
export function chipPatch(id, fields = {}) {
	return leafPatch("chips", id, gated(CHIP_GATES, fields));
}

/** Define a chip on this board. Every field written, so it is whole from its first write. Null with no name. */
export function addChipPatch(id, { name = "", icon = "", ink = RELMAP_INK_DEFAULT } = {}) {
	if (!chipNameOf(name)) return null;
	return chipPatch(id, { name, icon, ink });
}

/**
 * Put chips on one person and take chips off, ONE LEAF PER CHIP, written `true` to wear and deleted
 * to take off. A chip named in both lists is worn.
 */
export function nodeChipsPatch(id, add = [], remove = []) {
	if (!isSafeId(id)) return null;
	const patch = {};
	for (const chipId of remove ?? []) {
		if (!isSafeId(chipId)) continue;
		const [key, value] = deletionEntry(relmapPath("nodes", id, "chips", chipId));
		patch[key] = value;
	}
	for (const chipId of add ?? []) {
		if (!isSafeId(chipId)) continue;
		const [gone] = deletionEntry(relmapPath("nodes", id, "chips", chipId));
		delete patch[gone];
		patch[relmapPath("nodes", id, "chips", chipId)] = true;
	}
	return Object.keys(patch).length ? patch : null;
}

/** Rub a chip off this board: its definition and every person's leaf for it, in one update. */
export function dropChipPatch(graph, id) {
	if (!isSafeId(id)) return null;
	const entries = [deletionEntry(relmapPath("chips", id))];
	for (const [nodeId, node] of Object.entries(graph?.nodes ?? {})) {
		if (node?.chips?.[id]) entries.push(deletionEntry(relmapPath("nodes", nodeId, "chips", id)));
	}
	return Object.fromEntries(entries);
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
	dash = RELMAP_DASH_DEFAULT, size = RELMAP_SIZE_NONE, seat = RELMAP_SEAT_AUTO,
	src = RELMAP_SRC_NONE, origin = "", note = "",
} = {}) {
	if (!isSafeId(a) || !isSafeId(b) || a === b) return null;
	// ⚠ THE SEAT IS WRITTEN AS NOTHING and that is the field being whole rather than the field being
	// skipped: a line is born wherever the board puts its caption, and a stored zero is exactly what
	// says so. Left out, a line REDRAWN over an id that had been dragged before — an undo of a
	// deletion is one — would inherit the old line's seat and open with its caption somewhere
	// nobody on this board ever put it.
	return edgePatch(id, { a, b, label, ink, dir, dash, size, seat, src, origin, note });
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
	return deletionUpdate(relmapPath("edges", id));
}

/** Rename, recolour or reshape one group. Never its members; see {@link groupMembersPatch}. */
export function groupPatch(id, fields = {}) {
	const clean = gated(GROUP_GATES, fields);
	delete clean.members;
	return leafPatch("groups", id, clean);
}

/**
 * Put people into a group and take people out of it, ONE LEAF PER PERSON.
 *
 * `groups.<id>.members.<person>` written `true` to add and deleted to take out, so two players
 * adding two different people to "The hunters" at the same moment both win. Somebody named in both
 * lists is added: the later list of the two is the one a caller would have meant to lose.
 */
export function groupMembersPatch(id, add = [], remove = []) {
	if (!isSafeId(id)) return null;
	const patch = {};
	for (const nodeId of remove ?? []) {
		if (!isSafeId(nodeId)) continue;
		const [key, value] = deletionEntry(relmapPath("groups", id, "members", nodeId));
		patch[key] = value;
	}
	for (const nodeId of add ?? []) {
		if (!isSafeId(nodeId)) continue;
		// A deletion of this same person spelled the v13 way would sit under a different key; a write
		// and a deletion of one leaf in one update is a race the server settles, so drop the deletion.
		const [gone] = deletionEntry(relmapPath("groups", id, "members", nodeId));
		delete patch[gone];
		patch[relmapPath("groups", id, "members", nodeId)] = true;
	}
	return Object.keys(patch).length ? patch : null;
}

/**
 * Draw a group round some people. Every field written, so the group is whole from its first write.
 * Null when there is nobody to put in it: a group with no one inside has no outline to draw.
 */
export function addGroupPatch(id, {
	name = "", shape = RELMAP_GROUP_SHAPE_DEFAULT, dash = RELMAP_GROUP_DASH_DEFAULT,
	ink = RELMAP_INK_DEFAULT, grow = null, members = [],
} = {}) {
	if (!isSafeId(id)) return null;
	const into = groupMembersPatch(id, members);
	if (!into) return null;
	return { ...groupPatch(id, { name, shape, dash, ink, grow }), ...into };
}

/** Rub out one group. The people in it stay exactly where they are. */
export function dropGroupPatch(id) {
	if (!isSafeId(id)) return null;
	return deletionUpdate(relmapPath("groups", id));
}

/**
 * The dead data in a STORED map that nothing can ever bring back, as one patch rubbing it out, or
 * null when there is none. Read off the RAW flag, since what it is after is exactly what
 * `normalizeGraph` already hides.
 *
 * ONLY LINES WITH AN END NOBODY IS STANDING AT (or both ends on one person, or not a line at all).
 * They are left by the race `normalizeGraph` describes: a line drawn to somebody in the moment another
 * reader took them off. Nothing needs them. Taking a person off rubs out every line it can see in the
 * same write (`dropNodePatch`), and undoing that re-draws each of those lines, whole, from the step
 * itself (relmap-history.js `describeWrite`), never from what is left in the flag; and `stepPatch`
 * refuses to draw a line whose end is not on the board. The one way a dead line comes back to life
 * unpruned is the person it was raced to being put back, which revives a line nobody drew to them.
 *
 * ⚠ NOT A REMOVED PERSON'S MEMBERSHIP KEYS, AND NOT A GROUP WITH NOBODY LEFT STANDING. Those are
 * hidden on the read and still READ BY AN UNDO: putting back the last person taken out of a group
 * brings the group back through the key they left (relmap-groups.test.js "brings a group back with
 * its last member"), and with two readers undoing in turn the keys are the only record of who was in
 * a group that emptied in between. The history is per reader and never leaves their machine, so
 * nobody pruning can know whether some open window still holds such a step.
 *
 * ⚠ NOR A STRAY FIELD MADE INTO A FACELESS NODE (see `normalizeGraph`). Rubbing that out is a
 * deletion of the whole `nodes.<id>`, and if it lands just after an undo has put that person back
 * whole, it takes them off the map again.
 *
 * @param {object} raw  the graph flag as stored, not normalized.
 * @returns {object|null}
 */
export function pruneDeadPatch(raw) {
	if (!raw || typeof raw !== "object" || !raw.edges || typeof raw.edges !== "object") return null;
	// Who is standing is the read's own answer, so a line is dead here exactly when no board draws it.
	const standing = normalizeGraph(raw).nodes;
	const entries = [];
	for (const [id, edge] of Object.entries(raw.edges)) {
		// An id no path could have written cannot be named in a deletion either; it stays, unread.
		if (!isSafeId(id)) continue;
		const a = edge && typeof edge === "object" ? str(edge.a) : "";
		const b = edge && typeof edge === "object" ? str(edge.b) : "";
		if (standing[a] && standing[b] && a !== b) continue;
		// The same spelling `dropNodePatch` uses, for the reason it gives: the two cores disagree.
		entries.push(deletionEntry(relmapPath("edges", id)));
	}
	return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * Where the portraits already sit, in the shape `freeSpot` and `ringsLayout` want.
 *
 * ONE spelling, shared by the window and the importer: a seat that reads the occupied list
 * differently from the one that fills it is how a newcomer lands on top of somebody.
 *
 * `under` (how deep their label and chips hang, in board pixels) and `across` (how far either side) on
 * somebody with either, and only on them, so `freeSpot` keeps a newcomer's face off those too. Left off
 * everybody else, a board with no labels or chips seats exactly as it always did.
 */
export function takenSpots(graph) {
	const reach = personReach();
	return Object.values(graph?.nodes ?? {}).map(n => {
		const { x, down } = underReach(n, reach);
		return down ? { left: n.x, top: n.y, under: down, across: x } : { left: n.x, top: n.y };
	});
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
