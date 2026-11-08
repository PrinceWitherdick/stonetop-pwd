import { describe, it, expect, vi, afterEach } from "vitest";
import {
	FoundryArcanaRepository, _resetArcanaRulePriming, primeArcanaRules,
} from "../../../../module/actors/character/repositories/FoundryArcanaRepository.js";
import { MinorArcanum } from "../../../../module/model/MinorArcanum.js";

// -- Fixtures -----------------------------------------------------------------

const ARCANUM_FLAGS = {
	slug: "huge-wooden-sphere",
	front: { title: "A Huge Wooden Sphere", item: null, description: "", unlock: { description: "", requirements: [] } },
	back:  { title: "Ffyrnig Tonic", item: null, description: "", resource: null, move: null, options: [] },
};

const OTHER_FLAGS = {
	slug: "humble-broom",
	front: { title: "A Humble Broom", item: null, description: "", unlock: { description: "", requirements: [] } },
	back:  { title: "Broom of Sweeping", item: null, description: "", resource: null, move: null, options: [] },
};

// -- Helpers ------------------------------------------------------------------

function makePack(entries = [], flagsBySlug = {}) {
	return {
		getIndex: vi.fn(async () => {}),
		index: entries,
		getDocument: vi.fn(async (id) => {
			const entry = entries.find(e => e._id === id);
			const slug  = entry?.flags?.stonetop?.slug;
			return { flags: { stonetop: flagsBySlug[slug] } };
		}),
	};
}

function stubGame(pack) {
	vi.stubGlobal("game", { packs: { get: () => pack } });
}

function stubGameNoPack() {
	vi.stubGlobal("game", { packs: { get: () => null } });
}

// A world Item document as the repository sees it: full flags already loaded (no async
// getDocument needed), plus its own `img`.
function makeWorldItem(slug, flags, { img = null, moveType = "arcanum", type = "move" } = {}) {
	return { type, system: { moveType }, img, flags: { stonetop: { ...flags, slug } } };
}

// game with a (possibly empty) pack AND a world-item collection that supports .find().
function stubGameWithWorld(pack, worldItems = []) {
	vi.stubGlobal("game", { packs: { get: () => pack }, items: worldItems });
}

// -- Tests --------------------------------------------------------------------

describe("FoundryArcanaRepository", () => {
	afterEach(() => vi.unstubAllGlobals());

	describe("findBySlug", () => {
		it("returns null when pack is not registered", async () => {
			stubGameNoPack();
			const repo = new FoundryArcanaRepository();
			expect(await repo.findBySlug("huge-wooden-sphere")).toBeNull();
		});

		it("returns null when slug is not in index", async () => {
			stubGame(makePack([], {}));
			const repo = new FoundryArcanaRepository();
			expect(await repo.findBySlug("huge-wooden-sphere")).toBeNull();
		});

		it("returns a MinorArcanum when slug is found", async () => {
			const pack = makePack(
				[{ _id: "abc123xyz0000001", flags: { stonetop: { slug: "huge-wooden-sphere" } } }],
				{ "huge-wooden-sphere": ARCANUM_FLAGS },
			);
			stubGame(pack);
			const repo = new FoundryArcanaRepository();
			const result = await repo.findBySlug("huge-wooden-sphere");
			expect(result).toBeInstanceOf(MinorArcanum);
			expect(result.slug).toBe("huge-wooden-sphere");
			expect(result.front.title).toBe("A Huge Wooden Sphere");
			expect(result.back.title).toBe("Ffyrnig Tonic");
		});

		it("calls getIndex with flags.stonetop.slug field", async () => {
			const pack = makePack([], {});
			stubGame(pack);
			const repo = new FoundryArcanaRepository();
			await repo.findBySlug("anything");
			expect(pack.getIndex).toHaveBeenCalledWith({ fields: ["flags.stonetop.slug"] });
		});

		it("caches the result — getDocument is not called a second time", async () => {
			const pack = makePack(
				[{ _id: "abc123xyz0000001", flags: { stonetop: { slug: "huge-wooden-sphere" } } }],
				{ "huge-wooden-sphere": ARCANUM_FLAGS },
			);
			stubGame(pack);
			const repo = new FoundryArcanaRepository();
			await repo.findBySlug("huge-wooden-sphere");
			await repo.findBySlug("huge-wooden-sphere");
			expect(pack.getDocument).toHaveBeenCalledTimes(1);
		});
	});

	describe("findBySlug — world items (homebrew)", () => {
		it("resolves a world Item when the slug is not in the pack", async () => {
			const pack  = makePack([], {});
			const world = [makeWorldItem("humble-broom", OTHER_FLAGS, { img: "world/broom.webp" })];
			stubGameWithWorld(pack, world);
			const repo = new FoundryArcanaRepository();
			const result = await repo.findBySlug("humble-broom");
			expect(result).toBeInstanceOf(MinorArcanum);
			expect(result.slug).toBe("humble-broom");
			expect(result.back.title).toBe("Broom of Sweeping");
			expect(result.img).toBe("world/broom.webp");
		});

		it("carries the world Item's `major` flag through to the model", async () => {
			const world = [makeWorldItem("homebrew-staff", { ...OTHER_FLAGS, major: true })];
			stubGameWithWorld(makePack([], {}), world);
			const repo = new FoundryArcanaRepository();
			const result = await repo.findBySlug("homebrew-staff");
			expect(result.major).toBe(true);
		});

		it("the shipped pack wins over a world Item on slug collision", async () => {
			const pack = makePack(
				[{ _id: "abc123xyz0000001", flags: { stonetop: { slug: "huge-wooden-sphere" } } }],
				{ "huge-wooden-sphere": ARCANUM_FLAGS },
			);
			const world = [makeWorldItem("huge-wooden-sphere", { ...OTHER_FLAGS, slug: "huge-wooden-sphere" })];
			stubGameWithWorld(pack, world);
			const repo = new FoundryArcanaRepository();
			const result = await repo.findBySlug("huge-wooden-sphere");
			expect(result.front.title).toBe("A Huge Wooden Sphere"); // pack's, not the world item's
		});

		it("ignores world Items that aren't arcanum moves", async () => {
			const world = [
				makeWorldItem("humble-broom", OTHER_FLAGS, { moveType: "basic" }),
				makeWorldItem("humble-broom", OTHER_FLAGS, { type: "weapon" }),
			];
			stubGameWithWorld(makePack([], {}), world);
			const repo = new FoundryArcanaRepository();
			expect(await repo.findBySlug("humble-broom")).toBeNull();
		});

		it("does not cache world Items — picks up live edits on re-resolve", async () => {
			const item  = makeWorldItem("humble-broom", OTHER_FLAGS);
			const world = [item];
			stubGameWithWorld(makePack([], {}), world);
			const repo = new FoundryArcanaRepository();
			expect((await repo.findBySlug("humble-broom")).back.title).toBe("Broom of Sweeping");
			item.flags.stonetop.back = { ...OTHER_FLAGS.back, title: "Edited Title" };
			expect((await repo.findBySlug("humble-broom")).back.title).toBe("Edited Title");
		});

		it("returns null when neither pack nor world has the slug", async () => {
			stubGameWithWorld(makePack([], {}), []);
			const repo = new FoundryArcanaRepository();
			expect(await repo.findBySlug("nonexistent")).toBeNull();
		});
	});

	describe("findBySlugs", () => {
		it("returns MinorArcanum instances for all matching arcana", async () => {
			const pack = makePack(
				[
					{ _id: "abc123xyz0000001", flags: { stonetop: { slug: "huge-wooden-sphere" } } },
					{ _id: "abc123xyz0000002", flags: { stonetop: { slug: "humble-broom" } } },
				],
				{ "huge-wooden-sphere": ARCANUM_FLAGS, "humble-broom": OTHER_FLAGS },
			);
			stubGame(pack);
			const repo = new FoundryArcanaRepository();
			const results = await repo.findBySlugs(["huge-wooden-sphere", "humble-broom"]);
			expect(results).toHaveLength(2);
			expect(results[0]).toBeInstanceOf(MinorArcanum);
			expect(results[0].slug).toBe("huge-wooden-sphere");
			expect(results[1]).toBeInstanceOf(MinorArcanum);
			expect(results[1].slug).toBe("humble-broom");
		});

		it("filters out slugs not in index", async () => {
			const pack = makePack(
				[{ _id: "abc123xyz0000001", flags: { stonetop: { slug: "huge-wooden-sphere" } } }],
				{ "huge-wooden-sphere": ARCANUM_FLAGS },
			);
			stubGame(pack);
			const repo = new FoundryArcanaRepository();
			const results = await repo.findBySlugs(["huge-wooden-sphere", "nonexistent"]);
			expect(results).toHaveLength(1);
			expect(results[0]).toBeInstanceOf(MinorArcanum);
			expect(results[0].slug).toBe("huge-wooden-sphere");
		});

		it("returns [] for empty slugs array", async () => {
			stubGame(makePack([], {}));
			const repo = new FoundryArcanaRepository();
			expect(await repo.findBySlugs([])).toEqual([]);
		});
	});
});

