import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RULEBOOKS_SETTING, FORGOTTEN_RULEBOOKS_SETTING, rulebookPath, saveRulebookPath, wasRulebookForgotten } from "../../module/books/rulebooks.js";
import { adoptStoredRulebooks, rulebooksInListing } from "../../module/books/adopt-stored-rulebooks.js";

// A second world opens the books the first one kept.
//
// The pointer is per world but the copy is not: book-store.js writes `stonetop-books/book-i.pdf`
// at the top of the data folder. A new world used to show the GM Toolkit's book icons dimmed with
// both files sitting right there (user, 2026-10-11), while the art from the same import came
// across on its own.

let browse, notifications, store;

beforeEach(() => {
	browse = vi.fn(async () => ({ files: ["stonetop-books/book-i.pdf", "stonetop-books/book-ii.pdf"] }));
	globalThis.FilePicker = { browse };
	notifications = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	global.ui = { ...(global.ui ?? {}), notifications };
	global.game.user = { id: "gm", isGM: true };
	global.game.users = { activeGM: { id: "gm" } };
	store = new Map([[RULEBOOKS_SETTING, {}]]);
	game.settings = {
		get: (_scope, key) => store.get(key),
		set: (_scope, key, value) => { store.set(key, value); return Promise.resolve(value); },
	};
});

afterEach(() => {
	delete globalThis.FilePicker;
	delete global.game.user;
	delete global.game.users;
	delete game.settings;
});

describe("picking up books another world kept", () => {
	it("records both books a new world finds on the server, and says so once", async () => {
		expect(await adoptStoredRulebooks()).toEqual([1, 2]);
		expect(rulebookPath(1)).toBe("stonetop-books/book-i.pdf");
		expect(rulebookPath(2)).toBe("stonetop-books/book-ii.pdf");
		expect(notifications.info).toHaveBeenCalledTimes(1);
	});

	it("leaves a book the world already points at alone, wherever it points", async () => {
		store.set(RULEBOOKS_SETTING, { 1: "my-books/stonetop.pdf" });
		expect(await adoptStoredRulebooks()).toEqual([2]);
		expect(rulebookPath(1)).toBe("my-books/stonetop.pdf");
	});

	it("does not even look when the world has both books", async () => {
		store.set(RULEBOOKS_SETTING, { 1: "a.pdf", 2: "b.pdf" });
		expect(await adoptStoredRulebooks()).toEqual([]);
		expect(browse).not.toHaveBeenCalled();
	});

	// Forget deletes the pointer and leaves the file, so without a marker the next reload would
	// quietly put the book back.
	it("keeps a Forgotten book forgotten, until the GM picks it again", async () => {
		await saveRulebookPath(1, "");
		expect(wasRulebookForgotten(1)).toBe(true);
		expect(await adoptStoredRulebooks()).toEqual([2]);
		expect(rulebookPath(1)).toBe("");

		await saveRulebookPath(1, "stonetop-books/book-i.pdf");
		expect(wasRulebookForgotten(1)).toBe(false);
		expect(store.get(FORGOTTEN_RULEBOOKS_SETTING)).toEqual({});
	});

	it("is quiet when nothing was ever kept on this server", async () => {
		browse.mockRejectedValue(new Error("no such directory"));
		expect(await adoptStoredRulebooks()).toEqual([]);
		expect(rulebookPath(1)).toBe("");
		expect(notifications.info).not.toHaveBeenCalled();
	});

	// The Forge puts the upload in its Assets Library and answers "empty" about the data-relative
	// folder `ensureDataDir` made, so the folder is asked again behind the host's prefix.
	it("finds books a host keeps behind its prefix, and points at the served copy", async () => {
		const served = "https://assets.example.test/u1/stonetop-books/book-i.pdf";
		store.set("book2ArtPrefix", "https://assets.example.test/u1/");
		browse.mockImplementation(async (_source, target) => ({
			files: target.startsWith("https://") ? [served] : [],
		}));
		expect(await adoptStoredRulebooks()).toEqual([1]);
		expect(rulebookPath(1)).toBe(served);
	});

	it("does not overwrite a book the GM answered for while the folder was being read", async () => {
		let release;
		browse.mockImplementation(() => new Promise(resolve => {
			release = () => resolve({ files: ["stonetop-books/book-i.pdf", "stonetop-books/book-ii.pdf"] });
		}));
		const adopting = adoptStoredRulebooks();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		await saveRulebookPath(1, "my-books/stonetop.pdf");
		await saveRulebookPath(2, "");
		release();
		expect(await adopting).toEqual([]);
		expect(rulebookPath(1)).toBe("my-books/stonetop.pdf");
		expect(wasRulebookForgotten(2)).toBe(true);
		expect(notifications.info).not.toHaveBeenCalled();
	});

	it("is only done by the primary GM", async () => {
		global.game.users = { activeGM: { id: "other-gm" } };
		expect(await adoptStoredRulebooks()).toEqual([]);
		global.game.user = { id: "player", isGM: false };
		expect(await adoptStoredRulebooks()).toEqual([]);
		expect(browse).not.toHaveBeenCalled();
	});
});

describe("writing the records", () => {
	// Each write rebuilds the whole record, so two at once used to drop one book.
	it("keeps both books when two are saved at the same moment", async () => {
		game.settings.set = (_scope, key, value) => new Promise(resolve => setTimeout(() => {
			store.set(key, value); resolve(value);
		}, 5));
		await Promise.all([saveRulebookPath(1, "a.pdf"), saveRulebookPath(2, "b.pdf")]);
		expect(rulebookPath(1)).toBe("a.pdf");
		expect(rulebookPath(2)).toBe("b.pdf");
	});

	it("fails a Forget whose marker could not be saved, and keeps the book", async () => {
		store.set(RULEBOOKS_SETTING, { 1: "a.pdf" });
		const set = game.settings.set;
		game.settings.set = (scope, key, value) => key === FORGOTTEN_RULEBOOKS_SETTING
			? Promise.reject(new Error("refused")) : set(scope, key, value);
		await expect(saveRulebookPath(1, "")).rejects.toThrow("refused");
		expect(rulebookPath(1)).toBe("a.pdf");
		// And the queue is not left stuck behind the failure.
		game.settings.set = set;
		await saveRulebookPath(2, "b.pdf");
		expect(rulebookPath(2)).toBe("b.pdf");
	});
});

describe("which files in the folder are rulebooks", () => {
	// A hosted setup lists the full served URL, and that is what the reader has to fetch.
	it("keeps the path the host listed, not one rebuilt from the folder name", () => {
		const url = "https://assets.example.test/u1/stonetop-books/book-ii.pdf";
		expect(rulebooksInListing([url])).toEqual({ 2: url });
	});

	it("matches only the fixed names the store writes", () => {
		expect(rulebooksInListing([
			"stonetop-books/Book_I_-_Stonetop_(spreads).pdf",
			"stonetop-books/book-iii.pdf",
			"stonetop-books/book-i.pdf.bak",
		])).toEqual({});
		expect(rulebooksInListing(["stonetop-books/BOOK-I.PDF?v=2"])).toEqual({ 1: "stonetop-books/BOOK-I.PDF?v=2" });
	});

	it("answers nothing for no listing", () => {
		expect(rulebooksInListing(undefined)).toEqual({});
	});
});
