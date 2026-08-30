import { FrontOnOpen } from "./front-on-open.js";

// Minimum gap between progress re-renders. A long job reports once per document — a seeded
// world has several hundred — and each render is a full getData + template + setPosition;
// without this the job spends its wall clock on layout.
const PROGRESS_RENDER_MS = 150;

/**
 * Base class for Stonetop's authoring dialogs (custom move, love letter, add inventory
 * item, monster builder, love-letter reader). It centralises the two pieces of lifecycle
 * every one of them repeated:
 *
 *  • FrontOnOpen, so a dialog launched from an actor sheet stays above it (below tooltips)
 *    — applied on render, started on activateListeners, stopped on close; and
 *  • the result-dialog protocol below, for a dialog whose caller awaits its answer.
 *
 * It also offers a tiny form-value reader so each dialog's `_save` stops re-declaring the
 * same `root.querySelector(sel)?.value ?? ""`, and the throttled re-render every
 * long-running progress panel needs (see renderThrottled).
 *
 * Subclasses set their own fields AFTER `super(options)`. When a subclass overrides
 * activateListeners / close / _render to add its own behaviour, it MUST call the matching
 * `super.…` so the FrontOnOpen lifecycle still runs.
 */
export class StonetopDialog extends Application {
	constructor(options = {}) {
		super(options);
		this._frontOnOpen = new FrontOnOpen(this);
		// Set by promise(); settled once by _resolveWith on finish, or null on cancel-close.
		// Named _resultResolve, not _resolve: a subclass is free to have a _resolve() METHOD
		// (CallUpDeepOnesDialog does), which a same-named field here would silently shadow.
		this._resultResolve = null;
		// renderThrottled bookkeeping; inert until a subclass calls it.
		this._throttledRenderAt = 0;
		this._throttledRenderTimer = null;
	}

	// Throttled re-render, for a dialog fed by a per-document progress stream. A trailing
	// timer guarantees the last tick of a burst is drawn, so the panel never freezes one
	// update short of the truth — the reason this lives here rather than being re-written
	// per progress dialog, each with its own idea of whether that tick matters.

	/** Re-render at most every PROGRESS_RENDER_MS, with the final tick of a burst guaranteed. */
	renderThrottled() {
		const wait = PROGRESS_RENDER_MS - (Date.now() - this._throttledRenderAt);
		if (wait <= 0) { this.renderNow(); return; }
		if (this._throttledRenderTimer) return;
		this._throttledRenderTimer = setTimeout(() => { this._throttledRenderTimer = null; this.renderNow(); }, wait);
	}

	/** Re-render immediately, cancelling any pending throttled render. Subclasses may extend. */
	renderNow() {
		this._throttledRenderAt = Date.now();
		this._cancelThrottledRender();
		this.render(false);
	}

	_cancelThrottledRender() {
		if (this._throttledRenderTimer) { clearTimeout(this._throttledRenderTimer); this._throttledRenderTimer = null; }
	}

	// Result-dialog protocol: a caller awaits promise(); the dialog collects input and calls
	// _resolveWith(value) to settle it and close. Every exit resolves — a dialog dismissed by
	// Cancel, Escape or the X settles to null rather than leaving its caller awaiting forever.
	// A dialog nobody awaits simply never calls promise(), and these are inert.

	/** Open the dialog; resolves to the value passed to _resolveWith, or null if cancelled. */
	promise() {
		return new Promise(resolve => { this._resultResolve = resolve; this.render(true); });
	}

	/**
	 * Settle promise() with a result and close. `_resultResolve` is cleared first so close()'s
	 * own settle finds nothing and cannot re-resolve to null behind this.
	 *
	 * Settles AFTER the close, and in a `finally`, for exactly the reasons close() does: a
	 * caller queueing a follow-up dialog behind this one gets the floor rather than talking
	 * over the fade-out, and a close that throws still releases whoever was waiting. The two
	 * exits from a result dialog then have the same timing — before, the affirmative path
	 * resolved a beat earlier than Cancel did, which is the kind of difference nothing
	 * notices until something does.
	 *
	 * Async, but no caller awaits it: every call site is an event handler that fires and
	 * forgets, and the value it settles is delivered through promise().
	 */
	async _resolveWith(result) {
		const resolve = this._resultResolve;
		this._resultResolve = null;
		try { await this.close(); }
		finally { resolve?.(result); }
	}

