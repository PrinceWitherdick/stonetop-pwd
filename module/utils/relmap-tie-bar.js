// The bar that appears over a line on a relationship map when somebody clicks it: what the line
// says, what colour it is, which way it is read, and whether its stroke is broken.
//
// WHY THIS EXISTS AT ALL. Clicking a line opened a modal window asking six questions. Four of them
// are the ones a table changes while they are talking -- the words, the colour, the arrows, the
// dashes -- and a window that has to be opened, aimed at and dismissed for each is four windows
// between one thought and the next. So they are here, on the line itself, and the window is gone:
// the last button on this bar rubs the line out, which was the only other thing that window did
// that a table does in the middle of a sentence.
//
// TWO OF THE FOUR ARE ANSWERS ON A LATCH AND TWO ARE NOT, and which is which is decided by WIDTH
// rather than by kind. This bar floats over the very drawing the table is reading, so every press
// standing open on it is board the reader cannot see -- and a question nobody is asking should not
// be paying that rent. The arrows stay a row because four 26px presses cost about what one trigger
// would and answer in ONE press instead of two. The colour and the stroke are triggers, because
// eight discs and three squares together were half the strip.
//
// Eight colours as eight discs was a third of the bar, and a third of the board it floats over,
// spent on one question -- and it could only put each colour's NAME in a tooltip, when "the green
// one" is what a table actually says. A `select` named all eight and gave the width back, and cost
// the one press: open, find, release, for something that had been a click. What is here now is the
// ANSWER on the bar -- one disc and one word -- and the colours laid out under it when the reader
// presses that. One press to open it and one per colour after that, and the width is spent only
// while somebody is choosing.
//
// THE STROKE WENT THE SAME WAY WHEN THERE WERE THREE OF THEM. Solid and dotted were two presses and
// affordable; adding "dashed" -- the middle answer, the tie that was rather than the tie nobody is
// sure of -- would have made it three, on the question a table asks least of the four. So it is a
// trigger drawing the stroke the line HAS, and the three under it. `TIE_POPS` is the pair, and
// everything about opening, closing, placing and marking a panel is written once for both.
//
// ⚠ THE STROKE'S TRIGGER PRINTS NO WORD BESIDE ITS SAMPLE AND THE COLOUR'S DOES, which is not an
// inconsistency. A colour cannot be read at all by somebody who cannot resolve it, and there are
// two such readers at this table; a stroke IS a shape, and the shape on the trigger is the one the
// line is drawn with. It is still SAID -- the spoken label and the tooltip are rewritten on every
// pick, and every row in the panel prints its name -- because an 18px rule is small.
//
// THE PALETTE IS THREE BLOCKS AND THEY ARE ONE QUESTION. The eight this system ships; the forty
// this system offers, which are hexes and are stored as hexes (`RELMAP_INK_PRESETS`); and the
// colours already on THIS board that neither of those already shows, which is where a table that
// has typed itself a purple finds that purple again without going back through the picker. One
// radiogroup over all three, because a line is drawn in exactly one colour.
//
// ⚠ AND THEY ARE ALL LAID OUT AT ONE WIDTH, which is not a tidiness. Up and Down step by a ROW in
// there -- fifty-odd swatches is not a list to walk one at a time -- and one stride carries a
// reader down through all three blocks only because a row is the same number in each. `_across`
// reads that number off the markup; see `RELMAP_INK_ACROSS`.
//
// ⚠ BOTH PANELS ARE CHILDREN OF THE BAR AND MUST STAY SO. `BOARD_CONTROLS` in the window names
// `.stonetop-relmap-tiebar` as a thing a press must not start a pan from; a panel outside it would
// have its mousedown taken as the start of a pan, and the capture that takes retargets the click at
// the viewport -- so every swatch and every row in it would be dead on a dead-centre click that
// never moved a pixel.
//
// ⚠ IT LIVES IN THE VIEWPORT AND NOT ON THE BOARD, and that is not a positioning convenience. The
// board's markup is REPLACED wholesale on every live update -- somebody else at the table moving a
// portrait rewrites its innerHTML -- so a bar drawn on the board would be destroyed under the
// reader's hands mid-sentence, taking a half-typed caption and the focus with it. Out in the
// viewport it survives every repaint and is only re-placed. That is also why `place()` is called
// from the surface's `onChange`: nothing moves this thing except being told to.
//
// ⚠ AND IT IS PLACED IN SCREEN PIXELS, NOT BOARD PERCENTAGES. The board is scaled and rotated type
// is set on it; this is chrome. A bar that rode the board's transform would shrink to nothing at
// the zoom a forty-person map is read at, which is exactly the board that most needs it.

import {
	RELMAP_DASHES, RELMAP_DASH_DEFAULT, RELMAP_DIR_DEFAULT, RELMAP_INKS, RELMAP_INK_DEFAULT,
	readSize,
} from "../relmap/relmap-store.js";
import {
	RELMAP_INK_CUSTOM, RELMAP_INK_PRESETS, deepenInk, inkPaint, normalizeHex, resolveInkHex,
} from "../relmap/relmap-ink.js";
import { RELMAP_CAPTION_PX, curvePoints } from "./relmap-geometry.js";

/**
 * How long the caption field sits still before what is in it is written to the shared document.
 *
 * A WRITE PER KEYSTROKE IS A BROADCAST PER KEYSTROKE. Every client at the table repaints its board
 * on each one, and the board is not a cheap thing to repaint -- so typing a sentence would repaint
 * everybody else's map thirty times, each one throwing away the lit web under their pointer.
 *
 * AND IT IS NOT THE ONLY WAY OUT. Enter writes at once, closing the bar writes, and so does the
 * window asking whether it may repaint (`isWriting`), so nothing waits on this timer to be saved --
 * it only decides how quiet the field has to go before the save happens by itself.
 */
export const TIE_WRITE_DELAY_MS = 600;

/**
 * How long a chosen colour sits still before it is written.
 *
 * ⚠ THE PICKER FIRES `change` WHILE IT IS STILL BEING USED. `HTMLColorPickerElement` dispatches
 * from its own value setter, so a hex typed into its field is a `change` per keystroke and a drag
 * around the system colour dialog is a `change` per stop -- each one a write to a SHARED document
 * and a repaint of every board at the table. Coalesced here rather than guessed at from the event.
 *
 * THE EIGHT DO NOT NEED IT and are held back anyway, so there is one path for a chosen colour
 * rather than two. It costs nothing: the swatch and the bar are painted at once and only the
 * document waits, and a reader who picks rose and then green a moment later gets one write.
 */
export const TIE_INK_DELAY_MS = 250;

/**
 * How long a typed size sits still before it is written.
 *
 * ⚠ A NUMBER IS TYPED ONE DIGIT AT A TIME AND EVERY DIGIT IS A SIZE. "18" is a 1 and then an 8, and
 * a 1 is held to the floor by `readSize` -- so written per keystroke, every board at the table would
 * repaint with this caption at eight pixels on the way to eighteen, and the reader would watch their
 * own line jump about while they typed. The spinner arrows are the same story held down.
 *
 * SHORTER THAN THE CAPTION'S, because the answer is two digits rather than a sentence and a reader
 * who has typed one is waiting to see it. The five steps beside the field do not come through here
 * at all: one press is one answer, and it is written at once.
 */
export const TIE_SIZE_DELAY_MS = 300;

/**
 * The three answers this bar holds back before writing: how long each waits, and what writing it is.
 *
 * ⚠ ONE TABLE BECAUSE EVERY ONE OF THEM HAS TO BE ENUMERATED FOUR MORE TIMES. A held answer needs
 * arming, disarming, counting in `isWriting` -- the affirmative guard that stops a repaint landing
 * on something under the reader's hand -- and cancelling in `destroy`. Written out per field that
 * was a timer, an arm and a disarm apiece and three hand-kept lists, and the one that got left off
 * a list is either a write that lands on a line the reader has already rubbed out or a timer still
 * holding a closed bar alive. A fourth held answer is a row here and nothing else.
 *
 * The delays differ for the reasons each constant gives, and the flushes genuinely differ: only the
 * caption's compares the field against what was last saved, and only the size's repaints the field
 * from what will actually be stored.
 */
/**
 * The presses that are their own thing, rather than one of TIE_GROUPS answered on the spot.
 *
 * THE THREE THAT OPEN A PANEL WRITE NOTHING BY THEMSELVES, which is what makes one safe to open on a
 * line already drawn: the line keeps its colour, its stroke and its size until something inside is
 * actually pressed.
 *
 * A table rather than a run of `if`s for the reason the window's own TOOLS is one: a fourth chooser
 * was three near-identical branches in the middle of a method that also has to know about the rub
 * and about the groups, and the branches were the only thing saying which presses those are.
 */
const TIE_PRESSES = Object.freeze({
	inkopen: bar => bar._togglePop("ink"),
	dashopen: bar => bar._togglePop("dash"),
	sizeopen: bar => bar._togglePop("size"),
	inkmore: bar => bar._openHex(),
	ink: (bar, value) => bar._pickInk(value),
	dash: (bar, value) => bar._pickDash(value),
	size: (bar, value) => bar._pickSize(value),
});

/** The forty colours the palette offers, for asking whether one is among them. See `_isPreset`. */
const PRESET_HEXES = new Set(RELMAP_INK_PRESETS.map(preset => preset.hex));

const TIE_DEFERRED = Object.freeze({
	words: { ms: TIE_WRITE_DELAY_MS, flush: bar => bar.flush() },
	ink: { ms: TIE_INK_DELAY_MS, flush: bar => bar._flushInk() },
	size: { ms: TIE_SIZE_DELAY_MS, flush: bar => bar._flushSize() },
});

/** How far above the line the bar floats, and how near the viewport's edges it may come. */
const TIE_BAR_GAP_PX = 14;
const TIE_BAR_EDGE_PX = 6;

/**
 * How far the stroke must stay outside the bar's box before a seat counts as clear of it.
 *
 * A line grazing the bar's edge is not the failure this is guarding against, and a bar shoved
 * around the board to buy four more pixels of nothing is a bar that has moved for no reason a
 * reader can see. Wide enough to cover a thick stroke's half-width and the chord error between
 * two samples of a bowed curve; narrow enough that it never decides anything by itself.
 */
const TIE_BAR_CLEAR_PX = 4;

/**
 * How many pieces the line is cut into when the bar walks it looking for a seat clear of it.
 *
 * CHORDS, NOT THE CURVE, so this is an accuracy dial and not only a cost one. Thirty-two is well
 * past the point where a quadratic's bulge away from its own chord is smaller than the clearance
 * above, on a board of any size a person reads it at -- and the walk is thirty-two multiply-adds
 * on a frame that must not measure anything, which is about what one style write costs.
 */
const TIE_LINE_SAMPLES = 32;

/** How far the palette hangs below (or above) the bar it drops from. */
const TIE_POP_GAP_PX = 6;

/**
 * The drawn line as a flat run of `left, top` percentages: `[l0, t0, l1, t1, ...]`.
 *
 * FLAT AND TYPED because the only thing that reads it is `place`, which runs on every painted
 * frame of a pan and must not put a run of little objects on the heap sixty times a second. Cut
 * once when the bar takes hold of a line and again when the board is repainted under it, which is
 * where the shape of the line can actually change.
 */
function tieLine(curve) {
	const points = curvePoints(curve, TIE_LINE_SAMPLES);
	if (!points || points.length < 2) return null;
	const flat = new Float64Array(points.length * 2);
	for (let i = 0; i < points.length; i++) {
		flat[i * 2] = points[i].left;
		flat[i * 2 + 1] = points[i].top;
	}
	return flat;
}

/**
 * Whether a segment comes inside a box at all -- Liang-Barsky, asked only for the yes or no.
 *
 * ⚠ NOT "IS EITHER END INSIDE", which is the obvious test and the wrong one: a line crossing the
 * bar clean through has both of its ends well outside it. Nor "is a sample inside", which misses a
 * steep line that steps over a thirty-pixel-high bar between two samples. This clips the segment
 * against the four edges and answers whether anything of it survives, which is exact.
 */
