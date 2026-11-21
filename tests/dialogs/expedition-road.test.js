import Handlebars from "handlebars";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { declarations, readCss, readRepo as read } from "../fakes/css.js";

// Running the journey's road panel (partials/expedition-trail.hbs, ExpeditionDialog#_roadContext):
// where the party is on the route, a row per leg, and the GM's Travel / Back a leg. The count is
// stored on the trip with the key of the route it was counted on (utils/trip-progress.js). A forward
// step onto a stop the players were shown sends them the arrival band, in their own words.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));
const sent = vi.hoisted(() => []);
vi.mock("../../module/moments/moment-broadcast.js", () => ({ sendMoment: payload => { sent.push(payload); return true; } }));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { sharedRoutePayload } = await import("../../module/utils/shared-route.js");
const { journeyKey, journeyRoute } = await import("../../module/utils/travel-route.js");

const TRAIL = read("templates/dialogs/partials/expedition-trail.hbs");
const HBS = read("templates/dialogs/expedition.hbs");
const CSS = readCss();

// Stonetop to Three Coven Lake, which the book's table routes by way of the Steplands (4 + 3 days).
const JOURNEY = { origin: "stonetop", destination: "three-coven-lake" };
const LEGS = journeyRoute(JOURNEY).legs;

let store;

function dialog(trip) {
	store.expeditionAnswers = { currentId: trip?.id ?? null, list: trip ? [trip] : [] };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d._step = ExpeditionDialog.prototype._steps.findIndex(s => s.key === "running");
	d.render = () => {};
	// No window on the page: the panel's redraw has nothing to swap, and says so.
	d._refreshRoadPanel = vi.fn(async () => null);
	return d;
}

const trip = (reached, extra = {}) => ({
	id: "trip-1", title: "The Long Walk", createdAt: 0, journey: JOURNEY,
	...(reached === undefined ? {} : { progress: { reached, key: journeyKey(JOURNEY) } }),
	...extra,
});
const stored = () => store.expeditionAnswers.list[0];

function trail(road) {
	const hb = Handlebars.create();
	return hb.compile(TRAIL)({ road });
}

