import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_MAX_MS, PREVIEW_PAUSE_MS, RelmapPersonBar } from "../../module/utils/relmap-person-bar.js";
import { boardEl } from "../fakes/pointer-board.js";

// THE BAR THE LABEL UNDER A PERSON'S NAME RAISES ("Iron Knight", "Deceased"): a box of up to three
// lines, the side the name and label stand on, Italic and Save. The window's half is
// relationship-map-window.test.js's.

/** The bar's markup, as the window template prints it. */
function barDom() {
	const root = boardEl();
	const view = boardEl({ cls: ["stonetop-relmap-view"], parent: root });
	const bar = boardEl({ cls: ["stonetop-relmap-personbar"], parent: view });
	bar.hidden = true;
	const field = boardEl({ dataset: { relmapPbar: "subtitle" }, parent: bar });
	field.value = "";
	field.focus = vi.fn(() => { field.focused = true; });
	field.setSelectionRange = vi.fn();
	const button = dataset => Object.assign(boardEl({ dataset, parent: bar }), { tagName: "BUTTON" });
	// The four sides are radios, read through their `change`.
	const sides = ["below", "above", "left", "right"].map(side => Object.assign(
		boardEl({ dataset: { relmapPbar: "side" }, parent: bar }), { tagName: "INPUT", type: "radio", value: side, checked: false },
	));
	const title = boardEl({ cls: ["stonetop-relmap-personbar-title"], parent: bar });
	title.textContent = "";
	const close = button({ relmapPbar: "close" });
	// Italic is a checkbox, read through its `change`.
	const italic = Object.assign(boardEl({ dataset: { relmapPbar: "italic" }, parent: bar }), { tagName: "INPUT", type: "checkbox", checked: true });
	const save = button({ relmapPbar: "save" });
	// The title row, which moves the bar when it is dragged.
	const head = boardEl({ cls: ["stonetop-relmap-personbar-head"], parent: bar });
	head.setPointerCapture = vi.fn();
	head.releasePointerCapture = vi.fn();
	return { root, view, bar, field, sides, italic, save, title, close, head };
}

function setUp({ node = { name: "Simon", subtitle: "Squire" }, canEdit = () => true, italicDefault = () => true } = {}) {
	const dom = barDom();
	const state = { node };
	const handlers = {
		surface: () => ({
			painted: () => ({ width: 1000, height: 800 }), offset: { x: 0, y: 0 }, viewSize: { width: 1000, height: 800 },
		}),
		personAt: vi.fn(id => (id === "n1" && state.node ? { node: state.node, at: { left: 50, top: 50 } } : null)),
		onSave: vi.fn(() => Promise.resolve(true)),
		onPreview: vi.fn(),
		onPicked: vi.fn(),
		canEdit,
		italicDefault: vi.fn(italicDefault),
	};
	const bar = new RelmapPersonBar(dom.root, handlers);
	return { dom, state, handlers, bar };
}

