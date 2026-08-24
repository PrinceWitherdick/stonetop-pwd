import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readCss, ownRule, declarations, readRepo as read } from "../fakes/css.js";

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

// The GM's own sites, marked on the same maps. Their storage is proven in
// tests/sites/site-map-spots.test.js and their chooser opens a dialog, so both are faked here:
// what this suite covers is the panel's own share — the arithmetic that turns a stored fraction
// into a hotspot, and the order the two gestures happen in.
const sites = { onMap: [], chosen: null, placeCalls: [], liftCalls: [] };
// Only the reads: writing a spot is inside the gesture, which is faked whole below. Both of them,
// because a site pin now answers a tap as well as being drawn — `placedSiteSpot` is what the tap
// looks its own recorded fraction up through, across every tier rather than one.
vi.mock("../../module/sites/site-map-spots.js", () => ({
	sitesOnMap: (_steading, tier) => sites.onMap.filter(s => s.spot.tier === tier),
	placedSiteSpot: (_steading, uuid) => sites.onMap.find(s => s.page.uuid === uuid) ?? null,
}));
// The gesture itself (choose, aim, write) is proven in tests/sites/place-site-on-map.test.js,
// where it now lives. What is left for this suite is the dialog's own share: that it delegates,
// and that it redraws both surfaces afterwards only when something actually moved.
vi.mock("../../module/sites/place-site-on-map.js", () => ({
	chooseSiteForMap: () => Promise.resolve(sites.chosen),
	placeSiteOnMap: surface => { sites.placeCalls.push(surface); return Promise.resolve(!!sites.chosen); },
	liftSiteOffMap: uuid => { sites.liftCalls.push(uuid); return Promise.resolve(!!sites.chosen); },
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { chartPicked, chartGroupOf } = await import("../../module/dialogs/expedition-data.js");
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
	sites.onMap = [];
	sites.chosen = null;
	sites.placeCalls = [];
	sites.liftCalls = [];
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
	// AFTER Chart a Course: the move is what the players trigger, and the route is the GM working
	// out the answer. The two travel-time requirements on the checklist are filled in from the
	// pick made here, in both directions (see _carryToChart), so a GM who charts first and picks
	// second comes back to a checklist that has filled itself in.
	it("is one step, and comes after Chart a Course", () => {
		const steps = Object.create(ExpeditionDialog.prototype)._steps;
		const journeys = steps.filter(s => s.journey);
		expect(journeys).toHaveLength(1);
		expect(steps.indexOf(journeys[0])).toBeGreaterThan(steps.findIndex(s => s.key === "chart"));
	});

	it("carries a title short enough for the rail, and its own icon", () => {
		const step = Object.create(ExpeditionDialog.prototype)._steps.find(s => s.journey);
		expect(step.title.length).toBeLessThanOrEqual(20);
		expect(step.icon).toMatch(/^fa-/);
	});
});

/** A trip with no hand-drawn way on it, which every stored journey now reads back carrying. */
const NO_DRAWN_WAY = { on: false, tier: null, points: [] };
/** And where it sets out from, read back whole: a place the books letter, or a mark on one map. */
const startingAt = slug => ({ slug, tier: null, fx: null, fy: null });

describe("what the trip remembers", () => {
	it("sets out from home until told otherwise", () => {
		expect(dialog()._journeyPick()).toEqual({
			origin: "stonetop", start: startingAt("stonetop"), destination: null, custom: NO_DRAWN_WAY,
		});
	});

	it("keeps a saved pick", () => {
		expect(dialog({ origin: "marshedge", destination: "lygos" })._journeyPick()).toEqual({
			origin: "marshedge", start: startingAt("marshedge"), destination: "lygos", custom: NO_DRAWN_WAY,
		});
	});

	// The far end of a trip has always been able to be anywhere. This is the near end catching up:
	// a point on one of the books' maps, stored as the fraction it is, with `origin` null because
	// there is no place to name. See module/utils/journey-start.js.
	it("keeps a start the GM put down on the map by hand", () => {
		const pick = dialog({ origin: { tier: "vicinity", fx: 0.42, fy: 0.55 }, destination: "marshedge" })._journeyPick();
		expect(pick.origin).toBeNull();
		expect(pick.start).toEqual({ slug: null, tier: "vicinity", fx: 0.42, fy: 0.55 });
	});

	// A fraction with no picture to be a fraction OF is not a position, and honouring one would put
	// the party wherever the reader happened to be looking.
	it("falls back to home for a mark whose map it has never heard of", () => {
		expect(dialog({ origin: { tier: "atlantis", fx: 0.4, fy: 0.4 } })._journeyPick().origin).toBe("stonetop");
		expect(dialog({ origin: { tier: "vicinity", fx: 1.4, fy: 0.4 } })._journeyPick().origin).toBe("stonetop");
	});

	it("treats a place you are already standing in as no destination", () => {
		// Otherwise the readout would show a route with no legs and a total of nothing.
		expect(dialog({ origin: "marshedge", destination: "marshedge" })._journeyPick().destination).toBeNull();
		expect(dialog({ origin: "marshedge", destination: "marshedge" })._journeyRoute()).toBeNull();
	});

	it("falls back to home when the stored slug is not a place any more", () => {
		expect(dialog({ origin: "atlantis", destination: "narnia" })._journeyPick()).toEqual({
			origin: "stonetop", start: startingAt("stonetop"), destination: null, custom: NO_DRAWN_WAY,
		});
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

	// ── The map a pick leaves you on ────────────────────────────────────────────
	//
	// A pick used to hand the map back to `_activeTier` outright, which reads as the panel taking
	// the map away: every place the Vicinity letters is also drawn on the World's End, so a GM
	// planning on the continental map and tapping the Red Grove was moved in to a picture they had
	// not asked for, at a scale that hides the rest of the country they were planning across.
	describe("after a pick", () => {
		/** A panel that has been drawn once, so it knows which map the reader is looking at. */
		const showing = async (journey, tier = null) => {
			const d = dialog(journey);
			if (tier) d._showMapTier(tier);
			await d._buildJourney();
			return d;
		};

		it("stays on the World's End when the World's End can still show the trip", async () => {
			const d = await showing({ origin: "stonetop", destination: "marshedge" }, "worlds-end");
			await d._setJourneyPlace("destination", "the-red-grove");
			expect(d._activeTier("stonetop", "the-red-grove")).toBe("worlds-end");
		});

		// The case a pinned tab cannot account for: this reader never clicked one. They were taken
		// to the World's End by the LAST pick, and have as much claim to the map in front of them.
		it("stays put even when no tab was ever clicked", async () => {
			const d = await showing({ origin: "stonetop", destination: "marshedge" });
			expect(d._shownTier).toBe("worlds-end");
			await d._setJourneyPlace("destination", "the-foothills");
			expect(d._activeTier("stonetop", "the-foothills")).toBe("worlds-end");
		});

		// The other half of the same rule, and the reason it is a rule rather than "never move":
		// the Vicinity has no Marshedge, so staying would leave the reader on a map with no line
		// on it and no pin for where they are bound.
		it("moves out when the map on screen cannot show the new trip", async () => {
			const d = await showing({ origin: "stonetop", destination: "the-red-grove" }, "vicinity");
			await d._setJourneyPlace("destination", "marshedge");
			expect(d._journeyTier).toBeNull();
			expect(d._activeTier("stonetop", "marshedge")).toBe("worlds-end");
		});

		// BOTH ends, not just the far one. A GM on the Vicinity who sets out from Marshedge has an
		// origin the Vicinity cannot draw: no green "setting out" pin anywhere, and no route line,
		// because `routePath` refuses a journey with an end this map cannot place.
		it("moves out when the new ORIGIN is the end this map cannot draw", async () => {
			const d = await showing({ origin: "stonetop", destination: "the-red-grove" }, "vicinity");
			await d._setJourneyPlace("origin", "marshedge");
			expect(d._journeyTier).toBeNull();
		});

		it("keeps the reader on the Vicinity for a trip drawn on both", async () => {
			const d = await showing({ origin: "stonetop", destination: "the-maw" }, "vicinity");
			await d._setJourneyPlace("destination", "the-ruined-tower");
			expect(d._activeTier("stonetop", "the-ruined-tower")).toBe("vicinity");
		});
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

	// No fold is singled out any more. The heading used to take the gold for whichever group held
	// the destination, which the chosen place's own pill and the map tabs already said between
	// them; three marks for one fact, and the one on the heading read as being about the fold.
	it("singles out no group, whatever is chosen", async () => {
		for (const journey of [{ destination: "lygos" }, { destination: "marshedge" }, null]) {
			const built = await dialog(journey)._buildJourney();
			expect(built.groups.some(g => "isActive" in g), JSON.stringify(journey)).toBe(false);
		}
		// The picture still follows the destination; that is what the map tabs mark.
		expect((await dialog({ destination: "lygos" })._buildJourney()).activeTier).toBe("worlds-end");
	});

	it("leaves no active-fold class in the markup for nothing to style", () => {
		const hbs = read("templates/dialogs/partials/expedition-journey.hbs");
		expect(hbs).toContain('<div class="stonetop-journey-group">');
		expect(hbs).not.toContain("journey-group{{#if isActive}}");
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

	// The gazetteer link TRAILS its row, at the far end of it: it is what you reach for after
	// reading the place, so it follows the place.
	it("puts the gazetteer link after the place it belongs to", () => {
		const hbs = read("templates/dialogs/partials/expedition-journey.hbs");
		const link = hbs.indexOf("stonetop-journey-book");
		const row  = hbs.indexOf("stonetop-journey-pick stonetop-journey-row");
		expect(row).toBeGreaterThan(-1);
		expect(link).toBeGreaterThan(row);
	});

	// Tor's Fist is the one place in eighteen with no entry, so its row has ONE child — and left to
	// the grid's own sizing that lone row would spread over a cell no other row's name gets, which
	// is what put the icons at eighteen different x's. Both children name their column, which is
	// what stops it: a fixed LAST column, empty on the row that has nothing to put in it.
	it("reserves the icon's gutter on a row that has no gazetteer entry", () => {
		const css = readCss();
		const li  = declarations(css, ".stonetop-journey .stonetop-journey-list li");
		expect(li).toContain("display: grid;");
		expect(li).toMatch(/grid-template-columns: 1fr \d+px;/);
		expect(declarations(css, ".stonetop-journey .stonetop-journey-row")).toContain("grid-column: 1;");
		expect(declarations(css, ".stonetop-journey .stonetop-journey-book")).toContain("grid-column: 2;");
	});

	// The lit box takes in BOTH children: the button that picks the place and the bookmark that
	// opens its entry. Drawn on the button alone it stopped a whole column short of that icon, so
	// the chosen place read as a gold pill with a loose bookmark floating off the end of it. The
	// <li> is the only element that can hold both, since an <a> cannot live inside a <button>.
	it("draws the row's box around the gazetteer link as well as the name", () => {
		const css = readCss();
		const li  = declarations(css, ".stonetop-journey .stonetop-journey-list li");
		expect(li).toContain("border: 1px solid transparent;");
		expect(li).toMatch(/padding: \d+px \d+px;/);
		// And nothing left on the button to draw a second box inside the first: core styles a
		// <button> with a background and a border of its own, so both have to be put out by hand.
		const row = declarations(css, ".stonetop-journey .stonetop-journey-row");
		expect(row).toContain("border: none;");
		expect(row).toContain("background: none;");
		expect(row).not.toMatch(/padding: \d+px \d+px;/);
	});

	// Every lit state goes with the box, or the answer's gold would still stop where the button
	// does. The INK stays on the button: the name and the time turn gold, the bookmark keeps its
	// own faint grey against the wash behind it.
	it("lights that box rather than the button inside it", () => {
		const css  = readCss();
		const box  = ".stonetop-journey .stonetop-journey-list li";
		expect(ownRule(css, `${box}:has(.stonetop-journey-row.is-chosen)`)).toContain("--st-gold-bg");
		expect(ownRule(css, `${box}:has(.stonetop-journey-row:hover)`)).toContain("--st-slate-hover-bg");
		const chosen = declarations(css, ".stonetop-journey .stonetop-journey-row.is-chosen");
		expect(chosen).toContain("--st-gold-text");
		expect(chosen).not.toContain("background:");
	});

	// Core ships `.content-link` as a grey chip: a background, a border and padding sized for a
	// word of link text. Around a lone 2xs glyph it reads as a second button drawn inside the
	// row's pill, and it measures nine pixels wider than the gutter it sits in, so it crowds the
	// time on one side and the pill's border on the other.
	it("strips core's link chip off the bookmark", () => {
		const book = declarations(readCss(), ".stonetop-journey .stonetop-journey-book");
		expect(book).toContain("background: none;");
		expect(book).toContain("border: none;");
		expect(book).toContain("padding: 0;");
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

	// ── The corners the road turns ──────────────────────────────────────────────
	//
	// The table prints journeys, not roads, so "Stonetop to the Foothills, 2 days via the Roads" is
	// one row, and a line drawn for it pin to pin cuts straight across the Vicinity's Bottomlands.
	// The road leaves Stonetop heading south-west, meets the Highway at the Crossroads and turns
	// north there. ROAD_BENDS says so, per map, and `routePath` splices it in as it places the pins.
	describe("passing over the Crossroads on the roads that turn there", () => {
		/** One place's spot on a map, as the path prints it. */
		const at = (slug, tier = "vicinity") => {
			const spot = travelPlace(slug).spots[tier];
			return [Number((spot.fx * 100).toFixed(2)), Number((spot.fy * 100).toFixed(2))];
		};

		it("doglegs through the Crossroads on the way to the Foothills", async () => {
			const data = await dialog({ destination: "the-foothills" })._buildJourney("vicinity");
			expect(points(data.map.path)).toEqual([at("stonetop"), at("the-crossroads"), at("the-foothills")]);
		});

		it("does the same for Barrier Pass, out to the arrow that points at it", async () => {
			const data = await dialog({ destination: "barrier-pass" })._buildJourney("vicinity");
			const arrow = data.map.exits.find(e => e.node === "barrier-pass");
			expect(points(data.map.path)).toEqual([
				at("stonetop"), at("the-crossroads"),
				[Number(arrow.left.toFixed(2)), Number(arrow.top.toFixed(2))],
			]);
		});

		// THE WHOLE POINT: a bend is a place the line passes over, never a stop the journey makes.
		// It never reaches `route.legs`, so the time stays the book's printed one, Chart a Course's
		// "you must first travel to ___" stays empty on what is still a single-leg journey, and the
		// Chronicle still records the one leg.
		it("changes nothing the readout says about the trip", async () => {
			const data = await dialog({ destination: "the-foothills" })._buildJourney("vicinity");
			expect(data.route.legs).toHaveLength(1);
			expect(data.route.hasStops).toBe(false);
			expect(data.route.stops).toEqual([]);
			expect(data.route.atLeast).toBe("at least 2 days");
		});

		// One row per road, not one per direction: a road runs both ways, and coming back down from
		// the Foothills the same corner is turned in the other order.
		it("turns the same corner walking the other way", async () => {
			const data = await dialog({ origin: "the-foothills", destination: "stonetop" })
				._buildJourney("vicinity");
			expect(points(data.map.path)).toEqual([at("the-foothills"), at("the-crossroads"), at("stonetop")]);
		});

		it("leaves a leg with no corner to turn ruled from pin to pin", async () => {
			const data = await dialog({ destination: "the-maw" })._buildJourney("vicinity");
			expect(points(data.map.path)).toEqual([at("stonetop"), at("the-maw")]);
		});

		// A bend is a fact about ONE picture. The Vicinity draws the Crossroads well south-west of
		// Stonetop and Barrier Pass off its corner, which is what makes the dogleg worth drawing at
		// that scale; the World's End is a different drawing, and has no row of its own.
		it("bends only the map the row was written for", async () => {
			const data = await dialog({ destination: "barrier-pass" })._buildJourney("worlds-end");
			expect(points(data.map.path))
				.toEqual([at("stonetop", "worlds-end"), at("barrier-pass", "worlds-end")]);
		});

		// The marks are the GM's own account of which way the party goes. Bending them toward a
		// junction they drew around would be the system overruling the person holding the pen.
		it("never bends a way the GM drew by hand", async () => {
			const data = await dialog({
				origin: "stonetop", destination: "the-foothills",
				custom: { tier: "vicinity", points: [{ slug: "the-foothills" }] },
			})._buildJourney("vicinity");
			expect(points(data.map.path)).toEqual([at("stonetop"), at("the-foothills")]);
		});
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

describe("saying how long it takes, and what the list under it is", () => {
	const partial = f => readFileSync(
		new URL(`../../templates/dialogs/partials/${f}`, import.meta.url), "utf8");

	// The headline is a sentence a GM reads out at the table, and it used to be a bare span of
	// time with no verb in front of it: "AT LEAST 7-8 DAYS", sitting on its own over the legs.
	it("leads the total with a verb, whichever of the two wordings it carries", () => {
		const total = partial("expedition-journey-route.hbs")
			.match(/<div class="stonetop-journey-total[\s\S]*?<\/div>/)[0];
		// ONE lead over `journey.route.atLeast`, which is both wordings: "It will take at least
		// 7-8 days" for the table's own times and "It will take roughly 4-6 days" for a measured
		// way. Writing it into only one branch would have the same readout speaking two ways.
		expect(total).toContain("It will take {{journey.route.atLeast}}");
	});

	// ...and the verb is written in the TEMPLATE, because `routePhrase` has a second reader: the
	// Chronicle prints it after a colon ("Stonetop to Marshedge: at least 40 days"), where a
	// phrase that had swallowed a verb cannot sit.
	it("keeps the verb out of the phrase the Chronicle reuses", () => {
		expect(readFileSync(new URL("../../module/utils/travel-route.js", import.meta.url), "utf8"))
			.not.toContain("It will take");
	});

	// A total the system measured with a ruler is set apart by being italic and in sentence case.
	// It was ALSO the route's red, which on the step's one headline reads as a warning about the
	// journey rather than as a note about where the figure came from.
	it("sets a measured total in plain ink, not in the route's red", () => {
		const rule = ownRule(readCss(), ".stonetop-journey .stonetop-journey-total.is-estimate");
		expect(rule).toContain("color: var(--st-text)");
		expect(rule).not.toContain("--stonetop-route-ink");
		// The two marks that carry the distinction instead.
		expect(rule).toContain("font-style: italic");
		expect(rule).toContain("text-transform: none");
	});

	// The three folds under the readout are headed with the names of maps the books print, which
	// say everything to a reader with the rulebooks open and nothing at all to anyone else.
	it("heads the destination list with what the folds and the times are", () => {
		const markup = partial("expedition-journey.hbs");
		const head = markup.slice(
			markup.indexOf('<div class="stonetop-journey-listhead">'),
			markup.indexOf("{{#each journey.groups}}"));
		expect(head).toContain("Travel times");
		// Read off the START rather than saying "from Stonetop": a trip can set out from any place
		// the books letter OR any point on either map, and every time in the list re-solves when it
		// does. And with no start at all it names nobody — a trip right-clicked back past its own
		// start has nowhere to reckon from, so the heading says only what the list IS.
		expect(head).toContain("{{#if journey.start.set}} from {{journey.start.name}}{{/if}}");
		for (const fold of ["The Vicinity", "The World&rsquo;s End", "Beyond the maps"]) {
			expect(head, fold).toContain(fold);
		}
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
		expect(built.start.name).toBe("Stonetop");
		expect(built.start.set).toBe(true);
		expect(built.tiers.map(t => t.slug)).toEqual(["vicinity", "worlds-end"]);
		expect(built.destination.name).toBe("Lygos");
		expect(built.route.atLeast).toBe("at least 40 days");
		// The two flags the window arms its own picture off, so a mark laid at 300 dpi and one laid
		// on the panel's inch-wide map are the same act: what a click means here, and whether a
		// right-click has anything left to take.
		expect(built.custom.canSetStart).toBe(false);
		expect(built.custom.canUndo).toBe(true);
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

	// Every gesture the window offers goes through the panel's own methods, which is what makes a
	// pick made in the popout and one made on the panel the same act — same trip, same Chart a
	// Course boxes, same Chronicle line. `pick` is gone with the × it was bound to; a place clicked
	// in either window arrives here as `markPlace` and the planner decides what it means.
	it("hands the window a way to write, going through the panel's own method", async () => {
		const d = dialog();
		const source = d._mapWindowSource();
		expect(source.pick).toBeUndefined();
		expect(source.pickStart).toBeUndefined();

		await source.markPlace("marshedge", null, null, "vicinity");
		expect(saved().journey.destination).toBe("marshedge");
		expect(chartPicked(saved().chart).map(e => e.key)).toContain("days");
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
		// AND NAMES THE SCENE THEY HAVE TO OPEN. The press writes on the canvas, never on the
		// picture in the window, and a GM who reads the map here with another scene open gets a
		// refusal with nothing in the label to have warned them.
		expect(button.tooltip).toContain("The Vicinity");
		expect(button.tooltip).toContain("canvas");
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
		// No "open that map first" on this side: the route is showing, so they are already on it.
		expect(button.tooltip).not.toContain("canvas");
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
		"expedition-journey-controls.hbs", "expedition-journey-drawhint.hbs",
		"expedition-journey-route.hbs",
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
		// One of the GM's own sites, so the pin layer's third {{#each}} has a real element to be
		// checked against too. It is the block most likely to drift, being the newest and the only
		// one whose fields are not the travel table's.
		global.game.actors = [{ type: "stonetop" }];
		sites.onMap = [{
			page: { uuid: "JournalEntry.a.JournalEntryPage.b", name: "The Sunken Barrow" },
			spot: { tier: "worlds-end", fx: 0.5, fy: 0.5 },
		}];
		// And a way drawn by hand, with one bare mark on it, so the pin layer's FOURTH {{#each}}
		// has a real element too. It is checked here rather than in its own test for the same
		// reason the sites block is: what this guard protects is that no block references a field
		// its collection does not carry, and a block with nothing to iterate proves nothing.
		const data = await dialog({
			origin: "stonetop", destination: "lygos",
			custom: { tier: "worlds-end", points: [{ slug: "marshedge" }, { fx: 0.62, fy: 0.7 }] },
		})._buildJourney();
		// Each {{#each}} block's body, checked against one real element of that collection.
		const blocks = [
			// The pin layer's context is one `map` object, so its paths carry no prefix.
			["path.arrows", data.map.path.arrows[0]],
			["marks", data.map.marks[0]],
			["spots", data.map.spots[0]],
			["sites", data.map.sites[0]],
			["exits", data.map.exits[0]],
			["journey.route.legs", data.route.legs[0]],
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

// Chart a Course is a list a GM adds to now, not twelve ticks, so a pick that the map can answer
// PUTS THAT LINE ON THE LIST — and un-picking takes it back off, as long as it is still the row
// we put there. `charted` reads the trip's list the way both the step and the Chronicle do.
const charted = () => chartPicked(saved().chart).map(e => e.key);
const chartedRow = key => chartPicked(saved().chart).find(e => e.key === key);

describe("carrying the pick onto Chart a Course", () => {
	it("adds the two requirements the route can answer, and fills the route line", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "lygos");

		expect(saved().journey).toEqual({ destination: "lygos" });
		expect(charted().sort()).toEqual(["days", "firstTravel"]);
		// Marked as ours, which is the whole of what lets a later pick clear it again.
		expect(chartedRow("days").fromRoute).toBe(true);
		expect(chartedRow("days").group).toBe("requirements");
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		expect(rendered).toBe(1);
	});

	it("does not claim a first stop on a journey that has none", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "marshedge");
		expect(charted()).toEqual(["days"]);
	});

	// Five of the eighteen destinations from Stonetop are measured only in hours, so they have
	// legs and no day count — and `fillChartBlank` refuses to fill a day count it hasn't got. A
	// line on the list still reading "at least ___ days" is worse than no line at all.
	it("adds no days line for a journey the book measures in hours", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(charted()).toEqual([]);
	});

	// Nothing used to clear these, so a GM who changed their mind kept the previous journey's
	// lines — and a `firstTravel` blank with no stop left to name can never be filled in.
	it("takes back off what the new route cannot answer", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "lygos");
		expect(charted().sort()).toEqual(["days", "firstTravel"]);
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(charted()).toEqual([]);
		expect(saved().chart.route).toBe("Stonetop to the Red Grove");
	});

	it("clears its own carried-forward answers when the destination is cleared", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "lygos");   // seeds chart.route and both lines
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		await d._setJourneyPlace("destination", "");
		expect(saved().chart.route).toBe("");
		expect(charted()).toEqual([]);
	});

	// A row the GM put on the list themselves is theirs — for a stop the graph does not model, on
	// a trip the route can never answer for — and no later pick may quietly take it off, along
	// with its line in the Chronicle.
	it("never removes a line the GM added by hand", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" },
			{ picked: [{ id: "mine", group: "requirements", key: "firstTravel", answer: "the Maw" }] });
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(charted()).toEqual(["firstTravel"]);
		expect(chartedRow("firstTravel").answer).toBe("the Maw");
	});

	// ...and the stale line it replaced still cannot come back, because a row WE added still says
	// so, and is therefore still ours to clear.
	it("still clears a line of its own that the new route cannot answer", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" }, {
			picked: [
				{ id: "a", group: "requirements", key: "days",        fromRoute: true },
				{ id: "b", group: "requirements", key: "firstTravel", fromRoute: true },
			],
		});
		await d._setJourneyPlace("destination", "the-red-grove");
		expect(charted()).toEqual([]);
	});

	// A row added once and taken off by the GM does not come back on the next pick: the carry
	// only ever acts on the TURN, when the route's answer to that line changes.
	it("does not put back a line the GM took off, on a later pick of the same kind", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "lygos");
		await d._removeChartRow(chartedRow("days").id);
		expect(charted()).not.toContain("days");
		// Another destination the map can also count the days for. The route's ANSWER to that
		// line did not turn, so nothing about it is ours to touch, and the GM's removal stands.
		await d._setJourneyPlace("destination", "gordins-delve");
		expect(d._journeyRoute().total.days.max).toBeGreaterThan(0);
		expect(charted()).not.toContain("days");
	});

	it("never overwrites what the GM typed", async () => {
		const d = dialog(null, { route: "We follow the tracks north." });
		await d._setJourneyPlace("destination", "lygos");
		expect(saved().chart.route).toBe("We follow the tracks north.");
		expect(charted()).toContain("days");
	});

	it("charts nothing for a destination the book gives no time to", async () => {
		const d = dialog();
		await d._setJourneyPlace("destination", "");
		expect(saved().journey.destination).toBe("");
		expect(saved().chart).toBeUndefined();
	});

	it("reads the new pick, not the draft it is replacing", async () => {
		// ensureCurrent hands back a deep copy, so the draft still holds the old value while this
		// runs. Getting that wrong would chart the PREVIOUS destination.
		const d = dialog({ origin: "stonetop", destination: "the-red-grove" }, {});
		await d._setJourneyPlace("destination", "lygos");
		expect(saved().chart.route).toBe("Stonetop to Marshedge to Lygos");
		expect(charted()).toContain("firstTravel");
	});

	it("re-solves from a changed origin", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" }, {});
		await d._setJourneyPlace("origin", "marshedge");
		// Standing in Marshedge, Lygos is the printed 30-day leg with nothing before it.
		expect(saved().chart.route).toBe("Marshedge to Lygos");
		expect(charted()).not.toContain("firstTravel");
	});

	// A trip charted under the old tick-and-fill pair opens with everything it presented still on
	// it, and the first write retires the pair rather than leaving a second copy behind for the
	// Chronicle to print twice.
	it("upgrades a trip logged with the old ticks, keeping what was written", async () => {
		const d = dialog({ origin: "stonetop", destination: "the-red-grove" }, {
			checks: { perilous: true, days: true },
			fills:  { perilous: "the Ettenmark wolves are hunting", days: "60, the long way round" },
		});
		await d._setJourneyPlace("destination", "lygos");
		expect(charted().sort()).toEqual(["days", "firstTravel", "perilous"]);
		expect(chartedRow("perilous").answer).toBe("the Ettenmark wolves are hunting");
		expect(chartedRow("days").answer).toBe("60, the long way round");
		// An upgraded row is the GM's, not ours: a tick carried no record of who made it.
		expect(chartedRow("days").fromRoute).toBe(false);
		expect(saved().chart.checks).toBeUndefined();
		expect(saved().chart.fills).toBeUndefined();
	});
});

// Every requirement on Chart a Course now has somewhere to write the ANSWER to it, because most
// of them are a sentence with a hole in it that the table has to be told. What the route works
// out is offered to the two blanks it can answer as a placeholder rather than spliced into the
// words: the map's arithmetic is a starting point, and the GM's own ruling outranks it.
describe("what a charted line offers to answer with", () => {
	/** The chart step's rows, keyed by the authored key each one names. */
	function chartRows(d) {
		const step = d._steps.find(s => s.key === "chart");
		const rows = d._qaContext(step.qa).groups.flatMap(g => g.entries);
		const keys = chartPicked(d._answers().chart).map(e => e.key);
		return Object.fromEntries(rows.map((row, i) => [keys[i] ?? row.id, row]));
	}

	/** A trip that has presented these authored lines, with what was said against each. */
	const presenting = (journey, said = {}) => dialog(journey, {
		picked: Object.entries(said).map(([key, answer], i) =>
			({ id: `row-${i}`, group: chartGroupOf(key), key, answer })),
	});

	it("offers the days and the first stop from the plotted route", () => {
		const rows = chartRows(presenting({ origin: "stonetop", destination: "lygos" },
			{ days: "", firstTravel: "" }));
		expect(rows.days.hint).toBe("40");
		expect(rows.firstTravel.hint).toBe("Marshedge");
		// A placeholder, not an answer: nothing is written until the GM writes it.
		expect(rows.days.answer).toBe("");
	});

	it("leaves the sentence as authored, blank and all", () => {
		// The words are the book's whether a route has been plotted or not; what was told lives
		// in the box under them.
		for (const journey of [null, { origin: "stonetop", destination: "lygos" }]) {
			const rows = chartRows(presenting(journey, { days: "", firstTravel: "" }));
			expect(rows.days.text).toContain("___");
			expect(rows.firstTravel.text).toContain("___");
		}
	});

	it("hands back what the GM wrote against a line", () => {
		const rows = chartRows(presenting({ origin: "stonetop", destination: "lygos" },
			{ days: "60, the long way round", perilous: "the Ettenmark wolves are hunting" }));
		expect(rows.days.answer).toBe("60, the long way round");
		// Still shown as the placeholder, so the map's answer stays legible under the override.
		expect(rows.days.hint).toBe("40");
		expect(rows.perilous.answer).toBe("the Ettenmark wolves are hunting");
	});

	it("asks the plain question where the route has nothing to say", () => {
		const rows = chartRows(presenting(null, { days: "", watchOut: "" }));
		expect(rows.days.hint).toBe("What did you tell them?");
		expect(rows.watchOut.hint).toBe("What did you tell them?");
	});

	it("labels every box with the line it answers, in plain words", () => {
		const rows = chartRows(presenting(null, { bring: "", perilous: "" }));
		// Trusted authored HTML with entities in it; a screen reader needs the words.
		expect(rows.bring.plain).toBe("You'll need to bring ___ (warm clothes, a cart, rope…)");
		expect(rows.perilous.plain).toBe("The way is perilous, plagued with danger");
	});

	it("carries a line the GM wrote in their own words, verbatim", () => {
		const d = dialog(null, { picked: [
			{ id: "own", group: "challenges", text: "The ford is watched by Brennan's Claws" },
		] });
		const step = d._steps.find(s => s.key === "chart");
		const row  = d._qaContext(step.qa).groups.find(g => g.key === "challenges").entries[0];
		expect(row.text).toBe("The ford is watched by Brennan's Claws");
		expect(row.hint).toBe("What did you tell them?");
	});

	it("keeps each group's lines under its own heading, with its own add button", () => {
		const d = dialog(null, { picked: [
			{ id: "a", group: "requirements", key: "guide" },
			{ id: "b", group: "challenges",   key: "lost"  },
		] });
		const step   = d._steps.find(s => s.key === "chart");
		const groups = d._qaContext(step.qa).groups;
		expect(groups.map(g => g.key)).toEqual(["requirements", "challenges"]);
		expect(groups.map(g => g.entries.length)).toEqual([1, 1]);
		expect(groups.map(g => g.addLabel)).toEqual(["Add a requirement", "Add a challenge"]);
	});

	it("starts a fresh trip with nothing on either list", () => {
		const d = dialog();
		const step = d._steps.find(s => s.key === "chart");
		expect(d._qaContext(step.qa).groups.every(g => g.entries.length === 0)).toBe(true);
	});
});

// The GM's own sites, on the books' maps.
//
// The travel table charts eighteen places and neither map letters the barrow the GM invented last
// week, so this is the one kind of mark on these maps that is not the books'. What it must NOT do
// is drift from them: a site's stored position goes through the very same frame arithmetic the
// printed places do, or it lands in a different valley on the poster scan than on the render.
describe("sites on the map", () => {
	beforeEach(() => {
		// getStonetopSteadingActor finds this; where the sites are filed is the store's business
		// and is faked above.
		global.game.actors = [{ type: "stonetop" }];
		global.fromUuid = uuid => Promise.resolve(
			sites.onMap.find(s => s.page.uuid === uuid)?.page ?? null);
	});

	/** One placed site, as sitesOnMap hands it over. */
	const placed = (name, spot) => ({
		page: { uuid: `JournalEntry.x.JournalEntryPage.${name}`, name },
		spot,
	});

	it("places a pin by the same arithmetic as the book's own places", async () => {
		sites.onMap = [placed("The Sunken Barrow", { tier: "vicinity", fx: 0.5, fy: 0.5 })];
		const data = await dialog()._buildJourney("vicinity");
		// The printed render carries no registration, so a canonical half is half of the picture.
		expect(data.map.sites).toHaveLength(1);
		expect(data.map.sites[0]).toMatchObject({ name: "The Sunken Barrow", left: 50, top: 50 });
	});

	it("shows only the sites on the map being drawn", async () => {
		sites.onMap = [
			placed("The Sunken Barrow", { tier: "vicinity", fx: 0.5, fy: 0.5 }),
			placed("Far Hall", { tier: "worlds-end", fx: 0.3, fy: 0.3 }),
		];
		expect((await dialog()._buildJourney("vicinity")).map.sites.map(s => s.name))
			.toEqual(["The Sunken Barrow"]);
		expect((await dialog()._buildJourney("worlds-end")).map.sites.map(s => s.name))
			.toEqual(["Far Hall"]);
	});

	// A label near an edge hangs INWARD, or it spills out of the step column and gives it a
	// horizontal scrollbar. The book's places have always done this; a site is drawn by the same
	// rule because it is a mark on the same picture, and the rule now lives in one place.
	it("hangs an edge label inward, exactly as a place's does", async () => {
		sites.onMap = [
			placed("Right edge", { tier: "vicinity", fx: 0.95, fy: 0.95 }),
			placed("Left edge", { tier: "vicinity", fx: 0.05, fy: 0.05 }),
		];
		const [right, left] = (await dialog()._buildJourney("vicinity")).map.sites;
		expect(right).toMatchObject({ anchorH: "right", anchorV: "above" });
		expect(left).toMatchObject({ anchorH: "left", anchorV: "below" });
	});

	// A site is prep filed in a journal players cannot see, so a pin they could see would name a
	// write-up they could not open.
	it("draws none of it for a player, button and all", async () => {
		sites.onMap = [placed("The Sunken Barrow", { tier: "vicinity", fx: 0.5, fy: 0.5 })];
		global.game.user = { isGM: false };
		const data = await dialog()._buildJourney("vicinity");
		expect(data.map.sites).toEqual([]);
		expect(data.placeSite).toBeNull();
	});

	it("offers the button once there is a map to put a pin on, and names it", async () => {
		const data = await dialog()._buildJourney("vicinity");
		expect(data.placeSite.label).toBe("Put a site on the map");
		expect(data.placeSite.tooltip).toContain("The Vicinity");
	});

	// A placement is a point ON a picture. With no art imported there is no picture, and a control
	// that is visibly there and can do nothing is worse than one that never offered.
	it("offers no button when this world has no copy of the map", async () => {
		art.resolved = new Map();
		expect((await dialog()._buildJourney("vicinity")).placeSite).toBeNull();
	});

	// The controls partial is the markup BOTH surfaces draw, which is what makes one check cover
	// the walkthrough's own map and the popout alike.
	it("draws the button in the markup both surfaces render, and withholds it from a player", async () => {
		const controls = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-controls.hbs";
		const journey = await dialog()._buildJourney("vicinity");
		expect(await renderTemplate(controls, { journey })).toContain("stonetop-journey-place-site");

		global.game.user = { isGM: false };
		const forPlayer = await dialog()._buildJourney("vicinity");
		expect(await renderTemplate(controls, { journey: forPlayer }))
			.not.toContain("stonetop-journey-place-site");
	});

	// The pin has to carry `data-site-uuid`: that attribute is what routes a tap to the planner
	// (journey-controls.js#journeyPick), what a right-click reads to lift the pin, AND what tells
	// the popout's pan handler this is a control rather than open map. Miss it and the pin renders,
	// hovers, and is unclickable.
	it("draws a site pin that names the page it marks", async () => {
		sites.onMap = [placed("The Sunken Barrow", { tier: "vicinity", fx: 0.5, fy: 0.5 })];
		const map = (await dialog()._buildJourney("vicinity")).map;
		const html = await renderTemplate(
			"systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-pins.hbs", map);
		expect(html).toContain('data-site-uuid="JournalEntry.x.JournalEntryPage.The Sunken Barrow"');
		expect(html).toContain("stonetop-journey-site");
		// It wears its name always, unlike the book's own places, which show one only at the two
		// ends of the journey.
		expect(html).toContain("The Sunken Barrow");
		// And the tooltip teaches all three gestures, since only the right-click is the same one it
		// always was and none of them is guessable off a picture.
		expect(map.sites[0].tooltip).toContain("run the way through here");
		expect(map.sites[0].tooltip).toContain("shift-click");
		expect(map.sites[0].tooltip).toContain("right-click");
	});
});

// A SITE PIN IS A PLACE ON THE WAY (user, 2026-08-24), not a link out to a journal. Tapping one
// used to open its write-up, which made a GM's own barrow the one mark on this map that could not
// be part of the journey drawn across it — on the screen whose whole purpose is saying how the
// party gets somewhere, and where the somewhere is very often that barrow.
describe("tapping one of the GM's own sites", () => {
	const barrow = "JournalEntry.x.JournalEntryPage.The Sunken Barrow";
	const farHall = "JournalEntry.x.JournalEntryPage.Far Hall";

	beforeEach(() => {
		global.game.actors = [{ type: "stonetop" }];
		global.ui = { notifications: { info: () => {}, warn: () => {} } };
		sites.onMap = [
			{ page: { uuid: barrow, name: "The Sunken Barrow" }, spot: { tier: "vicinity", fx: 0.5, fy: 0.5 } },
			{ page: { uuid: farHall, name: "Far Hall" }, spot: { tier: "worlds-end", fx: 0.3, fy: 0.3 } },
		];
	});

	/** The stored marks of the way, as the trip holds them. */
	const way = () => saved().journey?.custom;

	// A plain tap runs the way through the site, which is the same sentence a plain tap on one of
	// the book's own pins says: that is where they are bound. It cannot be said the same WAY — a
	// site has no slug the travel table knows — so it begins a hand-drawn way ending on itself, and
	// the far end of a drawn way IS where the party is bound.
	it("runs the way through the site on a plain tap", async () => {
		const d = dialog({ origin: "stonetop" });
		await d._chooseJourneySite(barrow);
		expect(way()).toMatchObject({ tier: "vicinity", points: [{ fx: 0.5, fy: 0.5 }] });
	});

	// THE SITE'S OWN FRACTION, never the pointer's. A pin is a few pixels of standing stone with a
	// name tag hanging off it, so a stop laid where the cursor happened to be would sit beside the
	// place rather than on it — visibly so, once the line runs through it.
	it("lays the stop on the site's recorded spot", async () => {
		const d = dialog({ origin: "stonetop" });
		await d._chooseJourneySite(barrow);
		expect(way().points[0]).toEqual({ fx: 0.5, fy: 0.5 });
	});

	// Shift adds it as another stop rather than moving the far end there, exactly as it does for a
	// lettered place and for open map: the modifier is half of what the tap said.
	it("adds it as another stop on a shift-tap", async () => {
		const d = dialog({
			origin: "stonetop",
			custom: { tier: "vicinity", points: [{ fx: 0.2, fy: 0.2 }] },
		});
		await d._chooseJourneySite(barrow, { shiftKey: true });
		expect(way().points).toEqual([{ fx: 0.2, fy: 0.2 }, { fx: 0.5, fy: 0.5 }]);

		// And a plain tap moves that far end, rather than adding a third.
		await d._chooseJourneySite(barrow);
		expect(way().points).toEqual([{ fx: 0.2, fy: 0.2 }, { fx: 0.5, fy: 0.5 }]);
	});

	// With no start, the tap plants it — a site the GM has written up being a very likely answer to
	// "where are they?", since it is somewhere they have already decided matters.
	it("plants the start there on a trip that has none", async () => {
		const d = dialog({ origin: null });
		await d._chooseJourneySite(barrow);
		expect(saved().journey.origin).toMatchObject({ tier: "vicinity", fx: 0.5, fy: 0.5 });
		expect(way()).toBeUndefined();
	});

	// A site's fraction means ONE picture. A way already laid out on the other map cannot take it,
	// and the refusal is by name for the same reason a lettered place the map does not draw is: a
	// GM tapping a Vicinity barrow while drawing on the World's End has made a reasonable mistake.
	it("refuses a site on the other map by name, rather than silently", async () => {
		const warned = [];
		global.ui = { notifications: { info: () => {}, warn: msg => warned.push(msg) } };
		const d = dialog({
			origin: "stonetop",
			custom: { tier: "worlds-end", points: [{ fx: 0.2, fy: 0.2 }] },
		});
		rendered = 0;

		await d._chooseJourneySite(barrow);
		expect(way().points).toEqual([{ fx: 0.2, fy: 0.2 }]);
		expect(warned[0]).toContain("The Sunken Barrow");
		expect(rendered).toBe(0);
	});

	// And a way that does not exist yet would begin on the SITE's map, which has to be able to draw
	// where the party sets out from as well — or the first leg begins at a stop with nowhere to
	// stand, and routePath refuses to draw the line at all rather than drawing a shortened one.
	it("refuses to begin a way from a start its own map cannot draw", async () => {
		const warned = [];
		global.ui = { notifications: { info: () => {}, warn: msg => warned.push(msg) } };
		// Marshedge is lettered on the World's End and not on the Vicinity.
		const d = dialog({ origin: "marshedge" });
		rendered = 0;

		await d._chooseJourneySite(barrow);
		expect(way()).toBeUndefined();
		expect(warned[0]).toContain("Marshedge");
		expect(rendered).toBe(0);
	});

	// The ordinary state of a pin whose site was deleted from the Sites tab while this map was open.
	// Silent: the pin goes with the next redraw anyway, and there is nothing the reader can do.
	it("says nothing at all for a pin whose site has gone", async () => {
		const d = dialog({ origin: "stonetop" });
		rendered = 0;
		await d._chooseJourneySite("JournalEntry.x.JournalEntryPage.Nowhere");
		expect(way()).toBeUndefined();
		expect(rendered).toBe(0);
	});
});

describe("what the walkthrough does around a site placement", () => {
	beforeEach(() => {
		global.game.actors = [{ type: "stonetop" }];
		global.fromUuid = uuid => Promise.resolve(sites.onMap.find(s => s.page.uuid === uuid)?.page ?? null);
	});

	/** A dialog counting its own redraws, since neither surface is on screen here. */
	function planner() {
		const d = dialog();
		d.redrawn = 0;
		d._refreshMapWindows = async () => { d.redrawn += 1; };
		d._stepNav = () => ({ step: { journey: true } });
		return d;
	}

	const POSTER = { x0: 0.03, y0: 0.072, x1: 0.97, y1: 0.936 };
	const surface = { tier: "vicinity", frame: POSTER, pickPoint: async () => ({ left: 50, top: 50 }) };

	// The picture is the SURFACE's to supply, and it is the whole reason the popout routes this
	// through the panel: the reader aims at 300 dpi and the answer still comes back as a fraction
	// of the printed crop.
	it("hands the gesture whichever map the surface is showing", async () => {
		sites.chosen = { name: "The Sunken Barrow" };
		await planner()._placeSite(surface);
		expect(sites.placeCalls).toEqual([surface]);
	});

	it("redraws both surfaces once a pin has actually moved", async () => {
		sites.chosen = { name: "The Sunken Barrow" };
		const d = planner();
		await d._placeSite(surface);
		expect(d.redrawn).toBe(1);
	});

	// Backing out of the chooser is not a change, and a redraw of a map nothing happened to would
	// throw away the popout's zoom and pan for nothing.
	it("redraws nothing when the gesture wrote nothing", async () => {
		sites.chosen = null;
		const d = planner();
		await d._placeSite(surface);
		await d._takeSiteOffMap("JournalEntry.x.JournalEntryPage.gone");
		expect(d.redrawn).toBe(0);
	});

	it("lifts through the same one gesture, then redraws", async () => {
		sites.chosen = { name: "The Sunken Barrow" };
		const d = planner();
		await d._takeSiteOffMap("JournalEntry.x.JournalEntryPage.barrow");
		expect(sites.liftCalls).toEqual(["JournalEntry.x.JournalEntryPage.barrow"]);
		expect(d.redrawn).toBe(1);
	});
});

// ── Laying the way out by hand ───────────────────────────────────────────────
//
// The table's shortest path is the right answer to "how do you get to Marshedge" and the wrong one
// to "how are they going". There is no box to tick any more: a shift-click hands the line
// over and starts a way where there was none, a plain click moves its far end once it exists,
// and a right-click takes a leg back. The marks ARE the mode, so a way ends when its last does.

/** The trip's drawn way, as it now stands in the setting. */
const drawnWay = () => saved().journey?.custom;

describe("the first shift-click", () => {
	it("seeds the way from the route the table had already worked out", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" });
		// A mark laid on the World's End, which is the map this journey opens on.
		await d._drawJourneyMark({ fx: 0.7, fy: 0.7 }, { append: true, tier: "worlds-end" });
		// The first mark should not empty the map: the way they were going is nearly always the way
		// they are still going, plus a detour.
		expect(drawnWay()).toEqual({
			tier: "worlds-end",
			points: [{ slug: "marshedge" }, { slug: "lygos" }, { fx: 0.7, fy: 0.7 }],
		});
	});

	it("starts with just that mark when there is nowhere to go yet", async () => {
		const d = dialog();
		await d._drawJourneyMark({ fx: 0.4, fy: 0.6 }, { append: true, tier: "vicinity" });
		expect(drawnWay()).toEqual({ tier: "vicinity", points: [{ fx: 0.4, fy: 0.6 }] });
	});

	// A plain click has no far end to move on a bare map, and reading it as "begin a journey here"
	// would lay a way every time a GM clicked the picture to bring the window forward.
	it("is the only gesture that starts one: a plain click lays nothing", async () => {
		const d = dialog({ origin: "stonetop", destination: "lygos" });
		rendered = 0;
		await d._drawJourneyMark({ fx: 0.7, fy: 0.7 }, { append: false, tier: "worlds-end" });
		expect(saved().journey.custom).toBeUndefined();
		expect(rendered).toBe(0);
	});

	// Nor an undo or a "start over" on a map with nothing on it: neither can BEGIN a way. A right-
	// click on a trip that still has ends takes one of those instead (see the ladder), so this asks
	// it of a trip already peeled back to nothing — where doing nothing should cost no world-setting
	// write, re-render or sweep of the open map windows.
	it("is not an undo or a start-over", async () => {
		const d = dialog({ origin: null, destination: null });
		rendered = 0;
		await d._undoJourneyMark();
		await d._clearDrawnWay();
		expect(saved().journey.custom).toBeUndefined();
		expect(rendered).toBe(0);
	});

	it("does not overwrite a way drawn earlier with the table's guess", async () => {
		const d = dialog({
			origin: "stonetop", destination: "lygos",
			custom: { tier: "worlds-end", points: [{ fx: 0.4, fy: 0.6 }] },
		});
		await d._drawJourneyMark({ fx: 0.5, fy: 0.5 }, { append: true, tier: "worlds-end" });
		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.5 }]);
	});

	// A way begun on a map that cannot draw where the party is setting out from would start at a
	// stop with nowhere to stand, and `routePath` refuses the whole line rather than shorten it.
	it("begins on a map that can draw the origin", async () => {
		const d = dialog({ origin: "marshedge" });
		d._journeyTier = "vicinity";
		await d._drawJourneyMark({ fx: 0.4, fy: 0.6 }, { append: true, tier: "vicinity" });
		expect(drawnWay().tier).toBe("worlds-end");
		// And the panel follows, rather than sitting on a tab the marks do not belong to.
		expect(d._journeyTier).toBeNull();
	});

	// Which is why the two surfaces do not offer the gesture there at all, and the line under the
	// map says as much before a click is ever made.
	it("is not offered on a map that cannot draw the origin", async () => {
		const d = dialog({ origin: "marshedge" });
		const vicinity = await d._buildJourney("vicinity");
		expect(vicinity.custom.canDrawHere).toBe(false);
		expect(vicinity.custom.hint).toContain("Marshedge");
		const home = await d._buildJourney("worlds-end");
		expect(home.custom.canDrawHere).toBe(true);
		expect(home.custom.hint).toContain("Shift-click");
	});
});

