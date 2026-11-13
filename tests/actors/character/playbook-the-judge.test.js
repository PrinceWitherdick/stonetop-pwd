import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLiveCharacter, makeLiveItem, resetLiveIds } from "../../fakes/LiveCharacter.js";
// For the advancement blocks at the foot of the file.
import fs from "node:fs";
import path from "node:path";
import { sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { loadPlaybookPackDocs } from "../../fakes/sourcePack.js";
import { parseMovePickCount } from "../../../module/actors/character/StonetopCharacter.js";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

// The Judge's Castigate, driven through a real StonetopCharacter.
//
// "When you Censure someone, your voice deals 1d4 damage to them (near, loud, ignores armor)." The
// blow used to ride brandCondemned, so it only ever landed for a Judge who owned Condemn (level 6+,
// where Castigate is level 2+): nothing else opens the window that lays brands. It now lands from
// the Censure itself (the sheet's _censure, pinned in character-sheet-app.test.js), through
// `castigate` below, and laying a brand is record-keeping that rolls nothing.
//
// Only `rollMoveDamageAt` is replaced; everything else StonetopCharacter takes from attack-flow is real.
const flow = vi.hoisted(() => ({ rollAt: vi.fn(async () => ({ id: "card" })) }));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => ({
	...(await importOriginal()),
	rollMoveDamageAt: flow.rollAt,
}));

const LEARNED_OFF = { "stonetop-pwd": { learned: false } };

function judge({ castigate = true, learned = true, condemn = false } = {}) {
	const items = [makeLiveItem({ name: "Censure", type: "move", system: { rollType: null } })];
	if (castigate) {
		items.push(makeLiveItem({
			name: "Castigate", type: "move", system: { rollType: null }, flags: learned ? {} : LEARNED_OFF,
		}));
	}
	if (condemn) items.push(makeLiveItem({ name: "Condemn", type: "move", system: { rollType: null } }));
	return buildLiveCharacter({ slug: "the-judge", name: "The Judge", seedStartingMoves: false, items });
}

const bandit = { documentName: "Token", uuid: "Scene.s.Token.b", id: "b", name: "Bandit" };

beforeEach(() => {
	resetLiveIds();
	flow.rollAt.mockClear();
});

describe("Castigate's blow", () => {
	it("rolls one 1d4 card at the person Censured, loud and ignoring armor, with no Condemn owned", async () => {
		const { char, actor } = judge();
		expect(char.canCondemn).toBe(false);
		expect(char.canCastigate).toBe(true);
		await char.castigate(bandit);
		expect(flow.rollAt).toHaveBeenCalledTimes(1);
		expect(flow.rollAt).toHaveBeenCalledWith(actor, bandit, {
			move: "Castigate", formula: "1d4", ignoresArmor: true, tags: ["loud"],
		});
	});

	it("rolls nothing for a Judge who has not learned Castigate", async () => {
		for (const { char } of [judge({ castigate: false }), judge({ learned: false })]) {
			expect(char.canCastigate).toBe(false);
			expect(await char.castigate(bandit)).toBeNull();
		}
		expect(flow.rollAt).not.toHaveBeenCalled();
	});

	it("rolls nothing with nobody to hit", async () => {
		const { char } = judge();
		expect(await char.castigate(null)).toBeNull();
		expect(flow.rollAt).not.toHaveBeenCalled();
	});
});

// The old home of the blow. A Censure is followed by the brand being laid in the window, so a roll
// here as well as at the Censure would be two 1d4s for one denunciation; a brand added by hand
// with no Censure behind it is paperwork and hurts nobody.
describe("laying a brand", () => {
	it("stores the brand and rolls no Castigate damage", async () => {
		// The row's link resolves, as it would in a world: the old code rolled exactly when it did.
		const before = globalThis.fromUuid;
		globalThis.fromUuid = vi.fn(async () => bandit);
		try {
			const { char } = judge({ condemn: true });
			const laid = await char.brandCondemned({ name: "Bandit", uuid: "Actor.bandit" });
			expect(laid).toMatchObject({ name: "Bandit" });
			expect(char.condemned).toHaveLength(1);
			expect(flow.rollAt).not.toHaveBeenCalled();
		} finally {
			globalThis.fromUuid = before;
		}
	});
});

