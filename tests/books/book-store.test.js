import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	RULEBOOK_DIR, canBrowseRulebooks, canStoreRulebook, rulebookFileName,
	storeRulebookFile, storeRulebookWithNotice,
} from "../../module/books/book-store.js";

// Copying a book off the GM's own computer into the world, which is the half the Import Book Art
// macro does not need: that one reads a PDF once and throws it away, while the reader has to be
// able to FETCH it again next session. See the head of module/books/book-store.js.

let upload, createDirectory, notifications;

beforeEach(() => {
	upload = vi.fn(async (_source, dir, file) => ({ path: `${dir}/${file.name}` }));
	createDirectory = vi.fn(async () => ({}));
	globalThis.FilePicker = { upload, createDirectory };
	notifications = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	global.ui = { ...(global.ui ?? {}), notifications };
	global.game.user = { isGM: true };
});

afterEach(() => {
	delete globalThis.FilePicker;
	delete global.game.user;
});

const pdf = (name = "Book_I_-_Stonetop_(spreads).pdf") =>
	new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });

describe("copying a rulebook into the world", () => {
	// Outside `systems/`, for the same reason the imported art's folder is: anything under the
	// system directory is at the mercy of the next update, and a GM should not have to find
	// their rulebook again because they took a patch.
	it("lands outside the system folder", () => {
		expect(RULEBOOK_DIR).toBe("stonetop-books");
		expect(RULEBOOK_DIR.startsWith("systems/")).toBe(false);
	});

	// Deterministic, so re-picking a different file OVERWRITES the one copy rather than leaving
	// a 60 MB orphan behind under its old shop filename.
	it("names the copy after the book, not after the file that was picked", async () => {
		expect(rulebookFileName(1)).toBe("book-i.pdf");
		expect(rulebookFileName(2)).toBe("book-ii.pdf");

		await storeRulebookFile(1, pdf());
		const [, dir, file] = upload.mock.calls[0];
		expect(dir).toBe(RULEBOOK_DIR);
		expect(file.name).toBe("book-i.pdf");
	});

	it("makes the folder before writing into it", async () => {
		await storeRulebookFile(2, pdf());
		expect(createDirectory).toHaveBeenCalledWith("data", RULEBOOK_DIR, {});
		expect(createDirectory.mock.invocationCallOrder[0])
			.toBeLessThan(upload.mock.invocationCallOrder[0]);
	});

	// createDirectory THROWS when the folder is already there, which is the ordinary case.
	it("carries on when the folder already exists", async () => {
		createDirectory.mockRejectedValue(new Error("EEXIST"));
		await expect(storeRulebookFile(1, pdf())).resolves.toBe(`${RULEBOOK_DIR}/book-i.pdf`);
	});

	it("answers with the path the host actually wrote to", async () => {
		// The Forge redirects a data upload into its assets library and answers with the URL it
		// serves from, which is the only thing that names the file correctly.
		upload.mockResolvedValue({ path: "https://assets.forge-vtt.com/abc/stonetop-books/book-i.pdf" });
		await expect(storeRulebookFile(1, pdf()))
			.resolves.toBe("https://assets.forge-vtt.com/abc/stonetop-books/book-i.pdf");
	});

	// A REFUSED upload does not throw: Foundry answers false and The Forge answers false on
	// every failure path it has. Recording a path to a file nobody wrote is how a book icon
	// comes to open a reader that shows nothing.
	it("answers null when the upload is refused", async () => {
		upload.mockResolvedValue(false);
		await expect(storeRulebookFile(1, pdf())).resolves.toBe(null);
	});

	it("does nothing at all with no file", async () => {
		await expect(storeRulebookFile(1, null)).resolves.toBe(null);
		expect(upload).not.toHaveBeenCalled();
	});
});

describe("what the GM is told while it copies", () => {
	// A 60 MB book takes a visible moment and Foundry shows nothing while it does, so without
	// this the button appears to have done nothing at all.
	it("says it is copying, then says it is ready", async () => {
		await storeRulebookWithNotice(1, pdf());
		expect(notifications.info).toHaveBeenCalledTimes(2);
		expect(notifications.info.mock.calls[0][0]).toContain("Copying Book I: Stonetop");
		expect(notifications.info.mock.calls[1][0]).toContain("Book I: Stonetop is ready");
		expect(notifications.error).not.toHaveBeenCalled();
	});

	it("says so, once, when the host refuses it", async () => {
		upload.mockResolvedValue(false);
		await expect(storeRulebookWithNotice(2, pdf())).resolves.toBe(null);
		expect(notifications.error).toHaveBeenCalledTimes(1);
		expect(notifications.error.mock.calls[0][0]).toContain("could not be copied");
	});

	// A thrown upload is reported the same way a refused one is, rather than escaping into a
	// click handler where nothing would catch it.
	it("reports a thrown upload rather than letting it escape", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		upload.mockRejectedValue(new Error("network"));
		await expect(storeRulebookWithNotice(1, pdf())).resolves.toBe(null);
		expect(notifications.error).toHaveBeenCalledTimes(1);
	});
});

describe("who may do which", () => {
	// Separate rights: adding a file needs FILES_UPLOAD, picking one already there needs
	// FILES_BROWSE, and a world can grant either without the other.
	it("asks about adding and about browsing separately", () => {
		global.game.user = { isGM: false, can: right => right === "FILES_UPLOAD" };
		expect(canStoreRulebook()).toBe(true);
		expect(canBrowseRulebooks()).toBe(false);

		global.game.user = { isGM: false, can: right => right === "FILES_BROWSE" };
		expect(canStoreRulebook()).toBe(false);
		expect(canBrowseRulebooks()).toBe(true);
	});

	it("lets a GM do both", () => {
		global.game.user = { isGM: true };
		expect(canStoreRulebook()).toBe(true);
		expect(canBrowseRulebooks()).toBe(true);
	});
});
