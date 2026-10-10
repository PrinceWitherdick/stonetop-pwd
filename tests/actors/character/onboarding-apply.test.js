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
import { CharacterOnboardingDialog, combineNameChip } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { BackgroundAnswersDialog } from "../../../module/actors/character/dialogs/BackgroundAnswersDialog.js";

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

	it("hands the neighbor traits as filed last time to the filing, read before they are overwritten", async () => {
		const { actor, sheet } = await onboarded();
		await actor.setFlag("stonetop-pwd", "background.neighborTraits", { ennis: "sly" });
		const pbDoc = playbookDoc("the-blessed");

		await sheet._applyPlaybookSelections(pbDoc, sheet._readSelectionsFromActor(pbDoc));

		expect(sheet._applyBackgroundNeighbors.mock.calls.at(-1)[2]).toEqual({ previousTraits: { ennis: "sly" } });
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

	it("a level-up pick the new background also gives stays a pick, through Mighty Hunter and back (the Ranger)", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger", level: 3, flags: { "background.selected": "wide-wanderer" },
		});
		await char.ensureStartingMoves();
		const stalker = await char.addMove(moveId("The Ranger", "Stalker"));
		const shortfall = async () => (await char.buildSnapshot()).movelist.levelMovesShortfall;
		const before = await shortfall();
		const switchTo = async slug => {
			const previous = char.backgroundState();
			await char.background.selectBackground(slug);
			await char.settleBackgroundMoves(previous);
		};

		await switchTo("mighty-hunter");
		expect(actor.items.filter(i => i.name === "Stalker").map(i => i._id)).toEqual([stalker._id]);
		expect(await shortfall()).toBe(before);
		const row = (await char.buildSnapshot()).movelist.playbookMoves.find(m => m.name === "Stalker");
		expect(row.sourceLabel).toBeNull();

		await switchTo("wide-wanderer");
		expect(ownedMoveNames(actor)).toContain("Stalker");
		expect(ownedMoveNames(actor)).not.toContain("Expert Tracker");
		expect(await shortfall()).toBe(before);
	});

	it("a background's own copy from before the stamp still goes when it is left (the legacy path)", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-ranger", name: "The Ranger", level: 3, flags: { "background.selected": "mighty-hunter" },
		});
		await char.addMove(moveId("The Ranger", "Stalker"));
		await char.ensureStartingMoves();
		const previous = char.backgroundState();
		await char.background.selectBackground("wide-wanderer");
		await char.settleBackgroundMoves(previous);

		expect(ownedMoveNames(actor)).not.toContain("Stalker");
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

