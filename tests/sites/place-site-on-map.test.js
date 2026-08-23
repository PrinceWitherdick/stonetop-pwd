import { describe, it, expect, beforeEach, vi } from "vitest";

// Putting one of the GM's own sites on a regional map, and lifting it back off.
//
// The gesture, not any one surface's share of it: the walkthrough's route step and the popped-out
// map both call these, and what is proven here is the order the two halves happen in and what each
// of the ways out of them leaves behind. Where the pin is STORED is proven in site-map-spots.test.js
// and the redraw afterwards is each caller's own business, so neither is repeated here.

const sites = { pages: [], placed: [], cleared: [], chosen: null, steading: { id: "steading" } };

// The chooser's own dialog is a window, so only the picking is faked - the option list
// `chooseSiteForMap` builds is real, and `runPickedOption` runs the chosen row the way it does in
// production, which is what makes "the row IS the flow" hold here too.
vi.mock("../../module/dialogs/content-picker.js", () => ({
	pickContentOption: () => Promise.resolve(sites.chosen),
	runPickedOption: (options, id) => Promise.resolve(options.find(o => o.id === id)?.create() ?? null),
}));
// The WRITER is faked so nothing needs a document, but its normalizer is the real one. Refusing a
// fraction outside the printed crop is the contract this module reads an answer from, and a stand-in
// that accepted everything would happily prove a placement the real writer declines to make.
vi.mock("../../module/sites/site-map-spots.js", async (importOriginal) => {
	const real = await importOriginal();
	return {
		siteMapTier: page => page?.tier ?? null,
		setSiteMapSpot: (page, spot) => {
			const clean = real.readMapSpot(spot);
			if (clean) sites.placed.push({ page, spot: clean });
			return Promise.resolve(clean);
		},
		clearSiteMapSpot: page => { sites.cleared.push(page); return Promise.resolve(); },
	};
});
vi.mock("../../module/sites/site-store.js", () => ({ listSitePages: () => sites.pages }));
vi.mock("../../module/actors/gmtoolkit/gm-prep-actions.js", () => ({ createSiteFlow: () => null }));
vi.mock("../../module/utils/world.js", () => ({
	getStonetopSteadingActorOrWarn: () => sites.steading,
}));

const { liftSiteOffMap, placeSiteOnMap } = await import("../../module/sites/place-site-on-map.js");

/** A written-up site, as the Sites tab holds it. */
const sitePage = (name) => ({ id: name, name, uuid: `JournalEntry.x.JournalEntryPage.${name}`, system: {} });

const BARROW = sitePage("The Sunken Barrow");

// The poster is a DIFFERENT crop of the same drawing, so the middle of the printed page is not the
// middle of the file.
const POSTER = { x0: 0.03, y0: 0.072, x1: 0.97, y1: 0.936 };
const middleOf = (frame) => ({
	left: (frame.x0 + 0.5 * (frame.x1 - frame.x0)) * 100,
	top:  (frame.y0 + 0.5 * (frame.y1 - frame.y0)) * 100,
});

