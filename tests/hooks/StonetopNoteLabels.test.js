import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { onDrawStonetopNote } from "../../module/hooks/StonetopNoteLabels.js";
import { PLACE_MARKER_ICON_SUFFIX } from "../../module/utils/map-pins.js";
import { applyMapPinLabelMode } from "../../module/settings.js";
import { POSTER_MAPS } from "../../module/book2-art/poster-map-catalog.js";

// The label treatment our map pins get over core's: cream text on a translucent pill, and — for
// the regional maps' place markers only — a name that stands on the map instead of waiting for
// the cursor. Core decides tooltip visibility in Note#_refreshState and recomputes it on every
// interaction, so "set it once at draw time" is not a fix; the wrapper has to win every pass.

const MARKER = `systems/stonetop-pwd/${PLACE_MARKER_ICON_SUFFIX}`;
const DISC = "systems/stonetop-pwd/assets/icons/landmarks/landmark-c.svg";
const THEIRS = "icons/svg/book.svg";

// Saved and restored rather than assigned: vitest shares a worker across test files, and a
// stray PIXI on the global would change what an unrelated suite is testing.
let _pixi;
beforeEach(() => {
	_pixi = globalThis.PIXI;
	globalThis.PIXI = {
		Graphics: class {
			constructor() {
				this.destroyed = false;
				this.parent = null;
				this.visible = true;
				this.drawn = [];
			}
			clear() { this.drawn = []; return this; }
			beginFill(color, alpha) { this.drawn.push({ color, alpha }); return this; }
			drawRoundedRect(...args) { this.rect = args; return this; }
			endFill() { return this; }
		},
	};
});
afterEach(() => { globalThis.PIXI = _pixi; });

/**
 * A stand-in for a drawn Note, with core's own tooltip rule in `_refreshState` (note.mjs:230)
 * so the test is measuring what our wrapper does to core rather than to a convenient fiction.
 */
function fakeNote(src, { tooltip = true, scene = null } = {}) {
	const note = {
		// `parent` is the Scene a Note document belongs to, which is what decides whether this
		// pin's map has an answer of its own about names.
		document: { texture: { src }, parent: scene },
		hover: false,
		children: [],
		tooltip: tooltip
			? { visible: false, style: null, width: 120, height: 40, position: { x: 0, y: 52 }, anchor: { x: 0.5, y: 0 } }
			: null,
		_getTextStyle: () => ({ fill: "#1b1009", stroke: 0xFFFFFF, strokeThickness: 4 }),
		_refreshTooltip() { this.tooltip.style = this._getTextStyle(); },
		// Core's own line (note.mjs:232), unguarded exactly as core writes it.
		_refreshState() { this.tooltip.visible = this.hover; },
		getChildIndex: () => 0,
		addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; },
	};
	if (note.tooltip) note.children.push(note.tooltip);
	return note;
}

describe("the pill and the cream ink", () => {
	it("restyles a pin of ours and leaves everyone else's notes alone", () => {
		const ours = fakeNote(DISC);
		onDrawStonetopNote(ours);
		expect(ours.tooltip.style.fill).toBe("#f7efdc");
		expect(ours._stonetopLabelBg).toBeTruthy();

		const theirs = fakeNote(THEIRS);
		onDrawStonetopNote(theirs);
		expect(theirs.tooltip.style).toBe(null);
		expect(theirs._stonetopLabelBg).toBeUndefined();
	});

	it("keeps the cream fill across core recomputing the style", () => {
		// Core rebuilds the style on every tooltip refresh, so shadowing the instance method is
		// the only thing that survives; mutating the drawn style once would be undone here.
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		note._refreshTooltip();
		expect(note.tooltip.style.fill).toBe("#f7efdc");
	});
});

describe("a marker's name stands on the map", () => {
	it("shows the label with the cursor nowhere near it", () => {
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});

	it("wins every state pass, not just the first", () => {
		// The failure this pins: core sets tooltip.visible from `this.hover` on every hover in
		// and out, so a name set true at draw time goes dark the first time the cursor visits a
		// neighbouring pin and leaves again.
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		note.hover = true;
		note._refreshState();
		expect(note.tooltip.visible).toBe(true);
		note.hover = false;
		note._refreshState();
		expect(note.tooltip.visible).toBe(true);
	});

	it("takes the pill with it, rather than leaving the name unbacked", () => {
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		note._refreshState();
		expect(note._stonetopLabelBg.visible).toBe(true);
	});

	it("names the lettered discs too, since the switch is over all our pins", () => {
		// One switch, not one per family. They already share the pill and the ink and differ only
		// in when the name shows, so splitting the decision would be splitting one preference.
		const note = fakeNote(DISC);
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});

	it("shows a name with no settings registered at all", () => {
		// This runs inside a PIXI refresh, which a Scene painted during startup can reach before
		// the settings exist. The harmless answer there is the shipped default, not a quiet map.
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});
});

