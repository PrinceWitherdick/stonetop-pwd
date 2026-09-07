import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { RELMAP_NODE_PX } from "../../module/utils/relmap-geometry.js";

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

/** The board context, shaped exactly as RelationshipMapWindow._boardContext returns it. */
const boardContext = () => ({
	nodes: [
		{
			id: "n1", name: "Elena", left: 20, top: 30, img: "elena.webp",
			imgStyle: "position:absolute;width:200%", missing: false,
			tooltip: "Elena. Click to open their sheet.", linkLabel: "Draw a line from Elena",
			removeLabel: "Take Elena off this map",
		},
		{
			id: "n2", name: "Stefan", left: 70, top: 30, img: "", imgStyle: "", missing: true,
			tooltip: "Stefan", linkLabel: "Draw a line from Stefan",
			removeLabel: "Take Stefan off this map",
		},
	],
	edges: [{
		id: "e1", a: "n1", b: "n2", inkKey: "rose", inkHex: "",
		// The BROKEN path the stroke is painted along -- the caption's gap is cut out of it -- and
		// the WHOLE curve the invisible target is laid along. The two differ on purpose.
		d: "M 20,30 Q 45,28 60,30", hit: "M 20,30 Q 45,28 70,30",
		broken: "",
	}],
	labels: [{
		id: "e1", a: "n1", b: "n2", ink: "rose", text: "exes",
		// Where the words sit and how far they are turned over, in ABSOLUTE board PIXELS — type
		// cannot be set in a stretched viewBox, and board pixels are the space the caption layer's
		// viewBox is in.
		x: 470, y: 350, angle: 12,
		tooltip: "exes",
		ariaLabel: "exes. Click to change or delete this line.",
	}],
	heads: [{ id: "e1", end: "to", left: 66, top: 30, angle: 3, inkKey: "rose", inkHex: "" }],
	// The caption layer's coordinate space, which is the board's own pixels at 1:1. Not constants:
	// the sheet grows with the number of people on it.
	boardWidth: 1200,
	boardHeight: 960,
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

	// THE TRASH CAN, printed on every editable portrait and hidden by the stylesheet until a right
	// press asks for it. Printed rather than built on demand because a can that only existed once
	// somebody had asked would have to be made, placed and labelled from JavaScript, and its
	// accessible name would live somewhere the rest of this board's names do not.
	it("gives every portrait a trash can, named after the person it is about", () => {
		const html = render(boardContext());
		expect(html).toContain('data-relmap-remove="n1"');
		expect(html).toContain('data-relmap-remove="n2"');
		expect(html).toContain('data-tooltip="Take Elena off this map" aria-label="Take Elena off this map"');
	});

	// ⚠ AND NOT ONE ON A BOARD THIS READER MAY ONLY LOOK AT. Same gate as the handle, and the more
	// important of the two: a delete button that did nothing would be a promise the map cannot keep.
	it("prints no trash can where the reader may not edit", () => {
		expect(render({ ...boardContext(), canEdit: false })).not.toContain("data-relmap-remove");
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

	// ⚠ NO SECOND STROKE LAYER. The family tree drew one — a square-cornered stroke per household,
	// over the bowed lines — and it is gone with the view that asked for it. A board carries the
	// lines somebody drew and nothing else.
	it("draws no second stroke layer over the lines", () => {
		const html = render(boardContext());
		expect(html).not.toContain("stonetop-relmap-tree");
		expect(html.match(/class="stonetop-relmap-lines"/g)).toHaveLength(1);
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
	// a `<g>` costs an offscreen buffer apiece. (What makes a hundred captions affordable at all is
	// that the words are set STRAIGHT rather than warped onto a rail, which is pinned below.)
	it("draws every caption in ONE svg root, however many there are", () => {
		const context = boardContext();
		const label = context.labels[0];
		const html = render({
			...context,
			labels: [label, { ...label, id: "e2", railId: "relmap-rail-map1-1" }],
		});
		expect(html.match(/<svg/g)).toHaveLength(
			// the stroke layer, one head, ONE caption layer for both captions, and the empty layer
			// the lit person's copies are put into
			4,
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

	// ⚠ A LINE WITH NOTHING WRITTEN ON IT HAD NO TARGET AT ALL. The caption was the only thing on a
	// line a reader could aim at, so a line drawn without one could be reached from neither the
	// mouse nor the keyboard -- and the one gesture that would put writing on it is a click on the
	// line. The painted stroke cannot take that click: it is four screen pixels wide, in a layer
	// that refuses pointer events so a drag on bare board pans it.
	it("lays an invisible target along every line", () => {
		const html = render(boardContext());
		expect(html).toContain('<path class="stonetop-relmap-hit" data-relmap-hit="e1"');
	});

	// ⚠ THE WHOLE CURVE AND NOT THE BROKEN ONE. The gap cut out of the painted stroke for a caption
	// to sit in is the exact stretch a reader aims at, so a target with the same gap would be dead
	// in the middle.
	it("gives the target the whole curve, gap and all", () => {
		const html = render(boardContext());
		expect(html).toMatch(/data-relmap-hit="e1" d="M 20,30 Q 45,28 70,30"/);
		expect(html).toMatch(/data-relmap-line="e1" d="M 20,30 Q 45,28 60,30"/);
	});

	// A class and not a dash pattern written into the markup, for the reason the ink is a class:
	// what a mark resolves to is the stylesheet's business and has to stay retunable under the
	// accessibility skin.
	//
	// ⚠ AND IT IS THE KEY AND NOT A FLAG PER KIND. There are three answers now (RELMAP_DASHES) and
	// a whole line is the ABSENCE of a modifier, so a fourth arrives drawn rather than silently
	// solid -- which is the failure nothing else in this window would show.
	it("marks a stroke the reader broke, and leaves a solid one bare", () => {
		const context = boardContext();
		expect(render(context)).not.toContain("stonetop-relmap-line--rose is-");
		for (const key of ["dotted", "dashed"]) {
			expect(render({ ...context, edges: [{ ...context.edges[0], broken: key }] }))
				.toContain(`stonetop-relmap-line--rose is-${key}`);
		}
	});

	// THE WORDS ARE THE BUTTON. There is no HTML button around them any more -- a wrapper would
	// have to be either the caption's enormous bounding box or a second element kept in step with
	// the glyphs, and both were what merging the layer got rid of. So the `<text>` carries the
	// manners itself, and utils/relmap-drag.js gives it Enter and Space.
	//
	// ⚠ ONE OTHER PLACE BUILDS THIS ELEMENT: `mintCaption` in dialogs/RelationshipMapWindow.js, for
	// the first letter typed onto a line that has never carried a caption. It is a preview the very
	// next paint replaces, so it copies the hooks and not the words -- but a hook renamed here has
	// to be renamed there, and the mint's own test in relationship-map-window.test.js pins the same
	// three that this line does.
	it("makes the writing itself the button", () => {
		const html = render(boardContext());
		expect(html).toMatch(/<text class="stonetop-relmap-label-text" role="button" tabindex="0"/);
		expect(html).toMatch(/aria-label="exes\. Click to change or delete this line\."/);
		expect(html).not.toContain('<button type="button" class="stonetop-relmap-label"');
	});

	// HOW BIG THE WRITING ON ONE LINE IS SET, and nothing at all on every other one.
	//
	// ⚠ A CUSTOM PROPERTY AND NOT A `font-size`. An inline size is the top of the cascade and would
	// beat the rule that blows the held line's caption up while the board is zoomed too far out to
	// read anything -- so a reader who had set that line bigger could no longer see what they were
	// typing, which is the one thing that rule exists for.
	it("hands a chosen size to the stylesheet as a property, and prints none otherwise", () => {
		const context = boardContext();
		// Zero is "whatever the sheet sets", which is every line on every board drawn before a
		// reader could ask for a bigger one. No attribute at all, so an ordinary board is unchanged.
		expect(render(context)).not.toContain("--relmap-caption-px");
		expect(render(context)).not.toContain("style=\"font-size");
		const big = render({ ...context, labels: [{ ...context.labels[0], px: 18 }] });
		expect(big).toContain("--relmap-caption-px: 18px");
	});

});

describe("the window template", () => {
	const render = compile(WINDOW);
	/**
	 * Just the window's buttons, which all now stand in the FOOTER under the board.
	 *
	 * ⚠ IT USED TO BE A TOOLBAR, matched on `.stonetop-relmap-tools`, and the row is gone: "Add
	 * someone" and the undo pair moved down beside the captions box. Every assertion below that
	 * says "nothing on this row" needs a row to be sure of, and the footer's tool group is it —
	 * the same controls, scoped the same way, so a control resurrected onto them is still caught.
	 * The scope matters for the same reason it always did: the empty panel over the board carries
	 * an "Add someone" of its own, which is a different control answering a different question.
	 */
	const bar = html => html.match(/<div class="stonetop-relmap-foot-tools">[\s\S]*?<\/div>\s*<\/div>/)[0];
	const context = (over = {}) => ({
		title: "The people of Stonetop", canEdit: true,
		empty: false,
		board: "<board/>", addLabel: "Add someone",
		addHint: "h", emptyLead: "Nobody yet",
		emptyHint: "Drag someone in",
		emptyAction: over.canEdit === false
			? null
			: { action: "add", label: "Add someone", icon: "fa-user-plus" },
		// ⚠ THE NAMES THEY ANSWER TO WHILE THEY ARE OFF, and nothing else. The two history
		// buttons carry no words at all, only the curved arrows; what they can do is written onto
		// them by `_paintHistory` — it lives on the reader's own machine, not in the document a
		// render was built from — so the render's job is to put them there saying they can do
		// nothing yet, which is the truth for a window that has only just appeared.
		undoNothing: "There is nothing of yours on this board to take back.",
		redoNothing: "There is nothing to do again.",
		hideLabels: false, labelsLabel: "Hide labels",
		labelsHint: "why anybody would want this",
		// THE TIE BAR'S SHELL, and only its shell: which swatch is pressed and what the arrows are
		// called depend on a line nobody has clicked yet, so `RelmapTieBar` writes those on open.
		maxLength: 60, labelField: "What it says", inkLabel: "Colour",
		dirLabel: "Which way it is read", dashLabel: "The stroke",
		inks: [{ key: "rose", name: "Rose" }, { key: "slate", name: "Slate" }],
		// A PATTERN and not a finished phrase: which colour the trigger names changes with every
		// line the reader clicks, and `RelmapTieBar` has no i18n in it to build one with.
		inkNamed: "Colour: {name}",
		// The rest of the wheel, under the eight: colours nobody named, each already named HERE
		// because the words came off the discs when the palette became a grid. Two of the forty is
		// enough to hold the markup to its shape.
		inkPresets: [{ hex: "#2295bf", name: "Azure" }, { hex: "#0b724f", name: "Deep jade" }],
		inkAcross: 8,
		// The last row of the palette: empty slots the bar fills from the colours already drawn on
		// this board, since a render knows nothing about a line nobody has clicked yet.
		inkCustomSlots: [0, 1, 2],
		inkCustomHeading: "Already on this board",
		inkCustomNamed: "The colour {name}, already on this board",
		inkCustomField: "A colour of your own",
		// The four readings arrive the same way the eight inks do -- from `RELMAP_DIRS`, through the
		// window -- rather than being written out in the markup. The icons are only what the buttons
		// are BUILT with; the two one-way ones are re-pointed on open from where the faces sit.
		dirs: [
			{ key: "none", icon: "fa-minus", name: "Both ways, evenly" },
			{ key: "a-b", icon: "fa-arrow-right-long", name: "One way, to the second person" },
			{ key: "b-a", icon: "fa-arrow-left-long", name: "One way, to the first person" },
			{ key: "both", icon: "fa-arrows-left-right", name: "Both ways, marked at each end" },
		],
		dashes: [
			{ key: "solid", name: "Solid line" },
			{ key: "dashed", name: "Dashed line" },
			{ key: "dotted", name: "Dotted line" },
		],
		// The same shape as `inkNamed` and for the same reason: which stroke the trigger names
		// changes with every line the reader clicks, and the bar has no i18n in it.
		dashNamed: "The stroke: {name}",
		// HOW BIG THE WRITING IS. The value each step stands for is the NUMBER, in board pixels,
		// which is both what the row is marked by and what its sample is set in.
		sizeLabel: "How big the writing is",
		sizes: [
			{ px: 10, name: "Small" },
			{ px: 12, name: "Normal" },
			{ px: 18, name: "Very large" },
		],
		sizeNamed: "How big the writing is: {name}",
		sizeBase: 12,
		sizeMin: 8,
		sizeMax: 48,
		sizeOwnLabel: "Your own",
		sizeOwnField: "A size of your own, in pixels",
		tie: { label: "This line", placeholder: "what this line says", rub: "Rub out this line" },
		...over,
	});

	it("compiles and drops the board in unescaped", () => {
		expect(render(context())).toContain("<board/>");
	});

	// ── The tie bar ──────────────────────────────────────────────────────────
	//
	// ⚠ INSIDE THE VIEWPORT AND OUTSIDE THE BOARD, which is a correctness matter rather than a
	// layout one: `{{{board}}}` is replaced wholesale on every live update, so a bar drawn in there
	// would be destroyed under the reader's hands the moment anybody else moved a portrait --
	// taking a half-typed caption and the focus with it.
	it("puts the tie bar in the viewport, beside the board and not inside it", () => {
		const html = render(context());
		const view = html.indexOf('class="stonetop-relmap-view"');
		expect(html.indexOf("stonetop-relmap-tiebar")).toBeGreaterThan(view);
		expect(html.indexOf("stonetop-relmap-tiebar")).toBeGreaterThan(html.indexOf("<board/>"));
	});

	// ⚠ RENDERED ALWAYS AND HIDDEN, never behind an `{{#if}}`, for the reason every panel over this
	// board is: `RelmapTieBar` can only write onto markup a render left standing.
	it("renders the bar hidden rather than leaving it out", () => {
		expect(render(context())).toMatch(/class="stonetop-relmap-tiebar"[^>]*hidden/);
	});

	// THE FIELD IS FIRST AND TAKES THE FOCUS, which is the whole of "click a line and start typing".
	// It is clipped off the bar rather than drawn on it -- the words go on the LINE -- but it is
	// still first in the markup, because that is where the focus lands and where a tab reaches it.
	it("opens the bar with the writing field", () => {
		const html = render(context());
		const bar = html.slice(html.indexOf("stonetop-relmap-tiebar"));
		expect(bar.indexOf('data-relmap-tie="words"'))
			.toBeLessThan(bar.indexOf('data-relmap-tie="inkopen"'));
		expect(bar).toContain('maxlength="60"');
	});

	// A PROMPT PRINTED IN A BOX NOBODY CAN SEE is a string kept in step with nothing. What a line
	// with nothing written on it looks like is a bare stretch of stroke, which is the truth.
	it("prints no placeholder in a field that is not drawn", () => {
		const html = render(context());
		const field = html.slice(html.indexOf('data-relmap-tie="words"'));
		expect(field.slice(0, field.indexOf(">"))).not.toContain("placeholder");
	});

	// WHAT STANDS ON THE BAR IS THE ANSWER: a disc, a word, and the press that drops the palette.
	// The word is empty here -- a render knows nothing about a line nobody has clicked yet -- and
	// `data-relmap-said` is the pattern the bar builds the trigger's spoken name out of, since
	// there is no i18n in that module to build one with.
	it("puts the answer on the bar, as a disc and a word", () => {
		const html = render(context());
		expect(html).toMatch(/<button[^>]*data-relmap-tie="inkopen"/);
		expect(html).toContain('data-relmap-said="Colour: {name}"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('data-relmap-tie-mark="ink"');
		expect(html).toContain('data-relmap-tie-name="ink"');
	});

	// EVERY SWATCH IN THE PALETTE CARRIES ITS NAME, twice over: on the element, where `RelmapTieBar`
	// reads it to put on the trigger, and in the tooltip and the spoken label, which is where a
	// reader gets at it now that the palette is a grid of discs rather than a list of words. The
	// colour is never the only thing said, which is what makes this usable by the readers at this
	// table who cannot resolve two of the eight against each other.
	it("lays the eight out as named swatches", () => {
		const html = render(context());
		expect(html).toMatch(/<div class="stonetop-relmap-inkpop"[^>]*hidden/);
		for (const [key, name] of [["rose", "Rose"], ["slate", "Slate"]]) {
			expect(html).toMatch(
				new RegExp(`data-relmap-tie="ink" data-relmap-tie-value="${key}"\\s+data-relmap-name="${name}"`),
			);
			expect(html).toContain(`stonetop-relmap-inkpop-swatch stonetop-relmap-ink--${key}`);
			expect(html).toMatch(new RegExp(`aria-label="${name}" data-tooltip="${name}"`));
		}
	});

	// THE STROKE IS THE SECOND QUESTION ASKED IN A PANEL, and what stands on the bar is the ANSWER:
	// a drawn rule and a caret, with the name in words rather than beside the sample -- a stroke is
	// a shape, and the shape here is the one the line is drawn with. The bar writes which rule that
	// is on open, so what a render owes is the trigger, the pattern its spoken name is built from,
	// and a first paint that is a line rather than a hole.
	it("puts the stroke on the bar as a drawn rule, and the three under it", () => {
		const html = render(context());
		expect(html).toMatch(/<button[^>]*data-relmap-tie="dashopen"/);
		expect(html).toContain('data-relmap-said="The stroke: {name}"');
		expect(html).toMatch(/data-relmap-tie-mark="dash"[\s\S]*?stonetop-relmap-tiebar-rule--solid/);
		expect(html).toMatch(/<div class="stonetop-relmap-dashpop"[^>]*hidden/);
		for (const [key, name] of [["solid", "Solid line"], ["dashed", "Dashed line"], ["dotted", "Dotted line"]]) {
			expect(html).toMatch(
				new RegExp(`data-relmap-tie="dash" data-relmap-tie-value="${key}"\\s+data-relmap-name="${name}"`),
			);
			// Each row DRAWS the line it means rather than wearing an icon: `fa-ellipsis` sat two
			// buttons from `fa-ellipsis-vertical` and the two read as one control.
			expect(html).toContain(`stonetop-relmap-tiebar-rule--${key}`);
			// AND PRINTS ITS NAME, which is the one thing the palette's swatches gave up when they
			// became a grid and these did not: three rows have room for their words, and 18px of
			// dots beside 18px of dashes is exactly the distinction a name has to carry.
			expect(html).toContain(`>${name}</span>`);
		}
	});

	// HOW BIG THE WRITING IS: the third question asked in a panel, and the answer on the bar is a
	// NUMBER. Five steps have names and any other number a reader types has none, so a trigger that
	// showed the name would be blank on exactly the answers somebody chose for themselves.
	it("puts the size on the bar as a number, and the steps under it", () => {
		const html = render(context());
		expect(html).toMatch(/<button[^>]*data-relmap-tie="sizeopen"/);
		expect(html).toContain('data-relmap-said="How big the writing is: {name}"');
		// A first paint that is a number rather than a hole. The bar rewrites it on every open.
		expect(html).toMatch(/data-relmap-tie-mark="size"[\s\S]*?>12</);
		expect(html).toMatch(/<div class="stonetop-relmap-sizepop"[^>]*hidden/);
		for (const [px, name] of [[10, "Small"], [12, "Normal"], [18, "Very large"]]) {
			expect(html).toMatch(
				new RegExp(`data-relmap-tie="size" data-relmap-tie-value="${px}"\\s+data-relmap-name="${name}"`),
			);
			// ⚠ EACH STEP SHOWS ITSELF, set in the very size it stands for -- which is what a reader
			// is actually choosing between. A column of five identical labels would make them read
			// the numbers to find out what the list meant.
			expect(html).toContain(`style="font-size: ${px}px"`);
			expect(html).toContain(`>${name}</span>`);
		}
	});

	// A SIZE NOBODY OFFERED, which is the ninth colour again: five steps are what a table reaches
	// for, and the reader on the magnifier wants the one number that works on their screen.
	it("offers a field for a size of the reader's own, inside the bounds the store keeps", () => {
		const html = render(context());
		expect(html).toMatch(/<input[^>]*type="number"[^>]*data-relmap-tie="sizenum"/);
		expect(html).toMatch(/min="8"\s+max="48"/);
		expect(html).toContain('aria-label="A size of your own, in pixels"');
	});

	// ⚠ THE WORDS CAME OFF THE FACE OF THE SWATCHES AND NOWHERE ELSE. The palette is a grid of discs
	// now, which is what a table asked for and what forty more colours made necessary; a version
	// that dropped the name from the ELEMENT as well would take it from the trigger, from the
	// tooltip and from every screen reader at once, and would look identical.
	it("prints no word on the face of a swatch, and keeps every name on it", () => {
		const html = render(context());
		expect(html).not.toContain("stonetop-relmap-inkpop-word");
		expect(html).toContain('data-relmap-name="Rose"');
		expect(html).toContain('data-relmap-name="Azure"');
	});

	// THE REST OF THE WHEEL: colours nobody named, printed from the module rather than written out
	// in the markup -- a second copy of forty hexes is a second copy to drift, and the one that
	// would drift silently is the swatch.
	//
	// ⚠ THE COLOUR RIDES AS `--relmap-ink-raw` UNDER THE `--custom` CLASS, which is how the board
	// itself paints a line of this colour. Written as `--relmap-ink`, the swatch would sit at the
	// raw hue under the high-contrast skin while the line it stands for was taken darker.
	it("lays the presets out under the eight, each named and carrying its own colour", () => {
		const html = render(context());
		expect(html).toContain("stonetop-relmap-inkpop-grid--more");
		for (const [hex, name] of [["#2295bf", "Azure"], ["#0b724f", "Deep jade"]]) {
			expect(html).toMatch(new RegExp(
				`data-relmap-tie="ink" data-relmap-tie-value="${hex}"\\s+data-relmap-name="${name}" data-relmap-ink-preset="${hex}"`,
			));
			expect(html).toContain(`style="--relmap-ink-raw:${hex}"`);
			expect(html).toMatch(new RegExp(`aria-label="${name}" data-tooltip="${name}"`));
		}
	});

	// ⚠ HOW WIDE THE GRID IS, AS THE ARROW KEYS READ IT. `_across` walks up from whichever swatch is
	// focused, so this has to sit on the block holding all three grids and on nothing else -- the
	// direction and stroke rows must not inherit it, or Up would leap out of a four-button row.
	it("says how wide a row is, on the one block that holds every swatch", () => {
		const html = render(context());
		expect(html).toMatch(/role="radiogroup"[^>]*\s+data-relmap-ink-across="8"/);
		expect(html.match(/data-relmap-ink-across=/g)).toHaveLength(1);
	});

	// ⚠ ONE RADIO GROUP OVER BOTH ROWS. The eight and the colours already on the board are one
	// question with one answer -- a line is drawn in exactly one colour -- so they are one group,
	// with one tab stop and the arrow keys running through the whole of it. The `+` and the picker
	// are outside it: they ask a second question rather than answering this one.
	it("keeps the eight and the board's own colours in one group", () => {
		const html = render(context());
		const pop = html.slice(html.indexOf("stonetop-relmap-inkpop"));
		const group = pop.indexOf('role="radiogroup"');
		expect(group).toBeGreaterThan(-1);
		expect(pop.indexOf('data-relmap-tie-value="rose"')).toBeGreaterThan(group);
		expect(pop.indexOf('data-relmap-ink-slot="0"')).toBeGreaterThan(group);
		expect(pop.indexOf('data-relmap-tie="inkmore"'))
			.toBeGreaterThan(pop.indexOf('data-relmap-ink-slot="2"'));
	});

	// ⚠ FIXED SLOTS, RENDERED AND HIDDEN, rather than elements built when they are wanted -- the
	// house rule for everything over this board, since `RelmapTieBar` can only write onto markup a
	// render left standing. The whole block goes away on a board with no colours of its own on it,
	// so a heading over an empty row never appears.
	it("prints an empty slot for each colour the board might already have", () => {
		const html = render(context());
		expect(html).toMatch(/data-relmap-tie-mine="ink"[^>]*hidden/);
		for (const at of [0, 1, 2]) {
			expect(html).toMatch(
				new RegExp(`data-relmap-ink-slot="${at}"[^>]*data-relmap-said="The colour \\{name\\}, already on this board"`),
			);
		}
		expect(html).toContain("Already on this board");
	});

	// ⚠ RENDERED ALWAYS AND HIDDEN, like every other panel over this board -- and unlike the rest of
	// them this one is a CUSTOM ELEMENT, which has to have been connected to the document to have
	// built its own two inputs at all. Left out until it was wanted, it would arrive empty.
	it("carries the colour picker, put away until it is asked for", () => {
		const html = render(context());
		expect(html).toMatch(/<color-picker[^>]*data-relmap-tie="inkhex"/);
		expect(html).toMatch(/<color-picker[^>]*hidden/);
		// And the way to it is a NAMED button rather than a bare `+`: this is a table with two
		// readers who choose by reading, and a plus sign names nothing at all.
		expect(html).toContain("A colour of your own");
	});

	// Four presses and not three: "no arrow at either end" is an answer as much as the other three,
	// and is the one most lines want.
	it("offers all four readings of a line, none of them named here", () => {
		const html = render(context());
		for (const dir of ["none", "a-b", "b-a", "both"]) {
			expect(html).toMatch(new RegExp(`data-relmap-tie="dir"\\s+data-relmap-tie-value="${dir}"`));
		}
	});

	// Rubbing a line out is the last press on the bar, where the button that opened the editor
	// window used to be. It asks nothing first -- the undo is what puts a line back -- so the one
	// thing the markup has to get right is that it is set apart from the presses that only change
	// the line, and says what it is to a reader who cannot see the glyph.
	it("offers rubbing the line out, at the end of the bar and named", () => {
		const html = render(context());
		const bar = html.slice(html.indexOf("stonetop-relmap-tiebar"));
		expect(bar).toContain('data-relmap-tie="rub"');
		expect(bar).toContain("stonetop-relmap-tiebar-rub");
		expect(bar).toContain('aria-label="Rub out this line"');
		// Last: it ends the line, where everything before it changes one.
		expect(bar.indexOf('data-relmap-tie="rub"'))
			.toBeGreaterThan(bar.lastIndexOf('data-relmap-tie="dash"'));
	});

	// THE BOX THAT TAKES THE WORDS OFF THE LINES, and it is OUTSIDE the permission gate with the
	// captions cycle and the view chooser that used to stand beside it: it changes what one reader
	// is looking at and nothing in the document. The player who may only read a village board
	// buried under a hundred captions is exactly the person who needs it.
	it("offers the hide box to a reader who may not edit", () => {
		const html = render(context({ canEdit: false, showBoardTools: false }));
		expect(html).toContain('data-relmap-action="hidelabels"');
		expect(html).toContain("Hide labels");
	});

	// ⚠ NEVER HIDDEN. The box that stood here before was about one board's history -- the lines an
	// old import had written -- and appeared only where there were any. This one is about a board
	// with a village on it, which is every board, so there is no condition to render it behind.
	it("always offers the footer", () => {
		const foot = html => html.match(/<div class="stonetop-relmap-foot"[^>]*>/)[0];
		expect(foot(render(context()))).not.toContain("hidden");
		expect(foot(render(context({ canEdit: false })))).not.toContain("hidden");
	});

	// ⚠ AND NEITHER CONTROL FOR THE PULLED-IN LINES IS LEFT. "Rub out pulled-in lines" took the
	// whole lot off the shared board in one press, and the box beside it put them away for one
	// reader; a line an old import wrote is now read, rubbed out and undone exactly like every
	// other line. Guarded here so a context key resurrected by accident cannot put either back.
	it("offers nothing aimed at the pulled-in lines", () => {
		const html = render(context());
		expect(html).not.toContain('data-relmap-action="droppulled"');
		expect(html).not.toContain('data-relmap-action="hidepulled"');
	});

	// The class the stylesheet hangs the whole of this on. Written at render as well as by
	// `_paintChrome`, or a re-render would put the words back under a reader who turned them off.
	it("writes the reader's answer onto the root", () => {
		expect(render(context({ hideLabels: true }))).toContain("captions-off");
		expect(render(context({ hideLabels: false }))).not.toContain("captions-off");
	});

	// ⚠ GONE FOR GOOD, both of them. The party board and the village board still seat themselves on
	// open; what was removed is the pair of buttons asking for that same pass out loud, because the
	// map already answers "somebody is missing from this board" by drag or by "Add someone". Guarded
	// here so a context key resurrected by accident cannot quietly put them back in the footer.
	it("offers no refresh buttons at all", () => {
		const on = bar(render(context({ showRefreshParty: true, showRefreshVillage: true })));
		expect(on).not.toContain('data-relmap-action="refreshparty"');
		expect(on).not.toContain('data-relmap-action="refreshvillage"');
	});

	// ⚠ MATCHED ON THE BOX ITSELF AND NOT ON THE WORD. This asked whether the whole document
	// contained "checked" anywhere, which was true the day the tie bar arrived carrying nine
	// `aria-checked` radios -- a test that failed for a reason with nothing to do with what it is
	// about. The attribute is bare (Handlebars writes `checked` with no value), so the assertion is
	// the input element with it and the same input without.
	it("ticks the box when the words are off", () => {
		expect(render(context({ hideLabels: true })))
			.toMatch(/data-relmap-action="hidelabels"[^>]*\schecked/);
		expect(render(context({ hideLabels: false })))
			.not.toMatch(/data-relmap-action="hidelabels"[^>]*\schecked/);
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

	// ⚠ THERE IS NO TOOLBAR OVER THE BOARD, and this is the window's shape rather than a detail of
	// it. A row of buttons stood between the window's title and the page strip; everything left on
	// it moved into the footer, so nothing but the strip stands between the reader and the board.
	// Asserted because a control added back "on the bar" would render perfectly well in a div that
	// no stylesheet has laid out since.
	it("carries no toolbar row above the board", () => {
		const html = render(context());
		expect(html).not.toContain("stonetop-relmap-bar");
		expect(html).not.toContain("stonetop-relmap-tools");
	});

	// ⚠ AND NO "MATCH ANSWERS TO PEOPLE". It was a GM-only button on the party's board that drew
	// what the introductions had recorded onto it, for a table whose answers were taken down before
	// the introductions thought to ask who each one was about. Guarded here, with its context keys
	// forced on, so neither the button nor the keys that dressed it can come back unnoticed.
	it("offers no way to match the introductions' answers to people", () => {
		const html = render(context({
			showMatchIntros: true,
			matchIntrosLabel: "Match answers to people",
			matchIntrosHint: "hint",
		}));
		expect(html).not.toContain('data-relmap-action="matchintros"');
		expect(html).not.toContain("Match answers to people");
	});

	// THE BOX ON THE LEFT, THE BUTTONS ON THE RIGHT. What is drawn for this reader alone sits in
	// the corner the eye returns to last; everything that writes to the shared board sits at the
	// other end of the same line. The order in the markup is what a screen reader and the keyboard
	// follow, so it is asserted rather than left to the auto margin that paints it.
	it("puts the tools after the captions box, on the same footer row", () => {
		const html = render(context());
		const foot = html.slice(html.indexOf('<div class="stonetop-relmap-foot">'));
		expect(foot.indexOf("stonetop-relmap-foot-tools"))
			.toBeGreaterThan(foot.indexOf('data-relmap-action="hidelabels"'));
		expect(bar(html)).toContain('data-relmap-action="add"');
		expect(bar(html)).toContain('data-relmap-action="undo"');
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
	// because a pair appearing and vanishing as the reader worked would shuffle the whole row
	// sideways under the pointer.
	it("never renders an editing tool disabled, but the two history buttons", () => {
		const off = (render(context()).match(/<button[^>]*>/g) ?? [])
			.filter(tag => tag.includes("disabled"))
			.map(tag => tag.match(/data-relmap-action="([^"]+)"/)?.[1]);
		expect(off.sort()).toEqual(["redo", "undo"]);
	});

	// AT THE END OF THE ROW, after every board tool. A reader reaches for undo by muscle memory, so
	// where it sits must not depend on anything but the permission that decides whether it is there
	// at all.
	it("puts the history buttons last in the footer, after the board's own tools", () => {
		// The TOOL GROUP alone: the empty panel over the board carries an "Add someone" of its own,
		// which is a different control answering a different question.
		const row = bar(render(context()));
		expect(row.indexOf('data-relmap-action="undo"'))
			.toBeGreaterThan(row.indexOf('data-relmap-action="add"'));
		expect(row).toContain('data-relmap-action="redo"');
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

	// AND IT IS NO LONGER "ADD EVERYONE". Putting the whole cast on in one press is exactly the
	// crowding a second page exists to escape, so the bulk button is gone; what the panel offers is
	// what its own hint already told the reader to use.
	it("offers Add someone on an empty board, not a way to add everybody at once", () => {
		const panel = render(context({ empty: true })).match(/<div class="stonetop-relmap-empty"[\s\S]*?<\/div>/)[0];
		expect(panel).toContain('data-relmap-action="add"');
		expect(render(context())).not.toContain('data-relmap-action="cast"');
	});

	// ⚠ NOTHING ON THIS BAR ASKS THE MAP A DIFFERENT QUESTION ANY MORE. It carried a four-way
	// "Showing" chooser (the whole web, the party, one person's web, the family tree), the person
	// chooser that aimed the third, and "Find family ties", which fed the fourth. All of it is
	// gone; the pages below the bar are what thins a crowded map now. Asserted rather than left
	// implicit, because the window still has to be the only thing that decides what a board draws.
	it("offers no view chooser, no person chooser, and no find-family-ties", () => {
		const row = bar(render(context()));
		expect(row).not.toContain("data-relmap-view");
		expect(row).not.toContain("data-relmap-focus");
		expect(row).not.toContain('data-relmap-action="findkin"');
	});

	// ⚠ AND NO "TIDY UP". It was the one control on this bar that could throw away, in a single
	// press, an arrangement the table had built up over a season.
	it("offers no way to lay the board out again", () => {
		expect(bar(render(context()))).not.toContain('data-relmap-action="tidy"');
	});

	// ⚠ AND NO CAPTIONS CYCLE. Every line's caption is drawn; what rescues a dense board is the
	// lighting, which is the board's own doing and needs no control.
	it("offers no captions cycle, and says so on the root", () => {
		expect(render(context())).not.toContain('data-relmap-action="labels"');
		expect(render(context())).toContain("labels-all");
	});

	// ⚠ AND NO SECOND PANEL OVER THE BOARD. There used to be one for "this VIEW is showing nobody",
	// separate from "this MAP has nobody on it" — five situations between them, all but the last
	// belonging to a narrow view. One board, one panel.
	it("carries one panel over the board and no second one", () => {
		const html = render(context({ empty: true }));
		expect(html).not.toContain("stonetop-relmap-nokin");
		expect(html).not.toContain("stonetop-relmap-aside");
		expect(html.match(/class="stonetop-relmap-empty"/g)).toHaveLength(1);
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
			.toContain('aria-label="exes. Click to change or delete this line."');
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
		hideLabels: false,
		// The strip's own context.
		showPages: true,
		pageTabs: '<button data-relmap-page="p1" class="stonetop-relmap-page is-current">Stonetop</button>',
		pagePanelId: "stonetop-relmap-map1-page-p1",
		pagesLabel: "Pages of this map",
		pageNewHint: "Start another board",
		pageRenameHint: "Rename the page you are on",
		pageDeleteHint: "Rub out the page you are on",
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

	// ⚠ GLYPH ONLY. The words used to sit beside the icons, on the one row whose whole job is to
	// say which board is up — three pieces of tool prose competing with the tab names, and taking
	// width from a strip that scrolls. What replaced them is nothing at all in the markup: no
	// span, no text node, just the icon.
	it("carries no words beside the three glyphs", () => {
		const html = render(context());
		for (const action of ["pagenew", "pagerename", "pagedelete"]) {
			const button = html.match(
				new RegExp(`<button[^>]*data-relmap-action="${action}"[^>]*>([\\s\\S]*?)</button>`),
			)[1];
			expect(button).toMatch(/^\s*<i class="fas [^"]+"><\/i>\s*$/);
		}
	});

	// AND NOTHING IS LOST TO A READER WHO CANNOT READ THE GLYPH: the hint was always the
	// accessible name (`aria-label` overrode the span even when there was one), and it is still
	// both that and the tooltip.
	it("keeps the full hint as each glyph's name and its tooltip", () => {
		const html = render(context());
		for (const hint of ["Start another board", "Rename the page you are on",
			"Rub out the page you are on"]) {
			expect(html).toContain(`data-tooltip="${hint}"`);
			expect(html).toContain(`aria-label="${hint}"`);
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

// -- The portrait sits where its lines are drawn to -------------------------------------------
//
// A stylesheet suite in a template file, because this is one fact split across the two: the
// geometry trims every stroke, stands every arrowhead off and dodges every clearance against a
// circle of RELMAP_NODE_PX at the node's stored coordinates, and it is the MARKUP that decides
// where that circle actually lands. They disagreed once, and the way it showed was an arrowhead
// sliding under the face it pointed at, but only on lines arriving from above.
describe("a portrait's box is the circle and nothing else", () => {
	const css = read("styles/stonetop.css").replace(/\/\*[\s\S]*?\*\//g, "");
	// EVERY block whose whole selector is this class, joined. `.stonetop-relmap-name` carries
	// two of them: its own, and the one line handing the three inner parts their pointer events.
	const rule = name => [...css.matchAll(
		new RegExp(`(?:^|[\\n,])\\s*\\.stonetop-relmap-${name}\\s*\\{([^}]*)\\}`, "g"),
	)].map(found => found[1]).join("\n");

	// Both axes, at the size the geometry converts to a radius. A box taller than it is wide is
	// centred on the middle of the whole column rather than on the middle of the face.
	it("is a square the size of the face", () => {
		const node = rule("node");
		expect(node).toMatch(new RegExp(`width:\\s*${RELMAP_NODE_PX}px`));
		expect(node).toMatch(new RegExp(`height:\\s*${RELMAP_NODE_PX}px`));
	});

	// THE REGRESSION ITSELF: the name back in the flow, making the node about 92px tall and
	// carrying the circle ten pixels off the coordinate every line is aimed at.
	it("hangs the name out of the flow rather than stacking it under the face", () => {
		expect(rule("name")).toMatch(/position:\s*absolute/);
	});
});
