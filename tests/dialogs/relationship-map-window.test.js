import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

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
	// `sizes` is how big each caption is set in, which the board template turns into a custom
	// property on the words themselves. Carried out here because it is the one thing about a line
	// that reaches the paint through the LABEL rather than through the stroke, and a stand-in that
	// dropped it would pass a window that had stopped sending it at all.
	renderTemplate: (path, ctx) => Promise.resolve(
		`<board nodes="${ctx.nodes.length}" edges="${ctx.edges.length}"`
		+ ` sizes="${(ctx.labels ?? []).map(one => one.px).join(",")}">`,
	),
	getDragEventData: () => null,
	deletionEntry: keyPath => {
		const i = keyPath.lastIndexOf(".");
		return [`${keyPath.slice(0, i + 1)}-=${keyPath.slice(i + 1)}`, null];
	},
	// ⚠ THE OTHER HALF OF THE SAME DECISION, and it has to be here or the undo goes blind. The real
	// pair is in utils/foundry-compat.js: `deletionEntry` spells a deletion, `deletionTarget` reads
	// one back, and the two live together precisely so that a reader knowing only one spelling
	// cannot exist. Pinned to the v13 form above, so this reads that form.
	deletionTarget: (keyPath, value) => {
		const i = keyPath.lastIndexOf(".");
		const leaf = keyPath.slice(i + 1);
		if (value !== null || !leaf.startsWith("-=")) return null;
		return `${keyPath.slice(0, i + 1)}${leaf.slice(2)}`;
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
const { mapBoardRole, readGraph } = await import("../../module/relmap/relmap-doc.js");
const { forgetAllHistory } = await import("../../module/relmap/relmap-history.js");
const { dropNodePatch, edgePatch } = await import("../../module/relmap/relmap-store.js");

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
function entryFor(graph, { isOwner = true, id = "map1", pen = null } = {}) {
	// The two flags a map carries that this suite reads: its graph, and the PEN it is being drawn
	// with -- the colour, stroke and caption size the next line on it is born in, shared by
	// everybody editing the map. See module/relmap/relmap-pen.js.
	const flags = { relationshipMap: graph, relationshipMapPen: pen };
	return {
		id,
		name: "The people of Stonetop",
		isOwner,
		updates: [],
		getFlag: (scope, key) => (scope === "stonetop-pwd" ? flags[key] ?? null : null),
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
function windowFor(graph = TWO_PEOPLE, {
	isOwner = true, entry: given = null, pageId = null, pen = null,
} = {}) {
	const entry = given ?? entryFor(graph, { isOwner, pen });
	const app = Object.create(RelationshipMapWindow.prototype);
	const board = el();
	const live = el();
	const empty = el();
	const foot = el();
	const root = el();
	root.children[".stonetop-relmap-board"] = board;
	root.children[".stonetop-relmap-live"] = live;
	root.children[".stonetop-relmap-empty"] = empty;
	// The "nobody is on this map yet" panel's own three parts. Registered here rather than
	// per-test because `_paintPanel` returns without writing where they are missing, so an
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
	// The eye, and the glyph inside it that says where the board stands. Registered here for the
	// reason the panels are: `_paintSeen` returns without writing where the button is missing, so
	// an assertion about it would pass against a window that never touched it.
	const seenTool = el({ dataset: {}, attrs: {} });
	seenTool.setAttribute = (key, value) => { seenTool.attrs[key] = value; };
	seenTool.children["i"] = el();
	root.children["[data-relmap-action=\"pagehide\"]"] = seenTool;
	root.ownerDocument = { activeElement: null };
	app._entry = entry;
	app._entryId = entry.id;
	app._pendingSync = false;
	// The world hooks this window has registered, which the constructor would have stood up. See
	// `_hooks` on the class: `_wireSync` reads it as its already-wired guard and pushes onto it.
	app._hooks = [];
	app.id = "stonetop-relmap-map1";
	app._pageId = pageId;
	app._pagesSaid = null;
	app._root = root;
	app.rendered = true;
	app.render = vi.fn();
	app.reportWriteFailure = vi.fn();
	return {
		app, entry, root, board, live, empty, emptyLead, emptyHint, emptyCta, foot, strip,
		view, dropTool, seenTool,
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

	// HOW BIG EACH CAPTION IS SET, carried to the paint on the label rather than on the stroke.
	// Zero on a line nobody has sized, which is nearly all of them and every line drawn before a
	// reader could ask -- the template then prints no size markup at all and the sheet decides.
	it("sends each caption the size its own line was set in", async () => {
		const { app, board } = windowFor();
		await app.sync();
		expect(board.innerHTML).toContain("sizes=\"0\"");

		const big = structuredClone(TWO_PEOPLE);
		big.edges.link1.size = 18;
		const grown = windowFor(big);
		await grown.app.sync();
		expect(grown.board.innerHTML).toContain("sizes=\"18\"");
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
				link2: { a: "stefan", b: "marek", label: "", ink: "green", dir: "none", note: "" },
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
		// READ BACK AS WELL AS WRITTEN, because the window asks a caption whether the reader has
		// set a size on it -- and a stand-in that only remembered would answer no to every one of
		// them, which is the answer that hides the bug this pins.
		style.getPropertyValue = name => style.props[name] ?? "";
		return style;
	}

	/** One piece of a drawn link. */
	function part(dataset) {
		const node = { dataset, attrs: {}, style: styleOf() };
		node.setAttribute = (name, value) => { node.attrs[name] = value; };
		return node;
	}

	/** The size the stylesheet sets a caption in where the reader has not asked for another. */
	const BASE_PX = 12;

	/** The size out of a canvas font shorthand, which is the only part of it that measures. */
	function fontPx(font) {
		return Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1]) || BASE_PX;
	}

	/**
	 * A document that can measure a caption, which is what the window asks for before it cuts
	 * anything. The real one is a canvas 2D context set to the face the stylesheet ended up
	 * painting in; this one charges a flat `perChar` so a test can say what a caption measured.
	 *
	 * ⚠ AND IT CHARGES BY THE SIZE IT WAS SET TO. The window re-assigns `ctx.font` per caption
	 * size and leans on the answer changing with it; a stand-in on a flat rate would measure a
	 * board cut at the wrong size as though it had been cut at the right one.
	 */
	function measuringDoc(perChar) {
		return {
			activeElement: null,
			createElement: () => {
				const ctx = {
					font: "",
					measureText: text => ({ width: text.length * perChar * (fontPx(ctx.font) / BASE_PX) }),
				};
				return { getContext: () => ctx };
			},
			// SVG and so by namespace, which is how the window mints a caption for a line that has
			// never carried one. Only the surface `mintCaption` touches.
			createElementNS: (ns, tag) => {
				const node = part({});
				node.tagName = tag;
				node.childNodes = [];
				node.append = child => { node.childNodes.push(child); };
				return node;
			},
			defaultView: {
				// ⚠ ASKED OF THE ELEMENT, not answered flat. A caption the reader has sized carries
				// the size as a custom property and the sheet resolves it into the `font-size`; a
				// stand-in that gave every caption the same size could not tell the two apart.
				getComputedStyle: node => ({
					fontStyle: "normal",
					fontWeight: "400",
					fontSize: node?.style?.getPropertyValue?.("--relmap-caption-px") || `${BASE_PX}px`,
					fontFamily: "serif",
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

	// A caption is a straight run laid over a line that may be bowed, and which straight run
	// depends on how long the words are -- so cutting the sentence shorter re-seats it. On a line
	// with no bow in it at all, like this one, "re-seated" comes out as exactly where it already
	// was: what must never move is WHERE ALONG the line it sits, which the spreader settled.
	it("re-seats the caption on the words that painted, and never slides it along its line", () => {
		const { app, words, line } = drawn(5.2);
		const before = { ...app._drawn.shapes.get("link1").anchor };
		app._fitGapsToPaint();
		const after = app._drawn.shapes.get("link1").anchor;
		expect(after).toEqual(before);
		expect(words.attrs.x).toBe(Math.round((before.left * 1200) / 100));
		expect(words.attrs.transform).toBe(`rotate(${before.angle} ${words.attrs.x} ${words.attrs.y})`);
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

	// ⚠ AND THE CUT COMES WHEN THE ROOM RUNS OUT, NOT WHEN THE BOARD DOES. Two portraits close
	// enough together to leave no clear paper between them have a room of NOTHING (`captionRoomPx`),
	// and a room of nothing read as "nobody said" is how the whole sentence used to end up drawn
	// across both their faces. What is left is the ellipsis, which still says there is something
	// written here; the sentence itself is in the tooltip and in the tie bar.
	it("cuts a caption to its ellipsis where the two faces leave no room at all", () => {
		const tight = {
			...TALKERS,
			nodes: {
				elena: { ...TALKERS.nodes.elena, x: 46 },
				stefan: { ...TALKERS.nodes.stefan, x: 54 },
			},
		};
		const made = windowFor(tight);
		const line = part({ relmapLine: "link1" });
		const words = part({ relmapWords: "link1" });
		words.textContent = tight.edges.link1.label;
		words.ownerDocument = measuringDoc(5.2);
		made.board.all = {
			"[data-relmap-line]": [line],
			"[data-relmap-edge]": [part({ relmapEdge: "link1" })],
			"[data-relmap-words]": [words],
			"[data-relmap-head]": [],
		};
		made.app._boardContext(made.app._plan());
		expect(made.app._drawn.shapes.get("link1").labelMax).toBe(0);
		made.app._fitGapsToPaint();
		expect(words.textContent).toBe("…");
		// And no hole cut in a stroke with no room for one: the line between them stays whole.
		expect(line.attrs.d.split("M").filter(Boolean).length).toBe(1);
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

	// ── What the reader is typing, on the line ────────────────────────────────
	//
	// THE TIE BAR HAS NO TEXT BOX ON IT. A caption is words drawn along a stroke, and the box that
	// used to stand on the bar showed the sentence somewhere other than the thing it belonged to --
	// so the letters land on the line as they are typed, with the same fit and the same hole cut
	// for them as a real paint, and nothing at all written to the document.

	it("puts what is being typed onto the caption at once", () => {
		const { app, words } = drawn(5.2);
		app._fitGapsToPaint();
		app._sayLine("link1", "wed in secret");
		expect(words.textContent).toBe("wed in secret");
	});

	// The gap is re-cut for the words that are actually there, so nothing on the line jumps when
	// the write finally lands half a second later.
	it("re-cuts the hole in the stroke for the words as they arrive", () => {
		const { app, line } = drawn(5.2);
		app._fitGapsToPaint();
		const long = gapOf(line.attrs.d);
		app._sayLine("link1", "wed");
		expect(gapOf(line.attrs.d)).toBeLessThan(long);
	});

	// ⚠ AND THE SHAPE'S OWN LABEL MOVES WITH IT. `_fitGapsToPaint` and the drag preview both re-cut
	// this line from that field: a font arriving or a portrait moving mid-sentence would otherwise
	// re-cut the gap for the words the reader has stopped saying.
	it("moves the line's own label with it, so a later re-cut agrees", () => {
		const { app, words } = drawn(5.2);
		app._fitGapsToPaint();
		app._sayLine("link1", "wed");
		app._fitGapsToPaint();
		expect(words.textContent).toBe("wed");
	});

	it("writes nothing to the document for a keystroke", () => {
		const { app, entry } = drawn(5.2);
		app._fitGapsToPaint();
		app._sayLine("link1", "wed in secret");
		expect(entry.updates).toEqual([]);
	});

	// ⚠ NOT FITTED AND NOT GAPPED WHILE THE CAPTIONS ARE AWAY. In that state the board shows this
	// caption and no other, and every stroke on it is healed: a hole under the one visible caption
	// would be the only broken line on the board, and an ellipsis would hide the tail of what the
	// reader is writing at the very size where they need all of it.
	it("neither cuts the sentence nor breaks the stroke while the captions are away", () => {
		const { app, root, words, line } = drawn(30);
		app._fitGapsToPaint();
		root.classList.add("captions-off");
		const before = line.attrs.d;
		const said = "a sentence far longer than this short line has any room at all for";
		app._sayLine("link1", said);
		expect(words.textContent).toBe(said);
		expect(line.attrs.d).toBe(before);
	});

	it("has nothing to say about a line that is not on the board", () => {
		const { app } = drawn(5.2);
		app._fitGapsToPaint();
		expect(() => app._sayLine("nobody", "wed")).not.toThrow();
	});

	// ── A line nobody has written on yet ──────────────────────────────────────
	//
	// THE COMMONEST WAY INTO `_sayLine` OF ALL, rather than a corner of it: draw a line, the bar
	// opens over it, type. A line with no label is given no seat and no caption by the paint, so
	// there was nothing on the board for the letters to land on -- and since the bar's own field is
	// clipped to a pixel, the reader's first word showed up nowhere at all until the debounced
	// write came back round half a second later.

	/** A board whose one link has never been written on: a stroke, and no caption anywhere. */
	function bare() {
		const graph = { ...TALKERS, edges: { link1: { ...TALKERS.edges.link1, label: "" } } };
		const made = windowFor(graph);
		const doc = measuringDoc(5.2);
		const line = part({ relmapLine: "link1" });
		line.ownerDocument = doc;
		const layer = el();
		layer.ownerDocument = doc;
		layer.childNodes = [];
		layer.append = child => { layer.childNodes.push(child); };
		made.board.children[".stonetop-relmap-labels"] = layer;
		made.board.all = {
			"[data-relmap-line]": [line],
			"[data-relmap-edge]": [],
			"[data-relmap-words]": [],
			"[data-relmap-head]": [],
		};
		made.app._boardContext(made.app._plan());
		return { ...made, line, layer };
	}

	it("mints a caption for a line that has never carried one, so the first letter shows at once", () => {
		const { app, layer } = bare();
		app._fitGapsToPaint();
		app._sayLine("link1", "wed");
		const [group] = layer.childNodes;
		expect(group?.attrs["data-relmap-edge"]).toBe("link1");
		expect(group.attrs["data-relmap-who"]).toBe("elena stefan");
		const [words] = group.childNodes;
		expect(words.attrs["data-relmap-words"]).toBe("link1");
		expect(words.attrs.class).toBe("stonetop-relmap-label-text");
		expect(words.textContent).toBe("wed");
	});

	// One caption and not one per keystroke: the second letter finds the first letter's caption in
	// the index it was filed in, and the hole in the stroke is cut for it as for any other.
	it("cuts the hole for the caption it minted, and mints only the one", () => {
		const { app, line, layer } = bare();
		app._fitGapsToPaint();
		app._sayLine("link1", "wed");
		app._sayLine("link1", "wed in secret");
		expect(layer.childNodes).toHaveLength(1);
		expect(layer.childNodes[0].childNodes[0].textContent).toBe("wed in secret");
		expect(gapOf(line.attrs.d)).toBeGreaterThan(0);
	});

	// NOTHING WRITTEN ON IT IS NOT A CAPTION OF NO WORDS. Rubbing out what was typed gives back the
	// line the reader started with, which is exactly what the next real paint gives them: a line
	// with no label is given no seat and no hole at all.
	it("takes the words away and heals the stroke when the caption is rubbed out", () => {
		const { app, words, line } = drawn(5.2);
		app._fitGapsToPaint();
		app._sayLine("link1", "");
		expect(words.textContent).toBe("");
		expect(line.attrs.d).toBe(app._drawn.shapes.get("link1").unbroken);
		expect(app._drawn.painted.has("link1")).toBe(false);
	});

	// AND IT COMES BACK. The seat went with the words, so a reader who carries on typing after
	// clearing what they had is the same case as the line that never carried a caption at all.
	it("writes on the line again after the caption has been cleared", () => {
		const { app, words } = drawn(5.2);
		app._fitGapsToPaint();
		app._sayLine("link1", "");
		app._sayLine("link1", "wed");
		expect(words.textContent).toBe("wed");
		expect(app._drawn.shapes.get("link1").anchor).toBeTruthy();
	});

	// ── The size the board's captions are measured at ─────────────────────────
	//
	// ONE NUMBER FOR THE WHOLE BOARD, and it is the size the SHEET sets: what the zoom rule asks
	// about, and what every caption the reader has not resized is cut and gapped against. Read off
	// whichever caption the index happened to hold first, a single line set in thirty-two answered
	// for all of them -- the ordinary captions cut to about half the words that fit, their holes
	// opened twice as wide as the words in them, and a board claiming to show writing twice the
	// size it was actually showing.

	const PAIR = {
		version: 1,
		nodes: {
			...TALKERS.nodes,
			marta: { uuid: null, name: "Marta", img: "", x: 8, y: 92, note: "" },
		},
		edges: {
			link1: { ...TALKERS.edges.link1 },
			link2: {
				a: "elena", b: "marta", ink: "moss", dir: "none", note: "", label: "wed", size: 32,
			},
		},
	};

	/** That board drawn, with the RESIZED line first in the markup the index is walked out of. */
	function drawnPair(perChar) {
		const made = windowFor(PAIR);
		const doc = measuringDoc(perChar);
		const parts = ["link2", "link1"].map(id => {
			const line = part({ relmapLine: id });
			const words = part({ relmapWords: id });
			words.textContent = PAIR.edges[id].label;
			words.ownerDocument = doc;
			if (PAIR.edges[id].size) {
				words.style.setProperty("--relmap-caption-px", `${PAIR.edges[id].size}px`);
			}
			return { line, words };
		});
		made.board.all = {
			"[data-relmap-line]": parts.map(one => one.line),
			"[data-relmap-edge]": [],
			"[data-relmap-words]": parts.map(one => one.words),
			"[data-relmap-head]": [],
		};
		made.app._boardContext(made.app._plan());
		return { ...made, big: parts[0], plain: parts[1] };
	}

	it("takes the board's caption size from a line nobody has resized", () => {
		const { app } = drawnPair(5.2);
		app._fitGapsToPaint();
		expect(app._drawn.captionPx).toBe(12);
	});

	it("cuts an ordinary caption at the sheet's size, however big the line beside it is set", () => {
		const { app, plain } = drawnPair(5.2);
		app._fitGapsToPaint();
		expect(plain.words.textContent).toBe(TALKERS.edges.link1.label);
		expect(app._drawn.painted.get("link1"))
			.toBeCloseTo(TALKERS.edges.link1.label.length * 5.2, 6);
	});

	// The line the reader DID resize is still measured at its own size: a caption half again as big
	// has words half again as wide, and one cut against the board's ordinary size would run on past
	// both ends of the line it belongs to.
	it("still measures a resized line at the size that line is set in", () => {
		const { app } = drawnPair(5.2);
		app._fitGapsToPaint();
		expect(app._drawn.painted.get("link2")).toBeCloseTo(3 * 5.2 * (32 / 12), 6);
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

// THE DASHED RIM IS A MARK, AND A MARK HAS TO BE LEARNED. A reader meeting one for the first time
// has no way to tell a deleted actor from a decoration, so the words are in the tooltip — which is
// also the face's accessible name, so the reader on a magnifier and the reader on a screen reader
// are told the same thing by the same string, and neither has to click the face to find out.
describe("what a portrait says when it is rested on", () => {
	const CAST = {
		version: 1,
		nodes: {
			elena: { uuid: "Actor.a1", name: "Elena", img: "", x: 20, y: 30, note: "" },
			ghost: { uuid: "Actor.zz", name: "Tobin", img: "", x: 40, y: 30, note: "" },
			nobody: { uuid: null, name: "The Miller", img: "", x: 70, y: 30, note: "" },
		},
		edges: {},
	};

	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.fromUuidSync = uuid => (uuid === "Actor.a1" ? { name: "Elena", img: "" } : null);
	});

	const tooltips = ({ isOwner = true } = {}) => {
		const { app } = windowFor(CAST, { isOwner });
		const context = app._boardContext(app._plan());
		return Object.fromEntries(context.nodes.map(node => [node.id, node.tooltip]));
	};

	// The gesture sentence is appended to all three of these on a board the reader may edit, so
	// each is asserted as the START of what the face says rather than the whole of it. Its own
	// cases are below.
	it("names a deleted actor in words and stops offering a sheet", () => {
		expect(tooltips().ghost)
			.toContain("Tobin (deleted actor). Their sheet is no longer in this world.");
		expect(tooltips().ghost).not.toContain("Click to open their sheet");
	});

	it("still offers the sheet where there is one", () => {
		expect(tooltips().elena).toContain("Click to open their sheet");
	});

	// Somebody typed onto the board who never had an actor was not DELETED and must not be told
	// they were. `missing` is uuid-AND-no-actor, and the tooltip reads that same flag rather than
	// asking its own question — the two cannot drift apart.
	it("says nothing of the kind about somebody who never had an actor", () => {
		expect(tooltips().nobody).toMatch(/^The Miller\b/);
		expect(tooltips().nobody).not.toContain("deleted actor");
	});

	// THE ONLY PLACE THE RIGHT PRESS IS TAUGHT. It is what puts the trash can on a portrait, and a
	// gesture nothing on screen mentions is a gesture nobody finds — which is how a board came to
	// be a thing that could be added to and never subtracted from.
	it("names the right press on every face, for a reader who can act on it", () => {
		const said = tooltips();
		for (const id of ["elena", "ghost", "nobody"]) {
			expect(said[id]).toContain("Right-click to see the delete button.");
		}
	});

	// A bare name is not a sentence, and run straight into the instruction it reads as one broken
	// one. The two tooltips that already end in a full stop must not collect a second.
	it("puts a full stop between the two, and only where there is not one already", () => {
		expect(tooltips().nobody).toBe("The Miller. Right-click to see the delete button.");
		expect(tooltips().elena).not.toContain("..");
	});

	// AND NOT ON A BOARD THIS READER MAY ONLY LOOK AT, where the press does nothing: the trash can
	// is not printed for them at all, so the sentence would teach a gesture with no button behind
	// it. Same question the handle is gated on.
	it("says nothing of it to a reader who cannot edit the map", () => {
		const said = tooltips({ isOwner: false });
		expect(said.nobody).toBe("The Miller");
		expect(said.elena).not.toContain("Right-click");
	});
});

// THE MARK BEHIND THE TRASH CAN. A right press on a portrait arms one (utils/relmap-drag.js
// decides what counts as one); this is the window putting the class on the portrait it belongs to,
// and taking it off everybody else.
describe("arming one person's trash can", () => {
	/** A root whose `querySelectorAll` answers with portraits, the way a rendered board's does. */
	const boardOf = (app, ids = ["elena", "stefan"]) => {
		const nodes = ids.map(id => el({ dataset: { relmapNode: id } }));
		app._root.all["[data-relmap-node]"] = nodes;
		return Object.fromEntries(nodes.map((node, at) => [ids[at], node]));
	};
	const armed = node => node.classList.contains("is-arming");

	it("marks the person asked for and nobody else", () => {
		const { app } = windowFor();
		const nodes = boardOf(app);
		app._armRemove("stefan");
		expect(armed(nodes.stefan)).toBe(true);
		expect(armed(nodes.elena)).toBe(false);
		expect(app._armed).toBe("stefan");
	});

	// ONE AT A TIME. The sweep is what guarantees it: a second can left open on somebody the reader
	// has stopped pointing at is a delete button nobody asked for, sitting on a face.
	it("moves the can rather than leaving two of them out", () => {
		const { app } = windowFor();
		const nodes = boardOf(app);
		app._armRemove("stefan");
		app._armRemove("elena");
		expect(armed(nodes.stefan)).toBe(false);
		expect(armed(nodes.elena)).toBe(true);
	});

	// How every ordinary click closes it: the drag layer answers `null`, and nobody is armed.
	it("puts every can away when asked for nobody", () => {
		const { app } = windowFor();
		const nodes = boardOf(app);
		app._armRemove("elena");
		app._armRemove(null);
		expect(armed(nodes.elena)).toBe(false);
		expect(app._armed).toBe("");
	});

	// ⚠ SOMEBODY NO LONGER ON THE BOARD IS NOBODY, exactly as the lit web has it. This is put back
	// after every repaint, and the repaint may be the one that carried that very person off -- the
	// reader's own removal landing, or another player's. Written back from what the sweep actually
	// found, so the state can never name a portrait that is not there.
	it("forgets a person the board no longer has", () => {
		const { app } = windowFor();
		boardOf(app, ["elena"]);
		app._armed = "stefan";
		app._armRemove("stefan");
		expect(app._armed).toBe("");
	});

	// A window with no markup yet still has to remember the answer, or the mark is lost between
	// the gesture and the paint that would show it.
	it("holds the answer while there is no board to paint it on", () => {
		const { app } = windowFor();
		app._root = null;
		app._armRemove("elena");
		expect(app._armed).toBe("elena");
	});

	// It belonged to the board being left, and `_armRemove` would only have to throw it away again
	// on the next paint. Same reason `_lit` goes.
	it("drops the can when the reader switches board", () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._armed = "elena";
		app.showPage("p2");
		expect(app._armed).toBe("");
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
		expect(mapBoardRole(app.mapPage)).toBe("party");
	});

	it("is not the board the reader is on when they are on another one", () => {
		expect(mapBoardRole(on("board1").app.mapPage)).toBe("");
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
		expect(mapBoardRole(app.mapPage)).toBe("village");
	});

	it("is not the board the reader is on when they are on the party's", () => {
		expect(mapBoardRole(on("party1").app.mapPage)).not.toBe("village");
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

	// POPPING A BOARD OUT OF A SHEET INTO A WINDOW. The button that runs this is rendered only
	// on the steading sheet's tab (dialogs/RelationshipMapPanel.js sets `canPopOut`), but the
	// method is the window's, because what it says is true of any surface: bring up a window on
	// the board in front of me.
	it("opens a window on the very board the reader is looking at", () => {
		RelationshipMapWindow.prototype.render = vi.fn();
		const { app } = windowFor(TWO_PEOPLE, { pageId: "p2" });
		app._pageId = "p2";
		app._popOut();
		expect(opened).toEqual(["stonetop-relmap-map1"]);
		delete RelationshipMapWindow.prototype.render;
	});

	// ⚠ A READER PRESSES THIS WHILE LOOKING AT ONE PARTICULAR BOARD OF THE MAP. A window that
	// opened on whichever page comes first would be a different picture than the one they were
	// pointing at, which reads as the button opening the wrong thing.
	it("hands the window the page that was up, and asks for none when there is none", () => {
		const showing = { render: vi.fn(), bringToTop: vi.fn(), showPage: vi.fn() };
		alreadyOpen = showing;
		const { app } = windowFor();
		app._pageId = "p3";
		app._popOut();
		expect(showing.showPage).toHaveBeenCalledWith("p3");

		showing.showPage.mockClear();
		app._pageId = null;
		app._popOut();
		expect(showing.showPage).not.toHaveBeenCalled();
	});

	it("pops nothing out of a map that has gone", () => {
		const { app } = windowFor();
		app._entry = null;
		app._entryId = "gone";
		expect(app._popOut()).toBeNull();
		expect(opened).toEqual([]);
	});
});

// ── Turning the words off ────────────────────────────────────────────────────
//
// A village board carries a hundred captioned lines, and at the zoom that fits the whole of it
// into the window the writing is a grey thicket over the diagram: the shape of who knows whom,
// which is the question a whole board is being looked at to answer, is exactly what the words
// bury. The box in the corner takes them off.
//
// WHAT HAS TO HOLD. It is one reader's own view and it writes nothing — no caption is changed or
// rubbed out, and nobody else's window moves. It must survive a repaint, because a change from the
// far end of the table is not a reason to put the words back under somebody who turned them off.
// And the holes cut in the strokes for the words have to close: a gap is a length missing from the
// path data, so no stylesheet can heal it, and a board of lines with breaks in them for nothing
// reads as a broken diagram rather than a quiet one.

describe("turning the words off", () => {
	/** A board with one line's markup on it, as `_paintLineGaps` expects to find it. */
	function boardWithStroke() {
		const made = windowFor();
		const line = el({ dataset: { relmapLine: "link1" } });
		line.attrs = {};
		line.setAttribute = (key, value) => { line.attrs[key] = value; };
		made.board.all["[data-relmap-line]"] = [line];
		made.app._drawn = {
			shapes: new Map([["link1", {
				curve: { d: "M 0,0 L 100,0" },
				d: "M 0,0 L 40,0 M 60,0 L 100,0",
				unbroken: "M 0,0 L 100,0",
			}]]),
		};
		return { ...made, line };
	}

	it("draws the words while the box is clear", async () => {
		const { app, root } = windowFor();
		await app.sync();
		expect(root.classList.contains("captions-off")).toBe(false);
	});

	it("takes them off the whole board when it is ticked, and puts them back", () => {
		const { app, root } = windowFor();
		app._toggleLabels({ checked: true });
		expect(app._hideLabels).toBe(true);
		expect(root.classList.contains("captions-off")).toBe(true);

		app._toggleLabels({ checked: false });
		expect(app._hideLabels).toBe(false);
		expect(root.classList.contains("captions-off")).toBe(false);
	});

	// ⚠ NEITHER A RENDER NOR A REPAINT, which is the difference between this and the filter that
	// used to stand here. That one took whole LINES out of the picture, and lines are measured, so
	// every fan and dodge had to be worked out again. Words are only painted: the class is the
	// whole of the change, and the reader keeps the corner they had zoomed into.
	it("neither re-renders the window nor redraws the board", async () => {
		const { app, board } = windowFor();
		await app.sync();
		const drawn = board.innerHTML;
		app.render.mockClear();
		app._toggleLabels({ checked: true });
		expect(app.render).not.toHaveBeenCalled();
		expect(board.innerHTML).toBe(drawn);
	});

	// Said out loud, because on a board zoomed out past the size at which captions are drawn at
	// all, ticking this changes nothing anybody can see.
	it("says which way it went", () => {
		const { app, live } = windowFor();
		app._toggleLabels({ checked: true });
		expect(live.textContent).toBeTruthy();
	});

	// ⚠ THE HALF NO STYLESHEET CAN DO. Every line is drawn broken, with a length of it cut out
	// exactly where its caption sits, so a board with the words off would otherwise be a web of
	// lines with conspicuous holes in them for nothing.
	it("heals the holes cut in the strokes, and cuts them again", () => {
		const { app, line } = boardWithStroke();
		app._toggleLabels({ checked: true });
		expect(line.attrs.d).toBe("M 0,0 L 100,0");
		app._toggleLabels({ checked: false });
		expect(line.attrs.d).toBe("M 0,0 L 40,0 M 60,0 L 100,0");
	});

	// A change from the far end of the table repaints the board, and the box and the class both sit
	// outside it. Written back all the same: a state settled in the render alone is one a repaint
	// would silently undo the first time anybody else moved a portrait.
	it("keeps the words off through a repaint somebody else caused", async () => {
		const { app, root } = windowFor();
		const box = el({ tagName: "INPUT", type: "checkbox", checked: false });
		root.children["[data-relmap-action='hidelabels']"] = box;
		app._toggleLabels({ checked: true });
		await app.sync();
		expect(root.classList.contains("captions-off")).toBe(true);
		expect(box.checked).toBe(true);
	});

	// ⚠ THE ONE CONTROL IN HERE A PLAYER CAN PRESS, and gated in the TOOLS table rather than by
	// where it happens to be written. The person most in need of quieting a hundred captions is
	// exactly the reader who may not touch them.
	it("works for a reader who may only look, and writes nothing", async () => {
		const { app, root, entry } = windowFor(TWO_PEOPLE, { isOwner: false });
		await app._onToolClick({ currentTarget: { dataset: { relmapAction: "hidelabels" }, checked: true } });
		expect(root.classList.contains("captions-off")).toBe(true);
		expect(entry.updates).toEqual([]);
		// And every caption is still exactly where it was, for everybody.
		expect(readGraph(entry).edges.link1.label).toBe("exes");
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
// second layer over the top. (What makes a hundred captions affordable in the first place is that
// the words are set STRAIGHT rather than warped onto a rail: 1.2ms a raster tile against 73ms. See
// tests/styles/relationship-map-inks.test.js.)
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
				"aria-label": id + ". Click to change or delete this line.", "data-tooltip": id,
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
// ⚠ THE ZOOM DOES NOT TAKE THE WORDS AWAY. It used to: below a legibility floor every caption went,
// on the grounds that three-pixel writing is a grey thicket and, when the words were warped onto
// rails and stroked, cost SECONDS of raster to say nothing. The raster half was paid off when the
// captions were set straight instead (73ms a tile down to 1.2ms), and the legibility half was the
// board deciding for the reader -- somebody who zooms out to see the whole web is exactly the person
// who wants to see where the writing is. So the class marks the type as tiny and hides nothing.
describe("marking the board when its captions go under the legibility floor", () => {
	/** A window whose root remembers the classes written on it. */
	function windowWithRoot() {
		const { app, root, board } = windowFor();
		return { app, root, board, on: () => [...root.classList._set] };
	}

	it("marks the board once it is scaled below the legibility floor", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.3 });
		expect(root.classList.contains("captions-tiny")).toBe(true);
	});

	// ⚠ THE GUARD ON THE WHOLE CHANGE. Whatever else the mark does, it must never be the thing that
	// stops a caption being painted -- that class is gone and no zoom may bring it back.
	it("never hides a caption, however far out the board is zoomed", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.05 });
		expect(root.classList.contains("captions-too-small")).toBe(false);
		expect(app._captionsHidden()).toBe(false);
	});

	it("clears the mark the moment the reader zooms far enough in", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.3 });
		app._paintCaptionZoom({ scale: 1 });
		expect(root.classList.contains("captions-tiny")).toBe(false);
	});

	// THE RULE IS THE PAINTED SIZE OF THE TYPE and not a zoom number, so that it moves with whatever
	// the stylesheet sets the captions in -- which `_fitGapsToPaint` has already read off a real
	// caption. Bigger type survives a smaller board.
	it("measures the type rather than the zoom", () => {
		const { app, root } = windowWithRoot();
		app._drawn = { captionPx: 32 };
		app._paintCaptionZoom({ scale: 0.3 });
		expect(root.classList.contains("captions-tiny")).toBe(false);
	});

	// ⚠ AND THE CAPTION THE READER IS HOLDING IS BLOWN UP TO BE READABLE. The tie bar has no text
	// box on it: what a reader types shows on the LINE, and a whole board fitted into the window is
	// under this threshold -- which is the zoom the map opens at. This is the size the held one
	// keeps, in board pixels worked out so the words come out readable whatever the board is at.
	it("keeps the held caption readable while the board's type is tiny", () => {
		const { app, root } = windowWithRoot();
		const set = {};
		root.style = { setProperty: (k, v) => { set[k] = v; }, removeProperty: k => { delete set[k]; } };
		app._drawn = { captionPx: 12 };
		app._paintCaptionZoom({ scale: 0.25 });
		expect(set["--relmap-say-px"]).toBe("52px");
		app._paintCaptionZoom({ scale: 1 });
		expect(set["--relmap-say-px"]).toBeUndefined();
	});

	// A board that has not been sized yet must not open with one caption blown up over the rest.
	it("marks nothing when it does not know the scale", () => {
		const { app, root } = windowWithRoot();
		app._paintCaptionZoom(null);
		expect(root.classList.contains("captions-tiny")).toBe(false);
		app._paintCaptionZoom({ scale: 0 });
		expect(root.classList.contains("captions-tiny")).toBe(false);
	});
});

// ── The holes cut for words that are not there ──────────────────────────────
//
// Every line is drawn BROKEN, with a length cut out exactly where its caption goes, because the
// words sit IN the line rather than over it. Take the words away -- which only the reader ticking
// the box does -- and what is left is a web of lines with conspicuous breaks in them for nothing,
// which reads as a broken diagram.
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

	it("closes the gaps when the reader turns the words off", () => {
		const { app, line } = boardWithLines();
		app._toggleLabels({ checked: true });
		expect(line.attrs.d).toBe("WHOLE");
	});

	it("cuts them again when the captions come back", () => {
		const { app, line } = boardWithLines();
		app._toggleLabels({ checked: true });
		app._toggleLabels({ checked: false });
		expect(line.attrs.d).toBe("BROKEN");
	});

	// ⚠ AND A ZOOM NEVER TOUCHES THEM. The gaps are cut for captions that are still being painted,
	// however small the board has got: healing them would leave every line whole with the words
	// lying across it.
	it("leaves the gaps cut however far out the board is zoomed", () => {
		const { app, line } = boardWithLines();
		app._paintCaptionZoom({ scale: 0.05 });
		expect(line.attrs.d).toBe("BROKEN");
	});

	// Only when the answer CHANGES, rather than a hundred attribute writes on every frame of a pan.
	it("writes nothing when the answer has not changed", () => {
		const { app, line } = boardWithLines();
		app._toggleLabels({ checked: true });
		line.attrs.d = "UNTOUCHED";
		app._toggleLabels({ checked: true });
		expect(line.attrs.d).toBe("UNTOUCHED");
	});
});

// ⚠ WHAT A REPAINT CAN AND CANNOT PUT RIGHT. A live update replaces the BOARD's markup and
// nothing else, so the panel over it can only be shown, hidden and written into -- never
// re-rendered. Everything it says has to be written on every repaint, because all of it can change
// without a render: somebody at the far end of the table takes the last person off the board, or an
// ownership change takes away the right to put anybody back.
describe("the panel a repaint puts up", () => {
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
	});

	// ⚠ THE EMPTY BOARD'S HEADLINE SURVIVES A REPAINT, which is the failure this catches:
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

	// And it goes away again the moment somebody arrives, without a render.
	it("takes the panel down when the board stops being empty", () => {
		const made = windowFor({ nodes: {}, edges: {} });
		made.app._paintChrome(made.app._plan());
		expect(made.empty.hidden).toBe(false);
		made.app._entry = entryFor(TWO_PEOPLE);
		made.app._paintChrome(made.app._plan());
		expect(made.empty.hidden).toBe(true);
	});
});

// ⚠ `_plan` IS NOT FREE: it reads the document and filters the whole graph, on a pass that runs
// every time anybody at the table touches the map. So the plan a render was drawn from is handed
// forward to the listeners wired onto it rather than rebuilt for the two numbers they want out of
// the sheet.
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
// ── What the bar over a line is told ─────────────────────────────────────────
//
// ⚠ ASKED OF THE BOARD IN FRONT OF THE READER, NOT OF THE DOCUMENT. The document is read afresh
// on every repaint, and a repaint is exactly the moment a line's middle moves -- so a bar placed
// from the document would float over an empty patch of paper until the next one arrived.
describe("the line a reader has taken hold of", () => {
	// The arrow buttons are named after the two people, so this block needs the real table back:
	// an earlier suite replaces `globalThis.game` wholesale and takes `i18n` with it.
	beforeEach(() => { globalThis.game.i18n = TABLE; });

	/** A window whose last paint is on record, which is what `_tieAt` reads. */
	const painted = (graph = TWO_PEOPLE) => {
		const made = windowFor(graph);
		made.app._boardContext(made.app._plan());
		return made;
	};

	/** A board carrying two lines, each with its stroke, its click target and its caption. */
	function boardWithLines() {
		const { app, board } = windowFor();
		const parts = {};
		for (const id of ["link1", "link2"]) {
			parts[id] = {
				line: el({ dataset: { relmapLine: id } }),
				hit: el({ dataset: { relmapHit: id } }),
				label: el({ dataset: { relmapEdge: id } }),
			};
		}
		board.all["[data-relmap-line]"] = [parts.link1.line, parts.link2.line];
		board.all["[data-relmap-hit]"] = [parts.link1.hit, parts.link2.hit];
		board.all["[data-relmap-edge]"] = [parts.link1.label, parts.link2.label];
		return { app, parts };
	}

	// ⚠ THE BOARD'S MARKUP IS THE WINDOW'S. The bar floats outside the board and asks for this;
	// a bar that walked the strokes itself would be a second module enumerating the three families a
	// line is made of, which is how the invisible click target came to need adding in two places.
	it("marks the stroke, its click target and its caption, and no other line's", () => {
		const { app, parts } = boardWithLines();
		app._paintPickedLine("link1");
		expect(parts.link1.line.classList.contains("is-picked")).toBe(true);
		expect(parts.link1.hit.classList.contains("is-picked")).toBe(true);
		expect(parts.link1.label.classList.contains("is-picked")).toBe(true);
		expect(parts.link2.line.classList.contains("is-picked")).toBe(false);
	});

	// Taken off the elements it was PUT on, rather than swept off every stroke on the board: this
	// runs on every repaint, and a board carries eighty of each of the three.
	it("takes the mark off the line it last marked", () => {
		const { app, parts } = boardWithLines();
		app._paintPickedLine("link1");
		app._paintPickedLine("");
		expect(parts.link1.line.classList.contains("is-picked")).toBe(false);
		expect(parts.link1.hit.classList.contains("is-picked")).toBe(false);
		expect(parts.link1.label.classList.contains("is-picked")).toBe(false);
	});

	it("moves the mark when the reader takes hold of another line", () => {
		const { app, parts } = boardWithLines();
		app._paintPickedLine("link1");
		app._paintPickedLine("link2");
		expect(parts.link1.line.classList.contains("is-picked")).toBe(false);
		expect(parts.link2.line.classList.contains("is-picked")).toBe(true);
	});

	it("hands over the line, both people, and where to float", () => {
		const { app } = painted();
		const tie = app._tieAt("link1");
		expect(tie.edge.label).toBe("exes");
		expect(tie.from.name).toBe("Elena");
		expect(tie.to.name).toBe("Stefan");
		expect(tie.at.left).toBeGreaterThan(0);
		expect(tie.at.top).toBeGreaterThan(0);
	});

	// The arrow buttons in the two people's own names. A tie set the wrong way round is invisible
	// in the writing and glaring on the board, and "which end did I draw from" is not something
	// anybody remembers.
	it("names both arrows after the people they point at", () => {
		const { app } = painted();
		const tie = app._tieAt("link1");
		// Keyed by the answers themselves, which is what the buttons carry and what the bar reads.
		expect(tie.said["a-b"]).toContain("Stefan");
		expect(tie.said["b-a"]).toContain("Elena");
	});

	// ⚠ THE SEAT THIS VIEW GAVE THEM, not the stored one: which way the two one-way arrows POINT is
	// worked out from these, and on a computed board the stored coordinates would point them wrong.
	it("gives each end the seat this view drew it at", () => {
		const { app } = painted();
		const tie = app._tieAt("link1");
		expect(tie.from.x).toBe(20);
		expect(tie.to.x).toBe(70);
	});

	// A LINE WITH NOTHING WRITTEN ON IT STILL HAS SOMEWHERE FOR THE BAR TO GO, which it needs more
	// than a captioned one does: the bar is the only way to put writing on it at all.
	it("floats over the middle of a line with no caption", () => {
		const bare = {
			...TWO_PEOPLE,
			edges: { link1: { a: "elena", b: "stefan", label: "", ink: "rose", dir: "none" } },
		};
		const { app } = painted(bare);
		expect(app._tieAt("link1").at).toBeTruthy();
	});

	// NULL IS HOW THE BAR LEARNS TO LET GO: somebody else rubbing the line out, or this reader
	// switching to a view that does not draw it.
	it("says nothing about a line that is not on this board", () => {
		const { app } = painted();
		expect(app._tieAt("nosuchline")).toBe(null);
	});
});

// ── Drawing one, and rubbing one out ─────────────────────────────────────────
//
// BOTH USED TO BE A MODAL. Clicking a line, and drawing one, each opened a window asking six
// questions about it; four of those are on the bar over the line itself now, rubbing it out is the
// last press on that bar, and the window is gone. What is left to get right is the two ends of
// that: a line drawn is a line the reader can immediately say something about, and a line rubbed
// out is one press with an undo behind it rather than a question.
describe("drawing a line between two people", () => {
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	});

	/** A window whose bar only records what it was asked to take hold of. */
	const withBar = (graph = TWO_PEOPLE, options = {}) => {
		const made = windowFor(graph, options);
		made.app._tieBar = { open: vi.fn(), refresh: vi.fn(), flush: vi.fn() };
		return made;
	};

	/** The one line a write drew, read back off the leaf paths it was written as. */
	const drawn = patch => {
		const fields = {};
		let id = "";
		for (const [key, value] of Object.entries(patch)) {
			const found = /\.edges\.([^.]+)\.(.+)$/.exec(key);
			id = found[1];
			fields[found[2]] = value;
		}
		return { id, fields };
	};

	it("draws it at once, saying nothing, in the default ink on a map with no pen", async () => {
		const { app, entry } = withBar();
		await app._createLink("elena", "stefan");
		expect(entry.updates).toHaveLength(1);
		const { fields } = drawn(entry.updates[0]);
		expect(fields).toMatchObject({ a: "elena", b: "stefan", label: "", ink: "slate" });
	});

	// THE WHOLE POINT OF LOSING THE WINDOW. The line exists and the bar opens on it with the caret
	// in the writing field, so "draw a line and say what it is" is one gesture -- and the same one
	// as clicking a line that is already there.
	//
	// ⚠ IT WAITS FOR THE PAINT. The bar places itself over a line from `_drawn`, the geometry the
	// markup on screen was built from, and the paint standing when a line is drawn was made before
	// that line existed: asked at the write, the bar finds nothing and silently refuses to open --
	// a line drawn with no way to say what it is, which is the whole gesture failing quietly.
	it("waits for the board to have the new line before taking hold of it", async () => {
		const { app, entry } = withBar();
		await app._createLink("elena", "stefan");
		expect(app._tieBar.open).not.toHaveBeenCalled();
		expect(app._pendingPick).toBe(drawn(entry.updates[0]).id);
	});

	it("takes hold of it on the repaint the write sets off", async () => {
		const { app } = withBar();
		app._pendingPick = "link1";
		await app._repaintBoard();
		expect(app._tieBar.open).toHaveBeenCalledWith("link1");
		// AND ONCE. Left standing, every later repaint -- somebody else moving a portrait, this
		// reader switching view -- would drag the bar back onto a line they let go of long ago.
		app._tieBar.open.mockClear();
		await app._repaintBoard();
		expect(app._tieBar.open).not.toHaveBeenCalled();
	});

	it("draws nothing between somebody and themselves, or to a face that has gone", async () => {
		const { app, entry } = withBar();
		await app._createLink("elena", "elena");
		await app._createLink("elena", "nobody");
		expect(entry.updates).toEqual([]);
		expect(app._tieBar.open).not.toHaveBeenCalled();
	});

	// ⚠ AND IN THE PEN THE MAP IS BEING DRAWN WITH, which is the one thing about a new line that
	// is not simply the shipped default. A table that has settled on dotted plum for the rumours
	// would otherwise get slate and solid on every line and have to say it again on the bar
	// afterwards, on a board where six are drawn while they talk. It is the MAP that keeps it, so
	// the convention is the same in everybody's hand: see relmap/relmap-pen.js.
	it("draws it in the pen the map is being drawn with", async () => {
		const { app, entry } = withBar(TWO_PEOPLE, {
			pen: { ink: "plum", dash: "dotted", size: 24 },
		});
		await app._createLink("elena", "stefan");
		expect(drawn(entry.updates[0]).fields)
			.toMatchObject({ ink: "plum", dash: "dotted", size: 24 });
	});

	// ⚠ AND THE SIZE THIS READER LAST ASKED FOR SEEDS A MAP THAT HAS NONE, which is the one thing
	// left of the record that used to decide this on its own. A reader who has settled on
	// eighteen-pixel captions -- and the one at this table on a screen magnifier will -- would
	// otherwise start every NEW map back at the base size and have to reach for the chooser again.
	// See relmap/relmap-size.js, and `penFor`, which is where the two meet.
	it("draws it in the size this client last chose, on a map that has no size of its own", async () => {
		globalThis.game.settings = { get: () => 18, set: () => Promise.resolve() };
		const { app, entry } = withBar();
		await app._createLink("elena", "stefan");
		expect(drawn(entry.updates[0]).fields).toMatchObject({ size: 18 });
	});

	// And stops seeding it the moment the table has an answer, because the map is what they share.
	it("lets the map's own size beat the one this client remembers", async () => {
		globalThis.game.settings = { get: () => 18, set: () => Promise.resolve() };
		const { app, entry } = withBar(TWO_PEOPLE, { pen: { size: 24 } });
		await app._createLink("elena", "stefan");
		expect(drawn(entry.updates[0]).fields).toMatchObject({ size: 24 });
	});

	// A map and a client that have both never said, which is every board until somebody uses the
	// chooser. Zero is "whatever the sheet sets", and is what every line ever drawn already holds.
	it("draws it with no size of its own when nobody has ever chosen one", async () => {
		const { app, entry } = withBar();
		await app._createLink("elena", "stefan");
		expect(drawn(entry.updates[0]).fields).toMatchObject({ size: 0 });
	});
});

// ⚠ THE OTHER HALF OF THE PEN: picking it up. Everything the tie bar changes about a line comes
// through one handler, and three of those fields are what the NEXT line on this map is born in.
//
// The arithmetic of the pen itself is proved by tests/relmap/relmap-pen.test.js; what is held here
// is the wiring -- that the window hands the pen the MAP and not the board page, that it keeps this
// client's own size record alongside, and that neither can put itself in front of the line.
describe("picking up the pen a reader drew with", () => {
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		// This client's own size record, which rides alongside the map's pen. Stubbed for every
		// test in here rather than the two that read it back: without it the setting write throws
		// into the console on every pass, which is noise a real failure then hides in.
		globalThis.game.settings = { get: () => 0, set: () => Promise.resolve() };
	});

	const PEN_PREFIX = "flags.stonetop-pwd.relationshipMapPen";

	it("records a colour, a stroke and a size on the map, where everybody reads them", () => {
		const { app, entry } = windowFor();
		app._rememberPen({ ink: "plum", dash: "dotted", size: 24 });
		expect(entry.updates).toEqual([{
			[`${PEN_PREFIX}.ink`]: "plum",
			[`${PEN_PREFIX}.dash`]: "dotted",
			[`${PEN_PREFIX}.size`]: 24,
		}]);
	});

	// What a line SAYS is the line's own business, and which way it is read is a fact about the two
	// people rather than a house style. A pen that carried either would be the board asserting
	// something nobody said on the next line drawn.
	it("takes nothing else the bar wrote with it", () => {
		const { app, entry } = windowFor();
		app._rememberPen({ label: "her mother", dir: "a-b", note: "she never says so" });
		expect(entry.updates).toEqual([]);
	});

	it("says nothing twice, so an unchanged choice broadcasts nothing", () => {
		const { app, entry } = windowFor(TWO_PEOPLE, { pen: { ink: "plum" } });
		app._rememberPen({ ink: "plum" });
		expect(entry.updates).toEqual([]);
	});

	// The client's own record, still written beside the map's. It is flat across every world, so it
	// is what a reader on a magnifier carries onto a map nobody has set a size on yet.
	it("keeps this client's own size record alongside the map's", () => {
		const sets = [];
		globalThis.game.settings = {
			get: () => 0,
			set: (ns, key, value) => { sets.push([key, value]); return Promise.resolve(value); },
		};
		const { app } = windowFor();
		app._rememberPen({ size: 24 });
		expect(sets).toEqual([["lastCaptionSize", 24]]);
	});

	it("leaves that record alone when the choice was not a size", () => {
		const sets = [];
		globalThis.game.settings = {
			get: () => 0,
			set: (ns, key, value) => { sets.push([key, value]); return Promise.resolve(value); },
		};
		const { app } = windowFor();
		app._rememberPen({ ink: "plum" });
		expect(sets).toEqual([]);
	});
});

describe("putting several people on the board at once", () => {
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	});

	const ARRIVING = [
		{ uuid: "Actor.aerin", name: "Aerin", img: "" },
		{ uuid: "Actor.brakken", name: "Brakken", img: "" },
		{ uuid: "Actor.corwin", name: "Corwin", img: "" },
	];

	/** The nodes a write seated, read back off the leaf paths it was written as. */
	const seated = patch => {
		const people = new Map();
		for (const [key, value] of Object.entries(patch)) {
			const found = /\.nodes\.([^.]+)\.(.+)$/.exec(key);
			if (!found) continue;
			people.set(found[1], { ...(people.get(found[1]) ?? {}), [found[2]]: value });
		}
		return [...people.values()];
	};

	// ⚠ ONE WRITE, WHICH IS THE WHOLE REASON THIS IS NOT A LOOP. Three calls is three document
	// updates, three broadcasts, three repaints on every open window and three steps to undo
	// something the reader did once.
	it("seats everybody in a single update", async () => {
		const { app, entry } = windowFor();
		await app._addNodesFor(readGraph(app.boardDoc), ARRIVING);
		expect(entry.updates).toHaveLength(1);
		expect(seated(entry.updates[0]).map(node => node.name))
			.toEqual(["Aerin", "Brakken", "Corwin"]);
	});

	// ⚠ AND NOBODY LANDS ON ANYBODY. The seater keeps its own list of what is taken as it goes,
	// which a loop could not: `freeSpot` reads the graph, and the graph knows nothing about the
	// arrivals still in flight, so the second would be handed the seat the first had just taken.
	it("gives each of them a seat of their own", async () => {
		const { app, entry } = windowFor();
		await app._addNodesFor(readGraph(app.boardDoc), ARRIVING);
		const spots = seated(entry.updates[0]).map(node => `${node.x},${node.y}`);
		expect(new Set(spots).size).toBe(3);
	});

	it("writes nothing when there is nobody to seat", async () => {
		const { app, entry } = windowFor();
		await app._addNodesFor(readGraph(app.boardDoc), []);
		expect(entry.updates).toEqual([]);
	});
});

