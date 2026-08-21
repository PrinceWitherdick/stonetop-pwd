import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
	TRAVEL_PLACES, TRAVEL_LEGS, TRAVEL_MAPS, TRAVEL_EXITS, MAP_CAPTIONS, MAP_FRAMES, FULL_FRAME,
	BEYOND_TIER,
	travelPlace, homePlace, placesOnMap, placesBeyond, exitsOnMap,
	spotPercent, frameFor, frameFitsImage,
} from "../../module/data/travel-times.js";

// The travel graph is a duplicate of prose the packs already ship — the GM playbook's Travel
// times table, collapsed inside the Chart a Course move. Nothing at runtime can read a pack's
// source, so it is copied into the data module; this suite is what stops that copy from drifting
// silently and quoting a day count the book no longer prints.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOVE_DOC = path.resolve(
	HERE, "../../packs/src/stonetop-items/expedition-moves/chart-a-course.json"
);
const LOCATIONS_DIR = path.resolve(HERE, "../../packs/src/stonetop-locations");
const SETTING_OVERVIEW = path.resolve(
	HERE, "../../packs/src/stonetop-journals/setting-overview.json"
);

/** Every block heading the table uses, and the leg it implies. */
const BLOCKS = {
	"From Stonetop via the Roads to…":                 { origin: "stonetop", via: "the Roads" },
	"From Stonetop to…":                               { origin: "stonetop" },
	"From the Crossroads to…":                         { origin: "the-crossroads" },
	"From the north edge of the Steplands to…":        { origin: "the-steplands" },
	"From Marshedge to…":                              { origin: "marshedge" },
	// The one block written backwards: its rows are where you START.
	"To Tor's Fist from…":                             { destination: "tors-fist" },
};

/** The table's own wording for a place -> its slug, both spellings included. */
function slugByTableName() {
	const out = new Map();
	for (const place of TRAVEL_PLACES) {
		out.set(place.name, place.slug);
		if (place.tableName) out.set(place.tableName, place.slug);
	}
	return out;
}

/** "3–4 hours" -> { min: 3, max: 4, unit: "hours" }. */
function parseSpan(text) {
	const m = /^(\d+)(?:–(\d+))?\s+(day|hour)s?$/.exec(text.trim());
	if (!m) throw new Error(`unparsable travel time "${text}"`);
	return { min: Number(m[1]), max: Number(m[2] ?? m[1]), unit: `${m[3]}s` };
}

/**
 * The shipped table, read back as legs in the same shape TRAVEL_LEGS stores — so the comparison
 * is over the numbers and the place names, not over HTML.
 */
function packLegs() {
	const doc = JSON.parse(fs.readFileSync(MOVE_DOC, "utf8"));
	const table = /<table class="stonetop-travel-times-table">([\s\S]*?)<\/table>/
		.exec(doc.system.description);
	if (!table) throw new Error("Chart a Course no longer carries a travel-times table");

	const slugs = slugByTableName();
	const legs = [];
	let block = null;
	for (const [, row] of table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
		const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => m[1].trim());
		if (cells.length !== 2) {
			const heading = /<em>([\s\S]*?)<\/em>/.exec(cells[0] ?? "")?.[1];
			if (!heading) continue;                       // the <thead> "Journey | Time" row
			block = BLOCKS[heading];
			expect(block, `unrecognised travel-table block "${heading}"`).toBeTruthy();
			continue;
		}
		if (cells[0] === "Journey") continue;
		const slug = slugs.get(cells[0]);
		expect(slug, `no travel place matches the table row "${cells[0]}"`).toBeTruthy();
		const span = parseSpan(cells[1]);
		legs.push(block.destination
			? { from: slug, to: block.destination, ...span, via: block.via ?? null }
			: { from: block.origin, to: slug, ...span, via: block.via ?? null });
	}
	return legs;
}

