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
/** What the shared chooser was ASKED, which is the whole of what Tidy up's question is. The window
 * never sees a dialog here; the picker's own behaviour is content-prompt.test.js's business. */
const chooser = { asked: [], answer: null };
vi.mock("../../module/dialogs/content-picker.js", () => ({
	pickContentOption: config => { chooser.asked.push(config); return Promise.resolve(chooser.answer); },
	promptForText: () => Promise.resolve(null),
}));

const { RelationshipMapWindow, openRelationshipMap } =
	await import("../../module/dialogs/RelationshipMapWindow.js");
const { readGraph } = await import("../../module/relmap/relmap-doc.js");
const { graphCapPx } = await import("../../module/utils/relmap-geometry.js");

/** The real English table, kept from before the suite's `beforeEach` replaces `globalThis.game`. */
const TABLE = globalThis.game.i18n;

/** One element with only the surface these paths touch. */
function el(props = {}) {
	const node = {
		classList: {
			_set: new Set(),
			add(c) { this._set.add(c); },
			remove(c) { this._set.delete(c); },
			contains(c) { return this._set.has(c); },
			// The board writes nearly all of its state this way -- the lit web, the caption
			// modes, whether the type is too small to be worth painting.
			toggle(c, on) {
				const want = on ?? !this._set.has(c);
				if (want) this._set.add(c); else this._set.delete(c);
				return want;
			},
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

/** The same two people, with one line drawn by hand and one pulled in from the sheets. */
const BOTH_KINDS = {
	...TWO_PEOPLE,
	edges: {
		...TWO_PEOPLE.edges,
		pulled: { a: "elena", b: "stefan", label: "likes", ink: "sage", dir: "a-b", src: "hearts" },
	},
};

/** An instance without the Application constructor, wired to a stand-in root. */
function windowFor(graph = TWO_PEOPLE, { isOwner = true, entry: given = null, pageId = null } = {}) {
	const entry = given ?? entryFor(graph, { isOwner });
	const app = Object.create(RelationshipMapWindow.prototype);
	const board = el();
	const live = el();
	const empty = el();
	const foot = el();
	const root = el();
	root.children[".stonetop-relmap-board"] = board;
	root.children[".stonetop-relmap-live"] = live;
	root.children[".stonetop-relmap-empty"] = empty;
	// The "nobody is on this map yet" panel's own three parts, registered for the reason the
	// no-kin panel's below are: `_paintPanel` returns without writing where they are missing, so an
	// assertion about the words in it would pass against a window that never touched them.
	const emptyLead = el();
	const emptyHint = el();
	const emptyCta = el({ dataset: {} });
	emptyCta.children["span"] = el();
	emptyCta.children["i"] = el();
	empty.children[".stonetop-relmap-empty-lead"] = emptyLead;
	empty.children[".stonetop-relmap-empty-hint"] = emptyHint;
	empty.children[".stonetop-relmap-empty-cast"] = emptyCta;
	root.children[".stonetop-relmap-foot"] = foot;
	// The "this view is showing nobody" panel, with the three things `_paintChrome` writes into it.
	// Registered here rather than per-test because without it that whole branch is a silent no-op
	// and every assertion about the panel would pass against a window that never touched it.
	const bare = el();
	const bareLead = el();
	const bareHint = el();
	const bareIcon = el();
	const bareWords = el();
	const bareCta = el({ dataset: {} });
	bareCta.children["span"] = bareWords;
	bareCta.children["i"] = bareIcon;
	bare.children[".stonetop-relmap-empty-lead"] = bareLead;
	bare.children[".stonetop-relmap-empty-hint"] = bareHint;
	bare.children[".stonetop-relmap-empty-cast"] = bareCta;
	root.children[".stonetop-relmap-nokin"] = bare;
	// The person chooser. Registered here for the same reason the panel above is: `_paintFocusPick`
	// returns without writing anything where it is missing, so every assertion about the rows would
	// pass against a window that never touched them.
	const pick = el();
	root.children["[data-relmap-focus]"] = pick;
	// The page strip, and the two things `_paintPages` writes outside it: the board is the tab
	// panel, so it carries the label naming whichever tab is up, and whether the last board can be
	// rubbed out depends on how many there are. Registered here rather than per-test for the reason
	// the panels above are: without them those branches are silent no-ops and every assertion about
	// them would pass against a window that never touched them.
	const strip = el();
	strip.attrs = {};
	root.children[".stonetop-relmap-pages-strip"] = strip;
	const view = el();
	view.attrs = {};
	view.setAttribute = (key, value) => { view.attrs[key] = value; };
	root.children[".stonetop-relmap-view"] = view;
	const dropTool = el();
	root.children["[data-relmap-action=\"pagedelete\"]"] = dropTool;
	root.ownerDocument = { activeElement: null };
	app._entry = entry;
	app._entryId = entry.id;
	app._pendingSync = false;
	app.id = "stonetop-relmap-map1";
	app._pageId = pageId;
	app._pagesSaid = null;
	// The constructor never runs here, so the reader's own settings have to be set by hand. Which
	// of the two maps they are looking at is one of them, and it is read on nearly every path.
	app._view = "everyone";
	app._root = root;
	app.rendered = true;
	app.render = vi.fn();
	app.reportWriteFailure = vi.fn();
	return {
		app, entry, root, board, live, empty, emptyLead, emptyHint, emptyCta, foot, pick, strip,
		view, dropTool, bare, bareLead, bareHint, bareCta, bareWords,
	};
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
		// `setNaturalSize` is on the fake because the sheet GROWS with the number of people on it,
		// so a repaint tells the surface how big the board has become. That call must not disturb
		// the reader's zoom, which is what this test is about.
		app._surface = { scale: 3.2, offset: { x: -40, y: -12 }, setNaturalSize: () => {} };
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
		// AND DOES NOT HOARD IT EITHER. A closed window is not coming back to paint anything, so a
		// change held for it is a change held for ever -- and a `_pendingSync` left standing is the
		// first thing the NEXT window on this map would flush.
		expect(app._pendingSync).toBe(false);
	});

	// \u26a0 "NOT RENDERED" IS TWO DIFFERENT ANSWERS, and they want opposite handling. AppV1 sets
	// `_state` to RENDERING before it awaits `getData` and back to RENDERED only after
	// `activateListeners`, so a change arriving in that window is not a change for a closed window
	// -- it is one that simply has no markup to paint into yet. Dropped, it is lost until somebody
	// happens to make another. This became reachable the day switching views became a render.
	it("holds a change that lands while the window is part-way through a render", async () => {
		const { app, board } = windowFor();
		app.rendered = false;
		app._state = globalThis.Application.RENDER_STATES.RENDERING;
		await app.sync();
		expect(board.innerHTML).toBe("");
		expect(app._pendingSync).toBe(true);
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

	// ⚠ A FOCUSED CONTROL IS NOT AN OBSTRUCTION HERE, and this used to say the opposite. The
	// guard was written for a half-typed sentence, and this window has none to lose: it carries a
	// view chooser and a checkbox, neither of which holds writing, and a caption is edited in a
	// separate dialog whose focus is outside this window entirely. A repaint also replaces only the
	// BOARD's markup, so neither of those two could be taken away by one. What the guard did do was
	// hold every other player's changes off this board for as long as somebody left the chooser
	// focused -- and it had collected an exemption per control to stop it doing exactly that, which
	// is how it was found.
	for (const [what, tagName] of [["a field", "INPUT"], ["a chooser", "SELECT"], ["a button", "BUTTON"]]) {
		it(`is not held back by ${what} having focus`, async () => {
			const { app, root, board } = windowFor();
			const focused = el({ tagName });
			root.children[".focused"] = focused;
			root.ownerDocument.activeElement = focused;
			await app.sync();
			expect(board.innerHTML).toContain("nodes=");
			expect(app._pendingSync).toBe(false);
		});
	}

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

	/** One line, caption or arrowhead, as it sits on a rendered board. */
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

	/** A window whose board is already carrying one link's pieces. */
	function boardWithLine(graph = POINTED) {
		const made = windowFor(graph);
		const line = part({ relmapLine: "link1" });
		const label = part({ relmapEdge: "link1" });
		const words = part({ relmapWords: "link1" });
		const head = part({ relmapHead: "link1", relmapEnd: "to" });
		made.board.all = {
			"[data-relmap-line]": [line],
			"[data-relmap-edge]": [label],
			"[data-relmap-words]": [words],
			"[data-relmap-head]": [head],
		};
		return { ...made, line, label, words, head };
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

	it("carries the caption and the arrowhead along with it", () => {
		const { app, words, head } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		// A caption is placed by a POINT AND A TURN, which is how the arrowhead beside it is placed.
		expect(Number(words.attrs.y)).toBeGreaterThan(0);
		expect(words.attrs.transform).toMatch(/^rotate\(/);
		expect(head.style.props["--relmap-turn"]).toMatch(/deg$/);
	});

	// THE WORDS SIT IN THE LINE, so moving a portrait moves them and turns them: a caption left at
	// the last frame's anchor is a caption sitting beside its own line for the length of the
	// gesture.
	it("moves the caption and turns it as the line swings", () => {
		const { app, words } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 40 });
		const first = { y: words.attrs.y, turn: words.attrs.transform };
		app._previewMove("elena", { x: 20, y: 80 });
		expect(words.attrs.y).not.toBe(first.y);
		expect(words.attrs.transform).not.toBe(first.turn);
	});

	// ⚠ THE TURN IS ABOUT THE CAPTION'S OWN POINT. `rotate(a x y)` turns about a point, and a
	// rotation about anywhere else -- the layer's origin, say -- swings the words off the board.
	it("turns the words about the very point it just put them on", () => {
		const { app, words } = boardWithLine();
		app._previewMove("elena", { x: 20, y: 70 });
		expect(words.attrs.transform).toBe(`rotate(${
			words.attrs.transform.split(" ")[0].slice(7)} ${words.attrs.x} ${words.attrs.y})`);
	});

	// THE WORDS ARE LEFT ALONE for the length of the gesture, and that is deliberate rather than
	// missed: re-cutting a sentence to a shortening line means measuring it, and measuring it
	// sixty times a second is the forced layout this whole path exists to avoid. The drop repaints
	// and puts it right.
	it("does not re-word the caption while the pointer is still down", () => {
		const { app, words } = boardWithLine();
		words.textContent = "exes";
		app._previewMove("elena", { x: 62, y: 30 });
		app._previewMove("elena", { x: 5, y: 90 });
		expect(words.textContent).toBe("exes");
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

	// Escape can be pressed, or the map's ownership taken away, while a drag is in the air. The
	// drag layer puts the portrait back by dropping its transform; nothing else would put the
	// lines back.
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

	// ⚠ THE DRAG MUST SEE THE BOARD THE READER SEES. The preview used to gather its fan indexes
	// and its caption cap from the WHOLE map while the board had been painted from the visible one,
	// so with the imported lines put away a hand-drawn line sharing its pair with a hidden one was
	// previewed in a fan lane it is not drawn in: it slid sideways for the length of the gesture
	// and snapped back on the drop, with nothing on screen to explain either move.
	describe("with the imported lines put away", () => {
		// The imported line's id sorts BEFORE the hand-drawn one, so it is the imported line that
		// holds lane 0 and the hand-drawn one that is bowed aside for it. Which is the whole point:
		// put the imported one away and the hand-drawn line is alone on its pair and straightens.
		// With the ids the other way round the hand-drawn line keeps lane 0 either way and the
		// fault this suite is about cannot be seen.
		const FANNED = {
			...TWO_PEOPLE,
			edges: {
				"aa-pulled": { a: "elena", b: "stefan", label: "likes", ink: "sage", dir: "a-b", src: "hearts" },
				link1: TWO_PEOPLE.edges.link1,
			},
		};

		/** Where the hand-drawn line goes for one drag, on a board in the given state. */
		function draggedTo(graph, hidePulled) {
			const made = boardWithLine(graph);
			made.app._hidePulled = hidePulled;
			made.app._previewMove("elena", { x: 25, y: 65 });
			return made.line.attrs.d;
		}

		it("previews the hand-drawn line in the lane the board actually drew it in", () => {
			// A hidden line is not a line: the one left showing is alone on its pair, and traces
			// exactly what it traces on a map that never had the other one.
			expect(draggedTo(FANNED, true)).toBe(draggedTo(TWO_PEOPLE, false));
		});

		it("still fans the pair apart when the imported line is showing", () => {
			expect(draggedTo(FANNED, false)).not.toBe(draggedTo(TWO_PEOPLE, false));
		});

		// The caption cap steps down in tiers as a board fills up, and the gaps cut in the strokes
		// under a drag are sized by it. Counted over the whole map, a board whose imported lines
		// carry it past a tier boundary would cut gaps for a crowding the reader has put away.
		it("promises its captions the room the visible board promised them", () => {
			// Thirty imported captions on top of the one hand-drawn one: over the boundary counted
			// whole, comfortably under it counted as the reader sees it.
			const crowded = { ...TWO_PEOPLE, edges: { ...TWO_PEOPLE.edges } };
			for (let i = 0; i < 30; i++) {
				crowded.edges[`h${i}`] = {
					a: "elena", b: "stefan", label: `feeling ${i}`, ink: "sage", dir: "a-b", src: "hearts",
				};
			}
			const made = boardWithLine(crowded);
			made.app._hidePulled = true;
			made.app._previewMove("elena", { x: 25, y: 65 });
			expect(Object.keys(made.app._preview.graph.edges)).toEqual(["link1"]);
			expect(made.app._preview.capPx).toBe(graphCapPx(TWO_PEOPLE));
			expect(graphCapPx(crowded)).not.toBe(graphCapPx(TWO_PEOPLE));
		});
	});
});

// ⚠ THE BUG THIS EXISTS TO CATCH, found by clicking a portrait in a real world: every face on
// every map answered "that person's sheet is no longer in this world", including the people plainly
// still in it. `resolveLinkedActor` reads `link.dataset ?? link`, so the hand-built object here has
// to be spelled the way a row's `data-` attributes are (`actorUuid`), and `{uuid}` is not an error
// it can report: it resolves nobody, which is indistinguishable from a deleted actor. Every other
// caller in the system hands it a real element and so never meets this.
// THE FAULT THIS EXISTS TO CATCH, and it is one a reader sees immediately and no test could feel.
// A caption sits IN its stroke: the line is broken for exactly the width of the words. That width
// is a character count times a constant until the words are in a document, and the constant
// overshoots this face by about a fifth -- which on the full sentences a caption now carries is
// well over a hundred pixels of line rubbed out for words that were never there. The board reads
// as a sentence floating in a hole with its line picking up again some way off.
describe("cutting each gap to the caption that actually painted", () => {
	/** A style object with the two things these paths write: properties and custom properties. */
	function styleOf() {
		const style = { props: {} };
		style.setProperty = (name, value) => { style.props[name] = value; };
		return style;
	}

	/** One piece of a drawn link. */
	function part(dataset) {
		const node = { dataset, attrs: {}, style: styleOf() };
		node.setAttribute = (name, value) => { node.attrs[name] = value; };
		return node;
	}

	/**
	 * A document that can measure a caption, which is what the window asks for before it cuts
	 * anything. The real one is a canvas 2D context set to the face the stylesheet ended up
	 * painting in; this one charges a flat `perChar` so a test can say what a caption measured.
	 */
	function measuringDoc(perChar) {
		return {
			activeElement: null,
			createElement: () => ({
				getContext: () => ({ font: "", measureText: text => ({ width: text.length * perChar }) }),
			}),
			defaultView: {
				getComputedStyle: () => ({
					fontStyle: "normal", fontWeight: "400", fontSize: "12px", fontFamily: "serif",
				}),
			},
		};
	}

	// Two people far enough apart to carry a whole sentence between them, so the line is long
	// enough to break at all and the overshoot has somewhere to show.
	const TALKERS = {
		version: 1,
		nodes: {
			elena: { uuid: null, name: "Elena", img: "", x: 8, y: 50, note: "" },
			stefan: { uuid: null, name: "Stefan", img: "", x: 92, y: 50, note: "" },
		},
		edges: {
			link1: {
				a: "elena", b: "stefan", ink: "rose", dir: "none", note: "",
				label: "shut the great gate in his face and left him out all night",
			},
		},
	};

	/** A board whose one link has been drawn, its caption costing `perChar` pixels a character. */
	function drawn(perChar) {
		const made = windowFor(TALKERS);
		const line = part({ relmapLine: "link1" });
		const label = part({ relmapEdge: "link1" });
		const words = part({ relmapWords: "link1" });
		words.textContent = TALKERS.edges.link1.label;
		words.ownerDocument = measuringDoc(perChar);
		made.board.all = {
			"[data-relmap-line]": [line],
			"[data-relmap-edge]": [label],
			"[data-relmap-words]": [words],
			"[data-relmap-head]": [],
		};
		// What the render does before the markup lands: the shapes it built are held for exactly
		// this second pass.
		made.app._boardContext(made.app._plan());
		return { ...made, line, label, words };
	}

	/** How wide the hole in a broken `d` is, in board percentages. */
	function gapOf(d) {
		const [first, second] = d.split("M").filter(Boolean);
		const end = first.split("Q")[1].trim().split(/[ ,]/).slice(2).map(Number);
		const start = second.trim().split(" ")[0].split(",").map(Number);
		return Math.hypot(start[0] - end[0], start[1] - end[1]);
	}

	// The estimate charges 6.3 pixels a character; this caption paints at 5.2, which is what the
	// real face measures. Every one of those pixels was a pixel of stroke rubbed out for a word
	// that was never there.
	it("re-cuts the stroke to the measured caption instead of the guessed one", () => {
		const { app, line } = drawn(5.2);
		const guessed = app._drawn.shapes.get("link1").d;
		app._fitGapsToPaint();
		expect(line.attrs.d).toBeTruthy();
		expect(gapOf(line.attrs.d)).toBeLessThan(gapOf(guessed));
		expect((gapOf(guessed) - gapOf(line.attrs.d)) * 12).toBeGreaterThan(50);
	});

	it("leaves the two ends of the line exactly where the render put them", () => {
		const { app, line } = drawn(5.2);
		const whole = app._drawn.shapes.get("link1").curve;
		app._fitGapsToPaint();
		expect(line.attrs.d.startsWith(`M ${whole.from.left},${whole.from.top}`)).toBe(true);
		expect(line.attrs.d.endsWith(`${whole.to.left},${whole.to.top}`)).toBe(true);
	});

	// NOTHING TO RE-PLACE, and that is what the straight setting buys outright: the words are
	// centred on the anchor and turned to the line's angle there, and neither of those moves when
	// the sentence is cut shorter. What the measurement is still for is the hole in the stroke.
	it("leaves the caption where it is and re-cuts only the hole it sits in", () => {
		const { app, words, line } = drawn(5.2);
		const before = { x: words.attrs.x, y: words.attrs.y, turn: words.attrs.transform };
		app._fitGapsToPaint();
		expect(words.attrs.x).toBe(before.x);
		expect(words.attrs.y).toBe(before.y);
		expect(words.attrs.transform).toBe(before.turn);
		expect(line.attrs.d).toBeTruthy();
	});

	// The measurement is kept for the live drag, which re-cuts these same gaps every frame and
	// must not ask the browser to lay the board out on any of them.
	it("keeps what it measured, so a dragged line breaks for the same words as a still one", () => {
		const { app } = drawn(5.2);
		app._fitGapsToPaint();
		const said = TALKERS.edges.link1.label;
		expect(app._drawn.painted.get("link1")).toBeCloseTo(said.length * 5.2, 6);
	});

	// SVG has no `text-overflow`, and a glyph past the end of its rail is simply not drawn -- so a
	// caption too long for the room its line has is cut HERE, with an ellipsis to say that it was.
	// The whole sentence is still in the tooltip.
	it("cuts a caption its line has no room for, and says so with an ellipsis", () => {
		const { app, words } = drawn(30);
		const room = app._drawn.shapes.get("link1").labelMax;
		app._fitGapsToPaint();
		expect(words.textContent.endsWith("…")).toBe(true);
		expect(words.textContent.length).toBeLessThan(TALKERS.edges.link1.label.length);
		expect(app._drawn.painted.get("link1")).toBeLessThanOrEqual(room);
	});

	it("leaves the caption whole when it fits", () => {
		const { app, words } = drawn(5.2);
		app._fitGapsToPaint();
		expect(words.textContent).toBe(TALKERS.edges.link1.label);
	});

	it("leaves the guess standing where nothing on the board can be measured", () => {
		const made = drawn(5.2);
		made.words.ownerDocument = { activeElement: null };
		const guessed = made.app._drawn.shapes.get("link1").d;
		made.app._fitGapsToPaint();
		expect(made.line.attrs.d).toBeUndefined();
		expect(made.app._drawn.shapes.get("link1").d).toBe(guessed);
	});

	it("has nothing to re-cut before anything has been drawn, rather than throwing", () => {
		const { app } = windowFor(TALKERS);
		expect(() => app._fitGapsToPaint()).not.toThrow();
	});

	// A FACE NOTHING HAS PAINTED WITH YET IS NOT A PENDING LOAD, so `document.fonts.ready` resolves
	// perfectly happily while the face this board is about to be set in has never been fetched.
	// Measured in the fallback, every rail on the board comes out cut for the wrong words, and a
	// caption longer than its rail loses whatever falls off the end of it.
	it("asks the document for the face it is about to measure in, and measures again once it lands", async () => {
		const made = drawn(5.2);
		let arrived = false;
		const asked = [];
		made.root.ownerDocument.fonts = {
			check: font => { asked.push(font); return arrived; },
			load: () => { arrived = true; return Promise.resolve([]); },
		};
		made.app._fitGapsToPaint();
		expect(asked[0]).toContain("12px");
		expect(made.app._awaitingFonts).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(made.app._awaitingFonts).toBe(false);
		// And having landed, the board is measured again rather than left cut for the fallback.
		expect(asked.length).toBeGreaterThan(1);
	});
});

describe("opening the sheet behind a portrait", () => {
	const WITH_ACTORS = {
		version: 1,
		nodes: {
			elena: { uuid: "Actor.a1", name: "Elena", img: "", x: 20, y: 30, note: "" },
			nobody: { uuid: null, name: "The Miller", img: "", x: 70, y: 30, note: "" },
		},
		edges: {},
	};

	let sheet;
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
		sheet = { render: vi.fn() };
		globalThis.fromUuid = async uuid => (uuid === "Actor.a1" ? { sheet } : null);
	});

	it("opens the actor's sheet, rather than saying they are gone", async () => {
		const { app } = windowFor(WITH_ACTORS);
		await app._openPerson("elena");
		expect(sheet.render).toHaveBeenCalledWith(true);
		expect(globalThis.ui.notifications.warn).not.toHaveBeenCalled();
	});

	it("still says so when the actor really has been deleted", async () => {
		const gone = { ...WITH_ACTORS, nodes: { ...WITH_ACTORS.nodes } };
		gone.nodes.elena = { ...gone.nodes.elena, uuid: "Actor.zz" };
		const { app } = windowFor(gone);
		await app._openPerson("elena");
		expect(sheet.render).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});

	// Somebody on the map who never had a sheet: a settlement the ratings import brought in, or a
	// name typed onto the board. A different sentence, and not a warning.
	it("says something else for somebody who has no sheet at all", async () => {
		const { app } = windowFor(WITH_ACTORS);
		await app._openPerson("nobody");
		expect(globalThis.ui.notifications.info).toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).not.toHaveBeenCalled();
	});
});

describe("who may change a map", () => {
	it("is editable by an owner and by nobody else", () => {
		const owner = windowFor(TWO_PEOPLE, { isOwner: true }).app;
		expect(owner.canEdit).toBe(true);
		expect(owner.canEdit).toBe(true);

		const reader = windowFor(TWO_PEOPLE, { isOwner: false }).app;
		expect(reader.canEdit).toBe(false);
		expect(reader.canEdit).toBe(false);
	});

	// OPENS READY TO EDIT. A lock used to stand in front of this, closed on open, so that nobody
	// nudged a portrait while reaching for the board. It asked the deliberate question of everyone
	// including the person who had come to move somebody, which is most of the people who open a
	// map at all, so it is gone: permission is the whole of the gate.
	it("opens ready to edit, for an owner", () => {
		const app = new RelationshipMapWindow(entryFor(TWO_PEOPLE), {});
		expect(app.canEdit).toBe(true);
	});
});

// The other way of reading the same map. What is worth pinning here is the promise the whole view
// rests on: it is the READER's, it writes nothing, and switching back leaves the board exactly as
// the table arranged it.
describe("the family tree view", () => {
	const A_FAMILY = {
		version: 1,
		nodes: {
			ma: { uuid: null, name: "Ma", img: "", x: 20, y: 30, note: "" },
			pa: { uuid: null, name: "Pa", img: "", x: 70, y: 30, note: "" },
			kid: { uuid: null, name: "Kid", img: "", x: 45, y: 80, note: "" },
			smith: { uuid: null, name: "Smith", img: "", x: 90, y: 90, note: "" },
		},
		edges: {
			e1: { a: "ma", b: "pa", label: "married", ink: "rose", dir: "none", kin: "partner", note: "" },
			e2: { a: "ma", b: "kid", label: "her son", ink: "rose", dir: "none", kin: "parent", note: "" },
			e3: { a: "pa", b: "kid", label: "his son", ink: "rose", dir: "none", kin: "parent", note: "" },
			e4: { a: "ma", b: "smith", label: "owes money to", ink: "sage", dir: "none", note: "" },
		},
	};

	const inFamilyView = (graph = A_FAMILY) => {
		const made = windowFor(graph);
		made.app._view = "family";
		return made;
	};

	it("shows only the people a family line touches, at seats of its own", () => {
		const { app } = inFamilyView();
		const context = app._boardContext(app._plan());
		expect(context.nodes.map(node => node.id).sort()).toEqual(["kid", "ma", "pa"]);
		// Not where the stored map has them: `ma` is at x 20 on the board and the chart seats her
		// by who she is descended from.
		expect(context.nodes.find(node => node.id === "ma").left).not.toBe(20);
	});

	// The web is not hidden on the tree, it is not asked for: a bowed line between two faces saying
	// "her son" would be drawing a second time what the chart is already saying with its corners.
	it("draws households instead of the web, and offers no handle to add to it", () => {
		const { app } = inFamilyView();
		const context = app._boardContext(app._plan());
		expect(context.edges).toEqual([]);
		expect(context.labels).toEqual([]);
		expect(context.tree.length).toBeGreaterThan(0);
		expect(context.tree[0].who).toContain("kid");
		expect(context.canEdit).toBe(true);
		expect(context.canLink).toBe(false);
	});

	// ⚠ THE PROMISE THE VIEW RESTS ON. The chart works its seats out on this machine and writes
	// none of them; the arrangement the table built is still in the document, so switching back
	// puts the reader in front of it untouched.
	it("writes nothing at all, however long it is looked at", () => {
		const { app, entry } = inFamilyView();
		app._boardContext(app._plan());
		app._setView("family");
		app._setView("everyone");
		expect(entry.updates).toEqual([]);
	});

	it("is one reader's own, and switching it re-renders rather than repainting", () => {
		const { app } = windowFor(A_FAMILY);
		expect(app._view).toBe("everyone");
		app._setView("family");
		expect(app._view).toBe("family");
		// A render, unlike every other repaint in this window: the tools on the bar change and the
		// sheet changes size, so there is no corner of a zoom worth keeping.
		expect(app.render).toHaveBeenCalled();
	});

	// ⚠ AND ONLY WHEN IT CHANGES. With a two-way toggle this could not arise; with a chooser,
	// picking the row you are already on is the commonest idle gesture there is, and a render would
	// re-fit the board and cost the reader the corner they had zoomed into for no change at all.
	it("does nothing at all when asked for the view already up", () => {
		const { app } = windowFor(A_FAMILY);
		app._setView("everyone");
		expect(app.render).not.toHaveBeenCalled();
		// Absent rather than null: `windowFor` builds the instance without running the constructor.
		expect(app._sayOnRender).toBeFalsy();
	});

	// A view name arrives from a `<select>`, and one day from a newer version of this system that
	// had a fifth. The whole board is the one view that is always drawable.
	it("reads a view it does not know as the whole board", () => {
		const { app } = inFamilyView();
		app._setView("nonsense");
		expect(app._view).toBe("everyone");
	});

	// ⚠ SAID WHERE IT CAN BE HEARD. `render()` is fire-and-forget, so an announcement written on
	// either side of that call goes into the live region the render is about to throw away, and a
	// reader on a screen reader is told nothing at all about the view they just changed to. It is
	// handed to the render instead and spoken once the new region is on screen.
	it("tells a screen reader which map is up, after the render that replaces the region", () => {
		const { app, live } = windowFor(A_FAMILY);
		live.textContent = "";
		app._setView("family");
		// NOT yet. The region still on screen belongs to the render being replaced, and anything
		// written into it now goes down with it.
		expect(live.textContent).toBe("");
		const held = app._sayOnRender;
		expect(held).toBeTruthy();

		// What `_render` does once the new region is on screen.
		app._saySoFar();
		expect(live.textContent).toBe(held);
		expect(app._sayOnRender).toBeNull();

		// And a later render with nothing to say does not repeat it.
		live.textContent = "";
		app._saySoFar();
		expect(live.textContent).toBe("");
	});

	// FOUR VIEWS, FOUR SENTENCES. This used to key off `familyNow.on|off`, which a four-valued
	// state cannot use: two of the views would have announced the same words, and after the render
	// this announcement is the only thing a reader who cannot see the board learns about the press.
	it("says a different thing for every view", () => {
		const { app, live } = windowFor(A_FAMILY);
		const said = new Set();
		for (const view of ["family", "party", "everyone"]) {
			app._setView(view);
			app._saySoFar();
			said.add(live.textContent);
		}
		expect(said.size).toBe(3);
	});

	// A reader who may only look at the map still gets every view: none of them changes anything in
	// the document, exactly like the captions control beside them.
	it("is offered to somebody who may not edit the map", () => {
		const { app } = windowFor(A_FAMILY, { isOwner: false });
		expect(app.canEdit).toBe(false);
		app._setView("family");
		expect(app._view).toBe("family");
	});

	// ⚠ AN AppV1 RENDER DROPS FOCUS TO THE DOCUMENT BODY, and switching views is the one thing in
	// this window that renders. Without putting it back, changing view from the keyboard means
	// tabbing in from the top of the window again every time -- on the control whose whole point is
	// that it is flicked between. The announcement is the only other thing a reader who cannot see
	// the board gets from the press.
	it("puts the reader's focus back on the control they used", () => {
		const { app, root } = windowFor(A_FAMILY);
		const chooser = el();
		chooser.focus = vi.fn();
		root.children["[data-relmap-view]"] = chooser;
		app._setView("family");
		app._takeFocusBack();
		expect(chooser.focus).toHaveBeenCalled();
		// And an ORDINARY render -- a live update that could not be repainted, a resize -- must not
		// move anybody's focus at all.
		chooser.focus.mockClear();
		app._takeFocusBack();
		expect(chooser.focus).not.toHaveBeenCalled();
	});

	// ⚠ THE GATE THAT USED TO BE A DENYLIST. Every one of these was written as `!== VIEW_FAMILY`,
	// so the moment a third and fourth view existed they inherited "yes" from all of them: draggable
	// portraits on a computed board, each drag silently writing the shared document while the reader
	// watched nothing move; sidebar drops accepted and then not drawn; and Tidy up re-seating forty
	// people from a view showing six.
	it("refuses every writing gesture on any view that seats itself", () => {
		const { app } = windowFor(A_FAMILY);
		expect(app._placesOwnSeats()).toBe(false);
		for (const view of ["party", "focus", "family"]) {
			app._view = view;
			expect(app._placesOwnSeats()).toBe(true);
		}
	});
});

// Only the player characters, and only the lines between two of them: the introductions read back.
describe("the party view", () => {
	const PARTY = {
		version: 1,
		nodes: {
			pim: { uuid: "Actor.pim", name: "Pim", img: "", x: 10, y: 10, note: "" },
			sela: { uuid: "Actor.sela", name: "Sela", img: "", x: 80, y: 20, note: "" },
			ordga: { uuid: "Actor.ordga", name: "Ordga", img: "", x: 40, y: 70, note: "" },
		},
		edges: {
			e1: { a: "pim", b: "sela", label: "trusts", ink: "sage", dir: "a-b", note: "" },
			e2: { a: "sela", b: "pim", label: "wary of", ink: "rust", dir: "a-b", note: "" },
			e3: { a: "pim", b: "ordga", label: "her apprentice", ink: "slate", dir: "none", note: "" },
		},
	};

	const inPartyView = (party = ["Actor.pim", "Actor.sela"]) => {
		const made = windowFor(PARTY);
		globalThis.game.actors = {
			contents: party.map(uuid => ({
				id: uuid.split(".")[1], uuid, type: "character", name: uuid, hasPlayerOwner: true,
			})),
		};
		made.app._view = "party";
		return made;
	};

	it("shows the player characters and nobody else", () => {
		const { app } = inPartyView();
		const context = app._boardContext(app._plan());
		expect(context.nodes.map(node => node.id).sort()).toEqual(["pim", "sela"]);
	});

	// A NARROWING of whatever board is up. On "The Party" page, which is seeded from the Chronicle
	// (relmap/relmap-party.js), that is an arrow each way per answer; on any other page it is
	// whatever the table drew. The view derives nothing of its own.
	it("keeps every line the board has between two of them", () => {
		const { app } = inPartyView();
		const context = app._boardContext(app._plan());
		expect(context.edges).toHaveLength(2);
		expect(context.labels.map(l => l.text).sort()).toEqual(["trusts", "wary of"]);
	});

	// ⚠ THE CRASH THIS AVOIDS. `edgeShapes` reads an end's `x` with no guard, so a person pruned
	// without their lines is a TypeError inside `getData` and a window that renders blank.
	it("leaves no line hanging off somebody it is not showing", () => {
		const { app } = inPartyView();
		const plan = app._plan();
		for (const edge of Object.values(plan.graph.edges)) {
			expect(plan.graph.nodes[edge.a]).toBeTruthy();
			expect(plan.graph.nodes[edge.b]).toBeTruthy();
		}
	});

	// The seats are the view's own, and they are BAKED INTO the graph the board is drawn from:
	// carried beside it, every line would be drawn between the positions people hold on the real
	// board while their faces stood somewhere else.
	it("draws the lines between the seats it gave people, not the stored ones", () => {
		const { app } = inPartyView();
		const plan = app._plan();
		expect(plan.graph.nodes.pim.x).not.toBe(10);
		const context = app._boardContext(plan);
		expect(context.nodes.find(n => n.id === "pim").left).toBe(plan.graph.nodes.pim.x);
	});

	it("writes nothing, and leaves the stored board untouched", () => {
		const { app, entry } = inPartyView();
		app._boardContext(app._plan());
		expect(entry.updates).toEqual([]);
		expect(readGraph(entry).nodes.pim.x).toBe(10);
	});

	it("draws no link handle, because a new line has nowhere to land", () => {
		const { app } = inPartyView();
		expect(app._boardContext(app._plan()).canLink).toBe(false);
	});

	it("says it is showing nobody rather than painting a blank sheet", () => {
		const { app } = inPartyView([]);
		const plan = app._plan();
		expect(plan.bare).toBe("party");
		const said = app._chrome(plan);
		// `empty` stays a statement about the MAP, which has three people on it.
		expect(said.empty).toBe(false);
		expect(said.noKin).toBe(true);
		expect(said.bareAction.action).toBe("showall");
	});
});

// ── Which board is the party's ──────────────────────────────────────────────────────────────
//
// The board called "The Party" seats the party by itself when the primary GM opens the map, and
// knowing that it IS that board is what decides whether "Match answers to people" is offered. There
// is no longer a button asking for the seating pass out loud: somebody missing from the board is
// dragged on or added by hand.
describe("the party board's role", () => {

	/** A window on a map whose party board is `PARTY_PAGE`, standing on the page given. */
	const on = (pageId, { isOwner = true, primary = true } = {}) => {
		const made = windowFor(TWO_PEOPLE, { isOwner });
		const pages = [
			{ id: "board1", name: "The people of Stonetop", flags: {} },
			{ id: "party1", name: "The Party", flags: { "stonetop-pwd": { relationshipPartyBoard: true } } },
		];
		for (const page of pages) {
			page.getFlag = (scope, key) => page.flags[scope]?.[key] ?? null;
			page.sort = 0;
		}
		// `listMapPages` keeps only pages carrying a graph, so both need one.
		for (const page of pages) {
			page.flags["stonetop-pwd"] = { ...page.flags["stonetop-pwd"], relationshipMap: { nodes: {}, edges: {} } };
		}
		made.entry.pages = { contents: pages };
		made.app._pageId = pageId;
		globalThis.game.users = primary
			? { activeGM: { id: "u1" } }
			: { activeGM: { id: "somebody-else" } };
		return made;
	};

	// ⚠ ASKED OF THE PAGE AND NEVER OF ITS NAME. The board is renameable like any other, and a table
	// that calls it "Us" must not lose the tools that belong to it.
	it("knows the party board even after it has been renamed", () => {
		const { app, entry } = on("party1");
		entry.pages.contents[1].name = "Us";
		expect(app._boardRole()).toBe("party");
	});

	it("is not the board the reader is on when they are on another one", () => {
		expect(on("board1").app._boardRole()).toBe("");
	});

	// ⚠ THE SEATING PASS IS THE PRIMARY GM'S ALONE, now that nothing else can ask for it. It runs
	// unasked on every client that may edit and mints fresh ids, so two people opening the map in
	// the same minute would each write the same missing line under a different id.
	it("does not seat the party on a client that is not the primary GM", async () => {
		const { app } = on("party1", { primary: false });
		expect(await app._syncPartyPage()).toBe(null);
	});

	// The button that used to sit on the bar is gone, so the action it answered to is gone with it:
	// a stray press does nothing rather than reaching the seating pass from a client that must not
	// run it.
	it("has no refresh action left on the tool bar", async () => {
		const { app } = on("party1");
		app._syncPartyPage = vi.fn();
		await app._onToolClick({ currentTarget: { dataset: { relmapAction: "refreshparty" } } });
		expect(app._syncPartyPage).not.toHaveBeenCalled();
	});
});

// ── Which board is the village's ────────────────────────────────────────────────────────────
//
// The other board that fills itself: the map's own board takes on the steading's Residents roster
// when the map is opened. Nothing asks for that pass out loud any more, so a resident taken off the
// board stays off, and the way back is to drag them on or add them by hand.
describe("the village board's role", () => {

	/** A window on a map whose village board is `village1`, standing on the page given. */
	const on = (pageId, { isOwner = true, primary = true } = {}) => {
		const made = windowFor(TWO_PEOPLE, { isOwner });
		const pages = [
			{ id: "party1", name: "The Party", flags: { "stonetop-pwd": { relationshipPartyBoard: true } } },
			{ id: "village1", name: "Stonetop", flags: { "stonetop-pwd": { relationshipVillageBoard: { seated: [] } } } },
		];
		for (const page of pages) {
			page.flags["stonetop-pwd"] = { ...page.flags["stonetop-pwd"], relationshipMap: { nodes: {}, edges: {} } };
			page.getFlag = (scope, key) => page.flags[scope]?.[key] ?? null;
			page.sort = 0;
		}
		made.entry.pages = { contents: pages };
		made.app._pageId = pageId;
		globalThis.game.users = primary
			? { activeGM: { id: "u1" } }
			: { activeGM: { id: "somebody-else" } };
		return made;
	};

	// By the flag, never by the name: this board is the one named after the map, and renaming a map
	// is an ordinary thing to do.
	it("knows the village board even after it has been renamed", () => {
		const { app, entry } = on("village1");
		entry.pages.contents[1].name = "Home";
		expect(app._boardRole()).toBe("village");
	});

	it("is not the board the reader is on when they are on the party's", () => {
		expect(on("party1").app._boardRole()).not.toBe("village");
	});

	// The same guard the party board keeps, and for the same reason: the pass runs unasked on every
	// client that may edit and mints fresh ids.
	it("does not seat the village on a client that is not the primary GM", async () => {
		const { app } = on("village1", { primary: false });
		expect(await app._syncVillagePage()).toBe(null);
	});

	it("has no refresh action left on the tool bar", async () => {
		const { app } = on("village1");
		app._syncVillagePage = vi.fn();
		await app._onToolClick({ currentTarget: { dataset: { relmapAction: "refreshvillage" } } });
		expect(app._syncVillagePage).not.toHaveBeenCalled();
	});
});

// One person, everybody with a line straight to them, and only the lines that touch them.
describe("one person's web", () => {
	const WEB = {
		version: 1,
		nodes: {
			pim: { uuid: "Actor.pim", name: "Pim", img: "", x: 10, y: 10, note: "" },
			sela: { uuid: null, name: "Sela", img: "", x: 80, y: 20, note: "" },
			ordga: { uuid: null, name: "Ordga", img: "", x: 40, y: 70, note: "" },
			away: { uuid: null, name: "Away", img: "", x: 95, y: 95, note: "" },
		},
		edges: {
			e1: { a: "pim", b: "sela", label: "best friends", ink: "sage", dir: "none", note: "" },
			e2: { a: "ordga", b: "pim", label: "her apprentice", ink: "slate", dir: "none", note: "" },
			e3: { a: "sela", b: "ordga", label: "cannot stand her", ink: "rust", dir: "none", note: "" },
		},
	};

	// ⚠ THE REAL LANGUAGE TABLE. The suite's `beforeEach` replaces `globalThis.game` with the two
	// members these paths touch, which quietly takes `i18n` away; this view's panel and its
	// announcement both name a PERSON, so without it they come back as bare keys and an assertion
	// about the words would pass on anything.
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
	});

	const inFocusView = (on = "pim") => {
		const made = windowFor(WEB);
		made.app._view = "focus";
		made.app._focus = on;
		return made;
	};

	it("shows the person and everybody with a line straight to them", () => {
		const { app } = inFocusView();
		const context = app._boardContext(app._plan());
		expect(context.nodes.map(node => node.id).sort()).toEqual(["ordga", "pim", "sela"]);
	});

	it("puts them in the middle and marks which face that is", () => {
		const { app } = inFocusView();
		const context = app._boardContext(app._plan());
		const centre = context.nodes.find(node => node.id === "pim");
		expect(centre.left).toBe(50);
		expect(centre.top).toBe(50);
		expect(centre.centre).toBe(true);
		expect(context.nodes.filter(node => node.centre)).toHaveLength(1);
	});

	// DIRECT LINKS ONLY, and this half is a choice: two of the centre's friends stand side by side
	// with nothing between them although the board has a line there. That is the difference between
	// a star and a small dense web, and the corner aside says so.
	it("draws only the lines that touch the person in the middle", () => {
		const { app } = inFocusView();
		const context = app._boardContext(app._plan());
		expect(context.labels.map(l => l.text).sort()).toEqual(["best friends", "her apprentice"]);
	});

	// It happens: the reader picks somebody and another player takes them off the board a minute
	// later, and this runs again inside the repaint that carries them away.
	it("says so when the person it is about has left the map, rather than re-centring quietly", () => {
		const { app } = inFocusView("somebody-who-left");
		const plan = app._plan();
		expect(plan.centre).toBeNull();
		const said = app._chrome(plan);
		expect(said.noKin).toBe(true);
		// The way OUT of the view, not a second route to the chooser standing on the bar above it.
		expect(said.bareAction.action).toBe("showall");
		// ⚠ AND IT SAYS WHICH OF THE TWO THIS IS. "Nobody is chosen yet" is the state a reader
		// arrives in; this one is something that HAPPENED to them while they watched, and telling
		// them the first reads as the window having forgotten what they asked for.
		expect(plan.bare).toBe("gone");
		expect(said.bareLead).not.toBe(app._bareSaid({ bare: "nobody" }).bareLead);
	});

	it("tells a reader who has chosen nobody at all something different", () => {
		const { app } = inFocusView(null);
		const plan = app._plan();
		expect(plan.bare).toBe("nobody");
	});

	it("says so when nothing at all is linked to them", () => {
		const { app } = inFocusView("away");
		const plan = app._plan();
		expect(plan.centre).toBe("away");
		expect(plan.bare).toBe("focus");
		expect(app._chrome(plan).bareLead).toContain("Away");
	});

	it("writes nothing, and leaves the stored board untouched", () => {
		const { app, entry } = inFocusView();
		app._boardContext(app._plan());
		expect(entry.updates).toEqual([]);
		expect(readGraph(entry).nodes.pim.x).toBe(10);
	});

	// The reader's own person if they are on this map; otherwise whoever has the most lines drawn
	// to them. ⚠ NEVER `game.user.character` straight off: in this system a full GM's assigned
	// character is their GM Toolkit actor, which cannot be on a relationship map at all.
	it("opens on the reader's own person when they are on the map", () => {
		const { app, entry } = inFocusView();
		globalThis.game.user = { id: "u1", character: { uuid: "Actor.pim", name: "Pim" } };
		expect(app._defaultFocus(readGraph(entry))).toBe("pim");
	});

	it("falls through to the busiest person when the reader's is not on the map", () => {
		const { app, entry } = inFocusView();
		globalThis.game.user = { id: "u1", character: { uuid: "Actor.toolkit", name: "GM Toolkit" } };
		// `pim` and `sela` and `ordga` all carry two lines; the tie is broken by id, never by
		// whatever order the flag came back in.
		expect(["ordga", "pim", "sela"]).toContain(app._defaultFocus(readGraph(entry)));
	});

	it("settles on somebody on the way in, so the view never opens on nothing", () => {
		const { app } = windowFor(WEB);
		globalThis.game.user = { id: "u1", character: null };
		app._setView("focus");
		expect(app._focus).toBeTruthy();
		expect(app._plan().centre).toBe(app._focus);
	});
});

