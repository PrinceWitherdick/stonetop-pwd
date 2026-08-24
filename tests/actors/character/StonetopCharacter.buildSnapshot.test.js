import {afterEach, describe, expect, it} from "vitest";
import {CharacterSnapshot} from "../../../module/model/CharacterSnapshot.js";
import {OutfitItemBuilder} from "../../../module/model/OutfitItem.js";
import {FakePlaybookRepository} from "../../fakes/FakePlaybookRepository.js";
import {FakeInventoryRepository} from "../../fakes/FakeInventoryRepository.js";
import {TestCharacterBuilder} from "../../fakes/TestCharacterBuilder.js";
import {FakePostDeathInsertRepository} from "../../fakes/FakePostDeathInsertRepository.js";
import {FakeActorBuilder, FakeStatBuilder} from "../../fakes/FakeActorBuilder.js";

function makeOutfitItem(overrides = {}) {
	return new OutfitItemBuilder()
		.withSlug(overrides.slug ?? "test-item")
		.withName(overrides.name ?? "Test Item")
		.withWeight(overrides.weight ?? 1)
		.withNote(overrides.note ?? null)
		.withInventoryColumn(overrides.inventoryColumn ?? "regular")
		.withResource(overrides.resource ?? null)
		.withTwoCol(overrides.twoCol ?? false)
		.withSmallGrid(overrides.smallGrid ?? false)
		.withBreakBefore(overrides.breakBefore ?? false)
		.withArmor(overrides.armor ?? null)
		.withSpecial(overrides.special ?? false)
		.withSpecialCategory(overrides.specialCategory ?? null)
		.build();
}

afterEach(() => {
	delete global.game.actors;
});

// -- Playbook fixture ---------------------------------------------------------

const HEAVY_PLAYBOOK = {
	slug: "the-heavy",
	name: "The Heavy",
	img: "systems/stonetop-pwd/assets/playbooks/the-heavy.svg",
	description: "<p>You are the muscle.</p>",
	statsNote: "Put your highest stat in STR or CON.",
	hp: 20,
	damage: "d10",
	startingMovesNote: "Choose 2 to start.",
	specialPossessions: null,
	backgrounds: [
		{
			slug: "veteran",
			label: "Veteran",
			description: "<p>You fought in a war.</p>",
			moves: ["Harden"],
			choices: null,
			markableActions: {
				label: "Mark 1 at 1st level, then 3rd/5th/7th/9th.",
				levels: [1, 3, 5, 7, 9],
				options: [
					{slug: "act-a", label: "Action A"},
					{slug: "act-b", label: "Action B"},
					{slug: "act-c", label: "Action C"},
				],
			},
		},
		{
			slug: "mercenary",
			label: "Mercenary",
			description: "<p>You sold your sword.</p>",
			moves: ["Overcome"],
			choices: {
				label: "Choose one",
				count: [1, 1],
				options: [{slug: "iron-will", label: "Iron Will"}],
			},
		},
	],
	instincts: [
		{word: "Paranoia", description: "You see threats everywhere."},
		{word: "Protection", description: "You guard those who can't guard themselves."},
	],
	appearance: [
		["tall and broad", "lean and wiry", "slight"],
		["scarred", "unmarked", "tattooed"],
	],
	origin: [
		{region: "Stonetop", names: ["Brakken", "Corvin"]},
		{region: "Barrier Pass", names: ["Alagh", "Bora"]},
	],
};

function makeHeavyActor({items = [], flags = {}} = {}) {
	return new FakeActorBuilder()
		.withPlaybook("the-heavy", "The Heavy")
		.withItems(items)
		.withFlags(flags)
		.build();
}

// ── CharacterSnapshot class ───────────────────────────────────────────────────

describe("buildSnapshot — type", () => {
	it("returns a CharacterSnapshot instance", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap).toBeInstanceOf(CharacterSnapshot);
	});
});

// ── name ─────────────────────────────────────────────────────────────────────

describe("buildSnapshot — name", () => {
	it("uses actor.name", async () => {
		const actor = new FakeActorBuilder().withName("Jorvik").build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.name).toBe("Jorvik");
	});
});

// ── playbook (null when no playbook) ─────────────────────────────────────────

describe("buildSnapshot — playbook: null when no playbook selected", () => {
	it("playbook is null", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap.playbook).toBeNull();
	});
});

// ── playbook (populated) ─────────────────────────────────────────────────────

describe("buildSnapshot — playbook section", () => {
	async function buildSnap(flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK)).build().buildSnapshot();
	}

	it("includes slug, name, img, description, statsNote", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.slug).toBe("the-heavy");
		expect(snap.playbook.name).toBe("The Heavy");
		expect(snap.playbook.img).toBe("systems/stonetop-pwd/assets/playbooks/the-heavy.svg");
		expect(snap.playbook.description).toBe("<p>You are the muscle.</p>");
		expect(snap.playbook.statsNote).toBe("Put your highest stat in STR or CON.");
	});

	it("background.selected is null when none saved", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.background.selected).toBeNull();
	});

	it("background.selected reflects saved slug", async () => {
		const snap = await buildSnap({"background.selected": "veteran"});
		expect(snap.playbook.background.selected).toBe("veteran");
	});

	it("background.options has correct length and marks selected", async () => {
		const snap = await buildSnap({"background.selected": "mercenary"});
		expect(snap.playbook.background.options).toHaveLength(2);
		expect(snap.playbook.background.options[0].selected).toBe(false);
		expect(snap.playbook.background.options[1].selected).toBe(true);
	});

	it("background.options[n].moves is an array of slugs", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.background.options[0].moves).toEqual(["harden"]);
		expect(snap.playbook.background.options[1].moves).toEqual(["overcome"]);
	});

	it("background.options[n].choices is null when none defined", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.background.options[0].choices).toBeNull();
	});

	it("background.options[n].choices includes saved state", async () => {
		const snap = await buildSnap({"background.choices": {"iron-will": true}});
		const mercenary = snap.playbook.background.options[1];
		expect(mercenary.choices.saved).toEqual({"iron-will": true});
		expect(mercenary.choices.options[0].slug).toBe("iron-will");
	});

	it("background.options[n].markableActions is null when none defined", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.background.options[1].markableActions).toBeNull();
	});

	async function buildSnapAtLevel(level, flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withLevel(level)
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK)).build().buildSnapshot();
	}

	it("markableActions allows 1 mark at 1st level, with nothing marked", async () => {
		const snap = await buildSnapAtLevel(1);
		const veteran = snap.playbook.background.options[0];
		expect(veteran.markableActions.allowed).toBe(1);
		expect(veteran.markableActions.markedCount).toBe(0);
		expect(veteran.markableActions.options.map(o => o.checked)).toEqual([false, false, false]);
	});

	it("markableActions reflects a saved mark and locks the rest at the limit", async () => {
		const snap = await buildSnapAtLevel(1, {"background.markedActions": ["act-b"]});
		const opts = snap.playbook.background.options[0].markableActions.options;
		expect(snap.playbook.background.options[0].markableActions.markedCount).toBe(1);
		expect(opts.find(o => o.slug === "act-b").checked).toBe(true);
		// At the level-1 limit, the unmarked options are disabled (but the marked one is not).
		expect(opts.find(o => o.slug === "act-a").disabled).toBe(true);
		expect(opts.find(o => o.slug === "act-b").disabled).toBe(false);
	});

	it("markableActions unlocks a second mark at 3rd level", async () => {
		const snap = await buildSnapAtLevel(3, {"background.markedActions": ["act-a"]});
		const markable = snap.playbook.background.options[0].markableActions;
		expect(markable.allowed).toBe(2);
		// One marked, one slot left → remaining option still selectable.
		expect(markable.options.find(o => o.slug === "act-b").disabled).toBe(false);
	});

	it("instinct.selected is null when none saved", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.instinct.selected).toBeNull();
	});

	it("instinct.selected reflects saved value", async () => {
		const snap = await buildSnap({"instinct.selected": "Paranoia — You see threats everywhere."});
		expect(snap.playbook.instinct.selected).toBe("Paranoia — You see threats everywhere.");
	});

	it("instinct.options has word, description, value, and selected", async () => {
		const snap = await buildSnap();
		const opt = snap.playbook.instinct.options[0];
		expect(opt.word).toBe("Paranoia");
		expect(opt.description).toBe("You see threats everywhere.");
		expect(opt.value).toBe("Paranoia — You see threats everywhere.");
		expect(opt.selected).toBe(false);
	});

	it("instinct.options[n].selected is true when instinct matches saved", async () => {
		const snap = await buildSnap({"instinct.selected": "Paranoia — You see threats everywhere."});
		expect(snap.playbook.instinct.options[0].selected).toBe(true);
		expect(snap.playbook.instinct.options[1].selected).toBe(false);
	});

	it("appearance.options is array of {lineIdx, options} objects", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.appearance.options).toHaveLength(2);
		expect(snap.playbook.appearance.options[0].lineIdx).toBe(0);
		expect(snap.playbook.appearance.options[1].lineIdx).toBe(1);
		expect(snap.playbook.appearance.options[0].options[0]).toMatchObject({value: "tall and broad", selected: false});
	});

	it("appearance.options[n].options[n].selected is true when saved", async () => {
		const snap = await buildSnap({"appearance.selected": {0: "tall and broad", 1: "scarred"}});
		expect(snap.playbook.appearance.options[0].options.find(o => o.value === "tall and broad").selected).toBe(true);
		expect(snap.playbook.appearance.options[1].options.find(o => o.value === "scarred").selected).toBe(true);
	});

	// A line can be WRITTEN IN rather than picked — the onboarding wizard offers it on the
	// appearance step and the Details tab's own heading says "or make something up". A
	// written-in value matches no suggestion, so every reader that only looked for a ticked
	// option showed nothing: a character created with custom lines had a blank appearance.
	it("appearance line reads out a written-in value as well as a ticked suggestion", async () => {
		const snap = await buildSnap({"appearance.selected": {0: "built like a barn door", 1: "scarred"}});
		const [custom, picked] = snap.playbook.appearance.options;
		expect(custom.isCustom).toBe(true);
		expect(custom.customValue).toBe("built like a barn door");
		expect(custom.value).toBe("built like a barn door");
		expect(custom.options.some(o => o.selected)).toBe(false);
		expect(picked.isCustom).toBe(false);
		expect(picked.customValue).toBe("");
		expect(picked.value).toBe("scarred");
	});

	it("appearance.summary includes written-in lines", async () => {
		const snap = await buildSnap({"appearance.selected": {0: "built like a barn door", 1: "scarred"}});
		expect(snap.playbook.appearance.summary).toBe("Built like a barn door · scarred");
	});

	// The Details tab hides a section it reads as never filled in (detailsShow keys off
	// summary), so an all-written-in character used to lose the section entirely.
	it("appearance.summary is non-empty when every line was written in", async () => {
		const snap = await buildSnap({"appearance.selected": {0: "wiry", 1: "inked all over"}});
		expect(snap.playbook.appearance.summary).toBe("Wiry · inked all over");
	});

	it("appearance.summary is empty when nothing is chosen", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.appearance.summary).toBe("");
		expect(snap.playbook.appearance.options.every(l => l.value === "")).toBe(true);
	});

	it("origin.selected is null when none saved", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.origin.selected).toBeNull();
	});

	it("origin.selected reflects saved region", async () => {
		const snap = await buildSnap({"origin.selected": "Stonetop"});
		expect(snap.playbook.origin.selected).toBe("Stonetop");
	});

	it("origin.options has region and names", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.origin.options[0].region).toBe("Stonetop");
		expect(snap.playbook.origin.options[0].names.map(n => n.name)).toContain("Brakken");
	});

	it("origin.options includes setting overview descriptions", async () => {
		const snap = await buildSnap({"origin.selected": "Barrier Pass"});
		const origin = snap.playbook.origin.selectedOption;
		expect(origin.region).toBe("Barrier Pass");
		expect(origin.description).toContain("<p>");
		expect(origin.description).toContain("massive wall and gate");
	});
});

// ── debilities ────────────────────────────────────────────────────────────────

describe("buildSnapshot — debilities", () => {
	it("returns array of 3 debilities", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap.debilities).toHaveLength(3);
	});

	it("each debility has key, name, active, stats fields", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		const w = snap.debilities[0];
		expect(w.key).toBe("weakened");
		expect(w.name).toBe("Weakened");
		expect(w.active).toBe(false);
		expect(w.stats).toEqual(["str", "dex"]);
	});

	it("weakened active=true when actor flag is set", async () => {
		const actor = new FakeActorBuilder().withDebility("weakened", true).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		const weakened = snap.debilities.find(d => d.key === "weakened");
		expect(weakened.active).toBe(true);
	});

	it("dazed maps to int and wis", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		const dazed = snap.debilities.find(d => d.key === "dazed");
		expect(dazed.stats).toEqual(["int", "wis"]);
	});

	it("miserable maps to con and cha", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		const miserable = snap.debilities.find(d => d.key === "miserable");
		expect(miserable.stats).toEqual(["con", "cha"]);
	});
});

// ── stats ─────────────────────────────────────────────────────────────────────

