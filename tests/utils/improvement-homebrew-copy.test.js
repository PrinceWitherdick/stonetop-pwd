import { describe, it, expect } from "vitest";
import {
	alternativeSectionFlags,
	buildImprovementDef,
	groupsFromSections,
	improvementRequirementCount,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	sectionsFromGroups,
	unformatImprovementText,
} from "../../module/utils/improvement-def.js";
import { renderImprovementCardHtml } from "../../module/journal/steading-improvement-cards.js";
import { freeImprovementName, improvementCardSaver } from "../../module/dialogs/ImprovementBuilderDialog.js";
import {
	IMPROVEMENT_DEFINITIONS,
	IMPROVEMENT_GRANTS,
	StonetopSteading,
	improvementRequirementsMet,
} from "../../module/actors/steading/StonetopSteading.js";

// The whole point of the builder, stated as one question: can it produce a homebrew copy of
// one of the book's own improvements that BEHAVES like the original?
//
// Not "does it store the same fields" — that is the shape test next door. This one puts each
// of the seventeen through the round trip a user actually performs ("Start from" fills the
// form, Save reads it back) and then asks the steading's own rules about the result: does the
// requirement check answer the same for every possible pattern of ticked boxes, does
// completing it apply the same effects, does the card read the same.

/** The four stat keys the Effect panel offers, in the dialog's order. */
const STAT_KEYS = ["fortunes", "defenses", "prosperity", "population"];

/**
 * One improvement through the builder and back out, modelling what the form does to it: the
 * fields are DOM values, so a grant of 1 goes in as a number and comes back as the string
 * "1", and the effect prose goes in as HTML and comes back as the *asterisk* text that was
 * typed. Nothing here is a shortcut past the dialog: `_fillFrom` writes exactly these values
 * and `_readGrants`/`_readGroups` read exactly these back.
 */
function copyThroughTheForm(def, grants) {
	// What ImprovementBuilderDialog._fillFrom puts in the form.
	const filled = {
		name: def.label,
		category: def.category ?? "",
		flavor: def.flavor ?? "",
		effect: unformatImprovementText(def.effect ?? ""),
		groups: groupsFromSections(def.sections ?? []),
		grants: {
			stats: Object.fromEntries(STAT_KEYS.map(key =>
				[key, grants?.stats?.[key] === undefined ? "" : String(grants.stats[key])])),
			resources: (grants?.resources ?? []).join("\n"),
			fortifications: (grants?.fortifications ?? []).join("\n"),
			removeFortifications: (grants?.removeFortifications ?? []).join("\n"),
			setSize: grants?.setSize ?? "",
			setPopulation: Number.isFinite(grants?.setPopulation) ? String(grants.setPopulation) : "",
		},
	};
	// What _readDef reads back out of it.
	return buildImprovementDef({
		name: filled.name,
		category: filled.category,
		flavor: filled.flavor,
		effect: filled.effect,
		sections: sectionsFromGroups(filled.groups),
		grants: filled.grants,
	});
}

/** Every possible pattern of ticked requirement boxes for an improvement of `n` of them. */
function* everyTickPattern(n) {
	for (let mask = 0; mask < (1 << n); mask++) {
		yield Array.from({ length: n }, (_, i) => !!(mask & (1 << i)));
	}
}

/** The card's payload attribute, decoded the way a browser decodes it. */
function payloadFrom(html) {
	return JSON.parse(html.match(/data-steading-improvement="([^"]*)"/)[1]
		.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&#x27;/g, "'").replace(/&amp;/g, "&"));
}

const BOOK = IMPROVEMENT_DEFINITIONS.map(def => ({
	def,
	grants: IMPROVEMENT_GRANTS[def.slug] ?? null,
	copy: copyThroughTheForm(def, IMPROVEMENT_GRANTS[def.slug] ?? null),
}));

