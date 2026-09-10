import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	RelmapTieBar, TIE_INK_DELAY_MS, TIE_SIZE_DELAY_MS, TIE_WRITE_DELAY_MS,
} from "../../module/utils/relmap-tie-bar.js";
import { resolveInkHex } from "../../module/relmap/relmap-ink.js";
import { RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";
import { boardEl } from "../fakes/pointer-board.js";

// THE BAR OVER A LINE: what it fills in, what it writes, and when.
//
// WHAT THIS FILE IS ACTUALLY FOR is the three promises that are easy to break and invisible when
// broken. A caption is written to a SHARED document, so it must not be written per keystroke and
// must not be lost when the window closes or re-renders. A repaint replaces the board underneath a
// bar that survives it, so the mark saying which line is held has to be re-taken. And a line
// somebody else rubs out has to make the bar let go rather than leave it writing to nothing.
//
// The bar is built out of `boardEl` rather than rendered from the template: what is under test is
// the wiring, and a test that had to render Handlebars to press a swatch would fail for reasons
// that have nothing to do with the wiring.

/** One of the eight, named the way the template names it: `rose` -> "Rose". */
const inkName = key => key[0].toUpperCase() + key.slice(1);

/**
 * A few of the forty presets, as `[hex, name]`, and how wide the fake lays them out.
 *
 * ⚠ FOUR AND NOT FORTY, and three across and not eight. What the bar knows about the presets is
 * read off the markup -- whether a hex is one of them, what it is called, and how far a row is --
 * so a fake carrying the real list and the real width would be a test that passed on the numbers
 * rather than on the reading. `RELMAP_INK_PRESETS` itself is measured in tests/relmap/relmap-ink.js.
 */
const PRESETS = [["#2295bf", "Azure"], ["#ea5d2e", "Orange"], ["#0b724f", "Deep jade"], ["#1c1e22", "Soot"]];
const ACROSS = 3;

/** The bar's markup, as the window template prints it. */
/**
 * A few of the sizes, as `[px, name]`, in the order the panel offers them.
 *
 * FOUR AND NOT FIVE, and not the shipped numbers. What the bar knows about the steps is read off
 * the markup -- which number a row stands for and what it is called -- so a fake carrying the real
 * list would be a test passing on `RELMAP_SIZES` rather than on the reading. That list is held to
 * its own bounds in tests/styles/relationship-map-caption-size.js.
 *
 * ⚠ ONE OF THEM IS THE ORDINARY SIZE, because the interesting case is that pressing it stores
 * NOTHING: a line set in what the sheet already sets has no size of its own. That one is the
 * constant and not a number typed out beside it -- it is the base a retune moves, and written by
 * hand here it would be a fixture quietly offering a size the store no longer treats as ordinary.
 */
const SIZES = [[10, "Small"], [RELMAP_CAPTION_PX, "Normal"], [18, "Very large"], [26, "Huge"]];

function barDom({
	inks = ["rose", "slate"], dashes = ["solid", "dashed", "dotted"], slots = 3, presets = PRESETS,
	sizes = SIZES,
} = {}) {
	const root = boardEl();
	const view = boardEl({ cls: ["stonetop-relmap-view"], parent: root });
	const board = boardEl({ cls: ["stonetop-relmap-board"], parent: view });

	const bar = boardEl({ cls: ["stonetop-relmap-tiebar"], parent: view });
	bar.hidden = true;

	// The field is a real enough input: a value, a caret, and a focus flag to assert.
	const words = boardEl({ dataset: { relmapTie: "words" }, parent: bar });
	words.value = "";
	words.focus = vi.fn(() => { words.focused = true; });
	words.setSelectionRange = vi.fn((from, to) => { words.caret = [from, to]; });

	// THE COLOUR IS THE ANSWER ON THE BAR AND A PALETTE UNDER IT: one press showing a disc and a
	// word, and the eight laid out when it is pressed. The disc comes up wearing the class the
	// template prints, because taking THAT one off is the half of `_markInk` worth a test, and the
	// word comes up empty because a render knows nothing about a line nobody has clicked yet.
	const trigger = boardEl({
		dataset: { relmapTie: "inkopen", relmapSaid: "Colour: {name}" }, parent: bar,
	});
	trigger.focus = () => { trigger.focused = true; };
	const mark = boardEl({ cls: [`stonetop-relmap-ink--${inks[inks.length - 1] ?? "slate"}`],
		dataset: { relmapTieMark: "ink" }, parent: trigger });
	const word = boardEl({ dataset: { relmapTieName: "ink" }, parent: trigger });

	const pop = boardEl({
		cls: ["stonetop-relmap-inkpop"], dataset: { relmapTiePop: "ink" }, parent: bar,
	});
	pop.hidden = true;

	// ⚠ ONE BLOCK OVER ALL THREE GRIDS, CARRYING HOW WIDE THEY ARE. `_across` reads it off whichever
	// swatch is focused, by `closest`, which is what keeps the palette's row-sized Up and Down off
	// the single rows of presses beside it -- so the attribute has to sit on an ANCESTOR of every
	// swatch and of nothing else. A fake that hung it on the palette itself would pass a version
	// that read it off the bar and stepped the arrow buttons eight at a time.
	const choices = boardEl({ dataset: { relmapInkAcross: String(ACROSS) }, parent: pop });

	// THE NAME RIDES ON THE SWATCH, which is the only reason a module with no i18n in it can put a
	// colour's name on the bar. A fake that left it off would pass a `_markInk` that had stopped
	// writing the word at all.
	const swatch = {};
	for (const key of inks) {
		const one = boardEl({
			cls: [`stonetop-relmap-ink--${key}`],
			dataset: { relmapTie: "ink", relmapTieValue: key, relmapName: inkName(key) },
			parent: choices,
		});
		one.focus = () => { one.focused = true; };
		swatch[key] = one;
	}

	// THE REST OF THE WHEEL: colours nobody named, offered by the handful. Stored as hexes exactly
	// as a typed colour is, and told apart from one only by `data-relmap-ink-preset` -- which is
	// what the bar asks before it decides whether to spring the hex field open and whether the row
	// below needs to offer this colour a second time.
	//
	// ⚠ PRINTED BEFORE THE SLOTS, as the template prints them, because `_inkName` takes the FIRST
	// swatch carrying a hex and only these carry a name. A fake with them the other way round would
	// pass a palette that had stopped naming its own colours.
	const preset = {};
	for (const [hex, name] of presets) {
		const one = boardEl({
			cls: ["stonetop-relmap-ink--custom"],
			dataset: {
				relmapTie: "ink", relmapTieValue: hex, relmapName: name, relmapInkPreset: hex,
			},
			parent: choices,
		});
		one.focus = () => { one.focused = true; };
		preset[hex] = one;
	}

	// THE COLOURS ALREADY ON THIS BOARD, as fixed slots the bar fills in -- the house rule for
	// everything over this board, since the bar can only write onto markup a render left standing.
	const mine = boardEl({ dataset: { relmapTieMine: "ink" }, parent: choices });
	mine.hidden = true;
	const slotEls = [];
	for (let at = 0; at < slots; at += 1) {
		const one = boardEl({
			cls: ["stonetop-relmap-ink--custom"],
			dataset: {
				relmapTie: "ink",
				relmapTieValue: "",
				relmapInkSlot: String(at),
				relmapSaid: "The colour {name}, already on this board",
			},
			parent: mine,
		});
		one.hidden = true;
		one.focus = () => { one.focused = true; };
		slotEls.push(one);
	}

	const more = boardEl({ dataset: { relmapTie: "inkmore" }, parent: pop });

	// ⚠ THE PICKER DISPATCHES `change` FROM ITS OWN VALUE SETTER, and the fake has to do that or
	// the one bug worth testing here is untestable. `HTMLColorPickerElement` extends Foundry's
	// AbstractFormInputElement, whose setter fires `input` and `change` on EVERY assignment --
	// which means the bar painting the picker from the document is indistinguishable, at the
	// handler, from the reader having chosen that colour. A fake that stored the value quietly
	// would pass whether or not `_paintingInk` existed.
	const picker = boardEl({ dataset: { relmapTie: "inkhex" }, parent: pop });
	picker.hidden = true;
	picker.focus = () => { picker.focused = true; };
	let held = "";
	Object.defineProperty(picker, "value", {
		get: () => held,
		set(next) { held = next; picker.emit("change", picker); },
	});

	const press = {};
	const button = (what, value) => {
		const el = boardEl({ dataset: { relmapTie: what, relmapTieValue: value }, parent: bar });
		el.children.push(boardEl({ cls: ["glyph"] }));
		// The icon, which `_nameDirs` rewrites. `querySelector("i")` in production; the fake matches
		// on classes, so the arrow buttons are asked for theirs by class instead.
		el.querySelector = () => el.children[0] ?? null;
		el.focus = () => { el.focused = true; };
		(press[what] ??= {})[value] = el;
		return el;
	};
	for (const dir of ["none", "a-b", "b-a", "both"]) button("dir", dir);

	// THE STROKE IS THE ANSWER ON THE BAR AND THREE ROWS UNDER IT, exactly as the colour is: one
	// press drawing the stroke this line has, and the three laid out when it is pressed.
	//
	// ⚠ THE TRIGGER CARRIES NO WORD AND MUST NOT GROW ONE HERE. A stroke is a shape and the sample
	// is that shape; what says it in words is the spoken label, built from the pattern below -- so a
	// fake that printed the name beside the sample would pass a `_markDash` that had stopped writing
	// the one thing a reader not looking at the bar has.
	const dashTrigger = boardEl({
		dataset: { relmapTie: "dashopen", relmapSaid: "The stroke: {name}" }, parent: bar,
	});
	dashTrigger.focus = () => { dashTrigger.focused = true; };
	// Up wearing the class the template prints, because taking THAT one off is the half of
	// `_markDash` worth a test: two of these at once is a sample drawn whichever way the stylesheet
	// happens to declare last.
	const dashMark = boardEl({
		cls: ["stonetop-relmap-tiebar-rule", "stonetop-relmap-tiebar-rule--solid"],
		dataset: { relmapTieMark: "dash" }, parent: dashTrigger,
	});

	const dashPop = boardEl({
		cls: ["stonetop-relmap-dashpop"], dataset: { relmapTiePop: "dash" }, parent: bar,
	});
	dashPop.hidden = true;
	// ⚠ NO `data-relmap-ink-across` ANYWHERE ABOVE THESE. They are a LIST and a row is one button,
	// so `_across` has to find nothing and answer one -- a fake that hung the palette's width over
	// them would pass a version whose Up and Down leapt clean out of the panel.
	const dashChoices = boardEl({ parent: dashPop });

	for (const dash of dashes) {
		const one = boardEl({
			dataset: { relmapTie: "dash", relmapTieValue: dash, relmapName: `${dash} line` },
			parent: dashChoices,
		});
		one.focus = () => { one.focused = true; };
		(press.dash ??= {})[dash] = one;
	}

	// HOW BIG THE WRITING IS: the answer on the bar and the steps under it, as the other two are.
	//
	// ⚠ THE TRIGGER SHOWS A NUMBER AND NOT A WORD, and the fake has to keep that straight: five of
	// the sizes have names and any other number a reader types has none, so the number is the only
	// answer always true. What says it in words is the spoken label, built from the pattern below.
	const sizeTrigger = boardEl({
		dataset: { relmapTie: "sizeopen", relmapSaid: "How big the writing is: {name}" }, parent: bar,
	});
	sizeTrigger.focus = () => { sizeTrigger.focused = true; };
	const sizeMark = boardEl({ dataset: { relmapTieMark: "size" }, parent: sizeTrigger });
	sizeMark.textContent = String(RELMAP_CAPTION_PX);

	const sizePop = boardEl({
		cls: ["stonetop-relmap-sizepop"], dataset: { relmapTiePop: "size" }, parent: bar,
	});
	sizePop.hidden = true;
	// A list like the strokes, so no `data-relmap-ink-across` over it: a row is one button.
	const sizeChoices = boardEl({ parent: sizePop });

	// ⚠ THE VALUE IS THE NUMBER AS TEXT, which is how the template prints it and therefore what the
	// bar has to compare against. A fake holding numbers would pass a `_markSize` that had stopped
	// converting and marked nothing at all.
	for (const [px, name] of sizes) {
		const one = boardEl({
			dataset: { relmapTie: "size", relmapTieValue: String(px), relmapName: name },
			parent: sizeChoices,
		});
		one.focus = () => { one.focused = true; };
		(press.size ??= {})[px] = one;
	}

	// The field for a size nobody offered. A real enough number input: a value, and a focus flag,
	// since `_markSize` has to leave it alone while somebody is standing in it.
	const sizeNum = boardEl({ dataset: { relmapTie: "sizenum" }, parent: sizePop });
	sizeNum.value = "";
	sizeNum.focus = () => { sizeNum.focused = true; };

	const rub = boardEl({ dataset: { relmapTie: "rub" }, parent: bar });

	return {
		root, view, board, bar, words, trigger, mark, word, pop, choices, swatch, preset, mine,
		slots: slotEls, more, picker, press, rub, dashTrigger, dashMark, dashPop,
		sizeTrigger, sizeMark, sizePop, sizeNum,
	};
}

/** Choose a colour of one's own, as the picker's own value setter does it. */
function chooseHex(dom, hex) {
	dom.picker.value = hex;
}

/** Drop the palette, as a reader does: press the answer on the bar. */
function openPop(dom) {
	dom.trigger.emit("click", dom.trigger);
}

/** Choose one of the eight, as a reader does: drop the palette, then press a swatch. */
function chooseInk(dom, value) {
	if (dom.pop.hidden) openPop(dom);
	dom.swatch[value].emit("click", dom.swatch[value]);
}

/** Choose one of the colours already on the board, by the slot it landed in. */
function chooseSlot(dom, at) {
	if (dom.pop.hidden) openPop(dom);
	dom.slots[at].emit("click", dom.slots[at]);
}

/** Choose one of the colours the palette offers that nobody named. */
function choosePreset(dom, hex) {
	if (dom.pop.hidden) openPop(dom);
	dom.preset[hex].emit("click", dom.preset[hex]);
}

/** Drop the three strokes, as a reader does: press the answer on the bar. */
function openDashPop(dom) {
	dom.dashTrigger.emit("click", dom.dashTrigger);
}

/** Choose a stroke, as a reader does: drop the panel, then press a row. */
function chooseDash(dom, value) {
	if (dom.dashPop.hidden) openDashPop(dom);
	dom.press.dash[value].emit("click", dom.press.dash[value]);
}

/** Drop the sizes, as a reader does: press the number on the bar. */
function openSizePop(dom) {
	dom.sizeTrigger.emit("click", dom.sizeTrigger);
}

/** Choose one of the offered sizes: drop the panel, then press a step. */
function chooseSize(dom, px) {
	if (dom.sizePop.hidden) openSizePop(dom);
	dom.press.size[px].emit("click", dom.press.size[px]);
}

/** Type a size of one's own, a keystroke at a time, as a reader does. */
function typeSize(dom, said) {
	dom.sizeNum.value = String(said);
	dom.sizeNum.emit("input", dom.sizeNum);
}

const TIE = {
	edge: { a: "n1", b: "n2", label: "were once a thing", ink: "rose", dir: "a-b", dash: "dotted" },
	from: { name: "Mike", x: 20 },
	to: { name: "Sonya", x: 80 },
	said: { none: "No arrow", both: "Both ways", "a-b": "Arrow towards Sonya", "b-a": "Arrow towards Mike" },
	at: { left: 50, top: 40 },
};

/**
 * A line as the window hands one over: the three points `edgeCurve` draws it from.
 *
 * The control point is the middle unless one is given, which makes a straight run -- and straight
 * is what nearly every case here wants, because what the bar is dodging is the DIRECTION the line
 * leaves its middle in, and a bow does not change that.
 */
const along = (from, to, control = null) => ({
	from,
	to,
	control: control ?? { left: (from.left + to.left) / 2, top: (from.top + to.top) / 2 },
});

function make(dom, over = {}) {
	const handlers = {
		surface: () => ({ painted: () => ({ width: 1000, height: 600 }), offset: { x: 0, y: 0 } }),
		tieAt: vi.fn(() => structuredClone(TIE)),
		onField: vi.fn(),
		onSaying: vi.fn(),
		onRub: vi.fn(),
		onPicked: vi.fn(),
		onNudged: vi.fn(),
		inksInUse: vi.fn(() => []),
		canEdit: () => true,
		...over,
	};
	return { handlers, bar: new RelmapTieBar(dom.root, handlers) };
}

describe("opening the bar on a line", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	it("fills the field with what the line already says", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.words.value).toBe("were once a thing");
		expect(dom.bar.hidden).toBe(false);
	});

	// ⚠ THE WHOLE OF "CLICK A LINE AND START TYPING". A selected field would make the first
	// keystroke DELETE the caption, which is the opposite of what the reader was promised.
	it("puts the caret at the end and selects nothing", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.words.focus).toHaveBeenCalled();
		expect(dom.words.caret).toEqual([17, 17]);
	});

	it("shows the colour, the arrow and the stroke the line already has", () => {
		const { bar } = make(dom);
		bar.open("e1");
		// IN WORDS AND NOT ONLY AS A DISC. Two readers at this table cannot resolve two of the eight
		// against each other, so the bar names the colour as well as showing it -- and the name is
		// read off the palette swatch, since there is no i18n in the module to build one from.
		expect(dom.word.textContent).toBe("Rose");
		expect(dom.trigger.getAttribute("aria-label")).toBe("Colour: Rose");
		expect(dom.press.dir["a-b"].getAttribute("aria-checked")).toBe("true");
		expect(dom.press.dash.dotted.classes).toContain("is-chosen");
		expect(dom.press.dash.solid.classes).not.toContain("is-chosen");
		// AND THE STROKE IS SHOWN ON THE BAR WITHOUT THE PANEL BEING OPENED. The trigger draws the
		// answer: a reader who clicks a line and does not touch the chooser still sees what the
		// stroke is, and a reader not looking at it is told in words.
		expect(dom.dashMark.classes).toContain("stonetop-relmap-tiebar-rule--dotted");
		expect(dom.dashMark.classes).not.toContain("stonetop-relmap-tiebar-rule--solid");
		expect(dom.dashTrigger.getAttribute("aria-label")).toBe("The stroke: dotted line");
	});

	// ⚠ THE CLASS THE TEMPLATE PRINTED HAS TO COME OFF. Two ink classes on the swatch at once is
	// not a swatch in two colours: it is a swatch in whichever the stylesheet happens to declare
	// last, which is a colour nobody chose.
	it("paints the swatch beside it in that colour and no other", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--rose");
		expect(dom.mark.classes).not.toContain("stonetop-relmap-ink--slate");
	});

	// A reader who may only look gets a control that is visibly shut rather than one that opens,
	// takes a press and silently changes nothing -- which reads as a broken control, not a locked
	// map. The trigger is the one that matters: shut, the palette never comes down at all.
	it("locks the colour for a reader who may only look", () => {
		const { bar } = make(dom, { canEdit: () => false });
		bar.open("e1");
		expect(dom.trigger.disabled).toBe(true);
		expect(dom.swatch.slate.disabled).toBe(true);
		expect(dom.more.disabled).toBe(true);
		openPop(dom);
		expect(dom.pop.hidden).toBe(true);
	});

	// ⚠ NEITHER THE WORDS NOR THE ICONS CAN BE WRITTEN IN THE TEMPLATE. Which of the pair is drawn
	// on the left is a fact about where two portraits are sitting, and it changes when either is
	// dragged: a fixed left arrow means "towards Sonya" on one board and "towards Mike" a minute
	// later on the same one.
	it("names the two arrows after the two people", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.press.dir["a-b"].getAttribute("aria-label")).toBe("Arrow towards Sonya");
		expect(dom.press.dir["b-a"].getAttribute("aria-label")).toBe("Arrow towards Mike");
	});

	it("points them the way the line is actually drawn", () => {
		const { bar } = make(dom);
		bar.open("e1");
		// Sonya is to the RIGHT of Mike, so "towards Sonya" is the right-hand arrow.
		expect(dom.press.dir["a-b"].children[0].className).toContain("fa-arrow-right-long");
		expect(dom.press.dir["b-a"].children[0].className).toContain("fa-arrow-left-long");
	});

	it("points them the other way when the two have swapped sides", () => {
		const swapped = { ...structuredClone(TIE), from: { name: "Mike", x: 90 }, to: { name: "Sonya", x: 10 } };
		const { bar } = make(dom, { tieAt: () => swapped });
		bar.open("e1");
		expect(dom.press.dir["a-b"].children[0].className).toContain("fa-arrow-left-long");
		expect(dom.press.dir["b-a"].children[0].className).toContain("fa-arrow-right-long");
	});

	// Nothing else on the board says which of eighty strokes this bar belongs to -- but the board's
	// markup is the WINDOW'S, built and thrown away by it, so the bar asks rather than walking it.
	// What the ask paints is tests/dialogs/relationship-map-window.test.js's business.
	it("asks for the line it is holding to be marked", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		expect(handlers.onPicked).toHaveBeenCalledWith("e1");
	});

	it("asks for the mark to be taken off again when it is let go", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		handlers.onPicked.mockClear();
		bar.close();
		expect(dom.bar.hidden).toBe(true);
		expect(handlers.onPicked).toHaveBeenCalledWith("");
	});

	// \u26a0 NOTHING HELD, NOTHING TO PUT DOWN. Every click on bare board comes through `close`, and
	// a board this bar was never opened over has no mark on it to take off.
	it("asks for nothing when it was not holding a line", () => {
		const { bar, handlers } = make(dom);
		bar.close();
		expect(handlers.onPicked).not.toHaveBeenCalled();
	});

	it("refuses a line that is not on this board", () => {
		const { bar } = make(dom, { tieAt: () => null });
		expect(bar.open("e1")).toBe(false);
		expect(dom.bar.hidden).toBe(true);
	});
});

