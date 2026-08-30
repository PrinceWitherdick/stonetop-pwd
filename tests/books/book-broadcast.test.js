import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../module/books/BookReaderWindow.js", () => ({ openBookReader: vi.fn() }));

import {
	BOOK_SOCKET, SHOW_BOOK, showBookToPlayers, registerBookBroadcast,
} from "../../module/books/book-broadcast.js";
import { RULEBOOKS_SETTING } from "../../module/books/rulebooks.js";
import { openBookReader } from "../../module/books/BookReaderWindow.js";

// The listener, plus a way to let the dynamic import inside it settle. `receive` imports the
// reader window lazily, so a message is answered a microtask or two after it arrives.
let handler;
const deliver = async (payload) => { handler(payload); await new Promise(r => setTimeout(r, 0)); };

function withBooks(paths = {}) {
	game.settings = { get: (_scope, key) => (key === RULEBOOKS_SETTING ? paths : undefined) };
}

beforeEach(() => {
	vi.mocked(openBookReader).mockClear();
	withBooks({ 1: "books/one.pdf" });
	game.users = { get: (id) => ({ gm: { isGM: true }, player: { isGM: false } }[id] ?? null) };
	game.socket = { emit: vi.fn(), on: (_channel, fn) => { handler = fn; } };
	registerBookBroadcast();
});

afterEach(() => { delete game.settings; delete game.user; delete game.users; delete game.socket; });

describe("showing players a page", () => {
	it("sends the book, the page and who sent it, on the system's own channel", () => {
		game.user = { isGM: true, id: "gm" };
		expect(showBookToPlayers(1, 91)).toBe(true);
		expect(game.socket.emit).toHaveBeenCalledWith(BOOK_SOCKET, {
			action: SHOW_BOOK, book: 1, page: 91, userId: "gm",
		});
	});

	// A player's screen is not theirs to open.
	it("is a GM's move to make", () => {
		game.user = { isGM: false, id: "player" };
		expect(showBookToPlayers(1, 91)).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
	});

	it("sends nothing for a page that is not one", () => {
		game.user = { isGM: true, id: "gm" };
		expect(showBookToPlayers(1, 0)).toBe(false);
		expect(showBookToPlayers(1, undefined)).toBe(false);
		expect(game.socket.emit).not.toHaveBeenCalled();
	});
});

describe("being shown a page", () => {
	it("opens the book at the page the GM is on", async () => {
		await deliver({ action: SHOW_BOOK, book: 1, page: 91, userId: "gm" });
		expect(openBookReader).toHaveBeenCalledWith(1, { page: 91 });
	});

	// A window opening itself on every screen at the table should have exactly one source.
	it("ignores a message that did not come from a GM", async () => {
		await deliver({ action: SHOW_BOOK, book: 1, page: 91, userId: "player" });
		await deliver({ action: SHOW_BOOK, book: 1, page: 91 });
		expect(openBookReader).not.toHaveBeenCalled();
	});

	// The channel is the system's, not this feature's: anything else on it is somebody else's.
	it("ignores anything that is not this message", async () => {
		await deliver({ action: "somethingElse", book: 1, page: 91, userId: "gm" });
		await deliver(undefined);
		expect(openBookReader).not.toHaveBeenCalled();
	});

	// The GM's setup being incomplete is not this client's error to report.
	it("is a quiet no-op when the world has no copy of that book", async () => {
		withBooks({});
		await deliver({ action: SHOW_BOOK, book: 1, page: 91, userId: "gm" });
		expect(openBookReader).not.toHaveBeenCalled();
	});
});
