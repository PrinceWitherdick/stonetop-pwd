import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { IMPORT_BOOKS } from "../../module/book2-art/macro.js";
import { BOOK2_ART_APPLY_MANIFEST } from "../../module/book2-art/manifest.js";

// Starting the book import from somewhere OTHER than the importer's own window.
//
// The People of Stonetop gallery asks for the rulebooks in its own empty state and runs the
// import on them, because a GM standing in front of an empty gallery has already been told what
// is missing and does not need to be asked again on page two of a five-page sheet. That works by
// a handoff: `Macro#execute(scope)` turns each key of the scope into a variable inside the
// command, so the caller passes `stonetopPicks` and the macro skips its dialog.
//
// Every joint in that chain fails SILENTLY if it slips. A macro that stops reading the scope
// opens its window instead, which looks like the old behaviour rather than like a bug; a caller
// that stops passing it runs an import with no books and reports "nothing chosen"; a field
// renamed on one side of the collection is a book quietly dropped from a two-minute run. So this
// reads the SHIPPED command, which is what a world actually executes, and the shipped template,
// which is where the names are written down.

const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;
const MACRO_JS = read("module/book2-art/macro.js");
const GALLERY_JS = read("module/actors/steading/PeopleGalleryDialog.js");
const GALLERY_HBS = read("templates/dialogs/people-gallery.hbs");

describe("handing the importer its answers", () => {
	it("lets the shipped macro be given picks instead of asking for them", () => {
		// `typeof`, not a bare read: the macro is meant to stay pasteable into a console, where
		// there is no `scope` at all and any other test on an undeclared name throws.
		expect(COMMAND).toContain('const handedPicks = (typeof scope === "object" && scope) ? scope.stonetopPicks : null;');
	});

	it("skips the setup window only when it was given something", () => {
		// One expression, so there is exactly one `picks` and everything downstream of it cannot
		// tell which door the run came through.
		expect(COMMAND).toContain("const picks = handedPicks ? { books: [], force: false, maps: NO_MAPS, ...handedPicks } : await foundry.applications.api.DialogV2.wait({");
		// And the window is still the default: nothing handed over, nothing skipped.
		expect(COMMAND).not.toContain("const picks = handedPicks ??");
	});

	it("defaults every key the caller left out, so a partial handoff cannot run wild", () => {
		// A handoff carrying only books must not arrive as an undefined `maps` (the run reads
		// `maps.picks`) or a truthy `force` (which would re-extract 140 images nobody asked for).
		const at = COMMAND.indexOf("const picks = handedPicks ?");
		const line = COMMAND.slice(at, COMMAND.indexOf("\n", at));
		expect(line).toContain("books: []");
		expect(line).toContain("force: false");
		expect(line).toContain("maps: NO_MAPS");
		// Spread LAST, or the defaults would overwrite what the caller actually supplied.
		expect(line.indexOf("...handedPicks")).toBeGreaterThan(line.indexOf("maps: NO_MAPS"));
	});

	it("passes the picks through the scope the macro reads them from", () => {
		expect(MACRO_JS).toContain("return macro.execute(picks ? { stonetopPicks: picks } : {});");
	});

	// A world seeded before the handoff existed still holds the old command, which names no
	// `stonetopPicks`. Passing the key regardless would compile an argument the command never
	// reads; passing nothing leaves that world exactly where it was, with its window.
	it("hands over nothing at all when there is nothing to hand over", () => {
		expect(MACRO_JS).toMatch(/runImportBookArtMacro\(picks = null\)/);
	});
});

