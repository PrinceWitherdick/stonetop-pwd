import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";

// The Import Book Art wizard's pages are three separate errands: the rulebooks you bought, the
// free GM playbook, and your own poster-map files. None of them needs the others, so each page
// carries an Import button that lets a GM stop there, and the last page's "Import Art" is the
// same run under the name that suits a finish line.
//
// Every one of those buttons imports EVERYTHING the window is holding, not just the page it sits
// on. The page-scoped version of this read well and failed at the table: the ordinary way to fill
// the wizard in is rulebooks, Next, playbook, then press the button in front of you — and that
// press dropped both rulebooks without a word, so GM after GM came away with a five-image import
// and no idea why. What changes between the buttons is only what they are CALLED, which is why
// half of this file is about the label.
//
// Everything here fails silently if it breaks. A button that submits less than the window holds
// imports nothing and reports success; a label that promises less than the button does surprises
// a GM with a 1-2 minute run; one that stays visible on every page turns a wizard into four
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
		expect(COMMAND).toContain("callback: (event, button, dialog) => collectAll(dialog)");
	});

	// The reported bug, kept from coming back: a GM fills in the rulebooks, presses Next, fills in
	// the playbook, presses the button in front of them, and all three files go in. One read
	// serves every button, so there is no second path left for a page to fall down.
	it("submits every field the window holds, whichever button was pressed", () => {
		expect(COMMAND).toContain("const collectAll = (dialog) => ({ books: collectBooks(dialog), force: collectForce(dialog), maps: collectMaps(dialog) });");
		// Every book field, not the ones belonging to the page the button sits on: the rulebooks
		// page and the playbook page are two panels of one window, not two runs.
		expect(COMMAND).toContain("for (const b of booksUsed) {");
		// The page-scoped read is GONE, rather than left standing for something to call again.
		expect(COMMAND).not.toContain("collectPage");
		expect(COMMAND).not.toContain('books: key === "maps" ? [] : collectBooks(dialog, key)');
		expect(COMMAND).not.toContain('maps: key === "maps" ? collectMaps(dialog) : NO_MAPS');
		// Force belongs to every import button alike, which is why it is read the same way here.
		expect(COMMAND).toContain("force: collectForce(dialog)");
	});

	// A button that quietly does more than its name says is the same failure pointing the other
	// way, so the label answers to what is actually filled in: its own page's name while that is
	// all it is carrying, and a plainly bigger name once it is carrying another page too.
	it("renames itself once it is carrying another page's files", () => {
		expect(COMMAND).toContain('const runLabelFor = (root, s) => (suppliedElsewhere(root, s.key).length ? "Import everything filled in" : s.runLabel);');
		expect(COMMAND).toContain("const suppliedElsewhere = (root, key) => SETUP_SECTIONS");
		expect(COMMAND).toContain(".filter((s) => s.runLabel && s.key !== key)");
		// Painted into a span of ours, so repainting cannot wipe whatever DialogV2 put in the
		// button, and the page's copy of the name is set from the SAME answer in the same pass.
		expect(COMMAND).toContain('el.className = "stbook-setup-runlabel"');
		expect(COMMAND).toContain("const label = runLabelFor(root, s);");
		expect(COMMAND).toContain("if (labelEl) labelEl.textContent = label;");
		expect(COMMAND).toContain("if (named) named.textContent = label;");
	});

	// ...and the page says what is riding along, by name. A GM standing on the playbook page
	// cannot see the rulebooks page from there, so a count would tell them nothing.
	it("names on the page what it is bringing in from the other pages", () => {
		expect(COMMAND).toContain("const others = suppliedElsewhere(root, s.key);");
		expect(COMMAND).toContain("also.hidden = !others.length;");
		expect(COMMAND).toContain("You have also given this window <strong>${esc(andList(others))}</strong>");
		expect(COMMAND).toContain("so nothing you have filled in is left behind.");
		// Said a second time ON the button, because on a long panel that sentence is below the
		// fold at the moment it matters, and the moment it matters is the one where the cursor is
		// already on the button. Named in full there too: a count would answer nothing.
		expect(COMMAND).toContain("const all = suppliedEverywhere(root);");
		expect(COMMAND).toContain("run.dataset.tooltip = `Imports ${andList(all)}.");
		expect(COMMAND).toContain("else delete run.dataset.tooltip;");
		// Named off the SAME read the label is, and the books by their titles rather than a
		// tally, so the sentence and the button cannot describe two different runs.
		expect(COMMAND).toContain("const suppliedOn = (root, key) => {");
		expect(COMMAND).toContain(".map(bookTitle);");
		// andList is shared with the run report, and had to move up the file to be callable
		// while the dialog is open — a `const` declared below it is in its dead zone until then.
		expect(COMMAND).toMatch(/const andList = [^\n]+\n\s*const log = /);
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
		expect(COMMAND).toMatch(/\}\s*\n\s*paintReady\(root\);\s*\n\s*\};/);
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

	// "Import Art" is unchanged in what it does — it always ran the lot — and now says so through
	// the same one read as every other button, so there is no second definition of "everything".
	it("leaves the whole-run button running the whole thing", () => {
		expect(COMMAND).toContain('{ action: "ok", label: "Import Art", default: true, class: "stbook-setup-submit", callback: (event, button, dialog) => collectAll(dialog) }');
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

	// An Import button over an EMPTY WINDOW opens a progress window that imports nothing. Over an
	// empty page it does not: on an untouched playbook page it is still the button that imports
	// the two rulebooks behind it, which is the very press this window used to answer by dropping
	// them. So it is live on what the window holds, counted with the same `filledOn` the rail
	// badges are painted from.
	it("cannot be pressed only when the whole window is empty", () => {
		expect(COMMAND).toContain("run.disabled = !anywhere;");
		expect(COMMAND).toContain("const anywhere = SETUP_SECTIONS.filter((s) => s.runLabel).reduce((t, s) => t + filledOn(root, s.key), 0);");
		// The badge beside it still counts that page alone — it is a count OF the page.
		expect(COMMAND).toContain("const n = filledOn(root, s.key);");
		// Settled once against the empty sheet the dialog opens on, or every button starts live.
		expect(COMMAND).toMatch(/showPanel\(root, SETUP_SECTIONS\[0\]\.key\);\s*\n\s*paintBadges\(root\);/);
	});

	// A button that appears on one page and not another reads as furniture. The point of it is
	// knowing you are ALLOWED to leave, which only words can say.
	it("says on each page that stopping there is allowed, and what the alternative is", () => {
		for (const key of INPUT_PAGES) expect(COMMAND, key).toContain(`runHint("${key}")`);
		expect(COMMAND).toContain("You can stop here.");
		expect(COMMAND).toContain("<strong>Import Art</strong> on the last page is the same run");
		// The hint names the button by painting the live label in, not by writing s.runLabel into
		// the markup: the label changes as the window fills up, and a page telling you to press a
		// button that is no longer called that is worse than one that never named it.
		expect(COMMAND).toContain('data-runname="${key}"');
		expect(COMMAND).not.toContain("<em>${esc(s.runLabel)}</em>");
		// The promise itself has to match what the button now does.
		expect(COMMAND).toContain("imports everything you have filled in, on this page and on any other");
		expect(COMMAND).not.toContain("imports just what you filled in above");
		// ...and so does the overview's account of the same buttons.
		expect(COMMAND).not.toContain("Import button of its own that runs just that page");
		expect(COMMAND).toContain("it imports <strong>everything you have filled in</strong>");
	});

	// The offer is the one thing on the page that must not read as an aside, so it is deliberately
	// not a `.stbook-setup-note` (which is muted small grey) and has a style of its own.
	it("is drawn as a callout rather than another muted aside", () => {
		expect(COMMAND).toContain(".stbook-setup-runhint{");
		expect(COMMAND).not.toContain('class="stbook-setup-note stbook-setup-runhint"');
	});
});
