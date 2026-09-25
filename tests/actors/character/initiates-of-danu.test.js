// The Blessed's Initiates of Danu (Book I p.145): who counts as a follower, what the insert prints for
// each of them, and how the picks are kept.

import { afterEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookDefs } from "../../fakes/sourcePack.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import {
	activeInitiateOptions, choiceCountState, initiateActive, initiateChoicePatch, initiateExceptional,
	initiateMoves, initiateOption,
} from "../../../module/actors/character/initiates.js";
import { CharacterBackgrounds } from "../../../module/actors/character/CharacterBackgrounds.js";
import { dieFromDamage, printedBlow } from "../../../module/utils/damage.js";
import { followerNpcActorData } from "../../../module/data/follower-actor.js";

const { byName: PB_DEFS } = loadPlaybookDefs();
const BLESSED = PB_DEFS.get("The Blessed");
const BACKGROUNDS = BLESSED.backgrounds;
const INITIATES = BACKGROUNDS.find(b => b.slug === "initiate").choices.options;
const opt = slug => INITIATES.find(o => o.slug === slug);

const onInitiate = (choices) => ({ background: { selected: "initiate", choices } });

describe("who is a follower", () => {
	it("is an initiate picked under the Initiate background, and nobody under any other", () => {
		expect(initiateActive(onInitiate({ enfys: true }), "enfys")).toBe(true);
		expect(initiateActive(onInitiate({ enfys: false }), "enfys")).toBe(false);
		// The picks outlive a change of background, but they are not followers meanwhile.
		expect(initiateActive({ background: { selected: "vessel", choices: { enfys: true } } }, "enfys")).toBe(false);
		expect(activeInitiateOptions(BACKGROUNDS, { background: { selected: "vessel", choices: { enfys: true, olwin: true } } })).toEqual([]);
		expect(activeInitiateOptions(BACKGROUNDS, onInitiate({ olwin: true, enfys: true })).map(o => o.slug)).toEqual(["enfys", "olwin"]);
	});
});

describe("what the insert prints", () => {
	it("gives each initiate their three moves", () => {
		expect(opt("enfys").moves).toEqual(["Speak with birds", "Ask a difficult question", "Wander off"]);
		expect(opt("afon").moves).toEqual(["Weave a minor glamor", "Appear or disappear unexpectedly", "Speak an uncomfortable truth"]);
		expect(opt("gwendyl").moves).toEqual(["Tend to the sick, injured, women in labor", "Weave a talisman of fertility or good luck", "Point out a flaw in a person or plan"]);
		expect(opt("olwin").moves).toEqual(["Perform a divination", "Speak a (dire) prophecy", "Make a big deal about something"]);
		expect(opt("seren").moves).toEqual(["Consult the spirits, or abjure them", "Spin a tale to make a point", "Use shame and guilt as leverage"]);
	});

	it("names each weapon, and the die and range still read off it", () => {
		const printed = {
			enfys:   ["bronze knife d4 (hand)", "d4", "Bronze knife"],
			afon:    ["bronze hatchet d6 (hand)", "d6", "Bronze hatchet"],
			gwendyl: ["iron knife d6 (hand)", "d6", "Iron knife"],
			olwin:   ["iron spear d6 (close, thrown)", "d6", "Iron spear"],
			seren:   ["walking stick d4 (close)", "d4", "Walking stick"],
		};
		for (const [slug, [damage, die, title]] of Object.entries(printed)) {
			expect(opt(slug).damage).toBe(damage);
			expect(dieFromDamage(damage)).toBe(die);
			expect(printedBlow(damage, die).title).toBe(title);
		}
		expect(printedBlow(opt("olwin").damage, "d6").keywords).toBe("close, thrown");
	});

	it("prints Seren exceptional, as a flag rather than a tag chip", () => {
		expect(opt("seren").exceptional).toBe(true);
		expect(opt("seren").subtitle).not.toMatch(/exceptional/i);
		expect(INITIATES.filter(o => o.exceptional).map(o => o.slug)).toEqual(["seren"]);
	});

	it("gives Afon's NPC his armor with iron's clause beside it", () => {
		expect(followerNpcActorData({ armor: opt("afon").armor }).system.attributes.armor)
			.toMatchObject({ value: 2, conditional: 2, conditionalSource: "vs. iron" });
	});
});