function segmentInBox(ax, ay, bx, by, box) {
	const dx = bx - ax;
	const dy = by - ay;
	let lo = 0;
	let hi = 1;
	// Each edge as `den * t <= num`: entering edges push `lo` up, leaving edges pull `hi` down, and
	// the segment is outside the moment they cross.
	const edges = [-dx, ax - box.left, dx, box.right - ax, -dy, ay - box.top, dy, box.bottom - ay];
	for (let i = 0; i < edges.length; i += 2) {
		const den = edges[i];
		const num = edges[i + 1];
		// Parallel to this edge: inside it for the whole segment, or outside it for the whole segment.
		if (den === 0) { if (num < 0) return false; continue; }
		const t = num / den;
		if (den < 0) { if (t > hi) return false; if (t > lo) lo = t; }
		else { if (t < lo) return false; if (t < hi) hi = t; }
	}
	return true;
}

/** Which way each one-way arrow points, given a line whose second end is to the RIGHT of its first. */
const DIR_ICONS = {
	rightwards: { "a-b": "fa-arrow-right-long", "b-a": "fa-arrow-left-long" },
	leftwards: { "a-b": "fa-arrow-left-long", "b-a": "fa-arrow-right-long" },
};

/**
 * The icon each direction button is BUILT with, keyed by the answer it stands for.
 *
 * Exported because the window prints these buttons from `RELMAP_DIRS` rather than writing four of
 * them out by hand, and the icons are the one thing that table cannot supply. The two one-way ones
 * start out pointing rightwards and are rewritten by `_nameDirs` from where the faces actually are.
 */
export const TIE_DIR_ICONS = Object.freeze({
	none: "fa-minus",
	"a-b": DIR_ICONS.rightwards["a-b"],
	"b-a": DIR_ICONS.rightwards["b-a"],
	both: "fa-arrows-left-right",
});

/**
 * The groups on the bar that are one-of-N ROWS OF PRESSES, in the order a reader meets them.
 *
 * ⚠ THE COLOUR IS ONE OF THEM AGAIN. It was a `select` for a while and had to be kept out of this
 * list by hand -- a chooser brings its own list, its own keyboard and its own tab stop, and being
 * swept into the press wiring by the name it shares would have broken all three. The palette is a
 * row of presses like the other two, in a radiogroup of its own, so it belongs here: everything in
 * this file that walks a group reads this list rather than the attribute.
 */
const TIE_GROUPS = ["dir", "dash", "ink", "size"];

/**
 * THE GROUPS THAT ARE ASKED IN A PANEL RATHER THAN IN A ROW, keyed by the field they answer.
 *
 * ⚠ THE KEY IS THE FIELD NAME AND THAT IS LOAD-BEARING. Everything in here finds a chooser's own
 * buttons with `[data-relmap-tie='<key>']` -- the same attribute the presses on the bar carry and
 * the same string `_press` dispatches on -- so a panel keyed by anything else would be one whose
 * rows the arrow keys, the "which is set" marking and the opening focus all walked straight past.
 *
 * THREE OF THE FIVE QUESTIONS, and for the same reason every time: width. Eight colours as eight
 * discs, then three strokes as three squares, then five sizes beside them, is most of a strip that
 * floats over the very drawing the table is reading, spent on questions nobody is asking most of the
 * time. What stands on the bar is the ANSWER to each -- a disc and a word, a drawn rule, a number --
 * and the choices are laid out underneath only while somebody is choosing. The arrows stay a row of
 * presses because four of them cost what one trigger would and answer in one press instead of two.
 */
const TIE_POPS = ["ink", "dash", "size"];

/**
 * Mark exactly one of a group as chosen -- in the class, in the ARIA, and in the TAB ORDER.
 *
 * ⚠ THE TAB ORDER IS THE THIRD OF THOSE AND IS NOT DECORATION. These are `role="radio"` buttons in
 * a `role="radiogroup"`, and a radio group is ONE tab stop with the arrow keys inside it. Left as
 * ordinary buttons, this bar would put a stop at every one of them between the board and whatever
 * comes after it -- on a floating strip a reader arrives at by clicking a line, which is the worst
 * place in the window to lose somebody. So exactly one button per group is reachable by Tab (the
 * one that is set), and `_groupKey` moves the focus between the rest.
 *
 * ⚠ AND A HIDDEN BUTTON IS NOT IN THE GROUP AT ALL. The palette carries a fixed set of slots for
 * the colours already on the board and shows only as many as there are -- a `hidden` slot given the
 * tab stop is a group with no reachable button in it, which is a radiogroup a keyboard cannot enter.
 *
 * ⚠ `may` IS FOR THE ONE GROUP WHOSE ANSWER HONESTLY MIGHT NOT BE ON THE LIST. Everywhere else, a
 * value that matches no button is a template that has drifted from the store, and the first button
 * taking the mark is a defence against a group nobody can reach. The sizes are different in kind: a
 * reader may type any number in the bounds, and 22 is a perfectly good answer that no step stands
 * for -- so the first step must NOT come up looking pressed, which would say the line is set in ten
 * when it is set in twenty-two. Passed `false`, nothing shows as chosen and the tab stop goes to the
 * first button anyway, because the group still has to be reachable.
 */
function markChosen(buttons, value, { may = true } = {}) {
	// A group whose stored answer is not among its buttons -- which cannot happen from the store,
	// but can from a template that has drifted -- would otherwise have NO tab stop at all and be
	// unreachable. The first button takes it in that case.
	const list = [...buttons].filter(button => !button.hidden);
	const found = list.some(button => button.dataset?.relmapTieValue === value);
	list.forEach((button, index) => {
		const first = index === 0;
		const mine = found ? button.dataset?.relmapTieValue === value : may && first;
		button.classList?.toggle("is-chosen", mine);
		button.setAttribute?.("aria-checked", mine ? "true" : "false");
		button.setAttribute?.("tabindex", mine || (!found && first) ? "0" : "-1");
	});
}

export class RelmapTieBar {
	/**
	 * @param {HTMLElement} root  the window's root element.
	 * @param {object} handlers
	 * @param {Function} handlers.surface   `() => ZoomPanSurface|null` — asked rather than held,
	 *                   because a re-render builds a new one and this bar outlives that.
	 * @param {Function} handlers.tieAt     `id => {edge, from, to, at}|null` — everything about one
	 *                   line as it stands RIGHT NOW: its stored fields, the two people's names, and
	 *                   where on the board (in percentages) the bar should sit. Null when the line
	 *                   is not on this board any more, which closes the bar.
	 * @param {Function} handlers.onField   `(id, fields) => Promise` — write these fields.
	 * @param {Function} handlers.onSaying  `(id, said) => void` — the reader has this much of a
	 *                   caption typed, and the line should show it NOW. Nothing is written: this is
	 *                   the paint that used to happen in a text box on this bar, moved onto the line
	 *                   the words belong to. Handed out rather than done here for the reason
	 *                   `onPicked` is -- the board's markup is the window's, and a second module
	 *                   walking captions is the second copy of a walker that has already drifted
	 *                   once. See `_sayLine` in dialogs/RelationshipMapWindow.js.
	 * @param {Function} handlers.onRub     `id => void` — rub this line off the map.
	 * @param {Function} handlers.onPicked  `id => void` — mark which stroke on the board this bar
	 *                   belongs to, or none for "". The BOARD'S OWN MARKUP IS THE BOARD'S: its
	 *                   strokes, targets and captions are built and replaced by the window, and a bar
	 *                   that walked them for itself would be a second module enumerating the same
	 *                   three element families -- which is how the invisible hit layer came to need
	 *                   adding in two places at once.
	 * @param {Function} handlers.inksInUse `() => string[]` — the colours of their own that this
	 *                   board is already drawn in, as hexes, in the order the palette should offer
	 *                   them. READ OFF THE GRAPH RATHER THAN REMEMBERED PER READER: a table that
	 *                   has settled on a particular purple wants that purple on the next line too,
	 *                   and reading it off the map means every client at the table is offered the
	 *                   same list with nothing stored anywhere to say so. Asked afresh each time
	 *                   the palette opens, because a colour chosen a moment ago is one of them.
	 * @param {Function} handlers.canEdit   `() => boolean` — re-asked per gesture, as everything
	 *                   else on this board is: ownership can change under an open window.
	 * @param {Function} handlers.onNudged  `(chose, used, ratio) => void` — the reader picked a
	 *                   colour too pale to follow on this board and it was deepened to `used`.
	 *                   HANDED OUT RATHER THAN SAID HERE: this is a DOM component with no globals
	 *                   and no i18n in it, and a notification raised from inside it would be one
	 *                   more thing every test of this file has to stub.
	 */
	constructor(root, {
		surface, tieAt, onField, onSaying, onRub, onPicked, onNudged, inksInUse,
		canEdit = () => true,
	} = {}) {
		this.root = root ?? null;
		this._surface = surface ?? (() => null);
		this._tieAt = tieAt ?? (() => null);
		this._onField = onField ?? (() => {});
		this._onSaying = onSaying ?? (() => {});
		this._onRub = onRub ?? (() => {});
		this._onPicked = onPicked ?? (() => {});
		this._onNudged = onNudged ?? (() => {});
		this._inksInUse = inksInUse ?? (() => []);
		this._canEdit = canEdit;

		this.el = root?.querySelector?.(".stonetop-relmap-tiebar") ?? null;
		this.words = this.el?.querySelector?.("[data-relmap-tie='words']") ?? null;
		/** The answer as it stands, and the press that drops the palette: one disc and one word. */
		this.inkOpen = this.el?.querySelector?.("[data-relmap-tie='inkopen']") ?? null;
		this.inkMark = this.el?.querySelector?.("[data-relmap-tie-mark='ink']") ?? null;
		this.inkWord = this.el?.querySelector?.("[data-relmap-tie-name='ink']") ?? null;
		/** The palette, and the block in it holding the colours already on this board. */
		this.pop = this.el?.querySelector?.("[data-relmap-tie-pop='ink']") ?? null;
		this.inkMine = this.el?.querySelector?.("[data-relmap-tie-mine='ink']") ?? null;
		/**
		 * The stroke: the same three parts as the colour, minus the word.
		 *
		 * ⚠ THE TRIGGER'S SAMPLE IS THE ANSWER AND CARRIES NO NAME BESIDE IT, which is the one way
		 * this chooser differs from the palette above. A colour cannot be read by somebody who
		 * cannot resolve it, so its trigger prints "Rose" beside its disc; a stroke IS a shape, and
		 * the shape here is the one the line is actually drawn with. The words are still said -- on
		 * the trigger's spoken label and tooltip, which `_markDash` rewrites on every pick, and
		 * beside every rule in the panel -- because an 18px sample is small.
		 */
		this.dashOpen = this.el?.querySelector?.("[data-relmap-tie='dashopen']") ?? null;
		this.dashMark = this.el?.querySelector?.("[data-relmap-tie-mark='dash']") ?? null;
		this.dashPop = this.el?.querySelector?.("[data-relmap-tie-pop='dash']") ?? null;
		/**
		 * How big the writing is: the same three parts again, and the answer is a NUMBER.
		 *
		 * ⚠ WHY NOT A WORD, WHEN THE COLOUR SHOWS ONE. Five of the sizes have names and any other
		 * size a reader types has none at all, so a trigger that showed the name would be blank on
		 * exactly the answers somebody chose for themselves. The number is always true, always
		 * short, and is the same thing the field in the panel takes. The NAME is still said, on the
		 * trigger's spoken label and its tooltip, which `_markSize` rewrites on every pick.
		 */
		this.sizeOpen = this.el?.querySelector?.("[data-relmap-tie='sizeopen']") ?? null;
		this.sizeMark = this.el?.querySelector?.("[data-relmap-tie-mark='size']") ?? null;
		this.sizePop = this.el?.querySelector?.("[data-relmap-tie-pop='size']") ?? null;
		/** The field for a size nobody offered, at the foot of that panel. */
		this.sizeNum = this.el?.querySelector?.("[data-relmap-tie='sizenum']") ?? null;
		/** Foundry's colour picker, inside the palette and shown only when the `+` is pressed. */
		this.inkHex = this.el?.querySelector?.("[data-relmap-tie='inkhex']") ?? null;
		// The viewport this bar is clamped into, found ONCE. `place()` runs on every painted frame of
		// a pan, and a lookup per frame is a lookup per frame for an element that cannot change: this
		// bar is thrown away and rebuilt with the root it was given.
		this._view = root?.querySelector?.(".stonetop-relmap-view") ?? null;

		/** Which line is open, or "" for none. */
		this.id = "";
		/**
		 * Where on the board (in percentages) that line's middle is.
		 *
		 * ⚠ REMEMBERED RATHER THAN ASKED FOR IN `place()`, which is the difference between a pan
		 * that costs one style write per frame and one that rebuilds the board's whole geometry
		 * sixty times a second. Nothing can move it without a repaint, and a repaint calls
		 * `refresh`, which is where it is written.
		 */
		this._at = null;
		/**
		 * The whole of that line, in the same percentages, as `[left, top, left, top, ...]`.
		 *
		 * ⚠ THE MIDDLE IS NOT THE LINE, which is the entire reason this is here beside `_at`. A
		 * near-vertical link has its top half directly above its own middle, so a bar seated "above
		 * the middle" -- which is all a single point can ask for -- lands squarely across the stroke
		 * it is editing. `place` walks these to find a seat the line does not pass through.
		 *
		 * Cut where `_at` is written and thrown away where it is, and null for a caller that offers no
		 * curve: without one the bar seats itself exactly as it always did, off the middle alone.
		 */
		this._line = null;
		/**
		 * The bar's own box, measured once per opening rather than once per frame.
		 *
		 * Its width is a fixed field and a fixed row of presses, so nothing but its CONTENTS changing
		 * can move it -- and the two places that change them (`open` and `refresh`) throw this away.
		 */
		this._box = null;
		/**
		 * Which side of its line the bar is sitting on: false above it, true underneath.
		 *
		 * Written by `place()` and read by `_placePop()`, which hangs whichever panel is open on the
		 * side AWAY from the line, for the same reason the bar itself keeps off it.
		 */
		this._under = false;
		/** What the caption said when the field was last in step with the document. */
		this._saved = "";
		/**
		 * The pending write for each row of TIE_DEFERRED: 0 when nothing is waiting.
		 *
		 * One object rather than a field apiece so that `isWriting` and `destroy` can ask about all
		 * of them at once, and so that neither can be left behind when a fourth is added.
		 */
		this._timers = { words: 0, ink: 0, size: 0 };
		/**
		 * A colour the reader has chosen that the document does not have yet.
		 *
		 * Held rather than written straight through for the reason TIE_INK_DELAY_MS gives, and it is
		 * REMEMBERED rather than merely armed: a repaint arriving in the gap would otherwise paint
		 * the bar from the document and put the reader's own choice back to what it was.
		 */
		this._inkPending = "";
		/**
		 * ⚠ WHETHER THIS BAR IS THE ONE WRITING TO THE PICKER RIGHT NOW.
		 *
		 * `HTMLColorPickerElement` dispatches `change` from its own `value` setter, so painting the
		 * picker from the document -- which `_markInk` does on every open and every repaint -- looks
		 * exactly like the reader having chosen that colour. Without this flag, opening a line would
		 * write its own colour back to it, and a repaint arriving mid-pick would fight the reader
		 * for the field. Set around the assignment and read by the handler; nothing else touches it.
		 */
		this._paintingInk = false;
		/**
		 * A size the reader has typed that the document does not have yet.
		 *
		 * ⚠ ONLY THE TYPED ONE. The five steps in the panel are one press each and are written
		 * straight through, exactly as the strokes are; what waits here is the number FIELD beside
		 * them, where "18" is typed as a 1 and then an 8. Written per keystroke, the 1 would be held
		 * to the floor and every board at the table would repaint showing a caption at eight pixels
		 * on the way to eighteen. See TIE_SIZE_DELAY_MS.
		 *
		 * REMEMBERED rather than merely armed, for the reason `_inkPending` is: a repaint arriving in
		 * the gap would paint the bar from the document and put the number back under their hands.
		 */
		this._sizePending = null;
		/** The size the bar is showing, as the store would keep it. Written by `_markSize` and read
		 * only by the field's blur, which is the one moment there is a box to put right. */
		this._sizeSaid = 0;
		/** Where the focus goes when the bar is dismissed with Escape. */
		this._returnTo = null;
		this._bound = [];

		this._wire();
	}