describe("putting a site on the map", () => {
	beforeEach(() => {
		sites.pages = [BARROW];
		sites.placed = [];
		sites.cleared = [];
		sites.chosen = BARROW.id;
		sites.steading = { id: "steading" };
		global.ui = { notifications: { info: () => {}, warn: () => {} } };
		global.fromUuid = uuid => Promise.resolve(sites.pages.find(p => p.uuid === uuid) ?? null);
	});

	it("stores a click as a fraction of the printed crop, not of the file", async () => {
		const wrote = await placeSiteOnMap({
			tier: "vicinity", frame: POSTER, pickPoint: async () => middleOf(POSTER),
		});
		expect(wrote).toBe(true);
		expect(sites.placed).toEqual([{ page: BARROW, spot: { tier: "vicinity", fx: 0.5, fy: 0.5 } }]);
	});

	// The picker shows the whole map FILE, and the printed crop is inset a few percent inside it,
	// so the margin band is on screen and aiming at it is an ordinary miss rather than a broken
	// caller. Announced as placed, it would send the caller off to redraw a pin that is not there.
	it("says so, and claims nothing, when the click lands in the file's margin", async () => {
		const warned = [];
		global.ui = { notifications: { info: () => {}, warn: msg => warned.push(msg) } };

		const wrote = await placeSiteOnMap({
			// Two percent from the left of the FILE, which is outside a crop that starts at three.
			tier: "vicinity", frame: POSTER, pickPoint: async () => ({ left: 2, top: 50 }),
		});

		expect(wrote).toBe(false);
		expect(sites.placed).toEqual([]);
		expect(warned[0]).toContain("The Sunken Barrow");
		expect(warned[0]).toContain("The Vicinity");
	});

	// The other half of the same seam: a site already on the map must not be REPORTED as moved by
	// a miss, which would leave the toast and the pin telling the GM two different things.
	it("does not report a move it did not make", async () => {
		const infos = [];
		global.ui = { notifications: { info: msg => infos.push(msg), warn: () => {} } };

		await placeSiteOnMap({
			tier: "vicinity", frame: POSTER, pickPoint: async () => ({ left: 50, top: 99 }),
		});

		expect(infos.some(msg => msg.includes("is on"))).toBe(false);
	});

	// The chooser comes first and the click last, because the click is the part that has to be
	// precise: Book I's walkthrough is nine steps long, and running it AFTER the aim would lose
	// the point the GM was aiming at.
	it("chooses the site before it asks where it goes", async () => {
		const order = [];
		sites.chosen = null;                      // dismissed, so the aim must never be reached
		await placeSiteOnMap({
			tier: "vicinity", frame: POSTER,
			pickPoint: async () => { order.push("aim"); return { left: 50, top: 50 }; },
		});
		expect(order).toEqual([]);
	});

	it("writes nothing when the chooser is dismissed, and never asks for a click", async () => {
		sites.chosen = null;
		let asked = false;
		const wrote = await placeSiteOnMap({
			tier: "vicinity", frame: POSTER,
			pickPoint: async () => { asked = true; return { left: 50, top: 50 }; },
		});
		expect(wrote).toBe(false);
		expect(asked).toBe(false);
		expect(sites.placed).toEqual([]);
	});

	// Escape, a right-click, or the window closing with the gesture still armed. The site written
	// on the way through is KEPT: it is already on the Sites tab, and binning nine steps of
	// somebody's typing is the worst possible reading of "cancel".
	it("keeps a site whose placement was cancelled, and marks no map", async () => {
		const wrote = await placeSiteOnMap({ tier: "vicinity", frame: POSTER, pickPoint: async () => null });
		expect(wrote).toBe(false);
		expect(sites.placed).toEqual([]);
	});

	// No steading is no place to file a site, and the warn is the helper's own.
	it("does not even open the chooser with nowhere to file a site", async () => {
		sites.steading = null;
		let asked = false;
		const wrote = await placeSiteOnMap({
			tier: "vicinity", frame: POSTER,
			pickPoint: async () => { asked = true; return { left: 50, top: 50 }; },
		});
		expect(wrote).toBe(false);
		expect(asked).toBe(false);
	});
});

describe("lifting a site back off the map", () => {
	beforeEach(() => {
		sites.pages = [BARROW];
		sites.cleared = [];
		global.ui = { notifications: { info: () => {}, warn: () => {} } };
		global.fromUuid = uuid => Promise.resolve(sites.pages.find(p => p.uuid === uuid) ?? null);
	});

	it("lifts a pin without touching the write-up behind it", async () => {
		const lifted = await liftSiteOffMap(BARROW.uuid);
		expect(lifted).toBe(true);
		expect(sites.cleared).toEqual([BARROW]);
	});

	it("does nothing for a pin whose site has since been deleted", async () => {
		const lifted = await liftSiteOffMap("JournalEntry.x.JournalEntryPage.gone");
		expect(lifted).toBe(false);
		expect(sites.cleared).toEqual([]);
	});

	it("does nothing at all for a pin carrying no uuid", async () => {
		expect(await liftSiteOffMap("")).toBe(false);
		expect(sites.cleared).toEqual([]);
	});
});
