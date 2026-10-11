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

const PEACEFUL = { sources: ["A peaceful night's rest"] };

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

// Its other half: Interfere's "do it anyway, but with disadvantage on their (next) roll", held the
// same way and spent the same way. Both sides can be held at once (a peaceful night, then someone
// gets in the way), and advantage and disadvantage cancel (p.230).
describe("a held disadvantage", () => {
	const INTERFERED = { sources: ["Interfered with by Bram"] };

	function interfered({ held = null, dis = INTERFERED, sticky = "normal" } = {}) {
		const made = camper({ held, sticky });
		made.actor.flags["stonetop-pwd"].heldDisadvantage = dis;
		return made;
	}

	it("rolls the next roll at disadvantage, names who, and is spent by it", async () => {
		const { char } = interfered();
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("dis");
		expect(rolled[0].options.conditionNotes).toContain("Interfered with by Bram");
		expect(char.heldDisadvantage()).toBeNull();
		await char.onDirectStatRoll("int");
		expect(rolled[1].options.rollMode).toBe("normal");
	});

	it("cancels a held advantage, and both are named and both spent", async () => {
		const { char } = interfered({ held: PEACEFUL });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("normal");
		expect(rolled[0].options.conditionNotes).toEqual(expect.arrayContaining(["A peaceful night's rest", "Interfered with by Bram"]));
		expect(char.heldAdvantage()).toBeNull();
		expect(char.heldDisadvantage()).toBeNull();
	});

	// All at once, never pairwise: a sticky Disadvantage and a held advantage cancel, and the held
	// disadvantage is on the side that already spoke, so the roll stays straight.
	it("folds every side at once, so a sticky Disadvantage plus both promises rolls straight", async () => {
		const { char } = interfered({ held: PEACEFUL, sticky: "dis" });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("normal");
	});

	it("does not stack with a sticky Disadvantage", async () => {
		const { char } = interfered({ sticky: "dis" });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("dis");
	});

	// And across the stages the roll is built in: the debility is folded after the promises, in a
	// method of its own, and must see the sticky Advantage they cancelled, not the straight roll they
	// left. One side each way (Advantage; Interfere and Weakened) is a straight roll.
	it("folds the debility with the promises, not onto the roll they left", async () => {
		const made = camper({ sticky: "adv", weakened: true });
		made.actor.flags["stonetop-pwd"].heldDisadvantage = INTERFERED;
		await made.char.onDirectStatRoll("str");
		expect(rolled[0].options.rollMode).toBe("normal");
		expect(rolled[0].options.stonetopDebility).toBe("Weakened");
	});
});