describe("the books a surface asks for on the macro's behalf", () => {
	it("names the two rulebooks, in book order, by the numbers the handoff is keyed on", () => {
		expect(IMPORT_BOOKS.map((b) => b.book)).toEqual([1, 2]);
		expect(IMPORT_BOOKS[0].title).toContain("Book I");
		expect(IMPORT_BOOKS[1].title).toContain("Book II");
	});

	// The free GM playbook is in the macro's own table and deliberately not in this one: it is a
	// separate errand, wanted for five specific pictures and no faces at all.
	it("leaves the GM playbook to the window that already offers it", () => {
		expect(IMPORT_BOOKS.some((b) => b.book === 3)).toBe(false);
		expect(GALLERY_HBS).toContain("More import options");
	});

	// The reminder that costs a GM a minute of their life when it is missing. Every page number
	// and rect the importer works from was measured on the "spreads" sheet, and the macro REFUSES
	// a rulebook handed to it 1-up rather than fill the world with the wrong pictures. A field
	// that just says "Book I" invites exactly the file that gets rejected.
	it("names the edition, on every book it asks for", () => {
		for (const b of IMPORT_BOOKS) {
			expect(b.edition, `book ${b.book}`).toContain('"spreads"');
			// And says what "spreads" MEANS, since a GM looking at their own file has a page
			// count and a shape, not a word the publisher used.
			expect(b.edition, `book ${b.book}`).toMatch(/two printed pages side by side/);
		}
	});

	it("names it with the page count the macro actually validates against", () => {
		// Not a second copy of the number: both come off the shipped manifest, which is generated
		// from the same manifest.json meta the macro's own check reads. A copy written out by hand
		// would drift, and the drifted one tells a GM their correct file is the wrong one.
		for (const b of IMPORT_BOOKS) {
			const pages = BOOK2_ART_APPLY_MANIFEST.expectedPdfPages?.[b.book];
			expect(pages, `book ${b.book} has no expected page count`).toBeGreaterThan(0);
			expect(b.edition).toContain(`${pages}-page`);
			// The same number the macro warns on, spelled the same way it spells it.
			expect(COMMAND).toContain(`"expectedPdfPages${b.book === 1 ? "Book1" : ""}":${pages}`);
		}
	});

	it("puts the edition where the GM is about to choose a file", () => {
		expect(GALLERY_HBS).toContain('class="stonetop-people-book-edition">{{edition}}');
	});

	it("keeps its copy free of em dashes, like everything else the gallery says", () => {
		for (const b of IMPORT_BOOKS) {
			expect(b.title).not.toContain("—");
			expect(b.note).not.toContain("—");
			expect(b.edition).not.toContain("—");
		}
	});
});

describe("the gallery's own book fields", () => {
	// The template writes the name, the dialog reads it back. Written twice, they can drift, and a
	// drifted name is a book silently dropped rather than an error.
	it("names each field by its book number, on both sides", () => {
		expect(GALLERY_HBS).toContain('name="stonetop-book-file-{{book}}"');
		expect(GALLERY_JS).toContain('`[name="stonetop-book-file-${book}"]`');
	});

	it("accepts only PDFs", () => {
		expect(GALLERY_HBS).toMatch(/type="file" name="stonetop-book-file-\{\{book\}\}" accept="application\/pdf,\.pdf"/);
	});

	it("reads the files BEFORE it closes", () => {
		// Closing empties the DOM, and a File read out of a detached input is nothing: collect,
		// then close, then run.
		const body = GALLERY_JS.slice(GALLERY_JS.indexOf("async _importBookArt("));
		const collect = body.indexOf("_chosenBooks(root)");
		const close = body.indexOf("this.close()");
		expect(collect).toBeGreaterThan(-1);
		expect(close).toBeGreaterThan(collect);
	});

	it("runs the import rather than opening the importer's window", () => {
		// The whole point of the change: the button that says "Import Book Art" imports book art.
		expect(GALLERY_JS).toContain("return runImportBookArtMacro(books.length ? { books } : null);");
	});

	// The window is still reachable, for the poster maps and the playbook, but from a door of its
	// own rather than from the button that promises an import.
	it("keeps the full window on a separate button", () => {
		expect(GALLERY_HBS).toContain('class="stonetop-people-import-more"');
		expect(GALLERY_JS).toContain("_importMoreOptions()");
	});

	// A file field cannot be given its selection back from script, so a re-render of the empty
	// state would silently drop the book the GM had just chosen.
	it("never re-renders the panel while a book is sitting in it", () => {
		const wiring = GALLERY_JS.slice(GALLERY_JS.indexOf("_activateBookImport(root) {"),
			GALLERY_JS.indexOf("_visiblePicks()"));
		expect(wiring).not.toContain("this.render(");
	});
});
