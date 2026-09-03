import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	applyMapPinLabelMode, localMapPinNameOverride, setLocalMapPinNames, showMapPinNamesOn,
	toggleLocalMapPinNames,
} from "../../module/settings.js";
import { mapPinNameToggleView } from "../../module/hooks/MapPinNameToggle.js";
import { onDrawStonetopNote } from "../../module/hooks/StonetopNoteLabels.js";
import { SITE_PIN_ICON_SUFFIX } from "../../module/hooks/ThreatNotePins.js";
import { PLACE_MARKER_ICON_SUFFIX } from "../../module/utils/map-pins.js";
import { POSTER_MAPS } from "../../module/book2-art/poster-map-catalog.js";

// The eye beside the sidebar: one reader saying "quiet this map", about the map in front of them,
// on their own screen. It is the third and narrowest answer to a question the world default and
// the per-poster-map record already answer, so most of what is worth pinning down here is the
// order the three are consulted in and what happens at the edges of that order.
//
// The button's placement is not testable without a DOM (this suite runs on `node`), and it is
// deliberately not worth faking one for: the placement is a single insertBefore against core's
// own `#ui-right` row. What IS worth holding is the decision the button paints from, which is why
// mapPinNameToggleView takes its three facts as arguments instead of reading the canvas.

const VILLAGE = POSTER_MAPS[0];
const VICINITY = POSTER_MAPS[1];
const MARKER = `systems/stonetop-pwd/${PLACE_MARKER_ICON_SUFFIX}`;
const SITE_PIN = `systems/stonetop-pwd/${SITE_PIN_ICON_SUFFIX}`;

/** A plain scene: not a poster map, so it has only the world default behind it. */
const scene = (id, map = null) => ({
	id,
	name: map?.name ?? "Somewhere",
	flags: map ? { "stonetop-pwd": { posterMap: map.slug } } : {},
});

let _game;
let _store;

/**
 * Stand up a world whose settings can be written as well as read.
 *
 * `set` calls applyMapPinLabelMode because that is what core does: a client setting's onChange
 * fires synchronously from the write, and this one's onChange is exactly that call. A fake that
 * only stored the value would let every assertion below pass against a stale cache.
 */
function useWorld({ world = "stonetop", fallback = true, perMap = {}, local = {} } = {}) {
	_store = {
		alwaysShowMapPinNames: fallback,
		mapPinNamesByMap: perMap,
		mapPinNamesLocal: local,
	};
	globalThis.game = {
		world: { id: world },
		i18n: _game.i18n,
		settings: {
			get: (_scope, key) => {
				if (key in _store) return _store[key];
				throw new Error(`setting "${key}" is not registered`);
			},
			set: async (_scope, key, value) => {
				_store[key] = value;
				applyMapPinLabelMode();
				return value;
			},
		},
	};
	applyMapPinLabelMode();
	return _store;
}

beforeEach(() => { _game = globalThis.game; });
afterEach(() => { globalThis.game = _game; applyMapPinLabelMode(); });

