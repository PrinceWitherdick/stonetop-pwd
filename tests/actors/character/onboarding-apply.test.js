// What onboarding's apply (_applyPlaybookSelections / _applyCommonSelections), the Details tab's
// background dropdown and a change of playbook leave on the character. Each of these REPLACES what
// the character had rather than adding beside it: a re-run of onboarding, a new background or a new
// playbook must not leave the old picks standing next to the new ones. Driven through the real sheet
// and a stateful character (LiveCharacter), with the playbooks as the pack ships them.

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, ownedMoveNames, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { stubConfirm } from "../../fakes/confirm.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CREATION_PICK_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { moveArmor } from "../../../module/actors/character/move-armor.js";
import { combineNameChip } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const moveId = (playbook, name) => sourceMovesFor(playbook).find(d => d.name === name)._id;
const blessedId = name => moveId("The Blessed", name);
const flag = (actor, key) => actor.getFlag("stonetop-pwd", key);
const stamped = item => !!item.flags["stonetop-pwd"]?.[CREATION_PICK_FLAG];
const itemNamed = (actor, name) => actor.items.find(i => i.name === name);
const playbookMoveNames = actor => actor.items.filter(i => i.system?.moveType === "playbook").map(i => i.name).sort();

const BLESSED_STATS = { str: -1, dex: 0, con: 1, int: 0, wis: 2, cha: 1 };

function sheetFor(char, actor) {
	actor.typedActor = char;
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._openPossessionChoices = vi.fn();
	sheet._applyBackgroundNeighbors = vi.fn();
	return sheet;
}

// A Blessed built the way onboarding builds one, from nothing: no moves, no flags.
function freshBlessed(level = 1) {
	const made = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level, seedStartingMoves: false, stats: BLESSED_STATS });
	return { ...made, sheet: sheetFor(made.char, made.actor) };
}

// A first run through onboarding, as the dialog hands it over.
const FIRST_RUN = () => ({
	backgroundSlug: "initiate",
	initiates:      ["enfys", "afon"],
	stats:          BLESSED_STATS,
	possessions:    ["apiary", "mastiffs"],
	moves:          [blessedId("Barkskin")],
	lore: {
		picks: { "the-earth-mother:shrine-loved": 1, "danu-offerings:salt": 1, "danu-offerings:blood": 1 },
		texts: {},
	},
});

afterEach(() => { vi.restoreAllMocks(); });

describe("a first run of onboarding", () => {
	it("gives the starting moves, the background's move and the free pick, stamped as the free pick", async () => {
		const { actor, sheet } = freshBlessed();
		await sheet._applyPlaybookSelections(playbookDoc("the-blessed"), FIRST_RUN());

		expect(playbookMoveNames(actor)).toEqual(["Barkskin", "Call the Spirits", "Rites of the Land", "Spirit Tongue"]);
		// The apiary's gear came with it.
		expect(ownedMoveNames(actor)).toContain("Honey");
		expect(stamped(itemNamed(actor, "Barkskin"))).toBe(true);
		expect(stamped(itemNamed(actor, "Rites of the Land"))).toBe(false);
		expect(flag(actor, "background.choices")).toMatchObject({ enfys: true, afon: true });
	});
});

