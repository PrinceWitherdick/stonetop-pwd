import { isStonetopMapNote } from "./StonetopNoteLabels.js";
import {
	MAP_PIN_NAME_SETTINGS, localMapPinNameOverride, setLocalMapPinNames, showMapPinNamesOn,
	toggleLocalMapPinNames,
} from "../settings.js";
import { SYSTEM_ID } from "../system-id.js";
import { localize } from "../utils/i18n.js";

// The eye beside the sidebar: quiet this map's place names, or bring them back.
//
// WHAT IT IS FOR. Whether a Stonetop map pin wears its name or waits for the cursor is already a
// world setting with a per-poster-map override (settings.js), but both of those are a GM sitting
// in a settings window deciding for the table. The moment that is actually worth deciding is the
// one where a wall of names is between you and the artwork you are trying to look at — and at
// that moment the settings window is three clicks and a scene away, and for a player it is not
// reachable at all, because only a GM may write a world setting. So this is the third and
// narrowest answer to the same question: one button, on screen, about the map on screen, writing
// nothing anyone else can see.
//
// WHERE IT SITS, and why that needs no positioning maths. Foundry's `#ui-right` is a flex ROW
// holding `#ui-right-column-1` (the chat notification stack) and then the sidebar itself. Slot a
// button in between the two and it lands hard against the sidebar's left edge, top-aligned — and
// because it is a flex SIBLING rather than something positioned against a measured edge, it
// tracks the sidebar for free: collapse the sidebar and core shrinks that element, and the
// button slides right along with it, transition and all. Nothing here listens for a collapse.
//
// WHAT IT WRITES. `mapPinNamesLocal`, a client setting keyed by scene id — see the note on its
// registration. It flips the EFFECTIVE answer rather than a stored boolean, so one press always
// changes the map, whatever the GM has configured for it. Right-clicking clears the override and
// hands the scene back to the GM's configuration, which is the only way back to "follow": with
// two states and a left click alone, a reader who pressed it once could never stop overriding.
//
// WHY IT HIDES ITSELF. A button that does nothing is worse than no button, and on a scene with no
// pins of ours there is nothing for it to do. `n.visible` is the per-user test the threat board
// already uses for this: a player who cannot see the GM's threat pins does not get an eye that
// governs them.

/** The button's element id, and the hook-registration latch's namespace. */
export const PIN_NAME_TOGGLE_ID = "stonetop-map-pin-names";

// The settings that can change what the button should be showing, IMPORTED from the module that
// registers them so there is one list rather than two that must be kept in step. Matched against
// the SUFFIX of the changed key, because the two hooks below name a setting differently: the
// world one hands over a Setting document whose `key` is the full `<namespace>.<key>`, and the
// client one hands over that same string as a bare argument.
const _PIN_NAME_KEYS = MAP_PIN_NAME_SETTINGS;

let _installed = false;
let _refreshQueued = false;

/**
 * What the button should look like and say, from three facts and nothing else.
 *
 * Pure, and takes its facts as arguments rather than reading the canvas, so the states can be
 * checked without a DOM or a scene: this project's suite runs on the `node` environment.
 *
 * `hidden` short-circuits the rest: there is no meaningful icon or label for a button that is not
 * on screen, and building one would invite a caller to paint it anyway.
 */
export function mapPinNameToggleView({ hasPins = false, showing = true, overridden = false } = {}) {
	if (!hasPins) return { hidden: true };
	const key = showing ? "hide" : "show";
	const tip = [localize(`stonetop.mapPinNames.${key}Tooltip`)];
	// Only once they HAVE overridden, because until then there is nothing to hand back and the
	// sentence would be describing a state they have never been in.
	if (overridden) tip.push(localize("stonetop.mapPinNames.followHint"));
	return {
		hidden: false,
		showing,
		overridden,
		// fa-eye reads as "the names are here"; fa-eye-slash as "hidden". The icon states WHAT IS,
		// not what the click will do — the same convention core's own visibility toggles use, and
		// the tooltip carries the action.
		icon: showing ? "fa-eye" : "fa-eye-slash",
		// A toggle button, so `aria-pressed`, and PRESSED means quieted: the button's un-pressed
		// resting state is the map as it comes.
		pressed: !showing,
		label: localize(`stonetop.mapPinNames.${key}Label`),
		tooltip: tip.join(" "),
	};
}

/** Our own pins on the scene being viewed, as THIS user can see them. */
function _ourVisibleNotes() {
	const placeables = globalThis.canvas?.notes?.placeables ?? [];
	// `n.visible` is the pin's per-user visibility, the same test threats/threat-board.js makes:
	// threat and hazard pins are GM-only prep, so a player never sees one and never gets an eye
	// offered for a map that holds nothing else of ours.
	return placeables.filter(n => n?.visible && isStonetopMapNote(n.document));
}

/** The view for the scene on screen right now. */
export function currentMapPinNameToggleView() {
	const scene = globalThis.canvas?.scene ?? null;
	if (!scene) return { hidden: true };
	return mapPinNameToggleView({
		hasPins: _ourVisibleNotes().length > 0,
		showing: showMapPinNamesOn(scene),
		overridden: typeof localMapPinNameOverride(scene) === "boolean",
	});
}

