// Level Up's audit fixes (2026-10-23): a move agreed with the table (J2), a temporary Instinct
// that Level Up ends (J4), each pick after the level/XP write saved on its own (CORE-9), one
// client taking each level (CORE-4), and the dialog's agreed step, review line and keyboard picks.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { FakePlaybookRepository } from "../../fakes/FakePlaybookRepository.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";
import { LEVEL_PICK_FLAG, STARTING_CHOICE_FLAG } from "../../../module/actors/character/StonetopCharacter.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { CharacterInstincts } from "../../../module/actors/character/CharacterInstincts.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";
import {
	claimLevelUp, grantLevelUpClaim, handleLevelUpClaimQuery, resetLevelUpClaims, LEVEL_UP_CLAIM_TTL,
} from "../../../module/actors/character/level-up-claim.js";

// The level-up's agreed step asks a world setting whether this user may write a custom move
// (utils/authoring-gates.js); a world always has settings, so the tests give it some, all unset.
let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const heavyId = name => sourceMovesFor("The Heavy").find(d => d.name === name)._id;
const foxAt = level => buildLiveCharacter({ slug: "the-fox", name: "The Fox", level });
const levelOf = actor => actor.system.attributes.level.value;
const levelPick = item => !!item?.flags?.[STONETOP_SCOPE]?.[LEVEL_PICK_FLAG];

describe("applyLevelUp: a move agreed with the table (Book I p.529)", () => {
	it("learns another playbook's move as the level's pick, stamped so the budget counts it", async () => {
		const { char, actor } = foxAt(2);
		const create = vi.spyOn(actor, "createEmbeddedDocuments");
		const res = await char.applyLevelUp(null, null, { agreed: { foreignMoveId: heavyId("Cut from Granite") } }, { fromLevel: 2 });
		expect(res.applied).toBe(true);
		expect(levelOf(actor)).toBe(3);
		const item = actor.items.find(i => i.name === "Cut from Granite");
		expect(levelPick(item)).toBe(true);
		// Stamped in the write that creates it, not set on the item afterwards.
		const written = create.mock.calls.flatMap(([, docs]) => docs).find(d => d.name === "Cut from Granite");
		expect(levelPick(written)).toBe(true);
		expect(char._levelPickCount()).toBe(1);
	});

	it("writes a custom move from the editor's input, stamped the same", async () => {
		const { char, actor } = foxAt(2);
		const create = vi.spyOn(actor, "createEmbeddedDocuments");
		await char.applyLevelUp(null, null, { agreed: { customMove: { name: "Breaker of Chains", description: "When you..." } } }, { fromLevel: 2 });
		const item = actor.items.find(i => i.name === "Breaker of Chains");
		expect(item?.flags?.[STONETOP_SCOPE]?.custom).toBeTruthy();
		expect(levelPick(item)).toBe(true);
		const written = create.mock.calls.flatMap(([, docs]) => docs).find(d => d.name === "Breaker of Chains");
		expect(written?.flags?.[STONETOP_SCOPE]?.custom).toBeTruthy();
		expect(levelPick(written)).toBe(true);
	});
});

describe("applyLevelUp: each pick after the level is paid is saved on its own (CORE-9)", () => {
	it("a move that fails to add is named, and the Invocation and companion actions still land", async () => {
		const { char, actor } = foxAt(2);
		char.addMove = vi.fn(async () => { throw new Error("pack unreachable"); });
		char._background.setMarkedActions = vi.fn(async () => {});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = await char.applyLevelUp(heavyId("Cut from Granite"), "inv-a", { companionActions: ["track"] }, { fromLevel: 2 });
		err.mockRestore();
		expect(res).toMatchObject({ applied: true, failed: ["move"] });
		expect(levelOf(actor)).toBe(3);
		expect(actor.getFlag(STONETOP_SCOPE, "invocations.selected")).toEqual(["inv-a"]);
		expect(char._background.setMarkedActions).toHaveBeenCalled();
	});

	it("a temporary Instinct ends with the level-up and is handed back", async () => {
		const { char } = foxAt(2);
		await char.instinct.setTemporary("Birdlike: To act strangely, like a bird.", "the grwgnach");
		expect(char.instinct.temporary).toEqual({ value: "Birdlike: To act strangely, like a bird.", source: "the grwgnach" });
		const res = await char.applyLevelUp(null, null, null, { fromLevel: 2 });
		expect(res.endedInstinct?.value).toBe("Birdlike: To act strangely, like a bird.");
		expect(char.instinct.temporary).toBeNull();
	});
});