const key = (target, k) => {
	const ev = {
		key: k, target, defaultPrevented: false, propagationStopped: false,
		preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev.propagationStopped = true; },
	};
	return ev;
};
// Typing is the box's value changing and its `input`, which shows the change on the board.
const type = (dom, words) => {
	dom.field.value = words;
	dom.field.handlers.input.forEach(fn => fn({ target: dom.field }));
};
/** The bar's change as `onSave` and `onPreview` take it, with only label fields changed. */
const change = (fields = {}) => ({ fields, wear: [], off: [], defs: {}, drop: [] });
const keydown = (dom, ev) => { dom.bar.handlers.keydown.forEach(fn => fn(ev)); return ev; };
const sideButton = (dom, side) => dom.sides.find(radio => radio.value === side);
/** Which side's radio is checked. */
const checkedSide = dom => dom.sides.filter(radio => radio.checked).map(radio => radio.value);
/** A press on Save or the side `value`, or a click on the Italic checkbox (which ticks or unticks it). */
const press = (dom, what, value) => {
	if (what === "italic") {
		dom.italic.checked = !dom.italic.checked;
		const ev = { target: dom.italic, propagationStopped: false, stopPropagation() { ev.propagationStopped = true; } };
		dom.italic.handlers.change.forEach(fn => fn(ev));
		expect(ev.propagationStopped).toBe(true);
		return;
	}
	if (what === "side") {
		// A click on a radio checks it and unchecks the rest of its group, then fires its `change`.
		for (const radio of dom.sides) radio.checked = radio.value === value;
		const radio = sideButton(dom, value);
		const ev = { target: radio, propagationStopped: false, stopPropagation() { ev.propagationStopped = true; } };
		radio.handlers.change.forEach(fn => fn(ev));
		expect(ev.propagationStopped).toBe(true);
		return;
	}
	const target = what === "close" ? dom.close : dom.save;
	dom.bar.handlers.click.forEach(fn => fn({ target }));
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("opening the bar on somebody's label", () => {
	it("shows their label with the caret at the end, ready to type", () => {
		const { dom, bar, handlers } = setUp();
		expect(bar.open("n1")).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		expect(dom.field.value).toBe("Squire");
		expect(dom.field.focused).toBe(true);
		expect(dom.field.setSelectionRange).toHaveBeenCalledWith(6, 6);
		expect(handlers.onPicked).toHaveBeenCalledWith("n1");
	});

	it("opens empty for somebody with no label yet", () => {
		const { dom, bar } = setUp({ node: { name: "Vera", subtitle: "" } });
		bar.open("n1");
		expect(dom.field.value).toBe("");
	});

	it("does not open for somebody who is not on the board, or for a reader who may not edit", () => {
		expect(setUp().bar.open("gone")).toBe(false);
		const { dom, bar } = setUp({ canEdit: () => false });
		expect(bar.open("n1")).toBe(false);
		expect(dom.bar.hidden).toBe(true);
	});

	it("sits under the point it was given, not over it", () => {
		const { dom, bar } = setUp();
		dom.bar.getBoundingClientRect = () => ({ width: 200, height: 30 });
		bar.open("n1");
		expect(dom.bar.style.left).toBe("400px");
		expect(dom.bar.style.top).toBe("400px");
	});
});

describe("writing a label, on Save", () => {
	// NOTHING IS WRITTEN AS IT IS TYPED: the label, the side and the italics are kept on Save, as one
	// write and one step of the undo. After Dom Bosco's tags pull request, which brought the Save button.
	it("writes nothing while typing, and the label on Save, then puts the bar down", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Deceased");
		vi.advanceTimersByTime(5000);
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(bar.isWriting()).toBe(false);
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledTimes(1);
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "Deceased" }));
		expect(dom.bar.hidden).toBe(true);
	});

	it("saves on Ctrl+Enter in the box", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Iron Knight");
		const ev = keydown(dom, Object.assign(key(dom.field, "Enter"), { ctrlKey: true }));
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "Iron Knight" }));
		expect(dom.bar.hidden).toBe(true);
		expect(ev.propagationStopped).toBe(true);
	});

	// ENTER STARTS A NEW LINE, up to three: the box's own Enter is let through, and refused past the third.
	it("lets Enter make a new line, up to three, and keeps the bar up", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "The Iron Knight");
		const one = keydown(dom, key(dom.field, "Enter"));
		expect(one.defaultPrevented).toBe(false);
		expect(one.propagationStopped).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		type(dom, "The Iron Knight\nLord of the Vale\nSworn");
		expect(keydown(dom, key(dom.field, "Enter")).defaultPrevented).toBe(true);
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	it("saves the lines as they were typed, tidied", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "  The Iron   Knight \n\nLord of the Vale\n");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "The Iron Knight\nLord of the Vale" }));
	});

	it("rubs a label out when the box is emptied", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "" }));
	});

	it("writes the side and the italics with the label, only what changed, in one write", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		press(dom, "side", "left");
		press(dom, "italic");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledTimes(1);
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ side: "left", italic: false }));
	});

	it("shows the side and the italics the person has, and marks the one chosen", () => {
		const { dom, bar } = setUp({ node: { name: "Simon", subtitle: "Squire", side: "above", italic: false } });
		bar.open("n1");
		expect(checkedSide(dom)).toEqual(["above"]);
		expect(dom.italic.checked).toBe(false);
		press(dom, "side", "right");
		expect(checkedSide(dom)).toEqual(["right"]);
		press(dom, "italic");
		expect(dom.italic.checked).toBe(true);
	});

	// Escape, and a click away, are the ways out of a change thought better of.
	it("writes nothing on Escape, and puts it all back", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Traitor");
		press(dom, "side", "right");
		keydown(dom, key(dom.field, "Escape"));
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(dom.field.value).toBe("Squire");
		expect(dom.bar.hidden).toBe(true);
		bar.open("n1");
		expect(checkedSide(dom)).toEqual(["below"]);
	});

	it("writes nothing when it is let go from outside", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Iron Knight");
		bar.close();
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(bar.flush()).toBeUndefined();
		bar.open("n1");
		expect(dom.field.value).toBe("Squire");
	});

	it("writes nothing when nothing changed, and still puts the bar down", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		press(dom, "save");
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(dom.bar.hidden).toBe(true);
	});

	// ⚠ EVERY KEY STOPS ON THE BAR. Core's KeyboardManager listens in the bubble phase and never looks at
	// `defaultPrevented`: a Delete or an arrow here would reach the scene behind the window.
	it("keeps every other key from core, and still lets the field have it", () => {
		const { dom, bar } = setUp();
		bar.open("n1");
		for (const k of ["Delete", "ArrowLeft", "a", " "]) {
			const ev = keydown(dom, key(dom.field, k));
			expect(ev.propagationStopped).toBe(true);
			expect(ev.defaultPrevented).toBe(false);
		}
	});
});