// THE DROPDOWN THAT POINTS THAT VIEW AT A PERSON. It replaced a button opening a modal list, and
// the reason is the gesture rather than the chrome: walking the party one player at a time is the
// whole of what the view is for, and a window to open and dismiss between each of them is a window
// standing in the middle of the comparison the reader is making.
//
// Its rows are the one thing on the bar whose CONTENTS come off the shared document, which is what
// the second half of this suite is about.
describe("the chooser the focus view is pointed with", () => {
	const CAST = {
		version: 1,
		nodes: {
			pim: { uuid: "Actor.pim", name: "Pim", img: "", x: 10, y: 10, note: "" },
			sela: { uuid: "Actor.sela", name: "Sela", img: "", x: 80, y: 20, note: "" },
			mill: { uuid: null, name: "The Mill", img: "", x: 40, y: 70, note: "" },
			ordga: { uuid: null, name: "Ordga <the elder>", img: "", x: 60, y: 40, note: "" },
		},
		edges: {
			e1: { a: "pim", b: "sela", label: "best friends", ink: "sage", dir: "none", note: "" },
			e2: { a: "pim", b: "mill", label: "works there", ink: "slate", dir: "none", note: "" },
			e3: { a: "pim", b: "ordga", label: "her apprentice", ink: "rose", dir: "none", note: "" },
		},
	};

	// ⚠ THE REAL LANGUAGE TABLE, for the reason the view above needs it: the group headings and the
	// "your character" marker are localized, so without it every assertion about the words would be
	// asserting on bare keys and would pass against a chooser that had never been built.
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.game.actors = {
			contents: ["Actor.pim", "Actor.sela"].map(uuid => ({
				id: uuid.split(".")[1], uuid, type: "character", name: uuid, hasPlayerOwner: true,
			})),
		};
		globalThis.game.user = { id: "u1", character: null };
	});

	const pointedAt = (on = "pim", graph = CAST) => {
		const made = windowFor(graph);
		made.app._view = "focus";
		made.app._focus = on;
		return made;
	};

	const rows = app => app._chrome(app._plan()).focusPick;

	// THE PLAYER CHARACTERS FIRST AND IN THEIR OWN GROUP. "Whose web am I looking at" is nearly
	// always asked of one of them, and on a village of forty a flat list in name order buries the
	// six faces it is usually about.
	it("puts the player characters in their own group, ahead of everybody else", () => {
		const { app } = pointedAt();
		const html = rows(app);
		expect(html.indexOf("Player characters")).toBeGreaterThan(-1);
		expect(html.indexOf("Player characters")).toBeLessThan(html.indexOf("Everyone else"));
		// Pim and Sela are the party; the mill and Ordga are not, and both are still reachable --
		// the steading everybody is linked to is one of the most useful centres a map has.
		const [party, others] = html.split("Everyone else");
		expect(party).toContain("Pim");
		expect(party).toContain("Sela");
		expect(others).toContain("The Mill");
		expect(others).toContain("Ordga");
	});

	// A heading over the whole of a list is a heading that says nothing.
	it("does not group a map with nobody else on it", () => {
		const { app } = pointedAt("pim", {
			version: 1,
			nodes: {
				pim: CAST.nodes.pim,
				sela: CAST.nodes.sela,
			},
			edges: { e1: CAST.edges.e1 },
		});
		expect(rows(app)).not.toContain("optgroup");
	});

	// ⚠ ONLY THE READER'S OWN, and only when they are on this map. `_myNode` is a different question
	// from "who is this view showing": in this system a full GM's assigned character is their GM
	// Toolkit actor, which cannot be on a relationship map at all, so marking the row the view
	// happens to have opened on would be marking a stranger as somebody's own character.
	it("says which row is the reader's own character", () => {
		const { app } = pointedAt();
		globalThis.game.user = { id: "u1", character: { uuid: "Actor.sela", name: "Sela" } };
		const html = rows(app);
		expect(html).toContain("Sela (your character)");
		expect(html).not.toContain("Pim (your character)");
	});

	it("marks nobody at all when the reader's character is not on this map", () => {
		const { app } = pointedAt();
		globalThis.game.user = { id: "u1", character: { uuid: "Actor.toolkit", name: "GM Toolkit" } };
		expect(rows(app)).not.toContain("your character");
	});

	// The rows are actor names, which is text somebody at this table typed, and they are going into
	// markup rather than through Handlebars: the window builds them so that a repaint can write the
	// same string again, and that makes the escaping ours.
	it("escapes the names", () => {
		const { app } = pointedAt();
		const html = rows(app);
		expect(html).toContain("Ordga &lt;the elder&gt;");
		expect(html).not.toContain("<the elder>");
	});

	it("shows the person the board is showing as the one picked", () => {
		const { app } = pointedAt("mill");
		expect(rows(app)).toContain('<option value="mill" selected>The Mill</option>');
	});

	// ⚠ A `<select>` WHOSE VALUE MATCHES NO OPTION SHOWS ITS FIRST ONE. Without a row for nobody,
	// a chooser whose centre had been taken off the map would sit there naming somebody the board
	// is not showing, beside a panel explaining that the person it was showing has gone.
	it("carries a row for nobody while there is no centre", () => {
		const { app } = pointedAt("somebody-who-left");
		const html = rows(app);
		expect(html.startsWith('<option value="" selected>')).toBe(true);
		expect(html).not.toContain("selected>Pim");
	});

	it("is not built at all on the other three views", () => {
		const { app } = pointedAt();
		app._view = "everyone";
		expect(rows(app)).toBeNull();
	});
});

