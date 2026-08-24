import { describe, it, expect, vi } from "vitest";
import { readRepo as read, readCss, declarations } from "../fakes/css.js";

// Where the two roll buttons of the expedition walkthrough sit, relative to the tables they
// are read against.
//
// Both had drifted apart from that table. On "Player moves on the road" the Die of Fate button
// printed after the WHOLE body, so a GM who had just read the camp table and the line telling
// them to roll had a paragraph on deprivation between them and the button. On "Requisition (if
// needed)" the +Fortunes button printed BEFORE the outcome list, asking for a roll above the
// three results it lands on, and that list wore three stacked cards where the fate tables three
// steps later wear one bordered box.
//
// So: each button sits directly under its table, and the two tables look like one another.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

const steps = Object.create(ExpeditionDialog.prototype)._steps;
const step  = key => steps.find(s => s.key === key);

const HBS = read("templates/dialogs/expedition.hbs");
const CSS = readCss();

describe("the Die of Fate button on Player moves on the road", () => {
	const playermoves = step("playermoves");

	it("has the camp table as the last thing in the body it rolls against", () => {
		expect(playermoves.fate).toBe("camp");
		expect(playermoves.body).toContain("stonetop-exp-fatetable");
		// Nothing after the table: the button renders where the body ends.
		expect(playermoves.body.trimEnd().endsWith("</ul>")).toBe(true);
	});

	it("keeps every word of the deprivation note, below the button", () => {
		expect(playermoves.body).not.toContain("Deprivation");
		expect(playermoves.bodyAfterFate).toContain("<strong>Deprivation</strong> (p.335)");
		expect(playermoves.bodyAfterFate).toContain("deprivation up as a threat");
		expect(playermoves.bodyAfterFate).toContain("<em>Defy Danger</em>");
	});

	it("is the only step with prose past the button", () => {
		expect(steps.filter(s => s.bodyAfterFate).map(s => s.key)).toEqual(["playermoves"]);
	});

	it("prints that tail after the button in the template, in the body's own styling", () => {
		const button = HBS.indexOf("stonetop-exp-fate-btn");
		const tail   = HBS.indexOf("step.bodyAfterFate");
		expect(button).toBeGreaterThan(-1);
		expect(tail).toBeGreaterThan(button);
		expect(HBS).toContain('<div class="stonetop-spring-body">{{{step.bodyAfterFate}}}</div>');
	});
});

describe("the Requisition outcome table", () => {
	it("is still the step's three results", () => {
		expect(step("requisition").showTiers).toBe(true);
		expect(step("requisition").roll).toBe("requisition");
	});

	it("renders above the button that rolls on it", () => {
		const tiers = HBS.indexOf("{{#if showTiers}}");
		const roll  = HBS.indexOf("{{#if showRoll}}");
		expect(tiers).toBeGreaterThan(-1);
		expect(roll).toBeGreaterThan(tiers);
	});

	it("sits under the step's prose, ahead of the step's own panels", () => {
		// As a fate table does on the journey steps: prose, table, button, and only then
		// whatever else the step carries. The assets a GM ticks are what the roll is FOR,
		// so they follow it; before this they stood between the sentence asking for the
		// roll and the roll itself, a screen apart on a village with a full store.
		const body   = HBS.indexOf("{{{step.body}}}");
		const tiers  = HBS.indexOf("{{#if showTiers}}");
		const roll   = HBS.indexOf("{{#if showRoll}}");
		for (const panel of ["{{#if journey}}", "{{#if loadReadout}}", "{{#if assetPicker}}"]) {
			const at = HBS.indexOf(panel);
			expect(at, panel).toBeGreaterThan(-1);
			expect(at, panel).toBeGreaterThan(roll);
		}
		expect(tiers).toBeGreaterThan(body);
	});

	it("wears the boxed look of the Die of Fate tables", () => {
		expect(HBS).toContain('class="stonetop-spring-tiers stonetop-spring-tiers--table"');

		// declarations(), not a regex: either box may be declared as one entry in a shared
		// selector list, which a `selector {` match would miss entirely.
		const box  = declarations(CSS, ".stonetop-spring-tiers--table");
		const fate = declarations(CSS, ".stonetop-spring-body ul.stonetop-exp-fatetable");
		expect(box).toBeTruthy();
		expect(fate).toBeTruthy();

		// The frame is the same one, declaration for declaration, not merely similar.
		for (const prop of ["border", "border-radius", "background", "font-size", "padding", "gap"]) {
			const line = new RegExp(`\\n\\t${prop}: ([^;]+);`);
			expect(box.match(line)?.[1], prop).toBe(fate.match(line)?.[1]);
		}
	});

	it("reads as one sentence per line, as a fate row does", () => {
		// fateTableList writes "<strong>1-2</strong>: text"; this table says "10+: text".
		expect(HBS).toMatch(/tier-label">\{\{\{label\}\}\}<\/span>: <span/);

		// Text flow, so nothing sits between the colon and the outcome: a card look would put
		// the two in flex columns, with a label stop and a gap on top of it.
		const row = declarations(CSS, ".stonetop-spring-tiers--table .stonetop-spring-tier");
		expect(row).not.toContain("display: flex;");
		const label = declarations(CSS, ".stonetop-spring-tiers--table .stonetop-spring-tier-label");
		expect(label ?? "").not.toMatch(/min-width: [^0]/);
	});

	it("declares that modifier after the card rules it overrides", () => {
		// Equal specificity, so the later rule wins: a modifier hoisted above its base
		// would be overridden by the very card look it exists to replace.
		expect(CSS.indexOf(".stonetop-spring-tiers--table {"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-spring-tier {"));
		expect(CSS.indexOf(".stonetop-spring-tiers--table .stonetop-spring-tier {"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-spring-tier {"));
	});

	it("reads every line of the table, and still marks the one that came up", () => {
		// Every line at full strength: a dimmed row is the card list saying "not this one",
		// which is wrong for a table the GM reads all of before rolling.
		const row = declarations(CSS, ".stonetop-spring-tiers--table .stonetop-spring-tier");
		expect(row ?? "").not.toMatch(/opacity: 0/);
		// The green is the tier base's, shared with the Spring dialog's cards -- one answer to
		// "which one came up" for both looks. The table adds only the bleed that makes it a band
		// spanning the row rather than a box floating inside it.
		expect(declarations(CSS, ".stonetop-spring-tier.is-active")).toContain("var(--st-green-bg)");
		expect(declarations(CSS, ".stonetop-spring-tiers--table .stonetop-spring-tier.is-active"))
			.toContain("margin-inline: -6px;");
	});
});