describe("buildSnapshot — stats", () => {
	it("includes all six stats with value, name, abbr", async () => {
		const actor = new FakeActorBuilder().withStats(new FakeStatBuilder()
			.withStr(2)
			.withDex(1)
			.withCon(0)
			.withInt(-1)
			.withWis(1)
			.withCha(0))
			.build();

		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.stats.str.value).toBe(2);
		expect(snap.stats.str.name).toBe("Strength");
		expect(snap.stats.str.abbr).toBe("STR");
		expect(snap.stats.dex.name).toBe("Dexterity");
		expect(snap.stats.dex.abbr).toBe("DEX");
		expect(snap.stats.con.abbr).toBe("CON");
		expect(snap.stats.int.abbr).toBe("INT");
		expect(snap.stats.wis.abbr).toBe("WIS");
		expect(snap.stats.cha.abbr).toBe("CHA");
	});

	it("stats have no debilityKey field", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).build().buildSnapshot();
		expect(snap.stats.str).not.toHaveProperty("debilityKey");
	});
});

// ── vitals ────────────────────────────────────────────────────────────────────

describe("buildSnapshot — vitals", () => {
	it("hp.max comes from playbook.hp (not system.attributes.hp.max)", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withHp(15, 99)
			.build();

		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();
		expect(snap.vitals.hp.max).toBe(20);
	});

	it("hp.value from system.attributes.hp.value", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").withHp(12, 20).build();
		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();

		expect(snap.vitals.hp.value).toBe(12);
	});

	it("hp is {value:0, max:0} when no playbook", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap.vitals.hp).toMatchObject({value: 0, max: 0});
	});

	it("damage from playbook when playbook present", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").build();
		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();
		expect(snap.vitals.damage).toBe("d10");
	});

	it("damage is null when no playbook", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).build().buildSnapshot();
		expect(snap.vitals.damage).toBeNull();
	});

	it("a hand-set damage die overrides the playbook's, and damageBase keeps the playbook's", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withDamage("d8", "d8")
			.build();
		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();
		expect(snap.vitals.damage).toBe("d8");
		expect(snap.vitals.damageBase).toBe("d10");
	});

	it("a loosely typed override is normalized to a d# die", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withDamage("d10", " 1D8 ")
			.build();
		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();
		expect(snap.vitals.damage).toBe("d8");
	});

	it("a blank override leaves the playbook die in charge", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withDamage("d10", "")
			.build();
		const snap = await new TestCharacterBuilder(actor).addPlaybook(HEAVY_PLAYBOOK).build().buildSnapshot();
		expect(snap.vitals.damage).toBe("d10");
	});

	it("an override stands on a character with no playbook", async () => {
		const actor = new FakeActorBuilder().withDamage("d4", "d8").build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.vitals.damage).toBe("d8");
		expect(snap.vitals.damageBase).toBeNull();
	});

	it("armor is derived from checked inventory items", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"thick-hides": true, "shield": true})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([
				makeOutfitItem({ slug: "thick-hides", armor: { base: 1 } }),
				makeOutfitItem({ slug: "shield",      armor: { modifier: 1 } }),
			]))
			.build().buildSnapshot();
		expect(snap.vitals.armor).toBe(2);
	});

	it("a checked possession-granted cuirass (custom item) adds its armor", async () => {
		const cuirass = {
			_id: "cuirass-1", type: "move", name: "Boiled leather cuirass (1 armor)",
			system: { moveType: "inventory-custom", inventoryColumn: "regular", weight: 1, armor: { modifier: 1 }, sourcePossession: "tannery" },
		};
		const worn = new FakeActorBuilder().withItems([cuirass]).withFlag("inventory.checked", { "cuirass-1": true }).build();
		const wornSnap = await new TestCharacterBuilder(worn).build().buildSnapshot();
		expect(wornSnap.vitals.armor).toBe(1);

		// Unchecked (owned but not worn) → no armor.
		const stowed = new FakeActorBuilder().withItems([cuirass]).build();
		const stowedSnap = await new TestCharacterBuilder(stowed).build().buildSnapshot();
		expect(stowedSnap.vitals.armor).toBe(0);
	});

	it("level is a plain number", async () => {
		const actor = new FakeActorBuilder().withLevel(4).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.vitals.level).toBe(4);
		expect(typeof snap.vitals.level).toBe("number");
	});

	it("xp.max = 6 + level * 2", async () => {
		const actor = new FakeActorBuilder().withLevel(6).withXp(5, 8).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.vitals.xp.max).toBe(18);
	});

	it("xp.value from system.attributes.xp.value", async () => {
		const actor = new FakeActorBuilder().withXp(5, 8).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.vitals.xp.value).toBe(5);
	});
});

// ── moves ─────────────────────────────────────────────────────────────────────

describe("buildSnapshot — moves", () => {
	function makeMove(id, name, overrides = {}) {
		return {
			_id: id, name,
			system: {moveType: "playbook", isStartingMove: false, rollType: null, ...overrides},
		};
	}

	function makeBasicMove(id, name, rollType = "ask") {
		return {_id: id, name, system: {moveType: "basic", rollType}};
	}

	it("moves is an empty array when no playbook and no basic moves", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).build().buildSnapshot();
		expect(snap.moves).toEqual([]);
	});

	it("basic moves appear as a category when present", async () => {
		const basic = makeBasicMove("b1", "Defy Danger", "ask");
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).addBasicMove(basic).build().buildSnapshot();
		const basicCat = snap.moves.find(c => c.key === "basic");
		expect(basicCat).toBeDefined();
		expect(basicCat.title).toBe("Basic Moves");
		expect(basicCat.note).toBeNull();
		expect(basicCat.moves[0].name).toBe("Defy Danger");
	});

	it("labels basic move roll chips by stat, using ANY for ask-roll moves", async () => {
		const askMove = makeBasicMove("b1", "Defy Danger", "ask");
		const wisMove = makeBasicMove("b2", "Seek Insight", "wis");
		const noRollMove = makeBasicMove("b3", "Aid", null);
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.addBasicMove(askMove)
			.addBasicMove(wisMove)
			.addBasicMove(noRollMove)
			.build()
			.buildSnapshot();
		const labels = Object.fromEntries(snap.moves
			.find(c => c.key === "basic")
			.moves
			.map(move => [move.name, move.rollLabel]));

		expect(labels).toMatchObject({
			"Defy Danger": "ANY",
			"Seek Insight": "WIS",
			"Aid": null,
		});
	});

	it("playbook moves category title is '{Playbook Name} Moves'", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Harden");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const pbCat = snap.moves.find(c => c.key === "playbook");
		expect(pbCat.title).toBe("The Heavy Moves");
	});

	it("playbook moves category note comes from startingMovesNote", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Harden");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		expect(snap.moves.find(c => c.key === "playbook").note).toBe("Choose 2 to start.");
	});

	it("playbook move source is { type: 'playbook', slug }", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Harden");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.source).toEqual({type: "playbook", slug: "the-heavy"});
	});

	it("basic move source is { type: 'basic' }", async () => {
		const basic = makeBasicMove("b1", "Defy Danger");
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.addBasicMove(basic)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "basic").moves[0];
		expect(move.source).toEqual({type: "basic"});
	});

	it("owned playbook move has owned=true and ownedIds populated", async () => {
		const actor =  new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "o1", type: "move", name: "Harden", system: {moveType: "playbook"}})
			.build();
		const entry = makeMove("pm1", "Harden");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.owned).toBe(true);
		expect(move.ownedIds).toContain("o1");
	});

	it("budgeted markOptions move exposes a spent pick budget and locks unchosen options", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "vc1", type: "move", name: "Veteran Crew", system: {moveType: "playbook"}})
			.withFlags({ "moves.moveMarks": { "Veteran Crew": { tags: [{ stat: "", level: 3 }] } } })
			.build();
		const entry = makeMove("pm1", "Veteran Crew", {
			markBudget: { base: 1, perExtra: 1 },
			markOptions: [
				{ slug: "tags",    label: "Tags", marks: 4 },
				{ slug: "crew-hp", label: "HP",   marks: 4 },
			],
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();

		const move = snap.moves.find(c => c.key === "playbook").moves.find(m => m.name === "Veteran Crew");
		// 1 owned copy ⇒ budget 1; one tag already chosen ⇒ fully spent, no pending choice.
		expect(move.markBudget).toMatchObject({ used: 1, max: 1, atBudget: true, over: false, needsChoice: false });
		// Every UNchosen box locks once the budget is spent…
		expect(move.markOptions.find(o => o.slug === "crew-hp").checks.every(c => c.disabled)).toBe(true);
		// …but the already-chosen box stays editable so the pick can be released.
		expect(move.markOptions.find(o => o.slug === "tags").checks[0]).toMatchObject({ checked: true, disabled: false });
	});

	it("omits the pick budget for a markOptions move that declares none", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "pg1", type: "move", name: "Uncapped", system: {moveType: "playbook"}})
			.build();
		const entry = makeMove("pm1", "Uncapped", { markOptions: [{ slug: "a", label: "A", marks: 2 }] });
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves.find(m => m.name === "Uncapped");
		expect(move.markBudget).toBeNull();
		expect(move.markOptions.find(o => o.slug === "a").checks.every(c => !c.disabled)).toBe(true);
	});

	it("over-budget grandfathered marks expose over=true and keep chosen boxes editable while locking the rest", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "vc1", type: "move", name: "Veteran Crew", system: {moveType: "playbook"}})
			.withFlags({ "moves.moveMarks": { "Veteran Crew": { tags: [{ stat: "", level: 2 }, { stat: "", level: 2 }, { stat: "", level: 2 }] } } })
			.build();
		const entry = makeMove("pm1", "Veteran Crew", {
			markBudget: { base: 1, perExtra: 1 },
			markOptions: [
				{ slug: "tags",    label: "Tags", marks: 4 },
				{ slug: "crew-hp", label: "HP",   marks: 4 },
			],
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();

		const move = snap.moves.find(c => c.key === "playbook").moves.find(m => m.name === "Veteran Crew");
		// 1 owned ⇒ budget 1, but 3 tags marked ⇒ over budget.
		expect(move.markBudget).toMatchObject({ used: 3, max: 1, atBudget: true, over: true });
		// The 3 chosen tag boxes stay editable so the player can release back down…
		expect(move.markOptions.find(o => o.slug === "tags").checks.slice(0, 3).every(c => c.checked && !c.disabled)).toBe(true);
		// …while a different option's unchosen boxes are all locked.
		expect(move.markOptions.find(o => o.slug === "crew-hp").checks.every(c => c.disabled)).toBe(true);
	});

	it("an UNowned budgeted move grants 0 picks and locks every mark box", async () => {
		const actor = makeHeavyActor(); // does not own the move
		const entry = makeMove("pm1", "Veteran Crew", {
			markBudget: { base: 1, perExtra: 1 },
			markOptions: [{ slug: "tags", label: "Tags", marks: 4 }],
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves.find(m => m.name === "Veteran Crew");
		expect(move.owned).toBe(false);
		expect(move.markBudget).toMatchObject({ used: 0, max: 0, atBudget: true, needsChoice: false });
		expect(move.markOptions.find(o => o.slug === "tags").checks.every(c => c.disabled)).toBe(true);
	});

	it("flags needsChoice when an owned budgeted move still has unspent picks", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "vc1", type: "move", name: "Veteran Crew", system: {moveType: "playbook"}})
			.addItem({_id: "vc2", type: "move", name: "Veteran Crew", system: {moveType: "playbook"}})
			.withFlags({ "moves.moveMarks": { "Veteran Crew": { tags: [{ stat: "", level: 2 }] } } })
			.build();
		const entry = makeMove("pm1", "Veteran Crew", {
			markBudget: { base: 1, perExtra: 1 },
			markOptions: [{ slug: "tags", label: "Tags", marks: 4 }, { slug: "crew-hp", label: "HP", marks: 4 }],
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves.find(m => m.name === "Veteran Crew");
		// 2 owned ⇒ budget 2, only 1 chosen ⇒ a pick is still pending → the "needs input" cue.
		expect(move.markBudget).toMatchObject({ used: 1, max: 2, atBudget: false, needsChoice: true });
		// Budget not spent ⇒ boxes remain pickable (not locked).
		expect(move.markOptions.find(o => o.slug === "crew-hp").checks.every(c => !c.disabled)).toBe(true);
	});

	it("computes companionBonuses from Beast of Legend marks + Magnificent Specimen count", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "bol1", type: "move", name: "Beast of Legend",      system: {moveType: "playbook"}})
			.addItem({_id: "ms1",  type: "move", name: "Magnificent Specimen", system: {moveType: "playbook"}})
			.withFlags({ "moves.moveMarks": { "Beast of Legend": { tough: [{ stat: "", level: 6 }] } } })
			.build();
		const entry = makeMove("pm1", "Beast of Legend", {
			markOptions: [{ slug: "tough", label: "+4 HP +1 armor", marks: 3, companionHp: 4, companionArmor: 1 }],
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		// "tough" marked once ⇒ +4 HP / +1 armor; one Magnificent Specimen ⇒ +2 trait picks.
		expect(snap.companionBonuses).toEqual({ hp: 4, armor: 1, traitPicks: 2 });
	});

	it("groups granted foreign moves into a 'Learned Moves' category with a source label", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-fox", "The Fox")
			.addItem({
				_id: "fm1", type: "move", name: "Smash",
				system: { moveType: "playbook", playbook: "The Heavy", description: "Smash desc", rollType: "str" },
				flags: { "stonetop-pwd": { grantedBy: { move: "Versatile", instanceId: "v1" } } },
			})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		const learned = snap.moves.find(c => c.key === "learned");
		expect(learned).toBeDefined();
		expect(learned.title).toBe("Learned Moves");
		expect(learned.moves[0]).toMatchObject({
			name: "Smash",
			owned: true,
			rollType: "str",
			sourceLabel: "Granted by Versatile · The Heavy",
		});
	});

	// A foreign move dropped straight onto the sheet from the compendium carries no
	// `grantedBy` flag, and its own playbook keeps it out of the playbook category — so it
	// used to render in NO category: invisible on the sheet, yet owned, which also hid its
	// name from the Versatile picker (that skips names the actor already owns). The player
	// could see neither the move nor any way to get rid of it.
	it("shows an UNFLAGGED foreign move under Learned Moves, labeled with its origin playbook", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-would-be-hero", "The Would-Be Hero")
			.addItem({
				_id: "stray1", type: "move", name: "Smash",
				system: { moveType: "playbook", playbook: "The Heavy", description: "Smash desc", rollType: "str" },
			})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		const learned = snap.moves.find(c => c.key === "learned");
		expect(learned.moves.map(m => m.name)).toEqual(["Smash"]);
		// No granter to name, so it wears the origin playbook alone — not "Granted by —".
		expect(learned.moves[0]).toMatchObject({ owned: true, ownedId: "stray1", sourceLabel: "The Heavy" });
	});

	// The catch-all must not double-render: a move the playbook category already shows
	// belongs there and nowhere else.
	it("does NOT re-list an own-playbook move the playbook category already shows", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({ _id: "o1", type: "move", name: "Bravo", system: { moveType: "playbook" } })
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(makeMove("pm2", "Bravo"))
			.build().buildSnapshot();
		expect(snap.moves.find(c => c.key === "playbook").moves.map(m => m.name)).toEqual(["Bravo"]);
		expect(snap.moves.find(c => c.key === "learned")).toBeUndefined();
	});

	it("owned playbook moves are listed before unowned playbook moves", async () => {
		const actor =  new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "o1", type: "move", name: "Bravo", system: {moveType: "playbook"}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(makeMove("pm1", "Alpha"))
			.addPlaybookMove(makeMove("pm2", "Bravo"))
			.addPlaybookMove(makeMove("pm3", "Charlie"))
			.build().buildSnapshot();

		const names = snap.moves.find(c => c.key === "playbook").moves.map(m => m.name);
		expect(names).toEqual(["Bravo", "Alpha", "Charlie"]);
	});

	it("movelist splits playbook moves into owned and unowned render groups", async () => {
		const actor =  new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "o1", type: "move", name: "Bravo", system: {moveType: "playbook"}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(makeMove("pm1", "Alpha"))
			.addPlaybookMove(makeMove("pm2", "Bravo"))
			.addPlaybookMove(makeMove("pm3", "Charlie"))
			.build().buildSnapshot();

		expect(snap.movelist.playbookMoves.map(m => m.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
		expect(snap.movelist.playbookMovesOwned.map(m => m.name)).toEqual(["Bravo"]);
		expect(snap.movelist.playbookMovesUnowned.map(m => m.name)).toEqual(["Alpha", "Charlie"]);
	});

	// The Moves tab heads each of the playbook's three onboarding clusters, so the
	// movelist carries the same moves a second time, bucketed — each group keeping the
	// owned / un-owned split "Hide un-learned moves" reads.
	it("movelist buckets playbook moves into the playbook's onboarding groups", async () => {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.addItem({_id: "o1", type: "move", name: "Armored", system: {moveType: "playbook"}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(makeMove("pm1", "Berserker"))
			.addPlaybookMove(makeMove("pm2", "Armored"))
			.addPlaybookMove(makeMove("pm3", "Guardian"))
			.addPlaybookMove(makeMove("pm4", "Improved Stat"))
			.build().buildSnapshot();

		const groups = snap.movelist.playbookMoveGroups;
		expect(groups.map(g => [g.key, g.moves.map(m => m.name)])).toEqual([
			["offense",   ["Berserker"]],
			["defense",   ["Armored", "Guardian"]],
			["ungrouped", ["Improved Stat"]],
		]);
		const defense = groups.find(g => g.key === "defense");
		expect(defense.ownedMoves.map(m => m.name)).toEqual(["Armored"]);
		expect(defense.unownedMoves.map(m => m.name)).toEqual(["Guardian"]);
	});

	// [] is what tells the Moves tab to fall back to one flat owned/un-owned list.
	it("movelist leaves the move groups empty for a playbook with none defined", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.addBasicMove(makeBasicMove("b1", "Aid"))
			.build().buildSnapshot();

		expect(snap.movelist.playbookMoveGroups).toEqual([]);
	});

	it("owned basic moves are listed before unowned basic moves", async () => {
		const actor =  new FakeActorBuilder()
			.addItem({_id: "o1", type: "move", name: "Defy Danger", system: {moveType: "basic"}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.addBasicMove(makeBasicMove("b1", "Aid"))
			.addBasicMove(makeBasicMove("b2", "Defy Danger"))
			.build().buildSnapshot();

		const names = snap.moves.find(c => c.key === "basic").moves.map(m => m.name);
		expect(names).toEqual(["Defy Danger", "Aid"]);
	});

	it("unowned move has owned=false and ownedIds=[]", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Harden");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.owned).toBe(false);
		expect(move.ownedIds).toEqual([]);
	});

	it("locked move (unmet move requirement) has locked=true and requirement.met=false", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm2", "Locked Move", {requirement: {moves: ["Harden"]}});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.locked).toBe(true);
		expect(move.requirement.met).toBe(false);
	});

	it("move with resource has unified resource shape", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Resource Move", {resource: {max: 4, title: "Favor", labels: []}});
		const char = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build();
		actor.flags.stonetop["moves.backgroundChoices"] = {"Resource Move": 2};
		const snap = await char.buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.resource).toMatchObject({current: 2, max: 4, title: "Favor", labels: []});
	});

	it("move without resource has resource=null", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Simple Move");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.resource).toBeNull();
	});

	it("repeatable move has repeat: { max, current }", async () => {
		const actor = makeHeavyActor({
			items: [
				{_id: "r1", type: "move", name: "Big Move", system: {moveType: "playbook"}},
			]
		});
		const entry = makeMove("pm1", "Big Move", {repeatMax: 3});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.repeat).toEqual({max: 3, current: 1});
	});

	it("non-repeatable move has repeat=null", async () => {
		const actor = makeHeavyActor();
		const entry = makeMove("pm1", "Simple Move");
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.addPlaybookMove(entry)
			.addPlaybookMove(entry)
			.build().buildSnapshot();
		const move = snap.moves.find(c => c.key === "playbook").moves[0];
		expect(move.repeat).toBeNull();
	});

	it("categories with no moves are excluded", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		const keys = snap.moves.map(c => c.key);
		expect(keys).not.toContain("playbook");
		expect(keys).not.toContain("background");
	});
});

