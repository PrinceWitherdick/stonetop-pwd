import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// THE RELATIONSHIP MAP TAB'S LIFECYCLE, which is the whole of what this feature adds. The board
// itself is the window's own class mounted frameless (dialogs/RelationshipMapPanel.js), so nothing
// about drawing, dragging or syncing a map is this suite's business; what is, is the four moments
// where a sheet and a long-lived board meet, and every one of them fails quietly:
//
//  • a reader who never opens the tab must not pay for the board (it walks every person and line,
//    registers five global hooks, and on its first render seats the party and the village);
//  • a sheet re-render must MOVE the same board rather than rebuild it, or the reader loses the
//    corner of the map they were zoomed into every time anything writes to the steading;
//  • a sheet that closes must close the board, or its five global hooks fire on every journal
//    write at the table for the rest of the session;
//  • a world with no map at all must offer to make one, to the people who may.
//
// Runs in node with no jsdom, like the window's own suite, so the DOM is a hand-rolled stand-in
// for the three calls these paths actually make.

// ── The board, stubbed. What it DOES is tested next door; what matters here is when it is built,
// where it is pointed and when it is closed.
const built = [];
// The renders being held mid-flight, and the switch that holds them. See `render` below.
const pending = [];
const slow = { on: false };
/** Let every held render land, in the order they were asked for. */
const settle = () => { for (const panel of pending.splice(0)) panel.paint(); };
class FakePanel {
	constructor(entry, options, host, onClosed) {
		this.entry = entry;
		this.options = options;
		this.host = host;
		this.onClosed = onClosed;
		this.rendered = false;
		this.closed = 0;
		this.element = null;
		built.push(this);
	}

	render() {
		this.rendered = true;
		// ⚠ AND NOT ALWAYS AT ONCE. The real panel's FIRST render awaits `_ensurePage()` -- document
		// creates, for the map's first page and for the party and village boards it seeds -- before
		// core sets `_element`, so there is a stretch after `render()` returns during which the
		// panel exists and has no element. `slow` is that stretch, held open until `settle()`.
		if (slow.on) { pending.push(this); return this; }
		this.paint();
		return this;
	}

	/** The real panel paints into its host and keeps the element; the fake does the same, so that
	 *  "the same element, moved" is a thing this suite can actually observe. */
	paint() {
		this.element = [makeNode()];
		this.host?.replaceChildren(this.element[0]);
	}

	setHost(host) { this.host = host; }
	async close() { this.closed += 1; this.onClosed?.(this); }
}
vi.mock("../../../module/dialogs/RelationshipMapPanel.js", () => ({ RelationshipMapPanel: FakePanel }));

const world = { maps: [], canCreate: true, made: null, typed: "The Millers" };
vi.mock("../../../module/relmap/relmap-doc.js", () => ({
	hasRelationshipMap: () => world.maps.length > 0,
	canCreateRelationshipMap: () => world.canCreate,
}));

// ⚠ THE INVITATION ASKS FOR A NAME, and this fake is that question rather than a create. `typed`
// is what the reader puts in the box; null is the box dismissed, and is also what somebody who may
// not make a map gets without being asked anything. See relmap/relmap-make.js, which is where the
// question and the fallback for an empty name actually live -- what this suite is about is only
// what the tab does with the answer.
vi.mock("../../../module/relmap/relmap-make.js", () => ({
	promptForNewRelationshipMap: () => {
		if (!world.canCreate || world.typed === null) return Promise.resolve(null);
		world.made = { id: "made", name: world.typed };
		world.maps = [world.made];
		return Promise.resolve(world.made);
	},
}));

const landing = { value: null };
vi.mock("../../../module/relmap/relmap-last.js", () => ({ defaultBoard: () => landing.value }));

const {
	closeRelmapTab, detachRelmapTab, makeFirstRelationshipMap,
	relmapTabContext, STEADING_RELMAP_TAB, syncRelmapTab,
} = await import("../../../module/actors/steading/steading-relmap-tab.js");

