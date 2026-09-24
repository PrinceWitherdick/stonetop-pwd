import { describe, expect, it } from "vitest";
import {
	MOVE, ROW_KIND, SPOTS, STRUGGLE_STATUS, newStruggleRecord, readStruggleRoll, struggleBoard,
} from "../../module/struggle/struggle-rules.js";
import {
	bumpMatters, endPreviewLines, modeText, struggleCalledRows, struggleSummaryRows, struggleWindowView,
} from "../../module/struggle/struggle-view.js";

/**
 * What a struggle says, and to whom. The heart of it is p.329's "keep their results quiet for the
 * moment": until the GM shares them, a player reads only their own rows.
 */

const pc = (actorId, extra = {}) => ({ kind: ROW_KIND.PC, actorId, name: actorId[0].toUpperCase() + actorId.slice(1), ...extra });

function setUp(rows, { status = STRUGGLE_STATUS.ROLLING, totals = {}, saves = {}, ...extra } = {}) {
	const struggle = { ...newStruggleRecord({ id: "s1", rows, danger: "The mire", ...extra }), status };
	const records = {};
	for (const row of struggle.rows) {
		records[row.actorId] ??= { id: "s1", rolls: {}, saves: {} };
		if (row.key in totals) records[row.actorId].rolls[row.key] = { total: totals[row.key], stat: "wis", dice: "3, 4" };
		if (row.key in saves) records[row.actorId].saves[row.key] = saves[row.key];
	}
	const board = struggleBoard(struggle, id => readStruggleRoll(records[id], "s1"));
	return { struggle, board };
}

const gm = { isGM: true, drives: new Set(), mine: new Set() };
const player = key => ({ isGM: false, drives: new Set([key]), mine: new Set([key]) });

describe("who sees what, before the GM shares", () => {
	const rows = [pc("vahid"), pc("rhianna")];

	it("shows a player their own result and only 'Rolled' for anyone else's", () => {
		const { struggle, board } = setUp(rows, { totals: { pc_vahid: 5, pc_rhianna: 11 } });
		const view = struggleWindowView(struggle, board, player("pc_vahid"));
		const [vahid, rhianna] = view.rows;
		expect(vahid.result).toBe("5: in a spot");
		expect(rhianna.result).toBe("");
		expect(rhianna.stateText).toBe("Rolled");
		expect(rhianna.dice).toBe("");
	});

	it("shows the GM every result", () => {
		const { struggle, board } = setUp(rows, { totals: { pc_vahid: 5, pc_rhianna: 11 } });
		const view = struggleWindowView(struggle, board, gm);
		expect(view.rows.map(r => r.stateText)).toEqual(["6-", "10+"]);
	});

	it("shows everyone everything once shared", () => {
		const { struggle, board } = setUp(rows, { status: STRUGGLE_STATUS.REVEALED, totals: { pc_vahid: 5, pc_rhianna: 11 } });
		const view = struggleWindowView(struggle, board, player("pc_vahid"));
		expect(view.rows[1].result).toBe("11: does well enough to get someone else out of a spot");
	});
});

describe("the GM's footer", () => {
	it("offers to share the results only once everyone has rolled", () => {
		const waiting = setUp([pc("vahid"), pc("rhianna")], { totals: { pc_vahid: 8 } });
		expect(struggleWindowView(waiting.struggle, waiting.board, gm).gm.canShare).toBe(false);
		expect(struggleWindowView(waiting.struggle, waiting.board, gm).statusText).toContain("Waiting on Rhianna");
		const done = setUp([pc("vahid"), pc("rhianna")], { totals: { pc_vahid: 8, pc_rhianna: 3 } });
		expect(struggleWindowView(done.struggle, done.board, gm).gm.canShare).toBe(true);
	});

	it("gives a player no footer at all", () => {
		const { struggle, board } = setUp([pc("vahid")], { totals: { pc_vahid: 8 } });
		const view = struggleWindowView(struggle, board, player("pc_vahid"));
		expect(view.gm).toBeNull();
		expect(view.hasGmTools).toBe(false);
	});

	it("asks how several people are in a spot only when there are several", () => {
		const one = setUp([pc("a"), pc("b")], { status: STRUGGLE_STATUS.REVEALED, totals: { pc_a: 4, pc_b: 8 } });
		expect(struggleWindowView(one.struggle, one.board, gm).gm.spots).toBeNull();
		const two = setUp([pc("a"), pc("b")], { status: STRUGGLE_STATUS.REVEALED, totals: { pc_a: 4, pc_b: 5 } });
		expect(struggleWindowView(two.struggle, two.board, gm).gm.spots.map(s => s.value)).toEqual([SPOTS.APART, SPOTS.TOGETHER]);
	});

	it("says what ending it will do before the GM presses it", () => {
		const { board } = setUp([pc("caradoc"), pc("vahid"), pc("rhianna")], {
			status: STRUGGLE_STATUS.REVEALED, totals: { pc_caradoc: 4, pc_vahid: 5, pc_rhianna: 11 }, saves: { pc_rhianna: ["pc_vahid"] },
		});
		expect(endPreviewLines(board)).toEqual(["Caradoc is still in a spot, and marks XP."]);
	});
});

