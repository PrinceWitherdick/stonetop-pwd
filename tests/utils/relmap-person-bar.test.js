import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelmapPersonBar } from "../../module/utils/relmap-person-bar.js";
import { TIE_WRITE_DELAY_MS } from "../../module/utils/relmap-tie-bar.js";
import { boardEl } from "../fakes/pointer-board.js";

// THE BAR THE LABEL UNDER A PERSON'S NAME RAISES ("Iron Knight", "Deceased"): one field, typed in
// place. The window's half is relationship-map-window.test.js's.

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
	return { root, view, bar, field };
}

function setUp({ node = { name: "Simon", subtitle: "Squire" }, canEdit = () => true } = {}) {
	const dom = barDom();
	const state = { node };
	const handlers = {
		surface: () => ({
			painted: () => ({ width: 1000, height: 800 }), offset: { x: 0, y: 0 }, viewSize: { width: 1000, height: 800 },
		}),
		personAt: vi.fn(id => (id === "n1" && state.node ? { node: state.node, at: { left: 50, top: 50 } } : null)),
		onField: vi.fn(() => Promise.resolve(true)),
		onPicked: vi.fn(),
		canEdit,
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
const type = (dom, words) => {
	dom.field.value = words;
	dom.field.handlers.input.forEach(fn => fn({}));
};
const keydown = (dom, ev) => { dom.bar.handlers.keydown.forEach(fn => fn(ev)); return ev; };

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

describe("typing a label", () => {
	// ONE WRITE FOR A BURST OF TYPING: "Acolyte of the Celebrated Seer" is one broadcast and one step of
	// the undo, not thirty.
	it("holds what is typed back and writes it once the reader stops", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Dece");
		type(dom, "Deceased");
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(bar.isWriting()).toBe(true);
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledTimes(1);
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "Deceased" });
	});

	it("writes at once on Enter, and puts the bar down", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Iron Knight");
		const ev = keydown(dom, key(dom.field, "Enter"));
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "Iron Knight" });
		expect(ev.propagationStopped).toBe(true);
		expect(dom.bar.hidden).toBe(true);
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS);
		expect(handlers.onField).toHaveBeenCalledTimes(1);
	});

	it("rubs a label out when the field is emptied", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "");
		keydown(dom, key(dom.field, "Enter"));
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "" });
	});

	// Escape is the way out of a label thought better of, not a second way of saving it.
	it("writes nothing on Escape, and puts the field back", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Traitor");
		keydown(dom, key(dom.field, "Escape"));
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS * 2);
		expect(handlers.onField).not.toHaveBeenCalled();
		expect(dom.field.value).toBe("Squire");
		expect(dom.bar.hidden).toBe(true);
	});

	it("writes nothing when nothing changed", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		keydown(dom, key(dom.field, "Enter"));
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// ⚠ EVERY KEY STOPS ON THE BAR. Core's KeyboardManager listens in the bubble phase and never looks at
	// \`defaultPrevented\`: a Delete or an arrow here would reach the scene behind the window.
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

describe("the board repainted underneath", () => {
	it("keeps what the reader is typing when somebody else changes the board", () => {
		const { dom, state, bar } = setUp();
		bar.open("n1");
		type(dom, "Deceas");
		state.node = { name: "Simon", subtitle: "Somebody else's word" };
		bar.refresh();
		expect(dom.field.value).toBe("Deceas");
		expect(dom.bar.hidden).toBe(false);
	});

	it("lets go, writing nothing, when the person is taken off the board", () => {
		const { dom, state, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Deceased");
		state.node = null;
		bar.refresh();
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS * 2);
		expect(dom.bar.hidden).toBe(true);
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// AUDIT 2026-11-02: a bar left standing idle kept the OLD words after an undo or another
	// player's change, so Escape "put back" those and the next keystroke wrote them over the change.
	it("shows the label as it now stands when nobody is typing in it", () => {
		const { dom, state, bar, handlers } = setUp();
		bar.open("n1");
		state.node = { name: "Simon", subtitle: "Deceased" };
		bar.refresh();
		expect(dom.field.value).toBe("Deceased");
		keydown(dom, key(dom.field, "Escape"));
		expect(dom.field.value).toBe("Deceased");
		expect(handlers.onField).not.toHaveBeenCalled();
	});

	// A write trims ("Iron " is stored "Iron"), so refilling a FOCUSED field would eat the space the
	// reader has just typed before the next word.
	it("never refills the field the reader is in, even once what they typed has been written", () => {
		const { dom, state, bar, handlers } = setUp();
		dom.field.ownerDocument = { activeElement: dom.field };
		bar.open("n1");
		type(dom, "Iron ");
		vi.advanceTimersByTime(TIE_WRITE_DELAY_MS + 1);
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "Iron " });
		state.node = { name: "Simon", subtitle: "Iron" };
		bar.refresh();
		expect(dom.field.value).toBe("Iron ");
	});

	it("says whose label it is holding, for a screen reader", () => {
		const { dom, handlers, bar } = setUp();
		handlers.personAt.mockImplementation(() => ({
			node: { name: "Simon", subtitle: "" }, at: { left: 50, top: 50 }, label: "The label under Simon",
		}));
		bar.open("n1");
		expect(dom.bar.getAttribute("aria-label")).toBe("The label under Simon");
	});

	// AUDIT 2026-11-02: the footer's Undo blurs the field first, and that blur starts the write. The
	// undo waits for it in the window, where every write is kept until it lands (RelationshipMapWindow
	// `_write`), so what the bar owes here is to START it on the blur, in that breath, and to leave
	// nothing behind for the undo's own flush to write a second time.
	it("starts the write on the blur, at once, and leaves nothing to flush", () => {
		const { dom, bar, handlers } = setUp();
		handlers.onField.mockImplementation(() => new Promise(() => {}));
		bar.open("n1");
		type(dom, "Iron Knight");
		dom.field.handlers.blur.forEach(fn => fn({}));
		expect(handlers.onField).toHaveBeenCalledTimes(1);
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "Iron Knight" });
		expect(bar.flush()).toBeUndefined();
		expect(handlers.onField).toHaveBeenCalledTimes(1);
	});

	it("writes what is held when it is closed from outside", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		type(dom, "Iron Knight");
		bar.close();
		expect(handlers.onField).toHaveBeenCalledWith("n1", { subtitle: "Iron Knight" });
	});
});

// AUDIT 2026-11-03 (/fix-all).
describe("the edges of the label bar", () => {
	// The Enter that opened the bar keeps repeating into its field; closing on it handed the focus back
	// to the label, whose next repeat opened the bar again, for as long as the key was held.
	it("stays open on a held Enter", () => {
		const { dom, bar, handlers } = setUp();
		bar.open("n1");
		const held = key(dom.field, "Enter");
		held.repeat = true;
		const ev = keydown(dom, held);
		expect(ev.defaultPrevented).toBe(true);
		expect(dom.bar.hidden).toBe(false);
		expect(handlers.onField).not.toHaveBeenCalled();
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
			bar.flush();
			expect(handlers.onField).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.ui = was;
		}
	});
});
