import { describe, it, expect, vi } from "vitest";

// Where a GM's own site sits on the books' regional maps.
//
// The value stored is a fraction of the PRINTED CROP, not of whatever file this world happens to
// have (see module/data/travel-times.js#percentSpot), so what matters here is that nothing but a
// complete, in-bounds spot ever gets written or read back: a pin at fx 1.4 draws at 140% and is
// off the paper, and a pin with no tier belongs to no map at all, so neither can be cleared from
// the surface that would otherwise be the only place to notice it.

// The journal walk is the store's, and is proven where the store is. What this module adds is the
// filter, so the list it filters is faked.
const pages = { list: [] };
vi.mock("../../module/sites/site-store.js", () => ({
	listSitePages: () => pages.list,
}));

const {
	SITE_MAP_SPOT_FLAG, clearSiteMapSpot, readMapSpot, setSiteMapSpot, siteMapSpot, siteMapTier,
	sitesOnMap,
} = await import("../../module/sites/site-map-spots.js");

const SCOPE = "stonetop-pwd";

/** A site page with just the flag surface these functions touch. */
function page(name, spot = null) {
	const flags = spot ? { [SCOPE]: { [SITE_MAP_SPOT_FLAG]: spot } } : {};
	return {
		name,
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: (scope, key, value) => { (flags[scope] ??= {})[key] = value; return Promise.resolve(); },
		unsetFlag: (scope, key) => { delete flags[scope]?.[key]; return Promise.resolve(); },
	};
}

describe("what counts as a spot", () => {
	it("takes a whole one", () => {
		expect(readMapSpot({ tier: "vicinity", fx: 0.5, fy: 0.25 }))
			.toEqual({ tier: "vicinity", fx: 0.5, fy: 0.25 });
	});

	it("keeps the two edges, which are on the paper", () => {
		expect(readMapSpot({ tier: "vicinity", fx: 0, fy: 1 })).toEqual({ tier: "vicinity", fx: 0, fy: 1 });
	});

	// Each of these renders as a pin nobody can see and nothing can be told to lift, because the
	// only control that lifts one is the pin itself.
	it.each([
		["no tier", { fx: 0.5, fy: 0.5 }],
		["a blank tier", { tier: "  ", fx: 0.5, fy: 0.5 }],
		["no fy", { tier: "vicinity", fx: 0.5 }],
		["a fraction past the right edge", { tier: "vicinity", fx: 1.4, fy: 0.5 }],
		["a negative fraction", { tier: "vicinity", fx: 0.5, fy: -0.02 }],
		["text where a number goes", { tier: "vicinity", fx: "middle", fy: 0.5 }],
		["nothing at all", undefined],
	])("refuses %s", (_why, raw) => {
		expect(readMapSpot(raw)).toBeNull();
	});
});

describe("reading and writing one site's spot", () => {
	it("round-trips through the flag", async () => {
		const p = page("The Sunken Barrow");
		await setSiteMapSpot(p, { tier: "vicinity", fx: 0.42, fy: 0.61 });
		expect(siteMapSpot(p)).toEqual({ tier: "vicinity", fx: 0.42, fy: 0.61 });
		expect(siteMapTier(p)).toBe("vicinity");
	});

	// The same gate on the way in as on the way out. A caller whose arithmetic went wrong writes
	// nothing, rather than a pin that cannot be seen and cannot be cleared.
	it("writes nothing for a spot it would refuse to read", async () => {
		const p = page("The Sunken Barrow");
		expect(await setSiteMapSpot(p, { tier: "vicinity", fx: 2, fy: 0.5 })).toBeNull();
		expect(siteMapSpot(p)).toBeNull();
	});

	it("lifts the pin without touching anything else about the site", async () => {
		const p = page("The Sunken Barrow", { tier: "vicinity", fx: 0.42, fy: 0.61 });
		await clearSiteMapSpot(p);
		expect(siteMapSpot(p)).toBeNull();
		expect(siteMapTier(p)).toBe("");
		expect(p.name).toBe("The Sunken Barrow");
	});

	it("answers for a page that carries no flag bag at all", () => {
		expect(siteMapSpot({ name: "unplaced" })).toBeNull();
		expect(siteMapSpot(null)).toBeNull();
	});
});

describe("the sites on one map", () => {
	it("takes that tier's, in the order the Sites tab lists them", () => {
		const barrow = page("The Sunken Barrow", { tier: "vicinity", fx: 0.42, fy: 0.61 });
		const pit = page("The Weeping Pit", { tier: "vicinity", fx: 0.2, fy: 0.3 });
		pages.list = [
			barrow,
			page("Far Hall", { tier: "worlds-end", fx: 0.8, fy: 0.2 }),
			page("Unplaced prep"),
			pit,
		];
		expect(sitesOnMap({}, "vicinity").map(s => s.page)).toEqual([barrow, pit]);
		expect(sitesOnMap({}, "vicinity")[0].spot).toEqual({ tier: "vicinity", fx: 0.42, fy: 0.61 });
		expect(sitesOnMap({}, "worlds-end").map(s => s.page.name)).toEqual(["Far Hall"]);
	});

	// A world with no steading files its sites nowhere, and a caller with no tier is asking about
	// no map. Both are the ordinary state of the route step before any art is imported.
	it("answers empty without a steading or without a tier", () => {
		pages.list = [page("The Sunken Barrow", { tier: "vicinity", fx: 0.42, fy: 0.61 })];
		expect(sitesOnMap(null, "vicinity")).toEqual([]);
		expect(sitesOnMap({}, "")).toEqual([]);
	});
});
