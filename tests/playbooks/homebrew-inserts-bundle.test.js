import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	BUNDLE_FORMAT, normalizeBundle, bundleToItemData, itemsToBundle, diffBundles, insertMovesOf, playbookOwnMoves, writeInsTurnedToTicks,
} from "../../module/playbooks/homebrew-bundle.js";
import {
	homebrewPlaybookMoves, homebrewInsertMoves, homebrewInsertOf, invalidatePlaybookCatalog,
} from "../../module/playbooks/playbook-catalog.js";
import { FoundryMoveRepository } from "../../module/actors/character/repositories/FoundryMoveRepository.js";
import { staleHeldCopies, tickAnsweredWriteIns } from "../../module/playbooks/homebrew-store.js";
import { sameContent } from "../../module/playbooks/playbook-library.js";

// An original playbook with an INSERT (none of it from a published one): a "Tester's Toolbox" that
// the Tooled Up move opens, with gadgets to tick and tricks of its own to pick from.
function toolboxBundle(over = {}) {
	return {
		format: BUNDLE_FORMAT,
		version: 1,
		playbook: {
			name: "The Tester", hp: 16, damage: "d6",
			inserts: [{
				name: "Tester's Toolbox",
				description: "The tools inside you.",
				unlockedBy: "tooled up",
				form: { enabled: true },
				lists: [
					{ title: "Gadgets", prompt: "pick 2", pick: 2, options: [
						{ description: "Spring Fist: d6+1 (close, forceful)" },
						{ description: "Tin Plate: Armor 1" },
						{ description: "humming", preselected: true },
						{ description: "Something else", freeText: true, preselected: true },
					] },
					{ title: "Tricks", kind: "moves", pick: 1, perUnlock: 1, bonusPicks: [{ move: "extra gear", count: 1 }] },
				],
			}],
			...over.playbook,
		},
		moves: over.moves ?? [
			{ name: "Tooled Up", repeatMax: 3, description: "Fill out the Tester's Toolbox insert." },
			{ name: "Prod", starting: true, description: "Poke it." },
			{ name: "Unfold", insert: "tester-s-toolbox", starting: true, description: "When you unfold, roll +CON." },
			{ name: "Extra Gear", insert: "tester-s-toolbox", insertList: "tricks", description: "Choose 1 additional gadget from the Tester's Toolbox insert." },
			{ name: "Whirr", insert: "tester-s-toolbox", insertList: "tricks", description: "It whirrs." },
		],
	};
}

