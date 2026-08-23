import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Two blocks sit in different places depending on the user's layout setting
// (`classicLayout` + `classicLayoutSteading`, see module/settings.js):
//
//  * the stat band (Surplus/Fortunes/Size/Population/Prosperity/Defenses/Debilities). MODERN
//    heads the Overview tab with it, leaving the sheet's constant top as the title alone.
//    CLASSIC pins it above the tabs, costing its height on every page, which is where it
//    lived before the redesign.
//  * the settlements Relationships card. MODERN puts it last on the Residents tab, under the
//    three people tables. CLASSIC puts it back on Overview, between the inventory cards and
//    Places of Interest.
//
// Both are ONE partial mounted in two places, and the two mounts must be complementary: a
// double mount would render two copies of a card full of rating controls. These guard the
// wiring. Layout is verified in a browser, not here.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = rel => fs.readFileSync(path.resolve(HERE, "../../..", rel), "utf8");
// Every "must not contain" below is about MARKUP. These partials carry comments that name
// the very thing being forbidden ("the .stonetop-roll-mode-input handler was retired", "no
// ../ lookups"), so the prose has to come out first or the guard fails on its own rationale.
const stripComments = hbs => hbs.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

const STEADING_HBS = read("templates/actor/steading.hbs");
const STATS_BAR_HBS = read("templates/actor/partials/steading-stats-bar.hbs");
const OVERVIEW_HBS = read("templates/actor/partials/steading-tab-overview.hbs");
const NEIGHBORS_HBS = read("templates/actor/partials/steading-tab-neighbors.hbs");
const SETTLEMENTS_HBS = read("templates/actor/partials/steading-settlements-card.hbs");
const SIDEBAR_HBS = read("templates/actor/partials/steading-moves-sidebar.hbs");
const STONETOP_JS = read("stonetop.js");
const CSS = read("styles/stonetop.css");

// steading.hbs renders ONE body and ONE nav, with the handful of genuinely layout-specific
// pieces behind their own guard — rather than two whole copies of the sheet behind
// `{{#if}}/{{else}}`, which is five partial mounts and six nav entries to keep in step. So
// each placement question is asked of the guard wrapping that one piece.
const STEADING_MARKUP = stripComments(STEADING_HBS);

/** Everything rendered before the tab layout — i.e. the sheet's constant top. */
const alwaysVisible = STEADING_MARKUP.slice(0, STEADING_MARKUP.indexOf('<div class="stonetop-sheet-layout'));