	/** Whether a line is open. */
	get isOpen() { return !!this.id && !!this.el && !this.el.hidden; }

	/**
	 * Is there anything the reader has settled that the document does not have yet?
	 *
	 * THE CAPTION, THE COLOUR AND A TYPED SIZE: all three are held back briefly before they are
	 * written, and a repaint arriving in any of those gaps would paint over the answer under the
	 * reader's hand.
	 *
	 * ⚠ THE WINDOW'S REPAINT ASKS THIS, and it is the affirmative guard the old `_isBusy` note said
	 * to add if a text field ever landed on this window. A repaint does not touch this bar -- it is
	 * outside the board -- but it DOES rebuild the lines underneath, and the write that follows
	 * would then land on a caption the reader had gone on typing into. Asked about unsaved WRITING
	 * rather than about focus: a field somebody is merely resting in obstructs nothing.
	 */
	isWriting() {
		return this.isOpen && Object.values(this._timers).some(Boolean);
	}

	// ── Wiring ──────────────────────────────────────────────────────────────

	_on(el, type, handler, opts) {
		if (!el?.addEventListener) return;
		el.addEventListener(type, handler, opts);
		this._bound.push([el, type, handler, opts]);
	}

	_wire() {
		if (!this.el) return;

		for (const button of this.el.querySelectorAll("[data-relmap-tie]")) {
			const what = button.dataset.relmapTie;
			// The two fields and the picker are not presses and must not be given a press's handler:
			// a click on any of them is the browser putting a caret in it or opening it, and a
			// `preventDefault` here would be a control that never opens. The size field is one of
			// them -- a `preventDefault` on its spinner arrows is a stepper that cannot step.
			if (what === "words" || what === "inkhex" || what === "sizenum") continue;
			this._on(button, "click", ev => {
				ev.preventDefault();
				ev.stopPropagation();
				// ⚠ READ AT THE MOMENT OF THE PRESS, not closed over at wiring time. A slot in the
				// palette is a colour that changes: the same button stands for whichever hex the
				// board happens to be drawn in when it opens.
				this._press(what, button.dataset.relmapTieValue ?? "");
			});
		}

		// ⚠ ANYTHING ELSE ON THE BAR PUTS THE OPEN PANEL AWAY. Either of them hangs over the presses
		// below it, so a reader who has opened one and then reached past it for another control has
		// said they are done choosing -- and a panel that stayed up covering the thing they were
		// aiming at would be one they had to dismiss before they could use the bar at all. Its own
		// presses come through `_press` and are excluded by the branch below.
		//
		// ⚠ EACH PANEL SPARES ITS OWN TRIGGER, which is what lets a second press on it CLOSE the
		// thing. This handler runs before the click that toggles; a close that did not skip the
		// trigger under the pointer would shut the panel here and let the click open it straight
		// back, so the press a reader means as "never mind" would do nothing at all.
		this._on(this.el, "pointerdown", ev => {
			for (const which of TIE_POPS) {
				if (!this._popOpen(which)) continue;
				const { open, pop } = this._popParts(which);
				if (pop?.contains?.(ev.target) || open?.contains?.(ev.target)) continue;
				this._closePop(which);
			}
		});

		if (this.inkHex) {
			// ⚠ THE ELEMENT'S OWN `change`, NOT ITS TWO INPUTS'. `HTMLColorPickerElement` stops the
			// events its hex field and its swatch fire and dispatches one of its own from the value
			// setter, which is the only one that has been through its own normalising.
			this._on(this.inkHex, "change", ev => {
				// Painting is not choosing: see `_paintingInk`. Stopped as well as ignored, because
				// this event bubbles and the window has its own `change` handlers on the bar above.
				ev.stopPropagation();
				if (this._paintingInk) return;
				this._pickCustomInk(this.inkHex.value ?? "");
			});
		}

		if (this.words) {
			// EVERY keystroke arms the timer; nothing writes until it runs out. See TIE_WRITE_DELAY_MS.
			//
			// ⚠ AND EVERY KEYSTROKE IS PAINTED AT ONCE, which is a different thing from the write and
			// has to stay one. The field is clipped off the bar, so the LINE is where the reader sees
			// what they are typing -- and if that waited on TIE_WRITE_DELAY_MS the board would lag
			// half a second behind their hands and everybody else at the table would be repainted
			// per keystroke. `_say` touches one caption in this reader's own window and writes
			// nothing.
			this._on(this.words, "input", () => { this._defer("words"); this._say(); });
			// A field that loses the focus has finished being typed into, whatever the timer thinks.
			this._on(this.words, "blur", () => this.flush());
		}

		if (this.sizeNum) {
			// EVERY keystroke and every press of the spinner arms the timer; nothing is written
			// until it runs out. See TIE_SIZE_DELAY_MS, which is the whole of why this is not
			// written straight through like the five steps above it.
			//
			// ⚠ AND THE BAR IS NOT PAINTED FROM IT AS IT IS TYPED. What `_markSize` would do is
			// take the answer this reader is halfway through and hold it to the bounds -- so a 1 on
			// the way to 18 would put an 8 in the field they are typing into, and the next digit
			// would land after it. The trigger's number follows the WRITE, when the repaint comes
			// back with a size the document actually has.
			this._on(this.sizeNum, "input", () => this._armSize());
			// A field that has lost the focus has finished being typed into, whatever the timer says.
			//
			// ⚠ AND IT IS PAINTED AGAIN ON THE WAY OUT, which is the one place the field can be left
			// disagreeing with the line. A number is held to the bounds when it is written, and the
			// paint that follows deliberately leaves the box alone while somebody is standing in it
			// -- so a reader who typed 500, waited, and then clicked away would leave a box saying
			// 500 over a line drawn at 48. `_sizeSaid` is what the bar settled on; here, with the
			// focus gone, the box can be told.
			this._on(this.sizeNum, "blur", () => {
				this.flush();
				this._markSize(this._sizeSaid);
			});
			// ⚠ AND ITS `change` IS STOPPED. This bubbles, and the window carries `change` handlers
			// of its own on the chrome around this bar; a number field firing one on every blur is
			// an event they have no business seeing.
			this._on(this.sizeNum, "change", ev => ev.stopPropagation());
		}

		// ⚠ CLAIMED ON THE BAR ITSELF, and stopped rather than merely defaulted. Core's
		// KeyboardManager binds keydown in the BUBBLE phase and never looks at `defaultPrevented`,
		// so an Escape meant to dismiss this bar closes the whole window as well, and the arrow keys
		// inside the caption field pan the scene behind it. The board's own keydown handler
		// (utils/relmap-drag.js) has the same note for the same reason.
		this._on(this.el, "keydown", ev => this._key(ev));
	}

