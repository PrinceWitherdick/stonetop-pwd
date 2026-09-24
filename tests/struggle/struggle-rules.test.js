import { describe, expect, it } from "vitest";
import {
	MOVE, ROW_KIND, SPOTS, STRUGGLE_STATUS, TIER, allowedStats, bundleChoices, canPickBundleAlly, endWarnings,
	halfMissesFor, newStruggleRecord, readRow, readStruggle, readStruggleRoll, rescueTargets, rowKeyFor, rowResult,
	rowRollMode, struggleBoard, tierOf, xpOwed,
} from "../../module/struggle/struggle-rules.js";

/**
 * Struggle as One's rules, pure (Book I p.78, p.328-331). The documents are struggle-store.test.js's.
 */

const pc = (actorId, extra = {}) => ({ kind: ROW_KIND.PC, actorId, name: actorId, ...extra });
const follower = (actorId, slug, extra = {}) => ({ kind: ROW_KIND.FOLLOWER, actorId, ftype: "custom", slug, name: slug, ...extra });

function struggleOf(rows, extra = {}) {
	return newStruggleRecord({ id: "s1", rows, ...extra });
}

/** A board where each actor's record holds the given totals, and each rescuer's saves. */
function boardOf(struggle, { totals = {}, saves = {}, bundle = {} } = {}) {
	const records = {};
	for (const row of struggle.rows) {
		records[row.actorId] ??= { id: struggle.id, rolls: {}, saves: {}, bundleAlly: "" };
		if (row.key in totals) records[row.actorId].rolls[row.key] = { total: totals[row.key], stat: "str" };
		if (row.key in saves) records[row.actorId].saves[row.key] = saves[row.key];
		if (row.key in bundle) records[row.actorId].bundleAlly = bundle[row.key];
	}
	return struggleBoard(struggle, id => readStruggleRoll(records[id], struggle.id));
}

describe("reading a struggle", () => {
	it("keeps only what it knows and drops rows it cannot use", () => {
		const s = readStruggle({
			id: "s1", status: "rolling", danger: " The mire ", spots: "weird",
			rows: [pc("a", { stats: ["WIS", "luck"], mode: "sideways" }), { kind: "pc" }, pc("a")],
		});
		expect(s).toMatchObject({ id: "s1", status: STRUGGLE_STATUS.ROLLING, danger: "The mire", spots: SPOTS.APART });
		// The row with no actor is dropped, and so is the second copy of "a".
		expect(s.rows).toHaveLength(1);
		expect(s.rows[0]).toMatchObject({ key: "pc_a", stats: ["wis"], mode: "normal" });
	});

	it("is null without an id or a known status", () => {
		expect(readStruggle({ status: "rolling" })).toBeNull();
		expect(readStruggle({ id: "x", status: "napping" })).toBeNull();
		expect(readStruggle(null)).toBeNull();
	});

	it("caps a follower's bonus at +2 and gives a PC none", () => {
		expect(readRow(follower("a", "crew", { bonus: 5 })).bonus).toBe(2);
		expect(readRow(pc("a", { bonus: 2 })).bonus).toBe(0);
	});

	it("keys rows with no dot in them, since Foundry expands a dotted key on write", () => {
		const key = rowKeyFor({ kind: ROW_KIND.FOLLOWER, actorId: "a", ftype: "custom", slug: "lowri.2" });
		expect(key).not.toContain(".");
		expect(rowKeyFor({ kind: ROW_KIND.PC, actorId: "abc" })).toBe("pc_abc");
	});

	it("reads a character's record only for the struggle it belongs to", () => {
		const raw = { id: "old", rolls: { pc_a: { total: 4 } } };
		expect(readStruggleRoll(raw, "new").rolls).toEqual({});
		expect(readStruggleRoll({ ...raw, id: "new" }, "new").rolls.pc_a.total).toBe(4);
	});
});