describe("rubbing a line out from the bar", () => {
	beforeEach(() => {
		globalThis.game.i18n = TABLE;
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	});

	// ⚠ AND IT ASKS NOTHING, which is the one destructive gesture in this window that does not.
	// Taking a PERSON off asks because the reader cannot see everything that goes with them; a line
	// is one thing, they are looking straight at it, and the undo puts it back with what it said.
	it("takes the line off the map without a question", async () => {
		const { app, entry } = windowFor();
		await app._rubOutLink("link1");
		expect(entry.updates).toHaveLength(1);
		expect(Object.keys(entry.updates[0]))
			.toEqual(["flags.stonetop-pwd.relationshipMap.edges.-=link1"]);
	});

	// Somebody else at the table got there first. Nothing to write, and nothing to say about it:
	// the line the reader was looking at is already gone from under the bar.
	it("writes nothing for a line that is no longer there", async () => {
		const { app, entry } = windowFor();
		await app._rubOutLink("nosuchline");
		expect(entry.updates).toEqual([]);
	});

	// ONE PRESS BACK, and it is what stands in for the confirm this gesture does not ask. On a
	// living board, so the line actually comes back rather than the write merely being recorded.
	it("is a change the undo puts back, line and words together", async () => {
		forgetAllHistory();
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._tieBar = { open: vi.fn(), refresh: vi.fn(), flush: vi.fn() };
		await app._rubOutLink("link1");
		expect(readGraph(page).edges.link1).toBeUndefined();

		await app._stepHistory("back");
		expect(readGraph(page).edges.link1).toMatchObject({ a: "elena", b: "stefan", label: "exes" });
		forgetAllHistory();
	});
});

