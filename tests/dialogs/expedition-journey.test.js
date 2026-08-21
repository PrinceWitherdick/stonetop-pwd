import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

// The route step of the Run an Expedition walkthrough: the book's maps made tappable over its
// travel table. The graph and the solve are proven in tests/data/travel-times.test.js and
// tests/utils/travel-route.test.js; this covers the dialog's own two jobs — turning a solved route
// into hotspots, and carrying the pick forward onto Chart a Course.

// The map half is I/O (a FilePicker browse and an image decode), so it is faked here. Its real
// behaviour is that a world with no imported art gets an empty inventory, which is exactly the
// `null` this returns.
const art = { resolved: new Map(), browsed: true };
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => (art.browsed ? Promise.resolve({ has: () => true }) : Promise.reject(new Error("no folder"))),
	// The cheap "is it on disk?" half and the expensive "how is it shaped?" half, as the real
	// module splits them: the panel asks the first about every tier and the second only about the
	// map it draws.
	travelMapFile: map => Promise.resolve(art.resolved.get(map.slug) ?? null),
	resolveTravelMap: map => Promise.resolve(art.resolved.get(map.slug) ?? null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { frameFor, travelPlace } = await import("../../module/data/travel-times.js");

// The printed renders, which need no frame registration.
const PRINTED = {
	vicinity:     { slug: "vicinity",   out: "assets/maps/gm-vicinity.webp",   src: "art/gm-vicinity.webp",   frame: frameFor("assets/maps/gm-vicinity.webp"),   aspect: 584 / 422 },
	"worlds-end": { slug: "worlds-end", out: "assets/maps/gm-worlds-end.webp", src: "art/gm-worlds-end.webp", frame: frameFor("assets/maps/gm-worlds-end.webp"), aspect: 586 / 479 },
};

let store;
let rendered;

/**
 * A dialog instance without the Application constructor, the same trick
 * tests/dialogs/expedition-resume.test.js uses: everything under test touches only the log draft
 * and the pure travel modules.
 */
function dialog(journey = null, chart = null) {
	const trip = { id: "trip-1", title: "", createdAt: 0 };
	if (journey) trip.journey = journey;
	if (chart) trip.chart = chart;
	store.expeditionAnswers = { currentId: trip.id, list: [trip] };

	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d.render = () => { rendered++; };
	return d;
}

/** The trip as it now stands in the setting. */
const saved = () => store.expeditionAnswers.list[0];

beforeEach(() => {
	store = { expeditionAnswers: {} };
	rendered = 0;
	art.browsed = true;
	art.resolved = new Map(Object.entries(PRINTED));
	global.game = {
		user: { isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	// The log writer sets dotted paths on a trip; tests/setup.js fakes getProperty but not this.
	globalThis.foundry.utils.setProperty = (obj, path, value) => {
		const keys = path.split(".");
		const last = keys.pop();
		let at = obj;
		for (const key of keys) at = (at[key] ??= {});
		at[last] = value;
		return true;
	};
});

describe("the route step sits in the walkthrough", () => {
	it("is one step, and comes before Chart a Course", () => {
		const steps = Object.create(ExpeditionDialog.prototype)._steps;
		const journeys = steps.filter(s => s.journey);
		expect(journeys).toHaveLength(1);
		expect(steps.indexOf(journeys[0])).toBeLessThan(steps.findIndex(s => s.key === "chart"));
	});

	it("carries a title short enough for the rail, and its own icon", () => {
		const step = Object.create(ExpeditionDialog.prototype)._steps.find(s => s.journey);
		expect(step.title.length).toBeLessThanOrEqual(20);
		expect(step.icon).toMatch(/^fa-/);
	});
});

describe("what the trip remembers", () => {
	it("sets out from home until told otherwise", () => {
		expect(dialog()._journeyPick()).toEqual({ origin: "stonetop", destination: null });
	});

	it("keeps a saved pick", () => {
		expect(dialog({ origin: "marshedge", destination: "lygos" })._journeyPick())
			.toEqual({ origin: "marshedge", destination: "lygos" });
	});

	it("treats a place you are already standing in as no destination", () => {
		// Otherwise the readout would show a route with no legs and a total of nothing.
		expect(dialog({ origin: "marshedge", destination: "marshedge" })._journeyPick().destination).toBeNull();
		expect(dialog({ origin: "marshedge", destination: "marshedge" })._journeyRoute()).toBeNull();
	});

	it("falls back to home when the stored slug is not a place any more", () => {
		expect(dialog({ origin: "atlantis", destination: "narnia" })._journeyPick())
			.toEqual({ origin: "stonetop", destination: null });
	});
});

describe("which map is showing", () => {
	it("opens on the innermost map before anything is chosen", () => {
		expect(dialog()._activeTier("stonetop", null)).toBe("vicinity");
	});

	// With nothing to travel to yet, the ORIGIN is the whole of the journey — and it still has to
	// be drawable. Returning the innermost map flat opened a Vicinity with no "setting out" pin
	// anywhere on it for every place the inner map does not draw.
	it("shows a map that can draw the origin when nothing is chosen yet", () => {
		expect(travelPlace("marshedge").spots.vicinity).toBeUndefined();
		expect(dialog()._activeTier("marshedge", null)).toBe("worlds-end");
		expect(dialog()._activeTier("the-red-grove", null)).toBe("vicinity");
	});

	it("follows the destination to the map it is drawn on", () => {
		expect(dialog()._activeTier("stonetop", "the-ruined-tower")).toBe("vicinity");
		expect(dialog()._activeTier("stonetop", "marshedge")).toBe("worlds-end");
	});

	it("stays on the outermost map for a place drawn on none of them", () => {
		// Lygos is off both maps; the World's End is where the arrow to it lives.
		expect(travelPlace("lygos").spots).toEqual({});
		expect(dialog()._activeTier("stonetop", "lygos")).toBe("worlds-end");
	});

	// The whole reason the origin is an argument. Stonetop is the only place drawn on BOTH maps,
	// so "wherever the destination is drawn, outermost first" sent a few hours' walk to it out to
	// the map of the continent — where the origin has no pin and the route line cannot be drawn.
	it("picks the closest map that can draw BOTH ends, not just the destination", () => {
		expect(Object.keys(travelPlace("stonetop").spots)).toEqual(["vicinity", "worlds-end"]);
		expect(dialog()._activeTier("the-red-grove", "stonetop")).toBe("vicinity");
		// ...and a journey that genuinely spans the two still goes out to the wider one.
		expect(dialog()._activeTier("the-red-grove", "marshedge")).toBe("worlds-end");
	});

	it("obeys the GM's own choice over the destination's", () => {
		const d = dialog();
		d._showMapTier("vicinity");
		expect(d._activeTier("stonetop", "marshedge")).toBe("vicinity");
		expect(rendered).toBe(1);
	});

	it("ignores a map it does not have", () => {
		const d = dialog();
		d._showMapTier("atlantis");
		expect(d._journeyTier).toBeUndefined();
		expect(rendered).toBe(0);
	});
});

describe("building the panel", () => {
	it("places a hotspot per drawn place, as percentages", async () => {
		const data = await dialog({ origin: "stonetop", destination: "marshedge" })._buildJourney();
		expect(data.activeTier).toBe("worlds-end");
		const marshedge = data.map.spots.find(s => s.slug === "marshedge");
		// A printed render is the identity frame, so the percentage IS the measured fraction.
		expect(marshedge.left).toBeCloseTo(71.38, 5);
		expect(marshedge.top).toBeCloseTo(59.36, 5);
		expect(marshedge.isChosen).toBe(true);
		expect(marshedge.time).toBe("10 days");
		expect(marshedge.showLabel).toBe(true);
	});

	it("labels only the two ends of the journey, so eleven tags cannot collide", async () => {
		const data = await dialog({ origin: "stonetop", destination: "marshedge" })._buildJourney();
		expect(data.map.spots.filter(s => s.showLabel).map(s => s.slug).sort())
			.toEqual(["marshedge", "stonetop"]);
	});

	it("anchors a hotspot near an edge inward, so its label cannot spill out", async () => {
		const data = await dialog()._buildJourney();
		const lygos = (await dialog({ destination: "lygos" })._buildJourney()).map.exits
			.find(e => e.node === "lygos");
		expect(lygos.anchorH).toBe("right");   // left is 85%
		expect(lygos.anchorV).toBe("above");   // top is 96%
		expect(data.map.spots.find(s => s.slug === "the-crossroads").anchorH).toBe("centre");
	});

	it("gives the edge arrows a place to pick, except the one naming two", async () => {
		const data = await dialog()._buildJourney();
		const byLabel = Object.fromEntries(data.map.exits.map(e => [e.label, e]));
		expect(byLabel["Barrier Pass"].node).toBe("barrier-pass");
		expect(byLabel["Steplands & Marshedge"].node).toBeNull();
		expect(byLabel["Steplands & Marshedge"].to).toBe("worlds-end");
		expect(byLabel["Steplands & Marshedge"].tooltip).toMatch(/Zoom out/);
	});

	it("reports the route the book would give", async () => {
		const data = await dialog({ destination: "lygos" })._buildJourney();
		expect(data.route.atLeast).toBe("at least 40 days");
		expect(data.route.stops).toEqual(["Marshedge"]);
		expect(data.route.legs.map(l => l.time)).toEqual(["10 days", "30 days"]);
	});

	it("lists every destination whether or not a map is on disk", async () => {
		const withMap = await dialog()._buildJourney();
		art.resolved = new Map();
		const without = await dialog()._buildJourney();

		expect(withMap.hasAnyMap).toBe(true);
		expect(without.hasAnyMap).toBe(false);
		expect(without.map).toBeNull();
		// The list is the map's legend AND the fallback, so it cannot differ between the two.
		const names = data => data.groups.flatMap(g => g.places.map(p => p.name));
		expect(names(without)).toEqual(names(withMap));
		expect(names(without)).toContain("Lygos");
		expect(without.tiers.every(t => t.hasMap === false)).toBe(true);
	});

	it("still answers when the art folder cannot be browsed at all", async () => {
		art.browsed = false;
		const data = await dialog({ destination: "lygos" })._buildJourney();
		expect(data.map).toBeNull();
		expect(data.route.atLeast).toBe("at least 40 days");
	});

	it("groups the beyond-the-maps places on their own", async () => {
		const data = await dialog()._buildJourney();
		const beyond = data.groups.find(g => g.label === "Beyond the maps");
		expect(beyond.places.map(p => p.slug)).toEqual(["lygos"]);
	});

	// Stonetop is the one place drawn on BOTH maps, so a group per tier listed it twice — under
	// both headings, both wearing the green "setting out" pill, and both lighting up when it was
	// the destination. It belongs to the closest map that draws it.
	it("lists every place exactly once", async () => {
		const data = await dialog()._buildJourney();
		const slugs = data.groups.flatMap(g => g.places.map(p => p.slug));
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.filter(s => s === "stonetop")).toHaveLength(1);
		expect(data.groups.find(g => g.places.some(p => p.slug === "stonetop")).label).toBe("The Vicinity");
	});

	// The gold heading follows the DESTINATION's group. `_activeTier` can only ever name a map, so
	// keying it to the picture meant the group holding Lygos could never take it — the highlight
	// sat on a heading that did not contain the chosen place.
	it("highlights the group holding the destination, even past the maps' edge", async () => {
		const beyond = await dialog({ destination: "lygos" })._buildJourney();
		expect(beyond.activeTier).toBe("worlds-end");
		expect(beyond.groups.find(g => g.isActive).label).toBe("Beyond the maps");

		const drawn = await dialog({ destination: "marshedge" })._buildJourney();
		expect(drawn.groups.find(g => g.isActive).label).toBe("The World's End");

		// With nothing chosen there is only the picture to follow.
		const none = await dialog()._buildJourney();
		expect(none.groups.find(g => g.isActive).label).toBe("The Vicinity");
	});

	it("offers the gazetteer only where the books give the place an entry", async () => {
		const data = await dialog()._buildJourney();
		const rows = Object.fromEntries(data.groups.flatMap(g => g.places).map(p => [p.slug, p]));
		expect(rows.marshedge.uuid).toBe("Compendium.stonetop-pwd.stonetop-journal.JournalEntry.uXlyry9CpXUz4ooR");
		// The Crossroads has no entry of its own and BORROWS the road's, which is where the books
		// describe it: The Makers' Roads carries a section headed "The Crossroads".
		expect(rows["the-crossroads"].uuid)
			.toBe("Compendium.stonetop-pwd.stonetop-journal.JournalEntry.ezquwGFbne6uxzJK");
		// Tor's Fist still opens nothing, and that is the honest answer rather than an oversight:
		// nothing in the gazetteer describes it, and a card that opens the wrong entry is worse
		// than one that opens none.
		expect(rows["tors-fist"].uuid).toBeNull();
	});

	it("hangs that link off data-link, which is what core listens for", () => {
		// Core delegates the content-link click (and drag) off `a[data-link]` and only PAINTS
		// `.content-link`. The link shipped with the class alone: it looked exactly like every
		// other compendium link in the system, carried the right UUID, and did nothing at all.
		const markup = readFileSync(
			new URL("../../templates/dialogs/partials/expedition-journey.hbs", import.meta.url), "utf8");
		const link = markup.match(/<a class="content-link stonetop-journey-book"[\s\S]*?>/)[0];
		expect(link).toContain("data-link");
		expect(link).toContain('data-uuid="{{uuid}}"');
	});
});

describe("the line showing the way they go", () => {
	/** The path's points as [left, top] pairs, in travel order. */
	const points = path => (path?.points ?? "").split(" ").filter(Boolean).map(p => p.split(",").map(Number));

	it("joins every stop that the map being shown actually draws", async () => {
		const data = await dialog({ origin: "stonetop", destination: "three-coven-lake" })._buildJourney();
		const at = slug => {
			const spot = travelPlace(slug).spots["worlds-end"];
			return [Number((spot.fx * 100).toFixed(2)), Number((spot.fy * 100).toFixed(2))];
		};
		expect(points(data.map.path)).toEqual([at("stonetop"), at("the-steplands"), at("three-coven-lake")]);
	});

	it("runs out to the edge arrow for a place past the map", async () => {
		// Lygos is drawn nowhere. Stopping the line at Marshedge would say the journey ends there.
		const data = await dialog({ destination: "lygos" })._buildJourney();
		const drawn = points(data.map.path);
		expect(drawn).toHaveLength(3);
		const arrow = data.map.exits.find(e => e.node === "lygos");
		expect(drawn.at(-1)).toEqual([Number(arrow.left.toFixed(2)), Number(arrow.top.toFixed(2))]);
	});

	it("bridges a stop the map being shown does not draw", async () => {
		// Stonetop to Tor's Fist goes via the Foothills, which the World's End map never labels.
		const data = await dialog({ destination: "tors-fist" })._buildJourney();
		expect(data.activeTier).toBe("worlds-end");
		expect(travelPlace("the-foothills").spots["worlds-end"]).toBeUndefined();
		// Two points, not three, and never a break in the line.
		expect(points(data.map.path)).toHaveLength(2);
	});

	// Bridging is for stops in the MIDDLE. Dropping a missing END silently shortens the journey to
	// somewhere it merely passes through — and plants the destination arrowhead on that stop, which
	// on this tier is an unlabelled dot.
	it("draws no line at all when the map cannot show one of the ends", async () => {
		// Tor's Fist is a World's End place; ask for the same journey on the Vicinity tab.
		const data = await dialog({ destination: "tors-fist" })._buildJourney("vicinity");
		expect(travelPlace("tors-fist").spots.vicinity).toBeUndefined();
		expect(data.map.path).toBeNull();
	});

	it("still draws when only the middle is missing", async () => {
		// The guard above must not swallow the bridging case it sits next to.
		const data = await dialog({ destination: "tors-fist" })._buildJourney("worlds-end");
		expect(data.map.path).not.toBeNull();
	});


	it("caps the head at the destination end, pointing the way they are going", async () => {
		const data = await dialog({ destination: "three-coven-lake" })._buildJourney();
		const [, mid, end] = points(data.map.path);
		const { arrow } = data.map.path;
		// It sits on the final leg, short of the pin rather than under it.
		expect(arrow.left).toBeGreaterThan(Math.min(mid[0], end[0]) - 0.01);
		expect(arrow.left).toBeLessThan(Math.max(mid[0], end[0]) + 0.01);
		expect(Math.hypot(arrow.left - end[0], arrow.top - end[1])).toBeGreaterThan(0);
	});

	it("turns by the angle the eye sees, not the angle the percentages describe", async () => {
		// The map box is wider than it is tall, so a step of 1% down is fewer pixels than 1% across.
		// Taking the angle straight off the percentages would aim every diagonal too steeply.
		const data = await dialog({ destination: "three-coven-lake" })._buildJourney();
		const [, from, to] = points(data.map.path);
		const naive = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
		const corrected = Math.atan2((to[1] - from[1]) / data.map.aspect, to[0] - from[0]) * 180 / Math.PI;
		expect(data.map.path.arrow.angle).toBeCloseTo(corrected, 1);
		expect(Math.abs(data.map.path.arrow.angle - naive)).toBeGreaterThan(1);
	});

	it("points straight along an axis, where the two angles agree", async () => {
		// A purely horizontal leg is the case the distortion cannot affect, so it pins the sign
		// convention: 0 degrees is due east, and the SVG head is drawn pointing that way.
		const d = Object.create(Object.getPrototypeOf(dialog()));
		const east = d._routeArrow({ left: 10, top: 50 }, { left: 90, top: 50 }, 1.4);
		expect(east.angle).toBe(0);
		expect(east.left).toBe(87);
		const south = d._routeArrow({ left: 50, top: 10 }, { left: 50, top: 90 }, 1.4);
		expect(south.angle).toBe(90);
	});

	it("never backs the head past the stop before it on a short last leg", async () => {
		const d = Object.create(Object.getPrototypeOf(dialog()));
		const from = { left: 50, top: 50 };
		const to = { left: 51, top: 50 };          // a 1% hop, shorter than the 3% back-off
		const arrow = d._routeArrow(from, to, 1.4);
		expect(arrow.left).toBeGreaterThan(from.left);
		expect(arrow.left).toBeLessThanOrEqual(to.left);
	});

	it("has no head to draw when the last two stops coincide", async () => {
		const d = Object.create(Object.getPrototypeOf(dialog()));
		expect(d._routeArrow({ left: 40, top: 40 }, { left: 40, top: 40 }, 1.4)).toBeNull();
	});

	it("draws nothing when fewer than two stops are on the map", async () => {
		// Looking at the Vicinity while bound for Marshedge: only the origin is drawn there.
		const d = dialog({ origin: "stonetop", destination: "marshedge" });
		d._showMapTier("vicinity");
		const data = await d._buildJourney();
		expect(data.activeTier).toBe("vicinity");
		expect(data.map.path).toBeNull();
	});

	it("draws nothing before a destination is chosen", async () => {
		expect((await dialog()._buildJourney()).map.path).toBeNull();
	});

	it("stays inside the picture, so the stroke cannot escape the frame", async () => {
		for (const destination of ["lygos", "tors-fist", "three-coven-lake", "the-ruined-tower"]) {
			const data = await dialog({ destination })._buildJourney();
			for (const [x, y] of points(data.map.path)) {
				expect(x, destination).toBeGreaterThanOrEqual(0);
				expect(x, destination).toBeLessThanOrEqual(100);
				expect(y, destination).toBeGreaterThanOrEqual(0);
				expect(y, destination).toBeLessThanOrEqual(100);
			}
		}
	});

	it("places the line against the same frame as the pins", async () => {
		// A poster scan insets the printed page, so a path measured against the whole image would
		// drift away from the very pins it connects.
		const poster = {
			"worlds-end": { out: "assets/maps/map-worlds-end.webp", src: "art/poster.webp",
				frame: frameFor("assets/maps/map-worlds-end.webp"), aspect: 2100 / 1650 },
		};
		art.resolved = new Map(Object.entries(poster));
		const data = await dialog({ destination: "marshedge" })._buildJourney();
		const marshedge = data.map.spots.find(s => s.slug === "marshedge");
		expect(points(data.map.path).at(-1))
			.toEqual([Number(marshedge.left.toFixed(2)), Number(marshedge.top.toFixed(2))]);
	});
});

describe("seeing the whole map", () => {
	// The pin layer is rendered from the shared partial; here we only care that the dialog asks for
	// it with the right tier's data and keeps an open window in step.
	beforeEach(() => {
		globalThis.renderTemplate = (path, ctx) => Promise.resolve(
			`<render path="${path}" tier="${ctx.tier}" spots="${ctx.spots.length}" `
			+ `chosen="${ctx.spots.filter(s => s.isChosen).map(s => s.slug).join()}" `
			+ `path-points="${ctx.path?.points ?? ""}">`);
	});

	it("builds for the map being shown, not for wherever the panel has moved on to", async () => {
		// A window opened on the Vicinity keeps showing the Vicinity even once the destination has
		// taken the panel out to the World's End. Building for the panel's tier would put World's
		// End pins on a Vicinity picture.
		const d = dialog({ origin: "stonetop", destination: "marshedge" });
		expect((await d._buildJourney()).activeTier).toBe("worlds-end");

		const asked = await d._buildJourney("vicinity");
		expect(asked.activeTier).toBe("vicinity");
		expect(asked.map.tier).toBe("vicinity");
		expect(asked.pins).toContain('tier="vicinity"');
		expect(asked.pins).toContain('spots="7"');      // the seven places the Vicinity draws
	});

	it("marks the chosen destination in the layer it hands the window", async () => {
		const built = await dialog({ destination: "marshedge" })._buildJourney("worlds-end");
		expect(built.pins).toContain('chosen="marshedge"');
		expect(built.pins).toMatch(/path-points="[\d.,\s]+"/);
	});

	it("renders the layer from the shared partial, so a pin cannot differ between the two", async () => {
		const built = await dialog()._buildJourney("vicinity");
		expect(built.pins).toContain("templates/dialogs/partials/expedition-journey-pins.hbs");
	});

	it("does not render a layer for the panel, which draws the partial inline", async () => {
		expect((await dialog()._buildJourney()).pins).toBe("");
	});

	// The readout's "with the days filled in" hung off `hasStops`, which is about intermediate
	// stops alone — so it told the GM the days were filled on every single-leg journey, including
	// the four from Stonetop measured only in hours, where `chartBlankValue` refuses the blank and
	// the box is left unticked. One predicate now answers for both.
	it("says the days are carried only where the checklist can actually take them", async () => {
		const hours = (await dialog({ destination: "the-red-grove" })._buildJourney()).route;
		expect(hours.hasStops).toBe(false);
		expect(hours.hasDays).toBe(false);

		const days = (await dialog({ destination: "marshedge" })._buildJourney()).route;
		expect(days.hasStops).toBe(false);
		expect(days.hasDays).toBe(true);

		const both = (await dialog({ destination: "lygos" })._buildJourney()).route;
		expect(both.hasStops).toBe(true);
		expect(both.hasDays).toBe(true);
	});

	it("hands back no layer for a map this world does not have", async () => {
		art.resolved = new Map();
		const built = await dialog()._buildJourney("vicinity");
		expect(built.map).toBeNull();
		expect(built.pins).toBe("");
	});

	it("gives the window the same controls and the same route the panel has", async () => {
		// The window renders the shared controls/route partials off this very object, so a field
		// missing here is a control missing there.
		const built = await dialog({ destination: "lygos" })._buildJourney("worlds-end");
		expect(built.originOptions.some(o => o.selected)).toBe(true);
		expect(built.tiers.map(t => t.slug)).toEqual(["vicinity", "worlds-end"]);
		expect(built.hasDestination).toBe(true);
		expect(built.route.atLeast).toBe("at least 40 days");
	});

	it("re-reads an open window after a pick made in the panel", async () => {
		const d = dialog();
		let synced = 0;
		d._mapWindows.set("worlds-end", { rendered: true, sync: () => { synced++; return Promise.resolve(); } });

		await d._setJourneyPlace("destination", "lygos");
		expect(synced).toBe(1);
	});

	// A refresh that throws must not become an unhandled rejection: v13 core installs no
	// `unhandledrejection` listener, so it would be console-only and the pick itself still landed.
	it("survives a window that throws while re-reading", async () => {
		const d = dialog();
		d._mapWindows.set("worlds-end", { rendered: true, sync: () => Promise.reject(new Error("boom")) });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await expect(d._setJourneyPlace("destination", "lygos")).resolves.toBeUndefined();
		expect(saved().journey.destination).toBe("lygos");
		vi.restoreAllMocks();
	});

	// A map window is a view of ONE trip and cannot tell when the trip changes underneath it. Left
	// open it would go on showing the old route, and a click on one of its stale pins would write a
	// destination onto whichever trip is current now.
	it("closes its windows when the trip changes, and forgets the tier tab with them", async () => {
		for (const act of ["_switchExpedition", "_startNewExpedition", "_deleteCurrentExpedition"]) {
			const d = dialog();
			let closed = 0;
			d._showMapTier("worlds-end");
			d._mapWindows.set("worlds-end", { rendered: true, close: () => { closed++; return Promise.resolve(); } });
			global.Dialog = { confirm: () => Promise.resolve(true) };

			await d[act]("trip-1");
			expect(closed, act).toBe(1);
			expect(d._mapWindows.size, act).toBe(0);
			expect(d._journeyTier, act).toBeNull();
		}
	});

	// The window keeps a `source` bound to THIS dialog, whose log draft is memoized for its own
	// lifetime — so an orphan outliving the walkthrough writes a stale whole-log snapshot back over
	// `expeditionAnswers`, discarding every note typed since it was reopened.
	it("closes its windows when the walkthrough itself closes", async () => {
		const d = dialog();
		let closed = 0;
		d._mapWindows.set("vicinity", { rendered: true, close: () => { closed++; return Promise.resolve(); } });
		// Object.create skips the Application chain, so stand in for super.close().
		Object.getPrototypeOf(ExpeditionDialog.prototype).close = () => Promise.resolve();

		await d.close();
		expect(closed).toBe(1);
		expect(d._mapWindows.size).toBe(0);
	});

	it("forgets a window the reader has closed", async () => {
		const d = dialog();
		d._mapWindows.set("vicinity", { rendered: false, sync: () => { throw new Error("closed"); } });
		await d._refreshMapWindows();
		expect(d._mapWindows.size).toBe(0);
	});

	// The window that made the pick re-reads the planner itself the moment `pick` returns. Every
	// build is a graph solve, an art browse and a template render, so leaving it in the sweep meant
	// one click on one pin solved the same journey twice.
	it("does not re-read the window the pick came from", async () => {
		const d = dialog();
		let synced = 0;
		const window = { rendered: true, sync: () => { synced++; return Promise.resolve(); } };
		d._mapWindows.set("worlds-end", window);

		await d._setJourneyPlace("destination", "lygos", window);
		expect(synced).toBe(0);
	});

	// Forgetting an in-flight open does not cancel it. The promise went on to resolve after the
	// walkthrough was gone, rendered a window nothing would ever close, and re-filled the very map
	// that had just been cleared — an orphan holding a `source` bound to a closed dialog.
	it("waits for a window still opening before it closes them", async () => {
		const d = dialog();
		let closed = 0;
		let settle;
		const app = { rendered: true, close: () => { closed++; return Promise.resolve(); } };
		// Exactly the shape `_openMapWindow` files: the chained promise, whose `.then` registers
		// the window. Resolving it AFTER _closeMapWindows starts is the race being guarded.
		const opening = new Promise(r => { settle = r; })
			.then(a => { d._mapWindows.set("vicinity", a); return a; });
		d._opening.set("vicinity", opening);

		const closing = d._closeMapWindows();
		settle(app);
		await closing;

		expect(closed).toBe(1);
		expect(d._mapWindows.size).toBe(0);
		expect(d._opening.size).toBe(0);
	});

	// The zoom button is bound as a plain `() => zoom(key)` and drops the promise, so a throw
	// anywhere in the open surfaced only as an unhandled rejection. What the GM saw was a dead
	// button.
	it("warns rather than rejecting when a window cannot be opened", async () => {
		const d = dialog();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		d._opening.set("vicinity", Promise.reject(new Error("boom")).catch(() => null));
		await expect(d._closeMapWindows()).resolves.toBeUndefined();
		vi.restoreAllMocks();
	});

	// `_mapWindows` is keyed by tier and the window's own tabs can move it out from under that key.
	it("re-keys a window that has navigated to the other map", async () => {
		const d = dialog();
		const app = { rendered: true };
		d._mapWindows.set("vicinity", app);

		d._movedMapWindow("vicinity", "worlds-end", app);
		expect(d._mapWindows.get("vicinity")).toBeUndefined();
		expect(d._mapWindows.get("worlds-end")).toBe(app);
	});

	// Two windows cannot both BE the one showing a map: they would share the DOM id openOrFocus
	// matches on, and the loser is unreachable from the panel from then on.
	it("closes the window it displaced, so no two share an id", async () => {
		const d = dialog();
		let closed = 0;
		const app = { rendered: true };
		const other = { rendered: true, close: () => { closed++; return Promise.resolve(); } };
		d._mapWindows.set("vicinity", app);
		d._mapWindows.set("worlds-end", other);

		d._movedMapWindow("vicinity", "worlds-end", app);
		await Promise.resolve();
		expect(closed).toBe(1);
		expect(d._mapWindows.get("worlds-end")).toBe(app);
	});

	it("hands the window a way to write, going through the panel's own method", async () => {
		const d = dialog();
		const source = d._mapWindowSource();
		await source.pick("destination", "marshedge");
		expect(saved().journey.destination).toBe("marshedge");
		expect(saved().chart.checks.days).toBe(true);
		expect((await source.build("vicinity")).activeTier).toBe("vicinity");
	});
});

describe("the template asks for what the dialog builds", () => {
	// A renamed context field is silent: Handlebars prints an empty string for a path that is not
	// there, so the panel would just quietly lose its map or its day counts. Nothing else catches
	// it — the partial is registered (tests/templates/partial-registration.test.js) and the step
	// still renders.
	// Every piece of the panel: its own markup plus the three partials it composes — the same
	// three the "See the whole map" window renders, which is what makes this one check cover both.
	const TEMPLATE = [
		"expedition-journey.hbs", "expedition-journey-pins.hbs",
		"expedition-journey-controls.hbs", "expedition-journey-route.hbs",
	].map(f => readFileSync(new URL(`../../templates/dialogs/partials/${f}`, import.meta.url), "utf8"))
		.join("\n");

	it("names only fields the panel actually returns", async () => {
		const data = await dialog({ origin: "stonetop", destination: "lygos" })._buildJourney();
		const asked = new Set([...TEMPLATE.matchAll(/journey\.([a-zA-Z][\w]*)/g)].map(m => m[1]));
		expect(asked.size).toBeGreaterThan(6);
		for (const key of asked) {
			expect(Object.keys(data), `the template reads journey.${key}`).toContain(key);
		}
	});

	it("names only fields a hotspot, an arrow, a leg and a row actually carry", async () => {
		const data = await dialog({ origin: "stonetop", destination: "lygos" })._buildJourney();
		// Each {{#each}} block's body, checked against one real element of that collection.
		const blocks = [
			// The pin layer's context is one `map` object, so its paths carry no prefix.
			["spots", data.map.spots[0]],
			["exits", data.map.exits[0]],
			["journey.route.legs", data.route.legs[0]],
			["journey.originOptions", data.originOptions[0]],
			["journey.groups", data.groups[0]],
			["places", data.groups[0].places[0]],
		];
		for (const [path, sample] of blocks) {
			const open = TEMPLATE.indexOf(`{{#each ${path}}}`);
			expect(open, `no {{#each ${path}}} block`).toBeGreaterThan(-1);
			const from = open + `{{#each ${path}}}`.length;
			// Stop at a NESTED each as well as at this block's close: an inner loop iterates a
			// different collection, and its fields belong to that one, not to this element.
			const nested = TEMPLATE.indexOf("{{#each ", from);
			const close = TEMPLATE.indexOf("{{/each}}", from);
			const body = TEMPLATE.slice(from, nested > -1 ? Math.min(nested, close) : close);
			// Bare {{field}} / {{#if field}} references, skipping helpers and @-data.
			const fields = new Set([...body.matchAll(/\{\{#?(?:if |unless )?([a-z][\w]*)\}\}/g)].map(m => m[1]));
			for (const field of fields) {
				if (field === "else" || field === "this") continue;
				expect(Object.keys(sample), `${path} element carries "${field}"`).toContain(field);
			}
		}
	});
});

describe("carrying the pick onto Chart a Course", () => {
	it("ticks the two requirements the route can answer, and fills the route line", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "lygos");

		expect(saved().journey).toEqual({ destination: "lygos" });
		expect(saved().chart.checks.days).toBe(true);
		expect(saved().chart.checks.firstTravel).toBe(true);
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		expect(rendered).toBe(1);
	});

	it("does not claim a first stop on a journey that has none", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "marshedge");
		expect(saved().chart.checks.days).toBe(true);
		// Explicitly false, not merely absent: the carry-forward SETS both boxes from the route
		// every time rather than only ticking them, which is what lets a change of mind untick one.
		expect(saved().chart.checks.firstTravel).toBe(false);
	});

	// Five of the eighteen destinations from Stonetop are measured only in hours, so they have
	// legs and no day count — and `fillChartBlank` refuses to fill a day count it hasn't got. A
	// tick over a requirement still reading "at least ___ days" is worse than either state alone.
	it("does not tick the days box for a journey the book measures in hours", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(saved().chart.checks.days).toBe(false);
		expect(saved().chart.checks.firstTravel).toBe(false);
	});

	// Nothing used to clear these, so a GM who changed their mind kept the previous journey's
	// ticks — and a `firstTravel` blank with no stop left to name can never be filled in.
	it("unticks what the new route cannot answer", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" }, {});
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(saved().chart.checks.days).toBe(false);
		expect(saved().chart.checks.firstTravel).toBe(false);
		expect(saved().chart.route).toBe("Stonetop to the Red Grove");
	});

	it("clears its own carried-forward answers when the destination is cleared", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" }, {});
		await d._setJourneyPlace("destination", "lygos");   // seeds chart.route
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		await d._setJourneyPlace("destination", "");
		expect(saved().chart.route).toBe("");
		expect(saved().chart.checks.days).toBe(false);
		expect(saved().chart.checks.firstTravel).toBe(false);
	});

	// "Set from the route every time" was right about the stale tick and wrong about whose tick it
	// was. A GM who ticks "they must first travel to ___" by hand — for a stop the graph does not
	// model, on a trip the route can never answer for — had it silently cleared by the next pick,
	// along with its line in the Chronicle.
	it("never unticks a box the GM ticked by hand", async () => {
		const d = dialog({ origin: "stonetop", destination: "the-red-grove" },
			{ checks: { firstTravel: true } });
		await d._setJourneyPlace("origin", "the-maw");
		expect(saved().chart.checks.firstTravel).toBe(true);
	});

	// ...and the stale tick it replaced still cannot come back, because a box WE ticked still says
	// what the old route would have made it say, and is therefore still ours to clear.
	it("still clears a tick of its own that the new route cannot answer", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" },
			{ checks: { days: true, firstTravel: true } });
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(saved().chart.checks.days).toBe(false);
		expect(saved().chart.checks.firstTravel).toBe(false);
	});

	it("never overwrites what the GM typed", async () => {
		const d = dialog(null, { route: "We follow the tracks north." });
		await d._setJourneyPlace("destination", "lygos");
		expect(saved().chart.route).toBe("We follow the tracks north.");
		expect(saved().chart.checks.days).toBe(true);
	});

	it("ticks nothing for a destination the book gives no time to", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "");
		expect(saved().journey.destination).toBe("");
		expect(saved().chart).toBeUndefined();
	});

	it("reads the new pick, not the draft it is replacing", async () => {
		// ensureCurrent hands back a deep copy, so the draft still holds the old value while this
		// runs. Getting that wrong would tick the boxes for the PREVIOUS destination.
		const d = dialog({ origin: "stonetop", destination: "the-red-grove" }, {});
		await d._setJourneyPlace("destination", "lygos");
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		expect(saved().chart.checks.firstTravel).toBe(true);
	});

	it("re-solves from a changed origin", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" }, {});
		await d._setJourneyPlace("origin", "marshedge");
		// Standing in Marshedge, Lygos is the printed 30-day leg with nothing before it.
		expect(saved().chart.route).toBe("Marshedge to Lygos");
		expect(saved().chart.checks.firstTravel).toBe(false);
	});
});

describe("the Chart a Course blanks", () => {
	/** The chart step's checklist, as the template receives it. */
	function chartItems(d) {
		const step = d._steps.find(s => s.key === "chart");
		return Object.fromEntries(d._qaContext(step.qa).groups
			.flatMap(g => g.items).map(it => [it.path.split(".").pop(), it.text]));
	}

	it("fills the days and the first stop from the plotted route", () => {
		const items = chartItems(dialog({ origin: "stonetop", destination: "lygos" }));
		expect(items.days).toBe("It'll take at least 40 days (and a corresponding amount of supplies)");
		expect(items.firstTravel).toBe("First travel to Marshedge, and from there to your destination");
	});

	it("leaves the blanks as authored when no journey is plotted", () => {
		const items = chartItems(dialog());
		expect(items.days).toContain("___");
		expect(items.firstTravel).toContain("___");
	});

	it("leaves every other requirement exactly as authored", () => {
		const plotted = chartItems(dialog({ destination: "lygos" }));
		const blank = chartItems(dialog());
		for (const key of Object.keys(blank)) {
			if (key === "days" || key === "firstTravel") continue;
			expect(plotted[key], key).toBe(blank[key]);
		}
	});
});
