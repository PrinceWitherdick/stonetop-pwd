import { describe, it, expect, beforeEach, vi } from "vitest";

// The relationship map's window, and specifically the two things about it that are easy to get
// wrong and neither of which fails loudly:
//
//  • a change somebody else made must repaint the board WITHOUT costing this reader the corner
//    they had zoomed into, and
//  • a repaint that lands while this reader is mid-drag or mid-edit must wait rather than replace
//    the element under their pointer.
//
// The suite runs in node (there is no jsdom here), so the DOM is a hand-rolled stand-in for the
// handful of calls these paths make. The markup itself is pinned against the real templates by the
// partial-registration suite, and the geometry by tests/utils/relmap-geometry.test.js.

const opened = [];
let alreadyOpen = null;
vi.mock("../../module/utils/open-or-focus.js", () => ({
	openOrFocus: (id, make) => {
		opened.push(id);
		if (alreadyOpen) { alreadyOpen.bringToTop(); return alreadyOpen; }
		return make();
	},
}));
vi.mock("../../module/utils/foundry-compat.js", () => ({
	renderTemplate: (path, ctx) =>
		Promise.resolve(`<board nodes="${ctx.nodes.length}" edges="${ctx.edges.length}">`),
	getDragEventData: () => null,
	deletionEntry: keyPath => {
		const i = keyPath.lastIndexOf(".");
		return [`${keyPath.slice(0, i + 1)}-=${keyPath.slice(i + 1)}`, null];
	},
}));

const { RelationshipMapWindow, openRelationshipMap } =
	await import("../../module/dialogs/RelationshipMapWindow.js");

/** One element with only the surface these paths touch. */
function el(props = {}) {
	const node = {
		classList: {
			_set: new Set(),
			add(c) { this._set.add(c); },
			remove(c) { this._set.delete(c); },
			contains(c) { return this._set.has(c); },
		},
		children: {},
		// What a `querySelectorAll` for a given selector finds. Kept apart from `children` because
		// the two questions are different: one element by selector, or every element by it.
		all: {},
		innerHTML: "",
		hidden: false,
		tagName: "DIV",
		...props,
	};
	node.querySelector = sel => node.children[sel] ?? null;
	node.querySelectorAll = sel => node.all[sel] ?? [];
	node.contains = other => Object.values(node.children).includes(other);
	return node;
}

/** A JournalEntry holding one graph. */
function entryFor(graph, { isOwner = true, id = "map1" } = {}) {
	return {
		id,
		name: "The people of Stonetop",
		isOwner,
		updates: [],
		getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "relationshipMap" ? graph : null),
		update(patch) { this.updates.push(patch); return Promise.resolve(this); },
	};
}

const TWO_PEOPLE = {
	version: 1,
	nodes: {
		elena: { uuid: null, name: "Elena", img: "", x: 20, y: 30, note: "" },
		stefan: { uuid: null, name: "Stefan", img: "", x: 70, y: 30, note: "" },
	},
	edges: { link1: { a: "elena", b: "stefan", label: "exes", ink: "rose", dir: "none", note: "" } },
};

/** An instance without the Application constructor, wired to a stand-in root. */
function windowFor(graph = TWO_PEOPLE, { isOwner = true, locked = false } = {}) {
	const entry = entryFor(graph, { isOwner });
	const app = Object.create(RelationshipMapWindow.prototype);
	const board = el();
	const live = el();
	const empty = el();
	const root = el();
	root.children[".stonetop-relmap-board"] = board;
	root.children[".stonetop-relmap-live"] = live;
	root.children[".stonetop-relmap-empty"] = empty;
	root.ownerDocument = { activeElement: null };
	app._entry = entry;
	app._entryId = entry.id;
	app._locked = locked;
	app._pendingSync = false;
	app._root = root;
	app.rendered = true;
	app.render = vi.fn();
	app.reportWriteFailure = vi.fn();
	return { app, entry, root, board, live, empty };
}

beforeEach(() => {
	opened.length = 0;
	alreadyOpen = null;
	globalThis.game = {
		user: { id: "u1" },
		journal: { get: () => null, contents: [] },
	};
	globalThis.Hooks = { on: vi.fn(), off: vi.fn() };
	globalThis.fromUuidSync = () => null;
});

