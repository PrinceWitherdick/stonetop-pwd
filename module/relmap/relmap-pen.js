// THE PEN A MAP IS BEING DRAWN WITH: the colour, the stroke and the caption size the NEXT line
// starts in, kept on the map so that it is the same pen in everybody's hand.
//
// WHAT IT IS FOR, in the user's own words: "if the user changes the color or uses dotted lines,
// bigger font etc, keep that selection the next time they make a change on the page. This selection
// should carry over to everyone editing that map." A table working through a board sets a
// convention -- the rumours are dotted plum, the debts are solid rust -- and before this, every
// single line came out slate and solid and had to be recoloured by hand after it was drawn. On a
// board where six lines are drawn while the table talks, that is six trips to the tie bar to say
// the thing they already said on the last one.
//
// ⚠ THIS IS ONLY WHAT COMES NEXT, AND NOTHING HERE IS READ WHILE A BOARD IS PAINTED. What a line
// is drawn in is what is stored ON that line; this is read at exactly one moment, when a line is
// BORN (`_createLink` in dialogs/RelationshipMapWindow.js). Choosing a colour changes the line the
// bar is open over and stamps the ones drawn after it -- it never walks the board rewriting what
// the table has already set, which would be one reader silently editing everybody else's map.
//
// ⚠ ON THE ENTRY, WHICH IS THE MAP, AND NOT ON THE PAGE, WHICH IS ONE BOARD. The sharing the user
// asked for is per MAP, and a pen that reset every time somebody flicked to the next board of the
// same map would read as broken rather than as scoped. It also happens to be the one flag in this
// feature with no legacy shape to worry about: a map still on version 1 keeps its board on the
// entry too, so `getPen(entry)` is the same call on both.
//
// ⚠ AND IT IS THE MAP'S AND NOT THE READER'S, which is the deliberate reversal of what the caption
// size used to be on its own (relmap/relmap-size.js, which is still here and still writes -- see
// `penFor`). Said plainly because it is a real cost: one reader picking a huge caption size sets
// the size every OTHER reader's next line is born in, on that map, until somebody picks another.
// That is what "carry over to everyone editing that map" asks for, and it cuts the other way too --
// the reader at this table on a screen magnifier sets the size once and the GM's lines come out
// readable to them without the GM having to think about it.
//
// THREE FIELDS AND NOT FOUR. Which way a line is READ (`dir`) is on the tie bar beside these and is
// deliberately not remembered: an arrow says who owes whom, which is a fact about the two people
// rather than a house style, and a line that arrived already pointing somewhere would be the board
// asserting something nobody said. Colour, stroke and size are how loudly a line says its piece;
// direction is part of the piece.
//
// LEAF WRITES, for the reason relmap-store.js opens with: two readers at one table, one settling on
// a colour while the other settles on a size, write `...pen.ink` and `...pen.size` and the server
// merges both. Writing the pen object would have the second land on a copy read before the first.

import { SYSTEM_ID } from "../system-id.js";
import {
	RELMAP_DASH_DEFAULT, RELMAP_INK_DEFAULT, RELMAP_SIZE_NONE, readDash, readInk, readSize,
	relmapFlagPath,
} from "./relmap-store.js";

/**
 * The flag key, under this system's scope, that holds one map's pen.
 *
 * ITS OWN FLAG AND NOT A CORNER OF THE GRAPH'S, which matters for two things that would otherwise
 * both be wrong. The graph flag goes through `normalizeGraph`, which drops every key it does not
 * know -- so a pen stored in there would have to be threaded through the sanitiser, the patch
 * builders and the history's `describeWrite`. And the undo stack is made of reversing LEAF writes
 * into that flag (relmap/relmap-history.js): a pen inside it would be a step on the stack, so
 * pressing undo after recolouring a line would take back the colour AND the pen, or worse, take
 * back the pen and leave the line.
 */
export const RELMAP_PEN_FLAG = "relationshipMapPen";

/**
 * WHAT THE PEN HOLDS, and the one place the list is written down.
 *
 * Read by `rememberPen` to pick its fields out of whatever the tie bar happened to write -- the bar
 * hands over labels, notes and directions through the same handler, and this is what says which of
 * them are the pen's business.
 */
export const RELMAP_PEN_FIELDS = Object.freeze(["ink", "dash", "size"]);

/** Each field held to the same gate the line itself goes through. See `readPen`. */
const PEN_GATES = Object.freeze({ ink: readInk, dash: readDash, size: readSize });

