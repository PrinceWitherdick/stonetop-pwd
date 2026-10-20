import { afterEach, describe, expect, it, vi } from "vitest";

const {
	homeKey, settlementForHome, plannedResidents, syncResidentHome, sweepSettlementResidents,
	editSettlementList, onCreateActorForResidents, onUpdateActorForResidents, onPreUpdateActorForResidents,
	settleRenames, settlementResolver, ownsItsName,
} = await import("../../../module/actors/settlement/settlement-residents.js");

const hasProperty = (o, k) => k.split(".").reduce((v, p) => (v && typeof v === "object" && p in v ? v[p] : undefined), o) !== undefined;
const setProperty = (o, k, v) => {
	const parts = k.split(".");
	const last = parts.pop();
	parts.reduce((at, p) => (at[p] ??= {}), o)[last] = v;
};

/** A settlement whose update writes its residents and former names in place, as the server's answer would. */
function settlement(id, name, residents = [], { isOwner = true, formerNames = [] } = {}) {
	const doc = { id, uuid: `Actor.${id}`, type: "settlement", name, isOwner, system: { residents, formerNames } };
	doc.update = vi.fn(async diff => {
		if (diff["system.residents"]) doc.system.residents = diff["system.residents"];
		if (diff["system.formerNames"]) doc.system.formerNames = diff["system.formerNames"];
	});
	return doc;
}

/** A world NPC whose update writes its Home in place. */
function npc(id, home, { isOwner = true } = {}) {
	const doc = { id, uuid: `Actor.${id}`, type: "npc", name: id, isOwner, system: { home } };
	doc.update = vi.fn(async diff => { if ("system.home" in diff) doc.system.home = diff["system.home"]; });
	return doc;
}

/** A Residents row, caching its NPC's name (npc() names each NPC by its id). */
const row = (uuid, name = uuid.replace(/^Actor./, ""), id = `row-${uuid}`) => ({ id, uuid, name });
const uuids = s => s.system.residents.map(r => r.uuid);

/** `game` as the module reads it: the actors, and which user this client is. */
function world(actors, { gm = true, userId = "me", noGm = false } = {}) {
	vi.stubGlobal("game", {
		actors: Object.assign([...actors], { contents: actors }),
		user: { id: userId, isGM: gm && !noGm },
		// noGm: nobody holding the GM role is connected, so isPrimaryGM() answers true everywhere.
		users: { activeGM: noGm ? null : gm ? { id: userId } : { id: "other" }, find: () => null },
	});
	vi.stubGlobal("foundry", { utils: { hasProperty, setProperty, deepClone: v => structuredClone(v) } });
	vi.stubGlobal("fromUuidSync", uuid => actors.find(a => a.uuid === uuid) ?? null);
}

afterEach(() => vi.unstubAllGlobals());

describe("matching a Home to a settlement", () => {
	it("ignores case, spacing, curly apostrophes and a leading The", () => {
		expect(homeKey("  Gordin’s   DELVE ")).toBe(homeKey("Gordin's Delve"));
		expect(homeKey("The Steplands")).toBe(homeKey("steplands"));
		expect(homeKey("")).toBe("");
	});

	it("names the first settlement with that name, and none for a blank Home (Stonetop)", () => {
		const delve = settlement("d", "Gordin's Delve");
		const twin = settlement("d2", "Gordin's Delve");
		expect(settlementForHome("gordin's delve", [delve, twin])).toBe(delve);
		expect(settlementForHome("", [delve])).toBeNull();
		expect(settlementForHome("Lygos", [delve])).toBeNull();
	});

	it("still names a renamed settlement by a former name, unless a settlement goes by it now", () => {
		const deep = settlement("d", "Deepdelve", [], { formerNames: ["Gordin's Delve"] });
		expect(settlementForHome("Gordin's Delve", [deep])).toBe(deep);
		const twin = settlement("d2", "Gordin's Delve");
		expect(settlementForHome("Gordin's Delve", [deep, twin])).toBe(twin);
	});

	it("answers the same through a resolver built once for many Homes", () => {
		const deep = settlement("d", "Deepdelve", [], { formerNames: ["Gordin's Delve"] });
		const delve = settlement("d1", "Marshedge");
		const twin = settlement("d2", "marshedge");
		const resolve = settlementResolver([deep, delve, twin]);
		for (const home of ["Gordin’s Delve", "THE Marshedge", "Deepdelve", "", "Lygos"]) {
			expect(resolve(home)).toBe(settlementForHome(home, [deep, delve, twin]));
		}
		expect(ownsItsName(delve, [deep, delve, twin])).toBe(true);
		expect(ownsItsName(twin, [deep, delve, twin])).toBe(false);
	});
});