describe("re-running onboarding", () => {
	async function onboarded() {
		const made = freshBlessed();
		await made.sheet._applyPlaybookSelections(playbookDoc("the-blessed"), FIRST_RUN());
		return made;
	}

	it("changes nothing when confirmed as it was read back", async () => {
		const { actor, sheet } = await onboarded();
		const movesBefore = ownedMoveNames(actor).sort();
		const loreBefore  = structuredClone(flag(actor, "lore.counts"));
		const pbDoc = playbookDoc("the-blessed");

		const restored = sheet._readSelectionsFromActor(pbDoc);
		expect(restored.moves).toEqual(["Barkskin"]);
		await sheet._applyPlaybookSelections(pbDoc, restored);

		expect(ownedMoveNames(actor).sort()).toEqual(movesBefore);
		expect(flag(actor, "lore.counts")).toEqual(loreBefore);
		expect(flag(actor, "background.choices")).toMatchObject({ enfys: true, afon: true, gwendyl: false, olwin: false, seren: false });
	});

	it("replaces the free pick rather than adding a second one", async () => {
		const { actor, sheet } = await onboarded();
		const pbDoc = playbookDoc("the-blessed");
		const sel = sheet._readSelectionsFromActor(pbDoc);

		await sheet._applyPlaybookSelections(pbDoc, { ...sel, moves: [blessedId("Veil")] });

		expect(ownedMoveNames(actor)).not.toContain("Barkskin");
		expect(ownedMoveNames(actor)).toContain("Veil");
		expect(stamped(itemNamed(actor, "Veil"))).toBe(true);
	});

	it("replaces the lore picks, writing the ones taken back as 0", async () => {
		const { actor, sheet } = await onboarded();
		const pbDoc = playbookDoc("the-blessed");
		const sel = sheet._readSelectionsFromActor(pbDoc);
		// The dialog's untick stores 0 (CharacterOnboardingDialog's lore-pick handler).
		sel.lore.picks["the-earth-mother:shrine-loved"] = 0;
		sel.lore.picks["the-earth-mother:shrine-token"] = 1;
		sel.lore.picks["danu-offerings:salt"] = 0;
		sel.lore.picks["danu-offerings:whisky"] = 1;

		await sheet._applyPlaybookSelections(pbDoc, sel);

		const counts = flag(actor, "lore.counts");
		const ticked = section => Object.entries(counts).filter(([k, v]) => k.startsWith(`${section}:`) && v > 0).map(([k]) => k).sort();
		expect(ticked("the-earth-mother")).toEqual(["the-earth-mother:shrine-token"]);
		expect(ticked("danu-offerings")).toEqual(["danu-offerings:blood", "danu-offerings:whisky"]);
	});

	it("takes back the old background's move and grants the new one's", async () => {
		const { actor, sheet } = await onboarded();
		const pbDoc = playbookDoc("the-blessed");
		const sel = sheet._readSelectionsFromActor(pbDoc);

		await sheet._applyPlaybookSelections(pbDoc, { ...sel, backgroundSlug: "vessel", initiates: [] });

		expect(ownedMoveNames(actor)).not.toContain("Rites of the Land");
		expect(ownedMoveNames(actor)).toContain("Danu's Grasp");
		// Only the Initiate's own apply touches the initiates (initiates.js): kept for a return.
		expect(flag(actor, "background.choices")).toMatchObject({ enfys: true, afon: true });
	});

	it("replaces the initiates as a set", async () => {
		const { actor, sheet } = await onboarded();
		const pbDoc = playbookDoc("the-blessed");
		const sel = sheet._readSelectionsFromActor(pbDoc);

		await sheet._applyPlaybookSelections(pbDoc, { ...sel, initiates: ["olwin", "seren"] });

		expect(flag(actor, "background.choices")).toEqual({ enfys: false, afon: false, gwendyl: false, olwin: true, seren: true });
	});

	it("resolves a restored pick still named, when the moves step was never opened", async () => {
		const { actor, sheet } = await onboarded();
		const pbDoc = playbookDoc("the-blessed");
		// Straight through: the names _restoreCreationPicks gave are what arrives.
		await sheet._applyPlaybookSelections(pbDoc, { ...sheet._readSelectionsFromActor(pbDoc), moves: ["Veil"] });

		expect(ownedMoveNames(actor)).toContain("Veil");
		expect(ownedMoveNames(actor)).not.toContain("Barkskin");
	});
});

