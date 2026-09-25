// A move LEARNED from another playbook warns when its prerequisites stop being met, as a playbook
// move does (2026-09-25 Fox audit). Before, every learned card was built with no requirement at all:
// a Heavy who learned Skill at Arms, then Parry & Riposte through Seasoned Warrior, then dropped
// Skill at Arms, saw no warning on Parry & Riposte. A warning only: nothing is locked or removed.

import { describe, expect, it } from "vitest";
import { FakePlaybookRepository } from "../../fakes/FakePlaybookRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

const HEAVY = { slug: "the-heavy", name: "The Heavy", startingMovesNote: "", backgrounds: [] };
const GRANTED = { "stonetop-pwd": { grantedBy: { move: "Seasoned Warrior" } } };
const foxMove = (id, name, system = {}) => ({
	_id: id, type: "move", name, flags: GRANTED,
	system: { moveType: "playbook", playbook: "The Fox", ...system },
});
const PARRY = foxMove("pr", "Parry & Riposte", { requirement: { moves: ["Skill at Arms"] } });

async function learned(items, { level = 3 } = {}) {
	let b = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").withLevel(level);
	for (const item of items) b = b.addItem(item);
	const snap = await new TestCharacterBuilder(b.build()).withPlaybookRepo(new FakePlaybookRepository(HEAVY)).build().buildSnapshot();
	return new Map((snap.moves.find(c => c.key === "learned")?.moves ?? []).map(m => [m.name, m]));
}

describe("a learned move's requirement", () => {
	it("is met while the move it needs is owned", async () => {
		const moves = await learned([foxMove("sa", "Skill at Arms"), PARRY]);
		expect(moves.get("Parry & Riposte")).toMatchObject({ requirementsUnmet: false, requiresLabel: "Skill at Arms", locked: false });
	});

	it("warns once the move it needs is gone, and still leaves the move owned and unlocked", async () => {
		const moves = await learned([PARRY]);
		expect(moves.get("Parry & Riposte")).toMatchObject({ requirementsUnmet: true, owned: true, locked: false });
	});

	it("checks a level gate", async () => {
		const cheap = foxMove("cs", "Eye on the Door", { requirement: { level: 6 } });
		expect((await learned([cheap], { level: 3 })).get("Eye on the Door").requirementsUnmet).toBe(true);
		expect((await learned([cheap], { level: 6 })).get("Eye on the Door").requirementsUnmet).toBe(false);
	});

	it("does not ask the requirement's playbook: a learned move is from another one by definition", async () => {
		const dabbler = foxMove("db", "Dabbler", { requirement: { level: 2, playbook: "The Fox" } });
		expect((await learned([dabbler], { level: 3 })).get("Dabbler").requirementsUnmet).toBe(false);
	});

	it("leaves a move with no requirement alone", async () => {
		expect((await learned([foxMove("sa", "Skill at Arms")])).get("Skill at Arms")).toMatchObject({ requirementsUnmet: false, requiresLabel: null });
	});
});