describe("repainting when somebody else changes the map", () => {
	// The whole reason `sync` exists rather than a `render`. A render would re-fit the board and
	// throw away the corner this reader had zoomed into, which is the exact state they were using
	// at the moment the change arrived.
	it("swaps the board's markup and never re-renders the window", async () => {
		const { app, board } = windowFor();
		await app.sync();
		expect(app.render).not.toHaveBeenCalled();
		expect(board.innerHTML).toContain("nodes=\"2\"");
		expect(board.innerHTML).toContain("edges=\"1\"");
	});

	it("never touches the zoom or the pan", async () => {
		const { app } = windowFor();
		app._surface = { scale: 3.2, offset: { x: -40, y: -12 } };
		await app.sync();
		expect(app._surface.scale).toBe(3.2);
		expect(app._surface.offset).toEqual({ x: -40, y: -12 });
	});

	it("shows the empty panel only while nobody is on the map", async () => {
		const { app, empty } = windowFor({ version: 1, nodes: {}, edges: {} });
		await app.sync();
		expect(empty.hidden).toBe(false);
		app._entry = entryFor(TWO_PEOPLE);
		await app.sync();
		expect(empty.hidden).toBe(true);
	});

	it("does nothing at all once the window has closed", async () => {
		const { app, board } = windowFor();
		app.rendered = false;
		await app.sync();
		expect(board.innerHTML).toBe("");
	});
});

describe("the update hook", () => {
	/** Wire the hook and hand back the listener core would call. */
	function hookFor(app) {
		let listener = null;
		globalThis.Hooks = { on: (name, fn) => { if (name === "updateJournalEntry") listener = fn; }, off: vi.fn() };
		app.sync = vi.fn();
		app._wireSync();
		return listener;
	}

	it("ignores a write to a different journal", () => {
		const { app } = windowFor();
		const listener = hookFor(app);
		listener({ id: "someone-else" }, { flags: { "stonetop-pwd": { relationshipMap: {} } } });
		expect(app.sync).not.toHaveBeenCalled();
	});

	it("ignores a write to this journal that is not the map", () => {
		const { app } = windowFor();
		const listener = hookFor(app);
		listener({ id: "map1" }, { name: "Renamed" });
		listener({ id: "map1" }, { flags: { core: { sheetClass: "x" } } });
		listener({ id: "map1" }, { flags: { "stonetop-pwd": { somethingElse: 1 } } });
		expect(app.sync).not.toHaveBeenCalled();
	});

	// ⚠ The package id is hyphenated, so a DOTTED read of it (`changed.flags.stonetop-pwd`) parses
	// as a subtraction and throws. This handler is registered on a GLOBAL hook, so a throw here
	// takes down every other listener on it — a whole-world failure caused by a journal rename.
	it("does not throw on the hyphenated flag scope, in the shape Foundry sends it", () => {
		const { app } = windowFor();
		const listener = hookFor(app);
		expect(() => listener({ id: "map1" }, {
			flags: { "stonetop-pwd": { relationshipMap: { nodes: { elena: { x: 4 } } } } },
		})).not.toThrow();
	});

	it("repaints on a write to the map", async () => {
		const { app } = windowFor();
		const listener = hookFor(app);
		listener({ id: "map1" }, { flags: { "stonetop-pwd": { relationshipMap: { nodes: {} } } } });
		await new Promise(r => setTimeout(r, 80));
		expect(app.sync).toHaveBeenCalled();
	});

	// A deletion arrives with the key prefixed, and a repaint that only matched the bare name
	// would miss every removal — the board would keep drawing somebody who had been taken off it.
	it("repaints on a DELETION, whose key arrives prefixed", async () => {
		const { app } = windowFor();
		const listener = hookFor(app);
		listener({ id: "map1" }, { flags: { "stonetop-pwd": { "-=relationshipMap": null } } });
		await new Promise(r => setTimeout(r, 80));
		expect(app.sync).toHaveBeenCalled();
	});

	it("unregisters when the window closes", async () => {
		const { app } = windowFor();
		const off = vi.fn();
		globalThis.Hooks = { on: vi.fn(), off };
		app._wireSync();
		app._surface = null;
		app._teardownDrag = null;
		Object.getPrototypeOf(Object.getPrototypeOf(app)).close = async () => {};
		await app.close();
		expect(off).toHaveBeenCalledWith("updateJournalEntry", expect.any(Function));
	});
});

