import { describe, it, expect } from "vitest";
import { shapeSiteSystem } from "../../module/sites/site-store.js";

describe("shapeSiteSystem", () => {
	it("fills every field for an empty seed, so a bare site still saves", () => {
		const sys = shapeSiteSystem();
		expect(sys).toEqual({
			description: "", why: "", manner: "", mannerLabel: "", picks: [],
			regionId: "", regionLabel: "", terrain: "",
			connections: [], questions: [], timeline: [],
			denizens: [], dangers: [], discoveries: [], outside: [], inside: [],
			areas: [], plans: [], randomTables: [],
		});
	});

	it("trims and drops blank lines", () => {
		const sys = shapeSiteSystem({ dangers: ["  unstable pillars ", "", "   ", "wasps"] });
		expect(sys.dangers).toEqual(["unstable pillars", "wasps"]);
	});

	it("keeps a question with no answer yet, and drops a wholly blank row", () => {
		const sys = shapeSiteSystem({
			questions: [
				{ prompt: "Why is the tomb still intact?", answer: "" },
				{ prompt: "", answer: "" },
			],
		});
		expect(sys.questions).toEqual([{ prompt: "Why is the tomb still intact?", answer: "" }]);
	});

	it("drops a pick with no result", () => {
		const sys = shapeSiteSystem({
			picks: [
				{ key: "theme", label: "Theme", value: "Tombs" },
				{ key: "purpose", label: "Purpose", value: "  " },
			],
		});
		expect(sys.picks).toEqual([{ key: "theme", label: "Theme", value: "Tombs" }]);
	});

	it("keeps an area's typed line breaks but drops an empty area", () => {
		const sys = shapeSiteSystem({
			areas: [
				{ title: "Entrance chamber (A)", description: "Dimly lit.\n\nFilthy, muddy floor.", contents: "", exits: " outside " },
				{ title: "", description: "", contents: "", exits: "" },
			],
		});
		expect(sys.areas).toEqual([{
			title: "Entrance chamber (A)",
			description: "Dimly lit.\n\nFilthy, muddy floor.",
			contents: "",
			exits: "outside",
		}]);
	});

	it("keeps a captioned table with no results yet (it's a note to fill in)", () => {
		const sys = shapeSiteSystem({
			randomTables: [
				{ caption: "What the crinwin are up to", rows: ["", " "] },
				{ caption: "", rows: [] },
				{ caption: "", rows: ["fighting over junk"] },
			],
		});
		expect(sys.randomTables).toEqual([
			{ caption: "What the crinwin are up to", rows: [] },
			{ caption: "", rows: ["fighting over junk"] },
		]);
	});

	it("coerces stray shapes rather than throwing", () => {
		const sys = shapeSiteSystem({ connections: "not a list", denizens: null, picks: undefined });
		expect(sys.connections).toEqual([]);
		expect(sys.denizens).toEqual([]);
		expect(sys.picks).toEqual([]);
	});
});