describe("TRAVEL_LEGS mirrors the travel-times table Chart a Course ships", () => {
	const rows = packLegs();

	it("reads every row of the shipped table", () => {
		expect(rows).toHaveLength(TRAVEL_LEGS.length);
	});

	it("matches the shipped table leg for leg", () => {
		const shape = leg => ({
			from: leg.from, to: leg.to, min: leg.min, max: leg.max, unit: leg.unit,
			via: leg.via ?? null,
		});
		expect(TRAVEL_LEGS.map(shape)).toEqual(rows.map(shape));
	});

	it("prints Marshedge to Lygos as 30 days, the row the whole feature hangs on", () => {
		expect(rows).toEqual(expect.arrayContaining([
			expect.objectContaining({ from: "marshedge", to: "lygos", min: 30, max: 30, unit: "days" }),
		]));
	});
});

describe("the travel graph is internally consistent", () => {
	it("gives every place a unique slug", () => {
		const slugs = TRAVEL_PLACES.map(p => p.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it("gives every place a unique name, and a distinct second spelling where it has one", () => {
		const names = TRAVEL_PLACES.flatMap(p => (p.tableName ? [p.name, p.tableName] : [p.name]));
		expect(new Set(names).size).toBe(names.length);
	});

	it("connects only places it knows", () => {
		const known = new Set(TRAVEL_PLACES.map(p => p.slug));
		for (const leg of TRAVEL_LEGS) {
			expect(known, `leg from unknown place ${leg.from}`).toContain(leg.from);
			expect(known, `leg to unknown place ${leg.to}`).toContain(leg.to);
			expect(leg.from).not.toBe(leg.to);
		}
	});

	it("never prints the same leg twice, in either direction", () => {
		const seen = new Set();
		for (const leg of TRAVEL_LEGS) {
			const key = [leg.from, leg.to].sort().join("|");
			expect(seen, `duplicate leg ${key}`).not.toContain(key);
			seen.add(key);
		}
	});

	it("leaves every place reachable from home", () => {
		// An unreachable place could never be picked, so it would be a silent dead entry.
		const links = new Map();
		for (const leg of TRAVEL_LEGS) {
			links.set(leg.from, [...(links.get(leg.from) ?? []), leg.to]);
			links.set(leg.to, [...(links.get(leg.to) ?? []), leg.from]);
		}
		const seen = new Set([homePlace().slug]);
		const queue = [homePlace().slug];
		while (queue.length) {
			for (const next of links.get(queue.pop()) ?? []) {
				if (!seen.has(next)) { seen.add(next); queue.push(next); }
			}
		}
		expect([...TRAVEL_PLACES.map(p => p.slug)].filter(s => !seen.has(s))).toEqual([]);
	});

	it("names exactly one home", () => {
		expect(TRAVEL_PLACES.filter(p => p.home)).toHaveLength(1);
		expect(homePlace().slug).toBe("stonetop");
	});

	it("keeps a printed span in order, and a flat time equal at both ends", () => {
		for (const leg of TRAVEL_LEGS) {
			expect(leg.max, `${leg.from}->${leg.to}`).toBeGreaterThanOrEqual(leg.min);
			expect(leg.min).toBeGreaterThan(0);
			expect(["days", "hours"]).toContain(leg.unit);
		}
	});
});

describe("map positions", () => {
	it("puts every spot inside its map", () => {
		for (const place of TRAVEL_PLACES) {
			for (const [map, spot] of Object.entries(place.spots ?? {})) {
				expect(TRAVEL_MAPS.map(m => m.slug), `${place.slug} on ${map}`).toContain(map);
				expect(spot.fx).toBeGreaterThanOrEqual(0);
				expect(spot.fx).toBeLessThanOrEqual(1);
				expect(spot.fy).toBeGreaterThanOrEqual(0);
				expect(spot.fy).toBeLessThanOrEqual(1);
			}
		}
	});

	it("draws every place somewhere, or marks it as lying beyond the maps", () => {
		for (const place of TRAVEL_PLACES) {
			const drawn = Object.keys(place.spots ?? {}).length > 0;
			expect(drawn || place.beyond === true, `${place.slug} is neither drawn nor beyond`).toBe(true);
		}
	});

	it("puts Stonetop on both maps, since it is where every journey starts", () => {
		expect(Object.keys(travelPlace("stonetop").spots).sort()).toEqual(["vicinity", "worlds-end"]);
	});

	it("leaves Lygos off the maps, reachable only through the World's End arrow", () => {
		expect(placesBeyond().map(p => p.slug)).toEqual(["lygos"]);
		expect(exitsOnMap("worlds-end").map(e => e.to)).toContain(BEYOND_TIER);
	});

	it("orders a map's places down the page", () => {
		const ys = placesOnMap("worlds-end").map(p => p.spots["worlds-end"].fy);
		expect(ys).toEqual([...ys].sort((a, b) => a - b));
	});

	it("points every exit at a real tier from a real map", () => {
		const maps = TRAVEL_MAPS.map(m => m.slug);
		for (const exit of TRAVEL_EXITS) {
			expect(maps).toContain(exit.map);
			expect([...maps, BEYOND_TIER]).toContain(exit.to);
			expect(exit.to).not.toBe(exit.map);
		}
	});

	it("frames a poster scan inward and leaves a printed render whole", () => {
		// The poster is a wider crop of the same artwork, so a canonical fraction has to be
		// squeezed into it; the two PDF renders ARE the canonical crop and need no entry.
		for (const [out, frame] of Object.entries(MAP_FRAMES)) {
			expect(out).toMatch(/^assets\/maps\/map-/);
			expect(frame.x0).toBeGreaterThan(0);
			expect(frame.y0).toBeGreaterThan(0);
			expect(frame.x1).toBeLessThan(1);
			expect(frame.y1).toBeLessThan(1);
			expect(frame.x1).toBeGreaterThan(frame.x0);
			expect(frame.y1).toBeGreaterThan(frame.y0);
		}
		expect(MAP_FRAMES["assets/maps/gm-vicinity.webp"]).toBeUndefined();
		expect(MAP_FRAMES["assets/maps/book2-vicinity.webp"]).toBeUndefined();
	});

	it("hands a percentage straight to CSS, unframed and framed", () => {
		const spot = { fx: 0.5, fy: 0.5 };
		// A printed render has no registration, so the whole image IS the frame.
		expect(spotPercent(spot, frameFor("assets/maps/gm-vicinity.webp"))).toEqual({ left: 50, top: 50 });
		expect(spotPercent(spot)).toEqual({ left: 50, top: 50 });

		const poster = frameFor("assets/maps/map-vicinity.webp");
		const framed = spotPercent(spot, poster);
		expect(framed.left).toBeCloseTo((poster.x0 + 0.5 * (poster.x1 - poster.x0)) * 100, 6);
		expect(framed.top).toBeCloseTo((poster.y0 + 0.5 * (poster.y1 - poster.y0)) * 100, 6);
		// The frame's corners are where a canonical 0,0 and 1,1 land.
		expect(spotPercent({ fx: 0, fy: 0 }, poster)).toEqual({ left: poster.x0 * 100, top: poster.y0 * 100 });
		expect(spotPercent({ fx: 1, fy: 1 }, poster)).toEqual({ left: poster.x1 * 100, top: poster.y1 * 100 });
	});

	it("checks a registration against the shape of the file it is used on", () => {
		// A frame claims the printed page fills this rectangle, which is checkable: crop that
		// rectangle out of a file of that shape and the printed proportions must come back.
		for (const map of TRAVEL_MAPS) {
			const out = `assets/maps/map-${map.slug === "vicinity" ? "vicinity" : "worlds-end"}.webp`;
			const poster = frameFor(out);
			// The poster scans this was measured from are all 2100x1650.
			expect(frameFitsImage(poster, 2100 / 1650, map.printedAspect)).toBe(true);
			// The same file placed against the whole image would be wrong, which is the mistake
			// the guard exists to catch.
			expect(frameFitsImage(FULL_FRAME, 2100 / 1650, map.printedAspect)).toBe(false);
			// And a printed render really is the printed crop.
			expect(frameFitsImage(FULL_FRAME, map.printedAspect, map.printedAspect)).toBe(true);
		}
	});

	it("doubts nothing when there is nothing measured to doubt", () => {
		expect(frameFitsImage(FULL_FRAME, 0, 1.3)).toBe(true);
		expect(frameFitsImage(FULL_FRAME, 1.3, 0)).toBe(true);
	});
});

describe("gazetteer links", () => {
	/** Every location entry id the locations pack ships. */
	function locationIds() {
		const ids = new Set();
		for (const folder of fs.readdirSync(LOCATIONS_DIR, { withFileTypes: true })) {
			if (!folder.isDirectory() || folder.name === "_folders") continue;
			for (const file of fs.readdirSync(path.join(LOCATIONS_DIR, folder.name))) {
				if (!file.endsWith(".json")) continue;
				const doc = JSON.parse(fs.readFileSync(path.join(LOCATIONS_DIR, folder.name, file), "utf8"));
				ids.add(doc._id);
			}
		}
		return ids;
	}

	it("points at a journal the Setting Overview's own travel page already links", () => {
		// Same ids, so a destination card and the shipped Travel Times page open the same entry.
		const linked = new Set(
			[...JSON.parse(fs.readFileSync(SETTING_OVERVIEW, "utf8")).pages
				.find(p => p.name === "Travel Times").text.content
				.matchAll(/@UUID\[[^\]]*JournalEntry\.([A-Za-z0-9]+)\]/g)].map(m => m[1])
		);
		const ours = TRAVEL_PLACES.filter(p => p.journalId).map(p => p.journalId);
		expect(ours.length).toBeGreaterThan(10);
		// Stonetop, Blackwater Lake and the Crossroads are not rows on that page, so it cannot
		// vouch for them; everything it DOES link must agree with us.
		const overlap = ours.filter(id => linked.has(id));
		expect(overlap.length).toBeGreaterThanOrEqual(linked.size);
	});

	it("names a real gazetteer entry wherever it claims one", () => {
		const ids = locationIds();
		// The cave bears' den points at the creature, not a place, so it is the one exception.
		const bears = travelPlace("cave-bears-den").journalId;
		for (const place of TRAVEL_PLACES) {
			if (!place.journalId || place.journalId === bears) continue;
			expect(ids, `${place.slug} points at a journal the locations pack does not ship`)
				.toContain(place.journalId);
		}
	});

	it("holds the map captions to the same rule as the places", () => {
		// A caption's link is worth more scrutiny than a place's, not less: several of them BORROW
		// an entry rather than having one (the three gates onto the Old Wall open The Village of
		// Stonetop, which is where the wall is described), so a typo lands on a real-looking id
		// nobody would notice was the wrong entry. This at least catches one that is no entry.
		const ids = locationIds();
		// EVERY caption, not most of them: a caption whose pin opens nothing is a pin that looks
		// live on the map and does nothing when clicked, which is worse than not drawing it. Most
		// of the village's and both of the Vicinity's roads get there by BORROWING an entry that
		// describes them rather than by having one of their own, which is what the borrowing is
		// for: eight of these eighteen point at just two entries between them, the village's
		// own write-up and The Makers' Roads.
		const linked = MAP_CAPTIONS.filter(c => c.journalId);
		expect(linked.length).toBe(MAP_CAPTIONS.length);
		for (const caption of linked) {
			expect(ids, `${caption.map}/${caption.slug} points at a journal the locations pack does not ship`)
				.toContain(caption.journalId);
		}
	});
});