describe("holding another promise", () => {
	it("keeps both names when a second advantage is promised before the roll", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.holdAdvantage("Bram's Aid");
		expect(char.heldAdvantage()).toEqual({
			sources: ["A peaceful night's rest", "Bram's Aid"], source: "A peaceful night's rest & Bram's Aid",
		});
	});

	// The camp's one-write form, too: a peaceful night after an Aid keeps the Aid's name.
	it("keeps the earlier name in the camp's update fragment", () => {
		const { char } = camper({ held: { sources: ["Bram's Aid"] } });
		expect(char.heldAdvantageData("A peaceful night's rest")).toEqual({
			"flags.stonetop-pwd.heldAdvantage": { sources: ["Bram's Aid", "A peaceful night's rest"] },
		});
		// Several names in one fragment: the camp's peaceful night and fur-lined bedroll.
		expect(char.heldAdvantageData(["A peaceful night's rest", "A fur-lined bedroll"])).toEqual({
			"flags.stonetop-pwd.heldAdvantage": { sources: ["Bram's Aid", "A peaceful night's rest", "A fur-lined bedroll"] },
		});
	});

	// A gift taken back (its roll card moved off the tier that gave it) takes back its own name alone.
	it("takes back one promise by name and keeps the other held beside it", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.holdAdvantage("Aeron's Everything Burns");
		expect(await char.releaseHeldAdvantage("Aeron's Everything Burns")).toBe(true);
		expect(char.heldAdvantage()).toMatchObject(PEACEFUL);
		expect(await char.releaseHeldAdvantage("Aeron's Everything Burns")).toBe(false);
		expect(await char.releaseHeldAdvantage("A peaceful night's rest")).toBe(true);
		expect(char.heldAdvantage()).toBeNull();
	});

	// An Interfere's answer withdrawn takes back its own disadvantage, and nothing held beside it.
	it("takes back one disadvantage by name and leaves the advantage and the other name alone", async () => {
		const { char } = camper({ held: PEACEFUL });
		await char.holdDisadvantage("Interfered with by Bram");
		await char.holdDisadvantage("Interfered with by Cora");
		expect(await char.releaseHeldDisadvantage("Interfered with by Bram")).toBe(true);
		expect(char.heldDisadvantage()).toMatchObject({ sources: ["Interfered with by Cora"] });
		expect(char.heldAdvantage()).toMatchObject(PEACEFUL);
		expect(await char.releaseHeldDisadvantage("Interfered with by Bram")).toBe(false);
		expect(await char.releaseHeldDisadvantage("Interfered with by Cora")).toBe(true);
		expect(char.heldDisadvantage()).toBeNull();
	});

	it("does not repeat a name promised twice", async () => {
		const { char } = camper();
		await char.holdDisadvantage("Interfered with by Bram");
		await char.holdDisadvantage("Interfered with by Bram");
		expect(char.heldDisadvantage()).toEqual({ sources: ["Interfered with by Bram"], source: "Interfered with by Bram" });
	});

	// Stored as a list, so a name with its own ", " or " & " is held, shown and taken back whole.
	it("takes back a name with its own separators whole, and shows the names as one line", async () => {
		const { char } = camper();
		await char.holdDisadvantage("Interfered with by Bram, son of Tor");
		await char.holdDisadvantage("Interfered with by Rhys & Cora");
		await char.holdDisadvantage("Interfered with by Wren");
		expect(char.heldDisadvantage().source).toBe("Interfered with by Bram, son of Tor, Interfered with by Rhys & Cora & Interfered with by Wren");
		expect(await char.releaseHeldDisadvantage("Interfered with by Rhys")).toBe(false);
		expect(await char.releaseHeldDisadvantage("Interfered with by Rhys & Cora")).toBe(true);
		expect(char.heldDisadvantage()).toMatchObject({ sources: ["Interfered with by Bram, son of Tor", "Interfered with by Wren"] });
		expect(await char.releaseHeldDisadvantage("Interfered with by Bram, son of Tor")).toBe(true);
		expect(char.heldDisadvantage()).toMatchObject({ sources: ["Interfered with by Wren"] });
	});
});

// A world from before the list holds the names as the one line the card showed: `{source: "A & B"}`.
describe("a held promise written before its names were a list", () => {
	const OLD = { source: "A peaceful night's rest, Bram's Aid & Aeron's Everything Burns" };

	it("reads the old line as its names, and shows the same line", () => {
		const { char } = camper({ held: OLD });
		expect(char.heldAdvantage()).toEqual({
			sources: ["A peaceful night's rest", "Bram's Aid", "Aeron's Everything Burns"], source: OLD.source,
		});
	});

	it("takes back one of its names, and writes what is left as a list", async () => {
		const { char, actor } = camper({ held: OLD });
		expect(await char.releaseHeldAdvantage("Bram's Aid")).toBe(true);
		expect(actor.flags["stonetop-pwd"].heldAdvantage.sources).toEqual(["A peaceful night's rest", "Aeron's Everything Burns"]);
		expect(char.heldAdvantage().source).toBe("A peaceful night's rest & Aeron's Everything Burns");
	});

	it("lays a new promise beside its names", () => {
		const { char } = camper({ held: { source: "Bram's Aid" } });
		expect(char.heldAdvantageData("A peaceful night's rest")).toEqual({
			"flags.stonetop-pwd.heldAdvantage": { sources: ["Bram's Aid", "A peaceful night's rest"] },
		});
	});

	// Foundry merges a flag object into the one stored, so the old line stays beside the new list.
	it("reads the list over an old line left beside it", () => {
		const { char } = camper({ held: { source: "Bram's Aid", sources: ["A peaceful night's rest"] } });
		expect(char.heldAdvantage()).toEqual({ sources: ["A peaceful night's rest"], source: "A peaceful night's rest" });
	});

	it("still rolls at advantage and names it on the card", async () => {
		const { char } = camper({ held: OLD });
		await char.onDirectStatRoll("int");
		expect(rolled[0].options.rollMode).toBe("adv");
		expect(rolled[0].options.conditionNotes).toContain(OLD.source);
		expect(char.heldAdvantage()).toBeNull();
	});
});

