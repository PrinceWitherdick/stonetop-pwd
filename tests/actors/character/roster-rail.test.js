/**
 * The left rail that the standing rosters — the Judge's brands and oaths, the Blessed's five kinds
 * of mark — show their lists behind, one at a time.
 *
 * The lists grow without bound and never shrink on their own, so stacked they made a window taller
 * than the screen by the fourth session. The rail is what fixed that, and it fails in three ways
 * that a browser reports as nothing at all:
 *
 *  • the SETTLING. `_railFor` decides which panel shows, and it has to re-decide every render,
 *    because a list can stop existing under the player's hands (the last oath released, the last
 *    Barkskin lifted). Left pointing at a key nothing renders, the window comes back with every
 *    panel hidden and nothing lit in the rail: a blank window that looks broken.
 *  • the CLASS CONTRACT. The rail, the panels and the scroll column are found by three class names
 *    agreed between `RosterDialog._selectTab` and two templates. A rename binds nothing and throws
 *    nothing — the tabs simply stop switching.
 *  • the [hidden] TRAP. The panels declare `display: flex`, which out-specifies the UA's
 *    `[hidden] { display: none }`. Without a rule saying so, every panel renders at once and the
 *    rail is decoration on top of exactly the tall window it replaced.
 */
import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, declarations, specificity, beats } from "../../fakes/css.js";
import { renderRoster } from "../../fakes/hbs.js";
import { RosterDialog } from "../../../module/actors/character/dialogs/RosterDialog.js";

const TABS_HBS      = read("templates/dialogs/partials/guide-tabs.hbs");
const CONDEMNED_HBS = read("templates/dialogs/condemned.hbs");
const MARKS_HBS     = read("templates/dialogs/blessed-marks.hbs");
const ROSTER_JS     = read("module/actors/character/dialogs/RosterDialog.js");
const CSS           = readCss();

/** The panel column's selector, as the sheet spells it: both classes, to beat the shared
 *  `.stonetop-guide-main` rule that sits later in the file. See the padding guard below. */
const COLUMN = ".stonetop-guide-main.stonetop-roster-main";

/** Everything `_railFor` reads or writes, and nothing else. `options` and `position` are in here
 *  because settling the rail also settles the frame's height — see `_setFrameHeight`. */
const railStub = (activeTab = null) => ({
	_activeTab: activeTab, _railKeys: [], _railed: false,
	options: { height: "auto" }, position: { height: "auto" },
	_setFrameHeight: RosterDialog.prototype._setFrameHeight,
});

/** `_railFor` on a bare object. */
function settle(sections, activeTab = null) {
	const self = railStub(activeTab);
	const view = RosterDialog.prototype._railFor.call(self, sections);
	return { self, view };
}

const S = (key) => ({ key, title: key, icon: "fa-x" });

const render = (hbs, context) => renderRoster(hbs, context);

