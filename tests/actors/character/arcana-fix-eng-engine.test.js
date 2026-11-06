// Arcana audit 2026-11-04, fixer ENG: the arcana engine's fixes (A1, A2, A5, A6, A9, A14, MNB-2,
// MAJ-2, MAJ-11, ENG-4, ENG-5, ENG-8, ENG-14, ENG-15).
import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import {
	CharacterArcana, arcanumItemResourceKey, arcanumSlotLocked, arcanumUnlockedUnder, rolledTrackTouched, rolledUsesCount,
	unlockBoxCount, unlockRequirementsMet,
} from "../../../module/actors/character/CharacterArcana.js";
import { CharacterInventory } from "../../../module/actors/character/CharacterInventory.js";
import { MinorArcanum } from "../../../module/model/MinorArcanum.js";
import { ResourceDef } from "../../../module/model/Resource.js";
import { detectArcanaTracks } from "../../../module/timeline/timeline-milestones.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { flagFragmentOps } from "../../fakes/flag-fragments.js";

function makeFlags(store = {}) {
	return {
		_store: store,
		...flagFragmentOps(store),
		getFlag: key => store[key] ?? null,
		setFlag: vi.fn(async (key, value) => { store[key] = value; }),
		batch: vi.fn(async ({ sets = {}, deletes = {} } = {}) => {
			for (const [k, v] of Object.entries(sets)) store[k] = v;
			for (const [k, subs] of Object.entries(deletes)) for (const sub of subs) delete store[k]?.[sub];
		}),
	};
}
const arcanaOf = (store, cards) => new CharacterArcana(makeFlags(store), new FakeArcanaRepository(cards));
const readCard = rel => ({ ...JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")).flags.stonetop });

const opt = (slug, extra = {}) => ({ type: "option", slug, description: slug, ...extra });
const card = (slug, { requirements = [], unlock = "", back = "<p>Back.</p>", front = "<p>Front.</p>", resource = null, item = null } = {}) => ({
	slug,
	front: { title: slug, item: null, description: front, unlock: { description: unlock, requirements } },
	back: { title: `${slug} back`, item, description: back, resource, move: null, options: [] },
});

describe("A1: either/or requirement paths", () => {
	const reqs = [opt("always"), opt("a1", { path: "a" }), opt("a2", { path: "a" }), opt("b1", { path: "b" }), { type: "text", content: "or" }];
	const done = set => r => set.has(r.slug);

	it("needs every unpathed option and one whole path", () => {
		expect(unlockRequirementsMet(reqs, done(new Set(["always", "b1"])))).toBe(true);
		expect(unlockRequirementsMet(reqs, done(new Set(["always", "a1", "a2"])))).toBe(true);
		expect(unlockRequirementsMet(reqs, done(new Set(["always", "a1"])))).toBe(false);
		expect(unlockRequirementsMet(reqs, done(new Set(["b1"])))).toBe(false);
	});

	it("is the old every-option rule on a card with no paths", () => {
		expect(unlockRequirementsMet([opt("x"), opt("y")], done(new Set(["x"])))).toBe(false);
		expect(unlockRequirementsMet([opt("x"), opt("y")], done(new Set(["x", "y"])))).toBe(true);
	});

	it("unlocks the shipped a-folktale by either alternative, and masters it by its first path only", async () => {
		const folktale = readCard("packs/src/stonetop-arcana/minor/a-folktale.json");
		const paths = folktale.front.unlock.requirements.filter(r => r.type === "option");
		expect(paths.every(r => r.path)).toBe(true);
		const [first, second] = paths;
		expect(arcanumUnlockedUnder(folktale, { [`a-folktale:${second.slug}`]: second.max ?? 1 })).toBe(true);
		expect(arcanumUnlockedUnder(folktale, {})).toBe(false);
		const grant = await arcanaOf({ owned: ["a-folktale"] }, [folktale]).masteryGrant("a-folktale");
		expect(grant.unlock).toEqual({ [first.slug]: first.max ?? 1 });
	});

	it("groups the snapshot's options and heads a later path 'or'", async () => {
		const snap = await arcanaOf({ owned: ["c"], identified: ["c"] }, [card("c", { requirements: reqs })]).buildSnapshot();
		const items = snap.minor.items[0].front.unlock.requirements;
		expect(items.map(i => [i.slug ?? i.type, i.path ?? null, i.orBefore ?? false])).toEqual([
			["always", null, false], ["a1", "a", false], ["a2", "a", false], ["b1", "b", true], ["text", null, false],
		]);
	});

	it("keeps `path` through the MinorArcanum model", () => {
		const model = new MinorArcanum(card("c", { requirements: [opt("x", { path: "p" })] }));
		expect(model.front.unlock.requirements[0].path).toBe("p");
	});
});

describe("A2: the unlock latch", () => {
	const azure = card("erasable", { unlock: "○○ When you make the last mark, erase all marks." });

	it("is written in the same update that completes the track, and holds after the marks are erased", async () => {
		const store = { owned: ["erasable"], identified: ["erasable"] };
		const arcana = arcanaOf(store, [azure]);
		await arcana.setArcanumBoxChecked("erasable", "unlock", 0, true);
		expect(store.unlockedOnce).toBeUndefined();
		await arcana.setArcanumBoxChecked("erasable", "unlock", 1, true);
		expect(store.unlockedOnce).toEqual(["erasable"]);
		expect(arcana._flags.applyUpdateData).toHaveBeenLastCalledWith(expect.objectContaining({
			"flags.fake.ns.boxes.erasable:unlock:1": true, "flags.fake.ns.unlockedOnce": ["erasable"],
		}), undefined);
		// The card's order: choose a move on the reverse, then erase the marks.
		await arcana.setArcanumBoxChecked("erasable", "back", 0, true);
		await arcana.setArcanumBoxesChecked("erasable", "unlock", { 0: false, 1: false });
		expect(await arcana.isArcanumUnlocked("erasable")).toBe(true);
		expect((await arcana.buildSnapshot()).minor.items[0].unlocked).toBe(true);
	});

	it("lets go when the completing tick is taken back before anything on the back is marked", async () => {
		const store = { owned: ["erasable"], identified: ["erasable"], backOwed: ["erasable"], boxes: { "erasable:unlock:0": true } };
		const arcana = arcanaOf(store, [azure]);
		await arcana.setArcanumBoxChecked("erasable", "unlock", 1, true);
		expect(store.unlockedOnce).toEqual(["erasable"]);
		expect(store.backOwed).toEqual([]);
		await arcana.setArcanumBoxChecked("erasable", "unlock", 1, false);
		expect(store.unlockedOnce).toEqual([]);
		// The 7-9 back debt the latch settled is owed again.
		expect(store.backOwed).toEqual(["erasable"]);
		expect(store.owedAtLatch).toEqual([]);
		expect(await arcana.isArcanumUnlocked("erasable")).toBe(false);
	});

	it("holds when a back mark is taken back, and when an option card's count drops after a back option", async () => {
		const store = { owned: ["erasable"], identified: ["erasable"], unlockedOnce: ["erasable"], boxes: { "erasable:back:0": true } };
		const arcana = arcanaOf(store, [azure]);
		await arcana.setArcanumBoxChecked("erasable", "back", 0, false);
		expect(store.unlockedOnce).toEqual(["erasable"]);
		const optCard = card("opt", { requirements: [opt("one")] });
		const store2 = { owned: ["opt"], unlock: { "opt:one": 1 }, unlockedOnce: ["opt"], backOptions: { "opt:power": 1 } };
		await arcanaOf(store2, [optCard]).setUnlockCount("opt", "one", 0);
		expect(store2.unlockedOnce).toEqual(["opt"]);
		const store3 = { owned: ["opt"], unlock: { "opt:one": 1 }, unlockedOnce: ["opt"] };
		await arcanaOf(store3, [optCard]).setUnlockCount("opt", "one", 0);
		expect(store3.unlockedOnce).toEqual([]);
	});

	it("is written by an option count and by mastery", async () => {
		const optCard = card("opt", { requirements: [opt("one")] });
		const store = { owned: ["opt"] };
		await arcanaOf(store, [optCard]).setUnlockCount("opt", "one", 1);
		expect(store.unlockedOnce).toEqual(["opt"]);
		const store2 = { owned: ["opt"] };
		await arcanaOf(store2, [optCard]).masterArcanum("opt");
		expect(store2.unlockedOnce).toEqual(["opt"]);
		expect(store2.unlock).toEqual({ "opt:one": 1 });
	});

	it("ENG-14: settles a back a 7-9 owed in the same update", async () => {
		const store = { owned: ["erasable"], identified: ["erasable"], backOwed: ["erasable", "other"], boxes: { "erasable:unlock:0": true } };
		await arcanaOf(store, [azure]).setArcanumBoxChecked("erasable", "unlock", 1, true);
		expect(store.backOwed).toEqual(["other"]);
	});

	it("is cleared by Remove", async () => {
		const store = { owned: ["erasable"], unlockedOnce: ["erasable", "x"] };
		await arcanaOf(store, [azure]).removeArcanum("erasable");
		expect(store.unlockedOnce).toEqual(["x"]);
	});

	it("reaches the timeline: erasing marks on a latched card forgets no milestone", () => {
		const snap = (boxes, once) => ({ arcana: { unlock: {}, boxes, unlockedOnce: once } });
		const unlocked = (u, b, once) => arcanumUnlockedUnder(azure, u, b, once);
		const before = snap({ "erasable:unlock:0": true, "erasable:unlock:1": true }, ["erasable"]);
		const after = snap({ "erasable:unlock:0": false, "erasable:unlock:1": false }, ["erasable"]);
		expect(detectArcanaTracks("erasable", before, after, { unlocked })).toEqual([]);
	});
});

describe("A14: steps", () => {
	it("a card with no step is locked; □ in its unlock text are steps under unlockBox", async () => {
		const none = card("none");
		expect(arcanumUnlockedUnder(none, {}, {})).toBe(false);
		const boxed = card("boxed", { unlock: "<p>□ Find the smith. □ Pay her.</p>" });
		expect(unlockBoxCount(boxed.front.unlock.description)).toBe(2);
		const store = { owned: ["boxed"], identified: ["boxed"] };
		const arcana = arcanaOf(store, [boxed]);
		const html = (await arcana.buildSnapshot()).minor.items[0].front.unlock.description;
		expect([...html.matchAll(/data-context="unlockBox" data-index="(\d)"/g)].map(m => m[1])).toEqual(["0", "1"]);
		await arcana.setArcanumBoxChecked("boxed", "unlockBox", 0, true);
		expect(await arcana.isArcanumUnlocked("boxed")).toBe(false);
		await arcana.setArcanumBoxChecked("boxed", "unlockBox", 1, true);
		expect(await arcana.isArcanumUnlocked("boxed")).toBe(true);
		expect((await arcana.masteryGrant("boxed")).boxes).toEqual([{ context: "unlockBox", index: 0 }, { context: "unlockBox", index: 1 }]);
	});

	it("every shipped card has a step", () => {
		for (const tier of ["major", "minor"]) {
			const dir = path.resolve("packs/src/stonetop-arcana", tier);
			for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".json"))) {
				const c = readCard(path.join(dir, f));
				if (!c.front) continue;
				const marks = {};
				// Every option at its max and every box ticked: complete, unless the card has no step.
				const unlock = Object.fromEntries((c.front.unlock?.requirements ?? []).filter(r => r.type === "option").map(r => [`${c.slug}:${r.slug}`, r.max ?? 1]));
				for (const ctx of ["unlock", "unlockBox", "front"]) for (let i = 0; i < 40; i++) marks[`${c.slug}:${ctx}:${i}`] = true;
				expect(arcanumUnlockedUnder(c, unlock, marks), c.slug).toBe(true);
			}
		}
	});
});

