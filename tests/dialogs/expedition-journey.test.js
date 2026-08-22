import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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
const { offMapNote, routeArrow, routeLegs, routePath } = await import("../../module/utils/route-path.js");
const { offMapNames, showRouteOnScene } = await import("../../module/utils/scene-route.js");

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
		// tests/setup.js installs a localizer backed by the real languages/en.json, and this
		// override would otherwise drop it. The route's copy lives in that file now, so keeping
		// it is what lets these tests go on asserting the sentences a GM actually reads — and
		// makes a key that is missing from en.json fail here rather than ship as raw dotted text.
		i18n: global.game.i18n,
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
	/** The stops the path visits as [left, top] pairs, in travel order: its M, then every Q's end. */
	const points = path => [...(path?.d ?? "").matchAll(/(?:^M|Q [\d.-]+,[\d.-]+) ([\d.-]+),([\d.-]+)/g)]
		.map(m => [Number(m[1]), Number(m[2])]);

	/** Each leg's control point, which is where its bow lives. */
	const controls = path => [...(path?.d ?? "").matchAll(/Q ([\d.-]+),([\d.-]+)/g)]
		.map(m => [Number(m[1]), Number(m[2])]);

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

	// SYNTHETIC, and it did not use to be: Stonetop to Tor's Fist goes via the Foothills, which the
	// World's End does not letter, and that was this case. The Foothills has since been given an
	// anchor there (see `spots` in travel-times.js), so no journey the graph can solve now has a
	// stop the map cannot place. The behaviour still has to hold for the next place that does.
	it("bridges a stop the map being shown does not draw", () => {
		const route = { legs: [
			{ from: "stonetop", to: "nowhere-at-all" },
			{ from: "nowhere-at-all", to: "marshedge" },
		] };
		const path = routePath(route, "worlds-end", PRINTED["worlds-end"].frame, PRINTED["worlds-end"].aspect);
		// Two points, not three, and never a break in the line.
		expect(points(path)).toHaveLength(2);
		expect(path.d.split("M")).toHaveLength(2);
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

	it("still draws when only the middle is missing", () => {
		// The guard above must not swallow the bridging case it sits next to. Synthetic for the
		// same reason as that one.
		const route = { legs: [
			{ from: "stonetop", to: "nowhere-at-all" },
			{ from: "nowhere-at-all", to: "marshedge" },
		] };
		expect(routePath(route, "worlds-end", PRINTED["worlds-end"].frame, PRINTED["worlds-end"].aspect))
			.not.toBeNull();
	});


	// A ruled line pin to pin says the way runs exactly there, which is the one thing a schematic
	// over a hand-drawn map cannot know. Each leg bows a little instead.
	it("bends every leg instead of ruling it straight", async () => {
		const data = await dialog({ destination: "three-coven-lake" })._buildJourney();
		const stops = points(data.map.path);
		const bends = controls(data.map.path);
		expect(data.map.path.d.startsWith(`M ${stops[0][0].toFixed(2)},${stops[0][1].toFixed(2)} Q `)).toBe(true);
		expect(bends).toHaveLength(stops.length - 1);
		// A control point sitting on the midpoint of its chord IS the ruled line it replaced.
		bends.forEach((bend, i) => {
			const [from, to] = [stops[i], stops[i + 1]];
			const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
			expect(Math.hypot(bend[0] - mid[0], bend[1] - mid[1])).toBeGreaterThan(0.5);
		});
	});

	it("alternates the bend, so consecutive legs meet without a kink", async () => {
		// A quadratic leaves its first stop turned toward its control point and reaches its second
		// turned as far the other way, so bowing both legs to the same side would put a corner on
		// a middle stop the journey walks straight through.
		const [first, second] = routeLegs(
			[{ left: 0, top: 50 }, { left: 50, top: 50 }, { left: 100, top: 50 }], 1.4);
		const arriving = [first.to.left - first.control.left, first.to.top - first.control.top];
		const leaving = [second.control.left - second.from.left, second.control.top - second.from.top];
		expect(leaving[0]).toBeCloseTo(arriving[0], 6);
		expect(leaving[1]).toBeCloseTo(arriving[1], 6);
		// ...and they are bowed, on opposite sides of the line the two of them share.
		expect(Math.sign(first.control.top - 50)).toBe(-Math.sign(second.control.top - 50));
	});

	it("bows as deeply on a leg running north as on one running east", async () => {
		// The same correction the heads' angle needs: 1% down is fewer pixels than 1% across, so a
		// bow measured in raw percentages would be flat on one axis and fat on the other. These two
		// legs are the same length on screen, so they must bow the same distance on screen.
		const [east] = routeLegs([{ left: 30, top: 50 }, { left: 70, top: 50 }], 1.4);
		const [south] = routeLegs([{ left: 50, top: 22 }, { left: 50, top: 78 }], 1.4);
		expect(Math.abs(east.control.top - 50) / 1.4).toBeCloseTo(Math.abs(south.control.left - 50), 6);
	});

	it("caps the bend, so a long leg does not balloon", async () => {
		const depth = leg => Math.abs(leg.control.top - 50);
		const [across] = routeLegs([{ left: 0, top: 50 }, { left: 100, top: 50 }], 1.4);
		const [long] = routeLegs([{ left: 20, top: 50 }, { left: 80, top: 50 }], 1.4);
		const [short] = routeLegs([{ left: 45, top: 50 }, { left: 55, top: 50 }], 1.4);
		// Past the cap two legs of different lengths bow alike; a short hop stays shallower.
		expect(depth(across)).toBeCloseTo(depth(long), 6);
		expect(depth(short)).toBeLessThan(depth(long));
	});

	// Where each head SITS is proven once, over every one of them, by "puts a head on every leg"
	// below — this asserted the same three things about the last of them and failed with it.
	// What is left here is the one thing that test does not say: the head on the end belongs to
	// the final leg rather than to some earlier one, which is what makes it the destination's.
	it("hangs the last head on the final leg, so it is the destination's", async () => {
		const data = await dialog({ destination: "three-coven-lake" })._buildJourney();
		const legs = data.map.path.legs;
		const arrow = data.map.path.arrows.at(-1);
		const end = legs.at(-1).to;
		expect(Math.hypot(arrow.left - end.left, arrow.top - end.top))
			.toBeLessThan(Math.hypot(arrow.left - legs[0].from.left, arrow.top - legs[0].from.top));
	});

	it("turns by the angle the eye sees, not the angle the percentages describe", async () => {
		// The map box is wider than it is tall, so a step of 1% down is fewer pixels than 1% across.
		// Taking the angle straight off the percentages would aim every diagonal too steeply.
		//
		// A leg whose control point sits ON its chord is a straight one, which is what isolates
		// that correction from the turn a bowed leg adds to it.
		const from = { left: 20, top: 20 };
		const to = { left: 60, top: 70 };
		const straight = { from, to, control: { left: 40, top: 45 } };
		const naive = Math.atan2(to.top - from.top, to.left - from.left) * 180 / Math.PI;
		const corrected = Math.atan2((to.top - from.top) / 1.4, to.left - from.left) * 180 / Math.PI;
		expect(routeArrow(straight, 1.4).angle).toBeCloseTo(corrected, 1);
		expect(Math.abs(routeArrow(straight, 1.4).angle - naive)).toBeGreaterThan(1);
	});

	// The head is a fixed shape pinned at one point, so it can only be right if it takes its angle
	// from the curve where it sits. Off the chord instead, it would sit visibly askew on the line.
	it("lies along the curve where it sits, not along the chord", async () => {
		const stops = [{ left: 20, top: 20 }, { left: 60, top: 70 }];
		const [bowed] = routeLegs(stops, 1.4);
		const straight = { ...bowed, control: { left: 40, top: 45 } };
		expect(routeArrow(bowed, 1.4).angle).not.toBeCloseTo(routeArrow(straight, 1.4).angle, 1);
	});

	// A head on the far end alone says where the journey stops, not which way it is walked. The
	// dots between the stops are evenly spaced and identical in both directions, so on a route
	// that changes heading the middle of the line says nothing at all about the order of it.
	it("puts a head on every leg, so each stretch says which way it is walked", async () => {
		const data = await dialog({ destination: "three-coven-lake" })._buildJourney();
		const drawn = points(data.map.path);
		const { arrows } = data.map.path;
		expect(drawn).toHaveLength(3);
		expect(arrows).toHaveLength(2);
		// Each head sits on its own leg, short of the stop that leg arrives at.
		arrows.forEach((head, i) => {
			const [from, to] = [drawn[i], drawn[i + 1]];
			const toEnd = Math.hypot(head.left - to[0], head.top - to[1]);
			expect(toEnd).toBeGreaterThan(0);
			expect(toEnd).toBeLessThan(5);
			expect(Math.hypot(head.left - from[0], head.top - from[1])).toBeGreaterThan(toEnd);
		});
	});

	// The one on the end is the destination and should read as it; the rest are only direction.
	it("flags the heads short of a waypoint, and not the one on the destination", async () => {
		const { arrows } = (await dialog({ destination: "three-coven-lake" })._buildJourney()).map.path;
		expect(arrows.map(a => a.waypoint)).toEqual([true, false]);
	});

	it("has one head, unflagged, on a journey drawn as a single leg", async () => {
		const { arrows } = (await dialog({ destination: "the-red-grove" })._buildJourney()).map.path;
		expect(arrows).toHaveLength(1);
		expect(arrows[0].waypoint).toBe(false);
	});

	it("points along an axis in the sense the SVG head is drawn", async () => {
		// The sign convention: 0 degrees is due east, and the head is drawn pointing that way. Its
		// leg bows, so by the far end the head is already turning back toward the chord — east and
		// a little south of it, never the other way about.
		const [east] = routeLegs([{ left: 10, top: 50 }, { left: 90, top: 50 }], 1.4);
		const head = routeArrow(east, 1.4);
		// The bow is perpendicular to the leg, so on a due-east one it never moves the head across.
		expect(head.left).toBe(87);
		expect(head.angle).toBeGreaterThan(0);
		expect(head.angle).toBeLessThan(20);
		const [south] = routeLegs([{ left: 50, top: 10 }, { left: 50, top: 90 }], 1.4);
		expect(routeArrow(south, 1.4).angle).toBeGreaterThan(90);
		expect(routeArrow(south, 1.4).angle).toBeLessThan(110);
	});

	it("never backs the head past the stop before it on a short last leg", async () => {
		// A 1% hop, shorter than the 3% back-off.
		const [leg] = routeLegs([{ left: 50, top: 50 }, { left: 51, top: 50 }], 1.4);
		const arrow = routeArrow(leg, 1.4);
		expect(arrow.left).toBeGreaterThan(50);
		expect(arrow.left).toBeLessThanOrEqual(51);
	});

	it("has no head to draw when the last two stops coincide", async () => {
		const [leg] = routeLegs([{ left: 40, top: 40 }, { left: 40, top: 40 }], 1.4);
		expect(routeArrow(leg, 1.4)).toBeNull();
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
			// The control points as well as the stops: a leg's bow reaches out past its chord, and
			// on a leg run along an edge that is the part that would leave the frame first.
			for (const [x, y] of [...points(data.map.path), ...controls(data.map.path)]) {
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

describe("the outer map draws the inner map's journeys", () => {
	// THE BUG THIS FIXES. Six places are lettered on the Vicinity alone, so choosing one and then
	// opening the World's End took the whole route line away: `routePath` will not bridge a
	// missing END, and the destination had no position on that map. They now carry an `anchor`
	// spot there, which is a position and nothing else.
	const INNER = ["the-crossroads", "the-maw", "the-red-grove", "cave-bears-den",
		"the-ruined-tower", "the-foothills"];

	it("draws the way to every place the Vicinity letters alone", async () => {
		for (const destination of INNER) {
			const data = await dialog({ origin: "stonetop", destination })._buildJourney("worlds-end");
			expect(data.map.path, destination).not.toBeNull();
			expect(data.map.offMap, destination).toBeNull();
		}
	});

	// An anchor is a position, NOT a pin. Counting it as one would put six unlettered hotspots in a
	// knot on top of Stonetop's own, and six overlapping Notes on every GM's World's End Scene,
	// since module/utils/map-pins.js builds those from the same list.
	it("gives them no pin on the outer map", async () => {
		const data = await dialog({ origin: "stonetop", destination: "the-red-grove" })
			._buildJourney("worlds-end");
		const drawn = new Set(data.map.spots.map(spot => spot.slug));
		for (const slug of INNER) expect(drawn, slug).not.toContain(slug);
		expect(drawn).toContain("stonetop");
	});

	// The list still files them under the map that LETTERS them, which is also the map drawn at
	// the scale those journeys actually happen on.
	it("leaves them listed under the Vicinity", async () => {
		const data = await dialog()._buildJourney();
		const vicinity = data.groups.find(g => g.slug === "vicinity");
		for (const slug of INNER) {
			expect(vicinity.places.map(place => place.slug), slug).toContain(slug);
		}
	});

	// The line ends ON the anchor rather than somewhere near it: placing that far end is the whole
	// of what an anchor is for.
	it("ends the line on the anchor itself", async () => {
		const data = await dialog({ origin: "stonetop", destination: "the-red-grove" })
			._buildJourney("worlds-end");
		const spot = travelPlace("the-red-grove").spots["worlds-end"];
		// The last point the path arrives at: its final Q's endpoint.
		const last = data.map.path.d.split(" ").slice(-1)[0].split(",").map(Number);
		expect(last).toEqual([Number((spot.fx * 100).toFixed(2)), Number((spot.fy * 100).toFixed(2))]);
	});
});

describe("saying why a map has no line on it", () => {
	// The refusal to bridge a missing END is right, and it was also SILENT: the map read as having
	// forgotten the trip rather than as being unable to draw it. It still happens on the INNER map,
	// which letters none of the World's End's own places.
	it("names the end this map cannot draw, and the map that can", async () => {
		const data = await dialog({ origin: "stonetop", destination: "marshedge" })
			._buildJourney("vicinity");
		expect(data.map.path).toBeNull();
		expect(data.map.offMap).toMatchObject({
			names: ["Marshedge"], other: "worlds-end", otherName: "The World's End",
		});
		// The sentence the readout prints, written from en.json rather than in the partial.
		expect(data.map.offMap.sentence)
			.toBe("This map doesn't draw Marshedge, so the way there isn't on it.");
		expect(data.map.offMap.showLabel).toBe("Show The World's End");
	});

	it("names both ends when this map can draw neither", async () => {
		// Two World's End places asked for on the Vicinity: it draws neither, and the note has to
		// say so about the pair rather than picking one of them to blame.
		const data = await dialog({ origin: "marshedge", destination: "titan-bones" })
			._buildJourney("vicinity");
		expect(data.map.path).toBeNull();
		expect(data.map.offMap.names).toEqual(["Marshedge", "Titan Bones"]);
		expect(data.map.offMap.sentence).toContain("Marshedge & Titan Bones");
		expect(data.map.offMap.other).toBe("worlds-end");
	});

	it("says nothing at all when the line is drawn", async () => {
		const data = await dialog({ origin: "stonetop", destination: "three-coven-lake" })
			._buildJourney("worlds-end");
		expect(data.map.path).not.toBeNull();
		expect(data.map.offMap).toBeNull();
	});

	it("says nothing before a destination is chosen", async () => {
		expect((await dialog()._buildJourney()).map.offMap).toBeNull();
	});

	// The note must not report a stop the line BRIDGES: that one is not why there is no line, and
	// naming it would send the reader after the wrong map. Synthetic, for the reason set out over
	// the bridging test further up.
	it("says nothing about a missing stop in the middle", () => {
		const route = { legs: [
			{ from: "stonetop", to: "marshedge" },
			{ from: "marshedge", to: "the-red-grove" },
		] };
		expect(offMapNote("vicinity", route)).toBeNull();
	});

	// The fallback for a journey no single map can draw. Nothing in the books reaches it today,
	// because the World's End can now place every place there is. It stays because `other` is a
	// lookup that can come back empty, and without this the note would offer a button naming no
	// map at all.
	it("offers no other map when none draws both ends", () => {
		const route = { legs: [{ from: "atlantis", to: "narnia" }] };
		const note = offMapNote("worlds-end", route);
		expect(note.other).toBeNull();
		expect(note.otherName).toBeNull();
		// The bare array: `offMapNote` does geometry, and the joining is offMapNames' job --
		// through `joinNames`, the system's one list-joiner, so this reads like every other
		// "you got A, B & C" line in the system rather than wording its own pair.
		expect(note.names).toEqual(["atlantis", "narnia"]);
		expect(offMapNames(note)).toBe("atlantis & narnia");
		expect(offMapNames({ names: ["a", "b", "c"] })).toBe("a, b & c");
	});

	// The note is rendered by the shared route partial, so BOTH surfaces get it: the walkthrough
	// under its map and the "See the whole map" window under its viewport.
	it("is carried by the readout both surfaces draw", () => {
		const route = readFileSync(
			new URL("../../templates/dialogs/partials/expedition-journey-route.hbs", import.meta.url), "utf8");
		expect(route).toContain("journey.map.offMap");
		// The partial prints the finished sentence and the button's label; the wording itself is
		// in en.json and is built in ExpeditionDialog._offMapReadout, so what the template must
		// still carry is those two fields and the tier the button switches to.
		for (const field of ["sentence", "other", "showLabel"]) {
			expect(route, field).toContain("journey.map.offMap." + field);
		}
	});

	// The button that switches map is bound in journey-controls.js, which exists so that adding a
	// control means editing ONE place rather than remembering both surfaces. A class the binder
	// does not know is a button that reads as live and does nothing.
	it("binds the switch-map button through the shared binder", () => {
		const controls = readFileSync(
			new URL("../../module/dialogs/journey-controls.js", import.meta.url), "utf8");
		expect(controls).toContain("stonetop-journey-elsewhere");
	});
});

describe("seeing the whole map", () => {
	// The pin layer is rendered from the shared partial; here we only care that the dialog asks for
	// it with the right tier's data and keeps an open window in step.
	//
	// PUT BACK AFTERWARDS. This stub takes a pin-layer context and reads `ctx.spots` off it, so a
	// later block that renders any OTHER template through the same global gets a TypeError from a
	// stub that was never meant for it. Leaving it in place made the file order-dependent in a way
	// nothing announced.
	const real = globalThis.renderTemplate;
	beforeEach(() => {
		globalThis.renderTemplate = (path, ctx) => Promise.resolve(
			`<render path="${path}" tier="${ctx.tier}" spots="${ctx.spots.length}" `
			+ `chosen="${ctx.spots.filter(s => s.isChosen).map(s => s.slug).join()}" `
			+ `path-d="${ctx.path?.d ?? ""}">`);
	});
	afterEach(() => { globalThis.renderTemplate = real; });

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
		expect(built.pins).toMatch(/path-d="M [\d.,\s]+ Q [\d.,\s-]+"/);
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

// Putting the route on the table's own map. The check itself lives in utils/scene-route.js and is
// proven in tests/utils/scene-route.test.js; what is covered here is the dialog's half of it -
// which button the GM is shown, and what pressing it does to the scene they are looking at.
describe("drawing the route on the scene", () => {
	/** A poster-map Scene stand-in, with the flag API the writer needs. */
	function scene(slug = "vicinity", { name = null, width = 6000, height = 4714 } = {}) {
		const doc = {
			id: `scene-${slug}`,
			name: name ?? (slug === "vicinity" ? "The Vicinity" : "The World's End"),
			width, height,
			flags: { "stonetop-pwd": slug ? { posterMap: slug } : {} },
			// `update` rather than the flag helpers: the route is written and cleared through
			// explicit `flags.<scope>.<key>` paths so it can reach a scope core would refuse to
			// validate, which is what a rename of this package leaves behind. Dotted paths and
			// the `-=` deletion key are the whole of what those writes need.
			update: async (changes) => {
				for (const [path, value] of Object.entries(changes ?? {})) {
					const parts = path.split(".");
					const key = parts.pop();
					let node = doc;
					for (const part of parts) node = (node[part] ??= {});
					if (key.startsWith("-=")) delete node[key.slice(2)];
					else node[key] = value;
				}
			},
		};
		return doc;
	}

	/** Put a scene on the canvas and in the world, and catch what the GM is told. */
	function onCanvas(doc, others = []) {
		globalThis.canvas = { scene: doc };
		game.scenes = [doc, ...others];
		const said = { info: [], warn: [] };
		global.ui = {
			notifications: {
				info: msg => said.info.push(msg),
				warn: msg => said.warn.push(msg),
				error: () => {},
			},
		};
		return said;
	}

	afterEach(() => { delete globalThis.canvas; });

	it("offers no button until there is somewhere to go", async () => {
		onCanvas(scene());
		expect((await dialog()._buildJourney()).scene).toBeNull();
	});

	// It writes a Scene flag, which a player cannot do. A control that is visibly there and
	// refuses on click is worse than one that never offered; the line still SHOWS for them.
	it("offers no button to a player", async () => {
		onCanvas(scene());
		game.user.isGM = false;
		expect((await dialog({ destination: "the-crossroads" })._buildJourney()).scene).toBeNull();
	});

	// `canvasReady` fires on every scene switch, and a full redraw of the walkthrough (plus every
	// open map window) is expensive. The button is the only thing on either surface that turns on
	// the canvas, so a switch that leaves it saying the same thing must cost nothing — and one
	// that changes it must still redraw, which is the half worth guarding.
	describe("redrawing when the canvas moves under it", () => {
		/** A dialog that counts its own renders, with the canvas watch's bookkeeping primed. */
		function watched(dest = "the-crossroads") {
			const d = dialog({ destination: dest });
			d.rendered = true;
			let renders = 0;
			d.render = () => { renders += 1; };
			d._refreshMapWindows = async () => {};
			// Parked on the step that carries the button; which step it is is not what is under
			// test here, and the real stepper needs more of a dialog than this harness builds.
			d._stepNav = () => ({ step: { journey: true } });
			// What the panel was last drawn with, the way a real render stamps it.
			d._sceneRouteShowing();
			return { d, count: () => renders };
		}

		it("does nothing when the new scene says what the old one did", () => {
			onCanvas(scene());
			const { d, count } = watched();
			d._sceneChanged();
			expect(count()).toBe(0);
			// A second scene that also carries no route: still nothing to redraw.
			globalThis.canvas = { scene: scene("worlds-end") };
			d._sceneChanged();
			expect(count()).toBe(0);
		});

		it("redraws when the scene it walked onto is showing this very journey", async () => {
			const carrying = scene();
			onCanvas(carrying);
			const { d, count } = watched();
			// Another GM drew it, so the button must flip from "Draw" to "Take it off".
			await showRouteOnScene(carrying, { origin: "stonetop", destination: "the-crossroads" });
			d._sceneChanged();
			expect(count()).toBe(1);
			expect(d._sceneShowing).toBe(true);
		});
	});

	it("offers to draw it when the scene has no route on it", async () => {
		onCanvas(scene());
		const { scene: button } = await dialog({ destination: "the-crossroads" })._buildJourney();
		expect(button.showing).toBe(false);
		expect(button.label).toBe("Draw it on the scene");
	});

	// The label follows THIS reader's canvas, not the map tab showing in the panel: the two come
	// apart constantly, and a button offering to draw a line already on the map is a lie.
	it("offers to take it off once this very journey is on the scene", async () => {
		const doc = scene();
		onCanvas(doc);
		const d = dialog({ destination: "the-crossroads" });
		await d._putRouteOnScene();
		const { scene: button } = await d._buildJourney();
		expect(button.showing).toBe(true);
		expect(button.label).toBe("Take it off the scene");
	});

	it("stores the two slugs on the scene and says where the way now runs", async () => {
		const doc = scene();
		const said = onCanvas(doc);
		await dialog({ destination: "the-crossroads" })._putRouteOnScene();
		expect(doc.flags["stonetop-pwd"].expeditionRoute)
			.toMatchObject({ origin: "stonetop", destination: "the-crossroads" });
		expect(said.info[0]).toContain("the Crossroads");
		expect(said.info[0]).toContain("The Vicinity");
	});

	it("takes it back off on a second press", async () => {
		const doc = scene();
		const said = onCanvas(doc);
		const d = dialog({ destination: "the-crossroads" });
		await d._putRouteOnScene();
		await d._putRouteOnScene();
		expect(doc.flags["stonetop-pwd"].expeditionRoute).toBeUndefined();
		expect(said.info.at(-1)).toContain("off The Vicinity");
	});

	// The whole point of the alert. "Nothing happened" is the one answer none of the refusals
	// deserve, and the map that WOULD take it is the only part of a no the GM can act on.
	it("says why, and writes nothing, when the scene is no map of ours", async () => {
		const doc = scene(null, { name: "The Barrow", width: 4000, height: 3000 });
		const said = onCanvas(doc, [scene("vicinity")]);
		await dialog({ destination: "the-crossroads" })._putRouteOnScene();
		expect(doc.flags["stonetop-pwd"].expeditionRoute).toBeUndefined();
		expect(said.info).toHaveLength(0);
		expect(said.warn[0]).toContain("The Vicinity");
	});

	it("says which end the scene's map cannot place", async () => {
		const said = onCanvas(scene("vicinity"), [scene("worlds-end")]);
		await dialog({ destination: "tors-fist" })._putRouteOnScene();
		expect(said.warn[0]).toContain("The World's End");
	});

	// The panel is on the World's End and the table is on the Vicinity, which is the ordinary
	// state of things. Most journeys are drawable on either, and refusing because the two windows
	// disagreed would be refusing something that plainly works.
	it("draws for the scene the reader is on, not for the map tab the panel is showing", async () => {
		const doc = scene("worlds-end");
		const said = onCanvas(doc);
		const d = dialog({ destination: "the-crossroads" });
		d._showMapTier("vicinity");
		await d._putRouteOnScene();
		expect(doc.flags["stonetop-pwd"].expeditionRoute).toBeTruthy();
		expect(said.info[0]).toContain("The World's End");
	});

	it("puts the button in the markup both surfaces render", async () => {
		onCanvas(scene());
		const journey = await dialog({ destination: "the-crossroads" })._buildJourney();
		const html = await renderTemplate(
			"systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-controls.hbs", { journey });
		expect(html).toContain("stonetop-journey-to-scene");
		expect(html).toContain("Draw it on the scene");
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
			["path.arrows", data.map.path.arrows[0]],
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
