import { describe, it, expect, vi } from "vitest";
import { CharacterPossessions, onboardingWriteIns } from "../../../module/actors/character/CharacterPossessions.js";

function makeFlags(store = {}) {
	return {
		getFlag: (key) => store[key] ?? null,
		setFlag: vi.fn(async (key, val) => { store[key] = val; }),
		// StonetopFlags.batch writes several flags in one actor.update; here it is just
		// several stores set at once (the fake has no document to update).
		batch: vi.fn(async ({ sets = {} } = {}) => { Object.assign(store, sets); }),
	};
}

describe("CharacterPossessions — top-level", () => {
	it("selected returns empty Set when nothing saved", () => {
		const cp = new CharacterPossessions(makeFlags());
		expect(cp.selected.size).toBe(0);
	});

	it("select adds slug to set", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.select("apiary");
		expect(store.selected).toContain("apiary");
	});

	it("deselect removes slug from set", async () => {
		const store = { selected: ["apiary", "mastiffs"] };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.deselect("apiary");
		expect(store.selected).not.toContain("apiary");
		expect(store.selected).toContain("mastiffs");
	});

	it("deselect forgets the possession's spent uses and picks, in the same write, and only its own", async () => {
		const store = { selected: ["books-and-scrolls", "distillery"], uses: { "books-and-scrolls": 3, distillery: 1 }, subChoices: { "books-and-scrolls": ["x"] } };
		const flags = makeFlags(store);
		flags.batch = vi.fn(async ({ sets = {}, deletes = {} } = {}) => {
			Object.assign(store, sets);
			for (const [key, subs] of Object.entries(deletes)) for (const sub of subs) delete store[key][sub];
		});
		const cp = new CharacterPossessions(flags);
		await cp.deselect("books-and-scrolls");
		expect(flags.batch).toHaveBeenCalledTimes(1);
		expect(store.selected).toEqual(["distillery"]);
		expect(store.uses).toEqual({ distillery: 1 });
		expect(store.subChoices).toEqual({});
		// Nothing stored to forget: nothing asked to be deleted.
		await cp.deselect("distillery");
		expect(flags.batch.mock.calls[1][0].deletes).toEqual({ uses: ["distillery"] });
	});

	it("setUses stores count under slug key", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setUses("sacred-pouch", 2);
		expect(store.uses).toEqual({ "sacred-pouch": 2 });
	});
});

describe("CharacterPossessions — subChoices", () => {
	it("subChoices returns empty object when nothing saved", () => {
		const cp = new CharacterPossessions(makeFlags());
		expect(cp.subChoices).toEqual({});
	});

	it("addSubChoice stores the choiceSlug in the possession's array", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.addSubChoice("weapons-of-war", "sword");
		expect(store.subChoices).toEqual({ "weapons-of-war": ["sword"] });
	});

	it("addSubChoice is idempotent — calling twice does not duplicate", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.addSubChoice("weapons-of-war", "sword");
		await cp.addSubChoice("weapons-of-war", "sword");
		expect(store.subChoices["weapons-of-war"]).toHaveLength(1);
	});

	it("addSubChoice appends to an existing array", async () => {
		const store = { subChoices: { "weapons-of-war": ["sword"] } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.addSubChoice("weapons-of-war", "crossbow");
		expect(store.subChoices["weapons-of-war"]).toEqual(["sword", "crossbow"]);
	});

	it("removeSubChoice removes the choiceSlug from the array", async () => {
		const store = { subChoices: { "weapons-of-war": ["sword", "crossbow"] } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.removeSubChoice("weapons-of-war", "sword");
		expect(store.subChoices["weapons-of-war"]).toEqual(["crossbow"]);
	});

	it("removeSubChoice is safe when slug not in array", async () => {
		const store = { subChoices: { "weapons-of-war": ["sword"] } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.removeSubChoice("weapons-of-war", "battleaxe");
		expect(store.subChoices["weapons-of-war"]).toEqual(["sword"]);
	});

	it("setSubChoices replaces the whole array, dropping deselected picks", async () => {
		const store = { subChoices: { "weapons-of-war": ["sword", "battleaxe"] } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setSubChoices("weapons-of-war", ["sword", "long-spear"]);
		expect(store.subChoices["weapons-of-war"]).toEqual(["sword", "long-spear"]);
	});

	it("setSubChoices leaves other possessions' picks untouched", async () => {
		const store = { subChoices: { "weapons-of-war": ["sword"], "sacred-pouch": ["heirloom"] } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setSubChoices("weapons-of-war", []);
		expect(store.subChoices).toEqual({ "weapons-of-war": [], "sacred-pouch": ["heirloom"] });
	});
});

describe("CharacterPossessions — custom write-ins", () => {
	it("custom returns empty array when nothing saved", () => {
		const cp = new CharacterPossessions(makeFlags());
		expect(cp.custom).toEqual([]);
	});

	it("setCustom assigns custom-N slugs and drops blank labels", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setCustom(["A locket", "   ", "Grandfather's blade"]);
		expect(store.custom).toEqual([
			{ slug: "custom-1", label: "A locket" },
			{ slug: "custom-2", label: "Grandfather's blade" },
		]);
	});

	it("setCustom trims labels", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setCustom(["  A map  "]);
		expect(store.custom).toEqual([{ slug: "custom-1", label: "A map" }]);
	});

	it("setCustom replaces the whole list (idempotent across re-applies)", async () => {
		const store = { custom: [{ slug: "custom-1", label: "Old item" }] };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setCustom(["Old item"]);
		expect(store.custom).toEqual([{ slug: "custom-1", label: "Old item" }]);
	});

	it("setCustom with no labels clears the list", async () => {
		const store = { custom: [{ slug: "custom-1", label: "Old item" }] };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setCustom([]);
		expect(store.custom).toEqual([]);
	});

	it("removeCustom drops the matching slug", async () => {
		const store = { custom: [{ slug: "custom-1", label: "A" }, { slug: "custom-2", label: "B" }] };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.removeCustom("custom-1");
		expect(store.custom).toEqual([{ slug: "custom-2", label: "B" }]);
	});

	// The sheet's "+ Something else (discuss with GM)": the same { slug, label } onboarding stores.
	it("addCustom appends a trimmed write-in in onboarding's shape", async () => {
		const store = { custom: [{ slug: "custom-1", label: "A locket" }] };
		const cp = new CharacterPossessions(makeFlags(store));
		const entry = await cp.addCustom("  Grandfather's blade ");
		expect(entry).toEqual({ slug: "custom-2", label: "Grandfather's blade" });
		expect(store.custom).toEqual([
			{ slug: "custom-1", label: "A locket" },
			{ slug: "custom-2", label: "Grandfather's blade" },
		]);
	});

	it("addCustom never reuses a slug another write-in still holds", async () => {
		const store = { custom: [{ slug: "custom-2", label: "B" }] };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.addCustom("C");
		expect(store.custom.map(c => c.slug)).toEqual(["custom-2", "custom-3"]);
	});

	it("addCustom with a blank label adds nothing", async () => {
		const flags = makeFlags({});
		const cp = new CharacterPossessions(flags);
		expect(await cp.addCustom("   ")).toBeNull();
		expect(flags.setFlag).not.toHaveBeenCalled();
	});

	it("an added write-in removes like an onboarding one", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		const { slug } = await cp.addCustom("A map");
		await cp.removeCustom(slug);
		expect(store.custom).toEqual([]);
	});
});

