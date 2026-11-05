import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";
import {
	STEADING_ASSETS_QUERY, assetRelayTarget, handleSteadingAssetsQuery, registerSteadingAssetsQuery, relayAssetWrite,
} from "../../../module/actors/steading/steading-asset-relay.js";
import {
	REQUISITIONED_FROM_FLAG, assetIsCarried, offerToClearRequisitioned, openTripTag, requisitionedCopies,
} from "../../../module/utils/requisition-asset.js";
import { askHorsesBack, herdHorsesIn, herdHorsesOnLine } from "../../../module/actors/steading/herd-requisition.js";
import { takeOnRequisitionMiss } from "../../../module/actors/steading/steading-card-actions.js";
import { followerLoadMarks } from "../../../module/actors/character/follower-outfit.js";
import { fakeForm, stubAsk } from "../../fakes/confirm.js";
import { inTurn } from "../../../module/utils/turn-queue.js";
import { createStonetopSteadingSheetClass } from "../../../module/actors/steading/StonetopSteadingSheet.js";

// The expedition audit's preparation fixes (PREP-1..12, 2026-11-03): the steading's asset and herd
// writes, the relay that makes a player's on the GM's client, and the helpers both Requisition doors use.

function assetActor(assets, extra = {}) {
	const actor = {
		id: "stead", uuid: "Actor.stead", type: "stonetop", name: "Stonetop", system: {},
		flags: { stonetop: { steading: { assets, ...extra } } },
		getFlag: (scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
		setFlag: vi.fn((scope, key, value) => { actor.flags.stonetop.steading = value; }),
		update: vi.fn(async data => {
			const herd = data["flags.stonetop-pwd.steading.herd"];
			if (herd) actor.flags.stonetop.steading.herd = herd;
		}),
		testUserPermission: vi.fn(() => true),
	};
	return actor;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("PREP-2: an asset write names the asset it meant", () => {
	it("refuses to return or lose a row that is not the one named, and returns the one that is", async () => {
		const actor = assetActor([{ name: "Carts", checked: false, takenBy: { name: "Wren" } }, { name: "Wagon", checked: true }]);
		const steading = new StonetopSteading(actor);
		expect(await steading.returnAsset(0, { name: "Wagon" })).toBe(false);
		expect(actor.flags.stonetop.steading.assets[0].takenBy).toEqual({ name: "Wren" });
		expect(await steading.returnAsset(0, { name: "Carts" })).toBe(true);
		expect(actor.flags.stonetop.steading.assets[0]).toEqual({ name: "Carts", checked: true });
	});

	it("loses an asset off the list only under its own name (PREP-3)", async () => {
		const actor = assetActor([{ name: "Carts", checked: false }, { name: "Wagon", checked: false }]);
		const steading = new StonetopSteading(actor);
		expect(await steading.loseAsset(0, { name: "Wagon" })).toBe(false);
		expect(await steading.loseAsset(1, { name: "Wagon" })).toBe(true);
		expect(actor.flags.stonetop.steading.assets.map(a => a.name)).toEqual(["Carts"]);
	});
});

describe("PREP-8: a player's asset and herd writes are made on the GM's client", () => {
	it("writes here on a GM's client or with no GM connected, and hands over from a player's", () => {
		const gm = { id: "gm" };
		expect(assetRelayTarget({ user: { id: "p", isGM: false }, users: { activeGM: null } })).toBeNull();
		expect(assetRelayTarget({ user: { id: "gm", isGM: true }, users: { activeGM: gm } })).toBeNull();
		expect(assetRelayTarget({ user: { id: "p", isGM: false }, users: { activeGM: gm } })).toBe(gm);
	});

	it("sends a player's take to the GM with the steading and the write, and throws on a refusal", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const query = vi.fn(async () => ({ value: true }));
		const steading = new StonetopSteading(assetActor([{ name: "Wagon", checked: true }]));
		const here = vi.spyOn(steading, "_setAssetTakenHere");
		const out = await relayAssetWrite(steading, "take", [0, { name: "Wren" }, { name: "Wagon" }], { target: () => ({ query }) });
		expect(out).toBe(true);
		expect(here).not.toHaveBeenCalled();
		expect(query.mock.calls[0][0]).toBe(STEADING_ASSETS_QUERY);
		expect(query.mock.calls[0][1]).toMatchObject({ steadingUuid: "Actor.stead", op: "take", args: [0, { name: "Wren" }, { name: "Wagon" }] });

		await expect(relayAssetWrite(steading, "take", [], { target: () => ({ query: async () => ({ refused: true }) }) })).rejects.toThrow(/refused/);
		await expect(relayAssetWrite(steading, "take", [], { target: () => ({ query: async () => { throw new Error("timeout"); } }) })).rejects.toThrow(/No answer/);
	});

	it("makes the write on the GM's side for an asker who could have made it, and refuses one who could not", async () => {
		vi.stubGlobal("game", { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false }) } });
		const actor = assetActor([{ name: "Wagon", checked: true }]);
		const steading = new StonetopSteading(actor);
		const deps = { resolve: () => actor, wrap: () => steading, users: game.users };
		const answer = await handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "take", args: [0, { name: "Wren" }, { name: "Wagon" }], userId: "p" }, {}, deps);
		expect(answer).toEqual({ value: true });
		expect(actor.flags.stonetop.steading.assets[0].takenBy).toEqual({ name: "Wren" });

		actor.testUserPermission = () => false;
		expect(await handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "return", args: [0], userId: "p" }, {}, deps)).toEqual({ refused: true });
		expect(await handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "nope", args: [], userId: "p" }, {}, deps)).toEqual({ refused: true });
	});

	it("writes nothing for an asker who has stopped waiting by the time the write's turn comes", async () => {
		vi.stubGlobal("game", { user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false }) } });
		const actor = assetActor([{ name: "Wagon", checked: true }], { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 4, yearlings: 0, foals: 0 } });
		const steading = new StonetopSteading(actor);
		let clock = 0;
		const deps = { resolve: () => actor, wrap: () => steading, users: game.users, now: () => clock };
		// The steading's turn is held by a slow write; the relayed take waits behind it, past the asker's wait.
		let release;
		const gate = new Promise(r => { release = r; });
		const hold = inTurn("steading:stead", () => gate);
		const take = handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "take", args: [0, { name: "Wren" }, { name: "Wagon" }], userId: "p" }, {}, deps);
		const horses = handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "fromHerd", args: [2, { stonetopMove: "Requisition" }], userId: "p" }, {}, deps);
		clock = 9000;
		release();
		await hold;
		expect(await take).toEqual({ value: false });
		expect(await horses).toEqual({ value: null });
		expect(actor.flags.stonetop.steading.assets[0].takenBy).toBeUndefined();
		expect(actor.flags.stonetop.steading.herd.grown).toBe(4);

		// In time, the same write lands.
		clock = 0;
		const ontime = { ...deps, now: () => clock };
		expect(await handleSteadingAssetsQuery({ steadingUuid: actor.uuid, op: "take", args: [0, { name: "Wren" }, { name: "Wagon" }], userId: "p" }, {}, ontime)).toEqual({ value: true });
	});

	it("registers the GM's side", () => {
		const queries = {};
		registerSteadingAssetsQuery(queries);
		expect(typeof queries[STEADING_ASSETS_QUERY]).toBe("function");
	});

	it("takes horses out of the herd one take after another, each reading what the last left", async () => {
		const actor = assetActor([], { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 6, yearlings: 0, foals: 0 } });
		actor.update = vi.fn(async data => {
			await new Promise(r => setTimeout(r, 5));
			actor.flags.stonetop.steading.herd = data["flags.stonetop-pwd.steading.herd"];
		});
		const steading = new StonetopSteading(actor);
		await Promise.all([steading.requisitionFromHerd(2), steading.requisitionFromHerd(3)]);
		expect(actor.flags.stonetop.steading.herd.grown).toBe(1);
	});
});