// The Seeker's backgrounds note a Well Versed topic: the Patriot's and the Antiquarian's are fixed,
// the Witch Hunter's is "(pick 1) the Fae, the Things Below, or the Last Door and what lies beyond".
describe("a background's Well Versed topic on the Details tab", () => {
	const seeker = (flags = {}) => {
		const made = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", flags });
		return { ...made, sheet: sheetFor(made.char, made.actor) };
	};
	const choose = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });
	const answer = actor => flag(actor, "moves.backgroundAnswers")?.["Well Versed"]?.value;
	const card = async char => (await char.buildSnapshot()).movelist.playbookMoves.find(m => m.name === "Well Versed");

	it("a first background picked there writes its fixed topic", async () => {
		const { actor, sheet } = seeker();
		await choose(sheet, "patriot");
		expect(answer(actor)).toBe("the Things Below");
	});

	it("a switch to the Witch Hunter asks the topic, the kept one pre-picked, and writes the pick", async () => {
		const { char, actor, sheet } = seeker({
			"background.selected": "patriot",
			"moves.backgroundAnswers": { "Well Versed": { label: "Well Versed in", value: "the Things Below" } },
		});
		await char.ensureStartingMoves();
		const ask = vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue({ "Well Versed": "the Fae" });
		await choose(sheet, "witch-hunter");
		expect(ask).toHaveBeenCalledTimes(1);
		const [background, asks] = ask.mock.calls[0];
		expect(background.slug).toBe("witch-hunter");
		expect(asks).toEqual([{
			key: "Well Versed", move: "Well Versed", label: "Well Versed in",
			options: ["the Fae", "the Things Below", "the Last Door and what lies beyond"],
			value: "the Things Below",
		}]);
		expect(answer(actor)).toBe("the Fae");
	});

	it("closed unanswered, a topic not on offer is gone and the card cues the choice", async () => {
		const { char, actor, sheet } = seeker({
			"background.selected": "antiquarian",
			"moves.backgroundAnswers": { "Well Versed": { label: "Well Versed in", value: "the Makers and their arts" } },
		});
		await char.ensureStartingMoves();
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
		await choose(sheet, "witch-hunter");
		expect(answer(actor)).toBeUndefined();
		const wv = await card(char);
		expect(wv.backgroundAnswerNeeded).toMatchObject({ label: "Well Versed in", options: ["the Fae", "the Things Below", "the Last Door and what lies beyond"] });
		expect(wv.backgroundAnswerNeeded.tooltip).toContain("the Fae, the Things Below");
		// The cue's hand asks again; an answer ends it.
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue({ "Well Versed": "the Last Door and what lies beyond" });
		await sheet._askBackgroundAnswers();
		expect(answer(actor)).toBe("the Last Door and what lies beyond");
		expect((await card(char)).backgroundAnswerNeeded).toBeNull();
	});

	it("setBackgroundAnswer takes only an offer the background prints", async () => {
		const { char, actor } = seeker({ "background.selected": "witch-hunter" });
		expect(await char.setBackgroundAnswer("Well Versed", "the Makers and their arts")).toBe(false);
		expect(answer(actor)).toBeUndefined();
		expect(await char.setBackgroundAnswer("Well Versed", "the Fae")).toBe(true);
		expect(answer(actor)).toBe("the Fae");
	});
});