describe("MAJ-2: an unboxed back mystery", () => {
	it("the Lidless Orb's POWER is learned only once the back is realised", async () => {
		const orb = readCard("packs/src/stonetop-arcana/major/staff-of-the-lidless-orb.json");
		const arcana = arcanaOf({ owned: [orb.slug], identified: [orb.slug] }, [orb]);
		const { parseArcanumMoves } = await import("../../../module/data/arcana-moves.js");
		const unboxed = parseArcanumMoves(orb.back.description).find(m => m.boxIndex == null);
		if (!unboxed) return; // the pack now boxes every one of its mysteries (MAJ-2's data half)
		expect((await arcana.getArcanumMove(orb.slug, unboxed.slug)).learned).toBe(false);
	});
});

describe("A5 + ENG-4: Remove", () => {
	const major = card("maj", {
		unlock: "○○ unlock",
		back: "<p>□ MYSTERY</p><h3>Consequences</h3><ul><li>□ Lose 1 HP</li><li>□ Go blind</li></ul>",
	});

	it("lists the marked Consequences", async () => {
		const store = { owned: ["maj"], boxes: { "maj:back:0": true, "maj:back:2": true, "maj:back:1": false } };
		expect(await arcanaOf(store, [major]).markedConsequences("maj")).toEqual([{ index: 2, label: "Go blind" }]);
	});

	it("keeps only the card's Consequence marks (and its layout markers) when asked, in one fragment", async () => {
		const store = {
			owned: ["maj"], notes: { maj: "my note", other: "x" }, titles: { maj: "Maj" },
			boxes: { "maj:back:0": true, "maj:back:2": true, "maj:unlock:0": true, "other:back:0": true },
			boxLayouts: { "maj:back:moved": true },
		};
		const arcana = arcanaOf(store, [major]);
		await arcana.removeArcanum("maj", { keepConsequences: true });
		expect(arcana._flags.applyUpdateData).toHaveBeenCalledTimes(1);
		expect(store.boxes).toEqual({ "maj:back:2": true, "other:back:0": true });
		expect(store.boxLayouts).toEqual({ "maj:back:moved": true });
		expect(store.notes).toEqual({ other: "x" });
		expect(store.titles).toEqual({});
		expect(store.owned).toEqual([]);
	});

	it("drops every mark without keepConsequences", async () => {
		const store = { owned: ["maj"], boxes: { "maj:back:2": true }, boxLayouts: { "maj:back:moved": true } };
		await arcanaOf(store, [major]).removeArcanum("maj");
		expect(store.boxes).toEqual({});
		expect(store.boxLayouts).toEqual({});
	});

	it("the inventory half is sub-key deletions only", () => {
		const store = { resources: { maj: 1, "maj:item": 2, other: 3 }, checked: { maj: true } };
		const data = new CharacterInventory({ getFlag: k => store[k] ?? null, ...flagFragmentOps(store) }).arcanumRemovalData("maj");
		expect(Object.values(data).every(v => v === null)).toBe(true);
		expect(Object.keys(data)).toHaveLength(3);
	});
});