	/**
	 * Run `fn` once, ignoring further clicks until it settles, and grey the control meanwhile.
	 *
	 * The dialogs in this system commit through several awaited document writes — a level-up
	 * adds moves and grants possessions, end-of-session walks every player character with a
	 * write apiece — and the window closes only when all of them have landed. That leaves the
	 * button live and inviting for several round trips, and a second click in the gap applies
	 * the whole thing twice.
	 *
	 * Both halves matter and had been written out separately, once each, already disagreeing:
	 * the LATCH is what actually prevents the double apply, and DISABLING the control is what
	 * tells the person their press took. A dialog that latched without disabling still looked
	 * unresponsive and invited the second click it was busy ignoring.
	 *
	 * The control is put BACK only when the work throws. On success the caller has either closed
	 * the window or re-rendered it, so the button is gone or freshly drawn either way; greying it
	 * back in between would offer a second press at the one moment the latch has just let go. A
	 * throw is the case where neither of those happened and the window is still sitting there,
	 * and leaving it dead would give a GM no way to try again but to close and reopen.
	 *
	 * @param {Event|{currentTarget?: HTMLElement}} ev  the click, for the control to grey
	 * @param {Function} fn  the work; awaited, and the latch is released in a `finally`
	 */
	async _guardBusy(ev, fn) {
		if (this._busy) return;
		this._busy = true;
		const control = ev?.currentTarget;
		if (control) control.disabled = true;
		try {
			return await fn();
		} catch (err) {
			if (control) control.disabled = false;
			throw err;
		} finally {
			this._busy = false;
		}
	}

	/** Override to true for a content-hugging window that re-fits its height each render. */
	get _autoHeight() { return false; }

	async _render(force, options) {
		await super._render(force, options);
		this._frontOnOpen.apply();
		// Auto-height dialogs re-fit their height after each render so the window hugs the
		// current content (AppV1 caps the result via CSS max-height).
		if (this._autoHeight) this.setPosition({ height: "auto" });
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._frontOnOpen.start();
	}

	async close(options = {}) {
		this._frontOnOpen.stop();
		this._cancelThrottledRender();
		try {
			return await super.close(options);
		} finally {
			// A close without finishing (Cancel, Escape, X) resolves an open promise() to null.
			// Settled in a finally, AFTER super.close() has run: a caller queueing a follow-up
			// dialog behind this one gets the floor rather than talking over the fade-out, and a
			// close that throws still releases whoever was waiting.
			if (this._resultResolve) { const resolve = this._resultResolve; this._resultResolve = null; resolve(null); }
		}
	}

	/**
	 * Re-render an already-open window. The guard is not optional: AppV1's `render(true)`
	 * force-renders a CLOSED application back onto the page, so a dialog dismissed while an
	 * await was in flight would pop open again on top of whatever the user moved on to.
	 *
	 * `render(true)` rather than renderNow()'s `render(false)`, because a step-based dialog
	 * re-renders to CHANGE step and has to be brought to the front with it.
	 */
	renderIfOpen() {
		if (this.rendered) this.render(true);
	}

	/**
	 * A choice the player made that could not be written down. Log it for whoever has the console
	 * open, tell the player in words they can act on, and put the window back the way the DOCUMENT
	 * says it is — which, the write having failed, is the way it was before they clicked.
	 *
	 * The redraw is the part worth sharing. A dialog that latches a choice while its write is in
	 * flight has to un-latch it on failure, and every one of them then has to remember that the
	 * screen is still showing the latched state. Callers roll their own latch back before calling
	 * this, so all that is left is to say so and repaint.
	 *
	 * `noun` names the thing that did not get recorded, in the player's vocabulary rather than the
	 * schema's ("That fate", "That undeath resolution") — the rest of the sentence is the same
	 * advice whatever failed, and writing it out per dialog only invites it to drift.
	 */
	reportWriteFailure(noun, err) {
		console.error(`Stonetop | Could not apply this ${noun}.`, err);
		ui.notifications?.error(`That ${noun} could not be recorded. Try it again, or ask your GM to check your permissions.`);
		this.renderIfOpen();
	}

	/**
	 * Options for a dialog that must have one window PER DOCUMENT rather than one window at all.
	 *
	 * AppV1 resolves `Application#element` as `$("#" + this.id)` whenever `_element` is unset, so
	 * two dialogs sharing the single id from defaultOptions both resolve to the FIRST one's frame:
	 * the second's `_replaceHTML` paints its content into the first's window, and the first's
	 * handlers are left bound to nodes nothing will re-render. Two PCs at Death's Door in one
	 * fight is an ordinary evening, and the longer a dialog stays open the easier it is to hit.
	 *
	 * A static rather than something the constructor does, because `this.options` is frozen after
	 * `super()` — the id has to arrive in the options object, before the base class sees it.
	 */
	static perDocumentOptions(prefix, documentId, options = {}) {
		return foundry.utils.mergeObject({ id: `${prefix}-${documentId ?? "unknown"}` }, options);
	}

	/** Read a form field's value by selector from a root element; "" when the field is absent. */
	static readValue(root, selector) {
		return root.querySelector(selector)?.value ?? "";
	}
}