describe("the bar's title and its close", () => {
	it("names whose label it is in its title", () => {
		const { dom, bar, handlers } = setUp();
		handlers.personAt.mockImplementation(() => ({
			node: { name: "Simon", subtitle: "" }, at: { left: 50, top: 50 }, title: "Label for Simon",
		}));
		bar.open("n1");
		expect(dom.title.textContent).toBe("Label for Simon");
	});

	it("names each bar's side radios for that bar alone, so two windows' groups never join", () => {
		const one = setUp().dom.sides.map(radio => radio.name);
		const two = setUp().dom.sides.map(radio => radio.name);
		expect(new Set(one).size).toBe(1);
		expect(one[0]).not.toBe(two[0]);
	});

	// The title's x is Escape's way out.
	it("closes without saving on the x, and puts it all back", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Traitor");
		press(dom, "side", "left");
		press(dom, "close");
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(dom.bar.hidden).toBe(true);
		expect(dom.field.value).toBe("Squire");
	});
});

describe("moving the bar by its title", () => {
	const pointer = (target, x, y, extra = {}) => ({
		target, button: 0, pointerId: 1, clientX: x, clientY: y, defaultPrevented: false,
		preventDefault() { this.defaultPrevented = true; }, ...extra,
	});
	const drag = (dom, from, to) => {
		const down = pointer(dom.head, ...from);
		dom.head.handlers.pointerdown.forEach(fn => fn(down));
		dom.head.handlers.pointermove?.forEach(fn => fn(pointer(dom.head, ...to)));
		[...(dom.head.handlers.pointerup ?? [])].forEach(fn => fn(pointer(dom.head, ...to)));
		return down;
	};

	it("follows a drag on its title, and stays there through a pan", () => {
		const { dom, bar } = setUp();
		dom.bar.getBoundingClientRect = () => ({ width: 200, height: 100 });
		bar.open("n1");
		expect(dom.bar.style.left).toBe("400px");
		const down = drag(dom, [500, 400], [380, 250]);
		expect(down.defaultPrevented).toBe(true);
		expect(dom.head.setPointerCapture).toHaveBeenCalledWith(1);
		expect(dom.bar.style.left).toBe("280px");
		expect(dom.bar.style.top).toBe("250px");
		// The drag let go: no more moves are heard.
		expect(dom.head.handlers.pointermove ?? []).toHaveLength(0);
		bar.place();
		expect(dom.bar.style.left).toBe("280px");
	});

	it("is kept inside the view however far it is dragged", () => {
		const { dom, bar } = setUp();
		dom.bar.getBoundingClientRect = () => ({ width: 200, height: 100 });
		bar.open("n1");
		drag(dom, [500, 400], [5000, -900]);
		expect(dom.bar.style.left).toBe(`${1000 - 200 - 6}px`);
		expect(dom.bar.style.top).toBe("6px");
	});

	it("is not moved by a press on the title's x", () => {
		const { dom, bar } = setUp();
		bar.open("n1");
		const down = pointer(dom.close, 500, 400);
		dom.close.closest = sel => (sel === "button" ? dom.close : null);
		dom.head.handlers.pointerdown.forEach(fn => fn(down));
		expect(down.defaultPrevented).toBe(false);
		expect(dom.head.setPointerCapture).not.toHaveBeenCalled();
	});

	it("goes back under its person the next time it opens", () => {
		const { dom, bar } = setUp();
		dom.bar.getBoundingClientRect = () => ({ width: 200, height: 100 });
		bar.open("n1");
		drag(dom, [500, 400], [380, 250]);
		bar.close();
		bar.open("n1");
		expect(dom.bar.style.left).toBe("400px");
		expect(dom.bar.style.top).toBe("400px");
	});
});