describe("which moves count as onboarding's free pick", () => {
	it("at 1st level, a character from before the stamp: every move onboarding could have offered", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", level: 1, flags: { "background.selected": "initiate" },
		});
		for (const name of ["Rites of the Land", "Barkskin"]) await char.addMove(blessedId(name));
		const st = playbookDoc("the-blessed").flags.stonetop;

		expect(char.creationPickItems("The Blessed", st.backgrounds, st.moves?.choices).map(i => i.name)).toEqual(["Barkskin"]);
		expect(sheetFor(char, actor)._readSelectionsFromActor(playbookDoc("the-blessed")).moves).toEqual(["Barkskin"]);
	});

	it("past 1st level, a character from before the stamp: none, so a level-up's pick is never taken", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", level: 3, flags: { "background.selected": "initiate" },
		});
		for (const name of ["Rites of the Land", "Barkskin", "Veil"]) await char.addMove(blessedId(name));
		const sheet = sheetFor(char, actor);
		sheet._playbookHpInit = () => ({});
		const pbDoc = playbookDoc("the-blessed");

		const sel = sheet._readSelectionsFromActor(pbDoc);
		expect(sel.moves).toEqual([]);
		await sheet._applyPlaybookSelections(pbDoc, { ...sel, moves: [blessedId("Lightning Rod")] });

		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Barkskin", "Veil", "Lightning Rod"]));
	});

	it("past 1st level, only the stamped pick, whatever else of the same kind a level-up gave", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", level: 3, flags: { "background.selected": "initiate" },
		});
		const barkskin = await char.addMove(blessedId("Barkskin"));
		await barkskin.setFlag("stonetop-pwd", CREATION_PICK_FLAG, true);
		await char.addMove(blessedId("Veil"));
		const sheet = sheetFor(char, actor);
		sheet._playbookHpInit = () => ({});
		const pbDoc = playbookDoc("the-blessed");

		const sel = sheet._readSelectionsFromActor(pbDoc);
		expect(sel.moves).toEqual(["Barkskin"]);
		await sheet._applyPlaybookSelections(pbDoc, { ...sel, moves: [blessedId("Lightning Rod")] });

		expect(ownedMoveNames(actor)).not.toContain("Barkskin");
		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Veil", "Lightning Rod"]));
	});

	it("restores a stat move's pick along with it, keyed by name", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 1 });
		const improved = await char.addMove(moveId("The Would-Be Hero", "Improved Stat"));
		await actor.setFlag("stonetop-pwd", "improvedStatChoices", { [improved._id]: "dex" });

		const sel = sheetFor(char, actor)._readSelectionsFromActor(playbookDoc("the-would-be-hero"));
		expect(sel.moves).toContain("Improved Stat");
		expect(sel.moveStatChoices).toEqual({ "Improved Stat": "dex" });
	});
});

describe("_applyCommonSelections: lore", () => {
	it("sets each of the playbook's pick lists wholesale, and leaves other lore alone", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			flags: { "lore.counts": { "the-earth-mother:shrine-loved": 1, "elsewhere:kept": 1 } },
		});
		const sheet = sheetFor(char, actor);

		await sheet._applyCommonSelections(playbookDoc("the-blessed"), {
			lore: { picks: { "the-earth-mother:shrine-token": 1 }, texts: {} },
		});

		const counts = flag(actor, "lore.counts");
		expect(counts["the-earth-mother:shrine-loved"]).toBe(0);
		expect(counts["the-earth-mother:shrine-token"]).toBe(1);
		expect(counts["elsewhere:kept"]).toBe(1);
	});

	it("empties a written answer the player cleared", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox",
			flags: { "lore.texts": { "tall-tales-write:tale": "Once, in Marshedge..." } },
		});
		const sheet = sheetFor(char, actor);

		await sheet._applyCommonSelections(playbookDoc("the-fox"), { lore: { picks: {}, texts: { "tall-tales-write:tale": "  " } } });

		expect(flag(actor, "lore.texts")["tall-tales-write:tale"]).toBe("");
	});
});