describe("steading layout branches", () => {
	// The whole point of the single-body shape: the tab list and the panel list exist once.
	it("renders one body and one nav, not a copy per layout", () => {
		expect(STEADING_MARKUP.match(/<nav /g), "nav").toHaveLength(1);
		expect(STEADING_MARKUP.match(/<section class="sheet-body">/g), "sheet-body").toHaveLength(1);
		expect(STEADING_MARKUP).not.toContain("{{else}}");
		for (const tab of ["overview", "neighbors", "improvements", "notes"])
			expect(STEADING_MARKUP.match(new RegExp(`tab="${tab}"`, "g")), tab).toHaveLength(1);
	});

	// The moves sidebar and the moves TAB are the same content in two shapes; rendering both
	// would put Homefront Moves on screen twice. Complementary guards are what prevents it.
	it("gives the moves sidebar to classic and the moves tab to modern, never both", () => {
		expect(STEADING_MARKUP).toContain('{{#if stonetop.classicLayout}}{{> "stonetop.steading-moves-sidebar"}}{{/if}}');
		expect(STEADING_MARKUP).toContain('{{#unless stonetop.classicLayout}}{{> "stonetop.steading-tab-moves"}}{{/unless}}');
		expect(STEADING_MARKUP.match(/steading-moves-sidebar/g), "sidebar mounts").toHaveLength(1);
		expect(STEADING_MARKUP.match(/steading-tab-moves/g), "moves tab mounts").toHaveLength(1);
	});

	// Five tabs, not six: with the moves in a sidebar there is no page for them, and a `.tab`
	// with no nav entry is dead markup that still costs a render.
	it("drops the moves tab from the classic nav", () => {
		expect(STEADING_MARKUP).toMatch(
			/\{\{#unless stonetop\.classicLayout\}\}\{\{> "stonetop\.tab-nav-item" tab="moves"[^}]*\}\}\{\{\/unless\}\}/);
	});

	// The rail class is what tab-rail.js keys off to lift the nav onto the window frame, and
	// what every `:not(.stonetop-tab-rail)` in the strip skin excludes.
	it("wears the rail class in modern only", () => {
		expect(STEADING_MARKUP).toContain(
			'class="sheet-tabs tabs{{#unless stonetop.classicLayout}} stonetop-tab-rail{{/unless}}"');
		expect(STEADING_MARKUP.match(/stonetop-tab-rail/g), "rail mentions").toHaveLength(1);
	});
});

describe("steading stat band", () => {
	it("heads the Overview tab in modern and sits above the tabs in classic", () => {
		expect(OVERVIEW_HBS).toContain('{{#unless stonetop.classicLayout}}{{> "stonetop.steading-stats-bar"}}{{/unless}}');
		expect(STEADING_MARKUP).toContain('{{#if stonetop.classicLayout}}{{> "stonetop.steading-stats-bar"}}{{/if}}');
		// One mount here and one in Overview, on complementary guards — never two on screen.
		expect(STEADING_MARKUP.match(/steading-stats-bar/g), "band mounts").toHaveLength(1);
	});

	// The band is what a reader is looking at when they open Overview, so it goes above the
	// Resources/Fortifications/Assets cards rather than under them.
	it("heads the tab, above the inventory cards", () => {
		expect(OVERVIEW_HBS.indexOf('{{> "stonetop.steading-stats-bar"}}'))
			.toBeLessThan(OVERVIEW_HBS.indexOf("steading-overview-cards"));
	});

	it("still carries every stat, so none was dropped in the move", () => {
		for (const stat of ["fortunes", "surplus", "size", "population", "prosperity", "defenses"])
			expect(STATS_BAR_HBS, stat).toContain(`data-steading-stat="${stat}"`);
		expect(STATS_BAR_HBS).toContain('data-steading-stat="debilities"');
	});

	// steading-stats-bar.hbs reaches up with `../stonetop.edit.*`, so a mount inside an
	// {{#each}} or with a `this=` override renders the whole band permanently read-only —
	// no error, just disabled controls.
	it("mounts the band at top level in both layouts", () => {
		expect(STEADING_MARKUP).not.toMatch(/\{\{#each[\s\S]*steading-stats-bar/);
		expect(stripComments(OVERVIEW_HBS)).not.toMatch(/\{\{#each[\s\S]*steading-stats-bar/);
	});

	it("leaves the classic constant top as the title and the band alone", () => {
		expect(alwaysVisible).toContain('{{> "stonetop.steading-stats-bar"}}');
		// The band arrives as a partial, so the inlined markers must not appear here.
		expect(alwaysVisible).not.toContain("steading-statsbar-pair");
		expect(alwaysVisible).not.toContain("steading-debilities");
	});

	it("registers the partial", () => {
		expect(STONETOP_JS).toContain('"stonetop.steading-stats-bar":');
	});

	// Inside a tab that already insets and gaps its children, the padding double-insets and the
	// rule reads as a divider inside one page — so the base rule carries neither. The classic
	// mount needs both back, and gets them from a POSITIONAL rule (direct child of the sheet
	// wrapper) rather than a layout class, so the two mounts cannot reach each other.
	it("keeps the band-only padding and bottom rule off the base rule", () => {
		const bar = CSS.match(/\n\.steading-stats-bar \{([^}]*)\}/)?.[1];
		expect(bar, "the .steading-stats-bar rule is gone").toBeTruthy();
		expect(bar).not.toMatch(/padding:/);
		expect(bar).not.toMatch(/border-bottom:/);
	});

	it("restores them for the classic mount by position", () => {
		const classic = CSS.match(/\n\.steading-sheet-wrapper > \.steading-stats-bar \{([^}]*)\}/)?.[1];
		expect(classic, "the classic positional rule is missing").toBeTruthy();
		expect(classic).toMatch(/padding:/);
		expect(classic).toMatch(/border-bottom:/);
	});
});

describe("steading settlements relationships", () => {
	it("is one partial, mounted on Residents in modern and Overview in classic", () => {
		expect(NEIGHBORS_HBS).toContain('{{#unless stonetop.classicLayout}}{{> "stonetop.steading-settlements-card"}}{{/unless}}');
		expect(OVERVIEW_HBS).toContain('{{#if stonetop.classicLayout}}{{> "stonetop.steading-settlements-card"}}{{/if}}');
		expect(SETTLEMENTS_HBS).toContain("steading-residents-section--settlements");
		expect(STONETOP_JS).toContain('"stonetop.steading-settlements-card":');
	});

	// Complementary guards, or both mounts render and the page carries two copies of a card
	// full of rating controls.
	it("mounts exactly once in either layout", () => {
		expect(NEIGHBORS_HBS.match(/steading-settlements-card/g)).toHaveLength(1);
		expect(OVERVIEW_HBS.match(/steading-settlements-card/g)).toHaveLength(1);
	});

	// Under the three people tables: those are Stonetop's own, this is the same question asked
	// of the places beyond it.
	it("sits last on Residents, below the Players / Residents / Neighbors tables", () => {
		const settlements = NEIGHBORS_HBS.indexOf("steading-settlements-card");
		for (const before of ["steading-players-section", "steading-residents-section--residents",
			"steading-residents-section--neighbors"])
			expect(NEIGHBORS_HBS.indexOf(before), before).toBeLessThan(settlements);
	});

	// The card is one component rendered in several places; the move must not have cut it down
	// to the table half or dropped the edit gate.
	it("keeps the shared view, its toolbar and its edit gate", () => {
		expect(SETTLEMENTS_HBS).toContain('{{> "stonetop.relationships-view"');
		expect(SETTLEMENTS_HBS).toContain('{{> "stonetop.relationships-viewbar"');
		expect(SETTLEMENTS_HBS).toMatch(/section="settlements"/);
		expect(SETTLEMENTS_HBS).toContain("canToggle=stonetop.edit.settlements");
	});

	// No `../` lookups, so the card resolves at whatever depth it is mounted. Overview mounts
	// it one level deeper than Residents does.
	it("uses no parent-scope lookups, so either mount depth resolves", () => {
		expect(stripComments(SETTLEMENTS_HBS)).not.toContain("../");
	});
});

describe("classic moves sidebar", () => {
	it("is its own partial and is registered", () => {
		expect(STONETOP_JS).toContain('"stonetop.steading-moves-sidebar":');
		expect(SIDEBAR_HBS).toContain("steading-moves-sidebar");
	});

	// Neither shape of the roll modifier comes back with the classic layout. It was a stacked
	// radio list here and a segmented pill on the modern heading, and BOTH were sticky: whatever
	// you last rolled with, you kept rolling with. It is a per-roll question now
	// (module/dialogs/RollDialog.js), so a sheet that brought either control back would be
	// writing a flag nothing reads.
	it("brings back neither the stacked radios nor the modern pill", () => {
		const markup = stripComments(SIDEBAR_HBS);
		expect(markup).not.toContain("roll-mode-radios");
		expect(markup).not.toContain("roll-mode-picker");
		expect(markup).not.toContain("Roll Modifier");
	});

	// `.steading-moves-tab` carries `display: flex`, and an unlayered `display` on a `.tab`
	// beats core's layered `.tab { display: none }` — which would leak this panel onto every
	// other page at once.
	it("keeps its flex wrapper off any .tab element", () => {
		expect(SIDEBAR_HBS).toContain('<section class="steading-moves-tab">');
		// `class="tab ` / `class="tab"` rather than a `\btab\b` word match: `-` is a word
		// boundary, so that would also flag the `tab` in `steading-moves-tab` itself. What
		// matters is that nothing here is a Foundry tab PANEL.
		expect(stripComments(SIDEBAR_HBS)).not.toMatch(/class="tab[\s"]/);
		expect(stripComments(SIDEBAR_HBS)).not.toContain("data-group=");
		expect(stripComments(SIDEBAR_HBS)).not.toContain("data-tab=");
	});

	it("carries the collapse handle the sheet's handler binds", () => {
		expect(SIDEBAR_HBS).toContain("stonetop-sidebar-toggle");
		expect(SIDEBAR_HBS).toContain("stonetop-moves-sidebar");
	});
});