	_key(ev) {
		if (this._groupKey(ev)) return;
		if (ev.key === "Escape") {
			ev.preventDefault();
			ev.stopPropagation();
			// ⚠ ONE ESCAPE PUTS AWAY ONE THING. With a panel open, the thing the reader means is
			// that panel -- and one that dismissed the whole bar would throw away the caption they
			// were half way through as well, for a press that meant "not that colour after all".
			// The focus goes back to the trigger, which is where they opened it from. Only one of
			// the two can be open (`_openPop` sees to that), so closing them all closes theirs.
			if (this._popOpen()) { this._closePop("", { back: true }); return; }
			// The writing goes back to what the document has: Escape is the way OUT of a sentence
			// somebody has thought better of, and one that saved it would leave no way out at all.
			this._forgetWriting();
			// `dismiss` and not `close`: a reader who opened this from the keyboard has to be put
			// back on the caption they pressed Enter on, rather than at the top of the window.
			this.dismiss();
			return;
		}
		// ENTER SAVES WHAT IS IN A FIELD, whichever of the two the reader is standing in. On the
		// size field it is the way to see a typed number NOW rather than waiting out the timer,
		// which is what a reader who has typed one and stopped is expecting.
		if (ev.key === "Enter" && (ev.target === this.words || ev.target === this.sizeNum)) {
			ev.preventDefault();
			ev.stopPropagation();
			this.flush();
			return;
		}
		// A LETTER TYPED FROM ANYWHERE ON THE BAR GOES ON THE LINE. See `_typeInto`.
		if (this._typeInto(ev)) return;
		// Everything else the field takes is the field's own business, and none of it is the
		// scene's. Only the arrows and Delete would otherwise reach the canvas, but a list of keys
		// to stop is a list to keep in step with core; the field simply keeps what it is given.
		if (ev.target === this.words) ev.stopPropagation();
		// The picker's hex field is a text field like the caption, and its keys are its own.
		else if (this.inkHex?.contains?.(ev.target)) ev.stopPropagation();
		// ⚠ AND SO ARE THE SIZE FIELD'S, WHICH INCLUDES ITS UP AND DOWN. Those are how a number
		// field is stepped, and they are also what `_groupKey` moves the focus with and what core
		// pans the scene behind this window with. `_groupKey` has already let them past -- the
		// field is not a press and carries no `data-relmap-tie` value -- so all that is left is to
		// stop them here, or the reader nudging a size up would pan the map underneath it.
		else if (ev.target === this.sizeNum) ev.stopPropagation();
	}

	/**
	 * A letter typed while the focus is on one of the presses, handed back to the writing field.
	 *
	 * ⚠ WHY THIS EXISTS AT ALL. The field is clipped off the bar, so there is nothing on screen to
	 * tell a reader where their typing is going -- and a click on any press moves the focus onto
	 * that press. Without this, choosing a colour and then carrying on with the sentence would type
	 * into a button: nothing on the line, nothing in the box they cannot see, no clue why. The bar's
	 * promise is that typing writes on the line, and it has to hold from wherever they are standing.
	 *
	 * ⚠ NEVER SPACE, and that is the one deliberate hole in the promise. These are `role="radio"`
	 * buttons and Space is how a keyboard reader presses one; a space that ran off to the caption
	 * instead would take the palette, the arrows and the strokes away from them entirely. A space is
	 * also the one character a reader can always get by aiming at the line again, which none of the
	 * other keys on this bar can be said about.
	 *
	 * The character is inserted here rather than left to the browser: focusing mid-keydown and
	 * hoping the text lands in the newly focused field is true of Chromium and not a promise.
	 *
	 * @returns {boolean} whether the key was taken.
	 */
	_typeInto(ev) {
		const field = this.words;
		if (!field || field.disabled || !this._canEdit()) return false;
		// ⚠ EVERY FIELD ON THIS BAR IS EXEMPT, AND THE SIZE ONE MOST OF ALL. What a reader types
		// there is digits, and digits are exactly what this would carry off to the caption: they
		// would land on the line, the number they meant would never reach the field they were
		// looking at, and the only clue would be a sentence growing "18" on the end of it.
		if (ev.target === field || ev.target === this.sizeNum) return false;
		if (this.inkHex?.contains?.(ev.target)) return false;
		// A modified key is a shortcut, not a letter -- Ctrl+Z is the board's undo. AltGraph is
		// left out on purpose: it is how a great many keyboards type a character at all.
		if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
		const back = ev.key === "Backspace";
		if (!back && (ev.key?.length !== 1 || ev.key === " ")) return false;
		ev.preventDefault();
		ev.stopPropagation();
		field.focus?.();
		const said = field.value ?? "";
		// The field's own cap, said again: `maxlength` binds what a reader TYPES and not what is
		// assigned, so a sentence grown past it here would paint on the line and then be cut short
		// by the store on the way to the document.
		const cap = Number(field.maxLength) > 0 ? Number(field.maxLength) : Infinity;
		field.value = back ? said.slice(0, -1) : `${said}${ev.key}`.slice(0, cap);
		// The caret goes to the end, which is where the next letter belongs: this is the reader
		// carrying on with a sentence, not returning to a spot in the middle of one.
		const end = field.value.length;
		field.setSelectionRange?.(end, end);
		this._defer("words");
		this._say();
		return true;
	}

	/**
	 * The arrow keys inside one group of presses.
	 *
	 * ⚠ FOCUS MOVES AND THE ANSWER DOES NOT, which is the one place this departs from what a plain
	 * radio group does. Every one of these presses WRITES TO A SHARED DOCUMENT the moment it is
	 * made, so "selection follows focus" would mean arrowing across a group wrote every answer on
	 * the way past onto everybody's board. The reader chooses with Space or Enter, which is what
	 * the button does for itself. (ARIA allows exactly this for a group whose selection has side
	 * effects, and it is why these are buttons rather than inputs.) The palette is a group like the
	 * other two now and gets this for nothing; when it was a `select` it could not be asked for it
	 * at all, which is where TIE_INK_DELAY_MS came from.
	 *
	 * ⚠ UP AND DOWN STEP BY A ROW IN THE PALETTE, and by one everywhere else. The colours are a GRID
	 * -- fifty-odd of them, eight across -- and a Down that moved to the next swatch would mean up to
	 * fifty presses to cross a panel a reader can see the whole of, which is the version of this
	 * control a keyboard reader would simply stop using. The two rows of presses beside it are single
	 * rows, where a row's stride and one are the same thing.
	 *
	 * ⚠ AND IT IS ONE STRIDE FOR THE WHOLE GROUP, which is only right because every block in the
	 * palette is laid out at the same width -- the eight, the forty and the row of the board's own
	 * colours. See `RELMAP_INK_ACROSS`, which the render prints onto the palette for this to read;
	 * a block at some other width would have to carry its own, and Down would walk diagonally out of
	 * it until it did.
	 *
	 * @returns {boolean} whether the key was this group's.
	 */
	_groupKey(ev) {
		const way = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[ev.key];
		if (!way) return false;
		const button = ev.target?.closest?.("[data-relmap-tie]");
		const what = button?.dataset?.relmapTie;
		if (!TIE_GROUPS.includes(what)) return false;
		ev.preventDefault();
		// Stopped whatever comes of it: an arrow that reached core's KeyboardManager would pan the
		// scene behind this window, which is the note every keydown handler on this board carries.
		ev.stopPropagation();
		// A hidden slot is not in the group: see `markChosen`. Arrowing onto one would move the
		// focus to something nobody can see, which reads as the arrow keys having stopped working.
		const list = [...(this.el?.querySelectorAll?.(`[data-relmap-tie='${what}']`) ?? [])]
			.filter(one => !one.hidden);
		const at = list.indexOf(button);
		if (at < 0 || !list.length) return true;
		const upDown = ev.key === "ArrowUp" || ev.key === "ArrowDown";
		const step = way * (upDown ? this._across(button) : 1);
		// Wrapping, as a radio group does: a short row of presses is exactly the case where running
		// off the end and stopping feels like the control has jammed. A row's stride wraps the same
		// way, which lands a reader stepping down off the last row back near the top of the palette.
		const next = list[((at + step) % list.length + list.length) % list.length];
		// The focus has to be able to LAND, and only the set button carries a tab stop.
		next?.setAttribute?.("tabindex", "0");
		button?.setAttribute?.("tabindex", "-1");
		next?.focus?.();
		return true;
	}

	_press(what, value) {
		if (!this.id || !this._canEdit()) return;
		if (what === "rub") {
			const id = this.id;
			// ⚠ NOTHING IS WRITTEN ON THE WAY OUT, which is the opposite of what every other exit
			// from this bar does. A caption half-typed onto a line that is about to be rubbed out
			// would be a second change recorded a moment before the first, so taking the rub back
			// would restore the line and then need a second press to restore its words -- and the
			// reader pressed one button. `close` flushes, so the pending write is dropped BEFORE it
			// is called rather than left for it to find -- both of them: a colour chosen a moment
			// ago is the same second change recorded against a line that is going away.
			this._forgetWriting();
			this._forgetInk();
			this._forgetSize();
			this.close();
			this._onRub(id);
			return;
		}
		const own = TIE_PRESSES[what];
		if (own) { own(this, value); return; }
		if (!TIE_GROUPS.includes(what)) return;
		// Painted before the write rather than after it. The write is a round trip through the
		// document and comes back as a repaint; a bar that waited for it would sit there looking
		// unpressed for as long as that took, on the one control a reader presses repeatedly.
		this._markGroup(what, value);
		this._onField(this.id, { [what]: value });
	}

	// ── Opening and closing ─────────────────────────────────────────────────

	/**
	 * Take hold of one line.
	 *
	 * @param {string} id  the link.
	 * @param {object} [opts]
	 * @param {HTMLElement} [opts.returnTo]  where the focus goes if this is dismissed with Escape:
	 *        the caption or the stroke the reader came from. A keyboard reader who pressed Enter on
	 *        a caption and then thought better of it must not be dropped at the top of the window.
	 */
	open(id, { returnTo = null } = {}) {
		if (!this.el || !id) return false;
		const tie = this._tieAt(id);
		if (!tie) return false;
		// A DIFFERENT LINE, so whatever was being typed into the last one is written before the
		// field is refilled. Without this, clicking straight from one line to another throws the
		// sentence away silently.
		if (this.id && this.id !== id) this.flush();
		this.id = id;
		this._returnTo = returnTo ?? null;
		this._at = tie.at ?? null;
		this._line = tieLine(tie.curve);
		this._box = null;
		this._fill(tie);
		this.el.hidden = false;
		this._onPicked(id);
		this.place();
		// After `place`, so the browser does not scroll the field into view at its old position.
		this._focusWords();
		return true;
	}

	/** Let go, writing anything outstanding. */
	close() {
		if (!this.el) return;
		// ⚠ NOTHING HELD, NOTHING TO PUT DOWN. Every click that lands on bare board comes through
		// here, and there is no mark to take off a board this bar was never opened over.
		if (!this.id) { this.el.hidden = true; return; }
		this.flush();
		this._closePop();
		this.id = "";
		this._returnTo = null;
		this._at = null;
		this._line = null;
		this._box = null;
		this.el.hidden = true;
		this._onPicked("");
	}

	/** Let go and put the focus back where the reader came from. */
	dismiss() {
		const back = this._returnTo;
		this.close();
		back?.focus?.();
	}

	_focusWords() {
		const field = this.words;
		if (!field?.focus) return;
		field.focus();
		// THE CARET GOES TO THE END and nothing is selected, which is the whole of "click a line and
		// start typing": the next letter is added to what the line already says. Selecting the text
		// would make the first keystroke DELETE the caption, which is the opposite promise.
		const end = field.value?.length ?? 0;
		field.setSelectionRange?.(end, end);
	}

	// ── Painting ────────────────────────────────────────────────────────────

	_fill(tie) {
		const edge = tie.edge ?? {};
		if (this.words) {
			this.words.value = edge.label ?? "";
			this._saved = this.words.value;
			this.words.disabled = !this._canEdit();
		}
		// ⚠ THE COLOUR CONTROLS ARE DISABLED AND NOT MERELY IGNORED. A press that does nothing is a
		// press a reader can still make; a palette left live to a reader who may only look would
		// open, take a press and silently change nothing, which reads as a broken control rather
		// than a locked map. The trigger is the one that matters -- disabled, it never opens -- and
		// the rest are said as well so that a palette already open when ownership changes goes inert
		// rather than half-inert.
		const may = this._canEdit();
		if (this.inkOpen) this.inkOpen.disabled = !may;
		if (this.dashOpen) this.dashOpen.disabled = !may;
		if (this.sizeOpen) this.sizeOpen.disabled = !may;
		if (this.inkHex) this.inkHex.disabled = !may;
		if (this.sizeNum) this.sizeNum.disabled = !may;
		for (const which of TIE_POPS) {
			for (const one of this.el?.querySelectorAll?.(`[data-relmap-tie='${which}']`) ?? []) {
				one.disabled = !may;
			}
		}
		const add = this.el?.querySelector?.("[data-relmap-tie='inkmore']");
		if (add) add.disabled = !may;
		// A DIFFERENT LINE IS A DIFFERENT QUESTION. A panel left standing from the last one would be
		// open over an answer it is no longer showing.
		this._closePop();
		this._disarm("words");
		this._forgetInk();
		this._forgetSize();
		this._paintTie(tie);
	}