describe("the presses that act at once", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	it("writes which way the line is read", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.press.dir.both.emit("click", dom.press.dir.both);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { dir: "both" });
	});

	it("writes whether the stroke is broken", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseDash(dom, "solid");
		expect(handlers.onField).toHaveBeenCalledWith("e1", { dash: "solid" });
	});

	// THE MIDDLE ANSWER, and the reason this chooser exists at all: three strokes would have been
	// three 26px presses on a strip that floats over the drawing. Stored and written like the other
	// two -- nothing about it is a special case.
	it("writes the stroke that is broken rather than dotted", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseDash(dom, "dashed");
		expect(handlers.onField).toHaveBeenCalledWith("e1", { dash: "dashed" });
	});

	it("writes nothing at all for a reader who may only look", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		dom.press.dash.solid.emit("click", dom.press.dash.solid);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ A HALF-TYPED CAPTION IS DROPPED, NOT SAVED, and this is the one exit from the bar that
	// does that. Written first, it would be a change recorded a moment before the rub -- so taking
	// the rub back would restore the line and then need a SECOND press to restore its words, off
	// one button. Every other way out of this bar (a blur, another line, the window closing) saves.
	it("throws away what was being typed rather than writing it onto a line it is rubbing out", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "half a sentence";
		dom.words.emit("input", dom.words);
		dom.rub.emit("click", dom.rub);
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(handlers.onRub).toHaveBeenCalledWith("e1");
	});

	// AND IT HAS LET GO BEFORE THE LINE GOES. The bar is chrome in the viewport, so nothing else
	// takes it down: left open, it would float over a board with no line under it and the next
	// press would write to something that is not there.
	it("lets the line go before rubbing it out", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.rub.emit("click", dom.rub);
		expect(dom.bar.hidden).toBe(true);
		expect(handlers.onRub).toHaveBeenCalledWith("e1");
	});

	it("rubs out nothing for a reader who may only look", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		dom.rub.emit("click", dom.rub);
		expect(handlers.onRub).not.toHaveBeenCalled();
	});
});

