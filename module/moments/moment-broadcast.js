// Table moments carried to every screen. An event, not state, so a socket (as the End of Session
// broadcast is): a player who logs in a minute later should not see a fight begin that already
// began. GM-only at the source and checked again on arrival, because a socket is open to anyone
// signed in. Guarded by tests/moments/moment-broadcast.test.js.
import { SYSTEM_ID } from "../system-id.js";
import { isTableMomentsOn } from "../settings.js";
import { momentView } from "./moment-view.js";
import { playMoment } from "./moment-overlay.js";

/** The system's socket channel, shared with the book and End of Session broadcasts. */
export const MOMENT_SOCKET = `system.${SYSTEM_ID}`;
export const MOMENT_PLAY = "momentPlay";

let registered = false;

/**
 * Play a moment on every screen at the table, this one included (a sender never receives its own
 * emit). False, with nothing sent, from a player or with Table moments off.
 *
 * @param {{kind: string, title?: string, sub?: string}} payload
 */
export function sendMoment(payload) {
	const game = globalThis.game;
	if (!game?.user?.isGM || !isTableMomentsOn()) return false;
	const view = momentView(payload);
	if (!view) return false;
	game.socket?.emit?.(MOMENT_SOCKET, {
		action: MOMENT_PLAY,
		kind: view.kind,
		title: typeof payload.title === "string" ? payload.title : "",
		sub: typeof payload.sub === "string" ? payload.sub : "",
		userId: game.user.id,
	});
	playMoment(view);
	return true;
}

function receive(payload) {
	if (payload?.action !== MOMENT_PLAY) return;
	if (!globalThis.game?.users?.get?.(payload.userId)?.isGM) return;
	if (!isTableMomentsOn()) return;
	playMoment(momentView(payload));
}

/** Listen on every client, GM and player alike. Once, at `ready`. */
export function registerMomentBroadcast() {
	if (registered) return;
	registered = true;
	globalThis.game?.socket?.on?.(MOMENT_SOCKET, receive);
}

/** Test seam: let the next registerMomentBroadcast listen again. */
export function _resetMomentBroadcast() {
	registered = false;
}