describe("PREP-5 / E6: what a take leaves on the character", () => {
	it("makes animals and the village's vehicles no Inventory item", () => {
		expect(assetIsCarried("A wagon (plus horse harness)")).toBe(false);
		expect(assetIsCarried("A pair of carts (plus horse harness)")).toBe(false);
		expect(assetIsCarried("A pair of horse-drawn plows, iron")).toBe(false);
		expect(assetIsCarried("A pair of hardy draft horses", true)).toBe(false);
		expect(assetIsCarried("The smithy's good tongs")).toBe(true);
	});

	it("tags a take with the walkthrough's current trip until it has come home", () => {
		const log = { currentId: "t2", list: [{ id: "t1", title: "Old" }, { id: "t2", title: "" }] };
		expect(openTripTag(log)).toEqual({ id: "t2", title: "Expedition 2" });
		expect(openTripTag({ ...log, list: [log.list[0], { id: "t2", title: "Home", timelineRecorded: { season: "summer" } }] })).toBeNull();
		expect(openTripTag(undefined)).toBeNull();
	});

	it("finds the items and followers a take stamped, and offers them off to a user who can write the sheet", async () => {
		const actor = {
			id: "hero1", name: "Wren", isOwner: true,
			items: [{ id: "i1", name: "Tongs", flags: { "stonetop-pwd": { [REQUISITIONED_FROM_FLAG]: "Tongs" } } }, { id: "i2", name: "Rope", flags: {} }],
			flags: { "stonetop-pwd": { customFollowers: { f1: { name: "Horse 1", [REQUISITIONED_FROM_FLAG]: "Horses" }, f2: { name: "Dog" } } } },
			deleteEmbeddedDocuments: vi.fn(async () => {}),
			update: vi.fn(async () => {}),
		};
		expect(requisitionedCopies(actor, "Horses")).toEqual({ items: [], followers: ["f1"] });
		expect(requisitionedCopies(actor, "Tongs").items.map(i => i.id)).toEqual(["i1"]);

		const actors = { get: () => actor };
		const ask = vi.fn(async () => "clear");
		const deletion = key => [key.replace(/\.([^.]+)$/, ".-=$1"), null];
		expect(await offerToClearRequisitioned({ holderId: "hero1", assetName: "Horses", ask, deletion, actors })).toBe(true);
		expect(ask.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Take it off Wren's sheet", "Leave Wren's sheet as it is"]);
		expect(ask.mock.calls[0][0].content).toContain("Horse 1");
		expect(actor.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.-=f1": null });

		// Nothing stamped, nobody asked; a user who cannot write the sheet is not asked either.
		ask.mockClear();
		expect(await offerToClearRequisitioned({ holderId: "hero1", assetName: "Wagon", ask, deletion, actors })).toBe(false);
		actor.isOwner = false;
		expect(await offerToClearRequisitioned({ holderId: "hero1", assetName: "Horses", ask, deletion, actors })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
	});
});

describe("PREP-6 / E2: herd horses counted home", () => {
	it("reads a line counted home as none still out, but keeps it on the trip", () => {
		const lines = [{ name: "3 horses from the herd", herd: 3, home: true, back: 2 }, { name: "2 horses from the herd", herd: 2 }];
		expect(herdHorsesOnLine(lines[0])).toBe(0);
		expect(herdHorsesIn(lines)).toBe(2);
	});

	it("asks how many came home, all of them by default", async () => {
		const wait = stubAsk("back", fakeForm({ horses: { value: "1" } }));
		expect(await askHorsesBack({ taken: 3 })).toBe(1);
		expect(wait.mock.calls[0][0].content).toContain(`max="3" value="3"`);
		stubAsk("cancel");
		expect(await askHorsesBack({ taken: 3 })).toBeNull();
	});
});

describe("PREP-4: a take after a 6- costs 1 Fortunes, from either door", () => {
	const card = (flags = {}) => ({
		getFlag: vi.fn((scope, key) => flags[key]),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
	});

	it("asks, takes, then pays through Meet with Disaster's floor", async () => {
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
		const actor = assetActor([]);
		actor.system = { stats: { fortunes: { value: 1 } } };
		const steading = new StonetopSteading(actor);
		const take = vi.fn(async () => true);
		expect(await takeOnRequisitionMiss({ card: card(), missed: true, name: "Wagon", steading, canWrite: true, take, ask: async () => "take" })).toBe(true);
		expect(take).toHaveBeenCalled();
		expect(actor.update.mock.calls[0][0]["system.stats.fortunes.value"]).toBe(0);
	});

	it("takes for free after a hit, and takes nothing when left", async () => {
		const ask = vi.fn(async () => null);
		const take = vi.fn(async () => true);
		expect(await takeOnRequisitionMiss({ card: card(), missed: false, name: "Wagon", steading: {}, canWrite: true, take, ask })).toBe(true);
		expect(ask).not.toHaveBeenCalled();
		take.mockClear();
		expect(await takeOnRequisitionMiss({ card: card(), missed: true, name: "Wagon", steading: {}, canWrite: true, take, ask })).toBe(false);
		expect(take).not.toHaveBeenCalled();
	});
});

describe("PREP-1: a follower's load row weighs its gear", () => {
	const pcOutfit = {
		regularSegments: [{ items: [{ slug: "spear", name: "Spear", weight: 1 }, { slug: "shield", name: "Shield", weight: 2 }] }],
		smallItems: [{ slug: "rope", name: "Rope" }],
		smallGridItems: [],
	};

	it("weighs catalog items, skips small ones, reads a written ◇ run, and adds the undefined ◇", () => {
		const gear = [
			{ label: "Spear", checked: true }, { label: "Shield", checked: true }, { label: "Rope", checked: true },
			{ label: "◇◇ litter (Lowri)", checked: true }, { label: "lucky stone", checked: true }, { label: "Torch", checked: false },
		];
		expect(followerLoadMarks(gear, pcOutfit, { regular: 2 })).toBe(1 + 2 + 0 + 2 + 1 + 2);
	});

	it("counts each ticked line as 1 when there is no catalog to weigh against", () => {
		expect(followerLoadMarks([{ label: "Spear", checked: true }, { label: "Rope", checked: true }], null, {})).toBe(2);
	});
});

describe("the fixes are wired where they are used", () => {
	const read = rel => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", rel), "utf8");

	it("registers the GM's side of the asset relay at init", () => {
		expect(read("stonetop.js")).toContain("registerSteadingAssetsQuery(CONFIG.queries);");
		expect(read("stonetop.js")).toContain(`"stonetop.expedition-home-assets":`);
	});

	it("offers a returned asset's copies off the holder's sheet from the steading sheet too", () => {
		expect(read("module/actors/steading/StonetopSteadingSheet.js")).toContain("await offerToClearRequisitioned({ holderId: row?.takenBy?.id, assetName: row?.name");
	});

	it("says nothing was returned, and offers nothing off the holder's sheet, when the steading sheet's return is refused", async () => {
		const Sheet = createStonetopSteadingSheetClass(class { get actor() { return this._actor; } render() {} });
		const notes = { info: vi.fn(), warn: vi.fn() };
		const get = vi.fn(() => null);
		vi.stubGlobal("ui", { notifications: notes });
		vi.stubGlobal("game", { actors: { get } });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const outcome of [async () => false, async () => { throw new Error("relay refused"); }]) {
			const sheet = Object.create(Sheet.prototype);
			sheet._actor = { name: "Stonetop" };
			sheet._stonetopSteading = { _flags: { assets: [{ name: "Wagon", takenBy: { name: "Wren", id: "hero1" } }] }, returnAsset: vi.fn(outcome) };
			await sheet._onReturnAsset(0);
			expect(sheet._stonetopSteading.returnAsset).toHaveBeenCalledWith(0, { name: "Wagon" });
		}
		expect(notes.info).not.toHaveBeenCalled();
		expect(notes.warn).toHaveBeenCalledTimes(2);
		expect(get).not.toHaveBeenCalled();
	});

	it("styles the Surplus stepper and the Going home list", () => {
		const css = read("styles/stonetop.css");
		for (const cls of [".stonetop-exp-surplus-step", ".stonetop-exp-home-asset-btn", ".stonetop-exp-home-asset-actions"]) expect(css, cls).toContain(cls);
	});
});
