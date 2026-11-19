import { describe, it, expect } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import {
	autumnHarvest, winterConsumption, seasonalYields, militiaTactics, builtOnTheFields,
	MILITIA_SEASON_STEP,
} from "../../../module/actors/steading/season-effects.js";
import { IMPROVEMENT_DEFINITIONS, IMPROVEMENT_GRANTS, builtInImprovementRules } from "../../../module/actors/steading/StonetopSteading.js";
import { yieldStepKey } from "../../../module/actors/steading/improvement-rules.js";

// ── What the improvements do when the season turns ──────────────────────────────
// Ten of the book's improvements end in a seasonal "Henceforth…", and the Seasons Change window
// knew about three of them. The other seven were prose on a card: a steading with a Mill, a
// Market and a Township rolled the same 1d4 for its harvest as a village with none of them.
//
// These are the book's own arithmetic, so each case below is a printed line and its result.

// The rules list (improvement-rules.js) for these book improvements, built: what the window hands in.
const having = (...slugs) => builtInImprovementRules(slugs);
const lapsed = (...slugs) => builtInImprovementRules(slugs, { requirementsMet: () => false });

describe("autumnHarvest", () => {
	it("is a plain 1d4 for a steading with none of them", () => {
		expect(autumnHarvest({ rules: having() }).formula).toBe("1d4");
	});

	// "when the autumn harvest is complete, gain +1d4 Surplus"
	it("adds Greater Harvest's second die", () => {
		expect(autumnHarvest({ rules: having("greaterHarvest") }).formula).toBe("1d4 + 1d4");
	});

	// "when the autumn harvest is complete, the steading generates +1 Surplus"
	it("adds the Mill's flat Surplus", () => {
		expect(autumnHarvest({ rules: having("mill") }).formula).toBe("1d4 + 1");
	});

	it("stacks them, because both fire off the same completed harvest", () => {
		expect(autumnHarvest({ rules: having("greaterHarvest", "mill") }).formula).toBe("1d4 + 1d4 + 1");
	});

	// "Building on parts of the fields, resulting in −1 Surplus generated with each autumn's
	// harvest" — a cost of one of the two ways Additional Housing can be BUILT, so it rides on
	// the requirement box that records the choice and not on the improvement being finished.
	it("takes the fields' penalty only when that requirement was the one taken", () => {
		expect(autumnHarvest({ rules: having("additionalHousing"), builtOnTheFields: true }).formula).toBe("1d4 - 1");
		expect(autumnHarvest({ rules: having("additionalHousing"), builtOnTheFields: false }).formula).toBe("1d4");
	});

	// The box is meaningless without the improvement: a half-ticked requirement is a plan.
	it("ignores the fields when the housing was never built", () => {
		expect(autumnHarvest({ rules: having(), builtOnTheFields: true }).formula).toBe("1d4");
	});

	// A Mill and the fields cancel, and the formula must not come out as "1d4 + 0" or "1d4 - 0".
	it("writes no tail at all when the flat modifiers cancel", () => {
		expect(autumnHarvest({ rules: having("mill", "additionalHousing"), builtOnTheFields: true }).formula).toBe("1d4");
	});

	// The window prints these under the button. A single-part harvest has nothing to explain.
	it("names each contribution, so the dice are never just asserted", () => {
		const { parts } = autumnHarvest({ rules: having("greaterHarvest", "mill") });
		expect(parts.map(p => p.label)).toEqual(["Harvest", "Greater Harvest", "Mill"]);
		expect(autumnHarvest({ rules: having() }).parts).toHaveLength(1);
	});
});

