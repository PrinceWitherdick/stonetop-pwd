import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Handlebars from "handlebars";
import { readRepo } from "../fakes/css.js";
import {
	MAP_PIN_NAME_CHOICES, applyMapPinLabelMode, mapPinNameRecord, mapPinNameRows, showMapPinNamesOn,
} from "../../module/settings.js";
import { POSTER_MAPS, posterMapSlugOf } from "../../module/book2-art/poster-map-catalog.js";

// Whether a map pin wears its name is a question about a MAP, not about a world.
//
// The world setting is the default and the per-map record overrides it, so the two regional
// maps can stand wall-to-wall with the names the poster printing left out while the two town
// maps stay bare, in the same world, without either GM preference losing to the other.
//
// The record is sparse on purpose: a slug is present only once someone has said something about
// that map. Absent has to keep meaning "follow the default", or flipping the default later would
// move nothing, which is the failure a dense record of all five would have shipped with.

const VILLAGE = POSTER_MAPS[0];
const VICINITY = POSTER_MAPS[1];

let _game;
/** Stand up a world with a given default and per-map record, and drop the cached answers. */
function useSettings({ fallback = true, perMap = {} } = {}) {
	globalThis.game = {
		settings: {
			get: (_scope, key) => {
				if (key === "alwaysShowMapPinNames") return fallback;
				if (key === "mapPinNamesByMap") return perMap;
				throw new Error(`setting "${key}" is not registered`);
			},
		},
	};
	applyMapPinLabelMode();
}

/** A Scene the poster-map builder wrote: stamped with its slug, named the shipped name. */
const posterScene = map => ({ name: map.name, flags: { "stonetop-pwd": { posterMap: map.slug } } });

/**
 * A Scene our importer built BEFORE it stamped the flag: the shipped name, and the printing
 * itself as its background. Both halves matter — the name alone is not enough to be adopted.
 */
const unflaggedPosterScene = map => ({ name: map.name, flags: {}, background: { src: map.out } });

beforeEach(() => { _game = globalThis.game; });
afterEach(() => { globalThis.game = _game; applyMapPinLabelMode(); });

describe("which poster map a scene is", () => {
	it("reads the slug off the flag the builder stamps", () => {
		expect(posterMapSlugOf(posterScene(VICINITY))).toBe(VICINITY.slug);
	});

	it("reads it off a legacy flag scope, since the macro stamps the runtime id", () => {
		expect(posterMapSlugOf({ name: "Renamed", flags: { stonetop_pwd: { posterMap: "marshedge" } } }))
			.toBe("marshedge");
	});

	it("falls back to the shipped name, for a scene built before the flag existed", () => {
		expect(posterMapSlugOf(unflaggedPosterScene(VILLAGE))).toBe(VILLAGE.slug);
	});

	it("will not adopt a scene that merely shares the name", () => {
		// A GM's own dungeon called "Marshedge" or "Gordin's Delve" is an ordinary thing to build,
		// and every reader of this answer treats it as a fact about the PICTURE: whether that
		// map's pins wear their names, whether a route measured in fractions of that exact
		// printing may be drawn across it. Adopting one by name alone handed it both, silently,
		// with nothing on screen saying why.
		expect(posterMapSlugOf({ name: VILLAGE.name, flags: {} })).toBeNull();
		expect(posterMapSlugOf({ name: VILLAGE.name, flags: {}, background: { src: "worlds/mine/my-village.webp" } }))
			.toBeNull();
	});

	it("reads the background wherever this generation keeps it", () => {
		// v14 moved the artwork into the levels collection; v13 has it at the scene root. And the
		// same file is served from a different place on every host, so only the file's own name
		// is compared: a local data path, a Forge CDN url with a query string, a world moved
		// between the two.
		expect(posterMapSlugOf({
			name: VICINITY.name, flags: {},
			levels: { contents: [{ background: { src: `/${VICINITY.out}` } }] },
		})).toBe(VICINITY.slug);
		expect(posterMapSlugOf({
			name: VICINITY.name, flags: {},
			background: { src: `https://assets.forge-vtt.com/abc/${VICINITY.out}?t=1` },
		})).toBe(VICINITY.slug);
	});

	it("ignores a flag naming a map this package does not ship", () => {
		// A record left by a map that has since been dropped must not name a row that is not
		// there; the name fallback is what decides, and here it decides nothing.
		expect(posterMapSlugOf({ name: "Somewhere", flags: { "stonetop-pwd": { posterMap: "atlantis" } } }))
			.toBeNull();
	});

	it("says nothing about a scene that is no poster map", () => {
		expect(posterMapSlugOf({ name: "The Barrow Under the Hill", flags: {} })).toBeNull();
		expect(posterMapSlugOf(null)).toBeNull();
	});
});