describe("a repaint that arrives at a bad moment", () => {
	// Repainting under a live drag replaces the very element the pointer is holding: the drag then
	// carries on moving a node that is no longer in the document, and the drop writes nothing.
	it("waits while this reader is dragging, and lands the moment they let go", async () => {
		const { app, board } = windowFor();
		board.classList.add("is-dragging");
		await app.sync();
		expect(board.innerHTML).toBe("");
		expect(app._pendingSync).toBe(true);

		board.classList.remove("is-dragging");
		await app._flushPendingSync();
		await new Promise(r => setTimeout(r, 0));
		expect(app._pendingSync).toBe(false);
	});

	// Same argument for a focused field: a repaint mid-word takes the field away and the words
	// with it.
	it("waits while a field in the window has focus", async () => {
		const { app, root, board } = windowFor();
		const field = el({ tagName: "INPUT" });
		root.children[".field"] = field;
		root.ownerDocument.activeElement = field;
		await app.sync();
		expect(board.innerHTML).toBe("");
		expect(app._pendingSync).toBe(true);
	});

	it("is not held back by a focused element that is not a field", async () => {
		const { app, root, board } = windowFor();
		const button = el({ tagName: "BUTTON" });
		root.children[".button"] = button;
		root.ownerDocument.activeElement = button;
		await app.sync();
		expect(board.innerHTML).toContain("nodes=");
	});

	it("has nothing to flush when nothing was held back", async () => {
		const { app, board } = windowFor();
		app._pendingSync = false;
		await app._flushPendingSync();
		expect(board.innerHTML).toBe("");
	});
});

describe("nudging a portrait from the keyboard", () => {
	// THE FAULT THIS EXISTS TO CATCH. A held arrow key repeats about thirty times a second. Writing
	// each repeat is thirty document updates, thirty broadcasts, and thirty repaints on every open
	// client — and each repaint replaces the very button the key is being held on, so the focus the
	// reader was nudging from disappears mid-press. The portrait has to move on every key while the
	// document hears about it once.

	/** A window with one portrait element the nudge can move, and its debounce made manual. */
	function boardWithPortrait() {
		const made = windowFor();
		const portrait = el({ style: {} });
		made.root.children['[data-relmap-node="elena"]'] = portrait;
		made.app._pendingNudge = null;
		made.app._commitNudge = vi.fn();
		return { ...made, portrait };
	}

	it("moves the portrait on every key and writes none of them yet", () => {
		const { app, entry, portrait } = boardWithPortrait();
		app._nudgeNode("elena", { x: 21, y: 30 });
		app._nudgeNode("elena", { x: 22, y: 30 });
		app._nudgeNode("elena", { x: 23, y: 30 });
		expect(portrait.style.left).toBe("23%");
		expect(portrait.style.top).toBe("30%");
		expect(entry.updates).toEqual([]);
		expect(app._commitNudge).toHaveBeenCalledTimes(3);
	});

	it("writes once, at the spot the last key left it", async () => {
		const { app, entry } = boardWithPortrait();
		app._nudgeNode("elena", { x: 21, y: 30 });
		app._nudgeNode("elena", { x: 22, y: 30 });
		app._writeNudge();
		await Promise.resolve();
		expect(entry.updates).toHaveLength(1);
		expect(JSON.stringify(entry.updates[0])).toContain("22");
	});

	// The next key has to step on from where the portrait IS. Reading the document instead would
	// take every repeat back to the spot the burst started from, so a held key would jitter between
	// two positions instead of travelling.
	it("steps on from the unwritten spot rather than the stale one", () => {
		const { app } = boardWithPortrait();
		app._nudgeNode("elena", { x: 21, y: 30 });
		expect(app._pendingNudge).toEqual({ id: "elena", at: { x: 21, y: 30 } });
	});

	// A repaint landing mid-burst would redraw the portrait at the spot the document still holds,
	// silently undoing the keys already pressed.
	it("holds off a repaint while a nudge is unwritten, and lets it in after", () => {
		const { app } = boardWithPortrait();
		app._nudgeNode("elena", { x: 21, y: 30 });
		expect(app._isBusy()).toBe(true);
		app._writeNudge();
		expect(app._isBusy()).toBe(false);
	});

	// A drag is bounded by the pointer; a held arrow key is bounded by nothing. Shown unclamped, the
	// portrait would walk off the board and snap back the moment the write landed.
	it("stops at the edge of the board rather than walking off it", () => {
		const { app, portrait } = boardWithPortrait();
		app._nudgeNode("elena", { x: 140, y: -20 });
		expect(portrait.style.left).toBe("100%");
		expect(portrait.style.top).toBe("0%");
		expect(app._pendingNudge.at).toEqual({ x: 100, y: 0 });
	});

	it("has nothing to write when no key was pressed", () => {
		const { app, entry } = boardWithPortrait();
		app._writeNudge();
		expect(entry.updates).toEqual([]);
	});
});