// Picking somebody out of that chooser. A whole render, exactly as switching view is: a different
// cast on a differently sized sheet, with everybody at a seat this view has just worked out.
describe("showing somebody else's web", () => {
	const WEB = {
		version: 1,
		nodes: {
			pim: { uuid: null, name: "Pim", img: "", x: 10, y: 10, note: "" },
			sela: { uuid: null, name: "Sela", img: "", x: 80, y: 20, note: "" },
		},
		edges: { e1: { a: "pim", b: "sela", label: "best friends", ink: "sage", dir: "none", note: "" } },
	};

	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.game.user = { id: "u1", character: null };
		globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
	});

	const pointedAt = (on = "pim") => {
		const made = windowFor(WEB);
		made.app._view = "focus";
		made.app._focus = on;
		return made;
	};

	it("re-centres on them, and says whose web is up now", () => {
		const { app } = pointedAt();
		app._setFocus("sela");
		expect(app._focus).toBe("sela");
		expect(app.render).toHaveBeenCalled();
		expect(app._sayOnRender).toContain("Sela");
		// ⚠ AN AppV1 RENDER DROPS FOCUS TO THE DOCUMENT BODY, and this is the control a reader
		// walking the party is about to use again.
		expect(app._focusOnRender).toBe("[data-relmap-focus]");
	});

	// Nothing is written, here or anywhere the narrow views touch. That is what makes them views.
	it("leaves the stored board exactly as the table left it", () => {
		const { app, entry } = pointedAt();
		app._setFocus("sela");
		expect(entry.updates).toEqual([]);
	});

	// ⚠ RE-READ BEFORE IT IS BELIEVED. The rows were built when this window last painted, and
	// somebody at the far end of the table can take a person off the map in between.
	it("refuses somebody who has left the map since the rows were written, and says why", () => {
		const { app } = pointedAt();
		app._setFocus("somebody-who-left");
		expect(app._focus).toBe("pim");
		expect(app.render).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});

	// Picking the row that is already showing is the commonest idle gesture a dropdown has, and a
	// render would cost the reader the corner they had zoomed into for no change at all.
	it("does nothing when the reader picks the person already in the middle", () => {
		const { app } = pointedAt();
		app._setFocus("pim");
		expect(app.render).not.toHaveBeenCalled();
	});

	// The empty row stands in the list only to stop the control naming a stranger; choosing it is
	// the reader landing back where they started, not a request for anything.
	it("does nothing when the reader picks the row for nobody", () => {
		const { app } = pointedAt("somebody-who-left");
		app._setFocus("");
		expect(app.render).not.toHaveBeenCalled();
	});
});

