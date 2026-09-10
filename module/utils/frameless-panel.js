// A WINDOW, MOUNTED INSIDE SOMEBODY ELSE'S SHEET.
//
// Two features do this -- the relationship map and the timeline -- and a third will. Each is a
// full AppV1 window that ALSO appears as a tab, and the whole of the difference between the two
// shapes is what is in here. Not a second implementation of the feature: the same class, the same
// template, the same getData, the same listeners, the same write path.
//
// A MIXIN AND NOT A BASE CLASS, because the two panels descend from two different windows. What is
// shared is the frameless BEHAVIOUR, not an ancestor.
//
// ⚠ ALL OF THIS IS APPV1 BEHAVIOUR WE ARE ASKING FOR, NOT DEFEATING. An Application with
// `popOut: false` already knows how to be a body without a frame:
//
//   • `_render` skips `_renderOuter`, so no window frame, no title bar, no header buttons;
//   • `_replaceHTML` does `element.replaceWith(html)`, so a re-render repaints in place in the tab;
//   • `setPosition` returns at its first line for an app that is neither popOut nor resizable;
//   • the app is never entered in `ui.windows`, and `minimize`/`maximize` are no-ops.
//
// ⚠ WHICH IS WHY `resizable` MUST BE SET FALSE AND NOT MERELY LEFT OUT. A window sets it true, and
// a non-popOut app with `resizable` true gets a `Draggable` bound to it by core
// (`if (!this.popOut && this.options.resizable)`) -- a drag handle on a tab body, moving nothing.
// It is also half of what makes `setPosition` return early.
//
// This was written twice before it was written once: the relationship map's panel solved it, and
// the timeline's copied it line for line, comments and all. The lore above is the reason it is
// worth having in one place -- every line of it is a bug somebody already had.

/**
 * Make a frameless, sheet-mounted variant of a window class.
 *
 * @param {Function} Base  The window class this panel is a mounted shape of.
 * @param {object} options
 * @param {string} options.panelClass  One extra CSS class naming this panel.
 * @returns {Function} A subclass of `Base` that paints into a host element instead of the page.
 */
export function FramelessPanel(Base, { panelClass } = {}) {
	return class extends Base {
		static get defaultOptions() {
			const base = super.defaultOptions;
			return foundry.utils.mergeObject(base, {
				// Both halves are load-bearing; see the head of this file.
				popOut: false,
				resizable: false,
				// `mergeObject` REPLACES an array rather than concatenating it, so the window's own
				// classes are spread back in by hand.
				classes: [...(base.classes ?? []), ...(panelClass ? [panelClass] : [])],
			});
		}

		/**
		 * Point the panel at the element it is to be painted into.
		 *
		 * Called on every render of the host sheet, because the sheet's own re-render throws its
		 * whole body away and builds a fresh mount. A panel painted into the host it was given
		 * three renders ago is painted into a node nothing is looking at.
		 */
		setHost(host) {
			this._host = host ?? null;
		}

		/**
		 * ⚠ THE ONE METHOD THAT HAS TO BE REPLACED. Core's version appends the body to
		 * `document.body` and fades it in, which for a frameless application is the only sensible
		 * default and is not what a tab wants.
		 *
		 * `replaceChildren` rather than `append`: a mount carries its feature's "nothing here yet"
		 * invitation until the panel lands, and a panel arriving BESIDE that invitation would say
		 * two things at once.
		 */
		_injectHTML(html) {
			const node = html?.[0];
			if (!node) return;
			this._host?.replaceChildren(node);
			this._element = html;
		}

		/**
		 * ⚠ NEVER RAISED, AND THIS IS NOT COSMETIC. `StonetopDialog._render` runs
		 * `FrontOnOpen.apply()` on every open, whose whole job is `bringToTop()`; core's
		 * implementation stamps a `z-index` on `this.element[0]` and sets `ui.activeWindow = this`.
		 * On a window that is exactly right. On a panel sitting inside a sheet it puts a stacking
		 * context on a grid child and tells the rest of Foundry that the active window is something
		 * with no frame, which is how the real window under the pointer stops being brought forward.
		 */
		bringToTop() {}

		/**
		 * ⚠ NEVER ANIMATED. Core closes a frameless application by `slideUp`-ing the element and
		 * then removing it, which on a tab body is the panel folding itself up over half a second
		 * and leaving a hole. There is nothing here to watch leave.
		 */
		async close(options = {}) {
			return super.close({ ...options, animate: false });
		}
	};
}