describe("the lines while a portrait is being dragged", () => {
	// THE FAULT THIS EXISTS TO CATCH. A portrait under the pointer is moved by a transform on its
	// own element; its lines are drawn somewhere else entirely. Without a live redraw they stay
	// pinned to the spot the portrait was picked up from until the pointer is released, and the
	// map reads as not having noticed the drag at all.

	/** A style object with the two things these paths write: properties and custom properties. */
	function styleOf() {
		const style = { props: {} };
		style.setProperty = (name, value) => { style.props[name] = value; };
		return style;
	}

	/** One line, label or arrowhead, as it sits on a rendered board. */
	function part(dataset) {
		const node = { dataset, attrs: {}, style: styleOf() };
		node.setAttribute = (name, value) => { node.attrs[name] = value; };
		return node;
	}

	// Elena and Stefan, with the link between them wearing a label AND an arrowhead, so one drag
	// exercises all three renderers of a line at once.
	const POINTED = {
		version: 1,
		nodes: TWO_PEOPLE.nodes,
		edges: { link1: { ...TWO_PEOPLE.edges.link1, dir: "a-b" } },
	};

	/** A window whose board is already carrying one link's three pieces. */
	function boardWithLine(graph = POINTED) {
		const made = windowFor(graph);
		const line = part({ relmapLine: "link1" });
		const label = part({ relmapEdge: "link1" });
		const head = part({ relmapHead: "link1", relmapEnd: "to" });
		made.board.all = {
			"[data-relmap-line]": [line],
			"[data-relmap-edge]": [label],
			"[data-relmap-head]": [head],
		};
		return { ...made, line, label, head };
	}

	/** Where a path starts, which is the end of it welded to the portrait being dragged. */
	const startOf = d => d.slice(2, d.indexOf(" Q")).split(",").map(Number);

	it("redraws the stroke as the portrait moves, before anything is dropped", () => {
		const { app, line } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		const [, top] = startOf(line.attrs.d);
		// Elena started at y=30 and the line left her rim just below it; dragged to 70 it has to
		// leave from below her instead. The exact number is the geometry suite's business.
		expect(top).toBeGreaterThan(40);
	});

	it("carries the label and the arrowhead along with it", () => {
		const { app, label, head } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		expect(label.style.top).toMatch(/%$/);
		expect(parseFloat(label.style.top)).toBeGreaterThan(35);
		expect(head.style.props["--relmap-turn"]).toMatch(/deg$/);
	});

	it("leaves the lines nobody is dragging entirely alone", () => {
		const graph = {
			version: 1,
			nodes: {
				...TWO_PEOPLE.nodes,
				marek: { uuid: null, name: "Marek", img: "", x: 50, y: 80, note: "" },
			},
			edges: {
				link1: TWO_PEOPLE.edges.link1,
				link2: { a: "stefan", b: "marek", label: "", ink: "sage", dir: "none", note: "" },
			},
		};
		const made = boardWithLine(graph);
		const other = part({ relmapLine: "link2" });
		made.board.all["[data-relmap-line]"] = [made.line, other];
		made.app._previewMove("elena", { x: 20, y: 70 });
		expect(made.line.attrs.d).toBeTruthy();
		expect(other.attrs.d).toBeUndefined();
	});

	// Two portraits sitting on top of each other have no line between them to draw, and a repaint
	// leaves it out. A stroke frozen at its last good position while the portraits pile up on it
	// is worse than no stroke.
	it("hides a line whose two portraits have come to sit on each other", () => {
		const { app, line, label, head } = boardWithLine();
		app._previewMove("elena", { x: 70, y: 30 });
		expect(line.style.display).toBe("none");
		expect(label.style.display).toBe("none");
		expect(head.style.display).toBe("none");
		// And back the moment the drag pulls them apart again, without any repaint.
		app._previewMove("elena", { x: 20, y: 30 });
		expect(line.style.display).toBe("");
	});

	// The lock can be turned, or Escape pressed, while a drag is in the air. The drag layer puts
	// the portrait back by dropping its transform; nothing else would put the lines back.
	it("puts the lines back where they were when a drag is abandoned", () => {
		const { app, line } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		const dragged = line.attrs.d;
		app._endPreview("elena", { x: 20, y: 30 });
		expect(line.attrs.d).not.toBe(dragged);
		expect(startOf(line.attrs.d)[1]).toBeLessThan(40);
		expect(app._preview).toBeNull();
	});

	// On a real drop the write is already on its way and its repaint draws the same geometry over
	// the top. Putting the lines back first would flash every one of them to the old spot.
	it("leaves them where they were previewed when the drop is being written", () => {
		const { app, line } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		const dragged = line.attrs.d;
		app._endPreview("elena", null);
		expect(line.attrs.d).toBe(dragged);
		expect(app._preview).toBeNull();
	});

	// Once per DRAG, not once per frame: this runs sixty times a second, and re-reading the flag
	// and re-walking the board each time would learn the same answers over and over.
	it("reads the map and finds the elements once for the whole gesture", () => {
		const { app, entry } = boardWithLine();
		const reads = vi.spyOn(entry, "getFlag");
		for (let i = 0; i < 8; i++) app._previewMove("elena", { x: 20, y: 30 + i });
		expect(reads).toHaveBeenCalledTimes(1);
	});

	// A repaint throws away every element the preview was holding. Kept stale, the next drag would
	// write onto nodes that have left the document and nothing at all would move.
	it("forgets the elements it was holding when the board is repainted", async () => {
		const { app } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		expect(app._preview).not.toBeNull();
		await app.sync();
		expect(app._preview).toBeNull();
	});

	it("does nothing for a portrait that is no longer on the map", () => {
		const { app, line } = boardWithLine();
		expect(() => app._previewMove("nobody", { x: 40, y: 40 })).not.toThrow();
		expect(line.attrs.d).toBeUndefined();
	});
});

