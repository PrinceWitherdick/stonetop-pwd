import { FrontOnOpen } from "../utils/front-on-open.js";
import { getSetting } from "../settings.js";
import { getWalkthroughResume, patchWalkthroughResume, saveWalkthroughPosition } from "./walkthrough-resume.js";

// ── StepperDialog ────────────────────────────────────────────────────────────
// Shared scaffolding for the linear "walkthrough" dialogs (Spring Burst,
// Expedition, Create Follower): a `_step` cursor over a list of steps, the
// FrontOnOpen lifecycle, Back/Next navigation, and the per-render nav context.
//
// Subclasses provide the steps via `get _steps()`, spread `_stepNav()` into their
// `getData`, call `_bindStepNav(html)` from `activateListeners`, and may override
// `_onBeforeStepChange()` to flush focused-but-unblurred fields before navigating.
//
// A "result" wizard (Make a Hazard, the Things Below wizards) is awaited via `promise()`
// and settles it with `_resolveWith(value)` on finish (or null on cancel-close). A
// content-hugging window overrides `get _autoHeight()` to re-fit its height each render.
export class StepperDialog extends Application {
	constructor(options = {}) {
		super(options);
		this._step      = 0;
		this._frontOnOpen = new FrontOnOpen(this);
		// Set by promise(); settled once by _resolveWith on finish, or null on cancel-close.
		this._resolve   = null;
	}

	/** @returns {Array<object>} The ordered steps; the final one is flagged `isFinal`. */
	get _steps() { return []; }

	/** The world-setting key holding this dialog's persisted Q&A notes. Subclasses
	 *  that show note fields override this; others leave it null. */
	get _answersSetting() { return null; }

	/** The persisted answers blob, read fresh each render so navigating Back/Next
	 *  shows whatever the GM has already typed. */
	_answers() {
		return (this._answersSetting ? getSetting(this._answersSetting) : null) ?? {};
	}

	/** Override to true for a content-hugging window that re-fits its height each render. */
	get _autoHeight() { return false; }

	/** The scrollport holding a step's content, zeroed when the step changes. Only matters
	 *  to a fixed-height stepper that lists the same selector in `options.scrollY` (the
	 *  Expedition walkthrough): core restores those offsets at the end of every render, so
	 *  without this a new step opens scrolled to the previous one's reading position. */
	get _stepScrollSelector() { return ".stonetop-guide-main"; }

	// ── Reload-resume ────────────────────────────────────────────────────────────
	// A walkthrough is a plain Application, so it does not survive a browser refresh: it
	// records the step it is on and that it is open, and hooks/Ready.js reopens it there on
	// the next load. See walkthrough-resume.js.
	//
	// The protocol lives here rather than in each dialog because it is one contract with
	// four coupled halves — save on render, clear the open flag on a DELIBERATE close (a
	// reload never runs close(), which is exactly what marks it as interrupted), restore the
	// cursor on open, and skip the write when nothing moved. Written out per dialog it drifted
	// immediately, and the next stepper would have copied whichever version it happened to
	// read. A subclass opts in with `_resumeKey` alone.

	/** The walkthrough-resume record this dialog stores its place under. Null — the default —
	 *  means this stepper has nothing to reopen: a result wizard is awaited through promise()
	 *  by whatever opened it, so there is no standalone window for Ready.js to bring back. */
	get _resumeKey() { return null; }

	/** Extra fields a subclass keeps in its resume record beside `step`, for state that gates
	 *  what a step SHOWS and would otherwise come back wrong (Spring Burst's delegated roll).
	 *  Compared by value on save, so an unchanged record is not rewritten. */
	_resumeExtras() { return {}; }

	/** Take those extra fields back off the stored record when the dialog reopens. */
	_applyResumeExtras(_saved) {}

	/** Reopen on the step left off at before a reload. Called by a subclass's own `open()`
	 *  BEFORE the first render, so the restored cursor is what gets drawn.
	 *
	 *  By KEY where the record has one, and by index only as a fallback. An index is a place in
	 *  a list this system edits: inserting "The route" as the Expedition walkthrough's second
	 *  step moved nine later steps down one, and a GM who reloaded mid-walkthrough came back to
	 *  the step BEFORE the one they left — silently, because the range check still passed. A key
	 *  survives an insert, a removal and a reorder; only a renamed or deleted step misses, and
	 *  that falls through to the index, which is no worse than what it replaced. */
	_restoreStep() {
		if (!this._resumeKey) return;
		const saved = getWalkthroughResume(this._resumeKey);
		const byKey = saved?.stepKey ? this._steps.findIndex(s => s.key === saved.stepKey) : -1;
		const step = byKey >= 0 ? byKey : Number(saved?.step);
		if (Number.isInteger(step) && step >= 0 && step < this._steps.length) this._step = step;
		this._applyResumeExtras(saved);
	}

	/** Record where we are. saveWalkthroughPosition drops the write when nothing has moved — a
	 *  settings write per render, for a value that only changes on Back/Next, is pure noise. */
	_saveResume() {
		if (!this._resumeKey) return;
		saveWalkthroughPosition(this._resumeKey, {
			step:    this._step,
			stepKey: this._steps[this._step]?.key ?? null,
			...this._resumeExtras(),
		});
	}