// What the next roll is owed (the +forward, the held promises) is CLAIMED before the dice in one write, in the
// character's roll turn, and put back when no dice are thrown. The dice here wait on the test, so two rolls can
// be in flight at once, as a double-click or a second move rolled during the dice animation makes them.
describe("claiming what the next roll is owed", () => {
	let release;
	let failNext;
	beforeEach(async () => {
		release = [];
		failNext = false;
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => {
				if (failNext) { failNext = false; throw new Error("the card could not be posted"); }
				rolled.push({ stat, options });
				await new Promise(resolve => release.push(resolve));
				return { total: 7 };
			}),
		}));
		// Loaded once before two rolls import it at the same moment, so both are handed the mock.
		await import("../../../module/utils/roll-engine.js");
	});

	// Until `n` rolls are at their dice, waiting on the test.
	const atDice = n => vi.waitFor(() => expect(release.length).toBe(n));
	const releaseAll = () => { while (release.length) release.shift()(); };

	function forwardOf(actor) { return actor.system.attributes.forward.value; }

	// The second move is rolled while the first's dice are still rolling.
	it("gives the +forward to the first of two overlapping rolls, not both", async () => {
		const { char, actor } = camper();
		actor.system.attributes.forward = { value: 1 };
		const first = char.onDirectStatRoll("int");
		await atDice(1);
		const second = char.onDirectStatRoll("int");
		await atDice(2);
		releaseAll();
		await Promise.all([first, second]);
		expect(rolled.map(r => r.options.forward ?? 0)).toEqual([1, 0]);
		expect(forwardOf(actor)).toBe(0);
	});

	it("spends a held advantage on the first of two overlapping rolls, not both", async () => {
		const { char } = camper({ held: PEACEFUL });
		const first = char.onDirectStatRoll("int");
		await atDice(1);
		const second = char.onDirectStatRoll("int");
		await atDice(2);
		releaseAll();
		await Promise.all([first, second]);
		expect(rolled.map(r => r.options.rollMode)).toEqual(["adv", "normal"]);
	});

	// Two claims at the same moment (a double-click) are taken one after the other: the second reads what the
	// first left, which is nothing.
	it("hands what is owed to one of two claims made at once", async () => {
		const { char, actor } = camper({ held: PEACEFUL });
		actor.system.attributes.forward = { value: 1 };
		const claims = await Promise.all([char._claimNextRollOwed("Seek Insight"), char._claimNextRollOwed("Seek Insight")]);
		expect(claims.map(c => c.forward)).toEqual([1, 0]);
		expect(claims.map(c => c.held.adv?.sources ?? null)).toEqual([PEACEFUL.sources, null]);
	});

	// Cleared before the dice, so a +forward given while they are still rolling is the NEXT roll's, not wiped.
	it("leaves a +forward given while the dice are rolling for the roll after", async () => {
		const { char, actor } = camper();
		actor.system.attributes.forward = { value: 1 };
		const roll = char.onDirectStatRoll("int");
		await atDice(1);
		expect(forwardOf(actor)).toBe(0);
		actor.system.attributes.forward.value = 2;
		releaseAll();
		await roll;
		expect(rolled[0].options.forward).toBe(1);
		expect(forwardOf(actor)).toBe(2);
	});

	// A roll that throws before its dice made no roll: the +forward and both promises are put back.
	it("puts the +forward and the held promises back when the roll throws", async () => {
		const { char, actor } = camper({ held: PEACEFUL });
		actor.flags["stonetop-pwd"].heldDisadvantage = { sources: ["Interfered with by Bram, son of Tor", "Interfered with by Cora"] };
		actor.system.attributes.forward = { value: 1 };
		failNext = true;
		await expect(char.onDirectStatRoll("int")).rejects.toThrow("the card could not be posted");
		expect(forwardOf(actor)).toBe(1);
		expect(char.heldAdvantage()).toMatchObject(PEACEFUL);
		// Put back as the names they were, not as the one line the card shows.
		expect(char.heldDisadvantage()).toMatchObject({ sources: ["Interfered with by Bram, son of Tor", "Interfered with by Cora"] });
	});
});