/** Build the button and slot it between the chat column and the sidebar. Idempotent. */
function _mount() {
	const existing = document.getElementById(PIN_NAME_TOGGLE_ID);
	if (existing?.isConnected) return existing;
	const right = document.getElementById("ui-right");
	if (!right) return null;

	const button = document.createElement("button");
	button.type = "button";
	button.id = PIN_NAME_TOGGLE_ID;
	// CORE'S OWN CONTROL CLASS, plus ours for the handful of things it does not say. `ui-control`
	// is what every button in the interface chrome wears: it carries the 32px square, the light
	// and dark palettes, the `pointer-events: all` this row would otherwise deny it, and an
	// `[aria-pressed="true"]` state we are already setting. A bespoke parchment button would have
	// had to reinvent all of that and would still have read as a foreign object beside the
	// sidebar. Our stylesheet only re-points its active colour to the system slate.
	button.className = "ui-control stonetop-map-pin-names";
	// The icon on a CHILD `<i>`, never on the button itself. Font Awesome draws the glyph from an
	// inherited `::before`, and this system sets `font-family` on `button` — put the fa class on
	// the button and the glyph renders as a raw codepoint box.
	const icon = document.createElement("i");
	icon.className = "fa-solid fa-eye";
	button.append(icon);
	button.addEventListener("click", _onClick);
	button.addEventListener("contextmenu", _onClearOverride);

	// BEFORE the sidebar, which is what puts it against the sidebar's left edge and makes it
	// follow the collapse. If core ever moves the sidebar out of this row, appending still leaves
	// a usable button at the right of the interface rather than none at all.
	const sidebar = document.getElementById("sidebar");
	if (sidebar?.parentElement === right) right.insertBefore(button, sidebar);
	else right.append(button);
	return button;
}

/** Restate the mounted button from the current scene. Safe to call when nothing is mounted. */
export function refreshMapPinNameToggle() {
	const button = document.getElementById(PIN_NAME_TOGGLE_ID);
	if (!button) return;
	const view = currentMapPinNameToggleView();
	button.hidden = !!view.hidden;
	if (view.hidden) return;
	const icon = button.querySelector("i");
	if (icon) icon.className = `fa-solid ${view.icon}`;
	button.classList.toggle("is-quiet", !view.showing);
	button.classList.toggle("is-overridden", !!view.overridden);
	button.setAttribute("aria-pressed", String(view.pressed));
	button.setAttribute("aria-label", view.label);
	// `data-tooltip` is core's, so the hover reads like every other control in the interface.
	button.dataset.tooltip = view.tooltip;
}

/** Coalesce a burst (a multi-note paste, a scene swap) into one restate next microtask. */
function _schedule() {
	if (_refreshQueued) return;
	_refreshQueued = true;
	Promise.resolve()
		.then(() => { _refreshQueued = false; refreshMapPinNameToggle(); })
		// The latch clears before the work, so a throw cannot wedge the button — but without this
		// it would surface as an unhandled rejection with no hint that a note edit caused it.
		.catch(err => console.error("Stonetop | map pin name toggle refresh failed", err));
}

/** Left click: flip what this reader sees on this scene. */
async function _onClick(event) {
	event.preventDefault();
	const scene = globalThis.canvas?.scene ?? null;
	if (!scene) return;
	await toggleLocalMapPinNames(scene);
	// Restated here as well as from the setting hook because the write is this client's own: the
	// hook is the backstop for a change made somewhere else (the settings menu, another tab), and
	// waiting on it would leave the button a frame behind the map it just changed.
	refreshMapPinNameToggle();
}

/** Right click: drop this reader's override and follow the GM's configuration again. */
async function _onClearOverride(event) {
	event.preventDefault();
	// Core's own context menu would otherwise open over the interface on a right click here.
	event.stopPropagation();
	const scene = globalThis.canvas?.scene ?? null;
	if (!scene) return;
	// Nothing to clear is not an error, and saying so is better than a silent no-op on a button
	// whose tooltip only mentions the right click once there IS something to undo.
	if (typeof localMapPinNameOverride(scene) !== "boolean") return;
	await setLocalMapPinNames(scene, null);
	refreshMapPinNameToggle();
	ui.notifications?.info(localize("stonetop.mapPinNames.followed"));
}

/** True when a changed setting key is one of the three the button reflects. */
function _isPinNameKey(key) {
	const name = String(key ?? "").split(".").pop();
	return _PIN_NAME_KEYS.includes(name) && String(key ?? "").startsWith(`${SYSTEM_ID}.`);
}

/**
 * Mount the button and keep it in step. Idempotent, and called once from the `ready` hook.
 *
 * `canvasReady` is what carries a scene change: the effective answer is per scene, so the button
 * has to restate whenever the map under it changes — and it is also the first moment the notes
 * layer has placeables to count, which is what decides whether the button shows at all.
 */
export function installMapPinNameToggle() {
	if (_installed) return;
	_installed = true;

	Hooks.on("canvasReady", () => { _mount(); _schedule(); });
	// A pin arriving or leaving can be the first or the last of ours on this scene, which is the
	// difference between the button being there and not.
	for (const hook of ["createNote", "updateNote", "deleteNote"]) Hooks.on(hook, () => _schedule());
	// The two world settings, changed by a GM in the settings menu, on this client or another.
	// BOTH hooks, and this is not belt and braces: a world setting is a Document, so the FIRST
	// save in a world creates it and announces only `createSetting`. Listening for updates alone
	// would leave the button stale on exactly the occasion a GM is most likely to be watching it.
	for (const hook of ["createSetting", "updateSetting"]) {
		Hooks.on(hook, (setting) => { if (_isPinNameKey(setting?.key)) _schedule(); });
	}
	// And the client one, which core announces by key rather than by document.
	Hooks.on("clientSettingChanged", (key) => { if (_isPinNameKey(key)) _schedule(); });

	_mount();
	refreshMapPinNameToggle();
}