// ── The two things a stroke now carries ──────────────────────────────────────
describe("what the board draws a line with", () => {
	it("lays the whole curve under every line for a click to land on", () => {
		const { app } = windowFor();
		const [line] = app._boardContext(app._plan()).edges;
		// The painted stroke has the caption's gap cut out of it; the target must not, because that
		// gap is the exact stretch a reader aims at.
		expect(line.hit).toBeTruthy();
		expect(line.hit).not.toBe(line.d);
	});

	// ⚠ THE KEY AND NOT A FLAG PER KIND, and "" for a whole stroke. There are three answers (see
	// RELMAP_DASHES) and the class the board wears is the key itself, so a fourth arrives DRAWN
	// rather than silently solid -- which is the one failure nothing on the board would show.
	it("says how the reader broke this stroke, and nothing for one they left whole", () => {
		const { app } = windowFor();
		expect(app._boardContext(app._plan()).edges[0].broken).toBe("");

		for (const dash of ["dotted", "dashed"]) {
			const made = windowFor({
				...TWO_PEOPLE,
				edges: { link1: { ...TWO_PEOPLE.edges.link1, dash } },
			});
			expect(made.app._boardContext(made.app._plan()).edges[0].broken).toBe(dash);
		}

		// A stroke the store did not recognise is `solid` by the time it reaches here, so the board
		// draws it whole rather than hanging a class the stylesheet has never heard of on it.
		const odd = windowFor({
			...TWO_PEOPLE,
			edges: { link1: { ...TWO_PEOPLE.edges.link1, dash: "squiggly" } },
		});
		expect(odd.app._boardContext(odd.app._plan()).edges[0].broken).toBe("");
	});
});

