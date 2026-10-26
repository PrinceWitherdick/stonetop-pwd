// ── Creation-flow window tracking ──────────────────────────────────────────────
// The three windows that make up character creation — the "Welcome to Stonetop!" intro,
// the playbook picker, and the onboarding walkthrough — are plain Applications rather
// than document sheets, so they never appear in `actor.apps`. Core closes an actor's
// SHEETS when that actor is deleted; it knows nothing about these, so they stayed open
// over a document that no longer existed.
//
// That is not hypothetical. Minting a character for a player who already has one is a
// REPLACEMENT: createCharacterForUser deletes the old character first. Do that while the
// player is halfway through creation — exactly what the Welcome guide's roster invites,
// since its "Create character" button sits next to a row reading "on page 4 of 9" — and
// their walkthrough carried on over a dead actor. Every save threw, their answers were
// gone, and the new mint greeted them from the top.
//
// So each flow window is registered here against the character it is building. One
// deleteActor hook closes whatever belonged to a character that has just gone, and drops
// that character's local resume snapshot so it can't shadow the fresh start.
//
// Tracking beats scanning `ui.windows` for two reasons: it answers "mid-creation for
// WHICH character?", which the greeting in hooks/Ready.js wants, and it can't be defeated
// by one of these dialogs later moving to ApplicationV2 (see utils/open-windows.js).

import { clearOnboardingResume } from "./onboarding-resume.js";

// Application → the id of the character it is building.
const _flowWindows = new Map();
// Every window ever registered, so its close can be recognised after _live() has pruned it.
const _everTracked = new WeakSet();

/**
 * Is this window still one of ours to close?
 *
 * Read off the RENDER STATE, not off `rendered`. `rendered` is only true once _render has
 * finished awaiting getData and the template fetch — and every window here is registered on the
 * synchronous return from `render(true)`, so `rendered` is false for the whole of that gap.
 * Pruning on it dropped each flow from the map microseconds after it was added, which let the
 * ready hook's synchronous sweep over `game.actors` open a SECOND dialog with the same DOM id
 * (CharacterCreationDialog.open's own `ui.windows` guard is blind for the same window, since
 * core registers there after the same awaits) — the exact duplication both guards exist to
 * prevent. It also made a window invisible to closeCreationFlowFor if its actor were deleted
 * mid-render.
 *
 * Positive is RENDERING or RENDERED; zero and negative are NONE / CLOSED / CLOSING / ERROR. Both
 * application classes carry the same enum — AppV1 on `_state`, AppV2 through `state` — so this
 * survives one of these dialogs moving to ApplicationV2, which is the point of tracking at all.
 */
function _isLive(app) {
	if (!app) return false;
	const state = app.state ?? app._state;
	return Number.isFinite(state) ? state > 0 : !!app.rendered;
}

// Drop windows that have since closed. Pruning on read rather than hooking every close keeps
// this a leaf module, and the map only ever holds the handful of dialogs one client has open.
function _live() {
	for (const app of [..._flowWindows.keys()]) if (!_isLive(app)) _flowWindows.delete(app);
	return _flowWindows;
}

// The render states this module waits on, as both application classes number them.
const RENDERING = 1;
const CLOSING   = -2;
const POLL_MS    = 25;
const POLL_LIMIT = 400;   // ten seconds: a render or a fade that takes longer has failed

function _stateOf(app) {
	const state = app?.state ?? app?._state;
	return Number.isFinite(state) ? state : null;
}

async function _waitWhile(app, state) {
	for (let i = 0; i < POLL_LIMIT && _stateOf(app) === state; i++) {
		await new Promise(resolve => setTimeout(resolve, POLL_MS));
	}
}

/**
 * Close a window, and resolve only once it has really gone.
 *
 * Core's AppV1 `close()` does nothing at all unless the window is RENDERED (or ERROR): one still
 * painting carries on and appears anyway, and one already fading out returns at once, before its
 * element leaves the DOM. Both bite here. A creation window caught mid-render by its character's
 * delete stayed open over the dead actor; and a window opened under the same DOM id while its
 * predecessor was still fading found the OLD element by id (`Application#element` falls back to
 * `$("#id")`), drew into it, and vanished with it when the fade finished. So: let a render
 * finish, close, then wait out the fade.
 */
export async function closeAndSettle(app) {
	if (!app) return;
	await _waitWhile(app, RENDERING);
	await app.close();
	await _waitWhile(app, CLOSING);
}

// Characters deleted on this client since load. A flow that registers for one of them is closed
// on arrival: it was already on its way (an await between the click and the window) when its
// character went.
const _deletedActors = new Set();

/** Close one tracked window on its character's behalf, with its exit callbacks suppressed. */
function _closeForGone(app) {
	// The window's exit callbacks are suppressed, because the character they would act on has
	// already gone. `onClose` is openSheetOnce, which renders the sheet of a DELETED actor:
	// a ghost window that looks live and silently refuses every edit made in it. `onExit` is
	// saveResume, which writes back the very resume snapshot the caller clears a line before
	// calling this, so the deliberate "drop the snapshot first" ordering was undone by the
	// close that followed it. `_suppressOnClose` is the dialog's own switch for this: it is
	// what stepping back to the picker uses, so a step backwards is not read as giving up.
	app._suppressOnClose = true;
	// Not drawn yet: callers register first and chain `.render(true)` on the return, and core's
	// close() does nothing to a window in NONE, so the render that follows would paint it over
	// the dead actor anyway. Stop that render instead; there is nothing on screen to close.
	const state = _stateOf(app);
	if (state === 0 || (state === null && !app.rendered)) {
		app.render = () => app;
		return;
	}
	try {
		// Mid-render, core's close() would be a no-op (see closeAndSettle); wait for the paint.
		const closing = _stateOf(app) === RENDERING ? closeAndSettle(app) : app.close();
		Promise.resolve(closing).catch(() => {});   // a failed close must not stop the rest
	} catch { /* likewise */ }
}