describe("Proclamation", () => {
	it("is asked as a learned move", () => {
		const { char } = judge();
		expect(char.canProclaim).toBe(false);
		const proclaims = buildLiveCharacter({
			slug: "the-judge", name: "The Judge", seedStartingMoves: false,
			items: [makeLiveItem({ name: "Proclamation", type: "move", system: { rollType: null } })],
		});
		expect(proclaims.char.canProclaim).toBe(true);
	});
});

// ── The Judge's advancement ─────────────────────────────────────────────────────
// Book I p.54 / p.529: "If a move says '(Requires __),' then you must meet that requirement in
// order to take the move." "If a move replaces a different move, then it requires the one it
// replaces. When you take such a move, you lose the original move and any benefits that it
// conferred." The data guards read the pack SOURCE; the rest drives a real StonetopCharacter.

const MOVES_SRC = path.join(process.cwd(), "packs", "src", "stonetop-items", "playbook-moves");
const readMoves = dir => fs.readdirSync(path.join(MOVES_SRC, dir))
	.filter(f => f.endsWith(".json"))
	.map(f => JSON.parse(fs.readFileSync(path.join(MOVES_SRC, dir, f), "utf8")));
const JUDGE_SRC = new Map(readMoves("the-judge").map(d => [d.name, d]));
const JUDGE_PB  = JSON.parse(fs.readFileSync(path.join(process.cwd(), "packs", "src", "stonetop-items", "playbooks", "the-judge.json"), "utf8"));

const judgeMove = name => sourceMovesFor("The Judge").find(d => d.name === name);
const judgeItem = (name, flags) => makeLiveItem({ name, type: "move", system: structuredClone(judgeMove(name).system), flags });
const judgeAt   = (level, items = []) => buildLiveCharacter({ slug: "the-judge", name: "The Judge", level, items });
// The Judge's moves as the Moves tab builds them, keyed by name.
async function judgeEntries(char, level) {
	const entries = await char._moveRepo.getPlaybookMoves("The Judge");
	return new Map(char.buildMovelistContext(entries, char._buildOwnedMovesMap(), new Set(), level, "The Judge").map(e => [e.name, e]));
}