describe("who may change a map", () => {
	it("is editable only by an owner, and only once unlocked", () => {
		const owner = windowFor(TWO_PEOPLE, { isOwner: true, locked: false }).app;
		expect(owner.canEdit).toBe(true);
		expect(owner.editable).toBe(true);

		const locked = windowFor(TWO_PEOPLE, { isOwner: true, locked: true }).app;
		expect(locked.canEdit).toBe(true);
		expect(locked.editable).toBe(false);

		const reader = windowFor(TWO_PEOPLE, { isOwner: false, locked: false }).app;
		expect(reader.canEdit).toBe(false);
		expect(reader.editable).toBe(false);
	});

	// Locked on open, because everyone at this table owns these maps: everyone can move a portrait,
	// which means everyone can move one by accident while trying to drag the board.
	it("opens locked", () => {
		const app = new RelationshipMapWindow(entryFor(TWO_PEOPLE), {});
		expect(app._locked).toBe(true);
		expect(app.editable).toBe(false);
	});
});

describe("opening a map", () => {
	// AppV1 resolves an Application's element by its id, so two windows sharing one id both resolve
	// to the FIRST one's frame: the second paints into the first's window and the first's handlers
	// are left bound to nodes nothing will re-render. Several named maps is exactly that case.
	it("gives each map its own window id", () => {
		// Defined on the prototype rather than spied: `render` is inherited from the Application
		// stand-in, and there is no own property for a spy to replace.
		RelationshipMapWindow.prototype.render = vi.fn();
		openRelationshipMap(entryFor(TWO_PEOPLE, { id: "map1" }));
		openRelationshipMap(entryFor(TWO_PEOPLE, { id: "map2" }));
		expect(opened).toEqual(["stonetop-relmap-map1", "stonetop-relmap-map2"]);
		expect(new Set(opened).size).toBe(2);
		delete RelationshipMapWindow.prototype.render;
	});

	it("raises the window already showing a map rather than stacking a second", () => {
		const showing = { render: vi.fn(), bringToTop: vi.fn() };
		alreadyOpen = showing;
		openRelationshipMap(entryFor(TWO_PEOPLE, { id: "map1" }));
		expect(showing.bringToTop).toHaveBeenCalled();
		expect(showing.render).not.toHaveBeenCalled();
	});

	it("opens nothing for no entry", () => {
		expect(openRelationshipMap(null)).toBeNull();
		expect(opened).toEqual([]);
	});
});
