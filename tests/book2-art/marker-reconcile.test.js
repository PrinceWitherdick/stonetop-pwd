import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POSTER_MAPS, planMarkerWrites } from "../../module/book2-art/poster-maps.js";
import {
	markerPinKey, markerTextAnchor, placeMarkerIcon, posterMapPins,
} from "../../module/utils/map-pins.js";

// Deciding what to write to one map's markers: which pins to lay down, and which of the pins
// already down have fallen behind the design.
//
// The case this exists for is the one that bit: a table runs the pass, the design then changes
// (smaller icons, signposts for the arrows, links to the book), and a create-only pass leaves
// them frozen on version one with no way forward but deleting eighteen pins by hand.

let _const;
beforeEach(() => {
	_const = globalThis.CONST;
	globalThis.CONST = { TEXT_ANCHOR_POINTS: { CENTER: 0, BOTTOM: 1, TOP: 2, LEFT: 3, RIGHT: 4 } };
});
afterEach(() => { globalThis.CONST = _const; });

const SCENE = { width: 6000, height: 4714 };
const posterMap = slug => POSTER_MAPS.find(m => m.slug === slug);
const vicinity = () => posterMap("vicinity");
const pinsFor = () => posterMapPins(vicinity(), SCENE);
const places = () => pinsFor().filter(p => p.family === "place");

/** A marker note as this system would have written it, at whatever spec is passed. */
function noteFor(pin, over = {}) {
	return {
		id: `note-${pin.slug}`,
		x: pin.x, y: pin.y, text: pin.name,
		iconSize: 70, fontSize: 45, textAnchor: markerTextAnchor(pin.kind), textColor: "#1b1009",
		global: true, entryId: null,
		texture: { src: placeMarkerIcon(pin.kind) },
		flags: { "stonetop-pwd": { posterPin: pin.key, markerSpec: { x: pin.x, y: pin.y, text: pin.name } } },
		...over,
	};
}

describe("laying down what is missing", () => {
	it("creates every pin on a map that has never been marked", () => {
		const { creates, updates } = planMarkerWrites({ pins: pinsFor() });
		expect(creates).toHaveLength(14);
		expect(updates).toHaveLength(0);
		expect(creates.every(c => c.flags["stonetop-pwd"].markerSpec)).toBe(true);
	});

	it("leaves a pin the GM deleted deleted, because its key is on the record", () => {
		// The bargain the record exists to keep: removing the pin for a place the party has not
		// found yet is a decision, and a pass that puts it back every reload is arguing with them.
		const pins = pinsFor();
		const placed = pins.map(p => p.key);
		expect(planMarkerWrites({ pins, notes: [], placed }).creates).toHaveLength(0);
	});

	it("still creates a pin the design only just grew, on a map marked long ago", () => {
		// The failure that made this a reconcile rather than a latch. A world marked before the
		// arrows and the region captions existed has every PLACE key on its record and none of
		// theirs, so those are what a later pass has to be free to add.
		const pins = pinsFor();
		const placed = places().map(p => p.key);
		const { creates } = planMarkerWrites({ pins, notes: places().map(p => noteFor(p)), placed });
		expect(creates.map(c => c.text)).toEqual([
			"To Barrier Pass", "To Gordin's Delve", "To Steplands & Marshedge",
			"The Great Wood", "The Highway", "The West Road", "The Flats",
		]);
	});

	it("recognises a pin whose flag was lost, by its label and its glyph", () => {
		const pins = pinsFor();
		const orphan = { ...noteFor(pins[0]), flags: {} };
		const { creates } = planMarkerWrites({ pins, notes: [orphan] });
		expect(creates.map(c => c.text)).not.toContain(pins[0].name);
	});

	it("hands one unflagged note to ONE pin, however many share its caption", () => {
		// The village has three signposts all captioned "To the Old Wall", so a fallback that
		// matches on label text alone gives the same note to all three: two would never be laid
		// down, and the same `_id` would go into a single update batch three times over, which
		// Foundry answers by writing whichever copy it reaches last.
		const village = posterMapPins(posterMap("stonetop-village"), SCENE);
		const twins = village.filter(p => p.name === "To the Old Wall");
		expect(twins.length).toBe(3);

		const orphan = { ...noteFor(twins[0]), id: "orphan", flags: {} };
		const { creates, updates } = planMarkerWrites({ pins: twins, notes: [orphan] });
		expect(updates.map(u => u._id)).toEqual(["orphan"]);
		expect(new Set(updates.map(u => u._id)).size).toBe(updates.length);
		// The other two are new furniture, not silent no-ops.
		expect(creates).toHaveLength(2);
	});
});

