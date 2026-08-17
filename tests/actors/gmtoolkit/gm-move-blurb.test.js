import { describe, it, expect } from "vitest";
import { readRepo as read, readCss } from "../../fakes/css.js";
import { moveBlurb } from "../../../module/gm-toolkit/gm-move-blurb.js";
import { BASIC_GM_MOVES, EXPLORATION_GM_MOVES, HOMEFRONT_GM_MOVES } from "../../../module/gm-toolkit/gm-moves.js";

// The Moves tab shows each entry as one blurb that grows: the book's first sentence under the
// name, and the rest of that paragraph revealed in place after it. What can go wrong is quiet.
// A split at the wrong full stop cuts a sentence in half on screen; a lead that comes back empty
// leaves a name with a blank line under it and a caret that opens something invisible.

const CSS       = readCss();
const MOVES_HBS = read("templates/actor/partials/gm-toolkit-tab-moves.hbs");
const ALL_MOVES = [...BASIC_GM_MOVES, ...EXPLORATION_GM_MOVES, ...HOMEFRONT_GM_MOVES];

describe("moveBlurb", () => {
	it("leads with the book's first sentence and keeps the remainder whole", () => {
		const { lead, rest, paragraphs } = moveBlurb(BASIC_GM_MOVES[0]);
		expect(lead).toBe("This is one of your most versatile moves.");
		expect(rest).toBe("Trouble almost always provokes a reaction, or at least gets folks worrying and cranks up the tension.");
		// One paragraph in, nothing left over.
		expect(paragraphs).toEqual([]);
	});

	// Rejoining the two has to give the paragraph back exactly, or the sentence a reader sees
	// grow in place is not the sentence the book printed.
	it("loses nothing in the split, for any move", () => {
		for (const move of ALL_MOVES) {
			const { lead, rest, paragraphs } = moveBlurb(move);
			const first = move.detail[0] ?? move.hardness;
			expect([lead, rest].filter(Boolean).join(" "), move.name).toBe(first);
			expect(paragraphs, move.name).toEqual(move.detail.slice(1));
		}
	});

	it("gives every move something to lead with", () => {
		for (const move of ALL_MOVES) {
			const { lead } = moveBlurb(move);
			expect(lead.length, `${move.name} leads with nothing`).toBeGreaterThan(10);
			expect(lead, move.name).toMatch(/[.!?]$|^[^.!?]+$/);
		}
	});

	// The abbreviations the transcription actually contains all close with a bracket, so none of
	// them ends a sentence. This is the case that would silently cut a line in half.
	it("does not split inside a bracketed abbreviation", () => {
		const downside = moveBlurb(BASIC_GM_MOVES.find(m => m.name === "Demonstrate a downside"));
		expect(downside.lead).toContain("(e.g.) the Heavy.");
	});

	// Capture someone has no description at all: its whole Book I entry IS the soft/hard line. It
	// leads with that, and must not then print it again under the blurb.
	it("leads with the soft/hard line when that is the whole entry, and does not repeat it", () => {
		const capture = BASIC_GM_MOVES.find(m => m.name === "Capture someone");
		expect(capture.detail).toEqual([]);
		const { lead, hardness } = moveBlurb(capture);
		expect(lead).toBe("On a soft version of this move, capture them but stay in the scene, giving them a chance to escape (or others a chance to rescue them).");
		expect(hardness).toBe("");
	});

	// ...while a move that has both keeps the soft/hard line for the panel, where it sits under
	// the description rather than in front of it.
	it("keeps the soft/hard line below when the move has a description too", () => {
		const { lead, hardness } = moveBlurb(BASIC_GM_MOVES[0]);
		expect(lead).not.toContain("As a hard move");
		expect(hardness).toBe(BASIC_GM_MOVES[0].hardness);
	});

	it("shrugs at a move with nothing in it", () => {
		expect(moveBlurb(undefined)).toMatchObject({ lead: "", rest: "", paragraphs: [] });
		expect(moveBlurb({ gloss: "Only a gloss." }).lead).toBe("Only a gloss.");
	});
});

