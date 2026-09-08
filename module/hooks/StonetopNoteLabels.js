import { systemAssetVariants } from "../migration/compat.js";
import { localMapPinNameOverride, showMapPinNamesOn } from "../settings.js";
import { LANDMARK_ICON_SUFFIX } from "./PlaceOfInterestDrop.js";
import { SITE_PIN_ICON_SUFFIX, THREAT_PIN_ICON_SUFFIX } from "../journal/gm-prep-page.js";
// Make Stonetop map-note labels legible over busy hand-drawn maps.
//
// Our lettered Place-of-Interest discs and GM-prep pins (threats, hazards, sites) label
// themselves on hover.
// Core Foundry (Note#_getTextStyle) only gives the name a thin 4px outline, so on the
// illustrated Stonetop maps a name like "The Granary" sinks into the surrounding line art
// and is hard to read.
//
// The fix is the classic map/subtitle treatment: a translucent black "pill" behind the
// label with light (cream) text on top, so the name reads no matter what it sits over.
// Two seams over core, both scoped to our notes and surviving every refresh:
//   1. Shadow the instance's _getTextStyle so the label paints in cream (dark ink would
//      vanish on the pill). Core recomputes the style on every refresh, so we wrap the
//      instance method rather than mutating the drawn style once.
//   2. Add a PIXI.Graphics pill behind the tooltip, redrawn to the tooltip's bounds in a
//      wrapped _refreshTooltip and shown/hidden with it in a wrapped _refreshState.
//
// We claim a note by its icon path rather than a flag, so notes already placed in a world
// (like the user's existing Granary pin) are restyled immediately, with no data migration.

// Icon families we own; any note textured from one of these gets the pill treatment.
// The suffixes come from the modules that WRITE these notes, under every system id this
// package has shipped under, so neither a path change nor an id rename can desync them.
//
// `alwaysLabel` is a property OF THE FAMILY, which is why it is a column here rather than a
// named exception inside _showPermanentLabel: a fifth family arrives as one more row, and the
// roll-up every other test reads is derived from this list rather than kept beside it.
const _NOTE_FAMILIES = [
	// Place-of-Interest lettered discs
	{ icons: systemAssetVariants(`${LANDMARK_ICON_SUFFIX}/`), alwaysLabel: false },
	// threat + hazard pins
	{ icons: systemAssetVariants(THREAT_PIN_ICON_SUFFIX), alwaysLabel: false },
	// The GM's own sites, dropped on a scene. See _showPermanentLabel for why they never hide.
	{ icons: systemAssetVariants(SITE_PIN_ICON_SUFFIX), alwaysLabel: true },
];

const _OUR_NOTE_ICONS = _NOTE_FAMILIES.flatMap(family => family.icons);

// WHEN the label shows is a setting for every family that does not say otherwise above - the one
// that does is the GM's own site pins, whose reasoning is in _showPermanentLabel.
// Core shows a note's text only while the cursor is on it (Note#_refreshState), which is the
// right default for an annotation and the wrong one for a place name: the poster maps ship as
// the UNLABELLED printing of their artwork, so a reader who has to go hunting for each name
// with the mouse is reading a map with no names on it. So the setting ships ON.
//
// It governs every pin here rather than the place markers alone, because they already share
// everything else: the same pill, the same cream ink, one treatment. A GM who turns it off
// wants a quieter map, not a quieter half of one, and off is exactly core's own behaviour
// handed back. Nothing about the note document changes either way, so the switch is free to
// flip back and forth and costs a repaint.
//
// It is asked PER SCENE, though, and settings.js answers it: one world default, overridden per
// poster map. The two regional maps are wall-to-wall names once they are marked up and the two
// town maps are almost bare, so "names everywhere" and "names on hover" are genuinely different
// right answers for two maps in the same world. What decides is the scene the pin is painted
// on, which is why the scene is looked up here rather than the setting read directly.

