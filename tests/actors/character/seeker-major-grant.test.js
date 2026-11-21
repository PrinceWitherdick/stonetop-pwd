// The GM's "Give a major arcanum" for a Seeker (seeker-major-grant.js): the picker's rows, and what
// giving, changing, clearing or dismissing writes, before and after creation. Driven through a
// stateful character (LiveCharacter) with the arcana as the pack ships; the picker and the mark ask
// are stubbed.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs, loadArcanaPackDocs } from "../../fakes/sourcePack.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { SeekerMajorArcanumDialog } from "../../../module/actors/character/dialogs/SeekerMajorArcanumDialog.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";
import { ArcanaSource } from "../../../module/dialogs/catalog/ArcanaSource.js";
import { isMajorArcanumItem } from "../../../module/arcana-icons.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

vi.mock("../../../module/dialogs/content-picker.js", async importOriginal => ({
	...(await importOriginal()),
	pickContentOption: vi.fn(),
}));
const { pickContentOption } = await import("../../../module/dialogs/content-picker.js");
const {
	giveSeekerMajor, majorArcanumRows, pickMajorArcanum, loadMajorArcana, playersSeeHomebrewMajors, NO_GRANT,
} = await import("../../../module/actors/character/seeker-major-grant.js");

const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const playbookDoc = slug => ({ ...structuredClone(PACK.get(slug)), uuid: `Compendium.test.${slug}` });
const ARCANA = loadArcanaPackDocs().map(doc => structuredClone(doc.flags.stonetop));
const PATRIOT = { slug: "patriot", label: "Patriot", majorArcana: ["hectumel-codex", "red-scepter", "staff-of-the-lidless-orb"] };
const arcana = (actor, key) => actor.getFlag("stonetop-pwd", `arcana.${key}`);
const has = (actor, key, slug) => (arcana(actor, key) ?? []).includes(slug);
const ticked = (actor, slug) => Object.entries(arcana(actor, "boxes") ?? {}).filter(([k, v]) => v && k.startsWith(`${slug}:`)).map(([k]) => k).sort();

const SEEKER_STATS = { str: -1, dex: 0, con: 1, int: 2, wis: 1, cha: 0 };
const CHOICE = {
	backgroundSlug: "patriot", stats: SEEKER_STATS, moves: [], lore: { picks: {}, texts: {} },
	backgroundChoices: { "Well Versed": { label: "Well Versed in", value: "the Things Below" } },
	arcana: {
		major: "hectumel-codex", majorMarks: ["unlock:0"], majorMarksFor: "hectumel-codex",
		minorDraw: ["bow-with-no-string", "corroded-spearhead", "giant-oak-leaf"],
		minorRoles: { mastered: "bow-with-no-string", found: "corroded-spearhead", lead: "giant-oak-leaf" },
	},
};

