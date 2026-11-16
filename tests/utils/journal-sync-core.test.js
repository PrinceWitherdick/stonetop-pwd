import { describe, expect, it } from "vitest";
import { makeRewriter, remapPageData, managedHash, hashString, stableStringify, carryOverPageState, planSourceRestamp } from "../../module/hooks/journal-sync-core.js";

// The managed-journal update channel decides "did the GM edit this?" by comparing a
// content fingerprint to the baseline we stamped. These tests pin the two properties
// that make that safe: the fingerprint ignores cosmetic churn (page ids, key order)
// but reacts to any authored-content change, in all three section kinds.

const linkMap = new Map([["Compendium.stonetop-pwd.stonetop-journal.JournalEntry.abc", "JournalEntry.world123"]]);

describe("makeRewriter / remapPageData", () => {
	it("repoints a seeded compendium @UUID at its world copy, leaves unknown links alone", () => {
		const rewrite = makeRewriter(linkMap);
		expect(rewrite("see @UUID[Compendium.stonetop-pwd.stonetop-journal.JournalEntry.abc]{X}"))
			.toBe("see @UUID[JournalEntry.world123]{X}");
		expect(rewrite("see @UUID[Compendium.stonetop-pwd.arcana.Item.zzz]{Y}"))
			.toBe("see @UUID[Compendium.stonetop-pwd.arcana.Item.zzz]{Y}"); // not seeded → untouched
	});

	it("remaps links across a location page's prose, Q&A, and grouped Dangers", () => {
		const rewrite = makeRewriter(linkMap);
		const link = "@UUID[Compendium.stonetop-pwd.stonetop-journal.JournalEntry.abc]";
		const page = remapPageData({
			type: "location",
			system: { sections: [
				{ kind: "prose", body: `p ${link}` },
				{ kind: "qa", pairs: [{ prompt: `q ${link}`, answer: `a ${link}` }] },
				{ kind: "groups", groups: [{ heading: `h ${link}`, body: `b ${link}` }] },
			] },
		}, rewrite);
		const [prose, qa, groups] = page.system.sections;
		expect(prose.body).toBe("p @UUID[JournalEntry.world123]");
		expect(qa.pairs[0]).toEqual({ prompt: "q @UUID[JournalEntry.world123]", answer: "a @UUID[JournalEntry.world123]" });
		expect(groups.groups[0]).toEqual({ heading: "h @UUID[JournalEntry.world123]", body: "b @UUID[JournalEntry.world123]" });
	});
});

describe("hashString", () => {
	// Stored fingerprints (journals, chronicle prose, superseded pack values) are compared with these,
	// so a digest must never change.
	it("keeps every digest it has ever printed", () => {
		expect(hashString("abc")).toBe("7a91f9f91ac18c8d");
		expect(hashString("")).toBe("488bdcb81aee8d83");
		expect(hashString("Stonetop ’ 😀")).toBe("de5629ac72a5abe8");
	});
});

describe("managedHash", () => {
	const base = { pages: [
		{ _id: "p1", name: "Overview", type: "text", sort: 100, text: { content: "<p>Hello</p>" } },
		{ _id: "p2", name: "Region", type: "location", sort: 200, system: { sections: [{ kind: "qa", pairs: [{ prompt: "Why?", answer: "" }] }] } },
	] };

	it("ignores page ids, sort, and key order — same content, same fingerprint", () => {
		const reordered = { pages: [
			{ sort: 999, type: "text", name: "Overview", _id: "DIFFERENT", text: { content: "<p>Hello</p>" } },
			{ name: "Region", _id: "ALSO-DIFF", type: "location", sort: 1, system: { sections: [{ pairs: [{ answer: "", prompt: "Why?" }], kind: "qa" }] } },
		] };
		expect(managedHash(reordered)).toBe(managedHash(base));
	});

	it("changes when the GM fills in a Q&A answer", () => {
		const edited = structuredClone(base);
		edited.pages[1].system.sections[0].pairs[0].answer = "Because.";
		expect(managedHash(edited)).not.toBe(managedHash(base));
	});

	it("changes when prose body text changes", () => {
		const edited = structuredClone(base);
		edited.pages[0].text.content = "<p>Hello, world</p>";
		expect(managedHash(edited)).not.toBe(managedHash(base));
	});

	it("changes when a page is added or removed", () => {
		const fewer = { pages: [base.pages[0]] };
		expect(managedHash(fewer)).not.toBe(managedHash(base));
	});
});

