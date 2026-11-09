import { describe, it, expect, beforeEach, vi } from "vitest";

// The players' view of a route the GM has shown them (module/dialogs/SharedRouteWindow.js). What
// matters is that it is a picture and not a planner, that it follows the share while it is the live
// window, and that a chat card opens the route it was posted with. The words it shows are pinned in
// tests/utils/shared-route.test.js.

const opened = [];
vi.mock("../../module/utils/open-or-focus.js", () => ({
	openOrFocus: (id, make) => { opened.push(id); return make(); },
}));

const {
	SharedRouteWindow, openSharedRoute, postSharedRouteCard, wireSharedRouteCard, registerSharedRouteHooks,
	SHARED_ROUTE_PINS_TEMPLATE, SHARED_ROUTE_WINDOW_ID, sharedRouteSnapshotId,
} = await import("../../module/dialogs/SharedRouteWindow.js");
const { sharedRoutePayload, sharedRouteView } = await import("../../module/utils/shared-route.js");
const { frameFor } = await import("../../module/data/travel-times.js");

const ART = (name = "gm-vicinity") => ({
	src: `art/${name}.webp`, out: `assets/maps/${name}.webp`,
	frame: frameFor(`assets/maps/${name}.webp`), aspect: 584 / 422,
});
const share = (destination, id, art = ART()) => sharedRoutePayload({
	trip: { id: "trip-1", title: "", journey: { origin: "stonetop", destination } }, tier: "vicinity", art, id,
});