describe("finding the family ties already written on a map", () => {
	// ⚠ THE ONE PLACE IN THIS FILE THAT NEEDS THE REAL LANGUAGE TABLE. The suite's own `beforeEach`
	// replaces `globalThis.game` wholesale with the two members these paths touch, which quietly
	// takes `i18n` away with it; everywhere else that only means a key comes back instead of a
	// sentence, but the guess READS ITS WORD LIST out of the table, so without it there are no
	// words to match and this would pass by finding nothing whatever the code did.
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { info: () => {} } };
	});

	const OLD_MAP = {
		version: 1,
		nodes: {
			ma: { uuid: null, name: "Ma", img: "", x: 20, y: 30, note: "" },
			kid: { uuid: null, name: "Kid", img: "", x: 70, y: 30, note: "" },
		},
		edges: {
			e1: { a: "ma", b: "kid", label: "her mother", ink: "rose", dir: "none", note: "" },
			e2: { a: "kid", b: "ma", label: "smothered her at the mill", ink: "rose", dir: "none", note: "" },
		},
	};

	it("marks what the captions already say, in one write, and says how many", async () => {
		const { app, entry } = windowFor(OLD_MAP);
		await app._findKin();
		expect(entry.updates).toHaveLength(1);
		expect(entry.updates[0]).toEqual({
			"flags.stonetop-pwd.relationshipMap.edges.e1.kin": "parent",
		});
	});

	it("writes nothing when no unanswered line reads like family", async () => {
		const { app, entry } = windowFor(TWO_PEOPLE);
		await app._findKin();
		expect(entry.updates).toEqual([]);
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

// ── Putting the imported lines away ──────────────────────────────────────────
//
// "Pull in ratings" writes a line per rating, both ways round, so a table that rated everybody
// while introducing their characters ends up with the ties it drew by hand somewhere underneath a
// hundred imported ones. The box in the corner takes that whole kind of line off the board.
//
// WHAT HAS TO HOLD. It is one reader's own view, it writes nothing, and above all it must not reach
// the paths that WRITE: a graph with the hidden lines filtered out of it, handed to the delete,
// would take a portrait off the board and leave its hidden links dangling from nobody.

describe("hiding the lines the sheets drew", () => {
	it("draws every line while the box is clear", async () => {
		const { app, board } = windowFor(BOTH_KINDS);
		await app.sync();
		expect(board.innerHTML).toContain('edges="2"');
	});

	it("leaves the imported ones off the board once it is ticked", async () => {
		const { app, board } = windowFor(BOTH_KINDS);
		app._hidePulled = true;
		await app.sync();
		expect(board.innerHTML).toContain('edges="1"');
		// The people stay. Somebody who is on this map only because an import put them there is
		// still on it, and a portrait vanishing would look like the map losing people.
		expect(board.innerHTML).toContain('nodes="2"');
	});

	// ⚠ THE ONE THAT MATTERS. Everything that writes reads the entry itself, never the filtered
	// view: taking somebody off the board has to take EVERY link that touched them, including the
	// ones this reader cannot see, or the map is left with a line hanging from nobody.
	it("never lets the hiding reach what is written", () => {
		const { app, entry } = windowFor(BOTH_KINDS);
		app._hidePulled = true;
		const whole = readGraph(entry);
		expect(Object.keys(whole.edges)).toEqual(["link1", "pulled"]);
		expect(Object.keys(app._visibleGraph(whole).edges)).toEqual(["link1"]);
	});

	// A repaint and not a render: a render re-fits the board and costs the reader the corner they
	// had zoomed into, which is the state they were reading when they reached for the box.
	it("repaints on the press, and never re-renders the window", async () => {
		const { app, board, live } = windowFor(BOTH_KINDS);
		await app._togglePulled({ checked: true });
		expect(app.render).not.toHaveBeenCalled();
		expect(board.innerHTML).toContain('edges="1"');
		expect(live.textContent).toBeTruthy();
		await app._togglePulled({ checked: false });
		expect(board.innerHTML).toContain('edges="2"');
	});

	// ⚠ AND THE TRAP UNDER IT. The box takes focus on the click, and a focused field is one of the
	// things `_isBusy` counts, so a toggle routed through `sync` would defer its own repaint and the
	// box would appear to do nothing until the reader clicked elsewhere.
	it("repaints even though the box it was pressed on now has focus", async () => {
		const { app, root, board } = windowFor(BOTH_KINDS);
		const box = el({ tagName: "INPUT", type: "checkbox" });
		root.children[".box"] = box;
		root.ownerDocument.activeElement = box;
		await app._togglePulled({ checked: true });
		expect(board.innerHTML).toContain('edges="1"');
		// And a change from somebody else is not held back by it either: the window's chrome sits
		// outside the board's markup, so a repaint could not take a ticked box away in any case.
		expect(app._isBusy()).toBe(false);
	});

	it("offers the box only on a map something has been pulled into", async () => {
		const { app, foot } = windowFor(BOTH_KINDS);
		await app.sync();
		expect(foot.hidden).toBe(false);

		const plain = windowFor(TWO_PEOPLE);
		await plain.app.sync();
		expect(plain.foot.hidden).toBe(true);
	});

	// Asked of the WHOLE map and not of the filtered view, or ticking the box would take away the
	// box: the last imported line disappears, the answer turns false, and the one control that could
	// bring them back goes with it.
	it("keeps the box on the window while it is ticked", async () => {
		const { app, foot } = windowFor(BOTH_KINDS);
		app._hidePulled = true;
		await app.sync();
		expect(foot.hidden).toBe(false);
	});
});

// ── Rubbing those lines out for good ────────────────────────────────────────
//
// ⚠ THE WAY OUT OF A BUTTON THAT NO LONGER EXISTS. "Pull in ratings" wrote a line into the shared
// board for every rating anybody in the world had stored, both ways round; it is gone, and the
// party view shows the same regard without writing any of it. But a board somebody already pressed
// it on is still carrying every line it made, and there is no other way to be rid of a hundred
// lines than a hundred presses.
describe("rubbing out the lines an old import left behind", () => {
	/** The confirm this tool puts up, answered however the test says. */
	const asked = answer => {
		const calls = [];
		globalThis.foundry = {
			...globalThis.foundry,
			applications: { api: { DialogV2: { wait: spec => { calls.push(spec); return Promise.resolve(answer); } } } },
		};
		return calls;
	};

	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	});

	it("rubs out what the import stamped, and nothing else", async () => {
		asked("drop");
		const { app, entry } = windowFor(BOTH_KINDS);
		await app._dropImported();
		expect(entry.updates).toHaveLength(1);
		// One write for all of them: several would broadcast several times, and everybody else at
		// the table would watch the lines vanish one at a time.
		const [patch] = entry.updates;
		expect(Object.keys(patch)).toEqual(["flags.stonetop-pwd.relationshipMap.edges.-=pulled"]);
	});

	// The count is in the question, because there is no undo and the whole point of the press is
	// that the reader cannot see how many there are.
	it("asks first, and says how many", async () => {
		const calls = asked("keep");
		const { app, entry } = windowFor(BOTH_KINDS);
		await app._dropImported();
		expect(calls[0].content).toContain("1 line(s)");
		expect(entry.updates).toEqual([]);
	});

	// PEOPLE STAY. Some of them may be on the map only because the import put them there, but
	// taking somebody off is a separate act with its own question, and a button that removed a
	// dozen portraits as a side effect of tidying up lines is one nobody could predict.
	it("leaves everybody on the map", async () => {
		asked("drop");
		const { app, entry } = windowFor(BOTH_KINDS);
		await app._dropImported();
		expect(Object.keys(entry.updates[0]).some(key => key.includes(".nodes."))).toBe(false);
	});

	// Nothing creates such a line any more, so on nearly every board this is never seen at all --
	// and a press that arrives anyway means somebody else got there first.
	it("says so rather than sitting silent on a board with none", async () => {
		asked("drop");
		const { app, entry } = windowFor(TWO_PEOPLE);
		await app._dropImported();
		expect(entry.updates).toEqual([]);
		expect(ui.notifications.info).toHaveBeenCalled();
	});

	// It writes, so it is behind the same gate every other board tool is -- gated in the TOOLS
	// table rather than by where it happens to be written, which is what that table is for.
	it("does nothing at all for a reader who may only look", async () => {
		const calls = asked("drop");
		const { app, entry } = windowFor(BOTH_KINDS, { isOwner: false });
		await app._onToolClick({ currentTarget: { dataset: { relmapAction: "droppulled" } } });
		expect(calls).toEqual([]);
		expect(entry.updates).toEqual([]);
	});

	// ⚠ AND IT MUST GO AWAY UNDER AN OPEN WINDOW. Whether this board still has any of these lines
	// changes the moment somebody at the far end of the table presses it; `_paintChrome` is all
	// that runs on a repaint, so the tool is rendered always and hidden, and repainted here.
	it("takes the tool off the bar once the last of them has gone", async () => {
		const { app, root } = windowFor(BOTH_KINDS);
		const tool = el();
		root.children["[data-relmap-action='droppulled']"] = tool;
		await app.sync();
		expect(tool.hidden).toBe(false);

		const plain = windowFor(TWO_PEOPLE);
		const gone = el();
		plain.root.children["[data-relmap-action='droppulled']"] = gone;
		await plain.app.sync();
		expect(gone.hidden).toBe(true);
	});
});