describe("CharacterInstincts: the temporary Instinct", () => {
	const store = () => {
		const bag = {};
		return {
			getFlag: k => bag[k],
			setFlag: async (k, v) => { bag[k] = v; },
			unsetFlag: async k => { delete bag[k]; },
		};
	};
	it("a blank value removes it, and the chosen Instinct is untouched", async () => {
		const inst = new CharacterInstincts(store());
		await inst.select("Mercy: to spare a foe");
		await inst.setTemporary("Birdlike", "");
		expect(inst.temporary).toEqual({ value: "Birdlike", source: "" });
		await inst.setTemporary("   ");
		expect(inst.temporary).toBeNull();
		expect(inst.selectedValue).toBe("Mercy: to spare a foe");
	});
});

// ── The level move budget counts a stamped agreed pick ────────────────────────
const PACK = new Map(loadPlaybookPackDocs().map(doc => [doc.system.slug, doc]));
const FOX_PB = {
	slug: "the-fox", name: "The Fox", img: "x.svg", description: "", statsNote: "", hp: 16, damage: "d8",
	startingMovesNote: "You start with Ambush OR Skill at Arms; Danger Sense OR Perceptive; and 1 of your choice.",
	startingMoveChoices: PACK.get("the-fox").flags.stonetop.moves.choices,
};
const pbMove = (pb, id, name, o = {}) => ({ _id: id, name, system: { moveType: "playbook", isStartingMove: false, rollType: null, playbook: pb, ...o } });
const owned = (pb, id, name, o = {}) => ({ _id: id, type: "move", name, ...(o.flags ? { flags: o.flags } : {}),
	system: { moveType: "playbook", playbook: pb, isStartingMove: !!o.starting } });
const FOX_DEFS = [
	pbMove("The Fox", "am", "Ambush", { isStartingMove: true }), pbMove("The Fox", "sa", "Skill at Arms", { isStartingMove: true }),
	pbMove("The Fox", "ds", "Danger Sense", { isStartingMove: true }), pbMove("The Fox", "pe", "Perceptive", { isStartingMove: true }),
	pbMove("The Fox", "ca", "Catlike"), pbMove("The Fox", "bu", "Burgle"),
];
const started = { starting: true, flags: { [STONETOP_SCOPE]: { [STARTING_CHOICE_FLAG]: true } } };
async function movelist(items, level) {
	const actor = new FakeActorBuilder().withPlaybook(FOX_PB.slug, FOX_PB.name).withLevel(level).withItems(items).build();
	let b = new TestCharacterBuilder(actor).withPlaybookRepo(new FakePlaybookRepository(FOX_PB));
	for (const d of FOX_DEFS) b = b.addPlaybookMove(d);
	return (await b.build().buildSnapshot()).movelist;
}

describe("the level move budget: an agreed pick is the level's pick", () => {
	const base = [owned("The Fox", "a1", "Ambush", started), owned("The Fox", "p1", "Perceptive", started), owned("The Fox", "c1", "Catlike")];
	it("a level-3 Fox with a stamped Heavy move has made both level picks", async () => {
		const ml = await movelist([...base, owned("The Heavy", "h1", "Cut from Granite", { flags: { [STONETOP_SCOPE]: { [LEVEL_PICK_FLAG]: true } } })], 2);
		expect(ml.levelMovesShortfall).toBe(0);
	});
	it("the same move dropped on unstamped is not a pick", async () => {
		const ml = await movelist([...base, owned("The Heavy", "h1", "Cut from Granite")], 2);
		expect(ml.levelMovesShortfall).toBe(1);
	});
});