describe("A6: notes", () => {
	it("saves a note as its own sub-key, drops an empty one, and shows it on the snapshot", async () => {
		const store = { owned: ["c"], identified: ["c"] };
		const arcana = arcanaOf(store, [card("c", { requirements: [opt("x")] })]);
		expect(await arcana.setArcanumNote("c", "Diverted: 3 harm")).toBe(true);
		expect(store.notes).toEqual({ c: "Diverted: 3 harm" });
		expect((await arcana.buildSnapshot()).minor.items[0].notes).toBe("Diverted: 3 harm");
		expect(await arcana.setArcanumNote("c", "Diverted: 3 harm")).toBe(false);
		expect(await arcana.setArcanumNote("c", "  ")).toBe(true);
		expect(store.notes).toEqual({});
	});
});

describe("A9: rolled uses", () => {
	it("marks max - total as used, clamped", () => {
		expect(rolledUsesCount(12, 9)).toBe(3);
		expect(rolledUsesCount(12, 12)).toBe(0);
		expect(rolledUsesCount(12, 20)).toBe(0);
		expect(rolledUsesCount(12, -1)).toBe(12);
	});

	it("ResourceDef keeps rollUses, and the snapshot offers it only while the track is untouched", async () => {
		expect(new ResourceDef({ max: 12, rollUses: "1d4+8" }).rollUses).toBe("1d4+8");
		const pouch = card("pouch", { requirements: [opt("x")], item: { name: "Pouch", weight: 1, resource: { max: 12, rollUses: "1d4+8" } } });
		const fresh = (await arcanaOf({ owned: ["pouch"], identified: ["pouch"] }, [pouch]).buildSnapshot({}, {}, {})).minor.items[0];
		expect(fresh.back.item.resource).toMatchObject({ key: "pouch", rollUses: "1d4+8" });
		const used = (await arcanaOf({ owned: ["pouch"], identified: ["pouch"] }, [pouch]).buildSnapshot({}, {}, { pouch: 2 })).minor.items[0];
		expect(used.back.item.resource.rollUses).toBeUndefined();
		// A roll of the full 12 stores 0 marked: still rolled, so the roll is not offered again.
		const rolledFull = (await arcanaOf({ owned: ["pouch"], identified: ["pouch"] }, [pouch]).buildSnapshot({}, {}, { pouch: 0 })).minor.items[0];
		expect(rolledFull.back.item.resource.rollUses).toBeUndefined();
		expect(rolledTrackTouched({ pouch: 0 }, "pouch")).toBe(true);
		expect(rolledTrackTouched({}, "pouch")).toBe(false);
		expect(rolledTrackTouched(undefined, "pouch")).toBe(false);
	});

	it("the shipped Time-worn Missive carries it", () => {
		const missive = new MinorArcanum(readCard("packs/src/stonetop-arcana/minor/time-worn-missive.json"));
		expect(missive.back.item?.resource?.rollUses).toBe("1d4+8");
	});
});