describe("which answer wins for a scene", () => {
	it("follows the world default when this reader has said nothing", () => {
		useWorld({ fallback: true });
		expect(showMapPinNamesOn(scene("s1"))).toBe(true);
		expect(localMapPinNameOverride(scene("s1"))).toBeUndefined();
	});

	it("lets one reader quiet a map the world says to name", () => {
		useWorld({ fallback: true, local: { stonetop: { s1: false } } });
		expect(showMapPinNamesOn(scene("s1"))).toBe(false);
	});

	it("beats a poster map's own override, which is the point of asking it first", () => {
		// The per-map record is the GM's configuration for the table. This is one person looking
		// at that map right now, and their answer is about their screen, so it has to win.
		useWorld({ fallback: true, perMap: { [VILLAGE.slug]: false }, local: { stonetop: { s1: true } } });
		expect(showMapPinNamesOn(scene("s1", VILLAGE))).toBe(true);
	});

	it("is sparse, so an answer about one scene leaves every other scene following", () => {
		useWorld({ fallback: true, local: { stonetop: { s1: false } } });
		expect(showMapPinNamesOn(scene("s1"))).toBe(false);
		expect(showMapPinNamesOn(scene("s2"))).toBe(true);
		expect(showMapPinNamesOn(scene("s2", VICINITY))).toBe(true);
	});

	it("ignores a record written in a different world", () => {
		// Client settings live in browser localStorage under `namespace.key` alone, with no world
		// in the path, so the record has to nest by world id itself or a second world opened in
		// the same browser reads the first world's answers.
		useWorld({ world: "stonetop", fallback: true, local: { "some-other-world": { s1: false } } });
		expect(showMapPinNamesOn(scene("s1"))).toBe(true);
	});

	it("answers the shipped default for a scene with no id to be keyed by", () => {
		useWorld({ fallback: true, local: { stonetop: { s1: false } } });
		expect(showMapPinNamesOn(null)).toBe(true);
		expect(localMapPinNameOverride(null)).toBeUndefined();
	});
});

describe("writing this reader's answer", () => {
	it("records it under the current world, beside any other world's", () => {
		const store = useWorld({ world: "stonetop", local: { elsewhere: { s9: true } } });
		return setLocalMapPinNames(scene("s1"), false).then(() => {
			expect(store.mapPinNamesLocal).toEqual({ elsewhere: { s9: true }, stonetop: { s1: false } });
		});
	});

	it("clears the scene on null rather than storing a third value", () => {
		// Absent is what means "follow whatever the GM configured". A stored null would read as no
		// override and yet keep the scene listed forever.
		const store = useWorld({ local: { stonetop: { s1: false, s2: true } } });
		return setLocalMapPinNames(scene("s1"), null).then(() => {
			expect(store.mapPinNamesLocal.stonetop).toEqual({ s2: true });
			expect(showMapPinNamesOn(scene("s1"))).toBe(true);
		});
	});

	it("drops an emptied world slice, so turning every override off leaves no husk", () => {
		const store = useWorld({ world: "stonetop", local: { stonetop: { s1: false }, elsewhere: { s9: true } } });
		return setLocalMapPinNames(scene("s1"), null).then(() => {
			expect(store.mapPinNamesLocal).toEqual({ elsewhere: { s9: true } });
		});
	});

	it("writes nothing for a scene with no id", async () => {
		const store = useWorld({});
		await setLocalMapPinNames(null, false);
		expect(store.mapPinNamesLocal).toEqual({});
	});
});

describe("what one press of the button does", () => {
	it("quiets a map the world names", async () => {
		useWorld({ fallback: true });
		expect(await toggleLocalMapPinNames(scene("s1"))).toBe(false);
		expect(showMapPinNamesOn(scene("s1"))).toBe(false);
	});

	it("changes the map in ONE press even when the GM already had it on hover", async () => {
		// This is why the toggle flips the EFFECTIVE answer rather than a stored boolean. Storing
		// the opposite of the override would have written `false` over an absent key on a map
		// already painting hover-only, so the first press would have changed nothing on screen.
		useWorld({ fallback: true, perMap: { [VILLAGE.slug]: false } });
		const village = scene("s1", VILLAGE);
		expect(showMapPinNamesOn(village)).toBe(false);
		expect(await toggleLocalMapPinNames(village)).toBe(true);
		expect(showMapPinNamesOn(village)).toBe(true);
	});

	it("flips back on a second press", async () => {
		useWorld({ fallback: true });
		await toggleLocalMapPinNames(scene("s1"));
		expect(await toggleLocalMapPinNames(scene("s1"))).toBe(true);
		// And an explicit "yes" is still an override, so the tooltip keeps offering the way back.
		expect(localMapPinNameOverride(scene("s1"))).toBe(true);
	});
});