describe("carryOverPageState", () => {
	// A reader has ticked checkboxes on two pages; only flags.stonetop.checks holds
	// that state, and managedHash ignores flags — so a content refresh must carry it.
	const oldPages = [
		{ name: "Requirements", type: "text", flags: { stonetop: { checks: { a: true, c: true } } } },
		{ name: "Overview", type: "text", flags: {} },
	];

	it("carries checkbox ticks onto the matching new page, by name", () => {
		const newPages = [
			{ name: "Requirements", type: "text", text: { content: "<p>new</p>" } },
			{ name: "Overview", type: "text", text: { content: "<p>new</p>" } },
		];
		const [req, overview] = carryOverPageState(newPages, oldPages);
		expect(req.flags.stonetop.checks).toEqual({ a: true, c: true });
		expect(overview.flags?.stonetop?.checks).toBeUndefined();
	});

	it("preserves the shipped page's own baked flags, only adding checks", () => {
		const newPages = [{ name: "Requirements", type: "text", flags: { stonetop: { summary: "S" }, core: { x: 1 } } }];
		const [req] = carryOverPageState(newPages, oldPages);
		expect(req.flags).toEqual({ stonetop: { summary: "S", checks: { a: true, c: true } }, core: { x: 1 } });
	});

	it("does not mutate the inputs", () => {
		const newPages = [{ name: "Requirements", type: "text" }];
		carryOverPageState(newPages, oldPages);
		expect(newPages[0].flags).toBeUndefined();
	});

	it("returns pages unchanged when there is no stored state", () => {
		const newPages = [{ name: "Requirements", type: "text" }];
		expect(carryOverPageState(newPages, [{ name: "Requirements", flags: {} }])).toBe(newPages);
		expect(carryOverPageState(newPages, [])).toBe(newPages);
	});

	it("leaves a renamed/removed page's ticks behind (no match) without erroring", () => {
		const newPages = [{ name: "Renamed", type: "text" }];
		const [page] = carryOverPageState(newPages, oldPages);
		expect(page.flags?.stonetop?.checks).toBeUndefined();
	});

	it("a carried-over page still hashes equal to the shipped content (flags ignored)", () => {
		const shipped = { pages: [{ name: "Requirements", type: "text", text: { content: "<p>v2</p>" } }] };
		const carried = { pages: carryOverPageState(shipped.pages, oldPages) };
		expect(managedHash(carried)).toBe(managedHash(shipped));
	});
});

describe("stableStringify", () => {
	it("is key-order independent and null-safe", () => {
		expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
		expect(stableStringify(undefined)).toBe("null");
	});
});

describe("planSourceRestamp", () => {
	const COLL = "stonetop-pwd.stonetop-journal";
	const index = [
		{ _id: "aaa111", name: "North Manmarch" },
		{ _id: "bbb222", name: "South Manmarch" },
	];
	const uuid = id => `Compendium.${COLL}.JournalEntry.${id}`;

	it("stamps an un-stamped copy of our content, matched by preserved id", () => {
		// The failure mode: the pack's documents dropped into the world keep their id and
		// baked flags.stonetop, but never got Foundry's import stamp.
		const journals = [{ _id: "aaa111", name: "North Manmarch", flags: { stonetop: { summary: "…" } }, _stats: { compendiumSource: null } }];
		expect(planSourceRestamp(journals, index, COLL))
			.toEqual([{ _id: "aaa111", "_stats.compendiumSource": uuid("aaa111") }]);
	});

	it("falls back to a unique-name match when the id was not preserved", () => {
		const journals = [{ id: "worldFreshId", name: "South Manmarch", flags: { stonetop: {} } }];
		expect(planSourceRestamp(journals, index, COLL))
			.toEqual([{ _id: "worldFreshId", "_stats.compendiumSource": uuid("bbb222") }]);
	});

	it("skips entries that already carry a source stamp", () => {
		const journals = [
			{ _id: "aaa111", name: "North Manmarch", flags: { stonetop: {} }, _stats: { compendiumSource: uuid("aaa111") } },
			{ _id: "bbb222", name: "South Manmarch", flags: { core: { sourceId: uuid("bbb222") }, stonetop: {} } }, // legacy stamp
		];
		expect(planSourceRestamp(journals, index, COLL)).toEqual([]);
	});

	it("ignores journals that aren't ours (no baked flags.stonetop)", () => {
		const journals = [{ _id: "aaa111", name: "North Manmarch", flags: { core: {} } }];
		expect(planSourceRestamp(journals, index, COLL)).toEqual([]);
	});

	it("ignores our content that has no match in the pack (dropped from a later version)", () => {
		const journals = [{ _id: "zzz999", name: "A Retired Region", flags: { stonetop: { summary: "…" } } }];
		expect(planSourceRestamp(journals, index, COLL)).toEqual([]);
	});

	it("never restamps a duplicate-named entry by name (the pack has two 'Fomoraij')", () => {
		// The merged pack really carries two entries named "Fomoraij" (bestiary codex + lore
		// faction); a name match can't tell them apart, so a copy whose id was NOT preserved
		// must be left unstamped rather than pointed at the wrong tree.
		const dupIndex = [
			{ _id: "besFom", name: "Fomoraij" }, // bestiary-journal tree
			{ _id: "loreFom", name: "Fomoraij" }, // lore tree
		];
		const journals = [{ id: "worldFreshId", name: "Fomoraij", flags: { stonetop: {} } }];
		expect(planSourceRestamp(journals, dupIndex, COLL)).toEqual([]);
	});

	it("still restamps a duplicate-named entry when its id was preserved (id beats name)", () => {
		const dupIndex = [
			{ _id: "besFom", name: "Fomoraij" },
			{ _id: "loreFom", name: "Fomoraij" },
		];
		const journals = [{ _id: "loreFom", name: "Fomoraij", flags: { stonetop: {} } }];
		expect(planSourceRestamp(journals, dupIndex, COLL))
			.toEqual([{ _id: "loreFom", "_stats.compendiumSource": uuid("loreFom") }]);
	});
});
