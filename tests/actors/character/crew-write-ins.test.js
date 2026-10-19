// The Crew insert's write-in lines (Book I p.144): three blank tag lines and six blank inventory lines
// (3 ◇, 3 ◇◇). The tags live in crew.tags with the printed ones, so a crew from the one-box card reads
// its write-in into the first box with nothing migrated; a written-in item is a row of crew.writtenGear
// whose pips sit in the crew's pip map, so it loads the crew like the printed kit.

import { describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import {
	CREW_WRITE_IN_TAGS, crewWriteInTags, crewWriteInTagBoxes, crewWriteInOverflow, crewTagsWithWriteIns,
	crewWrittenGear, addCrewWrittenGear, removeCrewWrittenGearUpdate,
} from "../../../module/actors/character/crew-write-ins.js";
import * as crewSetup from "../../../module/actors/character/dialogs/CrewSetupDialog.js";
import { readRepo } from "../../fakes/css.js";

const MARSHAL_CREW = loadPlaybookPackDocs().find(d => d.system.slug === "the-marshal").flags.stonetop.crew;

describe("write-in tags", () => {
	it("draws three boxes, and an old crew's one write-in fills the first", () => {
		expect(CREW_WRITE_IN_TAGS).toBe(3);
		expect(crewWriteInTags(["brave", "stubborn"], MARSHAL_CREW, "respected")).toEqual(["stubborn", "", ""]);
		expect(crewWriteInTags(["group", "respected", "brave"], MARSHAL_CREW, "respected")).toEqual(["", "", ""]);
		expect(crewWriteInTags(["a", "b", "c", "d"], MARSHAL_CREW)).toEqual(["a", "b", "c"]);
		expect(crewWriteInOverflow(["a", "b", "c", "d"], MARSHAL_CREW)).toEqual(["d"]);
	});

	it("each write-in spends a pick, and an empty box is shut once they are spent", () => {
		expect(crewTagsWithWriteIns(["brave"], ["stubborn", " loud ", "proud"], 3)).toEqual(["brave", "stubborn", "loud"]);
		expect(crewTagsWithWriteIns(["brave"], ["", "loud", "loud"], 4)).toEqual(["brave", "loud"]);
		expect(crewTagsWithWriteIns([], [], 2, ["kept"])).toEqual(["kept"]);
		const boxes = crewWriteInTagBoxes(["brave", "stubborn"], MARSHAL_CREW, "respected", 2);
		expect(boxes).toEqual([
			{ index: 0, value: "stubborn", disabled: false },
			{ index: 1, value: "", disabled: true },
			{ index: 2, value: "", disabled: true },
		]);
		expect(crewWriteInTagBoxes(["brave"], MARSHAL_CREW, "respected", 4).every(b => !b.disabled)).toBe(true);
	});

	it("Create your crew takes three write-ins, each in its own box", async () => {
		let sel = crewSetup.crewSetupInitial();
		sel = crewSetup.crewSetupCustomTag(sel, "stubborn", MARSHAL_CREW, 4, 0);
		sel = crewSetup.crewSetupCustomTag(sel, "loud", MARSHAL_CREW, 4, 2);
		expect(sel.tags).toEqual(["stubborn", "loud"]);
		sel = crewSetup.crewSetupToggleTag(sel, "brave", true, 4).sel;
		sel = crewSetup.crewSetupCustomTag(sel, "", MARSHAL_CREW, 4, 0);
		expect(sel.tags).toEqual(["brave", "loud"]);
		const view = crewSetup.crewSetupView(MARSHAL_CREW, sel, { limit: 4 });
		expect(view.customTags.map(b => b.value)).toEqual(["loud", "", ""]);
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/crew-setup.hbs", { crewData: view });
		expect(html.match(/class="crew-setup-tag-custom"/g)).toHaveLength(3);
		expect(html).toContain('value="loud"');
	});
});

describe("the templates", () => {
	it("draw a box per write-in on the card and in onboarding, and the add row with its strike-off", () => {
		const tab = readRepo("templates/actor/partials/tab-followers.hbs");
		expect(tab).toMatch(/\{\{#each tagCustoms\}\}<input type="text" class="stonetop-follower-text stonetop-crew-tag-custom" data-index="\{\{index\}\}"/);
		expect(tab).toMatch(/\{\{#if writeIn\}\}\{\{#if \.\.\/edit\.gear\}\}<button type="button" class="stonetop-crew-gear-remove/);
		expect(tab).toContain('class="stonetop-crew-gear-add stonetop-inline-btn"');
		const onboarding = readRepo("templates/dialogs/character-onboarding.hbs");
		expect(onboarding).toMatch(/\{\{#each crewData\.customTags\}\}[\s\S]*?class="onboard-crew-tag-custom"[\s\S]*?\{\{\/each\}\}/);
	});
});

describe("written-in inventory", () => {
	it("adds a named row of weight 1 or 2, and refuses a blank name", () => {
		const rows = addCrewWrittenGear([], { label: " Rope ", weight: "2" }, "abc");
		expect(rows).toEqual([{ id: "written-abc", label: "Rope", weight: 2 }]);
		expect(addCrewWrittenGear(rows, { label: "Torch", weight: 7 }, "def")[1]).toEqual({ id: "written-def", label: "Torch", weight: 1 });
		expect(addCrewWrittenGear(rows, { label: "  " }, "x")).toBeNull();
		expect(crewWrittenGear([{ id: "", label: "x" }, null, { id: "a", label: "Ok", weight: 2 }])).toEqual([{ id: "a", label: "Ok", weight: 2 }]);
	});

	it("striking one off drops its row and its pips", () => {
		const stored = [{ id: "written-a", label: "Rope", weight: 2 }, { id: "written-b", label: "Torch", weight: 1 }];
		expect(removeCrewWrittenGearUpdate(stored, "written-a", "stonetop-pwd")).toEqual({
			"flags.stonetop-pwd.crew.writtenGear": [{ id: "written-b", label: "Torch", weight: 1 }],
			"flags.stonetop-pwd.crew.gear.-=written-a": null,
		});
	});

	it("draws on the crew card after the printed kit, and loads the crew when carried", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-marshal", name: "The Marshal", level: 2,
			flags: { crew: {
				name: "The Wolves", tags: ["brave", "stubborn"], instinct: "x", cost: "y",
				gear: { "written-a": 2 },
				writtenGear: [{ id: "written-a", label: "<b>Rope</b>", weight: 2 }, { id: "written-b", label: "Torch", weight: 1 }],
			} },
		});
		await char.addMove(sourceMovesFor("The Marshal").find(d => d.name === "Crew")._id);
		actor.typedActor = char;
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return true; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		const snap = await char.buildSnapshot();
		const crew = sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses).crew;
		const rope = crew.gear.find(g => g.slug === "written-a");
		expect(rope).toMatchObject({ writeIn: true, weight: 2, checked: true, label: "&lt;b&gt;Rope&lt;/b&gt;" });
		expect(crew.gear.at(-1)).toMatchObject({ slug: "written-b", checked: false });
		expect(crew.gear.findIndex(g => g.slug === "written-a")).toBe(MARSHAL_CREW.inventory.length);
		expect(crew.inventorySummary).toMatch(/^2 /);

		// Under the pencil, the tag picker's three write-in boxes, the stored write-in in the first.
		sheet._editingSections = new Set(["follower-card:crew:"]);
		const editing = sheet._buildFollowersData(await char.playbook(), null, snap.crewBonuses).crew;
		expect(editing.tagCustoms.map(b => b.value)).toEqual(["stubborn", "", ""]);
		expect(actor.getFlag(STONETOP_SCOPE, "crew.tags")).toEqual(["brave", "stubborn"]);
	});
});