describe("winterConsumption", () => {
	it("is 1d4+Population for a steading with none of them", () => {
		expect(winterConsumption({ population: 2, rules: having() }).formula).toBe("1d4 + 2");
		expect(winterConsumption({ population: -1, rules: having() }).formula).toBe("1d4 - 1");
		expect(winterConsumption({ population: 0, rules: having() }).formula).toBe("1d4");
	});

	// "roll 2d6+Population to consume Surplus instead of 1d4+Population"
	it("swaps the dice for a Township", () => {
		expect(winterConsumption({ population: 1, rules: having("township") }).formula).toBe("2d6 + 1");
	});

	// "when you consume Surplus in winter, consider Population to be 1 lower than it is"
	it("counts Population a point lower with Additional Housing", () => {
		expect(winterConsumption({ population: 3, rules: having("additionalHousing") }).formula).toBe("1d4 + 2");
	});

	// "when winter grips the land, the steading consumes 1 less Surplus than normal"
	it("takes one off the total behind a Stone Wall", () => {
		expect(winterConsumption({ population: 2, rules: having("stoneWall") }).formula).toBe("1d4 + 1");
	});

	it("applies all three at once", () => {
		const all = having("township", "additionalHousing", "stoneWall");
		// 2d6, Population 3 counted as 2, then one off for the wall.
		expect(winterConsumption({ population: 3, rules: all }).formula).toBe("2d6 + 1");
	});

	// Winter's second bite — the 7-9's "consume 1d4+Population more Surplus before winter ends".
	// The dice and the Population adjustment carry, because both say how a winter consumption is
	// ROLLED. The wall's flat −1 does not, or one wall pays twice for one winter.
	it("carries the dice and the Population rule to winter's second bite, but not the wall", () => {
		const all = having("township", "additionalHousing", "stoneWall");
		expect(winterConsumption({ population: 3, rules: all, second: true }).formula).toBe("2d6 + 2");
		expect(winterConsumption({ population: 2, rules: having("stoneWall"), second: true }).formula).toBe("1d4 + 2");
	});

	it("names each rewrite, and says nothing for a plain winter", () => {
		expect(winterConsumption({ population: 1, rules: having("township") }).parts.map(p => p.label))
			.toEqual(["Winter", "Township"]);
		expect(winterConsumption({ population: 1, rules: having() }).parts).toHaveLength(1);
		expect(winterConsumption({ population: 1, rules: having(), size: "village" }).parts).toHaveLength(1);
	});

	// "If Stonetop has shrunk to a hamlet, it consumes only 1d2 + Population. If it has grown to
	// a town, it consumes 2d6 + Population." (Book I p. 518; the Size table on p. 509)
	it("rolls the dice for the steading's Size", () => {
		expect(winterConsumption({ population: 1, rules: having(), size: "hamlet" }).formula).toBe("1d2 + 1");
		expect(winterConsumption({ population: 1, rules: having(), size: "village" }).formula).toBe("1d4 + 1");
		expect(winterConsumption({ population: 1, rules: having(), size: "town" }).formula).toBe("2d6 + 1");
		// The book leaves a city's Surplus to the table; it rolls a town's rather than nothing.
		expect(winterConsumption({ population: 1, rules: having(), size: "city" }).formula).toBe("2d6 + 1");
		expect(winterConsumption({ population: 1, rules: having(), size: "hamlet" }).parts.map(p => p.label))
			.toEqual(["Winter", "A hamlet"]);
	});

	// The Township makes the steading a town; a Size radio never moved still rolls a town's dice.
	it("lets the Township win over a Size that disagrees", () => {
		expect(winterConsumption({ population: 0, rules: having("township"), size: "village" }).formula).toBe("2d6");
	});

	it("carries the Size to winter's second bite", () => {
		expect(winterConsumption({ population: 0, rules: having(), size: "hamlet", second: true }).formula).toBe("1d2");
	});
});

