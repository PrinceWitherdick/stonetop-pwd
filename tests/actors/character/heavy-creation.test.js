// Making a Heavy, through the real sheet and a stateful character (LiveCharacter), with the
// playbooks and moves as the pack ships them: the Storm-Marked's arcanum and its one mark, the
// Sheriff's barked order, and Armored's hauberk "if you take this move at the start of play".

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, ownedMoveNames, sourceMovesFor, STANDARD_ARRAY } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs, loadArcanaPackDocs } from "../../fakes/sourcePack.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { stubConfirm } from "../../fakes/confirm.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { START_GEAR_FLAG } from "../../../module/actors/character/start-of-play-gear.js";

const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const moveId = (playbook, name) => sourceMovesFor(playbook).find(d => d.name === name)._id;
const heavyId = name => moveId("The Heavy", name);
const flag = (actor, key) => actor.getFlag("stonetop-pwd", key);
const itemNamed = (actor, name) => actor.items.find(i => i.name === name);
const arcanaRepo = () => new FakeArcanaRepository(loadArcanaPackDocs().map(doc => structuredClone(doc.flags.stonetop)));

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

// A character built the way onboarding builds one, from nothing: no moves, no flags.
function fresh(slug = "the-heavy", name = "The Heavy", { flags = {} } = {}) {
	const made = buildLiveCharacter({ slug, name, seedStartingMoves: false, arcana: arcanaRepo(), flags });
	return { ...made, sheet: sheetFor(made.char, made.actor) };
}

// A run through onboarding for a Heavy, as the dialog hands it over.
const HEAVY_RUN = (over = {}) => ({
	backgroundSlug: "sheriff",
	stats:          STANDARD_ARRAY,
	moves:          [],
	moveChoices:    { 0: heavyId("Armored") },
	lore:           { picks: {}, texts: {} },
	...over,
});

const onboard = (sheet, selections, slug = "the-heavy") => sheet._applyPlaybookSelections(playbookDoc(slug), selections);
const choose  = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });
const boxes   = actor => flag(actor, "arcana.boxes") ?? {};
const owned   = actor => flag(actor, "arcana.owned") ?? [];
const stormCard = async char => (await char._arcana.buildSnapshot()).major.items.find(i => i.slug === "storm-markings");

afterEach(() => { vi.restoreAllMocks(); });

describe("the Storm-Marked's arcanum", () => {
	it("is given identified, with one of the ○○○ unlock circles marked, the mark the card counts", async () => {
		const { char, actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN({ backgroundSlug: "storm-marked" }));

		expect(owned(actor)).toEqual(["storm-markings"]);
		expect(flag(actor, "arcana.identified")).toEqual(["storm-markings"]);
		expect(boxes(actor)).toEqual({ "storm-markings:unlock:0": true });
		expect((await stormCard(char)).unlocked).toBe(false);

		// "When you make the last mark, you unlock the mysteries": two more, and it is unlocked.
		await char.setArcanumBoxChecked("storm-markings", "unlock", 1, true);
		await char.setArcanumBoxChecked("storm-markings", "unlock", 2, true);
		expect((await stormCard(char)).unlocked).toBe(true);
	});

	it("comes with the background on the Details tab, and goes with it while untouched", async () => {
		const { actor, sheet } = fresh("the-heavy", "The Heavy", { flags: { "background.selected": "sheriff" } });
		stubConfirm(true);

		await choose(sheet, "storm-marked");
		expect(owned(actor)).toEqual(["storm-markings"]);
		expect(flag(actor, "arcana.identified")).toEqual(["storm-markings"]);
		expect(boxes(actor)).toEqual({ "storm-markings:unlock:0": true });

		await choose(sheet, "blood-soaked-past");
		expect(owned(actor)).toEqual([]);
		expect(boxes(actor)).toEqual({});
	});

	it("stays when play has marked it further, or put Fury on its track", async () => {
		const { char, actor, sheet } = fresh("the-heavy", "The Heavy", { flags: { "background.selected": "storm-marked" } });
		stubConfirm(true);
		await char.settleBackgroundArcana({ slug: "sheriff", setupChoices: {} });
		await char.setArcanumBoxChecked("storm-markings", "unlock", 1, true);

		await choose(sheet, "sheriff");
		expect(owned(actor)).toEqual(["storm-markings"]);

		await choose(sheet, "storm-marked");
		await char.setArcanumBoxChecked("storm-markings", "unlock", 1, false);
		await char.setArcanumResource("storm-markings", 2);
		await choose(sheet, "sheriff");
		expect(owned(actor)).toEqual(["storm-markings"]);
	});

	it("is not given twice, nor marked again, on a re-run of the same background", async () => {
		const { char, actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN({ backgroundSlug: "storm-marked" }));
		// The player moved the mark to the next circle.
		await char.setArcanumBoxChecked("storm-markings", "unlock", 0, false);
		await char.setArcanumBoxChecked("storm-markings", "unlock", 1, true);

		await onboard(sheet, HEAVY_RUN({ backgroundSlug: "storm-marked" }));

		expect(owned(actor)).toEqual(["storm-markings"]);
		expect(boxes(actor)).toEqual({ "storm-markings:unlock:0": false, "storm-markings:unlock:1": true });
	});

	it("goes on a re-run of onboarding that picks another background, while untouched", async () => {
		const { actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN({ backgroundSlug: "storm-marked" }));

		await onboard(sheet, HEAVY_RUN({ backgroundSlug: "sheriff" }));

		expect(owned(actor)).toEqual([]);
	});
});

