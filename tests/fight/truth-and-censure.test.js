// The Judge's one-shot records on a next roll against someone (the user's rulings, 2026-10-18):
//  - TRUTH OR CONSEQUENCES: "If the answer is 'Yes,' you have advantage on your next roll against them. When
//    you lie or otherwise deceive someone through words, you have disadvantage on your next roll against
//    them." Two buttons on the posted card record whom, on the Judge; the Judge's next roll aimed at them
//    folds the mode in, named, and spends it. A Yes and a lie at the same person cancel.
//  - CENSURE, enraged: "the next roll against them has advantage". ANYONE's next roll: the tick on the posted
//    card records whom on the Judge, and any character's next roll aimed at them folds it in and spends it,
//    through the GM's client when the roller cannot write the Judge.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { giveAdvantageCardHtml } from "../../module/actors/character/give-advantage.js";
import { wireTruthOrConsequences, truthRecorded, TRUTH_CARD_FLAG } from "../../module/actors/character/give-advantage-flow.js";
import { wireCensureEnraged, enragedTicked, CENSURE_ENRAGED_CARD_FLAG } from "../../module/actors/character/censure-enraged.js";
import {
	HERO_MOVES, TRUTH_FLAG, CENSURE_ENRAGED_FLAG, CENSURE_ENRAGED_QUERY, recordTruth, truthAgainst, spendTruth,
	recordCensureEnraged, censureEnragedAgainst, spendCensureEnraged, handleCensureEnragedQuery, foeAdvantage,
} from "../../module/fight/hero-moves.js";
import { CENSURE } from "../../module/actors/character/condemn.js";
import { StonetopCharacter } from "../../module/actors/character/StonetopCharacter.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { readRepo } from "../fakes/css.js";

/** A character holding the moves named, flags read and written as Foundry's are. */
function pc({ id = "judge", name = "Hafgan", moves = [HERO_MOVES.TRUTH], owner = true } = {}) {
	const flags = { [SYSTEM_ID]: {} };
	return {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: owner,
		items: moves.map(move => ({ type: "move", name: move, flags: {} })),
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	};
}

// Unlinked tokens: each is keyed by its token (fight/hero-moves.js#foeKey).
const REEVE = { uuid: "Scene.s.Token.reeve", name: "Reeve Gunnar" };
const CULTIST = { uuid: "Scene.s.Token.cult", name: "Cultist" };

function card({ id = "msg1", flags = {}, move = null } = {}) {
	const data = { [SYSTEM_ID]: { ...flags, ...(move ? { move } : {}) } };
	return {
		id, flags: data,
		getFlag: (scope, key) => data[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (data[scope] ??= {})[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete data[scope]?.[key]; }),
	};
}

/** The aimed-roll fold, as both roll paths ask it, for `actor`. */
const fold = (actor, targets, options = {}) => StonetopCharacter.prototype._foldAimedModes.call({ _actor: actor }, { ...options }, targets);