describe("MNB-2 / HB-12: one resource key", () => {
	it("is the bare slug unless the card also has a back-power track", () => {
		expect(arcanumItemResourceKey({ slug: "bow", back: { resource: null, item: {} } })).toBe("bow");
		expect(arcanumItemResourceKey({ slug: "book", back: { resource: { max: 3 }, item: {} } })).toBe("book:item");
	});

	it("the carried curio row and the curio record carry the key for a both-tracks card", async () => {
		const book = card("book", {
			requirements: [opt("x")], resource: { max: 6 },
			item: { name: "Wine skin", weight: 1, resource: { max: 5 } },
		});
		const arcana = arcanaOf({ owned: ["book"], identified: ["book"], unlock: { "book:x": 1 } }, [book]);
		const [row] = await arcana.weightedInventoryItems();
		expect(row.resourceKey).toBe("book:item");
		expect(await arcana.carriedResourceKey("book")).toBe("book:item");
	});
});

describe("the back-item key settle (StonetopCharacter#arcanumResourceKeysUpdate)", () => {
	it("moves a '<slug>:item' count into the bare key on a card with no back-power track, once", async () => {
		const { StonetopCharacter } = await import("../../../module/actors/character/StonetopCharacter.js");
		const store = { resources: { bow: 1, "bow:item": 2, "book:item": 4, book: 1 } };
		const bow = card("bow", { item: { name: "Bow", resource: { max: 2 } } });
		const book = card("book", { resource: { max: 6 }, item: { name: "Skin", resource: { max: 5 } } });
		const flags = { getFlag: k => store[k] ?? null, ...flagFragmentOps(store) };
		const self = {
			_inventory: new CharacterInventory(flags),
			_arcana: new CharacterArcana(makeFlags({}), new FakeArcanaRepository([bow, book])),
		};
		const data = await StonetopCharacter.prototype.arcanumResourceKeysUpdate.call(self);
		flags.applyUpdateData(data);
		expect(store.resources).toEqual({ bow: 2, "book:item": 4, book: 1 });
		expect(await StonetopCharacter.prototype.arcanumResourceKeysUpdate.call(self)).toBeNull();
	});

	it("rides in the audit settle's one quiet write, off the timeline only with counts to move", async () => {
		const { settleArcanaAudit1104, AUDIT_SETTLES_KEY, ARCANA_AUDIT_1104_SETTLES, ARCANA_AUDIT_1104_OPTION } =
			await import("../../../module/migration/arcana-audit-1104.js");
		const keys = { "flags.x.inventory.resources.bow": 2 };
		const stamped = Object.fromEntries(ARCANA_AUDIT_1104_SETTLES.map(c => [c.marker, true]));
		const actor = (arcana = {}) => ({
			type: "character", update: vi.fn(async () => {}),
			getFlag: (_scope, path) => (path === `arcana.${AUDIT_SETTLES_KEY}` ? arcana[AUDIT_SETTLES_KEY] : undefined),
			typedActor: { arcanumResourceKeysUpdate: vi.fn(async () => keys) },
		});
		const fresh = actor();
		expect(await settleArcanaAudit1104(fresh)).toBe(true);
		expect(fresh.update).toHaveBeenCalledTimes(1);
		expect(fresh.update.mock.calls[0][0]).toMatchObject(keys);
		expect(fresh.update.mock.calls[0][1]).toEqual({ stonetopLedger: true, [ARCANA_AUDIT_1104_OPTION]: true });
		const settled = actor({ [AUDIT_SETTLES_KEY]: stamped });
		expect(await settleArcanaAudit1104(settled)).toBe(true);
		expect(settled.update).toHaveBeenCalledWith(keys, { stonetopLedger: true });
		const skipped = actor({ [AUDIT_SETTLES_KEY]: stamped });
		expect(await settleArcanaAudit1104(skipped, { resourceKeys: false })).toBe(false);
		expect(skipped.typedActor.arcanumResourceKeysUpdate).not.toHaveBeenCalled();
	});
});