describe("the three gestures", () => {
	/** A dialog with a way already begun, one bare mark down on the Vicinity. */
	const drawing = (points = [{ fx: 0.4, fy: 0.6 }], over = {}) => dialog({
		origin: "stonetop", destination: null,
		custom: { tier: "vicinity", points },
		...over,
	});

	it("moves the far end on a plain click, and adds a leg on a shift-click", async () => {
		const d = drawing();
		await d._drawJourneyMark({ fx: 0.5, fy: 0.5 }, { append: false });
		expect(drawnWay().points).toEqual([{ fx: 0.5, fy: 0.5 }]);
		await d._drawJourneyMark({ fx: 0.6, fy: 0.6 }, { append: true });
		expect(drawnWay().points).toEqual([{ fx: 0.5, fy: 0.5 }, { fx: 0.6, fy: 0.6 }]);
	});

	it("takes the last leg back on a right-click", async () => {
		const d = drawing([{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.5 }]);
		await d._undoJourneyMark();
		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }]);
	});

	// A right-click past the last mark drops to the next rung of the ladder rather than doing
	// nothing: with no marks and no destination left, what it takes is the start.
	it("takes the start once the last mark has gone", async () => {
		const d = drawing([]);
		await d._undoJourneyMark();
		expect(saved().journey.origin).toBeNull();
		expect(d._journeyPick().start.slug).toBeNull();
	});

	// And only THEN is there nothing to take back — which should cost no world-setting write, no
	// re-render and no sweep of every open map window.
	it("writes nothing when there is nothing left to take back", async () => {
		const d = drawing([], { origin: null });
		rendered = 0;
		await d._undoJourneyMark();
		expect(rendered).toBe(0);
	});

	// "Start over" is also the way OUT: with the marks gone there is no way, and the trip is back to
	// the road the travel table works out.
	it("throws the marks away, and with them the drawing", async () => {
		const d = drawing([{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.5 }]);
		await d._clearDrawnWay();
		expect(drawnWay()).toEqual({ tier: "vicinity", points: [] });
		expect(d._customPath().on).toBe(false);
	});

	// The same door out, one leg at a time: the way is over when its last mark is taken back.
	it("ends the way when the last leg goes back", async () => {
		const d = drawing([{ fx: 0.4, fy: 0.6 }]);
		await d._undoJourneyMark();
		expect(d._customPath().on).toBe(false);
		expect(d._journeyRoute()).toBeNull();
	});

	// A click on a lettered place takes that place, name and all, so a way can wander off the road
	// and still come back through somewhere by name.
	it("takes a lettered place as a stop on a way already begun", async () => {
		const d = drawing();
		await d._chooseJourneyPlace("the-maw", { shiftKey: true });
		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }, { slug: "the-maw" }]);
	});

	// The margin of the FILE is not the margin of the printed page. MAP_FRAMES insets each crop
	// three to seven percent inside the file, and the panel shows the whole file, so the band
	// outside the crop is on screen and clickable and a click there is an ordinary aim at the edge
	// of the map. `percentSpot` answers it with a negative fraction, and a plain click MOVES the
	// far end: written through and normalized away downstream, one miss costs the GM the mark they
	// meant AND the leg they had already drawn.
	it("refuses a click past the printed edge without eating the last leg", async () => {
		const d = drawing([{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.5 }]);
		const warned = [];
		global.ui = { notifications: { warn: msg => warned.push(msg) } };
		rendered = 0;

		await d._drawJourneyMark({ fx: -0.032, fy: 0.44 }, { append: false });

		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }, { fx: 0.5, fy: 0.5 }]);
		// Said out loud, on the same terms as a place this map does not letter: a click that does
		// nothing at all is the baffling failure, not the safe one.
		expect(warned[0]).toContain("The Vicinity");
		// And it costs no world-setting write, re-render or sweep of the open map windows.
		expect(rendered).toBe(0);
	});

	it("refuses a click past the bottom and right edges too", async () => {
		const d = drawing();
		global.ui = { notifications: { warn: () => {} } };
		await d._drawJourneyMark({ fx: 0.5, fy: 1.04 }, { append: true });
		await d._drawJourneyMark({ fx: 1.02, fy: 0.5 }, { append: true });
		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }]);
	});

	// And a plain click means what it always meant, on the map and in the list alike: that is where
	// the party is bound.
	it("sets where they are bound on a plain click, with no way drawn", async () => {
		const d = dialog({ origin: "stonetop" });
		await d._chooseJourneyPlace("the-maw", { shiftKey: false });
		expect(saved().journey.destination).toBe("the-maw");
		expect(saved().journey.custom).toBeUndefined();
	});

	// Held with shift it starts a way through that place instead, on the map the reader is looking
	// at — which only the surface knows, since the popout keeps the map it was opened on.
	it("starts a way through a place on a shift-click, on the map that was clicked", async () => {
		const d = dialog({ origin: "stonetop" });
		await d._chooseJourneyPlace("the-maw", { shiftKey: true }, null, "vicinity");
		expect(drawnWay()).toEqual({ tier: "vicinity", points: [{ slug: "the-maw" }] });
		expect(saved().journey.destination).toBeUndefined();
	});

	// The destination list runs to every place the table knows, grouped by the map that draws it,
	// so clicking a World's End row while drawing on the Vicinity is an easy mistake to make and a
	// baffling one to have silently ignored.
	it("refuses a place this map does not letter, by name", async () => {
		const d = drawing();
		const warned = [];
		global.ui = { notifications: { warn: msg => warned.push(msg) } };
		await d._chooseJourneyPlace("marshedge");
		expect(drawnWay().points).toEqual([{ fx: 0.4, fy: 0.6 }]);
		expect(warned[0]).toContain("Marshedge");
		expect(warned[0]).toContain("The Vicinity");
	});
});