// ── inventory.outfit ─────────────────────────────────────────────────────────

describe("buildSnapshot — inventory.outfit", () => {
	it("load.selected is derived from the marked ◇ (here the undefined pool)", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.regularPool", 7).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.load.selected).toBe("heavy");
		expect(snap.inventory.outfit.load.totalMarks).toBe(7);
	});

	it("load.selected is derived from checked item weight", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.checked", {"big-load": true}).build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "big-load", weight: 5})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.load.selected).toBe("normal");
		expect(snap.inventory.outfit.load.totalMarks).toBe(5);
	});

	it("load.selected is null when nothing is marked", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap.inventory.outfit.load.selected).toBeNull();
		expect(snap.inventory.outfit.load.totalMarks).toBe(0);
	});

	it("flags an overloaded load when checked weight exceeds the heavy cap", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.checked", {"anvil": true}).build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "anvil", weight: 11})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.load.selected).toBe("overloaded");
		expect(snap.inventory.outfit.load.loadLevelOverloaded).toBe(true);
		expect(snap.inventory.outfit.load.loadLevelHeavy).toBe(true);
	});

	it("regularPool current reflects the stored undefined ◇ pool, capped to the heavy cap", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.regularPool", 5).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.regularPool).toMatchObject({current: 5, max: 9, title: null, labels: []});
	});

	it("regularPool always shows the full heavy cap of slots, regardless of checked item weight", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"big-load": true})
			.withFlag("inventory.regularPool", 7)
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "big-load", weight: 6})]))
			.build().buildSnapshot();
		// The 9-◇ track never collapses: only 3 fit under the cap (so 3 stay filled), but
		// the row still shows all 9 — the rest render as empty ◇ rather than vanishing.
		expect(snap.inventory.outfit.regularPool).toMatchObject({current: 3, max: 9});
	});

	it("regularPool reserve drawn into an item shows as empty ◇, not a collapsed track", async () => {
		// Reserve was 7; checking a weight-4 item drew all 4 from it, leaving 3 stored.
		// The 4 drawn ◇ moved onto the item; the track still shows the full cap, so they
		// read as empty slots instead of disappearing.
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"big-load": true})
			.withFlag("inventory.drawn", {"big-load": 4})
			.withFlag("inventory.regularPool", 3)
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "big-load", weight: 4})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularPool).toMatchObject({current: 3, max: 9});
	});

	it("regularPool keeps the full track as loot fills it, with the cap reporting room left", async () => {
		// Weight-6 item leaves only 3 ◇ of room under the cap. The track still shows all 9
		// (current 3 filled, the rest empty); the reservable ceiling (cap) is the room left.
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"big-load": true})
			.withFlag("inventory.regularPool", 3)
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "big-load", weight: 6})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularPool).toMatchObject({current: 3, max: 9});
		// The cap is the room left under the load limit (3) — clicking an empty slot past
		// it is what the "at your limit" toast guards.
		expect(snap.inventory.outfit.regularPoolCap).toBe(3);
	});

	it("regularPool stays at the heavy cap when overloaded (no 10th ◇ without Pack Horse)", async () => {
		// Overloaded by a heavy item: no room for any reserve (current 0), but the track
		// still shows the full 9-◇ capacity — all empty — rather than collapsing or growing.
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"anvil": true})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "anvil", weight: 11})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.load.selected).toBe("overloaded");
		expect(snap.inventory.outfit.regularPool).toMatchObject({current: 0, max: 9});
	});

	it("Pack Horse raises the ◇ track to 10", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Pack Horse", system: {moveType: "playbook", loadBonus: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.regularPool.max).toBe(10);
	});

	it("smallPool always shows exactly the 4+Prosperity allotment of boxes", async () => {
		// Marking small items never collapses the track: it stays at the full allotment,
		// with marked items' boxes rendering as empties rather than vanishing.
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"trinket": true})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "trinket", inventoryColumn: "small"})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.smallPool.max).toBe(9); // default 4+Prosperity allotment
	});

	it("pool caps report the room left under the load limit for the at-limit toast", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.checked", {"big-load": true})
			.withFlag("inventory.smallPool", 2)
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([makeOutfitItem({slug: "big-load", weight: 6})]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularPoolCap).toBe(3); // 9 heavy − 6 marked weight
		expect(snap.inventory.outfit.smallPoolCap).toBe(9);   // no small items marked
	});

	it("smallPool has unified resource shape", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.smallPool", 0).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.smallPool).toMatchObject({current: 0, max: 9, title: null, labels: []});
	});

	it("uses base load caps and names no load-bonus source when no move grants one", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).build().buildSnapshot();
		expect(snap.inventory.outfit.loadBonus).toBe(0);
		expect(snap.inventory.outfit.loadBonusMoves).toEqual([]);
		expect(snap.inventory.outfit.loadBonusFrom).toBe("");
		expect(snap.inventory.outfit.loadLimits).toEqual({light: 3, normal: 6, heavy: 9});
		expect(snap.inventory.outfit.loadBands).toEqual({light: "3", normal: "4–6", heavy: "7–9"});
		expect(snap.inventory.outfit.regularPool.max).toBe(9);
	});

	it("raises the load caps by one when the Pack Horse move is owned, and names it", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Pack Horse", system: {moveType: "playbook", loadBonus: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.loadBonus).toBe(1);
		expect(snap.inventory.outfit.loadBonusFrom).toBe("Pack Horse");
		expect(snap.inventory.outfit.loadLimits).toEqual({light: 4, normal: 7, heavy: 10});
		expect(snap.inventory.outfit.loadBands).toEqual({light: "4", normal: "5–7", heavy: "8–10"});
		expect(snap.inventory.outfit.regularPool.max).toBe(10);
	});

	// The bonus is a move FIELD, not the Ranger's move by name: a custom or world-authored
	// move carrying a loadBonus raises the caps just as well, and the notes that explain the
	// raised caps have to say which move did it rather than claiming a packhorse.
	it("names a custom move that granted the load bonus, not Pack Horse", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Bear the Standard", system: {moveType: "other", loadBonus: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.loadBonusFrom).toBe("Bear the Standard");
		expect(snap.inventory.outfit.loadLimits).toEqual({light: 4, normal: 7, heavy: 10});
	});

	it("names every granting move when two of them stack", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Pack Horse", system: {moveType: "playbook", loadBonus: 1}})
			.addItem({type: "move", name: "Bear the Standard", system: {moveType: "other", loadBonus: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.loadBonus).toBe(2);
		expect(snap.inventory.outfit.loadBonusMoves).toEqual(["Pack Horse", "Bear the Standard"]);
		expect(snap.inventory.outfit.loadBonusFrom).toBe("Pack Horse and Bear the Standard");
		expect(snap.inventory.outfit.loadLimits).toEqual({light: 5, normal: 8, heavy: 11});
	});

	// An un-learned custom move's bonuses stop applying, so it must not be named as the
	// source of a bonus it isn't granting.
	it("ignores an un-learned move's load bonus and never names it", async () => {
		const actor = new FakeActorBuilder()
			.addItem({
				type: "move", name: "Bear the Standard",
				system: {moveType: "other", loadBonus: 1},
				flags: {"stonetop-pwd": {custom: true, learned: false}},
			})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.loadBonus).toBe(0);
		expect(snap.inventory.outfit.loadBonusFrom).toBe("");
		expect(snap.inventory.outfit.loadLimits).toEqual({light: 3, normal: 6, heavy: 9});
	});

	it("with Pack Horse, 4 marked ◇ still reads as a light load", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("inventory.regularPool", 4)
			.addItem({type: "move", name: "Pack Horse", system: {moveType: "playbook", loadBonus: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.outfit.regularPool.current).toBe(4);
		expect(snap.inventory.outfit.load.selected).toBe("light");
	});

	it("a shield costs its full 2 ◇ without the Armored move", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.withInventoryRepo(new FakeInventoryRepository([
				makeOutfitItem({ slug: "shield", name: "Shield", weight: 2 }),
			]))
			.build().buildSnapshot();
		const shield = snap.inventory.outfit.regularItems.find(i => i.slug === "shield");
		expect(shield.weight).toBe(2);
	});

	it("Armored drops a carried shield from 2 ◇ to 1 ◇", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Armored", system: {moveType: "playbook", shieldLoadReduction: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([
				makeOutfitItem({ slug: "shield", name: "Shield", weight: 2 }),
			]))
			.build().buildSnapshot();
		const shield = snap.inventory.outfit.regularItems.find(i => i.slug === "shield");
		expect(shield.weight).toBe(1);
	});

	it("Armored only reduces the shield, not other carried items", async () => {
		const actor = new FakeActorBuilder()
			.addItem({type: "move", name: "Armored", system: {moveType: "playbook", shieldLoadReduction: 1}})
			.build();
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([
				makeOutfitItem({ slug: "cart", name: "Cart", weight: 2 }),
			]))
			.build().buildSnapshot();
		const cart = snap.inventory.outfit.regularItems.find(i => i.slug === "cart");
		expect(cart.weight).toBe(2);
	});

	it("regularItems from inventory repo have resource shape when defined", async () => {
		const item = makeOutfitItem({
			slug: "bow-arrows", name: "Bow & arrows", weight: 1,
			resource: {max: 2, title: null, labels: ["low ammo", "all out"]},
		});
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.withInventoryRepo(new FakeInventoryRepository([item]))
			.build().buildSnapshot();
		const ri = snap.inventory.outfit.regularItems[0];
		expect(ri.slug).toBe("bow-arrows");
		expect(ri.resource).toMatchObject({current: 0, max: 2, title: null, labels: ["low ammo", "all out"]});
	});

	it("inventory item with no resource has resource=null", async () => {
		const item = makeOutfitItem({slug: "cloak", name: "Cloak", weight: 0, resource: null});
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.withInventoryRepo(new FakeInventoryRepository([item]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularItems[0].resource).toBeNull();
	});

	it("checked inventory item has checked=true", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.checked", {"bow-arrows": true}).build();
		const item = makeOutfitItem({slug: "bow-arrows", name: "Bow", weight: 1});
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([item]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularItems[0].checked).toBe(true);
	});

	it("resource.current reflects inventory flag count", async () => {
		const actor = new FakeActorBuilder().withFlag("inventory.resources", {"bow-arrows": 1}).build();
		const item = makeOutfitItem({
			slug: "bow-arrows", name: "Bow", weight: 1,
			resource: {max: 2, title: null, labels: ["low ammo", "all out"]},
		});
		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([item]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularItems[0].resource.current).toBe(1);
	});

	it("dropped inventory-custom items keep their note and delete metadata in the Items column", async () => {
		const dropped = {
			_id: "drop-1",
			type: "move",
			name: "Sword, iron",
			system: {
				moveType: "inventory-custom",
				inventoryColumn: "regular",
				weight: 1,
				note: "<em>iron</em>, <em>hand</em>, <em>close</em>, +1 damage",
			},
		};
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().withItems([dropped]).build())
			.build().buildSnapshot();
		const item = snap.inventory.outfit.regularItems.find(i => i.slug === "drop-1");
		expect(item).toMatchObject({
			name: "Sword, iron",
			note: "<em>iron</em>, <em>hand</em>, <em>close</em>, +1 damage",
			isCustom: true,
			ownedId: "drop-1",
		});
	});
});

