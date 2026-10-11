import { afterEach, describe, expect, it, vi } from "vitest";
import { StonetopDialog } from "../../module/utils/stonetop-dialog.js";
import { CampWindow } from "../../module/camp/CampWindow.js";
import { StruggleWindow } from "../../module/struggle/StruggleWindow.js";
import { StruggleSetupDialog } from "../../module/struggle/StruggleSetupDialog.js";

/**
 * The reader's place, kept through a redraw (StonetopDialog#_keptScrollSelector and #_focusSelector).
 * A window whose controls all write a document redraws under its reader at every press, anyone's,
 * and each redraw hands it a fresh column sitting at its top and nothing holding the keyboard.
 *
 * The suite runs without a DOM, so a draw here is a stand-in root answering the selectors the code
 * asks with: one scrolling column, and controls found by `[attr="value"]`.
 */

const COLUMN = ".stonetop-guide-main";

/** A control: its attributes, and a focus() that records how it was asked. */
function control(attrs = {}) {
	const dataset = {};
	for (const [name, value] of Object.entries(attrs)) {
		if (name.startsWith("data-")) dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
	}
	return { dataset, getAttribute: name => attrs[name] ?? null, focus: vi.fn() };
}

/** One draw of the window's content. `scrollTop` is where its column sits. */
function draw(controls = [], scrollTop = 0) {
	const column = { scrollTop };
	const matches = (el, sel) => [...sel.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(([, name, value]) => el.getAttribute(name) === value);
	const root = {
		querySelector: sel => (sel === COLUMN ? column : controls.find(el => matches(el, sel)) ?? null),
		contains: el => el === column || controls.includes(el),
	};
	return { root, column, controls };
}

/**
 * Open `app` on `first`, and have its next render replace that with `next`. The auto-height fit throws
 * the column back to its top, as the real one does by measuring the window with its height cleared.
 */
function redrawing(app, first, next) {
	let shown = first;
	Object.defineProperty(app, "element", { configurable: true, get: () => (shown ? [shown.root] : []) });
	app.setPosition = vi.fn(pos => { if (pos.height === "auto" && shown) shown.column.scrollTop = 0; });
	vi.spyOn(Application.prototype, "_render").mockImplementation(async () => { shown = next; });
	return app;
}

/** Hand the keyboard to `el`. */
const focusOn = el => vi.stubGlobal("document", { activeElement: el });

class Kept extends StonetopDialog {
	get _autoHeight() { return true; }
	get _keptScrollSelector() { return COLUMN; }
	get _focusKeyAttribute() { return "data-kept-focus"; }
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("a window that keeps its reader's place", () => {
	it("puts the column back where they were reading, after the auto-height fit", async () => {
		const first = draw([], 240);
		const next  = draw();
		const app   = redrawing(new Kept(), first, next);
		await app._render(false, {});
		expect(app.setPosition).toHaveBeenCalledWith({ height: "auto" });
		expect(next.column.scrollTop).toBe(240);
	});

	it("gives the keyboard back to the same control in the fresh draw, without scrolling to it", async () => {
		const had   = control({ "data-kept-focus": "bram:add:food" });
		const again = control({ "data-kept-focus": "bram:add:food" });
		const other = control({ "data-kept-focus": "bram:take:food" });
		focusOn(had);
		await redrawing(new Kept(), draw([had]), draw([other, again]))._render(false, {});
		expect(again.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
		expect(other.focus).not.toHaveBeenCalled();
	});

	// Somebody else took that character away, and their row with them. Nothing else takes the keyboard.
	it("lets the keyboard go when the fresh draw no longer has that control", async () => {
		const had   = control({ "data-kept-focus": "bram:add:food" });
		const other = control({ "data-kept-focus": "cora:add:food" });
		focusOn(had);
		await expect(redrawing(new Kept(), draw([had]), draw([other]))._render(false, {})).resolves.toBeUndefined();
		expect(other.focus).not.toHaveBeenCalled();
	});

	it("lets it go from a control with no key, and never takes it from another window", async () => {
		const unkeyed = control();
		const outside = control({ "data-kept-focus": "bram:add:food" });
		const again   = control({ "data-kept-focus": "bram:add:food" });
		focusOn(unkeyed);
		await redrawing(new Kept(), draw([unkeyed]), draw([again]))._render(false, {});
		focusOn(outside);
		await redrawing(new Kept(), draw(), draw([again]))._render(false, {});
		expect(again.focus).not.toHaveBeenCalled();
	});

	// A timeline laid out sideways scrolls across, not down, and a live write must not throw its
	// reader back to the first season.
	it("puts a sideways column back where they were reading too", async () => {
		const first = draw([], 0);
		first.column.scrollLeft = 900;
		const next = draw();
		await redrawing(new Kept(), first, next)._render(false, {});
		expect(next.column.scrollLeft).toBe(900);
	});

	// A column at its top is PUT back at its top: a fresh draw is not always there already. The
	// timeline's opens past its drag gutter (utils/drag-scroll.js), and a reader scrolled right up to
	// the edge would be thrown a whole gutter by somebody else's write.
	it("puts a column that was at its top and left edge back there", async () => {
		const first = draw([], 0);
		first.column.scrollLeft = 0;
		const next = draw([], 225);
		next.column.scrollLeft = 300;
		const app = redrawing(new Kept(), first, next);
		app.setPosition = vi.fn();
		await app._render(false, {});
		expect(next.column.scrollTop).toBe(0);
		expect(next.column.scrollLeft).toBe(0);
	});

	it("has no place to keep on its first draw", async () => {
		const next = draw([control({ "data-kept-focus": "bram:add:food" })]);
		focusOn(next.controls[0]);
		await redrawing(new Kept(), null, next)._render(true, {});
		expect(next.controls[0].focus).not.toHaveBeenCalled();
		expect(next.column.scrollTop).toBe(0);
	});

	it("finds the control by the window's own selector where it overrides one", async () => {
		class ByField extends Kept {
			_focusSelector(el) { return `[data-field="${el.getAttribute("data-field")}"]`; }
		}
		const had   = control({ "data-field": "danger" });
		const again = control({ "data-field": "danger" });
		focusOn(had);
		await redrawing(new ByField(), draw([had]), draw([again]))._render(false, {});
		expect(again.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
	});
});

// A column in a sheet tab the reader is not on (or a minimized window) has no box: it reads 0 both ways
// while still holding its offset, and drops an offset written to it. A redraw there used to keep 0
// and hand the reader the start of the column when they came back.
describe("a column that is hidden at the redraw", () => {
	/** A column that can be hidden, that hears its own scrolls, and that is laid out unless hidden. */
	function hideable() {
		let top = 0, left = 0;
		const column = {
			hidden: false,
			onScroll: null,
			getClientRects() { return this.hidden ? [] : [{}]; },
			addEventListener(type, fn) { if (type === "scroll") this.onScroll = fn; },
			// Hidden, it reads 0 and drops a write, as Chrome's does.
			get scrollTop() { return this.hidden ? 0 : top; },
			set scrollTop(v) { if (!this.hidden) top = v; },
			get scrollLeft() { return this.hidden ? 0 : left; },
			set scrollLeft(v) { if (!this.hidden) left = v; },
		};
		const root = { querySelector: sel => (sel === COLUMN ? column : null), contains: () => false };
		return { root, column };
	}

	/** Every ResizeObserver made, so a test can tell it the column got a box. */
	function observers() {
		const made = [];
		vi.stubGlobal("ResizeObserver", class {
			constructor(fn) { this.fn = fn; this.live = true; made.push(this); }
			observe() {}
			disconnect() { this.live = false; }
		});
		return made;
	}

	/** Render `app` once onto each draw in turn. */
	async function renders(app, ...draws) {
		let shown = app._shownDraw ?? null;
		Object.defineProperty(app, "element", { configurable: true, get: () => (shown ? [shown.root] : []) });
		app.setPosition = vi.fn();
		const queue = [...draws];
		vi.spyOn(Application.prototype, "_render").mockImplementation(async () => { shown = queue.shift(); app._shownDraw = shown; });
		for (let i = 0; i < draws.length; i += 1) await app._render(false, {});
	}

	it("keeps the place it was last scrolled to, and puts it back when the column is shown", async () => {
		const made = observers();
		const first = hideable();
		const next = hideable();
		const app = new Kept();
		await renders(app, first);
		first.column.scrollTop = 240;
		first.column.scrollLeft = 900;
		first.column.onScroll();
		first.column.hidden = true;
		next.column.hidden = true;
		await renders(app, next);
		expect(next.column.scrollTop, "written into a column with no box").toBe(0);

		next.column.hidden = false;
		made.filter(o => o.live).forEach(o => o.fn());
		expect(next.column.scrollTop).toBe(240);
		expect(next.column.scrollLeft).toBe(900);
		expect(made.some(o => o.live), "still waiting after it landed").toBe(false);
	});

	it("does not take a hidden column's 0 for the reader's place", async () => {
		observers();
		const first = hideable();
		const app = new Kept();
		await renders(app, first);
		first.column.scrollTop = 240;
		first.column.onScroll();
		first.column.hidden = true;
		expect(app._readPlace().scrolled).toBe(240);
	});
});

// Every other StonetopDialog: declaring nothing, it redraws exactly as it always did.
describe("a window that declares no place", () => {
	it("keeps neither the column nor the keyboard", async () => {
		class Plain extends StonetopDialog { get _autoHeight() { return true; } }
		const had   = control({ "data-kept-focus": "bram:add:food" });
		const again = control({ "data-kept-focus": "bram:add:food" });
		const next  = draw([again]);
		focusOn(had);
		await redrawing(new Plain(), draw([had], 240), next)._render(false, {});
		expect(next.column.scrollTop).toBe(0);
		expect(again.focus).not.toHaveBeenCalled();
	});
});

describe("the windows that keep it", () => {
	it("Make Camp keeps its column, and each control by its data-camp-focus key", () => {
		const win = Object.create(CampWindow.prototype);
		expect(win._keptScrollSelector).toBe(COLUMN);
		expect(win._focusSelector(control({ "data-camp-focus": "bram:add:food" }))).toBe('[data-camp-focus="bram:add:food"]');
		expect(win._focusSelector(control())).toBeNull();
	});

	it("Struggle as One keeps its column, and each control by its data-struggle-focus key", () => {
		const win = Object.create(StruggleWindow.prototype);
		expect(win._keptScrollSelector).toBe(COLUMN);
		expect(win._focusSelector(control({ "data-struggle-focus": "r1:roll" }))).toBe('[data-struggle-focus="r1:roll"]');
		expect(win._focusSelector(control({ "data-camp-focus": "r1:roll" }))).toBeNull();
	});

	it("its setup keeps its column, and each field by whose it is and what it holds", () => {
		vi.stubGlobal("CSS", { escape: value => value });
		const setup = Object.create(StruggleSetupDialog.prototype);
		expect(setup._keptScrollSelector).toBe(COLUMN);
		expect(setup._focusSelector(control({ "data-pc": "rhianna", "data-field": "stat" }))).toBe('[data-pc="rhianna"][data-field="stat"]');
		expect(setup._focusSelector(control({ "data-follower": "f1", "data-field": "bonus" }))).toBe('[data-follower="f1"][data-field="bonus"]');
		expect(setup._focusSelector(control({ "data-pc": "rhianna" }))).toBeNull();
	});
});
