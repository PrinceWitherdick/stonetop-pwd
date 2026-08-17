import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _dropRetiredActorFlags } from "../../module/hooks/Ready.js";

// The sweep that takes retired sheet-preference flags off actors that still carry one. Right now
// that list is `invocationsSort` — the Invocations tab's "Known first / A-Z" dropdown, removed
// once the tab settled on the one order. Nothing reads the flag any more, so it is dead weight in
// an actor's data.
//
// Same gate as every other onReady write (see armour-migration-gate.test.js): a player has no
// right to update actors they don't own, and a second GM must not race the first.

const SCOPE = "stonetop-pwd";

/** An actor still carrying the retired flag, one carrying only live flags, one with no flags. */
function world({ isGM = true, activeGMs = ["gm1"], selfId = "gm1", generation = 13 } = {}) {
	const stale = {
		id: "stale", type: "character",
		flags: { [SCOPE]: { invocationsSort: "alpha", hideUnknownInvocations: true } },
	};
	const live = {
		id: "live", type: "character",
		flags: { [SCOPE]: { hideUnknownInvocations: true } },
	};
	const bare = { id: "bare", type: "npc", flags: {} };
	const updateDocuments = vi.fn(async () => []);
	return {
		stale, live, bare, updateDocuments,
		game: {
			actors: [stale, live, bare],
			user: { id: selfId, isGM },
			// isPrimaryGM elects the lowest-id ACTIVE GM.
			users: activeGMs.map(id => ({ id, isGM: true, active: true })),
			release: { generation },
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
}

describe("_dropRetiredActorFlags", () => {
	it("drops the retired flag for the primary GM, in ONE batched request", async () => {
		const w = world();
		install(w);

		expect(await _dropRetiredActorFlags()).toBe(1);

		expect(w.updateDocuments).toHaveBeenCalledTimes(1);
		// v13 shape: the legacy `-=` leaf prefix, chosen by deletionEntry off game.release.
		expect(w.updateDocuments).toHaveBeenCalledWith([
			{ _id: "stale", [`flags.${SCOPE}.-=invocationsSort`]: null },
		]);
	});

	it("leaves the LIVE flags on that actor alone", async () => {
		const w = world();
		install(w);

		await _dropRetiredActorFlags();

		const [[[update]]] = w.updateDocuments.mock.calls;
		// The whole point: only the retired key is named. `hideUnknownInvocations` is still read
		// by the Invocations tab, and a sweep that reset it would silently lose a real preference.
		expect(Object.keys(update)).toEqual(["_id", `flags.${SCOPE}.-=invocationsSort`]);
	});

	it("is a no-op in an already-clean world, so it can run every load", async () => {
		const w = world();
		delete w.stale.flags[SCOPE].invocationsSort;
		install(w);

		expect(await _dropRetiredActorFlags()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("writes NOTHING on a player's client", async () => {
		const w = world({ isGM: false, selfId: "player1" });
		install(w);

		await _dropRetiredActorFlags();

		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("writes nothing on a SECOND GM's client, so two GMs can't both sweep", async () => {
		const w = world({ activeGMs: ["gm1", "gm2"], selfId: "gm2" });
		install(w);

		await _dropRetiredActorFlags();

		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("sweeps the actors it can when the batch is rejected", async () => {
		// All-or-nothing, like every bulk write: one unwritable actor must not leave the rest
		// carrying a retired key until somebody notices. Idempotent either way, so whatever still
		// fails is picked up next load.
		const w = world();
		w.stale.update = vi.fn(async () => {});
		w.updateDocuments.mockRejectedValue(new Error("locked"));
		install(w);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			await _dropRetiredActorFlags();
			expect(w.stale.update).toHaveBeenCalledWith({ [`flags.${SCOPE}.-=invocationsSort`]: null });
		} finally {
			warn.mockRestore();
		}
	});

	it("uses a ForcedDeletion instance on v14, where the `-=` prefix is deprecated", async () => {
		const w = world({ generation: 14 });
		install(w);
		class ForcedDeletion {}
		const priorFoundry = globalThis.foundry;
		globalThis.foundry = { ...globalThis.foundry, data: { operators: { ForcedDeletion } } };

		try {
			await _dropRetiredActorFlags();
			const [[[update]]] = w.updateDocuments.mock.calls;
			// Plain path, and the VALUE carries the deletion — see utils/foundry-compat.js.
			expect(update[`flags.${SCOPE}.invocationsSort`]).toBeInstanceOf(ForcedDeletion);
		} finally {
			globalThis.foundry = priorFoundry;
		}
	});
});