describe("the Judge's moves, as the book prints them (pack source)", () => {
	const req = name => JUDGE_SRC.get(name)?.system?.requirement ?? {};

	it("Castigate needs level 2+ and Censure", () => {
		expect(req("Castigate")).toMatchObject({ level: 2, moves: ["Censure"] });
	});

	it.each([
		["Armistice",    "Bear Witness"],
		["Condemn",      "Censure"],
		["Proclamation", "Condemn"],
		["Mirrorshield", "Aegis of Faith"],
	])("%s needs level 6+ and %s", (name, need) => {
		expect(req(name)).toMatchObject({ level: 6, moves: [need] });
	});

	it.each(["The Tower Eternal", "Superior Stat"])("%s needs level 6+ and nothing else", name => {
		expect(req(name).level).toBe(6);
		expect(req(name).moves ?? []).toEqual([]);
		expect(req(name).anyMoves ?? []).toEqual([]);
	});

	it.each([
		["Binding Arbitration",         "Truth or Consequences"],
		["Like a Dog with a Bone",      "Hound of Aratis"],
		["A Bundle of Sticks Unbroken", "Many Hands Make Light Work"],
	])("%s needs %s, at any level", (name, need) => {
		expect(req(name).moves).toEqual([need]);
		expect(req(name).level ?? null).toBeNull();
	});

	it("A Mighty Rampart replaces Bulwark", () => {
		expect(JUDGE_SRC.get("A Mighty Rampart").system.replaces).toBe("Bulwark");
	});

	it("Improved Stat caps at +2, taken up to 3 times; Superior Stat caps at +3, once", () => {
		expect(JUDGE_SRC.get("Improved Stat").system).toMatchObject({ cap: 2, repeatMax: 3 });
		expect(JUDGE_SRC.get("Superior Stat").system.cap).toBe(3);
		expect(JUDGE_SRC.get("Superior Stat").system.repeatMax ?? 1).toBe(1);
	});

	it("starts with exactly Censure and Chronicler of Stonetop, plus 2 of choice", () => {
		const starting = [...JUDGE_SRC.values()].filter(d => d.system.isStartingMove).map(d => d.name).sort();
		expect(starting).toEqual(["Censure", "Chronicler of Stonetop"]);
		expect(parseMovePickCount(JUDGE_PB.flags.stonetop.moves.startingMovesNote)).toBe(2);
	});

	it("of the seven cross-playbook moves, only Versatile and Arts of War reach the Judge", () => {
		const cross = fs.readdirSync(MOVES_SRC, { withFileTypes: true })
			.filter(e => e.isDirectory()).flatMap(e => readMoves(e.name))
			.filter(d => d.system?.crossPlaybook);
		expect(cross).toHaveLength(7);
		const reach = cross.filter(d => {
			const pbs = d.system.crossPlaybook.playbooks;
			return pbs === "any" || pbs.includes("The Judge");
		}).map(d => d.name).sort();
		expect(reach).toEqual(["Arts of War", "Versatile"]);
	});
});

describe("a move given up for its replacement", () => {
	async function rampartJudge() {
		const made = judgeAt(6, [judgeItem("Bulwark")]);
		await made.char.addMove(judgeMove("A Mighty Rampart")._id);
		return made;
	}

	it("A Mighty Rampart retires Bulwark, and the Moves tab locks Bulwark as replaced", async () => {
		const { char, actor } = await rampartJudge();
		expect(actor.items.map(i => i.name)).not.toContain("Bulwark");
		const moves = await judgeEntries(char, 6);
		expect(moves.get("Bulwark")).toMatchObject({ owned: false, locked: true, replacedBy: "A Mighty Rampart" });
		// The replacer, owned, never reads as missing the move it gave up.
		expect(moves.get("A Mighty Rampart")).toMatchObject({ owned: true, requirementsUnmet: false, replacedBy: null });
	});

	it("the Moves tab card carries the replacer, and the template names it and shuts the box", async () => {
		const { char } = await rampartJudge();
		const section = await char._buildMovesSection(await char.playbook(), char._buildOwnedMovesMap(), 6);
		const card = section.find(c => c.key === "playbook").moves.find(m => m.name === "Bulwark");
		expect(card).toMatchObject({ replacedBy: "A Mighty Rampart", locked: true });
		const hbs = fs.readFileSync(path.join(process.cwd(), "templates", "actor", "partials", "move-group.hbs"), "utf8");
		expect(hbs).toContain("{{#if (or (and isStarting owned) replacedBy (not (or @root.stonetop.movesEdit this.pickable)))}}disabled{{/if}}");
		expect(hbs).toContain(`{{localize "stonetop.character.moves.replacedBy" move=replacedBy}}`);
		expect(game.i18n.format("stonetop.character.moves.replacedBy", { move: "A Mighty Rampart" })).toBe("Replaced by A Mighty Rampart");
	});

	it("is offered neither at level-up nor as an onboarding free pick", async () => {
		const { char } = await rampartJudge();
		const data = await char.getLevelUpData();
		expect([...data.availableMoves, ...data.lockedMoves].map(m => m.name)).not.toContain("Bulwark");

		const d = judgeDialog();
		d._retiredMoves = char._retiredMoveNames();
		expect(offered(d)).not.toContain("Bulwark");
		expect(offered(judgeDialog())).toContain("Bulwark");
	});

	it("is generic: the Would-be Hero's Undaunted locks Better Part of Valor the same way", async () => {
		const wbh = name => sourceMovesFor("The Would-Be Hero").find(d => d.name === name);
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 6,
			items: [makeLiveItem({ name: "Better Part of Valor", type: "move", system: structuredClone(wbh("Better Part of Valor").system) })] });
		await char.addMove(wbh("Undaunted")._id);
		const entries = await char._moveRepo.getPlaybookMoves("The Would-Be Hero");
		const bpv = char.buildMovelistContext(entries, char._buildOwnedMovesMap(), new Set(), 6, "The Would-Be Hero")
			.find(e => e.name === "Better Part of Valor");
		expect(bpv).toMatchObject({ owned: false, locked: true, replacedBy: "Undaunted" });
	});
});