// ── inventory: Book II journal treasures ─────────────────────────────────────

// A treasure dragged out of a journal lands as an ordinary "inventory-custom" item,
// marked system.isTreasure so it groups under its own "Treasures" heading in whichever
// column its weight puts it, instead of mixing in with hand-written items. It stays a
// real inventory item throughout: still deletable, still counted against load / the
// small allowance. These guard the routing (each treasure in exactly ONE place) and
// that separating them out didn't quietly drop them from the accounting.

describe("buildSnapshot — inventory: journal treasures", () => {
	const treasure = (over = {}) => ({
		_id: over._id ?? "t-1",
		type: "move",
		name: over.name ?? "Brass sphere",
		system: {
			moveType: "inventory-custom",
			inventoryColumn: over.column ?? "regular",
			weight: over.weight ?? 1,
			isTreasure: true,
			...(over.note ? { note: over.note } : {}),
		},
	});
	const snapWith = (items, flags = {}) => {
		let b = new FakeActorBuilder().withItems(items);
		for (const [k, v] of Object.entries(flags)) b = b.withFlag(k, v);
		return new TestCharacterBuilder(b.build()).build().buildSnapshot();
	};

	it("routes a ◇ treasure to treasureRegular, out of the Items column", async () => {
		const snap = await snapWith([treasure({ weight: 2 })]);
		expect(snap.inventory.outfit.treasureRegular.map(i => i.name)).toEqual(["Brass sphere"]);
		expect(snap.inventory.outfit.regularItems.some(i => i.slug === "t-1")).toBe(false);
	});

	it("routes a pocket-sized treasure to treasureSmall, out of the Small Items column", async () => {
		const snap = await snapWith([treasure({ column: "small", name: "A map" })]);
		expect(snap.inventory.outfit.treasureSmall.map(i => i.name)).toEqual(["A map"]);
		expect(snap.inventory.outfit.smallItems.some(i => i.slug === "t-1")).toBe(false);
	});

	it("renders each treasure exactly once across every outfit array", async () => {
		const snap = await snapWith([treasure({ _id: "t-1" }), treasure({ _id: "t-2", column: "small" })]);
		const o = snap.inventory.outfit;
		const everywhere = [
			...o.regularItems, ...o.smallItems, ...o.smallGridItems,
			...o.arcanaRegular, ...o.arcanaSmall, ...o.treasureRegular, ...o.treasureSmall,
		].map(i => i.slug);
		expect(everywhere.filter(s => s === "t-1")).toHaveLength(1);
		expect(everywhere.filter(s => s === "t-2")).toHaveLength(1);
	});

	it("leaves an ordinary write-in in the Items column", async () => {
		// The treasure filter is subtracted from the write-in catch-all, so guard that it
		// only takes treasures with it.
		const writeIn = { _id: "w-1", type: "move", name: "Rope", system: { moveType: "inventory-custom", inventoryColumn: "regular", weight: 1 } };
		const snap = await snapWith([writeIn, treasure()]);
		expect(snap.inventory.outfit.regularItems.some(i => i.slug === "w-1")).toBe(true);
		expect(snap.inventory.outfit.treasureRegular.some(i => i.slug === "w-1")).toBe(false);
	});

	it("keeps a treasure deletable, like the write-in it is underneath", async () => {
		const snap = await snapWith([treasure({ note: "<em>magical</em>" })]);
		expect(snap.inventory.outfit.treasureRegular[0]).toMatchObject({
			name: "Brass sphere", note: "<em>magical</em>", isCustom: true, ownedId: "t-1",
		});
	});

	it("still counts a marked ◇ treasure toward load", async () => {
		// Grouping treasures out of the column must not exempt them from encumbrance.
		const snap = await snapWith([treasure({ weight: 3 })], { "inventory.checked": { "t-1": true } });
		expect(snap.inventory.outfit.treasureRegular[0].checked).toBe(true);
		expect(snap.inventory.outfit.load.totalMarks).toBe(3);
	});

	it("still counts a marked small treasure against the small allowance", async () => {
		const snap = await snapWith(
			[treasure({ column: "small" })],
			{ "inventory.checked": { "t-1": true }, "inventory.smallPool": 99 },
		);
		// The □ pool is clamped to the room left after checked small items, so a treasure
		// eating one slot shows up as one fewer reservable box.
		const limit = snap.inventory.outfit.smallItemLimit ?? 9;
		expect(snap.inventory.outfit.smallPoolCap).toBe(limit - 1);
	});
});

// ── inventory: possession-derived special items ──────────────────────────────

describe("buildSnapshot — inventory: possession-derived special items", () => {
	// The Ranger's composite bow: a special ("handout") catalog item AND a preselected
	// special possession of the same slug. Holding the possession should carry the gear
	// into the Items column (◇ load + ○ ammo track), even though it's never added via
	// the "Add Special Item" picker.
	const COMPOSITE_BOW = makeOutfitItem({
		slug: "composite-bow", name: "Composite bow", weight: 1,
		special: true, specialCategory: "Weapons of War",
		resource: { max: 2, title: null, labels: ["low ammo", "all out"] },
	});

	function bowPlaybook(preselected = ["composite-bow"]) {
		return {
			...HEAVY_PLAYBOOK,
			specialPossessions: {
				pickNote: "Pick 2, in addition to your composite bow",
				pickCount: 2,
				preselected,
				options: [
					{ slug: "composite-bow", label: "Composite bow", description: "<em>far</em>, +1 damage" },
					{ slug: "hounds", label: "Hounds", description: "<p>Dogs.</p>" },
				],
			},
		};
	}

	it("surfaces a preselected possession's matching special item in the Items column with its ◇ load + ○ ammo track", async () => {
		const snap = await new TestCharacterBuilder(makeHeavyActor())
			.withPlaybookRepo(new FakePlaybookRepository(bowPlaybook()))
			.withInventoryRepo(new FakeInventoryRepository([COMPOSITE_BOW]))
			.build().buildSnapshot();
		const bow = snap.inventory.outfit.regularItems.find(i => i.slug === "composite-bow");
		expect(bow).toBeDefined();
		expect(bow.weight).toBe(1); // the ◇ load diamond
		expect(bow.resource).toMatchObject({ max: 2, labels: ["low ammo", "all out"] }); // the ○ ammo track
		// Locked starting gear (the possession is non-removable) → no "remove special" ✕.
		expect(bow.isAddedSpecial).toBeFalsy();
	});

	it("surfaces it for a player-SELECTED (non-preselected) possession too", async () => {
		const actor = makeHeavyActor({ flags: { "possessions.selected": ["composite-bow"] } });
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(bowPlaybook([])))
			.withInventoryRepo(new FakeInventoryRepository([COMPOSITE_BOW]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularItems.some(i => i.slug === "composite-bow")).toBe(true);
	});

	it("keeps a special item OFF the Items column when no held possession matches it", async () => {
		const snap = await new TestCharacterBuilder(makeHeavyActor())
			.withPlaybookRepo(new FakePlaybookRepository(bowPlaybook([])))
			.withInventoryRepo(new FakeInventoryRepository([COMPOSITE_BOW]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.regularItems.some(i => i.slug === "composite-bow")).toBe(false);
	});

	it("a picker-added special item keeps its removable ✕ and isn't duplicated by a same-slug possession", async () => {
		const actor = makeHeavyActor({ flags: { "inventory.addedSpecial": ["composite-bow"] } });
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(bowPlaybook()))
			.withInventoryRepo(new FakeInventoryRepository([COMPOSITE_BOW]))
			.build().buildSnapshot();
		const bows = snap.inventory.outfit.regularItems.filter(i => i.slug === "composite-bow");
		expect(bows).toHaveLength(1); // not double-listed
		expect(bows[0].isAddedSpecial).toBe(true); // explicit add wins → stays removable
	});

	it("surfaces a possession-matched special SMALL item into the Small Items column", async () => {
		const smallSpecial = makeOutfitItem({
			slug: "trinket-kit", name: "Trinket kit", weight: 0,
			inventoryColumn: "small", special: true,
		});
		const pb = {
			...HEAVY_PLAYBOOK,
			specialPossessions: {
				pickNote: "Pick 1", pickCount: 1, preselected: ["trinket-kit"],
				options: [{ slug: "trinket-kit", label: "Trinket kit", description: "<p>Bits.</p>" }],
			},
		};
		const snap = await new TestCharacterBuilder(makeHeavyActor())
			.withPlaybookRepo(new FakePlaybookRepository(pb))
			.withInventoryRepo(new FakeInventoryRepository([smallSpecial]))
			.build().buildSnapshot();
		expect(snap.inventory.outfit.smallItems.some(i => i.slug === "trinket-kit")).toBe(true);
	});

	it("surfaces Weapons of War special weapons as regular Outfit items when the linked steading earned the improvement", async () => {
		const weapons = [
			makeOutfitItem({ slug: "mace-or-flail", name: "Mace or flail, iron", weight: 1, special: true, specialCategory: "Weapons of War" }),
			makeOutfitItem({ slug: "battleaxe", name: "Battleaxe, iron", weight: 1, special: true, specialCategory: "Weapons of War" }),
			makeOutfitItem({ slug: "warhammer", name: "Warhammer, iron", weight: 1, special: true, specialCategory: "Weapons of War" }),
			makeOutfitItem({ slug: "glass-vial", name: "Glass vial", weight: 0, special: true, specialCategory: "Exotic Stuff" }),
		];
		global.game.actors = {
			get: () => null,
			find: () => ({
				type: "stonetop",
				flags: { "stonetop-pwd": { steading: { improvements: { weaponsOfWar: { completed: true } } } } },
			}),
		};

		const snap = await new TestCharacterBuilder(makeHeavyActor())
			.withInventoryRepo(new FakeInventoryRepository(weapons))
			.build().buildSnapshot();

		const regular = snap.inventory.outfit.regularItems;
		expect(regular.find(i => i.slug === "mace-or-flail")).toMatchObject({ name: "Mace or flail, iron", weight: 1 });
		expect(regular.find(i => i.slug === "battleaxe")).toMatchObject({ name: "Battleaxe, iron", weight: 1 });
		expect(regular.find(i => i.slug === "warhammer")).toMatchObject({ name: "Warhammer, iron", weight: 1 });
		expect(regular.some(i => i.slug === "glass-vial")).toBe(false);
	});

	it("keeps Weapons of War hidden until the steading improvement is earned", async () => {
		const axe = makeOutfitItem({
			slug: "battleaxe", name: "Battleaxe, iron", weight: 1,
			special: true, specialCategory: "Weapons of War",
		});
		global.game.actors = {
			get: () => null,
			find: () => ({
				type: "stonetop",
				flags: { "stonetop-pwd": { steading: { improvements: { weaponsOfWar: { completed: false } } } } },
			}),
		};

		const snap = await new TestCharacterBuilder(makeHeavyActor())
			.withInventoryRepo(new FakeInventoryRepository([axe]))
			.build().buildSnapshot();

		expect(snap.inventory.outfit.regularItems.some(i => i.slug === "battleaxe")).toBe(false);
	});

	it("does not duplicate a Weapons of War item that was already added through the picker", async () => {
		const actor = makeHeavyActor({ flags: { "inventory.addedSpecial": ["battleaxe"] } });
		global.game.actors = {
			get: () => null,
			find: () => ({
				type: "stonetop",
				flags: { "stonetop-pwd": { steading: { improvements: { weaponsOfWar: { completed: true } } } } },
			}),
		};

		const snap = await new TestCharacterBuilder(actor)
			.withInventoryRepo(new FakeInventoryRepository([
				makeOutfitItem({
					slug: "battleaxe", name: "Battleaxe, iron", weight: 1,
					special: true, specialCategory: "Weapons of War",
				}),
			]))
			.build().buildSnapshot();

		const axes = snap.inventory.outfit.regularItems.filter(i => i.slug === "battleaxe");
		expect(axes).toHaveLength(1);
		expect(axes[0].isAddedSpecial).toBe(true);
	});
});