describe("the world default, where no map has been switched", () => {
	it("names the pins on every map when it is on", () => {
		useSettings({ fallback: true });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(true);
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(true);
		expect(showMapPinNamesOn({ name: "A dungeon of my own" })).toBe(true);
	});

	it("hands every map back to hover when it is off", () => {
		useSettings({ fallback: false });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(false);
		expect(showMapPinNamesOn({ name: "A dungeon of my own" })).toBe(false);
	});
});

describe("a map that answers for itself", () => {
	it("goes quiet while the rest of the world keeps its names", () => {
		useSettings({ fallback: true, perMap: { [VICINITY.slug]: false } });
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(false);
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(true);
		expect(showMapPinNamesOn({ name: "A dungeon of my own" })).toBe(true);
	});

	it("keeps its names while the rest of the world goes quiet", () => {
		// The override is not a second OFF switch: it has to be able to overrule the default in
		// both directions, or a GM who wants names on one map only would have no way to ask.
		useSettings({ fallback: false, perMap: { [VICINITY.slug]: true } });
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(true);
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(false);
	});

	it("is matched by name too, so a scene built before the flag can be switched", () => {
		useSettings({ fallback: true, perMap: { [VILLAGE.slug]: false } });
		expect(showMapPinNamesOn(unflaggedPosterScene(VILLAGE))).toBe(false);
	});

	it("leaves a homebrew scene of the same name following the world default", () => {
		// The switch is per POSTER MAP. A GM who quietens the dense Marshedge printing must not
		// also quieten the pins on their own dungeon that happens to share its name — a scene
		// that appears nowhere in the settings menu, so nothing there could explain it.
		useSettings({ fallback: true, perMap: { [VILLAGE.slug]: false } });
		expect(showMapPinNamesOn({ name: VILLAGE.name, flags: {} })).toBe(true);
	});

	it("leaves every other map following the default when the default changes", () => {
		// The whole reason the record is sparse. One map switched must not pin the other four.
		useSettings({ fallback: true, perMap: { [VICINITY.slug]: false } });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(true);
		useSettings({ fallback: false, perMap: { [VICINITY.slug]: false } });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(false);
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(false);
	});
});

describe("reading before the settings exist", () => {
	it("names the pins rather than painting a silently quiet map", () => {
		// This is reached from a PIXI refresh, which a scene painted during startup can hit
		// before the keys are registered. Both reads throw there, and both have to land on the
		// shipped default.
		globalThis.game = { settings: { get: () => { throw new Error("not registered"); } } };
		applyMapPinLabelMode();
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(true);
	});

	it("does not freeze the empty answer it had to invent", () => {
		// Caching "nothing has ever been switched here" from a read that failed would blind the
		// world to every override it holds, until something else happened to flip a setting.
		globalThis.game = { settings: { get: () => { throw new Error("not registered"); } } };
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(true);
		globalThis.game = {
			settings: {
				get: (_scope, key) =>
					key === "alwaysShowMapPinNames" ? true : { [VICINITY.slug]: false },
			},
		};
		expect(showMapPinNamesOn(posterScene(VICINITY))).toBe(false);
	});
});