	/**
	 * Everything on the bar that says what this line IS: which swatch, which arrow, which stroke.
	 *
	 * In one place because opening and refreshing both do exactly this and differ only over the
	 * caption -- and a fifth group added to one of two copies is wrong only AFTER a live update,
	 * which is the failure nobody would find.
	 */
	_paintTie(tie) {
		const edge = tie.edge ?? {};
		// A colour the reader has just chosen wins over the one the document still has. Painting the
		// document's here is how a repaint arriving inside TIE_INK_DELAY_MS would undo the choice
		// under their hand -- see `_inkPending`.
		this._markInk(this._inkPending || edge.ink || RELMAP_INK_DEFAULT);
		this._markGroup("dir", edge.dir || RELMAP_DIR_DEFAULT);
		this._markDash(edge.dash || RELMAP_DASH_DEFAULT);
		// ⚠ AND A TYPED SIZE WINS OVER THE DOCUMENT'S, for the reason a chosen colour does: this
		// runs on every repaint of every board at the table, and a size the reader is halfway
		// through typing would be replaced by the stored one under their hands.
		this._markSize(this._sizePending ?? edge.size);
		this._nameDirs(tie);
	}

	/**
	 * Say what each arrow button means, in the two people's own names, and point it the right way.
	 *
	 * ⚠ NEITHER THE WORDS NOR THE ICONS CAN BE WRITTEN IN THE TEMPLATE. Which of the pair is drawn
	 * on the left is a fact about where two portraits happen to be sitting, and it changes the
	 * moment either is dragged: a fixed left arrow would mean "towards Sonya" on one board and
	 * "towards Mike" on the same board a minute later. So both are written from where the faces
	 * actually are, every time the bar opens.
	 */
	_nameDirs(tie) {
		const dirs = this.el?.querySelectorAll?.("[data-relmap-tie='dir']") ?? [];
		// The second end drawn to the RIGHT of the first, or level with it, reads left-to-right.
		const rightwards = (tie.to?.x ?? 0) >= (tie.from?.x ?? 0);
		const icons = rightwards ? DIR_ICONS.rightwards : DIR_ICONS.leftwards;
		// Keyed by the answer each button stands for, the same four `RELMAP_DIRS` holds and the same
		// four the buttons carry: a second vocabulary re-keyed on arrival is two names for one enum.
		const said = tie.said ?? {};
		for (const button of dirs) {
			const key = button.dataset.relmapTieValue;
			const words = said[key] ?? "";
			if (words) {
				button.setAttribute("data-tooltip", words);
				button.setAttribute("aria-label", words);
			}
			const glyph = icons[key];
			const icon = button.querySelector?.("i");
			if (glyph && icon) icon.className = `fas ${glyph}`;
		}
	}

	/** Which button in one group is pressed. `may` says whether an answer none of them stands for
	 * should fall back to the first -- see `markChosen`, and the size group, which is the one place
	 * it must not. */
	_markGroup(what, value, { may = true } = {}) {
		markChosen(this.el?.querySelectorAll?.(`[data-relmap-tie='${what}']`) ?? [], value, { may });
	}

	/**
	 * Everything that says which colour this line is drawn in: the disc, the word, the set swatch.
	 *
	 * FOUR THINGS AT ONCE AND ONE METHOD, because they are one fact -- the disc on the bar, the
	 * WORD beside it, whichever swatch in the palette shows as set, and the picker's own value
	 * where the colour is one nobody named. Written in four places they are four places for the
	 * answer to drift apart, and the one that drifts silently is the word, which is the half a
	 * reader who cannot resolve two of the eight is actually reading.
	 *
	 * THE DISC CARRIES THE INK AS A CLASS rather than as an inline colour, because what
	 * `.stonetop-relmap-ink--<key>` resolves to is the stylesheet's business: it is one colour under
	 * the ordinary skin and a darker one under the high-contrast skin, and an inline value written
	 * from here would be the one thing on the board that did not change with it.
	 */
	_markInk(value) {
		// HOW AN INK IS DRAWN IS `inkPaint`'S ANSWER, here as on the board. The disc on this bar is a
		// third element family wearing a line's colour, and one that worked the class and the hex out
		// for itself is a disc that would go on showing the old rule the day the rule changed.
		const { inkKey: shown, inkHex: hex } = inkPaint(value);

		// ⚠ THE SLOTS FIRST, because the answer may BE one of them. `_paintCustoms` is what puts the
		// colour this line is wearing into a slot of its own, and `markChosen` can only set a swatch
		// that is there -- so a palette painted after the mark would show nothing set at all on
		// exactly the lines drawn in a colour of somebody's own.
		this._paintCustoms(hex);
		this._markGroup("ink", value);

		const mark = this.inkMark;
		if (mark) {
			// Every one of the eight taken off rather than whichever was last put on, because the
			// FIRST paint has to take off the one the template printed -- and two of these classes
			// at once is not a disc in two colours, it is a disc in whichever the stylesheet
			// declares last.
			for (const key of RELMAP_INKS) mark.classList?.remove(`stonetop-relmap-ink--${key}`);
			mark.classList?.remove(`stonetop-relmap-ink--${RELMAP_INK_CUSTOM}`);
			mark.classList?.add(`stonetop-relmap-ink--${shown}`);
			this._wearInk(mark, hex);
		}

		// ⚠ THE WORD, AND WHERE IT COMES FROM. There is no i18n in this module, so the name of a
		// colour is read off the palette swatch that stands for it -- the render put it there, on the
		// eight and on all forty of the presets alike. A colour that is in neither is one somebody
		// typed, and has no name but the hex: honest, and the thing they typed.
		const named = this._nameOf("ink", value) || hex;
		if (this.inkWord) this.inkWord.textContent = named;
		this._nameTrigger(this.inkOpen, named);

		// ⚠ THE PICKER OPENS FOR A COLOUR NOBODY OFFERED, AND NOT FOR A PRESET. It used to open for
		// any hex at all, which was right when the picker was the only way to reach one; now that
		// forty of them are a press away, that would mean the hex field springing open behind most
		// picks and the palette growing a row taller for nothing. A colour the reader actually typed
		// still comes back with the picker showing it, which is where they left it.
		this._showPicker(!!hex && !this._isPreset(hex), hex);
	}

	/**
	 * Everything that says which STROKE this line is drawn with: the sample on the bar, the row in
	 * the panel that shows as set, and what the trigger is called.
	 *
	 * One method for the same reason `_markInk` is one: they are one fact said in three places, and
	 * the one that drifts silently is the spoken name -- which is the half a reader who cannot make
	 * out an 18px rule is actually going by.
	 *
	 * ⚠ THE SAMPLE CARRIES THE STROKE AS A CLASS, never a dash pattern written from here. What
	 * `--dotted` and `--dashed` resolve to is the stylesheet's business, and it is retuned there
	 * under the high-contrast skin -- the same reason the disc beside it wears an ink's class rather
	 * than its colour.
	 */
	_markDash(value) {
		const key = RELMAP_DASHES.includes(value) ? value : RELMAP_DASH_DEFAULT;
		this._markGroup("dash", key);

		const mark = this.dashMark;
		if (mark) {
			// Every one taken off rather than whichever was last put on, because the FIRST paint has
			// to take off the one the template printed -- and two of these at once is not a stroke
			// drawn two ways, it is whichever the stylesheet happens to declare last.
			for (const one of RELMAP_DASHES) mark.classList?.remove(`stonetop-relmap-tiebar-rule--${one}`);
			mark.classList?.add(`stonetop-relmap-tiebar-rule--${key}`);
		}

		// The name comes off the panel row that stands for this stroke -- there is no i18n in this
		// module -- and goes on the trigger, which shows only a drawn sample and would otherwise be
		// a control with no name at all to anybody not looking at it.
		this._nameTrigger(this.dashOpen, this._nameOf("dash", key));
	}

	/**
	 * Everything that says how big the writing on this line is: the number on the bar, the step in
	 * the panel that shows as set, the field beside them, and what the trigger is called.
	 *
	 * One method for the reason `_markInk` and `_markDash` are one each: they are one fact said in
	 * four places, and the one that drifts silently is the spoken name.
	 *
	 * ⚠ NOTHING STORED IS THE ORDINARY SIZE. `readSize` gives back zero for a line with no size of
	 * its own, which is nearly every line ever drawn -- and what has to be SHOWN for that is the
	 * number the sheet actually sets it in, because the reader is being told what they are looking
	 * at. So the display resolves zero to `RELMAP_CAPTION_PX` while the store goes on holding
	 * nothing, and pressing the step that reads "Normal" writes nothing back.
	 *
	 * ⚠ AND THE FIELD IS LEFT ALONE WHILE SOMEBODY IS STANDING IN IT. This runs on every repaint of
	 * every board at the table; rewriting the value under a caret would move it to the end mid-number
	 * and, on a half-typed "1", would hold it to the floor and put an 8 in front of the reader.
	 */
	_markSize(value) {
		const stored = readSize(value);
		const px = stored || RELMAP_CAPTION_PX;
		// ⚠ WHAT THE BAR IS SAYING RIGHT NOW, kept for the one moment the field cannot be painted
		// from: a number held to the bounds while the reader is still standing in the box. See the
		// blur handler in `_wire`.
		this._sizeSaid = stored;
		// The rows carry their sizes as the numbers the render printed, so the comparison is made in
		// the same currency: `markChosen` matches on the attribute's own text. `may: false` because
		// a number the reader typed is a real answer that no step stands for, and the first step
		// coming up pressed would say the line is set in ten when it is set in twenty-two.
		this._markGroup("size", String(px), { may: false });

		if (this.sizeMark) this.sizeMark.textContent = String(px);

		const field = this.sizeNum;
		if (field && field.ownerDocument?.activeElement !== field) {
			// A step chosen from the list is shown in the field as well, so the two halves of the
			// panel never disagree about the answer -- and so a reader who then wants 19 starts
			// from the 18 they just pressed rather than from an empty box.
			const said = String(px);
			if (field.value !== said) field.value = said;
		}

		// The name comes off the panel row that stands for this step -- there is no i18n in this
		// module -- and a size nobody offered has no name but its number, which is the honest thing
		// to say and is what the reader typed.
		this._nameTrigger(this.sizeOpen, this._nameOf("size", String(px)) || String(px));
	}

	/**
	 * What one answer is called, read off the button the render named it on.
	 *
	 * ⚠ IT TAKES A HEX AS READILY AS ONE OF THE EIGHT, and the order of the palette is what makes
	 * that safe: the preset grid is printed BEFORE the row of colours already on the board, and only
	 * the presets carry a name -- so a hex that is both finds the named one first, and a hex that is
	 * only on the board finds an unnamed slot and comes back "".
	 */
	_nameOf(what, key) {
		if (!key) return "";
		const one = this.el?.querySelector?.(
			`[data-relmap-tie='${what}'][data-relmap-tie-value='${key}']`,
		);
		return one?.dataset?.relmapName ?? "";
	}

	/**
	 * Whether a colour is one the palette already offers.
	 *
	 * ⚠ ASKED OF THE TABLE, NOT OF THE MARKUP. The palette is printed FROM `RELMAP_INK_PRESETS`, so
	 * "is this one of the forty" is a fact about that table and not about what happens to be
	 * rendered: two callers turn on this answer -- whether the picker opens for a colour, and
	 * whether it earns a slot in the row of the board's own -- and both would go quietly wrong on a
	 * palette that painted late, or in pages, or under a renamed attribute.
	 */
	_isPreset(hex) {
		return !!hex && PRESET_HEXES.has(hex);
	}

	/**
	 * How many presses one row of this button's group holds, for the arrow keys to step by.
	 *
	 * ⚠ ASKED OF THE BUTTON AND NOT OF THE BAR, which is the whole of what keeps this off the two
	 * rows beside the palette. The direction and dash buttons sit in no grid and carry no such
	 * attribute, so `closest` finds nothing and the answer is one -- a stride of exactly one, which
	 * is what a single row of presses wants. Read from the bar instead, they would inherit the
	 * palette's eight and Up would leap out of a four-button row.
	 */
	_across(button) {
		const said = Number(button?.closest?.("[data-relmap-ink-across]")
			?.dataset?.relmapInkAcross);
		return Number.isInteger(said) && said > 0 ? said : 1;
	}