describe("plannedResidents", () => {
	const delve = settlement("d", "Gordin's Delve");
	const marsh = settlement("m", "Marshedge");
	const all = [delve, marsh];

	it("adds whoever's Home names the place and drops whoever's names somewhere else", () => {
		const stays = npc("stays", "Gordin's Delve");
		const left = npc("left", "Marshedge");
		const comes = npc("comes", "gordin’s delve");
		const planned = plannedResidents([row(stays.uuid), row(left.uuid)], delve, [stays, left, comes], all);
		expect(planned.map(r => r.uuid)).toEqual([stays.uuid, comes.uuid]);
		expect(planned[0].id).toBe(`row-${stays.uuid}`);   // a kept row keeps its id
	});

	it("keeps a row whose NPC is gone, as the table shows its cached name", () => {
		expect(plannedResidents([row("Actor.gone", "Old Bryn")], delve, [], all)).toBeNull();
	});

	it("is null when the table already matches", () => {
		const stays = npc("stays", "Gordin's Delve");
		expect(plannedResidents([row(stays.uuid)], delve, [stays], all)).toBeNull();
	});

	it("keeps a row it is told to keep, whatever the NPC's Home says", () => {
		const unwritten = npc("unwritten", "");
		expect(plannedResidents([row(unwritten.uuid)], delve, [unwritten], all, { keep: new Set([unwritten.uuid]) })).toBeNull();
	});

	it("gives a kept row its NPC's name now, so a deleted NPC's row shows the last name they had", () => {
		const bryn = npc("bryn", "Gordin's Delve");
		bryn.name = "Bryn the Elder";
		const planned = plannedResidents([row(bryn.uuid, "Bryn")], delve, [bryn], all);
		expect(planned).toEqual([{ id: `row-${bryn.uuid}`, uuid: bryn.uuid, name: "Bryn the Elder" }]);
	});
});

describe("syncResidentHome", () => {
	it("files a new Delve neighbor on the Delve's table", async () => {
		const delve = settlement("d", "Gordin's Delve");
		const aled = npc("aled", "Gordin's Delve");
		expect(await syncResidentHome(aled, { settlements: [delve] })).toBe(true);
		expect(uuids(delve)).toEqual([aled.uuid]);
		expect(delve.system.residents[0]).toMatchObject({ name: "aled" });
	});

	it("renames the row of an NPC renamed on their own sheet, and is a no-op the second time", async () => {
		const aled = npc("aled", "Gordin's Delve");
		const delve = settlement("d", "Gordin's Delve", [row(aled.uuid)]);
		aled.name = "Aled Stonehand";
		expect(await syncResidentHome(aled, { settlements: [delve] })).toBe(true);
		expect(delve.system.residents).toEqual([{ id: `row-${aled.uuid}`, uuid: aled.uuid, name: "Aled Stonehand" }]);
		delve.update.mockClear();
		expect(await syncResidentHome(aled, { settlements: [delve] })).toBe(false);
		expect(delve.update).not.toHaveBeenCalled();
	});

	it("moves someone whose Home changed, and is a no-op the second time", async () => {
		const aled = npc("aled", "Marshedge");
		const delve = settlement("d", "Gordin's Delve", [row(aled.uuid)]);
		const marsh = settlement("m", "Marshedge");
		await syncResidentHome(aled, { settlements: [delve, marsh] });
		expect(uuids(delve)).toEqual([]);
		expect(uuids(marsh)).toEqual([aled.uuid]);
		delve.update.mockClear(); marsh.update.mockClear();
		expect(await syncResidentHome(aled, { settlements: [delve, marsh] })).toBe(false);
		expect(delve.update).not.toHaveBeenCalled();
		expect(marsh.update).not.toHaveBeenCalled();
	});

	it("takes them off everywhere when the Home names no sheet (Stonetop, Lygos)", async () => {
		const aled = npc("aled", "");
		const delve = settlement("d", "Gordin's Delve", [row(aled.uuid)]);
		await syncResidentHome(aled, { settlements: [delve] });
		expect(uuids(delve)).toEqual([]);
	});

	it("leaves a settlement this user can't write alone", async () => {
		const delve = settlement("d", "Gordin's Delve", [], { isOwner: false });
		await syncResidentHome(npc("aled", "Gordin's Delve"), { settlements: [delve] });
		expect(delve.update).not.toHaveBeenCalled();
	});

	it("ignores a compendium's or a token's NPC", async () => {
		const delve = settlement("d", "Gordin's Delve");
		expect(await syncResidentHome({ ...npc("p", "Gordin's Delve"), pack: "world.people" }, { settlements: [delve] })).toBe(false);
		expect(await syncResidentHome({ ...npc("t", "Gordin's Delve"), isToken: true }, { settlements: [delve] })).toBe(false);
		expect(delve.update).not.toHaveBeenCalled();
	});
});

