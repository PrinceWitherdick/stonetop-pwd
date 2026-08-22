import { describe, it, expect, beforeEach, vi } from "vitest";

// The "See the whole map" window: the route planner around a full-size map. It is meant to be a
// PEER of the walkthrough's route step — same controls, same hotspots, same readout, writing to
// the same trip — so what matters here is that every gesture reaches the planner it was given, and
// that redrawing after one never costs the reader the zoom they were using.
//
// The suite runs in node (there is no jsdom in this project), so the chrome is a hand-rolled stand
// -in for the few DOM calls _bindChrome makes. That is enough: the markup itself is pinned against
// the real partials by tests/dialogs/expedition-journey.test.js.

const opened = [];
// The already-open app the real helper would find, when a test wants that branch. Core's
// `openOrFocus` raises it and never runs the factory — which is precisely what has to stay free of
// the journey build.
let alreadyOpen = null;
const openOrFocusReturns = app => { alreadyOpen = app; };
vi.mock("../../module/utils/open-or-focus.js", () => ({
	openOrFocus: (id, make) => {
		opened.push(id);
		if (alreadyOpen) { alreadyOpen.bringToTop(); return alreadyOpen; }
		return make();
	},
}));
vi.mock("../../module/utils/foundry-compat.js", () => ({
	renderTemplate: (path, ctx) =>
		Promise.resolve(`<chrome path="${path}" tier="${ctx.journey.activeTier}">`),
}));

const { TravelMapWindow, openTravelMap } = await import("../../module/dialogs/TravelMapWindow.js");

/** A journey context the shape of what ExpeditionDialog._buildJourney returns. */
const journeyFor = (tier, destination = null) => ({
	activeTier: tier,
	map: { tier, src: `art/${tier}.webp`, alt: `The ${tier}`, aspect: 1.4 },
	pins: `<pins tier="${tier}">`,
	destination: destination ? { name: destination } : null,
	hasDestination: !!destination,
	tiers: [{ slug: "vicinity" }, { slug: "worlds-end" }],
	route: null,
});

/** One element, with just the surface _bindChrome touches. */
function el(props = {}) {
	const handlers = {};
	const node = {
		...props,
		addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
		listenerCount: type => (handlers[type] ?? []).length,
		fire: type => { for (const fn of handlers[type] ?? []) fn({ currentTarget: node }); },
	};
	return node;
}

/** The chrome the window binds against, as travel-map.hbs lays it out. */
function chromeRoot() {
	const parts = {
		origin: el({ value: "stonetop" }),
		clear:  el(),
		chrome: el({ innerHTML: "" }),
		foot:   el({ innerHTML: "" }),
		tabs:   [el({ dataset: { tier: "vicinity" } }), el({ dataset: { tier: "worlds-end" } })],
		// The readout's "show me the map that DOES draw this" button, which the same binder wires
		// to the same handler as the tabs.
		elsewhere: [el({ dataset: { tier: "vicinity" } })],
	};
	const byClass = {
		".stonetop-journey-origin":     parts.origin,
		".stonetop-journey-clear":      parts.clear,
		".stonetop-travel-map-chrome":  parts.chrome,
		".stonetop-travel-map-foot":    parts.foot,
	};
	return Object.assign(parts, {
		querySelector: sel => byClass[sel] ?? null,
		// Comma lists are split the way a real querySelectorAll reads them: the binder asks for the
		// tabs and the readout's switch-map button in one call, and a fake that matched the whole
		// string literally would report "no tabs here" and let a dead control through.
		querySelectorAll: sel => sel.split(",").flatMap(one => ({
			".stonetop-journey-tier":      parts.tabs,
			".stonetop-journey-elsewhere": parts.elsewhere,
		}[one.trim()] ?? [])),
	});
}

let picks;
let source;

/** An instance without the Application constructor, for the methods that do not need it. */
function windowFor(tier = "worlds-end") {
	const app = Object.create(TravelMapWindow.prototype);
	app._tier = tier;
	app._source = source;
	app._journey = journeyFor(tier);
	app._src = app._journey.map.src;
	app.rendered = true;
	app.render = vi.fn();
	app.setOverlay = vi.fn();
	return app;
}