	/**
	 * One phrase the render left on an element, with `{name}` filled in.
	 *
	 * ⚠ THE WORDS COME IN FROM OUTSIDE, ALWAYS. This is a DOM component with no globals and no i18n
	 * in it -- the same reason `onNudged` is a handler rather than a notification raised in here --
	 * so a spoken name that has to name a colour is a pattern printed by the template and filled in
	 * here. Empty for anything unnamed, and the caller then leaves the label the render wrote.
	 */
	_said(el, name) {
		const pattern = el?.dataset?.relmapSaid ?? "";
		return pattern && name ? pattern.replace("{name}", name) : "";
	}

	/**
	 * Say what one trigger currently stands for, in both the places that say it.
	 *
	 * ⚠ THE SPOKEN NAME AND THE TOOLTIP TOGETHER, ALWAYS. Each of these buttons shows a drawn sample
	 * and no words -- a disc of colour, a stroke, a number -- so the only way anybody learns what it
	 * is set to is one of these two attributes, and a control that tells a screen reader "Colour:
	 * plum" while its tooltip still reads the generic label the render printed is a control saying
	 * two things. Written out at each site it drifted exactly that way on the colour.
	 *
	 * Left alone for anything unnamed, so the render's own label stands -- unless a caller passes a
	 * `bare` name to fall back to, which the colour slots do: a slot's label is the hex it is showing
	 * and there is no render-printed one underneath worth keeping.
	 *
	 * @param {Element|null} el    The trigger to name.
	 * @param {string} name        What it is set to, for `{name}` in the render's pattern.
	 * @param {string} [bare]      What to say when the render left no pattern. Silent by default.
	 */
	_nameTrigger(el, name, bare = "") {
		const said = this._said(el, name) || bare;
		if (!said) return;
		el?.setAttribute?.("aria-label", said);
		el?.setAttribute?.("data-tooltip", said);
	}

	/**
	 * Put a custom colour on an element, or take one off.
	 *
	 * ⚠ `--relmap-ink-raw` AND NOT `--relmap-ink`, which is the property the BOARD writes for a line
	 * of this colour. `.stonetop-relmap-ink--custom` turns the raw one into the drawn one, and under
	 * the high-contrast skin it takes it darker on the way -- so an element given the finished
	 * colour would sit at the undarkened hue under exactly the skin whose job is to be legible.
	 *
	 * Taken off again for a named ink, or the element would go on showing the custom colour
	 * underneath the next one's class.
	 */
	_wearInk(el, hex) {
		if (hex) el?.style?.setProperty?.("--relmap-ink-raw", hex);
		else el?.style?.removeProperty?.("--relmap-ink-raw");
	}

	/**
	 * The colours already on this board, in the slots the render left standing for them.
	 *
	 * ⚠ IT IS THE COLOURS THE PALETTE DOES NOT ALREADY OFFER, which is what this row has come to
	 * mean now that forty presets sit above it. A hex that is one of those is already on screen, with
	 * a name on it, in a fixed place the reader can learn -- repeating it down here would say the
	 * board had a colour of its own that it does not, and would spend one of eight slots saying it.
	 * `markChosen` still finds the preset swatch and sets THAT, so the line's colour is never
	 * unmarked; what is left in these slots is exactly what somebody typed for themselves.
	 *
	 * ⚠ THE LINE'S OWN COLOUR IS STILL FIRST AMONG THOSE, even where the board is not otherwise
	 * drawn in it -- a colour chosen a second ago and not yet written, most of all.
	 *
	 * ⚠ AND A SLOT WITH NO COLOUR IS `hidden`, NOT BLANK. `markChosen` and `_groupKey` both leave
	 * hidden buttons out of the group, so an empty slot is not a tab stop, not somewhere an arrow
	 * key can land, and not somewhere the group's one tab stop can be stranded.
	 *
	 * @param {string} [first]  the colour to put at the head of the list, where there is one.
	 */
	_paintCustoms(first = "") {
		const slots = [...(this.el?.querySelectorAll?.("[data-relmap-ink-slot]") ?? [])];
		if (!slots.length) return;

		// ⚠ THE BOARD'S COLOURS ARE ASKED FOR ONLY WHILE THE PALETTE IS SHOWING. `_markInk` runs on
		// every repaint of every board at the table, and `inksInUse` reads the whole map's graph
		// through the sanitiser -- asked from there it would walk forty people's worth of lines to
		// fill a row nobody can see. The line's OWN colour is slotted either way, because that is
		// the one `markChosen` has to be able to find.
		const board = this._popOpen("ink") ? this._inksInUse() ?? [] : [];
		const seen = [];
		for (const said of [first, ...board]) {
			const hex = normalizeHex(said);
			if (hex && !seen.includes(hex) && !this._isPreset(hex)) seen.push(hex);
			if (seen.length >= slots.length) break;
		}

		slots.forEach((slot, at) => {
			const hex = seen[at] ?? "";
			slot.hidden = !hex;
			slot.dataset.relmapTieValue = hex;
			this._wearInk(slot, hex);
			// Named by its hex, which is the only name a colour nobody named has. Said rather than
			// left bare so a screen reader gets "the colour #7a2f8a, already on this board" instead
			// of a button with no name at all.
			if (hex) this._nameTrigger(slot, hex, hex);
		});
		// The heading goes with them: a board with no colours of its own on it must not show
		// "Already on this board" over an empty row.
		if (this.inkMine) this.inkMine.hidden = !seen.length;
	}

	/**
	 * Show or put away the colour picker, and set what it is holding.
	 *
	 * ⚠ THE VALUE IS WRITTEN BEHIND THE FLAG. Assigning to this element's `value` makes it dispatch
	 * `change`, which is indistinguishable from the reader having chosen -- see `_paintingInk`.
	 */
	_showPicker(open, hex = "") {
		const picker = this.inkHex;
		if (!picker) return;
		picker.hidden = !open;
		if (!open || !hex || picker.value === hex) return;
		this._paintingInk = true;
		try { picker.value = hex; } finally { this._paintingInk = false; }
	}

	// ── The panels ──────────────────────────────────────────────────────────

	/**
	 * One chooser's trigger and the panel it drops, by the field it answers.
	 *
	 * The one place the two are told apart, so everything below is written once. Anything not named
	 * comes back as the colour's, which is the older of the two and the one every bare call meant.
	 */
	_popParts(which) {
		if (which === "dash") return { open: this.dashOpen, pop: this.dashPop };
		if (which === "size") return { open: this.sizeOpen, pop: this.sizePop };
		return { open: this.inkOpen, pop: this.pop };
	}

	/** Whether one chooser is showing -- or any of them, asked with no name. */
	_popOpen(which = "") {
		if (!which) return TIE_POPS.some(one => this._popOpen(one));
		const { pop } = this._popParts(which);
		return !!pop && !pop.hidden;
	}

	_togglePop(which) {
		if (this._popOpen(which)) this._closePop(which, { back: true });
		else this._openPop(which);
	}

	/**
	 * Drop one panel, and put the focus on the answer this line already has.
	 *
	 * ⚠ THE FOCUS LANDS ON THE ANSWER, not at the top of the list. A reader changing rose to green
	 * wants to be standing on rose, one arrow key from where they are going; dropped at the first
	 * swatch, they have to work out where they were before they can leave it.
	 *
	 * ⚠ ONE AT A TIME. Both hang from presses a thumb apart and both are wider than the press they
	 * hang from, so two open at once is one lying underneath the other -- with a radiogroup in each,
	 * and the reader's focus in whichever they cannot see.
	 *
	 * ⚠ UNHIDDEN FIRST AND PAINTED SECOND, which is the opposite of how it reads and is deliberate:
	 * `_paintCustoms` asks for the board's colours only while the palette is showing, so a paint
	 * before the unhide would fill the second row with nothing. Nothing is on screen in between --
	 * this is all one task, and no frame is painted inside it -- and `_placePop` still measures a
	 * panel that is finished.
	 */
	_openPop(which) {
		const { open, pop } = this._popParts(which);
		if (!pop || !this.id || !this._canEdit()) return;
		for (const other of TIE_POPS) if (other !== which) this._closePop(other);
		pop.hidden = false;
		// ⚠ ASKED FOR ONLY WHEN IT IS NEEDED, which is why this is not read above the branch. A
		// colour the reader has just chosen and not yet written wins over the document's, and
		// reading the graph to find a value that is about to be thrown away is a walk of the whole
		// map for nothing -- see `_inkPending`.
		const edge = () => this._tieAt(this.id)?.edge ?? {};
		if (which === "dash") this._markDash(edge().dash || RELMAP_DASH_DEFAULT);
		// A number the reader has typed and not yet had written wins over the document's, exactly as
		// a chosen colour does: this runs on every open, and painting the stored size here would put
		// the field back to what it was under their hands. See `_sizePending`.
		else if (which === "size") this._markSize(this._sizePending ?? edge().size);
		else this._markInk(this._inkPending || edge().ink || RELMAP_INK_DEFAULT);
		open?.setAttribute?.("aria-expanded", "true");
		this._placePop(which);
		const list = [...(this.el?.querySelectorAll?.(`[data-relmap-tie='${which}']`) ?? [])]
			.filter(one => !one.hidden);
		const set = list.find(one => one.classList?.contains?.("is-chosen"));
		// ⚠ AND WHEN THE ANSWER IS ON NONE OF THEM, THE FOCUS GOES WHERE IT IS. Only the sizes can
		// be in that state -- a number the reader typed stands for no step -- and dropping them at
		// "Small" would land them furthest from the answer they actually have, on the one control in
		// the panel that is not a press. The field is where their twenty-two is.
		if (!set && which === "size" && this.sizeNum) { this.sizeNum.focus?.(); return; }
		(set ?? list[0])?.focus?.();
	}

	/**
	 * Put a panel away -- or all of them, asked with no name.
	 *
	 * @param {string} [which]  the chooser, or "" for every one that is open.
	 * @param {object} [opts]
	 * @param {boolean} [opts.back]  put the focus on the trigger. For every way OUT of a panel that
	 *        the reader took deliberately -- an answer pressed, Escape, the trigger again -- because
	 *        the focus is inside something about to stop existing, and a focus left on a hidden
	 *        button is a keyboard reader dropped at the top of the window. Not for the ways it is
	 *        closed AROUND them: a different line opened, the bar let go of.
	 */
	_closePop(which = "", { back = false } = {}) {
		for (const one of which ? [which] : TIE_POPS) {
			const { open, pop } = this._popParts(one);
			if (!pop) continue;
			const was = !pop.hidden;
			pop.hidden = true;
			open?.setAttribute?.("aria-expanded", "false");
			if (was && back) open?.focus?.();
		}
	}

	/**
	 * The `+`: open the picker on the colour the line already has.
	 *
	 * ⚠ IT WRITES NOTHING BY ITSELF. Seeded with what the line is wearing NOW -- rose, if the line
	 * is rose -- so the reader starts from where they are rather than from whatever black the
	 * element came up holding, and the line keeps its colour until they actually choose another. A
	 * control that blanked the line the moment it was opened would be one nobody could look inside.
	 */
	_openHex() {
		if (!this.id || !this._canEdit()) return;
		this._showPicker(true, this._currentHex());
		this.inkHex?.focus?.();
	}

