import { describe, it, expect, vi } from "vitest";
import { StonetopSteading, improvementRequirementsMet } from "../../../module/actors/steading/StonetopSteading.js";
import { renderImprovementCardHtml, readImprovementCard } from "../../../module/journal/steading-improvement-cards.js";
import { buildImprovementDef, sectionsFromGroups } from "../../../module/utils/improvement-def.js";
import { decodeEntities } from "../../../module/utils/strings.js";

// An improvement authored in the builder dialog has to arrive at the steading INTACT: its
// either/or requirement groups, its "2 of the following" counts, and the effects the sheet
// applies for itself. Every one of those used to be dropped somewhere along the way, which
// is why none of the book's own improvements could be reproduced by hand.
//
// The trip has two legs, and both are walked here:
//   builder -> definition -> steading                (the quick-add on the sheet)
//   builder -> journal card -> drop -> steading      (the reusable card)

function makeSteadingActor(steadingFlags = {}) {
	const actor = {
		type: "stonetop",
		system: {},
		flags: { stonetop: { steading: steadingFlags } },
		getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
		setFlag: vi.fn((scope, key, value) => { actor.flags.stonetop.steading = value; return Promise.resolve(); }),
		update: vi.fn(),
	};
	return actor;
}

/** What the builder dialog hands its saver, for an improvement with a fork in it. */
const authored = () => buildImprovementDef({
	name: "Roadbuilding",
	category: "renown",
	flavor: "The mud takes a wagon a week to cross.",
	effect: "Increase Prosperity by 1 and add the Roads to the map.",
	sections: sectionsFromGroups([
		{ items: "A crew of navvies and a season of work" },
		{ items: "Hiring the Delve's stonecutters\nPaying them (Value 3)", alternative: true },
		{ heading: "And 2 of the following:", items: "Gravel\nA surveyor\nGood weather", partial: true, min: 2 },
	]),
	grants: { stats: { prosperity: 1 }, resources: "The Maker's Roads" },
});

/**
 * The payload a dropped card delivers, read back out of the rendered card's attribute.
 *
 * The suite has no DOM, so the attribute decode a browser does when it fills `dataset` is
 * done here. `&#x27;` is spelled out beside decodeEntities because escHtml writes the hex
 * form of the apostrophe and decodeEntities only knows the decimal one.
 */
