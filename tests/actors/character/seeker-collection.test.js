// The Seeker's Collection (the playbook's first page): the major arcanum and the three minor draws
// creation gives, and what becomes of them on a re-run of onboarding (or a Save part-way), a role
// picked on the sheet, a background switch on the Details tab, and a change of playbook. Driven
// through the real sheet and a stateful character (LiveCharacter), with the arcana as the pack ships.

import { afterEach, describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { readRepo } from "../../fakes/css.js";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs, loadArcanaPackDocs } from "../../fakes/sourcePack.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { SeekerMajorArcanumDialog, seekerMajorChoices, seekerMajorAnswer } from "../../../module/actors/character/dialogs/SeekerMajorArcanumDialog.js";
import { BackgroundAnswersDialog } from "../../../module/actors/character/dialogs/BackgroundAnswersDialog.js";
import {
	seekerMajorTrack, pickSeekerMajorMark, minorArcanaHeldElsewhere, drawableMinorSlugs,
	seekerMajorSwitchPlan, withMinorRole, seekerCardRoles, seekerMajorOwed, frontTaskMarkers, frontTaskTrack,
	seekerMinorRolesAssigned, seekerMinorStepComplete, seekerOfferedMajors,
} from "../../../module/actors/character/seeker-collection.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const ARCANA = loadArcanaPackDocs().map(doc => structuredClone(doc.flags.stonetop));
const card = slug => ARCANA.find(a => a.slug === slug);
const flag = (actor, key) => actor.getFlag("stonetop-pwd", key);
const arcana = (actor, key) => flag(actor, `arcana.${key}`);
const has = (actor, key, slug) => (arcana(actor, key) ?? []).includes(slug);
const ticked = (actor, slug) => Object.entries(arcana(actor, "boxes") ?? {}).filter(([k, v]) => v && k.startsWith(`${slug}:`)).map(([k]) => k).sort();

const SEEKER_STATS = { str: -1, dex: 0, con: 1, int: 2, wis: 1, cha: 0 };

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

function seeker(flags = {}) {
	const made = buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker", seedStartingMoves: false, stats: SEEKER_STATS,
		arcana: new FakeArcanaRepository(structuredClone(ARCANA)), flags,
	});
	return { ...made, sheet: sheetFor(made.char, made.actor) };
}

const CHOICE = (arcanaSel, backgroundSlug = "patriot") => ({
	backgroundSlug, stats: SEEKER_STATS, moves: [], lore: { picks: {}, texts: {} },
	backgroundChoices: backgroundSlug === "patriot"
		? { "Well Versed": { label: "Well Versed in", value: "the Things Below" } }
		: { "Well Versed": { label: "Well Versed in", value: "the Makers and their arts" } },
	arcana: {
		major: "hectumel-codex", majorMarks: ["unlock:0"], majorMarksFor: "hectumel-codex",
		minorDraw: ["bow-with-no-string", "corroded-spearhead", "giant-oak-leaf"],
		minorRoles: { mastered: "bow-with-no-string", found: "corroded-spearhead", lead: "giant-oak-leaf" },
		...arcanaSel,
	},
});
const run = (sheet, sel) => sheet._applyPlaybookSelections(playbookDoc("the-seeker"), sel);

const realGame = globalThis.game;
// The world switches seekerOfferedMajors reads (getBooleanSetting), on for the keys named.
const worldSwitches = (...on) => {
	globalThis.game = { ...realGame, settings: { get: (scope, key) => scope === SYSTEM_ID && on.includes(key) } };
};

afterEach(() => { vi.restoreAllMocks(); globalThis.game = realGame; });

