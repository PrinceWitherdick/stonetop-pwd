import { describe, it, expect } from "vitest";
import {
	alternativeSectionFlags,
	buildImprovementDef,
	defaultSectionHeading,
	flatRequirementItems,
	formatImprovementText,
	groupsFromSections,
	improvementRequirementCount,
	itemsFromRows,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	ordinal,
	remapRequirementTicks,
	rowsFromItems,
	sectionsFromGroups,
	summarizeImprovementGrants,
	unformatImprovementText,
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

	// The bug this is here for: `Number("")` is 0, so the untouched "Set Population to" box
	// read as a real grant. EVERY improvement the builder saved carried setPopulation: 0,
	// and completing any of them reset the steading's Population to +0 (and un-completing
	// it put back whatever it had been). An explicit zero still has to mean zero, because
	// Township sets exactly that.
	it("does not read an untouched Population box as a grant of zero", () => {
		expect(normalizeImprovementGrants({ setPopulation: "" })).toBeNull();
		expect(normalizeImprovementGrants({ setPopulation: "   " })).toBeNull();
		expect(normalizeImprovementGrants({ setPopulation: null })).toBeNull();
		expect(normalizeImprovementGrants({ setPopulation: "0" })).toEqual({ setPopulation: 0 });
		expect(normalizeImprovementGrants({ setPopulation: 0 })).toEqual({ setPopulation: 0 });
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

	// `name` and `flavor` are painted with a double-stash by both readers and `heading`,
	// the items and `effect` with a triple. Escaping the first pair here would show the
	// entity itself on the card; NOT escaping the second would let typed markup through.
	it("stores the marked-up fields as HTML and leaves the plain ones plain", () => {
		const def = buildImprovementDef({
			name: "Roads & Bridges",
			flavor: "It's a long walk.",
			effect: "*Pull Together* to <build> it.",
			sections: sectionsFromGroups([{ rows: [{ text: "*Pull Together*", repeat: 2 }] }]),
		});
		expect(def.name).toBe("Roads & Bridges");
		expect(def.flavor).toBe("It's a long walk.");
		expect(def.effect).toBe("<em>Pull Together</em> to &lt;build&gt; it.");
		expect(def.sections[0].items).toEqual([
			"<em>Pull Together</em> (1st)",
			"<em>Pull Together</em> (2nd)",
		]);
	});

	it("marks up the heading it writes for a group as well as one that was typed", () => {
		const [written] = buildImprovementDef({
			name: "X",
			sections: sectionsFromGroups([{ heading: "Then *Pull Together*:", rows: [{ text: "A season" }] }]),
		}).sections;
		expect(written.heading).toBe("Then <em>Pull Together</em>:");
	});

	it("leaves an improvement whose Effect panel was never touched with no grants at all", () => {
		const def = buildImprovementDef({
			name: "Roadbuilding",
			sections: sectionsFromGroups([{ rows: [{ text: "A surveyor" }] }]),
			grants: {
				stats: { fortunes: "", defenses: "", prosperity: "", population: "" },
				resources: "", fortifications: "", removeFortifications: "",
				setSize: "", setPopulation: "",
			},
		});
		expect(def.grants).toBeNull();
	});
});

describe("authored text", () => {
	it("escapes what was typed, then resolves *asterisks* to the italics the book prints", () => {
		expect(formatImprovementText("*Pull Together* to raise <it>"))
			.toBe("<em>Pull Together</em> to raise &lt;it&gt;");
	});

	it("leaves a lone or unclosed asterisk alone rather than swallowing it", () => {
		expect(formatImprovementText("Timber (Value 2 * 3)")).toBe("Timber (Value 2 * 3)");
		expect(formatImprovementText("A *half-typed emphasis")).toBe("A *half-typed emphasis");
	});

	it("comes back out as what was typed, so an existing improvement can be re-opened", () => {
		const typed = "*Pull Together*, costing a month & 1 Surplus";
		expect(unformatImprovementText(formatImprovementText(typed))).toBe(typed);
	});

	// The steading tab and the journal card both paint these unescaped, so an escape that
	// survived into the stored definition would show as literal entity text on both.
	it("round-trips the book's own requirement text", () => {
		const stored = "<em>Pulling Together</em> to build the stable and corral";
		expect(formatImprovementText(unformatImprovementText(stored))).toBe(stored);
	});
});

describe("repeated requirements", () => {
	it("numbers the boxes the way the book numbers them", () => {
		expect(ordinal(1)).toBe("1st");
		expect(ordinal(2)).toBe("2nd");
		expect(ordinal(3)).toBe("3rd");
		expect(ordinal(4)).toBe("4th");
		// The teens are the case a naive lookup gets wrong; no book improvement repeats
		// eleven times, but the ordinal helper is not the place to bet on that.
		expect(ordinal(11)).toBe("11th");
		expect(ordinal(21)).toBe("21st");
	});

	it("expands one row into that many numbered boxes", () => {
		expect(itemsFromRows([
			{ text: "A designated building site", repeat: 1 },
			{ text: "*Pull Together*", repeat: 3 },
			{ text: "  ", repeat: 4 },
		])).toEqual([
			"A designated building site",
			"*Pull Together* (1st)",
			"*Pull Together* (2nd)",
			"*Pull Together* (3rd)",
		]);
	});

	it("caps a mistyped count rather than minting a thousand checkboxes", () => {
		expect(itemsFromRows([{ text: "A season", repeat: 500 }])).toHaveLength(20);
		expect(itemsFromRows([{ text: "A season", repeat: 0 }])).toEqual(["A season"]);
	});

	it("collapses a numbered run back into the row that produced it, and nothing else", () => {
		expect(rowsFromItems([
			"A veteran warrior",
			"4 seasons of work (1st)",
			"4 seasons of work (2nd)",
			// Not a run: the ordinals do not start at one, so these stay as they are.
			"Something else (2nd)",
		])).toEqual([
			{ text: "A veteran warrior", repeat: 1 },
			{ text: "4 seasons of work", repeat: 2 },
			{ text: "Something else (2nd)", repeat: 1 },
		]);
	});
});

describe("remapRequirementTicks", () => {
	// `r` is flat and positional, so an inserted step would slide every tick onto the wrong
	// requirement. That is the whole reason editing an improvement in place needs this.
	it("keeps a ticked step's tick when a step is inserted above it", () => {
		expect(remapRequirementTicks(
			["A surveyor", "Gravel"],
			["A charter", "A surveyor", "Gravel"],
			[true, false],
		)).toEqual([false, true, false]);
	});

	it("keeps it when the steps are reordered", () => {
		expect(remapRequirementTicks(["A", "B", "C"], ["C", "A", "B"], [false, true, true]))
			.toEqual([true, false, true]);
	});

	it("drops the tick of a step that was deleted, and starts a new step unticked", () => {
		expect(remapRequirementTicks(["A", "B"], ["A", "C"], [true, true])).toEqual([true, false]);
	});

	it("matches repeated text in order, which is the only reading available", () => {
		expect(remapRequirementTicks(
			["Pull Together", "Pull Together"],
			["Pull Together", "Pull Together", "Pull Together"],
			[true, false],
		)).toEqual([true, false, false]);
	});

	it("survives a missing or short tick array", () => {
		expect(remapRequirementTicks(["A", "B"], ["A", "B"], [true])).toEqual([true, false]);
		expect(remapRequirementTicks(["A"], ["A"], undefined)).toEqual([false]);
	});
});

describe("flatRequirementItems", () => {
	it("is the list `r` is indexed by, across every section", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
		expect(flatRequirementItems(def)).toHaveLength(improvementRequirementCount(def));
		expect(flatRequirementItems(null)).toEqual([]);
	});
});

