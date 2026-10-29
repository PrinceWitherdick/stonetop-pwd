import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndeathDialog } from "../../../../module/actors/character/dialogs/UndeathDialog.js";
import { DeathsDoorDialog } from "../../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { StonetopCharacter } from "../../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../../module/actors/character/deaths-door.js";
import { buildPostDeathChoices } from "../../../../module/actors/character/post-death-choices.js";
import { FakeRepositoryFactory } from "../../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../../fakes/LiveCharacter.js";
import { readRepo } from "../../../fakes/css.js";

// The three inserts as they SHIP, so every Consequence and Mark the dialog offers is the book's.
const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));

const THRALL_MARKS = ["a-festering-rot", "child-of-the-deeps", "death-mask", "quicksilver-dreams", "ravenous",
	"red-wrath", "shadows-cold-embrace", "speak-truth-whisper-secrets", "torments-blessing"];

/**
 * A character wearing `slug`, at 0 HP of 16 and dying: the moment their 0-HP move is for. The actor is the
 * stateful live one, so what a write puts on it can be read back off it; `counts` seeds the insert's lore.
 */
function makeUndead(slug, { counts = {}, insert = {}, hp = 0 } = {}) {
	const actor = makeLiveActor({
		name: "Vess",
		flags: { deathsDoor: DEATHS_DOOR_STATE.DYING, postDeathInsert: { slug, ...insert }, postDeathLore: { counts } },
	});
	actor.system.attributes.hp = { value: hp, max: 16 };
	actor.system.attributes.wounds = [];
	const factory = new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	});
	return { actor, char: new StonetopCharacter(actor, factory) };
}

const flag = (actor, key) => actor.flags["stonetop-pwd"][key];
const count = (actor, key) => Number(actor.flags["stonetop-pwd"].postDeathLore?.counts?.[key] ?? 0);

/** Where _onRoll leaves the window once the dice land on `tierKey`. */
async function landed(char, tierKey) {
	const dialog = await UndeathDialog.open(char, () => {});
	dialog._tierKey = tierKey;
	dialog._step = "resolve";
	dialog._syncForcedPicks();
	return dialog;
}

/** Apply, counting the writes it makes. */
async function apply(dialog, actor) {
	actor.update.mockClear();
	expect(dialog.getData().canApply).toBe(true);
	await dialog._onApply();
	return actor.update.mock.calls.length;
}

beforeEach(() => {
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
});
afterEach(() => { delete global.ChatMessage; });

describe("UndeathDialog._onApply: Undying, per tier, in one write", () => {
	it("10+: half max HP back, the one cost taken, and on their feet", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "success");
		dialog._setPicked("maim", true);

		expect(await apply(dialog, actor)).toBe(1);

		expect(actor.system.attributes.hp.value).toBe(8);
		expect(actor.system.attributes.wounds).toHaveLength(1);
		expect(actor.system.attributes.wounds[0].status).toBe("permanent");
		expect(flag(actor, "deathsDoor")).toBeNull();
		expect(dialog._summary[0]).toContain("8 HP");
	});

	// Half max HP AND out of the action: the write names the state itself, and the preUpdate hook keeps it
	// (tests/hooks/DeathsDoorPromptState.test.js pins that half).
	it("7-9: half max HP, a consequence, and out of the action, together", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "partial");
		dialog._setPicked("consequence", true);
		dialog._setChoice("consequence", "nightkin");
		dialog._setPicked("out-of-action", true);

		expect(await apply(dialog, actor)).toBe(1);

		expect(actor.system.attributes.hp.value).toBe(8);
		expect(count(actor, "consequences:nightkin")).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
	});

	it("6-: 1 HP and all three, one write", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "failure");
		expect([...dialog._picked].sort()).toEqual(["consequence", "maim", "out-of-action"]);
		dialog._setChoice("consequence", "breakdown");

		expect(await apply(dialog, actor)).toBe(1);

		expect(actor.system.attributes.hp.value).toBe(1);
		expect(count(actor, "consequences:breakdown")).toBe(1);
		expect(actor.system.attributes.wounds).toHaveLength(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
	});

	// A failed write leaves nothing behind, so the retry the latch allows cannot maim them twice.
	it("writes nothing on a failure, and a retry lands it once", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "failure");
		dialog._setChoice("consequence", "breakdown");
		const real = actor.update.getMockImplementation();
		actor.update.mockImplementationOnce(async () => { throw new Error("refused"); });

		await expect(dialog._onApply()).rejects.toThrow("refused");
		expect(actor.system.attributes.wounds).toHaveLength(0);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DYING);

		actor.update.mockImplementation(real);
		await dialog._onApply();
		expect(actor.system.attributes.wounds).toHaveLength(1);
	});
});

