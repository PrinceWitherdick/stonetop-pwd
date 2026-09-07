import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	RELMAP_PEN_FLAG, getPen, penFor, penPatch, readPen, rememberPen,
} from "../../module/relmap/relmap-pen.js";
import {
	RELMAP_DASH_DEFAULT, RELMAP_DASH_DOTTED, RELMAP_INK_DEFAULT, RELMAP_SIZE_NONE,
} from "../../module/relmap/relmap-store.js";
import { RELMAP_CAPTION_PX } from "../../module/utils/relmap-geometry.js";

// The pen a MAP is being drawn with: the colour, the stroke and the caption size the next line on
// it starts in, kept on the entry so that everybody editing that map draws with the same one.
//
// The two things this suite is really holding, because nothing else would notice either breaking:
//
//  • NOTHING REACHES A DOCUMENT UNCHECKED. The pen is a flag any owner of the map could have
//    written, and what it feeds is fields on a line every client at the table repaints from -- so
//    every path in and out goes through the store's own sanitisers, and a suite that stubbed those
//    would be testing nothing.
//  • SPARSE IS NOT THE SAME AS DEFAULT. "nobody has chosen a size on this map" and "somebody chose
//    the ordinary size" are different states that both read as `RELMAP_SIZE_NONE`, and telling them
//    apart is the whole of what lets a reader's own remembered size still seed a fresh map.

const PREFIX = `flags.stonetop-pwd.${RELMAP_PEN_FLAG}`;

/** A map, as much of one as this file touches: a flag bag, ownership, and a document update. */
function makeMap({ pen = null, isOwner = true } = {}) {
	const flags = pen ? { "stonetop-pwd": { [RELMAP_PEN_FLAG]: pen } } : {};
	return {
		isOwner,
		flags,
		updates: [],
		getFlag(scope, key) {
			return flags[scope]?.[key];
		},
		update(patch) {
			this.updates.push(patch);
			// Walked as a real document walks it, so a read back afterwards finds what was
			// written. See tests/relmap/relmap-doc.test.js, which says why a fake that only
			// recorded patches certifies code the real thing never runs.
			for (const [path, value] of Object.entries(patch)) {
				const parts = path.split(".");
				const leaf = parts.pop();
				let at = this;
				for (const part of parts) {
					if (at[part] === null || typeof at[part] !== "object") at[part] = {};
					at = at[part];
				}
				at[leaf] = value;
			}
			return Promise.resolve(this);
		},
	};
}

describe("reading a stored pen", () => {
	it("is empty on a map nobody has chosen anything on", () => {
		expect(readPen(undefined)).toEqual({});
		expect(readPen(null)).toEqual({});
		expect(readPen("dotted")).toEqual({});
		expect(getPen(makeMap())).toEqual({});
	});

	it("holds every field to the same gate the line itself goes through", () => {
		expect(readPen({ ink: "plum", dash: RELMAP_DASH_DOTTED, size: 20 }))
			.toEqual({ ink: "plum", dash: RELMAP_DASH_DOTTED, size: 20 });
		// A colour of the reader's own is a hex, and stays one.
		expect(readPen({ ink: "#3a404a" }).ink).toBe("#3a404a");
		// The two greens that are no longer offered are still read as the green that replaced them.
		expect(readPen({ ink: "teal" }).ink).toBe("green");
		// And anything else falls back rather than reaching a class name or a style attribute.
		expect(readPen({ ink: "javascript:alert(1)" }).ink).toBe(RELMAP_INK_DEFAULT);
		expect(readPen({ dash: "squiggly" }).dash).toBe(RELMAP_DASH_DEFAULT);
		expect(readPen({ size: 500 }).size).toBe(48);
		expect(readPen({ size: "potato" }).size).toBe(RELMAP_SIZE_NONE);
	});

	it("keeps only the fields that were actually set", () => {
		expect(readPen({ ink: "rust" })).toEqual({ ink: "rust" });
		expect(readPen({ ink: "rust", shape: "star", kin: "mother" })).toEqual({ ink: "rust" });
	});

	it("tells a size nobody chose from the ordinary size, chosen", () => {
		// Both read as zero -- which is why the presence of the key is what carries the difference.
		expect(readPen({ size: RELMAP_CAPTION_PX })).toEqual({ size: RELMAP_SIZE_NONE });
		expect("size" in readPen({})).toBe(false);
	});
});

