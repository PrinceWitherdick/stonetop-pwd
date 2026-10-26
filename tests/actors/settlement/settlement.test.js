import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollStat: vi.fn(async () => ({ total: 7 })),
}));

const { rollStat } = await import("../../../module/utils/roll-engine.js");
const {
	SETTLEMENT_TYPE, customSettlementActors, settlementDataFromBook, settlementDataFromTemplate,
	redrawForSettlement, settlementsBySlug, settlementSystemFrom, standingKey,
	tradePartnerSlug, settlementHiddenFromPlayers,
} = await import("../../../module/actors/settlement/settlement-actor.js");
const {
	SETTLEMENT_MOVES, rollSettlementMove, settlementIsLacking, settlementRollOptions,
} = await import("../../../module/actors/settlement/settlement-rolls.js");
const { settlementDataForChoice, settlementSourceOptions } = await import("../../../module/dialogs/create-actor-dialog.js");
const { classifySide } = await import("../../../module/fight/fight-sides.js");

/** A settlement's `system` as the model would hold it, filled from a book block. */
const systemOf = (data, patch = {}) => ({ ...data.system, ...patch });

const actor = (id, system, extra = {}) => ({ id, uuid: `Actor.${id}`, type: SETTLEMENT_TYPE, name: id, system, ...extra });

afterEach(() => vi.clearAllMocks());

describe("filling a settlement in from the books", () => {
	it("takes Marshedge's printed stat block (Book II p.274)", () => {
		const data = settlementDataFromBook("marshedge");
		expect(data.name).toBe("Marshedge");
		expect(data.system).toMatchObject({
			size: "town",
			headcount: "~800 to 900 souls",
			stats: { population: { value: 0 }, prosperity: { value: 2 }, defenses: { value: 1 } },
			sourceSlug: "marshedge",
			sourcePage: "Book II p.274",
		});
		expect(data.system.resources.map(r => r.name)).toEqual(["Farming", "Trades", "Forage", "Marketplace", "Windmill"]);
		expect(data.system.resources.every(r => r.lacking === false)).toBe(true);
		expect(data.system.fortifications.map(r => r.name)).toEqual(["The Guard", "Wooden palisade", "Bendis root braziers"]);
		expect(data.system.leaders.find(l => l.name === "Ianthe").instinct).toBe("To maintain her family's dignity");
	});

	it("has nothing to fill for a power the books give no stat block (the Fae)", () => {
		expect(settlementDataFromBook("the-fae")).toBeNull();
		expect(settlementDataFromBook("nowhere")).toBeNull();
	});

	it("makes a template band with its book name and pick-list note", () => {
		const data = settlementDataFromTemplate("hillfolk-band");
		expect(data.name).toBe("Hillfolk band");
		expect(data.system).toMatchObject({ size: "hamlet", sourceSlug: "hillfolk-band" });
		expect(data.system.stats.prosperity.value).toBe(-1);
		expect(data.system.setupNote).toMatch(/keep one/);
	});

	it("copies the block rather than sharing it, so editing a sheet can't edit the table", () => {
		const a = settlementDataFromBook("gordins-delve");
		a.system.resources[0].name = "Changed";
		expect(settlementDataFromBook("gordins-delve").system.resources[0].name).toBe("Mining");
	});

	it("falls back to a village for an unknown Size", () => {
		expect(settlementSystemFrom({ size: "metropolis" }).size).toBe("village");
	});
});

describe("Stonetop's standing with a settlement", () => {
	it("is keyed by roster slug for a named place, so the sheet and Stonetop's table share one rating", () => {
		expect(standingKey(actor("abc123", { sourceSlug: "marshedge" }))).toBe("marshedge");
	});

	it("is keyed by actor id for a template or homebrew place", () => {
		expect(standingKey(actor("abc123", { sourceSlug: "hillfolk-band" }))).toBe("abc123");
		expect(standingKey(actor("def456", { sourceSlug: "" }))).toBe("def456");
	});

	it("finds a named place's sheet, and tells the homebrew ones apart", () => {
		const actors = [
			actor("m1", { sourceSlug: "marshedge" }),
			actor("h1", { sourceSlug: "hillfolk-band" }),
			actor("m2", { sourceSlug: "marshedge" }),
			{ id: "s", type: "stonetop", system: {} },
		];
		const bySlug = settlementsBySlug(actors.filter(a => a.type === SETTLEMENT_TYPE));
		expect(bySlug.get("marshedge")?.id).toBe("m1");   // the first made wins
		expect(bySlug.get("lygos")).toBeUndefined();
		expect(customSettlementActors(actors).map(a => a.id)).toEqual(["h1"]);
	});

	// ST-1: after a reload the world lists actors by id, not by when they were made.
	it("keeps the oldest sheet for a place whatever order the world lists them in", async () => {
		const older = actor("zz", { sourceSlug: "marshedge" }, { _stats: { createdTime: 100 } });
		const newer = actor("aa", { sourceSlug: "marshedge" }, { _stats: { createdTime: 200 } });
		const { settlementActors } = await import("../../../module/actors/settlement/settlement-type.js");
		expect(settlementsBySlug(settlementActors([newer, older])).get("marshedge")).toBe(older);
		expect(settlementsBySlug(settlementActors([older, newer])).get("marshedge")).toBe(older);
	});
});