beforeEach(() => {
	sent.length = 0;
	store = { expeditionAnswers: {} };
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true, id: "gm" },
		actors: Object.assign([], { contents: [] }),
		settings: {
			settings: new Map([
				["stonetop-pwd.expeditionAnswers", { scope: "world" }],
				["stonetop-pwd.sharedRoute", { scope: "world" }],
			]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("the route this test walks", () => {
	it("has more than one leg", () => {
		expect(LEGS.length).toBeGreaterThan(1);
	});
});

describe("the panel's context", () => {
	it("says no route is plotted, and offers the route step, with nothing to travel", () => {
		const road = dialog(trip(undefined, { journey: {} }))._roadContext();
		expect(road.hasRoute).toBe(false);
		expect(road.where).toBe("No route is plotted for this trip yet.");
		expect(road.routeStepIndex).toBe(ExpeditionDialog.prototype._steps.findIndex(s => s.key === "journey"));
	});

	it("at the start, says whether they have set out, and offers the first stop", () => {
		const road = dialog(trip(0))._roadContext();
		expect(road.where).toBe(`They have not set out yet, from ${LEGS[0].fromName}.`);
		expect(dialog(trip(0, { setOut: { season: "summer", year: 1 } }))._roadContext().where)
			.toBe(`At ${LEGS[0].fromName}, ready to leave.`);
		expect(road.travel).toEqual({ label: `Travel on to ${LEGS[0].toName}`, disabled: false });
		expect(road.back.disabled).toBe(true);
		expect(road.legs.map(l => l.state)).toEqual(LEGS.map((_, i) => (i === 0 ? "next" : "ahead")));
	});

	it("mid-route, names the leg and the next stop, with the leg behind them travelled", () => {
		const road = dialog(trip(1))._roadContext();
		expect(road.where).toBe(`Leg 2 of ${LEGS.length}: next stop ${LEGS[1].toName}.`);
		expect(road.legs[0].stateLabel).toBe("travelled");
		expect(road.legs[1].stateLabel).toBe("next");
		expect(road.back.disabled).toBe(false);
	});

	it("arrived, says where, and travels no further", () => {
		const road = dialog(trip(LEGS.length))._roadContext();
		expect(road.where).toBe(`Arrived at ${LEGS.at(-1).toName}.`);
		expect(road.travel.disabled).toBe(true);
	});

	it("offers the days only for a leg just travelled that is measured in days", () => {
		const daysAt = LEGS.findIndex(l => l.unit === "days");
		const hoursAt = LEGS.findIndex(l => l.unit !== "days");
		if (daysAt >= 0) {
			const offer = dialog(trip(daysAt + 1))._roadContext().daysOffer;
			expect(offer.days).toBe(LEGS[daysAt].min);
			expect(offer.label).toMatch(/^Spend \d+ days? of supplies…$/);
		}
		if (hoursAt >= 0) expect(dialog(trip(hoursAt + 1))._roadContext().daysOffer).toBeNull();
		expect(dialog(trip(0))._roadContext().daysOffer).toBeNull();
	});

	it("counts a route changed since as not yet travelled", () => {
		const moved = trip(1, { progress: { reached: 1, key: "table|stonetop|marshedge" } });
		expect(dialog(moved)._roadContext().legs[0].state).toBe("next");
	});
});

describe("the panel's markup", () => {
	it("draws a row per leg with its state word, and the where line as a live region", () => {
		const html = trail(dialog(trip(1))._roadContext());
		expect(html.match(/class="stonetop-exp-trail-leg /g)).toHaveLength(LEGS.length);
		expect(html).toContain('<p class="stonetop-exp-trail-where" role="status" aria-live="polite">');
		expect(html).toContain('<span class="stonetop-exp-trail-leg-state">travelled</span>');
		expect(html).toContain('<span class="stonetop-exp-trail-leg-state">next</span>');
		expect(html).toMatch(/<span class="stonetop-exp-trail-marker" aria-hidden="true">/);
	});

	it("gives a player no buttons", () => {
		game.user = { isGM: false };
		const html = trail(dialog(trip(1))._roadContext());
		expect(html).not.toContain("<button");
	});

	it("disables Back at the start and Travel once arrived", () => {
		expect(trail(dialog(trip(0))._roadContext())).toMatch(/stonetop-exp-trail-back[^>]*disabled/);
		expect(trail(dialog(trip(LEGS.length))._roadContext())).toMatch(/stonetop-exp-trail-travel[^>]*disabled/);
	});

	it("sits under the set-out stamp in the walkthrough, in a host it can be redrawn into alone", () => {
		expect(HBS.indexOf('{{#if this.tripStamp.atTop}}')).toBeLessThan(HBS.indexOf("stonetop-exp-trail-wrap"));
		expect(HBS).toContain('<div class="stonetop-exp-trail-wrap">{{> "stonetop.expedition-trail" road=this.road}}</div>');
		expect(read("stonetop.js")).toContain('"stonetop.expedition-trail":');
	});
});

describe("Travel and Back a leg", () => {
	it("travels one leg, stamped with the route's key", async () => {
		const d = dialog(trip(0));
		await d._travel(1);
		expect(stored().progress).toEqual({ reached: 1, key: journeyKey(JOURNEY) });
		await d._travel(-1);
		expect(stored().progress.reached).toBe(0);
	});

	it("writes nothing back past the start or on past the end", async () => {
		const d = dialog(trip(0));
		const before = store.expeditionAnswers;
		await d._travel(-1);
		expect(store.expeditionAnswers).toBe(before);
		const far = dialog(trip(LEGS.length));
		const atEnd = store.expeditionAnswers;
		await far._travel(1);
		expect(store.expeditionAnswers).toBe(atEnd);
	});

	it("tells the players only of a forward step onto a stop of the route they were shown", async () => {
		const shown = trip(0);
		await dialog(shown)._travel(1);
		expect(sent).toEqual([]);

		const d = dialog(shown);
		store.sharedRoute = sharedRoutePayload({ trip: shown, tier: "worlds-end", id: "share-1", now: 1 });
		await d._travel(1);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "arrive", title: `Reached ${LEGS[0].toName}` });
		sent.length = 0;
		await d._travel(-1);
		expect(sent).toEqual([]);
	});
});

describe("the banner's status chip", () => {
	const chip = t => dialog(t)._tripStatusChip();

	it("reads each state, with the leg on the road", () => {
		expect(chip(trip(0))).toEqual({ key: "planning", label: "Planning" });
		expect(chip(trip(1))).toEqual({ key: "road", label: `On the road, leg 2 of ${LEGS.length}` });
		expect(chip(trip(LEGS.length))).toEqual({ key: "arrived", label: "Arrived" });
		expect(chip(trip(LEGS.length, { timelineRecorded: { season: "autumn", year: 1 } }))).toEqual({ key: "home", label: "Home" });
	});

	it("stands in the banner for the step count only once there is a trip", () => {
		expect(HBS).toMatch(/\{\{#if this\.tripStatus\}\}\s*<span class="stonetop-exp-status stonetop-exp-status--\{\{this\.tripStatus\.key\}\}" data-exp-status>\{\{this\.tripStatus\.label\}\}<\/span>\s*\{\{else\}\}\s*<div class="stonetop-guide-count">/);
	});
});

describe("the stylesheet", () => {
	it("walks the marker by keyframes, with both reduced-motion exits", () => {
		expect(declarations(CSS, ".stonetop-expedition-dialog .stonetop-exp-trail-marker.is-walking"))
			.toMatch(/animation:\s*stonetop-exp-trail-walk 0\.9s/);
		expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.stonetop-expedition-dialog \.stonetop-exp-trail-marker\.is-walking,\s*\.stonetop-expedition-dialog \.stonetop-exp-trail-marker\.is-walking > i \{ animation: none; \}/);
		// The Reduce Motion setting's blanket rule reaches it, being inside `.stonetop`; the script skips the walk too
		// (flash-highlight.js `playClassOnce` plays nothing for reduced motion).
		expect(read("module/dialogs/ExpeditionDialog.js")).toMatch(/playClassOnce\(marker, \["is-walking"\]/);
		expect(read("module/utils/flash-highlight.js")).toMatch(/export function playClassOnce\(el, classes, \{ fallbackMs \}\) \{\s*if \([^)]*prefersReducedMotion\(\)\) return false;/);
		expect(declarations(CSS, ".stonetop-expedition-dialog .stonetop-exp-trail-marker")).not.toMatch(/transition/);
	});

	it("measures the marker against its track", () => {
		expect(declarations(CSS, ".stonetop-expedition-dialog .stonetop-exp-trail-track")).toMatch(/position:\s*relative/);
	});
});