describe("what a new line is born in", () => {
	it("is the shipped default on a map with no pen", () => {
		expect(penFor(makeMap())).toEqual({
			ink: RELMAP_INK_DEFAULT, dash: RELMAP_DASH_DEFAULT, size: RELMAP_SIZE_NONE,
		});
	});

	it("is the map's own pen once somebody has chosen one", () => {
		const map = makeMap({ pen: { ink: "plum", dash: RELMAP_DASH_DOTTED, size: 24 } });
		expect(penFor(map)).toEqual({ ink: "plum", dash: RELMAP_DASH_DOTTED, size: 24 });
	});

	it("fills a field the map has not got from the shipped default and not from another", () => {
		const map = makeMap({ pen: { dash: RELMAP_DASH_DOTTED } });
		expect(penFor(map)).toEqual({
			ink: RELMAP_INK_DEFAULT, dash: RELMAP_DASH_DOTTED, size: RELMAP_SIZE_NONE,
		});
	});

	// ⚠ THE ONE PLACE THIS READER'S OWN REMEMBERED SIZE STILL GETS A SAY, and the reason
	// relmap/relmap-size.js is still written to at all. A reader on a screen magnifier carries their
	// twenty-pixel captions onto a map nobody has set a size on -- and stops carrying them the
	// moment the table sets one, because the map is what everybody at it shares.
	it("seeds an unset size from the reader's own, and only an unset one", () => {
		expect(penFor(makeMap(), { size: 20 }).size).toBe(20);
		expect(penFor(makeMap({ pen: { size: 13 } }), { size: 20 }).size).toBe(13);
	});

	it("holds even that seed to the store's gate", () => {
		expect(penFor(makeMap(), { size: 500 }).size).toBe(48);
		expect(penFor(makeMap(), { size: "potato" }).size).toBe(RELMAP_SIZE_NONE);
	});

	// A reader who deliberately clears the size has chosen "whatever the sheet sets", and that is a
	// choice the map keeps -- it must not fall through to the seed and quietly come back.
	it("lets the map's own 'no size at all' beat the reader's remembered one", () => {
		const map = makeMap({ pen: { size: RELMAP_SIZE_NONE } });
		expect(penFor(map, { size: 20 }).size).toBe(RELMAP_SIZE_NONE);
	});
});

describe("the write that records a pen", () => {
	it("is a leaf per field, so two readers choosing at once both survive", () => {
		expect(penPatch({ ink: "plum", size: 24 })).toEqual({
			[`${PREFIX}.ink`]: "plum",
			[`${PREFIX}.size`]: 24,
		});
	});

	it("takes only the pen's own fields out of what the bar wrote", () => {
		expect(penPatch({ label: "her mother", dir: "a-b", note: "x" })).toBeNull();
		expect(penPatch({ label: "her mother", dash: RELMAP_DASH_DOTTED }))
			.toEqual({ [`${PREFIX}.dash`]: RELMAP_DASH_DOTTED });
	});

	it("sanitises on the way in as well as on the way out", () => {
		expect(penPatch({ ink: "teal" })).toEqual({ [`${PREFIX}.ink`]: "green" });
		expect(penPatch({ dash: "squiggly" })).toEqual({ [`${PREFIX}.dash`]: RELMAP_DASH_DEFAULT });
	});

	it("writes nothing when the choice is the one already recorded", () => {
		const was = { ink: "plum", dash: RELMAP_DASH_DOTTED, size: 24 };
		expect(penPatch({ ink: "plum" }, was)).toBeNull();
		expect(penPatch({ ink: "plum", size: 24 }, was)).toBeNull();
		expect(penPatch({ ink: "plum", size: 32 }, was)).toEqual({ [`${PREFIX}.size`]: 32 });
	});

	// The choosers paint their answer on every open of the bar, so "unchanged" is most calls -- and
	// unlike the client settings beside it, an unchanged write here would broadcast to every client.
	it("counts a field the map has not got as a change, even to the default", () => {
		expect(penPatch({ dash: RELMAP_DASH_DEFAULT }, {}))
			.toEqual({ [`${PREFIX}.dash`]: RELMAP_DASH_DEFAULT });
	});
});

describe("remembering the pen on the map", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("puts the choice where every other client reads it", async () => {
		const map = makeMap();
		await rememberPen(map, { ink: "rust", dash: RELMAP_DASH_DOTTED });
		expect(map.updates).toEqual([{
			[`${PREFIX}.ink`]: "rust",
			[`${PREFIX}.dash`]: RELMAP_DASH_DOTTED,
		}]);
		// And the next line drawn on that map is born in it.
		expect(penFor(map)).toEqual({
			ink: "rust", dash: RELMAP_DASH_DOTTED, size: RELMAP_SIZE_NONE,
		});
	});

	it("does not write at all when nothing moved", async () => {
		const map = makeMap({ pen: { ink: "rust" } });
		expect(rememberPen(map, { ink: "rust" })).toBeNull();
		expect(rememberPen(map, { label: "her mother" })).toBeNull();
		expect(map.updates).toEqual([]);
	});

	// A GM who has reached past this feature for core's ownership dialog can leave a reader able to
	// edit a BOARD and not the map above it. The line still lands; the pen simply is not theirs.
	it("stays quiet on a map this reader may not write", () => {
		const map = makeMap({ isOwner: false });
		expect(rememberPen(map, { ink: "rust" })).toBeNull();
		expect(map.updates).toEqual([]);
		expect(console.error).not.toHaveBeenCalled();
	});

	// ⚠ SILENT, because this rides alongside the write that changed the line the reader is looking
	// at: a pen that failed to record must not put an error in front of a colour that landed.
	it("swallows a refused write rather than surfacing it over the line", async () => {
		const map = makeMap();
		map.update = () => Promise.reject(new Error("nope"));
		await rememberPen(map, { ink: "rust" });
		expect(console.error).toHaveBeenCalled();
	});

	it("swallows one that throws outright", () => {
		const map = makeMap();
		map.update = () => { throw new Error("nope"); };
		expect(rememberPen(map, { ink: "rust" })).toBeNull();
		expect(console.error).toHaveBeenCalled();
	});

	it("has nothing to say about a map that is not there", () => {
		expect(rememberPen(null, { ink: "rust" })).toBeNull();
		expect(rememberPen({}, { ink: "rust" })).toBeNull();
	});
});