// ── The palette ─────────────────────────────────────────────────────────────
//
// ⚠ WHY THE WRITES ARE COALESCED AT ALL. Every colour a reader settles on goes to a SHARED
// document and repaints every board at the table -- and the picker fires `change` while it is still
// being used, once per keystroke in its hex field and once per stop of a drag around the system
// dialog. The eight are held back the same way so there is one path for a chosen colour rather
// than two, and the delay is short enough that a mouse pick still lands while the reader is
// looking at it: the bar is painted at once and only the document waits.
describe("the palette", () => {
	let dom;
	beforeEach(() => {
		vi.useFakeTimers();
		dom = barDom();
	});
	afterEach(() => vi.useRealTimers());

	// The palette is a latch: it is only over the board while somebody is actually choosing.
	it("drops on a press and goes away on the next one", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.pop.hidden).toBe(true);
		openPop(dom);
		expect(dom.pop.hidden).toBe(false);
		expect(dom.trigger.getAttribute("aria-expanded")).toBe("true");
		openPop(dom);
		expect(dom.pop.hidden).toBe(true);
		expect(dom.trigger.getAttribute("aria-expanded")).toBe("false");
	});

	// ⚠ THE FOCUS LANDS ON THE ANSWER. A reader changing rose to green wants to be standing on
	// rose, one arrow key from where they are going -- not at the top of a list they have to read
	// through to work out where they already were.
	it("opens standing on the colour the line already has", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		expect(dom.swatch.rose.classes).toContain("is-chosen");
		expect(dom.swatch.rose.focused).toBe(true);
		expect(dom.swatch.slate.classes).not.toContain("is-chosen");
	});

	// SHOWN BEFORE IT IS WRITTEN, as every press on this bar is: the write is a round trip through
	// the document, and a swatch that waited for it would look unpressed for as long as that took.
	it("paints the disc and the word at once, before anything is written", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--slate");
		expect(dom.mark.classes).not.toContain("stonetop-relmap-ink--rose");
		expect(dom.word.textContent).toBe("Slate");
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ AND IT GETS OUT OF THE WAY. The palette hangs over the board and over the presses beside
	// it; one that stayed up after answering its own question would have to be dismissed before the
	// line it covers could be looked at. The focus goes back to the trigger, which now says slate.
	it("puts itself away behind a colour that has been picked", () => {
		const { bar } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		expect(dom.pop.hidden).toBe(true);
		expect(dom.trigger.focused).toBe(true);
	});

	it("writes the colour once the palette goes quiet", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "slate" });
	});

	// The point of the delay: a reader who tries three colours in a breath gets ONE write, of the
	// one they stopped on -- not three broadcasts and three repaints of everybody else's board.
	it("writes once for a run of colours tried in a breath, and only the last of them", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		for (const ink of ["slate", "rose", "slate"]) {
			chooseInk(dom, ink);
			vi.advanceTimersByTime(TIE_INK_DELAY_MS - 1);
		}
		expect(handlers.onField).not.toHaveBeenCalled();
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "slate" });
	});

	// ⚠ A REPAINT INSIDE THE GAP MUST NOT PUT THE CHOICE BACK. The document still has the old
	// colour, and painting it here would take the reader's own pick away under their hand.
	it("keeps a colour just chosen when the board repaints underneath", () => {
		const { bar } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		bar.refresh();
		expect(dom.word.textContent).toBe("Slate");
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--slate");
	});

	// Every ordinary way out of the bar saves, exactly as the caption does.
	it("writes a pending colour when the bar is let go", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		bar.close();
		expect(handlers.onField).toHaveBeenCalledWith("e1", { ink: "slate" });
	});

	// ⚠ AND THE ONE EXIT THAT DOES NOT. A colour chosen a moment before the rub would be a second
	// change recorded against a line that is going away, so taking the rub back would restore the
	// line and then need a second press to restore its colour -- off one button.
	it("throws a pending colour away rather than writing it onto a line it is rubbing out", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseInk(dom, "slate");
		dom.rub.emit("click", dom.rub);
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(handlers.onRub).toHaveBeenCalledWith("e1");
	});

	// The window's repaint asks this. A colour waiting to be written is writing the document has
	// not got, exactly as a half-typed caption is.
	it("holds a repaint off while a colour is still waiting to be written", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(bar.isWriting()).toBe(false);
		chooseInk(dom, "slate");
		expect(bar.isWriting()).toBe(true);
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(bar.isWriting()).toBe(false);
	});

	it("writes nothing at all for a reader who may only look", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		chooseInk(dom, "slate");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ THE ARROWS MOVE THE FOCUS AND WRITE NOTHING, which is what the palette gains by being a row
	// of presses rather than the `select` it was: a keyboard reader crossing the eight used to
	// write every colour they passed onto everybody's board. And the key is stopped as well as
	// taken -- one that reached core's KeyboardManager would pan the scene behind this window.
	it("moves the focus across the palette without choosing anything", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		openPop(dom);
		const ev = dom.bar.emit("keydown", dom.swatch.rose, { key: "ArrowRight" });
		expect(ev.propagationStopped).toBe(true);
		expect(ev.defaultPrevented).toBe(true);
		expect(dom.swatch.slate.focused).toBe(true);
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ DOWN IS A ROW AND NOT A SWATCH, which is the difference between a grid a keyboard reader can
	// cross and one that takes fifty presses to get down. `ACROSS` here is three, so Down from the
	// first swatch lands on the fourth -- and it counts across the WHOLE group, the eight and the
	// presets under them alike, because they are laid out at one width for exactly this reason.
	it("steps down by a row of the grid rather than by one swatch", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.bar.emit("keydown", dom.swatch.rose, { key: "ArrowDown" });
		expect(dom.preset["#ea5d2e"].focused).toBe(true);
		expect(dom.swatch.slate.focused).toBeUndefined();
	});

	// The two rows of presses beside the palette are single rows, where a row and one swatch are the
	// same step. They carry no width of their own, and must not inherit the palette's.
	it("keeps Up and Down to one press in the rows that are not a grid", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.dir.none, { key: "ArrowDown" });
		expect(dom.press.dir["a-b"].focused).toBe(true);
	});

	// ⚠ ONE ESCAPE PUTS AWAY ONE THING. With the palette open the thing the reader means is the
	// palette; one that dismissed the whole bar would throw away the caption they were half way
	// through as well, for a press that meant "not that colour after all".
	it("takes one Escape to close, and leaves the bar standing", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.bar.emit("keydown", dom.swatch.rose, { key: "Escape" });
		expect(dom.pop.hidden).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		expect(dom.trigger.focused).toBe(true);
		// And the second one is the bar's, as it always was.
		dom.bar.emit("keydown", dom.words, { key: "Escape" });
		expect(dom.bar.hidden).toBe(true);
	});

	// It hangs over the arrows and the strokes below it, so a reader reaching past it for one of
	// those has said they are done choosing -- and a panel left covering the control they were
	// aiming at is one they would have to dismiss before they could use the bar at all.
	it("gets out of the way when the reader reaches for anything else on the bar", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.bar.emit("pointerdown", dom.press.dir.none);
		expect(dom.pop.hidden).toBe(true);
	});

	// ⚠ AND THE TRIGGER ITSELF IS SPARED, which is what lets a second press CLOSE the thing. The
	// pointerdown runs before the click that toggles: a close that did not skip the press under the
	// pointer would shut the palette here and let the click open it straight back, so the press a
	// reader means as "never mind" would do nothing at all.
	it("still closes on a second press of the trigger it opened from", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.bar.emit("pointerdown", dom.trigger);
		openPop(dom);
		expect(dom.pop.hidden).toBe(true);
	});
});

