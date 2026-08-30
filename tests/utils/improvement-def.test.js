import { describe, it, expect } from "vitest";
import {
	alternativeSectionFlags,
	buildImprovementDef,
	defaultSectionHeading,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	sectionsFromGroups,
	summarizeImprovementGrants,
} from "../../module/utils/improvement-def.js";
import {
	IMPROVEMENT_DEFINITIONS,
	improvementRequirementsMet,
} from "../../module/actors/steading/StonetopSteading.js";

// The authoring shape of a steading improvement. The reason this exists at all: the
// create-improvement form could only ever produce ONE flat "requires all of these" list
// and no automatic effects, so none of the book's own improvements could be reproduced
// with it. What is tested here is that the parts it was missing survive the trip from
// the form to a definition the steading's own rules already understand.

describe("sectionsFromGroups", () => {
	it("writes the heading the playbook would print when the author leaves it blank", () => {
		const sections = sectionsFromGroups([
			{ items: "A veteran warrior\nSix well-equipped fighters" },
			{ items: "A season of drills" },
		]);
		expect(sections[0].heading).toBe("Requires all of the following:");
		expect(sections[1].heading).toBe("And then:");
	});

	it("says how many when the group only needs some of its items", () => {
		const [section] = sectionsFromGroups([
			{ items: "A herd of horses\nCooperating with the Hillfolk\nA cunning plan", partial: true, min: "2" },
		]);
		expect(section.heading).toBe("Requires 2 of the following:");
		expect(section.min).toBe(2);
	});

	it("keeps an author's own heading over the written one", () => {
		const [section] = sectionsFromGroups([{ heading: "Requires either one of these:", items: "One\nTwo" }]);
		expect(section.heading).toBe("Requires either one of these:");
	});

	it("leaves `min` off a group that must be fully ticked", () => {
		const [section] = sectionsFromGroups([{ items: "One\nTwo" }]);
		expect(section).not.toHaveProperty("min");
	});

	// The either/or the book prints as "Requires either this: ... Or all of these: ...".
	// The requirement check reads it off a shared `group` id, so the id has to be stamped
	// on BOTH sections, including the one that was authored before the fork existed.
	it("joins an alternative to the group above it under one group id", () => {
		const sections = sectionsFromGroups([
			{ items: "A few dozen good swords (Value 3)" },
			{ items: "A smith with upgraded tools\nA cartload of iron ore", alternative: true },
			{ items: "A veteran warrior" },
		]);
		expect(sections[0].group).toBe("alt1");
		expect(sections[1].group).toBe("alt1");
		expect(sections[1].heading).toBe("Or all of these:");
		expect(sections[2]).not.toHaveProperty("group");
		expect(sections[2].heading).toBe("And then:");
	});

	it("runs three alternatives into a single either/or rather than a chain of pairs", () => {
		const sections = sectionsFromGroups([
			{ items: "One" },
			{ items: "Two", alternative: true },
			{ items: "Three", alternative: true },
		]);
		expect(sections.map(s => s.group)).toEqual(["alt1", "alt1", "alt1"]);
	});

	it("starts a second either/or after an ordinary group breaks the run", () => {
		const sections = sectionsFromGroups([
			{ items: "One" },
			{ items: "Two", alternative: true },
			{ items: "Three" },
			{ items: "Four", alternative: true },
		]);
		expect(sections.map(s => s.group)).toEqual(["alt1", "alt1", "alt2", "alt2"]);
	});

	it("drops a group the author added and never filled in", () => {
		expect(sectionsFromGroups([{ items: "One" }, { items: "  \n " }, {}])).toHaveLength(1);
	});

	// A blank group between two real ones used to leave the second one an "alternative"
	// to nothing, which reads as a lone OR group and is satisfied by itself.
	it("ignores an alternative flag with nothing above it to be an alternative to", () => {
		const sections = sectionsFromGroups([{}, { items: "One", alternative: true }]);
		expect(sections).toHaveLength(1);
		expect(sections[0]).not.toHaveProperty("group");
		expect(sections[0].heading).toBe("Requires all of the following:");
	});

	// The whole point of authoring `min` and `group`: the steading's own requirement check
	// has always understood them, and now reads them off an authored improvement too.
	it("produces sections the steading's requirement check agrees with", () => {
		const def = { sections: sectionsFromGroups([
			{ items: "Swords (Value 3)" },
			{ items: "A smith\nIron ore", alternative: true },
			{ items: "One\nTwo\nThree", partial: true, min: "2" },
		]) };

		expect(improvementRequirementsMet(def, [false, false, false, false, false, false])).toBe(false);
		// The first alternative alone, plus 2 of the last 3: met, with three boxes unticked.
		expect(improvementRequirementsMet(def, [true, false, false, true, true, false])).toBe(true);
		// The other alternative in full does just as well.
		expect(improvementRequirementsMet(def, [false, true, true, true, true, false])).toBe(true);
		// One of the two alternatives half-done is not either of them.
		expect(improvementRequirementsMet(def, [false, true, false, true, true, false])).toBe(false);
	});
});