describe("groupsFromSections", () => {
	// Copying one of the book's improvements into the builder is the round trip, and the
	// whole of it: groupsFromSections fills the form, sectionsFromGroups reads it back, and
	// buildImprovementDef turns the *asterisks* into the <em> the definition stores. All
	// seventeen have to come out the way they went in, or "Start from" hands the author a
	// copy that quietly differs from what they picked.
	//
	// Compared as AUTHORED text and as the either/or pattern, not byte for byte, because
	// two differences are by design and neither changes what is rendered or checked:
	// a re-saved definition escapes the apostrophes the hand-written built-ins carry raw
	// (`&#x27;`, which paints as an apostrophe and comes back as one), and an either/or run
	// is re-issued a fresh shared id, since only its equality with its neighbour is ever
	// read (see alternativeSectionFlags, improvementRequirementsMet).
	const meaning = sections => ({
		sections: sections.map(s => ({
			heading: unformatImprovementText(s.heading),
			items: s.items.map(unformatImprovementText),
			...(Number.isFinite(s.min) ? { min: s.min } : {}),
		})),
		alternatives: alternativeSectionFlags(sections),
	});

	it("round-trips every one of the book's improvements through the form", () => {
		for (const def of IMPROVEMENT_DEFINITIONS) {
			const rebuilt = buildImprovementDef({
				name: def.label,
				sections: sectionsFromGroups(groupsFromSections(def.sections)),
			});
			expect(meaning(rebuilt.sections), def.slug).toEqual(meaning(normalizeImprovementSections(def.sections)));
		}
	});

	// The one thing the projection above cannot see, asserted directly: a copied
	// requirement still carries the book's italics as markup rather than as literal text.
	it("keeps the book's italics as markup through the copy", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "herdOfHorses");
		const rebuilt = buildImprovementDef({
			name: def.label,
			sections: sectionsFromGroups(groupsFromSections(def.sections)),
		});
		expect(rebuilt.sections[0].items[1]).toContain("<em>Pulling Together</em>");
	});

	it("collapses Additional Housing's five Pull Togethers into one repeated row", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "additionalHousing");
		const [, staged] = groupsFromSections(def.sections);
		expect(staged.rows).toEqual([{ text: "*Pull Together*", repeat: 5 }]);
	});

	it("brings back Weapons of War's either/or as an alternative group", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
		expect(groupsFromSections(def.sections).map(g => g.alternative)).toEqual([false, true, false]);
	});

	it("brings back Aurochs Hunting's 2-of-3 as a partial group", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "aurochsHunting");
		const [first] = groupsFromSections(def.sections);
		expect(first.partial).toBe(true);
		expect(first.min).toBe(2);
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