// ── The colours already on this board ───────────────────────────────────────
//
// THE SECOND ROW OF THE PALETTE, and the reason it is read off the map rather than remembered per
// reader: a table that has settled on one particular purple wants that purple on the next line too,
// and wants every client at the table offered the same list -- which is exactly what the map itself
// already says, with nothing stored anywhere to say it twice.
// ── The colours nobody named, offered by the handful ────────────────────────
//
// WHAT A PRESET IS, AT THIS LAYER: a hex, stored and drawn exactly as one typed into the picker.
// It differs from a typed colour in three ways the bar is responsible for, and each is a test here.
// It comes with a NAME, so the bar says "Deep jade" and not "#0b724f". It does not spring the hex
// field open, because forty of them a press away is not forty reasons to grow the panel a row. And
// it never needs deepening, because the list is authored above the floor -- so a press on one is
// silent where a pale colour typed into the picker raises a notice.
describe("the colours the palette offers that nobody named", () => {
	let dom;
	beforeEach(() => {
		vi.useFakeTimers();
		dom = barDom();
	});
	afterEach(() => vi.useRealTimers());

	it("draws the line in one at a press, and stores it as the hex it is", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		choosePreset(dom, "#0b724f");
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--custom");
		expect(dom.mark.style["--relmap-ink-raw"]).toBe("#0b724f");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "#0b724f" });
	});

	// ⚠ THE WORD IS THE WHOLE POINT OF NAMING THEM. The names came off the swatches when the palette
	// became a grid; a bar that then said "#0b724f" would have taken the word away from the readers
	// who choose by reading, on forty of the forty-eight colours it offers.
	it("says which colour it is in words, not as a hex", () => {
		const { bar } = make(dom);
		bar.open("e1");
		choosePreset(dom, "#0b724f");
		expect(dom.word.textContent).toBe("Deep jade");
		expect(dom.trigger.getAttribute("aria-label")).toBe("Colour: Deep jade");
	});

	// A colour somebody TYPED still comes back with the picker showing it, which is where they left
	// it. See the suite below, which holds that half.
	it("leaves the hex field shut, unlike a colour typed into it", () => {
		const { bar } = make(dom);
		bar.open("e1");
		choosePreset(dom, "#2295bf");
		expect(dom.picker.hidden).toBe(true);
		openPop(dom);
		expect(dom.picker.hidden).toBe(true);
	});

	// ⚠ NOT A PROMISE ABOUT THIS FAKE'S FOUR COLOURS BUT ABOUT THE PATH: a preset is taken as chosen
	// rather than run back through `deepenInk`, so no press on one can move the colour under the
	// reader or raise the notice that says it has. `RELMAP_INK_PRESETS` is what makes that safe, and
	// tests/relmap/relmap-ink.test.js is where all forty are measured.
	it("is never deepened, and never says it has been", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		choosePreset(dom, "#1c1e22");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onNudged).not.toHaveBeenCalled();
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "#1c1e22" });
	});
});

describe("the colours already on this board", () => {
	let dom;
	beforeEach(() => {
		vi.useFakeTimers();
		dom = barDom();
	});
	afterEach(() => vi.useRealTimers());

	it("fills a slot for each of them, and hides the rest", () => {
		const { bar } = make(dom, { inksInUse: () => ["#7a2f8a", "#1d5f4a"] });
		bar.open("e1");
		openPop(dom);
		expect(dom.mine.hidden).toBe(false);
		expect(dom.slots[0].dataset.relmapTieValue).toBe("#7a2f8a");
		expect(dom.slots[0].style["--relmap-ink-raw"]).toBe("#7a2f8a");
		expect(dom.slots[0].getAttribute("aria-label"))
			.toBe("The colour #7a2f8a, already on this board");
		expect(dom.slots[1].dataset.relmapTieValue).toBe("#1d5f4a");
		expect(dom.slots[2].hidden).toBe(true);
	});

	// ⚠ THE LINE'S OWN COLOUR IS ALWAYS THE FIRST OF THEM, and never twice. A palette with nothing
	// set in it says the line has no colour, and the reader would have to go back through the
	// picker to find the one they are looking at.
	it("puts the line's own colour first, and only once", () => {
		const own = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "#1d5f4a" } };
		const { bar } = make(dom, {
			tieAt: () => own, inksInUse: () => ["#7a2f8a", "#1d5f4a"],
		});
		bar.open("e1");
		openPop(dom);
		expect(dom.slots.map(one => one.dataset.relmapTieValue))
			.toEqual(["#1d5f4a", "#7a2f8a", ""]);
		expect(dom.slots[0].classes).toContain("is-chosen");
	});

	// A board with no colours of its own on it must not show a heading over an empty row.
	it("takes the whole row away when there are none", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		expect(dom.mine.hidden).toBe(true);
		expect(dom.slots.every(one => one.hidden)).toBe(true);
	});

	// ⚠ THIS ROW IS THE COLOURS THE PALETTE DOES NOT ALREADY OFFER. A hex that is one of the presets
	// is on screen already, named, in a fixed place a reader can learn -- repeating it here would
	// say the board had a colour of its own that it has not, and would spend one of the slots
	// saying it. The preset swatch is still what `markChosen` sets, so nothing goes unmarked.
	it("leaves out any colour the grid above already shows", () => {
		const own = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "#2295bf" } };
		const { bar } = make(dom, {
			tieAt: () => own, inksInUse: () => ["#2295bf", "#7a2f8a", "#0b724f"],
		});
		bar.open("e1");
		openPop(dom);
		expect(dom.slots.map(one => one.dataset.relmapTieValue)).toEqual(["#7a2f8a", "", ""]);
		expect(dom.preset["#2295bf"].classes).toContain("is-chosen");
	});

	// The row goes away entirely for a board drawn only in colours the palette offers.
	it("takes the row away when every colour on the board is one of them", () => {
		const { bar } = make(dom, { inksInUse: () => ["#2295bf", "#0b724f"] });
		bar.open("e1");
		openPop(dom);
		expect(dom.mine.hidden).toBe(true);
	});

	// ⚠ AND AN EMPTY SLOT IS NOT IN THE GROUP. `markChosen` and `_groupKey` both leave hidden
	// buttons out, so the arrow keys cannot strand the group's one tab stop on a button nobody can
	// see -- which is a radiogroup a keyboard reader can no longer get into.
	it("does not let the arrow keys land on an empty slot", () => {
		const { bar } = make(dom, { inksInUse: () => ["#7a2f8a"] });
		bar.open("e1");
		openPop(dom);
		// Off the end of the last swatch that is actually there, and round to the first.
		dom.bar.emit("keydown", dom.slots[0], { key: "ArrowDown" });
		expect(dom.slots[1].focused).toBeUndefined();
		expect(dom.swatch.rose.focused).toBe(true);
	});

	it("draws the line in one of them at a press", () => {
		const { bar, handlers } = make(dom, { inksInUse: () => ["#7a2f8a"] });
		bar.open("e1");
		chooseSlot(dom, 0);
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--custom");
		expect(dom.mark.style["--relmap-ink-raw"]).toBe("#7a2f8a");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "#7a2f8a" });
	});

	// ⚠ ASKED ONLY WHILE THE PALETTE IS SHOWING. `_markInk` runs on every repaint of every board at
	// the table, and this handler reads the whole map's graph through the sanitiser: asked from
	// there it would walk forty people's worth of lines to fill a row nobody can see.
	it("is not asked for on every repaint of the board", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		bar.refresh();
		expect(handlers.inksInUse).not.toHaveBeenCalled();
		openPop(dom);
		expect(handlers.inksInUse).toHaveBeenCalled();
	});
});

// ── Where the palette hangs ─────────────────────────────────────────────────
//
// ⚠ IT MEASURES, WHICH IS WHY IT IS NOT IN `place()`. That one runs on every painted frame of a pan
// and may not read the layout at all; this runs when the palette opens and when the board has been
// repainted under it. The offsets are the BAR'S OWN, because the palette is placed absolutely
// inside it -- which is also what carries it along on every frame `place()` does move.
describe("where the palette hangs", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	/** A viewport, a bar in it, and a palette of a given size. */
	function measured({ bar, pop, trigger, view }) {
		dom.view.rect = view;
		dom.bar.rect = bar;
		dom.pop.rect = pop;
		dom.trigger.rect = trigger;
	}

	it("hangs under the bar and lines up with the trigger", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 400 },
			bar: { left: 100, top: 60, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 150, top: 66, width: 90, height: 26 },
		});
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		// Under the bar, and aligned with the trigger 50px along it.
		expect(dom.pop.style.top).toBe("44px");
		expect(dom.pop.style.left).toBe("50px");
		expect(dom.pop.classes).not.toContain("is-above");
	});

	// A line near the foot of the board: the palette goes over the bar rather than off the window,
	// where half of it would be unreachable.
	it("turns over when there is no room underneath", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 300 },
			bar: { left: 100, top: 250, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 150, top: 256, width: 90, height: 26 },
		});
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		expect(dom.pop.style.top).toBe("-206px");
		expect(dom.pop.classes).toContain("is-above");
	});

	// A bar dragged up against the right edge would otherwise hang its palette off the side.
	it("is clamped into the viewport rather than off the right of it", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 400 },
			bar: { left: 100, top: 60, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 400, top: 66, width: 90, height: 26 },
		});
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		// 500 - 180 - 6 = 314 on screen, which is 214 along a bar that starts at 100.
		expect(dom.pop.style.left).toBe("214px");
	});

	// ⚠ THE SIDE THE BAR ITSELF CHOSE. The bar is kept clear of the stroke it is editing; a palette
	// dropped on the wrong side of it puts two hundred pixels of swatches straight back over that
	// stroke. What it covers instead is the bar's own writing field, which nobody is typing into
	// while the palette holds the focus.
	it("turns over to keep off the line the bar is sitting above", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 600 },
			bar: { left: 100, top: 250, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 150, top: 256, width: 90, height: 26 },
		});
		// The line's middle is at 40% of 600, with room above it: the bar sits above the line, so
		// the palette goes above the bar -- though there is room for it underneath as well.
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		expect(dom.pop.style.top).toBe("-206px");
		expect(dom.pop.classes).toContain("is-above");
	});

	it("hangs underneath when the bar is sitting under its line", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 600 },
			bar: { left: 100, top: 250, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 150, top: 256, width: 90, height: 26 },
		});
		// A line at 2% has no room above it, so the bar went underneath -- and so does the palette.
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), at: { left: 50, top: 2 } }),
		});
		bar.open("e1");
		openPop(dom);
		expect(dom.pop.style.top).toBe("44px");
		expect(dom.pop.classes).not.toContain("is-above");
	});

	// ⚠ RE-AIMED AND NOT SHUT. Somebody else at the table moving a portrait can carry this bar half
	// a board, and a palette measured against where it used to be would be pointing at nothing.
	// Closing it instead would take the question away mid-answer, over a change the reader had
	// nothing to do with -- the same promise `refresh` makes to the half-typed caption.
	it("is re-aimed by a repaint, not put away by one", () => {
		measured({
			view: { left: 0, top: 0, width: 500, height: 400 },
			bar: { left: 100, top: 60, width: 200, height: 38 },
			pop: { left: 0, top: 0, width: 180, height: 200 },
			trigger: { left: 150, top: 66, width: 90, height: 26 },
		});
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.bar.rect = { left: 20, top: 60, width: 200, height: 38 };
		dom.trigger.rect = { left: 70, top: 66, width: 90, height: 26 };
		bar.refresh();
		expect(dom.pop.hidden).toBe(false);
		expect(dom.pop.style.left).toBe("50px");
	});
});