describe("onboarding's apply of the Seeker's arcana", () => {
	it("gives the major marked, the mastered card unlocked, the found card read on both sides, the lead as a lead", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		expect(arcana(actor, "owned").sort()).toEqual(["bow-with-no-string", "corroded-spearhead", "giant-oak-leaf", "hectumel-codex"]);
		expect(ticked(actor, "hectumel-codex")).toEqual(["hectumel-codex:unlock:0"]);
		expect(has(actor, "identified", "corroded-spearhead") && has(actor, "revealed", "corroded-spearhead")).toBe(true);
		expect(Object.keys(arcana(actor, "unlock")).filter(k => k.startsWith("bow-with-no-string:")).length).toBe(4);
		expect(arcana(actor, "leads")).toEqual(["giant-oak-leaf"]);
		expect(has(actor, "identified", "giant-oak-leaf")).toBe(false);
		expect(arcana(actor, "major")).toBe("hectumel-codex");
		expect(arcana(actor, "majorMarks")).toEqual(["unlock:0"]);
	});

	it("a Save then a changed major replaces the major (and its mark) rather than adding a second", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		await run(sheet, CHOICE({ major: "red-scepter", majorMarks: ["unlock:0"], majorMarksFor: "red-scepter" }));
		expect(has(actor, "owned", "hectumel-codex")).toBe(false);
		expect(ticked(actor, "hectumel-codex")).toEqual([]);
		expect(ticked(actor, "red-scepter")).toEqual(["red-scepter:unlock:0"]);
		expect(arcana(actor, "major")).toBe("red-scepter");
	});

	it("a re-run with a changed background swaps the major for one of the new background's", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		await run(sheet, CHOICE({ major: "mindgem", majorMarks: ["front:2"], majorMarksFor: "mindgem" }, "antiquarian"));
		expect(arcana(actor, "owned").filter(s => ["hectumel-codex", "mindgem"].includes(s))).toEqual(["mindgem"]);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:2"]);
	});

	it("the kept major's onboarding mark follows the new one, and a played major stays when the choice changes", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await run(sheet, CHOICE({ majorMarks: ["unlock:1"] }));
		expect(ticked(actor, "hectumel-codex")).toEqual(["hectumel-codex:unlock:1"]);
		// Played: a second ○ marked in play.
		await char.setArcanumBoxChecked("hectumel-codex", "unlock", 2, true);
		await run(sheet, CHOICE({ major: "red-scepter", majorMarks: ["unlock:0"], majorMarksFor: "red-scepter" }));
		expect(has(actor, "owned", "hectumel-codex")).toBe(true);
		expect(has(actor, "owned", "red-scepter")).toBe(true);
	});

	it("role changes re-derive the cards: mastered to lead, found to mastered, lead to found", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		await run(sheet, CHOICE({ minorRoles: { mastered: "corroded-spearhead", found: "giant-oak-leaf", lead: "bow-with-no-string" } }));
		// The old mastered card is now only a lead: no unlock, not identified.
		expect(arcana(actor, "leads")).toEqual(["bow-with-no-string"]);
		expect(has(actor, "identified", "bow-with-no-string")).toBe(false);
		expect(Object.keys(arcana(actor, "unlock") ?? {}).some(k => k.startsWith("bow-with-no-string:"))).toBe(false);
		// The old found card is mastered, the old lead found: identified, revealed, no longer a lead.
		expect(Object.keys(arcana(actor, "unlock")).filter(k => k.startsWith("corroded-spearhead:")).length).toBe(5);
		expect(has(actor, "revealed", "giant-oak-leaf") && has(actor, "identified", "giant-oak-leaf")).toBe(true);
		expect(has(actor, "leads", "giant-oak-leaf")).toBe(false);
	});

	it("a played mastered card chosen as the found one keeps its play but loses the mastery", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.setArcanumBoxChecked("bow-with-no-string", "back", 0, true);
		await run(sheet, CHOICE({ minorRoles: { mastered: "corroded-spearhead", found: "bow-with-no-string", lead: "giant-oak-leaf" } }));
		expect(Object.keys(arcana(actor, "unlock") ?? {}).filter(k => k.startsWith("bow-with-no-string:") && arcana(actor, "unlock")[k])).toEqual([]);
		expect(ticked(actor, "bow-with-no-string")).toEqual(["bow-with-no-string:back:0"]);
		expect(has(actor, "revealed", "bow-with-no-string")).toBe(true);
	});

	it("a re-draw replaces the old three while untouched", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		await run(sheet, CHOICE({
			minorDraw:  ["gold-ring", "giants-dormitory", "gold-butter-lamp"],
			minorRoles: { mastered: "gold-ring", found: "giants-dormitory", lead: "gold-butter-lamp" },
		}));
		expect(arcana(actor, "owned").sort()).toEqual(["giants-dormitory", "gold-butter-lamp", "gold-ring", "hectumel-codex"]);
		expect(arcana(actor, "leads")).toEqual(["gold-butter-lamp"]);
	});

	it("a lead discovered or removed in play is not given again by a re-run", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.discoverArcanum("giant-oak-leaf");
		await run(sheet, CHOICE());
		expect(has(actor, "leads", "giant-oak-leaf")).toBe(false);
		expect(has(actor, "identified", "giant-oak-leaf")).toBe(true);

		await char.removeArcanum("giant-oak-leaf");
		await run(sheet, CHOICE());
		expect(has(actor, "owned", "giant-oak-leaf")).toBe(false);
	});

	it("a role picked on the sheet's lore picker settles the cards the same way", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.setMinorArcanumRole("lead", "corroded-spearhead");
		// The card left its found role; the old lead went; the found role is empty.
		expect(arcana(actor, "minorRoles")).toEqual({ mastered: "bow-with-no-string", found: "", lead: "corroded-spearhead" });
		expect(arcana(actor, "leads")).toEqual(["corroded-spearhead"]);
		expect(has(actor, "owned", "giant-oak-leaf")).toBe(false);
	});
});

// The Laboratory's first d4-1 of naphtha is rolled when onboarding takes it (the user's ruling of
// 2026-10-18), and a re-run that keeps it does not roll again.
describe("onboarding's apply of the Laboratory", () => {
	afterEach(() => { delete globalThis.Roll; });

	it("rolls d4-1 once, and the naphtha track holds the roll (it counts SPENT)", async () => {
		const toMessage = vi.fn(async () => {});
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = 1; } async evaluate() { return this; } toMessage(d) { return toMessage(this.formula, d); } };
		const { actor, sheet } = seeker();
		await run(sheet, { ...CHOICE(), possessions: ["laboratory"] });
		expect(toMessage).toHaveBeenCalledOnce();
		expect(flag(actor, "inventory.resources")?.naphtha).toBe(2);
		// A use spent, then a re-run that keeps the Laboratory: no second roll, the track as it was.
		await actor.update({ "flags.stonetop-pwd.inventory.resources.naphtha": 3 });
		await run(sheet, { ...CHOICE(), possessions: ["laboratory"] });
		expect(toMessage).toHaveBeenCalledOnce();
		expect(flag(actor, "inventory.resources")?.naphtha).toBe(3);
	});

	it("does not roll for a Seeker without the Laboratory", async () => {
		const toMessage = vi.fn(async () => {});
		globalThis.Roll = class { constructor(f) { this.formula = f; this.total = 1; } async evaluate() { return this; } toMessage(d) { return toMessage(this.formula, d); } };
		const { sheet } = seeker();
		await run(sheet, CHOICE());
		expect(toMessage).not.toHaveBeenCalled();
	});
});