describe("the menu's rows and what saving them stores", () => {
	it("offers a row per poster map, in the order the nav bar shows them", () => {
		expect(mapPinNameRows({}).map(row => row.slug)).toEqual(POSTER_MAPS.map(map => map.slug));
	});

	it("labels a row with the name its Scene carries", () => {
		expect(mapPinNameRows({})[0].name).toBe(VILLAGE.name);
	});

	it("reads an untouched map as following, whatever the default happens to be", () => {
		// Not "showing", even in a world whose default is on. The row states where the ANSWER
		// comes from; a row that read "always show" would look switched when it is not.
		const [village] = mapPinNameRows({});
		expect(village.chosen).toBe(MAP_PIN_NAME_CHOICES.follow);
	});

	it("reads a switched map as switched, in both directions", () => {
		const rows = mapPinNameRows({ [VILLAGE.slug]: false, [VICINITY.slug]: true });
		expect(rows[0].chosen).toBe(MAP_PIN_NAME_CHOICES.hover);
		expect(rows[1].chosen).toBe(MAP_PIN_NAME_CHOICES.always);
	});

	it("stores nothing at all for a map left following", () => {
		// The whole point of the sparse record: an absent slug follows the default forever after,
		// including after the default changes. Storing `false` here would silently pin it.
		const stored = mapPinNameRecord({ [`map.${VILLAGE.slug}`]: MAP_PIN_NAME_CHOICES.follow });
		expect(VILLAGE.slug in stored).toBe(false);
		expect(stored).toEqual({});
	});

	it("stores only the maps that were switched", () => {
		expect(mapPinNameRecord({
			[`map.${VILLAGE.slug}`]: MAP_PIN_NAME_CHOICES.hover,
			[`map.${VICINITY.slug}`]: MAP_PIN_NAME_CHOICES.always,
		})).toEqual({ [VILLAGE.slug]: false, [VICINITY.slug]: true });
	});

	it("drops an override when its row is handed back to the default", () => {
		// Rebuilt rather than merged, which is what makes "follow the world setting" reversible.
		// A merge would leave the old answer in place under a row that now says it follows.
		const stored = mapPinNameRecord({ [`map.${VILLAGE.slug}`]: MAP_PIN_NAME_CHOICES.follow });
		useSettings({ fallback: true, perMap: stored });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(true);
		useSettings({ fallback: false, perMap: stored });
		expect(showMapPinNamesOn(posterScene(VILLAGE))).toBe(false);
	});

	it("survives a form that carried no rows at all", () => {
		expect(mapPinNameRecord({})).toEqual({});
		expect(mapPinNameRecord()).toEqual({});
	});

	it("round-trips every row back to the answer it was showing", () => {
		const perMap = { [VILLAGE.slug]: false, [VICINITY.slug]: true };
		const formData = Object.fromEntries(mapPinNameRows(perMap)
			.map(row => [`map.${row.slug}`, row.chosen]));
		expect(mapPinNameRecord(formData)).toEqual(perMap);
	});

	// The select's option values and its field name are the wire between the template and
	// mapPinNameRecord, and a mismatch in either fails silently: every row would decode as
	// "follow", so saving the menu would quietly wipe every override a world holds.
	const TEMPLATE = readRepo("templates/settings/map-pin-names.hbs");

	// The template no longer spells the values out — it renders `options` — so the wire is
	// checked where it is now authored, and the .hbs is only asked to prove it still reads them.
	it("offers exactly the option values the decoder expects, and marks one selected", () => {
		const [row] = mapPinNameRows({ [VILLAGE.slug]: true });
		expect(row.options.map(o => o.value)).toEqual(Object.values(MAP_PIN_NAME_CHOICES));
		expect(row.options.filter(o => o.selected).map(o => o.value))
			.toEqual([MAP_PIN_NAME_CHOICES.always]);
		expect(row.options.every(o => !!o.labelKey)).toBe(true);
	});

	it("renders the option values from the row rather than restating them", () => {
		expect(TEMPLATE).toContain('<option value="{{value}}"');
		expect(TEMPLATE).not.toMatch(/<option value="(on|off)"/);
	});

	it("matches the template's field name to the one the decoder reads", () => {
		expect(TEMPLATE).toContain('name="map.{{slug}}"');
	});

	// The menu's chrome is two shared partials now, and a partial that fails to register renders
	// as NOTHING with nothing logged — a blank settings window. So the template is actually
	// compiled here, with the partials wired the way stonetop.js wires them, and asked to produce
	// the three controls the menu is: the master toggle, a per-map select, and the Save button.
	it("renders the whole menu once its shared partials are registered", () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", (key) => `L(${key})`);
		for (const [name, file] of [
			["stonetop.settings-toggle-row", "templates/settings/partials/settings-toggle-row.hbs"],
			["stonetop.settings-save-footer", "templates/settings/partials/settings-save-footer.hbs"],
		]) hb.registerPartial(name, readRepo(file));

		const html = hb.compile(TEMPLATE)({
			enabled: true,
			maps: mapPinNameRows({ [VILLAGE.slug]: false }),
		});
		expect(html).toContain('name="alwaysShowMapPinNames"');
		expect(html).toContain("checked");
		expect(html).toContain(`name="map.${VILLAGE.slug}"`);
		// The stored override is `false`, so "hover only" is the option that comes back selected.
		expect(html).toMatch(new RegExp(`<option value="${MAP_PIN_NAME_CHOICES.hover}" selected>`));
		expect(html).toContain('type="submit"');
	});

	it("reads the rows whether or not the form data arrived dot-expanded", () => {
		// v13 hands _updateObject a flat FormDataExtended object, so the dotted name survives
		// whole. Anything that expands it on the way delivers a nested `map` object instead, and
		// decoding that as "nothing was switched" would erase the record on the very next save.
		const expanded = { map: { [VILLAGE.slug]: MAP_PIN_NAME_CHOICES.hover } };
		expect(mapPinNameRecord(expanded)).toEqual({ [VILLAGE.slug]: false });
	});
});
