import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { steadingHolds, HOLD_DEFS, HOLD_ICON_DIR } from "../../../module/actors/steading/steading-holds.js";

// The row of glyphs beside the steading's title. ONE RULE decides membership: a glyph shows
// only while something is UNRESOLVED, and goes away when it resolves. So an empty tray is the
// normal state, and a lit glyph always means somebody has something to do.

describe("steadingHolds", () => {
	it("shows nothing when the steading owes nothing and is owed nothing", () => {
		expect(steadingHolds()).toEqual([]);
		expect(steadingHolds({})).toEqual([]);
	});

	it("names the source of a held Fortunes advantage, so the row explains itself", () => {
		const [row] = steadingHolds({ fortunesAdvantage: { source: "Sacrifice (Rites of the Land)" } });
		expect(row.key).toBe("fortunesAdvantage");
		expect(row.tooltip).toContain("Sacrifice (Rites of the Land)");
		expect(row.tone).toBe("boon");
	});

	it("survives a hold with no source rather than printing an empty clause", () => {
		const [row] = steadingHolds({ fortunesAdvantage: { source: "  " } });
		expect(row.tooltip).toContain("next roll of +Fortunes");
		expect(row.tooltip).not.toContain("promised by");
	});

	// The +1 Defenses is the half that must be given back, so the row says when it is riding.
	it("says whether the muster took the Defenses bonus", () => {
		expect(steadingHolds({ muster: { defenses: true } })[0].tooltip).toContain("+1 Defenses");
		expect(steadingHolds({ muster: { defenses: false } })[0].tooltip).not.toContain("+1 Defenses");
	});

	it("splits what the steading has from what it owes", () => {
		const tones = Object.fromEntries(HOLD_DEFS.map(d => [d.key, d.tone]));
		expect(tones.fortunesAdvantage).toBe("boon");
		expect(tones.muster).toBe("boon");
		expect(tones.torsBlessing).toBe("boon");
		expect(tones.innGathering).toBe("due");
		expect(tones.standingWatch).toBe("due");
		expect(tones.weaponsUpkeep).toBe("due");
	});

	it("keeps the declared order regardless of which are lit", () => {
		const all = steadingHolds({
			fortunesAdvantage: { source: "x" }, muster: { defenses: false }, torsBlessing: true,
			innGathering: true, standingWatch: true, weaponsUpkeep: true,
		});
		expect(all.map(r => r.key)).toEqual(HOLD_DEFS.map(d => d.key));
	});

	it("points every row at art that exists", () => {
		for (const def of HOLD_DEFS) {
			expect(read(`assets/icons/holds/${def.icon}.svg`), def.key).toContain("<svg");
		}
	});

	// game-icons stores the drawings inverted: an opaque 512 square under a white glyph, which
	// as a MASK resolves to a solid slab. The square must be punched transparent or the whole
	// tray paints as filled boxes.
	it("carries no opaque backing square, which a mask would render as a slab", () => {
		for (const def of HOLD_DEFS) {
			const svg = read(`assets/icons/holds/${def.icon}.svg`);
			expect(svg, def.key).toContain('<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>');
			expect(svg.match(/<path d="M0 0h512v512H0z"\s*\/>/), def.key).toBeNull();
		}
	});

	// CC BY 3.0 requires it, and the weather set is held to the same standard.
	it("credits every glyph by filename", () => {
		const attribution = read("assets/icons/holds/ATTRIBUTION.md");
		expect(attribution).toContain("CC BY 3.0");
		for (const def of HOLD_DEFS) expect(attribution, def.key).toContain(`${def.icon}.svg`);
	});
});

describe("how the tray is wired", () => {
	const HBS = read("templates/actor/steading.hbs");
	const CSS = read("styles/stonetop.css");
	const STEADING = read("module/actors/steading/StonetopSteading.js");
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

	it("sits in the header, between the title and the clock", () => {
		const holds = HBS.indexOf("steading-header-holds");
		expect(holds).toBeGreaterThan(HBS.indexOf('class="steading-title"'));
		expect(holds).toBeLessThan(HBS.indexOf("steading-header-clock"));
	});

	// The whole block is absent when nothing is outstanding, rather than an empty flex box
	// holding open a gap the header would otherwise close.
	it("renders nothing at all when the tray is empty", () => {
		expect(HBS).toContain("{{#if stonetop.holds.length}}");
	});

	// This file's markup is asserted to be free of {{else}} so the classic/modern split can
	// never become two whole copies of the sheet; the tray follows the same discipline.
	it("branches with complementary if/unless rather than else", () => {
		const at = HBS.indexOf("steading-header-holds");
		const block = HBS.slice(at, HBS.indexOf("{{/if}}", HBS.indexOf("{{/each}}", at)));
		expect(block).toContain("{{#if interactive}}");
		expect(block).toContain("{{#unless interactive}}");
		expect(block).not.toContain("{{else}}");
	});

	// Tolerant of the column alignment the rule list is written with, strict about the pairing:
	// this modifier must set this custom property, pointing at this file.
	it("gives every hold a mask rule, so none paints blank", () => {
		for (const def of HOLD_DEFS) {
			expect(CSS, def.key).toMatch(
				new RegExp(`\\.steading-hold--${def.icon}\\s*\\{\\s*--st-hold-icon:\\s*url\\('[^']*${def.icon}\\.svg'\\)`));
			expect(CSS, def.key).toContain(`${HOLD_ICON_DIR}/${def.icon}.svg`);
		}
	});

	// Both tone rules tie with the base `.steading-hold` on specificity, so they only win by
	// sitting later in the file.
	it("declares the tone modifiers after the base rule", () => {
		const base = CSS.indexOf(".steading-header .steading-hold {");
		expect(base).toBeGreaterThan(-1);
		expect(CSS.indexOf(".steading-header .steading-hold--boon")).toBeGreaterThan(base);
		expect(CSS.indexOf(".steading-header .steading-hold--due")).toBeGreaterThan(base);
	});

	it("reads the tray off the steading, and only offers controls to a GM", () => {
		expect(STEADING).toContain("holdsView()");
		expect(SHEET).toContain("this._stonetopSteading.holdsView()");
		expect(SHEET).toContain("interactive: !!h.action && context.stonetop.isGM");
	});

	// Before a world's first Seasons Change nothing has turned, so no upkeep can be overdue.
	it("does not dun a steading whose clock has never been stamped", () => {
		const at = STEADING.indexOf("holdsView()");
		const body = STEADING.slice(at, at + 1400);
		expect(body).toContain("!!seasonId");
		expect(body).toContain('seasonId === "spring"');
	});
});