describe("a change of playbook away from the Seeker", () => {
	it("keeps the arcana held, drops the lead placeholder and the creation bookkeeping, and the backfill can't bring the lead back", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.clearPlaybookData("The Seeker");
		expect(arcana(actor, "owned").sort()).toEqual(["bow-with-no-string", "corroded-spearhead", "hectumel-codex"]);
		expect(arcana(actor, "leads") ?? []).toEqual([]);
		for (const key of ["major", "minorDraw", "minorRoles", "majorMarks"]) expect(arcana(actor, key) ?? undefined).toBeUndefined();
		await actor.unsetFlag("stonetop-pwd", "arcana.leadBackfilled");
		await char.ensureSeekerLeadCard();
		expect(has(actor, "owned", "giant-oak-leaf")).toBe(false);
	});

	it("drops the GM's given major with the rest of the creation bookkeeping", async () => {
		const { actor, sheet, char } = seeker();
		await char.setSeekerMajorGrant("mindgem");
		await run(sheet, CHOICE({ major: "mindgem", majorMarks: ["front:0"], majorMarksFor: "mindgem" }));
		expect(arcana(actor, "majorGrant")).toBe("mindgem");
		await char.clearPlaybookData("The Seeker");
		expect(arcana(actor, "majorGrant") ?? undefined).toBeUndefined();
		expect(char.seekerMajorGrant()).toBe("");
	});
});