beforeEach(() => {
	picks = [];
	alreadyOpen = null;
	source = {
		build: vi.fn(tier => Promise.resolve(journeyFor(tier))),
		pick: vi.fn((field, slug) => { picks.push([field, slug]); return Promise.resolve(); }),
	};
});

describe("what it forwards to the planner", () => {
	it("hands the parent an onPick from the CONSTRUCTOR, or every hotspot would be dead", async () => {
		// The parent binds its overlay delegate only when it already has an onPick, and it binds
		// during its first activateListeners — so setting this afterwards would be too late.
		const app = new TravelMapWindow(
			{ tier: "worlds-end", source, journey: journeyFor("worlds-end") }, { id: "t", title: "t" });
		expect(typeof app._onPick).toBe("function");

		app.rendered = false;                    // sync() no-ops, which is all we want here
		await app._onPick({ slug: "marshedge", tier: "worlds-end" });
		expect(picks).toEqual([["destination", "marshedge"]]);
	});

	it("zooms out instead of picking, for the arrow that names two places", async () => {
		// The "Steplands & Marshedge" exit carries a tier and no slug, because it cannot know
		// which of the two the GM meant. Reading only the slug would leave it inert here while
		// its tooltip promised a zoom.
		const app = new TravelMapWindow(
			{ tier: "vicinity", source, journey: journeyFor("vicinity") }, { id: "t", title: "t" });
		app.render = vi.fn();
		await app._onPick({ slug: "", tier: "worlds-end" });
		expect(picks).toEqual([]);
		expect(app._tier).toBe("worlds-end");
	});

	it("opens on the picture the planner gave it", () => {
		const app = new TravelMapWindow(
			{ tier: "vicinity", source, journey: journeyFor("vicinity") }, { id: "t", title: "t" });
		expect(app._src).toBe("art/vicinity.webp");
		expect(app._tier).toBe("vicinity");
	});

	it("writes an origin when the picker changes, and clears on the clear button", async () => {
		const app = windowFor();
		const root = chromeRoot();
		app._bindChrome(root);

		root.origin.value = "marshedge";
		root.origin.fire("change");
		root.clear.fire("click");
		await new Promise(r => setTimeout(r, 0));

		expect(picks).toEqual([["origin", "marshedge"], ["destination", ""]]);
	});

	it("re-reads the planner after any pick", async () => {
		const app = windowFor();
		await app._pick("destination", "lygos");
		expect(picks).toEqual([["destination", "lygos"]]);
		expect(source.build).toHaveBeenCalledWith("worlds-end");
	});
});

describe("switching which map it shows", () => {
	it("re-renders, because the picture itself changes", async () => {
		const app = windowFor("worlds-end");
		const root = chromeRoot();
		app._bindChrome(root);

		root.tabs[0].fire("click");
		await new Promise(r => setTimeout(r, 0));

		expect(app._tier).toBe("vicinity");
		expect(app._src).toBe("art/vicinity.webp");
		// Back to fit: the new map has its own size, so the old zoom would mean nothing.
		expect(app._fitting).toBe(true);
		expect(app.render).toHaveBeenCalled();
	});

	it("ignores a click on the map it is already showing", async () => {
		const app = windowFor("worlds-end");
		await app.showTier("worlds-end");
		expect(app.render).not.toHaveBeenCalled();
	});

	// The panel's own tab handler (`ExpeditionDialog._showMapTier`) checks the slug against
	// TRAVEL_MAPS, and journey-controls.js says both surfaces have to agree or the same arrow does
	// two different things. Without the check this window navigated to a tier with no map and sat
	// on its permanent "that map isn't in this world" panel while the panel correctly did nothing.
	it("refuses a tier that is not one of the maps", async () => {
		const app = windowFor("worlds-end");
		await app.showTier("beyond");
		expect(app._tier).toBe("worlds-end");
		expect(app.render).not.toHaveBeenCalled();
	});

	// The id is what openOrFocus matches on and the title is what the frame says, and both were
	// fixed at the tier the window was OPENED on. Left there, the panel's Vicinity zoom raised a
	// window showing the World's End, and its World's End zoom opened a SECOND one.
	it("takes its id and its title with it", async () => {
		const app = windowFor("worlds-end");
		app.options = { id: "stonetop-travel-map-worlds-end", title: "The worlds-end" };
		await app.showTier("vicinity");
		expect(app.options.id).toBe("stonetop-travel-map-vicinity");
		expect(app.options.title).toBe("The vicinity");
	});

	it("tells the planner it has moved, so the panel re-keys it", async () => {
		const moved = [];
		source.moved = vi.fn((from, to, app) => { moved.push([from, to, app]); });
		const app = windowFor("worlds-end");
		await app.showTier("vicinity");
		expect(moved).toEqual([["worlds-end", "vicinity", app]]);
	});
});