describe("when the world asks for names on hover only", () => {
	let _game;
	beforeEach(() => {
		_game = globalThis.game;
		globalThis.game = { settings: { get: (_scope, key) => key !== "alwaysShowMapPinNames" } };
	});
	afterEach(() => { globalThis.game = _game; });

	it("hands every pin back to core's own hover behaviour", () => {
		// Off needs no counterpart in the wrapper: core has just set tooltip.visible from the
		// cursor, so declining to override IS hover. Both families, since it is one switch.
		for (const src of [MARKER, DISC]) {
			const note = fakeNote(src);
			onDrawStonetopNote(note);
			expect(note.tooltip.visible, src).toBe(false);
			note.hover = true;
			note._refreshState();
			expect(note.tooltip.visible, src).toBe(true);
			note.hover = false;
			note._refreshState();
			expect(note.tooltip.visible, src).toBe(false);
		}
	});

	it("keeps the pill and the cream ink, which are not what the switch is about", () => {
		// The switch is WHEN a name shows. A name that does show still has to be legible over
		// hand-drawn line art, which is this module's other and older job.
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		note.hover = true;
		note._refreshState();
		note._refreshTooltip();
		expect(note.tooltip.style.fill).toBe("#f7efdc");
		expect(note._stonetopLabelBg.visible).toBe(true);
	});

	it("takes the pill down with the name", () => {
		const note = fakeNote(MARKER);
		onDrawStonetopNote(note);
		note._refreshState();
		expect(note._stonetopLabelBg.visible).toBe(false);
	});

	it("survives drawing a note that has no tooltip", () => {
		// The hook runs for EVERY note on every scene, so a throw here is not one bad pin: it
		// aborts drawNote for whatever was still to be drawn. Only the draw is claimed. Core's
		// own _refreshState dereferences the tooltip unguarded, so a tooltip-less note has
		// already thrown inside core before any wrapper of ours could be reached, and pretending
		// otherwise would only be testing the stand-in.
		const note = fakeNote(MARKER, { tooltip: false });
		expect(() => onDrawStonetopNote(note)).not.toThrow();
		expect(note._stonetopLabelStyled).toBe(true);
	});
});

describe("when one map has asked for names on hover only", () => {
	// The switch is per map, so a world can carry both answers at once: the Vicinity wall-to-wall
	// with the names the poster printing left out, the village map quiet under its lettered discs.
	// What decides is the scene the pin is painted on, not the scene being looked at.
	const VILLAGE = POSTER_MAPS[0];
	const VICINITY = POSTER_MAPS[1];
	const sceneFor = map => ({ name: map.name, flags: { "stonetop-pwd": { posterMap: map.slug } } });

	let _game;
	beforeEach(() => {
		_game = globalThis.game;
		globalThis.game = {
			settings: {
				get: (_scope, key) => key === "alwaysShowMapPinNames" ? true : { [VILLAGE.slug]: false },
			},
		};
		applyMapPinLabelMode();
	});
	afterEach(() => { globalThis.game = _game; applyMapPinLabelMode(); });

	it("hands that map's pins back to hover and leaves the others named", () => {
		const quiet = fakeNote(MARKER, { scene: sceneFor(VILLAGE) });
		onDrawStonetopNote(quiet);
		expect(quiet.tooltip.visible).toBe(false);
		quiet.hover = true;
		quiet._refreshState();
		expect(quiet.tooltip.visible).toBe(true);

		const named = fakeNote(MARKER, { scene: sceneFor(VICINITY) });
		onDrawStonetopNote(named);
		expect(named.tooltip.visible).toBe(true);
	});

	it("asks about the pin's OWN scene, not the one on screen", () => {
		// A note is drawn as part of the scene it belongs to; `canvas.scene` is whatever is being
		// viewed. Reading the canvas would answer for the wrong map every time the two differ.
		const _canvas = globalThis.canvas;
		globalThis.canvas = { scene: sceneFor(VILLAGE) };
		try {
			const note = fakeNote(MARKER, { scene: sceneFor(VICINITY) });
			onDrawStonetopNote(note);
			expect(note.tooltip.visible).toBe(true);
		} finally { globalThis.canvas = _canvas; }
	});

	it("leaves a scene of the GM's own following the world setting", () => {
		const note = fakeNote(MARKER, { scene: { name: "The Barrow Under the Hill", flags: {} } });
		onDrawStonetopNote(note);
		expect(note.tooltip.visible).toBe(true);
	});
});