describe("the Details tab's background switch and the major arcanum", () => {
	const choose = (sheet, slug) => sheet._onBackgroundChange({ currentTarget: { value: slug } });

	it("plans: keep a listed major, replace an untouched one, leave a played one, ask with none", () => {
		const offered = ["norubas-ice-sphere", "azure-hand", "mindgem"];
		expect(seekerMajorSwitchPlan({ major: "mindgem", offered, asGranted: true })).toBe("keep");
		expect(seekerMajorSwitchPlan({ major: "hectumel-codex", offered, asGranted: true })).toBe("replace");
		expect(seekerMajorSwitchPlan({ major: "hectumel-codex", offered, asGranted: false })).toBe("stays");
		expect(seekerMajorSwitchPlan({ major: "", offered })).toBe("ask");
		expect(seekerMajorSwitchPlan({ major: "hectumel-codex", held: false, offered })).toBe("ask");
		expect(seekerMajorSwitchPlan({ major: "hectumel-codex", offered: [] })).toBe("none");
	});

	it("the dialog's answer: a ○ major takes its first ○, a □ major waits for its task", () => {
		const choices = seekerMajorChoices([card("azure-hand"), card("mindgem")]);
		expect(choices.map(c => [c.slug, c.circles, c.tasks.length])).toEqual([["azure-hand", 4, 0], ["mindgem", 0, 4]]);
		expect(seekerMajorAnswer(choices, "azure-hand")).toEqual({ major: "azure-hand", marks: ["unlock:0"] });
		expect(seekerMajorAnswer(choices, "mindgem")).toBeNull();
		expect(seekerMajorAnswer(choices, "mindgem", "front:1")).toEqual({ major: "mindgem", marks: ["front:1"] });
	});

	it("an untouched major goes and 1 of the new background's is asked for with its mark", async () => {
		const { actor, sheet } = seeker();
		await run(sheet, CHOICE());
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:0"] });
		await choose(sheet, "antiquarian");
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask.mock.calls[0][1].map(c => c.slug)).toEqual(["norubas-ice-sphere", "azure-hand", "mindgem"]);
		expect(has(actor, "owned", "hectumel-codex")).toBe(false);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:0"]);
		expect(arcana(actor, "major")).toBe("mindgem");
	});

	it("a played major stays and no second one is offered", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.setArcanumBoxChecked("hectumel-codex", "unlock", 1, true);
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null);
		await choose(sheet, "witch-hunter");
		expect(ask).not.toHaveBeenCalled();
		expect(has(actor, "owned", "hectumel-codex")).toBe(true);
	});

	it("a first background picked there, with no major, asks too", async () => {
		const { actor, sheet } = seeker();
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "red-scepter", marks: ["unlock:0"] });
		await choose(sheet, "patriot");
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ticked(actor, "red-scepter")).toEqual(["red-scepter:unlock:0"]);
	});

	it("owes a major while the background lists some and none is held, a kept creation major counting as one", () => {
		const offered = ["norubas-ice-sphere", "azure-hand", "mindgem"];
		expect(seekerMajorOwed({ offered, owned: [], major: "" })).toBe(true);
		expect(seekerMajorOwed({ offered, owned: ["gold-ring"], major: "" })).toBe(true);
		expect(seekerMajorOwed({ offered, owned: ["mindgem"], major: "" })).toBe(false);
		// A played major from the old background, kept (the "stays" plan).
		expect(seekerMajorOwed({ offered, owned: ["hectumel-codex"], major: "hectumel-codex" })).toBe(false);
		// The creation major is gone from the sheet: owed again.
		expect(seekerMajorOwed({ offered, owned: [], major: "hectumel-codex" })).toBe(true);
		expect(seekerMajorOwed({ offered: [], owned: [], major: "" })).toBe(false);
	});

	it("'Choose later' leaves the major owed, and the Arcana tab's button asks again and gives it", async () => {
		const { actor, sheet, char } = seeker();
		await run(sheet, CHOICE());
		expect(await char.seekerMajorOwed()).toBe(false);
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null);
		await choose(sheet, "antiquarian");
		expect(has(actor, "owned", "hectumel-codex")).toBe(false);
		expect(await char.seekerMajorOwed()).toBe(true);

		ask.mockResolvedValue({ major: "azure-hand", marks: ["unlock:0"] });
		await sheet._onSeekerMajorOwed();
		expect(ask).toHaveBeenCalledTimes(2);
		expect(ask.mock.calls[1][1].map(c => c.slug)).toEqual(["norubas-ice-sphere", "azure-hand", "mindgem"]);
		expect(ticked(actor, "azure-hand")).toEqual(["azure-hand:unlock:0"]);
		expect(arcana(actor, "major")).toBe("azure-hand");
		expect(await char.seekerMajorOwed()).toBe(false);
		expect(sheet.render).toHaveBeenCalled();
	});

	it("the Arcana tab draws the cue and its button only while a major is owed", () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", k => String(k));
		for (const name of ["eq", "lt", "and", "not", "times", "moveBody"]) hb.registerHelper(name, () => false);
		hb.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
		const tab = hb.compile(readRepo("templates/actor/partials/tab-arcana.hbs"));
		const owed = tab({ stonetop: { seekerMajorOwed: true, arcana: {}, arcanaOpen: {} } });
		expect(owed).toContain('class="stonetop-seeker-major-owed"');
		expect(owed).toContain("fa-hand-pointer");
		expect(owed).toContain('class="stonetop-seeker-major-owed-btn">stonetop.seekerMajor.owedButton<');
		expect(owed).not.toContain("stonetop.arcana.empty");
		const settled = tab({ stonetop: { seekerMajorOwed: false, arcana: {}, arcanaOpen: {} } });
		expect(settled).not.toContain("stonetop-seeker-major-owed");
		expect(settled).toContain("stonetop.arcana.empty");
	});

	it("the Arcana tab draws the GM's give-a-major row in place of the empty line, and names a grant", () => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", (k, opts) => `${k}${opts?.hash?.name ? `|${opts.hash.name}` : ""}`);
		for (const name of ["eq", "lt", "and", "not", "times", "moveBody"]) hb.registerHelper(name, () => false);
		hb.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
		const tab = hb.compile(readRepo("templates/actor/partials/tab-arcana.hbs"));
		const none = tab({ stonetop: { seekerMajorGrant: { shown: true, name: "" }, arcana: {}, arcanaOpen: {} } });
		expect(none).toContain('class="stonetop-seeker-major-grant"');
		expect(none).toContain("stonetop.seekerMajor.grant.none");
		expect(none).toMatch(/class="stonetop-inline-btn stonetop-seeker-major-grant-btn"><i class="fas fa-hand-sparkles" aria-hidden="true"><\/i>stonetop.seekerMajor.grant.give</);
		expect(none).not.toContain("stonetop.arcana.empty");
		const given = tab({ stonetop: { seekerMajorGrant: { shown: true, name: "The Mindgem" }, arcana: {}, arcanaOpen: {} } });
		expect(given).toContain("stonetop.seekerMajor.grant.set|The Mindgem");
		expect(given).toContain(">stonetop.seekerMajor.grant.change<");
		expect(tab({ stonetop: { seekerMajorGrant: { shown: false }, arcana: {}, arcanaOpen: {} } })).not.toContain("stonetop-seeker-major-grant");
	});

	// A major given by the GM (arcana.majorGrant) or picked freely under the world's "any major" switch
	// is on the offered list (seekerOfferedMajors), so the switch keeps it; with neither, the book's
	// rule replaces an untouched off-list major.
	describe("a major given or picked off the background's list", () => {
		// Patriot lists the Hectumel Codex; mindgem is the Antiquarian's.
		const offList = async ({ grant = "" } = {}) => {
			const made = seeker();
			if (grant) await made.char.setSeekerMajorGrant(grant);
			await run(made.sheet, CHOICE({ major: "mindgem", majorMarks: ["front:0"], majorMarksFor: "mindgem" }));
			vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
			return { ...made, ask: vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null) };
		};

		it("given by the GM: a background switch keeps it, asks nothing, and owes nothing", async () => {
			const { actor, sheet, char, ask } = await offList({ grant: "mindgem" });
			expect((await char.settleSeekerMajorOnBackground()).plan).toBe("keep");
			await choose(sheet, "witch-hunter");
			expect(ask).not.toHaveBeenCalled();
			expect(has(actor, "owned", "mindgem")).toBe(true);
			expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:0"]);
			expect(await char.seekerMajorOwed()).toBe(false);
		});

		it("picked under the world's switch, with no grant: kept the same way", async () => {
			worldSwitches("seekerAnyMajorArcanum");
			const { actor, sheet, char, ask } = await offList();
			expect((await char.settleSeekerMajorOnBackground()).plan).toBe("keep");
			await choose(sheet, "witch-hunter");
			expect(ask).not.toHaveBeenCalled();
			expect(has(actor, "owned", "mindgem")).toBe(true);
		});

		it("with neither, the untouched off-list major is replaced, as the book has it", async () => {
			const { actor, char } = await offList();
			expect((await char.settleSeekerMajorOnBackground()).plan).toBe("replace");
			expect(has(actor, "owned", "mindgem")).toBe(false);
		});

		it("a grant with nothing held yet is owed, and the ask offers only the grant", async () => {
			const { actor, sheet, char } = seeker();
			await char.setSeekerMajorGrant("mindgem");
			const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:1"] });
			vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
			await choose(sheet, "patriot");
			expect(ask.mock.calls[0][1].map(c => c.slug)).toEqual(["mindgem"]);
			expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:1"]);
			expect(await char.seekerMajorOwed()).toBe(false);
		});
	});

	it("owes nothing after a played major stays, and the button does nothing then", async () => {
		const { sheet, char } = seeker();
		await run(sheet, CHOICE());
		await char.setArcanumBoxChecked("hectumel-codex", "unlock", 1, true);
		vi.spyOn(BackgroundAnswersDialog, "ask").mockResolvedValue(null);
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null);
		await choose(sheet, "witch-hunter");
		expect(await char.seekerMajorOwed()).toBe(false);
		await sheet._onSeekerMajorOwed();
		expect(ask).not.toHaveBeenCalled();
	});
});