// ── The colours the table has already used ──────────────────────────────────
//
// The second row of the tie bar's palette, and the reason it is read off the map rather than
// remembered per reader: a table that has settled on one particular purple wants that purple on the
// next line too, and wants every client at the table offered the same list -- which is exactly what
// the map already says, with nothing stored anywhere to say it twice.
describe("the colours of the table's own already on a board", () => {
	const MANY_INKS = {
		...TWO_PEOPLE,
		edges: {
			l1: { a: "elena", b: "stefan", label: "", ink: "#7a2f8a", dir: "none" },
			l2: { a: "elena", b: "stefan", label: "", ink: "rose", dir: "none" },
			l3: { a: "elena", b: "stefan", label: "", ink: "#1d5f4a", dir: "none" },
			l4: { a: "elena", b: "stefan", label: "", ink: "#7a2f8a", dir: "none" },
		},
	};

	// MOST-USED FIRST, so a board where one colour means "owes money" and another was tried once
	// offers the first of them first. The eight are not in here at all: they have their own row.
	it("offers each one once, most-used first, and none of the eight", () => {
		const { app } = windowFor(MANY_INKS);
		expect(app._inksInUse()).toEqual(["#7a2f8a", "#1d5f4a"]);
	});

	it("offers nothing at all for a board drawn only in the eight", () => {
		const { app } = windowFor();
		expect(app._inksInUse()).toEqual([]);
	});

	// ⚠ READ OFF THE GRAPH AND NOT OFF `_drawn`, which is the one question this window asks of the
	// MAP rather than of the board in front of the reader. A narrow view showing eight of forty
	// people would otherwise offer eight people's worth of colours and lose the rest -- and the
	// reader would find their purple missing for a reason nothing on screen explains.
	it("reads the whole map, not the handful of people this view is showing", () => {
		const { app } = windowFor(MANY_INKS);
		app._drawn = { graph: { nodes: {}, edges: {} }, shapes: new Map() };
		expect(app._inksInUse()).toEqual(["#7a2f8a", "#1d5f4a"]);
	});
});

