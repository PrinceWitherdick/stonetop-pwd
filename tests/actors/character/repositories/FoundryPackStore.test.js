import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { FoundryPackStore } from "../../../../module/actors/character/repositories/FoundryPackStore.js";
import { resetPackIndexFields, withoutCoveredFields } from "../../../../module/utils/pack-index.js";

// -- Helpers ------------------------------------------------------------------

const ENTRY_A = { _id: "id001", system: { slug: "alpha" } };
const ENTRY_B = { _id: "id002", system: { slug: "beta" } };
const DOC_A   = { name: "Alpha Doc", system: { slug: "alpha" } };

function makePack(entries = [], docsById = {}) {
	return {
		getIndex:    vi.fn(async () => {}),
		index:       entries,
		getDocument: vi.fn(async (id) => docsById[id] ?? null),
	};
}

function stubGame(pack) {
	vi.stubGlobal("game", { packs: { get: () => pack } });
}

function stubGameNoPack() {
	vi.stubGlobal("game", { packs: { get: () => null } });
}

// The per-pack field union is remembered across calls, so each test starts from an empty registry.
beforeEach(() => resetPackIndexFields());
afterEach(() => vi.unstubAllGlobals());

// -- Tests --------------------------------------------------------------------

describe("FoundryPackStore", () => {
	describe("findEntry", () => {
		it("returns null when pack not registered", async () => {
			stubGameNoPack();
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.findEntry(e => e.system?.slug === "alpha")).toBeNull();
		});

		it("returns null when no entry matches predicate", async () => {
			stubGame(makePack([ENTRY_A], {}));
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.findEntry(e => e.system?.slug === "missing")).toBeNull();
		});

		it("returns matching entry", async () => {
			stubGame(makePack([ENTRY_A, ENTRY_B], {}));
			const store  = new FoundryPackStore("stonetop.test", ["system.slug"]);
			const result = await store.findEntry(e => e.system?.slug === "beta");
			expect(result).toEqual(ENTRY_B);
		});
	});

	describe("filterEntries", () => {
		it("returns [] when pack not registered", async () => {
			stubGameNoPack();
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.filterEntries(() => true)).toEqual([]);
		});

		it("returns only entries matching predicate", async () => {
			stubGame(makePack([ENTRY_A, ENTRY_B], {}));
			const store   = new FoundryPackStore("stonetop.test", ["system.slug"]);
			const results = await store.filterEntries(e => e.system?.slug === "alpha");
			expect(results).toHaveLength(1);
			expect(results[0]).toEqual(ENTRY_A);
		});

		it("returns all entries when predicate always true", async () => {
			stubGame(makePack([ENTRY_A, ENTRY_B], {}));
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.filterEntries(() => true)).toHaveLength(2);
		});
	});

	describe("getAll", () => {
		it("returns [] when pack not registered", async () => {
			stubGameNoPack();
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.getAll()).toEqual([]);
		});

		it("returns all index entries", async () => {
			stubGame(makePack([ENTRY_A, ENTRY_B], {}));
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.getAll()).toHaveLength(2);
		});
	});

	describe("getDocument", () => {
		it("returns null when pack not registered", async () => {
			stubGameNoPack();
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.getDocument("id001")).toBeNull();
		});

		it("returns the document by id", async () => {
			stubGame(makePack([ENTRY_A], { id001: DOC_A }));
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			expect(await store.getDocument("id001")).toEqual(DOC_A);
		});
	});

	describe("getIndex (via _ensureIndexed)", () => {
		it("passes the configured fields to getIndex", async () => {
			const pack = makePack([], {});
			stubGame(pack);
			const store = new FoundryPackStore("stonetop.test", ["system.slug", "system.name"]);
			await store.findEntry(() => false);
			expect(pack.getIndex).toHaveBeenCalledWith({ fields: ["system.slug", "system.name"] });
		});

		// Deliberately NOT "only once": the pack is asked on every query, because a getIndex it has
		// already covered returns without a round trip, while one it hasn't is exactly the case that
		// needs re-indexing — another store having narrowed the pack's indexed fields.
		it("asks the pack on every query", async () => {
			const pack = makePack([ENTRY_A], {});
			stubGame(pack);
			const store = new FoundryPackStore("stonetop.test", ["system.slug"]);
			await store.findEntry(e => e.system?.slug === "alpha");
			await store.filterEntries(() => true);
			await store.getAll();
			expect(pack.getIndex).toHaveBeenCalledTimes(3);
		});

		// The bug this guards: v14 rebuilds a document's index entry out of the fields the pack was
		// LAST indexed on, dropping every other one. Two stores sharing a pack with different lists
		// therefore un-indexed each other's fields, and any entry whose document had been loaded lost
		// them — post-death inserts vanishing from "Choose Your Fate" once opened. So every store's
		// request carries the union of what all of them have asked for.
		it("asks for the union of every store's fields on the same pack", async () => {
			const pack = makePack([ENTRY_A], {});
			stubGame(pack);
			const slugStore = new FoundryPackStore("stonetop.test", ["system.slug"]);
			const typeStore = new FoundryPackStore("stonetop.test", ["system.moveType"]);
			await slugStore.getAll();
			await typeStore.getAll();
			await slugStore.getAll();
			for (const call of pack.getIndex.mock.calls.slice(1)) {
				expect(call[0].fields).toEqual(expect.arrayContaining(["system.slug", "system.moveType"]));
			}
		});

		// The server projects with setProperty(field, 1) per field: `flags.stonetop` then
		// `flags.stonetop.slug` threw "Cannot create property 'slug' on number '1'" and failed the
		// items pack's index for every caller (move-refresh asks for the whole flag bag, the outfit
		// repository for leaves of it). The ancestor alone returns the subtree.
		it.each([
			["the child first", ["flags.stonetop.slug", "system.moveType"], ["flags.stonetop", "flags.stonetopx"]],
			["the ancestor first", ["flags.stonetop", "flags.stonetopx"], ["flags.stonetop.slug", "system.moveType"]],
		])("drops a field an ancestor in the union already covers, %s", async (_, first, second) => {
			const pack = makePack([ENTRY_A], {});
			stubGame(pack);
			await new FoundryPackStore("stonetop.test", first).getAll();
			await new FoundryPackStore("stonetop.test", second).getAll();
			const asked = pack.getIndex.mock.lastCall[0].fields;
			expect(asked).toHaveLength(3);
			expect(asked).toEqual(expect.arrayContaining(["system.moveType", "flags.stonetop", "flags.stonetopx"]));
		});

		// One request the server rejects used to stay in the union, so every later caller on the
		// pack sent it again and failed too until reload.
		it("rolls back the fields of a request the server rejects", async () => {
			const pack = makePack([ENTRY_A], {});
			pack.getIndex = vi.fn(async ({ fields }) => {
				if (fields.includes("bad")) throw new Error("rejected");
			});
			stubGame(pack);
			await new FoundryPackStore("stonetop.test", ["system.slug"]).getAll();
			await expect(new FoundryPackStore("stonetop.test", ["bad"]).getAll()).rejects.toThrow("rejected");
			await new FoundryPackStore("stonetop.test", ["system.moveType"]).getAll();
			expect(pack.getIndex).toHaveBeenLastCalledWith({ fields: ["system.slug", "system.moveType"] });
		});

		// A caller's link sends the whole union, which already holds the fields of callers queued
		// behind it, so a rejected field used to fail every valid caller ahead of it in a burst.
		it("fails only the caller that asked for a rejected field, in a concurrent burst", async () => {
			const pack = makePack([ENTRY_A], {});
			pack.getIndex = vi.fn(async ({ fields }) => {
				if (fields.includes("bad")) throw new Error("rejected");
			});
			stubGame(pack);
			const [good, bad, later] = await Promise.allSettled([
				new FoundryPackStore("stonetop.test", ["system.slug"]).getAll(),
				new FoundryPackStore("stonetop.test", ["bad"]).getAll(),
				new FoundryPackStore("stonetop.test", ["system.moveType"]).getAll(),
			]);
			expect(good.status).toBe("fulfilled");
			expect(bad.status).toBe("rejected");
			expect(later.status).toBe("fulfilled");
			expect(pack.getIndex).toHaveBeenLastCalledWith({ fields: ["system.slug", "system.moveType"] });
		});

		// A failed request is retried narrowed to this caller's own fields before it gives up, so a
		// one-off failure on the burst's union does not reject a caller whose fields were fine, and
		// the next caller in the burst still asks for its own.
		it("retries a failed union with only the caller's own fields", async () => {
			const pack = makePack([ENTRY_A], {});
			let failures = 1;
			pack.getIndex = vi.fn(async () => {
				if (failures-- > 0) throw new Error("socket timeout");
			});
			stubGame(pack);
			const results = await Promise.allSettled([
				new FoundryPackStore("stonetop.test", ["system.slug"]).getAll(),
				new FoundryPackStore("stonetop.test", ["system.moveType"]).getAll(),
			]);
			expect(results.map(r => r.status)).toEqual(["fulfilled", "fulfilled"]);
			expect(pack.getIndex.mock.calls.map(([{ fields }]) => fields)).toEqual([
				["system.slug", "system.moveType"],
				["system.slug"],
				["system.slug", "system.moveType"],
			]);
		});

		// Core adds `pack.indexFields` (its own and CONFIG[type].compendiumIndexFields) ahead of the
		// caller's, so a caller's field under one of them would be projected onto its 1.
		it("drops a field that one of core's own index fields already covers", async () => {
			const pack = { ...makePack([ENTRY_A], {}), indexFields: new Set(["name", "system.moveType"]) };
			stubGame(pack);
			await new FoundryPackStore("stonetop.test", ["system.moveType.label", "name", "system", "system.slug"]).getAll();
			expect(pack.getIndex).toHaveBeenLastCalledWith({ fields: ["system"] });
		});

		it("withoutCoveredFields keeps only the outermost of nested paths, matching whole segments", () => {
			expect(withoutCoveredFields(["a.b.c", "a.b", "a", "ab.c", "x.y.z", "x.y.z.w", "q", "q"]))
				.toEqual(["a", "ab.c", "x.y.z", "q"]);
		});

		it("keeps the field sets of different packs apart", async () => {
			const packs = { a: makePack([], {}), b: makePack([], {}) };
			vi.stubGlobal("game", { packs: { get: (id) => packs[id] ?? null } });
			await new FoundryPackStore("a", ["system.slug"]).getAll();
			await new FoundryPackStore("b", ["system.moveType"]).getAll();
			expect(packs.b.getIndex).toHaveBeenCalledWith({ fields: ["system.moveType"] });
		});
	});
});