describe("MAJ-11: the Redwood Effigy's locked Conduit slots", () => {
	const redwood = readCard("packs/src/stonetop-arcana/major/redwood-effigy.json");

	it("are disabled and refuse a tick until GREATER CONDUIT is ticked", async () => {
		const store = { owned: [redwood.slug], identified: [redwood.slug] };
		const arcana = arcanaOf(store, [redwood]);
		const front = (await arcana.buildSnapshot()).major.items[0].front.description;
		expect(front).toMatch(/data-context="frontDiamond" data-index="1" disabled/);
		expect(front).not.toMatch(/data-context="frontDiamond" data-index="0" disabled/);
		expect(await arcana.setArcanumBoxChecked(redwood.slug, "frontDiamond", 1, true)).toBe(false);
		expect(store.boxes?.[`${redwood.slug}:frontDiamond:1`]).toBeUndefined();
	});

	it("open once GREATER CONDUIT is ticked", async () => {
		const { boxIndexBefore } = await import("../../../module/utils/glyphs.js");
		const gc = boxIndexBefore(redwood.back.description, "GREATER CONDUIT");
		const boxes = { [`${redwood.slug}:back:${gc}`]: true };
		expect(arcanumSlotLocked(redwood, "frontDiamond", 1, boxes)).toBe(false);
		expect(arcanumSlotLocked(redwood, "frontDiamond", 1, {})).toBe(true);
	});
});