describe("bringing what is there up to date", () => {
	it("writes nothing at all when every pin already agrees", () => {
		// The pass runs on every load, so silence in the steady state is the whole budget.
		const pins = pinsFor();
		const { creates, updates } = planMarkerWrites({
			pins, notes: pins.map(p => noteFor(p)), placed: pins.map(p => p.key),
		});
		expect(creates).toHaveLength(0);
		expect(updates).toHaveLength(0);
	});

	it("resizes a pin left over from an earlier design", () => {
		const pin = places()[0];
		const stale = noteFor(pin, { iconSize: 100, fontSize: 60 });
		const [update] = planMarkerWrites({ pins: [pin], notes: [stale], placed: [pin.key] }).updates;
		expect(update.iconSize).toBe(70);
		expect(update.fontSize).toBe(45);
	});

	it("swaps the glyph when a pin's family changes drawing", () => {
		const exit = pinsFor().find(p => p.kind === "exit");
		const wrong = noteFor(exit, { texture: { src: placeMarkerIcon("place") } });
		const [update] = planMarkerWrites({ pins: [exit], notes: [wrong], placed: [exit.key] }).updates;
		expect(update.texture.src).toBe(placeMarkerIcon("exit"));
	});

	it("re-draws a place the design has since decided is a mountain, in place", () => {
		// The case a table is actually in: Tor's Fist and Barrier Pass went down as teardrops and
		// are mountains now. That has to reach the pin they already have, and it must not put a
		// second pin on the same peak, which is exactly what keying on the drawing would do.
		const pins = posterMapPins(posterMap("worlds-end"), SCENE);
		const fist = pins.find(p => p.slug === "tors-fist");
		const asPlaced = noteFor(fist, {
			texture: { src: placeMarkerIcon("place") },
			// It went down with the teardrop's lift, one pixel deeper than the range's.
			y: fist.y - 6,
			flags: { "stonetop-pwd": { posterPin: fist.key, markerSpec: { x: fist.x, y: fist.y - 6, text: fist.name } } },
		});
		const { creates, updates } = planMarkerWrites({ pins: [fist], notes: [asPlaced], placed: [fist.key] });
		expect(creates).toHaveLength(0);
		expect(updates).toHaveLength(1);
		expect(updates[0]._id).toBe(asPlaced.id);
		expect(updates[0].texture.src).toBe(placeMarkerIcon("peak"));
		// And it stands back up on the spot, since the two drawings have different feet.
		expect(updates[0].y).toBe(fist.y);
	});

	it("links a pin that was laid down before this world had the journals", () => {
		const pin = places()[0];
		const links = new Map([[pin.slug, "world-entry-1"]]);
		const [update] = planMarkerWrites({ pins: [pin], notes: [noteFor(pin)], placed: [pin.key], links }).updates;
		expect(update.entryId).toBe("world-entry-1");
		// The page is cleared with it, so the visibility test lands on the entry we opened.
		expect(update.pageId).toBe(null);
	});

	it("re-asserts both halves of the public-pin pair", () => {
		// A pin that lost either goes silently GM-only on Foundry 14, on the players' screens only.
		const pin = places()[0];
		const hidden = noteFor(pin, { global: false, _source: { author: "some-user" } });
		const [update] = planMarkerWrites({ pins: [pin], notes: [hidden], placed: [pin.key] }).updates;
		expect(update.global).toBe(true);
		expect(update.author).toBe(null);
	});
});

