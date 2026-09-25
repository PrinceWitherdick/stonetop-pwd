// Load-gated moves (module/actors/character/load-gates.js), from the 2026-09-25 Fox audit.
//
// Catlike: "When you carry a light load and act with care, you move silently. When you hide in
// shadows or darkness, you remain unseen until you draw attention to yourself, move positions, or
// attack." Only the FIRST clause is about load, yet the expedition readout crossed out the whole
// move, and the Moves tab said nothing at all while the Fox staggered under a heavy load.

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { loadGatedClause, loadGateNote, overLoadGate, tagLoadGatedMoves } from "../../../module/actors/character/load-gates.js";
import { FakePlaybookRepository } from "../../fakes/FakePlaybookRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";

vi.mock("../../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const ROOT = "Z:/Foundry/FoundryVTT/Data/systems/stonetop-pwd/packs/src/stonetop-items/playbook-moves";
const move = rel => JSON.parse(readFileSync(`${ROOT}/${rel}`, "utf8"));
const CATLIKE  = move("the-fox/catlike.json");
const FREE_RUN = move("the-fox/free-running.json");
const STALKER  = move("the-ranger/stalker.json");
const UNCANNY  = move("the-heavy/uncanny-reflexes.json");

describe("which clause the load gates, read off the move's own text", () => {
	it("gates only Catlike's first clause", () => {
		expect(loadGatedClause(CATLIKE.system.description)).toEqual({ partial: true, clause: "act with care" });
	});

	it("gates only Stalker's first clause, too", () => {
		expect(loadGatedClause(STALKER.system.description)).toEqual({ partial: true, clause: "move with care" });
	});

	it("gates the whole of a one-trigger move (Free Running, Uncanny Reflexes)", () => {
		expect(loadGatedClause(FREE_RUN.system.description).partial).toBe(false);
		expect(loadGatedClause(UNCANNY.system.description).partial).toBe(false);
	});
});

describe("the Moves tab's tag", () => {
	const owned = (m, over = {}) => ({ name: m.name, owned: true, maxLoad: m.system.maxLoad, description: m.system.description, ...over });

	it("says nothing while the load is within the move's limit", () => {
		expect(overLoadGate("light", "light")).toBe(false);
		expect(overLoadGate("light", null)).toBe(false);
		expect(loadGateNote(owned(FREE_RUN), "light")).toBeNull();
		expect(loadGateNote(owned(STALKER), "normal")).toBeNull();
	});

	it("names the load a move needs once the sheet's load is heavier", () => {
		expect(loadGateNote(owned(FREE_RUN), "normal")).toBe("needs a light load");
		expect(loadGateNote(owned(STALKER), "heavy")).toBe("move with care: needs a normal or light load");
		expect(loadGateNote(owned(CATLIKE), "overloaded")).toBe("act with care: needs a light load");
	});

	it("tags only a move the character owns", () => {
		expect(loadGateNote(owned(FREE_RUN, { owned: false }), "heavy")).toBeNull();
		const cats = [{ moves: [owned(FREE_RUN), { name: "Clash", owned: true, maxLoad: "" }] }];
		tagLoadGatedMoves(cats, "heavy");
		expect(cats[0].moves.map(m => m.loadGateNote ?? null)).toEqual(["needs a light load", null]);
	});

	it("reads the load the sheet itself derives", async () => {
		const FOX = { slug: "the-fox", name: "The Fox", startingMovesNote: "", backgrounds: [] };
		const system = { moveType: "playbook", playbook: "The Fox", maxLoad: "light", description: FREE_RUN.system.description };
		// Driven through the whole snapshot: a Fox carrying 4 undefined ◇ (normal) is told Free
		// Running needs a light load; one carrying nothing is not.
		const snapFor = async pool => {
			const actor = new FakeActorBuilder().withPlaybook("the-fox", "The Fox")
				.withFlag("inventory.regularPool", pool)
				.addItem({ _id: "fr", type: "move", name: "Free Running", system })
				.build();
			const snap = await new TestCharacterBuilder(actor).withPlaybookRepo(new FakePlaybookRepository(FOX))
				.addPlaybookMove({ _id: "fr", name: "Free Running", system })
				.build().buildSnapshot();
			return snap.moves.flatMap(c => c.moves).find(m => m.name === "Free Running");
		};
		expect((await snapFor(0)).loadGateNote).toBeUndefined();
		expect((await snapFor(4)).loadGateNote).toBe("needs a light load");
	});
});

describe("the expedition readout", () => {
	it("names Catlike's gated clause instead of crossing out the whole move", async () => {
		const { ExpeditionDialog } = await import("../../../module/dialogs/ExpeditionDialog.js");
		const snap = { moves: [{ moves: [
			{ name: "Catlike", owned: true, maxLoad: "light", description: CATLIKE.system.description },
			{ name: "Free Running", owned: true, maxLoad: "light", description: FREE_RUN.system.description },
		] }] };
		const rows = ExpeditionDialog.prototype._gatedMovesFor.call({}, snap, "heavy", 0);
		expect(rows.map(r => [r.name, r.active])).toEqual([["Catlike (act with care)", false], ["Free Running", false]]);
	});
});
