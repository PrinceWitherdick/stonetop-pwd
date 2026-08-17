import { describe, it, expect } from "vitest";
import { buildSiteCardVM, rollSiteTable, SITE_ACCENT } from "../../module/sites/site-view.js";
import { shapeSiteSystem } from "../../module/sites/site-store.js";

/** A fake site page: only what the card VM reads. */
const page = (seed, extra = {}) => ({
	id: "site1", uuid: "JournalEntry.j1.JournalEntryPage.site1", name: "The Green Lord's Tomb",
	isOwner: true, system: shapeSiteSystem(seed), ...extra,
});

describe("buildSiteCardVM", () => {
	it("renders a foundation-only site as just that", async () => {
		const vm = await buildSiteCardVM(page({
			mannerLabel: "Green Lord site", regionLabel: "The Great Wood", terrain: "Clearing, meadow, sparse trees",
			description: "A dome-shaped tomb, mostly intact.",
		}));
		expect(vm.name).toBe("The Green Lord's Tomb");
		expect(vm.accent).toBe(SITE_ACCENT);
		expect(vm.foundation).toEqual(["Green Lord site", "The Great Wood", "Clearing, meadow, sparse trees"]);
		expect(vm.hasDescription).toBe(true);
		// Nothing else was prepped, so no other section claims to have content.
		for (const flag of ["hasWhy", "hasPicks", "hasConnections", "hasQuestions", "hasTimeline",
			"hasDenizens", "hasDangers", "hasDiscoveries", "hasEnvironment", "hasAreas",
			"hasPlans", "hasRandomTables"]) {
			expect(vm[flag], flag).toBe(false);
		}
	});

	it("keeps the picks in order with their labels", async () => {
		const vm = await buildSiteCardVM(page({
			picks: [
				{ key: "theme", label: "Theme", value: "Tombs, mummification, constructed afterlives" },
				{ key: "structure", label: "Structure", value: "Ziggurat/pyramid/dome" },
			],
		}));
		expect(vm.picks).toEqual([
			{ label: "Theme", value: "Tombs, mummification, constructed afterlives" },
			{ label: "Structure", value: "Ziggurat/pyramid/dome" },
		]);
	});

	it("titles an untitled area by its position", async () => {
		const vm = await buildSiteCardVM(page({
			areas: [{ title: "", description: "Vaulted to 20 feet, coated in soot.", contents: "", exits: "" }],
		}));
		expect(vm.areas[0].title).toBe("Area 1");
		expect(vm.areas[0].hasDescription).toBe(true);
		expect(vm.areas[0].hasExits).toBe(false);
	});

	it("numbers a random table's rows and sizes its die by the row count", async () => {
		const vm = await buildSiteCardVM(page({
			randomTables: [{ caption: "Crinwin stuff", rows: ["eating", "nest-building", "fighting over junk"] }],
		}));
		expect(vm.randomTables[0].die).toBe("1d3");
		expect(vm.randomTables[0].rows).toEqual([
			{ roll: 1, text: "eating" },
			{ roll: 2, text: "nest-building" },
			{ roll: 3, text: "fighting over junk" },
		]);
	});

	it("marks an unanswered question and reads both halves of an answered one", async () => {
		const vm = await buildSiteCardVM(page({
			questions: [
				{ prompt: "Where do the crinwin live?", answer: "The trusted ones nest inside." },
				{ prompt: "What treasures did Thornthumb leave?", answer: "" },
			],
		}));
		expect(vm.questions).toEqual([
			{ prompt: "Where do the crinwin live?", answer: "The trusted ones nest inside." },
			{ prompt: "What treasures did Thornthumb leave?", answer: "" },
		]);
	});

	it("honours a forced owner flag (the overlay renders for the GM)", async () => {
		const vm = await buildSiteCardVM(page({}, { isOwner: false }), { forOwner: true });
		expect(vm.isOwner).toBe(true);
	});
});

describe("rollSiteTable", () => {
	const rolling = page({ randomTables: [{ caption: "Crinwin stuff", rows: ["eating", "nest-building", "fighting"] }] });

	it("rolls a row and reports its number and die", () => {
		expect(rollSiteTable(rolling, 0, () => 0)).toEqual({ roll: 1, text: "eating", die: "1d3" });
		expect(rollSiteTable(rolling, 0, () => 0.99)).toEqual({ roll: 3, text: "fighting", die: "1d3" });
	});

	it("returns null when there's nothing to roll", () => {
		expect(rollSiteTable(rolling, 7)).toBe(null);
		expect(rollSiteTable(page({ randomTables: [{ caption: "Empty", rows: [] }] }), 0)).toBe(null);
		expect(rollSiteTable(null, 0)).toBe(null);
	});
});
