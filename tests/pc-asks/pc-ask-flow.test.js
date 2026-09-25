import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../module/dialogs/RelationshipLinkDialog.js", () => ({ pickPersonOnMap: vi.fn() }));
vi.mock("../../module/utils/playbook-actors.js", () => ({ getPlayerCharacters: vi.fn() }));
vi.mock("../../module/actors/character/deaths-door-actor.js", () => ({ actorPastDeathKind: vi.fn(actor => actor?.dead ? "dead" : null) }));
vi.mock("../../module/utils/xp.js", () => ({ adjustXp: vi.fn(async () => ({ applied: 1, after: 5, max: 8 })) }));

import { SYSTEM_ID } from "../../module/system-id.js";
import { pickPersonOnMap } from "../../module/dialogs/RelationshipLinkDialog.js";
import { getPlayerCharacters } from "../../module/utils/playbook-actors.js";
import { adjustXp } from "../../module/utils/xp.js";
import { AID_MOVE, INTERFERE_MOVE, PERSUADE_PC_MOVE, PC_ANSWER_FLAG, PC_ASK_FLAG } from "../../module/pc-asks/pc-ask-rules.js";
import { aimPcAskRoll, answerPcAsk, beginAid, registerPcAskHooks, wirePcAskCard } from "../../module/pc-asks/pc-ask-flow.js";

// The documents half of Aid, Interfere and Persuade (vs. PCs): who the move is aimed at, the card
// that asks, and what an answer writes. The words are pc-ask-rules.test.js's.

const savedGame = globalThis.game;
const savedUi = globalThis.ui;
const savedHooks = globalThis.Hooks;

let actors;
let log;

function character(id, name, extra = {}) {
	return {
		id, name, type: "character", isOwner: false,
		typedActor: { holdAdvantage: vi.fn(async () => {}), holdDisadvantage: vi.fn(async () => {}) },
		...extra,
	};
}

function message(id, flags) {
	return { id, flags: { [SYSTEM_ID]: flags }, getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined) };
}

const askOf = move => ({ move, byId: "aeliana", byName: "Aeliana", targetId: "bram", targetName: "Bram" });
const asking = move => message("ask-1", { [PC_ASK_FLAG]: askOf(move) });
const move = name => ({ type: "move", name, system: { moveType: "basic", description: "<p>When you help someone who has not yet rolled, the GM picks 1:</p><ul><li>They can accomplish more than they could alone</li><li>They gain advantage on their roll</li></ul>" } });

function world({ isGM = false, ownsBram = false, samHere = false } = {}) {
	const sam = { id: "player-2", isGM: false, name: "Sam", active: samHere, character: { id: "bram" } };
	actors = {
		aeliana: character("aeliana", "Aeliana"),
		bram: character("bram", "Bram", { isOwner: isGM || ownsBram, testUserPermission: user => user === sam }),
		cora: character("cora", "Cora", { dead: true }),
	};
	log = [];
	getPlayerCharacters.mockReturnValue(Object.values(actors));
	globalThis.game = {
		...savedGame,
		user: { id: isGM ? "gm" : "player-2", isGM },
		users: [sam],
		actors: { get: id => actors[id] ?? null },
		messages: { contents: log, get: id => log.find(m => m.id === id) ?? null },
	};
	globalThis.ChatMessage = {
		create: vi.fn(async data => {
			const posted = message(`m${log.length + 1}`, data.flags?.[SYSTEM_ID] ?? {});
			Object.assign(posted, { content: data.content, speaker: data.speaker });
			log.push(posted);
			return posted;
		}),
		getSpeaker: ({ actor }) => ({ actor: actor?.id }),
	};
	globalThis.ui = { ...savedUi, chat: { updateMessage: vi.fn() }, notifications: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } };
}

beforeEach(() => {
	pickPersonOnMap.mockReset();
	adjustXp.mockClear();
	world();
});

afterEach(() => {
	globalThis.game = savedGame;
	globalThis.ui = savedUi;
	globalThis.Hooks = savedHooks;
	delete globalThis.ChatMessage;
});

