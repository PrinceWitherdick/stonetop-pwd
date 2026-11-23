import { StonetopDialog } from "./stonetop-dialog.js";

/**
 * How long a burst of document updates is collapsed before the window redraws. A settle lands one
 * update per character within a second, and several players pressing steppers at once is the
 * whole point of the window; either would otherwise redraw it once per write.
 */
const RENDER_DEBOUNCE_MS = 80;

/**
 * Base class for a shared window that keeps no state of its own (Make Camp, Struggle as One): every
 * control writes straight to a document, and the update that write causes, here and on every other
 * client, is what redraws it.
 *
 * It owns the plumbing both repeated: the hooks watched while the window is open (_watchedHooks),
 * the root click/change delegation to _onClick/_onChange, the serial write queue, and the debounced
 * redraw, whose post-debounce step is the subclass's _redrawOrClose.
 */
export class LiveDocumentWindow extends StonetopDialog {
	constructor(options = {}) {
		super(options);
		this._hooks       = null;
		this._renderTimer = null;
		this._writes      = Promise.resolve();
	}

	activateListeners(html) {
		super.activateListeners(html);
		this._watch();
		const root = html?.[0] ?? html;
		root?.addEventListener?.("click", ev => this._onClick(ev));
		root?.addEventListener?.("change", ev => this._onChange(ev));
	}

	async close(options = {}) {
		this._unwatch();
		return super.close(options);
	}

	/** Override: a click anywhere in the window. */
	_onClick() {}

	/** Override: a change anywhere in the window. */
	_onChange() {}

	/**
	 * Run one write after the last, so each one reads the documents as the one before it left them.
	 *
	 * A stepper gets pressed three times in a second. Each press reads the current offer and
	 * writes one more; three presses racing each other would all read the same offer and all write
	 * the same "one more". Chained, the second press reads what the first wrote.
	 */
	_queue(noun, task) {
		const run = this._writes.then(task);
		this._writes = run.catch(err => this.reportWriteFailure(noun, err));
		return this._writes;
	}

	/** Override: the `[hook, handler]` pairs watched while the window is open, in the order they are hooked. */
	_watchedHooks() { return []; }

	_watch() {
		if (this._hooks) return;
		this._hooks = this._watchedHooks().map(([hook, handler]) => [hook, Hooks.on(hook, handler)]);
	}

	_unwatch() {
		for (const [hook, id] of this._hooks ?? []) Hooks.off(hook, id);
		this._hooks = null;
		clearTimeout(this._renderTimer);
		this._renderTimer = null;
		this._onUnwatch();
	}

	/** Override: anything else to let go of once the window stops watching. */
	_onUnwatch() {}

	/** Redraw soon, collapsing a burst of updates into one; _redrawOrClose decides which, once the window is still up. */
	_scheduleRender() {
		clearTimeout(this._renderTimer);
		this._renderTimer = setTimeout(() => {
			this._renderTimer = null;
			if (!this.rendered) return;
			this._redrawOrClose();
		}, RENDER_DEBOUNCE_MS);
	}

	/** Override: close the window when what it shows is gone, or else `this.render(false)`. */
	_redrawOrClose() {
		this.render(false);
	}
}
