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
	edges: [{ id: "e1", a: "n1", b: "n2", d: "M 20,30 Q 45,28 70,30", ink: "rose" }],
	labels: [{
		id: "e1", a: "n1", b: "n2", ink: "rose", text: "exes",
		// Where the words sit and how far they are turned over, in ABSOLUTE board PIXELS — type
		// cannot be set in a stretched viewBox, and board pixels are the space the caption layer's
		// viewBox is in.
		x: 470, y: 350, angle: 12,
		tooltip: "exes",
		ariaLabel: "exes. Click to change or rub out this line.",
	}],
	heads: [{ id: "e1", end: "to", left: 66, top: 30, angle: 3, ink: "rose" }],
	// The caption layer's coordinate space, which is the board's own pixels at 1:1. Not constants:
	// the sheet grows with the number of people on it.
	boardWidth: 1200,
	boardHeight: 960,
	canEdit: true,
	// Whether a NEW line may be drawn, which is not the same question as whether this reader may
	// edit: the family tree is editable and still offers no handles, because a line drawn there
	// would land where the tree has no way of showing it.
	canLink: true,
	tree: [],
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
	it("reaches canLink from inside the node loop", () => {
		expect(render(boardContext())).toContain('data-relmap-handle="n1"');
		expect(render({ ...boardContext(), canLink: false })).not.toContain("data-relmap-handle");
	});

	it("positions everything in percentages", () => {
		const html = render(boardContext());
		expect(html).toContain("left:20%;top:30%");
		expect(html).toContain("--relmap-turn:3deg");
		// A caption is placed in the caption layer's board PIXELS rather than in percentages: it is
		// the one thing on the board that is, because type cannot be set in a stretched viewBox.
		expect(html).toContain('transform="rotate(12 470 350)"');
	});

	it("marks somebody whose actor has gone, and gives them the fallback face", () => {
		const html = render(boardContext());
		expect(html).toContain("is-missing");
		expect(html).toContain("fa-user");
	});

	// A face that arrived with a rim already drawn on it — the playbook badge a character who never
	// chose a portrait wears. The stylesheet takes the board's own rim off these; all the template
	// owes is the class, and only on the node that asked for it.
	it("marks a face that came with its own ring, and only that one", () => {
		const ctx = boardContext();
		ctx.nodes[0].ownRing = true;
		const html = render(ctx);
		expect(html).toMatch(/is-own-ring[^>]*data-relmap-node="n1"/);
		expect(html).not.toMatch(/is-own-ring[^>]*data-relmap-node="n2"/);
		expect(render(boardContext())).not.toContain("is-own-ring");
	});

	it("draws an empty board without throwing", () => {
		const html = render({ nodes: [], edges: [], labels: [], heads: [], canEdit: true, headD: "", headBox: 10, linkHint: "" });
		expect(html).toContain("stonetop-relmap-lines");
	});

	// EVERY STROKE SAYS WHO IT JOINS, in the one attribute a household's stroke uses, so that
	// resting on a face can mark that person's whole web without asking the graph again. Read off
	// `dataset`, never built into a selector: a stored id goes into a selector as text, and the
	// first id with a colon in it is a syntax error.
	it("carries the two people a line joins on the stroke and on its caption", () => {
		const html = render(boardContext());
		expect(html).toMatch(/data-relmap-line="e1"[\s\S]*?data-relmap-who="n1 n2"/);
		expect(html).toMatch(/data-relmap-edge="e1" data-relmap-who="n1 n2"/);
	});

	// THE FAMILY TREE'S OWN LAYER. One stroke per household, carrying everybody it joins so that
	// resting on any one of them can light the whole thing. Decoration and nothing else: a stroke
	// stands for as many lines as the household has children, so there is no one line a click on it
	// could mean, and a tie that wants fixing is fixed where it was written.
	it("draws each household as one stroke, naming everybody it joins", () => {
		const html = render({
			...boardContext(),
			tree: [{ d: "M 20,30 H 70 M 45,30 V 60", couple: true, who: "n1 n2 n3" }],
		});
		expect(html).toContain('d="M 20,30 H 70 M 45,30 V 60"');
		expect(html).toContain('data-relmap-who="n1 n2 n3"');
		expect(html).toContain("is-couple");
		expect(html).toMatch(/<svg class="stonetop-relmap-tree"[^>]*aria-hidden="true"/);
	});

	it("draws no tree layer content on the ordinary board", () => {
		expect(render(boardContext())).not.toContain("stonetop-relmap-tree-line");
	});

	// A POINT AND A TURN, which is how an arrowhead is placed too. The words are centred on the
	// point and rotated about it, so nothing here has to keep a box in step with the glyphs.
	//
	// ⚠ THE SAME x AND y IN BOTH PLACES. `rotate(a x y)` turns about a point, and a rotation about
	// anywhere but the caption's own anchor swings it off its line entirely.
	it("sets each caption at a point on its line, turned to the line's angle", () => {
		const html = render(boardContext());
		expect(html).toMatch(/<text[^>]*x="470"[^>]*y="350"/);
		expect(html).toContain('transform="rotate(12 470 350)"');
		expect(html).not.toContain("textPath");
	});

	// NOT the stretched viewBox the strokes live in: that one maps 0-100 onto whatever shape the
	// board happens to be, and text in it is sheared along one axis. The captions get their own
	// layer, unstretched, in the board's own pixels.
	it("sets the captions in an unstretched layer, in board pixels", () => {
		const html = render(boardContext());
		expect(html).toContain('<svg class="stonetop-relmap-labels" viewBox="0 0 1200 960"');
		expect(html).not.toMatch(/stonetop-relmap-labels[^>]*preserveAspectRatio/);
	});

	// ONE ROOT AND NOT ONE PER CAPTION: a hundred separate SVG roots are a hundred paint chunks, and
	// they would put the lit-web dimming on a hundred elements rather than on one, where opacity on
	// a `<g>` costs an offscreen buffer apiece. (What makes the captions affordable at all is the
	// stylesheet's `.captions-too-small`, which is pinned in tests/styles.)
	it("draws every caption in ONE svg root, however many there are", () => {
		const context = boardContext();
		const label = context.labels[0];
		const html = render({
			...context,
			labels: [label, { ...label, id: "e2", railId: "relmap-rail-map1-1" }],
		});
		expect(html.match(/<svg/g)).toHaveLength(
			// the tree layer, the stroke layer, one head, ONE caption layer for both captions, and
			// the empty layer the lit person's copies are put into
			5,
		);
		expect(html.match(/class="stonetop-relmap-labels"/g)).toHaveLength(1);
		expect(html).toContain('data-relmap-edge="e2"');
	});

	// The highlight is drawn OVER the caption layer rather than marked inside it, because restyling
	// one caption inside a layer of text-on-a-path re-warps every glyph in it. Empty in the markup:
	// `_lightPerson` fills it, and only while somebody is being rested on.
	it("leaves an empty layer for the lit person's captions, last on the board", () => {
		const html = render(boardContext());
		expect(html).toMatch(
			/<svg class="stonetop-relmap-labels-lit" viewBox="0 0 1200 960"[^>]*aria-hidden="true"[^>]*><\/svg>/);
		// LAST, so a lit caption comes forward over the portraits -- which is the "brought forward"
		// the chip used to get from a `z-index`, and an SVG group cannot ask for.
		expect(html.lastIndexOf("stonetop-relmap-labels-lit"))
			.toBeGreaterThan(html.lastIndexOf("stonetop-relmap-node"));
	});

	// The piece the live drag has to find again by the time a portrait is moving: it re-places the
	// words sixty times a second and finds them off `dataset`, never by a selector built from an id.
	it("marks a caption's words with the link they belong to", () => {
		expect(render(boardContext())).toContain('data-relmap-words="e1"');
	});

	// THE WORDS ARE THE BUTTON. There is no HTML button around them any more -- a wrapper would
	// have to be either the caption's enormous bounding box or a second element kept in step with
	// the glyphs, and both were what merging the layer got rid of. So the `<text>` carries the
	// manners itself, and utils/relmap-drag.js gives it Enter and Space.
	it("makes the writing itself the button", () => {
		const html = render(boardContext());
		expect(html).toMatch(/<text class="stonetop-relmap-label-text" role="button" tabindex="0"/);
		expect(html).toMatch(/aria-label="exes\. Click to change or rub out this line\."/);
		expect(html).not.toContain('<button type="button" class="stonetop-relmap-label"');
	});

});