// ── inventory.possessions ────────────────────────────────────────────────────

describe("buildSnapshot — inventory.possessions", () => {
	it("is null when no playbook", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build())
			.build().buildSnapshot();
		expect(snap.inventory.possessions).toBeNull();
	});

	it("is null when playbook has no specialPossessions", async () => {
		const actor = makeHeavyActor();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: null
			})).build().buildSnapshot();
		expect(snap.inventory.possessions).toBeNull();
	});

	const SP = {
		pickNote: "Pick 2",
		pickCount: 2,
		preselected: ["pouch"],
		options: [
			{
				slug: "pouch",
				label: "Sacred Pouch",
				description: "<p>A pouch.</p>",
				resource: {max: 3, title: "Stock", labels: []}
			},
			{slug: "apiary", label: "Apiary", description: "<p>Bees.</p>"},
		],
	};

	it("has pickCount, pickNote, and items", async () => {
		const actor = makeHeavyActor();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		expect(snap.inventory.possessions.pickCount).toBe(2);
		expect(snap.inventory.possessions.pickNote).toBe("Pick 2");
		expect(snap.inventory.possessions.items).toHaveLength(2);
	});

	it("possession has unified resource shape", async () => {
		const actor = makeHeavyActor({flags: {"possessions.selected": ["pouch"]}});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		const pouch = snap.inventory.possessions.items.find(i => i.slug === "pouch");
		expect(pouch.resource.max).toBe(3);
		// The title is rendered as the italic `usesLabel` in the possessions block,
		// so it's left off the resource to avoid the resource-track partial drawing
		// a duplicate label next to it.
		expect(pouch.resource.title).toBeNull();
		expect(pouch.usesLabel).toBe("Stock");
		expect(pouch.resource.labels).toEqual([]);
	});

	it("possession resource.current reflects uses flag", async () => {
		const actor = makeHeavyActor({
			flags: {
				"possessions.selected": ["pouch"],
				"possessions.uses": {pouch: 2},
			}
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		const pouch = snap.inventory.possessions.items.find(i => i.slug === "pouch");
		expect(pouch.resource.current).toBe(2);
	});

	it("resolves a possession's \"x piercing\" against the steading's Prosperity", async () => {
		// The composite bow's piercing scales with Stonetop's Prosperity (Book I p.94):
		// the sheet shows the resolved value (capped at 2), while a null steading keeps
		// the literal "x" — onboarding renders that raw playbook description directly.
		const char = new TestCharacterBuilder(makeHeavyActor()).build();
		const sp = {
			pickNote: "Pick 1", pickCount: 1, preselected: ["composite-bow"],
			options: [{
				slug: "composite-bow", label: "Composite bow",
				description: "<em>far</em>, +1 damage, x <em>piercing</em>",
			}],
		};
		const descFor = (prosperity) =>
			char._buildPossessionsSnapshot(sp, {}, prosperity).items[0].description;
		expect(descFor(1)).toBe("<em>far</em>, +1 damage, 1 <em>piercing</em>");
		expect(descFor(5)).toBe("<em>far</em>, +1 damage, 2 <em>piercing</em>"); // capped at 2
		expect(descFor(null)).toBe("<em>far</em>, +1 damage, x <em>piercing</em>"); // no steading
	});

	it("defaults an untitled circle track to a \"Uses\" label, keeps an explicit one", async () => {
		const actor = makeHeavyActor({flags: {"possessions.selected": ["pouch", "apiary"]}});
		const sp = {
			pickNote: "Pick 2", pickCount: 2, preselected: [],
			options: [
				// explicit title is preserved…
				{slug: "pouch", label: "Pouch", description: "<p>A pouch.</p>", resource: {max: 3, title: "Stock", labels: []}},
				// …an untitled track falls back to "Uses"…
				{slug: "apiary", label: "Books", description: "do a thing.", resource: {max: 3, title: null, labels: []}},
				// …and a possession with no track gets no label at all.
				{slug: "goats", label: "Goats", description: "milk, cheese."},
			],
		};
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({...HEAVY_PLAYBOOK, specialPossessions: sp}))
			.build().buildSnapshot();
		const items = snap.inventory.possessions.items;
		expect(items.find(i => i.slug === "pouch").usesLabel).toBe("Stock");
		expect(items.find(i => i.slug === "apiary").usesLabel).toBe("Uses");
		expect(items.find(i => i.slug === "goats").usesLabel).toBeNull();
	});

	it("strips the redundant \"uses\" circle count from a track's description", () => {
		// The track renders the circles top-right, so the inline count baked into the
		// playbook prose is dropped on the sheet (all three authoring shapes).
		const char = new TestCharacterBuilder(makeHeavyActor()).build();
		const descFor = (description) => char._buildPossessionsSnapshot({
			pickNote: "Pick 1", pickCount: 1, preselected: ["p"],
			options: [{slug: "p", label: "P", description, resource: {max: 3, title: null, labels: []}}],
		}, {}, null).items[0].description;

		// leading bare "○○○ uses:" clause → reflowed into its own capitalised sentence
		expect(descFor("○○○ uses: expend a use to consult your collection."))
			.toBe("Expend a use to consult your collection.");
		// leading "(○○○ uses)" parenthetical count
		expect(descFor("(○○○ uses) Expend a use to produce something."))
			.toBe("Expend a use to produce something.");
		// mid-text "(○○ uses, …)" keeps the non-count remainder of the note
		expect(descFor("skins of fine whisky (○○ uses, grants advantage to Persuade), ◇ firkins, etc."))
			.toBe("skins of fine whisky (grants advantage to Persuade), ◇ firkins, etc.");
	});

	it("leaves ◇ markers and non-\"uses\" circle counts untouched", () => {
		const char = new TestCharacterBuilder(makeHeavyActor()).build();
		const descFor = (description, resource) => char._buildPossessionsSnapshot({
			pickNote: "Pick 1", pickCount: 1, preselected: ["p"],
			options: [{slug: "p", label: "P", description, ...(resource ? {resource} : {})}],
		}, {}, null).items[0].description;

		// No track → nothing is stripped, even if the prose has circles.
		expect(descFor("○○○○○ hours of light, ◇ lanterns, etc.", null))
			.toBe("○○○○○ hours of light, ◇ lanterns, etc.");
		// Track present, but its circles aren't "uses" (e.g. "○○ firkins") → kept.
		expect(descFor("chisels, ◇ saws, ○○ firkins, barrels, etc.", {max: 2, title: null, labels: []}))
			.toBe("chisels, ◇ saws, ○○ firkins, barrels, etc.");
	});

	it("appends write-in custom possessions as selected, removable items", async () => {
		const actor = makeHeavyActor({
			flags: {"possessions.custom": [{slug: "custom-1", label: "A locket"}]}
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		const custom = snap.inventory.possessions.items.find(i => i.slug === "custom-1");
		expect(custom.label).toBe("A locket");
		expect(custom.isCustom).toBe(true);
		expect(custom.selected).toBe(true);
		expect(custom.checked).toBe(true);
		// Disabled so it can't be unchecked — it's removed via the × button instead.
		expect(custom.disabled).toBe(true);
	});

	it("listed possessions report isCustom false", async () => {
		const actor = makeHeavyActor({flags: {"possessions.selected": ["apiary"]}});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		expect(snap.inventory.possessions.items.find(i => i.slug === "apiary").isCustom).toBe(false);
	});

	it("write-in possessions count toward the pick budget", async () => {
		// SP needs 2 non-preselected picks; one listed + one write-in fills it.
		const actor = makeHeavyActor({
			flags: {
				"possessions.selected": ["apiary"],
				"possessions.custom": [{slug: "custom-1", label: "A locket"}],
			}
		});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({
				...HEAVY_PLAYBOOK,
				specialPossessions: SP
			})).build().buildSnapshot();
		expect(snap.inventory.possessions.isIncomplete).toBe(false);
	});

	// ── choiceSummary (sacred-pouch flavor + remarkable trait) ─────────────────
	// A possession with `choiceGroups` (the Blessed's sacred pouch) surfaces the
	// player's picks as a read-only prose summary woven under the description.
	const SP_FLAVOR = {
		pickNote: "Pick 1", pickCount: 1, preselected: ["pouch"],
		options: [{
			slug: "pouch", label: "Sacred Pouch", description: "<p>A pouch.</p>",
			choiceGroups: [
				{ heading: "Your sacred pouch is...", note: "choose 1 on each line", subgroups: [
					{ pickCount: 1, options: [
						{slug: "origin-heirloom", label: "an heirloom made just for you"},
						{slug: "origin-own-work", label: "your own work"},
					]},
					{ pickCount: 1, options: [
						{slug: "material-fur", label: "fur"},
						{slug: "material-woven", label: "woven"},
					]},
				]},
				{ heading: "What remarkable trait does it possess?", note: "choose 1", subgroups: [
					{ multiSelect: true, options: [
						{slug: "trait-indestructible", label: "It cannot be cut, torn, or burned."},
						{slug: "trait-unnoticed", label: "Ignored unless specifically sought."},
					]},
				]},
			],
		}],
	};

	const pouchSummary = async (subChoices) => {
		const actor = makeHeavyActor({flags: subChoices ? {"possessions.subChoices": subChoices} : {}});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({...HEAVY_PLAYBOOK, specialPossessions: SP_FLAVOR}))
			.build().buildSnapshot();
		return snap.inventory.possessions.items.find(i => i.slug === "pouch").choiceSummary;
	};

	it("choiceSummary is null when no sub-choices are picked", async () => {
		expect(await pouchSummary(null)).toBeNull();
	});

	it("choiceSummary groups picks by heading, in book order", async () => {
		const summary = await pouchSummary({
			pouch: ["material-fur", "origin-heirloom", "trait-indestructible"],
		});
		expect(summary).toEqual([
			{ heading: "Your sacred pouch is...", selections: "an heirloom made just for you, fur" },
			{ heading: "What remarkable trait does it possess?", selections: "It cannot be cut, torn, or burned." },
		]);
	});

	it("choiceSummary lists every remarkable trait (Big Magic adds more)", async () => {
		const summary = await pouchSummary({
			pouch: ["trait-unnoticed", "trait-indestructible"],
		});
		// Both traits, in book order regardless of pick order.
		expect(summary).toEqual([
			{ heading: "What remarkable trait does it possess?",
			  selections: "It cannot be cut, torn, or burned., Ignored unless specifically sought." },
		]);
	});

	it("choiceSummary omits a group with no picks", async () => {
		const summary = await pouchSummary({ pouch: ["origin-own-work"] });
		expect(summary).toEqual([
			{ heading: "Your sacred pouch is...", selections: "your own work" },
		]);
	});
});