describe("UndeathDialog._onApply: Tethered", () => {
	it("marks the consequence, names the tether and disperses them, in one write, with no HP yet", async () => {
		const { actor, char } = makeUndead("ghost");
		const dialog = await UndeathDialog.open(char, () => {});
		expect([...dialog._picked]).toEqual(["consequence"]);
		dialog._setChoice("consequence", "specter");
		dialog._tether = "The oak where I fell";

		expect(await apply(dialog, actor)).toBe(1);

		expect(count(actor, "consequences:specter")).toBe(1);
		expect(flag(actor, "postDeathInsert").tether).toBe("The oak where I fell");
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		expect(actor.system.attributes.hp.value).toBe(0);
	});

	it("a destroyed tether marks the Final Consequence and takes them out of play, one write", async () => {
		const { actor, char } = makeUndead("ghost", { insert: { tether: "My bones" } });
		const dialog = await UndeathDialog.open(char, () => {});
		dialog._setChoice("consequence", "specter");
		dialog._tetherDestroyed = true;

		expect(await apply(dialog, actor)).toBe(1);

		expect(count(actor, "consequences:final-consequence")).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
		expect(char.lostToTheGm).toBe("monster");
	});
});

describe("UndeathDialog._onApply: Dark Succor", () => {
	it("10+: the task, and Favor reset, out of the action, one write", async () => {
		const { actor, char } = makeUndead("thrall", { counts: { "favor:favor-track": 2 } });
		const dialog = await landed(char, "success");
		dialog._setPicked("task", true);
		dialog._setChoice("task", "Drown the shrine");

		expect(await apply(dialog, actor)).toBe(1);

		expect(flag(actor, "postDeathInsert").task).toBe("Drown the shrine");
		expect(count(actor, "favor:favor-track")).toBe(0);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
	});

	it("names a task still standing before a new one takes its place", async () => {
		const standing = await landed(makeUndead("thrall", { insert: { task: "Drown the shrine" } }).char, "success");
		expect(standing.getData().standingTask).toContain("Drown the shrine");
		const none = await landed(makeUndead("thrall").char, "success");
		expect(none.getData().standingTask).toBe("");
	});

	it("7-9: gains one Mark and crosses off another", async () => {
		const { actor, char } = makeUndead("thrall");
		const dialog = await landed(char, "partial");
		dialog._setPicked("mark-gain", true);
		dialog._setChoice("mark-gain", "ravenous");
		dialog._setPicked("mark-crossoff", true);
		dialog._setChoice("mark-crossoff", "red-wrath");

		expect(await apply(dialog, actor)).toBe(1);

		expect(count(actor, "marks:ravenous")).toBe(1);
		expect(flag(actor, "postDeathInsert").crossedOff).toEqual(["red-wrath"]);
	});

	it("6-: all three apply, in one write", async () => {
		const { actor, char } = makeUndead("thrall");
		const dialog = await landed(char, "failure");
		expect([...dialog._picked].sort()).toEqual(["mark-crossoff", "mark-gain", "task"]);
		dialog._setChoice("mark-gain", "death-mask");
		dialog._setChoice("mark-crossoff", "ravenous");
		dialog._setChoice("task", "Bring me the Judge's tongue");

		expect(await apply(dialog, actor)).toBe(1);

		expect(count(actor, "marks:death-mask")).toBe(1);
		expect(flag(actor, "postDeathInsert").crossedOff).toEqual(["ravenous"]);
		expect(flag(actor, "postDeathInsert").task).toBe("Bring me the Judge's tongue");
	});

	/**
	 * The deadlock: one Mark left, and a 6- demanding both the gain and the cross-off. Each dropdown hid the
	 * other's pick, so they could never both be answered and Apply never lit. The gain comes first: it takes
	 * the last Mark, and there is no Mark left that they don't have to cross off.
	 */
	it("with one Mark left, a 6- gains it and has nothing left to cross off", async () => {
		const held = Object.fromEntries(THRALL_MARKS.slice(1).map(m => [`marks:${m}`, 1]));
		const { actor, char } = makeUndead("thrall", { counts: held });
		const dialog = await landed(char, "failure");

		expect([...dialog._picked].sort()).toEqual(["mark-gain", "task"]);
		expect(dialog.getData().effects.find(e => e.kind === "mark-crossoff").exhausted).toBe(true);
		dialog._setChoice("mark-gain", "a-festering-rot");
		dialog._setChoice("task", "Feed the deep");

		expect(await apply(dialog, actor)).toBe(1);
		expect(count(actor, "marks:a-festering-rot")).toBe(1);
		expect(flag(actor, "postDeathInsert").crossedOff).toBeUndefined();
	});

	// And a 7-9 that picks the cross-off first gives the last Mark back to the gain the moment it is taken.
	it("drops a cross-off that would take the gain's only Mark", async () => {
		const held = Object.fromEntries(THRALL_MARKS.slice(1).map(m => [`marks:${m}`, 1]));
		const { char } = makeUndead("thrall", { counts: held });
		const dialog = await landed(char, "partial");
		dialog._setPicked("mark-crossoff", true);
		dialog._setChoice("mark-crossoff", "a-festering-rot");

		dialog._setPicked("mark-gain", true);

		expect(dialog._picked.has("mark-crossoff")).toBe(false);
		expect(dialog._selectableFor("mark-gain").map(o => o.slug)).toEqual(["a-festering-rot"]);
	});
});

