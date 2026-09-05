/**
 * System convention: every window and modal should be drag-resizable.
 *
 * Our own Application subclasses set `resizable: true` in their `defaultOptions`,
 * and core actor/item/journal sheets are resizable by default. But the ad-hoc
 * `new Dialog(...)` / `Dialog.confirm(...)` / `Dialog.prompt(...)` popups we spawn
 * from sheets can't carry their own subclass, and AppV1's base `Dialog` defaults
 * to `resizable: false`. Rather than thread `{ resizable: true }` through every
 * call site — and silently miss every future one — we flip the legacy `Dialog`
 * class default once, at init.
 *
 * Foundry reads `options.resizable` while building the window frame
 * (`Application#_renderOuter` → `new Draggable(...)`), so overriding the static
 * `defaultOptions` getter is enough for the resize handle to be wired up at
 * render time. Call sites that explicitly pass `resizable: false` still win.
 *
 * Idempotent: a marker flag guards against double-wrapping on re-init.
 */
export function makeDialogsResizable() {
	// V13+ exposes the classic Dialog under foundry.appv1; V12 only has the global.
	const DialogClass = foundry?.appv1?.api?.Dialog ?? globalThis.Dialog;
	if (!DialogClass || DialogClass._stonetopResizableDefault) return;

	const baseGetter = Object.getOwnPropertyDescriptor(DialogClass, "defaultOptions")?.get;
	if (!baseGetter) return;

	Object.defineProperty(DialogClass, "defaultOptions", {
		configurable: true,
		get() {
			return foundry.utils.mergeObject(baseGetter.call(this), { resizable: true });
		},
	});
	DialogClass._stonetopResizableDefault = true;
}

/**
 * System convention: a window whose `height` option is `"auto"` must still be
 * draggable taller/shorter by its resize handle, like a fixed-height one.
 *
 * Core's `Application#setPosition` (appv1/api/application-v1.mjs) treats
 * `options.height === "auto"` as a *permanent* override: on every call it blanks
 * `el.style.height` and refits the window to its content height, discarding the
 * pixel height the resize drag asked for. So auto-height windows resize fine
 * horizontally (width is a real number) but snap straight back vertically — which
 * is most of our modals, since they default to `height: "auto"` to fit content.
 *
 * The resize drag is the one caller that passes a bare `{ width?, height? }` with
 * a finite numeric height and no `left`/`top`: every internal reflow passes the
 * full `this.position` (with `left`/`top`) or no args, and the steppers' own
 * post-render refit passes the string `{ height: "auto" }`. We key off that
 * signature — on the first manual resize we adopt the dragged pixel height (so
 * core stops refitting to content) and remember it; afterwards we drop later
 * `{ height: "auto" }` refits so the user's chosen height sticks across the many
 * `render(false)` re-renders these dialogs do.
 *
 * A resized window also picks up a `stonetop-height-resized` class on its frame, which
 * lifts the CSS `max-height` cap some of these windows carry (see stonetop.css) — the
 * cap exists to bound the opening height, and would otherwise clamp the drag as well.
 *
 * Patches the V1 `Application` prototype once, but the behaviour change is scoped
 * to Stonetop windows (any `stonetop`-namespaced class) — every other V1 window
 * (core sheets, third-party apps) keeps core's exact `setPosition`, so a
 * programmatic `{ width, height }` call elsewhere can't be misread as a manual
 * resize and have its height frozen. Fixed-height and non-resized windows are
 * untouched. Idempotent via an own-property marker.
 */
// True for our own windows/modals — the only ones whose auto-height should be
// drag-lockable. Keyed off the shared `stonetop` class namespace every Stonetop
// Application/Dialog carries, so the prototype patch never alters a foreign window.
function _isStonetopWindow(app) {
	const classes = app?.options?.classes;
	return Array.isArray(classes)
		&& classes.some(c => c === "stonetop" || c.startsWith("stonetop-") || c.startsWith("stonetop_"));
}

