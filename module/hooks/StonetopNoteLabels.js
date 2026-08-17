import { systemAssetVariants } from "../migration/compat.js";
import { LANDMARK_ICON_SUFFIX } from "./PlaceOfInterestDrop.js";
import { THREAT_PIN_ICON_SUFFIX } from "./ThreatNotePins.js";
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
const _OUR_NOTE_ICONS = [
	...systemAssetVariants(`${LANDMARK_ICON_SUFFIX}/`), // Place-of-Interest lettered discs
	...systemAssetVariants(THREAT_PIN_ICON_SUFFIX),     // threat, hazard + site pins
];

const _LABEL_TEXT_COLOR = "#f7efdc"; // warm cream, reads on the dark pill
const _LABEL_STROKE_COLOR = 0x1b1009; // faint ink edge keeps letters crisp on light patches
const _PILL_COLOR = 0x000000;
const _PILL_ALPHA = 0.55; // see-through: darkens the clutter without hiding the map
const _PILL_RADIUS = 10;
const _PILL_PAD_X = 16;
const _PILL_PAD_Y = 6;

/** True when this note is one of ours, judged by its icon texture. */
function _isStonetopMapNote(noteDoc) {
	const src = noteDoc?.texture?.src;
	if (!src) return false;
	return _OUR_NOTE_ICONS.some((prefix) => src.includes(prefix));
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
	if (!_isStonetopMapNote(note.document)) return;

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
			const bg = this._stonetopLabelBg;
			if (bg && !bg.destroyed) bg.visible = this.tooltip?.visible ?? false;
		};

		note._stonetopLabelStyled = true;
	}

	// Apply now and on every redraw: the first draw built the tooltip with core's style. Guard
	// against a note that has no tooltip (core normally builds one in _draw, but a null here
	// would throw and break the whole drawNote hook); _redrawPill no-ops on a missing tooltip.
	if (note.tooltip) note.tooltip.style = note._getTextStyle();
	_redrawPill(note);
}