// ── choiceGear (Weapons of War: gear-bearing `choices` as ◇/□ rows) ────────────
// A possession whose `choices` object is flagged `gear` renders the options the player
// has already *chosen* as ◇/□ item-rows (like a grantsItems bundle). Choosing stays on
// the edit-mode `choices` checklist; the ◇ on a row is only the load mark, so an unchosen
// weapon never shows in play and a chosen-but-left-behind one reads as an empty ◇.
describe("buildSnapshot — possession choiceGear (Weapons of War)", () => {
	const WEAPONS_POSSESSIONS = {
		pickNote: "Pick 2", pickCount: 2, preselected: [],
		options: [{
			slug: "weapons-of-war",
			label: "Weapons of war",
			description: "",
			choices: {
				pickNote: "Choose up to 3 (now or later)",
				pickCount: 3, optional: true, gear: true,
				options: [
					{ slug: "sword",      label: "◇ Sword, iron (<em>close</em>, +1 damage)" },
					{ slug: "long-spear", label: "◇◇ Long spear, fine steel (<em>reach</em>, 2 piercing)" },
					{ slug: "battleaxe",  label: "◇ Battleaxe, iron (<em>close, messy</em>)" },
					{ slug: "crossbow",   label: "◇ Crossbow (<em>far</em>, x <em>piercing</em>, ○ low ammo, ○ all out)",
					  resource: { max: 2, title: null, labels: [] } },
				],
			},
		}],
	};

	const buildWeapons = async (flags = {}) => {
		const actor = makeHeavyActor({flags});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({...HEAVY_PLAYBOOK, specialPossessions: WEAPONS_POSSESSIONS}))
			.build().buildSnapshot();
		return snap;
	};
	const weaponsItem = snap => snap.inventory.possessions.items.find(i => i.slug === "weapons-of-war");

	it("choiceGear is null while the possession is unowned", async () => {
		expect(weaponsItem(await buildWeapons()).choiceGear).toBeNull();
	});

	it("owned but with nothing chosen yet, there are no rows at all", async () => {
		const gear = weaponsItem(await buildWeapons({"possessions.selected": ["weapons-of-war"]})).choiceGear;
		// The pick note rides along for the edit-mode checklist's heading, but nothing renders
		// on the card in play until a weapon is chosen.
		expect(gear.pickNote).toBe("Choose up to 3 (now or later)");
		expect(gear.hasPicked).toBe(false);
		expect(gear.regular).toEqual([]);
		expect(gear.small).toEqual([]);
	});

	it("only the chosen weapons become ◇ rows, with the leading diamonds parsed as weight", async () => {
		const gear = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword", "long-spear"]},
		})).choiceGear;
		expect(gear.regular.map(r => [r.choiceSlug, r.weight])).toEqual([["sword", 1], ["long-spear", 2]]);
		// The leading ◇/◆ run is stripped off the rendered label.
		expect(gear.regular.find(r => r.choiceSlug === "sword").label).toBe("Sword, iron (<em>close</em>, +1 damage)");
	});

	it("a chosen weapon's ◇ reads carried only once it's marked carried", async () => {
		const gear = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword", "battleaxe"]},
			"possessions.choiceCarried": {"weapons-of-war:sword": true},
		})).choiceGear;
		expect(gear.regular.find(r => r.choiceSlug === "sword").checked).toBe(true);
		expect(gear.regular.find(r => r.choiceSlug === "battleaxe").checked).toBe(false);
	});

	it("carried weapons count toward load by their weight", async () => {
		const snap = await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword", "long-spear"]},
			"possessions.choiceCarried": {"weapons-of-war:sword": true, "weapons-of-war:long-spear": true},
		});
		expect(snap.inventory.outfit.load.totalMarks).toBe(3); // ◇ + ◇◇
	});

	it("a weapon you own but left behind adds no load", async () => {
		const snap = await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword", "long-spear"]},
		});
		expect(snap.inventory.outfit.load.totalMarks).toBe(0);
	});

	it("a carry mark on a weapon that was never chosen adds no load", async () => {
		const snap = await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.choiceCarried": {"weapons-of-war:long-spear": true},
		});
		expect(snap.inventory.outfit.load.totalMarks).toBe(0);
	});

	it("the chosen crossbow carries an ammo resource; a plain weapon does not", async () => {
		const gear = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["crossbow", "sword"]},
		})).choiceGear;
		expect(gear.regular.find(r => r.choiceSlug === "crossbow").resource.max).toBe(2);
		expect(gear.regular.find(r => r.choiceSlug === "sword").resource).toBeNull();
	});

	// The book prints the ammo statuses in the line itself — "…, ○ low ammo, ○ all out)" —
	// so the track's circles stand in for those glyphs rather than trailing the row (which
	// showed both: the written statuses AND two unexplained circles at the end of the line).
	it("splits the inline ○ statuses off the label and names each circle after one", async () => {
		const gear = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["crossbow"]},
		})).choiceGear;
		const crossbow = gear.regular.find(r => r.choiceSlug === "crossbow");
		expect(crossbow.resourceInline).toBe(true);
		expect(crossbow.label).toBe("Crossbow (<em>far</em>, x <em>piercing</em>, ");
		expect(crossbow.resource.labels).toEqual(["low ammo", "all out"]);
		// What trailed the last status — the label's closing paren — follows the circles.
		expect(crossbow.labelAfter).toBe(")");
	});

	it("a weapon with no ○ statuses keeps its whole label and its trailing track", async () => {
		const gear = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword"]},
		})).choiceGear;
		const sword = gear.regular.find(r => r.choiceSlug === "sword");
		expect(sword.resourceInline).toBe(false);
		expect(sword.label).toBe("Sword, iron (<em>close</em>, +1 damage)");
		expect(sword.labelAfter).toBe("");
	});

	it("keeps the checklist `choices` (that's where you choose) but drops the prose summary", async () => {
		const item = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword"]},
		}));
		expect(item.choices.options.find(o => o.slug === "sword").checked).toBe(true);
		expect(item.choiceSummary).toBeNull();
		expect(item.choiceGear).not.toBeNull();
	});

	it("the checklist locks the remaining options once the pick cap is reached", async () => {
		const item = weaponsItem(await buildWeapons({
			"possessions.selected": ["weapons-of-war"],
			"possessions.subChoices": {"weapons-of-war": ["sword", "long-spear", "battleaxe"]},
		}));
		// Chosen ones stay togglable so you can put a weapon back; the 4th is locked out.
		expect(item.choices.options.find(o => o.slug === "sword").disabled).toBe(false);
		expect(item.choices.options.find(o => o.slug === "crossbow").disabled).toBe(true);
	});

	// ── mixed weights + fill-in blanks (the Would-Be Hero's Personal Token) ──────
	// A gear bundle whose options mix ◇ gear with weightless keepsakes and carry an
	// inline fill-in blank ("A shield, bearing ___'s crest"). Preselected, so owned.
	const TOKEN_POSSESSIONS = {
		pickNote: "Pick 1", pickCount: 1, preselected: ["personal-token"],
		options: [{
			slug: "personal-token", label: "Personal token", description: "",
			choices: {
				pickCount: 1, gear: true,
				options: [
					{ slug: "shield", label: "◇◇ A shield, bearing ___'s crest" },
					{ slug: "cloak",  label: "◇ A wool cloak, woven just for you by ___" },
					{ slug: "letter", label: "A letter, spattered with tears" },
					{ slug: "flute",  label: "A flute, a gift from someone you loved" },
				],
			},
		}],
	};
	const tokenGear = async (flags = {}) => {
		const actor = makeHeavyActor({flags});
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository({...HEAVY_PLAYBOOK, specialPossessions: TOKEN_POSSESSIONS}))
			.build().buildSnapshot();
		return snap.inventory.possessions.items.find(i => i.slug === "personal-token").choiceGear;
	};

	it("splits ◇ gear (regular) from weightless keepsakes (small)", async () => {
		const gear = await tokenGear({"possessions.subChoices": {"personal-token": ["shield", "letter"]}});
		expect(gear.regular.map(r => [r.choiceSlug, r.weight])).toEqual([["shield", 2]]);
		expect(gear.small.map(r => r.choiceSlug)).toEqual(["letter"]);
	});

	it("exposes an option's fill-in blank split around its saved write-in", async () => {
		const gear = await tokenGear({
			"possessions.subChoices": {"personal-token": ["shield", "letter"]},
			"possessions.choiceTexts": {"personal-token:shield": "the Old Baron"},
		});
		const shield = gear.regular.find(r => r.choiceSlug === "shield");
		expect(shield.hasBlank).toBe(true);
		expect(shield.fillBefore).toBe("A shield, bearing ");
		expect(shield.fillAfter).toBe("'s crest");
		expect(shield.fillValue).toBe("the Old Baron");
		// A blank-less keepsake reports no blank.
		expect(gear.small.find(r => r.choiceSlug === "letter").hasBlank).toBe(false);
	});

	it("a weightless keepsake eats a small-item mark only once it's carried", async () => {
		const carried = async flags => (await new TestCharacterBuilder(makeHeavyActor({flags}))
			.withPlaybookRepo(new FakePlaybookRepository({...HEAVY_PLAYBOOK, specialPossessions: TOKEN_POSSESSIONS}))
			.build().buildSnapshot()).inventory.possessions.items
			.find(i => i.slug === "personal-token").choiceGear.small[0].checked;
		expect(await carried({"possessions.subChoices": {"personal-token": ["letter"]}})).toBe(false);
		expect(await carried({
			"possessions.subChoices": {"personal-token": ["letter"]},
			"possessions.choiceCarried": {"personal-token:letter": true},
		})).toBe(true);
	});
});

// ── inventory.other ───────────────────────────────────────────────────────────

describe("buildSnapshot — inventory.other", () => {
	it("other is empty array when no non-inventory items owned", async () => {
		const snap = await new TestCharacterBuilder(new FakeActorBuilder().build()).build().buildSnapshot();
		expect(snap.inventory.other).toEqual([]);
	});

	it("other contains owned items that are not inventory-type moves", async () => {
		const actor = new FakeActorBuilder()
			.addItem({
				_id: "x1",
				type: "move",
				name: "Custom Sword",
				system: {moveType: "other", description: "<p>A sword.</p>", rollType: null}
			})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.other).toHaveLength(1);
		expect(snap.inventory.other[0].name).toBe("Custom Sword");
		expect(snap.inventory.other[0].id).toBe("x1");
	});

	it("inventory-type moves do not appear in other", async () => {
		const actor = new FakeActorBuilder()
			.addItem({_id: "i1", type: "move", name: "Bow", system: {moveType: "inventory", slug: "bow"}})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.inventory.other).toHaveLength(0);
	});
});

// ── lore ──────────────────────────────────────────────────────────────────────

