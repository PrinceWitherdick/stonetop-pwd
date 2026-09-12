// ── Primary-GM guard ────────────────────────────────────────────────────────
// With several GMs (or Assistant GMs) connected, actions that write shared world
// state — advancing the introductions cursor, harvesting player answers into the
// world setting, applying combat damage — must run on exactly ONE client, or two
// GMs race the same write. This resolves the single "primary" GM the same way
// everywhere: Foundry's designated activeGM when present, else the first active GM
// user (and true when there's no active GM at all, so a lone client still acts).

export function isPrimaryGM() {
	const activeGM = game.users?.activeGM;
	if (activeGM) return activeGM.id === game.user?.id;

	const firstActiveGM = game.users?.find(user => user.active && user.isGM);
	return !firstActiveGM || firstActiveGM.id === game.user?.id;
}

/**
 * Whether ANY GM is connected — the other question about the same set of users, and the one a
 * whispered ask has to have answered before it counts as asked.
 *
 * `ChatMessage.getWhisperRecipients("GM")` lists every user holding the role whether or not they
 * are logged in, so a whisper always sends and may still reach nobody: the GM stepped away, or a
 * player is trying something out on their own. A card that needs a GM's answer and has no GM to
 * answer it has to say so out loud rather than sit unread.
 *
 * Note this is NOT `isPrimaryGM()` inverted. That one answers "should THIS client do the write",
 * and deliberately returns true with no GM present so a lone client still acts.
 */
export function anyActiveGM() {
	return !!(game.users?.activeGM ?? game.users?.find(user => user.active && user.isGM));
}