describe("what the route step shows while the way is being drawn", () => {
	const drawnTrip = (points, tier = "worlds-end") => ({
		origin: "stonetop", destination: "lygos",
		custom: { tier, points },
	});

	it("draws the hand-drawn way instead of the table's", async () => {
		const data = await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney();
		expect(data.route.drawn).toBe(true);
		expect(data.route.legs.map(l => l.toName)).toEqual(["point 1"]);
		expect(data.route.atLeast).toMatch(/^roughly /);
	});

	// The far end of a drawn way is where they are bound, whether or not anything was ever picked
	// off the list — and a way ending on a bare mark has no name to give.
	it("says where they are bound from the end of the way", async () => {
		const named = await dialog(drawnTrip([{ slug: "marshedge" }]))._buildJourney();
		expect(named.destination.name).toBe("Marshedge");
		const bare = await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney();
		expect(bare.destination).toBeNull();
	});

	it("badges each bare mark with the number the readout calls it by", async () => {
		const data = await dialog(drawnTrip([
			{ fx: 0.6, fy: 0.7 }, { slug: "marshedge" }, { fx: 0.7, fy: 0.8 },
		]))._buildJourney();
		expect(data.map.marks.map(m => m.mark)).toEqual([1, 2]);
		expect(data.map.marks.at(-1).isEnd).toBe(true);
		expect(data.route.legs.map(l => l.toName)).toEqual(["point 1", "Marshedge", "point 2"]);
	});

	it("lights up a lettered place the way passes through", async () => {
		const data = await dialog(drawnTrip([{ slug: "marshedge" }, { fx: 0.7, fy: 0.8 }]))._buildJourney();
		const marshedge = data.map.spots.find(s => s.slug === "marshedge");
		expect(marshedge.isStop).toBe(true);
		expect(marshedge.showLabel).toBe(true);
		// Not where they are bound, though: the way runs on past it to a mark of the GM's own.
		expect(marshedge.isChosen).toBe(false);
	});

	// The tier is not up for negotiation while a way is drawn on it — only a deliberate tab click
	// outranks it, because looking at the other map to compare is a reasonable thing to want.
	it("opens on the map the way is drawn on", () => {
		const d = dialog();
		expect(d._activeTier("stonetop", "the-maw", { on: true, tier: "worlds-end" })).toBe("worlds-end");
		d._journeyTier = "vicinity";
		expect(d._activeTier("stonetop", "the-maw", { on: true, tier: "worlds-end" })).toBe("vicinity");
	});

	// On the other tab the readout says where the way is, with the button back to it — rather than
	// marks at fractions that mean somewhere else entirely.
	it("keeps its marks off the other map, and says where they are", async () => {
		const d = dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]));
		d._journeyTier = "vicinity";
		const data = await d._buildJourney();
		expect(data.map.marks).toEqual([]);
		expect(data.map.path).toBeNull();
		expect(data.map.offMap.sentence).toContain("The World's End");
		expect(data.map.offMap.showLabel).toContain("The World's End");
	});

	// The sentence has to reach the screen, and it is the SAME partial on both surfaces: the route
	// step sets it under its map, the popout under its viewport (expedition-journey-drawhint.hbs).
	it("puts the line in the markup both surfaces render", async () => {
		const hint = "systems/stonetop-pwd/templates/dialogs/partials/expedition-journey-drawhint.hbs";
		// Nothing drawn: an invitation, and nothing to start over from.
		const bare = await renderTemplate(hint, { journey: await dialog()._buildJourney("vicinity") });
		expect(bare).toContain("Shift-click the map");
		expect(bare).not.toContain("stonetop-journey-clear-drawn");

		// A way drawn here: the gestures, and the button that throws it away.
		const drawn = await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney();
		const on = await renderTemplate(hint, { journey: drawn });
		expect(on).toContain("stonetop-journey-draw is-on");
		expect(on).toContain("stonetop-journey-clear-drawn");

		// A player gets the one thing still theirs to know, and no controls at all.
		global.game.user = { isGM: false };
		const forPlayer = await renderTemplate(hint, {
			journey: await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney(),
		});
		expect(forPlayer).toContain("drawn by hand");
		expect(forPlayer).not.toContain("stonetop-journey-clear-drawn");
	});

	it("tells a GM the gestures, and a player only that the way was drawn", async () => {
		const on = await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney();
		expect(on.custom.canDraw).toBe(true);
		expect(on.custom.canDrawHere).toBe(true);
		expect(on.custom.hint).toContain("Shift-click");
		expect(on.custom.count).toBe(1);

		global.game.user.isGM = false;
		const off = await dialog(drawnTrip([{ fx: 0.6, fy: 0.7 }]))._buildJourney();
		expect(off.custom.canDraw).toBe(false);
		expect(off.custom.drawnNote).toContain("drawn by hand");
	});
});