describe("onboarding's major step: mark 1 ○ or □", () => {
	const dialog = major => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-seeker"), null, null);
		d._arcanaCache = { major: ["hectumel-codex", "mindgem"].map(slug => ({
			slug, frontDescription: card(slug).front.description, unlockDescription: card(slug).front.unlock?.description ?? "",
		})), minor: [] };
		d._selections.arcana.major = major;
		// "Answer at least 2 questions about it", so only the mark is in question below.
		d._selections.lore.texts["arcana-major:where-acquired"] = "A barrow";
		d._selections.lore.texts["arcana-major:who-else-wants"] = "The Hillfolk";
		return d;
	};

	it("Next waits for 2 of the major's questions answered, as well as the mark", () => {
		const d = dialog("hectumel-codex");
		d._markSeekerMajor("unlock:0", true);
		d._selections.lore.texts["arcana-major:who-else-wants"] = "  ";
		// The unlock question stands beside the set and does not count toward the 2.
		d._selections.lore.texts["arcana-major:when-unlocked"] = "Last winter";
		expect(d._isStepComplete("seekerArcana")).toBe(false);
		expect(d._isStepAnsweredForResume("seekerArcana")).toBe(false);
		d._step = d._steps.length;
		expect(d._skippedRequiredSteps().map(s => s.label)).toContain("Major Arcana");
		d._selections.lore.texts["arcana-major:what-cost"] = "My brother";
		expect(d._isStepComplete("seekerArcana")).toBe(true);
		expect(d._isStepAnsweredForResume("seekerArcana")).toBe(true);
		expect(d._skippedRequiredSteps().map(s => s.label)).not.toContain("Major Arcana");
	});

	it("a □ major gets no default mark and waits for one; a ○ major defaults to its first", () => {
		const d = dialog("mindgem");
		d._reconcileSeekerMajorMarks(d._seekerMajorMysteryTrack(d._arcanaCache.major[1]));
		expect(d._selections.arcana.majorMarks).toEqual([]);
		expect(d._isStepComplete("seekerArcana")).toBe(false);
		d._markSeekerMajor("front:3", true);
		expect(d._isStepComplete("seekerArcana")).toBe(true);

		const c = dialog("hectumel-codex");
		c._reconcileSeekerMajorMarks(c._seekerMajorMysteryTrack(c._arcanaCache.major[0]));
		expect(c._selections.arcana.majorMarks).toEqual(["unlock:0"]);
		expect(c._isStepComplete("seekerArcana")).toBe(true);
	});

	it("a new tick replaces the old (radio), and an untick leaves the step undone", () => {
		expect(pickSeekerMajorMark(["unlock:0"], "unlock:2", true)).toEqual(["unlock:2"]);
		const d = dialog("hectumel-codex");
		d._markSeekerMajor("unlock:0", true);
		d._markSeekerMajor("unlock:2", true);
		expect(d._selections.arcana.majorMarks).toEqual(["unlock:2"]);
		d._markSeekerMajor("unlock:2", false);
		expect(d._isStepComplete("seekerArcana")).toBe(false);
	});

	it("the unlock question doesn't count toward 'Answer at least 2'", () => {
		const d = dialog("hectumel-codex");
		d._selections.lore.texts = {};
		const section = d._rawLore.find(s => s.slug === "arcana-major");
		d._selections.lore.texts["arcana-major:where-acquired"] = "A barrow";
		d._selections.lore.texts["arcana-major:when-unlocked"] = "Last winter";
		expect(d._isLoreSectionAnswered(section)).toBe(false);
		d._selections.lore.texts["arcana-major:what-cost"] = "My brother";
		expect(d._isLoreSectionAnswered(section)).toBe(true);
	});

	it("reads the major's track the same way the Details-tab ask does", () => {
		expect(seekerMajorTrack(card("mindgem").front).markers.map(m => `${m.context}:${m.index}`)).toEqual(["front:0", "front:1", "front:2", "front:3"]);
		expect(seekerMajorTrack(card("hectumel-codex").front).kind).toBe("circle");
	});
});

