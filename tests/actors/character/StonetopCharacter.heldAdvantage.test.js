import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { buildLiveCharacter, makeLiveItem, resetLiveIds } from "../../fakes/LiveCharacter.js";

// A HELD advantage — "take advantage on your next roll", promised by something that has already
// happened (Make Camp's peaceful night, Book I p.334). Driven through a real StonetopCharacter,
// because the whole point of the flag is where it sits in the roll path: it has to outrank the
// two things that would otherwise decide the mode, and it has to be SPENT by the roll it was
// promised to rather than riding along on every roll after it.

let rolled;

function camper({ held = null, sticky = "normal", weakened = false } = {}) {
	const flags = { rollMode: sticky };
	if (held) flags.heldAdvantage = held;
	const { char, actor } = buildLiveCharacter({
		slug: "the-marshal", name: "The Marshal", seedStartingMoves: false,
		items: [makeLiveItem({ name: "Read a Bad Situation", type: "move", system: { rollType: "int" } })],
		flags,
	});
	if (weakened) actor.system.attributes.debilities.options.weakened.value = true;
	return { char, actor };
}

const PEACEFUL = { source: "A peaceful night's rest" };

beforeEach(() => {
	resetLiveIds();
	rolled = [];
	// onDirectStatRoll imports the roll engine lazily; the mode it hands over is the whole
	// assertion, so the engine is captured rather than run.
	vi.doMock("../../../module/utils/roll-engine.js", () => ({
		rollStat: vi.fn(async (stat, actor, options) => { rolled.push({ stat, options }); return { total: 7 }; }),
	}));
});

afterEach(() => vi.doUnmock("../../../module/utils/roll-engine.js"));

describe("a held advantage", () => {
	it("rolls the next roll at advantage and names what promised it", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("adv");
		expect(rolled[0].options.conditionNotes).toContain("A peaceful night's rest");
	});

	// The promise is about ONE roll. Left standing it would quietly upgrade every roll after it,
	// which is what parking it on the sticky selector used to do.
	it("is spent by that roll and gone from the next", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.onDirectStatRoll("int");
		expect(char.heldAdvantage()).toBeNull();
		await char.onDirectStatRoll("int");
		expect(rolled[1].options.rollMode).toBe("normal");
		expect(rolled[1].options.conditionNotes ?? []).not.toContain("A peaceful night's rest");
	});

	// The sticky selector and the pre-roll window are PREFERENCES; this is a rule the fiction
	// already settled, so it outranks both as a SOURCE of advantage. The window's answer arrives
	// as an explicit rollMode.
	it("outranks the pre-roll window's Normal", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.onDirectStatRoll("int", { rollMode: "normal" });
		expect(rolled[0].options.rollMode).toBe("adv");
	});

	// But it never beats a DISADVANTAGE, wherever that came from: adv and dis cancel, so a player
	// who picked Disadvantage in the window because they are doing this in the dark gets a flat
	// roll, not a silent upgrade past their own answer.
	it("cancels against a Disadvantage picked in the pre-roll window", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.onDirectStatRoll("int", { rollMode: "dis" });
		expect(rolled[0].options.rollMode).toBe("normal");
		expect(rolled[0].options.conditionNotes).toContain("A peaceful night's rest");
	});

	it("cancels against a sticky Disadvantage on the sheet", async () => {
		const { char } = camper({ held: PEACEFUL, sticky: "dis" });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("normal");
	});

	// Spent either way. The promise was made about this roll, and this is the roll that happened.
	it("is spent even when it only cancelled a disadvantage", async () => {
		const { char } = camper({ held: PEACEFUL, sticky: "dis" });
		await char.onDirectStatRoll("int");
		expect(char.heldAdvantage()).toBeNull();
	});

	// It does NOT outrank a debility, because advantage and disadvantage cancel — a character who
	// camped peacefully and is still Weakened rolls flat. The pill still names the promise, so a
	// player can see the trade rather than watch an advantage vanish.
	it("cancels against a debility rather than beating it", async () => {
		const { char } = camper({ held: PEACEFUL, weakened: true });
		await char.onDirectStatRoll("str");
		expect(rolled[0].options.rollMode).toBe("normal");
		expect(rolled[0].options.conditionNotes).toContain("A peaceful night's rest");
		expect(rolled[0].options.stonetopDebility).toBe("Weakened");
	});

	it("leaves an ordinary roll alone when nothing is held", async () => {
		const { char } = camper();
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("normal");
		expect(rolled[0].options.conditionNotes).toBeUndefined();
	});
});