describe("asking whom, before the dice", () => {
	it("asks nothing for any other move", async () => {
		expect(await aimPcAskRoll(actors.aeliana, move("Defy Danger"))).toBeNull();
		expect(pickPersonOnMap).not.toHaveBeenCalled();
	});

	it("offers the other living characters, not the roller and not the dead", async () => {
		pickPersonOnMap.mockResolvedValue("bram");
		await aimPcAskRoll(actors.aeliana, move(INTERFERE_MOVE));
		const offered = pickPersonOnMap.mock.calls[0][0].options;
		expect(offered.map(o => o.id)).toEqual(["bram"]);
		expect(offered[0].hint).toBe("Played by Sam");
	});

	it("stamps an Interfere with whom it foils, and leaves its list for them to answer in", async () => {
		pickPersonOnMap.mockResolvedValue("bram");
		const extra = await aimPcAskRoll(actors.aeliana, move(INTERFERE_MOVE));
		expect(extra.messageFlags[SYSTEM_ID][PC_ASK_FLAG]).toEqual(askOf(INTERFERE_MOVE));
		expect(extra.pickable).toBe(false);
		expect(extra.conditionNotes).toEqual(["Foiling Bram"]);
		expect(extra.tierActions).toBeUndefined();
	});

	it("gives a Persuade its answer rows", async () => {
		pickPersonOnMap.mockResolvedValue("bram");
		const extra = await aimPcAskRoll(actors.aeliana, move(PERSUADE_PC_MOVE));
		expect(Object.keys(extra.tierActions)).toEqual(["success", "partial"]);
		expect(extra.pickable).toBeUndefined();
	});

	it("rolls nothing when the question is closed", async () => {
		pickPersonOnMap.mockResolvedValue(null);
		expect(await aimPcAskRoll(actors.aeliana, move(INTERFERE_MOVE))).toBe("cancel");
	});

	// The rule is the book's move; a player's own move that only shares its name is their own.
	it("leaves a custom move that shares the name alone", async () => {
		const custom = { ...move(INTERFERE_MOVE), system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } };
		expect(await aimPcAskRoll(actors.aeliana, custom)).toBeNull();
		expect(pickPersonOnMap).not.toHaveBeenCalled();
	});

	// A lone character still has the move; the roll goes out as it always did.
	it("rolls plainly when there is nobody to aim at", async () => {
		getPlayerCharacters.mockReturnValue([actors.aeliana]);
		expect(await aimPcAskRoll(actors.aeliana, move(INTERFERE_MOVE))).toBeNull();
		expect(pickPersonOnMap).not.toHaveBeenCalled();
	});
});