// ── The lit person's captions ───────────────────────────────────────────────
//
// ⚠ THE RULE THIS SUITE EXISTS TO HOLD. Dimming the quiet captions used to be an `opacity` on
// each of a hundred `<g>` elements, and opacity on a group costs the browser an offscreen buffer
// apiece -- a hundred of them, thrown away and rebuilt every time the pointer crossed onto or off
// a portrait. One opacity on the layer as a whole costs one.
//
// So the layer is dimmed entire, and the captions that should stay bright are drawn AGAIN in a
// second layer over the top. (What makes the captions affordable in the first place is a different
// rule and a bigger one: the board paints none of them while they would be too small to read. See
// `_paintCaptionZoom` and tests/styles/relationship-map-inks.test.js.)
describe("lighting one person's web", () => {
	/** An element with just enough of the DOM for the copy to be made and stripped. */
	function node(tag, { classes = [], attrs = {}, kids = [] } = {}) {
		const self = {
			tagName: tag,
			attrs: { ...attrs },
			kids: [...kids],
			classList: {
				_set: new Set(classes),
				add(c) { this._set.add(c); },
				remove(c) { this._set.delete(c); },
				contains(c) { return this._set.has(c); },
			},
			removeAttribute(name) { delete self.attrs[name]; },
			appendChild(child) { self.kids.push(child); child.parent = self; return child; },
			replaceChildren(...next) { self.kids = next; },
			remove() { self.parent?.replaceChildren(...self.parent.kids.filter(k => k !== self)); },
			// Deep enough for the copy: every descendant, or the ones wearing one class.
			querySelectorAll(sel) {
				const walk = el => el.kids.flatMap(k => [k, ...walk(k)]);
				const every = walk(self);
				return sel === "*" ? every : every.filter(k => k.classList.contains(sel.slice(1)));
			},
			cloneNode() {
				const copy = node(tag, {
					classes: [...self.classList._set],
					attrs: { ...self.attrs },
				});
				for (const kid of self.kids) copy.appendChild(kid.cloneNode(true));
				return copy;
			},
		};
		for (const kid of self.kids) kid.parent = self;
		return self;
	}

	/** One caption as the board really carries it: a group and the words in it, placed and turned
	 * about a point. There is no rail: warped text that is also stroked costs a repaint per raster
	 * tile, so the captions are straight `<text>` and the `<path>` they used to run along is gone. */
	function caption(id, { lit = false } = {}) {
		const words = node("text", {
			classes: ["stonetop-relmap-label-text"],
			attrs: {
				role: "button", tabindex: "0", "data-relmap-words": id,
				"aria-label": id + ". Click to change or rub out this line.", "data-tooltip": id,
				x: "10", y: "20", transform: "rotate(15 10 20)",
			},
		});
		return node("g", {
			classes: lit ? ["stonetop-relmap-label", "is-lit"] : ["stonetop-relmap-label"],
			attrs: { "data-relmap-edge": id, "data-relmap-who": "elena stefan" },
			kids: [words],
		});
	}

	/** A window whose board carries three captions, two of them on the lit person's web. */
	function boardWithCaptions() {
		const { app, root } = windowFor();
		const captions = [caption("e1", { lit: true }), caption("e2", { lit: true }), caption("e3")];
		const lift = node("svg", { classes: ["stonetop-relmap-labels-lit"] });
		root.children[".stonetop-relmap-labels-lit"] = lift;
		root.all[".stonetop-relmap-labels .stonetop-relmap-label"] = captions;
		root.ownerDocument = { activeElement: null, createElement: () => node("div") };
		return { app, root, lift, captions };
	}

	it("draws a COPY of each lit caption into the layer over the top", () => {
		const { app, root, lift } = boardWithCaptions();
		app._lit = "elena";
		app._paintLitCaptions(root);
		expect(lift.kids).toHaveLength(2);
		expect(lift.kids.every(g => g.classList.contains("stonetop-relmap-label"))).toBe(true);
	});

	// ⚠ AND LEAVES THE ORIGINALS ALONE, which is the whole point: a caption that changed inside the
	// textured layer would re-warp every glyph on the board.
	it("never moves a caption out of the layer it was painted in", () => {
		const { app, root, captions } = boardWithCaptions();
		app._lit = "elena";
		app._paintLitCaptions(root);
		expect(captions).toHaveLength(3);
		expect(captions[0].attrs["data-relmap-edge"]).toBe("e1");
		expect(captions[0].querySelectorAll(".stonetop-relmap-label-text")).toHaveLength(1);
	});

	// A COPY IS NOT A TARGET. The caption it copies is still in the layer above, still focusable and
	// still what a click means; a second one would be announced twice and aimable twice.
	it("strips everything that would make the copy a second button", () => {
		const { app, root, lift } = boardWithCaptions();
		app._lit = "elena";
		app._paintLitCaptions(root);
		const [copy] = lift.kids;
		const [words] = copy.querySelectorAll(".stonetop-relmap-label-text");
		expect(copy.attrs["data-relmap-edge"]).toBeUndefined();
		expect(copy.attrs["data-relmap-who"]).toBeUndefined();
		expect(words.attrs.role).toBeUndefined();
		expect(words.attrs.tabindex).toBeUndefined();
		expect(words.attrs["aria-label"]).toBeUndefined();
		expect(words.attrs["data-tooltip"]).toBeUndefined();
	});

	// THE COPY IS DRAWN WHERE THE ORIGINAL IS. A caption is placed and turned by attributes on its
	// own `<text>`, so the clone lands over the caption it copies with nothing here to keep in step
	// -- which is the whole reason the highlight can be a copy at all.
	it("keeps the copy over the caption it was made from", () => {
		const { app, root, lift } = boardWithCaptions();
		app._lit = "elena";
		app._paintLitCaptions(root);
		const [copy] = lift.kids;
		const [words] = copy.querySelectorAll(".stonetop-relmap-label-text");
		expect(words.attrs.x).toBe("10");
		expect(words.attrs.y).toBe("20");
		expect(words.attrs.transform).toBe("rotate(15 10 20)");
	});

	it("empties the layer the moment nobody is being rested on", () => {
		const { app, root, lift } = boardWithCaptions();
		app._lit = "elena";
		app._paintLitCaptions(root);
		expect(lift.kids).toHaveLength(2);
		app._lit = null;
		app._paintLitCaptions(root);
		expect(lift.kids).toHaveLength(0);
	});
});