describe("a required move counts only while LEARNED", () => {
	const OFF = { "stonetop-pwd": { learned: false } };

	it("Hound of Aratis switched off: Like a Dog with a Bone is not offered at level-up or on the Moves tab", async () => {
		const { char } = judgeAt(1, [judgeItem("Hound of Aratis", OFF)]);
		const data = await char.getLevelUpData();
		expect(data.availableMoves.map(m => m.name)).not.toContain("Like a Dog with a Bone");
		expect(data.lockedMoves.map(m => m.name)).toContain("Like a Dog with a Bone");
		expect((await judgeEntries(char, 1)).get("Like a Dog with a Bone").locked).toBe(true);
	});

	it("an owned Like a Dog with a Bone warns while Hound is off, and re-learning clears it", async () => {
		const hound = judgeItem("Hound of Aratis", OFF);
		const { char, actor } = judgeAt(2, [hound, judgeItem("Like a Dog with a Bone")]);
		expect((await judgeEntries(char, 2)).get("Like a Dog with a Bone").requirementsUnmet).toBe(true);
		// Nothing is taken away: the warning is all.
		expect(actor.items.map(i => i.name)).toContain("Like a Dog with a Bone");
		await hound.setFlag("stonetop-pwd", "learned", true);
		expect((await judgeEntries(char, 2)).get("Like a Dog with a Bone").requirementsUnmet).toBe(false);
	});

	it("a learned Hound of Aratis opens Like a Dog with a Bone at level-up", async () => {
		const { char } = judgeAt(1, [judgeItem("Hound of Aratis")]);
		expect((await char.getLevelUpData()).availableMoves.map(m => m.name)).toContain("Like a Dog with a Bone");
	});

	it("the cross-playbook picker asks the same: a switched-off prerequisite opens no foreign move", async () => {
		const heavy = name => sourceMovesFor("The Heavy").find(d => d.name === name);
		const offers = async flags => {
			const carved = makeLiveItem({ name: "Carved Out of Wood", type: "move", system: structuredClone(heavy("Carved Out of Wood").system), flags });
			const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 6, items: [carved] });
			return (await char.getForeignMovesForLevelUp({ playbooks: "any" }, 6)).map(m => m.name);
		};
		expect(await offers(undefined)).toContain("Cut from Granite");
		expect(await offers(OFF)).not.toContain("Cut from Granite");
	});
});

// ── Onboarding: the Judge's 2 free picks chain ──────────────────────────────────
const JUDGE_PACK = loadPlaybookPackDocs().find(doc => doc.system.slug === "the-judge");
function judgeDialog(selections = {}) {
	const d = Object.create(CharacterOnboardingDialog.prototype);
	d._initializeState({ ...structuredClone(JUDGE_PACK), uuid: "Compendium.test.the-judge" }, null, null);
	d._movesCache = sourceMovesFor("The Judge").map(doc => ({ id: doc._id, name: doc.name, system: doc.system }));
	Object.assign(d._selections, selections);
	return d;
}
const offered = d => d._freePickOffers().map(doc => doc.name);

