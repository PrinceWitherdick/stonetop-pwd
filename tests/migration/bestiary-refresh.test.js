import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	monsterRefresh, fieldRefresh, bestiarySourceId, refreshSeededMonsters, statHash, monsterFingerprint,
} from "../../module/migration/bestiary-refresh.js";
import { SUPERSEDED_BESTIARY, BESTIARY_FINGERPRINTS, SUPERSEDED_FORMAT as DATA_FORMAT } from "../../module/migration/data/superseded-bestiary.js";
import { SUPERSEDED_FORMAT } from "../../module/migration/superseded-values.js";

// The monsters seeded into the world are copies, and Deploy and the monster browser prefer them to
// the pack: a stat-block field or a move still holding what an older pack shipped is brought up to
// the pack, and a GM's own edit is left.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "packs", "src", "stonetop-bestiary");
const source = rel => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
// A world copy as the seed makes it: the pack's stat block, stamped with where it came from.
const seeded = (entry, edit = c => c) => edit({ ...structuredClone(entry), _stats: { compendiumSource: `Compendium.stonetop-pwd.stonetop-bestiary.Actor.${entry._id}` } });

describe("monsterRefresh", () => {
	it("corrects the Specter's armor source, off the generated history", () => {
		const specter = source("powers/specter.json");
		const old = seeded(specter, c => { c.system.attributes.armor.source = "lacks vitals"; return c; });
		expect(monsterRefresh(old, specter, SUPERSEDED_BESTIARY[specter._id]))
			.toEqual({ actor: { "system.attributes.armor.source": "lacks organs" }, items: [] });
	});

	it("leaves an armor source the GM wrote, and a stat block already current", () => {
		const specter = source("powers/specter.json");
		const mine = seeded(specter, c => { c.system.attributes.armor.source = "incorporeal"; return c; });
		expect(monsterRefresh(mine, specter, SUPERSEDED_BESTIARY[specter._id])).toBeNull();
		expect(monsterRefresh(seeded(specter), specter, SUPERSEDED_BESTIARY[specter._id])).toBeNull();
	});

	it("gives a move its icon back, matched by id, off the generated history", () => {
		const colossus = source("makers/bronze-colossus.json");
		const tentacles = colossus.items.find(m => m.img.includes("tentacles"));
		const old = seeded(colossus, c => {
			c.items.find(m => m._id === tentacles._id).img = "icons/creatures/tentacles/tentacles-octopus-purple.webp";
			return c;
		});
		expect(monsterRefresh(old, colossus, SUPERSEDED_BESTIARY[colossus._id]))
			.toEqual({ actor: null, items: [{ _id: tentacles._id, img: tentacles.img }] });
	});

	it("keeps an unhurt monster unhurt when its max HP is corrected, and a hurt one's HP as it is", () => {
		const entry = { _id: "m", system: { attributes: { hp: { value: 12, max: 12 } } }, items: [] };
		const former = { paths: { "system.attributes.hp.max": [statHash(10)] } };
		const unhurt = { system: { attributes: { hp: { value: 10, max: 10 } } }, items: [] };
		expect(monsterRefresh(unhurt, entry, former).actor)
			.toEqual({ "system.attributes.hp.max": 12, "system.attributes.hp.value": 12 });
		const hurt = { system: { attributes: { hp: { value: 4, max: 10 } } }, items: [] };
		expect(monsterRefresh(hurt, entry, former).actor).toEqual({ "system.attributes.hp.max": 12 });
	});

	it("brings a hurt monster down only to a smaller max it would sit above, and otherwise keeps its wounds", () => {
		const entry = { _id: "m", system: { attributes: { hp: { value: 8, max: 8 } } }, items: [] };
		const former = { paths: { "system.attributes.hp.max": [statHash(12)] } };
		const above = { system: { attributes: { hp: { value: 10, max: 12 } } }, items: [] };
		expect(monsterRefresh(above, entry, former).actor).toEqual({ "system.attributes.hp.max": 8, "system.attributes.hp.value": 8 });
		const below = { system: { attributes: { hp: { value: 3, max: 12 } } }, items: [] };
		expect(monsterRefresh(below, entry, former).actor).toEqual({ "system.attributes.hp.max": 8 });
	});

	it("never writes current HP when max HP is not what changed", () => {
		const specter = source("powers/specter.json");
		const hurt = seeded(specter, c => { c.system.attributes.hp.value = 2; c.system.attributes.armor.source = "lacks vitals"; return c; });
		expect(Object.keys(monsterRefresh(hurt, specter, SUPERSEDED_BESTIARY[specter._id]).actor)).toEqual(["system.attributes.armor.source"]);
	});

	it("takes the Crinwin's unprinted choke move off a copy still holding it as shipped, and only then", () => {
		const crinwin = source("regions/crinwin.json");
		const choke = { _id: "HwT4Rew3fxkzRx6m", name: "Choke with sinewy fingers", type: "monsterMove", img: "x.webp", system: { description: "", rollFormula: "d6" } };
		const old = seeded(crinwin, c => { c.items.push(structuredClone(choke)); return c; });
		expect(monsterRefresh(old, crinwin, SUPERSEDED_BESTIARY[crinwin._id] ?? {})).toMatchObject({ deletes: [choke._id] });
		// Renamed, it is the GM's own move now, and stays.
		const mine = seeded(crinwin, c => { c.items.push({ ...structuredClone(choke), name: "Throttle" }); return c; });
		expect(monsterRefresh(mine, crinwin, SUPERSEDED_BESTIARY[crinwin._id] ?? {})?.deletes).toBeUndefined();
	});

	it("names the Broodfather's tongue with its printed damage, off the generated history", () => {
		const brood = source("regions/crinwin-broodfather.json");
		const tongue = brood.items.find(m => m._id === "hPN9iPWSsIt68SXk");
		expect(tongue.name).toBe("Lash out with a choking tongue (d6+2, reach, forceful, grabby)");
		const old = seeded(brood, c => { c.items.find(m => m._id === tongue._id).name = "Lash out with a choking tongue"; return c; });
		expect(monsterRefresh(old, brood, SUPERSEDED_BESTIARY[brood._id]).items).toEqual([{ _id: tongue._id, name: tongue.name }]);
	});

	it("never matches a move the GM added, and reads a 0 as a value", () => {
		const entry = { items: [{ _id: "a", name: "Bite", img: "new.webp" }] };
		const held = { items: [{ _id: "z", name: "Howl", img: "old.webp" }] };
		expect(monsterRefresh(held, entry, { items: { a: { img: [statHash("old.webp")] } } })).toBeNull();
		expect(fieldRefresh({ v: 0 }, { v: 2 }, ["v"], { v: [statHash(0)] })).toEqual({ v: 2 });
		expect(fieldRefresh({}, { v: 2 }, ["v"], { v: [statHash(0)] })).toBeNull();
	});
});