describe("a bundle's inserts", () => {
	it("an old bundle reads with no inserts, and every move outside one", () => {
		const { bundle } = normalizeBundle({ format: BUNDLE_FORMAT, version: 1, playbook: { name: "Old" }, moves: [{ name: "Prod" }] });
		expect(bundle.playbook.inserts).toEqual([]);
		expect(bundle.moves[0]).toMatchObject({ insert: "", insertList: "" });
	});

	it("mints keys, ties moves to their insert and list, and the unlocking move takes its own spelling", () => {
		const { bundle, issues } = normalizeBundle(toolboxBundle());
		const ins = bundle.playbook.inserts[0];
		expect(ins.key).toBe("tester-s-toolbox");
		expect(ins.unlockedBy).toBe("Tooled Up");
		expect(ins.lists.map(l => [l.key, l.kind, l.pick])).toEqual([["gadgets", "pick", 2], ["tricks", "moves", 1]]);
		expect(ins.lists[1].bonusPicks).toEqual([{ move: "Extra Gear", count: 1 }]);
		// A write-in is never pre-ticked.
		expect(ins.lists[0].options.map(o => o.preselected)).toEqual([false, false, true, false]);
		expect(insertMovesOf(bundle).map(m => m.name)).toEqual(["Unfold", "Extra Gear", "Whirr"]);
		expect(playbookOwnMoves(bundle).map(m => m.name)).toEqual(["Tooled Up", "Prod"]);
		expect(issues).toEqual([]);
	});

	it("a move naming an insert or list it doesn't have is repaired and reported", () => {
		const raw = toolboxBundle();
		raw.moves.push({ name: "Stray", insert: "nowhere" }, { name: "Lost", insert: "tester-s-toolbox", insertList: "gadgets" });
		const { bundle, issues } = normalizeBundle(raw);
		expect(bundle.moves.find(m => m.name === "Stray")).toMatchObject({ insert: "", insertList: "" });
		expect(bundle.moves.find(m => m.name === "Lost")).toMatchObject({ insert: "tester-s-toolbox", insertList: "" });
		expect(issues.map(i => i.message).join("\n")).toMatch(/"Stray" belonged to an insert/);
	});

	it("keeps an empty insert a move is part of, so the move doesn't become the playbook's own", () => {
		const raw = toolboxBundle({ playbook: { name: "The Tester", inserts: [{ key: "insert-1", name: "", lists: [] }, { key: "insert-2", name: "", lists: [] }] } });
		raw.moves.push({ name: "Wait", insert: "insert-1" });
		const { bundle, issues } = normalizeBundle(raw);
		expect(bundle.playbook.inserts.map(i => [i.key, i.name])).toEqual([["insert-1", "Insert"]]);
		expect(bundle.moves.find(m => m.name === "Wait").insert).toBe("insert-1");
		expect(issues.map(i => i.message).join()).toMatch(/had no name/);
	});

	it("flags an unlocking move nobody could reach, never refuses it", () => {
		const unknown = normalizeBundle(toolboxBundle({ playbook: { name: "The Tester", inserts: [{ name: "Box", unlockedBy: "Nope", lists: [{ title: "L", options: [{ description: "a" }] }] }] } }));
		expect(unknown.bundle.playbook.inserts[0].unlockedBy).toBe("Nope");
		expect(unknown.issues.map(i => i.message).join()).toMatch(/isn't one of this playbook's moves/);
		const own = normalizeBundle(toolboxBundle({ playbook: { name: "The Tester", inserts: [{ name: "Tester's Toolbox", unlockedBy: "Whirr", lists: [{ title: "Tricks", kind: "moves" }] }] } }));
		expect(own.issues.map(i => i.message).join()).toMatch(/one of the insert's own moves/);
	});
});

describe("inserts as Items", () => {
	const { bundle } = normalizeBundle(toolboxBundle());
	const data = bundleToItemData(bundle, { slug: "homebrew-the-tester" });

	it("stores pick lists in the lore shape, options slugged by their words", () => {
		const ins = data.playbook.flags.stonetop.inserts[0];
		expect(ins.key).toBe("tester-s-toolbox");
		const gadgets = ins.lists[0];
		expect(gadgets.slug).toBe("tester-s-toolbox-gadgets");
		expect(gadgets.options.map(o => o.slug)).toEqual(["spring-fist-d6-1-close-forceful", "tin-plate-armor-1", "humming", "something-else"]);
		expect(gadgets.options[2]).toMatchObject({ preselected: true, max: 1 });
		// Its write-in is a tick with a blank: "Something else: ___" (writeInsAsBlanks).
		expect(gadgets.options[3]).toMatchObject({ description: "Something else: ___", max: 1 });
		expect(gadgets.options[3]).not.toHaveProperty("type");
	});

	it("flags each insert move with its insert and list", () => {
		const byName = Object.fromEntries(data.moves.map(m => [m.name, m.flags["stonetop-pwd"]]));
		expect(byName.Prod.homebrewInsert).toBeUndefined();
		expect(byName.Unfold.homebrewInsert).toEqual({ key: "tester-s-toolbox", list: "" });
		expect(byName.Whirr.homebrewInsert).toEqual({ key: "tester-s-toolbox", list: "tricks" });
	});

	it("round-trips: Items back to the same bundle", () => {
		const back = normalizeBundle(itemsToBundle(data.playbook, data.moves)).bundle;
		expect(back.playbook.inserts).toEqual(bundle.playbook.inserts);
		const byName = list => Object.fromEntries(list.map(m => [m.name, [m.insert, m.insertList, m.starting]]));
		expect(byName(back.moves)).toEqual(byName(bundle.moves));
	});

	it("the library sees an old playbook re-saved with no inserts as the same playbook", () => {
		const old = { format: BUNDLE_FORMAT, version: 1, playbook: { name: "Old", hp: 16, damage: "d6" }, moves: [{ name: "Prod" }] };
		const resaved = normalizeBundle(old).bundle;
		expect(sameContent(old, resaved)).toBe(true);
	});

	it("says what changed in an insert, and when ticks won't carry over", () => {
		const after = normalizeBundle(toolboxBundle()).bundle;
		after.playbook.inserts[0].lists[0].pick = 3;
		expect(diffBundles(bundle, after).lines).toContain("Changed inserts: Tester's Toolbox");
		const rekeyed = normalizeBundle(toolboxBundle()).bundle;
		rekeyed.playbook.inserts[0].key = "toolbox-2";
		expect(diffBundles(bundle, rekeyed).lines.join()).toMatch(/won't carry over/);
	});
});

describe("insert moves in the world", () => {
	const { bundle } = normalizeBundle(toolboxBundle());
	const data = bundleToItemData(bundle, { slug: "homebrew-the-tester" });
	const playbook = { id: "pb", ...data.playbook };
	const moves = data.moves.map((m, i) => ({ id: `m${i}`, _id: `m${i}`, ...m }));

	beforeEach(() => {
		invalidatePlaybookCatalog();
		const items = [playbook, ...moves];
		items.get = id => items.find(i => i.id === id) ?? null;
		vi.stubGlobal("game", { items, packs: { get: () => null } });
	});
	afterEach(() => { vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

	it("are never the playbook's own moves (Level Up, onboarding, starting moves)", () => {
		expect(homebrewPlaybookMoves("The Tester").map(m => m.name).sort()).toEqual(["Prod", "Tooled Up"]);
		expect(homebrewInsertMoves("The Tester", "tester-s-toolbox").map(m => m.name).sort()).toEqual(["Extra Gear", "Unfold", "Whirr"]);
		expect(homebrewInsertOf(moves.find(m => m.name === "Whirr"))).toEqual({ key: "tester-s-toolbox", list: "tricks" });
		expect(homebrewInsertOf(moves.find(m => m.name === "Prod"))).toBeNull();
	});

	it("the repository offers them only by insert", async () => {
		const repo = new FoundryMoveRepository();
		repo._store = { filterEntries: async () => [], getDocument: async () => null };
		expect((await repo.getPlaybookMoves("The Tester")).map(d => d.name).sort()).toEqual(["Prod", "Tooled Up"]);
		expect(repo.getHomebrewInsertMoves("The Tester", "tester-s-toolbox").map(d => d.name).sort()).toEqual(["Extra Gear", "Unfold", "Whirr"]);
	});

	it("a held copy whose move left the insert is refreshed out of it", () => {
		vi.stubGlobal("foundry", { data: {} });
		const now = { ...moves.find(m => m.name === "Whirr"), flags: { "stonetop-pwd": { homebrewPlaybook: "homebrew-the-tester" } } };
		const copy = { id: "c1", type: "move", name: "Whirr", system: { ...now.system }, flags: { "stonetop-pwd": { homebrewPlaybook: "homebrew-the-tester", homebrewInsert: { key: "tester-s-toolbox", list: "tricks" } } } };
		const actor = { type: "character", name: "Ade", items: [copy] };
		const items = [playbook, now];
		const stale = staleHeldCopies("homebrew-the-tester", { actors: [actor], items });
		expect(stale).toHaveLength(1);
		expect(stale[0].update).toEqual({ "flags.stonetop-pwd.-=homebrewInsert": null });
	});
});

// A playbook saved before write-ins among options to tick became ticks with a blank holds them as
// write-ins, and its next save makes ticks of them: a character's typed answer comes along, ticked.
describe("write-ins a save turns into ticks", () => {
	const { bundle } = normalizeBundle(toolboxBundle({ playbook: { name: "The Tester", inserts: toolboxBundle().playbook.inserts,
		lore: [{ title: "Your past", options: [{ description: "A soldier" }, { description: "Something else", freeText: true }] }, { title: "Words", options: [{ description: "Who?", freeText: true }] }] } }));
	const after = bundleToItemData(bundle, { slug: "homebrew-the-tester" }).playbook.flags.stonetop;
	// As the old save wrote it: the write-ins as write-ins.
	const before = structuredClone(after);
	before.lore[0].options[1] = { slug: before.lore[0].options[1].slug, description: "Something else", type: "text" };
	before.inserts[0].lists[0].options[3] = { slug: "something-else", description: "Something else", type: "text" };

	it("finds each one, with where its answers sat and where they go", () => {
		const turned = writeInsTurnedToTicks(before, after);
		expect(turned.moves).toEqual([
			{ store: "lore", from: "your-past:your-past-2", to: "your-past:your-past-2" },
			{ store: "insertLore", from: "tester-s-toolbox-gadgets:something-else", to: `tester-s-toolbox-gadgets:${after.inserts[0].lists[0].options[3].slug}` },
		]);
		expect(turned.labels).toEqual(["Something else: ___", "Something else: ___"]);
		// A list of nothing but write-ins stays questions to answer; a save that changes nothing finds nothing.
		expect(writeInsTurnedToTicks(after, after).moves).toEqual([]);
	});

	it("ticks a write-in a character had answered, carrying the words to the tick's blank", async () => {
		const flags = { lore: { texts: { "your-past:your-past-2": "A smuggler" } }, insertLore: { texts: { "tester-s-toolbox-gadgets:something-else": "A lens" }, counts: {} } };
		const actor = {
			type: "character", system: { playbook: { slug: "homebrew-the-tester" } }, flags: { stonetop: flags },
			getFlag: (_scope, path) => path.split(".").reduce((o, k) => o?.[k], flags),
			update: vi.fn(async () => {}),
		};
		const other = { ...actor, system: { playbook: { slug: "homebrew-other" } }, update: vi.fn() };
		await tickAnsweredWriteIns("homebrew-the-tester", writeInsTurnedToTicks(before, after).moves, [actor, other]);
		expect(other.update).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalledTimes(1);
		const update = actor.update.mock.calls[0][0];
		// "Something else: ___" slugs as "something-else" too, so the words are already under the tick's key.
		expect(after.inserts[0].lists[0].options[3].slug).toBe("something-else");
		expect(update).toEqual({
			"flags.stonetop-pwd.lore.counts.your-past:your-past-2": 1,
			"flags.stonetop-pwd.insertLore.counts.tester-s-toolbox-gadgets:something-else": 1,
		});
	});

	it("carries the words across when the tick's key is a new one, and leaves a ticked or blank one be", async () => {
		const moves = [{ store: "insertLore", from: "box-l:old", to: "box-l:new" }, { store: "lore", from: "q:a", to: "q:a" }, { store: "lore", from: "q:b", to: "q:b" }];
		const flags = { insertLore: { texts: { "box-l:old": "A lens" } }, lore: { texts: { "q:a": "Words", "q:b": "  " }, counts: { "q:a": 1 } } };
		const actor = {
			type: "character", system: { playbook: { slug: "homebrew-x" } }, flags: { stonetop: flags },
			getFlag: (_scope, path) => path.split(".").reduce((o, k) => o?.[k], flags),
			update: vi.fn(async () => {}),
		};
		await tickAnsweredWriteIns("homebrew-x", moves, [actor]);
		expect(actor.update.mock.calls[0][0]).toEqual({
			"flags.stonetop-pwd.insertLore.counts.box-l:new": 1,
			"flags.stonetop-pwd.insertLore.texts.box-l:new": "A lens",
		});
	});
});
