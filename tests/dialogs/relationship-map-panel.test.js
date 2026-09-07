import { describe, it, expect, vi } from "vitest";

// THE FIVE LINES THAT MAKE THE BOARD A TAB BODY, and every one of them is load-bearing in a way
// that fails quietly rather than loudly.
//
// The panel is the relationship map's own window class with `popOut` off, which is AppV1's built-in
// way to be a body with no frame. That is why there is no second template here, no second wiring
// module and nothing to keep in step: `getData`, `activateListeners`, the pan/zoom surface, the tie
// bar, the five journal hooks and `close` are all the window's, unchanged. What this suite pins is
// the handful of overrides that make the arrangement safe.
//
// The base class is stubbed. Importing the real one drags in the whole map for no gain: what is
// being asked here is only what the SUBCLASS does, and mocking the base is what lets each override
// be observed rather than inferred.

const closed = [];
class FakeWindow {
	static get defaultOptions() {
		return {
			classes: ["stonetop", "stonetop-relmap-app"],
			template: "systems/stonetop-pwd/templates/dialogs/relationship-map.hbs",
			width: 900,
			height: 800,
			// The window is resizable; the panel must turn that off, and this is what it turns off.
			resizable: true,
		};
	}

	constructor(entry, options = {}) {
		this.entry = entry;
		this.options = options;
		this._element = null;
	}

	// The window's own context, trimmed to two keys. What matters is only that the panel adds to
	// it rather than replacing it: the board, the page strip and every label in the footer are
	// the window's business and must survive the override.
	async getData() { return { canEdit: true, board: "<board/>" }; }

	async close(options) { closed.push(options); }
}
vi.mock("../../module/dialogs/RelationshipMapWindow.js", () => ({ RelationshipMapWindow: FakeWindow }));

const { RelationshipMapPanel } = await import("../../module/dialogs/RelationshipMapPanel.js");

/** The smallest host these paths touch. */
function makeHost() {
	return {
		children: [],
		replaceChildren(...kids) { this.children = kids; },
	};
}

describe("the board knows it has no frame", () => {
	it("is not a pop-out, so core builds no window around it", () => {
		// With this off, `_render` skips `_renderOuter` entirely and hands the inner HTML straight
		// to `_injectHTML`; the app is never entered in `ui.windows`; minimize and maximize become
		// no-ops. All of that is core's, not ours.
		expect(RelationshipMapPanel.defaultOptions.popOut).toBe(false);
	});

	it("is not resizable, which is the half of it that is easy to forget", () => {
		// ⚠ TWO THINGS HANG OFF THIS, and leaving it merely unstated inherits the window's `true`.
		// A non-popOut application with `resizable` set gets a `Draggable` bound to it by core --
		// a resize handle on a tab body, moving nothing -- and `setPosition` only returns early
		// when BOTH are false, so without it every render would run core's window-positioning
		// arithmetic against an element that is a grid child.
		expect(RelationshipMapPanel.defaultOptions.resizable).toBe(false);
	});

	it("keeps every class the window wears and adds its own", () => {
		// The stylesheet paints the board off `.stonetop-relmap*` on the markup itself, so nothing
		// here is what makes it look right. The classes matter for the things that read a FRAME:
		// `stonetop` is what utils/resizable-dialogs.js checks before touching setPosition.
		const { classes } = RelationshipMapPanel.defaultOptions;
		expect(classes).toContain("stonetop");
		expect(classes).toContain("stonetop-relmap-app");
		expect(classes).toContain("stonetop-relmap-panel");
	});

	it("is a subclass, which is what makes it the same board", () => {
		// And also why utils/window-restore.js has to refuse a non-popOut app: AppV1 builds its
		// render hook out of every class name in the chain, so this fires the window's hook too.
		expect(Object.getPrototypeOf(RelationshipMapPanel)).toBe(FakeWindow);
	});
});

describe("the one control that exists only here", () => {
	it("asks the shared template for the pop-out, with its words", async () => {
		// The button is declared once, in the map's own footer, and turned on from this side. The
		// window leaves `canPopOut` unset and so never draws it.
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost());
		const context = await panel.getData();
		expect(context.canPopOut).toBe(true);
		// ONE string. The control is a glyph in the board's corner with no words on it, so this is
		// both what it is called and what its tooltip says.
		expect(context.popOutLabel).toBe("Open this board in a window");
		expect(context.popOutHint).toBeUndefined();
	});

	it("keeps everything the window's own context carried", async () => {
		// Spread over `super.getData()`, not replacing it: the board, the page strip and every
		// label in the footer come from there.
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost());
		expect(await panel.getData()).toMatchObject({ canEdit: true, board: "<board/>" });
	});
});

describe("where it paints", () => {
	it("paints into the host it was handed, not into document.body", () => {
		const host = makeHost();
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, host);
		const node = { tag: "board" };
		panel._injectHTML([node]);
		expect(host.children).toEqual([node]);
		expect(panel._element).toEqual([node]);
	});

	it("replaces what the mount held, so a board never lands beside the invitation", () => {
		const host = makeHost();
		host.children = [{ tag: "invitation" }];
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, host);
		panel._injectHTML([{ tag: "board" }]);
		expect(host.children).toEqual([{ tag: "board" }]);
	});

	it("can be re-pointed at the mount a later render built", () => {
		// The host sheet rebuilds its whole body on every render. A board painted into the host it
		// was given three renders ago is painted into a node nothing is looking at.
		const first = makeHost();
		const second = makeHost();
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, first);
		panel.setHost(second);
		panel._injectHTML([{ tag: "board" }]);
		expect(first.children).toEqual([]);
		expect(second.children).toEqual([{ tag: "board" }]);
	});

	it("paints nothing at all when there is nothing to paint into", () => {
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, null);
		expect(() => panel._injectHTML([{ tag: "board" }])).not.toThrow();
	});
});

describe("what it refuses to do", () => {
	it("never raises itself over the sheet it is inside", () => {
		// `StonetopDialog._render` runs FrontOnOpen on every open, whose whole job is bringToTop.
		// Core's version stamps a z-index on the element and claims `ui.activeWindow`; on a board
		// inside a sheet that puts a stacking context on a grid child and tells the rest of Foundry
		// the active window is something with no frame.
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost());
		expect(panel.bringToTop()).toBeUndefined();
	});
});

describe("closing", () => {
	it("never animates, because there is no window to watch fold up", () => {
		closed.length = 0;
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost());
		panel.close();
		expect(closed).toEqual([{ animate: false }]);
	});

	it("keeps the caller's other options while forcing that one", () => {
		closed.length = 0;
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost());
		panel.close({ force: true, animate: true });
		expect(closed).toEqual([{ force: true, animate: false }]);
	});

	it("tells its host, ONCE, so the tab can be put back the way the world now is", async () => {
		// The map can be deleted at the far end of the table, and the board closes itself on its
		// own `deleteJournalEntry` hook. Nothing else would tell the sheet.
		const told = [];
		const panel = new RelationshipMapPanel({ id: "map1" }, {}, makeHost(), one => told.push(one));
		await panel.close();
		await panel.close();
		expect(told).toEqual([panel]);
	});
});