function pageFor(name, graph, { id, sort, parent, ownership = null }) {
	const doc = {
		id, name, sort, parent,
		updates: [],
		// A page core made carries `{ default: INHERIT }`, which is what "the players see this one"
		// means on a map the whole table owns. A board the GM has kept back carries
		// `{ default: NONE }`. See relmap/relmap-doc.js.
		ownership: ownership ?? { default: -1 },
		getFlag: (scope, key) =>
			(scope === "stonetop-pwd" && key === "relationshipMap" ? graph : null),
		// Core's own rule, near enough: a GM is OWNER over everything, an explicit level for this
		// user beats the default, and INHERIT defers to the parent entry.
		testUserPermission(user, permission) {
			if (user?.isGM) return true;
			const level = doc.ownership?.[user?.id] ?? doc.ownership?.default ?? -1;
			if (level === -1) return !!doc.parent?.isOwner;
			return level >= (permission === "OWNER" ? 3 : 2);
		},
		// ⚠ DERIVED AND NOT SET, exactly as core derives it: `isOwner` is
		// `testUserPermission(game.user, "OWNER")`. A fake that carried it as a flag of its own
		// would certify a window asking the wrong document, because both documents would say yes.
		get isOwner() { return doc.testUserPermission(game?.user, "OWNER"); },
		update(patch) {
			doc.updates.push(patch);
			if (patch.ownership) Object.assign(doc.ownership, patch.ownership);
			return Promise.resolve(doc);
		},
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
		{
			id: board.id, sort: i * 100000, parent: entry,
			// `hidden: true` is a board the GM has kept back: nobody but them may look at it.
			ownership: board.hidden ? { default: 0 } : null,
		},
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
		//
		// Matched with the two attributes apart rather than adjacent: a shown board carries an
		// `aria-label` between them (see the visibility mark's own tests), and the thing under test
		// here is that the selected tab is the one with the open tabindex on it, not what else it
		// happens to say.
		expect(tabs).toMatch(/aria-selected="true" tabindex="0"[^>]*data-relmap-page="p2"/);
		expect(tabs).toMatch(/aria-selected="false" tabindex="-1"[^>]*data-relmap-page="p1"/);
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

	// The highlight belonged to the board being left, and `_lightPerson` would only have to throw
	// it away again on the next paint.
	it("drops the highlight, which belonged to the board being left", () => {
		const entry = TWO_BOARDS();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._lit = "elena";
		app.showPage("p2");
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
		app._wireSync();
		const [gone] = entry.pages.contents.splice(0, 1);
		on.get("deleteJournalEntryPage")(gone);
		expect(app._pageId).toBeNull();
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

// ── Taking a change back ────────────────────────────────────────────────────────────────────────
//
// The stacks themselves are proved in tests/relmap/relmap-history.test.js. What matters here is the
// wiring: that every edit this window makes is remembered by having gone through the one funnel,
// that an undo writes leaf paths like any other edit, that it does not become a change of its own,
// and that each board keeps its own.

/** The flag path prefix, spelled out once for the assertions below. */
const FLAG = "flags.stonetop-pwd.relationshipMap";

/**
 * A map whose boards actually KEEP what is written to them.
 *
 * The fakes above record their updates and never apply them, which is all the rest of this file
 * needs. An undo cannot be proved against one: the whole question it answers is what a step
 * recorded against one board does to the board as it stands NOW, so the board has to move.
 *
 * They also carry a `uuid`, which is how a history finds its board again (relmap-history.js).
 */
function livingMap(boards) {
	const pages = [];
	const entry = {
		id: "map1",
		name: "The people of Stonetop",
		isOwner: true,
		updates: [],
		pages: { get contents() { return pages; } },
		getFlag: (scope, key) =>
			(scope === "stonetop-pwd" && key === "relationshipMap" ? { version: 2 } : null),
		update(patch) { entry.updates.push(patch); return Promise.resolve(entry); },
	};
	boards.forEach((board, i) => {
		const page = {
			id: board.id,
			name: board.name,
			sort: i * 100000,
			parent: entry,
			uuid: `JournalEntry.map1.JournalEntryPage.${board.id}`,
			updates: [],
			// The ownership every shown board carries: INHERIT, which takes the map's own, and a map
			// is owned by everybody at the table. `isOwner` is DERIVED from it exactly as core
			// derives it, because the window asks the PAGE whether this reader may edit the board
			// and a fake that simply said yes would certify it asking anything at all.
			ownership: board.hidden ? { default: 0 } : { default: -1 },
			testUserPermission(user, permission) {
				if (user?.isGM) return true;
				const level = page.ownership?.[user?.id] ?? page.ownership?.default ?? -1;
				if (level === -1) return !!page.parent?.isOwner;
				return level >= (permission === "OWNER" ? 3 : 2);
			},
			get isOwner() { return page.testUserPermission(game?.user, "OWNER"); },
			flag: foundry.utils.deepClone(board.graph ?? EMPTY_BOARD),
			getFlag: (scope, key) =>
				(scope === "stonetop-pwd" && key === "relationshipMap" ? page.flag : null),
			update(patch) {
				page.updates.push(patch);
				for (const [key, value] of Object.entries(patch)) {
					const parts = key.slice(`${FLAG}.`.length).split(".");
					const leaf = parts[parts.length - 1];
					if (leaf.startsWith("-=")) {
						delete page.flag[parts[0]][leaf.slice(2)];
						continue;
					}
					if (parts.length === 1) {
						page.flag[parts[0]] = value;
						continue;
					}
					const [kind, id, field] = parts;
					page.flag[kind] ??= {};
					page.flag[kind][id] ??= {};
					page.flag[kind][id][field] = value;
				}
				return Promise.resolve(page);
			},
		};
		pages.push(page);
	});
	return { entry, pages };
}

const ONE_LIVING_BOARD = () => livingMap([{ id: "p1", name: "Stonetop", graph: TWO_PEOPLE }]);

describe("taking a change back", () => {
	// The stacks outlive the window they were filled through, which is the point of them -- so a
	// board named by one test would still be carrying the last one's steps.
	beforeEach(() => forgetAllHistory());
	afterEach(() => forgetAllHistory());

	it("puts a moved portrait back, and then forward again", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		expect(readGraph(page).nodes.elena.x).toBe(80);
		expect(app._history.canUndo).toBe(true);

		await app._stepHistory("back");
		expect(readGraph(page).nodes.elena.x).toBe(20);
		expect(readGraph(page).nodes.elena.y).toBe(30);
		expect(app._history.canUndo).toBe(false);
		expect(app._history.canRedo).toBe(true);

		await app._stepHistory("forward");
		expect(readGraph(page).nodes.elena.x).toBe(80);
		expect(app._history.canRedo).toBe(false);
	});

	// ⚠ THE DECISION THE WHOLE FEATURE RESTS ON, asserted where it can actually be broken. An undo
	// that wrote the graph back would be one write of `...relationshipMap.nodes`, and it would take
	// every change anybody else at the table had made with it.
	it("takes a change back with LEAF paths, exactly as the change was made", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		await app._stepHistory("back");
		expect(page.updates).toHaveLength(2);
		expect(Object.keys(page.updates[1]).sort()).toEqual([
			`${FLAG}.nodes.elena.x`, `${FLAG}.nodes.elena.y`,
		]);
	});

	// Otherwise the button would flip one edit on and off for ever.
	it("never records the undo itself as a change to take back", async () => {
		const { entry } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		await app._stepHistory("back");
		expect(app._history.canUndo).toBe(false);
	});

	it("says so, and writes nothing, when there is nothing left to take back", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		expect(await app._stepHistory("back")).toBe(false);
		expect(page.updates).toEqual([]);
	});

	// The ask, in the user's own words: at least twenty previous states.
	it("keeps at least the twenty states that were asked for", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		for (let step = 1; step <= 20; step += 1) await app._moveNode("elena", { x: 30 + step, y: 30 });
		expect(readGraph(page).nodes.elena.x).toBe(50);
		for (let step = 0; step < 20; step += 1) await app._stepHistory("back");
		// Twenty presses reach the seat the portrait started the evening in.
		expect(readGraph(page).nodes.elena.x).toBe(20);
		expect(app._history.canUndo).toBe(false);
	});

	it("puts somebody taken off the map back, with every line that came off with them", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		const before = readGraph(page);
		await app._write(dropNodePatch(before, "elena"), { label: "taking Elena off" });
		expect(readGraph(page).nodes.elena).toBeUndefined();
		expect(readGraph(page).edges.link1).toBeUndefined();

		await app._stepHistory("back");
		expect(readGraph(page).nodes.elena).toEqual(before.nodes.elena);
		expect(readGraph(page).edges.link1).toEqual(before.edges.link1);
	});

	// ⚠ ONE MAP IS SEVERAL NAMED BOARDS, and a history shared between them would make undo mean
	// "take back whatever I last did, wherever I did it" -- pressed on a board where nothing has
	// changed, it would silently move a portrait on another one.
	it("gives each board of a map its own history", async () => {
		const { entry } = livingMap([
			{ id: "p1", name: "Stonetop", graph: TWO_PEOPLE },
			{ id: "p2", name: "Marshedge", graph: TWO_PEOPLE },
		]);
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		expect(app._history.canUndo).toBe(true);

		app._pageId = "p2";
		expect(app._history.canUndo).toBe(false);

		app._pageId = "p1";
		expect(app._history.canUndo).toBe(true);
	});

	// A run of arrow keys is one gesture, and a reader walking somebody across the board wants one
	// press to put them back -- not one per pause they made on the way.
	it("folds a run of arrow keys into one change", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 25, y: 30 }, { coalesce: "node:elena" });
		await app._moveNode("elena", { x: 30, y: 30 }, { coalesce: "node:elena" });
		await app._moveNode("elena", { x: 35, y: 30 }, { coalesce: "node:elena" });
		expect(readGraph(page).nodes.elena.x).toBe(35);

		await app._stepHistory("back");
		expect(readGraph(page).nodes.elena.x).toBe(20);
		expect(app._history.canUndo).toBe(false);
	});

	// A drag passes no key, because a drag is a gesture already.
	it("never folds two deliberate drags together", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 40, y: 30 });
		await app._moveNode("elena", { x: 60, y: 30 });

		await app._stepHistory("back");
		expect(readGraph(page).nodes.elena.x).toBe(40);
	});

	// ⚠ A CAPTION STILL IN THE BAR IS A CHANGE THAT HAS NOT LANDED YET, and the undo has to wait
	// for it. Merely STARTED, the caption records itself a microtask later -- emptying the forward
	// stack under a redo already in flight, and taking back the change before the one the reader is
	// actually looking at.
	it("saves a caption the reader was still typing before it takes anything back", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		app._tieBar = {
			flush: () => app._write(edgePatch("link1", { label: "friends" }),
				{ label: "changing a line" }),
		};

		await app._stepHistory("back");
		// The caption landed first, so it is the caption -- the reader's LAST change -- that came
		// back off, and the portrait stayed where they had just put it.
		expect(readGraph(page).edges.link1.label).toBe("exes");
		expect(readGraph(page).nodes.elena.x).toBe(80);
	});

	it("refuses a reader who may only look", async () => {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		entry.isOwner = false;
		const { app } = windowFor(null, { entry, pageId: "p1" });
		expect(await app._stepHistory("back")).toBe(false);
		expect(page.updates).toEqual([]);
	});
});

