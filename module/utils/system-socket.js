// The system's one socket channel, shared by every table broadcast (the rulebook page, End of
// Session, table moments). Each feature listens for its own actions and ignores the rest.
// Guarded by tests/utils/system-socket.test.js.
import { SYSTEM_ID } from "../system-id.js";

/** The channel. `"socket": true` in system.json is what opens it. */
export const SYSTEM_SOCKET = `system.${SYSTEM_ID}`;

/**
 * Send one message to every other client (a sender never receives its own emit).
 *
 * Who sent it is carried IN the payload: Foundry relays a system message's arguments verbatim and
 * does not append the sender, so a receiver that wants to know has to be told.
 */
export function emitSystemMessage(action, fields = {}) {
	const game = globalThis.game;
	game?.socket?.emit?.(SYSTEM_SOCKET, { ...fields, action, userId: game?.user?.id });
}

/**
 * Whether a message says a GM sent it. The receiver takes the sender's word, since a socket is
 * open to anyone signed in and there is no proving otherwise. It is not a permission gate; it is
 * what keeps a stray message on the channel from opening a window on every screen.
 */
export function sentByGM(payload) {
	return !!globalThis.game?.users?.get?.(payload?.userId)?.isGM;
}

/** Listen for one action, or several, on the channel. */
export function onSystemMessage(actions, handler) {
	const wanted = new Set([actions].flat());
	globalThis.game?.socket?.on?.(SYSTEM_SOCKET, payload => {
		if (wanted.has(payload?.action)) return handler(payload);
	});
}
