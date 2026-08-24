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
	// `frame` is the registration of the file on screen. It rides the journey because the window
	// hands it back to the planner when a site is placed, rather than re-deriving it: doing that
	// would be a second browse and a second decode to arrive at the number already in hand.
	map: { tier, src: `art/${tier}.webp`, alt: `The ${tier}`, aspect: 1.4, frame: { x0: 0, y0: 0, x1: 1, y1: 1 } },
	pins: `<pins tier="${tier}">`,
	destination: destination ? { name: destination } : null,
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
		site:   el(),
		// Laying the way out by hand: the button that throws the marks away, which is the whole of
		// the chrome that mode has now (the gesture is the rest of it).
		clearDrawn: el(),
		// The two the partial no longer draws — the origin dropdown's replacement, and the × beside
		// the destination. Kept here so the suite can prove the binder does not reach for them.
		setStart: el(),
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
		".stonetop-journey-place-site": parts.site,
		".stonetop-journey-clear-drawn": parts.clearDrawn,
		".stonetop-journey-start-btn":  parts.setStart,
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
// Slug clicks that reached the planner, with whether the shift key was down: half of what a
// click on a place says while a way is being drawn by hand.
const marked = [];

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
	marked.length = 0;
	alreadyOpen = null;
	source = {
		build: vi.fn(tier => Promise.resolve(journeyFor(tier))),
		// THE PLANNER NO LONGER OFFERS THIS, and it is left here on purpose: any pick it records is
		// a control that the removal of the picks row was supposed to have taken with it.
		pick: vi.fn((field, slug) => { picks.push([field, slug]); return Promise.resolve(); }),
		// What a click on a PLACE goes through now, whichever of its two things it turns out to
		// mean: the planner decides between "where they are bound" and "another stop on the way
		// they are drawing", because only it knows which the trip is in. See `journeyPick`.
		markPlace: vi.fn((slug, ev) => { marked.push([slug, !!ev?.shiftKey]); return Promise.resolve(); }),
		// And a click on one of the GM's OWN sites, which goes the same way for the same reason — a
		// site is a place on the way now rather than a link out to a journal. No tier: it carries
		// its own, since the stop is laid at the site's recorded fraction, not the pointer's.
		markSite: vi.fn(() => Promise.resolve()),
		placeSite: vi.fn(() => Promise.resolve()),
		takeSiteOffMap: vi.fn(() => Promise.resolve()),
		drawMark: vi.fn(() => Promise.resolve()),
		undoMark: vi.fn(() => Promise.resolve()),
		clearDrawn: vi.fn(() => Promise.resolve()),
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
		await app._onPick({ slug: "marshedge", tier: "worlds-end" }, { shiftKey: false });
		expect(marked).toEqual([["marshedge", false]]);
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

	// NEITHER END OF THE JOURNEY IS CHROME ANY MORE (user, 2026-08-24). This window carried the
	// same row the panel did — a "Setting out from Stonetop" button whose press armed the next
	// click, "bound for Marshedge", and an × to un-pick it — and all three went with that row.
	// Both ends are gestures on the picture now, which is the thing this window has that the panel
	// does not, and they go through `markPlace`/`drawMark`/`undoMark` like every other one.
	it("wires neither end of the journey into its chrome", () => {
		const app = windowFor();
		const root = chromeRoot();
		app.watchPoints = vi.fn(() => () => {});
		app._bindChrome(root);

		expect(root.setStart.listenerCount("click")).toBe(0);
		expect(root.clear.listenerCount("click")).toBe(0);
		expect(picks).toEqual([]);
		expect(source.pickStart).toBeUndefined();
	});

	// A place clicked in here goes to the planner and the planner alone, which is what lets the
	// same pin mean "they set out from there" on a trip with no start and "they are bound there"
	// on one with — a decision this window is in no position to make, since its handler is built
	// once in the constructor and never rebound.
	it("re-reads itself after a place goes through the planner", async () => {
		const app = windowFor();
		app.sync = vi.fn();
		await app._through(s => s.markPlace("lygos", null, app, "worlds-end"));
		expect(marked).toEqual([["lygos", false]]);
		expect(app.sync).toHaveBeenCalled();
	});
});