// ── Type too small to be type ───────────────────────────────────────────────
//
// ⚠ THE MAP'S PERFORMANCE FIX, and it is a legibility rule that happens to be one. Text on a path
// is expensive to RASTER -- the browser warps every glyph onto its curve and, with the halo,
// strokes each warped outline as well -- and the cost is per glyph ON SCREEN. So it is worst at the
// scale the window OPENS at: the whole board fitted into the viewport, every one of a hundred
// captions drawn at once. Measured on this table's own map (36 people, 102 captions of ~85
// characters): 5.3 SECONDS of raster at a third size, 2.6s at 0.4, 76ms at 0.7, 3ms at 1. A trace of
// the real window showed the main thread blocked in Commit for a second and a half at a time and
// ~100 frames dropped a second, for as long as the map was open.
//
// And at those scales the writing is three pixels tall. It was never readable.
describe("putting the captions away while they would be too small to read", () => {
	/** A window whose root remembers the classes written on it. */
	function windowWithRoot() {
		const { app, root, board } = windowFor();
		return { app, root, board, on: () => [...root.classList._set] };
	}

	it("hides them once the board is scaled below the legibility floor", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.3 });
		expect(root.classList.contains("captions-too-small")).toBe(true);
	});

	it("brings them back the moment the reader zooms far enough in", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.3 });
		app._paintCaptionZoom({ scale: 1 });
		expect(root.classList.contains("captions-too-small")).toBe(false);
	});

	// THE RULE IS THE PAINTED SIZE OF THE TYPE and not a zoom number, so that it moves with whatever
	// the stylesheet sets the captions in -- which `_fitGapsToPaint` has already read off a real
	// caption. Bigger type survives a smaller board.
	it("measures the type rather than the zoom", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 32 };
		app._paintCaptionZoom({ scale: 0.3 });
		expect(root.classList.contains("captions-too-small")).toBe(false);
	});

	// A board that has not been sized yet must not open blank.
	it("shows them when it does not know the scale", () => {
		const { app, root } = windowWithRoot();
		app._paintCaptionZoom(null);
		expect(root.classList.contains("captions-too-small")).toBe(false);
		app._paintCaptionZoom({ scale: 0 });
		expect(root.classList.contains("captions-too-small")).toBe(false);
	});
});