describe("defaultSectionHeading", () => {
	it("distinguishes the first clause, a continuation, and an alternative", () => {
		expect(defaultSectionHeading({ index: 0, count: 3 })).toBe("Requires all of the following:");
		expect(defaultSectionHeading({ index: 1, count: 3 })).toBe("And then:");
		expect(defaultSectionHeading({ index: 1, count: 3, alternative: true })).toBe("Or all of these:");
		expect(defaultSectionHeading({ index: 1, count: 3, alternative: true, min: 2 })).toBe("Or 2 of these:");
	});

	// "3 of the following" over a list of 3 is just "all of them", and reads worse.
	it("does not count out a minimum that covers the whole list", () => {
		expect(defaultSectionHeading({ index: 0, count: 3, min: 3 })).toBe("Requires all of the following:");
	});
});

describe("normalizeImprovementSections", () => {
	it("keeps a real 'some of these' count and drops one that means all of them", () => {
		const [some, all] = normalizeImprovementSections([
			{ heading: "Two", items: ["a", "b", "c"], min: 2 },
			{ heading: "Every", items: ["a", "b"], min: 5 },
		]);
		expect(some.min).toBe(2);
		expect(all).not.toHaveProperty("min");
	});

	it("drops an empty group id, which would otherwise read as one shared alternative", () => {
		const [section] = normalizeImprovementSections([{ heading: "H", items: ["a"], group: "  " }]);
		expect(section).not.toHaveProperty("group");
	});

	it("trims items, drops blank lines, and drops a section with nothing in it", () => {
		expect(normalizeImprovementSections([
			{ heading: "", items: ["  a  ", "", "   "] },
			{ heading: "", items: [] },
		])).toEqual([{ heading: "", items: ["a"] }]);
	});
});

describe("normalizeImprovementGrants", () => {
	it("keeps only what the steading's grant engine can apply and reverse", () => {
		expect(normalizeImprovementGrants({
			stats: { fortunes: "1", defenses: 0, luck: 3 },
			resources: "Mill\n\n  Inn  ",
			fortifications: [],
			removeFortifications: "Palisade",
			setSize: "town",
			setPopulation: "0",
		})).toEqual({
			stats: { fortunes: 1 },
			resources: ["Mill", "Inn"],
			removeFortifications: ["Palisade"],
			setSize: "town",
			setPopulation: 0,
		});
	});

	it("is null when nothing was filled in, so an improvement can be prose only", () => {
		expect(normalizeImprovementGrants({ stats: { fortunes: "" }, resources: "  " })).toBeNull();
		expect(normalizeImprovementGrants(null)).toBeNull();
	});

	it("refuses a size that is not one of the four tiers", () => {
		expect(normalizeImprovementGrants({ setSize: "metropolis" })).toBeNull();
	});
});

describe("summarizeImprovementGrants", () => {
	it("reads back what completing the improvement will do", () => {
		expect(summarizeImprovementGrants(normalizeImprovementGrants({
			stats: { fortunes: 1, prosperity: -1 },
			fortifications: "Stone Wall",
			removeFortifications: "Palisade",
			setSize: "town",
			setPopulation: 0,
		}))).toEqual([
			"Fortunes +1",
			// U+2212, from the shared statGrantLine: this surface and the applied-record twin on
			// StonetopSteading used to print the same −1 with two different minus glyphs.
			"Prosperity −1",
			"Fortifications: Stone Wall",
			"Fortifications cleared: Palisade",
			"Size becomes town",
			"Population becomes +0",
		]);
	});

	it("has nothing to say about an improvement with no automatic effects", () => {
		expect(summarizeImprovementGrants(null)).toEqual([]);
	});
});

describe("buildImprovementDef", () => {
	it("trims the prose and carries the normalized parts through", () => {
		const def = buildImprovementDef({
			name: "  Roadbuilding  ",
			category: "renown",
			flavor: " The mud takes a wagon a week. ",
			effect: " Increase Prosperity by 1. ",
			sections: sectionsFromGroups([{ items: "A surveyor\nGravel", partial: true, min: 1 }]),
			grants: { stats: { prosperity: 1 } },
		});
		expect(def.name).toBe("Roadbuilding");
		expect(def.flavor).toBe("The mud takes a wagon a week.");
		expect(def.effect).toBe("Increase Prosperity by 1.");
		expect(def.sections[0].min).toBe(1);
		expect(def.grants).toEqual({ stats: { prosperity: 1 } });
	});
});

describe("alternativeSectionFlags", () => {
	it("marks the section that continues an either/or, not the one that opens it", () => {
		expect(alternativeSectionFlags([
			{ group: "weapons-source" },
			{ group: "weapons-source" },
			{},
		])).toEqual([false, true, false]);
	});

	// Weapons of War is the book's own two-ways-to-get-there improvement, and the reason
	// the sheet needs an "or" divider: its second section is an alternative, not a further
	// requirement.
	it("finds the fork in the book's own Weapons of War", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
		expect(alternativeSectionFlags(def.sections)).toEqual([false, true, false]);
	});

	it("marks nothing on an improvement with no alternatives", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "palisade");
		expect(alternativeSectionFlags(def.sections).some(Boolean)).toBe(false);
	});
});
