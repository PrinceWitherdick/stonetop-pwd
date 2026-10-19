// The Heavy's Bringer of Ruin (Heavy re-audit, 2026-10-18): "When you roll a 12+ to Clash and your foe
// survives, name something they possess ... Whatever you name, it is broken, shattered, lost. Tell us how."
// It did nothing. Learned, every Clash card carries its line on the 10+ row of a 12+ (roll-engine's
// `criticalActions`, as A Force to Be Reckoned With's prints), with nothing to tick in the roll window.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { rollStat } from "../../../module/utils/roll-engine.js";

// A Clash is an attack: its weapon and targets are asked first (combat/attack-flow.js#maybeBeginAttack).
// Not an attack here unless a test says otherwise, so no prompt opens.
const seams = vi.hoisted(() => ({ begin: null }));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, maybeBeginAttack: (...args) => (seams.begin ? seams.begin(...args) : null) };
});

const SCOPE = "stonetop-pwd";
const BRINGER = "Bringer of Ruin";

let rollTotal;
let rollMessages;
beforeEach(() => {
	rollTotal = 12;
	rollMessages = [];
	global.game.settings = { get: vi.fn(() => "publicroll") };
	global.ChatMessage = { getSpeaker: vi.fn(() => ({ alias: "The Heavy" })), create: vi.fn() };
	global.Roll = class {
		constructor(formula) { this.formula = formula; this.total = rollTotal; this.dice = [{ results: [{ result: 6, active: true }, { result: 6, active: true }] }]; }
		async evaluate() { return this; }
		async toMessage(message) { rollMessages.push(message); }
	};
});
afterEach(() => { seams.begin = null; });

function heavy({ moves = [BRINGER] } = {}) {
	const rolled = (name, rollType) => ({ _id: `${name}-1`, name, type: "move", system: { rollType }, roll: vi.fn(async () => ({ total: rollTotal })) });
	const clash = rolled("Clash", "str");
	const defy = rolled("Defy Danger", "dex");
	const made = buildLiveCharacter({
		slug: "the-heavy", name: "The Heavy", seedStartingMoves: false,
		items: moves.map(m => makeLiveItem({ name: m.name ?? m, type: "move", system: { moveType: "playbook" }, flags: m.learned === false ? { [SCOPE]: { learned: false } } : undefined })),
	});
	const items = [...made.actor.items, clash, defy];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	const roll = (item, prompted = {}) => made.char.onRoll({
		currentTarget: { closest: sel => (sel === ".item" ? { dataset: { itemId: item._id } } : null), getAttribute: () => null },
	}, prompted);
	return { ...made, clash, defy, roll };
}
const rolledWith = item => item.roll.mock.calls[0][0];

// The card the options would print, on the total given: the real roll engine, so a 10 or 11 is seen to say nothing.
async function cardOf(options, total) {
	rollTotal = total;
	rollMessages = [];
	await rollStat("str", { type: "stonetop", name: "The Heavy", system: {} }, { ...options, statValue: 0, noXpOnMiss: true });
	return rollMessages[0].flavor;
}

describe("Bringer of Ruin on a Clash", () => {
	it("prints its line on a 12+ Clash once learned, with no line to tick", async () => {
		const { char, clash, roll } = heavy();
		expect((await char.rollOffers(clash)).map(o => o.key)).not.toContain("bringer-of-ruin");
		await roll(clash);
		const options = rolledWith(clash);
		expect(options.criticalActions).toContain("Bringer of Ruin:");
		expect(options.criticalActions).toContain("broken, shattered, lost");
		expect(options.tierActions?.success ?? "").not.toContain("Bringer of Ruin");
		expect(await cardOf(options, 12)).toContain("Bringer of Ruin:");
	});

	// The 12+ row is still printed on a 10 or 11, hidden, so a Shift or +1 up to 12+ can show it
	// (roll-engine's `data-critical` row).
	it("keeps the note hidden on a 10 or an 11", async () => {
		const { clash, roll } = heavy();
		await roll(clash);
		const hiddenRow = /<div class="[^"]*stonetop-roll-critical-action"[^>]*hidden="hidden"[^>]*>(?:(?!<\/div>).)*Bringer of Ruin/s;
		for (const total of [10, 11]) {
			const card = await cardOf(rolledWith(clash), total);
			expect(card).toContain("result success");
			expect(card).toMatch(hiddenRow);
		}
		expect(await cardOf(rolledWith(clash), 12)).not.toMatch(hiddenRow);
	});

	it("rides a Clash aimed at a foe on the map, after the attack's own 10+ actions", async () => {
		seams.begin = async () => ({
			tierActions: { success: "<button>Roll damage</button>" },
			messageFlags: { [SCOPE]: { attack: { moveKey: "clash", targets: [{ uuid: "Scene.s.Token.t1", name: "Bandit", actorId: "a1" }] } } },
		});
		const { clash, roll } = heavy();
		await roll(clash);
		const card = await cardOf(rolledWith(clash), 12);
		expect(card.indexOf("Roll damage")).toBeGreaterThan(-1);
		expect(card.indexOf("Roll damage")).toBeLessThan(card.indexOf("Bringer of Ruin"));
	});

	it("rides a Clash rolled with no move item behind it (a guided roll by name)", async () => {
		const { char } = heavy();
		await char.onDirectStatRoll("str", { moveName: "Clash", targets: [] });
		expect(rollMessages[0].flavor).toContain("Bringer of Ruin:");
	});

	it("is absent without the move, with it unlearned, and on any move but Clash", async () => {
		const none = heavy({ moves: [] });
		await none.roll(none.clash);
		expect(rolledWith(none.clash).criticalActions).toBeUndefined();
		const unlearned = heavy({ moves: [{ name: BRINGER, learned: false }] });
		await unlearned.roll(unlearned.clash);
		expect(rolledWith(unlearned.clash).criticalActions).toBeUndefined();
		const other = heavy();
		await other.roll(other.defy);
		expect(rolledWith(other.defy).criticalActions).toBeUndefined();
		expect(other.char._foldStandingNotes({}, "Let Fly").criticalActions).toBeUndefined();
	});
});