describe("redrawing without losing the reader's place", () => {
	it("swaps the pins and the chrome in place, never re-rendering", async () => {
		const app = windowFor("worlds-end");
		const root = chromeRoot();
		app.element = [root];
		await app.sync();

		expect(app.setOverlay).toHaveBeenCalledWith('<pins tier="worlds-end">');
		expect(root.chrome.innerHTML).toContain("expedition-journey-controls.hbs");
		expect(root.foot.innerHTML).toContain("expedition-journey-route.hbs");
		// A re-render would re-fit the picture and throw away the corner they had zoomed into.
		expect(app.render).not.toHaveBeenCalled();
	});

	it("binds the replaced chrome once, not the viewport all over again", async () => {
		// The controls are new markup after a sync, so they must be bound again — but going
		// through the whole of activateListeners would stack a second set of wheel and pan
		// handlers on the viewport, and the next notch of the wheel would zoom twice.
		const app = windowFor("worlds-end");
		const root = chromeRoot();
		app.element = [root];
		await app.sync();
		await app.sync();

		expect(root.tabs[0].listenerCount("click")).toBe(2);   // one per sync, none extra
		root.tabs[0].fire("click");
		await new Promise(r => setTimeout(r, 0));
		// Both handlers ran, but showTier is idempotent past the first, so one render.
		expect(app.render).toHaveBeenCalledTimes(1);
	});

	it("does nothing at all when the window is closed", async () => {
		const app = windowFor();
		app.rendered = false;
		await app.sync();
		expect(app.setOverlay).not.toHaveBeenCalled();
	});
});

describe("opening one", () => {
	it("opens per map, on the tier asked for", async () => {
		// The stubbed Application in tests/setup.js has no render of its own to spy on.
		TravelMapWindow.prototype.render = vi.fn();
		const app = await openTravelMap({ tier: "vicinity", source });
		expect(app._tier).toBe("vicinity");
		// Keyed by tier, so the two maps are two windows and a second click raises the right one.
		expect(opened.at(-1)).toBe("stonetop-travel-map-vicinity");
	});

	it("opens nothing when this world has no copy of that map", async () => {
		// A zoom window around no picture is worse than the panel's own "run Import Book Art" line.
		source.build = () => Promise.resolve({ ...journeyFor("vicinity"), map: null });
		expect(await openTravelMap({ tier: "vicinity", source })).toBeNull();
	});

	// The build is a Dijkstra solve, an art browse, a `resolveTravelMap` and a pass over every
	// hotspot on the map. Done ahead of the already-open check, a second click on "See the whole
	// map" paid for all of it and then threw the answer away.
	it("builds nothing when the window for that tier is already up", async () => {
		TravelMapWindow.prototype.render = vi.fn();
		await openTravelMap({ tier: "vicinity", source });
		const builds = source.build.mock.calls.length;

		// The mock openOrFocus runs the factory only when nothing is open; this is that branch.
		const focused = { bringToTop: vi.fn(), rendered: true };
		openOrFocusReturns(focused);
		expect(await openTravelMap({ tier: "vicinity", source })).toBe(focused);
		expect(source.build.mock.calls.length).toBe(builds);
	});
});