// ── The smallest DOM these paths touch: a mount that can hold children, and a root that can find
// it. Nothing here pretends to be more than the three calls the module makes.
function makeNode() {
	return {
		children: [],
		parent: null,
		replaceChildren(...kids) {
			for (const kid of this.children) kid.parent = null;
			this.children = kids;
			for (const kid of kids) kid.parent = this;
		},
		remove() {
			if (this.parent) this.parent.children = this.parent.children.filter(kid => kid !== this);
			this.parent = null;
		},
	};
}

/** A sheet root that carries the map tab's mount, or (classic layout) does not. */
function makeRoot({ mounted = true } = {}) {
	const mount = mounted ? makeNode() : null;
	return {
		mount,
		querySelector: sel => (sel === "[data-steading-relmap]" ? mount : null),
	};
}

function makeSheet({ tab = STEADING_RELMAP_TAB } = {}) {
	return {
		actor: { id: "steading1" },
		rendered: true,
		renders: 0,
		render() { this.renders += 1; },
		_tabs: [{ active: tab }],
		_relmapPanel: null,
	};
}

beforeEach(() => {
	built.length = 0;
	pending.length = 0;
	slow.on = false;
	world.maps = [{ id: "map1", name: "Stonetop" }];
	world.canCreate = true;
	world.made = null;
	world.typed = "The Millers";
	landing.value = { entry: world.maps[0], pageId: "page7" };
});

describe("what the tab knows before there is a board", () => {
	it("reports a world that has a map", () => {
		expect(relmapTabContext().hasMap).toBe(true);
	});

	it("reports a world that has none, and who may make one", () => {
		world.maps = [];
		expect(relmapTabContext()).toMatchObject({ hasMap: false, canCreate: true });
		world.canCreate = false;
		expect(relmapTabContext()).toMatchObject({ hasMap: false, canCreate: false });
	});
});

describe("nothing is built for a reader who never opens the tab", () => {
	it("builds nothing while another tab is up", () => {
		const sheet = makeSheet({ tab: "overview" });
		syncRelmapTab(sheet, makeRoot());
		expect(built).toHaveLength(0);
		expect(sheet._relmapPanel).toBeNull();
	});

	it("builds the board the moment that tab is the one showing", () => {
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		expect(built).toHaveLength(1);
		expect(sheet._relmapPanel).toBe(built[0]);
		expect(built[0].rendered).toBe(true);
	});

	it("does nothing at all in the classic layout, which carries no such tab", () => {
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot({ mounted: false }));
		expect(built).toHaveLength(0);
	});
});

describe("which board it lands on", () => {
	it("opens the one this client last had open, page and all", () => {
		// `defaultBoard()` is the hotbar macro's own answer. Shared deliberately, so the tab and
		// the macro can never land somewhere different from each other.
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		expect(built[0].entry).toBe(world.maps[0]);
		expect(built[0].options.pageId).toBe("page7");
	});

	it("passes no page at all when the landing board names none", () => {
		// An absent `pageId` means "whichever board comes first", and the window reads a key that
		// is missing differently from one that is there and undefined.
		landing.value = { entry: world.maps[0], pageId: null };
		syncRelmapTab(makeSheet(), makeRoot());
		expect("pageId" in built[0].options).toBe(false);
	});

	it("is identified per SHEET, not per map, so two steadings do not share one element", () => {
		syncRelmapTab(makeSheet(), makeRoot());
		expect(built[0].options.id).toBe("stonetop-relmap-panel-steading1");
	});

	it("builds nothing when the world has no maps, leaving the invitation standing", () => {
		landing.value = null;
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		expect(built).toHaveLength(0);
		expect(sheet._relmapPanel).toBeNull();
	});
});

