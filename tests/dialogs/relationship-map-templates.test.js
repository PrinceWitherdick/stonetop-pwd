import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

// The map's three templates, COMPILED AND RENDERED against the context the code actually builds.
//
// Nothing else does this. The partial-registration suite proves each file exists and is registered;
// the window suite mocks `renderTemplate` away entirely so it can run in node. Between them a
// template with a broken `{{#each}}`, a mistyped `../` reach, or a helper that does not exist would
// ship green and fail only when somebody opened the window.

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const compile = p => Handlebars.compile(read(p));

// The two helpers these templates call. Enough to render; the real ones are Foundry's.
Handlebars.registerHelper("localize", key => String(key));

const BOARD = "templates/dialogs/partials/relationship-map-board.hbs";
const WINDOW = "templates/dialogs/relationship-map.hbs";
const LINK = "templates/dialogs/relationship-link.hbs";

/** The board context, shaped exactly as RelationshipMapWindow._boardContext returns it. */
const boardContext = () => ({
	nodes: [
		{
			id: "n1", name: "Elena", left: 20, top: 30, img: "elena.webp",
			imgStyle: "position:absolute;width:200%", missing: false,
			tooltip: "Elena. Click to open their sheet.", linkLabel: "Draw a line from Elena",
		},
		{
			id: "n2", name: "Stefan", left: 70, top: 30, img: "", imgStyle: "", missing: true,
			tooltip: "Stefan", linkLabel: "Draw a line from Stefan",
		},
	],
	edges: [{ id: "e1", d: "M 20,30 Q 45,28 70,30", ink: "rose" }],
	labels: [{
		id: "e1", ink: "rose", text: "exes", left: 45, top: 29, angle: -2,
		tooltip: "exes. Click to change or rub out this line.",
	}],
	heads: [{ id: "e1", end: "to", left: 66, top: 30, angle: 3, ink: "rose" }],
	canEdit: true,
	headD: "M1 1.2 L9 5 L1 8.8 Z",
	headBox: 10,
	linkHint: "Drag to another person to draw a line.",
});

describe("the board template", () => {
	const render = compile(BOARD);

	it("compiles and draws a line, its label, its head and both people", () => {
		const html = render(boardContext());
		expect(html).toContain('d="M 20,30 Q 45,28 70,30"');
		expect(html).toContain("stonetop-relmap-line--rose");
		expect(html).toContain(">exes<");
		expect(html).toContain('data-relmap-edge="e1"');
		expect(html).toContain('data-relmap-node="n1"');
		expect(html).toContain('data-relmap-node="n2"');
	});

	// ⚠ WHAT THESE IDS ARE FOR. While a portrait is being dragged the window redraws the lines
	// touching it by writing onto these elements, and it finds them by exactly these attributes.
	// Drop them and nothing fails to render — the lines simply stop following the portrait, which
	// is the very fault the live drag exists to fix.
	it("tags every piece of a line with the link it belongs to", () => {
		const html = render(boardContext());
		expect(html).toContain('data-relmap-line="e1"');
		expect(html).toContain('data-relmap-head="e1"');
		expect(html).toContain('data-relmap-end="to"');
	});

	// The reach that is easy to get wrong: `headD` and `headBox` live at the top of the context and
	// are read from inside an `{{#each}}`, so they need `../`. Without it the arrowheads render with
	// an empty path and a `viewBox="0 0 "` — invisible, and silent.
	it("reaches the shared arrowhead shape from inside the loop", () => {
		const html = render(boardContext());
		expect(html).toContain('viewBox="0 0 10 10"');
		expect(html).toContain('d="M1 1.2 L9 5 L1 8.8 Z"');
		expect(html).not.toContain('viewBox="0 0  "');
	});

	// Same reach, for the flag that decides whether the link handles exist at all.
	it("reaches canEdit from inside the node loop", () => {
		expect(render(boardContext())).toContain('data-relmap-handle="n1"');
		expect(render({ ...boardContext(), canEdit: false })).not.toContain("data-relmap-handle");
	});

	it("positions everything in percentages", () => {
		const html = render(boardContext());
		expect(html).toContain("left:20%;top:30%");
		expect(html).toContain("--relmap-turn:-2deg");
	});

	it("marks somebody whose actor has gone, and gives them the fallback face", () => {
		const html = render(boardContext());
		expect(html).toContain("is-missing");
		expect(html).toContain("fa-user");
	});

	it("draws an empty board without throwing", () => {
		const html = render({ nodes: [], edges: [], labels: [], heads: [], canEdit: true, headD: "", headBox: 10, linkHint: "" });
		expect(html).toContain("stonetop-relmap-lines");
	});
});