// The GM's grant (arcana.majorGrant, read live off the character) locks onboarding's major to it; the
// world's "any major" switch keeps an off-list pick. Both go through seekerOfferedMajors.
describe("onboarding's major step with a major given or picked off the list", () => {
	const OPTION = slug => ({
		slug, name: card(slug)?.front?.title ?? slug, description: "", homebrew: false,
		frontDescription: card(slug)?.front?.description ?? "", unlockDescription: card(slug)?.front?.unlock?.description ?? "",
	});
	const dialog = ({ grant = "", major = "hectumel-codex", majors = ["hectumel-codex", "red-scepter", "staff-of-the-lidless-orb", "mindgem"] } = {}) => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-seeker"), null, null);
		d._selections.backgroundSlug = "patriot";
		d._seekerActor = { id: "a1", name: "Ada", typedActor: { seekerMajorGrant: () => d._grant } };
		d._grant = grant;
		d._arcanaCache = { major: majors.map(OPTION), minor: [] };
		d._selections.arcana.major = major;
		d._selections.arcana.majorMarks = ["unlock:0"];
		d._selections.arcana.majorMarksFor = major;
		return d;
	};
	const slugs = data => data.major.map(m => m.slug);

	it("a grant is the only choice, picked, with the locked hint; the mark resets for its track", async () => {
		const d = dialog({ grant: "mindgem" });
		const data = await d._seekerArcanaChoiceData();
		expect(slugs(data)).toEqual(["mindgem"]);
		expect(data.major[0].selected).toBe(true);
		expect(data.majorLocked).toBe(true);
		expect(data.majorHint).toBe("Your GM has given you this major arcanum.");
		expect(data.majorActions).toEqual([]);
		d._reconcileSeekerMajorMarks(d._seekerMajorMysteryTrack(d._arcanaCache.major.find(o => o.slug === "mindgem")));
		expect(d._selections.arcana.majorMarks).toEqual([]);
		expect(d._isStepComplete("seekerArcana")).toBe(false);
	});

	it("taking the grant back offers the background's three again", async () => {
		const d = dialog({ grant: "mindgem" });
		await d._seekerArcanaChoiceData();
		d._grant = "";
		const data = await d._seekerArcanaChoiceData();
		expect(slugs(data).sort()).toEqual(["hectumel-codex", "red-scepter", "staff-of-the-lidless-orb"]);
		expect(data.majorLocked).toBe(false);
		expect(data.majorHint).toBe("Choose the major arcanum granted by your background.");
	});

	it("the background step draws the grant alone, with no radio, under the GM's label", async () => {
		const d = dialog({ grant: "mindgem" });
		d._step = d._steps.indexOf("background");
		const { backgrounds } = await d.getData();
		const patriot = backgrounds.find(b => b.slug === "patriot");
		expect(patriot.majorGranted).toBe(true);
		expect(patriot.majorGrantedLabel).toBe("Major arcanum, given by your GM");
		expect(patriot.majorArcana.map(m => [m.slug, m.granted, m.selected])).toEqual([["mindgem", true, true]]);
		const hb = Handlebars.create();
		for (const name of ["eq", "and", "or", "not", "gt", "lt", "includes", "localize", "times", "concat", "json"]) hb.registerHelper(name, () => "");
		const html = hb.compile(readRepo("templates/dialogs/character-onboarding.hbs"))({ ...await d.getData(), isBackground: true });
		const block = html.slice(html.indexOf("Major arcanum, given by your GM"));
		expect(block.slice(0, block.indexOf("</label>"))).not.toContain('name="onboard-background-major-arcanum"');
	});

	it("finishing applies the granted major with its mark", async () => {
		const { actor, sheet, char } = seeker();
		await char.setSeekerMajorGrant("mindgem");
		const d = dialog({ grant: "mindgem" });
		await d._seekerArcanaChoiceData();
		d._markSeekerMajor("front:1", true);
		await run(sheet, CHOICE({ ...structuredClone(d._selections.arcana), minorDraw: CHOICE().arcana.minorDraw, minorRoles: CHOICE().arcana.minorRoles }));
		expect(has(actor, "owned", "mindgem") && has(actor, "identified", "mindgem")).toBe(true);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:1"]);
		expect(arcana(actor, "major")).toBe("mindgem");
	});

	it("a homebrew major grant is loaded, shown, and never joins the minor pool", async () => {
		const homebrew = (slug, major) => ({ type: "move", name: slug, flags: { stonetop: { slug, major, front: { title: slug, description: "<p>x</p>" } } }, system: { moveType: "arcanum" } });
		globalThis.game = { ...realGame, packs: { get: () => null }, items: [homebrew("our-orb", true), homebrew("our-pebble", false)],
			settings: { get: (scope, key) => scope === SYSTEM_ID && key === "arcanaSeekerDrawsHomebrew" } };
		const d = dialog({ grant: "our-orb" });
		d._arcanaCache = null;
		// The card's first paragraph is read through the DOM, which this suite does not have.
		d._firstParagraph = () => "";
		const loaded = await d._loadArcanaOptions();
		expect(loaded.major.map(o => [o.slug, o.homebrew])).toEqual([["our-orb", true]]);
		expect(loaded.minor.map(o => o.slug)).toEqual(["our-pebble"]);
		expect(slugs(await d._seekerArcanaChoiceData())).toEqual(["our-orb"]);
	});

	it("with the world's switch on, an off-list pick survives the ensure and a change of background", async () => {
		worldSwitches("seekerAnyMajorArcanum");
		const d = dialog({ major: "mindgem" });
		const data = await d._seekerArcanaChoiceData();
		expect(d._selections.arcana.major).toBe("mindgem");
		expect(slugs(data)).toContain("mindgem");
		expect(data.majorActions.map(a => a.action)).toEqual(["other-major"]);
		d._applyBackgroundChange("witch-hunter");
		expect(d._selections.arcana.major).toBe("mindgem");
	});

	it("with the switch on, a major from the old background's list follows the background", () => {
		worldSwitches("seekerAnyMajorArcanum");
		const d = dialog({ major: "red-scepter", majors: ["hectumel-codex", "red-scepter", "norubas-ice-sphere", "azure-hand", "mindgem"] });
		d._applyBackgroundChange("antiquarian");
		expect(d._selections.arcana.major).toBe("norubas-ice-sphere");
	});

	it("a stale slug is snapped, switch on or off; with the switch off an off-list pick is snapped too", () => {
		worldSwitches("seekerAnyMajorArcanum");
		const stale = dialog({ major: "a-card-since-deleted" });
		stale._ensureSeekerMajorSelection();
		expect(stale._selections.arcana.major).toBe("hectumel-codex");
		globalThis.game = realGame;
		const off = dialog({ major: "mindgem" });
		off._ensureSeekerMajorSelection();
		expect(off._selections.arcana.major).toBe("hectumel-codex");
	});

	it("the GM's button shows for a GM only, and never on the Builder's try-out (no character)", async () => {
		globalThis.game = { ...realGame, user: { isGM: true } };
		const d = dialog();
		expect((await d._seekerArcanaChoiceData()).majorActions.map(a => [a.action, a.label])).toEqual([["give-major", "Give a major arcanum"]]);
		d._grant = "mindgem";
		expect((await d._seekerArcanaChoiceData()).majorActions.map(a => a.label)).toEqual(["Change"]);
		d._seekerActor = null;
		expect((await d._seekerArcanaChoiceData()).majorActions).toEqual([]);
		globalThis.game = { ...realGame, user: { isGM: false } };
		expect((await dialog()._seekerArcanaChoiceData()).majorActions).toEqual([]);
	});

	it("the Major Arcanum step draws its hint and buttons from the data", () => {
		const hb = Handlebars.create();
		for (const name of ["eq", "and", "or", "not", "gt", "lt", "includes", "localize", "times", "concat", "json"]) hb.registerHelper(name, () => "");
		const html = hb.compile(readRepo("templates/dialogs/character-onboarding.hbs"))({
			isSeekerArcana: true, seekerArcanaData: { title: "Collection", sections: [] },
			seekerArcanaChoices: { major: [], majorHint: "HINT", majorActions: [{ action: "other-major", icon: "fa-wand-sparkles", label: "Choose a different arcanum" }] },
		});
		expect(html).toContain('<p class="stonetop-onboarding-step-hint">HINT</p>');
		expect(html).toMatch(/<button type="button" class="stonetop-inline-btn" data-seeker-major-action="other-major"><i class="fas fa-wand-sparkles" aria-hidden="true"><\/i>Choose a different arcanum<\/button>/);
	});
});