	async _render(force, options) {
		const stepChanged = this._renderedStep !== this._step;
		await super._render(force, options);
		this._renderedStep = this._step;
		this._frontOnOpen.apply();
		// After super._render, which is where core writes the restored scroll offsets back.
		if (stepChanged) {
			const port = this.element?.[0]?.querySelector(this._stepScrollSelector);
			if (port) port.scrollTop = 0;
		}
		// Auto-height wizards recompute height after each render so the window hugs the
		// current step's content (AppV1 caps the result via CSS max-height).
		if (this._autoHeight) this.setPosition({ height: "auto" });
		this._saveResume();
	}

	// Result-dialog protocol: a caller awaits promise(); the dialog collects input and
	// calls _resolveWith(value) to settle it and close, or resolves null if cancelled.
	/** Open the dialog; resolves to the value passed to _resolveWith, or null if cancelled. */
	promise() {
		return new Promise(resolve => { this._resolve = resolve; this.render(true); });
	}

	/** Settle promise() with a result and close. Nulls _resolve first so close() won't re-resolve. */
	_resolveWith(result) {
		const resolve = this._resolve;
		this._resolve = null;
		this.close();
		resolve?.(result);
	}

	async close(options = {}) {
		this._frontOnOpen.stop();
		// Closing on purpose clears the open flag (no auto-reopen next load); a reload skips
		// close() entirely and leaves it set. The saved step stays either way, for a manual reopen.
		if (this._resumeKey) patchWalkthroughResume(this._resumeKey, { open: false });
		// A close without finishing (Cancel, Escape, X) resolves an open promise() to null.
		if (this._resolve) { const resolve = this._resolve; this._resolve = null; resolve(null); }
		return super.close(options);
	}

	// Per-render navigation context: the active step plus its position labels. The
	// `steps` list lets a template render a jump-to-step table of contents (the longer
	// steppers opt in via the shared guide-toc partial); harmless extra data for the rest.
	_stepNav() {
		const steps = this._steps;
		const step  = steps[this._step];
		const nav = {
			step,
			steps: steps.map((s, i) => ({
				index:    i,
				title:    s.title,
				icon:     s.icon,
				isActive: i === this._step,
			})),
			stepIndex: this._step + 1,
			stepCount: steps.length,
			stepLabel: `Step ${this._step + 1} of ${steps.length}`,
			isFirst:   this._step === 0,
			isLast:    !!step.isFinal,
		};
		// Key-based steps expose an `is_<key>` boolean so a template can switch on the active
		// step (`{{#if is_themes}}`); numeric-only steppers (Spring/Expedition) have no key.
		if (step?.key) nav[`is_${step.key}`] = true;
		return nav;
	}

	// Start the front-on-open watcher and wire the shared Back/Next buttons plus any
	// jump-to-step table-of-contents buttons.
	_bindStepNav(html) {
		this._frontOnOpen.start();
		html.find(".stonetop-spring-back").on("click", () => this._retreat());
		html.find(".stonetop-spring-next").on("click", () => this._advance());
		html.find(".stonetop-guide-toc-btn").on("click", ev => this._goTo(Number(ev.currentTarget.dataset.stepIndex)));
	}

	// Hook for subclasses to capture live field values before changing steps.
	_onBeforeStepChange() {}

	// ── Shared step-form helpers (the pick-and-roll wizards) ─────────────────────

	/** Add or remove `value` from a Set based on a checkbox's checked state. */
	_toggleInSet(set, value, on) { if (on) set.add(value); else set.delete(value); }

	/** Add every rolled table entry's `.id` into a Set (uncapped "roll into the picks"). */
	_addIds(set, items) { for (const it of items) set.add(it.id); }

	/** Snapshot a classed group of `[data-index]` text inputs back into a parallel string
	 *  array — the add/remove row lists that don't re-render on each keystroke. Indices absent
	 *  from the array are ignored so a stale input can't grow it. `root` may be the app element
	 *  or its jQuery wrapper; defaults to the live element. */
	_captureRowInputs(root, selector, arr) {
		const el = root?.jquery ? root[0] : (root ?? this.element?.[0]);
		el?.querySelectorAll?.(selector).forEach(input => {
			const i = Number(input.dataset.index);
			if (i in arr) arr[i] = input.value;
		});
	}

	_advance() {
		this._onBeforeStepChange();
		if (this._step < this._steps.length - 1) { this._step++; this.render(false); }
	}

	_retreat() {
		this._onBeforeStepChange();
		if (this._step > 0) { this._step--; this.render(false); }
	}

	// Jump straight to a step (table-of-contents click). Flushes the current field
	// first, like Back/Next.
	_goTo(index) {
		if (!Number.isInteger(index) || index < 0 || index >= this._steps.length || index === this._step) return;
		this._onBeforeStepChange();
		this._step = index;
		this.render(false);
	}
}
