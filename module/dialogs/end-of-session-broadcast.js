// End of Session, shown to the table: the GM's window, mirrored read-only on every player's screen.
//
// The questions are the table's to answer together (Book I p.232), so the players should be
// reading them, not hearing them read out. When the GM opens End of Session, each player gets a
// copy; as the GM ticks a group question, every copy ticks with it; when the GM awards (or closes),
// every copy closes. The awarding stays the GM's alone: a player's copy has no Award button and no
// roster, only the prompts and the GM's ticks.
//
// WHY A SOCKET, the same reasoning as rulebook "Show Players" (books/book-broadcast.js): this is
// an event, not state. A world setting would also reach everyone, but it would persist, and a
// player logging in tomorrow would get last session's questions.
//
// THE RUN. Each GM window carries a random id, and every message names it. A player who closes
// their copy has closed THAT run, so the GM's next tick does not throw it back open; a GM who
// opens a fresh window starts a new run, which does. A late arrival asks once at `ready`, and a GM
// with the window open answers with where it stands.
//
// A player who runs the macro gets the same copy (requestEndOfSession): the window already up, or
// the GM asked for theirs.
//
// GM-only at the source and checked again on arrival, as the book broadcast is: a socket is open
// to anyone signed in. A GM's own client never mirrors: they have the real window, and a co-GM
// opening theirs would only get two windows fighting.
import { SYSTEM_ID } from "../system-id.js";

/** The system's socket channel (shared with books/book-broadcast.js), and the messages on it. */
export const EOS_SOCKET = `system.${SYSTEM_ID}`;
export const EOS_SHOW  = "eosShow";
export const EOS_CLOSE = "eosClose";
export const EOS_ASK   = "eosAsk";

const ACTIONS = new Set([EOS_SHOW, EOS_CLOSE, EOS_ASK]);

/** The GM's open window on this client, so a late player's ask can be answered. */
let host = null;
/** This player's copy, and the run they closed themselves (so it stays closed). */
let mirror = null;
let dismissedRun = null;
/** This player's ask still waiting on a GM's answer (requestEndOfSession), or null. */
let pendingAsk = null;
/** How long a player's ask waits for a GM's copy before telling them none came. */
export const EOS_ASK_WAIT_MS = 1500;
/** Messages handled one at a time: two quick ticks must not each open a window. */
let queue = Promise.resolve();

const isGM = () => !!globalThis.game?.user?.isGM;
const emit = payload => globalThis.game?.socket?.emit?.(EOS_SOCKET, { ...payload, userId: globalThis.game?.user?.id });

/** The GM's window drew: tell the table what it shows. False on a player's client. */
export function sendEndOfSession(win, checks) {
	if (!isGM() || !win?.run) return false;
	host = win;
	emit({ action: EOS_SHOW, run: win.run, checks: { ...checks } });
	return true;
}

/** The GM's window closed, by Award or by Close: every copy closes with it. */
export function sendEndOfSessionClosed(win) {
	if (!isGM() || !win?.run) return false;
	if (host === win) host = null;
	emit({ action: EOS_CLOSE, run: win.run });
	return true;
}

/** A player's copy closed. By the player's own hand, it stays closed for the rest of that run. */
export function mirrorClosed(win) {
	if (mirror !== win) return;
	mirror = null;
	dismissedRun = win.run;
}

/**
 * A player asked for End of Session themselves (the hotbar macro, or the macro dragged out of the
 * compendium). The window is the GM's to open, so a player never gets one of their own: their own
 * would carry the roster and an Award button that can only refuse, and the GM's copy arriving
 * after it would take over its frame (both are the one DOM id, and core's V1 render adopts an
 * element already standing under its id). So the copy already up is brought forward, or the GM is
 * asked for it, even for a run this player closed: asking for it is taking that close back.
 *
 * `onNoAnswer` runs if no copy has arrived EOS_ASK_WAIT_MS after asking: no GM has the window open.
 * Waited for rather than said at once, because a GM who has it open answers within a moment, and a
 * notice saying the window is theirs to open would then sit over the copy that just opened.
 *
 * The copy brought forward, or null once asked (null on a GM's client, which asks nobody).
 */
export function requestEndOfSession({ onNoAnswer = null } = {}) {
	if (isGM()) return null;
	if (mirror?.rendered) {
		// A minimized window is in front of nobody (utils/open-or-focus.js).
		if (mirror.minimized ?? mirror._minimized) mirror.maximize?.();
		mirror.bringToTop?.();
		return mirror;
	}
	dismissedRun = null;
	const ask = pendingAsk = { answered: false };
	emit({ action: EOS_ASK });
	if (onNoAnswer) {
		setTimeout(() => {
			if (pendingAsk === ask) pendingAsk = null;
			if (!ask.answered) onNoAnswer();
		}, EOS_ASK_WAIT_MS);
	}
	return null;
}

async function showMirror(payload) {
	if (payload.run === dismissedRun) return;
	if (pendingAsk) pendingAsk.answered = true;
	if (mirror?.run === payload.run) { await mirror.showChecks(payload.checks); return; }
	// A new run. Any copy still up is from a run whose close never reached us (the GM reloaded).
	const stale = mirror;
	mirror = null;
	await stale?.close();
	// Lazily, as the book reader is: a client nobody ever shows this to need not load the window.
	const { EndOfSessionDialog } = await import("./EndOfSessionDialog.js");
	const win = mirror = new EndOfSessionDialog({ mirror: { run: payload.run, checks: payload.checks } });
	// AWAITED, through the queue: core's `render` does not wait for its own draw, and a close or a
	// tick handled while the copy is still drawing would be dropped (see EndOfSessionDialog#settled).
	win.render(true);
	await win.settled?.();
}

async function closeMirror(payload) {
	if (payload.run === dismissedRun) dismissedRun = null;
	if (!mirror || mirror.run !== payload.run) return;
	// Cleared first, so mirrorClosed does not read the GM's close as the player's.
	const win = mirror;
	mirror = null;
	await win.close();
}

async function receive(payload) {
	if (!ACTIONS.has(payload?.action)) return;
	if (payload.action === EOS_ASK) {
		if (isGM() && host?.rendered) sendEndOfSession(host, host.groupChecks);
		return;
	}
	// Not a permission gate (see the book broadcast's `receive`): what keeps a stray message from
	// opening a window on every screen.
	if (!globalThis.game?.users?.get?.(payload.userId)?.isGM) return;
	if (isGM() || typeof payload.run !== "string") return;
	if (payload.action === EOS_SHOW) await showMirror(payload);
	else await closeMirror(payload);
}

/** Listen, and a player asks whether a GM already has the window open. Once, for every user, at `ready`. */
export function registerEndOfSessionBroadcast() {
	globalThis.game?.socket?.on?.(EOS_SOCKET, payload => {
		queue = queue.then(() => receive(payload)).catch(err =>
			console.error("Stonetop | Could not show the GM's End of Session window.", err));
	});
	if (!isGM()) emit({ action: EOS_ASK });
}

/** Test seam: forget the module's state between cases. */
export function _resetEndOfSessionBroadcast() {
	host = null; mirror = null; dismissedRun = null; pendingAsk = null; queue = Promise.resolve();
}