describe("a sheet re-render moves the board rather than rebuilding it", () => {
	it("carries the same element into the tab the new render built", () => {
		const sheet = makeSheet();
		const first = makeRoot();
		syncRelmapTab(sheet, first);
		const board = sheet._relmapPanel.element[0];
		expect(first.mount.children).toEqual([board]);

		// What `_render` does before `super._render` throws the old body away.
		detachRelmapTab(sheet);
		expect(first.mount.children).toEqual([]);

		// ...and what `activateListeners` does once the new body is there.
		const second = makeRoot();
		syncRelmapTab(sheet, second);
		expect(built).toHaveLength(1);
		expect(second.mount.children).toEqual([board]);
		expect(sheet._relmapPanel.element[0]).toBe(board);
	});

	it("re-points the board at the mount this render built", () => {
		// A board painted into the host it was handed three renders ago is painted into a node
		// nothing is looking at. Only a later render of the board itself would show it.
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		detachRelmapTab(sheet);
		const second = makeRoot();
		syncRelmapTab(sheet, second);
		expect(sheet._relmapPanel.host).toBe(second.mount);
	});

	it("moves the board even onto a tab that is not the one showing", () => {
		// The reader switched to Overview; the board is still theirs and still live, and it has to
		// travel with the sheet or the next visit finds an empty tab.
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		detachRelmapTab(sheet);
		sheet._tabs[0].active = "overview";
		const second = makeRoot();
		syncRelmapTab(sheet, second);
		expect(second.mount.children).toHaveLength(1);
		expect(built).toHaveLength(1);
	});

	it("detaching a sheet that never opened the tab is not an error", () => {
		expect(() => detachRelmapTab(makeSheet())).not.toThrow();
	});
});

// ⚠ A PANEL WITH NO ELEMENT YET IS STILL A PANEL. The board's first render awaits document writes
// -- the map's first page, and the party and village boards it seeds -- so for a stretch after it
// is asked for there is a panel on the sheet whose `element` is empty. Asking `element` rather
// than the sheet's own field therefore answered "no board here" to a question that meant "is one
// already coming", and the second answer built a second board over the top of the first: five
// global journal hooks that only `closeRelmapTab` takes off, on an instance the sheet no longer
// holds and so never closes, repainting a detached tree for the rest of the session -- and, since
// the seeding is remembered per instance, a second run of it that can leave the map wearing two
// boards called "The Party".
describe("a board still being built is not a board that is missing", () => {
	it("builds no second one while the first render is still in flight", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		expect(built).toHaveLength(1);
		// Away and back again before the render lands, which is one sheet re-render apart.
		detachRelmapTab(sheet);
		syncRelmapTab(sheet, makeRoot());
		expect(built).toHaveLength(1);
		expect(sheet._relmapPanel).toBe(built[0]);
	});

	it("lands the board in the mount the LAST render built, not the one thrown away", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		detachRelmapTab(sheet);
		const second = makeRoot();
		syncRelmapTab(sheet, second);
		expect(sheet._relmapPanel.host).toBe(second.mount);
		settle();
		expect(second.mount.children).toEqual([sheet._relmapPanel.element[0]]);
	});

	it("leaves one board to close, so nothing is left holding the journal hooks", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		detachRelmapTab(sheet);
		syncRelmapTab(sheet, makeRoot());
		settle();
		closeRelmapTab(sheet);
		expect(built).toHaveLength(1);
		expect(built[0].closed).toBe(1);
	});

	// A hop to another tab is the same question with a different answer available, and the guard
	// sits ahead of the "is this tab even showing" one on purpose: the board is already being built
	// and has to be pointed at the mount this render made either way.
	it("re-points a board in flight even onto a tab that is not the one showing", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		detachRelmapTab(sheet);
		sheet._tabs[0].active = "overview";
		const second = makeRoot();
		syncRelmapTab(sheet, second);
		expect(built).toHaveLength(1);
		expect(sheet._relmapPanel.host).toBe(second.mount);
	});
});

describe("closing the sheet closes the board", () => {
	it("closes it, which is the only thing that takes its global hooks off", () => {
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		const panel = sheet._relmapPanel;
		closeRelmapTab(sheet);
		expect(panel.closed).toBe(1);
		expect(sheet._relmapPanel).toBeNull();
	});

	it("does not re-render the sheet it is closing", () => {
		// The panel tells its host when it closes, so that a map DELETED at the far end of the
		// table puts the tab back the way the world now is. That must not fire on the sheet's own
		// way out, which is why the field is cleared before the close.
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		const before = sheet.renders;
		closeRelmapTab(sheet);
		expect(sheet.renders).toBe(before);
	});

	it("is safe on a sheet that never built one", () => {
		const sheet = makeSheet();
		expect(() => closeRelmapTab(sheet)).not.toThrow();
	});
});