describe("seasonalYields", () => {
	const all = having("market", "township", "harnessingStream", "raincatching");

	it("offers only what this season's rules name", () => {
		const keyed = season => seasonalYields({ seasonId: season, population: 1, rules: all }).map(y => y.key);
		// In the improvements' own order (the Improvements tab's), the step keys they always had.
		expect(keyed("spring")).toEqual(["streamYield", "marketYield", "townshipYield"]);
		expect(keyed("summer")).toEqual(["marketYield", "raincatchingYield", "townshipYield"]);
		expect(keyed("autumn")).toEqual(["marketYield"]);
		expect(keyed("winter")).toEqual([]);
	});

	it("offers nothing an unbuilt improvement would bring", () => {
		expect(seasonalYields({ seasonId: "spring", population: 2, rules: having() })).toEqual([]);
	});

	// "the town generates Surplus equal to Population+1"
	it("scales the Township with Population, and floors it at nothing", () => {
		const amount = population => seasonalYields({ seasonId: "spring", population, rules: having("township") })[0].amount;
		expect(amount(2)).toBe(3);
		expect(amount(0)).toBe(1);
		// A negative yield would be Surplus the season quietly took away, which no line describes.
		expect(amount(-1)).toBe(0);
	});

	// "and Population is +1 or better" — a condition this window CAN check, so it does.
	it("blocks the Market below Population +1, and says why rather than vanishing", () => {
		const [row] = seasonalYields({ seasonId: "spring", population: 0, rules: having("market") });
		expect(row.blocked).toBe(true);
		expect(row.amount).toBe(0);
		expect(row.unmet).toContain("+1");
	});

	// Book I p. 158 (PDF 80): "...and the market is active, and Population is +1 or better". A
	// Market that has ceased to meet its requirements is not active.
	it("blocks a lapsed Market whatever its Population, and says it is not active", () => {
		const [row] = seasonalYields({ seasonId: "summer", population: 2, rules: lapsed("market") });
		expect(row).toMatchObject({ key: "marketYield", blocked: true, amount: 0 });
		expect(row.unmet).toMatch(/not active/);
		// Only the Market asks: the Township's yield has no such clause.
		const town = seasonalYields({ seasonId: "summer", population: 2, rules: lapsed("township") });
		expect(town[0].blocked).toBe(false);
	});

	// The two that wait on a roll this window cannot read. Their buttons say the condition rather
	// than pretending to know the tier, exactly as winter's debt button does.
	it("marks the two that wait on a 7+ with Fortunes", () => {
		const rows = seasonalYields({ seasonId: "spring", population: 2, rules: all });
		expect(rows.find(r => r.key === "streamYield").needsHit).toBe(true);
		expect(rows.find(r => r.key === "marketYield").needsHit).toBe(false);
	});

	// The card goes in front of the table, so each row says what it pays and when.
	it("says on every row what it generates", () => {
		for (const y of seasonalYields({ seasonId: "spring", population: 2, rules: all })) expect(y.rule, y.key).toMatch(/Surplus/);
	});

	// Each yield is its own step, so a GM who took the Market's, closed the window and came back
	// for the Township's finds one spent and one waiting rather than the whole block gone.
	it("gives every yield a step key of its own", () => {
		const keys = Object.keys(IMPROVEMENT_GRANTS).filter(slug => IMPROVEMENT_GRANTS[slug].seasonalYield).map(yieldStepKey);
		expect(keys).toEqual(["streamYield", "marketYield", "raincatchingYield", "townshipYield"]);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).not.toContain(MILITIA_SEASON_STEP);
	});
});

describe("builtOnTheFields", () => {
	const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "additionalHousing");

	// The box it reads is found by its text, so the text is pinned here against the real
	// definition: a reword that loses this match silently stops docking the harvest.
	it("finds the fields option among the improvement's own requirements", () => {
		const items = def.sections.flatMap(sec => sec.items ?? []);
		const at = items.findIndex(t => /parts of the fields/i.test(t));
		expect(at).toBeGreaterThanOrEqual(0);

		const r = [];
		r[at] = true;
		expect(builtOnTheFields(def, r)).toBe(true);
	});

	// The other way to build it (hiring the engineer) costs the harvest nothing, and neither
	// does a steading that has ticked nothing yet.
	it("is false for the other way of building it, and for a missing definition", () => {
		expect(builtOnTheFields(def, [])).toBe(false);
		expect(builtOnTheFields(def, def.sections.flatMap(sec => sec.items ?? []).map(() => false))).toBe(false);
		expect(builtOnTheFields(undefined, [true, true])).toBe(false);
	});
});