describe("Ctrl+Z on the relationship map", () => {
	beforeEach(() => forgetAllHistory());
	afterEach(() => forgetAllHistory());

	/** A keystroke, with only the surface the handler touches. */
	const stroke = (over = {}) => ({
		ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "z",
		target: { closest: () => null },
		prevented: false, stopped: false,
		preventDefault() { this.prevented = true; },
		stopPropagation() { this.stopped = true; },
		...over,
	});

	function ready() {
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		const made = windowFor(null, { entry, pageId: "p1" });
		made.app._stepHistory = vi.fn();
		return { ...made, page };
	}

	it("takes a change back, and puts one forward on Shift", () => {
		const { app } = ready();
		app._onHistoryKey(stroke());
		expect(app._stepHistory).toHaveBeenCalledWith("back");
		app._onHistoryKey(stroke({ shiftKey: true }));
		expect(app._stepHistory).toHaveBeenLastCalledWith("forward");
		// Ctrl+Y as well, which is what a reader coming from a Windows drawing program presses.
		app._onHistoryKey(stroke({ key: "y" }));
		expect(app._stepHistory).toHaveBeenLastCalledWith("forward");
	});

	// ⚠ THE ONE THIS HANDLER EXISTS TO GET RIGHT. The tie bar carries a caption box inside this
	// window, and Ctrl+Z in a text field is the browser undoing what the reader is TYPING. Taken
	// here, somebody fixing a typo would silently take back a change to the shared board instead --
	// and would have no way of telling that was what happened.
	it("never takes the keystroke out from under a text field", () => {
		const { app } = ready();
		const ev = stroke({ target: { closest: sel => (sel.includes("input") ? {} : null) } });
		app._onHistoryKey(ev);
		expect(app._stepHistory).not.toHaveBeenCalled();
		expect(ev.prevented).toBe(false);
	});

	it("leaves an ordinary keystroke alone", () => {
		const { app } = ready();
		app._onHistoryKey(stroke({ ctrlKey: false }));
		app._onHistoryKey(stroke({ key: "a" }));
		app._onHistoryKey(stroke({ altKey: true }));
		expect(app._stepHistory).not.toHaveBeenCalled();
	});

	// Unhandled, it reaches core's own keybindings, which is core's undo of the last canvas
	// operation -- a scene edit the reader never asked to take back.
	it("stops the keystroke it has taken from going any further", () => {
		const { app } = ready();
		const ev = stroke();
		app._onHistoryKey(ev);
		expect(ev.prevented).toBe(true);
		expect(ev.stopped).toBe(true);
	});

	it("leaves it alone for a reader who may only look", () => {
		const { entry } = ONE_LIVING_BOARD();
		entry.isOwner = false;
		const { app } = windowFor(null, { entry, pageId: "p1" });
		app._stepHistory = vi.fn();
		app._onHistoryKey(stroke());
		expect(app._stepHistory).not.toHaveBeenCalled();
	});
});