let store;
beforeEach(() => {
	opened.length = 0;
	store = {};
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: false },
		settings: {
			settings: new Map([["stonetop-pwd.sharedRoute", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("a picture, not a planner", () => {
	it("binds nothing to a click on the map", () => {
		store.sharedRoute = share("the-crossroads", "a");
		const app = new SharedRouteWindow({ live: true });
		expect(app._onPick).toBeNull();
	});

	it("draws marks that are not controls the pan handler would stop for", async () => {
		const view = sharedRouteView(share("the-crossroads", "a"));
		const html = await renderTemplate(SHARED_ROUTE_PINS_TEMPLATE, view.map);
		expect(html).not.toMatch(/data-slug|data-tier|<button/);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("stonetop-journey-path");
		expect(html).toContain("the Crossroads");
	});
});

describe("what the window renders", () => {
	it("puts the words before the picture, and offers the GM a way to stop", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		global.game.user.isGM = true;
		const app = new SharedRouteWindow({ live: true });
		const data = await app.getData();
		expect(data.canStop).toBe(true);
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/shared-route.hbs", data);
		expect(html.indexOf("The way to the Crossroads")).toBeLessThan(html.indexOf("stonetop-image-zoom-img"));
		expect(html.indexOf("stonetop-image-zoom-img")).toBeLessThan(html.indexOf("stonetop-journey-legs"));
		// NO live region in the content (audit RTE-3): this markup is replaced on every change, and a
		// region replaced along with its words is never read. The window keeps its own, outside.
		expect(html).not.toContain("aria-live");
		expect(html).toContain("Stop showing players");
		expect(html).toContain('alt="The Vicinity, with the way from Stonetop to the Crossroads drawn on it."');
	});

	it("gives a player no stop button", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		const data = await new SharedRouteWindow({ live: true }).getData();
		expect(data.canStop).toBe(false);
	});

	// A window vanishing under a reader who cannot see it go is worse than one that says why.
	it("says nothing is being shown rather than closing", async () => {
		store.sharedRoute = {};
		const data = await new SharedRouteWindow({ live: true }).getData();
		expect(data.view).toBeNull();
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/shared-route.hbs", data);
		expect(html).toContain("isn’t showing a route right now");
		expect(html).not.toContain("stonetop-image-zoom-view");
	});

	it("writes the journey out without a map where the world has none", async () => {
		store.sharedRoute = share("the-crossroads", "a", null);
		const data = await new SharedRouteWindow({ live: true }).getData();
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/shared-route.hbs", data);
		expect(html).toContain("no copy of the map");
		expect(html).toContain("stonetop-journey-legs");
		expect(html).not.toContain("stonetop-image-zoom-view");
	});

	it("marks a card's snapshot as older once the GM has moved on, and never offers it a stop", async () => {
		const old = share("the-crossroads", "old");
		store.sharedRoute = share("the-maw", "new");
		global.game.user.isGM = true;
		const data = await new SharedRouteWindow({ payload: old, live: false }).getData();
		expect(data.older).toBe(true);
		expect(data.canStop).toBe(false);
		expect(data.view.title).toBe("The way to the Crossroads");
	});
});

describe("which window opens", () => {
	it("opens the live window with no payload, or with the one being shown", () => {
		store.sharedRoute = share("the-crossroads", "a");
		openSharedRoute();
		openSharedRoute(store.sharedRoute);
		expect(opened).toEqual([SHARED_ROUTE_WINDOW_ID, SHARED_ROUTE_WINDOW_ID]);
	});

	it("opens an older card's route as its own snapshot", () => {
		store.sharedRoute = share("the-maw", "new");
		const app = openSharedRoute(share("the-crossroads", "old"));
		expect(opened).toEqual([sharedRouteSnapshotId("old")]);
		expect(app._live).toBe(false);
	});
});

describe("following the share", () => {
	function live() {
		const app = new SharedRouteWindow({ live: true });
		app.rendered = true;
		app.renders = 0;
		app.render = () => { app.renders += 1; };
		app.overlays = [];
		app.setOverlay = html => app.overlays.push(html);
		return app;
	}

	// The reader's zoom survives the GM showing a new way across the same map.
	it("redraws in place when the picture stays the same", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		const app = live();
		store.sharedRoute = share("the-maw", "b");
		await app.follow();
		expect(app.renders).toBe(0);
		expect(app.overlays).toHaveLength(1);
		expect(app._shownView.title).toBe("The way to the Maw");
	});

	it("re-renders when the picture changes, and when the share goes", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		const app = live();
		store.sharedRoute = share("the-maw", "b", ART("map-vicinity"));
		await app.follow();
		expect(app.renders).toBe(1);
		expect(app._src).toBe("art/map-vicinity.webp");
		store.sharedRoute = {};
		await app.follow();
		expect(app.renders).toBe(2);
		expect(app._shownView).toBeNull();
	});

	// Audit RTE-10: the steading's chip is patched where it stands. A full render of every open
	// steading sheet threw away whatever a player was typing on it.
	it("is reached from the setting's hook, and patches the steading's chip without a render", () => {
		const hooks = {};
		global.Hooks = { ...global.Hooks, on: (name, fn) => { hooks[name] = fn; } };
		registerSharedRouteHooks();
		store.sharedRoute = share("the-crossroads", "a");
		const app = live();
		app.follow = vi.fn(() => Promise.resolve());
		const header = { querySelector: vi.fn(() => null) };
		const sheet = {
			actor: { type: "stonetop" }, rendered: true, render: vi.fn(),
			element: [{ querySelector: sel => (sel === ".steading-header" ? header : null) }],
		};
		const other = { actor: { type: "character" }, rendered: true, render: vi.fn() };
		global.ui = { ...global.ui, windows: { 1: app, 2: sheet, 3: other } };
		store.sharedRoute = {};
		hooks.stonetopSharedRouteChanged({});
		expect(app.follow).toHaveBeenCalled();
		expect(sheet.render).not.toHaveBeenCalled();
		expect(header.querySelector).toHaveBeenCalledWith(".steading-header-route");
		expect(other.render).not.toHaveBeenCalled();
	});

	// Audit RTE-11: of two follows in flight, the later one wins.
	it("lets a later follow overrule one still waiting on its templates", async () => {
		store.sharedRoute = share("the-crossroads", "a");
		const app = live();
		const overlays = [];
		app.setOverlay = html => overlays.push(html);
		store.sharedRoute = share("the-maw", "b");
		const first = app.follow();
		store.sharedRoute = {};
		const second = app.follow();
		await Promise.all([first, second]);
		expect(overlays).toHaveLength(0);
		expect(app._shownView).toBeNull();
	});
});

describe("the steading chip's markup", () => {
	// The in-place refresh and the sheet's template both print this one markup.
	it("is the header's labelled route button", async () => {
		const { sharedRouteChip, sharedRouteChipHtml } = await import("../../module/utils/shared-route.js");
		const html = sharedRouteChipHtml(sharedRouteChip(share("the-crossroads", "a")));
		for (const bit of ['class="steading-header-route"', 'data-action="see-shared-route"', 'data-tooltip-direction="DOWN"',
			'<i class="fas fa-route" aria-hidden="true"></i>', '<span class="stonetop-chip-text">']) {
			expect(html).toContain(bit);
		}
		expect(html).toContain("See the route");
		expect(sharedRouteChipHtml(null)).toBe("");
	});
});

describe("the chat card", () => {
	it("carries its own copy of the share, and the legs", async () => {
		let created = null;
		global.ChatMessage = { create: data => { created = data; return Promise.resolve(data); } };
		const payload = share("the-crossroads", "a");
		await postSharedRouteCard(payload);
		expect(created.flags["stonetop-pwd"].sharedRoute).toEqual(payload);
		expect(created.content).toContain("The way to the Crossroads");
		expect(created.content).toContain("See the route");
		delete global.ChatMessage;
	});

	it("opens the route the card carries, and does nothing without one", () => {
		store.sharedRoute = share("the-maw", "new");
		const payload = share("the-crossroads", "old");
		let click = null;
		const button = { addEventListener: (_type, fn) => { click = fn; } };
		const html = { querySelector: () => button };
		wireSharedRouteCard({ getFlag: () => payload }, html);
		click({ preventDefault() {} });
		expect(opened).toEqual([sharedRouteSnapshotId("old")]);

		click = null;
		wireSharedRouteCard({ getFlag: () => null }, html);
		expect(click).toBeNull();
	});
});