function payloadFromCard(def) {
	const html = renderImprovementCardHtml(def);
	const raw = html.match(/data-steading-improvement="([^"]*)"/)[1];
	const json = decodeEntities(raw.replace(/&#x27;/g, "&#39;"));
	return readImprovementCard({ dataset: { steadingImprovement: json } });
}

describe("authoring a custom steading improvement", () => {
	it("keeps the either/or, the count and the grants when added straight to the steading", async () => {
		const actor = makeSteadingActor();
		const steading = new StonetopSteading(actor);
		expect(await steading.addCustomImprovement(authored())).toMatchObject({ ok: true, slug: "custom-roadbuilding" });

		const def = steading.improvementDef("custom-roadbuilding");
		expect(def.sections[0].group).toBe("alt1");
		expect(def.sections[1].group).toBe("alt1");
		expect(def.sections[2].min).toBe(2);
		expect(def.grants).toEqual({ stats: { prosperity: 1 }, resources: ["The Maker's Roads"] });
	});

	it("gates completion on the authored rules rather than on every box being ticked", async () => {
		const actor = makeSteadingActor();
		const steading = new StonetopSteading(actor);
		await steading.addCustomImprovement(authored());
		const def = steading.improvementDef("custom-roadbuilding");

		// One arm of the fork, and 2 of the last 3: met, with three boxes still empty.
		expect(improvementRequirementsMet(def, [true, false, false, true, true, false])).toBe(true);
		// Neither arm finished is not a fork that has been taken.
		expect(improvementRequirementsMet(def, [false, true, false, true, true, false])).toBe(false);
		// The fork taken but only 1 of the last 3.
		expect(improvementRequirementsMet(def, [true, false, false, true, false, false])).toBe(false);
	});

	it("applies a custom improvement's own grants on completion, and reverses them", async () => {
		const actor = makeSteadingActor();
		const steading = new StonetopSteading(actor);
		await steading.addCustomImprovement(authored());

		const done = await steading.setImprovementCompleted("custom-roadbuilding", true);
		const applied = actor.update.mock.calls.at(-1)[0];
		expect(applied["system.attributes.prosperity.value"]).toBe(1);
		expect(applied["flags.stonetop-pwd.steading.resources"].map(r => r.name))
			.toContain("The Maker's Roads");
		expect(done.summary).toContain("Prosperity +1");

		// The record of what was applied is what the un-complete reads back, so put the
		// steading in the state that update would have left it in and toggle it off.
		const record = applied["flags.stonetop-pwd.steading.improvements"]["custom-roadbuilding"];
		actor.flags.stonetop.steading = {
			...actor.flags.stonetop.steading,
			system: { attributes: { prosperity: { value: 1 } } },
			resources: applied["flags.stonetop-pwd.steading.resources"],
			improvements: { "custom-roadbuilding": record },
		};

		const undone = await steading.setImprovementCompleted("custom-roadbuilding", false);
		const reverted = actor.update.mock.calls.at(-1)[0];
		expect(reverted["system.attributes.prosperity.value"]).toBe(0);
		expect(reverted["flags.stonetop-pwd.steading.resources"].map(r => r.name))
			.not.toContain("The Maker's Roads");
		expect(undone.reverted).toBe(true);
	});

	// A built-in slug's effects come from the table, never from a definition, so a custom
	// improvement can't take over one by colliding with it.
	it("still ticks the box for an improvement with no automatic effects", async () => {
		const actor = makeSteadingActor();
		const steading = new StonetopSteading(actor);
		await steading.addCustomImprovement(buildImprovementDef({ name: "Bell Tower", effect: "Ring it in danger." }));

		await steading.setImprovementCompleted("custom-bell-tower", true);
		const data = actor.update.mock.calls.at(-1)[0];
		expect(data["flags.stonetop-pwd.steading.improvements"]["custom-bell-tower"].completed).toBe(true);
		// No grants means nothing to record and nothing to reverse, so `applied` is never
		// written at all (the `null` an emptied record leaves behind is a different thing).
		expect(data["flags.stonetop-pwd.steading.improvements"]["custom-bell-tower"].applied).toBeUndefined();
		expect(data).not.toHaveProperty("system.attributes.prosperity.value");
	});

	describe("by way of a journal card", () => {
		it("carries the same rules and grants through the card's payload", () => {
			const payload = payloadFromCard(authored());
			expect(payload.sections.map(s => s.group)).toEqual(["alt1", "alt1", undefined]);
			expect(payload.sections[2].min).toBe(2);
			expect(payload.grants).toEqual({ stats: { prosperity: 1 }, resources: ["The Maker's Roads"] });
			expect(payload.category).toBe("renown");
		});

		it("lands on the steading as the improvement that was authored", async () => {
			const actor = makeSteadingActor();
			const steading = new StonetopSteading(actor);
			await steading.addCustomImprovement(payloadFromCard(authored()));

			const def = steading.improvementDef("custom-roadbuilding");
			expect(def.sections[0].group).toBe(def.sections[1].group);
			expect(def.sections[2].min).toBe(2);
			expect(def.grants.stats).toEqual({ prosperity: 1 });
		});

		it("draws the fork as an 'or' and spells out what completion applies", () => {
			const html = renderImprovementCardHtml(authored());
			expect(html.match(/steading-req-or/g)).toHaveLength(1);
			expect(html).toContain("<strong>On completion:</strong> Prosperity +1; Resources: The Maker&#x27;s Roads");
		});
	});

	it("draws the 'or' divider on the sheet above a continued either/or", async () => {
		const actor = makeSteadingActor();
		const steading = new StonetopSteading(actor);
		await steading.addCustomImprovement(authored());

		const snapshot = await steading.buildSnapshot();
		const added = snapshot.improvements.find(i => i.slug === "custom-roadbuilding");
		expect(added.sections.map(s => s.alternative)).toEqual([false, true, false]);

		// The book's own two-ways improvement gets it too, not just authored ones.
		const weapons = snapshot.improvements.find(i => i.slug === "weaponsOfWar");
		expect(weapons.sections.map(s => s.alternative)).toEqual([false, true, false]);
	});
});