// ST-5: a Trade-with row's link follows its partner's name.
describe("tradePartnerSlug", () => {
	it("links a new row whose partner the roster knows, and none it doesn't", () => {
		expect(tradePartnerSlug("Marshedge")).toBe("marshedge");
		expect(tradePartnerSlug("gordin’s delve")).toBe("gordins-delve");
		expect(tradePartnerSlug("Lowland traders")).toBe("");
		expect(tradePartnerSlug("")).toBe("");
	});

	it("keeps a row's link while its partner keeps their name, however the book spelled it", () => {
		const was = { partner: "Marshedge (by the Highway)", goods: "grain", slug: "marshedge" };
		expect(tradePartnerSlug("Marshedge (by the Highway)", was)).toBe("marshedge");
	});

	it("moves the link to the place a renamed partner names, or drops it", () => {
		const was = { partner: "Marshedge", goods: "grain", slug: "marshedge" };
		expect(tradePartnerSlug("Gordin's Delve", was)).toBe("gordins-delve");
		expect(tradePartnerSlug("Some homebrew city", was)).toBe("");
	});
});

// ST-4: what the header chip shows and flips.
describe("settlementHiddenFromPlayers", () => {
	const gm = { id: "gm", isGM: true }, ann = { id: "ann", isGM: false }, bo = { id: "bo", isGM: false };

	it("is shown while the default lets players see it, and hidden once it doesn't", () => {
		expect(settlementHiddenFromPlayers({ default: 2 }, [gm, ann])).toBe(false);
		expect(settlementHiddenFromPlayers({ default: 0 }, [gm, ann])).toBe(true);
		expect(settlementHiddenFromPlayers({}, [gm, ann])).toBe(true);
	});

	it("is shown while a player has a seeing level of their own", () => {
		expect(settlementHiddenFromPlayers({ default: 0, ann: 1 }, [gm, ann])).toBe(false);
		expect(settlementHiddenFromPlayers({ default: 0, ann: -1 }, [gm, ann])).toBe(true);
	});

	it("leaves out a player who owns it, so a hidden place still reads hidden and can be shown again", () => {
		expect(settlementHiddenFromPlayers({ default: 0, ann: 3 }, [gm, ann, bo])).toBe(true);
		expect(settlementHiddenFromPlayers({ default: 2, ann: 3 }, [gm, ann, bo])).toBe(false);
	});
});

describe("redrawForSettlement", () => {
	const sheet = (doc, rendered = true) => ({ document: doc, rendered, render: vi.fn() });
	const stonetop = { id: "s", type: "stonetop", system: {} };
	const marshedge = actor("m1", { sourceSlug: "marshedge" });
	const lygos = actor("l1", { sourceSlug: "lygos" });
	afterEach(() => vi.unstubAllGlobals());
	const open = (...apps) => {
		vi.stubGlobal("ui", { windows: Object.fromEntries(apps.map((app, i) => [i, app])) });
		vi.stubGlobal("foundry", { utils: { hasProperty: (o, k) => k.split(".").reduce((v, p) => (v && p in v ? v[p] : undefined), o) !== undefined } });
		return apps;
	};

	it("redraws Stonetop and the other settlements when one comes or goes", () => {
		const [home, other, own, closed] = open(sheet(stonetop), sheet(lygos), sheet(marshedge), sheet(stonetop, false));
		redrawForSettlement(marshedge);
		expect(home.render).toHaveBeenCalledWith(false);
		expect(other.render).toHaveBeenCalledWith(false);
		expect(own.render).not.toHaveBeenCalled();      // core redraws a sheet for its own document
		expect(closed.render).not.toHaveBeenCalled();
	});

	it("redraws for what Stonetop's rows show, not for every write", () => {
		const [home] = open(sheet(stonetop));
		redrawForSettlement(marshedge, { system: { resources: [] } });
		expect(home.render).not.toHaveBeenCalled();
		redrawForSettlement(marshedge, { ownership: { default: 0 } });
		expect(home.render).toHaveBeenCalledTimes(1);
	});

	it("ignores any other actor", () => {
		const [home] = open(sheet(stonetop));
		redrawForSettlement({ id: "n", type: "npc" });
		expect(home.render).not.toHaveBeenCalled();
	});

	// ST-3: a compendium's or a token's copy is on no other sheet.
	it("ignores a compendium's or a token's settlement", () => {
		const [home] = open(sheet(stonetop));
		redrawForSettlement({ ...marshedge, pack: "world.places" });
		redrawForSettlement({ ...marshedge, isToken: true });
		expect(home.render).not.toHaveBeenCalled();
	});
});