describe("bestiarySourceId", () => {
	it("is the pack id a monster was seeded from, under any id the system has had", () => {
		expect(bestiarySourceId({ _stats: { compendiumSource: "Compendium.stonetop-pwd.stonetop-bestiary.Actor.abc" } })).toBe("abc");
		expect(bestiarySourceId({ _stats: { compendiumSource: "Compendium.stonetop_pwd.stonetop-bestiary.Actor.abc" } })).toBe("abc");
		expect(bestiarySourceId({ _stats: { compendiumSource: "Compendium.stonetop-pwd.stonetop-items.Item.abc" } })).toBeNull();
		expect(bestiarySourceId({ _stats: {} })).toBeNull();
	});
});

describe("refreshSeededMonsters", () => {
	it("writes each stale seeded monster once, and reads only the pack entries it needs", async () => {
		const specter = source("powers/specter.json");
		const old = seeded(specter, c => { c.system.attributes.armor.source = "lacks vitals"; return c; });
		old.update = vi.fn(async () => {});
		old.updateEmbeddedDocuments = vi.fn(async () => {});
		const pc = { type: "character", _stats: {}, update: vi.fn() };
		const getEntries = vi.fn(async () => [specter]);
		expect(await refreshSeededMonsters({ actors: [old, pc], getEntries })).toBe(1);
		expect(getEntries).toHaveBeenCalledWith([specter._id]);
		expect(old.update).toHaveBeenCalledWith({ "system.attributes.armor.source": "lacks organs" });
		expect(old.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(pc.update).not.toHaveBeenCalled();
	});

	it("touches only monsters: an NPC built off a stat block keeps its own", async () => {
		const specter = source("powers/specter.json");
		const npc = { ...seeded(specter, c => { c.system.attributes.armor.source = "lacks vitals"; return c; }), type: "npc", update: vi.fn() };
		const getEntries = vi.fn();
		expect(await refreshSeededMonsters({ actors: [npc], getEntries })).toBe(0);
		expect(npc.update).not.toHaveBeenCalled();
	});

	it("writes every other monster when one refuses, then fails so it is tried again", async () => {
		const specter = source("powers/specter.json");
		const stale = name => {
			const m = seeded(specter, c => { c.system.attributes.armor.source = "lacks vitals"; return c; });
			return { ...m, name, update: vi.fn(async () => {}), updateEmbeddedDocuments: vi.fn(async () => {}) };
		};
		const broken = stale("Broken");
		broken.update = vi.fn(async () => { throw new Error("locked"); });
		const fine = stale("Fine");
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(refreshSeededMonsters({ actors: [broken, fine], getEntries: async () => [specter] })).rejects.toThrow(/Broken/);
		expect(fine.update).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("deletes a retired move from a seeded copy", async () => {
		const crinwin = source("regions/crinwin.json");
		const old = seeded(crinwin, c => {
			c.items.push({ _id: "HwT4Rew3fxkzRx6m", name: "Choke with sinewy fingers", type: "monsterMove", img: "x.webp", system: { description: "", rollFormula: "d6" } });
			return c;
		});
		old.update = vi.fn(async () => {});
		old.updateEmbeddedDocuments = vi.fn(async () => {});
		old.deleteEmbeddedDocuments = vi.fn(async () => {});
		expect(await refreshSeededMonsters({ actors: [old], getEntries: async () => [crinwin] })).toBe(1);
		expect(old.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["HwT4Rew3fxkzRx6m"]);
	});

	it("reads no pack at all in a world with no seeded monsters", async () => {
		const getEntries = vi.fn();
		expect(await refreshSeededMonsters({ actors: [], getEntries })).toBe(0);
		expect(getEntries).not.toHaveBeenCalled();
	});
});

// Generated from git history; a stat block edited since is missing from it. Needs no history.
it("was generated from the bestiary as it is now (else run `npm run gen:superseded`)", () => {
	expect(DATA_FORMAT).toBe(SUPERSEDED_FORMAT);
	const readTree = dir => readdirSync(dir).flatMap(name => {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) return name === "_folders" ? [] : readTree(p);
		return name.endsWith(".json") ? [JSON.parse(readFileSync(p, "utf8"))] : [];
	});
	const now = Object.fromEntries(readTree(root).filter(d => d._id && Array.isArray(d.items)).map(d => [d._id, monsterFingerprint(d)]));
	expect(BESTIARY_FINGERPRINTS).toEqual(now);
});
