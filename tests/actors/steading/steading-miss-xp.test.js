import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../module/utils/playbook-actors.js", () => ({ getPlayerCharacters: vi.fn(() => []) }));
vi.mock("../../../module/actors/character/deaths-door-actor.js", () => ({ isOutOfPlay: vi.fn(actor => !!actor?.dead) }));

import { SYSTEM_ID } from "../../../module/system-id.js";
import { getPlayerCharacters } from "../../../module/utils/playbook-actors.js";
import { MISS_XP_ACTOR_FLAG, MISS_XP_FLAG, XP_MARK_FOR_FLAG } from "../../../module/utils/undo-xp-mark.js";
import { ROLLED_FLAG } from "../../../module/utils/counted-tier.js";
import { reconcileMissXp } from "../../../module/utils/roll-engine.js";
import { deletionTarget } from "../../../module/utils/foundry-compat.js";
import {
	defaultSteadingXpActor, handleSteadingMissXp, pickSteadingXpActor, steadingMissXpButtons, withSteadingMissXp,
} from "../../../module/actors/steading/steading-miss-xp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A steading-stat roll's 6- earns the mover's XP (Book I p.209, p.560), but the roll is the steading's:
// the miss card's buttons mark it for a character, tied to the card so it follows the total.

const savedGame = globalThis.game;
let log, actors;

function card({ total = 5, author = "p1" } = {}) {
	const flags = { [ROLLED_FLAG]: { move: "Muster" } };
	return {
		id: "c1", flags, author: { id: author }, rolls: [{ total }], speaker: { actor: "steading" },
		getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
		// A batch of this system's flags, set or deleted (`flags.<scope>.<key>`, either deletion spelling).
		update: vi.fn(async data => {
			for (const [path, value] of Object.entries(data)) {
				const gone = deletionTarget(path, value);
				const key = (gone ?? path).slice(`flags.${SYSTEM_ID}.`.length);
				if (gone) delete flags[key];
				else flags[key] = value;
			}
		}),
	};
}

function pc(id, xp = 3) {
	const actor = {
		id, uuid: `Actor.${id}`, name: id, type: "character",
		system: { attributes: { xp: { value: xp }, level: { value: 1 } } },
		update: vi.fn(async data => { actor.system.attributes.xp.value = data["system.attributes.xp.value"]; }),
	};
	return actor;
}

beforeEach(() => {
	log = [];
	actors = { wren: pc("wren"), bram: pc("bram") };
	globalThis.game = {
		...savedGame,
		user: { id: "p1", isGM: false, character: actors.wren },
		actors: { get: id => actors[id] ?? null },
		messages: { contents: log, get: id => log.find(m => m.id === id) ?? null },
		settings: { get: () => "publicroll" },
	};
	globalThis.ChatMessage = {
		getSpeaker: ({ actor }) => ({ actor: actor?.id }),
		create: vi.fn(async data => {
			const flags = { ...data.flags[SYSTEM_ID] };
			const m = { id: `r${log.length}`, flags, getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined),
				setFlag: async (scope, key, value) => { flags[key] = value; } };
			log.push(m);
			return m;
		}),
	};
});

afterEach(() => {
	globalThis.game = savedGame;
	delete globalThis.ChatMessage;
});

describe("which steading moves offer it", () => {
	it("is on the 6-, after what the tier already offers", () => {
		expect(steadingMissXpButtons()).toContain("stonetop-steading-miss-xp");
		const merged = withSteadingMissXp({ failure: "<b>lose horses</b>", partial: "x" });
		expect(merged.failure.startsWith("<b>lose horses</b>")).toBe(true);
		expect(merged.failure).toContain("stonetop-steading-miss-xp");
		expect(merged.partial).toBe("x");
		expect(withSteadingMissXp(null).failure).toContain("stonetop-steading-miss-xp");
	});

	it("is not on a move whose 6- says don't mark XP", () => {
		expect(withSteadingMissXp(null, { noXpOnMiss: true })).toBeNull();
		const own = { failure: "<b>x</b>" };
		expect(withSteadingMissXp(own, { noXpOnMiss: true })).toBe(own);
	});

	// Which moves those are lives on the moves themselves (StonetopSteadingSheet.js), so a new move earns it
	// by default; improvement-moves.test.js rolls each one.
	it("names no moves of its own", () => {
		const src = fs.readFileSync(path.resolve(HERE, "../../../module/actors/steading/steading-miss-xp.js"), "utf8");
		expect(src).not.toMatch(/STEADING_MOVE\b|STEADING_XP_MOVES/);
	});
});

describe("whose XP", () => {
	it("is the rolling player's own character without asking, and nobody's for a GM", () => {
		expect(defaultSteadingXpActor({ isGM: false, character: actors.wren })).toBe(actors.wren);
		expect(defaultSteadingXpActor({ isGM: true, character: actors.wren })).toBeNull();
		expect(defaultSteadingXpActor({ isGM: false, character: { ...actors.wren, dead: true } })).toBeNull();
	});

	it("can be chosen from the living player characters, the player's own picked to start with", async () => {
		getPlayerCharacters.mockReturnValue([actors.bram, actors.wren, { ...pc("cora"), dead: true }]);
		const pick = vi.fn(async ({ options, selected }) => {
			expect(options.map(o => o.id)).toEqual(["bram", "wren"]);
			expect(selected).toEqual(["wren"]);
			return "bram";
		});
		expect(await pickSteadingXpActor(game.user, pick)).toBe(actors.bram);
		pick.mockResolvedValueOnce(null);
		expect(await pickSteadingXpActor(game.user, pick)).toBeNull();
	});
});

describe("marking it, on the card's writer", () => {
	it("marks the named character once, on a receipt tied to the card", async () => {
		const c = card();
		expect(await handleSteadingMissXp({ message: c, user: game.user, data: { actorId: "bram" } })).toEqual({ marked: "bram" });
		expect(await handleSteadingMissXp({ message: c, user: game.user, data: { actorId: "bram" } })).toBeNull();
		expect(actors.bram.system.attributes.xp.value).toBe(4);
		expect(c.flags).toMatchObject({ [MISS_XP_FLAG]: true, [MISS_XP_ACTOR_FLAG]: "bram" });
		expect(log).toHaveLength(1);
		expect(log[0].flags[XP_MARK_FOR_FLAG]).toBe("c1");
	});

	it("refuses another player's press, and a card no longer on a miss", async () => {
		expect(await handleSteadingMissXp({ message: card({ author: "p2" }), user: game.user, data: { actorId: "wren" } })).toBeNull();
		expect(await handleSteadingMissXp({ message: card({ total: 7 }), user: game.user, data: { actorId: "wren" } })).toBeNull();
		expect(await handleSteadingMissXp({ message: card({ author: "p2" }), user: { id: "gm", isGM: true }, data: { actorId: "wren" } })).toEqual({ marked: "wren" });
	});

	// A Shift that lifts the card off the miss takes the XP back from the character the button named.
	it("follows the total: lifted off the miss, the XP is taken back and the button offered again", async () => {
		const c = card();
		await handleSteadingMissXp({ message: c, user: game.user, data: { actorId: "bram" } });
		await reconcileMissXp(c, 8, { actor: { type: "steading" } });
		expect(actors.bram.system.attributes.xp.value).toBe(3);
		expect(c.flags[MISS_XP_ACTOR_FLAG]).toBeUndefined();
		expect(c.flags[MISS_XP_FLAG]).toBeUndefined();
	});
});