// A NEW LABEL STARTS IN THE ITALICS THE LAST ONE SAVED ON THIS MAP HAD.
describe("the italics a new label starts in", () => {
	const upright = () => false;

	it("starts a person with no label on the map's last choice, and writes it with the words", () => {
		const { dom, bar, handlers } = setUp({ node: { name: "Vera", subtitle: "" }, italicDefault: upright });
		bar.open("n1");
		expect(dom.italic.checked).toBe(false);
		type(dom, "Smith");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "Smith", italic: false }));
	});

	it("writes nothing for the starting italics alone, while there are no words", () => {
		const { dom, bar, handlers } = setUp({ node: { name: "Vera", subtitle: "" }, italicDefault: upright });
		bar.open("n1");
		press(dom, "save");
		expect(handlers.onSave).not.toHaveBeenCalled();
		expect(dom.bar.hidden).toBe(true);
	});

	it("keeps the reader's own tick over the starting italics", () => {
		const { dom, bar, handlers } = setUp({ node: { name: "Vera", subtitle: "" }, italicDefault: upright });
		bar.open("n1");
		press(dom, "italic");
		type(dom, "Smith");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "Smith" }));
	});

	it("leaves a label already there in its own italics", () => {
		const { dom, bar, handlers } = setUp({ italicDefault: upright });
		bar.open("n1");
		expect(dom.italic.checked).toBe(true);
		expect(handlers.italicDefault).not.toHaveBeenCalled();
	});
});

// EVERY CHANGE SHOWS ON THE BOARD AS IT IS MADE, and closing without Save takes it back off.
describe("showing the change before it is saved", () => {
	const last = handlers => handlers.onPreview.mock.calls.at(-1);

	it("shows the label once typing pauses, tidied, and the side and italics as soon as they are chosen", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "  Iron   Knight ");
		expect(handlers.onPreview).not.toHaveBeenCalled();
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		expect(last(handlers)).toEqual(["n1", change({ subtitle: "Iron Knight" })]);
		press(dom, "side", "left");
		expect(last(handlers)).toEqual(["n1", change({ subtitle: "Iron Knight", side: "left" })]);
		press(dom, "italic");
		expect(last(handlers)).toEqual(["n1", change({ subtitle: "Iron Knight", side: "left", italic: false })]);
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	// ⚠ EVERY SHOWING REPAINTS THE WHOLE BOARD: a word typed is one, not one per key.
	it("shows a burst of typing once, after the pause", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		for (const words of ["K", "Kn", "Kni", "Knig", "Knigh", "Knight"]) {
			type(dom, words);
			vi.advanceTimersByTime(40);
		}
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		expect(handlers.onPreview).toHaveBeenCalledTimes(1);
		expect(last(handlers)).toEqual(["n1", change({ subtitle: "Knight" })]);
	});

	it("keeps up with typing that never pauses, a few times a second", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		let words = "";
		for (let i = 0; i < 20; i++) {
			words += "a";
			type(dom, words);
			vi.advanceTimersByTime(50);
		}
		// A thousand milliseconds of typing, never left more than PREVIEW_MAX_MS unshown.
		expect(handlers.onPreview.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(1000 / PREVIEW_MAX_MS));
		expect(handlers.onPreview.mock.calls.length).toBeLessThan(6);
	});

	it("does not show the same change twice, and shows typing still waiting at once on a press", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Knight");
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		// A trailing space tidies away: the same change, so the board is not repainted.
		type(dom, "Knight ");
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		expect(handlers.onPreview).toHaveBeenCalledTimes(1);
		type(dom, "Knights");
		press(dom, "side", "left");
		expect(last(handlers)).toEqual(["n1", change({ subtitle: "Knights", side: "left" })]);
		vi.advanceTimersByTime(PREVIEW_MAX_MS);
		expect(handlers.onPreview).toHaveBeenCalledTimes(2);
	});

	it("shows nothing changed once a change is undone by hand", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Knight");
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		type(dom, "Squire");
		vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
		expect(last(handlers)).toEqual(["n1", null]);
	});

	it("drops typing still waiting to be shown when the bar is let go, and saves it on Save", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Traitor");
		bar.close();
		vi.advanceTimersByTime(PREVIEW_MAX_MS);
		expect(last(handlers)).toEqual(["n1", null]);
		bar.open("n1");
		type(dom, "Traitor");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ subtitle: "Traitor" }));
	});

	it.each([
		["Escape", dom => keydown(dom, key(dom.field, "Escape"))],
		["the x", dom => press(dom, "close")],
		["a click away", (dom, bar) => bar.close()],
	])("takes the change off the board on %s", (_how, letGo) => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Traitor");
		press(dom, "side", "right");
		letGo(dom, bar);
		expect(last(handlers)).toEqual(["n1", null]);
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	it("takes the last person's change off the board when the bar opens on somebody else", () => {
		const { dom, bar, handlers } = setUp();
		handlers.personAt.mockImplementation(id => ({ node: { name: id, subtitle: "" }, at: { left: 50, top: 50 } }));
		bar.open("n1");
		type(dom, "Traitor");
		bar.open("n2");
		expect(handlers.onPreview).toHaveBeenCalledWith("n1", null);
		expect(dom.field.value).toBe("");
	});
});