const _LABEL_TEXT_COLOR = "#f7efdc"; // warm cream, reads on the dark pill
const _LABEL_STROKE_COLOR = 0x1b1009; // faint ink edge keeps letters crisp on light patches
const _PILL_COLOR = 0x000000;
const _PILL_ALPHA = 0.55; // see-through: darkens the clutter without hiding the map
const _PILL_RADIUS = 10;
const _PILL_PAD_X = 16;
const _PILL_PAD_Y = 6;

/**
 * True when this note is one of ours, judged by its icon texture.
 *
 * Exported because the eye button beside the sidebar (hooks/MapPinNameToggle.js) asks the same
 * question for a different reason: it only offers itself on a scene that actually carries our
 * pins, and "ours" has to mean here exactly what it means to the labelling below, or the button
 * would appear on maps it governs nothing on and hide on maps it does.
 */
export function isStonetopMapNote(noteDoc) {
	const src = noteDoc?.texture?.src;
	if (!src) return false;
	return _OUR_NOTE_ICONS.some((prefix) => src.includes(prefix));
}

/** The family a note belongs to, or null when it is not one of ours. */
function _noteFamily(noteDoc) {
	const src = noteDoc?.texture?.src;
	if (!src) return null;
	return _NOTE_FAMILIES.find((family) => family.icons.some((prefix) => src.includes(prefix))) ?? null;
}

/**
 * Show this note's label, unless this map has asked for names on hover only - and a site pin
 * wears its name whatever the map says.
 *
 * Which map that is comes off the note's OWN scene rather than off the canvas, because they are
 * not always the same one: a note is drawn as part of the scene it belongs to, and the canvas
 * getter answers whatever is being viewed. `canvas.scene` is the fallback for a stand-in note
 * with no parent behind it, and a null scene is a fine question to ask: it is no poster map, so
 * it lands on the world default, which is what any other scene gets too.
 *
 * Only ever turns a tooltip ON, and only for our own pins, so every other note on every scene
 * keeps core's hover behaviour untouched. Turning it off needs no counterpart here: core has
 * just recomputed `tooltip.visible` from the cursor, so declining to override IS the hover
 * behaviour. Forcing it is safe against all the ways a note is
 * meant to disappear, because none of them run through the tooltip: the note is a container
 * whose own visibility core sets from Note#isVisible (permission, fog, elevation), and the
 * Notes layer's display toggle hides the whole objects container wholesale. A hidden parent
 * hides this child whatever the child thinks of itself. What is overridden here is only the
 * last and narrowest of those gates, the one that asks where the mouse is.
 */
function _showPermanentLabel(note) {
	// OURS first, and deliberately: this runs per note per refresh pass — canvas draw and every
	// hover in and out — and it is an `includes` over a module constant, where the settings
	// question below has to find the note's poster map first. Most notes on most scenes are not
	// ours, and they now cost the cheap test alone.
	const doc = note?.document;
	const family = _noteFamily(doc);
	if (!family) return;
	// A SITE IS NOT SUBJECT TO THE SETTING. The setting exists because the poster maps carry
	// dozens of the book's own places and a wall of names is a fair thing to want quieter. A GM
	// places a HANDFUL of sites, on their own prep, and a mark whose name you have to go hunting
	// for with the mouse is not a label - it is an anonymous blob on somebody else's artwork. The
	// journey dialog's site pins already made this exact exception (expedition-journey-pins.hbs);
	// this is the same mark on the table's own map, so it answers the same way.
	//
	// IT IS SUBJECT TO THE READER'S OWN BUTTON, though, and the difference is the whole reason the
	// two are asked separately here. The exemption above is about a CONFIGURED default nobody set
	// with this scene in front of them; the eye beside the sidebar is someone looking at this map
	// and saying "quiet". If a site ignored that too, pressing the button on a scene carrying only
	// site pins would change nothing on screen and read as a broken control.
	const scene = doc?.parent ?? globalThis.canvas?.scene ?? null;
	if (family.alwaysLabel) {
		if (localMapPinNameOverride(scene) === false) return;
	} else if (!showMapPinNamesOn(scene)) return;
	if (note.tooltip) note.tooltip.visible = true;
}