// The minor page ("Minor Arcana & Questions") asks for a role on each drawn card and the three
// questions under them. Next and the reopen's first-unfinished-page both read seekerMinorStepComplete,
// so whatever one says the other says too: a page Next let the player past is never the page a
// reopen puts them back on.
describe("onboarding's minor step: three roles and their questions", () => {
	const ROLES = { mastered: "bow-with-no-string", found: "corroded-spearhead", lead: "giant-oak-leaf" };
	const ANSWERS = {
		"arcana-minor:mastered-location": "Under my bed",
		"arcana-minor:found-location":    "A hollow tree",
		"arcana-minor:sought-notes":      "The Giant Oak Leaf",
	};
	const dialog = ({ roles = ROLES, texts = ANSWERS } = {}) => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-seeker"), null, null);
		d._selections.arcana.minorDraw  = Object.values(ROLES);
		d._selections.arcana.minorRoles = { ...roles };
		d._selections.lore.texts = { ...texts };
		return d;
	};
	const agree = d => {
		const next = d._isStepComplete("seekerArcanaMinor");
		expect(d._isStepAnsweredForResume("seekerArcanaMinor")).toBe(next);
		return next;
	};

	it("is done with every role given and every question answered", () => {
		expect(agree(dialog())).toBe(true);
	});

	it("waits for all three roles", () => {
		expect(agree(dialog({ roles: { ...ROLES, lead: "" } }))).toBe(false);
	});

	it("waits for every question: the section names no 'at least N', so a blank or spaces-only answer holds it", () => {
		expect(agree(dialog({ texts: { ...ANSWERS, "arcana-minor:sought-notes": "" } }))).toBe(false);
		expect(agree(dialog({ texts: { ...ANSWERS, "arcana-minor:found-location": "   " } }))).toBe(false);
		expect(agree(dialog({ texts: {} }))).toBe(false);
	});

	it("a page skipped with blank answers is listed as unfinished and is where a reopen lands", () => {
		const d = dialog({ texts: { ...ANSWERS, "arcana-minor:mastered-location": "" } });
		d._step = d._steps.length;
		expect(d._skippedRequiredSteps().map(s => s.label)).toContain("Minor Arcana");
		const minorIndex = d._steps.indexOf("seekerArcanaMinor");
		expect(d._firstIncompleteStepIndex()).toBeLessThanOrEqual(minorIndex);
		d._selections.lore.texts["arcana-minor:mastered-location"] = "Under my bed";
		expect(d._skippedRequiredSteps().map(s => s.label)).not.toContain("Minor Arcana");
	});
});

describe("the minor draw leaves out cards already held", () => {
	it("others' held cards (not their leads) and this character's cards from outside its last draw", () => {
		const held = minorArcanaHeldElsewhere([
			{ id: "a", arcana: { owned: ["gold-ring", "giant-oak-leaf"], leads: ["giant-oak-leaf"] } },
			{ id: "me", arcana: { owned: ["bow-with-no-string", "cracked-flute"], minorDraw: ["bow-with-no-string"] } },
		], "me");
		expect([...held].sort()).toEqual(["cracked-flute", "gold-ring"]);
		expect(drawableMinorSlugs([{ slug: "gold-ring" }, { slug: "giant-oak-leaf" }, { slug: "bow-with-no-string" }], held))
			.toEqual(["giant-oak-leaf", "bow-with-no-string"]);
	});

	it("the dialog's draw and swap picker never deal a held card", async () => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-seeker"), null, null);
		d._heldMinorArcana = new Set(["a", "b", "c"]);
		const options = ["a", "b", "c", "d", "e", "f"].map(slug => ({ slug, name: slug }));
		for (let i = 0; i < 10; i++) {
			d._drawSeekerMinorArcana(options);
			expect(d._selections.arcana.minorDraw.sort()).toEqual(["d", "e", "f"]);
		}
		d._arcanaCache = { major: [], minor: options };
		const data = await d._seekerArcanaChoiceData();
		expect(data.minor[0].swapOptions).toEqual([]);
	});
});