describe("what is typed into the caption", () => {
	let dom;
	beforeEach(() => {
		vi.useFakeTimers();
		dom = barDom();
	});
	afterEach(() => vi.useRealTimers());

	// A WRITE PER KEYSTROKE IS A BROADCAST PER KEYSTROKE, and every client at the table repaints
	// its board on each one.
	it("writes nothing while the letters are still arriving", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		for (const said of ["w", "we", "wed"]) {
			dom.words.value = said;
			dom.words.emit("input", dom.words);
			vi.advanceTimersByTime(TIE_WRITE_DELAY_MS - 1);
		}
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	it("writes once the field goes quiet", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed in secret";
		dom.words.emit("input", dom.words);
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { label: "wed in secret" });
	});

	it("writes at once on Enter, without waiting out the timer", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed in secret";
		dom.words.emit("input", dom.words);
		dom.bar.emit("keydown", dom.words, { key: "Enter" });
		expect(handlers.onField).toHaveBeenCalledWith("e1", { label: "wed in secret" });
	});

	// The way out of a sentence somebody has thought better of. One that saved would leave none.
	it("puts back what the line said when Escape is pressed", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "something regretted";
		dom.words.emit("input", dom.words);
		dom.bar.emit("keydown", dom.words, { key: "Escape" });
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(dom.words.value).toBe("were once a thing");
		expect(dom.bar.hidden).toBe(true);
	});

	// ⚠ CORE'S KeyboardManager BINDS keydown IN THE BUBBLE PHASE AND NEVER LOOKS AT
	// `defaultPrevented`. An Escape meant for this bar closes the whole window as well, and the
	// arrows inside the field pan the scene behind it.
	it("keeps its keys away from the scene behind the window", () => {
		const { bar } = make(dom);
		bar.open("e1");
		for (const key of ["Escape", "Enter", "ArrowLeft", "Delete"]) {
			const ev = dom.bar.emit("keydown", dom.words, { key });
			expect(ev.propagationStopped).toBe(true);
			bar.open("e1");
		}
	});

	// Clicking straight from one line to another must not throw the sentence away silently.
	it("writes what was typed before moving to another line", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed in secret";
		dom.words.emit("input", dom.words);
		bar.open("e2");
		expect(handlers.onField).toHaveBeenCalledWith("e1", { label: "wed in secret" });
	});

	it("says nothing when the words have not changed", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		bar.flush();
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// The window's repaint asks this, and it is the affirmative guard the old `_isBusy` note said
	// to add if a text field ever landed here: about unsaved WRITING, never about focus.
	it("holds a repaint off only while there is writing the document has not got", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(bar.isWriting()).toBe(false);
		dom.words.value = "wed in secret";
		dom.words.emit("input", dom.words);
		expect(bar.isWriting()).toBe(true);
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS);
		expect(bar.isWriting()).toBe(false);
	});

	// ⚠ THE PAINT AND THE WRITE ARE TWO DIFFERENT THINGS AND HAVE TWO DIFFERENT CLOCKS. There is
	// no text box on this bar: the field is clipped off it and the LINE is where a reader sees
	// their sentence, so every keystroke has to reach the board at once -- while the write it will
	// eventually cause still waits out the delay, because a write is a repaint of every board at
	// the table.
	it("puts every keystroke on the line at once, and writes none of them", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		for (const said of ["w", "we", "wed"]) {
			dom.words.value = said;
			dom.words.emit("input", dom.words);
		}
		expect(handlers.onSaying.mock.calls).toEqual([["e1", "w"], ["e1", "we"], ["e1", "wed"]]);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// What is being thrown away is on the BOARD, not in a box a reader can see emptied.
	it("puts the line back to what the document says when Escape is pressed", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "something regretted";
		dom.words.emit("input", dom.words);
		dom.bar.emit("keydown", dom.words, { key: "Escape" });
		expect(handlers.onSaying).toHaveBeenLastCalledWith("e1", "were once a thing");
	});

	// ⚠ A CLICK ON ANY PRESS TAKES THE FOCUS OFF THE FIELD, and the field cannot be seen. Without
	// this, choosing a colour and carrying on with the sentence would type into a button: nothing
	// on the line, nothing in a box, no clue why.
	it("takes a letter typed while a press has the focus and puts it on the line", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed";
		const ev = dom.bar.emit("keydown", dom.press.dir.none, { key: "!" });
		expect(dom.words.value).toBe("wed!");
		expect(dom.words.focus).toHaveBeenCalled();
		expect(handlers.onSaying).toHaveBeenLastCalledWith("e1", "wed!");
		expect(ev.defaultPrevented).toBe(true);
	});

	it("rubs a letter out from a press as well", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed";
		dom.bar.emit("keydown", dom.press.dir.none, { key: "Backspace" });
		expect(dom.words.value).toBe("we");
		expect(handlers.onSaying).toHaveBeenLastCalledWith("e1", "we");
	});

	// ⚠ NEVER SPACE, and it is the one deliberate hole in that promise. These are `role="radio"`
	// buttons and Space is how a keyboard reader presses one; a space that ran off to the caption
	// would take the palette, the arrows and the strokes away from them entirely.
	it("leaves Space to the press it was aimed at", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed";
		dom.bar.emit("keydown", dom.press.dir.none, { key: " " });
		expect(dom.words.value).toBe("wed");
		expect(handlers.onSaying).not.toHaveBeenCalled();
	});

	// Ctrl+Z is the board's undo, not a letter.
	it("leaves a modified key alone", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed";
		dom.bar.emit("keydown", dom.press.dir.none, { key: "z", ctrlKey: true });
		expect(dom.words.value).toBe("wed");
		expect(handlers.onSaying).not.toHaveBeenCalled();
	});

	// A repaint rebuilds the board from the DOCUMENT, so the caption under this bar goes back to
	// what was last saved -- which, mid-sentence, is a reader watching their own words vanish
	// because somebody at the far end of the table moved a portrait.
	it("puts a half-typed sentence back on the line when the board repaints under it", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.words.value = "wed in sec";
		dom.words.emit("input", dom.words);
		handlers.onSaying.mockClear();
		bar.refresh();
		expect(handlers.onSaying).toHaveBeenCalledWith("e1", "wed in sec");
	});

	// AND NOT OTHERWISE. A reader who has typed nothing must not have a stale field painted over a
	// caption somebody else has just changed -- the same promise `refresh` makes by not refilling
	// the field.
	it("leaves a repainted caption alone when there is nothing unsaved to put back", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		bar.refresh();
		expect(handlers.onSaying).not.toHaveBeenCalled();
	});
});

// ── A colour of the reader's own ────────────────────────────────────────────
//
// THE NINTH ANSWER, and the two things about it that are not like the eight. It is not chosen from
// the palette -- the `+` under it OPENS the picker -- and what the reader picks is not necessarily
// what gets drawn: a colour under 3:1 against this paper cannot be followed by the reader at this
// table on a magnifier, so it is deepened along its own hue and the bar says so. Neither of those
// is visible from the outside, which is why they are pinned here.
describe("a colour of the reader's own", () => {
	let dom;
	beforeEach(() => {
		vi.useFakeTimers();
		dom = barDom();
	});
	afterEach(() => vi.useRealTimers());

	it("keeps the picker away for a line drawn in one of the eight", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.picker.hidden).toBe(true);
		expect(dom.word.textContent).toBe("Rose");
	});

	it("shows the picker, holding the colour, for a line that has one of its own", () => {
		const own = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "#a1263a" } };
		const { bar } = make(dom, { tieAt: () => own });
		bar.open("e1");
		expect(dom.picker.hidden).toBe(false);
		expect(dom.picker.value).toBe("#a1263a");
		// The disc has no token to point at for a colour nobody named, so it is written inline --
		// and the word is the hex itself, which is the only name that colour has.
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--custom");
		expect(dom.mark.style["--relmap-ink-raw"]).toBe("#a1263a");
		expect(dom.word.textContent).toBe("#a1263a");
	});

	// ⚠ PAINTING IS NOT CHOOSING. Filling the picker in fires the same event the reader's own pick
	// does; without `_paintingInk` simply opening a line would write its own colour straight back
	// to the document, on every open and every repaint at the far end of the table.
	it("writes nothing when it is only filling the picker in", () => {
		const own = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "#a1263a" } };
		const { bar, handlers } = make(dom, { tieAt: () => own });
		bar.open("e1");
		bar.refresh();
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// The `+` is a question, not an answer: it opens the picker and changes nothing. A line that
	// went black the moment somebody looked inside would be one nobody could open.
	it("opens the picker without touching the line", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		openPop(dom);
		dom.more.emit("click", dom.more);
		expect(dom.picker.hidden).toBe(false);
		expect(dom.picker.focused).toBe(true);
		// AND THE PALETTE STAYS DOWN. The picker is inside it, and the reader is not finished:
		// they may be half way round the system colour dialog.
		expect(dom.pop.hidden).toBe(false);
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ IT OPENS ON THE COLOUR THE LINE IS ALREADY WEARING, and that is not a nicety. A picker that
	// came up holding black would be asking a reader who wants "this rose, but a little deeper" to
	// find their way back to rose first. The colour is read off the DOCUMENT rather than from a
	// table in here, so it is the colour actually on the board -- including the deeper one the
	// high-contrast skin paints, which is what that reader is looking at.
	it("opens the picker on the colour the line is already wearing", () => {
		const had = { doc: globalThis.document, css: globalThis.getComputedStyle };
		globalThis.document = { documentElement: {} };
		globalThis.getComputedStyle = () => ({
			getPropertyValue: name => (name === "--st-relmap-ink-rose" ? "hsl(340deg 62% 60%)" : ""),
		});
		try {
			const { bar } = make(dom);
			bar.open("e1");
			openPop(dom);
			dom.more.emit("click", dom.more);
			// Against `resolveInkHex` and not a hex written out here: this palette is retunable on
			// purpose, and a copy of rose in this file would be a second place to remember.
			expect(dom.picker.value).toBe(resolveInkHex("rose"));
			expect(dom.picker.value).toMatch(/^#[0-9a-f]{6}$/);
		} finally {
			globalThis.document = had.doc;
			globalThis.getComputedStyle = had.css;
		}
	});

	it("writes a colour that reads, once the picker goes quiet", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseHex(dom, "#a1263a");
		expect(handlers.onField).not.toHaveBeenCalled();
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "#a1263a" });
	});

	// ⚠ THE COLOUR THAT WAS USED IS THE COLOUR THAT IS SHOWN. A picker still displaying the pale
	// yellow while the board draws a dark one is the bar lying about what it did.
	it("deepens a colour too pale to follow, says so, and shows what it used", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseHex(dom, "#ffe680");
		expect(handlers.onNudged).toHaveBeenCalled();
		const [chose, used] = handlers.onNudged.mock.calls[0];
		expect(chose).toBe("#ffe680");
		expect(used).not.toBe("#ffe680");
		expect(dom.picker.value).toBe(used);
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: used });
	});

	// A reader typing a hex by hand is mid-word for most of it, and every one of those keystrokes
	// arrives here. Ignored rather than complained about: they have not finished.
	it("says nothing about a hex that is still being typed", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseHex(dom, "#a12");
		chooseHex(dom, "#a126");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onNudged).not.toHaveBeenCalled();
		// "#a12" IS a colour -- the three-digit form -- so that one is taken and the half-finished
		// four-character one is not. What must never happen is a write of something that is neither.
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { ink: "#aa1122" });
	});

	it("is locked, like everything else on the bar, for a reader who may only look", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		expect(dom.picker.disabled).toBe(true);
		chooseHex(dom, "#a1263a");
		vi.advanceTimersByTime(TIE_INK_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// Choosing one of the eight after all puts the picker away and takes the inline colour off the
	// disc -- which would otherwise go on showing the custom colour under the new ink's class.
	it("puts the picker away again when a named colour is chosen", () => {
		const own = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "#a1263a" } };
		const { bar } = make(dom, { tieAt: () => own });
		bar.open("e1");
		chooseInk(dom, "slate");
		expect(dom.picker.hidden).toBe(true);
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--slate");
		expect(dom.mark.classes).not.toContain("stonetop-relmap-ink--custom");
		expect(dom.mark.style["--relmap-ink-raw"]).toBeUndefined();
		expect(dom.word.textContent).toBe("Slate");
	});
});