// Onboarding's one "Something else" box opens on the first stored write-in.
describe("onboardingWriteIns (an onboarding re-run)", () => {
	const stored = [{ slug: "custom-1", label: "A locket" }, { slug: "custom-2", label: "A map" }];

	it("rewrites the first write-in and keeps the ones the sheet added after it", () => {
		expect(onboardingWriteIns("A silver locket", stored)).toEqual(["A silver locket", "A map"]);
	});

	it("a cleared box drops only the first", () => {
		expect(onboardingWriteIns("  ", stored)).toEqual(["A map"]);
	});

	it("matches the old one-box result when the sheet added nothing", () => {
		expect(onboardingWriteIns("A locket", [stored[0]])).toEqual(["A locket"]);
		expect(onboardingWriteIns("", [])).toEqual([]);
	});
});

describe("CharacterPossessions — choiceUses", () => {
	it("choiceUses returns empty object when nothing saved", () => {
		const cp = new CharacterPossessions(makeFlags());
		expect(cp.choiceUses).toEqual({});
	});

	it("setChoiceUses stores count under possessionSlug:choiceSlug key", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setChoiceUses("weapons-of-war", "crossbow", 1);
		expect(store.choiceUses).toEqual({ "weapons-of-war:crossbow": 1 });
	});

	it("setChoiceUses merges with existing choiceUses", async () => {
		const store = { choiceUses: { "weapons-of-war:sword": 0 } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setChoiceUses("weapons-of-war", "crossbow", 2);
		expect(store.choiceUses).toEqual({ "weapons-of-war:sword": 0, "weapons-of-war:crossbow": 2 });
	});
});

describe("CharacterPossessions — choiceTexts (sub-option fill-in blanks)", () => {
	it("getChoiceText returns '' when nothing saved", () => {
		const cp = new CharacterPossessions(makeFlags());
		expect(cp.getChoiceText("personal-token", "shield")).toBe("");
	});

	it("setChoiceText stores the written value under possessionSlug:choiceSlug", async () => {
		const store = {};
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setChoiceText("personal-token", "shield", "House Dunmer");
		expect(store.choiceTexts).toEqual({ "personal-token:shield": "House Dunmer" });
		expect(cp.getChoiceText("personal-token", "shield")).toBe("House Dunmer");
	});

	it("setChoiceText merges with existing fills", async () => {
		const store = { choiceTexts: { "personal-token:shield": "House Dunmer" } };
		const cp = new CharacterPossessions(makeFlags(store));
		await cp.setChoiceText("personal-token", "wool-cloak", "your late mother");
		expect(store.choiceTexts).toEqual({
			"personal-token:shield": "House Dunmer",
			"personal-token:wool-cloak": "your late mother",
		});
	});
});
