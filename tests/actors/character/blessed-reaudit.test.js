/**
 * The Blessed re-audit (2026-10-18), items 1-7: switched-off moves do nothing, Nature's Wrath and
 * Potent Workings are wired, a charm is used up by its roll, and Trackless Step counts its marks.
 *
 * Book I, The Blessed (printed pp.104-108). Each block quotes the clause it holds the code to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { renderRoster } from "../../fakes/hbs.js";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import {
	MARK_KINDS, BARKSKIN, TRACKLESS_STEP, AMULETS_TALISMANS, WARDS_BINDINGS,
	NATURES_WRATH, DANUS_GRASP, CHARM_POTENCY,
	availableKinds, canMarkBlessed, groupMarks, readMarks, addMark,
	charmSpentByRoll, charmPotencyText, tracklessTally,
} from "../../../module/actors/character/blessed-marks.js";
import { ritesBoonCapacity, openRitesOfTheLand } from "../../../module/actors/character/rites-of-the-land.js";
import { BlessedMarksDialog } from "../../../module/actors/character/dialogs/BlessedMarksDialog.js";

const picked = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock("../../../module/dialogs/content-picker.js", async (importOriginal) => ({
	...(await importOriginal()),
	pickContentOption: vi.fn(async (spec) => { picked.calls.push(spec); return picked.answer; }),
}));
const rites = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../../module/actors/character/rites-of-the-land.js", async (importOriginal) => {
	const real = await importOriginal();
	// The real one still runs (the module's own test below needs it); the sheet's call is spied.
	return { ...real, openRitesOfTheLand: (...args) => { rites.open(...args); return real.openRitesOfTheLand(...args); } };
});

const {
	createStonetopCharacterSheetClass, GUIDED_CHARACTER_MOVES,
	_stockSpendOffered, _readPotentWorkings, _potentWorkingsHtml,
} = await import("../../../module/actors/character/StonetopCharacterSheet.js");

const SCOPE = "stonetop-pwd";
const move = (name, { off = false, id = `move-${name}` } = {}) =>
	({ type: "move", name, id, flags: off ? { [SCOPE]: { learned: false } } : {} });
const actorWith = (...items) => ({ items });

// -- 2. New marks only for LEARNED moves --------------------------------------------

describe("laying a mark needs the move learned", () => {
	it("offers no new mark for a move kept switched off", () => {
		const blessed = actorWith(move(BARKSKIN, { off: true }), move(TRACKLESS_STEP));
		expect(availableKinds(blessed).map(k => k.key)).toEqual(["trackless"]);
	});

	// The glyph, and the roster's survival through a playbook change, are OWNED questions: a
	// Blessed who switched Barkskin off still has marks to look after.
	it("still lights the glyph for an owned, switched-off marking move", () => {
		expect(canMarkBlessed(actorWith(move(BARKSKIN, { off: true })))).toBe(true);
		expect(availableKinds(actorWith(move(BARKSKIN, { off: true })))).toEqual([]);
	});

	it("keeps the rows a switched-off move laid, with no add bar to lay more", () => {
		const blessed = actorWith(move(BARKSKIN, { off: true }));
		const canLay = new Set(availableKinds(blessed).map(k => k.key));
		const groups = groupMarks([{ id: "a", kind: "barkskin", name: "Aeronwen" }], { include: canLay });
		expect(groups.map(g => g.def.key)).toEqual(["barkskin"]);
		expect(groups[0].rows.map(r => r.name)).toEqual(["Aeronwen"]);
		expect(canLay.has("barkskin")).toBe(false);
	});

	// "the sheet's roster opener follows": using a switched-off marking move opens nothing.
	it("opens the roster from a move's use only while that move is learned", async () => {
		for (const [name, opens] of [[BARKSKIN, true], [TRACKLESS_STEP, false]]) {
			const { sheet } = makeSheet([move(BARKSKIN), move(TRACKLESS_STEP, { off: true })]);
			await sheet._onDescriptionMoveUsed({ type: "move", name });
			expect(sheet._openBlessedMarks.mock.calls.length > 0, name).toBe(opens);
		}
	});
});

// -- 1. Rites of the Land switched off ----------------------------------------------

describe("Rites of the Land, switched off", () => {
	beforeEach(() => rites.open.mockClear());

	it("reads a Boon track of 0 as 0, not the printed 4", () => {
		expect(ritesBoonCapacity({ ritesBoonMax: () => 0 })).toBe(0);
		expect(ritesBoonCapacity({ ritesBoonMax: () => 4 })).toBe(4);
		expect(ritesBoonCapacity({ ritesBoonMax: () => "3" })).toBe(3);
		// A stand-in with no reader at all keeps the book's 4.
		expect(ritesBoonCapacity({})).toBe(4);
	});

	it("opens no walkthrough for a character with no Boon track", () => {
		const Dialog = vi.fn();
		globalThis.Dialog = Dialog;
		try {
			openRitesOfTheLand({ character: { ritesBoonMax: () => 0, ritesBoonHeld: () => 2 }, steading: null });
			expect(Dialog).not.toHaveBeenCalled();
		} finally {
			delete globalThis.Dialog;
		}
	});

	it("is not opened from the sheet for a Rites kept switched off, and is for a learned one", () => {
		const off = makeSheet([move("Rites of the Land", { off: true })]).sheet;
		off._openRitesOfTheLand();
		expect(rites.open).not.toHaveBeenCalled();
		const on = makeSheet([move("Rites of the Land")]).sheet;
		globalThis.Dialog = vi.fn(function () { this.render = vi.fn(); });
		try {
			on._openRitesOfTheLand();
		} finally {
			delete globalThis.Dialog;
		}
		expect(rites.open).toHaveBeenCalledTimes(1);
	});
});

// -- 3. The chat Spend button -------------------------------------------------------

describe("the chat Spend Stock button", () => {
	it("is offered only for a move this character owns and has learned", () => {
		const learned = move("Call the Spirits");
		const off = move("Healer's Arts", { off: true });
		const actor = new FakeActorBuilder().withItems([learned, off]).build();
		expect(_stockSpendOffered(actor, learned)).toBe(true);
		expect(_stockSpendOffered(actor, off)).toBe(false);
		// A compendium document (an un-owned playbook row) and no item at all.
		expect(_stockSpendOffered(actor, move("Veil", { id: "compendium-veil" }))).toBe(false);
		expect(_stockSpendOffered(actor, null)).toBe(false);
	});

	it("leaves the button off the card of a switched-off Stock move", () => {
		const { sheet, actor } = makeSheet([move("Call the Spirits"), move("Healer's Arts", { off: true })]);
		const text = "<p>When you call on the spirits, spend 1 Stock.</p>";
		expect(sheet._stockSpendButtonHtml(text, actor.items[0])).toContain("stonetop-spend-stock");
		expect(sheet._stockSpendButtonHtml(text, actor.items[1])).toBe("");
		expect(sheet._stockSpendButtonHtml(text, null)).toBe("");
	});

	// The click asks again (stonetop.js#_chatWireSpendStock): the move may be switched off after the card went up.
	it("names its move on the button so the click can check it is still learned", () => {
		const { sheet, actor } = makeSheet([move("Call the Spirits")]);
		const text = "<p>When you call on the spirits, spend 1 Stock.</p>";
		expect(sheet._stockSpendButtonHtml(text, actor.items[0])).toContain(`data-move-id="${actor.items[0].id}"`);
	});
});

// -- 4. Nature's Wrath --------------------------------------------------------------

describe("Nature's Wrath on Danu's Grasp's window", () => {
	const guide = GUIDED_CHARACTER_MOVES[DANUS_GRASP];

	it("says a mortal is subdued or killed, and other things are bound in stone, when learned", () => {
		const note = guide.noteFor(actorWith(move(NATURES_WRATH)));
		expect(note).toMatch(/A mortal brought to 0 HP is subdued or killed \(your choice\)/);
		expect(note).toMatch(/anything else is pulled into the earth and bound in rune-etched stone/);
		expect(note).toMatch(/area tag/);
	});

	it("keeps the printed line without it, or with it switched off", () => {
		expect(guide.noteFor(actorWith())).toBeNull();
		expect(guide.noteFor(actorWith(move(NATURES_WRATH, { off: true })))).toBeNull();
		expect(guide.note).toMatch(/bound in rune-etched stone/);
	});
});

// -- 5. Potent Workings -------------------------------------------------------------

describe("Potent Workings in the Amulets crafting window", () => {
	const form = (choice, harm = "") => [{
		querySelector: sel => {
			if (sel === '[name="potentWorkings"]:checked') return { value: choice };
			if (sel === '[name="potentHarm"]') return { value: harm };
			return null;
		},
	}];

	it("reads neither, an extra harm, or retains", () => {
		expect(_readPotentWorkings(form(""))).toBeNull();
		expect(_readPotentWorkings(form("harm", " poison "))).toEqual({ extraHarm: "poison", retains: false });
		expect(_readPotentWorkings(form("retains"))).toEqual({ extraHarm: "", retains: true });
		// An extra harm with none named would buy nothing.
		expect(_readPotentWorkings(form("harm", "  "))).toEqual({ invalid: true });
	});

	it("offers both book options, with neither as the default", () => {
		const html = _potentWorkingsHtml({ amount: 2, label: "Stock", affordable: true });
		for (const { label } of CHARM_POTENCY) expect(html).toContain(label);
		expect(html).toMatch(/value="" checked/);
		expect(html).not.toContain("disabled");
	});

	it("shows them disabled, with why, when the purse cannot cover the extra Stock", () => {
		const html = _potentWorkingsHtml({ amount: 2, label: "Stock", affordable: false });
		expect(html).toMatch(/value="harm" disabled/);
		expect(html).toContain("Not enough Stock for the additional 2.");
	});

	it("prices the crafting at 1 more Stock through the same payer, only when learned", () => {
		const SHEET = read("module/actors/character/StonetopCharacterSheet.js");
		// The offer rides Amulets & Talismans' guide (DEFERRED_SPEND_EXTRAS), and the window asks its move learned.
		expect(SHEET).toMatch(/\[AMULETS_TALISMANS, \{\s+ownsLearned: POTENT_WORKINGS,\s+amount:\s+1,/);
		expect(SHEET).toContain("ownsLearnedMoveNamed(this.actor, extra.ownsLearned)");
		expect(SHEET).toContain("const price = potency ? { ...spend, amount: spend.amount + extra.amount } : spend;");
		expect(SHEET).toContain("const paid = await this._spendStockCost(price, html, name);");
	});

	it("stores the choice on charm rows only", () => {
		const { entries } = addMark([], { kind: "charm", name: "Olwin", extraHarm: " fire ", retains: false });
		expect(entries[0]).toMatchObject({ kind: "charm", extraHarm: "fire", retains: false });
		const [ward] = readMarks([{ kind: "ward", name: "the gate", extraHarm: "fire", retains: true }]);
		expect(ward).toMatchObject({ extraHarm: null, retains: null });
		expect(readMarks([{ kind: "charm", name: "Olwin", retains: true }])[0].retains).toBe(true);
	});

	it("words the choice for the row", () => {
		expect(charmPotencyText({ extraHarm: "fire" })).toBe("also wards against fire");
		expect(charmPotencyText({ extraHarm: "", retains: true })).toBe("keeps its potency on a 10+");
		expect(charmPotencyText({ extraHarm: "", retains: false })).toBe("");
	});

	it("lays the pending choice on the next charm, and only that one", async () => {
		const laid = [];
		const character = { blessedMarks: [], layBlessedMark: vi.fn(async e => { laid.push(e); return e; }) };
		const dialog = new BlessedMarksDialog({ id: "a1", items: [] }, character, { pendingCharm: { extraHarm: "", retains: true } });
		dialog._clearAddField = vi.fn();
		dialog.renderIfOpen = vi.fn();
		expect(dialog._activeTab).toBe("charm");
		await dialog._lay({ kind: "barkskin", name: "Aeronwen" });
		await dialog._lay({ kind: "charm", name: "Olwin" });
		await dialog._lay({ kind: "charm", name: "Brennan" });
		expect(laid[0]).not.toHaveProperty("retains");
		expect(laid[1]).toMatchObject({ name: "Olwin", retains: true, extraHarm: "" });
		expect(laid[2]).not.toHaveProperty("retains");
	});

	it("shows the choice on the roster row, and the pending one in the charm panel", () => {
		const html = renderRoster(read("templates/dialogs/blessed-marks.hbs"), {
			editable: true, hasGroups: true, railed: false, activeTab: "charm",
			listId: "l", suggestions: [], tabs: [],
			groups: [{
				key: "charm", label: "Amulet or talisman", rule: "…", icon: "fa-gem", canAdd: true,
				pending: "Potent Workings, paid: the next charm laid here keeps its potency on a 10+.",
				hasRows: true,
				rows: [{ id: "c1", name: "Olwin", note: "", img: "", imgStyle: "", linked: false, pips: null,
					signs: null, potency: "Potent Workings: also wards against fire" }],
			}],
		});
		expect(html).toContain('class="stonetop-mark-potency">Potent Workings: also wards against fire<');
		expect(html).toContain('class="stonetop-marks-pending">Potent Workings, paid');
	});
});

// -- 6. A charm is used up by its roll ----------------------------------------------

describe("Amulets & Talismans: a charm loses its potency after 1 use", () => {
	it("is spent on any roll, unless it retains its potency and the roll was a 10+", () => {
		const plain = { retains: false };
		const potent = { retains: true };
		for (const tier of ["success", "critical", "partial", "failure"]) expect(charmSpentByRoll(plain, tier), tier).toBe(true);
		expect(charmSpentByRoll(potent, "success")).toBe(false);
		expect(charmSpentByRoll(potent, "critical")).toBe(false);
		expect(charmSpentByRoll(potent, "partial")).toBe(true);
		expect(charmSpentByRoll(potent, "failure")).toBe(true);
	});

	let savedMessages;
	beforeEach(() => { savedMessages = globalThis.game.messages; picked.calls = []; picked.answer = null; });
	afterEach(() => { globalThis.game.messages = savedMessages; });

	const rollCard = (id, total, actorId = "actor-1") => ({
		id, speaker: { actor: actorId }, rolls: [{ total }],
		getFlag: (scope, key) => (key === "move" ? AMULETS_TALISMANS : null),
	});

	function charmSheet(marks, cards, seen = []) {
		const made = makeSheet([move(AMULETS_TALISMANS)]);
		made.actor.typedActor.blessedMarks = readMarks(marks);
		made.actor.typedActor.liftBlessedMark = vi.fn(async () => true);
		globalThis.game.messages = { contents: [...seen, ...cards] };
		return { ...made, seen: new Set(seen.map(m => m.id)) };
	}

	const CHARMS = [
		{ id: "c1", kind: "charm", name: "Olwin", note: "against fire" },
		{ id: "c2", kind: "charm", name: "Brennan", note: "against falling", retains: true },
		{ id: "b1", kind: "barkskin", name: "Aeronwen" },
	];

	it("asks which charm (never guessing among several), then lifts it", async () => {
		const { sheet, actor, seen } = charmSheet(CHARMS, [rollCard("new", 8)], [rollCard("old", 11)]);
		picked.answer = "c1";
		await sheet._onMoveRolled(actor.items[0], { phase: "roll", seen });
		expect(picked.calls).toHaveLength(1);
		expect(picked.calls[0].options.map(o => o.id)).toEqual(["c1", "c2", "none"]);
		expect(picked.calls[0].selected).toBe("none");
		expect(actor.typedActor.liftBlessedMark).toHaveBeenCalledWith("c1");
	});

	it("keeps a Potent Workings charm on a 10+", async () => {
		const { sheet, actor, seen } = charmSheet(CHARMS, [rollCard("new", 10)]);
		picked.answer = "c2";
		await sheet._onMoveRolled(actor.items[0], { phase: "roll", seen });
		expect(actor.typedActor.liftBlessedMark).not.toHaveBeenCalled();
	});

	it("offers the only charm as the default, and lifts nothing on 'none of these'", async () => {
		const { sheet, actor, seen } = charmSheet([CHARMS[0]], [rollCard("new", 7)]);
		picked.answer = "none";
		await sheet._onMoveRolled(actor.items[0], { phase: "roll", seen });
		expect(picked.calls[0].selected).toBe("c1");
		expect(actor.typedActor.liftBlessedMark).not.toHaveBeenCalled();
	});

	// The tier must come from THIS roll's card; an older one is never taken for it.
	it("opens the roster instead of guessing when this roll's card cannot be found", async () => {
		const { sheet, actor, seen } = charmSheet(CHARMS, [], [rollCard("old", 11)]);
		await sheet._onMoveRolled(actor.items[0], { phase: "roll", seen });
		expect(picked.calls).toHaveLength(0);
		expect(sheet._openBlessedMarks).toHaveBeenCalled();
		expect(actor.typedActor.liftBlessedMark).not.toHaveBeenCalled();
	});

	it("opens the roster with the Potent Workings choice at the crafting", async () => {
		const { sheet, actor } = charmSheet([], []);
		const potency = { extraHarm: "poison", retains: false };
		await sheet._onMoveRolled(actor.items[0], { phase: "spend", potency });
		expect(sheet._openBlessedMarks).toHaveBeenCalledWith({ pendingCharm: potency });
	});

	it("does nothing for a switched-off Amulets & Talismans", async () => {
		const { sheet, actor } = makeSheet([move(AMULETS_TALISMANS, { off: true })]);
		actor.typedActor.blessedMarks = readMarks(CHARMS);
		await sheet._onMoveRolled(actor.items[0], { phase: "spend" });
		await sheet._charmUsedByRoll({});
		expect(sheet._openBlessedMarks).not.toHaveBeenCalled();
		expect(picked.calls).toHaveLength(0);
	});

	it("leaves Wards & Bindings opening the roster at both moments", async () => {
		const { sheet, actor } = makeSheet([move(WARDS_BINDINGS)]);
		await sheet._onMoveRolled(actor.items[0], { phase: "spend" });
		await sheet._onMoveRolled(actor.items[0], { phase: "roll" });
		expect(sheet._openBlessedMarks).toHaveBeenCalledTimes(2);
	});
});

// -- 7. Trackless Step's head count -------------------------------------------------

describe("Trackless Step: 1 Stock can mark up to your level+INT", () => {
	const marks = n => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, kind: "trackless", name: `P${i}` }));

	it("counts the marks against level + INT, and flags past it", () => {
		expect(tracklessTally(marks(3), { level: 2, int: 1 })).toEqual({ count: 3, perStock: 3, over: false });
		expect(tracklessTally(marks(4), { level: 2, int: 1 })).toEqual({ count: 4, perStock: 3, over: true });
		// Only Trackless Step rows count.
		expect(tracklessTally([...marks(1), { kind: "barkskin", name: "B" }], { level: 1, int: 0 }).count).toBe(1);
		// A negative INT can take the cap to 0, and never below it.
		expect(tracklessTally([], { level: 1, int: -2 }).perStock).toBe(0);
	});

	it("says so on the Trackless Step panel, as a warning and never a block", () => {
		const actor = { id: "a1", items: [move(TRACKLESS_STEP)], system: { attributes: { level: { value: 1 } }, stats: { int: { value: 1 } } } };
		const dialog = new BlessedMarksDialog(actor, { blessedMarks: readMarks(marks(3)) }, {});
		dialog._suggestionRows = () => [];
		dialog._rosterPool = () => [];
		const data = dialog.getData();
		const panel = data.groups.find(g => g.key === "trackless");
		expect(panel.tally).toMatchObject({ count: 3, perStock: 2, over: true });
		expect(panel.tally.text).toMatch(/^3 marked; 1 Stock covers up to 2 \(level \+ INT\)\./);
		// Still layable: the cap flags, it does not take the add bar away.
		expect(panel.canAdd).toBe(true);
		expect(MARK_KINDS.find(k => k.key === "trackless").move).toBe(TRACKLESS_STEP);
	});
});

// -- 1. The MOVE_USE_EFFECTS sweep --------------------------------------------------

describe("every MOVE_USE_EFFECTS / MOVE_ROLL_EFFECTS handler that acts asks for the move learned", () => {
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");

	it.each([
		["_consecrateFlame() {", "ownsLearnedMoveNamed(this.actor, CONSECRATED_FLAME)"],
		["_openCondemnedIfJudge(moveName = null) {", "ownsLearnedMoveNamed(this.actor, moveName)"],
		["_censure(moveName = CENSURE) {", "ownsLearnedMoveNamed(this.actor, moveName)"],
		["_openRitesOfTheLand() {", "ownsLearnedMoveNamed(this.actor, RITES_OF_THE_LAND)"],
		["_openBlessedMarksIfBlessed(moveName = null", "ownsLearnedMoveNamed(this.actor, moveName)"],
		["_charmUsedByRoll({ seen = null } = {}) {", "ownsLearnedMoveNamed(this.actor, AMULETS_TALISMANS)"],
	])("%s", (decl, gate) => {
		const at = SHEET.indexOf(decl);
		expect(at, decl).toBeGreaterThan(-1);
		expect(SHEET.slice(at, at + 500)).toContain(gate);
	});

	it("names the move each row is for", () => {
		for (const row of [
			"[CONDEMN]:            sheet => sheet._openCondemnedIfJudge(CONDEMN)",
			"[CENSURE]:            sheet => sheet._censure(CENSURE)",
			"[CASTIGATE]:          sheet => sheet._censure(CASTIGATE)",
			"[BINDING_ARBITRATION]: sheet => sheet._openCondemnedIfJudge(BINDING_ARBITRATION)",
			"[BARKSKIN]:           sheet => sheet._openBlessedMarksIfBlessed(BARKSKIN)",
			"[TRACKLESS_STEP]:     sheet => sheet._openBlessedMarksIfBlessed(TRACKLESS_STEP)",
			"[SHARED_SOULS]:       sheet => sheet._openBlessedMarksIfBlessed(SHARED_SOULS)",
			"[WARDS_BINDINGS]:    sheet => sheet._openBlessedMarksIfBlessed(WARDS_BINDINGS)",
		]) expect(SHEET, row).toContain(row);
	});
});

// -- Fixture ------------------------------------------------------------------------

function makeSheet(items) {
	const actor = new FakeActorBuilder().withItems(items).build();
	actor.id = "actor-1";
	actor.isOwner = true;
	actor.typedActor = {
		blessedMarks: [],
		canMarkBlessed: canMarkBlessed(actor),
		getSteadingActor: () => null,
		ritesBoonMax: () => 4,
		ritesBoonHeld: () => 0,
	};
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const Sheet = createStonetopCharacterSheetClass(Base);
	const sheet = new Sheet();
	sheet._openBlessedMarks = vi.fn(async () => {});
	return { sheet, actor };
}