describe("militiaTactics", () => {
	const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "wellTrainedMilitia");

	// The offsets this reads depend on the definition's shape, so the shape is pinned here.
	it("finds the five drilled tactics as the improvement's last requirement section", () => {
		const last = def.sections[def.sections.length - 1];
		expect(last.items).toHaveLength(5);
		expect(last.items[0]).toMatch(/^Archery/);
		// One item ahead of them (the veteran warrior), so the tactics start at flat index 1.
		expect(militiaTactics(def, [true, true, true, true, true, true])[0].index).toBe(1);
	});

	it("returns only the tactics actually trained", () => {
		const r = [true, true, false, false, true, false];
		expect(militiaTactics(def, r).map(t => t.index)).toEqual([1, 4]);
	});

	it("returns nothing for a militia that has drilled none, or a missing definition", () => {
		expect(militiaTactics(def, [true])).toEqual([]);
		expect(militiaTactics(undefined, [true, true])).toEqual([]);
	});
});

// ── How the window uses it ──────────────────────────────────────────────────────
describe("how the seasonal effects are wired", () => {
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

	it("rolls the harvest and the consumption from the builders, not from a literal", () => {
		expect(SHEET).toContain("autumnHarvest({ rules, builtOnTheFields: this._builtOnTheFields() })");
		expect(SHEET).toContain("_harvestRoll(rules = this._improvementRules())");
		expect(SHEET).toContain("const harvest = this._harvestRoll(rules);");
		expect(SHEET).toContain("winterConsumption({ population, rules, size })");
		// Both are written onto their button, so the label and the roll cannot disagree.
		expect(SHEET).toContain(`data-action="roll-surplus" data-formula=`);
		expect(SHEET).toContain(`data-action="roll-consumption" data-formula=`);
	});

	it("takes each yield on its own button and its own season marker", () => {
		const at = SHEET.indexOf(`data-action='take-yield'`);
		expect(at).toBeGreaterThan(-1);
		const body = SHEET.slice(at, at + 1200);
		expect(body).toContain("_disableIfSeasonStepDone(btn, key, year, seasonId)");
		// The gain and its marker go out as ONE write, the way spendSurplus does it.
		expect(body).toContain("seasonStepFlags(key, year, seasonId)");
		expect(body).toContain("applyChanges({");
		// Live, like every other spend and grant in this window.
		expect(body).toContain(`getStatValue("surplus")`);
	});

	// The watch's shape: two ways to answer, one step key, so a reopen can neither drill twice
	// nor forget a second tactic after paying.
	it("settles the militia's summer either way, on one marker", () => {
		// The militia's wiring, whole: from its own comment to the next block's.
		const at = SHEET.indexOf("// The militia's summer.");
		expect(at).toBeGreaterThan(-1);
		const end = SHEET.indexOf("// A Surplus roll button:", at);
		expect(end).toBeGreaterThan(at);
		const body = SHEET.slice(at, end);
		expect(body).toContain(`data-action='drill-militia'`);
		// The spend goes through the shared _wireSurplusUpkeep, as the watch's and the
		// weapons' do; the tactic half writes its own marker on the same step key.
		expect(body).toContain("_wireSurplusUpkeep(drillMilitiaBtn");
		expect(body).toContain("MILITIA_SEASON_STEP");
		expect(body).toContain(`_onImprovementReq("wellTrainedMilitia"`);
		// Whether the drill is offered follows the live Surplus, not the figure at open.
		expect(body).toContain("liveRefreshers.push(");
		expect(body).toContain(`getStatValue("surplus") >= 1`);
	});

	// Book I p. 158: "Henceforth, when the seasons change, whoever is friendliest rolls +Fortunes".
	// With the move, so off the Fortunes the season opened with, and once a season (a re-post
	// stays possible, for a lost card).
	it("hands the Inn's questions to the table on the Inn's own ladder, once a season", () => {
		const at = SHEET.indexOf(`data-action='ask-friendliest'`);
		expect(at).toBeGreaterThan(-1);
		const body = SHEET.slice(at, at + 1400);
		expect(body).toContain(`table: "inn"`);
		expect(body).toContain("steading.openingFortunes(year, seasonId) ?? steading.getStatValue(\"fortunes\")");
		expect(body).toContain("setSeasonStepApplied(INN_ROLL_SEASON_STEP, year, seasonId)");
		expect(body).toContain("Post the Inn's card again");
	});
});

