import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { CallUpDeepOnesDialog } from "../../../../module/actors/character/dialogs/CallUpDeepOnesDialog.js";

// "Each time you Call Up the Deep Ones, roll five d4s" (Book II p.561). The window keeps an
// unspent roll, announces a deliberate re-roll, and rolls how many appear exactly once.

// Each `new Roll(formula)` answers the next queued total set; 5d4 reads `dice[0].results`.
let queue = [];
function queueRolls(...rolls) { queue.push(...rolls); }
class FakeRoll {
	constructor(formula) { this.formula = formula; }
	async evaluate() {
		const next = queue.shift();
		if (Array.isArray(next)) {
			this.dice = [{ results: next.map(result => ({ result })) }];
			this.total = next.reduce((a, b) => a + b, 0);
		} else {
			this.total = next;
		}
		return this;
	}
}

let actorSeq = 0;
function makeDialog(onApply = vi.fn()) {
	const actor = { uuid: `Actor.callup${++actorSeq}`, id: `callup${actorSeq}` };
	const d = new CallUpDeepOnesDialog(actor, { id: "ring", name: "The Ring", loyalty: 2, hasRing: true }, onApply);
	d.render = vi.fn();
	d.close = vi.fn();
	return { d, actor, onApply };
}

beforeEach(() => {
	queue = [];
	global.Roll = FakeRoll;
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: vi.fn(() => ({})) };
});
afterEach(() => { delete global.Roll; });

describe("CallUpDeepOnesDialog dice", () => {
	it("reopening the window for the same character keeps the unspent roll", async () => {
		const { d, actor } = makeDialog();
		queueRolls([3, 1, 4, 2, 2]);
		await d._rollDice();
		const again = new CallUpDeepOnesDialog(actor, { hasRing: true }, vi.fn());
		queueRolls([4, 4, 4, 4, 4]);
		await again._rollDice();
		expect(again._dice).toEqual([3, 1, 4, 2, 2]);
	});

	it("a re-roll replaces the dice and says so in chat, old and new", async () => {
		const { d } = makeDialog();
		queueRolls([3, 1, 4, 2, 2], [1, 1, 2, 3, 4]);
		await d._rollDice();
		await d._reroll();
		expect(d._dice).toEqual([1, 1, 2, 3, 4]);
		const content = ChatMessage.create.mock.calls.at(-1)[0].content;
		expect(content).toContain("3, 1, 4, 2, 2");
		expect(content).toContain("1, 1, 2, 3, 4");
	});

	it("swapping the No. Appearing die rolls nothing; the headcount is rolled once, at Manifest", async () => {
		const { d, onApply } = makeDialog();
		// tags 2, number 1 (horde), size 3, traits 1, moves 1
		queueRolls([2, 1, 3, 1, 1]);
		await d._rollDice();
		d._assignDie("number", 2);
		d._assignDie("number", 1);
		expect(queue).toHaveLength(0);
		d._traits = ["hide"];
		d._moves = ["Heal at a prodigious rate"];
		queueRolls(7);
		await d._finish();
		const { input, cost } = onApply.mock.calls[0][0];
		expect(cost.countRoll).toEqual({ formula: "2d6", total: 7 });
		expect(input.size).toBe(7);
	});

	it("a manifested roll is spent: the next Call Up rolls afresh", async () => {
		const { d, actor } = makeDialog();
		queueRolls([4, 1, 1, 1, 1]);
		await d._rollDice();
		d._assign = { tags: 1, number: 0, size: 2, traits: 3, moves: 4 };   // number = 4 (solitary)
		d._traits = ["hide"];
		d._moves = ["Heal at a prodigious rate"];
		await d._finish();
		const next = new CallUpDeepOnesDialog(actor, { hasRing: true }, vi.fn());
		queueRolls([2, 2, 2, 2, 2]);
		await next._rollDice();
		expect(next._dice).toEqual([2, 2, 2, 2, 2]);
	});
});