describe("the settlement chooser", () => {
	it("offers each named place until it has a sheet, then the templates, then a blank one", () => {
		const ids = settlementSourceOptions(slug => slug === "marshedge").filter(o => o.id).map(o => o.id);
		expect(ids).toContain("book:gordins-delve");
		expect(ids).not.toContain("book:marshedge");
		expect(ids).not.toContain("book:the-fae");
		expect(ids).toContain("template:manmarch-hillfort");
		expect(ids.at(-1)).toBe("blank");
	});

	it("turns each row back into creation data", () => {
		expect(settlementDataForChoice("book:barrier-pass").name).toBe("Barrier Pass");
		expect(settlementDataForChoice("template:fortress-monastery").system.size).toBe("hamlet");
		expect(settlementDataForChoice("blank").system).toEqual({});
		expect(settlementDataForChoice("book:nowhere")).toBeNull();
	});
});

describe("rolling a settlement's moves", () => {
	const marshedge = systemOf(settlementDataFromBook("marshedge"));
	const band = systemOf(settlementDataFromTemplate("hillfolk-band"));
	const pass = systemOf(settlementDataFromBook("barrier-pass"));

	it("offers the four moves Book I p.508 names", () => {
		expect(SETTLEMENT_MOVES).toEqual(["tradeBarter", "muster", "deploy", "pullTogether"]);
	});

	it("rolls Trade & Barter off the place's own Prosperity, at a town's advantage, Value subtracted", async () => {
		const { statKey, options } = await settlementRollOptions(marshedge, "tradeBarter", { value: 2 });
		expect(statKey).toBe("prosperity");
		expect(options.statValue).toBe(2);
		expect(options.modifier).toBe(-2);
		expect(options.rollMode).toBe("adv");
		expect(options.moveName).toBe("Trade & Barter");
		expect(options.moveResults.success.value).toBeTruthy();
	});

	it("puts a hamlet's Muster at disadvantage (Book I p.509)", async () => {
		const { options } = await settlementRollOptions(band, "muster");
		expect(options.rollMode).toBe("dis");
	});

	it("leaves a village's Muster alone, and Size never touches Deploy", async () => {
		expect((await settlementRollOptions(pass, "muster")).options.rollMode).toBe("normal");
		expect((await settlementRollOptions(band, "deploy")).options.rollMode).toBe("normal");
	});

	it("cancels a town's advantage against winter's disadvantage on Trade & Barter", async () => {
		const { options } = await settlementRollOptions(marshedge, "tradeBarter", { winter: true });
		expect(options.rollMode).toBe("normal");
	});

	it("rolls Prosperity as 1 lower when a resource is ticked lacking", async () => {
		const lacking = { ...marshedge, resources: marshedge.resources.map((r, i) => ({ ...r, lacking: i === 0 })) };
		expect(settlementIsLacking(lacking)).toBe(true);
		const { options } = await settlementRollOptions(lacking, "tradeBarter");
		expect(options.statValue).toBe(1);
		expect(options.stonetopDebility).toBe("Lacking");
	});

	// Fortunes, Surplus and the debilities are Stonetop's alone; a settlement has none to bite.
	it("never rolls a settlement as Diminished", async () => {
		const { options } = await settlementRollOptions(pass, "deploy");
		expect(options.stonetopDebility).toBeUndefined();
		expect(options.rollMode).toBe("normal");
	});

	it("carries none of Stonetop's card buttons, only a miss's Mark XP", async () => {
		const pull = (await settlementRollOptions(pass, "pullTogether")).options;
		expect(pull.tierActions?.partial ?? "").toBe("");
		expect(pull.tierActions.failure).toMatch(/stonetop-steading-miss-xp/);
		// Trade & Barter's 6- says "don't mark XP" (p.540), so it carries none at all.
		expect((await settlementRollOptions(marshedge, "tradeBarter")).options.tierActions).toBeUndefined();
	});

	it("refuses a move that is not one of the four", async () => {
		expect(await settlementRollOptions(marshedge, "aurochsHunt")).toBeNull();
	});

	it("posts the roll as the settlement", async () => {
		const doc = actor("m1", marshedge);
		await rollSettlementMove(doc, "deploy", { situational: 1 });
		expect(rollStat).toHaveBeenCalledWith("defenses", doc, expect.objectContaining({ statValue: 1, modifier: 1 }));
	});
});

describe("a settlement is never a combatant", () => {
	it("stays out of fights", () => {
		expect(classifySide({ type: SETTLEMENT_TYPE })).toBeNull();
	});
});