function seeker() {
	const made = buildLiveCharacter({
		slug: "the-seeker", name: "The Seeker", seedStartingMoves: false, stats: SEEKER_STATS,
		arcana: new FakeArcanaRepository(structuredClone(ARCANA)),
	});
	made.actor.typedActor = made.char;
	const Base = class {
		constructor() { this._actor = made.actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._openPossessionChoices = vi.fn();
	sheet._applyBackgroundNeighbors = vi.fn();
	return { ...made, sheet, finish: () => sheet._applyPlaybookSelections(playbookDoc("the-seeker"), structuredClone(CHOICE)) };
}

// The rows ArcanaSource#loadRows would give: every shipped card, plus one finished homebrew major.
const SOURCE_ROWS = [
	...ARCANA.map(a => ({ key: a.slug, title: a.front?.title ?? a.slug, summary: "A card.", isMajor: isMajorArcanumItem(a), uuid: `Compendium.stonetop-pwd.stonetop-arcana.Item.${a.slug}` })),
	{ key: "homebrew-orb", title: "Homebrew Orb", summary: "Ours.", isMajor: true, uuid: "Item.homebrewOrb" },
];

const realGame = globalThis.game;
const asUser = (isGM, ...switches) => {
	globalThis.game = { ...realGame, user: { id: "u1", isGM }, settings: { get: (scope, key) => scope === SYSTEM_ID && switches.includes(key) } };
};

beforeEach(() => {
	pickContentOption.mockReset();
	vi.spyOn(ArcanaSource.prototype, "loadRows").mockResolvedValue(structuredClone(SOURCE_ROWS));
	globalThis.ui = { ...(globalThis.ui ?? {}), notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	asUser(true);
});
afterEach(() => { vi.restoreAllMocks(); globalThis.game = realGame; });

describe("the major arcanum picker's rows", () => {
	const majors = [
		{ slug: "red-scepter", name: "Red Scepter", summary: "x".repeat(300) },
		{ slug: "mindgem", name: "Mindgem", summary: "" },
		{ slug: "azure-hand", name: "Azure Hand", summary: "" },
		{ slug: "homebrew-orb", name: "Homebrew Orb", summary: "", homebrew: true },
	];
	const shape = rows => rows.map(r => r.heading ?? r.id);

	it("lists the background's own first, then the other shipped ones by name, then homebrew", () => {
		const rows = majorArcanumRows({ majors, listed: ["red-scepter"] });
		expect(shape(rows)).toEqual([
			"From this background", "red-scepter",
			"Other major arcana", "azure-hand", "mindgem",
			"Homebrew", "homebrew-orb",
		]);
		expect(rows[1].icon).toBe("fa-wand-sparkles");
		expect(rows[1].hint.length).toBeLessThanOrEqual(111);
	});

	it("leaves out an empty group's heading, and has the clear row only when asked", () => {
		const rows = majorArcanumRows({ majors: majors.slice(1, 3), listed: [] });
		expect(shape(rows)).toEqual(["Other major arcana", "azure-hand", "mindgem"]);
		const withClear = majorArcanumRows({ majors: majors.slice(1, 2), clearLabel: "The background's own three" });
		expect(shape(withClear)).toEqual([NO_GRANT, "Other major arcana", "mindgem"]);
		expect(withClear[0]).toMatchObject({ label: "The background's own three", icon: "fa-rotate-left" });
	});

	it("resolves the slug, '' for the clear row, null when dismissed", async () => {
		pickContentOption.mockResolvedValueOnce("mindgem").mockResolvedValueOnce(NO_GRANT).mockResolvedValueOnce(null);
		const ask = () => pickMajorArcanum({ majors, title: "t", buttonLabel: "b", clearLabel: "c" });
		expect(await ask()).toBe("mindgem");
		expect(await ask()).toBe("");
		expect(await ask()).toBeNull();
		// With no grant the clear row opens picked.
		expect(pickContentOption.mock.calls[0][0].selected).toBe(NO_GRANT);
	});

	it("loads only the majors, telling homebrew from shipped by the uuid, and can leave homebrew out", async () => {
		const all = await loadMajorArcana();
		expect(all.length).toBe(SOURCE_ROWS.filter(r => r.isMajor).length);
		expect(all.find(m => m.slug === "homebrew-orb").homebrew).toBe(true);
		expect(all.find(m => m.slug === "mindgem").homebrew).toBe(false);
		expect((await loadMajorArcana({ homebrew: false })).some(m => m.homebrew)).toBe(false);
	});

	it("players see homebrew majors only with both world switches on", () => {
		asUser(false, "seekerAnyMajorHomebrew");
		expect(playersSeeHomebrewMajors()).toBe(false);
		asUser(false, "seekerAnyMajorArcanum");
		expect(playersSeeHomebrewMajors()).toBe(false);
		asUser(false, "seekerAnyMajorArcanum", "seekerAnyMajorHomebrew");
		expect(playersSeeHomebrewMajors()).toBe(true);
	});
});

describe("the GM gives a Seeker a major arcanum", () => {
	const give = char => giveSeekerMajor(char, { background: PATRIOT, name: "Ada" });

	it("writes nothing for a player, and never opens the picker", async () => {
		asUser(false);
		const { actor, char } = seeker();
		expect(await give(char)).toBe(false);
		expect(pickContentOption).not.toHaveBeenCalled();
		expect(arcana(actor, "majorGrant") ?? undefined).toBeUndefined();
	});

	it("the GM's picker lists homebrew with the world switches off, and opens on the grant held", async () => {
		const { char } = seeker();
		await char.setSeekerMajorGrant("azure-hand");
		pickContentOption.mockResolvedValue(null);
		await give(char);
		const { options, selected, buttonLabel } = pickContentOption.mock.calls[0][0];
		expect(options.some(o => o.id === "homebrew-orb")).toBe(true);
		expect(options[0].id).toBe(NO_GRANT);
		expect(selected).toBe("azure-hand");
		expect(buttonLabel).toBe("Give this arcanum");
	});

	it("before creation: the grant is stored and no card is given", async () => {
		const { actor, char } = seeker();
		pickContentOption.mockResolvedValue("mindgem");
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask");
		expect(await give(char)).toBe(true);
		expect(arcana(actor, "majorGrant")).toBe("mindgem");
		expect(has(actor, "owned", "mindgem")).toBe(false);
		expect(ask).not.toHaveBeenCalled();
	});

	it("after creation: the card comes with its mark, and the untouched old major goes", async () => {
		const { actor, char, finish } = seeker();
		await finish();
		pickContentOption.mockResolvedValue("mindgem");
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:2"] });
		await give(char);
		expect(ask.mock.calls[0][1].map(c => c.slug)).toEqual(["mindgem"]);
		expect(arcana(actor, "majorGrant")).toBe("mindgem");
		expect(has(actor, "owned", "mindgem") && has(actor, "identified", "mindgem")).toBe(true);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:2"]);
		expect(arcana(actor, "major")).toBe("mindgem");
		expect(has(actor, "owned", "hectumel-codex")).toBe(false);
		expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
	});

	it("after creation: a played old major stays, with a notice", async () => {
		const { actor, char, finish } = seeker();
		await finish();
		await char.setArcanumBoxChecked("hectumel-codex", "unlock", 1, true);
		pickContentOption.mockResolvedValue("mindgem");
		vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:0"] });
		await give(char);
		expect(has(actor, "owned", "hectumel-codex") && has(actor, "owned", "mindgem")).toBe(true);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledOnce();
	});

	it("'Choose later' after creation leaves the grant owed, and the owed cue's ask offers only it", async () => {
		const { actor, char, sheet, finish } = seeker();
		await finish();
		await char.setArcanumBoxChecked("hectumel-codex", "unlock", 1, true);
		pickContentOption.mockResolvedValue("mindgem");
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null);
		await give(char);
		expect(await char.seekerMajorOwed()).toBe(true);
		ask.mockResolvedValue({ major: "mindgem", marks: ["front:1"] });
		await sheet._onSeekerMajorOwed();
		expect(ask.mock.calls[1][1].map(c => c.slug)).toEqual(["mindgem"]);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:1"]);
		expect(has(actor, "owned", "hectumel-codex")).toBe(true);
		expect(await char.seekerMajorOwed()).toBe(false);
	});

	it("clearing the grant removes the flag and keeps the card held", async () => {
		const { actor, char, finish } = seeker();
		await finish();
		pickContentOption.mockResolvedValueOnce("mindgem");
		vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:0"] });
		await give(char);
		pickContentOption.mockResolvedValueOnce(NO_GRANT);
		expect(await give(char)).toBe(true);
		expect(arcana(actor, "majorGrant") ?? undefined).toBeUndefined();
		expect(has(actor, "owned", "mindgem")).toBe(true);
		expect(arcana(actor, "major")).toBe("mindgem");
	});

	it("dismissing the picker writes nothing", async () => {
		const { actor, char, finish } = seeker();
		await finish();
		const before = structuredClone(actor.flags);
		pickContentOption.mockResolvedValue(null);
		expect(await give(char)).toBe(false);
		expect(actor.flags).toEqual(before);
	});
});

// The players' "Choose a different arcanum" (the world's "any major" switch): homebrew majors listed
// only with the second switch on too (playersSeeHomebrewMajors), on onboarding's step and on the
// Details tab's ask alike.
describe("the players' picker under the world's switch", () => {
	const onboarding = () => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(playbookDoc("the-seeker"), null, null);
		d._selections.backgroundSlug = "patriot";
		d._arcanaCache = { major: [
			{ slug: "hectumel-codex", name: "Hectumel Codex", description: "", homebrew: false },
			{ slug: "mindgem", name: "Mindgem", description: "", homebrew: false },
			{ slug: "homebrew-orb", name: "Homebrew Orb", description: "", homebrew: true },
		], minor: [] };
		d.render = vi.fn(async () => {});
		return d;
	};
	const listed = () => pickContentOption.mock.calls.at(-1)[0].options.map(o => o.heading ?? o.id);

	it("onboarding: no homebrew with its switch off, or with only the homebrew switch on", async () => {
		for (const switches of [["seekerAnyMajorArcanum"], ["seekerAnyMajorHomebrew"]]) {
			asUser(false, ...switches);
			pickContentOption.mockResolvedValue(null);
			await onboarding()._chooseOtherSeekerMajor();
			expect(listed()).not.toContain("homebrew-orb");
		}
	});

	it("onboarding: both on lists homebrew under its heading, and the pick is taken", async () => {
		asUser(false, "seekerAnyMajorArcanum", "seekerAnyMajorHomebrew");
		pickContentOption.mockResolvedValue("mindgem");
		const d = onboarding();
		await d._chooseOtherSeekerMajor();
		expect(listed()).toEqual(["From this background", "hectumel-codex", "Other major arcana", "mindgem", "Homebrew", "homebrew-orb"]);
		expect(pickContentOption.mock.calls[0][0].buttonLabel).toBe("Take this arcanum");
		expect(d._selections.arcana.major).toBe("mindgem");
		expect(d.render).toHaveBeenCalled();
	});

	it("the Details tab's ask offers the third button only with the switch on and no grant", async () => {
		const { sheet, char } = seeker();
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue(null);
		await char.background.selectBackground("patriot");
		await sheet._askSeekerMajorArcanum();
		expect(ask.mock.calls[0][2]).toEqual({ other: false });
		asUser(false, "seekerAnyMajorArcanum");
		await sheet._askSeekerMajorArcanum();
		expect(ask.mock.calls[1][2]).toEqual({ other: true });
		await char.setSeekerMajorGrant("mindgem");
		await sheet._askSeekerMajorArcanum();
		expect(ask.mock.calls[2][2]).toEqual({ other: false });
	});

	it("the Details tab's 'different arcanum' picks any major, then asks its mark", async () => {
		asUser(false, "seekerAnyMajorArcanum");
		const { actor, sheet, char } = seeker();
		await char.background.selectBackground("patriot");
		const ask = vi.spyOn(SeekerMajorArcanumDialog, "ask")
			.mockResolvedValueOnce({ other: true })
			.mockResolvedValueOnce({ major: "mindgem", marks: ["front:3"] });
		pickContentOption.mockResolvedValue("mindgem");
		await sheet._askSeekerMajorArcanum();
		expect(listed()).not.toContain("homebrew-orb");
		expect(ask.mock.calls[1][1].map(c => c.slug)).toEqual(["mindgem"]);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:3"]);
		expect(arcana(actor, "major")).toBe("mindgem");
	});

	it("the ask dialog has the third button only when asked for it", async () => {
		const withOther = new SeekerMajorArcanumDialog(PATRIOT, [ARCANA.find(a => a.slug === "mindgem")], { other: true });
		const without   = new SeekerMajorArcanumDialog(PATRIOT, [ARCANA.find(a => a.slug === "mindgem")]);
		expect(withOther.getData().otherLabel).toBe("Choose a different arcanum");
		expect(without.getData().otherLabel).toBe("");
	});
});

// Re-running creation from Edit Character keeps a given off-list major as it is (step 6).
describe("a re-run of creation and a given major", () => {
	it("finishing unchanged keeps the card, its mark and arcana.major", async () => {
		const { actor, char, sheet, finish } = seeker();
		await finish();
		pickContentOption.mockResolvedValue("mindgem");
		vi.spyOn(SeekerMajorArcanumDialog, "ask").mockResolvedValue({ major: "mindgem", marks: ["front:2"] });
		await giveSeekerMajor(char, { background: PATRIOT });
		const pb = playbookDoc("the-seeker");
		const selections = sheet._readSelectionsFromActor(pb);
		const d = Object.create(CharacterOnboardingDialog.prototype);
		d._initializeState(pb, null, null);
		// As _initializeState merges them in Foundry (tests/setup.js's mergeObject has no `inplace`).
		Object.assign(d._selections, structuredClone(selections));
		d._seekerActor = actor;
		d._arcanaCache = { major: ARCANA.filter(a => isMajorArcanumItem(a)).map(a => ({ slug: a.slug, name: a.slug, frontDescription: a.front?.description ?? "", unlockDescription: a.front?.unlock?.description ?? "" })), minor: [] };
		d._ensureSeekerMajorSelection();
		expect(d._selections.arcana.major).toBe("mindgem");
		await sheet._applyPlaybookSelections(pb, d._selections);
		expect(has(actor, "owned", "mindgem")).toBe(true);
		expect(ticked(actor, "mindgem")).toEqual(["mindgem:front:2"]);
		expect(arcana(actor, "major")).toBe("mindgem");
	});
});

describe("a character still being made", () => {
	it("reads the playbook its walkthrough is on, and none once a playbook is committed", async () => {
		const { actor, char } = seeker();
		const committed = actor.system.playbook;
		actor.system.playbook = {};
		await actor.setFlag("stonetop-pwd", "onboardingProgress", { state: "onboarding", playbook: "The Seeker", playbookSlug: "the-seeker" });
		const playbook = await char.playbookInCreation();
		expect(playbook?.backgrounds?.some(bg => bg.majorArcana?.length)).toBe(true);
		actor.system.playbook = committed;
		expect(await char.playbookInCreation()).toBeNull();
	});
});
