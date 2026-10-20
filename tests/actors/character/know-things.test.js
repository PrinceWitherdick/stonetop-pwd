import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	isKnowThings, ownedMoveNames, logbookUses, knowThingsRollOptions, neverAtALossActions, latestKnowThingsCard, latestMoveCard,
	KNOW_THINGS, LOGBOOK, NEVER_AT_A_LOSS, STRONG_HIT_TOTAL,
} from "../../../module/actors/character/know-things.js";
import { SYSTEM_ID } from "../../../module/system-id.js";

const move = (name, extra = {}) => ({ type: "move", name, system: extra });
const actorWith = (...names) => ({ type: "character", items: names.map(n => (typeof n === "string" ? move(n) : n)) });

describe("isKnowThings", () => {
	it("matches the base move name that the message flag stores", () => {
		expect(isKnowThings(KNOW_THINGS)).toBe(true);
	});

	it("does not match other moves, or nothing at all", () => {
		// The card HEADER would read "Know Things with WIS" for a Well-Read roll, which is exactly
		// why the flag stores the base name and this compares against that rather than the header.
		expect(isKnowThings("Know Things with WIS")).toBe(false);
		expect(isKnowThings("Seek Insight")).toBe(false);
		expect(isKnowThings(null)).toBe(false);
		expect(isKnowThings(undefined)).toBe(false);
	});
});

describe("ownedMoveNames", () => {
	it("collects move names and ignores other item types", () => {
		const actor = { items: [move("Logbook"), { type: "equipment", name: "Rope" }] };
		expect([...ownedMoveNames(actor)]).toEqual(["Logbook"]);
	});

	it("tolerates an actor with no items", () => {
		expect(ownedMoveNames({}).size).toBe(0);
		expect(ownedMoveNames().size).toBe(0);
	});
});

describe("logbookUses", () => {
	// A move track's stored number is how many pips are FILLED, and for a move that means uses
	// SPENT — so a character who has never touched the track has no flag and a full logbook.
	const logbook = move(LOGBOOK, { resource: { max: 2, title: "Uses" } });

	it("reads an untouched logbook as full, not as exhausted", () => {
		expect(logbookUses(actorWith(logbook), {})).toEqual({ max: 2, spent: 0, left: 2 });
	});

	it("counts down as uses are spent", () => {
		expect(logbookUses(actorWith(logbook), { Logbook: 1 }).left).toBe(1);
		expect(logbookUses(actorWith(logbook), { Logbook: 2 }).left).toBe(0);
	});

	it("never reports negative uses if the track overruns its max", () => {
		expect(logbookUses(actorWith(logbook), { Logbook: 5 }).left).toBe(0);
	});

	it("takes max off the owned item, so a re-pointed or homebrew logbook still works", () => {
		const bigger = move(LOGBOOK, { resource: { max: 4 } });
		expect(logbookUses(actorWith(bigger), { Logbook: 1 }).left).toBe(3);
	});

	it("is null for a character who does not own the move", () => {
		expect(logbookUses(actorWith("Know Things"), {})).toBeNull();
	});

	// Seeker audit (2026-09-26): a rule asks the LEARNED move. A Logbook kept on the sheet switched
	// off offered its consult button all the same.
	it("is null for a Logbook kept on the sheet un-learned", () => {
		const off = { ...logbook, flags: { "stonetop-pwd": { learned: false } } };
		expect(logbookUses(actorWith(off), {})).toBeNull();
	});

	it("ignores another move's track", () => {
		expect(logbookUses(actorWith(logbook), { "Potential for Greatness": 2 }).left).toBe(2);
	});
});