// ── The stroke ──────────────────────────────────────────────────────────────
//
// THE SECOND QUESTION ASKED IN A PANEL RATHER THAN IN A ROW, and for the same reason the colour is:
// three 26px presses is a quarter of a strip that floats over the very drawing the table is
// reading, standing open all evening for the question they ask least of the four.
//
// WHAT THIS FILE IS FOR, HERE. The panel machinery is shared with the palette and everything above
// already covers it once -- so what is tested here is the half that is NOT shared: that the trigger
// says which stroke the line has, in a shape and in words; that a press writes and closes; and that
// only one of the two panels is ever open, which is the thing that breaks the moment there are two.
describe("the stroke", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	// The panel is a question, not an answer: opening it changes nothing about the line.
	it("opens without touching the line", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		openDashPop(dom);
		expect(dom.dashPop.hidden).toBe(false);
		expect(dom.dashTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ THE FOCUS LANDS ON THE ANSWER, not at the top of the list. A reader changing dotted to
	// dashed wants to be standing on dotted, one arrow key from where they are going.
	it("puts the focus on the stroke the line already has", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openDashPop(dom);
		expect(dom.press.dash.dotted.focused).toBe(true);
	});

	// ⚠ WRITTEN STRAIGHT THROUGH, unlike the colour beside it: a colour arrives from a picker that
	// fires per keystroke, and there are three strokes and each is one press.
	it("writes at once and puts the panel away behind it", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseDash(dom, "dashed");
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { dash: "dashed" });
		expect(dom.dashPop.hidden).toBe(true);
		// The focus goes back to the trigger, which by then draws the stroke they picked: a focus
		// left on a hidden button is a keyboard reader dropped at the top of the window.
		expect(dom.dashTrigger.focused).toBe(true);
	});

	// ⚠ PAINTED BEFORE THE WRITE, as every press on this bar is. The write is a round trip through
	// the document and comes back as a repaint; a trigger that waited would sit there looking
	// unpressed for as long as that took.
	it("draws and names the chosen stroke on the bar without waiting for the write", () => {
		const { bar } = make(dom, { onField: vi.fn(() => new Promise(() => {})) });
		bar.open("e1");
		chooseDash(dom, "dashed");
		expect(dom.dashMark.classes).toContain("stonetop-relmap-tiebar-rule--dashed");
		expect(dom.dashMark.classes).not.toContain("stonetop-relmap-tiebar-rule--dotted");
		expect(dom.dashTrigger.getAttribute("aria-label")).toBe("The stroke: dashed line");
		expect(dom.dashTrigger.getAttribute("data-tooltip")).toBe("The stroke: dashed line");
	});

	// A reader who may only look gets a control that is visibly shut rather than one that opens,
	// takes a press and silently changes nothing -- which reads as a broken control, not a locked map.
	it("is locked for a reader who may only look", () => {
		const { bar } = make(dom, { canEdit: () => false });
		bar.open("e1");
		expect(dom.dashTrigger.disabled).toBe(true);
		expect(dom.press.dash.dashed.disabled).toBe(true);
		openDashPop(dom);
		expect(dom.dashPop.hidden).toBe(true);
	});

	// ⚠ ONE AT A TIME. Both hang from presses a thumb apart and both are wider than the press they
	// hang from, so two open at once is one lying underneath the other -- with a radiogroup in each,
	// and the reader's focus in whichever they cannot see.
	it("puts the palette away when it opens, and the other way about", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		openDashPop(dom);
		expect(dom.pop.hidden).toBe(true);
		expect(dom.dashPop.hidden).toBe(false);
		expect(dom.trigger.getAttribute("aria-expanded")).toBe("false");
		openPop(dom);
		expect(dom.dashPop.hidden).toBe(true);
		expect(dom.pop.hidden).toBe(false);
	});

	// One Escape puts away one thing, whichever thing is open, and leaves the bar standing.
	it("takes one Escape to close, and leaves the bar standing", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openDashPop(dom);
		dom.bar.emit("keydown", dom.press.dash.solid, { key: "Escape" });
		expect(dom.dashPop.hidden).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		expect(dom.dashTrigger.focused).toBe(true);
	});

	// A DIFFERENT LINE IS A DIFFERENT QUESTION: a panel left standing from the last one would be
	// open over an answer it is no longer showing.
	it("closes when the bar takes hold of another line", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openDashPop(dom);
		bar.open("e2");
		expect(dom.dashPop.hidden).toBe(true);
	});

	// A stored stroke this build does not know about -- a board written by a newer version -- is
	// drawn whole rather than leaving the trigger showing nothing and the group with no tab stop.
	it("falls back to a whole stroke for an answer it does not offer", () => {
		const odd = { ...structuredClone(TIE), edge: { ...TIE.edge, dash: "squiggly" } };
		const { bar } = make(dom, { tieAt: () => odd });
		bar.open("e1");
		expect(dom.dashMark.classes).toContain("stonetop-relmap-tiebar-rule--solid");
		expect(dom.press.dash.solid.classes).toContain("is-chosen");
	});
});

// ── The keyboard ────────────────────────────────────────────────────────────
//
// ⚠ ONE TAB STOP PER GROUP, NOT ONE PER PRESS. Left as ordinary buttons, every press on this bar
// would be a stop between the board and whatever comes after it, on a strip a reader arrives at by
// clicking a line -- the worst place in the window to lose somebody. A radiogroup is one stop with
// the arrows inside it, and that is only true if exactly one button per group carries the stop.
describe("moving about the bar without a mouse", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	it("gives each group exactly one tab stop, on the answer it is set to", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.press.dash.dotted.getAttribute("tabindex")).toBe("0");
		expect(dom.press.dash.solid.getAttribute("tabindex")).toBe("-1");
		expect(dom.press.dir["a-b"].getAttribute("tabindex")).toBe("0");
		expect(dom.press.dir.none.getAttribute("tabindex")).toBe("-1");
	});

	it("moves the stop when a different answer is pressed", () => {
		const { bar } = make(dom);
		bar.open("e1");
		chooseDash(dom, "solid");
		expect(dom.press.dash.solid.getAttribute("tabindex")).toBe("0");
		expect(dom.press.dash.dotted.getAttribute("tabindex")).toBe("-1");
	});

	it("walks the arrow keys along one group", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.dir["a-b"], { key: "ArrowRight" });
		expect(dom.press.dir["b-a"].focused).toBe(true);
		expect(dom.press.dir["b-a"].getAttribute("tabindex")).toBe("0");
		expect(dom.press.dir["a-b"].getAttribute("tabindex")).toBe("-1");
	});

	// Running off the end and stopping feels like the control has jammed.
	it("wraps round the end of a group", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.dir.none, { key: "ArrowLeft" });
		expect(dom.press.dir.both.focused).toBe(true);
	});

	// ⚠ EVERY ONE OF THESE PRESSES WRITES TO A SHARED DOCUMENT. "Selection follows focus", which is
	// what a plain radio group does, would mean arrowing across a group wrote every answer on the
	// way past onto everybody's board. The reader chooses with Space or Enter, which the button
	// does for itself. (The colour chooser is a select and cannot; see TIE_INK_DELAY_MS.)
	it("writes nothing on the way past", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.dir["a-b"], { key: "ArrowRight" });
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// An arrow that reached core's KeyboardManager would pan the scene behind this window.
	it("keeps the arrow away from the scene behind the window", () => {
		const { bar } = make(dom);
		bar.open("e1");
		const ev = dom.bar.emit("keydown", dom.press.dir["a-b"], { key: "ArrowRight" });
		expect(ev.defaultPrevented).toBe(true);
		expect(ev.propagationStopped).toBe(true);
	});

	// The arrows inside the CAPTION move the caret and are nobody else's business.
	it("leaves the arrows alone inside the writing field", () => {
		const { bar } = make(dom);
		bar.open("e1");
		const ev = dom.bar.emit("keydown", dom.words, { key: "ArrowRight" });
		expect(ev.defaultPrevented).toBe(false);
		expect(dom.press.dir["b-a"].focused).toBeFalsy();
	});
});