/** Cream fill + thin ink edge; layered onto core's computed tooltip style, in place. */
function _labelTextStyle(style) {
	style.fill = _LABEL_TEXT_COLOR;
	style.stroke = _LABEL_STROKE_COLOR;
	style.strokeThickness = 2;
	style.lineJoin = "round";
	return style;
}

/** Get (re)the pill Graphics for a note, recreating it after a redraw destroys children. */
function _ensurePill(note) {
	let bg = note._stonetopLabelBg;
	if (bg && !bg.destroyed && bg.parent === note) return bg;
	bg = new PIXI.Graphics();
	bg.eventMode = "none";
	note._stonetopLabelBg = bg;
	// Insert right behind the tooltip so the pill sits under the text but over the map.
	const tip = note.tooltip;
	const idx = tip ? note.getChildIndex(tip) : note.children.length;
	note.addChildAt(bg, Math.max(0, idx));
	return bg;
}

/** Redraw the pill to the tooltip's current bounds/position and match its visibility. */
function _redrawPill(note) {
	const tip = note.tooltip;
	if (!tip) return;
	const bg = _ensurePill(note);
	bg.clear();
	// tooltip.width/height include the stroke; anchor shifts where the glyphs land
	// relative to tooltip.position, so back it out to find the text's top-left.
	const tw = tip.width;
	const th = tip.height;
	if (!tw || !th) {
		bg.visible = false;
		return;
	}
	const left = tip.position.x - tip.anchor.x * tw;
	const top = tip.position.y - tip.anchor.y * th;
	bg.beginFill(_PILL_COLOR, _PILL_ALPHA);
	bg.drawRoundedRect(left - _PILL_PAD_X, top - _PILL_PAD_Y, tw + 2 * _PILL_PAD_X, th + 2 * _PILL_PAD_Y, _PILL_RADIUS);
	bg.endFill();
	bg.visible = tip.visible;
}

/** drawNote hook: cream label on a translucent pill, glued to the tooltip across refreshes. */
export function onDrawStonetopNote(note) {
	if (!note) return;
	if (typeof note._getTextStyle !== "function") return;
	if (!isStonetopMapNote(note.document)) return;

	// Wrap the instance methods once; the pill graphic itself is (re)built below so it
	// survives a redraw (which destroys children but keeps these instance overrides).
	if (!note._stonetopLabelStyled) {
		const baseGetTextStyle = note._getTextStyle.bind(note);
		note._getTextStyle = function () {
			return _labelTextStyle(baseGetTextStyle());
		};

		const baseRefreshTooltip = note._refreshTooltip.bind(note);
		note._refreshTooltip = function () {
			baseRefreshTooltip();
			_redrawPill(this);
		};

		const baseRefreshState = note._refreshState.bind(note);
		note._refreshState = function () {
			baseRefreshState();
			// Ahead of the pill, which is only ever a backing for whatever the tooltip is
			// doing: core has just recomputed tooltip.visible from where the cursor is.
			_showPermanentLabel(this);
			const bg = this._stonetopLabelBg;
			if (bg && !bg.destroyed) bg.visible = this.tooltip?.visible ?? false;
		};

		note._stonetopLabelStyled = true;
	}

	// Apply now and on every redraw: the first draw built the tooltip with core's style. Guard
	// against a note that has no tooltip (core normally builds one in _draw, but a null here
	// would throw and break the whole drawNote hook); _redrawPill no-ops on a missing tooltip.
	if (note.tooltip) note.tooltip.style = note._getTextStyle();
	// Eagerly, for the same reason the style is applied eagerly: core draws the tooltip during
	// _draw and only settles its visibility on the next render flag pass, so a marker whose
	// scene is painted and then left alone would sit there nameless until something touched it.
	_showPermanentLabel(note);
	_redrawPill(note);
}