describe("the board closing itself", () => {
	it("puts the sheet back the way the world now is", () => {
		// The map was deleted by somebody else; the board closes on its own `deleteJournalEntry`
		// hook. The tab now has to show another map or the invitation, and only a render can tell.
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		const panel = sheet._relmapPanel;
		panel.close();
		expect(sheet._relmapPanel).toBeNull();
		expect(sheet.renders).toBe(1);
	});

	it("ignores a board the sheet has already let go of", () => {
		const sheet = makeSheet();
		syncRelmapTab(sheet, makeRoot());
		const stale = sheet._relmapPanel;
		sheet._relmapPanel = null;
		stale.onClosed(stale);
		expect(sheet.renders).toBe(0);
	});
});

// ⚠ "NO MAP ANY MORE" RATHER THAN "NO MAP YET". Every world is given one during setup
// (relmap/relmap-make.js), so a steading sheet reaching the invitation is one whose GM deleted
// that map -- which is the whole reason the button asks a question instead of minting a second
// "Stonetop" over the answer they just gave.
describe("a world whose map has been deleted", () => {
	beforeEach(() => {
		world.maps = [];
		landing.value = null;
	});

	it("makes the map the reader named, and not one named for us", async () => {
		const sheet = makeSheet();
		const made = await makeFirstRelationshipMap(sheet);
		expect(made).toBe(world.made);
		expect(made.name).toBe("The Millers");
	});

	it("re-renders the sheet, which is what mounts the board", async () => {
		const sheet = makeSheet();
		await makeFirstRelationshipMap(sheet);
		expect(sheet.renders).toBe(1);
	});

	// The box is a real decision and dismissing it is one of the answers. A sheet re-rendered on
	// the way out would repaint the invitation under somebody who has just declined it.
	it("makes nothing when the box is dismissed, and does not re-render", async () => {
		world.typed = null;
		const sheet = makeSheet();
		expect(await makeFirstRelationshipMap(sheet)).toBeNull();
		expect(sheet.renders).toBe(0);
	});

	it("makes nothing for somebody who may not, and does not re-render either", async () => {
		world.canCreate = false;
		const sheet = makeSheet();
		expect(await makeFirstRelationshipMap(sheet)).toBeNull();
		expect(sheet.renders).toBe(0);
	});
});

// ── The markup, and the joins between it and the module above ─────────────────────────────────
//
// Read as text, the way the rest of this repo's template checks are: the questions here are about
// what the partial DECLARES, and every one of them is a join that fails silently when it drifts.

const TAB_HBS = fs.readFileSync(
	path.resolve(HERE, "../../../templates/actor/partials/steading-tab-relmap.hbs"), "utf8");
const TAB_JS = fs.readFileSync(
	path.resolve(HERE, "../../../module/actors/steading/steading-relmap-tab.js"), "utf8");
const EN = JSON.parse(fs.readFileSync(path.resolve(HERE, "../../../languages/en.json"), "utf8"));