describe("the blurb on the page", () => {
	// The caret is drawn by the BUTTON, so it turns with the button's own state, and it is pinned
	// to the row's right edge rather than trailing the text. One right edge and thirty rows means
	// the control is in the same place every time; a caret chasing the end of each sentence is
	// thirty different places, and lands mid-line the moment that sentence grows.
	it("pins the caret to the right edge, off the button", () => {
		expect(CSS).toMatch(/\.stonetop-gm-move-toggle::after\s*\{[^}]*content:/);
		expect(CSS).not.toMatch(/\.stonetop-gm-move-lead::after\s*\{[^}]*content:/);

		const caret = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-toggle::after\s*\{([^}]*)\}/)?.[1];
		expect(caret, "no caret rule").toBeTruthy();
		expect(caret).toMatch(/position:\s*absolute/);
		expect(caret).toMatch(/right:\s*0/);
		// Out of flow needs something to resolve against, and it must be the BUTTON rather than
		// the row: a lit row's padding box grows 6px either side for five seconds (the flash
		// band), and a caret pinned to that would slide out and back while the light was on.
		const button = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-toggle\s*\{([^}]*)\}/)?.[1];
		expect(button).toMatch(/position:\s*relative/);
		// ...and the lane it sits in stays clear on the NAME, which is the line it now sits on and
		// the one that wraps under it (four of the thirty names do).
		const name = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-name\s*\{([^}]*)\}/)?.[1];
		expect(name).toMatch(/padding-right:\s*var\(--st-gm-caret-lane\)/);
	});

	// The caret is the ROW's control, so it sits level with the row's title rather than with the
	// blurb it happens to be drawn by. Because the button is what draws it (that is what makes it
	// turn with the button's state), landing on the name's line means walking back up over the gap
	// and the name's whole line box, and the numbers for both come from the variables the name is
	// set from. Spelled as literals instead, a change to the name's size would leave the caret
	// floating between the two lines with nothing failing.
	it("lifts the caret onto the name's line, off the name's own metrics", () => {
		const caret = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-toggle::after\s*\{([^}]*)\}/)?.[1];
		expect(caret).toMatch(/top:\s*calc\(-1 \* \(var\(--st-gm-blurb-gap\) \+ var\(--st-gm-name-size\) \* var\(--st-gm-name-line\)\)\)/);
		// Centred on that line by being a box of exactly its height, which is the one way that
		// survives the user's font scale: a fixed nudge tuned at 16px drifts at 20px.
		expect(caret).toMatch(/height:\s*calc\(var\(--st-gm-name-size\) \* var\(--st-gm-name-line\)\)/);
		expect(caret).toMatch(/align-items:\s*center/);

		// One source for those numbers, declared on the entry and read by all three rules.
		const entry = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move\s*\{([^}]*)\}/)?.[1];
		expect(entry).toMatch(/--st-gm-name-size:/);
		expect(entry).toMatch(/--st-gm-name-line:/);
		expect(entry).toMatch(/--st-gm-blurb-gap:/);
		const name = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-name\s*\{([^}]*)\}/)?.[1];
		expect(name).toMatch(/font-size:\s*var\(--st-gm-name-size\)/);
		expect(name).toMatch(/line-height:\s*var\(--st-gm-name-line\)/);
		expect(button()).toMatch(/margin:\s*var\(--st-gm-blurb-gap\)/);

		function button() {
			return CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-toggle\s*\{([^}]*)\}/)?.[1];
		}
	});

	// Bigger than the line it marks and in the page's darkest ink. At the blurb's 0.85rem a caret
	// set in secondary ink at inherited size is a grey speck at the edge of a grey line.
	it("sets the caret larger and darker than the line it marks", () => {
		const caret = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-toggle::after\s*\{([^}]*)\}/)?.[1];
		expect(caret).toMatch(/font-size:\s*1\.[2-9]/);
		expect(caret).toMatch(/color:\s*var\(--st-text\)/);
		expect(Number(caret.match(/opacity:\s*([\d.]+)/)?.[1])).toBeGreaterThanOrEqual(0.7);
	});

	// The blurb is a paragraph to read, not a link. Underlining a whole sentence on hover fights
	// the reading, so the caret answers the hover instead.
	it("does not underline the description on hover", () => {
		expect(CSS).not.toMatch(/\.stonetop-gm-move-toggle:hover \.stonetop-gm-move-lead\s*\{[^}]*text-decoration:\s*underline/);
		expect(CSS).toMatch(/\.stonetop-gm-move-toggle:hover::after\s*\{[^}]*opacity/);
	});

	// The rest of the sentence is revealed INSIDE the button, immediately after the lead. Outside
	// it, or after the panel, and the sentence would restart somewhere else on the page instead of
	// carrying on.
	it("puts the revealed remainder inside the button, right after the lead", () => {
		expect(MOVES_HBS).toMatch(
			/<span class="stonetop-gm-move-lead">\{\{blurb\.lead\}\}<\/span>[\s\S]{0,80}?class="stonetop-gm-move-rest" hidden>/);
		expect(MOVES_HBS.indexOf('class="stonetop-gm-move-rest"'))
			.toBeLessThan(MOVES_HBS.indexOf("</button>"));
	});

	// Both halves move on one call, from one selector, so a blurb cannot finish its sentence above
	// a panel that stayed shut.
	it("opens the remainder and the panel together", () => {
		const sheet = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
		expect(sheet).toContain('toggleDisclosure(toggle, ".stonetop-gm-move-rest, .stonetop-gm-move-book")');
	});

	// The panel is the same passage continuing, so it sits flush with the blurb. An indent or a
	// rule down its left would draw a seam exactly where the reading should not break.
	it("sets the panel flush with the blurb rather than as an indented aside", () => {
		const panel = CSS.match(/\.stonetop-gm-toolkit-moves \.stonetop-gm-move-book\s*\{([^}]*)\}/)?.[1];
		expect(panel, "no rule for the panel").toBeTruthy();
		expect(panel).not.toMatch(/border-left/);
		expect(panel).not.toMatch(/padding-left/);
	});
});
