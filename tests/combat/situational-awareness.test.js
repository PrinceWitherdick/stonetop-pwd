import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import {
	shouldRemindSituationalAwareness, situationalAwarenessCardHtml, postSituationalAwareness, installSituationalAwareness,
	SITUATIONAL_AWARENESS,
} from "../../module/combat/situational-awareness.js";
import { SEEK_INSIGHT_QUESTIONS } from "../../module/actors/character/give-advantage.js";
import { MOVE_PICK_BONUSES } from "../../module/actors/character/move-pick-bonuses.js";
import { readRepo } from "../fakes/css.js";

// Heavy re-audit (the user's ruling of 2026-10-18): Situational Awareness's "When a fight breaks out, ask the
// GM 1 question that you could ask when Seeking Insight" is a card whispered to the character's players and
// the GM as they join a fight, once per character per Combat, listing the printed questions and the move's own.

const SCOPE = "stonetop-pwd";
const AWARENESS = MOVE_PICK_BONUSES.find(row => row.ownsLearned === SITUATIONAL_AWARENESS).addOptions;

function heavy({ id = "h", learned = true, moves = [SITUATIONAL_AWARENESS] } = {}) {
	return {
		id, name: "Brannoc", type: "character",
		items: moves.map(name => ({ type: "move", name, flags: learned ? {} : { [SCOPE]: { learned: false } } })),
		testUserPermission: () => true,
	};
}

const combat = id => ({ id });

/** A hooks fake that keeps every listener by name. */
function fakeHooks() {
	const listeners = {};
	return {
		on: vi.fn((name, fn) => { listeners[name] = fn; return name; }),
		off: vi.fn(),
		fire: (name, ...args) => listeners[name]?.(...args),
	};
}

describe("shouldRemindSituationalAwareness", () => {
	it("is a character holding the move LEARNED, not yet reminded in this Combat", () => {
		const reminded = new Map();
		expect(shouldRemindSituationalAwareness(heavy(), combat("c1"), reminded)).toBe(true);
		expect(shouldRemindSituationalAwareness(heavy({ learned: false }), combat("c1"), reminded)).toBe(false);
		expect(shouldRemindSituationalAwareness(heavy({ moves: ["Frosty"] }), combat("c1"), reminded)).toBe(false);
		expect(shouldRemindSituationalAwareness({ ...heavy(), type: "npc" }, combat("c1"), reminded)).toBe(false);
		expect(shouldRemindSituationalAwareness(heavy(), null, reminded)).toBe(false);
		reminded.set("c1", new Set(["h"]));
		expect(shouldRemindSituationalAwareness(heavy(), combat("c1"), reminded)).toBe(false);
		expect(shouldRemindSituationalAwareness(heavy(), combat("c2"), reminded)).toBe(true);
	});
});

describe("the card", () => {
	it("says the fight-start line and lists the printed questions and the move's three", () => {
		const root = new Window().document.createElement("div");
		root.innerHTML = situationalAwarenessCardHtml(heavy());
		expect(root.querySelector(".stonetop-chat-move-name").textContent).toBe("Situational Awareness");
		expect(root.textContent).toContain("A fight breaks out: ask the GM 1 question you could ask when Seeking Insight.");
		expect([...root.querySelectorAll("li")].map(li => li.textContent)).toEqual([...SEEK_INSIGHT_QUESTIONS, ...AWARENESS]);
	});

	it("is whispered to the GM and whoever plays the character, spoken as them", async () => {
		const saved = globalThis.ChatMessage;
		const create = vi.fn(async data => data);
		globalThis.ChatMessage = { create, getSpeaker: ({ actor }) => ({ alias: actor.name }) };
		try {
			const actor = heavy();
			const users = [
				{ id: "gm", isGM: true, character: null },
				{ id: "p1", isGM: false, character: actor },
				{ id: "p2", isGM: false, character: { id: "other" } },
			];
			await postSituationalAwareness(actor, { users });
			expect(create).toHaveBeenCalledTimes(1);
			expect(create.mock.calls[0][0].whisper).toEqual(["gm", "p1"]);
			expect(create.mock.calls[0][0].speaker).toEqual({ alias: "Brannoc" });
		} finally {
			globalThis.ChatMessage = saved;
		}
	});
});

describe("installSituationalAwareness", () => {
	let reminded;
	beforeEach(() => { reminded = new Map(); });
	afterEach(() => vi.restoreAllMocks());

	it("posts once per character per Combat, on the client that answers for them", async () => {
		const hooks = fakeHooks();
		const post = vi.fn(async () => {});
		installSituationalAwareness({ hooks, post, answers: () => true, reminded });
		const actor = heavy();
		const c1 = combat("c1");
		hooks.fire("createCombatant", { actor, parent: c1 });
		// A second token of the same Heavy in the same fight.
		hooks.fire("createCombatant", { actor, parent: c1 });
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith(actor);
		// Another fight is another fight breaking out.
		hooks.fire("createCombatant", { actor, parent: combat("c2") });
		expect(post).toHaveBeenCalledTimes(2);
	});

	it("posts nothing on a client that does not answer for the character, but still marks them reminded", () => {
		const hooks = fakeHooks();
		const post = vi.fn();
		installSituationalAwareness({ hooks, post, answers: () => false, reminded });
		hooks.fire("createCombatant", { actor: heavy(), parent: combat("c1") });
		expect(post).not.toHaveBeenCalled();
		expect(reminded.get("c1").has("h")).toBe(true);
	});

	it("posts nothing for a character without the move learned, and forgets a Combat when it is deleted", () => {
		const hooks = fakeHooks();
		const post = vi.fn();
		installSituationalAwareness({ hooks, post, answers: () => true, reminded });
		hooks.fire("createCombatant", { actor: heavy({ learned: false }), parent: combat("c1") });
		hooks.fire("createCombatant", { actor: { ...heavy(), type: "npc" }, parent: combat("c1") });
		expect(post).not.toHaveBeenCalled();
		hooks.fire("createCombatant", { actor: heavy(), parent: combat("c1") });
		expect(post).toHaveBeenCalledTimes(1);
		hooks.fire("deleteCombat", combat("c1"));
		expect(reminded.has("c1")).toBe(false);
	});

	it("logs a failed post rather than throwing into the hook", async () => {
		const hooks = fakeHooks();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		installSituationalAwareness({ hooks, post: async () => { throw new Error("boom"); }, answers: () => true, reminded });
		hooks.fire("createCombatant", { actor: heavy(), parent: combat("c1") });
		await vi.waitFor(() => expect(error).toHaveBeenCalled());
	});

	it("stops listening to both hooks", () => {
		const hooks = fakeHooks();
		const stop = installSituationalAwareness({ hooks, post: vi.fn(), answers: () => true, reminded });
		stop();
		expect(hooks.off).toHaveBeenCalledWith("createCombatant", "createCombatant");
		expect(hooks.off).toHaveBeenCalledWith("deleteCombat", "deleteCombat");
	});

	it("is installed with the other fight installers", () => {
		expect(readRepo("stonetop.js")).toContain("installSituationalAwareness();");
	});
});