describe("Armored at the start of play", () => {
	const hauberk = actor => ({
		added:   (flag(actor, "inventory.addedSpecial") ?? []).includes("hauberk-iron"),
		carried: !!flag(actor, "inventory.checked")?.["hauberk-iron"],
	});

	it("adds the hauberk, carried, and the move remembers it", async () => {
		const { actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN());

		expect(hauberk(actor)).toEqual({ added: true, carried: true });
		expect(itemNamed(actor, "Armored").flags["stonetop-pwd"][START_GEAR_FLAG]).toBe("hauberk-iron");
	});

	it("gives it once: a re-run of the same choice adds nothing", async () => {
		const { actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN());
		await onboard(sheet, HEAVY_RUN());

		expect(flag(actor, "inventory.addedSpecial")).toEqual(["hauberk-iron"]);
	});

	it("takes it back when a re-run swaps to Uncanny Reflexes", async () => {
		const { actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN());

		await onboard(sheet, HEAVY_RUN({ moveChoices: { 0: heavyId("Uncanny Reflexes") } }));

		expect(ownedMoveNames(actor)).not.toContain("Armored");
		expect(hauberk(actor)).toEqual({ added: false, carried: false });
	});

	it("leaves a hauberk the player added themselves", async () => {
		const { char, actor, sheet } = fresh();
		await char._inventory.addSpecial("hauberk-iron");
		await onboard(sheet, HEAVY_RUN());
		expect(itemNamed(actor, "Armored").flags["stonetop-pwd"][START_GEAR_FLAG]).toBeUndefined();

		await onboard(sheet, HEAVY_RUN({ moveChoices: { 0: heavyId("Uncanny Reflexes") } }));

		expect(hauberk(actor).added).toBe(true);
	});

	it("gives nothing taken later, at a level-up or on the Moves tab", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 2 });
		// LiveCharacter seeds Armored as the starting half; take the other half as a pick.
		await char.addMove(heavyId("Uncanny Reflexes"));
		const { char: judge, actor: judgeActor } = buildLiveCharacter({ slug: "the-judge", name: "The Judge", level: 2 });
		await judge.addMove(moveId("The Judge", "Armored"));

		expect(flag(actor, "inventory.addedSpecial")).toBeNull();
		expect(flag(judgeActor, "inventory.addedSpecial")).toBeNull();
	});

	it("the Marshal's Armored as onboarding's free pick adds it too, and a re-run that drops the pick takes it back", async () => {
		const { actor, sheet } = fresh("the-marshal", "The Marshal");
		const marshalRun = pick => ({
			backgroundSlug: "penitent", stats: STANDARD_ARRAY, moves: [moveId("The Marshal", pick)], lore: { picks: {}, texts: {} },
		});

		await onboard(sheet, marshalRun("Armored"), "the-marshal");
		expect(hauberk(actor)).toEqual({ added: true, carried: true });

		await onboard(sheet, marshalRun("Shield Wall"), "the-marshal");
		expect(ownedMoveNames(actor)).not.toContain("Armored");
		expect(hauberk(actor)).toEqual({ added: false, carried: false });
	});

	describe("un-ticked on the Moves tab", () => {
		const marshalArmored = { backgroundSlug: "penitent", stats: STANDARD_ARRAY, moves: [moveId("The Marshal", "Armored")], lore: { picks: {}, texts: {} } };
		const untick = (char, actor) => char.removeMove(itemNamed(actor, "Armored")._id);

		it("takes back the hauberk Armored brought at the start of play", async () => {
			const { char, actor, sheet } = fresh("the-marshal", "The Marshal");
			await onboard(sheet, marshalArmored, "the-marshal");
			expect(hauberk(actor)).toEqual({ added: true, carried: true });

			await untick(char, actor);

			expect(ownedMoveNames(actor)).not.toContain("Armored");
			expect(hauberk(actor)).toEqual({ added: false, carried: false });
		});

		it("leaves a hauberk the player had before, which Armored never claimed", async () => {
			const { char, actor, sheet } = fresh("the-marshal", "The Marshal");
			await char._inventory.addSpecial("hauberk-iron");
			await onboard(sheet, marshalArmored, "the-marshal");

			await untick(char, actor);

			expect(hauberk(actor).added).toBe(true);
		});

		it("leaves it while another move still claims it", async () => {
			const { char, actor, sheet } = fresh("the-marshal", "The Marshal");
			await onboard(sheet, marshalArmored, "the-marshal");
			const other = actor.items.find(i => i.type === "move" && i.name !== "Armored");
			await other.setFlag("stonetop-pwd", START_GEAR_FLAG, "hauberk-iron");

			await untick(char, actor);

			expect(hauberk(actor).added).toBe(true);
		});
	});
});