describe("Aid", () => {
	it("posts the card the GM answers on, naming who helps whom", async () => {
		pickPersonOnMap.mockResolvedValue("bram");
		expect(await beginAid(actors.aeliana, move(AID_MOVE))).toBe(true);
		const [posted] = ChatMessage.create.mock.calls[0];
		expect(posted.flags[SYSTEM_ID][PC_ASK_FLAG]).toEqual(askOf(AID_MOVE));
		expect(posted.content).toContain("Aeliana helps Bram.");
		expect(posted.content).toContain("They gain advantage on their roll");
		expect(posted.speaker).toEqual({ actor: "aeliana" });
	});

	it("posts nothing when the question is closed", async () => {
		pickPersonOnMap.mockResolvedValue(null);
		expect(await beginAid(actors.aeliana, move(AID_MOVE))).toBe(true);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("hands any other move back to the sheet without asking", async () => {
		expect(await beginAid(actors.aeliana, move("Defy Danger"))).toBe(false);
		expect(await beginAid(actors.aeliana, { ...move(AID_MOVE), system: { moveType: "other" }, flags: { "stonetop-pwd": { custom: true } } })).toBe(false);
		expect(pickPersonOnMap).not.toHaveBeenCalled();
	});

	it("hands back to the sheet when there is nobody to help", async () => {
		getPlayerCharacters.mockReturnValue([actors.aeliana]);
		expect(await beginAid(actors.aeliana, move(AID_MOVE))).toBe(false);
	});
});

describe("answering", () => {
	it("gives the helped character advantage when the GM picks it, and says so as them", async () => {
		world({ isGM: true });
		const card = asking(AID_MOVE);
		await answerPcAsk(card, "advantage", null);
		expect(actors.bram.typedActor.holdAdvantage).toHaveBeenCalledWith("Aeliana's Aid");
		const [posted] = ChatMessage.create.mock.calls[0];
		expect(posted.flags[SYSTEM_ID][PC_ANSWER_FLAG]).toEqual({ to: "ask-1", choice: "advantage" });
		expect(posted.speaker).toEqual({ actor: "bram" });
		// Redrawn by the createChatMessage hook (below), which fires on the answering client too.
		expect(ui.chat.updateMessage).not.toHaveBeenCalled();
	});

	it("writes nothing for Aid's other pick but the card", async () => {
		world({ isGM: true });
		await answerPcAsk(asking(AID_MOVE), "more", null);
		expect(actors.bram.typedActor.holdAdvantage).not.toHaveBeenCalled();
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("does not let a player answer Aid for the GM", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(AID_MOVE), "advantage", null);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("lays the disadvantage on the foiled character when their player goes ahead anyway", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(INTERFERE_MOVE), "anyway", "partial");
		expect(actors.bram.typedActor.holdDisadvantage).toHaveBeenCalledWith("Interfered with by Aeliana");
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Bram does it anyway, with disadvantage on their next roll.");
	});

	it("lays nothing when they relent", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(INTERFERE_MOVE), "relent", "success");
		expect(actors.bram.typedActor.holdDisadvantage).not.toHaveBeenCalled();
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("does nothing on a 6-, which asks nothing", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(INTERFERE_MOVE), "anyway", "failure");
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("does not let somebody else's player answer for them", async () => {
		world();
		await answerPcAsk(asking(INTERFERE_MOVE), "anyway", "success");
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("marks the persuaded character's XP on a receipt their Undo can take back", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(PERSUADE_PC_MOVE), "agree", "success");
		expect(adjustXp).toHaveBeenCalledWith(actors.bram, 1, { move: PERSUADE_PC_MOVE });
		const [posted] = ChatMessage.create.mock.calls[0];
		expect(posted.flags[SYSTEM_ID]).toMatchObject({ xpMark: 1, [PC_ANSWER_FLAG]: { to: "ask-1", choice: "agree" } });
		expect(posted.content).toContain("+1 XP (5 / 8)");
		expect(posted.content).toContain("stonetop-xp-undo");
	});

	it("marks no XP for a refusal", async () => {
		world({ ownsBram: true });
		await answerPcAsk(asking(PERSUADE_PC_MOVE), "counter", "partial");
		expect(adjustXp).not.toHaveBeenCalled();
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Bram refuses, or makes a counter-offer.");
	});

	it("answers once, whoever presses second", async () => {
		world({ isGM: true });
		const card = asking(PERSUADE_PC_MOVE);
		await answerPcAsk(card, "agree", "success");
		await answerPcAsk(card, "refuse", "success");
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(adjustXp).toHaveBeenCalledTimes(1);
	});

	it("leaves the answer to the player while they are here, even for the GM", async () => {
		world({ isGM: true, samHere: true });
		await answerPcAsk(asking(INTERFERE_MOVE), "anyway", "success");
		expect(ChatMessage.create).not.toHaveBeenCalled();
		world({ isGM: true, samHere: false });
		await answerPcAsk(asking(INTERFERE_MOVE), "anyway", "success");
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	// A GM's Shift Up past 12 draws the card `critical`, and the question stays open as a 10+.
	it("answers a card shifted up to 12+ as a 10+", async () => {
		world({ ownsBram: true });
		let click = null;
		const button = { dataset: { pcAnswer: "agree" }, addEventListener: (_type, fn) => { click = fn; } };
		const html = {
			querySelector: sel => (sel === ".stonetop-roll-result" ? { classList: { contains: c => c === "critical" } } : null),
			querySelectorAll: sel => (sel === "[data-pc-answer]" ? [button] : []),
		};
		wirePcAskCard(asking(PERSUADE_PC_MOVE), html);
		click({ preventDefault() {} });
		await vi.waitFor(() => expect(ChatMessage.create).toHaveBeenCalledTimes(1));
		expect(adjustXp).toHaveBeenCalledTimes(1);
	});

	it("answers once for a double click", async () => {
		world({ isGM: true });
		const card = asking(PERSUADE_PC_MOVE);
		await Promise.all([answerPcAsk(card, "agree", "success"), answerPcAsk(card, "agree", "success")]);
		expect(adjustXp).toHaveBeenCalledTimes(1);
	});
});

describe("on every client", () => {
	it("redraws the asked card when its answer arrives or is deleted", () => {
		const handlers = {};
		globalThis.Hooks = { on: vi.fn((name, fn) => { handlers[name] = fn; }), once: () => {} };
		registerPcAskHooks();
		const card = Object.assign(asking(INTERFERE_MOVE), { logged: true });
		log.push(card);
		const answer = message("m9", { [PC_ANSWER_FLAG]: { to: "ask-1", choice: "relent" } });
		handlers.createChatMessage(answer);
		handlers.deleteChatMessage(answer);
		expect(ui.chat.updateMessage).toHaveBeenCalledTimes(2);
		expect(ui.chat.updateMessage).toHaveBeenCalledWith(card);
		handlers.createChatMessage(message("m10", {}));
		expect(ui.chat.updateMessage).toHaveBeenCalledTimes(2);
	});

	// Core's updateMessage posts a card it has never drawn at the foot of the log, out of order.
	it("leaves a card this client has not drawn yet alone", () => {
		const handlers = {};
		globalThis.Hooks = { on: vi.fn((name, fn) => { handlers[name] = fn; }), once: () => {} };
		registerPcAskHooks();
		log.push(asking(INTERFERE_MOVE));
		handlers.createChatMessage(message("m9", { [PC_ANSWER_FLAG]: { to: "ask-1", choice: "relent" } }));
		expect(ui.chat.updateMessage).not.toHaveBeenCalled();
	});
});
