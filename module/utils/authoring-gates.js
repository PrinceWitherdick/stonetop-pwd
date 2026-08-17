import { SYSTEM_ID } from "../system-id.js";
// Authoring permission gates for Stonetop's hand-authored content (custom moves, homebrew
// arcana). A GM may always author; a non-GM may only when the world hasn't flipped the given
// "GM-only" setting. Shared so every entry point (the character sheet's per-section buttons
// AND the sidebar "Create Item" chooser) enforces the same rule — a gate applied at only one
// call-site leaves the other as a bypass.

export function gmOnlyGate(gmOnlySettingKey) {
	if (game.user?.isGM) return true;
	return !game.settings.get(SYSTEM_ID, gmOnlySettingKey);
}

/** Whether the current user may author custom moves. */
export function canAuthorCustomMoves() { return gmOnlyGate("customMovesGmOnly"); }

/** Whether the current user may author homebrew arcana (minor & major). */
export function canCreateArcana() { return gmOnlyGate("arcanaCreationGmOnly"); }