/**
 * A stored pen, made safe, with ONLY the fields that were actually set.
 *
 * ⚠ THE SPARSENESS IS THE POINT and is why this cannot just hand back three defaults. Every gate
 * above collapses "absent" and "nonsense" onto the same answer -- an unset size and a size of
 * `"potato"` both read as `RELMAP_SIZE_NONE`, which is also the perfectly good answer "the size the
 * sheet sets". So a pen that filled in its blanks could not tell a map whose reader has never
 * chosen a size from one whose reader has chosen the ordinary one, and `penFor` has to tell those
 * apart to know whether this client's own remembered size still gets a say.
 *
 * Nothing is trusted: this comes out of a flag any owner of the map could have written, through
 * however many versions of this system, exactly like the graph beside it.
 */
export function readPen(raw) {
	const pen = {};
	if (!raw || typeof raw !== "object") return pen;
	for (const key of RELMAP_PEN_FIELDS) {
		if (key in raw) pen[key] = PEN_GATES[key](raw[key]);
	}
	return pen;
}

/** The pen this map is being drawn with, sparse. `{}` on a map nobody has chosen anything on. */
export function getPen(entry) {
	return readPen(entry?.getFlag?.(SYSTEM_ID, RELMAP_PEN_FLAG));
}

/**
 * The fields a line drawn on this map right now is born with: `{ink, dash, size}`, all three set.
 *
 * ⚠ THE CLIENT'S OWN REMEMBERED SIZE IS THE SEED AND ONLY THE SEED. A reader on a screen magnifier
 * who has settled on twenty-pixel captions has that recorded for themselves, flat across every
 * world they open (relmap/relmap-size.js says why at length), and taking that away when the pen
 * arrived would have meant that reader starting every NEW map back at the base size. So it fills in
 * for a map where nobody has chosen a size yet -- and the moment anybody does, the map's answer is
 * the answer for everyone, including them. Passed IN rather than read here so that this file stays
 * a pure reader of one document and the settings live at the call site.
 *
 * @param {JournalEntry} entry  the map.
 * @param {object} [opts]
 * @param {number} [opts.size]  what to use where the map has no size of its own.
 */
export function penFor(entry, { size = RELMAP_SIZE_NONE } = {}) {
	const pen = getPen(entry);
	return {
		ink: pen.ink ?? RELMAP_INK_DEFAULT,
		dash: pen.dash ?? RELMAP_DASH_DEFAULT,
		size: "size" in pen ? pen.size : readSize(size),
	};
}

/**
 * The write that records a chosen field on the map's pen, or null when there is nothing to record.
 *
 * ⚠ ONLY THE PEN'S OWN FIELDS, out of whatever else came with them. Everything the tie bar changes
 * about a line arrives through one handler, so this is handed captions, notes and directions too;
 * they are simply not the pen's business.
 *
 * THE WRITE IS SKIPPED WHEN NOTHING MOVED, which is most calls: the choosers paint their answer on
 * every open of the bar, and a reader pressing the colour a line already has has changed nothing.
 * The same bargain `rememberBoard` and `rememberSize` strike, and it matters more here, because
 * this one is a DOCUMENT write that broadcasts to every client at the table.
 *
 * @param {object} fields  what the reader just chose, as the tie bar wrote it.
 * @param {object} [was]   the pen as it stands, so an unchanged choice writes nothing.
 */
export function penPatch(fields, was = {}) {
	const patch = {};
	for (const key of RELMAP_PEN_FIELDS) {
		if (!(key in (fields ?? {}))) continue;
		const value = PEN_GATES[key](fields[key]);
		if (key in was && was[key] === value) continue;
		patch[relmapFlagPath(RELMAP_PEN_FLAG, key)] = value;
	}
	return Object.keys(patch).length ? patch : null;
}

/**
 * Remember the pen a reader just drew with, so the next line on this map starts in it.
 *
 * ⚠ SILENT, AND NOT AWAITED BY ITS CALLER. This rides alongside the write that actually changes the
 * line, and the line is what the reader is looking at: a pen that failed to record must not put a
 * notification over a colour that landed perfectly well, and must not hold the colour up either.
 * The one way it can honestly fail is a GM who has reached past this feature for core's ownership
 * dialog and left a reader able to edit a BOARD but not the map above it -- rare, real, and not
 * worth interrupting them over. The console line is for whoever is debugging why it did not stick.
 *
 * @returns {Promise|null}  the update in flight, or null when there was nothing to write. Handed
 *          back for the tests and for anything that does want to wait; nothing in the window does.
 */
export function rememberPen(entry, fields = {}) {
	// ASKED, NEVER HELD, the way everything else in this feature asks it: ownership can change
	// under an open board. The same question `canEditRelationshipMap` asks, spelled here rather
	// than imported, to keep this file's only dependency the store it shares a sanitiser with.
	if (!entry?.update || !entry.isOwner) return null;
	const patch = penPatch(fields, getPen(entry));
	if (!patch) return null;
	const blame = err => console.error("Stonetop | remembering the relationship map's pen failed", err);
	try {
		return Promise.resolve(entry.update(patch)).catch(blame);
	} catch (err) {
		blame(err);
		return null;
	}
}