describe("the player's own word wins", () => {
	it("keeps Seren exceptional until her player turns it off", () => {
		expect(initiateExceptional({}, opt("seren"))).toBe(true);
		expect(initiateExceptional({ exceptional: false }, opt("seren"))).toBe(false);
		expect(initiateExceptional({}, opt("enfys"))).toBe(false);
		expect(initiateExceptional({ exceptional: true }, opt("enfys"))).toBe(true);
	});

	it("seeds the moves only on a card nobody has written moves to", () => {
		expect(initiateMoves({}, opt("enfys"))).toBe("Speak with birds\nAsk a difficult question\nWander off");
		expect(initiateMoves({ moves: "Scry in the millpond" }, opt("enfys"))).toBe("Scry in the millpond");
		// Cleared on purpose stays cleared.
		expect(initiateMoves({ moves: "" }, opt("enfys"))).toBe("");
	});
});

describe("the picks are a set", () => {
	it("ticks the ones picked and crosses off every other initiate", () => {
		expect(initiateChoicePatch(BACKGROUNDS, ["olwin", "seren"])).toEqual({
			enfys: false, afon: false, gwendyl: false, olwin: true, seren: true,
		});
		expect(initiateChoicePatch([], ["olwin"])).toEqual({});
	});

	it("writes several choices in one go, keeping any it was not handed", async () => {
		const store = { choices: { enfys: true, "other-choice": true } };
		const bg = new CharacterBackgrounds({ getFlag: k => store[k], setFlag: vi.fn(async (k, v) => { store[k] = v; }) });
		await bg.setChoices({ enfys: false, olwin: true });
		expect(store.choices).toEqual({ enfys: false, olwin: true, "other-choice": true });
	});

	it("says where a 'choose 2 or 3' stands: full at 3, short under 2", () => {
		expect(choiceCountState([2, 3], 3)).toMatchObject({ atMax: true, underMin: false });
		expect(choiceCountState([2, 3], 2)).toMatchObject({ atMax: false, underMin: false });
		expect(choiceCountState([2, 3], 1)).toMatchObject({ atMax: false, underMin: true });
	});
});

describe("the Details tab's initiate checkboxes", () => {
	const blessedWith = choices => buildLiveCharacter({
		slug: "the-blessed", name: "The Blessed",
		flags: { "background.selected": "initiate", "background.choices": choices },
	});
	const initiateBgOf = snap => snap.playbook.background.options.find(o => o.slug === "initiate");

	it("disables the unticked ones once three are ticked", async () => {
		const { char } = blessedWith({ enfys: true, afon: true, olwin: true });
		const choices = initiateBgOf(await char.buildSnapshot()).choices;
		expect(choices.options.filter(o => o.disabled).map(o => o.slug)).toEqual(["gwendyl", "seren"]);
		expect(choices.underMin).toBe(false);
	});

	it("flags one ticked, and blocks nothing", async () => {
		const { char } = blessedWith({ enfys: true });
		const choices = initiateBgOf(await char.buildSnapshot()).choices;
		expect(choices.underMin).toBe(true);
		expect(choices.checkedCount).toBe(1);
		expect(choices.options.some(o => o.disabled)).toBe(false);
	});
});

// ── Through the sheet ───────────────────────────────────────────────────────────

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
	return new (createStonetopCharacterSheetClass(Base))();
}

describe("onboarding's initiates", () => {
	it("replaces the picks rather than adding to them", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			flags: { "background.selected": "initiate", "background.choices": { enfys: true, afon: true } },
		});
		const sheet = sheetFor(char, actor);
		const playbookDoc = { name: "The Blessed", flags: { stonetop: { backgrounds: BACKGROUNDS } } };

		await sheet._applyCommonSelections(playbookDoc, { backgroundSlug: "initiate", initiates: ["olwin", "seren"] });

		expect(actor.getFlag("stonetop-pwd", "background.choices")).toEqual({
			enfys: false, afon: false, gwendyl: false, olwin: true, seren: true,
		});
	});

	it("leaves the picks alone when another background is applied", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			flags: { "background.selected": "initiate", "background.choices": { enfys: true, afon: true } },
		});
		const sheet = sheetFor(char, actor);
		const playbookDoc = { name: "The Blessed", flags: { stonetop: { backgrounds: BACKGROUNDS } } };

		await sheet._applyCommonSelections(playbookDoc, { backgroundSlug: "vessel", initiates: [] });

		expect(actor.getFlag("stonetop-pwd", "background.choices")).toEqual({ enfys: true, afon: true });
	});
});