describe("a repaint underneath the bar", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	// ⚠ `is-picked` IS A CLASS ON MARKUP THE REPAINT HAS JUST THROWN AWAY. Without this the bar
	// goes on floating over a picture with nothing on it saying which line it belongs to, and the
	// reader's next press writes to a line they can no longer see they chose. The class itself is
	// the window's to write; what has to happen here is that the bar ASKS again, every repaint.
	it("asks for the mark on its line again", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		handlers.onPicked.mockClear();
		bar.refresh();
		expect(handlers.onPicked).toHaveBeenCalledWith("e1");
	});

	it("shows a colour somebody else changed at the far end of the table", () => {
		const changed = { ...structuredClone(TIE), edge: { ...TIE.edge, ink: "slate" } };
		const { bar } = make(dom, { tieAt: vi.fn().mockReturnValueOnce(structuredClone(TIE)).mockReturnValue(changed) });
		bar.open("e1");
		bar.refresh();
		expect(dom.word.textContent).toBe("Slate");
		expect(dom.mark.classes).toContain("stonetop-relmap-ink--slate");
	});

	// ⚠ AND NEVER THE FIELD. Somebody else renaming this line while it is open is a real thing, and
	// the reader typing here has the newer sentence: replacing what is under their caret is the one
	// outcome nobody would forgive.
	it("leaves the half-typed caption exactly where it is", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.words.value = "half a sen";
		bar.refresh();
		expect(dom.words.value).toBe("half a sen");
	});

	it("lets go of a line somebody else has rubbed out", () => {
		const gone = vi.fn().mockReturnValueOnce(structuredClone(TIE)).mockReturnValue(null);
		const { bar } = make(dom, { tieAt: gone });
		bar.open("e1");
		bar.refresh();
		expect(bar.isOpen).toBe(false);
		expect(dom.bar.hidden).toBe(true);
	});
});

describe("where the bar floats", () => {
	let dom;
	beforeEach(() => {
		dom = barDom();
		dom.view.rect = { left: 0, top: 0, width: 800, height: 600 };
		dom.bar.rect = { left: 0, top: 0, width: 400, height: 30 };
	});

	// ABOVE the line, because the caption is drawn IN the stroke and a bar over it would cover the
	// thing being edited. Centred on the line's own middle.
	it("sits centred above the line", () => {
		const { bar } = make(dom);
		bar.open("e1");
		// 50% of a 1000px board is 500; the bar is 400 wide, so its left edge is 300.
		expect(dom.bar.style.left).toBe("300px");
		// 40% of 600 is 240, less the bar's own 30 and the 14px gap.
		expect(dom.bar.style.top).toBe("196px");
	});

	it("follows the board when it is panned", () => {
		const { bar } = make(dom, {
			surface: () => ({ painted: () => ({ width: 1000, height: 600 }), offset: { x: 40, y: 0 } }),
		});
		bar.open("e1");
		expect(dom.bar.style.left).toBe("340px");
	});

	// ⚠ AN UNMEASURED SURFACE STILL ANSWERS THE QUESTION. `viewSize` is a getter that hands back a
	// pair whether or not the surface has ever been measured, so a bar that tested the OBJECT
	// rather than the number took {0, 0} for the viewport and clamped itself into the corner of the
	// board it was supposed to be floating over.
	it("measures the viewport itself when the surface has not been measured", () => {
		const { bar } = make(dom, {
			surface: () => ({
				painted: () => ({ width: 1000, height: 600 }),
				offset: { x: 0, y: 0 },
				viewSize: { width: 0, height: 0 },
			}),
		});
		bar.open("e1");
		expect(dom.bar.style.left).toBe("300px");
		expect(dom.bar.style.top).toBe("196px");
	});

	// A line at the edge of a board dragged half off screen still has a bar the reader can reach.
	it("is clamped into the viewport rather than drawn off it", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), at: { left: 99, top: 2 } }),
		});
		bar.open("e1");
		expect(dom.bar.style.left).toBe("394px");
		// No room above at 2%, so it goes underneath the line instead.
		expect(dom.bar.style.top).toBe("26px");
	});

	// ⚠ THE ONE PROMISE THIS PLACEMENT MAKES. A bar whose box has the line's middle inside it is
	// sitting on the caption being typed into it, and the vertical clamp used to put it there: a
	// wrapped bar in a short board was pushed off the foot, pulled back by the clamp, and landed
	// squarely across its own line. It hangs off the board now instead.
	it("hangs off the board rather than sitting across its line", () => {
		dom.view.rect = { left: 0, top: 0, width: 800, height: 120 };
		dom.bar.rect = { left: 0, top: 0, width: 400, height: 90 };
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), at: { left: 50, top: 10 } }),
		});
		bar.open("e1");
		// 10% of 600 is 60, and neither side of it has room for ninety pixels of bar. Above by the
		// tie, which puts its foot at 46 -- above the line rather than through it.
		expect(dom.bar.style.top).toBe("-44px");
	});

	// A line dragged off the FOOT of the viewport: the bar comes up into view, and stops above the
	// line rather than being pulled down onto it.
	it("is pulled up into view when its line is off the bottom", () => {
		dom.view.rect = { left: 0, top: 0, width: 800, height: 300 };
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), at: { left: 50, top: 95 } }),
		});
		bar.open("e1");
		// 300 less the bar's 30 and the 6px margin, and 570 -- where the line is -- is well below it.
		expect(dom.bar.style.top).toBe("264px");
	});

	// And the other way about: a board panned so the line is off the TOP. The bar comes down into
	// view, and stops below the line.
	it("is pushed down into view when its line is off the top", () => {
		dom.view.rect = { left: 0, top: 0, width: 800, height: 300 };
		const { bar } = make(dom, {
			surface: () => ({ painted: () => ({ width: 1000, height: 600 }), offset: { x: 0, y: -300 } }),
		});
		bar.open("e1");
		// The line's middle is at -60; the bar sits at the top margin, which is underneath it.
		expect(dom.bar.style.top).toBe("6px");
	});

	// ⚠ ABOVE IS ONLY CLEAR OF A LINE THAT RUNS ACROSS. The stroke the bar is editing is a whole
	// line and not the one point it floats over, and the seat above that point is a seat the line
	// itself may run straight through.
	it("keeps the seat above a line that runs level", () => {
		const { bar } = make(dom, {
			tieAt: () => ({
				...structuredClone(TIE),
				curve: along({ left: 20, top: 40 }, { left: 80, top: 40 }),
			}),
		});
		bar.open("e1");
		// The line is at 240 and the bar's foot at 226: nothing to dodge, so it sits where it always did.
		expect(dom.bar.style.left).toBe("300px");
		expect(dom.bar.style.top).toBe("196px");
	});

	// ⚠ THE CASE THE OLD PLACEMENT COULD NOT SEE. A vertical link has its whole top half directly
	// above its own middle, so "above the middle" put the bar squarely across the stroke -- and
	// underneath was no better. Sideways is the only seat that clears it.
	it("moves beside a line that runs straight up through it", () => {
		const { bar } = make(dom, {
			tieAt: () => ({
				...structuredClone(TIE),
				curve: along({ left: 50, top: 10 }, { left: 50, top: 70 }),
			}),
		});
		bar.open("e1");
		// The bar's 400 and the 14px gap back from the line at 500, and level with it.
		expect(dom.bar.style.left).toBe("86px");
		expect(dom.bar.style.top).toBe("225px");
	});

	// A bar as wide as the window has nowhere sideways to go, and a line up through it crosses every
	// seat there is. It takes the first one anyway: a bar that refused to appear would be a line
	// that cannot be edited at all.
	it("takes the seat it would have had when the line crosses every one", () => {
		dom.bar.rect = { left: 0, top: 0, width: 800, height: 30 };
		const { bar } = make(dom, {
			tieAt: () => ({
				...structuredClone(TIE),
				curve: along({ left: 50, top: 10 }, { left: 50, top: 70 }),
			}),
		});
		bar.open("e1");
		expect(dom.bar.style.left).toBe("6px");
		expect(dom.bar.style.top).toBe("196px");
	});

	// A caller that hands over no curve gets the seating this bar has always had. Every other test
	// in this file is that caller, which is the point: the dodge is an addition, not a rewrite.
	it("seats itself off the middle alone when no line is offered", () => {
		const { bar } = make(dom, { tieAt: () => ({ ...structuredClone(TIE), curve: null }) });
		bar.open("e1");
		expect(dom.bar.style.left).toBe("300px");
		expect(dom.bar.style.top).toBe("196px");
	});

	// ⚠ AND THE STROKE IT DODGES IS RE-CUT ON A REPAINT. Somebody dragging either face re-bows this
	// line, and a bar keeping off where the line used to run is a bar sitting on where it runs now.
	it("re-reads the line when the board is repainted under it", () => {
		const level = { ...structuredClone(TIE), curve: along({ left: 20, top: 40 }, { left: 80, top: 40 }) };
		const upright = { ...structuredClone(TIE), curve: along({ left: 50, top: 10 }, { left: 50, top: 70 }) };
		const { bar } = make(dom, { tieAt: vi.fn().mockReturnValueOnce(level).mockReturnValue(upright) });
		bar.open("e1");
		expect(dom.bar.style.top).toBe("196px");
		bar.refresh();
		expect(dom.bar.style.left).toBe("86px");
		expect(dom.bar.style.top).toBe("225px");
	});
});