describe.each(BOOK)("a homebrew copy of $def.label", ({ def, grants, copy }) => {
	it("has the same requirement boxes, in the same order", () => {
		expect(improvementRequirementCount(copy)).toBe(improvementRequirementCount(def));
		// Compared as authored text: a re-saved definition escapes the apostrophes the
		// hand-written built-ins carry raw, which paints identically (see improvement-def).
		expect(copy.sections.flatMap(s => s.items.map(unformatImprovementText)))
			.toEqual(def.sections.flatMap(s => s.items.map(unformatImprovementText)));
	});

	// The strong form of "behaves the same": not a few sampled patterns but EVERY one. This
	// is what catches a lost `min` ("2 of the following" quietly becoming all of them) or a
	// lost either/or group id (two ways to meet one requirement becoming two requirements),
	// neither of which shows up when all the boxes are ticked.
	it("is met and unmet by exactly the same ticked boxes as the original", () => {
		const n = improvementRequirementCount(def);
		for (const r of everyTickPattern(n)) {
			expect(improvementRequirementsMet(copy, r), r.map(Number).join("")).toBe(
				improvementRequirementsMet(def, r));
		}
	});

	it("draws the same either/or dividers", () => {
		expect(alternativeSectionFlags(copy.sections)).toEqual(alternativeSectionFlags(def.sections));
	});

	it("applies the same effects on completion", () => {
		expect(copy.grants).toEqual(normalizeImprovementGrants(grants));
	});

	// Prose compared as authored text on both sides, because a re-saved definition escapes
	// characters the hand-written built-ins carry raw and that paint identically: every
	// apostrophe, and the `&` in Township's "Trade & Barter" (which the copy writes as the
	// `&amp;` the book's own entry should have used).
	it("keeps its heading, flavor, category and effect prose", () => {
		expect(copy.category).toBe(def.category);
		expect(copy.flavor).toBe(def.flavor);
		expect(unformatImprovementText(copy.effect)).toBe(unformatImprovementText(def.effect));
		expect(copy.sections.map(s => unformatImprovementText(s.heading)))
			.toEqual(def.sections.map(s => unformatImprovementText(s.heading)));
	});

	// The reusable-card path: the copy is written into a journal card, which is dragged onto a
	// steading. What the steading receives is the card's payload, so that has to be the copy.
	it("survives the trip out to a homebrew card and back", () => {
		const payload = payloadFrom(renderImprovementCardHtml(copy));
		expect(payload.name).toBe(copy.name);
		expect(payload.category).toBe(copy.category);
		expect(payload.flavor).toBe(copy.flavor);
		expect(payload.effect).toBe(copy.effect);
		expect(payload.sections).toEqual(copy.sections);
		expect(payload.grants).toEqual(copy.grants);
		// And what addCustomImprovement then normalizes it to is the same thing again, so a
		// card can be dropped, removed and re-dropped without drifting.
		expect(normalizeImprovementSections(payload.sections)).toEqual(copy.sections);
		expect(normalizeImprovementGrants(payload.grants)).toEqual(copy.grants);
	});
});

describe("naming a copy the write target will accept", () => {
	// The steading holds one improvement per name, the book's own included, so an exact-name
	// copy of Palisade cannot be added to it. Being told that only on Save, after filling in
	// the whole thing, is the wrong end of the workflow: "Start from" offers a free name.
	const taken = new Set(["palisade", "palisade (homebrew)"]);
	const isTaken = name => taken.has(String(name).toLowerCase());

	it("leaves a free name alone", () => {
		expect(freeImprovementName("Roadbuilding", isTaken)).toBe("Roadbuilding");
	});

	it("marks a copy as one, and keeps counting while the marked name is taken too", () => {
		expect(freeImprovementName("Palisade", isTaken)).toBe("Palisade (homebrew 2)");
	});

	// The journal-card target declares no rule at all, since a reusable card may share a name
	// with the improvement it was copied from (and normally should).
	it("suffixes nothing when the target has no rule about names", () => {
		expect(freeImprovementName("Palisade", undefined)).toBe("Palisade");
		expect(improvementCardSaver().nameTaken).toBeUndefined();
	});

	it("agrees with the rule addCustomImprovement actually enforces", async () => {
		const flags = { customImprovements: [{ slug: "custom-roadbuilding", label: "Roadbuilding" }] };
		const actor = {
			type: "stonetop",
			system: {},
			flags: { stonetop: { steading: flags } },
			getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
			setFlag: (scope, key, value) => { actor.flags.stonetop.steading = value; return Promise.resolve(); },
		};
		const steading = new StonetopSteading(actor);

		expect(steading.improvementNameTaken("Palisade")).toBe(true);       // a built-in's label
		expect(steading.improvementNameTaken("roadbuilding")).toBe(true);   // an existing custom
		expect(steading.improvementNameTaken("Palisade (homebrew)")).toBe(false);
		expect(steading.improvementNameTaken("  ")).toBe(false);

		// And the name the picker offers is one the write actually accepts.
		const offered = freeImprovementName("Palisade", n => steading.improvementNameTaken(n));
		expect(offered).toBe("Palisade (homebrew)");
		await expect(steading.addCustomImprovement({ name: "Palisade" }))
			.resolves.toMatchObject({ ok: false, reason: "duplicate" });
		await expect(steading.addCustomImprovement({ name: offered }))
			.resolves.toMatchObject({ ok: true, label: offered });
	});
});

describe("what a homebrew copy deliberately does NOT carry", () => {
	// Herd of Horses' herd tracker and the Inn's "Bring Folks Together" button are keyed by
	// SLUG on the steading sheet, not by anything on the definition, so a copy of either is
	// the card without the widget. That is the honest behaviour (the herd's arithmetic reads
	// the steading's own herd state, of which there is one), and it is recorded here so it
	// stays a decision rather than becoming a surprise.
	it("the two slug-keyed widgets, since a copy is a different improvement", () => {
		const sheet = ["herdOfHorses", "inn"];
		for (const slug of sheet) {
			const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === slug);
			const copy = copyThroughTheForm(def, IMPROVEMENT_GRANTS[slug]);
			// The prose that explains the widget is still there; only the widget is not.
			expect(copy.effect.length).toBeGreaterThan(0);
			expect(copy.slug).toBeUndefined();
		}
	});
});