describe("editSettlementList", () => {
	it("hands the edit deep copies, so nested rows change only through the write", async () => {
		const plans = [{ id: "p1", requirements: [{ text: "Cut timber", done: false }] }];
		const doc = { uuid: "Actor.s", system: { plans }, update: vi.fn(async () => {}) };
		await editSettlementList(doc, "plans", rows => { rows[0].requirements[0].done = true; });
		expect(plans[0].requirements[0].done).toBe(false);
		expect(doc.update.mock.calls[0][0]["system.plans"][0].requirements[0].done).toBe(true);
	});

	it("queues writes so a second edit starts from the first one's rows", async () => {
		const delve = settlement("d", "Gordin's Delve");
		await Promise.all([
			editSettlementList(delve, "residents", rows => { rows.push(row("Actor.a")); }),
			editSettlementList(delve, "residents", rows => { rows.push(row("Actor.b")); }),
		]);
		expect(uuids(delve)).toEqual(["Actor.a", "Actor.b"]);
	});
});

describe("sweepSettlementResidents (old worlds, and a settlement made after its people)", () => {
	it("files every NPC whose Home names a settlement, one write per settlement", async () => {
		const a = npc("a", "Gordin's Delve"), b = npc("b", "Gordin's Delve"), c = npc("c", "Stonetop");
		const delve = settlement("d", "Gordin's Delve");
		world([a, b, c, delve]);
		expect(await sweepSettlementResidents()).toBe(1);
		expect(uuids(delve)).toEqual([a.uuid, b.uuid]);
		expect(delve.update).toHaveBeenCalledTimes(1);
	});

	it("gives a listed resident with a blank Home this place's name rather than dropping them", async () => {
		const blank = npc("blank", "");
		const delve = settlement("d", "Gordin's Delve", [row(blank.uuid)]);
		world([blank, delve]);
		await sweepSettlementResidents();
		expect(blank.system.home).toBe("Gordin's Delve");
		expect(uuids(delve)).toEqual([blank.uuid]);
	});

	it("fills a blank Home only from the settlement it was asked about", async () => {
		const blank = npc("blank", "");
		const delve = settlement("d", "Gordin's Delve", [row(blank.uuid)]);
		const marsh = settlement("m", "Marshedge");
		world([blank, delve, marsh]);
		await sweepSettlementResidents({ only: marsh });
		expect(blank.update).not.toHaveBeenCalled();
	});

	it("once per world, keeps a listed resident whose Home names no settlement by giving them this place's", async () => {
		const stonetopper = npc("s", "Stonetop"), drover = npc("w", "North Manmarch"), marshFolk = npc("m", "Marshedge");
		const delve = settlement("d", "Gordin's Delve", [row(stonetopper.uuid), row(drover.uuid), row(marshFolk.uuid)]);
		const marsh = settlement("me", "Marshedge");
		world([stonetopper, drover, marshFolk, delve, marsh]);
		await sweepSettlementResidents({ adoptHomes: true });
		expect(stonetopper.system.home).toBe("Gordin's Delve");
		expect(drover.system.home).toBe("Gordin's Delve");
		// A Home naming another sheet is theirs: they move to that table rather than vanishing.
		expect(marshFolk.update).not.toHaveBeenCalled();
		expect(uuids(delve)).toEqual([stonetopper.uuid, drover.uuid]);
		expect(uuids(marsh)).toEqual([marshFolk.uuid]);
	});

	it("without adoptHomes, takes off a listed resident whose Home names somewhere else", async () => {
		const stonetopper = npc("s", "Stonetop");
		const delve = settlement("d", "Gordin's Delve", [row(stonetopper.uuid)]);
		world([stonetopper, delve]);
		await sweepSettlementResidents();
		expect(stonetopper.update).not.toHaveBeenCalled();
		expect(uuids(delve)).toEqual([]);
	});

	it("keeps a listed resident's row when their Home could not be written", async () => {
		const blank = npc("blank", "");
		blank.update.mockRejectedValueOnce(new Error("locked"));
		const delve = settlement("d", "Gordin's Delve", [row(blank.uuid)]);
		world([blank, delve]);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await sweepSettlementResidents();
		expect(blank.system.home).toBe("");
		expect(uuids(delve)).toEqual([blank.uuid]);
	});

	it("gives no Home of a name an earlier settlement goes by, and keeps the row", async () => {
		const blank = npc("blank", "");
		const first = settlement("d1", "Gordin's Delve");
		const second = settlement("d2", "Gordin's Delve", [row(blank.uuid)]);
		world([blank, first, second]);
		await sweepSettlementResidents();
		expect(blank.update).not.toHaveBeenCalled();
		expect(uuids(second)).toEqual([blank.uuid]);
		expect(uuids(first)).toEqual([]);
	});

	it("does nothing in a world with no settlements", async () => {
		const a = npc("a", "Gordin's Delve");
		world([a]);
		expect(await sweepSettlementResidents()).toBe(0);
		expect(a.update).not.toHaveBeenCalled();
	});
});