describe("what belongs to the GM once they touch it", () => {
	it("moves a pin that is still where we left it", () => {
		const pin = places()[0];
		const old = noteFor(pin, {
			y: pin.y + 13,
			flags: { "stonetop-pwd": { posterPin: pin.key, markerSpec: { x: pin.x, y: pin.y + 13, text: pin.name } } },
		});
		const [update] = planMarkerWrites({ pins: [pin], notes: [old], placed: [pin.key] }).updates;
		expect(update.y).toBe(pin.y);
	});

	it("leaves a pin the GM dragged somewhere else exactly where they put it", () => {
		const pin = places()[0];
		const moved = noteFor(pin, { x: pin.x + 900, y: pin.y - 400 });
		const { updates } = planMarkerWrites({ pins: [pin], notes: [moved], placed: [pin.key] });
		expect(updates[0]?.x).toBeUndefined();
		expect(updates[0]?.y).toBeUndefined();
	});

	it("adopts a pin the GM moved once the table agrees with where they put it", () => {
		// What recording a GM's own placement back into travel-times.js looks like from here. The
		// pin is already right, so there is nothing to move; what is wrong is the RECORD, which
		// still says they dragged it off a position nothing claims any more. Left alone it would
		// refuse every later move of that place on behalf of an argument that has ended.
		const pin = places()[0];
		const theirs = noteFor(pin, {
			flags: { "stonetop-pwd": { posterPin: pin.key, markerSpec: { x: pin.x - 240, y: pin.y + 90, text: pin.name } } },
		});
		const { creates, updates } = planMarkerWrites({ pins: [pin], notes: [theirs], placed: [pin.key] });
		expect(creates).toHaveLength(0);
		expect(updates).toHaveLength(1);
		// The record and nothing else: the pin does not budge, because it is already there.
		expect(updates[0].flags["stonetop-pwd"].markerSpec).toEqual({ x: pin.x, y: pin.y, text: pin.name });
		expect(updates[0].x).toBeUndefined();
		expect(updates[0].y).toBeUndefined();

		// And it settles in that one write rather than writing every load forever.
		const settled = noteFor(pin, { flags: updates[0].flags });
		expect(planMarkerWrites({ pins: [pin], notes: [settled], placed: [pin.key] }).updates).toHaveLength(0);
	});

	it("leaves a pin the GM renamed under their own name", () => {
		const pin = places()[0];
		const renamed = noteFor(pin, { text: "Where Tor fell" });
		const { updates } = planMarkerWrites({ pins: [pin], notes: [renamed], placed: [pin.key] });
		expect(updates[0]?.text).toBeUndefined();
	});

	it("treats a pin stamped before we kept records as untouched", () => {
		// There is nothing to compare it against, and a pin nobody has edited is what it almost
		// always is. Being wrong costs one pin moving back to where the map says it goes.
		const pin = places()[0];
		const unstamped = noteFor(pin, {
			y: pin.y + 13,
			flags: { "stonetop-pwd": { posterPin: pin.key } },
		});
		const [update] = planMarkerWrites({ pins: [pin], notes: [unstamped], placed: [pin.key] }).updates;
		expect(update.y).toBe(pin.y);
		expect(update.flags["stonetop-pwd"].markerSpec).toEqual({ x: pin.x, y: pin.y, text: pin.name });
	});

	it("stamps a pin that has no record even when nothing else about it is wrong", () => {
		// Otherwise the very next pass cannot tell it from one the GM has since moved.
		const pin = places()[0];
		const unstamped = noteFor(pin, { flags: { "stonetop-pwd": { posterPin: pin.key } } });
		const { updates } = planMarkerWrites({ pins: [pin], notes: [unstamped], placed: [pin.key] });
		expect(updates).toHaveLength(1);
		expect(updates[0].flags["stonetop-pwd"].markerSpec.text).toBe(pin.name);
	});
});

describe("the padded canvas", () => {
	it("offsets creates and moves alike", () => {
		const pin = places()[0];
		const origin = { x: 1600, y: 1200 };
		const { creates } = planMarkerWrites({ pins: [pin], origin });
		expect(creates[0].x).toBe(pin.x + 1600);
		expect(creates[0].y).toBe(pin.y + 1200);

		const settled = noteFor(pin);
		const [update] = planMarkerWrites({ pins: [pin], notes: [settled], placed: [pin.key], origin }).updates;
		expect(update.x).toBe(pin.x + 1600);
		expect(update.y).toBe(pin.y + 1200);
	});
});

describe("keys", () => {
	it("namespaces the two families apart, so an arrow and its destination cannot collide", () => {
		const keys = pinsFor().map(p => p.key);
		expect(new Set(keys).size).toBe(keys.length);
		// The Vicinity carries an arrow TO Gordin's Delve while the World's End carries the place
		// itself, so the two families are namespaced apart as well as slugged apart.
		expect(keys).toContain(markerPinKey("to-gordins-delve", "exit"));
		expect(markerPinKey("x", "exit")).not.toBe(markerPinKey("x", "place"));
	});
});