describe("a row's controls", () => {
	it("gives the driver a stat list saying what each stat means here, from Defy Danger", () => {
		const { struggle, board } = setUp([pc("vahid", { stats: ["str", "con"] })]);
		const view = struggleWindowView(struggle, board, player("pc_vahid"), {
			statValues: { pc_vahid: { str: 1, con: -1 } },
			approaches: { str: "to power through or test your might" },
		});
		expect(view.rows[0].rollForm.choices.map(c => c.label)).toEqual([
			"+STR (+1): to power through or test your might",
			"+CON (−1)",
		]);
	});

	it("gives a single allowed stat a button that names it", () => {
		const { struggle, board } = setUp([pc("blodwen", { stats: ["wis"] })]);
		const view = struggleWindowView(struggle, board, player("pc_blodwen"), { statValues: { pc_blodwen: { wis: 2 } } });
		expect(view.rows[0].rollForm).toMatchObject({ choices: null, label: "Roll +WIS (+2)", stat: "wis" });
	});

	it("gives a 10+ a list of the people it can get out, once the results are shared", () => {
		const { struggle, board } = setUp([pc("rhianna"), pc("vahid")], { status: STRUGGLE_STATUS.REVEALED, totals: { pc_rhianna: 11, pc_vahid: 3 } });
		const view = struggleWindowView(struggle, board, player("pc_rhianna"));
		expect(view.rows[0].rescue.options.map(o => o.label)).toEqual(["Vahid"]);
	});

	it("lets the GM take back a rescue that doesn't hold up", () => {
		const { struggle, board } = setUp([pc("rhianna"), pc("vahid")], {
			status: STRUGGLE_STATUS.REVEALED, totals: { pc_rhianna: 11, pc_vahid: 3 }, saves: { pc_rhianna: ["pc_vahid"] },
		});
		const view = struggleWindowView(struggle, board, gm);
		expect(view.rows[0].rescue).toMatchObject({ canUndo: true, undoLabel: "That doesn't get them out" });
		expect(view.rows[1].outcome[0]).toBe("Got out by Rhianna. No XP for this 6-.");
	});

	it("reminds the GM that a helper who gave Aid shares the spot", () => {
		const { struggle, board } = setUp([pc("vahid", { aid: { by: "Lowri", advantage: true } })], {
			status: STRUGGLE_STATUS.REVEALED, totals: { pc_vahid: 5 },
		});
		expect(struggleWindowView(struggle, board, gm).rows[0].outcome).toContain("Lowri gave Aid, so is in the spot too, or instead.");
	});

	it("reminds the GM of Trailblazer's discovery on a journey 10+", () => {
		const { struggle, board } = setUp([pc("rhianna", { owns: [MOVE.TRAILBLAZER] })], {
			status: STRUGGLE_STATUS.REVEALED, journey: true, totals: { pc_rhianna: 10 },
		});
		expect(struggleWindowView(struggle, board, gm).rows[0].outcome.join(" ")).toContain("Trailblazer");
	});
});

describe("Many Hands Make Light Work, from outside the struggle", () => {
	it("is offered only where +1 changes the result", () => {
		const { struggle, board } = setUp([pc("a"), pc("b"), pc("c")], { totals: { pc_a: 6, pc_b: 8, pc_c: 9 }, helpers: ["Garet"] });
		expect(board.rows.map(r => bumpMatters(r, struggle))).toEqual([true, false, true]);
		const view = struggleWindowView(struggle, board, gm);
		expect(view.rows[0].gm.bump.label).toBe("+1 from Garet (Many Hands Make Light Work)");
		expect(view.rows[1].gm).toBeNull();
	});

	it("is not offered on a 6 a move already counts as a 7-9", () => {
		const { struggle, board } = setUp([pc("a", { halfMisses: [MOVE.STONE_COLD] })], { totals: { pc_a: 6 }, helpers: ["Garet"] });
		expect(bumpMatters(board.rows[0], struggle)).toBe(false);
	});
});

describe("the cards", () => {
	it("names the danger and who rolls when the struggle is called", () => {
		const { struggle } = setUp([pc("vahid"), pc("rhianna")], { approach: "Single file" });
		const html = struggleCalledRows(struggle);
		expect(html).toContain("The mire");
		expect(html).toContain("Single file");
		expect(html).toContain("Vahid &amp; Rhianna");
	});

	it("sums up every roll, rescue and XP mark when it ends", () => {
		const { struggle, board } = setUp([pc("caradoc"), pc("vahid"), pc("rhianna")], {
			status: STRUGGLE_STATUS.CLOSED, totals: { pc_caradoc: 4, pc_vahid: 5, pc_rhianna: 11 }, saves: { pc_rhianna: ["pc_vahid"] },
		});
		const html = struggleSummaryRows(struggle, board);
		expect(html).toContain("<strong>Caradoc:</strong> +WIS, 4: in a spot; marked XP");
		expect(html).toContain("<strong>Vahid:</strong> +WIS, 5: in a spot; got out by Rhianna");
		expect(html).toContain("got Vahid out");
	});

	it("escapes what the table typed", () => {
		const { struggle } = setUp([pc("vahid")], { danger: "<b>bees</b>" });
		expect(struggleCalledRows(struggle)).toContain("&lt;b&gt;bees&lt;/b&gt;");
	});
});

describe("modeText", () => {
	it("names who gave advantage, and says so when it cancels", () => {
		expect(modeText({ mode: "adv", adv: ["Aid from Blodwen"], dis: [] })).toBe("Advantage (Aid from Blodwen)");
		expect(modeText({ mode: "dis", adv: [], dis: ["The GM"] })).toBe("Disadvantage");
		expect(modeText({ mode: "normal", adv: ["Aid from Blodwen"], dis: ["The GM"] })).toBe("Advantage and disadvantage cancel (Aid from Blodwen & The GM)");
		expect(modeText({ mode: "normal", adv: [], dis: [] })).toBe("");
	});
});