describe("the window template", () => {
	const render = compile(WINDOW);
	const context = (over = {}) => ({
		title: "The people of Stonetop", canEdit: true, locked: false, empty: false,
		board: "<board/>", lockLabel: "Editing", lockHint: "h", addLabel: "Add someone",
		addHint: "h", tidyLabel: "Tidy up", tidyHint: "h", emptyLead: "Nobody yet",
		emptyHint: "Drag someone in", lockToggle: "Edit the board", ...over,
	});

	it("compiles and drops the board in unescaped", () => {
		expect(render(context())).toContain("<board/>");
	});

	it("shows the tools to an editor and hides them from a reader", () => {
		expect(render(context())).toContain('data-relmap-action="add"');
		expect(render(context({ canEdit: false }))).not.toContain('data-relmap-action="add"');
		expect(render(context({ canEdit: false }))).toContain("is-readonly");
	});

	it("disables the editing tools while the board is locked, but never the lock itself", () => {
		const html = render(context({ locked: true }));
		expect(html).toContain("is-locked");
		expect(html).toMatch(/data-relmap-action="add"[\s\S]*?disabled/);
		expect(html).toMatch(/data-relmap-action="tidy"[\s\S]*?disabled/);
	});

	// A toggle needs a CONSTANT name and a CHANGING state, and it is easy to ship two changing
	// halves that contradict each other when they are read out together. The name says what the
	// control is; `aria-pressed` says how it is set; and it is spelled out both ways round because
	// the obvious `{{#unless}}` renders `aria-pressed=""` in the other case, which tells a screen
	// reader the control is a toggle and then gives it nothing to report.
	it("names the lock the same way whichever way it is set, and states its position", () => {
		const locked = render(context({ locked: true }));
		const editing = render(context({ locked: false }));
		expect(locked).toContain('aria-label="Edit the board"');
		expect(editing).toContain('aria-label="Edit the board"');
		// Pressed means editing is ON, which is the state the name describes.
		expect(locked).toContain('aria-pressed="false"');
		expect(editing).toContain('aria-pressed="true"');
	});

	it("carries a live region, and it is not inside the board", () => {
		const html = render(context());
		const live = html.indexOf("stonetop-relmap-live");
		const board = html.indexOf("<board/>");
		expect(live).toBeGreaterThan(-1);
		expect(live).toBeGreaterThan(board);
	});

	// THE BUG THIS EXISTS TO CATCH, and it used to assert the fault. Behind an `{{#if empty}}` the
	// panel existed on exactly the maps that OPENED empty, and `_toggleEmpty` can only show and
	// hide markup that is already there: take the last person off a populated map and the repaint
	// left a blank board with no lead text and no "Add everyone", which is the moment the panel is
	// most wanted. So it is always rendered and `hidden` carries the state.
	it("always renders the empty panel, and hides it while the map has people on it", () => {
		expect(render(context({ empty: true }))).toContain("stonetop-relmap-empty");
		expect(render(context({ empty: false }))).toContain("stonetop-relmap-empty");
	});

	it("marks the panel hidden when the map is populated, and only then", () => {
		const panel = html => html.match(/<div class="stonetop-relmap-empty"[^>]*>/)[0];
		expect(panel(render(context({ empty: false })))).toContain("hidden");
		expect(panel(render(context({ empty: true })))).not.toContain("hidden");
	});

	// The panel's one button is gated on the LOCK, never on emptiness — it has to already be in the
	// markup for the repaint that empties the board to have something to unhide. A lock turning is
	// the one thing that re-renders the window whole, which is what keeps that gate honest.
	// By the panel's OWN class and not by `data-relmap-action="cast"`: the toolbar carries a cast
	// button too, which is present-but-disabled while locked, so the bare action would match it and
	// the assertion would pass on markup that had lost the panel's button entirely.
	it("carries the empty panel's button on a populated board, ready for it to empty", () => {
		expect(render(context({ empty: false }))).toContain("stonetop-relmap-empty-cast");
		expect(render(context({ empty: false, locked: true }))).not.toContain("stonetop-relmap-empty-cast");
		expect(render(context({ empty: false, canEdit: false }))).not.toContain("stonetop-relmap-empty-cast");
	});
});

describe("the link editor template", () => {
	const render = compile(LINK);
	const context = (over = {}) => ({
		edge: { label: "exes", note: "" },
		between: "Between Elena and Stefan.",
		suggestions: ["best friends", "exes"],
		maxLength: 120, placeholder: "p", labelLabel: "What it says", inkLabel: "Colour",
		dirLabel: "Which way", noteLabel: "Notes", notePlaceholder: "p",
		inks: [{ key: "rose", name: "Rose", checked: true }, { key: "sage", name: "Sage", checked: false }],
		dirs: [{ key: "none", name: "Both ways", checked: true }, { key: "a-b", name: "One way", checked: false }],
		canDelete: true, saveLabel: "Save", deleteLabel: "Rub out", cancelLabel: "Never mind",
		...over,
	});

	it("compiles, and checks the ink and direction the link already has", () => {
		const html = render(context());
		expect(html).toContain('value="rose" checked');
		expect(html).toContain('value="none" checked');
		expect(html).toContain('value="exes"');
	});

	it("offers the labels already used on this map as suggestions", () => {
		expect(render(context())).toContain('<option value="best friends">');
	});

	// A brand new link has nothing to rub out yet, and a delete button on one would be a control
	// that cannot mean anything.
	it("offers the delete button only for a link that exists", () => {
		expect(render(context())).toContain('data-relmap-link="delete"');
		expect(render(context({ canDelete: false }))).not.toContain('data-relmap-link="delete"');
	});

	it("puts the affirmative button first", () => {
		const html = render(context());
		expect(html.indexOf('data-relmap-link="save"'))
			.toBeLessThan(html.indexOf('data-relmap-link="cancel"'));
	});
});