/** Register a creation window against the character it is building. */
export function trackCreationFlow(app, actorId) {
	if (!app || !actorId) return app;
	if (_deletedActors.has(actorId)) {
		_closeForGone(app);
		return app;
	}
	_flowWindows.set(app, actorId);
	_everTracked.add(app);
	return app;
}

// Flows that are on their way but have no window yet: token -> the character they are for.
const _pending = new Map();

/**
 * Count a flow as open from the moment it is STARTED, not from when its window registers.
 *
 * Starting one can await before the window exists (the resume path fetches its playbook from the
 * compendium first), and the ready-time sweep over the player's characters is synchronous: in
 * that gap a second character's greeting would open beside the first. Held until `promise`
 * settles, by which time the flow's own window has registered through trackCreationFlow.
 * Returns `promise`.
 */
export function holdCreationFlow(actorId, promise) {
	if (!actorId) return promise;
	const token = {};
	_pending.set(token, actorId);
	const release = () => {
		_pending.delete(token);
		_scheduleHeldGreetings();
	};
	Promise.resolve(promise).then(release).catch(release);
	return promise;
}

/**
 * Is this client already walking someone through creation?
 *
 * With an `actorId`, asks specifically about that character; without one, about any.
 * The bare form is what stops a fresh greeting landing on top of a flow already in
 * progress — whatever character that flow is for, re-entering would bury it.
 */
export function creationFlowOpen(actorId = null) {
	const ids = [..._live().values(), ..._pending.values()];
	if (!actorId) return ids.length > 0;
	return ids.includes(actorId);
}

// ── Greetings held back while a flow is open ─────────────────────────────────
// The greeting in hooks/Ready.js stands aside while this client is already in a creation flow,
// rather than burying it. It used to wait for the NEXT LOAD, while the GM had just been told it
// had started on the player's screen. Instead it is parked here and tried again as soon as the
// last flow window has closed, this session. Keyed by character, so a second hold for the same
// one replaces the first rather than greeting twice.
const _heldGreetings = new Map();
let _drainTimer = null;

/** Park a greeting until this client has no creation flow open; `retry` re-runs it. */
export function holdGreetingUntilIdle(actorId, retry) {
	if (!actorId || typeof retry !== "function") return;
	_heldGreetings.set(actorId, retry);
}

/** Is a greeting for this character (or any, with none given) parked? */
export function greetingHeld(actorId = null) {
	return actorId ? _heldGreetings.has(actorId) : _heldGreetings.size > 0;
}

/**
 * Re-run parked greetings once no flow is open. Deferred a macrotask: a flow moving from one
 * window to the next (intro to picker, picker to walkthrough, Back to the picker) registers the
 * next window in the same task, or a microtask later, as the old one finishes closing. Each
 * retry re-checks and parks itself again if a flow has opened meanwhile, so running them all
 * at once still opens one flow at a time.
 */
function _scheduleHeldGreetings() {
	if (!_heldGreetings.size || _drainTimer) return;
	_drainTimer = setTimeout(() => {
		_drainTimer = null;
		runHeldGreetings();
	}, 0);
}

/** Run every parked greeting now, if no flow is open. */
function runHeldGreetings() {
	if (!_heldGreetings.size || creationFlowOpen()) return;
	const retries = [..._heldGreetings.values()];
	_heldGreetings.clear();
	for (const retry of retries) {
		try {
			retry();
		} catch (err) {
			console.error("Stonetop | a held character-creation greeting failed", err);
		}
	}
}

/**
 * A tracked window has started closing: once it has gone, try the parked greetings. Waits out
 * the fade, because the window still counts as open until then, and a flow's next window
 * registers as the old one's close resolves.
 */
export async function flowWindowClosing(app) {
	if (!app || !_everTracked.has(app)) return;
	await _waitWhile(app, CLOSING);
	_scheduleHeldGreetings();
}

/** Close every creation window building `actorId`. Returns how many were closed. */
export function closeCreationFlowFor(actorId) {
	if (!actorId) return 0;
	let closed = 0;
	for (const [app, id] of [..._live().entries()]) {
		if (id !== actorId) continue;
		_flowWindows.delete(app);
		closed++;
		_closeForGone(app);
	}
	return closed;
}

/**
 * Close any creation flow whose character is deleted out from under it.
 *
 * Registered once from the ready hook, on every client: the delete is broadcast, so the
 * player whose character was replaced hears about it on their own screen. Says so out
 * loud — a walkthrough vanishing mid-sentence with no explanation reads as a crash, and
 * the replacement's own greeting arrives a moment later anyway.
 */
export function registerCreationFlowCleanup() {
	// Core fires close<Class> for every class in an AppV1 window's chain, so this hears all three flow windows.
	Hooks.on("closeApplication", app => { flowWindowClosing(app); });
	Hooks.on("deleteActor", actor => {
		if (actor?.type !== "character") return;
		// Drop the client-local resume snapshot first: it is keyed by actor id, and leaving
		// it behind means a later character could never be told apart from this one's
		// abandoned progress.
		clearOnboardingResume(actor);
		if (actor.id) _deletedActors.add(actor.id);
		if (!closeCreationFlowFor(actor.id)) return;
		ui.notifications?.warn(`Character creation closed: “${actor.name}” was removed.`);
	});
}