// ── Which boards the players may look at ────────────────────────────────────────────────────────
//
// Every board starts hidden from the players and is shown one at a time with the eye beside the
// pen. Two halves under test here: what the GM's window says and does, and what a player's window
// is left with when a board is not theirs.
describe("hiding a board from the players", () => {
	/** A GM at the keyboard. `canHideMapPages` asks nothing else. */
	const asGM = () => { globalThis.game.user = { id: "gm1", isGM: true }; };
	/** A player who owns the map, which every player at this table does. */
	const asPlayer = () => { globalThis.game.user = { id: "u1", isGM: false }; };

	const MIXED = () => pagedEntry([
		{ id: "p1", name: "Stonetop", graph: TWO_PEOPLE },
		{ id: "p2", name: "Marshedge", graph: EMPTY_BOARD, hidden: true },
	]);

	// THE GM SEES THE LOT AND THE PLAYERS SEE WHAT THEY HAVE BEEN SHOWN, which is the whole feature
	// and the thing every other answer in the window is derived from.
	it("keeps a hidden board out of a player's strip and leaves the GM's whole", () => {
		asPlayer();
		expect(windowFor(null, { entry: MIXED() }).app.mapPages.map(p => p.id)).toEqual(["p1"]);
		asGM();
		expect(windowFor(null, { entry: MIXED() }).app.mapPages.map(p => p.id)).toEqual(["p1", "p2"]);
	});

	// A player pointed at a board that has since been hidden falls through to one they may see,
	// exactly as they would if it had been deleted. Never to the hidden one.
	it("moves a player off a board that is not theirs", () => {
		asPlayer();
		const { app } = windowFor(null, { entry: MIXED(), pageId: "p2" });
		expect(app.mapPage.id).toBe("p1");
		expect(app.boardDoc.id).toBe("p1");
	});

	// ⚠ THE STATE WORTH GETTING RIGHT. A player owns the map entry, so without this they would have
	// every tool enabled over `boardDoc`, which with no page to resolve to is the ENTRY, and every
	// person they added would go into a flag that is drawn nowhere.
	it("gives a player with no board of their own nothing to write to", () => {
		asPlayer();
		const { app } = windowFor(null, {
			entry: pagedEntry([{ id: "p1", name: "Stonetop", hidden: true }]),
		});
		expect(app.noBoardForMe).toBe(true);
		expect(app.canEdit).toBe(false);
	});

	// AND SAYS SO IN ITS OWN WORDS. "Nobody is on this map yet" would read as a map that is theirs
	// to fill in, which is the opposite of what has happened.
	it("tells that player what they are looking at instead", () => {
		asPlayer();
		const { app } = windowFor(null, {
			entry: pagedEntry([{ id: "p1", name: "Stonetop", hidden: true }]),
		});
		const said = app._chrome(app._plan());
		expect(said.empty).toBe(true);
		expect(said.emptyLead).toBe("stonetop.relmap.unsharedLead");
		expect(said.emptyHint).toBe("stonetop.relmap.unsharedHint");
		expect(said.emptyAction).toBeNull();
	});

	// A map still on version 1 has no pages at all and keeps its board on the entry, which is a
	// perfectly editable board and must not be mistaken for a map with nothing shared on it.
	it("does not mistake a map that has no pages yet for one that is all hidden", () => {
		asPlayer();
		const { app } = windowFor();
		expect(app.noBoardForMe).toBe(false);
		expect(app.canEdit).toBe(true);
	});

	// THE GLYPH IS THE STATE AND THE HINT IS THE OUTCOME, which is the only pairing that reads
	// correctly on a control that is both.
	it("shows an open eye on a shown board and a struck one on a hidden board", () => {
		asGM();
		const entry = MIXED();
		const shown = windowFor(null, { entry, pageId: "p1" }).app._seenTool();
		expect(shown.pageHidden).toBe(false);
		expect(shown.pageHideIcon).toBe("fa-eye");
		expect(shown.pageHideHint).toBe("stonetop.relmap.pages.hideHint");
		const dark = windowFor(null, { entry, pageId: "p2" }).app._seenTool();
		expect(dark.pageHidden).toBe(true);
		expect(dark.pageHideIcon).toBe("fa-eye-slash");
		expect(dark.pageHideHint).toBe("stonetop.relmap.pages.showHint");
	});

	// Only a GM: core's own sanitizer refuses an ownership change from anybody else, so the button
	// offered to a player would be a button that throws on the server.
	it("offers the eye to a GM and to nobody else", () => {
		asGM();
		expect(windowFor(null, { entry: MIXED(), pageId: "p1" }).app._seenTool().pageHideOn).toBe(true);
		asPlayer();
		expect(windowFor(null, { entry: MIXED(), pageId: "p1" }).app._seenTool().pageHideOn).toBe(false);
	});

	it("hides the board that is up, and says so", async () => {
		asGM();
		const { app, entry, live } = windowFor(null, { entry: MIXED(), pageId: "p1" });
		await app._hidePage();
		expect(entry.pages.contents[0].updates).toEqual([{ ownership: { default: 0 } }]);
		expect(live.textContent).toBe("stonetop.relmap.pages.hidden");
	});

	// The same button the other way, which is the half a GM presses when the table is ready for it.
	// INHERIT and not OBSERVER: the map is owned by everybody, so a board that inherits is one the
	// players may move people on, which is most of the point of showing it to them.
	it("shows it again, and hands the right to edit it back with it", async () => {
		asGM();
		const { app, entry, live } = windowFor(null, { entry: MIXED(), pageId: "p2" });
		await app._hidePage();
		expect(entry.pages.contents[1].updates).toEqual([{ ownership: { default: -1 } }]);
		expect(live.textContent).toBe("stonetop.relmap.pages.shown");
	});

	it("writes nothing at all for a reader who may not hide one", async () => {
		asPlayer();
		const { app, entry } = windowFor(null, { entry: MIXED(), pageId: "p1" });
		await app._hidePage();
		expect(entry.pages.contents[0].updates).toEqual([]);
	});

	// ⚠ A TAB SAYS THE BOARD'S NAME AND NOTHING ELSE. It briefly carried an eye in front of the names
	// of the boards the players could see, and that was one mark too many on the one row whose whole
	// job is to say which board is UP. Where a board stands is the eye in the tools beside the
	// strip, which is one place and not eight.
	it("puts no mark of its own on any tab", () => {
		asGM();
		const tabs = windowFor(null, { entry: MIXED(), pageId: "p1" }).app._pageTabs();
		expect(tabs).not.toContain("<i");
		expect(tabs).not.toContain("is-shared");
		expect(tabs).toContain(">Stonetop<");
		expect(tabs).toContain(">Marshedge<");
	});

	// ⚠ WHICH IS EXACTLY WHY THE EYE IS WRITTEN AHEAD OF `_paintPages`'s GUARD. That guard compares
	// the strip's markup, and with no mark on any tab, hiding the board this reader is standing on
	// changes NOTHING in that string: under the guard the glyph would go on saying "the table can
	// see this" over a board the GM had just taken back. The board is hidden here without touching
	// its name or the set of pages, so the strip is byte-for-byte what it was.
	it("writes the eye again when a board is hidden under an open window", () => {
		asGM();
		const entry = MIXED();
		const { app, seenTool } = windowFor(null, { entry, pageId: "p1" });
		app._paintPages();
		expect(seenTool.hidden).toBe(false);
		expect(seenTool.children["i"].className).toBe("fas fa-eye");
		expect(seenTool.dataset.tooltip).toBe("stonetop.relmap.pages.hideHint");
		expect(seenTool.attrs["aria-label"]).toBe("stonetop.relmap.pages.hideHint");

		const strip = app._pagesSaid;
		entry.pages.contents[0].ownership = { default: 0 };
		app._paintPages();
		expect(app._pageTabs()).toBe(strip);
		expect(seenTool.children["i"].className).toBe("fas fa-eye-slash");
		expect(seenTool.dataset.tooltip).toBe("stonetop.relmap.pages.showHint");
		expect(seenTool.classList.contains("is-hidden-board")).toBe(true);
	});

	// The button is in the markup on every map and hidden when it does not apply, for the reason the
	// trash beside it is: behind a condition it would exist only on the maps that already had a
	// board when the window last rendered.
	it("takes the eye away from a reader who may not use it", () => {
		asPlayer();
		const { app, seenTool } = windowFor(null, { entry: MIXED(), pageId: "p1" });
		app._paintPages();
		expect(seenTool.hidden).toBe(true);
	});

	// ⚠ A REVEAL IS AS MUCH A RENDER AS A HIDE, and asking "was this a hide of the board they are
	// standing on" was the wrong question. `_paintPages` can only rewrite a strip that is already
	// there, and the two readers with no strip are exactly the ones a reveal is for: a player on a
	// map whose every board is still the GM's own has neither strip nor board, and a player with a
	// single visible board has no strip either (`showPages` is `canEdit || pages.length > 1`). So
	// the GM presses the eye and the first goes on saying "there is nothing here for you to see
	// yet" while the second never sees the new tab — until they close the window and open it again.
	//
	// The question is therefore asked in the two terms the render is built from: has the BOARD
	// under this reader changed, or has the strip's being there at all?
	describe("and showing one again", () => {
		function hooksOf() {
			const on = new Map();
			globalThis.Hooks = { on: (name, fn) => on.set(name, fn), off: vi.fn() };
			return on;
		}

		/** A render that emitted no strip, which is what `showPages: false` produces. */
		const withNoStrip = made => { delete made.root.children[".stonetop-relmap-pages-strip"]; return made; };

		const SHOW = { ownership: { default: -1 } };

		it("renders again for a player who had no board at all until now", () => {
			asPlayer();
			const on = hooksOf();
			const entry = pagedEntry([{ id: "p1", name: "Stonetop", hidden: true }]);
			const { app } = withNoStrip(windowFor(null, { entry }));
			app._wireSync();
			expect(app.noBoardForMe).toBe(true);

			entry.pages.contents[0].ownership = { default: -1 };
			on.get("updateJournalEntryPage")(entry.pages.contents[0], SHOW);
			expect(app.render).toHaveBeenCalled();
			expect(app.noBoardForMe).toBe(false);
		});

		// The second reader with no strip: one board, so there was nothing to choose between. A
		// second one arriving is the moment the strip has to exist, and no repaint can make it.
		it("renders again when a second board turns the strip on", () => {
			asPlayer();
			const on = hooksOf();
			const entry = MIXED();
			const { app } = withNoStrip(windowFor(null, { entry, pageId: "p1" }));
			app._wireSync();
			expect(app.mapPages.map(page => page.id)).toEqual(["p1"]);

			entry.pages.contents[1].ownership = { default: -1 };
			on.get("updateJournalEntryPage")(entry.pages.contents[1], SHOW);
			expect(app.render).toHaveBeenCalled();
			// AND THEY STAY WHERE THEY WERE. The board under them did not change, so the render is
			// about the strip appearing over it and nothing else.
			expect(app._pageId).toBe("p1");
		});

		// The GM's own window, where the eye was pressed. Their strip has every board on it either
		// way and the board under them is untouched, so this is the repaint case — which is what
		// makes the eye's own glyph the thing that has to change. See `_paintSeen`.
		it("only writes the eye again on the window that pressed it", () => {
			asGM();
			const on = hooksOf();
			const entry = MIXED();
			const { app, seenTool } = windowFor(null, { entry, pageId: "p1" });
			app._wireSync();

			entry.pages.contents[1].ownership = { default: -1 };
			on.get("updateJournalEntryPage")(entry.pages.contents[1], SHOW);
			expect(app.render).not.toHaveBeenCalled();
			expect(seenTool.children["i"].className).toBe("fas fa-eye");
		});

		// The half that already worked, kept here beside its mirror image so that a change which
		// quietly broke one of them fails as a DIFFERENCE rather than as one test nobody re-read.
		it("still moves a player off a board taken back from them, and re-renders", () => {
			asPlayer();
			const on = hooksOf();
			const entry = pagedEntry([
				{ id: "p1", name: "Stonetop", graph: TWO_PEOPLE },
				{ id: "p2", name: "Marshedge", graph: EMPTY_BOARD },
			]);
			const { app } = windowFor(null, { entry, pageId: "p1" });
			app._wireSync();
			app._lit = "e1";

			entry.pages.contents[0].ownership = { default: 0 };
			on.get("updateJournalEntryPage")(entry.pages.contents[0], { ownership: { default: 0 } });
			expect(app.render).toHaveBeenCalled();
			expect(app._pageId).toBeNull();
			expect(app._lit).toBeNull();
			expect(app.mapPage.id).toBe("p2");
		});

		// A strip appearing over the SAME board is not a reason to put out the line this reader was
		// holding: they have not been moved anywhere, and the bar is about their own board.
		it("keeps the line a reader is holding when only the strip has changed", () => {
			asPlayer();
			const on = hooksOf();
			const entry = MIXED();
			const { app } = withNoStrip(windowFor(null, { entry, pageId: "p1" }));
			app._wireSync();
			app._lit = "e1";

			entry.pages.contents[1].ownership = { default: -1 };
			on.get("updateJournalEntryPage")(entry.pages.contents[1], SHOW);
			expect(app.render).toHaveBeenCalled();
			expect(app._lit).toBe("e1");
		});

		// `rendered` is false for a CLOSED window as well as a mid-render one, and a render from
		// here would reopen a board the reader had shut a moment before the GM pressed the eye.
		it("renders nothing from a window that is not on screen", () => {
			asPlayer();
			const on = hooksOf();
			const entry = pagedEntry([{ id: "p1", name: "Stonetop", hidden: true }]);
			const { app } = withNoStrip(windowFor(null, { entry }));
			app.rendered = false;
			app._wireSync();

			entry.pages.contents[0].ownership = { default: -1 };
			on.get("updateJournalEntryPage")(entry.pages.contents[0], SHOW);
			expect(app.render).not.toHaveBeenCalled();
		});
	});
});