// Well Versed: "Mark 1 topic, in addition to the one noted in your Background." Onboarding asks it
// beside the background's topic, and marks it at 1st level.
describe("onboarding's extra Well Versed topic", () => {
	const SEEKER_STATS = { str: -1, dex: 0, con: 1, int: 2, wis: 1, cha: 0 };
	const freshSeeker = (level = 1) => {
		const made = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level, seedStartingMoves: false, stats: SEEKER_STATS });
		return { ...made, sheet: sheetFor(made.char, made.actor) };
	};
	const run = (sheet, extra, backgroundSlug = "patriot") => sheet._applyPlaybookSelections(playbookDoc("the-seeker"), {
		backgroundSlug, stats: SEEKER_STATS, moves: [], lore: { picks: {}, texts: {} },
		backgroundChoices: { "Well Versed": { label: "Well Versed in", value: "the Things Below" } },
		backgroundMoveMarks: { "Well Versed": extra },
	});
	const wvMarks = actor => flag(actor, "moves.moveMarks")?.["Well Versed"] ?? {};
	const marked = actor => Object.entries(wvMarks(actor)).filter(([, v]) => v?.length).map(([slug]) => slug).sort();

	it("marks the topic at 1st level, and a re-run replaces it", async () => {
		const { actor, sheet } = freshSeeker();
		vi.spyOn(sheet._stonetopCharacter, "addArcanum").mockResolvedValue(undefined);
		await run(sheet, "fae");
		expect(marked(actor)).toEqual(["fae"]);
		expect(wvMarks(actor).fae[0].level).toBe(1);
		await run(sheet, "wild");
		expect(marked(actor)).toEqual(["wild"]);
	});

	it("a re-run past 1st level keeps the level-up topics and restores its own pick", async () => {
		const { char, actor, sheet } = freshSeeker(3);
		await run(sheet, "fae");
		// A second Well Versed at 2nd level, with its 2 topics.
		await char.addMove(moveId("The Seeker", "Well Versed"));
		await actor.setFlag("stonetop-pwd", "moves.moveMarks", {
			"Well Versed": { ...wvMarks(actor), humanity: [{ stat: "", level: 2 }], primordial: [{ stat: "", level: 2 }] },
		});
		expect(sheet._readSelectionsFromActor(playbookDoc("the-seeker")).backgroundMoveMarks).toEqual({ "Well Versed": "fae" });
		await run(sheet, "wild");
		expect(marked(actor)).toEqual(["humanity", "primordial", "wild"]);
		expect(wvMarks(actor).wild[0].level).toBe(1);
	});

	it("the background step asks it, never offers the background's topic, and waits for it", () => {
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		dialog._initializeState(playbookDoc("the-seeker"), null, null);
		dialog._applyBackgroundChange("witch-hunter");
		dialog._selections.backgroundChoices["Well Versed"] = { label: "Well Versed in", value: "the Fae" };
		const witchHunter = dialog._backgrounds.find(b => b.slug === "witch-hunter");
		const extra = dialog._backgroundMoveChoiceData(witchHunter)[0].extraMark;
		expect(extra.options.map(o => o.slug)).toEqual(["last-door", "humanity", "fae", "makers", "primordial", "things-below", "wild"]);
		expect(extra.options.find(o => o.slug === "fae")).toMatchObject({ fromBackground: true, selected: false });
		expect(dialog._isStepComplete("background")).toBe(false);
		expect(dialog._backgroundStepDiagnostic().missing).toContain("moveMark:Well Versed");

		// The background's own topic doesn't count.
		dialog._selections.backgroundMoveMarks["Well Versed"] = "fae";
		expect(dialog._isStepComplete("background")).toBe(false);
		dialog._selections.backgroundMoveMarks["Well Versed"] = "wild";
		expect(dialog._isStepComplete("background")).toBe(true);

		// Picking the extra topic as the background's drops the extra pick.
		dialog._selections.backgroundChoices["Well Versed"].value = "the Things Below";
		dialog._selections.backgroundMoveMarks["Well Versed"] = "things-below";
		dialog._ensureBackgroundMoveChoices();
		expect(dialog._selections.backgroundMoveMarks["Well Versed"]).toBeUndefined();
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

	// Only onboarding used to select the preselected possessions, and only a select makes their
	// gear: a GM who dropped The Judge on a blank sheet and closed onboarding got Scribe's kit
	// ticked and locked, and no Parchment, Ink or Notebook.
	it("onto a blank character brings the preselected possessions' gear without onboarding", async () => {
		const { char, actor } = buildLiveCharacter({ seedStartingMoves: false });
		const sheet = sheetFor(char, actor);
		const asked = stubConfirm(true);

		await sheet._onDropPlaybook(playbookDoc("the-judge"));

		expect(asked).not.toHaveBeenCalled();
		expect(ownedMoveNames(actor)).toEqual(expect.arrayContaining(["Parchment", "Ink", "Pigments", "Vials", "Quills", "Notebook"]));
		expect(itemNamed(actor, "Notebook").system.sourcePossession).toBe("scribes-kit");
		expect(ownedMoveNames(actor)).not.toContain("Anvil");
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

// "Start play with your current HP equal to your max HP" (Book I p.53): the REAL max, with the
// stats, moves and any lasting adjustment in it, not the printed number the drop seeds.
describe("a new playbook starts at full HP", () => {
	const hp = actor => actor.system.attributes.hp;
	const HEAVY_RUN = () => ({
		backgroundSlug: "sheriff", stats: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: -1 },
		moves: [], lore: { picks: {}, texts: {} },
	});

	it("through onboarding: current and stored max HP are the computed max", async () => {
		const { char, actor, sheet } = freshBlessed();
		await sheet._applyPlaybookSelections(playbookDoc("the-heavy"), HEAVY_RUN());

		const max = await char.computedMaxHp();
		expect(max).toBeGreaterThan(0);
		expect(hp(actor).value).toBe(max);
		expect(hp(actor).max).toBe(max);
	});

	it("keeps a lasting adjustment through the change, and starts full at the max it gives", async () => {
		const { char, actor, sheet } = freshBlessed();
		await sheet._applyPlaybookSelections(playbookDoc("the-blessed"), FIRST_RUN());
		await actor.update({ "system.attributes.hp.adjustment": -3 });
		const unadjusted = (await char.computedMaxHp()) + 3;

		await sheet._applyPlaybookSelections(playbookDoc("the-heavy"), HEAVY_RUN());

		const max = await char.computedMaxHp();
		expect(hp(actor).adjustment).toBe(-3);
		expect(hp(actor).value).toBe(max);
		expect(max).not.toBe(unadjusted);
	});

	it("a re-run of the SAME playbook leaves the damage taken", async () => {
		const { actor, sheet } = freshBlessed();
		await sheet._applyPlaybookSelections(playbookDoc("the-blessed"), FIRST_RUN());
		await actor.update({ "system.attributes.hp.value": 2 });

		await sheet._applyPlaybookSelections(playbookDoc("the-blessed"), sheet._readSelectionsFromActor(playbookDoc("the-blessed")));

		expect(hp(actor).value).toBe(2);
	});

	it("through a playbook drop: current and stored max HP are the computed max, adjustment and all", async () => {
		const { char, actor } = buildLiveCharacter({ seedStartingMoves: false });
		await actor.update({ "system.attributes.hp.adjustment": -3 });
		const sheet = sheetFor(char, actor);
		stubConfirm(true);

		await sheet._onDropPlaybook(playbookDoc("the-heavy"));

		const max = await char.computedMaxHp();
		expect(max).toBe(playbookDoc("the-heavy").flags.stonetop.hp - 3);
		expect(hp(actor).value).toBe(max);
		expect(hp(actor).max).toBe(max);
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

// "You start knowing 2" Invocations is onboarding's step; Level Up step 5 adds one at each even level.
// A re-run replaces only the starting pair (starting-invocations.js).
describe("re-running onboarding: the Lightbearer's Invocations", () => {
	const LIGHTBEARER_STATS = { str: -1, dex: 0, con: 1, int: 0, wis: 2, cha: 1 };
	const FOUR = ["blinding-light", "dancing-light", "warmth-of-the-sun", "cold-light-of-day"];
	const STAMPED = ["blinding-light", "dancing-light"];

	function lightbearer(flags = {}) {
		const made = buildLiveCharacter({
			slug: "the-lightbearer", name: "The Lightbearer", level: 4, stats: LIGHTBEARER_STATS,
			flags: { "background.selected": "auspicious-birth", "invocations.selected": FOUR, ...flags },
		});
		const sheet = sheetFor(made.char, made.actor);
		sheet._playbookHpInit = () => ({});
		return { ...made, sheet };
	}

	it("restores only the stamped starting pair, and the level-up ones as learned", () => {
		const { sheet } = lightbearer({ "invocations.starting": STAMPED });
		const sel = sheet._readSelectionsFromActor(playbookDoc("the-lightbearer"));
		expect(sel.invocations).toEqual(STAMPED);
		expect(sel.learnedInvocations).toEqual(["warmth-of-the-sun", "cold-light-of-day"]);
	});

	it("keeps the two learned at level-up when the pair is replaced, and stamps the new pair", async () => {
		const { actor, sheet } = lightbearer({ "invocations.starting": STAMPED });
		const pbDoc = playbookDoc("the-lightbearer");
		const sel = sheet._readSelectionsFromActor(pbDoc);

		await sheet._applyPlaybookSelections(pbDoc, { ...sel, invocations: ["moth-to-a-flame", "blinding-light"] });

		expect(flag(actor, "invocations.selected")).toEqual(["moth-to-a-flame", "blinding-light", "warmth-of-the-sun", "cold-light-of-day"]);
		expect(flag(actor, "invocations.starting")).toEqual(["moth-to-a-flame", "blinding-light"]);
	});

	it("changes nothing when confirmed as it was read back", async () => {
		const { actor, sheet } = lightbearer({ "invocations.starting": STAMPED });
		const pbDoc = playbookDoc("the-lightbearer");
		await sheet._applyPlaybookSelections(pbDoc, sheet._readSelectionsFromActor(pbDoc));
		expect(flag(actor, "invocations.selected")).toEqual(FOUR);
	});

	it("takes a character from before the stamp to have started with the first two", async () => {
		const { actor, sheet } = lightbearer();
		const pbDoc = playbookDoc("the-lightbearer");
		const sel = sheet._readSelectionsFromActor(pbDoc);
		expect(sel.invocations).toEqual(STAMPED);

		await sheet._applyPlaybookSelections(pbDoc, { ...sel, invocations: ["moth-to-a-flame", "terrible-as-the-dawn"] });

		expect(flag(actor, "invocations.selected")).toEqual(["moth-to-a-flame", "terrible-as-the-dawn", "warmth-of-the-sun", "cold-light-of-day"]);
		expect(flag(actor, "invocations.starting")).toEqual(["moth-to-a-flame", "terrible-as-the-dawn"]);
	});

	it("ends an ongoing Invocation the re-run leaves unknown, and keeps one still known", async () => {
		const dropped = lightbearer({ "invocations.starting": STAMPED, ongoingInvocation: "dancing-light" });
		const pbDoc = playbookDoc("the-lightbearer");
		await dropped.sheet._applyPlaybookSelections(pbDoc, { ...dropped.sheet._readSelectionsFromActor(pbDoc), invocations: ["blinding-light", "moth-to-a-flame"] });
		expect(dropped.char.ongoingInvocations).toEqual([]);

		const kept = lightbearer({ "invocations.starting": STAMPED, ongoingInvocation: "warmth-of-the-sun" });
		await kept.sheet._applyPlaybookSelections(pbDoc, { ...kept.sheet._readSelectionsFromActor(pbDoc), invocations: ["blinding-light", "moth-to-a-flame"] });
		expect(kept.char.ongoingInvocations).toEqual(["warmth-of-the-sun"]);
	});

	it("shows the learned ones ticked and locked in the step, which completes with the starting two", () => {
		const { sheet } = lightbearer({ "invocations.starting": STAMPED });
		const pbDoc = playbookDoc("the-lightbearer");
		const dialog = Object.create(CharacterOnboardingDialog.prototype);
		dialog._initializeState(pbDoc, null, null);
		// The test Foundry's mergeObject is not in place, so the restored picks go in by hand.
		Object.assign(dialog._selections, sheet._readSelectionsFromActor(pbDoc));

		expect(dialog._isStepComplete("invocations")).toBe(true);
		const data = dialog._invocationStepData();
		expect(data).toMatchObject({ startingCount: 2, selectedCount: 2, learnedCount: 2 });
		const card = slug => data.options.find(o => o.slug === slug);
		expect(card("warmth-of-the-sun")).toMatchObject({ isSelected: true, isLearned: true, disabled: true });
		expect(card("blinding-light")).toMatchObject({ isSelected: true, isLearned: false, disabled: false });
		// The pair is full, so an unknown one waits for a starting pick to be unticked.
		expect(card("moth-to-a-flame")).toMatchObject({ isSelected: false, disabled: true });
	});
});

// Itinerant Mystic: "At the very start of play, hold 3 Enigma." Only onboarding is the start.
describe("a background's setup tracks", () => {
	const choose = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });

	it("onboarding at the start of play gives the Itinerant Mystic 3 Enigma", async () => {
		const made = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", seedStartingMoves: false });
		const sheet = sheetFor(made.char, made.actor);
		const pbDoc = playbookDoc("the-lightbearer");
		await sheet._applyPlaybookSelections(pbDoc, {
			backgroundSlug: "itinerant-mystic", stats: { str: -1, dex: 0, con: 1, int: 0, wis: 2, cha: 1 },
			moves: [], invocations: ["blinding-light", "dancing-light"], lore: { picks: {}, texts: {} },
		});
		expect(flag(made.actor, "background.setupResources")).toMatchObject({ enigma: 3 });
	});

	it("a switch to it mid-play starts the Enigma empty", async () => {
		const made = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer", flags: { "background.selected": "soul-on-fire" } });
		const sheet = sheetFor(made.char, made.actor);
		stubConfirm(true);
		await choose(sheet, "itinerant-mystic");
		expect(flag(made.actor, "background.selected")).toBe("itinerant-mystic");
		expect(flag(made.actor, "background.setupResources")).toEqual({ enigma: 0 });
	});

	it("a first background picked on the Details tab is still the start of play, so nothing is seeded", async () => {
		const made = buildLiveCharacter({ slug: "the-lightbearer", name: "The Lightbearer" });
		const sheet = sheetFor(made.char, made.actor);
		await choose(sheet, "itinerant-mystic");
		expect(flag(made.actor, "background.setupResources")).toBeFalsy();
	});

	it("holds up to 9 Enigma", () => {
		const im = PACK.get("the-lightbearer").flags.stonetop.backgrounds.find(b => b.slug === "itinerant-mystic");
		expect(im.setup.resources[0]).toMatchObject({ key: "enigma", max: 9, value: 3 });
	});
});