describe("Truth or Consequences: the posted card", () => {
	let saved;
	beforeEach(() => {
		saved = { ChatMessage: globalThis.ChatMessage, ui: globalThis.ui };
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	});
	afterEach(() => { Object.assign(globalThis, saved); });

	const rendered = (judge = pc()) => {
		const root = new Window().document.createElement("div");
		root.innerHTML = `<div class="stonetop-chat-move">${giveAdvantageCardHtml(judge, HERO_MOVES.TRUTH)}</div>`;
		return { root, button: mode => root.querySelector(`.stonetop-truth[data-truth="${mode}"]`) };
	};

	it("carries both buttons for a Judge holding it learned, none otherwise, and is wired from the chat hook", () => {
		const { button } = rendered();
		expect(button("adv")?.textContent).toContain("They said Yes");
		expect(button("dis")?.textContent).toContain("I deceived them");
		expect(giveAdvantageCardHtml(pc({ moves: [] }), HERO_MOVES.TRUTH)).toBe("");
		const homebrew = { type: "move", name: HERO_MOVES.TRUTH, flags: { [SYSTEM_ID]: { custom: true } } };
		expect(giveAdvantageCardHtml(pc(), HERO_MOVES.TRUTH, homebrew)).toBe("");
		expect(readRepo("stonetop.js")).toContain("wireTruthOrConsequences(message, html);");
	});

	it("\"They said Yes\" records the targeted person on the Judge, and the card says so", async () => {
		const judge = pc();
		const { root, button } = rendered(judge);
		const message = card();
		wireTruthOrConsequences(message, root, { giver: judge, usable: true, targets: () => [{ name: "Reeve Gunnar", document: { uuid: REEVE.uuid } }], engaged: () => [] });
		button("adv").click();
		await vi.waitFor(() => expect(message.getFlag(SYSTEM_ID, TRUTH_CARD_FLAG)).toEqual([{ mode: "adv", foe: "Reeve Gunnar" }]));
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([{ key: REEVE.uuid, name: "Reeve Gunnar", mode: "adv" }]);

		// Drawn again, the readout is there and the buttons stay for another press.
		const again = rendered(judge);
		wireTruthOrConsequences(message, again.root, { giver: judge, usable: true });
		expect(again.root.textContent).toContain("Reeve Gunnar is lying or hiding something");
		expect(again.button("adv")).not.toBeNull();
	});

	it("is not offered to someone who cannot write the card and the Judge", () => {
		const { root, button } = rendered();
		wireTruthOrConsequences(card(), root, { giver: pc(), usable: false });
		expect(button("adv")).toBeNull();
		expect(button("dis")).toBeNull();
	});

	it("asks among the scene's people with nobody targeted or fought, with a row for someone not on the map", async () => {
		const judge = pc();
		const pick = vi.fn(async () => CULTIST.uuid);
		expect(await truthRecorded(card(), judge, "dis", { targets: () => [], engaged: () => [], onScene: () => [CULTIST], pick, resolve: () => null })).toBe(true);
		expect(pick).toHaveBeenCalledTimes(1);
		expect(pick.mock.calls[0][0].options.map(o => o.name)).toEqual(["Cultist", "Someone not on the map (type their name)"]);
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([{ key: CULTIST.uuid, name: "Cultist", mode: "dis" }]);
	});

	// Mostly said across a table, to someone with no token: the name is typed and kept under it.
	it("takes a typed name for someone not on the map, and records nothing when no name is given", async () => {
		const judge = pc();
		const message = card();
		const askName = vi.fn(async () => "  Old Ivar ");
		expect(await truthRecorded(message, judge, "adv", { targets: () => [], engaged: () => [], onScene: () => [], askName })).toBe(true);
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([{ key: "named:old ivar", name: "Old Ivar", mode: "adv" }]);
		expect(message.getFlag(SYSTEM_ID, TRUTH_CARD_FLAG)).toEqual([{ mode: "adv", foe: "Old Ivar", named: true }]);
		// The "someone else" row leads to the same question.
		const other = pc();
		const pick = vi.fn(async () => "__someone-else__");
		expect(await truthRecorded(card(), other, "dis", { targets: () => [], engaged: () => [], onScene: () => [CULTIST], pick, askName, resolve: () => null })).toBe(true);
		expect(other.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([{ key: "named:old ivar", name: "Old Ivar", mode: "dis" }]);

		const lonely = pc();
		expect(await truthRecorded(card(), lonely, "adv", { targets: () => [], engaged: () => [], onScene: () => [], askName: async () => "" })).toBe(false);
		expect(lonely.setFlag).not.toHaveBeenCalled();
	});

	it("a second press at the same person replaces that person's entry of that mode, and keeps the other mode", async () => {
		const judge = pc();
		await recordTruth(judge, [REEVE], "adv");
		await recordTruth(judge, [REEVE], "dis");
		await recordTruth(judge, [{ ...REEVE, name: "Gunnar" }], "adv");
		const held = judge.flags[SYSTEM_ID][TRUTH_FLAG];
		expect(held).toHaveLength(2);
		expect(held).toContainEqual({ key: REEVE.uuid, name: "Gunnar", mode: "adv" });
		expect(held).toContainEqual({ key: REEVE.uuid, name: "Reeve Gunnar", mode: "dis" });
	});
});

describe("Truth or Consequences: the Judge's next roll against them", () => {
	it("a Yes gives advantage on the next aimed roll, named, then is spent", async () => {
		const judge = pc();
		await recordTruth(judge, [REEVE], "adv");
		const first = fold(judge, [REEVE]);
		expect(first.options.rollMode).toBe("adv");
		expect(first.options.conditionNotes).toContain("Truth or Consequences (they said Yes)");
		await first.spend();
		const second = fold(judge, [REEVE]);
		expect(second.options.rollMode).toBeUndefined();
		expect(second.options.conditionNotes ?? []).toEqual([]);
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([]);
	});

	it("a lie gives disadvantage on the next aimed roll, named, then is spent", async () => {
		const judge = pc();
		await recordTruth(judge, [REEVE], "dis");
		const first = fold(judge, [REEVE]);
		expect(first.options.rollMode).toBe("dis");
		expect(first.options.conditionNotes).toContain("Truth or Consequences (you deceived them)");
		await first.spend();
		expect(truthAgainst(judge, [REEVE], "dis")).toBeNull();
	});

	it("a Yes and a lie at the same person cancel, and both are spent by that one roll", async () => {
		const judge = pc();
		await recordTruth(judge, [REEVE], "adv");
		await recordTruth(judge, [REEVE], "dis");
		const first = fold(judge, [REEVE]);
		expect(first.options.rollMode).toBe("normal");
		expect(first.options.conditionNotes).toEqual(expect.arrayContaining([
			"Truth or Consequences (they said Yes)", "Truth or Consequences (you deceived them)",
		]));
		await first.spend();
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([]);
	});

	it("rides an attack's advantage (foeAdvantage), never a roll at someone else", async () => {
		const judge = pc();
		await recordTruth(judge, [REEVE], "adv");
		expect(foeAdvantage(judge, [REEVE])).toBe("Truth or Consequences (they said Yes)");
		expect(truthAgainst(judge, [CULTIST], "adv")).toBeNull();
		expect(truthAgainst(judge, [REEVE, CULTIST], "adv")).toBeNull();
		expect(await spendTruth(judge, [CULTIST])).toBe(false);
		// An attack folds `grudged`: the advantage was foeAdvantage's, but a lie's disadvantage is still folded here.
		await recordTruth(judge, [REEVE], "dis");
		const attack = StonetopCharacter.prototype._foldAimedModes.call({ _actor: judge }, {}, [REEVE], { grudged: true });
		expect(attack.options.rollMode).toBe("dis");
		await attack.spend();
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([]);
	});

	it("does nothing without the move learned: no record, and no fold of an old one", async () => {
		const judge = pc({ moves: [] });
		expect(await recordTruth(judge, [REEVE], "adv")).toBe(false);
		judge.flags[SYSTEM_ID][TRUTH_FLAG] = [{ key: REEVE.uuid, name: "Reeve Gunnar", mode: "adv" }];
		expect(truthAgainst(judge, [REEVE], "adv")).toBeNull();
		expect(fold(judge, [REEVE]).options.rollMode).toBeUndefined();
	});
});

describe("Censure: enraged", () => {
	let saved;
	beforeEach(() => {
		saved = { game: globalThis.game, ui: globalThis.ui };
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	});
	afterEach(() => { Object.assign(globalThis, saved); });

	const judgeOf = (options = {}) => pc({ moves: [CENSURE], ...options });
	// The world, over the test setup's own game (which carries the English table the card's words come from).
	const setGame = extra => { globalThis.game = { ...saved.game, ...extra }; };
	const enragedHeld = judge => judge.flags[SYSTEM_ID][CENSURE_ENRAGED_FLAG] ?? [];

	it("another PC's next roll aimed at them has advantage, named for the Judge, once", async () => {
		const judge = judgeOf();
		const bran = pc({ id: "bran", name: "Bran", moves: [] });
		setGame({ actors: [judge, bran], users: { activeGM: null }, user: { id: "u1" } });
		await recordCensureEnraged(judge, [CULTIST], "msg1");
		const first = fold(bran, [CULTIST]);
		expect(first.options.rollMode).toBe("adv");
		expect(first.options.conditionNotes).toContain("Censure: enraged (Hafgan)");
		await first.spend();
		expect(enragedHeld(judge)).toEqual([]);
		expect(fold(bran, [CULTIST]).options.rollMode).toBeUndefined();
	});

	it("names it on an attack (foeAdvantage), and asks it of every target", async () => {
		const judge = judgeOf();
		const bran = pc({ id: "bran", name: "Bran", moves: [] });
		setGame({ actors: [judge, bran] });
		await recordCensureEnraged(judge, [CULTIST], "msg1");
		expect(foeAdvantage(bran, [CULTIST])).toBe("Censure: enraged (Hafgan)");
		expect(censureEnragedAgainst(bran, [CULTIST, REEVE])).toBeNull();
	});

	it("is spent through the GM's client when the roller cannot write the Judge, and skipped with a warning with no GM", async () => {
		const judge = judgeOf({ owner: false });
		const bran = pc({ id: "bran", name: "Bran", moves: [] });
		judge.flags[SYSTEM_ID][CENSURE_ENRAGED_FLAG] = [{ key: CULTIST.uuid, name: "Cultist", message: "msg1" }];
		const gm = { query: vi.fn(async () => true) };
		expect(await spendCensureEnraged(bran, [CULTIST], { actors: [judge, bran], gm, userId: "u1" })).toBe(true);
		expect(gm.query).toHaveBeenCalledWith(CENSURE_ENRAGED_QUERY, { judgeUuid: judge.uuid, rollerUuid: bran.uuid, keys: [CULTIST.uuid], userId: "u1" }, expect.anything());
		expect(judge.setFlag).not.toHaveBeenCalled();

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(await spendCensureEnraged(bran, [CULTIST], { actors: [judge, bran], gm: null, userId: "u1" })).toBe(false);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("the GM spends it only for whoever owns the character who rolled", async () => {
		const judge = judgeOf();
		judge.flags[SYSTEM_ID][CENSURE_ENRAGED_FLAG] = [{ key: CULTIST.uuid, name: "Cultist", message: "msg1" }];
		const owner = { id: "u1", isGM: false };
		const stranger = { id: "u2", isGM: false };
		const users = { get: id => ({ u1: owner, u2: stranger })[id], activeGM: { id: "gm" } };
		setGame({ user: { id: "gm", isGM: true }, users });
		const bran = { ...pc({ id: "bran", name: "Bran", moves: [] }), testUserPermission: user => user === owner };
		const resolve = uuid => ({ [judge.uuid]: judge, [bran.uuid]: bran })[uuid] ?? null;
		const data = { judgeUuid: judge.uuid, rollerUuid: bran.uuid, keys: [CULTIST.uuid] };
		expect(await handleCensureEnragedQuery({ ...data, userId: "u2" }, {}, { users, resolve })).toBe(false);
		expect(enragedHeld(judge)).toHaveLength(1);
		expect(await handleCensureEnragedQuery({ ...data, userId: "u1" }, {}, { users, resolve })).toBe(true);
		expect(enragedHeld(judge)).toEqual([]);
		expect(readRepo("stonetop.js")).toContain("CONFIG.queries[CENSURE_ENRAGED_QUERY]");
	});

	it("does nothing once the Judge no longer has Censure learned", async () => {
		const judge = judgeOf();
		const bran = pc({ id: "bran", name: "Bran", moves: [] });
		setGame({ actors: [judge, bran] });
		await recordCensureEnraged(judge, [CULTIST], "msg1");
		judge.items = [];
		expect(censureEnragedAgainst(bran, [CULTIST])).toBeNull();
		expect(await recordCensureEnraged(judge, [REEVE], "msg2")).toBe(false);
	});

	describe("the tick on the posted card", () => {
		const ENRAGED = "They are enraged, and lash out predictably (the next roll against them has advantage)";
		const rendered = () => {
			const root = new Window().document.createElement("div");
			root.innerHTML = `<div class="stonetop-chat-move"><h3 class="stonetop-chat-move-name">Censure</h3><ul class="stonetop-picklist">`
				+ `<li class="stonetop-picklist-item"><label><input type="checkbox" class="stonetop-check stonetop-picklist-check" data-index="0"><span>They are ashamed, and act accordingly</span></label></li>`
				+ `<li class="stonetop-picklist-item"><label><input type="checkbox" class="stonetop-check stonetop-picklist-check" data-index="3"><span>${ENRAGED}</span></label></li>`
				+ `</ul></div>`;
			return { root, box: index => root.querySelector(`.stonetop-picklist-check[data-index="${index}"]`) };
		};
		const tick = (box, on) => { box.checked = on; box.dispatchEvent(new box.ownerDocument.defaultView.Event("change")); };

		it("ticked, asks who was Censured and records them on the Judge; unticked, lets them go", async () => {
			const judge = judgeOf();
			const message = card();
			const who = vi.fn(async () => [CULTIST]);
			const { root, box } = rendered();
			wireCensureEnraged(message, root, { judge, usable: true, who });
			tick(box(0), true);
			expect(who).not.toHaveBeenCalled();
			tick(box(3), true);
			await vi.waitFor(() => expect(message.getFlag(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG)).toEqual({ names: ["Cultist"] }));
			expect(enragedHeld(judge)).toEqual([{ key: CULTIST.uuid, name: "Cultist", message: "msg1" }]);

			// Drawn again, the option says who is enraged.
			const again = rendered();
			wireCensureEnraged(message, again.root, { judge, usable: true, who });
			expect(again.root.textContent).toContain("the next roll against Cultist has advantage");

			tick(box(3), false);
			await vi.waitFor(() => expect(message.getFlag(SYSTEM_ID, CENSURE_ENRAGED_CARD_FLAG)).toBeUndefined());
			expect(enragedHeld(judge)).toEqual([]);
		});

		it("records nothing for a Judge without Censure learned, or on another move's card", async () => {
			const judge = judgeOf({ moves: [] });
			const who = vi.fn(async () => [CULTIST]);
			expect(await enragedTicked(card(), judge, { who })).toBe(false);
			expect(who).not.toHaveBeenCalled();

			const other = rendered();
			other.root.querySelector(".stonetop-chat-move-name").textContent = "Armistice";
			const learned = judgeOf();
			wireCensureEnraged(card(), other.root, { judge: learned, usable: true, who });
			tick(other.box(3), true);
			await Promise.resolve();
			expect(who).not.toHaveBeenCalled();
		});
	});
});

// A roll aimed at nobody (or at someone only named) can't be matched to a record, so the roll window offers
// each one as an UNTICKED line the player takes when the roll is against them (StonetopCharacter#_recordedFoeOffers).
describe("the roll window's lines for records no target can match", () => {
	let saved;
	beforeEach(() => { saved = { game: globalThis.game }; });
	afterEach(() => { Object.assign(globalThis, saved); });

	const setGame = extra => { globalThis.game = { ...saved.game, ...extra }; };
	const offersOf = (actor, moveName = "Persuade") => StonetopCharacter.prototype._recordedFoeOffers.call({ _actor: actor }, moveName);

	it("offers the Judge's own Truth records unticked, the lie as disadvantage, and spends only the one taken", async () => {
		const judge = pc();
		setGame({ actors: [judge], user: { targets: new Set() } });
		await recordTruth(judge, [REEVE], "adv");
		await recordTruth(judge, [{ name: "Old Ivar", named: true }], "dis");
		const offers = offersOf(judge);
		expect(offers.map(o => o.applied)).toEqual([false, false]);
		const [yes, lie] = offers;
		expect(yes.label).toContain("vs. Reeve Gunnar: Truth or Consequences advantage");
		expect(yes.effect).toBeUndefined();
		expect(lie.label).toContain("vs. Old Ivar: Truth or Consequences DISADVANTAGE");
		expect(lie.effect).toBe("disadvantage");
		expect(lie.source).toBe("Truth or Consequences (vs. Old Ivar)");
		await lie.spend();
		expect(judge.flags[SYSTEM_ID][TRUTH_FLAG]).toEqual([{ key: REEVE.uuid, name: "Reeve Gunnar", mode: "adv" }]);
	});

	it("drops a record on the map once something is targeted (the targeted roll reads it), but keeps a named one", async () => {
		const judge = pc();
		setGame({ actors: [judge], user: { targets: new Set([{}]) } });
		await recordTruth(judge, [REEVE], "adv");
		await recordTruth(judge, [{ name: "Old Ivar", named: true }], "adv");
		expect(offersOf(judge).map(o => o.label)).toEqual([expect.stringContaining("vs. Old Ivar")]);
	});

	it("offers every Judge's enraged people on ANYONE's untargeted roll, and spends it on the Judge", async () => {
		const judge = pc({ moves: [CENSURE] });
		const bran = pc({ id: "bran", name: "Bran", moves: [] });
		setGame({ actors: [judge, bran], user: { id: "u1", targets: new Set() }, users: { activeGM: null } });
		await recordCensureEnraged(judge, [CULTIST], "msg1");
		const [line, ...rest] = offersOf(bran, "Defy Danger");
		expect(rest).toEqual([]);
		expect(line.applied).toBe(false);
		expect(line.label).toContain("vs. Cultist: advantage, enraged by Hafgan's Censure");
		expect(line.source).toBe("Censure (vs. Cultist)");
		await line.spend();
		expect(judge.flags[SYSTEM_ID][CENSURE_ENRAGED_FLAG]).toEqual([]);
		// Targeted, the roll reads the record itself instead.
		await recordCensureEnraged(judge, [CULTIST], "msg2");
		setGame({ actors: [judge, bran], user: { targets: new Set([{}]) } });
		expect(offersOf(bran)).toEqual([]);
	});

	it("leaves Interfere and Persuade (vs. PCs) alone, which ask whom they are aimed at after the window", async () => {
		const judge = pc();
		setGame({ actors: [judge], user: { targets: new Set() } });
		await recordTruth(judge, [{ name: "Old Ivar", named: true }], "adv");
		expect(offersOf(judge, "Interfere")).toEqual([]);
		expect(offersOf(judge, "Persuade (vs. PCs)")).toEqual([]);
	});
});