describe("which panel a roster settles on", () => {
	// A rail of one entry is a label dressed as a choice, and it would cost 168px of width and a
	// fixed height to say what the window title already says. The single panel still has to render,
	// which is what pointing `activeTab` at it buys — both templates gate on that alone.
	it("draws no rail for a single list, but still names it as the active one", () => {
		const { self, view } = settle([S("brands")]);
		expect(view.railed).toBe(false);
		expect(view.tabs).toEqual([]);
		expect(view.activeTab).toBe("brands");
		expect(self._activeTab).toBe("brands");
	});

	it("draws one for two, and lights the first by default", () => {
		const { view } = settle([S("brands"), S("oaths")]);
		expect(view.railed).toBe(true);
		expect(view.tabs.map(t => t.key)).toEqual(["brands", "oaths"]);
		expect(view.tabs.map(t => t.selected)).toEqual([true, false]);
	});

	// These windows re-render after every write — lifting a mark, blurring a note — so a tab held
	// only in the DOM would snap back to the first list constantly.
	it("keeps the tab you were on across a re-render", () => {
		const { view } = settle([S("brands"), S("oaths")], "oaths");
		expect(view.activeTab).toBe("oaths");
		expect(view.tabs.find(t => t.key === "oaths").selected).toBe(true);
	});

	// THE one that shows as a blank window: release the last oath while standing on the Sworn tab
	// and that list stops rendering, leaving the active key pointing at nothing.
	it("falls back to the first list when the one you were on stops existing", () => {
		const { self, view } = settle([S("brands")], "oaths");
		expect(view.activeTab).toBe("brands");
		expect(self._activeTab).toBe("brands");
	});

	// Nothing to show at all still has to settle to something a template can compare against
	// rather than to a stale key from a previous render.
	it("settles to nothing when there are no lists left", () => {
		const { view } = settle([], "brands");
		expect(view.activeTab).toBe(null);
		expect(view.railed).toBe(false);
	});

	// A window that is not railed hugs its content; one that is, holds a fixed height so the frame
	// does not resize under the cursor each time a tab is clicked.
	it("hugs its content only while unrailed", () => {
		expect(Object.getOwnPropertyDescriptor(RosterDialog.prototype, "_autoHeight")
			.get.call({ _railed: false })).toBe(true);
		expect(Object.getOwnPropertyDescriptor(RosterDialog.prototype, "_autoHeight")
			.get.call({ _railed: true })).toBe(false);
	});

	it("ignores a click on a tab it never offered", () => {
		const self = { _railKeys: ["brands"], _activeTab: "brands", element: null };
		RosterDialog.prototype._selectTab.call(self, "oaths");
		expect(self._activeTab).toBe("brands");
	});

	// WHERE THE HEIGHT HAS TO LAND, and why both places. `options.height` is what core's positioner
	// consults every time it runs: while it reads "auto" the positioner blanks `style.height` and
	// measures the content, so a pixel height written anywhere else is measured away on the next
	// render and the railed window goes on hugging whichever panel is showing — jumping every time
	// the rail is clicked, which is the thing the rail exists to stop. `position.height` is the
	// value actually handed to that positioner, since `_render` ends with `setPosition(this.position)`.
	//
	// Checked by CALLING it rather than by grepping the source for a setPosition line, which is
	// what stood here: a grep passes whatever the call it finds actually does.
	const railFor = (self, keys) => RosterDialog.prototype._railFor.call(self, keys.map(S));

	it("gives a railed window a real pixel height, in both places core reads one", () => {
		const self = railStub();
		railFor(self, ["brands", "oaths"]);

		expect(self.options.height, "options.height still auto: core will measure the content away")
			.toBeTypeOf("number");
		expect(self.position.height).toBe(self.options.height);
	});

	it("hands it back to hugging when the last list goes", () => {
		const self = railStub();
		railFor(self, ["brands", "oaths"]);
		railFor(self, ["brands"]);

		expect(self.options.height).toBe("auto");
		expect(self.position.height).toBe("auto");
	});

	it("leaves the height alone across an ordinary re-render, so a drag survives", () => {
		// These windows re-render after every write — a mark lifted, a note blurred. Re-imposing
		// the rail height on each would undo a player's own resize a keystroke at a time.
		const self = railStub();
		railFor(self, ["brands", "oaths"]);
		self.options.height = 700;  // the player dragged the frame taller
		self.position.height = 700;
		railFor(self, ["brands", "oaths"]);

		expect(self.options.height).toBe(700);
	});
});