// ── A board the players can see is a board they can work on ─────────────────────────────────────
//
// ⚠ THE HALF OF THE FEATURE THAT IS EASY TO GET WRONG, and the reason "shown" is spelt `INHERIT`
// rather than `OBSERVER`. Hiding a board must not be a way of quietly making the whole map
// read-only: the moment the GM shows a board, everybody at the table can put people on it, move
// them and draw between them, exactly as the GM can. What makes that true is that a shown board
// takes the MAP's ownership, and a map is owned by everybody (`createRelationshipMap`).
describe("what a player may do on a board that has been shown to them", () => {
	const asGM = () => { globalThis.game.user = { id: "gm1", isGM: true }; };
	const asPlayer = () => { globalThis.game.user = { id: "u1", isGM: false }; };

	const SOMEBODY = { uuid: "Actor.jaspar", name: "Jaspar", img: "jaspar.webp" };

	// THE SERVER'S OWN ANSWER, which is the one that actually decides: a page write is checked
	// against the PAGE. A shown board defers to the map, and the map is everybody's.
	it("makes the player an owner of the board itself, and not merely of the map", () => {
		asPlayer();
		const { entry, pages: [page] } = ONE_LIVING_BOARD();
		expect(page.testUserPermission(game.user, "OWNER")).toBe(true);
		expect(page.isOwner).toBe(true);
		expect(entry.isOwner).toBe(true);
	});

	it("lets them put somebody on it, and the person lands on that board", async () => {
		asPlayer();
		const { pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry: page.parent, pageId: "p1" });
		expect(app.canEdit).toBe(true);
		await app._addNodeFor(SOMEBODY, { left: 40, top: 60 });
		const added = Object.values(readGraph(page).nodes).find(node => node.uuid === "Actor.jaspar");
		expect(added).toBeTruthy();
		expect([added.x, added.y]).toEqual([40, 60]);
	});

	// The same board, the same write, from the other side of the table. Named so a change that
	// quietly made the board GM-only would fail as a DIFFERENCE between the two rather than as two
	// separate tests that might both be adjusted together.
	it("lets the GM do exactly the same thing, and no more", async () => {
		const seatedBy = async () => {
			const { pages: [page] } = ONE_LIVING_BOARD();
			const { app } = windowFor(null, { entry: page.parent, pageId: "p1" });
			const could = app.canEdit;
			await app._addNodeFor(SOMEBODY, { left: 40, top: 60 });
			return { could, nodes: Object.keys(readGraph(page).nodes).length };
		};
		asPlayer();
		const player = await seatedBy();
		asGM();
		expect(await seatedBy()).toEqual(player);
	});

	// And moving people about, which is the other half of "working on a board".
	it("lets them move somebody already on it", async () => {
		asPlayer();
		const { pages: [page] } = ONE_LIVING_BOARD();
		const { app } = windowFor(null, { entry: page.parent, pageId: "p1" });
		await app._moveNode("elena", { x: 80, y: 90 });
		expect(readGraph(page).nodes.elena.x).toBe(80);
	});

	// ⚠ ASKED OF THE BOARD AND NOT OF THE MAP. The two agree on every board this window makes, and
	// part company the moment a GM reaches past it for core's own ownership dialog on a page. There
	// the honest answer is a board that reads read-only, because the server will refuse the write
	// whatever this window lets somebody click.
	it("reads a board somebody has hand-set to look-only as read-only", () => {
		asPlayer();
		const { pages: [page] } = ONE_LIVING_BOARD();
		page.ownership = { default: 2 };
		const { app } = windowFor(null, { entry: page.parent, pageId: "p1" });
		expect(app.mapPage.id).toBe("p1");
		expect(app.canEdit).toBe(false);
		// The map is still theirs, which is exactly the difference this is here to hold on to.
		expect(app.entry.isOwner).toBe(true);
	});

	// A map still on version 1 keeps its whole board on the ENTRY and has no page to ask, and it is
	// editable by everybody who owns the map. It must not be swept up by the rule above.
	it("still lets a player edit a map that has no pages yet", () => {
		asPlayer();
		expect(windowFor().app.canEdit).toBe(true);
	});
});