describe("ordering Seren", () => {
	afterEach(() => vi.restoreAllMocks());

	it("rolls her as exceptional from either door until her player says otherwise", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			flags: { "background.selected": "initiate", "background.choices": { seren: true } },
		});
		const sheet = sheetFor(char, actor);
		const opened = [];
		const dialogs = await import("../../../module/actors/character/dialogs/OrderFollowersDialog.js");
		vi.spyOn(dialogs.OrderFollowersDialog.prototype, "render").mockImplementation(function () { opened.push(this._follower); return this; });

		// The token's door hands over what the NPC and the stored toggle say: nothing set.
		await sheet.orderFollower({ name: "Seren", tags: [], moves: [], exceptional: false }, { ftype: "initiate", slug: "seren" });
		expect(opened.at(-1).exceptional).toBe(true);

		await actor.setFlag("stonetop-pwd", "initiateDetails.seren.exceptional", false);
		await sheet.orderFollower({ name: "Seren", tags: [], moves: [], exceptional: false }, { ftype: "initiate", slug: "seren" });
		expect(opened.at(-1).exceptional).toBe(false);
	});
});

describe("the Followers tab", () => {
	it("draws initiates only under the Initiate background, with the insert's moves and Seren exceptional", async () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			flags: {
				"background.selected": "initiate",
				"background.choices": { enfys: true, seren: true },
				"initiateDetails.enfys.moves": "Scry in the millpond",
			},
		});
		const sheet = sheetFor(char, actor);
		const groups = sheet._buildFollowersData(BLESSED);
		const bySlug = Object.fromEntries((groups.initiates ?? []).map(c => [c.slug, c]));
		expect(Object.keys(bySlug)).toEqual(["enfys", "seren"]);
		expect(bySlug.enfys.movesLines).toEqual(["Scry in the millpond"]);
		expect(bySlug.seren.movesLines).toEqual(["Consult the spirits, or abjure them", "Spin a tale to make a point", "Use shame and guilt as leverage"]);
		expect(bySlug.seren.exceptional).toBe(true);
		expect(bySlug.seren.tags.map(t => t.label)).not.toContain("Exceptional");
		expect(bySlug.seren.damageRoll).toBe("d4");
		expect(bySlug.seren.damage).toBe("walking stick d4 (close)");

		await actor.setFlag("stonetop-pwd", "background.selected", "vessel");
		expect(sheet._buildFollowersData(BLESSED).initiates ?? []).toEqual([]);
		// The picks and the details are still there for a return to Initiate.
		expect(actor.getFlag("stonetop-pwd", "background.choices")).toEqual({ enfys: true, seren: true });
		await actor.setFlag("stonetop-pwd", "background.selected", "initiate");
		expect(sheet._buildFollowersData(BLESSED).initiates.map(c => c.slug)).toEqual(["enfys", "seren"]);
	});

	it("says so on the Armor line when a follower wears a Blessed's Barkskin", () => {
		const { char, actor } = buildLiveCharacter({
			slug: "the-blessed", name: "The Blessed",
			items: [],
			flags: {
				"background.selected": "initiate",
				"background.choices": { enfys: true, afon: true },
				blessedMarks: [{ kind: "barkskin", name: "Enfys" }, { kind: "barkskin", name: "Afon" }],
			},
		});
		const prior = globalThis.game.actors;
		actor.items.push({ type: "move", name: "Barkskin" });
		globalThis.game.actors = [actor];
		try {
			const sheet = sheetFor(char, actor);
			const bySlug = Object.fromEntries(sheet._buildFollowersData(BLESSED).initiates.map(c => [c.slug, c]));
			expect(bySlug.enfys.armorGateNote).toContain("Barkskin");
			// Afon's own 2 already matches the bark, so there is nothing to say.
			expect(bySlug.afon.armorGateNote).toBeUndefined();
		} finally {
			globalThis.game.actors = prior;
		}
	});
});

it("finds the option for a slug", () => {
	expect(initiateOption(BACKGROUNDS, "afon")?.armor).toBe("2 (0 vs. iron)");
	expect(initiateOption(BACKGROUNDS, "nobody")).toBe(null);
});
