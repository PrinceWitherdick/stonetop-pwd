import { describe, it, expect, beforeEach, vi } from "vitest";

// THE TIMELINE TAB'S LIFECYCLE, which is the whole of what the tab adds. The panel itself is the
// window's own class mounted frameless (dialogs/TimelinePanel.js), so nothing about drawing or
// writing a timeline is this suite's business. What is, is the four moments where a sheet and a
// long-lived panel meet, and every one of them fails quietly:
//
//  • a reader who never opens the tab must not pay for the panel (it walks every entry on the
//    track, enriches every body, and registers three global journal hooks);
//  • a sheet re-render must MOVE the same panel rather than rebuild it, or the reader loses where
//    they had scrolled to every time anything writes to the actor;
//  • a sheet that closes must close the panel, or its three global hooks fire on every journal
//    write at the table for the rest of the session;
//  • a reader who clicks the tab twice before the first render lands must not get two panels.
//
// Runs in node with no jsdom, so the DOM is a hand-rolled stand-in for the three calls these paths
// actually make.

// ── The panel, stubbed. What it DOES is tested next door; what matters here is when it is built,
// where it is pointed and when it is closed.
const built = [];
const pending = [];
const slow = { on: false };
/** Let every held render land, in the order they were asked for. */
const settle = () => { for (const panel of pending.splice(0)) panel.paint(); };

class FakePanel {
	constructor(track, options, host) {
		this.track = track;
		this.options = options;
		this.host = host;
		this.rendered = false;
		this.closed = 0;
		this.element = null;
		built.push(this);
	}

	static panelId(hostKey) { return `stonetop-timeline-panel-${hostKey}`; }

	render() {
		this.rendered = true;
		// ⚠ AND NOT ALWAYS AT ONCE. The real panel's render awaits its own getData (which enriches
		// every entry body) before core sets `_element`, so there is a stretch after `render()`
		// returns during which the panel exists and has no element. `slow` is that stretch.
		if (slow.on) { pending.push(this); return this; }
		this.paint();
		return this;
	}

	paint() {
		this.element = [makeNode()];
		this.host?.replaceChildren(this.element[0]);
	}

	setHost(host) { this.host = host; }
	async close() { this.closed += 1; }
}
vi.mock("../../module/dialogs/TimelinePanel.js", () => ({ TimelinePanel: FakePanel }));

const world = { track: { trackId: "steading", trackKind: "steading", name: "Stonetop" } };
vi.mock("../../module/timeline/timeline-store.js", () => ({
	trackForActor: () => world.track,
}));

const {
	closeTimelineTab, detachTimelineTab, syncTimelineTab, TIMELINE_TAB,
} = await import("../../module/timeline/timeline-tab.js");

// ── The smallest DOM these paths touch: a mount that can hold children, and a root that finds it.
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

/** A sheet root that carries the timeline tab's mount, or (classic layout) does not. */
function makeRoot({ mounted = true } = {}) {
	const mount = mounted ? makeNode() : null;
	return {
		mount,
		querySelector: sel => (sel === "[data-stonetop-timeline]" ? mount : null),
	};
}

function makeSheet({ tab = TIMELINE_TAB } = {}) {
	return {
		actor: { id: "steading1" },
		rendered: true,
		_tabs: [{ active: tab }],
		_timelinePanel: null,
	};
}

beforeEach(() => {
	built.length = 0;
	pending.length = 0;
	slow.on = false;
	world.track = { trackId: "steading", trackKind: "steading", name: "Stonetop" };
});

describe("nothing is built for a reader who never opens the tab", () => {
	it("builds nothing while another tab is up", () => {
		const sheet = makeSheet({ tab: "overview" });
		syncTimelineTab(sheet, makeRoot());
		expect(built).toHaveLength(0);
		expect(sheet._timelinePanel).toBeNull();
	});

	it("builds the panel the moment that tab is the one showing", () => {
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		expect(built).toHaveLength(1);
		expect(sheet._timelinePanel).toBe(built[0]);
		expect(built[0].rendered).toBe(true);
	});

	// The classic layout carries no such tab, so there is no mount and nothing to do. It must not
	// throw either: this runs on every render of every sheet, whichever layout is on.
	it("does nothing at all in the classic layout, which carries no such tab", () => {
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot({ mounted: false }));
		expect(built).toHaveLength(0);
	});

	// An actor with no thread (a monster, an NPC) may still somehow reach this call; it must not
	// build a panel for a track that does not exist.
	it("builds nothing for an actor with no thread", () => {
		world.track = null;
		syncTimelineTab(makeSheet(), makeRoot());
		expect(built).toHaveLength(0);
	});
});