describe("knowThingsRollOptions", () => {
	it("leaves an ordinary character's roll untouched", () => {
		expect(knowThingsRollOptions(actorWith(KNOW_THINGS))).toBeNull();
	});

	it("defers the miss XP for Never at a Loss, and puts the choice on the card", () => {
		const opts = knowThingsRollOptions(actorWith(KNOW_THINGS, NEVER_AT_A_LOSS));
		// Suppressing the automatic mark is what makes the player's choice possible at all.
		expect(opts.noXpOnMiss).toBe(true);
		expect(opts.tierActions.failure).toContain('data-choice="mark"');
		expect(opts.tierActions.failure).toContain('data-choice="decline"');
	});

	it("leaves the roll untouched for a Never at a Loss kept on the sheet un-learned", () => {
		const off = { type: "move", name: NEVER_AT_A_LOSS, system: {}, flags: { "stonetop-pwd": { learned: false } } };
		expect(knowThingsRollOptions(actorWith(KNOW_THINGS, off))).toBeNull();
	});

	it("offers the choice only on a miss — the move only triggers on a 6-", () => {
		const { tierActions } = knowThingsRollOptions(actorWith(NEVER_AT_A_LOSS));
		expect(Object.keys(tierActions)).toEqual(["failure"]);
	});

	it("does not defer XP for a Logbook-only character", () => {
		// The Logbook acts after the roll and spends a resource; it has nothing to do with XP.
		expect(knowThingsRollOptions(actorWith(KNOW_THINGS, LOGBOOK))).toBeNull();
	});
});

describe("neverAtALossActions", () => {
	it("emits both buttons with the shared handler class", () => {
		const html = neverAtALossActions().failure;
		expect(html.match(/class="stonetop-know-things-xp"/g)).toHaveLength(2);
	});
});

describe("STRONG_HIT_TOTAL", () => {
	it("is 10 — padding to exactly a strong hit keeps the card off the 12+ label", () => {
		expect(STRONG_HIT_TOTAL).toBe(10);
	});
});

// Seeker re-audit (2026-10-18), the user's ruling: "a Know Things roll you JUST made" is the character's
// most recent Know Things card, so the Logbook and books & scrolls buttons sit on that card only.
describe("latestKnowThingsCard", () => {
	const card = (id, actor, move, rolled = true) => ({
		id, speaker: { actor },
		rolls: rolled ? [{ total: 7 }] : [],
		getFlag: (scope, key) => (scope === SYSTEM_ID && key === "move" ? move : undefined),
	});

	it("is the newest Know Things roll card the character spoke, whatever came after it", () => {
		const log = [
			card("old", "maelis", KNOW_THINGS),
			card("mid", "maelis", KNOW_THINGS),
			card("other", "maelis", "Seek Insight"),
			card("bram", "bram", KNOW_THINGS),
		];
		expect(latestKnowThingsCard(log, "maelis")?.id).toBe("mid");
		expect(latestKnowThingsCard(log, "bram")?.id).toBe("bram");
	});

	it("passes over a Know Things card with no roll on it", () => {
		const log = [card("rolled", "maelis", KNOW_THINGS), card("posted", "maelis", KNOW_THINGS, false)];
		expect(latestKnowThingsCard(log, "maelis")?.id).toBe("rolled");
	});

	it("reads the chat log in place, or a stand-in through its contents, to the same card", () => {
		const log = [card("old", "maelis", KNOW_THINGS), card("new", "maelis", KNOW_THINGS), card("bram", "bram", KNOW_THINGS)];
		expect(latestKnowThingsCard(new Map(log.map(m => [m.id, m])).values(), "maelis")?.id).toBe("new");
		expect(latestKnowThingsCard(new Set(log), "maelis")?.id).toBe("new");
		expect(latestKnowThingsCard({ contents: log }, "maelis")?.id).toBe("new");
	});

	it("is null for a character with no Know Things card, or no character", () => {
		expect(latestKnowThingsCard([card("x", "bram", KNOW_THINGS)], "maelis")).toBeNull();
		expect(latestKnowThingsCard([card("x", undefined, KNOW_THINGS)], undefined)).toBeNull();
		expect(latestKnowThingsCard(undefined, "maelis")).toBeNull();
	});

	// stonetop.js registers its hooks on import, so the wiring is read off the source.
	it("gates both the Logbook buttons and the writer's spend on it", () => {
		const src = fs.readFileSync(path.resolve("stonetop.js"), "utf8");
		const body = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf("\n}\n", src.indexOf(`function ${name}(`)));
		// Read from the newest end (an array), so the walk stops at the bottom card rather than testing the whole log.
		expect(body("_isLatestKnowThingsCard")).toContain("latestKnowThingsCard(game.messages?.contents ?? [], actorId)");
		// Remembered per speaker: a card made or deleted forgets its speaker's, an edit only one that could change the
		// answer (a card flag written is not one); the spend always asks the log afresh.
		expect(src).toContain('for (const hook of ["createChatMessage", "deleteChatMessage"]) Hooks.on(hook, message => _latestKnowThings.delete(message.speaker?.actor));');
		expect(src).toContain('if ("rolls" in changes || foundry.utils.hasProperty(changes, `flags.${SYSTEM_ID}.move`)) _latestKnowThings.delete(message.speaker?.actor);');
		expect(src).toContain('if ("speaker" in changes) return _latestKnowThings.clear();');
		expect(src).toContain("if (!_isLatestKnowThingsCard(message, { fresh: true })) return { upgraded: false, stale: true };");
		expect(body("_wireLogbook")).toContain("if (!_isLatestKnowThingsCard(message)) return;");
		// Only once a track has a use to offer: a character with none never walks the log.
		const wire = body("_wireLogbook");
		expect(wire.indexOf("if (!offers.length) return;")).toBeGreaterThan(-1);
		expect(wire.indexOf("if (!offers.length) return;")).toBeLessThan(wire.indexOf("_isLatestKnowThingsCard(message)"));
		expect(body("_upgradeKnowThings")).toContain("_isLatestKnowThingsCard(message, { fresh: true })");
	});
});

