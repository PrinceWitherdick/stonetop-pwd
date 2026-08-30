// "Show Players": the page the GM is reading, opened on everybody else's screen.
//
// The whole feature is one message. There is no shared state to keep in step, no window to
// keep alive on the other end, and nothing to undo: a GM says "look at this page", every
// other client opens its own reader at that page, and from then on each reader is that
// reader's own. Turning the GM's page afterwards does NOT drag the table along, which is the
// behaviour a table wants -- a player who flipped back a page to re-read a move should not be
// yanked forward again by the GM scrolling.
//
// WHY A SOCKET AND NOT A SETTING. Writing the page into a world setting would broadcast it
// too, but it would also PERSIST: a player logging in an hour later would have last night's
// page shoved at them. This is an event, so it is sent as one. `"socket": true` is already
// declared in system.json.
//
// WHAT THE PLAYERS NEED. Nothing of their own. The book path is a world setting and the file
// lives in this world's data (see the head of rulebooks.js, and the copy in RulebooksDialog
// that says so out loud), so the URL the GM is reading is a URL every signed-in client can
// fetch. A world whose GM never pointed at a copy has no path, `openBookReader` answers null,
// and the message lands as a no-op rather than an error.
import { SYSTEM_ID } from "../system-id.js";
import { rulebookPath } from "./rulebooks.js";

/** The socket channel this system talks on, and the one message sent over it. */
export const BOOK_SOCKET = `system.${SYSTEM_ID}`;
export const SHOW_BOOK = "showBook";

/**
 * Send one page of one book to every other client.
 *
 * GM-only at the source, and checked again on arrival: a socket is open to anyone signed in,
 * so "only the GM can do this" has to be true on the receiving end or it is not true at all.
 */
export function showBookToPlayers(book, page) {
	if (!globalThis.game?.user?.isGM) return false;
	const n = Number(page);
	if (!Number.isFinite(n) || n < 1) return false;
	globalThis.game?.socket?.emit?.(BOOK_SOCKET, {
		action: SHOW_BOOK, book: Number(book), page: Math.trunc(n),
		// Who sent it, carried IN the payload: Foundry relays a system message's arguments
		// verbatim and does not append the sender, so a receiver that wants to know has to be
		// told. See `receive` for what that check is and is not worth.
		userId: globalThis.game?.user?.id,
	});
	return true;
}

/**
 * Open the book a GM just pointed at, on this client.
 *
 * Imported lazily because this module is registered at boot and BookReaderWindow drags in the
 * dialog base, the sheet chrome and the setup dialog behind it -- none of which a client that
 * is never shown a page needs to have loaded.
 */
async function receive(payload) {
	if (payload?.action !== SHOW_BOOK) return;
	// The sender says it is a GM and we take its word for it, because a socket is open to
	// anyone signed in and there is no way to prove otherwise from here. Worth having anyway:
	// this is not a permission gate, it is what keeps an unrelated message on the same channel
	// from opening a book on every screen at the table.
	if (!globalThis.game?.users?.get?.(payload.userId)?.isGM) return;
	const book = Number(payload.book);
	const page = Number(payload.page);
	if (!Number.isFinite(page) || page < 1) return;
	// No copy recorded for this world means there is nothing to open, and that is a quiet
	// no-op rather than an error: it is the GM's setup that is incomplete, not this client.
	if (!rulebookPath(book)) return;
	const { openBookReader } = await import("./BookReaderWindow.js");
	openBookReader(book, { page });
}

/** Listen for the message. Called once, for every user, at `ready`. */
export function registerBookBroadcast() {
	globalThis.game?.socket?.on?.(BOOK_SOCKET, (payload) => {
		receive(payload).catch(err =>
			console.error("Stonetop | Could not open the page the GM shared.", err));
	});
}
