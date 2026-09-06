import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelmapTieBar, TIE_WRITE_DELAY_MS } from "../../module/utils/relmap-tie-bar.js";
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

/** The bar's markup, as the window template prints it. */
function barDom({ inks = ["rose", "slate"], dashes = ["solid", "dotted"] } = {}) {
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
	for (const ink of inks) button("ink", ink);
	for (const dir of ["none", "a-b", "b-a", "both"]) button("dir", dir);
	for (const dash of dashes) button("dash", dash);
	const more = boardEl({ dataset: { relmapTie: "more" }, parent: bar });

	return { root, view, board, bar, words, press, more };
}

const TIE = {
	edge: { a: "n1", b: "n2", label: "were once a thing", ink: "rose", dir: "a-b", dash: "dotted" },
	from: { name: "Mike", x: 20 },
	to: { name: "Sonya", x: 80 },
	said: { none: "No arrow", both: "Both ways", "a-b": "Arrow towards Sonya", "b-a": "Arrow towards Mike" },
	at: { left: 50, top: 40 },
};

function make(dom, over = {}) {
	const handlers = {
		surface: () => ({ painted: () => ({ width: 1000, height: 600 }), offset: { x: 0, y: 0 } }),
		tieAt: vi.fn(() => structuredClone(TIE)),
		onField: vi.fn(),
		onMore: vi.fn(),
		onPicked: vi.fn(),
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

	it("presses the swatch, the arrow and the stroke the line already has", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.press.ink.rose.classes).toContain("is-chosen");
		expect(dom.press.ink.slate.classes).not.toContain("is-chosen");
		expect(dom.press.dir["a-b"].getAttribute("aria-checked")).toBe("true");
		expect(dom.press.dash.dotted.classes).toContain("is-chosen");
		expect(dom.press.dash.solid.classes).not.toContain("is-chosen");
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

	it("writes the colour, and presses the swatch before the write comes back", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.press.ink.slate.emit("click", dom.press.ink.slate);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { ink: "slate" });
		expect(dom.press.ink.slate.classes).toContain("is-chosen");
		expect(dom.press.ink.rose.classes).not.toContain("is-chosen");
	});

	it("writes which way the line is read", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.press.dir.both.emit("click", dom.press.dir.both);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { dir: "both" });
	});

	it("writes whether the stroke is broken", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.press.dash.solid.emit("click", dom.press.dash.solid);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { dash: "solid" });
	});

	it("writes nothing at all for a reader who may only look", () => {
		const { bar, handlers } = make(dom, { canEdit: () => false });
		bar.open("e1");
		dom.press.ink.slate.emit("click", dom.press.ink.slate);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ THE DIALOG IS ABOUT TO ASK THE SAME QUESTION THIS FIELD ANSWERS. Two windows disagreeing
	// about what a line says is worse than either of them being wrong.
	//
	// ⚠ AND WAITS FOR IT TO LAND. The editor fills itself by reading the board SYNCHRONOUSLY, so a
	// write merely fired off leaves it showing the caption as it was — and saving puts that back
	// over the sentence the reader had just finished typing.
	it("writes the caption before handing on to the dialog", async () => {
		let land;
		const written = new Promise(resolve => { land = resolve; });
		const { bar, handlers } = make(dom, { onField: vi.fn(() => written) });
		bar.open("e1");
		dom.words.value = "half a sentence";
		dom.words.emit("input", dom.words);
		dom.more.emit("click", dom.more);
		expect(handlers.onField).toHaveBeenCalledWith("e1", { label: "half a sentence" });
		expect(dom.bar.hidden).toBe(true);
		expect(handlers.onMore).not.toHaveBeenCalled();

		land();
		await written;
		await Promise.resolve();
		expect(handlers.onMore).toHaveBeenCalledWith("e1");
	});

	// Nothing typed is nothing to wait for, and the dialog still opens.
	it("hands on to the dialog when there was nothing to write", async () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.more.emit("click", dom.more);
		expect(handlers.onField).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(handlers.onMore).toHaveBeenCalledWith("e1");
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
});

// ── The keyboard ────────────────────────────────────────────────────────────
//
// ⚠ ONE TAB STOP PER GROUP, NOT ONE PER PRESS. Fourteen ordinary buttons would be fourteen stops
// between the board and whatever comes after it, on a strip a reader arrives at by clicking a line
// -- the worst place in the window to lose somebody. A radiogroup is one stop with the arrows
// inside it, and that is only true if exactly one button per group carries the stop.
describe("moving about the bar without a mouse", () => {
	let dom;
	beforeEach(() => { dom = barDom(); });

	it("gives each group exactly one tab stop, on the answer it is set to", () => {
		const { bar } = make(dom);
		bar.open("e1");
		expect(dom.press.ink.rose.getAttribute("tabindex")).toBe("0");
		expect(dom.press.ink.slate.getAttribute("tabindex")).toBe("-1");
		expect(dom.press.dir["a-b"].getAttribute("tabindex")).toBe("0");
		expect(dom.press.dir.none.getAttribute("tabindex")).toBe("-1");
	});

	it("moves the stop when a different answer is pressed", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.press.ink.slate.emit("click", dom.press.ink.slate);
		expect(dom.press.ink.slate.getAttribute("tabindex")).toBe("0");
		expect(dom.press.ink.rose.getAttribute("tabindex")).toBe("-1");
	});

	it("walks the arrow keys along one group", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.ink.rose, { key: "ArrowRight" });
		expect(dom.press.ink.slate.focused).toBe(true);
		expect(dom.press.ink.slate.getAttribute("tabindex")).toBe("0");
		expect(dom.press.ink.rose.getAttribute("tabindex")).toBe("-1");
	});

	// Eight colours in a row is exactly the case where running off the end and stopping feels like
	// the control has jammed.
	it("wraps round the end of a group", () => {
		const { bar } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.dir.none, { key: "ArrowLeft" });
		expect(dom.press.dir.both.focused).toBe(true);
	});

	// ⚠ EVERY ONE OF THESE PRESSES WRITES TO A SHARED DOCUMENT. "Selection follows focus", which is
	// what a plain radio group does, would mean arrowing from rose to slate wrote four colours onto
	// everybody's board on the way past. The reader chooses with Space or Enter, which the button
	// does for itself.
	it("writes nothing on the way past", () => {
		const { bar, handlers } = make(dom);
		bar.open("e1");
		dom.bar.emit("keydown", dom.press.ink.rose, { key: "ArrowRight" });
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// An arrow that reached core's KeyboardManager would pan the scene behind this window.
	it("keeps the arrow away from the scene behind the window", () => {
		const { bar } = make(dom);
		bar.open("e1");
		const ev = dom.bar.emit("keydown", dom.press.ink.rose, { key: "ArrowRight" });
		expect(ev.defaultPrevented).toBe(true);
		expect(ev.propagationStopped).toBe(true);
	});

	// The arrows inside the CAPTION move the caret and are nobody else's business.
	it("leaves the arrows alone inside the writing field", () => {
		const { bar } = make(dom);
		bar.open("e1");
		const ev = dom.bar.emit("keydown", dom.words, { key: "ArrowRight" });
		expect(ev.defaultPrevented).toBe(false);
		expect(dom.press.ink.slate.focused).toBeFalsy();
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
		expect(dom.press.ink.slate.classes).toContain("is-chosen");
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
});