describe("results", () => {
	it("bands a total the way every move does", () => {
		expect([tierOf(6), tierOf(7), tierOf(9), tierOf(10)]).toEqual([TIER.FAILURE, TIER.PARTIAL, TIER.PARTIAL, TIER.SUCCESS]);
	});

	it("counts a 6- as a 7-9 for a move the GM ticked", () => {
		const row = readRow(pc("heavy", { halfMisses: [MOVE.STONE_COLD] }));
		const result = rowResult(row, { total: 4 }, struggleOf([row]));
		expect(result).toMatchObject({ tier: TIER.PARTIAL, halfMiss: MOVE.STONE_COLD, rolledTier: TIER.FAILURE });
	});

	it("gives Home on the Range its 7-9 only on a journey", () => {
		const row = readRow(pc("ranger", { owns: [MOVE.HOME_ON_THE_RANGE] }));
		expect(halfMissesFor(row, struggleOf([row], { journey: false }))).toEqual([]);
		expect(halfMissesFor(row, struggleOf([row], { journey: true }))).toEqual([MOVE.HOME_ON_THE_RANGE]);
	});

	it("follows the total on the roll's message, so a GM's Shift Up carries through", () => {
		const row = readRow(pc("a"));
		expect(rowResult(row, { total: 6 }, struggleOf([row]), { liveTotal: 7 }).tier).toBe(TIER.PARTIAL);
	});

	it("adds Many Hands' +1 on top of the dice", () => {
		const row = readRow(pc("a", { bump: 1 }));
		expect(rowResult(row, { total: 9 }, struggleOf([row]))).toMatchObject({ total: 10, tier: TIER.SUCCESS });
	});

	it("lets the GM limit the stats, or leaves all six to the player", () => {
		expect(allowedStats(readRow(pc("a", { stats: ["str", "con"] })))).toEqual(["str", "con"]);
		expect(allowedStats(readRow(pc("a")))).toHaveLength(6);
	});
});

describe("advantage and disadvantage", () => {
	it("cancel rather than stack (p.230)", () => {
		const row = readRow(pc("a", { mode: "dis", aid: { by: "Blodwen", advantage: true } }));
		expect(rowRollMode(row)).toMatchObject({ mode: "normal", adv: ["Aid from Blodwen"], dis: ["The GM"] });
	});

	it("gives a Judge with A Bundle of Sticks Unbroken advantage, and the ally they pick", () => {
		const s = struggleOf([pc("judge", { owns: [MOVE.BUNDLE_OF_STICKS] }), pc("b"), pc("c")]);
		const board = boardOf(s, { bundle: { pc_judge: "pc_b" } });
		expect(board.byKey.get("pc_judge").rollMode.mode).toBe("adv");
		expect(board.byKey.get("pc_b").rollMode).toMatchObject({ mode: "adv", adv: [`${MOVE.BUNDLE_OF_STICKS} (judge)`] });
		expect(board.byKey.get("pc_c").rollMode.mode).toBe("normal");
	});

	it("lets the Judge change the pick until that ally has rolled", () => {
		const s = struggleOf([pc("judge", { owns: [MOVE.BUNDLE_OF_STICKS] }), pc("b"), pc("c")]);
		const before = boardOf(s, { bundle: { pc_judge: "pc_b" } });
		expect(canPickBundleAlly(before, before.byKey.get("pc_judge"), s)).toBe(true);
		const after = boardOf(s, { bundle: { pc_judge: "pc_b" }, totals: { pc_b: 8 } });
		expect(canPickBundleAlly(after, after.byKey.get("pc_judge"), s)).toBe(false);
		expect(bundleChoices(after, after.byKey.get("pc_judge")).map(r => r.key)).toEqual(["pc_c"]);
	});
});