// ── Nothing seasonal left on the cards ──────────────────────────────────────────
// The gap this whole module closes was invisible: an improvement's seasonal clause lived in its
// `effect` prose, the window never read it, and nothing anywhere connected the two. So the
// definitions are the authority — every improvement whose printed effect names a seasonal
// trigger has to be reachable from the Seasons Change window, or be listed below with a reason.
describe("every improvement with a seasonal rule reaches the window", () => {
	// "when the Seasons Change", "each spring", "when winter grips the land", "when the autumn
	// harvest is complete", "at the start of each season", "when summer comes"…
	// The last alternative is the one that nearly got away: Additional Housing says "when you
	// consume Surplus IN WINTER" and Aurochs Hunting "when you lead the aurochs hunt IN SPRING",
	// neither of which any of the other phrasings catch.
	const SEASONAL = /seasons change|(each|every|this) (season|spring|summer|autumn|winter)|(spring|summer|autumn|winter) (comes|breaks forth|grips)|start of each season|autumn harvest|in (spring|summer|autumn|winter)/i;
	const plain = html => String(html ?? "").replace(/<[^>]*>/g, " ");
	const SHEET = read("module/actors/steading/StonetopSteadingSheet.js");

	// EXCUSED, each with the reason, because an empty escape hatch is one somebody fills in
	// silently. Nothing is excused today — Aurochs Hunting came closest and is surfaced as a
	// spring line instead of a step, for the reason written beside it in the sheet.
	const EXCUSED = new Set();

	// The slugs the window reaches, and HOW: through a seasonal grant the window's readers ask for
	// (a yield, a harvest or winter rewrite, an upkeep), or by name in the sheet's own blocks.
	const SEASONAL_GRANTS = ["seasonalYield", "harvestBonus", "winterConsumption", "winterPopulation", "upkeep"];
	const viaYield = new Set(Object.keys(IMPROVEMENT_GRANTS)
		.filter(slug => SEASONAL_GRANTS.some(key => IMPROVEMENT_GRANTS[slug][key])));

	it("names every seasonal improvement somewhere the window can act on it", () => {
		const seasonal = IMPROVEMENT_DEFINITIONS
			.filter(d => SEASONAL.test(plain(d.effect)))
			.map(d => d.slug);
		// A scan that finds nothing would pass everything below while proving nothing.
		expect(seasonal.length).toBeGreaterThanOrEqual(14);
		for (const slug of ["mill", "stoneWall", "additionalHousing", "aurochsHunting"]) {
			expect(seasonal, slug).toContain(slug);
		}

		// The ways to be reached, and nothing else counts: a seasonal grant on the improvement,
		// a bespoke rewrite inside one of the formula builders, or a block in the window gated on it.
		// A passing mention of the slug anywhere in the sheet does NOT count, or the improvement
		// cards themselves would satisfy this for every slug in the book.
		const EFFECTS = read("module/actors/steading/season-effects.js");
		const missing = seasonal.filter(slug =>
			!EXCUSED.has(slug) && !viaYield.has(slug)
			&& !EFFECTS.includes(`rulesHas(rules)("${slug}")`)
			&& !SHEET.includes(`_hasImprovement("${slug}")`));
		expect(missing).toEqual([]);
	});

	// The one that is surfaced rather than stepped. It is a thing the group DOES during spring,
	// not a thing the turning of the season does to the steading — the distinction inn-gathering.js
	// draws — so spring says it is open and sends the table to its own card.
	it("tells a spring GM the aurochs hunt is open, without making it a step", () => {
		expect(SHEET).toContain("aurochsNote");
		const at = SHEET.indexOf("const aurochsNote");
		const body = SHEET.slice(at, at + 700);
		expect(body).toContain(`seasonId === "spring"`);
		expect(body).toContain("Improvements tab");
		expect(body).not.toContain("data-action");
	});
});