describe("buildSnapshot — lore section", () => {
	const LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{
				slug: "the-earth-mother",
				title: "The Earth Mother",
				description: "<p>Danu text</p>",
				options: [
					{ slug: "shrine-loved",  description: "... loved.",    max: 1 },
					{ slug: "shrine-berth",  description: "... berth.",    max: 1 },
				],
			},
			{
				slug: "danu-offerings",
				title: "Offerings to Danu",
				description: "<p>Offerings text</p>",
				options: [
					{ slug: "fruits", description: "Fruits of harvest", max: 3 },
				],
			},
		],
	};

	async function buildSnap(flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(LORE_PLAYBOOK))
			.build().buildSnapshot();
	}

	it("lore.hasEntries is true when playbook has lore", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.lore.hasEntries).toBe(true);
	});

	it("lore.hasEntries is false when playbook has no lore", async () => {
		const actor = new FakeActorBuilder().withPlaybook("the-heavy", "The Heavy").build();
		const snap = await new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(HEAVY_PLAYBOOK))
			.build().buildSnapshot();
		expect(snap.playbook.lore.hasEntries).toBe(false);
	});

	it("lore.hasSelection is false when no lore options are selected", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.lore.hasSelection).toBe(false);
	});

	it("lore.hasSelection is true when any lore option is selected", async () => {
		const snap = await buildSnap({ "lore.counts": { "the-earth-mother:shrine-loved": 1 } });
		expect(snap.playbook.lore.hasSelection).toBe(true);
	});

	it("lore.entries has correct length", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.lore.entries).toHaveLength(2);
	});

	it("lore entry has slug, title, description", async () => {
		const snap = await buildSnap();
		const entry = snap.playbook.lore.entries[0];
		expect(entry.slug).toBe("the-earth-mother");
		expect(entry.title).toBe("The Earth Mother");
		expect(entry.description).toBe("<p>Danu text</p>");
	});

	it("lore entry options have slug, description, max", async () => {
		const snap = await buildSnap();
		const opt = snap.playbook.lore.entries[0].options[0];
		expect(opt.slug).toBe("shrine-loved");
		expect(opt.description).toBe("... loved.");
		expect(opt.max).toBe(1);
	});

	it("lore option count is 0 when no flag saved", async () => {
		const snap = await buildSnap();
		expect(snap.playbook.lore.entries[0].options[0].count).toBe(0);
	});

	it("lore option count reflects saved flag", async () => {
		const snap = await buildSnap({ "lore.counts": { "the-earth-mother:shrine-loved": 1 } });
		expect(snap.playbook.lore.entries[0].options[0].count).toBe(1);
	});

	const CHRONICLE_LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{
				slug: "chronicle",
				title: "The Chronicle",
				description: "<p>The Chronicle is a physical place. On the plus side, it\u2026 <em>(choose 3)</em></p>",
				options: [
					{ slug: "vast",   description: "\u2026 is vast.",   max: 1 },
					{ slug: "secure", description: "\u2026 is secure.", max: 1 },
					{ slug: "known",  description: "\u2026 is known.",  max: 1 },
				],
			},
			{
				slug: "chronicle-alas",
				title: "But Alas, It\u2026",
				description: "<p><em>(choose 2)</em></p>",
				options: [
					{ slug: "damp", description: "... is damp.", max: 1 },
					{ slug: "dark", description: "... is dark.", max: 1 },
				],
			},
		],
	};

	async function buildChronicleSnap(flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(CHRONICLE_LORE_PLAYBOOK))
			.build().buildSnapshot();
	}

	it("completed lore entries expose readonly descriptions without choose prompts", async () => {
		const snap = await buildChronicleSnap({
			"lore.counts": {
				"chronicle:vast": 1,
				"chronicle:secure": 1,
				"chronicle:known": 1,
				"chronicle-alas:damp": 1,
				"chronicle-alas:dark": 1,
			},
		});
		const [positive, negative] = snap.playbook.lore.entries;
		expect(positive.readonlyDescription).toBe("<p>The Chronicle is a physical place. On the plus side, it\u2026</p>");
		expect(negative.readonlyDescription).toBe("");
	});

	it("readonly lore descriptions omit choose prompts even before all picks are made", async () => {
		const snap = await buildChronicleSnap({
			"lore.counts": {
				"chronicle:vast": 1,
			},
		});
		expect(snap.playbook.lore.entries[0].isAnswered).toBe(false);
		expect(snap.playbook.lore.entries[0].readonlyDescription).toBe("<p>The Chronicle is a physical place. On the plus side, it\u2026</p>");
	});

	it("readonly lore options strip leading ellipses and mark positive and negative entries", async () => {
		const snap = await buildChronicleSnap({
			"lore.counts": {
				"chronicle:vast": 1,
				"chronicle-alas:damp": 1,
			},
		});
		const [positive, negative] = snap.playbook.lore.entries;
		expect(positive.readonlyMarker).toBe("+");
		expect(positive.options[0].readonlyDescription).toBe("is vast.");
		expect(negative.readonlyMarker).toBe("-");
		expect(negative.options[0].readonlyDescription).toBe("is damp.");
	});

	it("uses the spiral marker for lore entries that are not plus or alas topics", async () => {
		const snap = await buildSnap({ "lore.counts": { "the-earth-mother:shrine-loved": 1 } });
		expect(snap.playbook.lore.entries[0].readonlyMarker).toBe("spiral");
	});

	it("marks alas lore entries as continuations of the previous topic", async () => {
		const snap = await buildChronicleSnap();
		const [positive, negative] = snap.playbook.lore.entries;
		expect(positive.isContinuation).toBe(false);
		expect(negative.isContinuation).toBe(true);
	});

	const LAWKEEPER_LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{
				slug: "lawkeeper-shrine",
				title: "The Lawkeeper",
				description: "<p>Aratis's shrine is... <em>(pick 1)</em></p>",
				options: [
					{ slug: "shrine-hub", description: "... a hub of the community.", max: 1 },
				],
			},
			{
				slug: "lawkeeper-demands",
				title: "Of Her True Disciples, Aratis Demands...",
				description: "<p><em>(choose 3)</em></p>",
				options: [
					{ slug: "truth", description: "... truth, honesty, and forthrightness.", max: 1 },
				],
			},
		],
	};

	async function buildLoreSnap(lorePlaybook, flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(lorePlaybook))
			.build().buildSnapshot();
	}

	it("marks Aratis demands lore entries as continuations of the Lawkeeper topic", async () => {
		const snap = await buildLoreSnap(LAWKEEPER_LORE_PLAYBOOK);
		const [lawkeeper, demands] = snap.playbook.lore.entries;
		expect(lawkeeper.isContinuation).toBe(false);
		expect(demands.isContinuation).toBe(true);
		expect(demands.readonlyMarker).toBe("spiral");
	});

	const PDF_CONTINUATION_LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{
				slug: "earth-mother",
				title: "The Earth Mother",
				description: "<p>Danu's shrine is... <em>(choose 1)</em></p>",
				options: [{ slug: "loved", description: "... loved.", max: 1 }],
			},
			{
				slug: "offerings",
				title: "Offerings to Danu",
				description: "<p><em>(choose 2-3)</em></p>",
				options: [{ slug: "fruit", description: "Fruits of harvest.", max: 1 }],
			},
			{
				slug: "tall-tale-end",
				title: "And You Ended Up...",
				description: "<p><em>(choose 1 or 2 per tale)</em></p>",
				options: [{ slug: "running", description: "... running for your life.", max: 1 }],
			},
			{
				slug: "tall-tale-left",
				title: "But All You've Got Left to Show for It Is...",
				description: "",
				options: [{ slug: "scar", description: "... a nasty scar.", max: 1 }],
			},
			{
				slug: "violence-shadow",
				title: "But Folks Are Less Keen to Discuss...",
				description: "<p><em>(pick 1 or 2)</em></p>",
				options: [{ slug: "look", description: "... the look in your eye.", max: 1 }],
			},
			{
				slug: "violence-fears",
				title: "What Keeps You Up at Night?",
				description: "<p><em>(pick 1 or 2)</em></p>",
				options: [{ slug: "temper", description: "That temper.", max: 1 }],
			},
			{
				slug: "helior-practice",
				title: "He Is Worshipped Through...",
				description: "<p><em>(choose 1 or 2)</em></p>",
				options: [{ slug: "hymns", description: "... solemn hymns.", max: 1 }],
			},
			{
				slug: "helior-shrine",
				title: "In Stonetop's Pavilion of the Gods, Helior's Shrine Has...",
				description: "<p><em>(choose 1)</em></p>",
				options: [{ slug: "honor", description: "... the place of highest honor.", max: 1 }],
			},
			{
				slug: "lightbearer-predecessor",
				title: "Your Predecessor, the Previous Lightbearer...",
				description: "<p><em>(choose 2 or 3)</em></p>",
				options: [{ slug: "legend", description: "... lived long ago.", max: 1 }],
			},
			{
				slug: "lightbearer-powers",
				title: "You Came Into Your Powers...",
				description: "<p><em>(choose 1)</em></p>",
				options: [{ slug: "study", description: "... through years of study.", max: 1 }],
			},
			{
				slug: "war-questions",
				title: "Answer At Least 3 of the Following",
				description: "",
				options: [{ slug: "when", description: "When did it happen?", max: 1 }],
			},
			{
				slug: "anger",
				title: "What Makes You Burn with Righteous Anger?",
				description: "<p><em>(choose 2, maybe 3)</em></p>",
				options: [{ slug: "injustice", description: "Injustice.", max: 1 }],
			},
			{
				slug: "fear-story",
				title: "When Did Your Fear or Anger Last Cause You Trouble?",
				description: "",
				options: [{ slug: "when", description: "When did it happen?", max: 1 }],
			},
		],
	};

	it("marks other PDF subprompts as continuations of their playbook topic", async () => {
		const snap = await buildLoreSnap(PDF_CONTINUATION_LORE_PLAYBOOK);
		const entries = snap.playbook.lore.entries;
		expect(entries[0].isContinuation).toBe(false);
		expect(entries.slice(1).every(e => e.isContinuation)).toBe(true);
	});

	// Mirrors the Marshal/Ranger "War Stories" shape: a (choose 1) entry followed by
	// an "Answer at least 3…" text-question entry flagged readonlyMerge.
	const READONLY_MERGE_LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{ slug: "war-stories", title: "War Stories", description: "", options: [] },
			{
				slug: "war-stories-action",
				continuation: true,
				title: "The Last Time the Militia Saw Serious Action, It Was…",
				description: "<p><em>(pick 1)</em></p>",
				options: [{ slug: "bandits", description: "… to drive off bandits.", max: 1 }],
			},
			{
				slug: "war-stories-questions",
				continuation: true,
				columnBreak: true,
				readonlyMerge: true,
				title: "Answer At Least 3 of the Following",
				description: "",
				options: [{ slug: "when", description: "When did it happen?", type: "text" }],
			},
		],
	};

	it("readonlyMerge entry keeps its edit-mode column break but collapses it read-only", async () => {
		const snap = await buildLoreSnap(READONLY_MERGE_LORE_PLAYBOOK);
		const questions = snap.playbook.lore.entries[2];
		expect(questions.readonlyMerge).toBe(true);
		expect(questions.columnBreak).toBe(true);        // edit mode still two-column
		expect(questions.readonlyColumnBreak).toBe(false); // read-only merges in
	});

	it("a section whose only break is merged renders single-column read-only", async () => {
		const snap = await buildLoreSnap(READONLY_MERGE_LORE_PLAYBOOK);
		expect(snap.playbook.lore.hasColumnBreak).toBe(true);
		expect(snap.playbook.lore.hasReadonlyColumnBreak).toBe(false);
	});

	it("a subheader column break is preserved read-only (not merged)", async () => {
		const snap = await buildLoreSnap({
			...HEAVY_PLAYBOOK,
			lore: [
				{ slug: "collection", title: "Collection", description: "", options: [] },
				{
					slug: "arcana-minor",
					continuation: true,
					columnBreak: true,
					subheader: true,
					title: "Minor Arcana",
					description: "",
					options: [{ slug: "where", description: "Where?", type: "text" }],
				},
			],
		});
		const minor = snap.playbook.lore.entries[1];
		expect(minor.readonlyColumnBreak).toBe(true);
		expect(snap.playbook.lore.hasReadonlyColumnBreak).toBe(true);
	});

	it("lore option checks has length equal to max", async () => {
		const snap = await buildSnap();
		const opt = snap.playbook.lore.entries[1].options[0];
		expect(opt.checks).toHaveLength(3);
	});

	it("lore option checks are all false when count is 0", async () => {
		const snap = await buildSnap();
		const opt = snap.playbook.lore.entries[0].options[0];
		expect(opt.checks).toEqual([false]);
	});

	it("lore option checks reflect count correctly", async () => {
		const snap = await buildSnap({ "lore.counts": { "danu-offerings:fruits": 2 } });
		const opt = snap.playbook.lore.entries[1].options[0];
		expect(opt.checks).toEqual([true, true, false]);
	});

	const TEXT_LORE_PLAYBOOK = {
		...HEAVY_PLAYBOOK,
		lore: [
			{
				slug: "questions",
				title: "Questions",
				description: "",
				options: [
					{ slug: "q-one", description: "What happened?", type: "text" },
				],
			},
		],
	};

	async function buildSnapWithText(flags = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withFlags(flags)
			.build();
		return new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(TEXT_LORE_PLAYBOOK))
			.build().buildSnapshot();
	}

	it("text-type option has type === 'text'", async () => {
		const snap = await buildSnapWithText();
		expect(snap.playbook.lore.entries[0].options[0].type).toBe("text");
	});

	it("text-type option has checks === []", async () => {
		const snap = await buildSnapWithText();
		expect(snap.playbook.lore.entries[0].options[0].checks).toEqual([]);
	});

	it("text-type option textValue is empty string when no flag saved", async () => {
		const snap = await buildSnapWithText();
		expect(snap.playbook.lore.entries[0].options[0].textValue).toBe("");
	});

	it("text-type option textValue reflects saved flag", async () => {
		const snap = await buildSnapWithText({ "lore.texts": { "questions:q-one": "it was chaos" } });
		expect(snap.playbook.lore.entries[0].options[0].textValue).toBe("it was chaos");
	});
});

// ── movelist: post-death moves ────────────────────────────────────────────────

const REVENANT_INSERT = {
	_id: "pDiRevenant00001",
	name: "Revenant",
	img: null,
	system: { slug: "revenant", description: "<p>When you die…</p>" },
	flags: { stonetop: { instincts: [], lore: [] } },
};

const REVENANT_ACTOR_MOVE = {
	_id: "pdMove001Own",
	name: "Undying",
	type: "move",
	system: { moveType: "post-death", rollType: "str", description: "You refuse to stay down." },
};

describe("buildSnapshot — movelist / post-death moves", () => {
	it("postDeathGroup is null when no active insert", async () => {
		const actor = new FakeActorBuilder().build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.movelist.postDeathGroup).toBeNull();
		expect(snap.movelist.otherGroups.find(g => g.key === "post-death")).toBeUndefined();
	});

	it("postDeathGroup is set to insert name and owned PDI moves", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("postDeathInsert.slug", "revenant")
			.addItem(REVENANT_ACTOR_MOVE)
			.build();
		const pdiRepo = new FakePostDeathInsertRepository([REVENANT_INSERT]);
		const snap = await new TestCharacterBuilder(actor)
			.withPostDeathInsertRepo(pdiRepo)
			.build()
			.buildSnapshot();
		expect(snap.movelist.postDeathGroup).not.toBeNull();
		expect(snap.movelist.postDeathGroup.label).toBe("Revenant");
		expect(snap.movelist.postDeathGroup.moves).toHaveLength(1);
	});

	it("PDI group moves have source.type 'post-death', real ownedId, owned and isStarting true", async () => {
		const actor = new FakeActorBuilder()
			.withFlag("postDeathInsert.slug", "revenant")
			.addItem(REVENANT_ACTOR_MOVE)
			.build();
		const pdiRepo = new FakePostDeathInsertRepository([REVENANT_INSERT]);
		const snap = await new TestCharacterBuilder(actor)
			.withPostDeathInsertRepo(pdiRepo)
			.build()
			.buildSnapshot();
		const move = snap.movelist.postDeathGroup.moves[0];
		expect(move.source.type).toBe("post-death");
		expect(move.ownedId).toBe("pdMove001Own");
		expect(move.owned).toBe(true);
		expect(move.isStarting).toBe(true);
		expect(move.name).toBe("Undying");
	});
});