describe("onboarding's free picks chain", () => {
	it.each([
		["Hound of Aratis",            "Like a Dog with a Bone"],
		["Many Hands Make Light Work", "A Bundle of Sticks Unbroken"],
		["Truth or Consequences",      "Binding Arbitration"],
	])("picking %s first offers %s as the second pick", (first, second) => {
		expect(offered(judgeDialog())).not.toContain(second);
		expect(offered(judgeDialog({ moves: [judgeMove(first)._id] }))).toContain(second);
	});

	it("still never offers a level-gated move", () => {
		const d = judgeDialog({ moves: [judgeMove("Bulwark")._id] });
		expect(d._movePickCount).toBe(2);
		for (const gated of ["Castigate", "Condemn", "A Mighty Rampart", "Superior Stat", "The Tower Eternal"]) {
			expect(offered(d)).not.toContain(gated);
		}
	});

	it("unticking the prerequisite lets the dependent pick go", () => {
		const hound = judgeMove("Hound of Aratis")._id;
		const d = judgeDialog({ moves: [hound, judgeMove("Like a Dog with a Bone")._id] });
		d._pruneFreePicks();
		expect(d._selections.moves).toHaveLength(2);
		d._selections.moves = d._selections.moves.filter(id => id !== hound);
		expect(d._pruneFreePicks().map(doc => doc.name)).not.toContain("Like a Dog with a Bone");
		expect(d._selections.moves).toEqual([]);
	});
});

// ── The Judge's playbook text, against the printed sheet ────────────────────────
describe("the Judge's playbook text, as the sheet prints it (pack source)", () => {
	const st = JUDGE_PB.flags.stonetop;
	const background = slug => st.backgrounds.find(b => b.slug === slug).description;
	const lore = slug => st.lore.find(s => s.slug === slug);

	it("spells the Barrier Pass name Bortachikhan", () => {
		const names = st.origin.find(o => o.region === "Barrier Pass").names;
		expect(names).toContain("Bortachikhan");
		expect(names).not.toContain("Bortachikan");
	});

	it("Legacy asks the GM a question", () => {
		expect(background("legacy")).toContain("ask the GM a question, and the GM will tell you what you learn");
	});

	it("Missionary lists the Judges to add, marks the aviary, and sends birds as the order does", () => {
		const text = background("missionary");
		expect(text).toContain("Add these Judges to the Neighbors section of the steading playbook (pick 2 more):");
		for (const name of ["Devin", "Haeris", "Isalde", "Rahat", "Tejisha", "Unz"]) expect(text).toContain(`<strong>${name}</strong>`);
		expect(text).toContain("special possessions (go mark it now).");
		expect(text).toContain("via trained bird</em></strong>, as is the way of the Judges of your order, the GM will tell you");
	});

	it("the Chronicle says its lore follows the Background, asks for its structure, and has it marked on the map", () => {
		expect(lore("chronicle-plus").description).toContain(
			"The nature of the lore contained in the Chronicle depends on your Background, but it is more than a mere book; it is a physical place. Decide on its physical structure.");
		expect(lore("chronicle-minus").description).toContain("Mark the location of the Chronicle on the Stonetop playbook map.");
	});

	// Onboarding reads each section's pick count out of its description; the restored sentences
	// must not change what it finds.
	it("each lore section still counts 3 / 2 / 1 / 3", () => {
		const d = Object.create(CharacterOnboardingDialog.prototype);
		const counts = ["chronicle-plus", "chronicle-minus", "lawkeeper-shrine", "lawkeeper-demands"]
			.map(slug => [d._parseLorePickMin(lore(slug)), d._parseLorePickMax(lore(slug))]);
		expect(counts).toEqual([[3, 3], [2, 2], [1, 1], [3, 3]]);
	});
});