describe("carrying a drawn way onto Chart a Course", () => {
	// The same carry-forward the table's own routes get, through the same predicate: a box is
	// ticked only when the blank underneath it can actually be filled.
	it("ticks the days once the drawn way is a day's march or more", async () => {
		const d = dialog({ origin: "stonetop", destination: null });
		await d._drawJourneyMark({ fx: 0.2, fy: 0.8 }, { append: true, tier: "vicinity" });
		expect(chartPicked(saved().chart).map(e => e.key)).toContain("days");
		expect(saved().chart.route).toMatch(/^Stonetop to point 1$/);
	});

	// "You must first travel to ___" cannot be filled with "point 2", so only lettered stops count.
	it("names only a lettered stop as the place to travel to first", async () => {
		const d = dialog({
			origin: "stonetop", destination: null,
			custom: { tier: "worlds-end", points: [{ slug: "marshedge" }] },
		});
		await d._drawJourneyMark({ fx: 0.8, fy: 0.9 }, { append: true });
		expect(chartPicked(saved().chart).map(e => e.key)).toContain("firstTravel");
		expect(saved().chart.route).toBe("Stonetop to Marshedge to point 1");
	});
});

// ── Where they set out from ──────────────────────────────────────────────────
//
// This used to be a dropdown of the eighteen places the books letter, and it stopped being enough
// the moment the far end of a trip could be anywhere: a way laid out by hand ends wherever the GM
// last clicked, so a party could be BOUND for a bend in the river and still had to claim they were
// LEAVING Stonetop.
//
// It is a press and then a click now, the same shape "put a site on the map" already has. What
// this covers is the dialog's own share of that: which surface may offer it, what the armed click
// reaches, and what a miss does.
// WHERE THEY SET OUT FROM, which is now the same kind of thing as everything else on this picture:
// a click, and a right-click to take it back.
//
// It was a press-then-click gesture armed off a button in a row above the map, and before that a
// dropdown of the eighteen places the books letter. Both are gone with that row (user, 2026-08-24).
// A trip either has a start or it does not, and while it does not, the next click anywhere on this
// screen says where it is — the map, a pin, or a row of the list.
describe("saying where the party sets out from", () => {
	beforeEach(() => {
		global.ui = { notifications: { info: () => {}, warn: () => {} } };
	});

	// A point on the map, written as the fraction of the printed crop it is — the very same shape a
	// bare mark on a hand-drawn way is stored in, because they are the same kind of fact.
	it("writes a click on open map as a mark on that map", async () => {
		// `origin: null` is a trip peeled back past its own start, which is the state this gesture
		// answers. The frame is the file's registration, so a percentage of the FILE becomes a
		// fraction of the printed crop on the way in.
		const d = dialog({ origin: null, destination: "the-maw" });
		await d._drawJourneyMark({ fx: 0.5, fy: 0.5 }, { tier: "vicinity" });

		const written = saved().journey.origin;
		expect(written.tier).toBe("vicinity");
		expect(written.fx).toBeCloseTo(0.5);
		expect(d._journeyPick().origin).toBeNull();
		expect(d._journeyPick().start.tier).toBe("vicinity");
	});

	// The surface shows the whole map FILE, and on a poster scan the printed crop is inset three
	// percent inside it — so the margin band is on screen and clickable, and a click there is an
	// ordinary aim at the edge of a valley. `percentSpot` answers it with a NEGATIVE fraction.
	// Written through, `normalizeStart` would quietly drop it: a start silently thrown away by a
	// near miss, which is the one failure worse than nothing happening.
	it("refuses a click past the printed edge, and leaves the start where it was", async () => {
		const d = dialog({ origin: null, destination: "lygos" });
		const warned = [];
		global.ui = { notifications: { info: () => {}, warn: msg => warned.push(msg) } };
		rendered = 0;

		await d._drawJourneyMark({ fx: -0.02, fy: 0.5 }, { tier: "vicinity" });

		expect(saved().journey.origin).toBeNull();
		// Worded for the gesture that was actually made: nothing was being drawn, so nothing about a
		// missing leg.
		expect(warned[0]).toContain("The Vicinity");
		expect(warned[0]).toContain("set out from");
		// And it costs no world-setting write, re-render or sweep of the open map windows.
		expect(rendered).toBe(0);
	});

	// A place pin, an edge arrow, or a row of the destination list. That last one is what makes the
	// gesture work at all in a world that never imported the book art, where the list is the whole
	// screen and there is no picture to click.
	it("takes a place click as the start while the trip has none", async () => {
		const d = dialog({ origin: null, destination: "lygos" });
		await d._chooseJourneyPlace("marshedge");
		expect(saved().journey.origin).toBe("marshedge");
		// And it did NOT also become the destination: one click, one meaning.
		expect(saved().journey.destination).toBe("lygos");
	});

	// With a start already down, a click on a place means what it always meant, on the map and in
	// the list alike: that is where the party is bound.
	it("leaves a place click meaning the destination once there is a start", async () => {
		const d = dialog();
		await d._chooseJourneyPlace("marshedge");
		expect(saved().journey.destination).toBe("marshedge");
		expect(saved().journey.origin).toBeUndefined();
	});

	// A plain click on open map still lays nothing once there IS a start and no way drawn: with no
	// far end to move, reading a stray click as "begin a journey here" would put a way on the map
	// every time a GM clicked the picture to bring the window forward.
	it("still lays nothing on a bare map once the start is down", async () => {
		const d = dialog();
		rendered = 0;
		await d._drawJourneyMark({ fx: 0.5, fy: 0.5 }, { tier: "vicinity" });
		expect(saved().journey?.custom).toBeUndefined();
		expect(rendered).toBe(0);
	});

	// A mark belongs to the picture it was laid on, and a start laid by hand is a mark like any
	// other. Without a tier there is no map for the fraction to be a fraction OF, and the write
	// would normalize straight back to nowhere.
	it("refuses a mark that names no map, rather than storing a homeless fraction", async () => {
		const d = dialog({ origin: null });
		rendered = 0;
		await d._drawJourneyMark({ fx: 0.5, fy: 0.5 }, {});
		expect(saved().journey.origin).toBeNull();
		expect(rendered).toBe(0);
	});

	// GM-ONLY. The dropdown this all replaces was live for a player and wrote nothing when they
	// used it, because the trip lives in a world setting; the class that lights the list rows must
	// not offer them the gesture either.
	it("offers the gesture to a GM and not to a player", async () => {
		expect((await dialog({ origin: null })._buildJourney()).needsStart).toBe(true);
		global.game.user.isGM = false;
		const built = await dialog({ origin: null })._buildJourney();
		expect(built.needsStart).toBe(false);
		// And the reader is told plainly that there is no start yet, rather than being shown one.
		expect(built.start.set).toBe(false);
		expect(built.start.name).toBeNull();
	});
});

