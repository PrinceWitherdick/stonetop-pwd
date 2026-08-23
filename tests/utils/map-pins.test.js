import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
	MAP_PIN_TEXT_COLOR, MAP_PIN_TINT,
	PLACE_EXIT_ICON_SUFFIX, PLACE_MARKER_ICON_SUFFIX, PLACE_PEAK_ICON_SUFFIX, PUBLIC_MAP_PIN,
	colorKey, isPlaceMarkerNote,
	markerPinKey, markerTextAnchor, markerTipLift, placeMarkerIcon, placeMarkerNoteData,
	posterMapPins, sameColor,
} from "../../module/utils/map-pins.js";
import { asColor } from "../fakes/color.js";
import { POSTER_MAPS } from "../../module/book2-art/poster-maps.js";
import {
	MAP_FRAMES, captionsOnMap, exitsOnMap, frameFor, placesOnMap, travelMap, travelPlace,
} from "../../module/data/travel-times.js";

// The named-place markers the Vicinity and the World's End wear. The poster printing of both is
// the UNLABELLED one, so these pins are the map's own missing names put back — which is why they
// show permanently rather than on hover, and why every coordinate has to be right.

// At module scope, not in a hook: a describe body runs at collection time, and one of them
// builds a note payload, which reads CONST for the anchor point core numbers rather than names.
globalThis.CONST = { TEXT_ANCHOR_POINTS: { CENTER: 0, BOTTOM: 1, TOP: 2, LEFT: 3, RIGHT: 4 } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const posterMap = slug => POSTER_MAPS.find(m => m.slug === slug);
const SCENE = { width: 6000, height: 4714 };

describe("which maps get markers", () => {
	it("draws them on the three maps with recorded positions and nowhere else", () => {
		// Marshedge and Gordin's Delve are poster maps too and get nothing: no label position on
		// either has ever been measured, and a guess would be worse than a bare map.
		const drawn = POSTER_MAPS.filter(m => posterMapPins(m, SCENE).length).map(m => m.slug);
		expect(drawn).toEqual(["stonetop-village", "vicinity", "worlds-end"]);
	});

	it("labels the village map without touching its lettered discs", () => {
		// The village map is the one poster map that carries pins in the catalog as well, and the
		// two are answering different questions. A disc is an INDEX into the steading sheet's list,
		// which is why it shows a letter and keeps its name until hovered; these are the names the
		// poster printing left out. So they coexist, and nothing here may claim a letter's key.
		const pins = posterMapPins(posterMap("stonetop-village"), SCENE);
		expect(pins.map(p => p.name)).toEqual([
			"To the Old Wall", "The Ringwall", "The Great Wood", "To the Crossroads",
			"The Fields", "To the Old Wall", "The Stream", "To the Old Wall",
		]);
		const letters = posterMap("stonetop-village").notes.map(n => n.key);
		expect(letters).toHaveLength(8);
		expect(pins.some(p => letters.includes(p.key))).toBe(false);
	});

	it("gives the four roads out a signpost and the wood and the water a pin", () => {
		// A road off the edge is not a place: none of the four names anywhere on this paper, they
		// say the way out and where it goes, which is the same job the regional maps' edge arrows
		// do. Three read alike because there are three gates onto the Old Wall, so they are told
		// apart by the compass rather than by their label, as the three Watchtowers discs are.
		const pins = posterMapPins(posterMap("stonetop-village"), SCENE);
		const kind = name => [...new Set(pins.filter(p => p.name === name).map(p => p.kind))];
		expect(kind("To the Old Wall")).toEqual(["exit"]);
		expect(kind("To the Crossroads")).toEqual(["exit"]);
		expect(kind("The Great Wood")).toEqual(["place"]);
		expect(kind("The Stream")).toEqual(["place"]);
		expect(pins.filter(p => p.name === "To the Old Wall").map(p => p.slug))
			.toEqual(["to-the-old-wall-nw", "to-the-old-wall-sw", "to-the-old-wall-se"]);
	});

	it("opens a write-up for every pin on the village map, borrowed where it has to be", () => {
		// Neither the Old Wall nor the Crossroads has a gazetteer entry of its own, and neither
		// needs one: the wall is described in The Village of Stonetop under the fields it wraps,
		// and the Crossroads has a section to itself inside The Makers' Roads, which is the road it
		// is the crossing of. That is the same borrowing an edge arrow on a regional map does.
		const pins = posterMapPins(posterMap("stonetop-village"), SCENE);
		const opens = Object.fromEntries(pins.map(p => [p.slug, p.journalId]));
		expect(opens).toEqual({
			"to-the-old-wall-nw": "6yScslDfqrcCQ6CJ",
			"to-the-old-wall-sw": "6yScslDfqrcCQ6CJ",
			"to-the-old-wall-se": "6yScslDfqrcCQ6CJ",
			"the-ringwall": "6yScslDfqrcCQ6CJ",
			"the-fields": "6yScslDfqrcCQ6CJ",
			"to-the-crossroads": "ezquwGFbne6uxzJK",
			"the-great-wood": "6kt1b8ozEREDCi4k",
			"the-stream": "KJUzuYlurcjPxHd7",
		});
		// Five of the eight borrow one entry between them, which is right: three gates onto one
		// wall are not three walls, and the wall and the fields it wraps are one paragraph.
		expect(new Set(pins.map(p => p.journalId)).size).toBe(4);
	});

	it("keeps the Great Wood one pin across three tiers, however each of them draws it", () => {
		// One name on three maps, and one family the whole way across. That split is the point:
		// `kind` has already changed twice here, once per tier, while `family` is what the pin IS,
		// so a redrawing re-dresses the pin instead of standing a second one up beside it on a
		// table that already has the first. All three read "place" today; that is the fact least
		// worth pinning down, and the key below is the one that has to hold when it changes again.
		const on = tier => posterMapPins(posterMap(tier), SCENE).find(p => p.slug === "the-great-wood");
		expect(on("stonetop-village").kind).toBe("place");
		expect(on("vicinity").kind).toBe("place");
		expect(on("worlds-end").kind).toBe("place");
		for (const tier of ["stonetop-village", "vicinity", "worlds-end"]) {
			expect(on(tier).family).toBe("region");
			expect(on(tier).key).toBe(markerPinKey("the-great-wood", "region"));
		}
	});

	it("says nothing about a Scene whose size is not known yet", () => {
		expect(posterMapPins(posterMap("vicinity"), {})).toEqual([]);
		expect(posterMapPins(posterMap("vicinity"), { width: 6000, height: 0 })).toEqual([]);
		expect(posterMapPins(undefined, SCENE)).toEqual([]);
	});
});

describe("what each map is labelled with", () => {
	it("marks every place the travel graph draws on that map, in reading order", () => {
		for (const slug of ["vicinity", "worlds-end"]) {
			const pins = posterMapPins(posterMap(slug), SCENE).filter(p => p.family === "place");
			expect(pins.map(p => p.slug)).toEqual(placesOnMap(slug).map(p => p.slug));
		}
	});

	it("carries all three families a map letters on itself, grouped and in one order", () => {
		// Places, then the arrows off the edge, then the country lettered across the middle. One
		// call because every caller wants all of them: they dedupe together, are laid down
		// together, and wear the same permanent label. Grouped so the reading order above reads.
		//
		// FAMILY, not drawing. Two of the World's End's places are drawn as mountains and two of
		// its captions are drawn as the same mountains, so grouping by glyph would interleave a
		// caption with the places and shuffle the reading order.
		for (const slug of ["vicinity", "worlds-end"]) {
			const pins = posterMapPins(posterMap(slug), SCENE);
			expect(pins.filter(p => p.family === "exit").map(p => p.slug))
				.toEqual(exitsOnMap(slug).map(e => e.slug));
			expect(pins.filter(p => p.family === "region").map(p => p.slug))
				.toEqual(captionsOnMap(slug).map(c => c.slug));
			const order = [...new Set(pins.map(p => p.family))];
			expect(order).toEqual(["place", "exit", "region"].filter(f => pins.some(p => p.family === f)));
		}
	});

	it("letters the country the Vicinity crosses, and pins all of it", () => {
		// This tier is drawn the whole way through. Seven travel places on the same map all wear a
		// teardrop, so four bare captions among them would draw the wood and the roads as a lesser
		// sort of thing than their neighbours, which is a fact about the travel table and not about
		// the ground. The roads take the teardrop and not the signpost on purpose: the signpost
		// means the way OUT toward somewhere off the page, and these are the roads themselves.
		const regions = posterMapPins(posterMap("vicinity"), SCENE).filter(p => p.family === "region");
		expect(regions.map(p => p.name)).toEqual([
			"The Great Wood", "The Highway", "The West Road", "The Flats",
		]);
		expect(regions.every(p => p.kind === "place")).toBe(true);
		// So they hang off their point the way every other teardrop does, rather than sitting
		// centred on it the way a bare caption does.
		expect(markerTipLift("place")).toBeGreaterThan(0);
		expect(markerTextAnchor("place")).toBe(globalThis.CONST.TEXT_ANCHOR_POINTS.BOTTOM);
		// The bare drawing is still what a caption gets for asking for nothing, though no caption
		// on any of the three maps asks any more.
		expect(markerTipLift("region")).toBe(0);
		expect(markerTextAnchor("region")).toBe(globalThis.CONST.TEXT_ANCHOR_POINTS.CENTER);
	});

	it("letters the country the World's End crosses, in reading order down the page", () => {
		const regions = posterMapPins(posterMap("worlds-end"), SCENE).filter(p => p.family === "region");
		expect(regions.map(p => p.name)).toEqual([
			"Whitefang Mountains", "The Great Wood", "The Flats", "Ferrier's Fen",
			"Huffel Peaks", "South Manmarch",
		]);
		// All six open the gazetteer's write-up of that country.
		expect(regions.every(p => p.journalId)).toBe(true);
	});

	it("marks the World's End's ranges as terrain and the rest of its country as points", () => {
		// The ranges keep the terrain symbol on what the mark CLAIMS: it says "mountains", true of
		// the Whitefang Mountains the whole length of their arc, where a teardrop says "here",
		// true nowhere on it. The other four take the teardrop, which is the same argument losing:
		// it is just as untrue of four days of wood, and a bare name among pins reads as a pin
		// that failed to draw rather than as a region. Nobody has drawn a wood symbol; draw one
		// and the wood should have it, because a wood is not a different kind of thing from a
		// range. See the note over `kind` in travel-times.js.
		const regions = posterMapPins(posterMap("worlds-end"), SCENE).filter(p => p.family === "region");
		const kinds = Object.fromEntries(regions.map(p => [p.name, p.kind]));
		expect(kinds).toEqual({
			"Whitefang Mountains": "peak", "Huffel Peaks": "peak",
			"The Great Wood": "place", "The Flats": "place",
			"Ferrier's Fen": "place", "South Manmarch": "place",
		});
		// The two halves of the march are drawn alike, whichever list each of them lives in.
		const north = posterMapPins(posterMap("worlds-end"), SCENE).find(p => p.slug === "north-manmarch");
		expect(kinds["South Manmarch"]).toBe(north.kind);
		expect(north.family).not.toBe("region");
		// The map's own wording, not the gazetteer's "The Whitefang Mountains".
		expect(regions[0].journalId).toBe("5vFbBIn18TKtCF91");
		expect(markerTextAnchor("peak")).toBe(globalThis.CONST.TEXT_ANCHOR_POINTS.BOTTOM);
	});

	it("letters the wood and the flats on both tiers, as two captions rather than one", () => {
		// Not one caption drawn twice. The Vicinity shows a few days' walk of wood and the World's
		// End shows the whole of it, so they sit in different places saying different things about
		// how much of it there is. The key carries no tier, which is safe because keys are only
		// ever compared within one Scene, exactly as Stonetop's is on the two maps that draw it.
		for (const slug of ["the-great-wood", "the-flats"]) {
			const on = tier => posterMapPins(posterMap(tier), SCENE).find(p => p.slug === slug);
			expect(on("vicinity"), slug).toBeTruthy();
			expect(on("worlds-end"), slug).toBeTruthy();
			expect(on("vicinity").key).toBe(on("worlds-end").key);
			expect({ x: on("vicinity").x, y: on("vicinity").y })
				.not.toEqual({ x: on("worlds-end").x, y: on("worlds-end").y });
		}
		// A caption is identified by its slug AND its tier, so no tier may list one twice.
		for (const tier of ["vicinity", "worlds-end"]) {
			const slugs = captionsOnMap(tier).map(c => c.slug);
			expect(new Set(slugs).size, tier).toBe(slugs.length);
		}
	});

	it("draws a place that is itself a mountain as one, without making it any less a place", () => {
		// A pin's key is its identity and its kind is only its drawing, which is what lets the
		// design change under a map a table already has open. Redrawing Tor's Fist must re-dress
		// the pin they have, not stand a second one beside it.
		const pins = posterMapPins(posterMap("worlds-end"), SCENE);
		const by = slug => pins.find(p => p.slug === slug);
		for (const slug of ["tors-fist", "barrier-pass"]) {
			expect(by(slug).kind, slug).toBe("peak");
			expect(by(slug).family, slug).toBe("place");
			expect(by(slug).key, slug).toBe(markerPinKey(slug));
		}
		expect(by("marshedge").kind).toBe("place");
		// And they are still places to the travel graph, which is what the pin is drawn from.
		expect(placesOnMap("worlds-end").map(p => p.slug)).toContain("tors-fist");
	});

	it("covers the Vicinity's seven and the World's End's eleven", () => {
		const named = slug => posterMapPins(posterMap(slug), SCENE)
			.filter(p => p.family === "place").map(p => p.name);
		expect(named("vicinity")).toEqual([
			"The Foothills", "The Maw", "Stonetop", "Red Grove", "The Crossroads",
			"Cave Bears", "The Ruined Tower",
		]);
		// Reading order is down the page, so a spot that moves can change it: North Manmarch used
		// to sort above Titan Bones, back when it sat where its label is printed along the map's
		// right edge rather than over the country it names, and Stonetop has since crossed above
		// Gordin's Delve by being nudged 46 pixels up the bluff.
		expect(named("worlds-end")).toEqual([
			"Tor's Fist", "Barrier Pass", "Stonetop", "Gordin's Delve", "Titan Bones",
			"North Manmarch", "Steplands", "Marshedge", "Blackwater Lake", "Three Coven Lake",
			"The Dread River",
		]);
	});

	it("says which way an arrow points, since a pin alone would read as \"you are here\"", () => {
		// On the page the arrow's own shape carries that; a pin has no arrow, so the word does.
		const exits = posterMapPins(posterMap("vicinity"), SCENE).filter(p => p.family === "exit");
		expect(exits.map(p => p.name)).toEqual([
			"To Barrier Pass", "To Gordin's Delve", "To Steplands & Marshedge",
		]);
		expect(posterMapPins(posterMap("worlds-end"), SCENE).filter(p => p.family === "exit")
			.map(p => p.name)).toEqual(["To Lygos & the South"]);
	});

	it("lets an arrow borrow the write-up of the one place it names", () => {
		// "To Gordin's Delve" naming one place can open that place; "To Steplands & Marshedge"
		// names two, so it opens nothing rather than guessing which the GM meant.
		const byName = new Map(posterMapPins(posterMap("vicinity"), SCENE).map(p => [p.name, p]));
		expect(byName.get("To Gordin's Delve").journalId).toBe(travelPlace("gordins-delve").journalId);
		expect(byName.get("To Barrier Pass").journalId).toBe(travelPlace("barrier-pass").journalId);
		expect(byName.get("To Steplands & Marshedge").journalId).toBe(null);
	});

	it("labels a pin the way a map prints a name, not the way a move says it", () => {
		// travel-times.js stores the table's own mid-sentence wording ("the cave bears' den")
		// because that is what the GM reads off Chart a Course. A label standing alone over a
		// drawing is a different job and gets the printed map's own wording.
		const pins = posterMapPins(posterMap("vicinity"), SCENE);
		expect(pins.find(p => p.slug === "cave-bears-den").name).toBe("Cave Bears");
		expect(pins.some(p => /^the /.test(p.name))).toBe(false);
	});

	it("puts Stonetop on both maps, in two different places", () => {
		const here = posterMapPins(posterMap("vicinity"), SCENE).find(p => p.slug === "stonetop");
		const there = posterMapPins(posterMap("worlds-end"), SCENE).find(p => p.slug === "stonetop");
		expect(here).toBeTruthy();
		expect(there).toBeTruthy();
		expect({ x: here.x, y: here.y }).not.toEqual({ x: there.x, y: there.y });
	});
});

describe("where the pins land", () => {
	it("insets a printed-crop fraction into the poster it is laid on", () => {
		// Worked by hand off the numbers in travel-times.js rather than by re-running the code:
		// Stonetop sits at 0.708 / 0.5202 of the PRINTED crop, and the printed crop occupies
		// 0.030-0.970 by 0.072-0.936 of the poster scan. So 0.030 + 0.708 * 0.940 = 0.69552 of
		// 6000 = 4173.1, and 0.072 + 0.5202 * 0.864 = 0.5214528 of 4714 = 2458.1.
		const stonetop = posterMapPins(posterMap("vicinity"), SCENE).find(p => p.slug === "stonetop");
		expect(stonetop.x).toBe(4173);
		// Lifted so the drawing's POINT lands on 2458 rather than its middle. Core centres a
		// note's icon on the note, and the lowest ink is at (494.892 + 10)/512 of the box: the
		// path's last vertex plus half of the 20-unit stroke riding on it, which a round join
		// wraps around the tip. That is 0.4861 below centre, or 34 at the 70px icon these wear.
		expect(stonetop.y).toBe(2458 - 34);
	});

	it("stands every drawing on its own foot, whichever drawing it is", () => {
		// Each family moves by ITS lift, not by one shared number: the teardrop stands on its
		// point and the signpost on the foot of its post, and those are different heights.
		const frame = MAP_FRAMES[posterMap("worlds-end").out];
		const spots = new Map([
			...placesOnMap("worlds-end").map(p => [p.slug, p.spots["worlds-end"]]),
			...exitsOnMap("worlds-end").map(e => [e.slug, e]),
			...captionsOnMap("worlds-end").map(c => [c.slug, c]),
		]);
		for (const pin of posterMapPins(posterMap("worlds-end"), SCENE)) {
			const fy = spots.get(pin.slug).fy;
			const spotY = Math.round((frame.y0 + fy * (frame.y1 - frame.y0)) * SCENE.height);
			expect(spotY - pin.y, `${pin.slug} lift`).toBe(markerTipLift(pin.kind));
			expect(pin.y, `${pin.slug} off the top`).toBeGreaterThan(0);
		}
		expect(markerTipLift("place")).not.toBe(markerTipLift("exit"));
	});

	it("takes its lift from the glyph that actually ships", () => {
		// The lift is a MEASUREMENT of the drawing, so it goes stale the moment the drawing moves.
		// Re-derive it from the file: the path's last vertex, plus half the stroke centred on it,
		// because stroke-linejoin: round wraps the point in an arc of that radius and it is the
		// arc a reader sees. Confirmed against a rasterisation, which puts the last opaque row at
		// 505 of 512. The 70 is the note's iconSize, which is what the lift is measured in.
		const read = file => fs.readFileSync(path.resolve(HERE, "../../assets/icons/landmarks", file), "utf8");
		const drawings = [
			["place", "place-marker.svg", 20, 34],
			["exit", "place-exit.svg", 20, 33],
			["peak", "place-peak.svg", 14, 28],
		];
		for (const [kind, file, pen, expected] of drawings) {
			const svg = read(file);
			const stroke = Number(/stroke-width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
			const viewBox = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
			expect({ kind, stroke, viewBox }).toEqual({ kind, stroke: pen, viewBox: 512 });
			expect(svg, file).toContain('stroke-linejoin="round"');
			// No file may carry the game-icons backing square: it has no fill of its own, so it
			// paints an opaque black tile on the map behind the drawing.
			expect(svg, file).not.toContain('d="M0 0h512v512H0z"');
			expect(markerTipLift(kind), kind).toBe(expected);
		}
		// The teardrop's lowest vertex: "L256 494.892l119.982-274.244", the point itself and the
		// stroke back up the far side. Rasterising puts the last opaque row at 505 of 512, which
		// is that vertex plus half the stroke the round join wraps around it.
		expect(Number(/L\d+ (\d+\.\d+)l119\.982/.exec(read("place-marker.svg"))?.[1])).toBe(494.892);
		// The range's lowest vertex is the bottom of its foothills: "L19.04 420.42l84.884 30.937"
		// walks down to 451.357, and the next hop up is +30.937 from 420.42. Measured with the
		// browser's own getBBox, which rounds it to 452.08 once the shallow slope either side of
		// that corner is taken in.
		expect(read("place-peak.svg")).toContain("L19.04 420.42l84.884 30.937");
	});

	it("holds the peaks' folds open, which is the one place the three pens differ", () => {
		// Not a lighter pen but the same nib on a busier drawing. The teardrop and the signpost
		// are single silhouettes barely half the width of their box; the range is drawn 473 of 512
		// wide with five inner folds, so the weight that reads as one clean line around a teardrop
		// closes those folds into a dark mass at the 70px these ship at. Settled by rendering the
		// glyph on the map it has to sit on, not by arithmetic.
		const svg = fs.readFileSync(path.resolve(HERE, "../../assets/icons/landmarks/place-peak.svg"), "utf8");
		expect(svg).toContain('stroke-width="14"');
		// The outline itself is upstream's and must stay untouched, since that is what the CC BY
		// row in assets/icons/ATTRIBUTION.md claims about it.
		expect(svg).toContain("M245.795 19.12l-52.363 153.513");
		expect(svg).toContain('fill="#f2e6c8"');
		expect(svg).toContain('stroke="#33281e"');
	});

	it("puts a placed spot back on the exact pixel it was placed on", () => {
		// What the fourth decimal on a placed spot is for. The poster-map pass decides whether a
		// pin is still the design's by comparing its position against this arithmetic, so a spot
		// that misses by even one pixel reads as one somebody has dragged away, and every later
		// change to that place is then refused on its behalf.
		//
		// Driven off the spot's own `placed` flag rather than off its digit count, which was the
		// first cut and has a hole in it: a placed value can land on a three-decimal boundary by
		// luck, and inferring "placed" from the digits would quietly stop checking that one.
		// Measured spots are label centres off a scanned page and make no such claim.
		const seen = [];
		for (const slug of ["stonetop-village", "vicinity", "worlds-end"]) {
			// `frameFor`, not MAP_FRAMES: the village map has no inset recorded, and the identity
			// frame it falls back to is the right one, since its fractions are the poster's own.
			const frame = frameFor(posterMap(slug).out);
			// All three kinds, arrows included: an arrow can be placed by hand like anything else,
			// and leaving it out of this would let exactly the pin most likely to need the flag
			// claim exactness nothing checks.
			const spots = new Map([
				...placesOnMap(slug).map(p => [p.slug, p.spots[slug]]),
				...exitsOnMap(slug).map(e => [e.slug, e]),
				...captionsOnMap(slug).map(c => [c.slug, c]),
			]);
			for (const pin of posterMapPins(posterMap(slug), SCENE)) {
				const spot = spots.get(pin.slug);
				if (!spot?.placed) continue;
				seen.push(pin.slug);
				expect(pin.x, `${pin.slug}.x`).toBe(Math.round((frame.x0 + spot.fx * (frame.x1 - frame.x0)) * SCENE.width));
				expect(pin.y, `${pin.slug}.y`)
					.toBe(Math.round((frame.y0 + spot.fy * (frame.y1 - frame.y0)) * SCENE.height) - markerTipLift(pin.kind));
			}
		}
		expect(seen).toEqual([
			"to-the-old-wall-nw", "the-great-wood", "to-the-crossroads", "the-fields",
			"to-the-old-wall-sw", "the-stream", "to-the-old-wall-se",
			"the-foothills", "stonetop", "the-crossroads", "the-ruined-tower",
			"to-steplands", "the-highway", "the-west-road", "the-flats",
			"tors-fist", "barrier-pass", "stonetop", "north-manmarch", "marshedge",
			"blackwater-lake", "three-coven-lake", "dread-river-ruins", "ferriers-fen", "huffel-peaks",
			"south-manmarch",
		]);
		// The Ringwall is measured off the refit, not placed, so it makes no such claim.
		expect(seen).not.toContain("the-ringwall");
		// Two of them read as three decimals, which is the case the flag exists for: Stonetop's
		// fx landed on 0.708 when it was placed, and no digit count could tell that from measured.
		expect(captionsOnMap("stonetop-village").find(c => c.slug === "to-the-old-wall-nw").fx).toBe(0.116);
	});

	it("knows a frame for the file each Scene is actually built from", () => {
		// The inset above only applies because MAP_FRAMES is keyed by the poster's own path. A
		// map row re-pathed without moving its frame would silently place every pin as though
		// the poster were the printed crop, which is a whole map of pins in the wrong valley.
		for (const slug of ["vicinity", "worlds-end"]) {
			expect(MAP_FRAMES[posterMap(slug).out], `no frame for ${slug}`).toBeTruthy();
		}
	});

	it("keeps every pin inside the picture", () => {
		for (const slug of ["vicinity", "worlds-end"]) {
			for (const pin of posterMapPins(posterMap(slug), SCENE)) {
				expect(pin.x, `${pin.slug}.x`).toBeGreaterThan(0);
				expect(pin.x, `${pin.slug}.x`).toBeLessThan(SCENE.width);
				expect(pin.y, `${pin.slug}.y`).toBeGreaterThan(0);
				expect(pin.y, `${pin.slug}.y`).toBeLessThan(SCENE.height);
			}
		}
	});

	it("scales with the Scene, so a GM's own resolution is not assumed", () => {
		// The POSITION doubles with the picture; the lift does not, because it is a fact about
		// the drawing and the note's iconSize, both of which are the same on either Scene.
		const big = posterMapPins(posterMap("vicinity"), { width: 12000, height: 9428 });
		const small = posterMapPins(posterMap("vicinity"), SCENE);
		for (const [i, pin] of big.entries()) {
			const lift = markerTipLift(pin.kind);
			expect(pin.x).toBeCloseTo(small[i].x * 2, -1);
			expect(pin.y + lift).toBeCloseTo((small[i].y + lift) * 2, -1);
		}
	});

	it("refuses a Scene that is not the shape the positions were measured against", () => {
		// A GM who saved their own differently-trimmed scan over one of the names we know breaks
		// the frame's claim without breaking anything a caller could notice. No pins at all is
		// obviously unfinished; a full set in the wrong places looks finished and is worse.
		expect(posterMapPins(posterMap("vicinity"), { width: 6000, height: 6000 })).toEqual([]);
		const tier = travelMap("vicinity");
		expect(tier.printedAspect).toBeGreaterThan(1);
	});
});

describe("placeMarkerNoteData", () => {
	const note = placeMarkerNoteData({ x: 100, y: 200, name: "  Stonetop  " });

	it("wears the marker glyph, contained and untinted", () => {
		expect(note.texture.src).toBe(placeMarkerIcon());
		expect(note.texture.src.endsWith(PLACE_MARKER_ICON_SUFFIX)).toBe(true);
		expect(note.texture.fit).toBe("contain");
		expect(note.texture.tint).toBe("#ffffff");
		expect(note.texture.anchorX).toBe(0.5);
		expect(note.texture.anchorY).toBe(0.5);
	});

	it("carries the trimmed label below the pin", () => {
		expect(note.text).toBe("Stonetop");
		expect(note.textAnchor).toBe(globalThis.CONST.TEXT_ANCHOR_POINTS.BOTTOM);
		expect(note.fontSize).toBe(45);
		expect(note.iconSize).toBe(70);
	});

	it("is part of the map rather than someone's private note", () => {
		// Both fields, or the whole map's pins go quietly GM-only on Foundry 14.
		expect(note.global).toBe(true);
		expect(note.author).toBe(null);
		expect(PUBLIC_MAP_PIN).toEqual({ global: true, author: null });
	});

	it("links to nothing unless it is handed something to link", () => {
		// Core gates a LINKED note on the reader holding LIMITED over what it links to, so the
		// default has to be the harmless one. Resolving an entry, and opening it far enough that
		// the pin survives, is utils/gazetteer-notes.js's job and nobody else's.
		expect(note.entryId).toBe(null);
		expect(note.pageId).toBe(null);
	});

	it("carries a link when one is resolved for it, and still never names the page", () => {
		// The page is left null on purpose: core tests `page ?? entry` for visibility, so naming
		// the page would move that decision onto a document whose ownership is INHERIT rather
		// than onto the entry that was actually opened up.
		const linked = placeMarkerNoteData({ x: 1, y: 2, name: "Marshedge", entryId: "abc123" });
		expect(linked.entryId).toBe("abc123");
		expect(linked.pageId).toBe(null);
	});
});

describe("telling a marker apart from everything else on a scene", () => {
	it("claims every drawing, under any package id this system has shipped as", () => {
		// One predicate covers all of them because everything that asks wants the same answer for
		// all of them: does this pin wear its name permanently, and is it already on the map. A
		// drawing added without being claimed here is a family of pins that stops recognising
		// itself, which shows up as a second set standing beside the first.
		const suffixes = [PLACE_MARKER_ICON_SUFFIX, PLACE_EXIT_ICON_SUFFIX, PLACE_PEAK_ICON_SUFFIX];
		for (const suffix of suffixes) {
			expect(isPlaceMarkerNote({ texture: { src: `systems/stonetop-pwd/${suffix}` } }), suffix).toBe(true);
			expect(isPlaceMarkerNote({ texture: { src: `systems/stonetop_pwd/${suffix}` } }), suffix).toBe(true);
		}
		for (const kind of ["place", "exit", "peak", "region"]) {
			expect(isPlaceMarkerNote({ texture: { src: placeMarkerIcon(kind) } }), kind).toBe(true);
		}
		// Every drawing a pin can actually be handed is one of the files claimed above.
		const drawn = new Set(posterMapPins(posterMap("worlds-end"), SCENE)
			.concat(posterMapPins(posterMap("vicinity"), SCENE)).map(p => placeMarkerIcon(p.kind)));
		expect([...drawn].every(src => isPlaceMarkerNote({ texture: { src } }))).toBe(true);
	});

	it("leaves the lettered discs, the prep pins and everyone else's notes alone", () => {
		expect(isPlaceMarkerNote({ texture: { src: "systems/stonetop-pwd/assets/icons/landmarks/landmark-c.svg" } })).toBe(false);
		expect(isPlaceMarkerNote({ texture: { src: "systems/stonetop-pwd/assets/icons/threat-note.svg" } })).toBe(false);
		expect(isPlaceMarkerNote({ texture: { src: "icons/svg/book.svg" } })).toBe(false);
		expect(isPlaceMarkerNote({ texture: {} })).toBe(false);
		expect(isPlaceMarkerNote(undefined)).toBe(false);
	});

	it("namespaces its idempotency key away from the village map's letters", () => {
		const letters = (posterMap("stonetop-village").notes ?? []).map(n => n.key);
		expect(letters.length).toBeGreaterThan(0);
		for (const slug of ["vicinity", "worlds-end"]) {
			for (const pin of posterMapPins(posterMap(slug), SCENE)) {
				// Keyed on the FAMILY, never the drawing: a pin's key is its identity, and identity
				// is what has to hold still while the design moves.
				expect(pin.key).toBe(markerPinKey(pin.slug, pin.family));
				expect(letters).not.toContain(pin.key);
			}
			// And the three families are namespaced apart from each other, since an arrow and the
			// place it points at can share a name.
			const keys = posterMapPins(posterMap(slug), SCENE).map(p => p.key);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});
});

describe("comparing a pin's colour with the colour it was written in", () => {
	// The bug this exists to prevent is quiet and total. Every refit pass in this system promises
	// to be silent once the pins agree, and that promise is what makes it safe to run one on every
	// world load. A live Note's textColor and tint are ColorFields, so what comes back is a Color
	// object and never the string the writer declared, and a === against that string is false for
	// every pin that ever existed. Compared that way the passes rewrite every pin on every map, on
	// every load, for every GM, and the "has the GM moved this?" tests behind them never run.

	it("reads a live document's Color as the hex it was written from", () => {
		expect(colorKey(asColor(MAP_PIN_TEXT_COLOR))).toBe(MAP_PIN_TEXT_COLOR);
		expect(colorKey(asColor(MAP_PIN_TINT))).toBe(MAP_PIN_TINT);
		expect(sameColor(asColor(MAP_PIN_TEXT_COLOR), MAP_PIN_TEXT_COLOR)).toBe(true);
		expect(sameColor(asColor(MAP_PIN_TINT), MAP_PIN_TINT)).toBe(true);
	});

	it("keeps a leading zero, which is where a naive hex conversion loses a pin", () => {
		// #0b1009 as a number is six digits short of nothing; unpadded it reads as #b1009 and the
		// darkest inks in this palette would report drift forever.
		expect(colorKey(asColor("#0b1009"))).toBe("#0b1009");
		expect(colorKey(asColor("#000000"))).toBe("#000000");
	});

	it("still answers for the plain strings the stored source holds", () => {
		expect(sameColor("#1B1009", "#1b1009")).toBe(true);
		expect(sameColor(" #ffffff ", "#ffffff")).toBe(true);
		// The short form is the same colour, and core writes only the long one: a pin hand-edited
		// to "#fff" is a pin to leave alone, not one to rewrite on every load.
		expect(sameColor("#fff", "#ffffff")).toBe(true);
	});

	it("still says no when the colours genuinely differ", () => {
		expect(sameColor(asColor(MAP_PIN_TINT), MAP_PIN_TEXT_COLOR)).toBe(false);
		expect(sameColor("#1b1009", "#1b100a")).toBe(false);
	});

	it("reads nothing at all as nothing, rather than as black", () => {
		// `Number("")` is 0, so an empty string routed through the numeric arm would come back as
		// #000000 and an unset ink would silently agree with a black one.
		expect(colorKey(undefined)).toBe("");
		expect(colorKey(null)).toBe("");
		expect(colorKey("")).toBe("");
		expect(sameColor(undefined, MAP_PIN_TEXT_COLOR)).toBe(false);
		expect(sameColor("", "#000000")).toBe(false);
	});
});