describe("primeArcanaRules", () => {
	afterEach(() => _resetArcanaRulePriming());

	// A world actor as StonetopFlags reads it: `owned` under the arcana namespace.
	const character = (owned, type = "character") => ({
		type, flags: {}, getFlag: (_scope, key) => (key === "arcana.owned" ? owned : undefined),
	});
	const hooksStub = () => {
		const on = {};
		return { on: vi.fn((name, fn) => { on[name] = fn; }), fire: (name, ...args) => on[name]?.(...args) };
	};

	it("reads only the rule cards a world character holds, each once", async () => {
		const repo = { findBySlugs: vi.fn(async () => []) };
		const actors = [
			character(["storm-markings", "huge-wooden-sphere"]),
			character(["storm-markings", "redwood-effigy"]),
			character(["twisted-spear"], "npc"),
		];
		await primeArcanaRules({ actors, hooks: hooksStub(), repo });
		expect(repo.findBySlugs).toHaveBeenCalledTimes(1);
		expect(repo.findBySlugs.mock.calls[0][0].sort()).toEqual(["redwood-effigy", "storm-markings"]);
	});

	it("reads a rule card as a character gains it, not again once read", async () => {
		const repo = { findBySlugs: vi.fn(async () => []) };
		const hooks = hooksStub();
		await primeArcanaRules({ actors: [], hooks, repo });
		expect(repo.findBySlugs).not.toHaveBeenCalled();
		hooks.fire("updateActor", character(["twisted-spear"]), { name: "Renamed" });
		expect(repo.findBySlugs).not.toHaveBeenCalled();
		hooks.fire("updateActor", character(["twisted-spear"]), { flags: {} });
		hooks.fire("createActor", character(["twisted-spear", "norubas-ice-sphere"]));
		await Promise.resolve();
		expect(repo.findBySlugs.mock.calls.map(([slugs]) => slugs)).toEqual([["twisted-spear"], ["norubas-ice-sphere"]]);
	});

	it("tries again after a read that failed", async () => {
		const repo = { findBySlugs: vi.fn(async () => { throw new Error("offline"); }) };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await primeArcanaRules({ actors: [character(["storm-markings"])], hooks: hooksStub(), repo });
		await primeArcanaRules({ actors: [character(["storm-markings"])], hooks: hooksStub(), repo });
		expect(repo.findBySlugs).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});
});