// THE RIGHT-CLICK LADDER, which is what let the row of controls above the map go: every state this
// screen can be put into by clicking comes back off by right-clicking, in the order it went on.
describe("taking the trip back a step at a time", () => {
	beforeEach(() => {
		global.ui = { notifications: { info: () => {}, warn: () => {} } };
	});

	// The whole ladder, walked in one test, because the ORDER is the thing worth pinning: marks
	// first, then where they were bound, then where they were setting out from.
	it("peels the marks, then the destination, then the start", async () => {
		const d = dialog({
			origin: "stonetop", destination: "marshedge",
			custom: { tier: "vicinity", points: [{ slug: "gordins-delve" }] },
		});

		await d._undoJourneyMark();
		expect(saved().journey.custom.points).toEqual([]);
		expect(saved().journey.destination).toBe("marshedge");

		await d._undoJourneyMark();
		expect(saved().journey.destination).toBe("");
		expect(saved().journey.origin).toBe("stonetop");

		await d._undoJourneyMark();
		expect(saved().journey.origin).toBeNull();
		expect(d._journeyPick().start.slug).toBeNull();
	});

	// Past the last rung there is nothing to take, and taking nothing must cost nothing: no
	// world-setting write, no re-render, no sweep of the open map windows.
	it("writes nothing once the trip is already back to nothing", async () => {
		const d = dialog({ origin: null });
		rendered = 0;
		await d._undoJourneyMark();
		expect(rendered).toBe(0);
	});

	// And then the next click starts it again, which is the whole point of being able to reach this
	// state at all: a party camped in the Flats says so by right-clicking twice and clicking once.
	it("lets the next click plant the start again", async () => {
		const d = dialog({ origin: "stonetop" });
		await d._undoJourneyMark();
		expect(saved().journey.origin).toBeNull();

		await d._drawJourneyMark({ fx: 0.36, fy: 0.62 }, { tier: "vicinity" });
		expect(saved().journey.origin).toMatchObject({ tier: "vicinity", fx: 0.36, fy: 0.62 });
	});

	// A trip with no start has no journey: no line, no solved times, and nothing for the scene
	// button to draw. The destination list still lists its places — it is the map's legend — but the
	// times beside them are gone, because there is nowhere to reckon them from.
	it("leaves no route and no times behind it", async () => {
		const built = await dialog({ origin: null, destination: "marshedge" })._buildJourney();
		expect(built.route).toBeNull();
		expect(built.scene).toBeNull();
		expect(built.groups.flatMap(g => g.places).every(place => !place.time)).toBe(true);
	});

	// IN A WORLD WITH NO BOOK ART THE LIST IS THE WHOLE SCREEN, and this ladder is the only way back
	// from a pick now that the row of controls has gone. Without the list carrying it, such a GM
	// could set a trip and never un-set it — no picture to right-click, and so no way to reach the
	// state where the next click says where the party is. See `bindJourneyUndo`.
	it("is reachable from the destination list, which is all a world with no art has", () => {
		const markup = read("templates/dialogs/partials/expedition-journey.hbs");
		expect(read("module/dialogs/ExpeditionDialog.js")).toContain("bindJourneyUndo(html[0]");
		// And the state is said in words there, since there is no picture whose caption could say
		// it — but only there, or the map's own caption would be saying it twice.
		const hint = markup.slice(markup.indexOf("{{#unless journey.map}}"));
		expect(hint).toContain("journey.needsStart");
		expect(hint).toContain("right-click a place to take the trip back a step");
	});
});

