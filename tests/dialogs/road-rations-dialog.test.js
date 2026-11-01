import { describe, it, expect, beforeEach, vi } from "vitest";

// "N days pass" in the Expedition walkthrough (Book I p.89, p.304): the window reads the packs of
// the party on the trip, suggests who pays, lets the GM change any figure, and spends from each
// pack (provisions first) with a chat card saying who paid what. The arithmetic is
// tests/utils/road-rations.test.js; this is the reading and the writing.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

vi.mock("../../module/utils/world.js", () => ({
	getStonetopSteadingActor:       () => null,
	getStonetopSteadingActorOrWarn: () => null,
	isSteadingActor: () => false,
}));

// The camp's own readers of a pack, stood in for so the suite needs no character model.
// isUnliving is Death's Door's own rule, so a Ghost here is one by the insert they wear.
vi.mock("../../module/camp/camp-store.js", async () => ({
	campVitalsFor:       async actor => ({ messKit: !!actor.carriesMessKit }),
	isUnliving:          (await vi.importActual("../../module/actors/character/deaths-door-actor.js")).isUnliving,
	packResources:       actor => ({ ...actor.pack }),
	partyFollowerMouths: actor => actor.fed ?? 0,
	partyCrewMouths:     actor => actor.crewFed ?? 0,
	crewSuppliesOf:      actor => ({ held: actor.crewHeld ?? 0 }),
	// The pack, and the crew's supplies beside it written to one stand-in path.
	mealSpendTarget:     actor => ({
		resources:    { ...actor.pack, "crew-supplies": actor.crewHeld ?? 0 },
		resourceData: (slug, n) => (slug === "crew-supplies" ? { crewLeft: n } : actor.typedActor.inventoryResourceData(slug, n)),
	}),
}));
vi.mock("../../module/actors/character/follower-roster.js", () => ({ partyFollowersOf: async () => [] }));

const { RoadRationsDialog } = await import("../../module/dialogs/RoadRationsDialog.js");
const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

const SCOPE = "stonetop-pwd";

/** A PC whose pack is `pack`, recording every update it is sent. */
/** A PC wearing the `insert` post-death insert (ghost, revenant, thrall). */
function wearing(insert, id, pack, over = {}) {
	const flags = { [SCOPE]: { postDeathInsert: { slug: insert } } };
	return pc(id, pack, { flags, getFlag: (_s, key) => foundry.utils.getProperty(flags[SCOPE], key), ...over });
}

function pc(id, pack, over = {}) {
	const actor = {
		id, name: id, img: "", type: "character", flags: { [SCOPE]: {} },
		system: { playbook: { slug: "blessed" } },
		pack,
		updates: [],
		update: vi.fn(async (data, options) => { actor.updates.push({ data, options }); }),
		typedActor: { inventoryResourceData: (slug, n) => ({ [`flags.${SCOPE}.inventory.resources.${slug}`]: n }) },
		...over,
	};
	return actor;
}

let chat;
beforeEach(() => {
	chat = [];
	global.ChatMessage = { create: vi.fn(data => chat.push(data)), getSpeaker: () => ({ alias: "GM" }) };
	global.game = { i18n: global.game.i18n, user: { isGM: true } };
});

