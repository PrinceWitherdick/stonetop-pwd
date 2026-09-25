import { describe, expect, it, vi } from "vitest";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

// A foreign playbook move definition (raw doc the fake move repo wraps in MoveDefinition).
function foreignMove(id, name, system = {}) {
	return { _id: id, name, system: { playbook: "The Heavy", moveType: "playbook", description: `${name} desc`, ...system } };
}

describe("StonetopCharacter.getForeignMovesForLevelUp", () => {
	it("returns qualifying foreign moves; excludes stat / cross-playbook / owned / under-level / unmet-prereq / playbook-locked", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-fox", "The Fox")
			.addItem({ _id: "o1", type: "move", name: "Armored", system: { moveType: "playbook", playbook: "The Heavy" } })
			.build();
		const char = new TestCharacterBuilder(actor)
			.addPlaybookMove(foreignMove("f1", "Smash"))                                                  // ✓ qualifies
			.addPlaybookMove(foreignMove("f2", "Improved Stat", { cap: 2 }))                               // ✗ stat move
			.addPlaybookMove(foreignMove("f3", "Seasoned Warrior", { crossPlaybook: { playbooks: ["X"] } })) // ✗ cross-playbook
			.addPlaybookMove(foreignMove("f4", "Armored"))                                                // ✗ already owned
			.addPlaybookMove(foreignMove("f5", "Cut From Granite", { requirement: { moves: ["Carved Out of Wood"] } })) // ✗ missing prereq
			.addPlaybookMove(foreignMove("f6", "Hardy", { requirement: { playbook: "The Heavy" } }))       // ✗ playbook-locked (Book I p.528: "No one but the Heavy can take Dangerous")
			.addPlaybookMove(foreignMove("f7", "Tough", { requirement: { level: 6 } }))                    // ✗ under level
			.build();

		const result = await char.getForeignMovesForLevelUp({ playbooks: ["The Heavy"] }, 5);
		expect(result.map(m => m.name)).toEqual(["Smash"]);
		expect(result[0]).toMatchObject({ compendiumId: "f1", playbook: "The Heavy", description: "Smash desc" });
	});

	it("admits a foreign move whose required move the actor DOES own", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-fox", "The Fox")
			.addItem({ _id: "o1", type: "move", name: "Crew", system: { moveType: "playbook", playbook: "The Marshal" } })
			.build();
		const char = new TestCharacterBuilder(actor)
			.addPlaybookMove(foreignMove("vc", "Veteran Crew", { requirement: { moves: ["Crew"] } }))
			.build();
		const result = await char.getForeignMovesForLevelUp({ playbooks: ["The Marshal"] }, 5);
		expect(result.map(m => m.name)).toEqual(["Veteran Crew"]);
	});
});

describe("StonetopCharacter._applyForeignMoveChoice", () => {
	function makeChar(flags = {}) {
		const actor = new FakeActorBuilder().withPlaybook("the-seeker", "The Seeker").withFlags(flags).build();
		return new TestCharacterBuilder(actor).build();
	}

	it("adds the foreign move and tags it grantedBy the cross-playbook move instance", async () => {
		const char = makeChar();
		const foreignItem = { _id: "new1", name: "Smash", setFlag: vi.fn() };
		char.addMove = vi.fn().mockResolvedValue(foreignItem);
		await char._applyForeignMoveChoice({ id: "cross1", name: "Versatile" }, "f1", null);
		expect(char.addMove).toHaveBeenCalledWith("f1");
		expect(foreignItem.setFlag).toHaveBeenCalledWith("stonetop-pwd", "grantedBy", { move: "Versatile", instanceId: "cross1" });
	});

	it("grants the possession when grantsPossession is set and not already owned (Initiate Sacred Pouch)", async () => {
		const char = makeChar();
		char.addMove = vi.fn().mockResolvedValue({ _id: "x", name: "Big Magic", setFlag: vi.fn() });
		char.selectPossession = vi.fn();
		await char._applyForeignMoveChoice({ id: "c1", name: "Initiate of the Secret Arts" }, "bm", "sacred-pouch");
		expect(char.selectPossession).toHaveBeenCalledWith("sacred-pouch");
	});

	it("does NOT re-grant the possession when the actor already owns it (idempotent across repeated takes)", async () => {
		const char = makeChar({ "possessions.selected": ["sacred-pouch"] });
		char.addMove = vi.fn().mockResolvedValue(null);
		char.selectPossession = vi.fn();
		await char._applyForeignMoveChoice({ id: "c2", name: "Initiate of the Secret Arts" }, null, "sacred-pouch");
		expect(char.selectPossession).not.toHaveBeenCalled();
	});

	it("does nothing with the foreign move when none was chosen (foreignMoveId null)", async () => {
		const char = makeChar();
		char.addMove = vi.fn();
		await char._applyForeignMoveChoice({ id: "c3", name: "Versatile" }, null, null);
		expect(char.addMove).not.toHaveBeenCalled();
	});
});

