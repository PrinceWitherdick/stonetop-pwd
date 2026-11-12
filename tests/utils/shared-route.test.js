import { describe, it, expect, beforeEach } from "vitest";

// The route a GM shows the players, outside the canvas (module/utils/shared-route.js). Pure over
// the real travel table, so every sentence asserted here is one a player would actually read.

const {
	isSharedRoute, readSharedRoute, sharedRoutePayload, sharedRouteState, sharedRouteView,
	sharedRouteCardHtml, sharedRouteChip, sharedLegLine, shareRoute, stopSharingRoute,
	sharedRequirementLines, sharedRequirementsHtml, publicRoute,
} = await import("../../module/utils/shared-route.js");
const { frameFor } = await import("../../module/data/travel-times.js");
const { journeyMapLayer } = await import("../../module/dialogs/journey-map-layer.js");
const { journeyRoute, normalizeJourney, solveFrom } = await import("../../module/utils/travel-route.js");

const ART = {
	src: "stonetop-book-art/assets/maps/gm-vicinity.webp",
	out: "assets/maps/gm-vicinity.webp",
	frame: frameFor("assets/maps/gm-vicinity.webp"),
	aspect: 584 / 422,
};

let store;
beforeEach(() => {
	store = {};
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.sharedRoute", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

const trip = (journey, extra = {}) => ({ id: "trip-1", title: "", journey, ...extra });
const crossroads = () => sharedRoutePayload({
	trip: trip({ origin: "stonetop", destination: "the-crossroads" }), tier: "vicinity", art: ART, id: "share-1", now: 1,
});

describe("what a share stores", () => {
	it("stores the trip as the scene flag does, the map's file, and nothing of the notes", () => {
		const payload = sharedRoutePayload({
			trip: trip({ origin: "stonetop", destination: "the-crossroads" }, { title: "To the Crossroads", chart: { notes: "secret prep" } }),
			tier: "vicinity", art: { ...ART, extra: "dropped" }, id: "x", now: 5,
		});
		expect(payload).toEqual({
			id: "x", sharedAt: 5, expeditionId: "trip-1", title: "To the Crossroads",
			journey: { origin: "stonetop", destination: "the-crossroads", custom: null },
			tier: "vicinity",
			art: { src: ART.src, out: ART.out, frame: ART.frame, aspect: ART.aspect },
		});
		expect(JSON.stringify(payload)).not.toContain("secret prep");
	});

	// A drawn way keeps its marks and drops the destination, so changing the pick under a drawn
	// way does not make the share look out of step (utils/scene-route.js storedJourney).
	it("stores a drawn way as its marks, with the destination written as null", () => {
		const payload = sharedRoutePayload({
			trip: trip({ origin: "stonetop", destination: "lygos", custom: { tier: "vicinity", points: [{ slug: "the-crossroads" }, { fx: 0.4, fy: 0.5 }] } }),
			tier: "vicinity", art: ART,
		});
		expect(payload.journey.destination).toBeNull();
		expect(payload.journey.custom.tier).toBe("vicinity");
		expect(payload.journey.custom.points).toHaveLength(2);
	});

	it("stores no picture where the world has no copy of the map", () => {
		expect(sharedRoutePayload({ trip: trip({ destination: "the-crossroads" }), tier: "vicinity", art: null }).art).toBeNull();
	});

	it("makes nothing of a trip with nowhere to go", () => {
		expect(sharedRoutePayload({ trip: trip({ origin: "stonetop" }), tier: "vicinity" })).toBeNull();
	});
});

describe("reading what is being shown", () => {
	it("reads nothing from the empty value, junk, or a journey that solves to no route", () => {
		for (const value of [undefined, {}, [], "x", { id: "a" }, { id: "a", journey: { origin: "stonetop" } }]) {
			expect(isSharedRoute(value)).toBe(false);
		}
		store.sharedRoute = {};
		expect(readSharedRoute()).toBeNull();
	});

	it("reads back a share that was written", async () => {
		await shareRoute(crossroads());
		expect(readSharedRoute()?.id).toBe("share-1");
		await stopSharingRoute();
		expect(store.sharedRoute).toEqual({});
		expect(readSharedRoute()).toBeNull();
	});

	it("writes nothing for a player", async () => {
		global.game.user.isGM = false;
		await shareRoute(crossroads());
		expect(store.sharedRoute).toBeUndefined();
	});
});

describe("where the share stands against the GM's trip", () => {
	const journey = { origin: "stonetop", destination: "the-crossroads" };
	it("is none with nothing shown", () => {
		expect(sharedRouteState(null, { expeditionId: "trip-1", journey, hasRoute: true })).toBe("none");
	});
	it("is same when this trip's way is what is shown", () => {
		expect(sharedRouteState(crossroads(), { expeditionId: "trip-1", journey, hasRoute: true })).toBe("same");
	});
	it("is stale when this trip now goes elsewhere", () => {
		expect(sharedRouteState(crossroads(), {
			expeditionId: "trip-1", journey: { origin: "stonetop", destination: "the-maw" }, hasRoute: true,
		})).toBe("stale");
	});
	it("is stale when the same way belongs to another trip", () => {
		expect(sharedRouteState(crossroads(), { expeditionId: "trip-2", journey, hasRoute: true })).toBe("stale");
	});
	// Code review 11-10: the Chart a Course lines sent with it go stale when the GM changes them.
	it("is stale when the Chart a Course lines it carried have changed since", () => {
		const lines = [{ label: "Requirements", lines: ["At least 2 days of food"] }];
		const shared = { ...crossroads(), requirements: lines };
		const at = { expeditionId: "trip-1", journey, hasRoute: true };
		expect(sharedRouteState(shared, { ...at, requirements: lines })).toBe("same");
		expect(sharedRouteState(shared, { ...at, requirements: [{ label: "Requirements", lines: ["At least 3 days of food"] }] })).toBe("stale");
		// A share sent without them has none to go stale.
		expect(sharedRouteState(crossroads(), { ...at, requirements: [] })).toBe("same");
	});
	// The scene button's lesson: with no route in hand, there must still be a way to take it off.
	it("is orphan when something is shown and this trip has no route", () => {
		expect(sharedRouteState(crossroads(), { expeditionId: "trip-1", journey: {}, hasRoute: false })).toBe("orphan");
	});
});

describe("what the players read", () => {
	it("names the way, says how long it takes, and writes every leg out in words", () => {
		const view = sharedRouteView(crossroads());
		expect(view.title).toBe("The way to the Crossroads");
		expect(view.summary).toMatch(/^Stonetop to the Crossroads: at least /);
		expect(view.total).toMatch(/^It will take at least .+\.$/);
		expect(view.legs.length).toBeGreaterThan(0);
		expect(view.legs[0].text).toMatch(/^Stonetop to /);
	});

	it("keeps the trip's own title where the GM gave it one", () => {
		const payload = sharedRoutePayload({ trip: trip({ destination: "the-crossroads" }, { title: "The Long Walk" }), tier: "vicinity", art: ART });
		expect(sharedRouteView(payload).title).toBe("The Long Walk");
	});

	// A tilde read aloud is the word "tilde".
	it("says about rather than a tilde for a measured leg", () => {
		expect(sharedLegLine({ fromName: "Stonetop", toName: "point 1", time: "2 days", estimated: true }))
			.toBe("Stonetop to point 1, about 2 days");
		expect(sharedLegLine({ fromName: "Stonetop", toName: "Marshedge", time: "10 days", via: "the Roads" }))
			.toBe("Stonetop to Marshedge, 10 days (via the Roads)");
		expect(sharedLegLine({ fromName: "A", toName: "B" })).toBe("A to B");
	});

	it("describes the picture by its map and both ends of the way", () => {
		expect(sharedRouteView(crossroads()).map.alt)
			.toBe("The Vicinity, with the way from Stonetop to the Crossroads drawn on it.");
	});

	// The players' picture is the answer, not the planner: only the places that carry it.
	it("keeps only the labelled places and the arrows that name a stop, and none of the GM's sites", () => {
		const { map } = sharedRouteView(crossroads());
		expect(map.sites).toEqual([]);
		expect(map.spots.length).toBeGreaterThan(0);
		expect(map.spots.every(spot => spot.showLabel)).toBe(true);
		expect(map.spots.map(spot => spot.slug)).toEqual(expect.arrayContaining(["stonetop", "the-crossroads"]));
		expect(map.exits.every(exit => exit.isChosen || exit.isStop)).toBe(true);
		expect(map.path?.d).toBeTruthy();
	});

	it("draws the same line the walkthrough would", () => {
		const payload = crossroads();
		const { start, origin, destination } = normalizeJourney(payload.journey);
		const route = journeyRoute(payload.journey);
		const gm = journeyMapLayer("vicinity", ART, { routes: solveFrom(start), route, start, origin, destination });
		expect(sharedRouteView(payload).map.path).toEqual(gm.path);
	});

	it("has no map without a picture, and still says the whole journey", () => {
		const view = sharedRouteView(sharedRoutePayload({ trip: trip({ destination: "the-crossroads" }), tier: "vicinity", art: null }));
		expect(view.map).toBeNull();
		expect(view.legs.length).toBeGreaterThan(0);
	});

	it("says how a drawn way's estimate was made", () => {
		const view = sharedRouteView(sharedRoutePayload({
			trip: trip({ origin: "stonetop", custom: { tier: "vicinity", points: [{ fx: 0.4, fy: 0.5 }] } }),
			tier: "vicinity", art: ART,
		}));
		expect(view.title).toBe("The way they are going");
		expect(view.estimated).toBe(true);
		expect(view.estimateNote).toContain("The Vicinity");
		expect(view.legs.some(leg => leg.text.includes("about"))).toBe(true);
	});
});

describe("the chat card and the steading chip", () => {
	it("lists every leg, escapes what it prints, and offers the map only where there is one", () => {
		const view = sharedRouteView(crossroads());
		const html = sharedRouteCardHtml(view);
		for (const leg of view.legs) expect(html).toContain(leg.text.replace(/'/g, "&#39;"));
		expect(html).toContain("stonetop-shared-route-open");
		expect(html).toContain("See the route");
		expect(sharedRouteCardHtml({ ...view, title: "x", total: "<b>", legs: [], map: null })).not.toContain("<b>");
		expect(sharedRouteCardHtml({ ...view, map: null })).not.toContain("stonetop-shared-route-open");
	});

	it("lights the steading chip only while something is shown", () => {
		expect(sharedRouteChip(null)).toBeNull();
		const chip = sharedRouteChip(crossroads());
		expect(chip.label).toBe("See the route");
		expect(chip.tooltip).toContain("Stonetop to the Crossroads");
	});
});

describe("the map layer builds without a GM", () => {
	it("needs no user, and draws the sites it is handed and no others", () => {
		global.game = { i18n: global.game.i18n };
		const { start, origin, destination } = normalizeJourney({ destination: "the-crossroads" });
		const route = journeyRoute({ destination: "the-crossroads" });
		const site = { uuid: "u", name: "A barrow", left: 1, top: 2 };
		expect(journeyMapLayer("vicinity", ART, { routes: solveFrom(start), route, start, origin, destination }).sites).toEqual([]);
		expect(journeyMapLayer("vicinity", ART, { routes: solveFrom(start), route, start, origin, destination, sites: [site] }).sites)
			.toEqual([site]);
		expect(journeyMapLayer("vicinity", null, {})).toBeNull();
	});
});

// Audit RTE-6 / ruling E17: a stop the GM put down is "point 2" on the GM's side, which says where
// it is only to someone who can see the numeral. The players hear what the GM typed for it, or
// where it stands against the nearest place the map letters.
describe("naming the GM's own stops for the players", () => {
	const drawn = (points, origin = "stonetop") => sharedRoutePayload({
		trip: trip({ origin, custom: { tier: "vicinity", points } }), tier: "vicinity", art: ART, id: "d", now: 1,
	});

	it("says a bare stop is near the nearest lettered place, numeral and all", () => {
		const view = sharedRouteView(drawn([{ fx: 0.88, fy: 0.6 }]));
		expect(view.legs[0].text).toMatch(/^Stonetop to near the Red Grove \(point 1\), about /);
		expect(view.map.alt).toContain("near the Red Grove (point 1)");
	});

	it("says what the GM typed, and never the site the stop was laid on", () => {
		const payload = drawn([{ fx: 0.88, fy: 0.6, siteUuid: "s1", name: "The Sunken Barrow", label: "the old shrine" }]);
		expect(JSON.stringify(payload)).not.toContain("Sunken");
		expect(payload.journey.custom.points[0]).toEqual({ fx: 0.88, fy: 0.6, label: "the old shrine" });
		expect(sharedRouteView(payload).legs[0].text).toMatch(/^Stonetop to the old shrine \(point 1\)/);
	});

	it("says a start the GM put down is a point near a place", () => {
		const payload = sharedRoutePayload({
			trip: trip({ origin: { tier: "vicinity", fx: 0.88, fy: 0.6 }, destination: "the-crossroads" }),
			tier: "vicinity", art: ART, id: "m", now: 1,
		});
		expect(sharedRouteView(payload).legs[0].text).toMatch(/^a point near the Red Grove to /);
	});

	it("says what the GM typed for a start they put down", () => {
		const payload = sharedRoutePayload({
			trip: trip({ origin: { tier: "vicinity", fx: 0.88, fy: 0.6, label: " the old shrine " }, destination: "the-crossroads" }),
			tier: "vicinity", art: ART, id: "m", now: 1,
		});
		expect(payload.journey.origin.label).toBe("the old shrine");
		expect(sharedRouteView(payload).legs[0].text).toMatch(/^the old shrine to /);
	});

	it("keeps a later leg's stored from-name when its bare mark has no name and no place near it", () => {
		const route = { tier: null, stops: [], legs: [
			{ from: "stonetop", fromName: "Stonetop", toSpot: { fx: 0.5, fy: 0.5 }, toName: "the bend" },
			{ fromSpot: { fx: 0.5, fy: 0.5 }, fromName: "the bend", to: "marshedge", toName: "Marshedge" },
		] };
		const legs = publicRoute(route).legs;
		expect(legs[0].toName).toBe("the bend");
		expect(legs[1].fromName).toBe("the bend");
	});

	it("carries no start words for a start that is a lettered place", () => {
		const payload = sharedRoutePayload({
			trip: trip({ origin: { slug: "stonetop", label: "the old shrine" }, destination: "the-crossroads" }),
			tier: "vicinity", art: ART, id: "p", now: 1,
		});
		expect(payload.journey.origin).toBe("stonetop");
		expect(sharedRouteView(payload).legs[0].text).toMatch(/^Stonetop to /);
	});
});

// Audit ruling E4: the Chart a Course lines, when the GM sends them.
describe("the Chart a Course lines a share can carry", () => {
	const chart = { picked: [
		{ id: "a", group: "requirements", key: "firstTravel", answer: "" },
		{ id: "b", group: "requirements", key: "days", answer: "" },
		{ id: "c", group: "challenges", key: "watchOut", answer: "the hagr" },
		{ id: "d", group: "challenges", key: "perilous", answer: "they said the bridge is out" },
		{ id: "e", group: "challenges", text: "The Flats flood in spring" },
	] };

	it("fills each line's blank, per leg once the trip must first travel, and leaves the GM's notes out", () => {
		const lygos = journeyRoute({ origin: "stonetop", destination: "lygos" });
		expect(sharedRequirementLines(chart, lygos)).toEqual([
			{ label: "Requirements", lines: [
				"First travel to Marshedge, and from there to your destination",
				"It'll take at least 10 days to Marshedge, then 30 from there, each way (and a corresponding amount of supplies)",
			] },
			{ label: "Challenges", lines: [
				"Watch out for the hagr",
				"The way is perilous, plagued with danger",
				"The Flats flood in spring",
			] },
		]);
		expect(sharedRequirementLines(null, lygos)).toEqual([]);
	});

	it("carries them in the payload, the window's view and the card, as words", () => {
		const requirements = [{ label: "Requirements", lines: ["You'll need to bring rope"] }];
		const payload = sharedRoutePayload({
			trip: trip({ origin: "stonetop", destination: "the-crossroads" }), tier: "vicinity", art: ART,
			requirements, id: "r", now: 1,
		});
		expect(payload.requirements).toEqual(requirements);
		const view = sharedRouteView(payload);
		expect(view.requirements).toEqual(requirements);
		const html = sharedRouteCardHtml(view);
		expect(html).toContain("What the journey asks of them");
		expect(html).toMatch(/<li>You[^<]*ll need to bring rope<\/li>/);
		expect(sharedRequirementsHtml([])).toBe("");
		// Not sent: the key is absent, so a reader can tell "none shared" from "none chosen".
		expect(crossroads().requirements).toBeUndefined();
	});
});

// Audit RTE-12: the title heads the players' window, so a rename makes the share an older one.
describe("a renamed trip", () => {
	it("is an older share once its name changes, and the same one while it does not", () => {
		const shown = crossroads();
		const journey = { origin: "stonetop", destination: "the-crossroads" };
		expect(sharedRouteState(shown, { expeditionId: "trip-1", journey, hasRoute: true, title: "" })).toBe("same");
		expect(sharedRouteState(shown, { expeditionId: "trip-1", journey, hasRoute: true, title: "Dusk run" })).toBe("stale");
		// A caller that does not say leaves the title out of it.
		expect(sharedRouteState(shown, { expeditionId: "trip-1", journey, hasRoute: true })).toBe("same");
	});
});