describe("what the button shows", () => {
	it("is not on screen at all on a map carrying none of our pins", () => {
		// A control that governs nothing is worse than no control.
		expect(mapPinNameToggleView({ hasPins: false, showing: true })).toEqual({ hidden: true });
	});

	it("states what IS, not what the click would do", () => {
		// The open eye means the names are here; the button is a toggle at rest.
		const named = mapPinNameToggleView({ hasPins: true, showing: true });
		expect(named.icon).toBe("fa-eye");
		expect(named.pressed).toBe(false);

		const quiet = mapPinNameToggleView({ hasPins: true, showing: false });
		expect(quiet.icon).toBe("fa-eye-slash");
		expect(quiet.pressed).toBe(true);
	});

	it("names the action it would take, for anyone reading it by ear", () => {
		expect(mapPinNameToggleView({ hasPins: true, showing: true }).label)
			.toBe(game.i18n.localize("stonetop.mapPinNames.hideLabel"));
		expect(mapPinNameToggleView({ hasPins: true, showing: false }).label)
			.toBe(game.i18n.localize("stonetop.mapPinNames.showLabel"));
	});

	it("offers the way back only once there is something to go back from", () => {
		const hint = game.i18n.localize("stonetop.mapPinNames.followHint");
		expect(mapPinNameToggleView({ hasPins: true, showing: true, overridden: false }).tooltip)
			.not.toContain(hint);
		expect(mapPinNameToggleView({ hasPins: true, showing: false, overridden: true }).tooltip)
			.toContain(hint);
	});
});

describe("a site pin, which the world setting does not govern", () => {
	// A site keeps its name whatever the GM has configured, because a GM places a handful of them
	// on their own prep and an unnamed one is an anonymous blob. But a reader pressing the button
	// with that map in front of them is a different act, and if a site ignored that too, the
	// button would do nothing at all on a scene carrying only site pins.
	const fakeNote = (src, sceneDoc) => ({
		document: { texture: { src }, parent: sceneDoc },
		hover: false,
		children: [],
		tooltip: { visible: false, style: null, width: 120, height: 40, position: { x: 0, y: 52 }, anchor: { x: 0.5, y: 0 } },
		_getTextStyle: () => ({ fill: "#1b1009", stroke: 0xFFFFFF, strokeThickness: 4 }),
		_refreshTooltip() { this.tooltip.style = this._getTextStyle(); },
		_refreshState() { this.tooltip.visible = this.hover; },
		getChildIndex: () => 0,
		addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; },
	});

	let _pixi;
	beforeEach(() => {
		_pixi = globalThis.PIXI;
		globalThis.PIXI = {
			Graphics: class {
				constructor() { this.destroyed = false; this.parent = null; this.visible = true; }
				clear() { return this; }
				beginFill() { return this; }
				drawRoundedRect() { return this; }
				endFill() { return this; }
			},
		};
	});
	afterEach(() => { globalThis.PIXI = _pixi; });

	it("keeps its name when the WORLD asks for hover only", () => {
		useWorld({ fallback: false });
		const note = fakeNote(SITE_PIN, scene("s1"));
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});

	it("goes quiet when THIS READER asks for hover only on this map", () => {
		useWorld({ fallback: true, local: { stonetop: { s1: false } } });
		const note = fakeNote(SITE_PIN, scene("s1"));
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(false);
		// And it is core's own hover behaviour underneath, not a name that is gone for good.
		note.hover = true;
		note._refreshState();
		expect(note.tooltip.visible).toBe(true);
	});

	it("still wears its name when the reader has asked for names on this map", () => {
		useWorld({ fallback: false, local: { stonetop: { s1: true } } });
		const note = fakeNote(SITE_PIN, scene("s1"));
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});

	it("carries a place marker with it, since one button governs the whole map", () => {
		useWorld({ fallback: true, local: { stonetop: { s1: false } } });
		const note = fakeNote(MARKER, scene("s1"));
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(false);
	});
});
