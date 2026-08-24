import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { backfillTreasureWriteups } from "../../module/hooks/SeedItems.js";
import { TREASURE_CATALOG } from "../../module/data/treasure-catalog.js";

// The load-time pass that puts the book's write-up onto treasures already in a world. The
// treasures shipped for years carrying only their tags, and neither the pack rebuild nor the
// world seed reaches those copies: `treasureItemsSeeded` is latched, and a treasure dragged
// onto a sheet last session is a document nobody revisits.
//
// Same gate as every other onReady write (see retired-actor-flags.test.js): a player has no
// right to update documents they don't own, and a second GM must not race the first.

const DAGGER = TREASURE_CATALOG.find(e => e.name === "An old bronze dagger");
const CROWN  = TREASURE_CATALOG.find(e => e.name === "The Three-star Crown");

const treasure = (id, name, system = {}) => ({
	id, name, type: "move",
	system: { moveType: "inventory", isTreasure: true, ...system },
});

function world({ isGM = true, activeGMs = ["gm1"], selfId = "gm1", items = [], actors = [] } = {}) {
	const updateDocuments = vi.fn(async () => []);
	return {
		updateDocuments,
		game: {
			items, actors,
			user: { id: selfId, isGM },
			users: activeGMs.map(id => ({ id, isGM: true, active: true })),
		},
	};
}

/** An actor holding the given items, recording what gets written to them. */
function holder(name, items) {
	return { name, items, updateEmbeddedDocuments: vi.fn(async () => []) };
}

let priorGame, priorItem;
beforeEach(() => { priorGame = globalThis.game; priorItem = globalThis.Item; });
afterEach(() => { globalThis.game = priorGame; globalThis.Item = priorItem; });

function install(w) {
	globalThis.game = w.game;
	globalThis.Item = { updateDocuments: w.updateDocuments };
}

describe("backfillTreasureWriteups", () => {
	it("fills the sidebar library in ONE batched request", async () => {
		const w = world({ items: [treasure("a", "An old bronze dagger"), treasure("b", "The Three-star Crown")] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(2);
		expect(w.updateDocuments).toHaveBeenCalledTimes(1);
		expect(w.updateDocuments.mock.calls[0][0]).toEqual([
			{ _id: "a", "system.artifactLore": DAGGER.writeup },
			{ _id: "b", "system.artifactLore": CROWN.writeup },
		]);
	});

	it("reaches the copies already on a character's sheet", async () => {
		const pc = holder("Ivar", [treasure("owned", "An old bronze dagger", { moveType: "inventory-custom" })]);
		install(world({ actors: [pc] }));

		expect(await backfillTreasureWriteups()).toBe(1);
		expect(pc.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{ _id: "owned", "system.artifactLore": DAGGER.writeup },
		]);
	});

	it("never overwrites a write-up the GM wrote themselves", async () => {
		const w = world({ items: [treasure("a", "An old bronze dagger", { artifactLore: "<p>Mine, actually.</p>" })] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("leaves ordinary gear and unknown treasures alone", async () => {
		const w = world({ items: [
			{ id: "gear", name: "Bedroll", type: "move", system: { moveType: "inventory" } },
			treasure("homebrew", "A perfectly ordinary rock"),
		] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("is a no-op on a second load", async () => {
		// Idempotent by construction — it only ever fills a blank — which is what lets it run
		// every load with no gate setting of its own.
		const filled = treasure("a", "An old bronze dagger", { artifactLore: DAGGER.writeup });
		const w = world({ items: [filled] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("writes nothing for a player", async () => {
		const w = world({ isGM: false, items: [treasure("a", "An old bronze dagger")] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("writes nothing for the second GM at the table", async () => {
		const w = world({ selfId: "gm2", activeGMs: ["gm1", "gm2"], items: [treasure("a", "An old bronze dagger")] });
		install(w);

		expect(await backfillTreasureWriteups()).toBe(0);
		expect(w.updateDocuments).not.toHaveBeenCalled();
	});

	it("keeps going when one actor's write fails", async () => {
		const bad = holder("Broken", [treasure("x", "An old bronze dagger")]);
		bad.updateEmbeddedDocuments = vi.fn(async () => { throw new Error("locked"); });
		const good = holder("Ivar", [treasure("y", "The Three-star Crown")]);
		install(world({ actors: [bad, good] }));

		expect(await backfillTreasureWriteups()).toBe(1);
		expect(good.updateEmbeddedDocuments).toHaveBeenCalled();
	});
});