describe("the hooks", () => {
	const flush = () => new Promise(resolve => setTimeout(resolve, 0));

	it("leave filing to a GM: with none connected, no player client files from the hooks", async () => {
		const delve = settlement("d", "Gordin's Delve");
		const a = npc("a", "Gordin's Delve");
		world([a, delve], { noGm: true });
		onCreateActorForResidents(a);
		onUpdateActorForResidents(a, { system: { home: "Gordin's Delve" } }, {}, "someone");
		await flush();
		expect(delve.update).not.toHaveBeenCalled();
	});

	it("file a created NPC, on the primary GM only", async () => {
		const delve = settlement("d", "Gordin's Delve");
		const a = npc("a", "Gordin's Delve");
		world([a, delve], { gm: false });
		onCreateActorForResidents(a);
		await flush();
		expect(delve.update).not.toHaveBeenCalled();
		world([a, delve]);
		onCreateActorForResidents(a);
		await flush();
		expect(uuids(delve)).toEqual([a.uuid]);
	});

	it("move an NPC whose Home changed, and ignore any other write", async () => {
		const a = npc("a", "Marshedge");
		const delve = settlement("d", "Gordin's Delve", [row(a.uuid)]);
		world([a, delve]);
		onUpdateActorForResidents(a, { system: { traits: "x" } }, {}, "me");
		await flush();
		expect(delve.update).not.toHaveBeenCalled();
		onUpdateActorForResidents(a, { system: { home: "Marshedge" } }, {}, "me");
		await flush();
		expect(uuids(delve)).toEqual([]);
	});

	it("carry an NPC's new name onto their row", async () => {
		const a = npc("a", "Gordin's Delve");
		const delve = settlement("d", "Gordin's Delve", [row(a.uuid)]);
		world([a, delve]);
		a.name = "Aled";
		onUpdateActorForResidents(a, { name: "Aled" }, {}, "someone");
		await flush();
		expect(delve.system.residents[0].name).toBe("Aled");
	});

	it("gather a new settlement's people", async () => {
		const a = npc("a", "Marshedge");
		const marsh = settlement("m", "Marshedge");
		world([a, marsh]);
		onCreateActorForResidents(marsh);
		await flush();
		expect(uuids(marsh)).toEqual([a.uuid]);
	});

	/** Rename a settlement as Foundry would: what the pre-hook adds lands with the name. */
	function rename(doc, name) {
		const changed = { name };
		onPreUpdateActorForResidents(doc, changed);
		doc.name = name;
		if (changed.system?.formerNames) doc.system.formerNames = changed.system.formerNames;
		return changed;
	}

	it("remember a renamed settlement's old name in the rename itself, and forget a name taken back", () => {
		world([]);
		const delve = settlement("d", "Gordin's Delve");
		expect(rename(delve, "Deepdelve").system.formerNames).toEqual(["Gordin's Delve"]);
		expect(rename(delve, "Gordin's Delve").system.formerNames).toEqual(["Deepdelve"]);
		expect(rename(delve, "gordin’s delve").system).toBeUndefined();
	});

	it("re-home a renamed settlement's residents on the renaming client, then gather the new name's", async () => {
		const a = npc("a", "Gordin's Delve");
		const already = npc("already", "Deepdelve");
		const delve = settlement("d", "Gordin's Delve", [row(a.uuid)]);
		world([a, already, delve], { gm: false });
		const changed = rename(delve, "Deepdelve");
		onUpdateActorForResidents(delve, changed, {}, "someone-else");
		await flush();
		expect(a.update).not.toHaveBeenCalled();
		onUpdateActorForResidents(delve, changed, {}, "me");
		for (let i = 0; i < 5; i++) await flush();
		expect(a.system.home).toBe("Deepdelve");
		expect(uuids(delve)).toEqual([a.uuid, already.uuid]);
		expect(delve.system.formerNames).toEqual([]);
	});

	it("keep the residents a renaming player can't write, until the primary GM re-homes them", async () => {
		const theirs = npc("theirs", "Gordin's Delve", { isOwner: false });
		const delve = settlement("d", "Gordin's Delve", [row(theirs.uuid)]);
		world([theirs, delve], { gm: false });
		const changed = rename(delve, "Deepdelve");
		onUpdateActorForResidents(delve, changed, {}, "me");
		for (let i = 0; i < 5; i++) await flush();
		expect(theirs.update).not.toHaveBeenCalled();
		expect(uuids(delve)).toEqual([theirs.uuid]);
		expect(delve.system.formerNames).toEqual(["Gordin's Delve"]);

		// The GM's next load settles the pending rename before anyone is filed.
		theirs.isOwner = true;
		world([theirs, delve]);
		await sweepSettlementResidents();
		expect(theirs.system.home).toBe("Deepdelve");
		expect(uuids(delve)).toEqual([theirs.uuid]);
		expect(delve.system.formerNames).toEqual([]);
	});

	it("re-home a player's rename on the primary GM as well", async () => {
		const theirs = npc("theirs", "Gordin's Delve");
		const delve = settlement("d", "Gordin's Delve", [row(theirs.uuid)]);
		world([theirs, delve]);
		const changed = rename(delve, "Deepdelve");
		onUpdateActorForResidents(delve, changed, {}, "a-player");
		for (let i = 0; i < 5; i++) await flush();
		expect(theirs.system.home).toBe("Deepdelve");
		expect(uuids(delve)).toEqual([theirs.uuid]);
	});
});

describe("settleRenames", () => {
	it("moves nobody while an earlier settlement goes by the new name, so the sheet keeps its people", async () => {
		const a = npc("a", "Hillfolk band");
		const first = settlement("d1", "Gordin's Delve");
		const renamed = settlement("d2", "Gordin's Delve", [row(a.uuid)], { formerNames: ["Hillfolk band"] });
		world([a, first, renamed]);
		vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
		onUpdateActorForResidents(renamed, { name: "Gordin's Delve" }, {}, "me");
		for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
		expect(a.update).not.toHaveBeenCalled();
		expect(uuids(renamed)).toEqual([a.uuid]);
		expect(uuids(first)).toEqual([]);
		expect(renamed.system.formerNames).toEqual(["Hillfolk band"]);
		expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
	});

	it("lets a former name go once another settlement goes by it", async () => {
		const a = npc("a", "Gordin's Delve");
		const deep = settlement("d", "Deepdelve", [], { formerNames: ["Gordin's Delve"] });
		const twin = settlement("d2", "Gordin's Delve");
		world([a, deep, twin]);
		expect(await settleRenames(deep)).toBe(false);
		expect(a.update).not.toHaveBeenCalled();
		expect(deep.system.formerNames).toEqual([]);
	});
});