// ── movelist: level move budget ───────────────────────────────────────────────

describe("buildSnapshot — movelist / level move budget", () => {
	// parseMovePickCount keys off the "… of your choice" phrasing, so the note must
	// carry it for pickCount to be 2 (as real playbook notes do, e.g. the Judge's).
	const BUDGET_PLAYBOOK = { ...HEAVY_PLAYBOOK, startingMovesNote: "Pick 2 moves of your choice." };
	function pbMove(id, name, overrides = {}) {
		return { _id: id, name, system: { moveType: "playbook", isStartingMove: false, rollType: null, ...overrides } };
	}
	function ownedMove(id, name) {
		return { _id: id, type: "move", name, system: { moveType: "playbook" } };
	}
	// A background that hands over a move through a `setup.choices` pick rather than a
	// flat `moves` list — the shape the Fox's A Life of Crime uses (Burgle OR Light
	// Fingers).
	const SETUP_CHOICE_PLAYBOOK = {
		...BUDGET_PLAYBOOK,
		backgrounds: [{
			slug: "a-life-of-crime",
			label: "A Life of Crime",
			setup: {
				choices: [{
					key: "extraMove",
					apply: "move",
					options: [{ value: "Burgle" }, { value: "Light Fingers" }],
				}],
			},
		}],
	};
	// A level-1 A Life of Crime character whose setup choice landed on Burgle, owning
	// whichever moves the caller passes. Level 1 ⇒ 2 free picks.
	const crimeMovelist = items => buildMovelist({
		level:    1,
		playbook: SETUP_CHOICE_PLAYBOOK,
		defs:     [pbMove("a", "Alpha"), pbMove("b", "Bravo"), pbMove("bu", "Burgle"), pbMove("lf", "Light Fingers")],
		flags:    { "background.selected": "a-life-of-crime", "background.setupChoices": { extraMove: "Burgle" } },
		items,
	});
	async function buildMovelist({ level = 1, defs = [], items = [], flags = {}, playbook = BUDGET_PLAYBOOK } = {}) {
		const actor = new FakeActorBuilder()
			.withPlaybook("the-heavy", "The Heavy")
			.withLevel(level)
			.withItems(items)
			.withFlags(flags)
			.build();
		let builder = new TestCharacterBuilder(actor)
			.withPlaybookRepo(new FakePlaybookRepository(playbook));
		for (const def of defs) builder = builder.addPlaybookMove(def);
		const snap = await builder.build().buildSnapshot();
		return snap.movelist;
	}

	it("flags a character that is behind on move picks for its level", async () => {
		// Level 3 ⇒ 2 starting picks + 2 advancements expected; only the 2 starting picks made.
		const ml = await buildMovelist({
			level: 3,
			defs:  [pbMove("a", "Alpha"), pbMove("b", "Bravo")],
			items: [ownedMove("a1", "Alpha"), ownedMove("b1", "Bravo")],
		});
		expect(ml.movesIncomplete).toBe(false);
		expect(ml.levelMovesIncomplete).toBe(true);
		expect(ml.levelMovesShortfall).toBe(2);
		expect(ml.characterLevel).toBe(3);
	});

	it("does not flag a character that has made every pick for its level", async () => {
		// Level 4 ⇒ 2 starting + 3 advancements = 5 picks; all five owned.
		const ml = await buildMovelist({
			level: 4,
			defs:  ["a", "b", "c", "d", "e"].map((s, i) => pbMove(s, `Move ${i}`)),
			items: ["a", "b", "c", "d", "e"].map((s, i) => ownedMove(`${s}1`, `Move ${i}`)),
		});
		expect(ml.levelMovesIncomplete).toBe(false);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverLimit).toBe(false);
		expect(ml.levelMovesOverage).toBe(0);
	});

	it("flags a character that has too many move picks for its level", async () => {
		const ml = await buildMovelist({
			level: 2,
			defs:  ["a", "b", "c", "d"].map((s, i) => pbMove(s, `Move ${i}`)),
			items: ["a", "b", "c", "d"].map((s, i) => ownedMove(`${s}1`, `Move ${i}`)),
		});
		expect(ml.levelMovesIncomplete).toBe(false);
		expect(ml.levelMovesShortfall).toBe(0);
		expect(ml.levelMovesOverLimit).toBe(true);
		expect(ml.levelMovesOverage).toBe(1);
		expect(ml.levelMovesOverageKey).toBe("2:3:4");
	});

	it("stays hidden at level 1 while the starting-moves onboarding prompt is still up", async () => {
		const ml = await buildMovelist({
			level: 1,
			defs:  [pbMove("a", "Alpha"), pbMove("b", "Bravo")],
			items: [],
		});
		expect(ml.movesIncomplete).toBe(true);     // onboarding prompt owns this case
		expect(ml.levelMovesIncomplete).toBe(false);
	});

	it("counts each take of a repeatable move, not just the move name", async () => {
		// Level 3 ⇒ 4 picks expected. Alpha once + Improved Stat taken twice = 3 instances.
		const ml = await buildMovelist({
			level: 3,
			defs:  [pbMove("a", "Alpha"), pbMove("imp", "Improved Stat", { repeatMax: 3, cap: 2 })],
			items: [ownedMove("a1", "Alpha"), ownedMove("imp1", "Improved Stat"), ownedMove("imp2", "Improved Stat")],
		});
		expect(ml.levelMovesIncomplete).toBe(true);
		expect(ml.levelMovesShortfall).toBe(1);
	});

	it("counts repeatable move instances when checking over-budget moves", async () => {
		const ml = await buildMovelist({
			level: 2,
			defs:  [pbMove("a", "Alpha"), pbMove("imp", "Improved Stat", { repeatMax: 3, cap: 2 })],
			items: [ownedMove("a1", "Alpha"), ownedMove("imp1", "Improved Stat"), ownedMove("imp2", "Improved Stat"), ownedMove("imp3", "Improved Stat")],
		});
		expect(ml.levelMovesOverLimit).toBe(true);
		expect(ml.levelMovesOverage).toBe(1);
	});

	it("never counts auto-granted starting moves toward the level budget", async () => {
		// Level 2 ⇒ 3 picks expected. Owning a starting move plus 2 choice moves still
		// leaves the character 1 advancement short — the starting move must not count.
		const ml = await buildMovelist({
			level: 2,
			defs:  [pbMove("s", "Steadfast", { isStartingMove: true }), pbMove("a", "Alpha"), pbMove("b", "Bravo")],
			items: [ownedMove("s1", "Steadfast"), ownedMove("a1", "Alpha"), ownedMove("b1", "Bravo")],
		});
		expect(ml.levelMovesIncomplete).toBe(true);
		expect(ml.levelMovesShortfall).toBe(1);
	});

	it("never counts a background's setup-choice move toward the level budget", async () => {
		// A Life of Crime grants Burgle through a setup choice, not a flat `moves` list.
		// Alpha and Bravo spend the two picks and the granted Burgle rides on top, so the
		// character is exactly on budget and the move reads as a background gift.
		const ml = await crimeMovelist([ownedMove("a1", "Alpha"), ownedMove("b1", "Bravo"), ownedMove("bu1", "Burgle")]);
		expect(ml.levelMovesOverLimit).toBe(false);
		expect(ml.levelMovesOverage).toBe(0);
		expect(ml.playbookMoves.find(m => m.name === "Burgle")?.sourceLabel).toBe("Background");
	});

	it("still counts the option a background's setup choice did NOT take", async () => {
		// The grant was Burgle, so owning Light Fingers as well is a real advancement spend
		// — and at level 1 that puts the character over budget.
		const ml = await crimeMovelist([
			ownedMove("a1", "Alpha"), ownedMove("b1", "Bravo"),
			ownedMove("bu1", "Burgle"), ownedMove("lf1", "Light Fingers"),
		]);
		expect(ml.levelMovesOverLimit).toBe(true);
		expect(ml.levelMovesOverage).toBe(1);
		expect(ml.playbookMoves.find(m => m.name === "Light Fingers")?.sourceLabel).toBeNull();
	});

	it("never flags a character with no playbook", async () => {
		const actor = new FakeActorBuilder().withLevel(4).build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.movelist.levelMovesIncomplete).toBe(false);
		expect(snap.movelist.levelMovesOverLimit).toBe(false);
	});
});

// ── rollMode ──────────────────────────────────────────────────────────────────

// The snapshot used to carry one, for a stacked radio list in the Moves sidebar. Nothing
// renders a roll mode any more: it is asked per roll (module/dialogs/RollDialog.js), which is
// what stopped players carrying yesterday's Advantage into today's rolls. A stale flag left on
// an old actor must not come back through the snapshot and light a control up somewhere.
describe("buildSnapshot — rollMode", () => {
	it("carries none, even for an actor that still holds the retired flag", async () => {
		const actor = new FakeActorBuilder().withRollMode("adv").build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		expect(snap.rollMode).toBeUndefined();
	});
});
describe("buildSnapshot - homefront moves", () => {
	it("normalizes object rollType values before rendering", async () => {
		const actor = new FakeActorBuilder()
			.addItem({
				_id: "h1",
				type: "move",
				name: "Pull Together",
				system: { moveType: "homefront", rollType: { value: "ask", label: "Ask" } },
			})
			.build();
		const snap = await new TestCharacterBuilder(actor).build().buildSnapshot();
		const homefront = snap.moves.find(category => category.key === "homefront");

		expect(homefront.moves[0].rollType).toBe("ask");
		expect(homefront.moves[0].rollLabel).toBe("Population");
	});
});

// ── possession choices: move triggers, caps, open-slot detection ───────────────
// Backs the sacred-pouch editor: which moves grant a sub-choice (Big Magic → pouch),
// owned-move counts that scale the cap, and whether gaining a move frees a new slot.
describe("possession choices: triggers + open-slot detection", () => {
	const SP_CAP = {
		pickNote: "Pick 1", pickCount: 1, preselected: ["pouch"],
		options: [
			{
				slug: "pouch", label: "Sacred Pouch", description: "<p>A pouch.</p>",
				choiceGroups: [
					{ heading: "Your sacred pouch is...", subgroups: [
						{ options: [{slug: "o-a", label: "a"}, {slug: "o-b", label: "b"}] },
					]},
					{ heading: "What remarkable trait does it possess?", subgroups: [
						{ multiSelect: true, maxSelect: 1,
						  maxSelectBonus: { moveBonus: [{ moveName: "Big Magic", perInstance: 1 }] },
						  options: [{slug: "t-a", label: "A"}, {slug: "t-b", label: "B"}] },
					]},
				],
			},
			{ slug: "apiary", label: "Apiary", description: "" },
		],
	};
	const PB = { specialPossessions: SP_CAP };
	const move = name => ({ type: "move", name });
	const charWith = (items = [], flags = {}) =>
		new TestCharacterBuilder(makeHeavyActor({ items, flags }))
			.withPlaybookRepo(new FakePlaybookRepository({ ...HEAVY_PLAYBOOK, specialPossessions: SP_CAP }))
			.build();

	it("ownedMoveCounts counts move items by name (ignoring non-moves)", () => {
		const c = charWith([move("Big Magic"), move("Big Magic"), move("Veil"), { type: "weapon", name: "Spear" }]);
		expect(c.ownedMoveCounts()).toEqual({ "Big Magic": 2, "Veil": 1 });
	});

	it("possessionTriggerMoves maps a cap move to its selected possession", () => {
		expect(charWith().possessionTriggerMoves(PB)).toEqual({ "Big Magic": "pouch" });
	});

	it("possessionTriggerMoves is empty when the possession isn't selected", () => {
		const sp = { ...SP_CAP, preselected: [] };
		const c = new TestCharacterBuilder(makeHeavyActor())
			.withPlaybookRepo(new FakePlaybookRepository({ ...HEAVY_PLAYBOOK, specialPossessions: sp })).build();
		expect(c.possessionTriggerMoves({ specialPossessions: sp })).toEqual({});
	});

	it("possessionWithOpenChoiceFor returns the pouch when Big Magic frees a slot", async () => {
		const c = charWith([move("Big Magic")]); // cap 2, 0 traits chosen
		expect(await c.possessionWithOpenChoiceFor("Big Magic")).toBe("pouch");
	});

	it("possessionWithOpenChoiceFor is null when trait slots are full", async () => {
		// No Big Magic → cap 1; one trait chosen → full.
		const c = charWith([], { "possessions.subChoices": { pouch: ["t-a"] } });
		expect(await c.possessionWithOpenChoiceFor("Big Magic")).toBeNull();
	});

	it("possessionWithOpenChoiceFor ignores moves unrelated to any possession", async () => {
		const c = charWith([move("Big Magic")]);
		expect(await c.possessionWithOpenChoiceFor("Veil")).toBeNull();
	});

	it("possession snapshot flags hasChoiceGroups only for the selected pouch", async () => {
		const snap = await charWith().buildSnapshot();
		expect(snap.inventory.possessions.items.find(i => i.slug === "pouch").hasChoiceGroups).toBe(true);
		expect(snap.inventory.possessions.items.find(i => i.slug === "apiary").hasChoiceGroups).toBe(false);
	});
});