describe("latestMoveCard", () => {
	const card = (id, actor, move, rolled = true) => ({
		id, speaker: { actor },
		rolls: rolled ? [{ total: 7 }] : [],
		getFlag: (scope, key) => (scope === SYSTEM_ID && key === "move" ? move : undefined),
	});
	const log = [
		card("a1", "maelis", "Amulets & Talismans"),
		card("seen", "maelis", "Seek Insight"),
		card("a2", "maelis", "Amulets & Talismans", false),
		card("bram", "bram", "Amulets & Talismans"),
	];
	const asIterable = list => new Set(list);

	it("is the newest card the character spoke for a move named or matched, rolled or not", () => {
		for (const messages of [log, asIterable(log)]) {
			expect(latestMoveCard(messages, "maelis", "Amulets & Talismans")?.id).toBe("a2");
			expect(latestMoveCard(messages, "maelis", "Amulets & Talismans", { rolled: true })?.id).toBe("a1");
			expect(latestMoveCard(messages, "maelis", name => name === "Seek Insight")?.id).toBe("seen");
			expect(latestMoveCard(messages, "maelis", "Forage")).toBeNull();
			expect(latestMoveCard(messages, undefined, "Amulets & Talismans")).toBeNull();
		}
	});

	it("stops at a message already seen, from the end and walked forward alike", () => {
		for (const messages of [log, asIterable(log)]) {
			expect(latestMoveCard(messages, "maelis", "Amulets & Talismans", { seen: new Set(["seen"]) })?.id).toBe("a2");
			expect(latestMoveCard(messages, "maelis", "Amulets & Talismans", { seen: new Set(["seen"]), rolled: true })).toBeNull();
			expect(latestMoveCard(messages, "maelis", "Seek Insight", { seen: new Set(["seen"]) })).toBeNull();
			expect(latestMoveCard(messages, "bram", "Amulets & Talismans", { seen: new Set(["a1"]) })?.id).toBe("bram");
		}
	});
});