describe("drawing a start the GM put down", () => {
	const inTheFlats = { tier: "vicinity", fx: 0.36, fy: 0.62 };

	// A mark carries its own position, so it gets a mark of its own. A LETTERED start does not: it
	// is already drawn by its own pin wearing the setting-out ring, and a second mark on top of it
	// would be the same fact drawn twice.
	it("puts a pin of its own on the map, and only for a start with no place to name", async () => {
		const placed = await dialog({ origin: inTheFlats })._buildJourney();
		expect(placed.map.start).toMatchObject({ label: "setting out" });
		expect(placed.map.start.left).toBeGreaterThan(0);
		expect(placed.map.spots.some(spot => spot.isOrigin)).toBe(false);

		const lettered = await dialog({ origin: "stonetop" })._buildJourney();
		expect(lettered.map.start).toBeNull();
		expect(lettered.map.spots.some(spot => spot.isOrigin)).toBe(true);
	});

	// Its fractions mean one valley on the Vicinity and quite another on the World's End, so the
	// other map draws nothing rather than drawing it wrong.
	it("draws on its own map and on no other", async () => {
		const built = await dialog({ origin: inTheFlats })._buildJourney("worlds-end");
		expect(built.map.start).toBeNull();
	});

	// And the panel opens on the map the party is standing on, rather than following a destination
	// out to one that cannot show where they are.
	it("opens the panel on the map the mark belongs to", async () => {
		const built = await dialog({ origin: inTheFlats, destination: "marshedge" })._buildJourney();
		expect(built.activeTier).toBe("vicinity");
	});

	// "This way was drawn on The Vicinity" is the wrong sentence for a trip nobody drew. Both are
	// about a route pinned to one map; only one of them is about somebody's pen.
	it("says why the other map is empty without claiming somebody drew this", async () => {
		const built = await dialog({ origin: inTheFlats, destination: "marshedge" })._buildJourney("worlds-end");
		expect(built.map.offMap.sentence).toContain("set out from a point on The Vicinity");
		expect(built.map.offMap.sentence).not.toContain("drew");
	});

	// The list is the map's legend and, in a world with no art, the whole screen. Every place keeps
	// a time — the book's own roads plus one measured leg — and the tilde is what says which is which.
	it("keeps a time on every row, tilded because one leg was measured", async () => {
		const built = await dialog({ origin: inTheFlats })._buildJourney();
		const rows = built.groups.flatMap(g => g.places);
		expect(rows.every(row => !!row.time)).toBe(true);
		expect(rows.every(row => row.time.startsWith("~"))).toBe(true);
		// Against the trip that leaves a lettered place, where nothing is measured and nothing is
		// tilded — and where home itself has no route from home.
		const home = await dialog({ origin: "stonetop" })._buildJourney();
		const timed = home.groups.flatMap(g => g.places).filter(row => row.time);
		expect(timed.length).toBeGreaterThan(0);
		expect(timed.some(row => row.time.startsWith("~"))).toBe(false);
	});

	// A way by hand starts where the party is, so the map it can be laid on is the one they are
	// standing on. On the other tab the invitation would be teaching a gesture with nowhere to make it.
	it("lets a way be drawn on its own map, and nowhere else", async () => {
		const here = await dialog({ origin: inTheFlats })._buildJourney();
		expect(here.custom.canDrawHere).toBe(true);
		const there = await dialog({ origin: inTheFlats })._buildJourney("worlds-end");
		expect(there.custom.canDrawHere).toBe(false);
		expect(there.custom.hint).toContain("a point on The Vicinity");
	});
});

