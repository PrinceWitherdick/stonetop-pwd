import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeathsDoorDialog } from "../../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import { UndeathDialog } from "../../../../module/actors/character/dialogs/UndeathDialog.js";
import { StonetopCharacter } from "../../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../../module/actors/character/deaths-door.js";
import { FakeRepositoryFactory } from "../../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../../fakes/LiveCharacter.js";
import { readRepo } from "../../../fakes/css.js";

// Audit DD-1: a 0-HP move's roll is a roll like any other. "If someone tries to save the dying PC (tending to
// wounds, etc.), then they're Aiding the Death's Door roll" (Book I p.245), and Aid's answer is "they gain
// advantage on their roll". Both windows used to roll at a hard-wired Normal, so an Aid's advantage was left
// held and spent by whatever the character rolled next. Driven through a real StonetopCharacter, because where
// the held promise is folded and spent is the whole question.

const rolled = vi.hoisted(() => []);
const rollStat = vi.hoisted(() => vi.fn(async (stat, actor, options) => { rolled.push({ stat, options }); return { total: 8 }; }));
vi.mock("../../../../module/utils/roll-engine.js", async importOriginal => ({ ...(await importOriginal()), rollStat }));
const promptRoll = vi.hoisted(() => vi.fn(async () => ({ situational: 0 })));
vi.mock("../../../../module/dialogs/RollDialog.js", async importOriginal => ({ ...(await importOriginal()), promptRoll }));

const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));

const AID = { sources: ["Aeron's Aid"] };

/** A character at 0 HP and dying, holding an Aid's advantage; `slug` puts an insert on them. */
function dying({ slug = null, flags = {} } = {}) {
	const actor = makeLiveActor({
		name: "Blodwen",
		flags: {
			deathsDoor: DEATHS_DOOR_STATE.DYING,
			heldAdvantage: AID,
			...(slug ? { postDeathInsert: { slug }, postDeathLore: { counts: {} } } : {}),
			...flags,
		},
	});
	actor.system.attributes.hp = { value: 0, max: 16 };
	actor.system.attributes.wounds = [];
	const factory = new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	});
	return { actor, char: new StonetopCharacter(actor, factory) };
}

const saved = {};
beforeEach(() => {
	rolled.length = 0;
	rollStat.mockClear();
	promptRoll.mockReset();
	promptRoll.mockImplementation(async () => ({ situational: 0 }));
	saved.user = game.user;
	saved.users = game.users;
	game.user = { id: "p1", name: "Aline" };
	// No GM connected: the window claims the roll itself.
	game.users = { get: () => null, activeGM: null, contents: [] };
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
});
afterEach(() => {
	game.user = saved.user;
	game.users = saved.users;
	delete global.ChatMessage;
});

describe("Death's Door rolls like any other roll", () => {
	it("takes an Aid's advantage, names it, and spends it", async () => {
		const { char } = dying();
		const dialog = new DeathsDoorDialog(char, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();

		await dialog._onRoll();

		expect(rolled).toHaveLength(1);
		expect(rolled[0].options).toMatchObject({ rollMode: "adv", noXpOnMiss: true, statValue: 0, moveName: "Death's Door" });
		expect(rolled[0].options.conditionNotes).toContain("Aeron's Aid");
		// Spent by this roll, not left for the next one.
		expect(char.heldAdvantage()).toBeNull();
		expect(dialog._applyTier).toHaveBeenCalledWith("partial");
	});

	it("follows the pre-roll window, and Unstoppable's penalty rides its one-off modifier", async () => {
		const { char } = dying({ flags: { heldAdvantage: null } });
		char.deathsDoorRollOptions = () => ({ statChoices: [{ stat: "", label: "+nothing" }], penalty: -2 });
		promptRoll.mockImplementation(async () => ({ rollMode: "dis", situational: 1 }));
		const dialog = new DeathsDoorDialog(char, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();

		await dialog._onRoll({ shiftKey: true });

		expect(promptRoll).toHaveBeenCalledWith(expect.objectContaining({ title: "Death's Door", shiftKey: true }));
		expect(rolled[0].options).toMatchObject({ rollMode: "dis", modifier: -1, noXpOnMiss: true });
	});

	it("backing out of the pre-roll window rolls nothing and claims nothing", async () => {
		const { actor, char } = dying();
		promptRoll.mockImplementation(async () => null);
		const dialog = new DeathsDoorDialog(char, () => {});
		dialog.renderIfOpen = vi.fn();
		actor.update.mockClear();

		await dialog._onRoll();

		expect(rollStat).not.toHaveBeenCalled();
		expect(actor.update).not.toHaveBeenCalled();
		expect(char.heldAdvantage()).toMatchObject(AID);
	});
});

describe("an insert's 0-HP move rolls like any other roll", () => {
	it("Undying takes an Aid's advantage and spends it", async () => {
		const { char } = dying({ slug: "revenant" });
		const dialog = await UndeathDialog.open(char, () => {});
		dialog.renderIfOpen = vi.fn();

		await dialog._onRoll();

		expect(rolled).toHaveLength(1);
		expect(rolled[0].stat).toBe("con");
		expect(rolled[0].options).toMatchObject({ rollMode: "adv", noXpOnMiss: true, moveName: "Undying" });
		expect(char.heldAdvantage()).toBeNull();
	});
});
