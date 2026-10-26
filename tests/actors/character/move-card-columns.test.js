import { describe, it, expect } from "vitest";
import { readCss, readRepo, declarations, declared } from "../../fakes/css.js";

// The move and invocation cards in character creation and level-up flow in balanced columns
// (multi-column, not grid): two at each window's default width, three once dragged wide. The
// column width is one token in stonetop.css; the default widths live in the two dialogs' JS. These
// pin the layout and the arithmetic that ties the two together, so changing either alone fails.

const CSS = readCss();
const COLUMN_GAP = 6;
// Generous allowance for the window's own padding and the step's side padding (24px each side on
// the onboarding step, a few px on the level-up body), so "two fit" holds with room to spare.
const CHROME = 64;

const columnMinPx = () => {
	const value = declared(declarations(CSS, ":root") ?? "", "--st-move-column-min");
	expect(value).toMatch(/^max\(\d+px, \d+(\.\d+)?em\)$/);
	return Number(value.match(/(\d+)px/)[1]);
};
const span = n => n * columnMinPx() + (n - 1) * COLUMN_GAP;

describe("move cards flow in columns", () => {
	it("the level-up move and invocation grids, and creation's move and invocation steps, share the column rule", () => {
		for (const sel of [".stonetop-levelup-move-grid", ".stonetop-levelup-invocation-grid", ".stonetop-onboarding-cards--columns"]) {
			const body = declarations(CSS, sel);
			expect(declared(body, "columns")).toBe("var(--st-move-column-min) 3");
			expect(declared(body, "column-gap")).toBe(`${COLUMN_GAP}px`);
		}
		// The base .stonetop-onboarding-cards is a flex column; the columns need a block box.
		expect(declared(declarations(CSS, ".stonetop-onboarding-cards--columns"), "display")).toBe("block");
		expect(declared(declarations(CSS, ".stonetop-onboarding-cards--columns > .stonetop-onboarding-card"), "break-inside")).toBe("avoid");
	});

	it("cards are spaced like the flex gap they replace: nothing after the last one", () => {
		const gap = declared(declarations(CSS, ".stonetop-onboarding-cards"), "gap");
		expect(declared(declarations(CSS, ".stonetop-onboarding-cards--columns > .stonetop-onboarding-card"), "margin-bottom")).toBe(gap);
		expect(declared(declarations(CSS, ".stonetop-onboarding-cards--columns > .stonetop-onboarding-card:last-child"), "margin-bottom")).toBe("0");
	});

	it("creation's move, either/or and invocation lists use the columns", () => {
		const hbs = readRepo("templates/dialogs/character-onboarding.hbs");
		expect(hbs.match(/class="stonetop-onboarding-cards stonetop-onboarding-cards--columns"/g)).toHaveLength(3);
	});

	it("both windows open on two columns, not three", () => {
		const levelUpWidth = Number(readRepo("module/actors/character/dialogs/LevelUpDialog.js").match(/const LEVELUP_MOVE_WIDTH = (\d+);/)[1]);
		const onboardingWidth = Number(readRepo("module/actors/character/dialogs/CharacterOnboardingDialog.js").match(/id:\s*"stonetop-character-onboarding"[\s\S]*?width:\s*(\d+)/)[1]);
		for (const width of [levelUpWidth, onboardingWidth]) {
			expect(span(2)).toBeLessThanOrEqual(width - CHROME);
			expect(span(3)).toBeGreaterThan(width);
		}
	});
});

describe("ticking Improved Stat doesn't reshuffle the columns", () => {
	it("its stat picker is always laid out, faded and inert until the move is ticked", () => {
		const idle = declarations(CSS, ".stonetop-onboarding-card--stat-move .stonetop-onboarding-move-stat-picker");
		expect(declared(idle, "display")).toBe("block");
		expect(declared(idle, "pointer-events")).toBe("none");
		expect(Number(declared(idle, "opacity"))).toBeLessThan(1);
		const ticked = declarations(CSS, ".stonetop-onboarding-card--stat-move.is-selected .stonetop-onboarding-move-stat-picker");
		expect(declared(ticked, "display")).toBe(null);
		expect(declared(ticked, "pointer-events")).toBe("auto");
		expect(declared(ticked, "opacity")).toBe("1");
	});

	it("its radios stay disabled, and the picker inert, until the move is ticked; the tick handler switches both", () => {
		const hbs = readRepo("templates/dialogs/character-onboarding.hbs");
		expect(hbs).toContain("{{#if atCap}}disabled{{else}}{{#unless ../selected}}disabled{{/unless}}{{/if}}");
		expect(hbs).toContain('<div class="stonetop-onboarding-move-stat-picker" onclick="event.stopPropagation()"{{#unless this.selected}} inert{{/unless}}>');
		const js = readRepo("module/actors/character/dialogs/CharacterOnboardingDialog.js");
		expect(js).toMatch(/moveCard\?\.querySelectorAll\("\.onboard-move-stat"\)\.forEach\(radio => \{\s*radio\.disabled = !checked \|\|/);
		expect(js).toContain("if (statPicker) statPicker.inert = !checked;");
	});

	it("a capped stat isn't faded twice over while the whole picker is faded", () => {
		const capped = declarations(CSS, ".stonetop-onboarding-card--stat-move:not(.is-selected) .stonetop-onboarding-move-stat-option.is-disabled");
		expect(declared(capped, "opacity")).toBe("1");
	});
});

describe("a learned invocation's badge", () => {
	it("wraps under the name, not flush right", () => {
		const header = declarations(CSS, ".stonetop-onboarding-card--invocation.is-preselected .stonetop-onboarding-card-header");
		expect(header).toMatch(/flex-wrap:\s*wrap/);
		const badge = declarations(CSS, ".stonetop-onboarding-card--invocation.is-preselected .stonetop-onboarding-possession-badge");
		// The checkbox's side plus the header's gap, each read from the token the box and the
		// header are themselves sized by: where the name starts.
		expect(declared(badge, "margin-left")).toBe("calc(var(--st-check-size) + var(--st-onboarding-header-gap))");
		const baseHeader = declarations(CSS, ".stonetop-onboarding-card-header");
		expect(declared(baseHeader, "gap")).toBe("var(--st-onboarding-header-gap)");
		expect(declared(baseHeader, "--st-onboarding-header-gap")).toBe("6px");
		expect(declared(declarations(CSS, ":root") ?? "", "--st-check-size")).toBe("calc(15px * var(--stonetop-font-scale, 1))");
		expect(CSS).toMatch(/\.stonetop-onboarding-check,[^{]*\{[^}]*width: var\(--st-check-size\) !important;/);
	});
});
