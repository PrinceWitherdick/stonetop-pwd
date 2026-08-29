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
		expect(tones.herdAdvance).toBe("boon");
		expect(tones.innGathering).toBe("due");
		expect(tones.standingWatch).toBe("due");
		expect(tones.weaponsUpkeep).toBe("due");
		expect(tones.militiaTraining).toBe("due");
		expect(tones.herdFeed).toBe("due");
		expect(tones.winterDebt).toBe("due");
	});

	// Every row lit at once, which no real season can produce (three are season-locked and two
	// of those locks exclude each other) but which is what pins the DECLARED order.
	it("keeps the declared order regardless of which are lit", () => {
		const all = steadingHolds({
			fortunesAdvantage: { source: "x" }, muster: { defenses: false }, torsBlessing: true,
			herdAdvance: true, innGathering: true, standingWatch: true, weaponsUpkeep: true,
			militiaTraining: true,
			herdFeed: { needed: 2, surplus: 4 }, winterDebt: { amount: 3, surplus: 4 },
		});
		expect(all.map(r => r.key)).toEqual(HOLD_DEFS.map(d => d.key));
	});

	// The herd's feed is the one seasonal upkeep the book prices, so the row carries the price
	// AND the shortfall — a GM reading the hover should not have to go and look up the Surplus.
	it("names what the herd's feed costs, and says so louder when it cannot be paid", () => {
		const flush = steadingHolds({ herdFeed: { needed: 2, surplus: 5 } })[0];
		expect(flush.tooltip).toContain("2 Surplus");
		expect(flush.tooltip).not.toContain("the steading has");

		const short = steadingHolds({ herdFeed: { needed: 3, surplus: 1 } })[0];
		expect(short.tooltip).toContain("the steading has 1");
		expect(short.tooltip).toContain("1d6 horses");
	});

	it("says what winter still wants, and what the steading has to meet it with", () => {
		const [row] = steadingHolds({ winterDebt: { amount: 4, surplus: 2 } });
		expect(row.tooltip).toContain("4 more Surplus");
		expect(row.tooltip).toContain("It has 2");
	});

	// The dues are all settled inside the Seasons Change window EXCEPT this one, which comes due
	// after that window is shut — so it is the only due that has to lead somewhere.
	it("gives the winter debt the only control among the dues", () => {
		const withAction = HOLD_DEFS.filter(d => d.action).map(d => d.key);
		expect(withAction).toEqual(["muster", "innGathering", "winterDebt"]);
	});

	// The label does three jobs at once — accessible name, screen-reader text for a glyph with
	// no text of its own, and the heading line of the hover — so it has to read as a NAME.
	it("names every row, distinctly, as a short Title Case noun phrase", () => {
		const labels = HOLD_DEFS.map(d => d.label);
		expect(new Set(labels).size).toBe(labels.length);
		for (const label of labels) {
			expect(label, label).toMatch(/^[A-Z]/);
			expect(label.length, label).toBeLessThanOrEqual(24);
			// A name, not a sentence about the state: those are the tooltip's job below it.
			expect(label, label).not.toMatch(/\.$/);
			// Every word of three letters or more is capitalised, bar the joiners.
			for (const word of label.split(" ")) {
				if (word.length < 3 || ["the", "at", "of", "and"].includes(word)) continue;
				expect(word, `${label}: ${word}`).toMatch(/^[A-Z]/);
			}
		}
	});

	// The heading already says which row this is, so a tooltip that opened by naming itself
	// again would read as a stutter under it.
	it("does not make the description repeat the name", () => {
		for (const def of HOLD_DEFS) {
			const tip = def.tooltip({ needed: 2, surplus: 1, amount: 3, defenses: true, source: "x" });
			expect(tip.startsWith(def.label), def.key).toBe(false);
		}
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

	// ── The hover names the glyph before it explains it ──────────────────────────
	// A masked drawing is a picture the reader has to learn. A hover that opened straight into
	// "The herd eats 2 Surplus this winter" made them work out which of the nine they were on
	// from the sentence itself.

	it("puts the row's name above its description, in both branches", () => {
		const at = HBS.indexOf("steading-header-holds");
		const block = HBS.slice(at, HBS.indexOf("{{/if}}", HBS.indexOf("{{/each}}", at)));
		const tips = block.match(/data-tooltip-html="[^"]*"/g) ?? [];
		// One for the button, one for the read-only span, and they must be the SAME string:
		// a hover that differed by who was looking at it is two things to keep in step.
		expect(tips).toHaveLength(2);
		expect(tips[0]).toBe(tips[1]);
		expect(tips[0]).toContain("stonetop-hold-tip-name");
		expect(tips[0]).toContain("stonetop-hold-tip-text");
		expect(tips[0].indexOf("{{label}}")).toBeLessThan(tips[0].indexOf("{{tooltip}}"));
	});

	// `data-tooltip` is offered to game.i18n.has() first, as though it might be a key. These are
	// sentences, so that lookup always misses — but asking a question with a wrong answer
	// available is not the same as not asking it. The HTML form goes straight to cleanHTML.
	it("uses the html tooltip attribute rather than the plain one", () => {
		const at = HBS.indexOf("steading-header-holds");
		const block = HBS.slice(at, HBS.indexOf("{{/if}}", HBS.indexOf("{{/each}}", at)));
		expect(block).not.toMatch(/data-tooltip="/);
		expect((block.match(/data-tooltip-class="stonetop-hold-tip"/g) ?? [])).toHaveLength(2);
	});

	// Core wipes #tooltip's class list on every activation and re-adds only `active themed
	// theme-dark` plus whatever data-tooltip-class named, so that class is the ONLY way a rule
	// can reach inside. Reached off #tooltip, since the tooltip lives outside every sheet and
	// no sheet-scoped selector in this file can see it.
	it("styles both halves through the class the glyph declares", () => {
		expect(CSS).toContain("#tooltip.stonetop-hold-tip .stonetop-hold-tip-name");
		expect(CSS).toContain("#tooltip.stonetop-hold-tip .stonetop-hold-tip-text");
	});

	// The heading earns its rank on weight and a rule, NOT by dimming the line below it. The
	// body carries the actual information, numbers included, and a reader on a magnifier is the
	// one who most needs a hover to say what a picture means.
	it("does not dim the description to make the name stand out", () => {
		const at = CSS.indexOf("#tooltip.stonetop-hold-tip .stonetop-hold-tip-text");
		const rule = CSS.slice(at, CSS.indexOf("}", at));
		expect(rule).toContain("--color-light-1");
		expect(rule).not.toMatch(/opacity|--st-text-secondary|--color-light-[2-9]/);
	});

	// The tooltip is stamped `theme-dark` by core whatever the sheet or the world is set to, so
	// the page's own ink tokens are exactly wrong here: --st-text-body is near-black.
	it("paints the hover in core's light tooltip ink, never the page's", () => {
		const at = CSS.indexOf("#tooltip.stonetop-hold-tip {");
		const block = CSS.slice(at, CSS.indexOf("/* Two tones", at));
		expect(block).not.toContain("--st-text-body");
		expect(block).not.toContain("--stonetop-bg");
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
		const body = STEADING.slice(at, at + 2000);
		expect(body).toContain("!!seasonId");
		expect(body).toContain('seasonId === "spring"');
	});
});