describe("UndeathDialog: Unholy Vessel", () => {
	// Every Mark held or crossed off: "When you would gain a Mark but there are none left to gain, your humanity
	// is utterly lost. You become a threat in the GM's control."
	function spent() {
		const counts = Object.fromEntries(THRALL_MARKS.slice(0, 7).map(m => [`marks:${m}`, 1]));
		return makeUndead("thrall", { counts, insert: { crossedOff: THRALL_MARKS.slice(7) } });
	}

	it("on a 6-, owes a Mark there is none of, and takes them out of play in one write", async () => {
		const { actor, char } = spent();
		const dialog = await landed(char, "failure");

		const data = dialog.getData();
		expect(data.unholyVessel).not.toBeNull();
		expect(data.applyLabel).toBe("Lose your humanity");

		expect(await apply(dialog, actor)).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
		expect(char.lostToTheGm).toBe("threat");
		expect(dialog._summary[0]).toContain("Unholy Vessel");
	});

	it("on a 7-9, the task alone can't cover two costs, so the gain is owed", async () => {
		const { char } = spent();
		expect((await landed(char, "partial")).getData().unholyVessel).not.toBeNull();
	});

	it("on a 10+, the task pays for it and nothing is lost", async () => {
		const { char } = spent();
		expect((await landed(char, "success")).getData().unholyVessel).toBeNull();
	});
});

describe("UndeathDialog._onAlternative: the Revenant who becomes a Ghost", () => {
	it("swaps in one write, out of the action, and asks for a FRESH first Consequence", async () => {
		// BREAKDOWN is printed on both inserts, so the prune keeps it; CARRION STENCH is the Revenant's own.
		const { actor, char } = makeUndead("revenant", {
			counts: { "consequences:breakdown": 1, "consequences:carrion-stench": 1, "terrible-purpose:longing": 1 },
		});
		const dialog = await landed(char, "failure");
		dialog._openChoices = vi.fn(async () => {});
		// Asked first since 2026-10-27 (UndeathDialog.fixes.test.js covers the question itself).
		dialog._confirmGhost = vi.fn(async () => true);
		dialog._insertRepo = new FakePostDeathInsertRepository(INSERTS);
		actor.update.mockClear();

		await dialog._onAlternative("ghost");

		const slugWrites = actor.update.mock.calls.map(([d]) => d)
			.filter(d => "flags.stonetop-pwd.postDeathInsert.slug" in d);
		// The prune rides in the same write (audit RV-6): CARRION STENCH goes with the slug, never before it.
		expect(slugWrites).toHaveLength(1);
		expect(slugWrites[0]).toMatchObject({
			"flags.stonetop-pwd.postDeathInsert.slug": "ghost",
			"flags.stonetop-pwd.deathsDoor": DEATHS_DOOR_STATE.OUT_OF_ACTION,
		});
		expect(Object.keys(slugWrites[0]).filter(k => k.includes("carrion-stench"))).toHaveLength(1);
		expect(Object.keys(slugWrites[0]).some(k => k.includes("breakdown"))).toBe(false);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		expect(dialog._openChoices).toHaveBeenCalledWith({ consequences: ["breakdown", "carrion-stench"] });
		// The summary no longer sends them to the tab for a Purpose they already have.
		expect(dialog._summary.join(" ")).not.toContain("Post-Death tab");
		expect(dialog._summary[0]).toContain("Terrible Purpose stays with you");

		// The choices step it opens: BREAKDOWN came along, ticked and locked, and does not answer it.
		const vm = await buildPostDeathChoices(char, { carried: dialog._openChoices.mock.calls[0][0] });
		const step = vm.steps.find(s => s.key === "consequence");
		expect(step.done).toBe(false);
		const breakdown = step.options.find(o => o.slug === "breakdown");
		expect(breakdown).toMatchObject({ marked: true, carried: true, locked: true });
		// The Terrible Purpose was kept, and still answers its own step.
		expect(vm.steps.find(s => s.key === "purpose").chosenSlug).toBe("longing");
		// A Consequence of the Ghost's own is still on offer, and taking it answers the step.
		expect(step.options.find(o => o.slug === "specter").locked).toBe(false);
		await char.markSectionOption("consequences", "specter");
		const after = await buildPostDeathChoices(char, { carried: { consequences: ["breakdown", "carrion-stench"] } });
		expect(after.steps.find(s => s.key === "consequence").done).toBe(true);
	});

	// The window it opens is Death's Door's own choices step, on the Ghost's first Consequence.
	it("opens Death's Door's choices step on the Consequence, in the Ghost's own words", async () => {
		const { char } = makeUndead("ghost", {
			counts: { "consequences:breakdown": 1, "terrible-purpose:longing": 1 },
		});
		const window = await DeathsDoorDialog.openChoices(char, () => {}, { carried: { consequences: ["breakdown"] }, taken: "undying" });

		const data = window.getData();
		expect(data.isChoices).toBe(true);
		expect(data.choicesIntro).toContain("Terrible Purpose stays with you");
		expect(data.choices.steps.find(s => s.key === "consequence").done).toBe(false);
	});
});