describe("StonetopCharacter.applyLevelUp — cross-playbook threading", () => {
	function makeChar() {
		const actor = new FakeActorBuilder().withPlaybook("the-fox", "The Fox").withLevel(2).withXp(20, 30).build();
		return new TestCharacterBuilder(actor).build();
	}

	it("adds the cross-playbook move FIRST, then applies the foreign-move choice with that item (ordering is load-bearing for the grantedBy tag)", async () => {
		const char = makeChar();
		const crossItem = { id: "cross1", name: "Versatile" };
		char.addMove = vi.fn().mockResolvedValue(crossItem);
		char._applyForeignMoveChoice = vi.fn();
		await char.applyLevelUp("vId", null, { crossPlaybook: true, foreignMoveId: "fId", grantsPossession: null });
		expect(char.addMove).toHaveBeenCalledWith("vId");
		expect(char._applyForeignMoveChoice).toHaveBeenCalledWith(crossItem, "fId", null);
	});

	it("skips the foreign-move choice entirely when the cross-playbook move failed to add", async () => {
		const char = makeChar();
		char.addMove = vi.fn().mockResolvedValue(null);
		char._applyForeignMoveChoice = vi.fn();
		await char.applyLevelUp("badId", null, { crossPlaybook: true, foreignMoveId: "fId", grantsPossession: "sacred-pouch" });
		expect(char._applyForeignMoveChoice).not.toHaveBeenCalled();
	});

	it("plain move (no choices): adds the move and deducts XP/level, calling no choice helper", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-blessed", "The Blessed").withLevel(2).withXp(20, 30).build();
		const char = new TestCharacterBuilder(actor).build();
		char.addMove = vi.fn().mockResolvedValue({ id: "x", name: "Big Magic" });
		char._applyForeignMoveChoice = vi.fn();
		char._applyStatIncreaseChoice = vi.fn();
		await char.applyLevelUp("bmId", null, null);
		expect(char.addMove).toHaveBeenCalledWith("bmId");
		expect(char._applyForeignMoveChoice).not.toHaveBeenCalled();
		expect(char._applyStatIncreaseChoice).not.toHaveBeenCalled();
		// level 2 → 3; cost = 6 + 2*2 = 10, so xp 20 → 10.
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.level.value": 3, "system.attributes.xp.value": 10 });
	});
});

describe("StonetopCharacter.removeMove — cross-playbook cascade", () => {
	it("removes the foreign moves a cross-playbook move granted (matched by grantedBy.instanceId)", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-fox", "The Fox")
			.addItem({ _id: "cross1", type: "move", name: "Versatile", system: { moveType: "playbook" } })
			.addItem({ _id: "g1", type: "move", name: "Smash", system: { moveType: "playbook", playbook: "The Heavy" },  flags: { "stonetop-pwd": { grantedBy: { move: "Versatile", instanceId: "cross1" } } } })
			.addItem({ _id: "g2", type: "move", name: "Other", system: { moveType: "playbook", playbook: "The Marshal" }, flags: { "stonetop-pwd": { grantedBy: { move: "Versatile", instanceId: "OTHER"  } } } })
			.build();
		await new TestCharacterBuilder(actor).build().removeMove("cross1");
		// cross1 + its grant g1; g2 belongs to a different instance and is left alone.
		expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["cross1", "g1"]);
	});

	it("removes just the move when it granted nothing", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-fox", "The Fox")
			.addItem({ _id: "m1", type: "move", name: "Harden", system: { moveType: "playbook" } }).build();
		await new TestCharacterBuilder(actor).build().removeMove("m1");
		expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["m1"]);
	});
});

// A custom move's resource track is keyed by item id, and ids are never reused — so the
// stored count has to go with the move. A shipped move keys by NAME and keeps its count on
// purpose, so re-adding it later picks up where the player left off.
describe("StonetopCharacter.removeMove — resource-track cleanup", () => {
	const RESOURCE_FLAG = "flags.stonetop-pwd.moves.backgroundChoices";

	function actorWithTracks(item) {
		return new FakeActorBuilder()
			.withFlag("moves", { backgroundChoices: { cm1: 2, "Rites of the Land": 3 } })
			.addItem(item).build();
	}

	it("drops a custom move's stored count", async () => {
		const actor = actorWithTracks({
			_id: "cm1", type: "move", name: "Homebrew", system: { moveType: "other", resource: { max: 3 } },
			flags: { "stonetop-pwd": { custom: true } },
		});
		await new TestCharacterBuilder(actor).build().removeMove("cm1");
		expect(actor.update).toHaveBeenCalledWith({ [`${RESOURCE_FLAG}.-=cm1`]: null }, undefined);
	});

	it("leaves a shipped move's name-keyed count alone", async () => {
		const actor = actorWithTracks({
			_id: "pm1", type: "move", name: "Rites of the Land", system: { moveType: "playbook", resource: { max: 4 } },
		});
		await new TestCharacterBuilder(actor).build().removeMove("pm1");
		expect(actor.update).not.toHaveBeenCalledWith(expect.objectContaining({
			[`${RESOURCE_FLAG}.-=Rites of the Land`]: null,
		}), expect.anything());
	});

	it("writes nothing when the custom move never held a track", async () => {
		const actor = actorWithTracks({
			_id: "cm2", type: "move", name: "Trackless", system: { moveType: "other" },
			flags: { "stonetop-pwd": { custom: true } },
		});
		await new TestCharacterBuilder(actor).build().removeMove("cm2");
		expect(actor.update).not.toHaveBeenCalled();
	});
});