	/**
	 * Hang a panel off the bar, on the side away from the line.
	 *
	 * ⚠ IT MEASURES, WHICH IS WHY IT IS NOT IN `place()`. That one runs on every painted frame of a
	 * pan and may not read the layout at all; this runs when a panel opens and when the board
	 * has been repainted under it, which is a handful of times rather than sixty a second. What
	 * that costs is a panel that keeps the side it opened on through a pan -- which is right
	 * anyway: one that flipped over the bar under the reader's hand as they reached for a swatch
	 * is worse than one hanging a little off a board they can pan back.
	 *
	 * THE OFFSETS ARE THE BAR'S OWN, because the panel is placed absolutely INSIDE it -- which is
	 * also what carries it along on every frame `place()` does move.
	 *
	 * @param {string} [which]  the chooser, or "" for whichever is open. `refresh` asks with no
	 *        name: what has moved is the bar, and the panel riding on it is the panel to re-aim.
	 */
	_placePop(which = "") {
		if (!which) {
			for (const one of TIE_POPS) if (this._popOpen(one)) this._placePop(one);
			return;
		}
		if (!this._popOpen(which) || !this.el) return;
		const { open: anchorEl, pop } = this._popParts(which);
		const bar = this.el.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
		const box = pop.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		const view = this._view?.getBoundingClientRect?.()
			?? { left: 0, top: 0, width: 0, height: 0 };

		// ⚠ AWAY FROM THE LINE, WHICH IS THE SIDE THE BAR ITSELF CHOSE. `place()` keeps the bar clear
		// of the stroke it is editing, above it or under it; two hundred pixels of swatches dropped on
		// the wrong side of that bar put the palette straight back over the stroke, which undoes the
		// one thing that placement is for. What it covers on the near side instead is the bar's own
		// writing field -- and nobody is typing into that while the palette holds the focus.
		//
		// Turned over anyway where the chosen side has no room and the other one has: a palette half
		// off the window is one a reader cannot pick the bottom row out of at all.
		const high = (box.height ?? 0);
		const roomBelow = (view.top ?? 0) + (view.height ?? 0) - TIE_BAR_EDGE_PX
			- ((bar.top ?? 0) + (bar.height ?? 0) + TIE_POP_GAP_PX);
		const roomAbove = (bar.top ?? 0) - TIE_POP_GAP_PX - ((view.top ?? 0) + TIE_BAR_EDGE_PX);
		const below = this._under
			? (roomBelow >= high || roomAbove < high)
			: (roomAbove < high && roomBelow >= high);
		const top = below ? (bar.height ?? 0) + TIE_POP_GAP_PX : -(high + TIE_POP_GAP_PX);

		// Aligned with the trigger and then clamped into the viewport: a bar near the right edge
		// would otherwise hang its panel off the side of the window, where half of it is unreachable.
		const anchor = anchorEl?.getBoundingClientRect?.() ?? bar;
		const edge = (view.left ?? 0) + TIE_BAR_EDGE_PX;
		const maxLeft = Math.max(edge, (view.left ?? 0) + (view.width ?? 0) - (box.width ?? 0) - TIE_BAR_EDGE_PX);
		const at = Math.max(edge, Math.min(anchor.left ?? bar.left ?? 0, maxLeft));

		pop.style.left = `${Math.round(at - (bar.left ?? 0))}px`;
		pop.style.top = `${Math.round(top)}px`;
		pop.classList?.toggle("is-above", !below);
	}

	/**
	 * The reader has chosen a colour: show it at once, write it in a moment, and get out of the way.
	 *
	 * SHOWN BEFORE IT IS WRITTEN for the reason every press on this bar is -- the write is a round
	 * trip through the document and comes back as a repaint, and a swatch that waited for it would
	 * sit there looking unpressed for as long as that took.
	 *
	 * ⚠ AND THE PALETTE CLOSES BEHIND IT. It hangs over the board and over the presses beside it,
	 * and a reader who has answered the question it asks is done with it: one that stayed up would
	 * have to be dismissed before the line it covers could be looked at. The focus goes back to the
	 * trigger, which by then says the colour they picked.
	 */
	_pickInk(value) {
		if (!this.id || !this._canEdit() || !value) return;
		this._markInk(value);
		this._inkPending = value;
		this._defer("ink");
		this._closePop("ink", { back: true });
	}

	/**
	 * The reader has chosen a stroke: show it at once, write it, and get out of the way.
	 *
	 * ⚠ WRITTEN STRAIGHT THROUGH, unlike the colour beside it, and the difference is the control
	 * rather than the field. A colour arrives from a picker that fires `change` per keystroke and
	 * per drag stop, which is why `TIE_INK_DELAY_MS` exists at all; there are three strokes and each
	 * is one press, so a delay here would buy nothing and cost a repaint the reader is waiting on.
	 *
	 * ⚠ AND THE PANEL CLOSES BEHIND IT, as the palette does: it hangs over the board and over the
	 * presses beside it, and a reader who has answered the question it asks is done with it. The
	 * focus goes back to the trigger, which by then draws the stroke they picked.
	 */
	_pickDash(value) {
		if (!this.id || !this._canEdit() || !value) return;
		// Painted before the write rather than after it, as every press on this bar is: the write is
		// a round trip through the document and comes back as a repaint, and a control that waited
		// for it would sit there looking unpressed for as long as that took.
		this._markDash(value);
		this._onField(this.id, { dash: value });
		this._closePop("dash", { back: true });
	}

	/**
	 * The reader has chosen one of the offered sizes: show it at once, write it, get out of the way.
	 *
	 * ⚠ WRITTEN STRAIGHT THROUGH, like the strokes and unlike the FIELD beside these steps. One
	 * press is one whole answer here, so there is nothing for a delay to coalesce; the field is
	 * where a number arrives a digit at a time, and that is what `TIE_SIZE_DELAY_MS` is for.
	 *
	 * ⚠ AND A TYPED NUMBER STILL WAITING IS THROWN AWAY, because this press is the reader changing
	 * their mind about the same question. Left armed, it would land a moment later and put the
	 * caption back to a size they had just pressed away from.
	 *
	 * THE PANEL CLOSES BEHIND IT, as the other two do, and the focus goes back to the trigger --
	 * which by then shows the number they chose.
	 */
	_pickSize(value) {
		if (!this.id || !this._canEdit() || value === "") return;
		this._forgetSize();
		this._markSize(value);
		this._onField(this.id, { size: readSize(value) });
		this._closePop("size", { back: true });
	}

	/**
	 * What the line is wearing right now, as a hex the picker can open on.
	 *
	 * One of the eight is resolved through the STYLESHEET rather than from a table in here, so the
	 * picker opens on the colour actually on the board -- including the deeper one the
	 * high-contrast skin paints, which is the colour that reader is looking at.
	 */
	_currentHex() {
		const edge = this._tieAt(this.id)?.edge ?? {};
		const ink = edge.ink || RELMAP_INK_DEFAULT;
		return normalizeHex(ink) || resolveInkHex(ink) || "#000000";
	}

	/**
	 * A colour the reader chose for themselves: check it can be followed, then treat it as any pick.
	 *
	 * ⚠ DEEPENED RATHER THAN REFUSED, and the reader is TOLD. A dialog that says no to a colour has
	 * taken the choice away and given nothing back; what somebody picking a pale yellow wants is a
	 * yellow line, and there is one -- a darker one. So the hue is kept and only the lightness moves,
	 * the picker is set to what was actually used so its swatch is not lying about the board, and
	 * `onNudged` says what happened. See `deepenInk`.
	 */
	_pickCustomInk(said) {
		if (!this.id || !this._canEdit()) return;
		const chose = normalizeHex(said);
		// A half-typed hex in the picker's text field is not a colour yet. Ignored rather than
		// refused out loud: the reader is still typing it.
		if (!chose) return;
		const { hex, nudged, ratio } = deepenInk(chose);
		if (!hex) return;
		if (nudged) {
			this._showPicker(true, hex);
			this._onNudged(chose, hex, ratio);
		}
		this._markInk(hex);
		this._inkPending = hex;
		this._defer("ink");
	}

	/**
	 * Put the bar back over its line, wherever the board has got to.
	 *
	 * Called from the surface's `onChange`, so it runs on every painted frame of a pan and every
	 * zoom step, and NOTHING IN IT MAY MEASURE. It runs immediately after the surface has written a
	 * transform and the caption pass has toggled a class on the root, so every read here is a forced
	 * style-and-layout flush over a board carrying forty portraits and a hundred and sixty paths.
	 * So: the surface is asked for the viewport's size (it keeps that measured anyway), the viewport
	 * element was found in the constructor, and the bar's own box is measured once per opening.
	 *
	 * WHICH IS ALSO WHY THE LINE IS CUT UP ELSEWHERE. Seating the bar off the stroke rather than off
	 * one point of it means walking that stroke, and the walk here is arithmetic over percentages
	 * cut when the bar took hold of the line: `_seats` offers the places it could go and
	 * `_clearsLine` says which of them the line stays out of, and neither touches the layout.
	 */
	place() {
		if (!this.isOpen || !this.el) return;
		const surface = this._surface();
		const at = this._at;
		if (!surface || !at) return;

		const painted = surface.painted?.();
		const offset = surface.offset;
		if (!painted?.width || !offset) return;

		const x = offset.x + (painted.width * (at.left ?? 0)) / 100;
		const y = offset.y + (painted.height * (at.top ?? 0)) / 100;

		this._box ??= this.el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		// The measured viewport where the surface has one, and its box otherwise -- which is what a
		// surface that has not been attached to a real element can offer.
		//
		// ⚠ ASKED OF THE MEASUREMENT AND NOT OF THE OBJECT. `viewSize` is a getter that always
		// hands back a pair, so `??` never reached the fallback: a surface that has not been
		// measured yet answers {0, 0}, and the clamp below then pins the bar to the top-left corner
		// of the board instead of floating it over its line.
		const measured = surface.viewSize;
		const room = measured?.width
			? measured
			: this._view?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
		const w = this._box.width || 0;
		const h = this._box.height || 0;

		// ⚠ CLEAR OF THE LINE AND NEVER ACROSS IT -- which takes EIGHT seats and not two, because
		// the middle of a line says nothing about where the rest of it goes. Above and underneath
		// answer a level line and no other: a near-vertical link runs straight up through a bar
		// seated above its own middle, and a steep diagonal clips a corner of it. So the two
		// obvious seats are tried first, in the order a reader wants them, and then the same bar
		// beside the line and off its corners -- and the first one the stroke keeps out of wins.
		const seats = this._seats({ x, y, w, h, room });
		const seat = seats.find(one => this._clearsLine(one, w, h, offset, painted)) ?? seats[0];

		// ⚠ AND WHEN NOTHING IS CLEAR, THE FIRST SEAT IS STILL TAKEN. A line long enough to cross
		// every seat is one running corner to corner of a viewport barely taller than the bar, and
		// the answer there is the seat the reader expects rather than none at all: a bar that
		// refused to appear would be a line that cannot be edited.
		this._under = seat.top + h / 2 > y;
		this.el.style.left = `${Math.round(seat.left)}px`;
		this.el.style.top = `${Math.round(seat.top)}px`;
	}

	/**
	 * Every place the bar could sit over this point, best first, each already held inside the view.
	 *
	 * THE ORDER IS THE ANSWER. Above by preference, because that is the side the words are read
	 * from; underneath when the bar's height will not fit above, which is a line near the top of a
	 * board zoomed right in; and the roomier of the two when it fits on neither, which is a short
	 * viewport or a bar that has wrapped to two rows. That pair is what this bar has always
	 * offered, and it stays first so a level line -- most of them -- is seated exactly where it was.
	 *
	 * THEN BESIDE, AND THEN OFF THE CORNERS. A vertical line is cleared by moving sideways and by
	 * nothing else; a steep diagonal is usually cleared by a corner, which keeps the bar nearer its
	 * own line than a seat out to the side would. Sideways seats come first of those because a bar
	 * level with the point it belongs to reads as belonging to it.
	 *
	 * ⚠ CLAMPED PER SEAT, AND ON THE BOUND THAT PUSHES IT AWAY FROM THE LINE. A bar above a line
	 * dragged off the FOOT of the viewport is pulled up into view; one underneath a line dragged
	 * off the TOP is pushed down into it. The other bound would drag it back across the stroke it
	 * is editing -- a bar hanging a little off the board is the price, and a bar that fits by
	 * sitting on its own line is not. Sideways seats take the pair, since what holds those off the
	 * line is horizontal and a vertical nudge cannot undo it.
	 */
	_seats({ x, y, w, h, room }) {
		const wide = room.width || 0;
		const high = room.height || 0;
		// `Math.max` last, or a viewport narrower than the bar pushes it off the left rather than
		// the right -- and the left is the edge a reader cannot pan back to.
		const maxLeft = Math.max(TIE_BAR_EDGE_PX, wide - w - TIE_BAR_EDGE_PX);
		const maxTop = Math.max(TIE_BAR_EDGE_PX, high - h - TIE_BAR_EDGE_PX);
		const across = at => Math.max(TIE_BAR_EDGE_PX, Math.min(at, maxLeft));

		const roomAbove = y - TIE_BAR_GAP_PX - TIE_BAR_EDGE_PX;
		const roomUnder = high - TIE_BAR_EDGE_PX - (y + TIE_BAR_GAP_PX);
		const under = h > roomAbove && (h <= roomUnder || roomUnder > roomAbove);

		const above = Math.min(y - h - TIE_BAR_GAP_PX, maxTop);
		const below = Math.max(y + TIE_BAR_GAP_PX, TIE_BAR_EDGE_PX);
		const level = Math.max(TIE_BAR_EDGE_PX, Math.min(y - h / 2, maxTop));
		const first = under ? below : above;
		const other = under ? above : below;

		const centre = across(x - w / 2);
		const before = across(x - w - TIE_BAR_GAP_PX);
		const after = across(x + TIE_BAR_GAP_PX);
		return [
			{ left: centre, top: first },
			{ left: centre, top: other },
			{ left: before, top: level },
			{ left: after, top: level },
			{ left: before, top: first },
			{ left: after, top: first },
			{ left: before, top: other },
			{ left: after, top: other },
		];
	}

