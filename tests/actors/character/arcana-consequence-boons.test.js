import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakeInventoryRepository } from "../../fakes/FakeInventoryRepository.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { consequenceBoonsFrom } from "../../../module/actors/character/CharacterArcana.js";
import { MinorArcanum } from "../../../module/model/MinorArcanum.js";
import { boxIndexBefore } from "../../../module/utils/glyphs.js";

// Audit EDG-6 (2026-11-06): a marked arcana Consequence that grants armor or max HP changes the numbers the
// damage card's Apply and the token bar read (Book II).

const PACKS = path.resolve(__dirname, "../../../packs/src/stonetop-arcana");
const card = file => JSON.parse(fs.readFileSync(path.join(PACKS, file), "utf8")).flags.stonetop;

const REDWOOD = {
	slug: "redwood-effigy",
	consequenceBoons: [{ label: "Your blood flows like sap", hp: 4, armor: 1 }],
	front: { title: "Redwood Effigy", item: null, description: "<p>A doll.</p>", unlock: { description: "", requirements: [] } },
	back: {
		title: "Mysteries", item: null, resource: null, move: null, options: [],
		description: "<p><strong>□ GREATER CONDUIT</strong> …</p><h3>Consequences</h3><ul><li>□ Your heartbeat slows.</li><li>□ Your blood flows like sap and your muscles become like wood. Gain +1 armor and +4 max HP.</li></ul>",
	},
};
const CAVE = {
	slug: "creepy-cave",
	consequenceBoons: [{ label: "Gain unholy resilience", hp: 2, versus: { armor: 1, against: "bronze" } }],
	front: { title: "Creepy Cave", item: null, description: "<p>A cave.</p>", unlock: { description: "", requirements: [] } },
	back: {
		title: "Mysteries", item: null, resource: null, move: null, options: [],
		description: "<ul><li>□ Gain unholy resilience: increase your max HP by 2 and gain +1 armor against anything but bronze.</li><li>□ Gain one of your victim's physical traits.</li></ul>",
	},
};

const PLAYBOOK = { slug: "test-heavy", name: "Test Heavy", hp: 10, specialPossessions: { pickCount: 0, preselected: [], options: [] } };

function makeChar({ arcana = [], owned = [], boxes = {} } = {}) {
	const actor = new FakeActorBuilder()
		.withFlag("arcana.owned", owned)
		.withFlag("arcana.identified", owned)
		.withFlag("arcana.boxes", boxes)
		.withPlaybook(PLAYBOOK.slug, PLAYBOOK.name)
		.build();
	return new TestCharacterBuilder(actor)
		.withInventoryRepo(new FakeInventoryRepository([]))
		.withArcanaRepo(new FakeArcanaRepository(arcana))
		.addPlaybook(PLAYBOOK)
		.build();
}

describe("what marked Consequences add", () => {
	it("sums the boons whose box is marked, found by their printed words", () => {
		expect(consequenceBoonsFrom([REDWOOD], {})).toEqual({ hp: 0, armor: 0, versus: null });
		// The heartbeat (box 1) is not the sap (box 2).
		expect(consequenceBoonsFrom([REDWOOD], { "redwood-effigy:back:1": true })).toEqual({ hp: 0, armor: 0, versus: null });
		expect(consequenceBoonsFrom([REDWOOD, CAVE], { "redwood-effigy:back:2": true, "creepy-cave:back:0": true }))
			.toEqual({ hp: 6, armor: 1, versus: { armor: 1, against: "bronze" } });
	});

	it("is carried through the card model", () => {
		expect(new MinorArcanum(REDWOOD).consequenceBoons).toEqual(REDWOOD.consequenceBoons);
		expect(new MinorArcanum({ slug: "x", front: {}, back: {} }).consequenceBoons).toEqual([]);
	});

	it("names a box the shipped card prints right before those words", () => {
		for (const file of ["major/redwood-effigy.json", "major/hectumel-codex.json", "major/staff-of-the-lidless-orb.json", "minor/creepy-cave.json"]) {
			const data = card(file);
			expect(data.consequenceBoons?.length, file).toBeGreaterThan(0);
			for (const boon of data.consequenceBoons) {
				expect(boxIndexBefore(data.back.description, boon.label, { adjacent: true }), `${file}: ${boon.label}`).toBeGreaterThanOrEqual(0);
			}
		}
	});
});

describe("the character's armor and max HP", () => {
	it("gain the Redwood Effigy's +1 armor and +4 max HP once its Consequence is marked (pp.570-571)", async () => {
		const before = await makeChar({ arcana: [REDWOOD], owned: ["redwood-effigy"] }).computedVitals();
		const after = await makeChar({ arcana: [REDWOOD], owned: ["redwood-effigy"], boxes: { "redwood-effigy:back:2": true } }).computedVitals();
		expect(after.armor).toBe(before.armor + 1);
		expect(after.maxHp).toBe(before.maxHp + 4);
	});

	it("gain the Creepy Cave's +1 armor as armor that does not count against bronze (p.528)", async () => {
		const v = await makeChar({ arcana: [CAVE], owned: ["creepy-cave"], boxes: { "creepy-cave:back:0": true } }).computedVitals();
		expect(v.armor).toBe(1);
		expect(v.maxHp).toBe(12);
		expect(v.conditional).toBe(1);
		expect(v.conditionalSource).toBe("vs. bronze");
	});
});