describe("the days-on-the-road window", () => {
	it("names who carries a mess kit but leaves the box unticked (p.304: only if someone uses it)", async () => {
		const ash = pc("Ash", { supplies: 4 }, { carriesMessKit: true });
		const bo = pc("Bo", { supplies: 4 });
		const d = new RoadRationsDialog([ash, bo], { days: 2 });
		const data = await d.getData();
		expect(data.messKit).toBe(false);
		expect(data.cooks).toBe("Ash");
		// Two mouths without one: 2 a day, 4 in all.
		expect(data.bill).toBe(4);
	});

	it("suggests who pays once the GM ticks the mess kit", async () => {
		const ash = pc("Ash", { supplies: 4 }, { carriesMessKit: true });
		const bo = pc("Bo", { supplies: 4 });
		const d = new RoadRationsDialog([ash, bo], { days: 2 });
		await d.getData();
		d._messKit = true;
		const data = await d.getData();
		expect(data.messKit).toBe(true);
		// Two mouths with a mess kit: 1 a day, 2 in all, split between them.
		expect(data.bill).toBe(2);
		expect(data.rows.map(r => r.pays)).toEqual([1, 1]);
	});

	// Code review 10-22 (HC-8): a pack eaten from while the window was open pays what it still holds, and the
	// card says the rest went short rather than naming uses nobody ate.
	it("names on the card only what the packs still held at the press", async () => {
		const ash = pc("Ash", { supplies: 2 });
		const d = new RoadRationsDialog([ash], { days: 2 });
		await d.getData();
		ash.pack = { supplies: 1 };
		await d._apply();
		expect(ash.updates[0].data).toEqual({ [`flags.${SCOPE}.inventory.resources.supplies`]: 0 });
		expect(chat[0].content).toContain("1 use (1 supplies)");
		expect(chat[0].content).toContain("Went short");
	});

	it("spends each pack provisions first, and posts who paid what", async () => {
		const ash = pc("Ash", { supplies: 4, provisions: 1 });
		const bo = pc("Bo", { supplies: 4 });
		const d = new RoadRationsDialog([ash, bo], { days: 2 });
		await d.getData();
		d._paid = { Ash: 3, Bo: 1 };
		await d._apply();
		expect(ash.update).toHaveBeenCalledTimes(1);
		expect(ash.updates[0].data).toEqual({
			[`flags.${SCOPE}.inventory.resources.provisions`]: 0,
			[`flags.${SCOPE}.inventory.resources.supplies`]: 2,
		});
		expect(ash.updates[0].options).toEqual({ stonetopMove: "On the road" });
		expect(bo.updates[0].data).toEqual({ [`flags.${SCOPE}.inventory.resources.supplies`]: 3 });
		expect(chat).toHaveLength(1);
		expect(chat[0].content).toContain("Days on the road");
		expect(chat[0].content).toContain("3 uses (1 provisions, 2 supplies)");
	});

	it("feeds a Marshal's crew from the crew's own supplies first, and only the rest from the packs", async () => {
		// Rook, a crew of 4 and Bo for 2 days: 12 uses. The crew's 6 held pay 6 of its 8; Rook's pack pays
		// Rook's 2 and the crew's other 2, and Bo's pays Bo's 2.
		const rook = pc("Rook", { supplies: 8 }, { fed: 4, crewFed: 4, crewHeld: 6 });
		const bo = pc("Bo", { supplies: 4 });
		const d = new RoadRationsDialog([rook, bo], { days: 2 });
		const data = await d.getData();
		expect(data.bill).toBe(12);
		expect(data.rows.map(r => r.pays)).toEqual([4, 2]);
		expect(data.rows[0]).toMatchObject({ crewPays: 6, crewHeld: 6 });
		expect(data.rows[0].crewText).toBe("Feeds the crew first: 6 of the 8 uses the crew eats. The other 2 come out of the packs.");
		expect(data.rows[1].crewText).toBe("");
		await d._apply();
		expect(rook.updates[0].data).toEqual({ crewLeft: 0, [`flags.${SCOPE}.inventory.resources.supplies`]: 4 });
		expect(bo.updates[0].data).toEqual({ [`flags.${SCOPE}.inventory.resources.supplies`]: 2 });
		expect(chat[0].content).toContain("6 uses from the crew");
		expect(chat[0].content).toContain("own supplies; 4 uses (4 supplies) from the pack");
	});

	it("draws the crew's supplies as a sentence, never a figure to set", async () => {
		const rook = pc("Rook", { supplies: 4 }, { fed: 2, crewFed: 2, crewHeld: 8 });
		const data = await new RoadRationsDialog([rook], { days: 1 }).getData();
		const html = await renderTemplate("systems/stonetop-pwd/templates/dialogs/road-rations.hbs", data);
		expect(html).toContain("Crew supplies (8 left): Feeds the crew first: 2 uses, all the crew eats.");
		expect(html.match(/class="road-pays/g)).toHaveLength(1);
	});

	// Unliving (Ghost and Revenant inserts): "You need not eat nor drink nor sleep." Their box starts
	// unticked, and the row says why, so a GM who ticks it knows what it costs.
	describe("a Ghost or Revenant on the trip", () => {
		const render = data => renderTemplate("systems/stonetop-pwd/templates/dialogs/road-rations.hbs", data);

		it("leaves a Ghost's Eats box unticked and says why, while their followers still eat", async () => {
			const wisp = wearing("ghost", "Wisp", { supplies: 4 }, { fed: 2 });
			const bo = pc("Bo", { supplies: 4 });
			const data = await new RoadRationsDialog([wisp, bo], { days: 1 }).getData();
			expect(data.rows.find(r => r.actorId === "Wisp").eats).toBe(false);
			// Bo and Wisp's two followers: 3 mouths.
			expect(data.bill).toBe(3);
			const html = await render(data);
			expect(html.match(/class="road-unliving"/g)).toHaveLength(1);
			expect(html).toContain("Needs no food or sleep (Unliving); their followers still eat.");
			// The Eats box points a screen reader at the reason.
			expect(html).toContain('id="road-unliving-Wisp"');
			expect(html).toMatch(/aria-label="Wisp eats" aria-describedby="road-unliving-Wisp"/);
			expect(html).not.toContain('aria-describedby="road-unliving-Bo"');
		});

		it("names no followers when none travel with them", async () => {
			const wisp = wearing("revenant", "Wisp", { supplies: 4 });
			const data = await new RoadRationsDialog([wisp], { days: 1 }).getData();
			expect(data.rows[0].unlivingText).toBe("Needs no food or sleep (Unliving).");
		});

		it("says they cost a mouth once the GM ticks their Eats box", async () => {
			const wisp = wearing("ghost", "Wisp", { supplies: 4 }, { fed: 1 });
			const d = new RoadRationsDialog([wisp], { days: 1 });
			await d.getData();
			d._eats.Wisp = true;
			const data = await d.getData();
			expect(data.bill).toBe(2);
			expect(data.rows[0].unlivingText).toBe("Needs no food or sleep (Unliving), but counted as a mouth here: untick Eats to leave them out.");
		});

		it("feeds a Thrall like anyone else", async () => {
			const data = await new RoadRationsDialog([wearing("thrall", "Grim", { supplies: 4 })], { days: 1 }).getData();
			expect(data.rows[0].eats).toBe(true);
			expect(data.rows[0].unlivingText).toBe("");
		});
	});

	it("writes nothing for days with a laden pack animal, but still says the days went by", async () => {
		const ash = pc("Ash", { supplies: 4 });
		const d = new RoadRationsDialog([ash], { days: 3 });
		await d.getData();
		d._packAnimal = true;
		await d._apply();
		expect(ash.update).not.toHaveBeenCalled();
		expect(chat[0].content).toContain("re-Outfit");
	});
});

describe("the Expedition walkthrough's button", () => {
	it("sits on Running the journey, for the GM", () => {
		const running = new ExpeditionDialog()._steps.find(s => s.key === "running");
		expect(running.roadDays).toBe(true);
	});

	it("feeds only the party on this trip, leaving out who the Outfit step toggled off", () => {
		const ash = pc("Ash", {});
		const bo = pc("Bo", {});
		global.game.actors = { contents: [ash, bo] };
		const d = Object.create(ExpeditionDialog.prototype);
		d._currentExpedition = () => ({ partyOut: { Bo: true } });
		expect(d._tripParty().map(a => a.id)).toEqual(["Ash"]);
	});
});