describe("the Sheriff's barked order", () => {
	it("is a +CHA move the background gives, not a pick", async () => {
		const { char, actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN());

		const bark = itemNamed(actor, "Bark an Order");
		expect(bark.system.rollType).toBe("cha");
		expect(Object.keys(bark.system.moveResults)).toEqual(["success", "partial", "failure"]);
		const { movelist } = await char.buildSnapshot();
		expect(movelist.levelMovesShortfall).toBe(0);
		expect(movelist.levelMovesOverage).toBe(0);
	});

	it("goes when the Heavy leaves the Sheriff", async () => {
		const { actor, sheet } = fresh();
		await onboard(sheet, HEAVY_RUN());
		stubConfirm(true);

		await choose(sheet, "blood-soaked-past");

		expect(ownedMoveNames(actor)).not.toContain("Bark an Order");
	});

	// The background is a creation choice, so the move can't be earned: not even a faded, locked row.
	it("is never a level-up pick for another Heavy, not even a locked one, nor a move another playbook can learn", async () => {
		const { char } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: { "background.selected": "blood-soaked-past" } });
		const data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).not.toContain("Bark an Order");
		expect(data.lockedMoves.map(m => m.name)).not.toContain("Bark an Order");
		// The level-6 moves are still there, locked: the leaving-out is for the background's move alone.
		expect(data.lockedMoves.map(m => m.name)).toContain("Bringer of Ruin");

		const { char: fox } = buildLiveCharacter({ slug: "the-fox", name: "The Fox", level: 9 });
		const foreign = await fox.getForeignMovesForLevelUp({ playbooks: ["The Heavy"] }, 10);
		expect(foreign.map(m => m.name)).not.toContain("Bark an Order");
	});

	const barkRow = async char => (await char.buildSnapshot()).movelist.playbookMoves.find(m => m.name === "Bark an Order") ?? null;

	it("is on the Moves tab of the Sheriff alone", async () => {
		const sheriff = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: { "background.selected": "sheriff" } });
		const other   = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: { "background.selected": "storm-marked" } });
		const none    = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });

		expect(await barkRow(sheriff.char)).toMatchObject({ isStarting: true, locked: false });
		expect(await barkRow(other.char)).toBeNull();
		expect(await barkRow(none.char)).toBeNull();
	});

	it("shows, warned, for another Heavy who holds it anyway", async () => {
		const { char } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", flags: { "background.selected": "blood-soaked-past" } });
		await char.addMove(heavyId("Bark an Order"));

		expect(await barkRow(char)).toMatchObject({ owned: true, locked: true, requirementsUnmet: true });
	});
});

describe("the Heavy's pack data", () => {
	it("prints no stray words between a background's list items (the Sheriff's \"or\")", () => {
		const stray = [...PACK.values()].flatMap(doc => (doc.flags.stonetop.backgrounds ?? [])
			.filter(b => /<\/li>\s*[^<\s][^<]*<li>/.test(b.description ?? ""))
			.map(b => `${doc.name}: ${b.slug}`));
		expect(stray).toEqual([]);
	});
});

// A possession the BACKGROUND hands over (the Standout's Veteran gets Weapons of War) has its own
// pick made on the possessions page like any other: the live import of 2026-11-12 lost it.
describe("a pick inside a possession the background gives", () => {
	it("is kept, though the player never picked the possession itself", async () => {
		const { char, sheet } = fresh();
		const doc = playbookDoc("the-heavy");
		const bg = doc.flags.stonetop.backgrounds.find(b => b.slug === "sheriff");
		bg.extraPossessions = ["weapons-of-war"];
		await sheet._applyPlaybookSelections(doc, HEAVY_RUN({ possessions: [], possessionChoices: { "weapons-of-war": ["sword"] } }));
		expect([...char._possessions.selected]).toContain("weapons-of-war");
		expect(char._possessions.subChoices["weapons-of-war"]).toEqual(["sword"]);
	});
});