describe("changing background on the Details tab", () => {
	async function initiateBlessed({ boon = 0 } = {}) {
		const made = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", flags: { "background.selected": "initiate" },
		});
		await made.char.ensureStartingMoves();
		if (boon) await made.actor.setFlag("stonetop-pwd", "moves.backgroundChoices", { "Rites of the Land": boon });
		return { ...made, sheet: sheetFor(made.char, made.actor) };
	}
	const choose = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });

	it("takes back the old background's move and grants the new one's, asking nothing", async () => {
		const { actor, sheet } = await initiateBlessed();
		const asked = stubConfirm(true);
		expect(ownedMoveNames(actor)).toContain("Rites of the Land");

		await choose(sheet, "vessel");

		expect(ownedMoveNames(actor)).not.toContain("Rites of the Land");
		expect(ownedMoveNames(actor)).toContain("Danu's Grasp");
		expect(asked).not.toHaveBeenCalled();
	});

	it("asks first when the move going holds Boon, and keeps it all on a no", async () => {
		const { actor, sheet } = await initiateBlessed({ boon: 3 });
		const asked = stubConfirm(false);

		await choose(sheet, "vessel");

		expect(asked).toHaveBeenCalledTimes(1);
		const { content, buttons } = asked.mock.calls[0][0];
		expect(content).toContain("Rites of the Land (3 Boon held)");
		expect(buttons.map(b => b.label)).toEqual(["Change to Vessel", "Keep Initiate"]);
		expect(flag(actor, "background.selected")).toBe("initiate");
		expect(ownedMoveNames(actor)).toContain("Rites of the Land");
		expect(ownedMoveNames(actor)).not.toContain("Danu's Grasp");
	});

	it("goes ahead on a yes", async () => {
		const { actor, sheet } = await initiateBlessed({ boon: 3 });
		stubConfirm(true);

		await choose(sheet, "vessel");

		expect(flag(actor, "background.selected")).toBe("vessel");
		expect(ownedMoveNames(actor)).not.toContain("Rites of the Land");
	});

	it("leaves a move the player also holds as their free pick", async () => {
		const made = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", flags: { "background.selected": "vessel" } });
		await made.char.ensureStartingMoves();
		const trackless = await made.char.addMove(blessedId("Trackless Step"));
		await trackless.setFlag("stonetop-pwd", CREATION_PICK_FLAG, true);
		const sheet = sheetFor(made.char, made.actor);
		stubConfirm(true);

		await choose(sheet, "raised-by-wolves");
		await choose(sheet, "vessel");

		expect(ownedMoveNames(made.actor)).toContain("Trackless Step");
		expect(ownedMoveNames(made.actor).filter(n => n === "Trackless Step")).toHaveLength(1);
	});

	it("never takes a starting move", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", flags: { "background.selected": "initiate" } });
		// A background that also names a starting move would give it twice over; leaving it must not take it.
		const from = { slug: "initiate", setupChoices: {} };
		vi.spyOn(char, "playbook").mockResolvedValue({
			name: "The Blessed",
			backgrounds: [{ slug: "initiate", moves: ["Spirit Tongue"] }, { slug: "vessel", moves: [] }],
		});
		expect(await char.backgroundMovesDropped(from, { slug: "vessel", setupChoices: {} })).toEqual([]);
		expect(ownedMoveNames(actor)).toContain("Spirit Tongue");
	});
});

describe("settleBackgroundMoves, for every background shape", () => {
	it("a setup choice that picks a move: changing only the pick takes back the other (the Fox)", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox",
			flags: { "background.selected": "a-life-of-crime", "background.setupChoices": { extraMove: "Burgle" } },
		});
		await char.ensureStartingMoves();
		expect(ownedMoveNames(actor)).toContain("Burgle");
		const previous = char.backgroundState();

		await actor.setFlag("stonetop-pwd", "background.setupChoices", { extraMove: "Light Fingers" });
		await char.settleBackgroundMoves(previous);

		expect(ownedMoveNames(actor)).not.toContain("Burgle");
		expect(ownedMoveNames(actor)).toContain("Light Fingers");
	});

	it("a flat list of two (the Ranger's Mighty Hunter) goes whole", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger", flags: { "background.selected": "mighty-hunter" },
		});
		await char.ensureStartingMoves();
		const previous = char.backgroundState();

		await char.background.selectBackground("wide-wanderer");
		await char.settleBackgroundMoves(previous);

		expect(ownedMoveNames(actor)).not.toContain("Expert Tracker");
		expect(ownedMoveNames(actor)).not.toContain("Stalker");
		expect(ownedMoveNames(actor)).toContain("Mental Map");
	});

	it("a background's answer to a move (the Seeker's Well Versed topic) follows the background", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-seeker", name: "The Seeker",
			flags: {
				"background.selected": "patriot",
				"moves.backgroundAnswers": { "Well Versed": { label: "Well Versed in", value: "the Things Below" } },
			},
		});
		await char.ensureStartingMoves();
		let previous = char.backgroundState();
		await char.background.selectBackground("antiquarian");
		await char.settleBackgroundMoves(previous);

		expect(ownedMoveNames(actor)).not.toContain("Let's Make a Deal");
		expect(ownedMoveNames(actor)).toContain("Polyglot");
		expect(ownedMoveNames(actor)).toContain("Well Versed");
		expect(flag(actor, "moves.backgroundAnswers")["Well Versed"].value).toBe("the Makers and their arts");

		// A background offering a choice keeps the topic only if it is among the offers.
		previous = char.backgroundState();
		await char.background.selectBackground("witch-hunter");
		await char.settleBackgroundMoves(previous);
		expect(flag(actor, "moves.backgroundAnswers")["Well Versed"]).toBeUndefined();
	});
});