describe("spots and rescues (p.329)", () => {
	const three = () => struggleOf([pc("a"), pc("b"), pc("c"), pc("d")]);

	it("gets one person out per 10+ when they are in separate spots", () => {
		const s = three();
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 5, pc_c: 4, pc_d: 8 }, saves: { pc_a: ["pc_b", "pc_c"] } });
		expect(board.byKey.get("pc_b").savedBy).toEqual(["pc_a"]);
		expect(board.byKey.get("pc_c").savedBy).toEqual([]);
		expect(board.stillInSpot.map(r => r.key)).toEqual(["pc_c"]);
	});

	it("lets one 10+ get everybody out of a shared spot", () => {
		const s = { ...three(), spots: SPOTS.TOGETHER };
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 5, pc_c: 4, pc_d: 8 }, saves: { pc_a: ["pc_b", "pc_c"] } });
		expect(board.stillInSpot).toEqual([]);
	});

	it("stops counting a rescue that no longer makes sense, with nothing to clean up", () => {
		const s = three();
		// The rescuer was shifted down to a 7-9, so the save they wrote no longer counts.
		const board = boardOf(s, { totals: { pc_a: 9, pc_b: 5, pc_c: 8, pc_d: 8 }, saves: { pc_a: ["pc_b"] } });
		expect(board.byKey.get("pc_b").savedBy).toEqual([]);
		expect(board.xpOwed.map(o => o.key)).toEqual(["pc_b"]);
	});

	it("never lets a 10+ save itself", () => {
		const s = three();
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 8, pc_c: 8, pc_d: 8 }, saves: { pc_a: ["pc_a"] } });
		expect(board.byKey.get("pc_a").saves).toEqual([]);
	});

	it("offers a 10+ only people still to be got out, in separate spots", () => {
		const s = three();
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 5, pc_c: 4, pc_d: 12 }, saves: { pc_d: ["pc_b"] } });
		expect(rescueTargets(board, "pc_a", SPOTS.APART).map(r => r.key)).toEqual(["pc_c"]);
		expect(rescueTargets(board, "pc_a", SPOTS.TOGETHER).map(r => r.key)).toEqual(["pc_b", "pc_c"]);
	});
});

describe("XP and the end", () => {
	it("marks XP for every 6- nobody got out, and for nobody else (p.78)", () => {
		const s = struggleOf([pc("a"), pc("b"), follower("a", "crew")]);
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 4, fo_a_custom_crew: 3 }, saves: { pc_a: ["pc_b"] } });
		// The crew's miss is marked by the character who rolled for them, as Order Followers' are.
		expect(board.xpOwed).toEqual([{ actorId: "a", key: "fo_a_custom_crew", name: "crew" }]);
		expect(xpOwed([])).toEqual([]);
	});

	it("says when everyone got a 7+, Keep Company's cue (p.332)", () => {
		const s = struggleOf([pc("a"), pc("b")]);
		expect(boardOf(s, { totals: { pc_a: 7, pc_b: 12 } }).everyoneSevenPlus).toBe(true);
		expect(boardOf(s, { totals: { pc_a: 7 } }).everyoneSevenPlus).toBe(false);
		expect(boardOf(s, { totals: { pc_a: 7, pc_b: 6 } }).everyoneSevenPlus).toBe(false);
	});

	it("warns of rolls never made and 10+ rescues never used", () => {
		const s = struggleOf([pc("a"), pc("b"), pc("c")]);
		const board = boardOf(s, { totals: { pc_a: 11, pc_b: 5 } });
		const warnings = endWarnings(board);
		expect(warnings.unrolled.map(r => r.key)).toEqual(["pc_c"]);
		expect(warnings.unusedRescues.map(r => r.key)).toEqual(["pc_a"]);
	});

	it("knows when everyone has rolled", () => {
		const s = struggleOf([pc("a"), pc("b")]);
		expect(boardOf(s, { totals: { pc_a: 8 } }).allRolled).toBe(false);
		expect(boardOf(s, { totals: { pc_a: 8, pc_b: 2 } }).allRolled).toBe(true);
	});
});