// ── One client takes each level (CORE-4) ──────────────────────────────────────
describe("level-up claims", () => {
	afterEach(() => resetLevelUpClaims());
	const pc = (level = 2) => ({ uuid: "Actor.pc", system: { attributes: { level: { value: level } } }, testUserPermission: () => true });

	it("the first asker holds the level; another asker is refused; the holder may retry", () => {
		const actor = pc();
		expect(grantLevelUpClaim(actor, 2, "player", 1000)).toBe(true);
		expect(grantLevelUpClaim(actor, 2, "gm", 1001)).toBe(false);
		expect(grantLevelUpClaim(actor, 2, "player", 1002)).toBe(true);
		// A claim lapses, so a write that never came does not lock the level for good.
		expect(grantLevelUpClaim(actor, 2, "gm", 1002 + LEVEL_UP_CLAIM_TTL + 1)).toBe(true);
	});

	it("refuses a level the GM's copy is already past", () => {
		expect(grantLevelUpClaim(pc(3), 2, "player")).toBe(false);
	});

	it("the query handler refuses a non-owner", async () => {
		const actor = { ...pc(), testUserPermission: () => false };
		const asker = { id: "u2", isGM: false };
		expect(await handleLevelUpClaimQuery({ actorUuid: "Actor.pc", fromLevel: 2 }, { user: asker }, { resolve: () => actor })).toBe(false);
	});

	// v13 names no sender: a player naming a GM must not skip the owner check and hold another's level.
	it("on v13 a claim naming a GM holds the level only once that GM's client says it sent it", async () => {
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, user: { id: "g1", isGM: true } };
		try {
			const actor = { ...pc(), testUserPermission: () => false };
			const verify = vi.fn(async () => false);
			const g2 = { id: "g2", isGM: true, query: verify };
			const users = { get: id => ({ g1: { id: "g1", isGM: true }, g2 })[id] ?? { id, isGM: false } };
			// Forged: granted as with no GM (the claimer still cannot write what it does not own), and nothing held.
			expect(await handleLevelUpClaimQuery({ actorUuid: "Actor.pc", fromLevel: 2, userId: "g2", askId: "x" }, {}, { users, resolve: () => actor })).toBe(true);
			expect(verify).toHaveBeenCalledWith("stonetop.ownerAskVerify", { askId: "x" }, expect.anything());
			expect(grantLevelUpClaim({ ...pc() }, 2, "owner")).toBe(true);
			resetLevelUpClaims();
			// Naming this GM's own client is always forged: it never asks itself.
			verify.mockClear();
			expect(await handleLevelUpClaimQuery({ actorUuid: "Actor.pc", fromLevel: 2, userId: "g1", askId: "x" }, {}, { users, resolve: () => actor })).toBe(true);
			expect(verify).not.toHaveBeenCalled();
			expect(grantLevelUpClaim({ ...pc() }, 2, "owner")).toBe(true);
			resetLevelUpClaims();
			// A second GM's real claim holds it.
			verify.mockResolvedValue(true);
			expect(await handleLevelUpClaimQuery({ actorUuid: "Actor.pc", fromLevel: 2, userId: "g2", askId: "y" }, {}, { users, resolve: () => actor })).toBe(true);
			expect(grantLevelUpClaim({ ...pc() }, 2, "owner")).toBe(false);
		} finally {
			globalThis.game = savedGame;
		}
	});

	it("a player asks the GM's client; no GM, or no answer, lets the level-up go ahead", async () => {
		const actor = pc();
		const ask = vi.fn(async () => false);
		const game = { user: { id: "p" }, users: { activeGM: { id: "g" } } };
		expect(await claimLevelUp(actor, 2, { game, ask })).toBe(false);
		expect(ask).toHaveBeenCalledWith(game.users.activeGM, expect.any(String), expect.objectContaining({ fromLevel: 2, askId: expect.any(String) }), expect.objectContaining({ fallback: true }));
		expect(await claimLevelUp(actor, 2, { game: { user: { id: "p" }, users: {} }, ask })).toBe(true);
		expect(await claimLevelUp(actor, 2, { game, ask: vi.fn(async () => true) })).toBe(true);
	});

	it("the GM's own press claims on its own client", async () => {
		const actor = pc();
		const game = { user: { id: "g" }, users: { activeGM: { id: "g" } } };
		grantLevelUpClaim(actor, 2, "p");
		expect(await claimLevelUp(actor, 2, { game })).toBe(false);
	});
});

