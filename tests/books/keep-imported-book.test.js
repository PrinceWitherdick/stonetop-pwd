import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RULEBOOKS_SETTING, rulebookPath } from "../../module/books/rulebooks.js";
import { keepRulebook } from "../../module/books/book-store.js";
import { rulebookMacroApi } from "../../module/books/rulebook-api.js";

// One book, supplied once.
//
// A GM who owns Book I used to have to hand it over TWICE: once to the Import Book Art macro, so
// it could cut the illustrations out of it, and again under "Your rulebooks" so the reader could
// open it. Same 60 MB file, two windows, no reason a GM could see. The macro now offers to keep
// the file it has already been given, and reaches the reader through `game.stonetop.rulebooks`.
//
// The failure this guards is quiet on both sides. A path recorded for a file the host refused to
// write leaves a book icon that opens an empty reader; and the shipped macro is REGENERATED from
// a source outside this repo, so the wiring can be deleted wholesale by a stale rebuild without a
// single test going red anywhere near it.

let upload, notifications, store;

beforeEach(() => {
	upload = vi.fn(async (_source, dir, file) => ({ path: `${dir}/${file.name}` }));
	globalThis.FilePicker = { upload, createDirectory: vi.fn(async () => ({})) };
	notifications = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	global.ui = { ...(global.ui ?? {}), notifications };
	global.game.user = { isGM: true };
	store = new Map([[RULEBOOKS_SETTING, {}]]);
	game.settings = {
		get: (_scope, key) => store.get(key),
		set: (_scope, key, value) => { store.set(key, value); return Promise.resolve(value); },
	};
});

afterEach(() => {
	delete globalThis.FilePicker;
	delete global.game.user;
	delete game.settings;
});

const pdf = (name = "Stonetop_Book_I.pdf") =>
	new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });

describe("keeping a book the importer was handed", () => {
	it("copies it in and writes down where it landed", async () => {
		const at = await keepRulebook(1, pdf());
		expect(at).toBe("stonetop-books/book-i.pdf");
		expect(rulebookPath(1)).toBe("stonetop-books/book-i.pdf");
	});

	// A refused upload does NOT throw: Foundry answers false, and The Forge answers false on
	// every failure path it has. Recording the path anyway is how a world comes to point at a
	// file nobody wrote, and the only symptom is a book icon opening a reader that shows nothing.
	it("records nothing when the host refuses the upload", async () => {
		upload.mockResolvedValue(false);
		expect(await keepRulebook(1, pdf())).toBeNull();
		expect(rulebookPath(1)).toBe("");
		expect(notifications.error).toHaveBeenCalled();
	});
});

describe("what the macro can ask of the reader", () => {
	it("offers to keep a book the reader knows", () => {
		const api = rulebookMacroApi();
		expect(api.canKeep(1)).toBe(true);
		expect(api.canKeep(2)).toBe(true);
	});

	// The macro also reads the free GM playbook as `book: 3`, and no icon anywhere opens that:
	// keeping a copy would upload a file this world could never show anyone. The macro asks the
	// reader rather than carrying its own list, so the day a third book gets an icon, the offer
	// appears by itself.
	it("refuses a book nothing can open", () => {
		expect(rulebookMacroApi().canKeep(3)).toBe(false);
	});

	it("refuses a user who may not write files", () => {
		global.game.user = { isGM: false, can: () => false };
		expect(rulebookMacroApi().canKeep(1)).toBe(false);
	});

	// Re-checked at the moment of writing, not trusted from the caller: the macro decides what to
	// OFFER when it draws its window, and the run that follows can finish minutes later.
	it("writes nothing for a book it would not have offered", async () => {
		const api = rulebookMacroApi();
		expect(await api.keep(3, pdf())).toBeNull();
		global.game.user = { isGM: false, can: () => false };
		expect(await api.keep(1, pdf())).toBeNull();
		expect(upload).not.toHaveBeenCalled();
	});

	it("reports what the world already holds", async () => {
		const api = rulebookMacroApi();
		expect(api.has(1)).toBe(false);
		await api.keep(1, pdf());
		expect(api.has(1)).toBe(true);
	});
});

// The macro ships as a COMMAND STRING in a compendium document, generated outside this repo by
// `scripts/local/book2-art/gen-pack-macro.js` in the pre-rename folder. That generator has
// already, once, been run from an input that had fallen behind the shipped file and silently
// deleted features from it. Nothing in the running system imports this string, so a rebuild that
// drops this wiring would go unnoticed until a GM was asked for their book twice again.
describe("the shipped macro's half of it", () => {
	const command = JSON.parse(fs.readFileSync(
		path.resolve(__dirname, "../../packs/src/stonetop-macros/import-book2-art.json"), "utf8")).command;

	it("asks the reader whether a book can be kept, rather than deciding alone", () => {
		expect(command).toContain("game.stonetop?.rulebooks");
		expect(command).toContain("READER?.canKeep?.(b)");
	});

	it("offers the tick-box, ticked", () => {
		expect(command).toContain('name="keep-book-${b}" checked');
		expect(command).toContain('[name="keep-book-${b}"]');
	});

	it("hands the file over and says so in the ending", () => {
		expect(command).toContain("READER.keep(book, file)");
		expect(command).toContain("Kept to read in Foundry:");
	});

	// A caller that skips the setup window (the People gallery's empty state) has no box to tick,
	// and the answer it wants is yes: it asked a GM for a book they own.
	it("defaults a handed-over pick to keeping the book", () => {
		expect(command).toContain("map((p) => ({ keep: true, ...p }))");
	});
});