describe("settleBackgroundPossessions", () => {
	it("the Missionary's aviary comes and goes with the background, leaving the player's own pick", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-judge", name: "The Judge",
			flags: { "background.selected": "legacy", "possessions.selected": ["scribes-kit"] },
		});
		let previous = char.backgroundState();
		await char.background.selectBackground("missionary");
		await char.settleBackgroundPossessions(previous);
		expect(flag(actor, "possessions.selected")).toEqual(["scribes-kit", "aviary"]);

		previous = char.backgroundState();
		await char.background.selectBackground("prophet");
		await char.settleBackgroundPossessions(previous);
		expect(flag(actor, "possessions.selected")).toEqual(["scribes-kit"]);
	});

	it("A Life of Crime's pick goes when the Fox leaves it", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox",
			flags: {
				"background.selected": "a-life-of-crime",
				"background.setupChoices": { extraPossession: "hidden-stash" },
				"possessions.selected": ["hidden-stash", "tannery"],
			},
		});
		const previous = char.backgroundState();
		await char.background.selectBackground("the-natural");
		await char.settleBackgroundPossessions(previous);
		expect(flag(actor, "possessions.selected")).toEqual(["tannery"]);
	});
});

describe("changing playbook", () => {
	// A Blessed with everything the playbook brings: Barkskin, the sacred pouch and a trait, the
	// Initiate background and two initiates, shrine lore, Boon on Rites of the Land, a standing
	// Barkskin mark, and an instinct. Plus things that are not the playbook's: a note and XP.
	async function fullBlessed() {
		const made = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed", level: 2, xp: 3,
			flags: {
				"background.selected": "initiate",
				"background.choices": { enfys: true, afon: true },
				"initiateDetails.enfys.pronoun": "she",
				"initiatesLoyalty": { enfys: 2 },
				"possessions.selected": ["sacred-pouch", "mastiffs"],
				"possessions.subChoices": { "sacred-pouch": ["trait-sealed"] },
				"lore.counts": { "the-earth-mother:shrine-loved": 1 },
				"moves.backgroundChoices": { "Rites of the Land": 3 },
				"blessedMarks": [{ id: "m1", kind: "barkskin", name: "Wren" }],
				"instinct.selected": "Delight",
				"notes": "Keep me",
			},
		});
		await made.char.ensureStartingMoves();
		await made.char.addMove(blessedId("Barkskin"));
		await made.char.addMove(blessedId("Wild Soul")).then(wildSoul =>
			made.char._applyForeignMoveChoice(wildSoul, moveId("The Ranger", "Stalker"), null));
		return { ...made, sheet: sheetFor(made.char, made.actor) };
	}

	it("to a DIFFERENT playbook clears what came with the old one, and keeps the rest", async () => {
		const { actor, sheet } = await fullBlessed();
		expect(moveArmor({ actor }).base).toBe(2);
		const asked = stubConfirm(true);

		await sheet._onDropPlaybook(playbookDoc("the-heavy"));

		expect(asked).toHaveBeenCalledTimes(1);
		expect(actor.system.playbook.slug).toBe("the-heavy");
		const names = ownedMoveNames(actor);
		for (const gone of ["Barkskin", "Spirit Tongue", "Call the Spirits", "Rites of the Land", "Wild Soul", "Stalker"]) {
			expect(names, gone).not.toContain(gone);
		}
		expect(names).toEqual(expect.arrayContaining(["Dangerous", "Hard to Kill"]));
		expect(moveArmor({ actor }).base).toBe(0);
		for (const key of ["possessions", "background", "lore", "initiateDetails", "initiatesLoyalty", "blessedMarks", "instinct"]) {
			expect(flag(actor, key), key).toBeNull();
		}
		expect(flag(actor, "moves.backgroundChoices")?.["Rites of the Land"]).toBeUndefined();
		// Not the playbook's.
		expect(actor.system.attributes.level.value).toBe(2);
		expect(actor.system.attributes.xp.value).toBe(3);
		expect(flag(actor, "notes")).toBe("Keep me");
	});

	it("says what goes, with buttons that name the outcome", async () => {
		const { actor, sheet } = await fullBlessed();
		const asked = stubConfirm(false);

		await sheet._onDropPlaybook(playbookDoc("the-heavy"));

		const { content, buttons } = asked.mock.calls[0][0];
		expect(content).toContain("clears everything that came with The Blessed");
		expect(content).toContain("special possessions");
		expect(buttons.map(b => b.label)).toEqual(["Become The Heavy", "Stay The Blessed"]);
		// Declined: nothing changed.
		expect(actor.system.playbook.slug).toBe("the-blessed");
		expect(ownedMoveNames(actor)).toContain("Barkskin");
		expect(flag(actor, "possessions.selected")).toEqual(["sacred-pouch", "mastiffs"]);
	});

	it("to the SAME playbook clears nothing and asks nothing", async () => {
		const { actor, sheet } = await fullBlessed();
		const asked = stubConfirm(true);
		const before = ownedMoveNames(actor).sort();

		await sheet._onDropPlaybook(playbookDoc("the-blessed"));

		expect(asked).not.toHaveBeenCalled();
		expect(ownedMoveNames(actor).sort()).toEqual(before);
		expect(flag(actor, "background.choices")).toEqual({ enfys: true, afon: true });
		expect(flag(actor, "lore.counts")).toEqual({ "the-earth-mother:shrine-loved": 1 });
	});

	it("through \"New\" in the creation flow: the apply clears the old playbook first", async () => {
		const { actor, sheet } = freshBlessed();
		await sheet._applyPlaybookSelections(playbookDoc("the-blessed"), FIRST_RUN());
		expect(ownedMoveNames(actor)).toContain("Honey");

		await sheet._applyPlaybookSelections(playbookDoc("the-heavy"), {
			backgroundSlug: "sheriff", stats: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: -1 },
			moves: [], lore: { picks: {}, texts: {} },
		});

		expect(ownedMoveNames(actor)).not.toContain("Barkskin");
		expect(flag(actor, "possessions.selected") ?? []).not.toContain("sacred-pouch");
		// The apiary went, and its gear with it.
		expect(ownedMoveNames(actor)).not.toContain("Honey");
		expect(flag(actor, "background.choices")).toBeNull();
		expect(flag(actor, "background.selected")).toBe("sheriff");
		expect(flag(actor, "lore.counts")?.["the-earth-mother:shrine-loved"]).toBeUndefined();
	});
});

describe("the Wild's names: mix and match 1-3", () => {
	it("appends a word, up to three, and never the same word twice", () => {
		expect(combineNameChip("", "Red", 3)).toBe("Red");
		expect(combineNameChip("Red", "Wolf", 3)).toBe("Red Wolf");
		expect(combineNameChip("Red Wolf", "Red", 3)).toBe("Red Wolf");
		expect(combineNameChip("Red Wolf", "Winter", 3)).toBe("Red Wolf Winter");
		expect(combineNameChip("Red Wolf Winter", "Owl", 3)).toBe("Red Wolf Winter");
	});

	it("replaces the name for a region of whole names", () => {
		expect(combineNameChip("Arwel", "Celyn", 0)).toBe("Celyn");
	});

	it("is the only origin that says so in the data", () => {
		const combining = [...PACK.values()].flatMap(doc => (doc.flags.stonetop.origin ?? [])
			.filter(o => o.combine).map(o => [doc.name, o.region, o.combine, o.note]));
		expect(combining).toEqual([["The Blessed", "The Wild", 3, "Mix and match 1-3 of these."]]);
	});
});