export function enableAutoHeightVerticalResize() {
	// V13+ exposes the classic Application under foundry.appv1; fall back to the global.
	const ApplicationClass = foundry?.appv1?.api?.Application ?? globalThis.Application;
	const proto = ApplicationClass?.prototype;
	if (!proto || Object.prototype.hasOwnProperty.call(proto, "_stonetopVerticalResizePatched")) return;

	const baseSetPosition = proto.setPosition;
	if (typeof baseSetPosition !== "function") return;

	proto.setPosition = function (position = {}) {
		// Only Stonetop windows opt into the auto-height resize lock; everything else
		// gets core's untouched behaviour.
		if (!_isStonetopWindow(this)) return baseSetPosition.call(this, position);

		// A WINDOW THAT NO LONGER HAS A FRAME HAS NOTHING TO POSITION, and core does not check:
		// `Application#setPosition` opens with `getComputedStyle(this.element[0])`, and on an
		// application that has been closed `_element` is null, so `element[0]` is undefined and the
		// call throws `parameter 1 is not of type 'Element'`.
		//
		// WHICH IS REACHABLE BY ORDINARY USE, because the window-frame `Draggable` binds its
		// mousemove to the WINDOW and calls `app.setPosition` on every one until the mouseup that
		// unbinds it. Anything that closes the application mid-gesture -- Escape, a sheet closing
		// under the pointer, another client deleting the document being looked at -- leaves that
		// listener running against an app whose element has gone, and then every mouse movement
		// throws until the button comes up. Nothing is broken by it and nothing is fixed by it
		// either: there is no box on screen to move.
		//
		// Guarded HERE and not for every V1 window, because this file promises above that a foreign
		// window keeps core's exact `setPosition` and that promise is worth more than tidying up
		// somebody else's console.
		//
		// `nodeType` rather than `instanceof HTMLElement`, which is the same question asked in a way
		// that does not need a DOM global to be in scope to answer it.
		if (this.element?.[0]?.nodeType !== 1) return this.position;

		const isAutoHeight = this.options?.height === "auto";
		// The resize drag's tell: a finite numeric height with no left/top (Draggable
		// passes only { width?, height? }); internal reflows always carry left/top.
		const isResizeDrag = Number.isFinite(position?.height)
			&& !("top" in position) && !("left" in position);

		if (isAutoHeight && isResizeDrag) {
			// First manual resize: adopt the dragged height so core honours it instead
			// of refitting to content, and flag that the user has taken over sizing.
			this.options.height = position.height;
			this._stonetopHeightLocked = true;
		} else if (this._stonetopHeightLocked && position?.height === "auto") {
			// After a manual resize, ignore later auto-refit requests so the chosen
			// height persists (some steppers re-assert height:"auto" on every render).
			position = { ...position };
			delete position.height;
		}

		// Adopting the height above is only half the job: several of our auto-height
		// windows also carry a CSS `max-height` cap on the frame, there to stop a long
		// list opening the full height of the screen. That cap clamps the rendered box
		// no matter what `style.height` the drag writes, so a window sitting AT its cap
		// (the People of Stonetop gallery, with a full portrait grid, always is) reads
		// as un-growable. Mark the frame so the stylesheet can lift the cap once the
		// user has taken sizing over — the cap has done its job by then, and core still
		// clamps the dragged height to the viewport. Marked via a class, never an inline
		// `style.maxHeight`: core reads `el.style.maxHeight` straight into `Math.clamp`,
		// where a CSS string ("none", "800px") yields NaN and kills resizing outright.
		// Re-asserted on every call rather than once, since it costs nothing and covers
		// a window whose frame is rebuilt by a later render.
		if (this._stonetopHeightLocked) this.element?.[0]?.classList.add("stonetop-height-resized");

		return baseSetPosition.call(this, position);
	};

	proto._stonetopVerticalResizePatched = true;
}
