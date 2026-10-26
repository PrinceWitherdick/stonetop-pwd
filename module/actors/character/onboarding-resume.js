// ── Onboarding resume snapshot ───────────────────────────────────────────────
// A character's in-progress creation answers, stored client-side so an unexpected
// reload (e.g. a dropped connection) doesn't lose written content. localStorage is
// deliberate: this only needs to survive a reload on the same machine, and writing
// it costs nothing — no database round-trip and no broadcast to other clients, the
// way an actor flag would on every keystroke. It even works while offline, which is
// the failure case it exists for. The lightweight page number (for the GM's roster)
// still lives in the actor's onboardingProgress flag; only the heavy selections blob
// lives here.
//
// Trade-off: being client-local, this won't follow a player to a different browser
// or computer — there, creation falls back to restarting the current page.
//
// Keyed by world, USER and character. Two people sharing one browser profile (a family
// machine, a GM testing as a player) must not resume each other's answers. Snapshots
// written before the user was part of the key are read once from the old key, moved to
// the new one, and the old key dropped.

const PREFIX = "stonetop-pwd.onboarding";

function _world() {
	return game?.world?.id ?? "world";
}

function storageKey(actor) {
	return `${PREFIX}.${_world()}.${game?.user?.id ?? "user"}.${actor.id}`;
}

// The key used before the user id joined it. Read only as a fallback.
function legacyStorageKey(actor) {
	return `${PREFIX}.${_world()}.${actor.id}`;
}

function _sameSelections(a, b) {
	try {
		return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
	} catch (_err) {
		return false;
	}
}

/**
 * Persist the resume snapshot. Swallows storage errors (private mode / quota): a failed
 * autosave must never interrupt the player.
 *
 * `committed` says these exact answers were just written to the character (the walkthrough's
 * Save). A later write keeps that mark only while the answers are unchanged, so the mark means
 * "the character already holds everything here" and its absence means "this snapshot holds
 * answers the character does not" (see resumeHasUnsavedWork).
 */
export function writeOnboardingResume(actor, snapshot, { committed = false } = {}) {
	if (!actor?.id) return;
	try {
		let saved = committed;
		if (!saved) {
			const prev = readOnboardingResume(actor);
			saved = prev?.committed === true && _sameSelections(prev.selections, snapshot?.selections);
		}
		localStorage.setItem(storageKey(actor), JSON.stringify({ ...snapshot, committed: saved }));
	} catch (_err) { /* storage unavailable — resume just won't be offered */ }
}

// Read the resume snapshot, or null if there's nothing saved / it can't be parsed.
export function readOnboardingResume(actor) {
	if (!actor?.id) return null;
	try {
		const key = storageKey(actor);
		let raw = localStorage.getItem(key);
		if (!raw) {
			// Once only: a snapshot under the old world+actor key moves to this user's key.
			const legacy = legacyStorageKey(actor);
			raw = localStorage.getItem(legacy);
			if (raw) {
				localStorage.setItem(key, raw);
				localStorage.removeItem(legacy);
			}
		}
		return raw ? JSON.parse(raw) : null;
	} catch (_err) {
		return null;
	}
}

/**
 * Does this snapshot hold answers the character does not? True for any usable snapshot not
 * marked as saved: every snapshot of a character with no playbook yet, and one written after
 * the walkthrough's Save whose answers have changed since. A snapshot from before the mark
 * existed counts as unsaved, the safe reading.
 */
export function resumeHasUnsavedWork(snap) {
	return !!snap?.playbookUuid && !!snap?.selections && snap.committed !== true;
}

// Drop the snapshot once creation is finished (or the character is gone).
export function clearOnboardingResume(actor) {
	if (!actor?.id) return;
	try {
		localStorage.removeItem(storageKey(actor));
		localStorage.removeItem(legacyStorageKey(actor));
		localStorage.removeItem(exitedSheetKey(actor));
	} catch (_err) { /* nothing to clean up */ }
}

// ── "We already showed you the sheet" ────────────────────────────────────────
// A player who backed out of creation with nothing to resume is shown their sheet once
// on load (it carries the Create Character button and the incomplete banner), not on
// every load after. Per client, like the snapshot: it only decides what pops up here.

function exitedSheetKey(actor) {
	return `${PREFIX}.exitShown.${_world()}.${game?.user?.id ?? "user"}.${actor.id}`;
}

export function exitedSheetShown(actor) {
	if (!actor?.id) return false;
	try {
		return !!localStorage.getItem(exitedSheetKey(actor));
	} catch (_err) {
		return false;
	}
}

export function markExitedSheetShown(actor) {
	if (!actor?.id) return;
	try {
		localStorage.setItem(exitedSheetKey(actor), "1");
	} catch (_err) { /* it shows again next load, which is harmless */ }
}