describe("the board repainted underneath", () => {
	it("keeps what the reader is changing when somebody else changes the board", () => {
		const { dom, state, bar } = setUp();
		bar.open("n1");
		type(dom, "Deceas");
		state.node = { name: "Simon", subtitle: "Somebody else's word", side: "left" };
		bar.refresh();
		expect(dom.field.value).toBe("Deceas");
		expect(dom.bar.hidden).toBe(false);
	});

	it("keeps a side the reader chose when somebody else changes the board", () => {
		const { dom, state, bar, handlers } = setUp();
		bar.open("n1");
		press(dom, "side", "above");
		state.node = { name: "Simon", subtitle: "Deceased" };
		bar.refresh();
		expect(dom.field.value).toBe("Squire");
		press(dom, "save");
		expect(handlers.onSave).toHaveBeenCalledWith("n1", change({ side: "above" }));
	});

	it("lets go, writing nothing, when the person is taken off the board", () => {
		const { dom, state, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Deceased");
		state.node = null;
		bar.refresh();
		expect(dom.bar.hidden).toBe(true);
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	// AUDIT 2026-11-02: a bar left standing idle kept the OLD words after an undo or another
	// player's change, so a save would have written them back over the change.
	it("shows the person as they now stand while nothing is changed in it", () => {
		const { dom, state, bar, handlers } = setUp();
		bar.open("n1");
		state.node = { name: "Simon", subtitle: "Deceased", side: "right", italic: false };
		bar.refresh();
		expect(dom.field.value).toBe("Deceased");
		expect(checkedSide(dom)).toEqual(["right"]);
		expect(dom.italic.checked).toBe(false);
		press(dom, "save");
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	it("says whose label it is holding, for a screen reader", () => {
		const { dom, handlers, bar } = setUp();
		handlers.personAt.mockImplementation(() => ({
			node: { name: "Simon", subtitle: "" }, at: { left: 50, top: 50 }, label: "The label under Simon",
		}));
		bar.open("n1");
		expect(dom.bar.getAttribute("aria-label")).toBe("The label under Simon");
	});
});

// AUDIT 2026-11-03 (/fix-all).
describe("the edges of the label bar", () => {
	// The Enter that opened the bar keeps repeating into its field; closing on it handed the focus back
	// to the label, whose next repeat opened the bar again, for as long as the key was held.
	it("stays open on a held Enter, and adds no lines with it", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		const held = key(dom.field, "Enter");
		held.repeat = true;
		const ev = keydown(dom, held);
		expect(ev.defaultPrevented).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		expect(handlers.onSave).not.toHaveBeenCalled();
	});

	// Clamped up from under the name, a bar near the bottom of the view sat over the face it is about.
	it("goes above the face, not onto it, where the view has no room below the name", () => {
		const { dom, state, bar, handlers } = setUp();
		handlers.personAt.mockImplementation(() => ({ node: state.node, at: { left: 50, top: 97 }, lift: { left: 50, top: 90 } }));
		dom.bar.getBoundingClientRect = () => ({ width: 200, height: 30 });
		bar.open("n1");
		// The face's top is 720px down an 800px view; the bar's 30px and the 6px edge go above it.
		expect(dom.bar.style.top).toBe("684px");
	});

	// Edit rights taken away mid-sentence used to throw the words away with nothing said.
	it("says so when what was typed can no longer be saved", () => {
		const was = globalThis.ui;
		const warn = vi.fn();
		globalThis.ui = { ...was, notifications: { ...was?.notifications, warn } };
		try {
			let can = true;
			const { dom, bar, handlers } = setUp({ canEdit: () => can });
			bar.open("n1");
			type(dom, "Traitor");
			can = false;
			keydown(dom, { ...key(dom.field, "Enter"), ctrlKey: true });
			expect(handlers.onSave).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.ui = was;
		}
	});
});