// ── The dialog ───────────────────────────────────────────────────────────────
function makeDialog(data = {}, character = {}) {
	const char = {
		applyLevelUp: vi.fn(async () => ({ applied: true })),
		getForeignMovesForLevelUp: vi.fn(async () => [
			{ compendiumId: "h1", name: "Cut from Granite", playbook: "The Heavy", ownedIds: [] },
		]),
		_actor: { id: "pcA" },
		...character,
	};
	const dlg = new LevelUpDialog(char, {
		level: 2, newLevel: 3, cost: 10, xpRemaining: 0, playbookName: "The Fox", needsInvocation: false,
		availableMoves: [], lockedMoves: [], availableInvocations: [], stats: [], ...data,
	}, vi.fn());
	dlg.close = vi.fn();
	dlg.render = vi.fn();
	return { dlg, char };
}

describe("LevelUpDialog: agreed with the table", () => {
	it("the move step can finish with no playbook move left: the agreed card is the pick", async () => {
		const { dlg, char } = makeDialog();
		dlg._step = "move";
		expect(dlg.getData().canContinue).toBe(false);
		dlg._selectedMoveId = "__agreed__";
		expect(dlg.getData().canContinue).toBe(true);
		expect(dlg._adjacentStep(+1)).toBe("agreed");
		await dlg._loadAgreedMoves();
		expect(char.getForeignMovesForLevelUp).toHaveBeenCalledWith({ playbooks: "any" }, 3);
		dlg._step = "agreed";
		expect(dlg.getData().canContinue).toBe(false);
		dlg._selectedAgreedId = "h1";
		const ctx = dlg.getData();
		expect(ctx.canContinue).toBe(true);
		expect(ctx.isLastStep).toBe(true);
		await dlg._apply();
		expect(char.applyLevelUp).toHaveBeenCalledWith(null, null, { agreed: { foreignMoveId: "h1" } }, { fromLevel: 2, moveName: "Cut from Granite" });
	});

	it("a custom move opens the editor, and only its save takes the level", async () => {
		const { dlg, char } = makeDialog();
		dlg._selectedMoveId = "__agreed__";
		dlg._selectedAgreedId = "__custom__";
		dlg._step = "agreed";
		const opened = [];
		dlg._openCustomEditor = vi.fn((choices, slug) => { opened.push({ choices, slug }); });
		await dlg._apply();
		expect(opened).toHaveLength(1);
		expect(char.applyLevelUp).not.toHaveBeenCalled();
	});

	// The level-up window stays usable while the editor is open: a pick changed and Applied again only raises
	// the editor, and its save must take the picks of that last Apply.
	it("saves the custom move with the picks of the last Apply, not the first", async () => {
		const { CustomMoveDialog } = await import("../../../module/actors/character/dialogs/CustomMoveDialog.js");
		const render = vi.spyOn(CustomMoveDialog.prototype, "render").mockImplementation(function () { return this; });
		try {
			const { dlg, char } = makeDialog();
			dlg._openCustomEditor({ companionActions: ["first"] }, "old-slug");
			const editor = dlg._customEditor;
			Object.defineProperty(editor, "rendered", { value: true });
			editor.bringToTop = vi.fn();
			dlg._openCustomEditor({ companionActions: ["second"] }, "new-slug");
			expect(dlg._customEditor).toBe(editor);
			expect(editor.bringToTop).toHaveBeenCalledTimes(1);
			await editor._saver.create({ name: "My Move" });
			expect(char.applyLevelUp).toHaveBeenCalledWith(null, "new-slug",
				{ companionActions: ["second"], agreed: { customMove: { name: "My Move" } } }, { fromLevel: 2, moveName: "My Move" });
		} finally {
			render.mockRestore();
		}
	});
});

describe("LevelUpDialog: step 6's review line", () => {
	it("names a temporary Instinct that ends, or the insert whose Instinct replaced the playbook's", () => {
		const t = makeDialog({ temporaryInstinct: "Birdlike" }).dlg;
		expect(t._reviewLine()).toMatch(/temporary Instinct "Birdlike" ends/);
		const i = makeDialog({ insertInstinctName: "Ghost" }).dlg;
		expect(i._reviewLine()).toMatch(/your Ghost insert's, which replaced your playbook's/);
		const plain = makeDialog().dlg;
		expect(plain._reviewLine()).toMatch(/^Last, review your Instinct and Appearance/);
	});
});

// One open per character (CORE-5) is covered in levelup-again.test.js, through the sheet.