describe("the tab's markup", () => {
	it("is a panel of the sheet's own shape", () => {
		expect(TAB_HBS).toContain('<div class="tab relmap" data-group="primary" data-tab="relmap">');
		expect(TAB_HBS).toContain('<section class="sheet-tab steading-relmap" data-steading-relmap>');
	});

	// ⚠ CORE'S `.tab { display: none }` IS LAYERED, so any unlayered `display` on the panel itself
	// out-ranks it and the panel shows on EVERY tab of the sheet at once. That is why the height
	// chain lives on the inner section and in the stylesheet rather than here, and why this tab
	// needs no paired unlayered re-hide the way Notes does.
	it("sets no style of its own on the panel", () => {
		// Asked of the MARKUP, with the Handlebars comments stripped: the file explains this rule
		// at length and names the very declaration it is refusing.
		const markup = TAB_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		expect(markup).not.toMatch(/style=/);
		expect(markup).not.toMatch(/display\s*:/);
	});

	// The board is mounted by JS into an element the JS finds by attribute. Two spellings of one
	// selector is a tab that renders perfectly and stays empty forever, with nothing logged.
	it("names the mount the module looks for", () => {
		expect(TAB_JS).toContain('const MOUNT_SEL = "[data-steading-relmap]"');
		expect(TAB_HBS).toContain("data-steading-relmap>");
	});

	it("names the invitation's button the sheet binds", () => {
		expect(TAB_HBS).toContain("data-steading-relmap-make");
	});

	// The mount is left empty on purpose: `_injectHTML` replaces its children, and the board is
	// built lazily, so a placeholder here would either be wiped or sit beside a board.
	it("puts nothing in the mount but the invitation", () => {
		const inner = TAB_HBS.slice(TAB_HBS.indexOf("data-steading-relmap>"), TAB_HBS.indexOf("</section>"));
		expect(inner).toContain("{{#unless stonetop.relmap.hasMap}}");
		expect(inner.match(/<div /g) ?? []).toHaveLength(1);
	});

	// Making a map and editing one are different rights. The button is HIDDEN rather than
	// disabled, and the line that replaces it says who can.
	it("offers the button only to somebody who may make a map", () => {
		expect(TAB_HBS).toContain("{{#if stonetop.relmap.canCreate}}");
		expect(TAB_HBS).toContain("{{#unless stonetop.relmap.canCreate}}");
		expect(TAB_HBS).toContain('{{localize "stonetop.relmap.maps.cannotCreate"}}');
		// MAKING A MAP AND EDITING ONE ARE DIFFERENT RIGHTS, and the tab has to say so rather than
		// show a button that refuses. The wording is the same one the hotbar macro uses.
		expect(EN.stonetop.relmap.maps.cannotCreate).toContain("trusted-player role");
	});

	// House style for this sheet's templates: complementary guards, never `{{else}}`, so each
	// branch can be found and read on its own.
	it("uses paired guards rather than {{else}}", () => {
		expect(TAB_HBS).not.toContain("{{else}}");
	});
});

describe("the sheet's own wiring", () => {
	const SHEET = fs.readFileSync(
		path.resolve(HERE, "../../../module/actors/steading/StonetopSteadingSheet.js"), "utf8");

	it("lifts the board out before the body is replaced, and puts it back after", () => {
		// Order is the whole of it: detaching happens in `_render` BEFORE `super._render` throws
		// the old body away, and the board goes back at the FOOT of the same method. Reversed, or
		// either half missing, the board is orphaned on the first re-render.
		//
		// Asserted as an ORDER rather than as adjacency: the timeline tab detaches in the same
		// place for the same reason, and pinning these two lines as neighbours made this test fail
		// on a change that was correct. What matters is that nothing has moved the detach below
		// the super call, so both positions are read and compared.
		const detachAt = SHEET.indexOf("detachRelmapTab(this);");
		const replacedAt = SHEET.indexOf("await super._render(force, options);");
		expect(detachAt, "the board is never detached").toBeGreaterThan(-1);
		expect(replacedAt, "_render never calls super").toBeGreaterThan(-1);
		expect(detachAt).toBeLessThan(replacedAt);
		expect(SHEET).toContain("syncRelmapTab(this, this.element?.[0]);");
	});

	// ⚠ AND NOT FROM `activateListeners`, WHICH RUNS TOO EARLY. Whether the board is wanted
	// depends on which tab is showing, and utils/window-restore.js puts a reloaded sheet back on
	// the tab it was left on from the RENDER hook -- which core fires after `activateListeners`.
	// Wired there, reloading with the sheet open on the map hands the reader an empty tab.
	it("does not mount the board from activateListeners", () => {
		const listeners = SHEET.slice(SHEET.indexOf("activateListeners(html) {"));
		expect(listeners).not.toContain("syncRelmapTab(this, html[0])");
	});

	it("closes the board when the sheet closes", () => {
		// ⚠ The board registers five global journal hooks and only its own `close` takes them off.
		expect(SHEET).toContain("closeRelmapTab(this);");
	});

	it("builds the board from the tab callback rather than from every render", () => {
		expect(SHEET).toMatch(/_onChangeTab\(event, tabs, active\) \{[\s\S]{0,200}STEADING_RELMAP_TAB/);
	});
});