// Putting one of the GM's own sites on the map, from in here.
//
// The division is the same one `pick` and `toScene` already follow: the planner owns every write,
// and this window supplies the one thing only it can — the picture. That matters because the
// picture here is the good one to aim at, wheel-zoom and all, which is the whole reason a GM would
// place from this window rather than from the panel's inch-wide map.
describe("placing a site from the popout", () => {
	it("hands the planner this map's tier, its registration, and its own aim", async () => {
		const app = windowFor("vicinity");
		app.pickPoint = vi.fn(() => Promise.resolve({ left: 40, top: 60 }));
		app.sync = vi.fn();
		const root = chromeRoot();
		app._bindChrome(root);

		root.site.fire("click");
		await new Promise(r => setTimeout(r, 0));

		expect(source.placeSite).toHaveBeenCalledTimes(1);
		const [surface, from] = source.placeSite.mock.calls[0];
		expect(surface.tier).toBe("vicinity");
		expect(surface.frame).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
		// The window is named as the caller, so the planner's sweep over the open maps skips it:
		// it re-reads itself the moment the call returns.
		expect(from).toBe(app);
		expect(await surface.pickPoint()).toEqual({ left: 40, top: 60 });
		expect(app.sync).toHaveBeenCalled();
	});

	// A window sitting on the "that map isn't in this world" panel has no picture to point at, so
	// there is nothing to aim and nothing to write.
	it("asks for nothing when there is no map on screen", async () => {
		const app = windowFor("vicinity");
		app._journey = { ...app._journey, map: null };
		app.sync = vi.fn();
		await app._placeSite();
		expect(source.placeSite).not.toHaveBeenCalled();
	});

	it("lifts a pin through the planner and re-reads", async () => {
		const app = windowFor("vicinity");
		app.sync = vi.fn();
		await app._removeSite("JournalEntry.a.JournalEntryPage.b");
		expect(source.takeSiteOffMap).toHaveBeenCalledWith("JournalEntry.a.JournalEntryPage.b", app);
		expect(app.sync).toHaveBeenCalled();
	});

	// A site pin carries neither `data-slug` nor `data-tier`, so the parent's default selector
	// would take a press on one for a press on open map: it would start a pan, capture the pointer
	// on the viewport, and retarget the click away from the pin. Every site on the map would look
	// live and be unclickable.
	it("tells the parent that a site pin is a control", () => {
		const app = new TravelMapWindow(
			{ tier: "vicinity", source, journey: journeyFor("vicinity") }, { id: "t", title: "t" });
		expect(app._controls).toContain("[data-site-uuid]");
		expect(app._controls).toContain("[data-slug]");
		expect(app._controls).toContain("[data-tier]");
	});

	// A SITE PIN IS A ROUTE CONTROL (user, 2026-08-24), not a link out to a journal. It goes to the
	// planner exactly as a lettered pin does — and with NO tier, unlike a lettered one: a site
	// carries its own, because the stop is laid at the site's recorded fraction rather than wherever
	// the pointer landed, so the same tap here and on the panel's inch-wide map writes one number.
	it("hands a site pin to the planner as a place on the way", async () => {
		const app = new TravelMapWindow(
			{ tier: "vicinity", source, journey: journeyFor("vicinity") }, { id: "t", title: "t" });
		app.rendered = false;
		await app._onPick({ siteUuid: "JournalEntry.a.JournalEntryPage.b" }, { shiftKey: true });

		expect(source.markSite).toHaveBeenCalledTimes(1);
		const [uuid, click, asked] = source.markSite.mock.calls[0];
		expect(uuid).toBe("JournalEntry.a.JournalEntryPage.b");
		// The modifier is half of what the tap said, so it travels with it.
		expect(click.shiftKey).toBe(true);
		// The window names itself as the caller, so the planner's sweep skips the one about to
		// re-read itself.
		expect(asked).toBe(app);
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

// ── Drawing the way from the popout ──────────────────────────────────────────
//
// The same division again: the planner owns every write, and this window supplies the picture —
// which here is a 300 dpi map the reader can wheel down into before laying a mark, rather than the
// panel's inch-wide copy of it. What has to be right on this side is which picture is armed and
// which is not, since this window keeps showing whatever tier it was opened on long after the
// panel has followed a destination out to the other one.

/** A journey with the box ticked, drawn on `tier`. */
const drawnOn = (tier, over = {}) => ({
	...journeyFor(tier),
	// Every one of these is the planner's own per-tier answer (ExpeditionDialog._drawState), and
	// between them they are the whole of what this window asks before it arms a picture:
	// `canDrawHere` says a click lays a leg and `canSetStart` that it plants the start; `crosshair`
	// says the next click lands SOMETHING; and `canUndo` is the right-click ladder in one flag —
	// the last mark, else the destination, else the start (ExpeditionDialog `_undoJourneyMark`).
	// All four travel with the journey rather than being worked out again per picture.
	custom: {
		on: true, canDraw: true, canDrawHere: true, canSetStart: false, tier, count: 1,
		crosshair: true, canUndo: true,
		...over,
	},
});

describe("drawing the way from the popout", () => {
	it("arms its own picture and reports a mark as a fraction of the printed crop", async () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity");
		app.sync = vi.fn();
		let handlers = null;
		app.watchPoints = vi.fn(h => { handlers = h; return () => {}; });

		app._bindChrome(chromeRoot());
		expect(app.watchPoints).toHaveBeenCalledTimes(1);
		// The pins keep their own clicks, and a site pin keeps its own right-click.
		expect(handlers.ignore).toContain("data-slug");
		expect(handlers.undoIgnore).toContain("data-site-uuid");

		await handlers.onPoint({ left: 40, top: 60 }, { shiftKey: true });
		// A percentage of the picture on screen, converted against THIS file's registration — which
		// is what makes a mark laid here land in the same valley on every other copy of the map.
		expect(source.drawMark).toHaveBeenCalledWith(
			{ fx: 0.4, fy: 0.6 }, { append: true, tier: "vicinity" }, app);
		expect(app.sync).toHaveBeenCalled();
	});

	// Armed, but nothing drawn yet: the shift-click that would START a way has to be heard, and the
	// crosshair has to stay off until it is, because it would promise that ANY click lands a point.
	// The right-click stays armed all the same — there is still a start on this trip, and that is
	// the last rung of the ladder.
	it("arms a bare map without the crosshair, but keeps the right-click", () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity", { on: false, count: 0, crosshair: false });
		let handlers = null;
		app.watchPoints = vi.fn(h => { handlers = h; return () => {}; });

		app._bindChrome(chromeRoot());
		expect(typeof handlers.onPoint).toBe("function");
		expect(typeof handlers.onUndo).toBe("function");
		expect(handlers.crosshair).toBe(false);
	});

	// A trip already peeled back to nothing: no marks, no destination, no start. The right-click
	// swallows the browser's own menu while it is armed, so arming it here would be taking that
	// menu away in order to do nothing with it.
	it("leaves the right-click alone once there is nothing left to take back", () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity", {
			on: false, count: 0, canDrawHere: false, canSetStart: true, crosshair: true, canUndo: false,
		});
		let handlers = null;
		app.watchPoints = vi.fn(h => { handlers = h; return () => {}; });

		app._bindChrome(chromeRoot());
		expect(handlers.onUndo).toBeNull();
		// And the crosshair comes back ON, because now a plain click DOES land something: it says
		// where the party sets out from.
		expect(handlers.crosshair).toBe(true);
	});

	it("takes the trip back a step on a right-click", async () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity");
		app.sync = vi.fn();
		let handlers = null;
		app.watchPoints = vi.fn(h => { handlers = h; return () => {}; });
		app._bindChrome(chromeRoot());

		await handlers.onUndo();
		expect(source.undoMark).toHaveBeenCalledWith(app);
	});

	// This window keeps the map it was opened on. A crosshair over a picture whose clicks could not
	// join this way would be promising something it cannot do.
	it("leaves its picture alone when the way is drawn on the other map", () => {
		const app = windowFor("vicinity");
		app._journey = { ...journeyFor("vicinity"), custom: { on: true, canDraw: true, canDrawHere: false, tier: "worlds-end" } };
		app.watchPoints = vi.fn();
		app.stopWatchingPoints = vi.fn();
		app._bindChrome(chromeRoot());
		expect(app.watchPoints).not.toHaveBeenCalled();
		expect(app.stopWatchingPoints).toHaveBeenCalled();
	});

	// Drawing writes the trip into a world setting, which a player cannot do.
	it("leaves it alone for a reader who may not draw", () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity", { canDraw: false, canDrawHere: false });
		app.watchPoints = vi.fn();
		app.stopWatchingPoints = vi.fn();
		app._bindChrome(chromeRoot());
		expect(app.watchPoints).not.toHaveBeenCalled();
	});

	it("forwards the start-over button to the planner", async () => {
		const app = windowFor("vicinity");
		app._journey = drawnOn("vicinity");
		app.sync = vi.fn();
		app.watchPoints = vi.fn(() => () => {});
		const root = chromeRoot();
		app._bindChrome(root);

		root.clearDrawn.fire("click");
		await new Promise(r => setTimeout(r, 0));

		expect(source.clearDrawn).toHaveBeenCalledWith(app);
	});

	// The tier is the one thing this window can tell the planner that the planner cannot work out
	// for itself: it keeps showing the map it was opened on long after the panel has followed a
	// destination out to the other one, and a way that does not exist yet begins on the map the
	// reader is actually looking at.
	it("names its own map when a place is shift-clicked into a way", async () => {
		const app = new TravelMapWindow(
			{ tier: "vicinity", source, journey: journeyFor("vicinity") }, { id: "t", title: "t" });
		app.rendered = false;                    // sync() no-ops, which is all we want here
		await app._onPick({ slug: "the-maw" }, { shiftKey: true });
		expect(source.markPlace).toHaveBeenCalledWith("the-maw", { shiftKey: true }, app, "vicinity");
	});
});