describe("which track it opens on", () => {
	it("opens on the track this sheet's own actor names", () => {
		syncTimelineTab(makeSheet(), makeRoot());
		expect(built[0].track).toMatchObject({ trackId: "steading", trackKind: "steading" });
	});

	// ⚠ PER HOST, NOT PER TRACK, and not the window's id either: the window declares a fixed id so
	// a second open focuses the first, and a panel sharing it would be found by `openOrFocus` and
	// "brought to top", so the aggregate would refuse to open while any such sheet was on screen.
	it("gives the panel an id of its own, per host", () => {
		syncTimelineTab(makeSheet(), makeRoot());
		expect(built[0].options.id).toBe("stonetop-timeline-panel-steading1");
		expect(built[0].options.id).not.toBe("stonetop-timeline-window");
	});
});

describe("a re-render moves the panel rather than rebuilding it", () => {
	it("carries the same element into the tab the new render built", () => {
		const sheet = makeSheet();
		const first = makeRoot();
		syncTimelineTab(sheet, first);
		const body = built[0].element[0];

		// What a sheet re-render does: lift the panel out, then point it at a fresh mount.
		detachTimelineTab(sheet);
		const second = makeRoot();
		syncTimelineTab(sheet, second);

		expect(built, "the panel was rebuilt rather than moved").toHaveLength(1);
		expect(second.mount.children[0]).toBe(body);
		expect(built[0].host).toBe(second.mount);
	});

	// Detaching is what makes "the same element, moved" a fact rather than a hope: the node is
	// about to be orphaned by the sheet replacing its body either way.
	it("lifts the element out of the old mount", () => {
		const sheet = makeSheet();
		const root = makeRoot();
		syncTimelineTab(sheet, root);
		expect(root.mount.children).toHaveLength(1);
		detachTimelineTab(sheet);
		expect(root.mount.children).toHaveLength(0);
	});

	it("moves a panel even onto a tab that is not the active one", () => {
		// The reader is on the timeline, the sheet re-renders, and by the time the panel goes back
		// the active tab is whatever it was. A guard on the active tab here would drop the panel.
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		detachTimelineTab(sheet);
		sheet._tabs[0].active = "overview";
		const second = makeRoot();
		syncTimelineTab(sheet, second);
		expect(built).toHaveLength(1);
		expect(second.mount.children[0]).toBe(built[0].element[0]);
	});
});

describe("a panel with no element yet is still a panel", () => {
	// ⚠ THE DOUBLE-BUILD TRAP. `element` is null between `render()` and the render landing, so a
	// reader who clicks the tab, clicks away and clicks back inside that window would build a
	// SECOND panel over the first: three global journal hooks on an instance the sheet no longer
	// holds and therefore never closes, repainting a detached tree for the rest of the session.
	it("does not build a second panel while the first is still rendering", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		expect(built).toHaveLength(1);
		expect(built[0].element).toBeNull();

		const second = makeRoot();
		syncTimelineTab(sheet, second);
		expect(built, "a second panel was built mid-render").toHaveLength(1);
	});

	// And the host it was given is by then the mount the last render threw away, so it has to be
	// re-pointed at the fresh one: `_injectHTML` reads it when the render finally lands.
	it("points the in-flight panel at the mount that will still be there", () => {
		slow.on = true;
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		const second = makeRoot();
		syncTimelineTab(sheet, second);

		settle();
		expect(second.mount.children[0]).toBe(built[0].element[0]);
	});
});

describe("closing", () => {
	// ⚠ The panel registers three global journal hooks and only its own `close` takes them off.
	it("closes the panel and lets go of it", () => {
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		const panel = sheet._timelinePanel;
		closeTimelineTab(sheet);
		expect(panel.closed).toBe(1);
		expect(sheet._timelinePanel).toBeNull();
	});

	it("is safe on a sheet that never opened the tab", () => {
		const sheet = makeSheet({ tab: "overview" });
		expect(() => closeTimelineTab(sheet)).not.toThrow();
	});

	it("is safe on a sheet that has already closed", () => {
		const sheet = makeSheet();
		syncTimelineTab(sheet, makeRoot());
		closeTimelineTab(sheet);
		expect(() => closeTimelineTab(sheet)).not.toThrow();
	});
});