	/**
	 * Whether the stroke stays out of one seat, walked in the seat's own pixels.
	 *
	 * ⚠ IT MEASURES NOTHING, which is what lets it run on every frame of a pan beside the rest of
	 * `place`. The line was cut into percentages when the bar took hold of it; the only work here
	 * is multiplying those by the painted board and clipping a segment against four numbers.
	 *
	 * TRUE FOR A LINE NOBODY HANDED OVER. A caller that offers no curve gets the seating this bar
	 * has always had -- the first seat, off the middle of the line alone.
	 */
	_clearsLine({ left, top }, w, h, offset, painted) {
		const line = this._line;
		if (!line || line.length < 4) return true;
		const box = {
			left: left - TIE_BAR_CLEAR_PX,
			top: top - TIE_BAR_CLEAR_PX,
			right: left + w + TIE_BAR_CLEAR_PX,
			bottom: top + h + TIE_BAR_CLEAR_PX,
		};
		let ax = offset.x + (painted.width * line[0]) / 100;
		let ay = offset.y + (painted.height * line[1]) / 100;
		for (let i = 2; i < line.length; i += 2) {
			const bx = offset.x + (painted.width * line[i]) / 100;
			const by = offset.y + (painted.height * line[i + 1]) / 100;
			if (segmentInBox(ax, ay, bx, by, box)) return false;
			ax = bx;
			ay = by;
		}
		return true;
	}

	/**
	 * The board has been repainted underneath: re-take the mark, and let go of a line that has gone.
	 *
	 * ⚠ THE MARK HAS TO BE RE-TAKEN. `is-picked` is a class on markup the repaint has just thrown
	 * away, so without this the bar goes on floating over a board with nothing on it saying which
	 * line it belongs to -- and the reader's next press writes to a line they can no longer see they
	 * chose. It is the same repair `_lightPerson` makes for the lit web, one line further down.
	 *
	 * ⚠ AND THE FIELD IS NOT REFILLED. Somebody else at the table renaming this line while it is
	 * open is a real thing that happens, and the reader typing here has the newer sentence: quietly
	 * replacing what is under their caret is the one outcome nobody would forgive. What is re-read
	 * is everything they are NOT holding -- the colour, the arrows, the dashes -- which is where a
	 * change made elsewhere should show.
	 */
	refresh() {
		if (!this.isOpen) return;
		const tie = this._tieAt(this.id);
		if (!tie) { this.close(); return; }
		// Where it is drawn NOW, which a repaint can have moved: somebody else dragged one of the
		// two faces, or this reader switched to a view that seats them itself.
		this._at = tie.at ?? this._at;
		// AND THE WHOLE STROKE WITH IT. A drag on either face re-bows this line, so the run the bar
		// dodges has to be re-cut from the repaint that moved it -- a bar keeping off where the line
		// used to be is a bar sitting on where it is now.
		this._line = tieLine(tie.curve) ?? this._line;
		this._box = null;
		this._paintTie(tie);
		this._onPicked(this.id);
		// ⚠ AND A HALF-TYPED SENTENCE IS PUT BACK ON THE LINE. The repaint rebuilt the board from
		// the document, so the caption under this bar has just gone back to what was last SAVED --
		// which, mid-sentence, is a reader watching their own words vanish because somebody at the
		// far end of the table moved a portrait. Only when there is something unsaved to put back:
		// a reader who has typed nothing must not have a stale field painted over a caption
		// somebody else has just changed, which is the same promise the note above makes about not
		// refilling the field.
		if (this.words && this.words.value !== this._saved) this._say();
		this.place();
		// ⚠ AND THE PALETTE IS RE-AIMED, NOT SHUT. Somebody else at the table moving a portrait can
		// carry this bar half a board, and the palette hanging off it was measured against where it
		// used to be. Closing it instead would take the question away mid-answer for a change the
		// reader had nothing to do with -- which is the same promise `refresh` makes to the caption.
		this._placePop();
	}

	// ── The caption ─────────────────────────────────────────────────────────

	/**
	 * Show the LINE what is in the field, writing nothing.
	 *
	 * This is where the text box went. A caption is words drawn along a stroke, and the reader is
	 * looking at the stroke -- so a keystroke belongs on it at once, while the write it will
	 * eventually cause waits out TIE_WRITE_DELAY_MS with everybody else's board.
	 *
	 * ⚠ IT IS NOT A WRITE AND MUST NEVER BECOME ONE. Nothing here reaches the document, nothing is
	 * broadcast, and nothing is recorded on the undo stack: this is one caption repainted in this
	 * reader's own window, thrown away and redrawn by the next repaint like everything else on the
	 * board. `flush` is still the only way a sentence is saved.
	 */
	_say() {
		if (!this.id) return;
		this._onSaying(this.id, this.words?.value ?? "");
	}

	/**
	 * Hold one of TIE_DEFERRED's answers back, and write it when the reader stops.
	 *
	 * @param {"words"|"ink"|"size"} kind Which held answer to arm. Re-arming restarts its wait.
	 */
	_defer(kind) {
		this._disarm(kind);
		const { ms, flush } = TIE_DEFERRED[kind];
		this._timers[kind] = setTimeout(() => { this._timers[kind] = 0; flush(this); }, ms);
	}

	/** Stop one held answer's write from landing. What was held is left alone; see the `_forget`s. */
	_disarm(kind) {
		if (this._timers[kind]) { clearTimeout(this._timers[kind]); this._timers[kind] = 0; }
	}

	// ── The colour ──────────────────────────────────────────────────────────

	/** Throw away a colour that has not been written yet, so nothing later saves it. */
	_forgetInk() {
		this._disarm("ink");
		this._inkPending = "";
	}

	/** Write the chosen colour, if one is waiting. */
	_flushInk() {
		this._disarm("ink");
		const ink = this._inkPending;
		this._inkPending = "";
		if (!ink || !this.id || !this._canEdit()) return undefined;
		return this._onField(this.id, { ink });
	}

	// ── The size ────────────────────────────────────────────────────────────

	/**
	 * A number is being typed: hold it, and write it when the typing stops.
	 *
	 * ⚠ THE FIELD IS READ HERE AND NOT AT THE TIMER, which is the difference between a size and a
	 * caption. `flush` for the caption compares the field against what was last saved, so reading it
	 * late is harmless; this has to be REMEMBERED, because a repaint arriving in the gap paints the
	 * bar from the document, and a `_sizePending` is the only thing that tells `_markSize` not to
	 * put the field back to the stored number under the reader's caret.
	 *
	 * ⚠ AN EMPTY FIELD IS A REAL ANSWER and is held as one: it means "no size of its own", which is
	 * what `readSize` gives back for it, and is how a reader takes a size off a line by clearing the
	 * box. Held as the string rather than as zero so that nothing here has to know that.
	 */
	_armSize() {
		this._sizePending = this.sizeNum?.value ?? "";
		this._defer("size");
	}

	/** Throw away a typed size that has not been written yet, so nothing later saves it. */
	_forgetSize() {
		this._disarm("size");
		this._sizePending = null;
	}

	/** Write the typed size, if one is waiting. */
	_flushSize() {
		this._disarm("size");
		const said = this._sizePending;
		this._sizePending = null;
		if (said === null || !this.id || !this._canEdit()) return undefined;
		const size = readSize(said);
		// ⚠ PAINTED FROM WHAT WILL ACTUALLY BE STORED, and only now that the reader has stopped:
		// this is where a 500 becomes the ceiling and a 1 becomes the floor in front of them, and
		// doing it a keystroke earlier is what would have rewritten the number under their caret.
		this._markSize(size);
		return this._onField(this.id, { size });
	}

	/**
	 * Throw away a caption that has not been written yet, so nothing later saves it.
	 *
	 * The field goes back to what the document has rather than merely being disarmed, because
	 * `flush` compares the two: a timer cancelled but a field left holding a newer sentence is a
	 * write waiting for the next blur. Escape takes the same two steps for the same reason.
	 */
	_forgetWriting() {
		this._disarm("words");
		if (this.words) this.words.value = this._saved;
		// AND THE LINE IS PUT BACK WITH IT. What is being thrown away is on the BOARD now, not in a
		// box: a field quietly restored under a caption still showing the abandoned sentence would
		// leave the line saying something the document has never had, until the next repaint.
		this._say();
	}

	/**
	 * Write everything the reader has settled that the document does not have yet.
	 *
	 * ⚠ IT HANDS BACK WHAT THE WRITE IS DOING, which most callers ignore and one must not. Nearly
	 * everywhere this is a "get it saved and carry on" — a blur, an Escape, a re-render throwing the
	 * bar away. The undo is the exception: it has to know the caption has actually LANDED before it
	 * reads the board it is about to reverse, and before it takes a step off a stack the caption's
	 * own recording is about to change. Fire-and-forget there, and a redo peeks at a stack the
	 * caption empties a microtask later. See `_stepHistory` in dialogs/RelationshipMapWindow.js.
	 *
	 * @returns {Promise<*>|undefined}  the write, where there was one to make.
	 */
	flush() {
		// ALL THREE, AND THE WRITING LAST. A caption, a colour and a size settled in the same breath
		// are three writes and three steps on the undo stack, and the order they land in is the order
		// they come back off it: the reader typed and then chose, so a chosen thing is what a single
		// undo takes back. (They are separate steps on purpose -- see `_stepHistory`, which reverses
		// one leaf.)
		const writes = [this._flushInk(), this._flushSize(), this._flushWords()].filter(Boolean);
		if (!writes.length) return undefined;
		return writes.length === 1 ? writes[0] : Promise.all(writes);
	}

	/** Write what is in the field, if it says anything the document does not already have. */
	_flushWords() {
		this._disarm("words");
		if (!this.id || !this.words || !this._canEdit()) return undefined;
		const said = this.words.value ?? "";
		if (said === this._saved) return undefined;
		this._saved = said;
		return this._onField(this.id, { label: said });
	}

	destroy() {
		// EVERY HELD ANSWER, from the table rather than by hand: a timer missed here is a write
		// landing on a bar that no longer exists.
		for (const kind of Object.keys(TIE_DEFERRED)) this._disarm(kind);
		for (const [el, type, handler, opts] of this._bound) {
			el.removeEventListener?.(type, handler, opts);
		}
		this._bound = [];
		this.id = "";
		if (this.el) this.el.hidden = true;
		this.el = null;
		this.words = null;
		this.inkOpen = null;
		this.inkMark = null;
		this.inkWord = null;
		this.pop = null;
		this.inkMine = null;
		this.inkHex = null;
		this.dashOpen = null;
		this.dashMark = null;
		this.dashPop = null;
		this.sizeOpen = null;
		this.sizeMark = null;
		this.sizePop = null;
		this.sizeNum = null;
		this._view = null;
		this.root = null;
	}
}