describe("the classes the rail is found by", () => {
	// One contract, three names, two templates and one wiring. Each is read through a selector
	// built from these constants in RosterDialog, so a rename in a template binds nothing.
	const CONTRACT = ["stonetop-roster-tab", "stonetop-roster-panel", "stonetop-roster-main"];

	it("is stated once in the wiring", () => {
		for (const cls of CONTRACT) expect(ROSTER_JS, `${cls} is not named in the wiring`).toContain(cls);
		// Looked up by the tab attribute the shared rail partial emits — NOT `data-step-index`,
		// which is the linear walkthroughs' rail and is read by a different handler entirely.
		expect(ROSTER_JS).toMatch(/dataKey: "tab"/);
		expect(TABS_HBS).toContain('data-tab="{{this.key}}"');
	});

	for (const [name, hbs] of [["the Judge's", CONDEMNED_HBS], ["the Blessed's", MARKS_HBS]]) {
		it(`is worn by ${name} template`, () => {
			for (const cls of CONTRACT) expect(hbs, `${cls} is missing`).toContain(cls);
			// And the rail itself comes from the shared partial rather than a sixth hand-rolled copy.
			expect(hbs).toContain('"stonetop.guide-tabs"');
		});
	}

	// Every panel carries the key its rail entry names, or clicking that entry hides everything.
	it("gives the Judge a panel per list, keyed to its rail entry", () => {
		const html = render(CONDEMNED_HBS, {
			editable: true, showBrands: true, showOaths: true,
			railed: true, activeTab: "brands",
			tabs: [
				{ key: "brands", title: "The Condemned", icon: "fa-stamp", count: 2, selected: true },
				{ key: "oaths", title: "The Sworn", icon: "fa-scroll", selected: false },
			],
			rows: [], hasRows: false, oaths: [], hasOaths: false,
		});
		expect(html).toMatch(/class="[^"]*stonetop-roster-panel[^"]*"[^>]*data-tab="brands"/);
		expect(html).toMatch(/class="[^"]*stonetop-roster-panel[^"]*"[^>]*data-tab="oaths"/);
		// The one you are not on is hidden, and the one you are on is not.
		expect(html).toMatch(/data-tab="oaths"\s*\n?\s*hidden/);
		expect(html).not.toMatch(/data-tab="brands"\s*\n?\s*hidden/);
		// The rail's count rides the entry that has one; an empty list passes none and shows none.
		expect(html).toContain('<span class="stonetop-guide-toc-count">2</span>');
		expect((html.match(/stonetop-guide-toc-count/g) ?? [])).toHaveLength(1);
	});

	it("gives the Blessed a panel per kind, keyed to its rail entry", () => {
		// No `selected` on a group: which panel shows is `activeTab` against the group's key, the
		// one gate both rosters use. A fixture that fed a per-panel flag was answering a question
		// getData never answers, and would have let every panel ship hidden unnoticed.
		const group = (key, label) => ({
			key, label, rule: "…", icon: "fa-paw", rows: [], hasRows: false,
			canAdd: true, signs: null,
		});
		const html = render(MARKS_HBS, {
			editable: true, hasGroups: true, railed: true, activeTab: "barkskin",
			listId: "stonetop-marks-suggestions", suggestions: [{ value: "Alun" }],
			tabs: [
				{ key: "barkskin", title: "Barkskin", icon: "fa-shield-halved", selected: true },
				{ key: "beast", title: "Shared Souls", icon: "fa-paw", selected: false },
			],
			groups: [group("barkskin", "Barkskin"), group("beast", "Shared Souls")],
		});
		expect(html).toMatch(/class="[^"]*stonetop-roster-panel[^"]*"[^>]*data-tab="barkskin"/);
		expect(html).toMatch(/data-tab="beast"\s*\n?\s*hidden/);
		// The kind a drop or a typed name lands on is read off the panel, so it must be on it.
		expect(html).toContain('data-mark-kind="barkskin"');
		// ONE datalist for all five bars, not one apiece: every panel offers the same world
		// actors, so a list per panel wrote the whole world out five times per render. Each bar
		// names the shared one, which is how utils/autocomplete.js resolves a field's options.
		expect(html).toContain('id="stonetop-marks-suggestions"');
		expect((html.match(/<datalist/g) ?? [])).toHaveLength(1);
		expect((html.match(/list="stonetop-marks-suggestions"/g) ?? [])).toHaveLength(2);
	});
});

