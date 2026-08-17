import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// The Import Book Art wizard's pages are three separate errands: the rulebooks you bought, the
// free GM playbook, and your own poster-map files. None of them needs the others, so each page
// carries an Import button that runs THAT page and closes, and the last page's "Import Art" still
// runs the lot.
//
// Everything here fails silently if it breaks. A button that submits more than its page starts a
// 1-2 minute run over PDFs the GM did not mean to hand over; one that submits less imports
// nothing and reports success; one that stays visible on every page turns a wizard into four
// buttons that all look like the finish line. So this file reads the SHIPPED macro command, which
// is what a world actually executes, rather than any local copy of its source.

const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;

/** The rail-entry literal for one panel, up to its closing brace. */
function section(key) {
	const at = COMMAND.indexOf(`key: "${key}",`);
	expect(at, `there is no "${key}" rail entry`).toBeGreaterThan(-1);
	return COMMAND.slice(at, COMMAND.indexOf("}", at));
}

/** Pages that take files, and pages that do not. */
const INPUT_PAGES = ["books", "playbook", "maps"];
const EMPTY_PAGES = ["overview", "ready"];

describe("importing one page at a time", () => {
	it("offers it on every page that takes files, and on no other", () => {
		for (const key of INPUT_PAGES) expect(section(key), key).toMatch(/runLabel: "[^"]+"/);
		// A run button on a page holding no inputs would submit an empty selection, which the
		// macro answers with "nothing chosen" — an offer that can only ever fail.
		for (const key of EMPTY_PAGES) expect(section(key), key).not.toContain("runLabel");
	});

	// A button inside the panel body could not end the dialog: ApplicationV2 dispatches on
	// `[data-action]`, and everything downstream of `picks` is written against a dialog that has
	// closed with an answer. So these are declared buttons, built from the same section table that
	// draws the rail, rather than markup in the panel.
	it("declares them as real dialog buttons, one per page, off the section table", () => {
		expect(COMMAND).toContain("SETUP_SECTIONS.filter((s) => s.runLabel).map((s) => ({");
		expect(COMMAND).toContain("action: `run-${s.key}`");
		expect(COMMAND).toContain("callback: (event, button, dialog) => collectPage(dialog, s.key)");
	});

	// The whole promise of the button is that it does not touch what another page holds.
	it("submits that page's inputs and nothing another page holds", () => {
		expect(COMMAND).toContain('books: key === "maps" ? [] : collectBooks(dialog, key)');
		expect(COMMAND).toContain('maps: key === "maps" ? collectMaps(dialog) : NO_MAPS');
		// Scoped by the same panel-to-books answer the fields were BUILT from, so a book moved
		// between pages cannot leave its field on one page and its import on another.
		expect(COMMAND).toContain("for (const b of (key ? booksOn(key) : booksUsed))");
		// Force is the deliberate exception: it belongs to every import button alike.
		expect(COMMAND).toContain("force: collectForce(dialog)");
	});

	// Force update changes what EVERY button in this row does, so it is drawn beside them rather
	// than on a panel — which is where it was, and where a GM importing from the playbook page
	// could not see it. Both halves matter: in the footer it is reachable from every page, and
	// built by hand it submits nothing (a declared DialogV2 button would start the run).
	it("puts Force update in the footer, beside Cancel, and not inside a panel", () => {
		expect(COMMAND).toContain('force.className = "stbook-setup-force"');
		expect(COMMAND).toContain('box.name = "force-update"');
		expect(COMMAND).toContain("cancel.after(force)");
		// Not a declared button, and not markup in any panel body.
		expect(COMMAND).not.toContain('action: "force-update"');
		expect(COMMAND).not.toMatch(/<input type="checkbox" name="force-update">/);
		// Read wherever it sits, which is what lets one selector serve the footer and every
		// button that submits.
		expect(COMMAND).toContain(`querySelector?.('[name="force-update"]')?.checked`);
	});

	// "Import Art" appears on the last panel only, so the last panel has to be one whose job is to
	// be the end. It was Options, which held nothing but the tick-box now in the footer; it is now
	// a recap, painted from the same count as the rail badges so the two cannot disagree.
	it("ends the rail on a page that recaps what was supplied", () => {
		expect(section("ready")).toContain('title: "Ready to import"');
		expect(COMMAND).toContain("const READY_ROWS = [");
		expect(COMMAND).toContain("const paintReady = (root) => {");
		// Painted from paintBadges, so a page stepped away from still shows up here.
		expect(COMMAND).toMatch(/run\.disabled = !n;\s*\n\s*}\s*\n\s*paintReady\(root\);/);
		expect(COMMAND).toContain("filledOn(root, r.key)");
	});

	// A page's own Import button hands the run ONE book. Every row out of the other two is then a
	// row this run was never asked for — not a failure. Counting them as failures is what turned a
	// clean five-image playbook import into "Images written: 5/550 (545 failed)" over a wall of
	// "(Book I not provided)", which reads as a catastrophe and buries anything real.
	it("does not count the books it was not given as failures", () => {
		expect(COMMAND).toContain("if (!pdfByBook.has(w.book)) { unasked++;");
		// Dropped the way an already-on-disk row is, `available` included, so a partial run still
		// wires the art the world already has instead of quietly un-pointing every journal page.
		expect(COMMAND).toContain("if (existingFiles.has(keyOf(w.out))) available.add(w.out); continue; }");
		// Gated on the documents that LOADED, exactly like artRun: a file that turned out to be
		// unreadable has already said so once, in a notification naming it.
		expect(COMMAND).toContain("const artRun = pdfByBook.size > 0;");
		// The old wording is gone with the old behaviour, rather than left on a branch that would
		// print it again.
		expect(COMMAND).not.toContain("not provided)");
		// Said once, as its own line, so a partial run explains its own arithmetic.
		expect(COMMAND).toContain("come from books not supplied this run; left alone");
	});

	// A short report is not a broken one either. With one book supplied, four of the summary lines
	// still read zero ("Monster portraits: 0 actors, 0 journal pages"), which is the same lie the
	// failure count told: work that was never asked for, presented as work that did not happen. So
	// a count line appears only when it has something to say, which is the rule the other ten lines
	// already followed, and the run names what it read and what it did not.
	it("reports a partial run as a short errand, not a mostly-empty one", () => {
		expect(COMMAND).toContain("`Read: ${andList(booksRead)}`");
		expect(COMMAND).toContain("Not supplied this time: ${andList(booksMissed)}. That art was left exactly as it is.");
		for (const line of [
			"actorsUpdated + besPages > 0 ? `Monster portraits:",
			"locPages ? `Location art:",
			"worldJournalPages ? `World journals synced:",
			"worldActors ? `World actors synced:",
		]) expect(COMMAND, line).toContain(line);
		// None may go back to printing on artRun alone, which is what made them read zero.
		expect(COMMAND).not.toMatch(/artRun \? `(Monster portraits|Location art)/);
		// The reassurance names the books, never the row count: "545 images not imported" is the
		// exact number that made a five-image run read as a disaster.
		expect(COMMAND).not.toMatch(/\$\{unasked\}[^`]*not imported/);
	});

	// "Import Art" is unchanged: the last page still runs everything, unscoped.
	it("leaves the whole-run button running the whole thing", () => {
		expect(COMMAND).toContain("({ books: collectBooks(dialog), force: collectForce(dialog), maps: collectMaps(dialog) })");
	});

	// Declared AFTER the submit, which is what puts each page's import to the right of Back/Next
	// (the render hook inserts those before `[data-action="ok"]`), so the rightmost button in the
	// row is always the one that applies to the page you are on.
	it("sits at the end of the footer row, where the finishing button sits", () => {
		expect(COMMAND.indexOf('action: "ok"')).toBeLessThan(COMMAND.indexOf("action: `run-${s.key}`"));
	});

	it("shows only the one belonging to the page on screen", () => {
		expect(COMMAND).toContain("run.hidden = s.key !== sec.key;");
	});

	// Hidden, never removed, for the same reason Import Art is: DialogV2's submit handler walks
	// every declared action and disables its button.
	it("keeps every one of them in the DOM", () => {
		expect(COMMAND).not.toMatch(/run\.remove\(\)/);
	});

	// An enabled "Import these maps" over an empty page opens a progress window that imports
	// nothing. The count that decides this is the same one painted on the rail badge.
	it("cannot be pressed on a page with nothing filled in", () => {
		expect(COMMAND).toContain("run.disabled = !n;");
		expect(COMMAND).toContain("const n = filledOn(root, s.key);");
		// Settled once against the empty sheet the dialog opens on, or every button starts live.
		expect(COMMAND).toMatch(/showPanel\(root, SETUP_SECTIONS\[0\]\.key\);\s*\n\s*paintBadges\(root\);/);
	});

	// A button that appears on one page and not another reads as furniture. The point of it is
	// knowing you are ALLOWED to leave, which only words can say.
	it("says on each page that stopping there is allowed, and what the alternative is", () => {
		for (const key of INPUT_PAGES) expect(COMMAND, key).toContain(`runHint("${key}")`);
		expect(COMMAND).toContain("You can stop here.");
		expect(COMMAND).toContain("<strong>Import Art</strong> on the last page runs everything");
		// ...and the hint names the button by the same label the button is drawn with.
		expect(COMMAND).toContain("<em>${esc(s.runLabel)}</em>");
	});

	// The offer is the one thing on the page that must not read as an aside, so it is deliberately
	// not a `.stbook-setup-note` (which is muted small grey) and has a style of its own.
	it("is drawn as a callout rather than another muted aside", () => {
		expect(COMMAND).toContain(".stbook-setup-runhint{");
		expect(COMMAND).not.toContain('class="stbook-setup-note stbook-setup-runhint"');
	});
});