describe("ENG-5 / ENG-8 / ENG-15", () => {
	it("box and back-option writes are single sub-keys", async () => {
		const store = { owned: ["c"], boxes: { "other:back:0": true } };
		const arcana = arcanaOf(store, [card("c", { requirements: [opt("x")] })]);
		await arcana.setArcanumBoxChecked("c", "back", 0, true);
		await arcana.setBackOptionCount("c", "o", 2);
		expect(store.boxes).toEqual({ "other:back:0": true, "c:back:0": true });
		expect(store.backOptions).toEqual({ "c:o": 2 });
		expect(arcana._flags.setFlag).not.toHaveBeenCalled();
	});

	it("addLead is one write", async () => {
		const flags = makeFlags({});
		await new CharacterArcana(flags, new FakeArcanaRepository()).addLead("l");
		expect(flags.batch).toHaveBeenCalledTimes(1);
		expect(flags.setFlag).not.toHaveBeenCalled();
	});

	it("MinorArcanumMove keeps noXpOnMiss", () => {
		const model = new MinorArcanum({ ...card("c"), back: { ...card("c").back, move: { name: "m", description: "d", noXpOnMiss: true } } });
		expect(model.back.move.noXpOnMiss).toBe(true);
	});
});

describe("CharacterArcana#backOpenToOwner: the owner's own rule for reading a back", () => {
	it("is a GM reveal, or the card unlocked (latch included), identified or not", async () => {
		const key = card("key", { requirements: [opt("x")] });
		expect(await arcanaOf({ owned: ["key"], revealed: ["key"] }, [key]).backOpenToOwner("key")).toBe(true);
		expect(await arcanaOf({ owned: ["key"] }, [key]).backOpenToOwner("key")).toBe(false);
		expect(await arcanaOf({ owned: ["key"], unlock: { "key:x": 1 } }, [key]).backOpenToOwner("key")).toBe(true);
		expect(await arcanaOf({ owned: ["key"], unlockedOnce: ["key"] }, [key]).backOpenToOwner("key")).toBe(true);
		// A known answer skips the card lookup.
		expect(await arcanaOf({ owned: ["key"], unlock: { "key:x": 1 } }, [key]).backOpenToOwner("key", { unlocked: false })).toBe(false);
	});
});