describe("what the rail looks like", () => {
	// The panels declare `display: flex`, which beats the UA's `[hidden] { display: none }` — the
	// same trap `.wd-section[hidden]` and `.stonetop-custom-move-section[hidden]` are here for.
	// Without this every panel renders at once and the rail sits on top of the tall window it was
	// added to replace.
	it("makes the panels' hidden attribute stick", () => {
		expect(declarations(CSS, ".stonetop-roster-panel[hidden]")).toMatch(/display:\s*none/);
	});

	// The panel fills the column and its LIST is what scrolls, so each list's add bar stays pinned
	// under it however many people are on it. Lose either half and the field goes off the bottom.
	it("lets the panel fill the column and the list take the slack", () => {
		const panel = declarations(CSS, ".stonetop-roster-panel");
		expect(panel).toMatch(/flex:\s*1 1 auto/);
		expect(panel).toMatch(/min-height:\s*0/);
		const main = declarations(CSS, COLUMN);
		expect(main).toMatch(/min-height:\s*0/);
		expect(main).toMatch(/overflow:\s*hidden/);
	});

	// The column wears BOTH classes, and the shared `.stonetop-guide-main` rule sits later in the
	// sheet with the same one-class specificity, so a bare `.stonetop-roster-main` rule loses the
	// tie and every declaration in it is dead: the column silently took the guide dialogs'
	// `padding: 12px 20px 16px` and `gap: 12px`, which is how the panel came to sit 20px off the
	// right edge with its heading 6px below the rail entry naming the same list. Nothing about
	// that fails in a browser, and both rules read as if they had won.
	it("states the column's own padding where it beats the shared guide rule", () => {
		const shared = declarations(CSS, ".stonetop-guide-main");
		expect(shared).toMatch(/padding:/);
		expect(beats(specificity(COLUMN), specificity(".stonetop-guide-main"))).toBe(true);
		expect(declarations(CSS, COLUMN)).toMatch(/padding:\s*12px/);
	});

	// The rail is a band running from the window header to the floor, which is only true while the
	// title block renders INSIDE the panel column. Hoisted back above the split it spans the full
	// width again, the rail starts an inch down the window, and the playbook mark sits on top of
	// the first rail entry — which is what it did.
	it("keeps the title block inside the column so the rail reaches the header", () => {
		for (const hbs of [CONDEMNED_HBS, MARKS_HBS]) {
			const column = hbs.indexOf('class="stonetop-guide-main stonetop-roster-main"');
			const heading = hbs.search(/class="stonetop-(?:condemned|marks)-heading"/);
			expect(column).toBeGreaterThan(-1);
			expect(heading).toBeGreaterThan(column);
		}
	});

	// The title block drops to a one-line bar when there is a rail beside it, and the column's own
	// 12px is the only inset it gets there. Both rules are keyed by walking from the rail to the
	// column it precedes, so no template has to remember a modifier class.
	it("lays the railed title block as a bar, inset once", () => {
		const BAR = ".stonetop-guide-toc ~ .stonetop-roster-main > "
			+ ":is(.stonetop-condemned-heading, .stonetop-marks-heading)";
		expect(declarations(CSS, BAR)).toMatch(/flex-direction:\s*row/);
		expect(declarations(CSS, ".stonetop-roster-main > "
			+ ":is(.stonetop-condemned-heading, .stonetop-marks-heading)")).toMatch(/padding:\s*0/);
	});

	// GENERAL sibling, not adjacent, between the rail and the column. Adjacent held once and broke
	// once already, when blessed-marks.hbs grew its shared <datalist>: a display-none element is
	// still an element sibling, and the Blessed's railed window silently kept the 76px centred
	// stack inside a frame whose height is fixed at 520px.
	it("does not let an invisible sibling decide the railed title bar", () => {
		const railed = [...CSS.matchAll(/^[^\n{]*\.stonetop-roster-main[^{]*(?:condemned|marks)-heading[^{]*\{/gm)]
			.map(m => m[0]);
		expect(railed.length).toBeGreaterThan(0);
		for (const prelude of railed) expect(prelude).not.toMatch(/\.stonetop-guide-toc\s*\+/);
	});

	// The column holds the title block above the panel now, so it needs a gap where it wanted none.
	// Every other panel is display-none and a flex container puts no gap around an item it is not
	// laying out, so this reaches exactly one seam.
	it("parts the title block from the panel under it", () => {
		expect(declarations(CSS, COLUMN)).toMatch(/gap:\s*(?!0)/);
	});

	// A flex item defaults to `flex: 0 1 auto`, which sizes to its CONTENT. Without this pair the
	// column came out only as wide as its widest row, leaving a band of window backing beside the
	// rail whose width varied with how long the names on that list happened to be.
	it("makes the column claim the width the rail leaves", () => {
		const main = declarations(CSS, COLUMN);
		expect(main).toMatch(/flex:\s*1 1 auto/);
		expect(main).toMatch(/min-width:\s*0/);
	});

	it("gives the rail's count a style of its own", () => {
		expect(declarations(CSS, ".stonetop-guide-toc-count")).toBeTruthy();
	});
});
