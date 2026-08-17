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

/** Register a creation window against the character it is building. */
export function trackCreationFlow(app, actorId) {
	if (!app || !actorId) return app;
	_flowWindows.set(app, actorId);
	return app;
}

/**
 * Is this client already walking someone through creation?
 *
 * With an `actorId`, asks specifically about that character; without one, about any.
 * The bare form is what stops a fresh greeting landing on top of a flow already in
 * progress — whatever character that flow is for, re-entering would bury it.
 */
export function creationFlowOpen(actorId = null) {
	const live = _live();
	if (!actorId) return live.size > 0;
	return [...live.values()].includes(actorId);
}

/** Close every creation window building `actorId`. Returns how many were closed. */
export function closeCreationFlowFor(actorId) {
	if (!actorId) return 0;
	let closed = 0;
	for (const [app, id] of [..._live().entries()]) {
		if (id !== actorId) continue;
		_flowWindows.delete(app);
		closed++;
		// The window's exit callbacks are suppressed, because the character they would act on has
		// already gone. `onClose` is openSheetOnce, which renders the sheet of a DELETED actor —
		// a ghost window that looks live and silently refuses every edit made in it. `onExit` is
		// saveResume, which writes back the very resume snapshot the caller clears a line before
		// calling this, so the deliberate "drop the snapshot first" ordering was undone by the
		// close that followed it. `_suppressOnClose` is the dialog's own switch for this: it is
		// what stepping back to the picker uses, so a step backwards is not read as giving up.
		app._suppressOnClose = true;
		Promise.resolve(app.close()).catch(() => {});   // a failed close must not stop the rest
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
	Hooks.on("deleteActor", actor => {
		if (actor?.type !== "character") return;
		// Drop the client-local resume snapshot first: it is keyed by actor id, and leaving
		// it behind means a later character could never be told apart from this one's
		// abandoned progress.
		clearOnboardingResume(actor);
		if (!closeCreationFlowFor(actor.id)) return;
		ui.notifications?.warn(`Character creation closed: “${actor.name}” was removed.`);
	});
}
