// System convention: an actor sheet reopens at the size its user last left it.
//
// `withSheetSizeMemory(Base)` is the whole protocol — restore on construction, debounced save
// when the user finishes a resize drag, immediate save on close. Every sheet that wants it wraps
// its own Base with it (`class X extends withSheetSizeMemory(Base)`), which fits the
// `createStonetop*SheetClass(Base)` factory shape all four actor sheets already use.
//
// Only a size the USER chose is ever written. That is the whole reason the save hangs off
// `_onResize` and a `_stonetopUserSized` latch rather than off `setPosition`: see the mixin.
//
// The three underlying steps stay exported so they can be exercised directly in tests. A sheet
// that needs more than the default does NOT call them: it reads `_restoredSheetSize`, which is
// what the monster does to retire its one-shot initial sizing.

import { getSheetSize, setSheetSize } from "../settings.js";

/** How long to wait out a resize drag before writing. A client set round-trips the server. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Apply the remembered size to a sheet that is being constructed.
 *
 * @param {Application} app  The sheet, before its first render.
 * @returns {{width: number|null, height: number|null}} What was restored, so a caller can
 *   react — the monster sheet uses the height to suppress its own one-shot initial sizing.
 */
export function restoreSheetSize(app) {
	const stored = getSheetSize(app?.actor?.id);

	if (stored.width) {
		app.options.width = stored.width;
		app.position.width = stored.width;
	}

	if (stored.height) {
		app.options.height = stored.height;
		app.position.height = stored.height;
		// Load-bearing for an auto-height sheet (the NPC), and harmless for the rest.
		//
		// Core's setPosition treats `options.height === "auto"` as a standing instruction:
		// on EVERY call it blanks the inline height and refits to content. Writing a number
		// into options.height above is what stops that — but the sheet's own refits pass the
		// string ("auto") explicitly, and that branch fires on the argument too. So the
		// restored height would survive construction and then be thrown away by the first
		// refit that ran.
		//
		// `_stonetopHeightLocked` is enableAutoHeightVerticalResize's flag for "the user owns
		// this height now" (module/utils/resizable-dialogs.js); it strips `height: "auto"`
		// out of later setPosition calls. Setting it here is not a trick — a restored height
		// IS a height the user chose, just in an earlier session.
		app._stonetopHeightLocked = true;
	}

	return stored;
}

/**
 * Take a window's ONE opening measurement, after the frame has actually painted, and never again.
 *
 * The MEASUREMENT is each sheet's own — the NPC asks core to refit and reads the number back, the
 * monster measures down to where its Notes should fall — but the guards around it are subtle,
 * identical, and were written out twice:
 *
 *  - once per sheet, latched on a flag the constructor may have pre-raised because
 *    `restoreSheetSize` already had a remembered height (a size the user chose outranks anything
 *    measured here);
 *  - after a paint, because the header work each sheet does during `_render` changes the very
 *    height being measured;
 *  - never while MINIMIZED, because a minimized frame measures as its title bar and adopting THAT
 *    reopens the sheet as a sliver. Core skips its own end-of-render setPosition for this reason.
 *
 * @param {Application} app
 * @param {string} flag  instance property latching this to once per sheet.
 * @param {Function} size  measures and applies. Return `false` when there was nothing real to
 *   measure, which leaves the latch open for a later render to try again.
 */
export function sizeOnceOnOpen(app, flag, size) {
	if (app[flag] || !app.element?.[0]) return;
	requestAnimationFrame(() => {
		if (app[flag] || app._minimized || !app.element?.[0]) return;
		if (size() !== false) app[flag] = true;
	});
}

/** Queue a save. Safe to call on every resize frame; only the last one in a burst writes. */
export function scheduleSheetSizeSave(app) {
	clearTimeout(app._sizeSaveTimer);
	app._sizeSaveTimer = setTimeout(() => persistSheetSize(app), SAVE_DEBOUNCE_MS);
}

/**
 * Give a sheet class the remember-my-size behaviour.
 *
 * Wrap the Base a sheet factory was handed:
 *
 *     return class StonetopThingSheet extends withSheetSizeMemory(Base) { … }
 *
 * A subclass that overrides `close` keeps working without doing anything — its `super.close()`
 * lands here, which persists and then continues up the chain.
 */
export function withSheetSizeMemory(Base) {
	return class SheetSizeMemory extends Base {
		/** What `restoreSheetSize` found, for a subclass that needs to react to it. */
		_restoredSheetSize = { width: null, height: null };

		/**
		 * Has the user dragged this window's resize handle in THIS session? Nothing is written
		 * until they have, which is the difference between remembering a choice and freezing a
		 * default.
		 *
		 * This cannot be inferred from `setPosition`. Core ends every `_render` with
		 * `this.setPosition(this.position)` (appv1/api/application-v1.mjs), and `this.position`
		 * always carries a width and a height — so keying off "a dimension was in the call"
		 * fires on plain renders. Worse, `setPosition` never leaves a height as the string
		 * "auto": it computes `el.offsetHeight + 1` and clamps that into `position.height`. So
		 * an untouched auto-height sheet (the NPC) would store its own measured height on first
		 * open, restore it on the next, and never fit its content again; a fixed-height one
		 * would store `defaultOptions.height`, pinning every existing user to whatever that was
		 * the day they first opened the sheet.
		 */
		_stonetopUserSized = false;

		constructor(...args) {
			super(...args);
			this._restoredSheetSize = restoreSheetSize(this);
		}

		/**
		 * Core's one unambiguous "the user finished resizing" signal: `Draggable#_onResizeMouseUp`
		 * calls it, and nothing else does (applications/ux/draggable.mjs). Debounced rather than
		 * written straight out so a flurry of small drags coalesces into one client set.
		 */
		_onResize(event) {
			super._onResize?.(event);
			this._stonetopUserSized = true;
			scheduleSheetSizeSave(this);
		}

		async close(options) {
			// Immediately, to catch a resize-then-close inside the debounce window. Still gated:
			// a sheet nobody resized has nothing worth recording, and `position` on close is
			// core's own measurement, not a choice.
			if (this._stonetopUserSized) persistSheetSize(this);
			else clearTimeout(this._sizeSaveTimer);
			return super.close(options);
		}
	};
}

/**
 * Write the sheet's current size now.
 *
 * Callers are responsible for only calling this for a size the user chose (the mixin's
 * `_stonetopUserSized` latch) — this writes whatever `position` currently reads.
 *
 * Each dimension is offered only if it passes its own floor, and setSheetSize keeps the two
 * independently — so a frame that reads junk for one (a minimized window, or a height still
 * the string "auto" because `setPosition` has not run yet) cannot overwrite a good value for
 * the other.
 */
export function persistSheetSize(app) {
	if (!app) return;
	// Drop any queued save: this call supersedes it, and a timer left armed on a closing sheet
	// keeps the sheet — and the DOM it references — alive for the rest of the debounce window.
	clearTimeout(app._sizeSaveTimer);
	if (app._minimized) return;
	const { width, height } = app.position ?? {};
	setSheetSize(app.actor?.id, {
		width:  Number.isFinite(width)  && width  >= (app.options?.minWidth  ?? 0) ? width  : null,
		height: Number.isFinite(height) && height >= (app.options?.minHeight ?? 0) ? height : null,
	});
}
