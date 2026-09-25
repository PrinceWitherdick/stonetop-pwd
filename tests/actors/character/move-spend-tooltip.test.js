// The "Spend 1 to:" hover on a move's hold track (Silver Tongued's Nerve, Command). ResourceDef
// builds it and the move templates read `resource.spendTooltip`, but a playbook move's and a learned
// move's tracks were built through ResourceBuilder, which copied only max/title/labels, so only an
// Other move ever showed it (2026-09-25 Fox audit).

import { describe, it, expect } from "vitest";
import { FakePlaybookRepository } from "../../fakes/FakePlaybookRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { ResourceBuilder } from "../../../module/model/Resource.js";

const FOX   = { slug: "the-fox", name: "The Fox", img: "x.svg", description: "", statsNote: "", hp: 16, damage: "d8", startingMovesNote: "", backgrounds: [] };
const HEAVY = { slug: "the-heavy", name: "The Heavy", startingMovesNote: "", backgrounds: [] };
const NERVE = { max: 3, title: "Nerve", spendOptions: ["Get them to say more than they meant", "Plant a seed of doubt"] };
const HOVER = "Spend 1 to:<br>• Get them to say more than they meant<br>• Plant a seed of doubt";
const movesByKey = (snap, key) => snap.moves.find(c => c.key === key)?.moves ?? [];

describe("the Spend 1 to: hover", () => {
	it("rides a playbook move's track", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-fox", "The Fox").withLevel(1)
			.withItems([{ _id: "st1", type: "move", name: "Silver Tongued", system: { moveType: "playbook", playbook: "The Fox", resource: NERVE } }]).build();
		const snap = await new TestCharacterBuilder(actor).withPlaybookRepo(new FakePlaybookRepository(FOX))
			.addPlaybookMove({ _id: "st", name: "Silver Tongued", system: { moveType: "playbook", playbook: "The Fox", rollType: "cha", resource: NERVE } })
			.build().buildSnapshot();
		expect(movesByKey(snap, "playbook").find(m => m.name === "Silver Tongued").resource.spendTooltip).toBe(HOVER);
	});

	it("rides a move learned from another playbook", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy")
			.addItem({
				_id: "gm1", type: "move", name: "Silver Tongued",
				system: { moveType: "playbook", playbook: "The Fox", resource: NERVE },
				flags: { "stonetop-pwd": { grantedBy: { move: "Versatile" } } },
			}).build();
		const snap = await new TestCharacterBuilder(actor).withPlaybookRepo(new FakePlaybookRepository(HEAVY)).build().buildSnapshot();
		expect(movesByKey(snap, "learned").find(m => m.name === "Silver Tongued").resource.spendTooltip).toBe(HOVER);
	});

	it("is absent on a track with no spend menu, which keeps the shape it had", () => {
		const plain = new ResourceBuilder().withCurrent(0).withMax(2).withTitle(null).withLabels([]).withSpendTooltip(null).build();
		expect(plain).not.toHaveProperty("spendTooltip");
	});
});
