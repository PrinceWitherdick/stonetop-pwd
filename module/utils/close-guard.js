import { askWithButtons } from "./ask-with-buttons.js";

// ── Don't throw away what the GM wrote ─────────────────────────────────────────────────────────────
// A walkthrough that keeps its answers only in the window (Make a Site, Make a Hazard, the Things
// Below wizards, Create a Follower, the monster worksheet) loses them all on Cancel, Escape or the X.
// This asks first, once there is something to lose. Shared by both dialog bases (StonetopDialog and
// StepperDialog), which are separate Application subclasses.
//
// A window opts in by defining `_workState()`: a snapshot of what it would save (any JSON value, or
// a string). The first one is taken after the first render (notePristineWork), and the question is
// asked only while the current one differs. A window that can save partway defines `_saveForNow()`,
// and the question then offers that too. `_discardCopy()` may return its own `{ title, body, saveLabel }`.
//
// A close that FINISHES (the work was saved) passes `{ discard: true }`.
//
// Escape closes every open window at once (core's dismiss, with `closeKey`), so the others go while
// this one asks, and if the question is closed unanswered core may go on to open its main menu. Core's
// behaviour, accepted: the Improvement builder has always had it.

/** The window's work as one comparable string, or null when it has none to guard. */
function readWork(app) {
	if (typeof app?._workState !== "function") return null;
	try {
		const state = app._workState();
		if (state === null || state === undefined) return null;
		return typeof state === "string" ? state : JSON.stringify(state);
	} catch (err) {
		// Unreadable is not "nothing to lose": a window whose form throws (the Playbook Builder's did, on
		// a background with no track) would otherwise close without asking and drop what was typed.
		console.warn("Stonetop | couldn't read a window's work to guard its close", err);
		return UNREADABLE_WORK;
	}
}

/** What readWork answers for a window whose work it couldn't read: never equal to a real snapshot. */
const UNREADABLE_WORK = "\u0000unreadable";

/**
 * Take the untouched state, once: call after every render; only the first one that READS counts. One
 * that throws is not kept (as the untouched state, every later throw would equal it and the window
 * would close without asking): the window is marked as having opened unread, and the next render tries
 * again.
 */
export function notePristineWork(app) {
	if (app._pristineWork !== undefined && app._pristineWork !== null) return;
	const work = readWork(app);
	if (work === UNREADABLE_WORK) {
		app._pristineWork = null;
		app._pristineUnread = true;
		return;
	}
	app._pristineWork = work;
	app._pristineUnread = false;
}

/**
 * Has the window been written in since it opened? Where that can't be told (its work won't read now,
 * or hasn't read once since it opened), it answers yes, so closing asks rather than drops what was typed.
 */
export function hasUnsavedWork(app) {
	const known = app?._pristineWork !== undefined && app._pristineWork !== null;
	if (!known && !app?._pristineUnread) return false;
	const now = readWork(app);
	if (now === null) return false;
	if (now === UNREADABLE_WORK || !known) return true;
	return now !== app._pristineWork;
}

/**
 * May the window close now? True straight away for a finishing close, a window that isn't up, or one
 * with nothing to lose; otherwise asks. "Save for now" saves (and that save closes the window
 * itself), so it answers false here.
 *
 * @param {Application} app
 * @param {object} [options]  the close options; `discard: true` skips the question
 * @returns {Promise<boolean>}
 */
export async function mayClose(app, options = {}) {
	if (options?.discard || options?.force) return true;
	if (app.rendered === false || !hasUnsavedWork(app)) return true;
	// A second Escape while the question is up must not stack another.
	if (app._askingToClose) return false;
	app._askingToClose = true;
	const copy = app._discardCopy?.() ?? {};
	const canSave = typeof app._saveForNow === "function";
	let answer;
	try {
		answer = await askWithButtons({
			title: copy.title ?? "Discard what you've written?",
			content: `<p>${copy.body ?? "This hasn't been saved. Closing the window now loses what you've written."}</p>`,
			buttons: [
				...(canSave ? [{ key: "save", label: copy.saveLabel ?? "Save for now", icon: "fa-floppy-disk", value: "save" }] : []),
				{ key: "discard", label: "Discard what I wrote", icon: "fa-trash", className: "stonetop-dialog-btn--danger", value: "discard" },
			],
			// No "keep writing" button: the question's own X (or Escape) does that. Enter presses
			// nothing, so it can't throw the work away.
			defaultKey: false,
		});
	} finally {
		app._askingToClose = false;
	}
	// The question isn't modal: the GM may have finished (or closed) the window while it was up.
	if (app.rendered === false) return false;
	if (answer === "save") {
		await app._saveForNow();
		return false;
	}
	return answer === "discard";
}