// HOW BIG THE WRITING ON A LINE IS SET: five steps and a field.
//
// WHAT THIS BLOCK IS ACTUALLY FOR is the two ways this question differs from the four beside it.
// The answer may be a number NOBODY OFFERED, so the panel has to be able to show none of its steps
// as chosen rather than falling back to the first -- which would tell the reader their line is set
// in ten when it is set in twenty-two. And the answer arrives A DIGIT AT A TIME, so the field must
// not write per keystroke, must not be rewritten under the caret by the repaint that a write of its
// own causes, and must not have its digits carried off to the caption by the bar's own promise that
// typing anywhere writes on the line.
describe("how big the writing on a line is", () => {
	let dom;
	beforeEach(() => {
		dom = barDom();
		vi.useFakeTimers();
	});
	afterEach(() => vi.useRealTimers());

	// A line with no size of its own is nearly every line ever drawn, and what the reader has to be
	// shown for it is the size the sheet actually sets -- not the nothing that is stored.
	it("shows the ordinary size for a line that has none of its own", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.sizeMark.textContent).toBe(String(RELMAP_CAPTION_PX));
		expect(dom.sizeTrigger.getAttribute("aria-label")).toBe("How big the writing is: Normal");
		expect(dom.press.size[RELMAP_CAPTION_PX].classes).toContain("is-chosen");
	});

	it("shows the size a line has been set in", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 18 } }),
		});
		bar.open("e1");
		expect(dom.sizeMark.textContent).toBe("18");
		expect(dom.sizeTrigger.getAttribute("aria-label")).toBe("How big the writing is: Very large");
		expect(dom.press.size[18].classes).toContain("is-chosen");
		expect(dom.press.size[RELMAP_CAPTION_PX].classes).not.toContain("is-chosen");
	});

	// ⚠ THE ONE THAT WOULD LIE. A number the reader typed stands for no step, and the group's
	// ordinary fallback hands the mark to the first button -- so the panel would come up saying
	// "Small" on a line set in twenty-two.
	it("marks no step at all for a size nobody offered, and still says the number", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 22 } }),
		});
		bar.open("e1");
		expect(dom.sizeMark.textContent).toBe("22");
		expect(dom.sizeTrigger.getAttribute("aria-label")).toBe("How big the writing is: 22");
		for (const [px] of SIZES) expect(dom.press.size[px].classes).not.toContain("is-chosen");
		// AND THE GROUP IS STILL REACHABLE. A radiogroup with no tab stop in it is one a keyboard
		// cannot enter at all, which is worse than the wrong row looking pressed.
		expect(dom.press.size[10].getAttribute("tabindex")).toBe("0");
	});

	// ⚠ WRITTEN STRAIGHT THROUGH, like a stroke and unlike a colour: one press is one whole answer,
	// so a delay would buy nothing and cost a repaint the reader is waiting on.
	it("writes a chosen step at once, and puts the panel away", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		chooseSize(dom, 18);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 18 });
		expect(dom.sizePop.hidden).toBe(true);
		expect(dom.sizeTrigger.focused).toBe(true);
		expect(dom.sizeMark.textContent).toBe("18");
	});

	// ⚠ THE ORDINARY SIZE IS STORED AS NOTHING. A line set in what the sheet already sets has no
	// size of its own: that keeps the field empty on the overwhelming majority of lines and keeps
	// an ordinary board following the stylesheet if that number is ever retuned.
	it("stores no size at all when the reader picks the ordinary one", () => {
		const { bar, handlers } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 24 } }),
		});
		bar.open("e1");
		chooseSize(dom, RELMAP_CAPTION_PX);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 0 });
	});

	// The two halves of the panel are one answer, so a step pressed shows in the field as well --
	// which is also where a reader who then wants 19 starts from.
	it("puts a chosen step into the field beside it", () => {
		const { bar } = make(dom);
		bar.open("e1");
		chooseSize(dom, 18);
		expect(dom.sizeNum.value).toBe("18");
	});

	// ⚠ THE WHOLE REASON THE FIELD IS NOT WRITTEN THROUGH. "18" is a 1 and then an 8, and a 1 is
	// held to the floor -- so every board at the table would repaint at eight pixels on the way.
	it("writes a typed size once the typing stops, not once a digit", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "1");
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS - 1);
		typeSize(dom, "18");
		expect(handlers.onField).not.toHaveBeenCalled();
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 18 });
	});

	// Held to the bounds rather than refused: somebody who types 500 wants the biggest there is,
	// and giving them the ordinary twelve says their answer was thrown away.
	it("holds a wild number to the bounds, in front of the reader", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "500");
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 48 });
		expect(dom.sizeMark.textContent).toBe("48");
		expect(dom.sizeNum.value).toBe("48");
	});

	// The way to take a size off a line: clear the box.
	it("takes the size off a line when the field is emptied", () => {
		const { bar, handlers } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 18 } }),
		});
		bar.open("e1");
		typeSize(dom, "");
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 0 });
	});

	// ⚠ A REPAINT INSIDE THE GAP MUST NOT PUT THE NUMBER BACK. The document still has the old size,
	// and painting it here would take the digits out from under the reader's caret.
	it("keeps a half-typed size when the board repaints underneath", () => {
		const { bar } = make(dom);
		bar.open("e1");
		typeSize(dom, "22");
		bar.refresh();
		expect(dom.sizeNum.value).toBe("22");
	});

	// ⚠ AND NEITHER DOES A REPAINT WHILE THE READER IS SIMPLY STANDING IN THE FIELD. Rewriting the
	// value under a caret moves it to the end mid-number.
	it("leaves the field alone while somebody is standing in it", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 18 } }),
		});
		dom.sizeNum.ownerDocument = { activeElement: dom.sizeNum };
		dom.sizeNum.value = "2";
		bar.open("e1");
		expect(dom.sizeNum.value).toBe("2");
		// The bar itself still says what the line IS, which is where the reader reads it.
		expect(dom.sizeMark.textContent).toBe("18");
	});

	// A blur has finished the typing, whatever the timer thinks.
	it("writes a typed size the moment the field is left", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "20");
		dom.sizeNum.emit("blur", dom.sizeNum);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { size: 20 });
	});

	// ⚠ AND THE BOX IS PUT RIGHT ON THE WAY OUT. A number is held to the bounds when it is written,
	// and the paint that follows leaves the field alone while somebody is standing in it -- so
	// without this, a reader who typed 500 and clicked away would leave a box saying 500 over a
	// line drawn at 48, with the bar beside it disagreeing.
	it("puts a clamped number right in the box once the reader leaves it", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.sizeNum.ownerDocument = { activeElement: dom.sizeNum };
		typeSize(dom, "500");
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(dom.sizeNum.value).toBe("500");
		// The focus has moved on by the time a blur is handled, which is what lets the box be told.
		dom.sizeNum.ownerDocument = { activeElement: null };
		dom.sizeNum.emit("blur", dom.sizeNum);
		expect(dom.sizeNum.value).toBe("48");
	});

	// A step pressed is the reader changing their mind about the same question, so a number still
	// waiting must not land a moment later and put the caption back.
	it("throws away a typed size when a step is pressed instead", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "22");
		chooseSize(dom, 18);
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledExactlyOnceWith("e1", { size: 18 });
	});

	// The same promise the caption and the colour make: nothing is written onto a line on its way
	// out, or taking the rub back would restore the line and then need a second press for its size.
	it("throws a typed size away rather than writing it onto a line it is rubbing out", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "22");
		dom.rub.emit("click", dom.rub);
		vi.advanceTimersByTime(TIE_SIZE_DELAY_MS);
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(handlers.onRub).toHaveBeenCalledWith("e1");
	});

	// ⚠ THE BAR'S OWN PROMISE IS WHAT WOULD BREAK THIS. A printable key pressed anywhere on the bar
	// is handed back to the caption field, so without an exemption the digits of a size would land
	// on the LINE -- and the number the reader meant would never reach the box they are looking at.
	it("lets the field keep its own digits instead of writing them on the line", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		const was = dom.words.value;
		dom.bar.emit("keydown", dom.sizeNum, { key: "8" });
		expect(dom.words.value).toBe(was);
		expect(handlers.onSaying).not.toHaveBeenCalled();
	});

	// A number field is stepped with the arrow keys, and those are also what pans the scene behind
	// this window and what walks a group of presses.
	it("keeps its own arrow keys off the board", () => {
		const { bar } = make(dom);
		bar.open("e1");
		const ev = dom.bar.emit("keydown", dom.sizeNum, { key: "ArrowUp" });
		expect(ev.propagationStopped).toBe(true);
		expect(ev.defaultPrevented).toBe(false);
	});

	// Enter is how a reader says "now", rather than waiting out the timer.
	it("writes a typed size on Enter", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		typeSize(dom, "20");
		dom.bar.emit("keydown", dom.sizeNum, { key: "Enter" });
		expect(handlers.onField).toHaveBeenCalledWith("e1", { size: 20 });
	});

	// The focus lands on the answer, as it does in the palette: a reader going from eighteen to
	// twenty-four wants to be standing on eighteen, not working out where they were.
	it("opens standing on the step this line is already set in", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 18 } }),
		});
		bar.open("e1");
		openSizePop(dom);
		expect(dom.press.size[18].focused).toBe(true);
	});

	// ⚠ AND WHEN THE ANSWER IS ON NONE OF THEM, IT LANDS WHERE THE ANSWER IS. Dropped at the first
	// step, a reader with a typed size would be standing as far from their own answer as the panel
	// allows -- and on a press that would overwrite it.
	it("opens standing in the field when the size is one nobody offered", () => {
		const { bar } = make(dom, {
			tieAt: () => ({ ...structuredClone(TIE), edge: { ...TIE.edge, size: 22 } }),
		});
		bar.open("e1");
		openSizePop(dom);
		expect(dom.sizeNum.focused).toBe(true);
		expect(dom.press.size[10].focused).toBeUndefined();
	});

	// ⚠ ONE PANEL AT A TIME. All three hang from presses a thumb apart and each is wider than the
	// press it hangs from, so two open at once is one lying underneath the other.
	it("puts the colour away when the sizes are opened", () => {
		const { bar } = make(dom);
		bar.open("e1");
		openPop(dom);
		expect(dom.pop.hidden).toBe(false);
		openSizePop(dom);
		expect(dom.pop.hidden).toBe(true);
		expect(dom.sizePop.hidden).toBe(false);
	});

	// A reader who may only look gets a chooser that never opens, rather than one that opens, takes
	// a press and silently changes nothing.
	it("is inert on a board this reader may not edit", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		expect(dom.sizeTrigger.disabled).toBe(true);
		expect(dom.sizeNum.disabled).toBe(true);
		openSizePop(dom);
		expect(dom.sizePop.hidden).toBe(true);
		chooseSize(dom, 18);
		expect(handlers.onField).not.toHaveBeenCalled();
	});
});

// ⚠ THE CAPTION CAN BE DRAGGED ALONG ITS LINE while this bar is floating over it, and the bar is
// chrome in the viewport rather than a thing on the board — so nothing moves it unless it is told
// to. Left behind, it points at a patch of paper the words have left, and its arrow still says it
// belongs to that line.
describe("a caption slid out from under the bar", () => {
	let dom;
	beforeEach(() => {
		dom = barDom();
		dom.view.rect = { left: 0, top: 0, width: 800, height: 600 };
		dom.bar.rect = { left: 0, top: 0, width: 400, height: 30 };
	});

	it("moves the bar to where the words have got to", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.bar.style.left).toBe("300px");
		bar.slideTo("e1", { left: 30, top: 40 });
		// 30% of a 1000px board is 300, less half the bar's 400.
		expect(dom.bar.style.left).toBe("100px");
	});

	// ⚠ AND THE ANCHOR IS KEPT, not merely used for one placement: the reader pans the board with
	// the bar open all the time, and a pan re-places it from the anchor it holds.
	it("keeps the new spot, so a pan afterwards does not put it back", () => {
		const { bar } = make(dom);
		bar.open("e1");
		bar.slideTo("e1", { left: 30, top: 40 });
		bar.place();
		expect(dom.bar.style.left).toBe("100px");
	});

	// A reader can take hold of one line and then drag the words of another. The bar belongs to the
	// line it was opened on, and a slide somewhere else on the board is not about it.
	it("ignores a slide on a line it is not holding", () => {
		const { bar } = make(dom);
		bar.open("e1");
		bar.slideTo("e2", { left: 30, top: 40 });
		expect(dom.bar.style.left).toBe("300px");
	});

	it("has nothing to do when no line is held at all", () => {
		const { bar } = make(dom);
		expect(() => bar.slideTo("e1", { left: 30, top: 40 })).not.toThrow();
	});
});