// ── The holes cut for words that are not there ──────────────────────────────
//
// Every line is drawn BROKEN, with a length cut out exactly where its caption goes, because the
// words sit IN the line rather than over it. Take the words away -- captions turned off, or the
// board zoomed out past the size at which they are drawn at all -- and what is left is a web of
// lines with conspicuous breaks in them for nothing, which reads as a broken diagram.
describe("healing a stroke that has no caption to carry", () => {
	function boardWithLines() {
		const { app, root, board } = windowFor();
		const line = { dataset: { relmapLine: "link1" }, attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
		board.all["[data-relmap-line]"] = [line];
		app._drawn = {
			shapes: new Map([["link1", { curve: { d: "WHOLE" }, d: "BROKEN" } ]]),
			captionPx: 12,
		};
		app._labels = "all";
		return { app, root, board, line };
	}

	it("closes the gaps when the type is too small to be drawn", () => {
		const { app, line } = boardWithLines();
		app._paintCaptionZoom({ scale: 0.3 });
		expect(line.attrs.d).toBe("WHOLE");
	});

	it("cuts them again when the captions come back", () => {
		const { app, line } = boardWithLines();
		app._paintCaptionZoom({ scale: 0.3 });
		app._paintCaptionZoom({ scale: 1 });
		expect(line.attrs.d).toBe("BROKEN");
	});

	it("closes them when the reader turns the captions off", () => {
		const { app, line } = boardWithLines();
		app._labels = "off";
		app._paintLineGaps();
		expect(line.attrs.d).toBe("WHOLE");
	});

	// NOT IN `hover` MODE: the captions are still being painted there, one person's at a time, and a
	// line healed until the pointer arrives would have to break again underneath the caption.
	it("leaves them cut on a board whose captions appear on hover", () => {
		const { app, root, line } = boardWithLines();
		app._labels = "hover";
		root.classList.add("captions-too-small");
		app._paintLineGaps();
		expect(line.attrs.d).toBe("BROKEN");
	});

	// Only when the answer CHANGES: on a zoom that is once, at the threshold, rather than a hundred
	// attribute writes on every step of the wheel.
	it("writes nothing when the answer has not changed", () => {
		const { app, line } = boardWithLines();
		app._paintCaptionZoom({ scale: 0.3 });
		line.attrs.d = "UNTOUCHED";
		app._paintCaptionZoom({ scale: 0.31 });
		expect(line.attrs.d).toBe("UNTOUCHED");
	});
});

// ⚠ WHAT A REPAINT CAN AND CANNOT PUT RIGHT. A live update replaces the BOARD's markup and
// nothing else, so every panel over it can only be shown, hidden and written into -- never
// re-rendered. The panel that explains why a view is showing nobody names a person and carries the
// one button that gets the reader out, and both can change without a render: ticking the box that
// puts the pulled-in lines away empties a focus ring, and somebody at the far end of the table can
// remove the last player character.
describe("the panel a repaint puts up", () => {
	const LONELY = {
		version: 1,
		nodes: {
			pim: { uuid: null, name: "Pim", img: "", x: 10, y: 10, note: "" },
			sela: { uuid: null, name: "Sela", img: "", x: 80, y: 20, note: "" },
		},
		edges: {
			e1: { a: "pim", b: "sela", label: "trusts", ink: "sage", dir: "none", src: "hearts", note: "" },
		},
	};

	beforeEach(() => {
		globalThis.game.i18n = TABLE;
	});

	it("writes the panel's words AND its button, so the way out is never missing", () => {
		const made = windowFor(LONELY);
		made.app._view = "focus";
		made.app._focus = "pim";

		// The reader's first sight of it: a ring with Sela on it, so no panel and no button needed.
		made.app._paintChrome(made.app._plan());
		expect(made.bare.hidden).toBe(true);

		// They tick "hide the lines the sheets drew". The one line to Sela was an imported one, so
		// the ring empties -- through a REPAINT, which never re-renders the panel.
		made.app._hidePulled = true;
		made.app._paintChrome(made.app._plan());
		expect(made.bare.hidden).toBe(false);
		expect(made.bareLead.textContent).toContain("Pim");
		// The button is the only thing in the viewport they can reach while this is up.
		expect(made.bareCta.hidden).toBe(false);
		expect(made.bareCta.dataset.relmapAction).toBe("showall");
		expect(made.bareWords.textContent).toBeTruthy();
	});

	// \u26a0 AND IT IS SAID OUT LOUD, ONCE. Switching view announces itself because the reader asked
	// for it; this is the other way round -- the board they were reading emptied under them, because
	// somebody at the far end of the table took the last person off it. A reader who cannot see the
	// panel gets no other sign that anything happened.
	it("announces a panel that appears under the reader, and does not repeat it", () => {
		const made = windowFor(LONELY);
		made.app._view = "focus";
		made.app._focus = "pim";
		made.app._paintChrome(made.app._plan());
		made.live.textContent = "";

		made.app._hidePulled = true;
		made.app._paintChrome(made.app._plan());
		expect(made.live.textContent).toContain("Pim");

		// A repaint arrives every time anybody touches this map. A live region that repeats itself
		// is one people learn to ignore.
		made.live.textContent = "";
		made.app._paintChrome(made.app._plan());
		expect(made.live.textContent).toBe("");
	});

	// ⚠ AND THE EMPTY BOARD'S HEADLINE SURVIVES A REPAINT, which is the failure this catches:
	// `_paintPanel` WRITES every part of the panel it is given, so a sentence settled in `getData`
	// alone came back undefined here and was blanked outright. The reader was left with a board that
	// had emptied under them and a panel with no first line -- until the window was fully rendered
	// again, which a repaint deliberately never does.
	it("keeps the empty board's headline through a repaint", () => {
		const made = windowFor({ nodes: {}, edges: {} });
		made.app._paintChrome(made.app._plan());
		expect(made.empty.hidden).toBe(false);
		expect(made.emptyLead.textContent).toBe(TABLE.localize("stonetop.relmap.emptyLead"));
		expect(made.emptyLead.textContent).toBeTruthy();
		// The rest of the panel is written in the same pass, as it always was.
		expect(made.emptyHint.textContent).toBeTruthy();
		expect(made.emptyCta.hidden).toBe(false);
	});

	// The same panel serves every view that can come out empty, and the way out is not the same one
	// each time -- the tree offers "Find family ties", which WRITES and so is offered to editors
	// only -- so the action is written onto the button rather than assumed.
	it("gives the party view its own way back to the whole board", () => {
		const made = windowFor(LONELY);
		made.app._view = "party";
		globalThis.game.actors = { contents: [] };
		made.app._paintChrome(made.app._plan());
		expect(made.bare.hidden).toBe(false);
		expect(made.bareCta.dataset.relmapAction).toBe("showall");
	});

	/** A window in the focus view whose chooser holds the rows the last render put in it. */
	const painted = (graph = LONELY, on = "pim") => {
		const made = windowFor(graph);
		made.app._view = "focus";
		made.app._focus = on;
		made.app._pickSaid = made.app._chrome(made.app._plan()).focusPick;
		made.pick.innerHTML = made.app._pickSaid;
		return made;
	};

	// THE ONE CONTROL ON THE BAR WHOSE CONTENTS COME OFF THE SHARED DOCUMENT. Until this runs, the
	// chooser cannot be pointed at somebody who has just been put on the map -- and, worse, still
	// offers a row for anybody taken off it, which picked warns and does nothing.
	it("writes the chooser's rows again when the cast has changed under the reader", () => {
		const made = painted();
		made.app._entry = entryFor({
			...LONELY,
			nodes: { ...LONELY.nodes, jen: { uuid: null, name: "Jen", img: "", x: 50, y: 50, note: "" } },
		});
		made.app._paintChrome(made.app._plan());
		expect(made.pick.innerHTML).toContain("Jen");
	});

	// ⚠ AND ONLY THEN. A repaint arrives every time anybody at the table touches this map, and
	// `innerHTML` on a `<select>` throws away its option elements: an open dropdown shuts, and a
	// reader who has tabbed to the control loses it, because somebody else dragged a portrait.
	it("leaves the control alone on a repaint that did not change the cast", () => {
		const made = painted();
		made.pick.innerHTML = "UNTOUCHED";
		made.app._paintChrome(made.app._plan());
		expect(made.pick.innerHTML).toBe("UNTOUCHED");
	});

	// A board somebody else has rearranged is not a changed cast either -- but the person in the
	// MIDDLE is part of the answer, because the picked row is in the same string.
	it("writes them again when the person in the middle has changed", () => {
		const made = painted();
		made.app._focus = "sela";
		made.app._paintChrome(made.app._plan());
		expect(made.pick.innerHTML).toContain('value="sela" selected');
	});
});

// ⚠ `_plan` IS NOT FREE, and its own doc-block records that building one four times per render
// was a cost that had to be paid down once: the family view relaxes a column per generation and
// settles every row, on a pass that runs every time anybody at the table touches the map. So the
// plan a render was drawn from is handed forward to the listeners wired onto it rather than rebuilt
// for the two numbers they want out of the sheet.
describe("the plan a render is drawn from", () => {
	const MAP = {
		version: 1,
		nodes: { a: { uuid: null, name: "A", img: "", x: 10, y: 10, note: "" } },
		edges: {},
	};

	it("is handed forward from getData, and taken exactly once", async () => {
		const { app } = windowFor(MAP);
		expect(app._takePlan()).toBeNull();

		await app.getData();
		const handed = app._takePlan();
		expect(handed).toBeTruthy();
		expect(handed.board).toBeTruthy();

		// TAKEN, not cached. A plan held past its own render is a board drawn from a map that has
		// moved on, which is the one thing `_plan` refuses to do.
		expect(app._takePlan()).toBeNull();
	});

	it("still answers with a fresh sheet for a caller that never went through getData", () => {
		const { app } = windowFor(MAP);
		expect(app._boardSize().width).toBeGreaterThan(0);
	});
});

// The things a window over a shared document has to notice about that document, as opposed to about
// the map inside it.
describe("what happens to the document under the window", () => {
	const MAP = {
		version: 1,
		nodes: { a: { uuid: null, name: "A", img: "", x: 10, y: 10, note: "" } },
		edges: {},
	};

	/** The hooks this window registered, by name. */
	function hooksOf() {
		const on = new Map();
		globalThis.Hooks = { on: (name, fn) => on.set(name, fn), off: vi.fn() };
		return on;
	}

	// \u26a0 NOTHING ELSE WOULD NOTICE. This is a StonetopDialog rather than a DocumentSheet, so it
	// is not in `entry.apps` and core's own sweep on delete never reaches it -- and the `entry` getter
	// deliberately falls back to the document it was handed, which after a delete is a stale copy
	// still carrying its last flags and still answering `isOwner`. The board would go on looking live,
	// with every tool enabled, writing into a document that is not there.
	it("closes when its own map is deleted", () => {
		const on = hooksOf();
		const { app, entry } = windowFor(MAP);
		app.close = vi.fn();
		app._wireSync();

		on.get("deleteJournalEntry")({ id: "somebody-else" });
		expect(app.close).not.toHaveBeenCalled();

		on.get("deleteJournalEntry")(entry);
		expect(app.close).toHaveBeenCalled();
	});

	// Ownership decides the bar's tools, the link handles, the drag, the drop and the readonly class
	// on the root -- none of which a repaint can change, because a repaint replaces the board's markup
	// and nothing else. So this is the one update that takes the render the rest of the handler goes
	// out of its way to avoid.
	it("re-renders when who may edit it changes, rather than filtering it out with the rest", () => {
		const on = hooksOf();
		const { app, entry } = windowFor(MAP);
		app._wireSync();
		const update = on.get("updateJournalEntry");

		update(entry, { name: "Renamed" });
		expect(app.render).not.toHaveBeenCalled();

		update(entry, { ownership: { default: 3 } });
		expect(app.render).toHaveBeenCalled();
	});
});

// ── The pages of one map ────────────────────────────────────────────────────────────────────────
//
// One map is several NAMED BOARDS, each a JournalEntryPage carrying its own graph. What matters
// here is that the window reads and writes the board the reader is actually LOOKING at, that the
// strip keeps up with boards being added and renamed at the far end of the table, and that two
// people on two pages of one map do not repaint each other.

/** One board of a map: a JournalEntryPage stand-in. */
function pageFor(name, graph, { id, sort, parent }) {
	const doc = {
		id, name, sort, parent,
		updates: [],
		getFlag: (scope, key) =>
			(scope === "stonetop-pwd" && key === "relationshipMap" ? graph : null),
		update(patch) { doc.updates.push(patch); return Promise.resolve(doc); },
	};
	return doc;
}

const EMPTY_BOARD = { version: 2, nodes: {}, edges: {} };

/** A map with named boards on it. The entry's own flag is the MARK, never a graph. */
function pagedEntry(boards, { isOwner = true } = {}) {
	const pages = [];
	const entry = {
		id: "map1",
		name: "The people of Stonetop",
		isOwner,
		updates: [],
		pages: { get contents() { return pages; } },
		getFlag: (scope, key) =>
			(scope === "stonetop-pwd" && key === "relationshipMap" ? { version: 2 } : null),
		update(patch) { entry.updates.push(patch); return Promise.resolve(entry); },
		createEmbeddedDocuments(type, rows) {
			const made = rows.map((row, i) => pageFor(
				row.name, row.flags?.["stonetop-pwd"]?.relationshipMap ?? null,
				{ id: `made${pages.length + i + 1}`, sort: row.sort, parent: entry },
			));
			pages.push(...made);
			return Promise.resolve(made);
		},
	};
	boards.forEach((board, i) => pages.push(pageFor(
		board.name, board.graph ?? EMPTY_BOARD,
		{ id: board.id, sort: i * 100000, parent: entry },
	)));
	return entry;
}

const TWO_BOARDS = () => pagedEntry([
	{ id: "p1", name: "Stonetop", graph: TWO_PEOPLE },
	{ id: "p2", name: "Marshedge", graph: EMPTY_BOARD },
]);

describe("the pages of one map", () => {
	it("names every board in the strip, and marks the one that is up", () => {
		const { app } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p2" });
		const tabs = app._pageTabs();
		expect(tabs).toContain(">Stonetop<");
		expect(tabs).toContain(">Marshedge<");
		// The one that is up carries all three marks, because each does a different job: the class
		// paints it, aria-selected says so out loud, and the tabindex is what makes the strip one
		// tab stop with the arrow keys inside it rather than one stop per board.
		expect(tabs).toMatch(/aria-selected="true" tabindex="0" data-relmap-page="p2"/);
		expect(tabs).toMatch(/aria-selected="false" tabindex="-1" data-relmap-page="p1"/);
		expect(tabs).toContain("is-current");
	});

	// A page name is text somebody at this table typed, and it is going into markup rather than
	// through Handlebars.
	it("escapes a board name somebody has typed", () => {
		const entry = pagedEntry([{ id: "p1", name: "<img src=x onerror=alert(1)>" }]);
		const { app } = windowFor(null, { entry, pageId: "p1" });
		expect(app._pageTabs()).not.toContain("<img");
		expect(app._pageTabs()).toContain("&lt;img");
	});

	// ⚠ THE POINT OF THE WHOLE CHANGE. Everything the board reads and writes has to be the page in
	// front of the reader: not the map, and not another page.
	it("reads the board the reader is looking at, and not another one", () => {
		const entry = TWO_BOARDS();
		const onStonetop = windowFor(null, { entry, pageId: "p1" });
		expect(Object.keys(readGraph(onStonetop.app.boardDoc).nodes)).toEqual(["elena", "stefan"]);
		const onMarshedge = windowFor(null, { entry, pageId: "p2" });
		expect(Object.keys(readGraph(onMarshedge.app.boardDoc).nodes)).toEqual([]);
	});

	it("writes to that board's own document and to nothing else", async () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 40, y: 60 });
		const [stonetop, marshedge] = entry.pages.contents;
		expect(stonetop.updates).toHaveLength(1);
		// Still LEAF PATHS, which is the concurrency story the whole feature is built on: two
		// people dragging two portraits on one page both survive the merge.
		expect(Object.keys(stonetop.updates[0])).toEqual([
			"flags.stonetop-pwd.relationshipMap.nodes.elena.x",
			"flags.stonetop-pwd.relationshipMap.nodes.elena.y",
		]);
		expect(marshedge.updates).toEqual([]);
		expect(entry.updates).toEqual([]);
	});

	// Switching board writes NOTHING. Which page somebody is on is theirs, exactly like the view
	// and the captions: two people at one table reading two pages of one map is the ordinary case.
	it("switches board without writing anything to the map", () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app.showPage("p2");
		expect(app._pageId).toBe("p2");
		expect(app.render).toHaveBeenCalled();
		expect(entry.updates).toEqual([]);
		expect(entry.pages.contents.flatMap(p => p.updates)).toEqual([]);
	});

	it("drops the focus and the highlight, which belonged to the board being left", () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._focus = "elena";
		app._lit = "elena";
		app.showPage("p2");
		expect(app._focus).toBeNull();
		expect(app._lit).toBeNull();
	});

	it("refuses a page that is not one of this map's boards", () => {
		const { app } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p1" });
		app.showPage("nonsense");
		expect(app._pageId).toBe("p1");
		expect(app.render).not.toHaveBeenCalled();
	});

	// ⚠ A nudge still waiting on its debounce belongs to the board being LEFT. Written a line later
	// it would land on the one being arrived at, moving a portrait on a page the reader never
	// touched, by an id that very likely names nobody there.
	it("lands an unwritten nudge on the board being left, not the one arrived at", () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._pendingNudge = { id: "elena", at: { x: 55, y: 55 } };
		app.showPage("p2");
		const [stonetop, marshedge] = entry.pages.contents;
		expect(stonetop.updates).toHaveLength(1);
		expect(marshedge.updates).toEqual([]);
	});

	// A repaint runs every time anybody at the table moves a portrait, and rewriting the strip
	// destroys the element the reader may have their keyboard focus on mid arrow-key walk.
	it("leaves the strip alone on a repaint that did not change it", () => {
		const { app, strip } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p1" });
		app._paintPages();
		expect(strip.innerHTML).toContain("Stonetop");
		strip.innerHTML = "TOUCHED";
		app._paintPages();
		expect(strip.innerHTML).toBe("TOUCHED");
	});

	it("writes the strip again when a board is renamed at the far end of the table", () => {
		const entry = TWO_BOARDS();
		const { app, strip } = windowFor(null, { entry, pageId: "p1" });
		app._paintPages();
		entry.pages.contents[1].name = "The Marshes";
		app._paintPages();
		expect(strip.innerHTML).toContain("The Marshes");
		expect(strip.innerHTML).not.toContain("Marshedge");
	});

	// The board is the tab panel, and which tab it is the panel FOR can change with no render at
	// all: somebody else deleting the page this reader was on moves them to another.
	it("keeps the board labelled by whichever tab is up", () => {
		const entry = TWO_BOARDS();
		const { app, view } = windowFor(null, { entry, pageId: "p2" });
		app._paintPages();
		expect(view.attrs["aria-labelledby"]).toBe("stonetop-relmap-map1-page-p2");
	});

	// ⚠ ALWAYS RENDERED AND HIDDEN, never behind a condition: whether the last board may be rubbed
	// out changes whenever anybody at the table adds or removes one, and `_paintPages` can only
	// write onto markup a repaint left standing.
	it("offers the delete only while there is more than one board", () => {
		const entry = pagedEntry([{ id: "p1", name: "Stonetop" }]);
		const { app, dropTool } = windowFor(null, { entry, pageId: "p1" });
		app._paintPages();
		expect(dropTool.hidden).toBe(true);
		entry.pages.contents.push(pageFor("Marshedge", EMPTY_BOARD, { id: "p2", sort: 1, parent: entry }));
		app._paintPages();
		expect(dropTool.hidden).toBe(false);
	});

	// A map written before pages existed keeps its whole board on the entry. It gets one tab named
	// after itself rather than an empty strip over a board full of people.
	it("gives a map that still has no pages one tab named after the map", () => {
		const { app } = windowFor(TWO_PEOPLE);
		expect(app._pageTabs()).toContain(">The people of Stonetop<");
		expect(app._pageTabs()).toContain("data-relmap-page=\"\"");
		expect(app.boardDoc).toBe(app.entry);
	});

	// Which page a board was on is as much a part of "where this window was" as its corner of the
	// screen. utils/window-restore.js asks for it by name, because the board is not a DocumentSheet.
	it("tells window-restore which board to come back to", () => {
		const { app } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p2" });
		expect(app.restorePageId).toBe("p2");
	});
});