describe("pure helpers", () => {
	it("seekerOfferedMajors: a grant wins and locks; the world's switch keeps an off-list pick; else the list", () => {
		const listed = ["a", "b", "c"];
		expect(seekerOfferedMajors({ listed, grant: "x", open: true, major: "y" })).toEqual({ offered: ["x"], locked: true });
		expect(seekerOfferedMajors({ listed, open: true, major: "x" })).toEqual({ offered: ["a", "b", "c", "x"], locked: false });
		expect(seekerOfferedMajors({ listed, open: true, major: "b" })).toEqual({ offered: listed, locked: false });
		expect(seekerOfferedMajors({ listed, major: "x" })).toEqual({ offered: listed, locked: false });
		expect(seekerOfferedMajors({ listed: ["a", "", "a"] })).toEqual({ offered: ["a"], locked: false });
		expect(seekerOfferedMajors()).toEqual({ offered: [], locked: false });
	});

	it("withMinorRole moves a card out of any other role", () => {
		expect(withMinorRole({ mastered: "x", found: "y", lead: "z" }, "lead", "x")).toEqual({ mastered: "", found: "y", lead: "x" });
		expect(withMinorRole({ mastered: "x" }, "found", "")).toEqual({ mastered: "x", found: "", lead: "" });
	});

	it("seekerMinorRolesAssigned wants all three roles, each on a different card", () => {
		expect(seekerMinorRolesAssigned({ mastered: "a", found: "b", lead: "c" })).toBe(true);
		expect(seekerMinorRolesAssigned({ mastered: "a", found: "b", lead: "" })).toBe(false);
		expect(seekerMinorRolesAssigned({ mastered: "a", found: "a", lead: "c" })).toBe(false);
		expect(seekerMinorRolesAssigned({})).toBe(false);
		expect(seekerMinorRolesAssigned(undefined)).toBe(false);
	});

	it("seekerMinorStepComplete wants the roles AND the questions", () => {
		const roles = { mastered: "a", found: "b", lead: "c" };
		expect(seekerMinorStepComplete({ minorRoles: roles, questionsAnswered: true })).toBe(true);
		expect(seekerMinorStepComplete({ minorRoles: roles, questionsAnswered: false })).toBe(false);
		expect(seekerMinorStepComplete({ minorRoles: { ...roles, found: "" }, questionsAnswered: true })).toBe(false);
		expect(seekerMinorStepComplete()).toBe(false);
	});

	it("seekerCardRoles names each card creation gave", () => {
		expect([...seekerCardRoles({ major: "m", minorRoles: { mastered: "a", found: "b", lead: "c" } })])
			.toEqual([["a", "mastered"], ["b", "found"], ["c", "lead"], ["m", "major"]]);
	});

	it("frontTaskMarkers reads a card's front □ tasks in box order, each labelled by its list item", () => {
		const tasks = frontTaskMarkers(card("mindgem").front.description);
		expect(tasks.map(t => [t.context, t.index])).toEqual([["front", 0], ["front", 1], ["front", 2], ["front", 3]]);
		expect(tasks[0].label).toBe("Recover its chassis of white granite, which weighs well over a ton");
		expect(tasks[3].label).toBe("Puzzle out how to assemble all the pieces");
		expect(frontTaskMarkers("<p>No tasks here.</p>")).toEqual([]);
	});

	it("frontTaskTrack reads how many tasks unlock a card off its unlock lead", () => {
		expect(frontTaskTrack(card("mindgem").front)).toMatchObject({ needed: 4 });
		expect(frontTaskTrack(card("twisted-spear").front)).toMatchObject({ needed: 3 });
		expect(frontTaskTrack(card("twisted-spear").front).markers).toHaveLength(5);
		// A lead that names no tasks makes a front □ some other box; a ○ lead is its own track.
		const oneShot = { description: "<p>□ Once, you may call on it.</p>", unlock: { description: "When you learn its name, see reverse." } };
		expect(frontTaskTrack(oneShot)).toBeNull();
		expect(seekerMajorTrack(oneShot)).toEqual({ kind: null, markers: [] });
		expect(frontTaskTrack({ ...oneShot, unlock: { description: "When you mark ○○ tasks, see reverse." } })).toBeNull();
		// A card listing its requirements under the lead unlocks by those, whatever the lead calls them.
		expect(frontTaskTrack({ ...oneShot, unlock: { description: "Complete the task.", requirements: [{ type: "option", slug: "x" }] } })).toBeNull();
		expect(frontTaskTrack({ ...oneShot, unlock: { description: "Meet the requirements.", requirements: [{ type: "text", content: "Learn its name" }] } })).toBeNull();
		const fourTasks = { description: "<ul>" + "<li>□ A task.</li>".repeat(4) + "</ul>", unlock: { description: "When you have marked 2 of the 4 tasks, see reverse." } };
		expect(frontTaskTrack(fourTasks).needed).toBe(2);
	});
});