// ── The markup and the stylesheet agree about the gesture ────────────────────
//
// Three files have to say the same thing for the armed state to be visible at all: the partial
// renders the sentence, the binder writes the class, and the stylesheet is what reveals it. Arming
// deliberately costs no re-render (a render would replace the very picture the click is armed on),
// so a disagreement here is a mode with no way of telling the reader it is on.
describe("the row above the map, and what replaced it", () => {
	const partial = f => readFileSync(
		new URL(`../../templates/dialogs/partials/${f}`, import.meta.url), "utf8");

	// THE WHOLE ROW OF PICKS IS GONE (user, 2026-08-24): "Setting out from Stonetop" as a button
	// that armed the next click, "bound for Marshedge", and the × that un-picked it. Three readings
	// of what the map already draws in pins, one of them a mode invisible until you were in it, and
	// the only way out of two of those states.
	it("draws neither end of the journey as a control any more", () => {
		const markup = partial("expedition-journey-controls.hbs");
		for (const gone of [
			"<select", "originOptions", "stonetop-journey-picks", "stonetop-journey-start-btn",
			"stonetop-journey-bound", "stonetop-journey-clear\"", "stonetop-journey-starthint",
		]) expect(markup).not.toContain(gone);
	});

	// And nothing is left styling them either: a stylesheet still dressing markup nobody renders is
	// how a control comes back half-alive.
	it("leaves no styling behind for the row it removed", () => {
		const css = readCss();
		for (const gone of [
			".stonetop-journey-picks", ".stonetop-journey-picklab", ".stonetop-journey-start-btn",
			".stonetop-journey-startname", ".stonetop-journey-starthint", ".stonetop-journey-bound",
		]) expect(css).not.toContain(`}\n${gone} `);
		expect(css).not.toContain(".is-setting-out ");
	});

	// PUT THE ROUTE ON THE SCENE moved next to PUT A SITE ON THE MAP (user, 2026-08-24). Both write
	// something onto a picture, and the row of facts the scene button used to sit in has gone — so
	// the two buttons that act on a map are what the map-tab row now ends with.
	it("ends the map-tab row with the two buttons that write onto a picture", () => {
		const markup = partial("expedition-journey-controls.hbs");
		const row = markup.slice(markup.indexOf("stonetop-journey-tiers"));
		const site = row.indexOf("stonetop-journey-place-site");
		const scene = row.indexOf("stonetop-journey-to-scene");
		expect(site).toBeGreaterThan(-1);
		expect(scene).toBeGreaterThan(site);
		// Inside the row rather than after it, or they would wrap onto a line of their own.
		expect(row.indexOf("</div>", scene)).toBeGreaterThan(scene);
	});

	// The two are built on different conditions — the site button wants a map on screen, the scene
	// button wants a route, and a route can be plotted in a world with no book art at all — so the
	// site button's auto margin cannot be the only thing holding the pair at the right end.
	it("keeps the scene button at the right end even when it is alone there", () => {
		expect(declarations(readCss(), ".stonetop-journey .stonetop-journey-place-site"))
			.toContain("margin-left: auto;");
		expect(ownRule(readCss(),
			".stonetop-journey .stonetop-journey-tierlist + .stonetop-journey-to-scene"))
			.toContain("margin-left: auto");
	});

	// The rows of the destination list answer "where do they set out from?" while the trip has no
	// start, which is what makes the gesture work in a world that never imported the book art. A
	// RENDERED state now (ExpeditionDialog `needsStart`), not an armed one: there is no mode left to
	// arm, so the class comes off the same build as everything else on the screen.
	it("lights the destination list, in the green of the near end of the journey", () => {
		const css = readCss();
		expect(read("templates/dialogs/partials/expedition-journey.hbs"))
			.toContain("journey.needsStart}} is-needing-start");
		expect(read("templates/dialogs/travel-map.hbs"))
			.toContain("journey.needsStart}} is-needing-start");
		// The ink on the row, the box around the whole row (gazetteer icon included) on its <li>.
		const ink = ownRule(css, ".stonetop-journey.is-needing-start .stonetop-journey-row:hover");
		const box = ownRule(css,
			".stonetop-journey.is-needing-start .stonetop-journey-list li:has(.stonetop-journey-row:hover)");
		expect(ink).toContain("--st-green");
		expect(box).toContain("--st-green");
		expect(`${ink}${box}`).not.toContain("--st-gold");
	});

	// A start the GM placed takes no clicks at all, exactly as a drawn way's numerals do not: every
	// gesture over that picture is about the way, and a mark that swallowed one would be the one
	// thing on the map that stops the map working.
	it("draws a placed start as a mark that takes no clicks", () => {
		expect(partial("expedition-journey-pins.hbs")).toContain("stonetop-journey-start");
		expect(declarations(readCss(), ".stonetop-journey-canvas .stonetop-journey-start"))
			.toContain("pointer-events: none;");
	});
});