describe("keeping up with pages being changed elsewhere", () => {
	function hooksOf() {
		const on = new Map();
		globalThis.Hooks = { on: (name, fn) => on.set(name, fn), off: vi.fn() };
		return on;
	}

	const GRAPH_WRITE = { flags: { "stonetop-pwd": { relationshipMap: { nodes: {} } } } };

	it("ignores a page write to a different journal entirely", () => {
		const on = hooksOf();
		const { app } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p1" });
		app.sync = vi.fn();
		app._wireSync();
		on.get("updateJournalEntryPage")({ id: "p1", parent: { id: "elsewhere" } }, GRAPH_WRITE);
		expect(app.sync).not.toHaveBeenCalled();
	});

	// ⚠ THE OTHER HALF OF WHY A BOARD IS ITS OWN DOCUMENT. Two people at one table working on two
	// pages of the same map must not repaint each other.
	it("does not repaint when a board this reader is not on changes", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app.sync = vi.fn();
		app._wireSync();
		on.get("updateJournalEntryPage")(entry.pages.contents[1], GRAPH_WRITE);
		expect(app.sync).not.toHaveBeenCalled();
	});

	it("repaints when the board it is showing changes", async () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app.sync = vi.fn();
		app._wireSync();
		on.get("updateJournalEntryPage")(entry.pages.contents[0], GRAPH_WRITE);
		await new Promise(r => setTimeout(r, 90));
		expect(app.sync).toHaveBeenCalled();
	});

	// A rename is the STRIP's business whichever board it happened to: renaming a page this reader
	// is not on still changes what the strip says.
	it("rewrites the strip when any board is renamed, without repainting the board", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app, strip } = windowFor(null, { entry, pageId: "p1" });
		app.sync = vi.fn();
		app._wireSync();
		app._paintPages();
		entry.pages.contents[1].name = "The Marshes";
		on.get("updateJournalEntryPage")(entry.pages.contents[1], { name: "The Marshes" });
		expect(strip.innerHTML).toContain("The Marshes");
		expect(app.sync).not.toHaveBeenCalled();
	});

	it("puts a board added elsewhere into the strip without re-rendering", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app, strip } = windowFor(null, { entry, pageId: "p1" });
		app._wireSync();
		app._paintPages();
		const made = pageFor("The Millers", EMPTY_BOARD, { id: "p3", sort: 300000, parent: entry });
		entry.pages.contents.push(made);
		on.get("createJournalEntryPage")(made);
		expect(strip.innerHTML).toContain("The Millers");
		expect(app.render).not.toHaveBeenCalled();
	});

	// ⚠ A window left pointing at a deleted document goes on looking live while every write it
	// makes vanishes. The board, its shape and the whole bar belong to another page now, so this is
	// the one page change that takes a full render.
	it("moves this reader off a board somebody else has rubbed out, and re-renders", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._focus = "elena";
		app._wireSync();
		const [gone] = entry.pages.contents.splice(0, 1);
		on.get("deleteJournalEntryPage")(gone);
		expect(app._pageId).toBeNull();
		expect(app._focus).toBeNull();
		expect(app.mapPage.name).toBe("Marshedge");
		expect(app.render).toHaveBeenCalled();
	});

	it("only rewrites the strip when the board rubbed out was not the one being read", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app, strip } = windowFor(null, { entry, pageId: "p1" });
		app._wireSync();
		app._paintPages();
		const [gone] = entry.pages.contents.splice(1, 1);
		on.get("deleteJournalEntryPage")(gone);
		expect(app._pageId).toBe("p1");
		expect(app.render).not.toHaveBeenCalled();
		expect(strip.innerHTML).not.toContain("Marshedge");
	});

	// `rendered` is false for a CLOSED window as well as a mid-render one, and a render from here
	// would reopen a board the reader had shut a moment before somebody else touched the map.
	it("drives nothing at all from a window that is not on screen", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app.rendered = false;
		app._wireSync();
		const [gone] = entry.pages.contents.splice(0, 1);
		on.get("deleteJournalEntryPage")(gone);
		expect(app.render).not.toHaveBeenCalled();
	});

	it("lets go of all three page hooks when it closes", async () => {
		const off = vi.fn();
		globalThis.Hooks = { on: vi.fn(), off };
		const { app } = windowFor(null, { entry: TWO_BOARDS(), pageId: "p1" });
		app._wireSync();
		app._surface = null;
		app._teardownDrag = null;
		Object.getPrototypeOf(Object.getPrototypeOf(app)).close = async () => {};
		await app.close();
		for (const hook of ["updateJournalEntryPage", "createJournalEntryPage", "deleteJournalEntryPage"]) {
			expect(off).toHaveBeenCalledWith(hook, expect.any(Function));
		}
	});
});

describe("which board this window is standing on", () => {
	function hooksOf() {
		const on = new Map();
		globalThis.Hooks = { on: (name, fn) => on.set(name, fn), off: vi.fn() };
		return on;
	}

	// ⚠ WHAT THE DELETE HOOK LEANS ON. Null means "whichever board comes first", and left null the
	// hook cannot tell "the board this reader was standing on has just gone" from "some other board
	// has" — by the time it is asked the page is gone and `mapPage` has already fallen through to
	// another one, leaving the reader looking at a board that no longer exists.
	it("is pinned to a concrete page by every render", async () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry });
		expect(app._pageId).toBeNull();
		await app.getData();
		expect(app._pageId).toBe("p1");
	});

	it("heals an id that has gone stale rather than showing nothing", async () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "rubbed-out-elsewhere" });
		await app.getData();
		expect(app._pageId).toBe("p1");
	});

	// The rail under the pinning: a window that has not rendered yet is one where any deletion may
	// have changed what it would show.
	it("moves a reader who never picked a page off a board that has been rubbed out", () => {
		const on = hooksOf();
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry });
		app._wireSync();
		const [gone] = entry.pages.contents.splice(0, 1);
		on.get("deleteJournalEntryPage")(gone);
		expect(app.render).toHaveBeenCalled();
	});
});

describe("adding a board from the strip", () => {
	// OPENED ON, not merely created. A page made at the end of a strip the reader may not even be
	// looking at the end of, and not shown, is a button whose only visible effect is a tab lighting
	// up somewhere off-screen.
	it("makes the board and takes the reader straight to it", async () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._askPageName = vi.fn().mockResolvedValue("The Millers");
		await app._addPage();
		const made = entry.pages.contents.at(-1);
		expect(made.name).toBe("The Millers");
		expect(app._pageId).toBe(made.id);
		expect(app.render).toHaveBeenCalled();
	});

	// It says so out loud, and says the right thing: arriving at a board you have just made is news,
	// where arriving at one you picked off the strip is only navigation. ⚠ The real language table,
	// because the suite's own `beforeEach` replaces `globalThis.game` and the two sentences are only
	// tellable apart once they are actually sentences.
	it("says the board has been added rather than merely that it is showing", async () => {
		globalThis.game.i18n = TABLE;
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._askPageName = vi.fn().mockResolvedValue("The Millers");
		await app._addPage();
		expect(app._sayOnRender).toContain("The Millers");
		expect(app._sayOnRender).not.toBe(
			TABLE.format("stonetop.relmap.pages.now", { name: "The Millers" }));
	});

	it("makes nothing at all when the reader backs out of the name box", async () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._askPageName = vi.fn().mockResolvedValue(null);
		await app._addPage();
		expect(entry.pages.contents).toHaveLength(2);
		expect(app.render).not.toHaveBeenCalled();
	});
});

// ── Which shape Tidy up lays the board out in ───────────────────────────────────────────────────
//
// It asks every time, because the two shapes are not better and worse: a ring is the poster of who
// is at this table, clusters the diagram of who the factions are, and the same map wants each of
// them on different evenings. What it must not do is reorder the question to say which one the
// board is already in.

describe("asking which shape to lay the board out in", () => {
	beforeEach(() => {
		chooser.asked.length = 0;
		chooser.answer = null;
	});

	// ⚠ THE ROWS STAY PUT, and the default is SAID rather than sorted to the top. Reordering is how
	// a reader loses the order they had learned -- Ring above Clusters on one board and below it on
	// the next, so the row under the pointer depends on something nobody was thinking about -- and
	// it gives no hint why the second row is the pre-selected one.
	it("keeps the rows in one order and names the board's own shape as the default", async () => {
		const { app } = windowFor();
		await app._askShape("clusters");
		const [config] = chooser.asked;
		expect(config.options.map(row => row.id)).toEqual(["ring", "clusters"]);
		expect(config.selected).toBe("clusters");
	});

	it("opens on the ring for a board that has never been laid out", async () => {
		const { app } = windowFor();
		await app._askShape(undefined);
		expect(chooser.asked[0].options.map(row => row.id)).toEqual(["ring", "clusters"]);
		expect(chooser.asked[0].selected).toBe("ring");
	});

	// The answer still comes back through the same guard, so a row id this version has never heard
	// of cannot reach the layout or the flag it is written into.
	it("hands back a known shape, or nothing when the reader backs out", async () => {
		const { app } = windowFor();
		chooser.answer = "clusters";
		expect(await app._askShape("ring")).toBe("clusters");
		chooser.answer = null;
		expect(await app._askShape("ring")).toBe(null);
	});
});
