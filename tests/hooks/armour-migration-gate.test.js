import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _migrateArmourToArmor } from "../../module/hooks/Ready.js";

// The pre-rename `system.attributes.armour` sweep. It is a GM-only, primary-GM-only world write,
// and it used to be neither: it ran on every connected client, so each PLAYER tried to update
// every character — including the ones they don't own. Core rejects that, and because the call
// site was a bare `await`, the rejection tore down the rest of onReady for them (no hotbar
// macros, no game.stonetop, no window restore). It went unnoticed for as long as it did because
// the "nothing stale" early return makes it a silent no-op in an already-clean world.
//
// One BATCHED request, like every other actor sweep in onReady (see retired-actor-flags.test.js):
// a round trip, a world-wide broadcast and a sidebar repaint apiece is a lot to spend on the
// blocking startup path when the load this fires on is the load it fires for every stale
// character at once.

/** A character still carrying the legacy key, plus one that has already been migrated. */
function world({ isGM = true, activeGMs = ["gm1"], selfId = "gm1" } = {}) {
	const stale = {
		id: "stale", type: "character",
		system: { attributes: { armour: 1 } },
	};
	const clean = {
		id: "clean", type: "character",
		system: { attributes: { armor: { value: 1 } } },
	};
	const updateDocuments = vi.fn(async () => []);
	return {
		stale, clean, updateDocuments,
		game: {
			// A plain array: game.actors is a Collection, but the sweep only ever calls .filter,
			// which an array already provides.
			actors: [stale, clean],
			user: { id: selfId, isGM },
			// isPrimaryGM elects the lowest-id ACTIVE GM.
			users: activeGMs.map(id => ({ id, isGM: true, active: true })),
			release: { generation: 13 },
		},
	};
}

let priorGame, priorActor;
beforeEach(() => { priorGame = globalThis.game; priorActor = globalThis.Actor; });
afterEach(() => { globalThis.game = priorGame; globalThis.Actor = priorActor; });

/** Install the world and the Actor class the sweep batches through. */
function install(w) {
	globalThis.game = w.game;
	globalThis.Actor = { updateDocuments: w.updateDocuments };
	return w;
}

describe("_migrateArmourToArmor", () => {
	it("drops the legacy key for the primary GM, in one request", async () => {
		const w = install(world());

		await _migrateArmourToArmor();

		expect(w.updateDocuments).toHaveBeenCalledTimes(1);
		// Only the stale character is in it — the clean one has no `armour` key to drop.
		// v13 shape: the legacy `-=` leaf prefix, chosen by deletionEntry off game.release.
		expect(w.updateDocuments).toHaveBeenCalledWith([
			{ _id: "stale", "system.attributes.-=armour": null },
		]);
	});

	it("writes NOTHING on a player's client", async () => {
		const w = install(world({ isGM: false, selfId: "player1" }));

		await _migrateArmourToArmor();

		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("writes nothing on a SECOND GM's client, so two GMs can't both migrate", async () => {
		const w = install(world({ activeGMs: ["gm1", "gm2"], selfId: "gm2" }));

		await _migrateArmourToArmor();

		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("is a no-op in an already-clean world", async () => {
		const w = install(world());
		delete w.stale.system.attributes.armour;

		await _migrateArmourToArmor();

		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("gives every document in the batch its OWN deletion operator on v14", async () => {
		// deletionEntry's stated contract: v14 removes a key only where the update value is a fresh
		// `ForcedDeletion` INSTANCE. One built for the whole batch and spread across N documents is
		// trusting an operator object to be reusable when nothing says it is — and if core consumes
		// or normalises it per document, every character behind the first keeps the legacy key.
		const w = world();
		w.game.actors.push({ id: "stale2", type: "character", system: { attributes: { armour: 2 } } });
		w.game.release = { generation: 14 };
		install(w);
		class ForcedDeletion {}
		const priorFoundry = globalThis.foundry;
		globalThis.foundry = { ...globalThis.foundry, data: { operators: { ForcedDeletion } } };

		try {
			await _migrateArmourToArmor();
			const [[updates]] = w.updateDocuments.mock.calls;
			const ops = updates.map(u => u["system.attributes.armour"]);
			expect(ops).toHaveLength(2);
			expect(ops[0]).toBeInstanceOf(ForcedDeletion);
			expect(ops[1]).toBeInstanceOf(ForcedDeletion);
			expect(ops[0]).not.toBe(ops[1]);
		} finally {
			globalThis.foundry = priorFoundry;
		}
	});

	it("saves the characters it can when the batch is rejected", async () => {
		// Actor.updateDocuments is all-or-nothing, so one locked or unwritable character used to
		// hold every clean one stale — on the single load this sweep has any work to do at all.
		const w = world();
		w.stale.update = vi.fn(async () => {});
		w.updateDocuments.mockRejectedValue(new Error("locked"));
		install(w);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			await _migrateArmourToArmor();
			expect(w.stale.update).toHaveBeenCalledWith({ "system.attributes.-=armour": null });
		} finally {
			warn.mockRestore();
		}
	});
});