describe("the window template", () => {
	const render = compile(WINDOW);
	// `showBoardTools` and not `canEdit` alone, because the board's own tools answer to both: they
	// act on an arrangement a narrow view does not show, so they are off while one is up. The
	// window works the two out together (`canEdit && !plan.seated`); the fixture spells them out so
	// a test can drive either half. `captions` is the same shape of thing for the captions cycle.
	const views = (chosen = "everyone") => [
		{ id: "everyone", label: "Everyone on the map", chosen: chosen === "everyone" },
		{ id: "party", label: "The party", chosen: chosen === "party" },
		{ id: "focus", label: "One person's web", chosen: chosen === "focus" },
		{ id: "family", label: "Family tree", chosen: chosen === "family" },
	];
	/** Just the toolbar. Several controls now appear both there and on a panel over the board. */
	const bar = html => html.match(/<div class="stonetop-relmap-tools">[\s\S]*?<\/div>\s*<\/div>/)[0];
	const context = (over = {}) => ({
		title: "The people of Stonetop", canEdit: true, showBoardTools: over.canEdit !== false,
		empty: false, views: views(over.chosen), viewLabel: "Showing", viewHint: "h",
		captions: true, showFindKin: false, showFocusPick: false,
		focusOf: "of", focusAria: "Whose web this shows", focusHint: "h", focusPick: "",
		board: "<board/>", addLabel: "Add someone",
		addHint: "h", tidyLabel: "Tidy up", tidyHint: "h", emptyLead: "Nobody yet",
		emptyHint: "Drag someone in",
		emptyAction: over.canEdit === false
			? null
			: { action: "add", label: "Add someone", icon: "fa-user-plus" },
		findKinLabel: "Find family ties", findKinHint: "h",
		dropPulledLabel: "Rub out pulled-in lines", dropPulledHint: "h",
		showRefreshParty: false, refreshPartyLabel: "Bring the party in", refreshPartyHint: "h",
		bareLead: "No family ties yet", bareHint: "Mark a line",
		bareAction: { action: "findkin", label: "Find family ties", icon: "fa-wand-magic-sparkles" },
		noKin: false, omittedSaid: "",
		labelMode: "all", labelsLabel: "All labels", labelsHint: "how much writing shows",
		labelsAria: "What the lines say: All labels",
		// ⚠ THE VISIBLE NAMES ONLY, and no state. What the two history buttons can do is written
		// onto them by `_paintHistory` — it lives on the reader's own machine, not in the document
		// a render was built from — so the render's job is to put them there saying they can do
		// nothing yet, which is the truth for a bar that has only just appeared.
		undoLabel: "Undo", redoLabel: "Redo",
		undoNothing: "There is nothing of yours on this board to take back.",
		redoNothing: "There is nothing to do again.",
		hasPulled: true, hidePulled: false, pulledLabel: "Hide pulled-in lines",
		pulledHint: "why anybody would want this", ...over,
	});

	it("compiles and drops the board in unescaped", () => {
		expect(render(context())).toContain("<board/>");
	});

	// THE BOX THAT PUTS THE PULLED-IN LINES AWAY, and it is OUTSIDE the permission gate with the
	// captions cycle and the view chooser: it changes what one reader is looking at and nothing in
	// the document. The player who may only read a map buried under a hundred pulled-in arrows is
	// exactly the person who needs it -- and the tool that rubs those lines out, being an edit, is
	// the one thing in this corner they cannot reach.
	it("offers the hide box to a reader who may not edit", () => {
		const html = render(context({ canEdit: false, showBoardTools: false }));
		expect(html).toContain('data-relmap-action="hidepulled"');
		expect(html).toContain("Hide pulled-in lines");
	});

	// The same argument as the empty panel above: `_paintChrome` can only show and hide markup that
	// is already there, and somebody at the far end of the table rubbing the last of these out is
	// the moment this reader stops having anything to hide.
	it("always renders the footer, and hides it while there is nothing pulled in", () => {
		const foot = html => html.match(/<div class="stonetop-relmap-foot"[^>]*>/)[0];
		expect(foot(render(context({ hasPulled: false })))).toContain("hidden");
		expect(foot(render(context({ hasPulled: true })))).not.toContain("hidden");
	});

	// ⚠ THE SAME RULE FOR THE TOOL BESIDE IT, one step further on. It is rendered whether or not
	// there is anything to rub out, because whether there is changes the moment somebody at the far
	// end of the table presses it -- and `_paintChrome` can only write onto markup a repaint left
	// standing. Behind a condition, their window would go on offering a button whose work was
	// already done until it happened to re-render.
	it("always renders the rub-out tool, and hides it while there is nothing pulled in", () => {
		const tool = html => html.match(/<button[^>]*data-relmap-action="droppulled"[^>]*>/)[0];
		expect(tool(render(context({ hasPulled: false })))).toContain("hidden");
		expect(tool(render(context({ hasPulled: true })))).not.toContain("hidden");
	});

	// ⚠ GONE FOR GOOD, both of them. The party board and the village board still seat themselves on
	// open; what was removed is the pair of buttons asking for that same pass out loud, because the
	// map already answers "somebody is missing from this board" by drag or by "Add someone". Guarded
	// here so a context key resurrected by accident cannot quietly put them back on the bar.
	it("offers no refresh buttons at all", () => {
		const on = bar(render(context({ showRefreshParty: true, showRefreshVillage: true })));
		expect(on).not.toContain('data-relmap-action="refreshparty"');
		expect(on).not.toContain('data-relmap-action="refreshvillage"');
	});

	// It writes to the shared board, so it is one of the board's own tools: away with the rest of
	// them on a view that seats itself, and never offered to a reader who may only look.
	it("keeps the rub-out tool behind the editing gate", () => {
		expect(render(context({ canEdit: false, showBoardTools: false })))
			.not.toContain('data-relmap-action="droppulled"');
	});

	it("ticks the box when the lines are put away", () => {
		expect(render(context({ hidePulled: true }))).toContain("checked");
		expect(render(context({ hidePulled: false }))).not.toContain("checked");
	});

	// On the LABEL, so resting on either the box or its words says why anybody would want this,
	// which four words cannot and which is the whole reason the option exists.
	it("explains itself from the whole label", () => {
		const html = render(context());
		expect(html).toMatch(/<label class="stonetop-relmap-foot-check" data-tooltip="why anybody/);
	});

	it("shows the tools to an editor and hides them from a reader", () => {
		expect(render(context())).toContain('data-relmap-action="add"');
		expect(render(context({ canEdit: false }))).not.toContain('data-relmap-action="add"');
		expect(render(context({ canEdit: false }))).toContain("is-readonly");
	});

	// PERMISSION IS THE ONLY GATE ON THE TOOLS. There used to be a second one, a lock the reader
	// turned, and every tool carried a `disabled` that answered to it. Somebody who may edit now
	// gets a tool that works the moment they see it, so a tool rendered disabled would be a tool
	// disabled by an accident.
	//
	// ⚠ THE TWO HISTORY BUTTONS ARE THE ONE EXCEPTION, and it is named here rather than left to be
	// discovered. What they can do is not a permission and is not in the document: it is what this
	// reader has done to this board since they opened it, which no render can know. So they come up
	// off and saying so, and `_paintHistory` switches them on. They are DISABLED rather than absent
	// because a pair appearing and vanishing as the reader worked would shuffle the whole bar
	// sideways under the pointer.
	it("never renders an editing tool disabled, but the two history buttons", () => {
		const off = (render(context()).match(/<button[^>]*>/g) ?? [])
			.filter(tag => tag.includes("disabled"))
			.map(tag => tag.match(/data-relmap-action="([^"]+)"/)?.[1]);
		expect(off.sort()).toEqual(["redo", "undo"]);
	});

	// AND THEY STAND IN THE SAME PLACE ON EVERY VIEW, unlike every other tool on this bar. A reader
	// reaches for undo by muscle memory, and it must not move when they change what they are
	// looking at -- so it is outside `showBoardTools`, and behind permission alone.
	it("keeps the history buttons on a view that has no board tools", () => {
		// The BAR alone: the empty panel over the board carries an "Add someone" of its own, which
		// is a different control answering a different question.
		const narrow = bar(render(context({ canEdit: true, showBoardTools: false })));
		expect(narrow).not.toContain('data-relmap-action="add"');
		expect(narrow).toContain('data-relmap-action="undo"');
		expect(narrow).toContain('data-relmap-action="redo"');
	});

	// Taking a change back is an edit like any other.
	it("hides the history buttons from a reader who may only look", () => {
		const html = render(context({ canEdit: false }));
		expect(html).not.toContain('data-relmap-action="undo"');
		expect(html).not.toContain('data-relmap-action="redo"');
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

	// The panel's one button is gated on PERMISSION, never on emptiness — it has to already be in
	// the markup for the repaint that empties the board to have something to unhide.
	//
	// ⚠ SCOPED TO THE PANEL, because the class alone is a FALSE GUARD: the no-family panel's button
	// wears `stonetop-relmap-empty-cast` too and is gated on `canEdit` in the same way, so an
	// assertion on the bare class stays green with the empty panel's button deleted outright — and
	// that is the one control a brand new map has.
	// ⚠ IN THE MARKUP ALWAYS, HIDDEN WHEN THERE IS NOTHING TO PRESS -- the same rule its
	// neighbour in the no-kin panel keeps, and for the same reason: `_paintChrome` is all that runs
	// on a repaint and can only WRITE onto markup that is there. Which button this is depends on
	// the view and on whether the reader may edit, and both can change without a render.
	it("carries the empty panel's button on a populated board, ready for it to empty", () => {
		const panel = html => html.match(/<div class="stonetop-relmap-empty"[\s\S]*?<\/div>/)[0];
		const editor = panel(render(context({ empty: false })));
		expect(editor).toContain("data-relmap-action=");
		expect(editor).not.toMatch(/<button[^>]*hidden/);
		const reader = panel(render(context({ empty: false, canEdit: false, emptyAction: null })));
		expect(reader).toMatch(/<button[^>]*hidden/);
	});

	// AND IT IS NO LONGER "ADD EVERYONE". Putting the whole cast on in one press is the crowding
	// the views exist to escape, so the bulk button is gone; what the panel offers is what its own
	// hint already told the reader to use.
	it("offers Add someone on an empty board, not a way to add everybody at once", () => {
		const panel = render(context({ empty: true })).match(/<div class="stonetop-relmap-empty"[\s\S]*?<\/div>/)[0];
		expect(panel).toContain('data-relmap-action="add"');
		expect(render(context())).not.toContain('data-relmap-action="cast"');
	});

	// THE VIEW CHOOSER IS THE READER'S OWN and changes nothing in the document, so it sits outside
	// the permission gate with the captions control rather than inside it with the editing tools. A
	// player who may only look at a crowded map is exactly who most needs to narrow it.
	it("offers every view to a reader who may not edit", () => {
		const html = render(context({ canEdit: false, showBoardTools: false }));
		expect(html).toContain("data-relmap-view");
		// Handlebars escapes the apostrophe, so the option is matched as it is actually written out.
		for (const label of ["Everyone on the map", "The party", "One person&#x27;s web", "Family tree"]) {
			expect(html).toContain(label);
		}
	});

	// A `<select>` says which view is up in its own value, so there is no second element to keep in
	// step — but the row has to be marked, or the control opens on the wrong answer after a render.
	it("marks the view that is up", () => {
		const html = render(context({ chosen: "party" }));
		expect(html).toMatch(/<option value="party" selected>/);
		expect(html).toMatch(/<option value="everyone" >/);
	});

	// The board's own tools act on an arrangement a narrow view does not show: laying it out again,
	// adding somebody it would not draw, rubbing out lines it does not display. A button whose
	// effect is invisible from where the reader is standing is worse than one that is not there.
	it("puts the board's tools away while a narrow view is up", () => {
		const tree = render(context({
			chosen: "family", showBoardTools: false, showFindKin: true, captions: false,
		}));
		// SCOPED TO THE BAR. "Add someone" is also the empty board's own call to action, down in a
		// panel that is always rendered and merely hidden, so an unscoped assertion would be
		// satisfied — or defeated — by markup that has nothing to do with the toolbar.
		expect(bar(tree)).not.toContain('data-relmap-action="tidy"');
		expect(bar(tree)).not.toContain('data-relmap-action="add"');
		expect(bar(tree)).toContain('data-relmap-action="findkin"');
	});

	// ⚠ THE CAPTIONS CYCLE GOES WITH THE TREE AND WITH NOTHING ELSE. It used to be hidden by
	// `{{#unless family}}`, and spelt that way the two narrow views — which DO draw captioned lines,
	// and are the crowded ones — would have lost the one control that rescues a dense board.
	// `_paintLabelMode` writes onto this element and returns silently where it is missing.
	it("keeps the captions cycle on every view that draws captions, and only those", () => {
		expect(render(context({ chosen: "party", captions: true })))
			.toContain('data-relmap-action="labels"');
		expect(render(context({ chosen: "focus", captions: true })))
			.toContain('data-relmap-action="labels"');
		expect(render(context({ chosen: "family", captions: false })))
			.not.toContain('data-relmap-action="labels"');
	});

	// Only the focus view needs to say who it is about, and it is not an edit: a player who may
	// only read this map is exactly who wants to point it at themselves.
	it("offers the person chooser only in the focus view, edit rights or not", () => {
		expect(render(context({ chosen: "focus", showFocusPick: true, canEdit: false })))
			.toContain("data-relmap-focus");
		expect(render(context())).not.toContain("data-relmap-focus");
	});

	// ⚠ ITS ROWS GO IN UNESCAPED, exactly as the board does, because the window builds them: the
	// same string is written again by `_paintFocusPick` when somebody at the far end of the table
	// changes the cast, and that writer can only reach the DOM. Spelt as an `{{#each}}` here it
	// would be two spellings of one list, and the escaping would be in only one of them.
	it("drops the chooser's rows in whole", () => {
		const html = render(context({
			chosen: "focus", showFocusPick: true,
			focusPick: '<option value="pim" selected>Pim</option>',
		}));
		expect(html).toContain('<option value="pim" selected>Pim</option>');
		// And the control it is spoken as: the visible word beside it is only the joining "of".
		expect(html).toContain('aria-label="Whose web this shows"');
	});

	// Its own panel and not a second state of the empty one: a board with nobody on it and a board
	// whose people THIS VIEW does not draw want different words and a different button.
	// Always rendered and hidden, for the reason the empty panel is.
	it("always renders the nothing-here panel, and hides it unless the view is bare", () => {
		expect(render(context({ noKin: false }))).toContain("stonetop-relmap-nokin");
		const panel = html => html.match(/<div class="stonetop-relmap-nokin"[^>]*>/)[0];
		expect(panel(render(context({ noKin: false })))).toContain("hidden");
		expect(panel(render(context({ noKin: true })))).not.toContain("hidden");
	});

	// One panel, three situations, and each needs its own way out — back to the whole board, or
	// the button that fixes what is missing.
	it("carries whatever words and button the empty view was given", () => {
		const html = render(context({
			noKin: true,
			bareLead: "Nobody on this map is a player character.",
			bareHint: "Put them on the map.",
			bareAction: { action: "showall", label: "Show everyone", icon: "fa-users" },
		}));
		expect(html).toContain("Nobody on this map is a player character.");
		expect(html).toContain('data-relmap-action="showall"');
	});

	// ⚠ THE BUTTON IS ALWAYS IN THE MARKUP, HIDDEN, and this is the bug the test exists for.
	// `_paintChrome` is all that runs on a repaint and can only write onto markup that is already
	// there. Behind an `{{#if bareAction}}` the button existed on precisely the views that were
	// ALREADY showing nobody when the window last rendered -- so ticking "hide the lines the sheets
	// drew" until a focus ring emptied, or somebody at the far end of the table removing the last
	// player character, put the panel up carrying its sentence and nothing at all to press. The
	// panel takes no pointer events, so that button is the only thing in the viewport a reader can
	// reach while it is up.
	it("keeps the panel's button in the markup even with nothing to press, ready to be filled in", () => {
		const bare = html => html.match(/<div class="stonetop-relmap-nokin"[\s\S]*?<\/div>/)[0];
		const none = bare(render(context({ noKin: true, bareAction: null })));
		expect(none).toContain("<button");
		expect(none).toMatch(/<button[^>]*hidden/);
		const some = bare(render(context({ noKin: true })));
		expect(some).not.toMatch(/<button[^>]*hidden/);
	});

	// Who this view is NOT showing, and it must be outside the board: the board's markup is
	// replaced wholesale on every repaint, and it must stay put while the picture is panned.
	it("says who the view is leaving out, outside the board", () => {
		const html = render(context({ chosen: "family", omittedSaid: "21 more on this map." }));
		expect(html).toContain("21 more on this map.");
		expect(html.indexOf("stonetop-relmap-aside")).toBeGreaterThan(html.indexOf("<board/>"));
		expect(render(context())).toMatch(/<p class="stonetop-relmap-aside" hidden>/);
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
		kinLabel: "Family tie", kinHint: "h",
		kins: [
			{ key: "none", name: "Not a family tie", checked: true },
			{ key: "parent", name: "Elena is Stefan's parent", checked: false },
		],
		canDelete: true, saveLabel: "Save", deleteLabel: "Rub out", cancelLabel: "Never mind",
		...over,
	});

	it("compiles, and checks the ink and direction the link already has", () => {
		const html = render(context());
		expect(html).toContain('value="rose" checked');
		expect(html).toContain('value="none" checked');
		expect(html).toContain('value="exes"');
	});

	// THE OPTIONS NAME BOTH PEOPLE, rather than saying "the first person" as the direction control
	// above them does. A family tie set the wrong way round leaves no trace in the writing on the
	// line and turns the whole chart upside down, so the one control that decides it must not make
	// the reader remember which end they drew from.
	it("asks what family tie it is, naming the two people", () => {
		const html = render(context());
		expect(html).toContain('name="kin"');
		expect(html).toContain("Elena is Stefan&#x27;s parent");
		expect(html).toMatch(/value="none" checked[\s\S]*?Not a family tie/);
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

describe("the captions control", () => {
	const render = compile(WINDOW);
	const context = (over = {}) => ({
		title: "t", canEdit: true, empty: false, board: "<board/>",
		// The control is offered by what the view HAS (captioned lines), not by what it is not.
		captions: true,
		views: [{ id: "everyone", label: "Everyone on the map", chosen: true }],
		viewLabel: "Showing", viewHint: "h",
		addLabel: "a", addHint: "h",
		tidyLabel: "Tidy up", tidyHint: "h", emptyLead: "l", emptyHint: "h",
		labelMode: "hover", labelsLabel: "Labels on hover", labelsHint: "how much writing shows",
		labelsAria: "What the lines say: Labels on hover", ...over,
	});

	// IT IS NOT AN EDIT, and that is the point of testing it separately from the tools. A player
	// who may only read a crowded map is exactly the person who needs to turn its captions down;
	// behind the editing gate, the one control that rescues a dense board would be handed only to
	// the person who does not need it.
	it("is there for a reader who may not edit the board at all", () => {
		const html = render(context({ canEdit: false }));
		expect(html).toContain('data-relmap-action="labels"');
		// The editing tools are gone with the permission; the captions cycle is not one of them.
		expect(html).not.toContain('data-relmap-action="tidy"');
	});

	it("carries the current setting on the root, where the stylesheet reads it", () => {
		expect(render(context())).toContain("labels-hover");
		expect(render(context({ labelMode: "off" }))).toContain("labels-off");
	});

	// A cycle, not a toggle: three settings and a button that says which is on. The accessible
	// name has to carry the setting WITH it, or a screen reader hears the same words on all three.
	it("names the setting as well as the control", () => {
		expect(render(context())).toContain('aria-label="What the lines say: Labels on hover"');
	});

	// The window rewrites this span on every press rather than re-rendering, which would rebuild
	// the surface and throw away the corner the reader had zoomed into. It can only find it by
	// this class.
	it("gives its label a class the window can write into without a re-render", () => {
		expect(render(context())).toContain("stonetop-relmap-tool-text");
	});
});

describe("what a caption says when you rest on it", () => {
	const render = compile(BOARD);

	// THE TOOLTIP IS THE SENTENCE AND NOTHING ELSE. Its job is the words the chip could not fit,
	// so on a crowded board it is the only place the whole of a caption can be read. An
	// instruction repeated on eighty lines buries that under something the reader learned once.
	it("shows the caption, not an instruction about clicking it", () => {
		const html = render(boardContext());
		expect(html).toContain('data-tooltip="exes"');
		expect(html).not.toContain('data-tooltip="exes. Click');
	});

	// A screen reader announces a button by its accessible name and gets no other clue that it is
	// one, so the instruction the tooltip drops is exactly what a reader who cannot see the chip
	// needs to hear. The two are separate fields for that reason and must not be re-merged.
	it("still tells a screen reader what pressing it will do", () => {
		expect(render(boardContext()))
			.toContain('aria-label="exes. Click to change or rub out this line."');
	});
});

// ── The page strip ──────────────────────────────────────────────────────────────────────────────
//
// One map is several named boards, each a JournalEntryPage of the same entry. The strip is how a
// reader knows which one they are on and how a table discovers that a second one is possible at
// all, so what matters here is that the tabs arrive unescaped from the window's own builder, that
// the three tools are behind the editing gate, and that the delete is RENDERED-AND-HIDDEN rather
// than absent.

describe("the page strip", () => {
	const render = compile(WINDOW);
	const context = (over = {}) => ({
		title: "The people of Stonetop", canEdit: true, showBoardTools: true,
		empty: false, captions: true, showFindKin: false, showFocusPick: false,
		views: [{ id: "everyone", label: "Everyone on the map", chosen: true }],
		viewLabel: "Showing", viewHint: "h",
		focusOf: "of", focusAria: "a", focusHint: "h", focusPick: "",
		board: "<board/>", addLabel: "Add someone", addHint: "h",
		tidyLabel: "Tidy up", tidyHint: "h", emptyLead: "Nobody yet", emptyHint: "Drag someone in",
		emptyAction: null, findKinLabel: "Find family ties", findKinHint: "h",
		bareLead: "l", bareHint: "h", bareAction: null, noKin: false, omittedSaid: "",
		labelMode: "all", labelsLabel: "All labels", labelsHint: "h", labelsAria: "a",
		hasPulled: false, hidePulled: false, pulledLabel: "l", pulledHint: "h",
		// The strip's own context.
		showPages: true,
		pageTabs: '<button data-relmap-page="p1" class="stonetop-relmap-page is-current">Stonetop</button>',
		pagePanelId: "stonetop-relmap-map1-page-p1",
		pagesLabel: "Pages of this map",
		pageNewLabel: "New page", pageNewHint: "Start another board",
		pageRenameLabel: "Rename", pageRenameHint: "Rename the page you are on",
		pageDeleteLabel: "Delete page", pageDeleteHint: "Rub out the page you are on",
		canDropPage: true,
		...over,
	});

	// A single tab over a board, with no way to add a second, is a row of chrome answering a
	// question nobody asked. The window decides; the template only has to honour it.
	it("is absent entirely when the window says not to show it", () => {
		const html = render(context({ showPages: false }));
		expect(html).not.toContain("stonetop-relmap-pages");
		expect(html).not.toContain("data-relmap-action=\"pagenew\"");
	});

	// ⚠ DROPPED IN WHOLE from `_pageTabs`, never written out here as an `{{#each}}`: boards are
	// added and renamed under an open window, and the repaint that keeps up with that can only
	// reach the DOM.
	it("drops the tabs in unescaped, in a tablist with a name", () => {
		const html = render(context());
		expect(html).toContain('<button data-relmap-page="p1"');
		expect(html).toContain('role="tablist"');
		expect(html).toContain('aria-label="Pages of this map"');
	});

	// A `role="tab"` with nothing saying what it controls is a tab in name only.
	it("makes the board the panel the strip names", () => {
		const html = render(context());
		expect(html).toContain('role="tabpanel"');
		expect(html).toContain('aria-labelledby="stonetop-relmap-map1-page-p1"');
	});

	// All three make, rename or destroy a document, so the whole group is behind the gate. The
	// strip itself is not: a reader who may only look still gets to look at every board.
	it("offers no page tools at all to a reader who may only look", () => {
		const html = render(context({ canEdit: false }));
		expect(html).toContain("stonetop-relmap-pages-strip");
		expect(html).not.toContain('data-relmap-action="pagenew"');
		expect(html).not.toContain('data-relmap-action="pagedelete"');
	});

	it("offers the three page tools to a reader who may edit", () => {
		const html = render(context());
		for (const action of ["pagenew", "pagerename", "pagedelete"]) {
			expect(html).toContain(`data-relmap-action="${action}"`);
		}
	});

	// ⚠ RENDERED AND HIDDEN, never behind an `{{#if}}`. Whether the last board may be rubbed out
	// changes whenever anybody at the table adds or removes one, and `_paintPages` can only write
	// onto markup a repaint left standing: behind a condition, a reader who adds a second page
	// would have no way to remove it again until they reopened the window.
	it("keeps the delete in the markup on a one-page map, merely hidden", () => {
		const html = render(context({ canDropPage: false }));
		const button = html.match(/<button[^>]*data-relmap-action="pagedelete"[^>]*>/)[0];
		expect(button).toContain("hidden");
	});

	it("shows the delete once there is more than one board", () => {
		const html = render(context({ canDropPage: true }));
		const button = html.match(/<button[^>]*data-relmap-action="pagedelete"[^>]*>/)[0];
		expect(button).not.toContain("hidden");
	});
});
