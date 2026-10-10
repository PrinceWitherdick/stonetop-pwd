import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { DeathsDoorDialog, tradeHardToKillDebility } from "../../../../module/actors/character/dialogs/DeathsDoorDialog.js";
import {
	DEATHS_DOOR_ROLL_FLAG, DEATHS_DOOR_ROLL_STALE_MS, DEATHS_DOOR_STATE, NEVER_GONNA_KEEP_ME_DOWN, isDeathsDoorCard,
} from "../../../../module/actors/character/deaths-door.js";
import { GAVE_IT_ALL_FLAG, offersGiveItAll } from "../../../../module/actors/character/impetuous-youth.js";
import { ROLLED_FLAG, rolledRecord } from "../../../../module/utils/counted-tier.js";
import { registerRollRewrite } from "../../../../module/utils/roll-rewrite.js";
import {
	DEATHS_DOOR_BOOST_QUERY, DEATHS_DOOR_CLAIM_QUERY, handleDeathsDoorBoostQuery, handleDeathsDoorClaimQuery,
} from "../../../../module/actors/character/deaths-door-relay.js";
import { stubAsk } from "../../../fakes/confirm.js";
import { readRepo } from "../../../fakes/css.js";
import { escHtml } from "../../../../module/utils/strings.js";
import { deletionEntry, deletionTarget } from "../../../../module/utils/foundry-compat.js";

// Only the roll itself is stood in for (the Battle Joy case below reads what it was handed), and the card it
// was posted as (none, unless a test hands one over: the Burn Brightly / Impetuous Youth cases below).
const rollStat = vi.hoisted(() => vi.fn(async () => ({ total: 8 })));
const messageOfRoll = vi.hoisted(() => vi.fn(() => null));
vi.mock("../../../../module/utils/roll-engine.js", async importOriginal => ({ ...(await importOriginal()), rollStat, messageOfRoll }));
// The pre-roll window every roll gets: answered as a window that asked nothing, unless a test says otherwise.
const promptRoll = vi.hoisted(() => vi.fn(async () => ({ situational: 0 })));
vi.mock("../../../../module/dialogs/RollDialog.js", async importOriginal => ({ ...(await importOriginal()), promptRoll }));

// StonetopCharacter#onDirectStatRoll as these stand-ins have it: the debility pass, then the dice. The real one also
// folds the sticky mode, ongoing and what the next roll is owed; its own tests cover that, these cover the window.
function directRoll(stat, opts) {
	return rollStat(stat, this._actor, this.applyDebilityRollMode ? this.applyDebilityRollMode(stat, opts) : opts);
}

// A character at the Door, with only what the 10+ path touches: the hit point it hands back and
// the wound list the mark goes into. The wound store is the real shape (add returns an id, patch
// finds by it), because "does the second write patch the first wound or add another one" is the
// whole question these tests are asking.
function makeCharacter() {
	const wounds = [];
	let next = 0;
	return {
		_actor: { id: "actor-1" },
		deathsDoorState: "dying",
		onDirectStatRoll: directRoll,
		wounds,
		restored: false,
		async returnToOneHp() { this.restored = true; },
		async addWound(data) {
			const id = `w${++next}`;
			wounds.push({ id, ...data });
			return id;
		},
		async updateWound(id, patch) {
			const w = wounds.find(x => x.id === id);
			if (w) Object.assign(w, patch);
		},
	};
}

function makeDialog(character) {
	return new DeathsDoorDialog(character, () => {});
}

describe("DeathsDoorDialog — the 10+ mark records itself", () => {
	it("a 10+ puts the mark on the sheet with no button pressed", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);

		await dialog._applyTier("success");

		// The mark is not a choice the move offers ("say how your brush with death has marked
		// you"), so the tier writes it the same way it writes the hit point.
		expect(character.restored).toBe(true);
		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0]).toMatchObject({ status: "permanent", origin: "deaths-door" });
		// Undescribed, it carries the question rather than sitting blank.
		expect(character.wounds[0].text).toMatch(/describe the mark/i);
	});

	it("describing it patches that wound instead of adding a second", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);
		await dialog._applyTier("success");

		await dialog._saveMark("a lost eye");
		await dialog._saveMark("a lost eye, and the crows that took it");

		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0].text).toBe("a lost eye, and the crows that took it");
	});

	it("clearing the field leaves the mark standing, back on its prompt", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);
		await dialog._applyTier("success");
		await dialog._saveMark("a nasty scar");

		await dialog._saveMark("   ");

		// They were marked whether or not they can say how — only the sheet's own trash
		// affordance takes a Death's-Door wound back.
		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0].text).toMatch(/describe the mark/i);
	});

	it("a re-rolled 10+ is still one visit to the Door, so still one mark", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);

		await dialog._applyTier("success");
		await dialog._applyTier("success");

		expect(character.wounds).toHaveLength(1);
	});

	it("saves racing the seed write join it rather than minting a second mark", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);

		// A chip clicked while the seed is still going out — both resolve against one wound.
		await Promise.all([dialog._applyTier("success"), dialog._saveMark("visions of the Last Door")]);

		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0].text).toBe("visions of the Last Door");
	});

	it("a save with no seeded wound records the mark on its own", async () => {
		const character = makeCharacter();
		const dialog = makeDialog(character);

		// The close() flush on a window reopened at the result step: nothing seeded it here, and
		// the mark still has to land.
		await dialog._saveMark("a murder of crows, always nearby");

		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0]).toMatchObject({
			text: "a murder of crows, always nearby",
			status: "permanent",
			origin: "deaths-door",
		});
	});

	// Every automated move write names its move, so the ledger reads "via Death's Door".
	it("records the mark as Death's Door's own write, for the ledger", async () => {
		const character = makeCharacter();
		const add = character.addWound.bind(character);
		const options = [];
		character.addWound = async (data, opts) => { options.push(opts); return add(data); };

		await makeDialog(character)._applyTier("success");

		expect(options).toEqual([{ moveName: "Death's Door" }]);
	});

	it("a failed seed doesn't sink the tier, and the next save retries it", async () => {
		const character = makeCharacter();
		const add = character.addWound.bind(character);
		let failed = false;
		character.addWound = async (data) => {
			if (failed) return add(data);
			failed = true;
			throw new Error("no connection");
		};
		const dialog = makeDialog(character);

		// The HP and the chat card must not go down with a wound that couldn't be written.
		await expect(dialog._applyTier("success")).resolves.toBeUndefined();
		expect(character.restored).toBe(true);
		expect(character.wounds).toHaveLength(0);

		await dialog._saveMark("a nasty scar");
		expect(character.wounds).toHaveLength(1);
		expect(character.wounds[0].text).toBe("a nasty scar");
	});
});

// Unstoppable: "When you stop fighting, roll for Death's Door ... If you survive, clear all your
// circles." Surviving is a 10+ or a 7-9; the 7-9's Hard to Kill trade follows the tier that already
// cleared them.
describe("DeathsDoorDialog: Unstoppable's circles clear on surviving", () => {
	let posted;
	beforeEach(() => {
		posted = [];
		globalThis.ChatMessage = { create: vi.fn(async d => posted.push(d)), getSpeaker: () => ({}) };
	});
	afterEach(() => { delete globalThis.ChatMessage; });

	function withCircles(n) {
		const character = makeCharacter();
		const order = [];
		Object.assign(character, {
			circles: n,
			order,
			async clearUnstoppableCircles() { order.push("circles"); const c = this.circles; this.circles = 0; return c; },
			async returnToOneHp() { order.push("hp"); this.restored = true; },
			async setDeathsDoorState(state) { this.state = state; },
		});
		return character;
	}

	it("clears them on a 10+, before the hit point goes back on", async () => {
		const character = withCircles(3);
		await makeDialog(character)._applyTier("success");
		expect(character.circles).toBe(0);
		// First, or the 1 HP would be read as "regain HP while fighting" and clear one mark instead.
		expect(character.order).toEqual(["circles", "hp"]);
		expect(posted.some(p => p.content.includes("clears all 3 Unstoppable circles"))).toBe(true);
	});

	it("clears them on a 7-9", async () => {
		const character = withCircles(2);
		await makeDialog(character)._applyTier("partial");
		expect(character.circles).toBe(0);
	});

	it("leaves them on a 6-, which is not surviving", async () => {
		const character = withCircles(2);
		await makeDialog(character)._applyTier("failure");
		expect(character.circles).toBe(2);
	});

	it("says nothing when there was nothing to clear", async () => {
		const character = withCircles(0);
		await makeDialog(character)._applyTier("partial");
		expect(posted).toHaveLength(0);
	});
});

// "When you stop fighting, roll for Death's Door": rolling it is stopping, so a Heavy still in their
// Battle Joy (fighting on at 0 HP with Unstoppable) comes out of it first, with no roll, and the Door
// is rolled with their debilities.
describe("DeathsDoorDialog: a Battle Joy ends before the roll", () => {
	let posted;
	beforeEach(() => {
		posted = [];
		rollStat.mockClear();
		globalThis.ChatMessage = { create: vi.fn(async d => posted.push(d)), getSpeaker: () => ({}) };
	});
	afterEach(() => { delete globalThis.ChatMessage; });

	it("ends it, says so, and rolls with the debility biting", async () => {
		const actor = {
			id: "actor-1", name: "Duvin", type: "character",
			system: { attributes: { hp: { value: 0 } } },
			flags: { "stonetop-pwd": { battleJoy: true, deathsDoor: "dying" } },
			getFlag: (scope, key) => actor.flags[scope]?.[key],
			unsetFlag: vi.fn(async (scope, key) => { delete actor.flags[scope][key]; }),
		};
		const character = Object.assign(makeCharacter(), {
			_actor: actor,
			deathsDoorRollOptions: () => ({ penalty: -1 }),
			// Weakened-style: disadvantage unless the rage is still on.
			applyDebilityRollMode: (_stat, options) => (actor.flags["stonetop-pwd"].battleJoy ? options : { ...options, rollMode: "dis" }),
		});
		const dialog = makeDialog(character);
		dialog._stat = "con";
		dialog._applyTier = vi.fn(async () => {});

		await dialog._onRoll();

		expect(actor.flags["stonetop-pwd"].battleJoy).toBeUndefined();
		expect(posted[0].content).toContain("their Battle Joy ends, with no roll");
		// Unstoppable's -1 rides the one-off modifier, and the roll is aimed at nobody on the map.
		expect(rollStat.mock.calls[0][2]).toMatchObject({ rollMode: "dis", situational: -1, noXpOnMiss: true, targets: [] });
	});
});

// The last step's rail. Only the CURSOR is tested here: what the questions are, and whether each
// is answered, is post-death-choices.js's to say (and its own tests'). This is the window's half —
// which one panel is on screen, and what moves it.
function withChoices(steps) {
	const dialog = makeDialog(makeCharacter());
	dialog._choices = { slug: "ghost", name: "Ghost", group: "g", steps, outstanding: steps.filter(s => !s.done).length };
	return dialog;
}

const GHOST_STEPS = () => [
	{ key: "purpose",     done: false },
	{ key: "consequence", done: false },
	{ key: "instinct",    done: false },
	{ key: "tether",      done: false },
];

describe("DeathsDoorDialog — the rail through what the insert asks", () => {
	it("opens on the first question that hasn't been answered", () => {
		const steps = GHOST_STEPS();
		steps[0].done = true;
		const dialog = withChoices(steps);

		dialog._latchChoiceStep();

		// A player who took their insert, answered the Purpose and closed the window comes back to
		// where they left off rather than to the top of a list they've half filled in.
		expect(dialog._choiceStep).toBe("consequence");
	});

	it("stays on the question being answered instead of walking itself forward", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._latchChoiceStep();
		expect(dialog._choiceStep).toBe("purpose");

		// Every answer re-renders through _refreshChoices. If the cursor were re-derived there, the
		// click that settles the Purpose would swap the panel out before the player had read what
		// taking it did to them.
		dialog._choices.steps[0].done = true;
		dialog._latchChoiceStep();

		expect(dialog._choiceStep).toBe("purpose");
	});

	it("keeps the player's own pick, answered or not", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._goToChoice("tether");

		dialog._latchChoiceStep();

		expect(dialog._activeChoiceKey()).toBe("tether");
	});

	it("re-latches when the steps change under it, rather than showing nothing", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._goToChoice("tether");

		// A Thrall's questions are not a Ghost's: "tether" is gone, and a cursor left pointing at
		// it would render an empty panel beside a rail that still worked.
		dialog._choices.steps = [{ key: "master", done: false }, { key: "impulse", done: false }];
		dialog._latchChoiceStep();

		expect(dialog._choiceStep).toBe("master");
	});

	it("walks the rail with Back and Next, and stops at both ends", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._latchChoiceStep();

		dialog._stepChoice(-1);
		expect(dialog._activeChoiceKey()).toBe("purpose");   // already at the first

		dialog._stepChoice(1);
		expect(dialog._activeChoiceKey()).toBe("consequence");
		dialog._stepChoice(1);
		dialog._stepChoice(1);
		expect(dialog._activeChoiceKey()).toBe("tether");
		dialog._stepChoice(1);
		expect(dialog._activeChoiceKey()).toBe("tether");    // already at the last

		dialog._stepChoice(-1);
		expect(dialog._activeChoiceKey()).toBe("instinct");
	});

	it("ignores a key that names no question", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._latchChoiceStep();

		dialog._goToChoice("wight");

		expect(dialog._activeChoiceKey()).toBe("purpose");
	});

	it("draws exactly one panel, and marks its rail entry", () => {
		const steps = GHOST_STEPS();
		steps[0].done = true;
		const dialog = withChoices(steps);
		dialog._step = "choices";
		dialog._latchChoiceStep();

		const data = dialog.getData();

		// One question on screen: the whole point of the rail is that the other three aren't.
		expect(data.choices.steps.filter(s => s.isActive).map(s => s.key)).toEqual(["consequence"]);
		expect(data.choiceTabs).toHaveLength(4);
		expect(data.choiceTabs[0]).toMatchObject({ key: "purpose", done: true, isActive: false });
		expect(data.atFirstChoice).toBe(false);
		expect(data.atLastChoice).toBe(false);
	});

	it("doesn't leak the cursor into the view model the next refresh reads back", () => {
		const dialog = withChoices(GHOST_STEPS());
		dialog._step = "choices";
		dialog._latchChoiceStep();

		dialog.getData();

		expect(dialog._choices.steps.every(s => !("isActive" in s))).toBe(true);
	});
});

// Burn Brightly ("spend 2 XP after you roll to add +1") and the Would-Be Hero's Impetuous Youth ("give it
// your all and turn a 6- into a 7-9, a 7-9 into a 10+") both reach back into a roll after the dice land.
// This window settles the tier the moment they do, so when either is on offer it waits on the counted
// tier instead, and writes it only once the player accepts (or nothing is left to offer).
describe("DeathsDoorDialog: Burn Brightly and giving it your all, before the tier lands", () => {
	const SCOPE = "stonetop-pwd";
	let posted;
	let deps;
	let madeDocument = false;

	beforeEach(() => {
		posted = [];
		globalThis.ChatMessage = { create: vi.fn(async d => { posted.push(d); return d; }), getSpeaker: () => ({}) };
		deps = {
			shiftRoll:  vi.fn(async (roll, shift) => { roll.total += shift; }),
			cardFlavor: vi.fn((flavor, total) => `${flavor}<!--${total}-->`),
			afterShift: vi.fn(async () => {}),
			hurt:       vi.fn(async () => {}),
		};
		registerRollRewrite(deps);
		// The cost picker's content is an element (content-picker.js#contentElement).
		if (!globalThis.document) {
			globalThis.document = { createElement: () => ({}) };
			madeDocument = true;
		}
	});
	afterEach(() => {
		registerRollRewrite(null);
		delete globalThis.ChatMessage;
		if (madeDocument) { delete globalThis.document; madeDocument = false; }
		messageOfRoll.mockReset();
		messageOfRoll.mockImplementation(() => null);
	});

	function hero({ background = null, xp = 0, level = 1 } = {}) {
		const actor = {
			id: "wren", name: "Wren", type: "character", isOwner: true,
			system: { playbook: { name: "The Would-Be Hero" }, attributes: { xp: { value: xp }, level: { value: level } } },
			flags: { [SCOPE]: background ? { background: { selected: background } } : {} },
			getFlag: (scope, key) => actor.flags[scope]?.[key],
			update: vi.fn(async data => {
				if ("system.attributes.xp.value" in data) actor.system.attributes.xp.value = data["system.attributes.xp.value"];
			}),
		};
		return actor;
	}

	// The Door's roll card, as rollStat stamps it (its move, and the Destined's bends when it carries them).
	function doorCard(total, tierShift = null) {
		const store = { [ROLLED_FLAG]: rolledRecord("", {
			moveName: "Death's Door", missCountsAsPartial: tierShift ?? "", partialCountsAsSuccess: tierShift ?? "",
		}) };
		const message = {
			id: `m${Math.random()}`, flavor: "<p>Death's Door</p>", speaker: { alias: "Wren" }, whisper: [],
			rolls: [{ total, formula: "2d6" }],
			getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
			// Posted by this window's client, so this client may write it.
			canUserModify: () => true,
			update: vi.fn(async data => {
				if (data.flavor !== undefined) message.flavor = data.flavor;
				if (data.rolls) message.rolls = data.rolls;
				Object.assign(store, data.flags?.[SCOPE] ?? {});
			}),
			store,
		};
		return message;
	}

	function doorFor(actor, tierShift = null) {
		const character = {
			_actor: actor,
			deathsDoorState: "dying",
			onDirectStatRoll: directRoll,
			deathsDoorRollOptions: () => ({ statChoices: [{ stat: "", label: "+nothing" }], penalty: 0, tierShift }),
		};
		const dialog = new DeathsDoorDialog(character, () => {});
		dialog._applyTier = vi.fn(async () => {});
		dialog.renderIfOpen = vi.fn();
		return dialog;
	}

	// Roll `total`, posted as the Door's card.
	async function roll(dialog, total, tierShift = null) {
		const card = doorCard(total, tierShift);
		const rolled = { total };
		rollStat.mockResolvedValueOnce(rolled);
		messageOfRoll.mockImplementation(r => (r === rolled ? card : null));
		await dialog._onRoll();
		return card;
	}

	it("waits on the result only while a boost is affordable, and hides what the tier does meanwhile", async () => {
		const dialog = doorFor(hero({ background: "driven", xp: 2 }));
		await roll(dialog, 9);

		expect(dialog._applyTier).not.toHaveBeenCalled();
		const data = dialog.getData();
		expect(data).toMatchObject({ isResult: true, boostsPending: true, canBurnBrightly: true, canGiveItAll: false });
		// The ladder shows where it stands; nothing the 7-9 does is offered until it lands.
		expect(data.tiers.find(t => t.isCurrent).label).toBe("7-9");
		expect(data).toMatchObject({ isWeak: false, outOfAction: false });
	});

	it("does not wait without a boost: no XP to burn, another background, or already a 10+", async () => {
		const poor = doorFor(hero({ background: "driven", xp: 1 }));
		await roll(poor, 9);
		expect(poor._applyTier).toHaveBeenCalledWith("partial");
		expect(poor.getData()).toMatchObject({ boostsPending: false, isWeak: true });

		// Not a Driven hero: Burn Brightly asks the level-up total (8 at level 1).
		const levelUp = doorFor(hero({ background: "destined", xp: 7 }));
		await roll(levelUp, 5);
		expect(levelUp._applyTier).toHaveBeenCalledWith("failure");

		// A 10+ is the top of this move: nothing to buy.
		const top = doorFor(hero({ background: "impetuous-youth", xp: 20 }));
		await roll(top, 10);
		expect(top._applyTier).toHaveBeenCalledWith("success");
		expect(top.getData().boostsPending).toBe(false);
	});

	it("does not wait when the card or the rewrite is missing, and a Never Gonna 10+ never waits", async () => {
		const noCard = doorFor(hero({ background: "impetuous-youth" }));
		rollStat.mockResolvedValueOnce({ total: 5 });
		await noCard._onRoll();
		expect(noCard._applyTier).toHaveBeenCalledWith("failure");

		registerRollRewrite(null);
		const noRewrite = doorFor(hero({ background: "impetuous-youth" }));
		await roll(noRewrite, 5);
		expect(noRewrite._applyTier).toHaveBeenCalledWith("failure");
	});

	it("Burn Brightly lifts a 9 to a 10: 2 XP spent, the card rewritten, and the 10+ applied", async () => {
		const actor = hero({ background: "driven", xp: 3 });
		const dialog = doorFor(actor);
		const card = await roll(dialog, 9);

		await dialog._onBurnBrightly();

		expect(actor.system.attributes.xp.value).toBe(1);
		expect(actor.update).toHaveBeenCalledWith({ "system.attributes.xp.value": 1 }, { stonetopMove: "Burn Brightly" });
		expect(posted.some(p => p.content.includes("-2 XP for Burning Brightly"))).toBe(true);
		expect(card.rolls[0].total).toBe(10);
		expect(deps.shiftRoll).toHaveBeenCalledTimes(1);
		expect(deps.cardFlavor).toHaveBeenCalledWith("<p>Death's Door</p>", 10, "2d6");
		expect(card.store.burnBrightly).toBe(true);
		expect(deps.afterShift).toHaveBeenCalledWith(card, 10);
		// Nothing left to offer, so it lands: once, on the lifted tier.
		expect(dialog._applyTier).toHaveBeenCalledTimes(1);
		expect(dialog._applyTier).toHaveBeenCalledWith("success");
		const data = dialog.getData();
		expect(data).toMatchObject({ boostsPending: false, isStrong: true, rolledTotal: 10 });
		expect(data.tierNote).toBe("Burn Brightly: 9 → 10.");
	});

	it("Burn Brightly asks again at the press, so XP spent elsewhere meanwhile buys nothing, and Accept still lands it", async () => {
		const actor = hero({ background: "driven", xp: 2 });
		const dialog = doorFor(actor);
		await roll(dialog, 9);
		actor.system.attributes.xp.value = 1;   // spent elsewhere after the window drew the button

		await dialog._onBurnBrightly();

		expect(actor.update).not.toHaveBeenCalled();
		expect(deps.shiftRoll).not.toHaveBeenCalled();
		expect(dialog._applyTier).not.toHaveBeenCalled();
		// Now nothing is on offer but accepting.
		await dialog._onAcceptResult();
		expect(dialog._applyTier).toHaveBeenCalledWith("partial");
	});

	it("giving it your all lifts a 6- to a 7-9, asks and records the cost, and rolls the 2d4 at the hero", async () => {
		const actor = hero({ background: "impetuous-youth" });
		const dialog = doorFor(actor);
		const card = await roll(dialog, 5);
		expect(dialog.getData()).toMatchObject({ boostsPending: true, canBurnBrightly: false, canGiveItAll: true });
		const asked = stubAsk("hurt");

		await dialog._onGiveItAll();

		// The card's own picker: pick 1, affirmative first.
		expect(asked).toHaveBeenCalledTimes(1);
		expect(card.rolls[0].total).toBe(7);
		expect(card.store[GAVE_IT_ALL_FLAG]).toEqual({ cost: "hurt", from: 5, to: 7 });
		expect(deps.hurt).toHaveBeenCalledWith(actor);
		expect(posted.some(p => p.content.includes("gives it their all"))).toBe(true);
		expect(dialog._applyTier).toHaveBeenCalledTimes(1);
		expect(dialog._applyTier).toHaveBeenCalledWith("partial");
		expect(dialog.getData().tierNote).toBe("Impetuous Youth: 5 → 7, and got hurt.");
	});

	it("closing the cost picker gives nothing, costs nothing, and the result still waits", async () => {
		const dialog = doorFor(hero({ background: "impetuous-youth" }));
		const card = await roll(dialog, 5);
		stubAsk("cancel");

		await dialog._onGiveItAll();

		expect(card.update).not.toHaveBeenCalled();
		expect(dialog._applyTier).not.toHaveBeenCalled();
		expect(dialog.getData().canGiveItAll).toBe(true);
	});

	it("both, each once: Burn Brightly, then giving it your all, then it lands", async () => {
		// Impetuous Youth, and enough XP to level: both are on offer.
		const actor = hero({ background: "impetuous-youth", xp: 8, level: 1 });
		const dialog = doorFor(actor);
		const card = await roll(dialog, 5);
		expect(dialog.getData()).toMatchObject({ canBurnBrightly: true, canGiveItAll: true });

		await dialog._onBurnBrightly();
		// Still a 6-, and giving it your all is still on offer: it waits, and Burn Brightly is spent.
		expect(card.rolls[0].total).toBe(6);
		expect(dialog._applyTier).not.toHaveBeenCalled();
		expect(dialog.getData()).toMatchObject({ boostsPending: true, canBurnBrightly: false, canGiveItAll: true });
		await dialog._onBurnBrightly();
		expect(actor.update).toHaveBeenCalledTimes(1);

		stubAsk("lost");
		await dialog._onGiveItAll();
		expect(card.rolls[0].total).toBe(7);
		expect(dialog._applyTier).toHaveBeenCalledTimes(1);
		expect(dialog._applyTier).toHaveBeenCalledWith("partial");

		// Settled: neither can be pressed again.
		await dialog._onGiveItAll();
		await dialog._onBurnBrightly();
		expect(card.rolls[0].total).toBe(7);
		expect(dialog._applyTier).toHaveBeenCalledTimes(1);
		expect(dialog.getData().tierNote).toBe("Burn Brightly: 5 → 6. Impetuous Youth: 6 → 7, and something was lost or broke.");
	});

	it("composes with the Destined's shift: a boost lifts the tier the roll COUNTS as", async () => {
		// Burn Brightly on a Destined 6: the 6- counts as a 7-9, and the +1 makes a 7, which counts as a 10+.
		const burner = doorFor(hero({ xp: 8 }), "Destined");
		await roll(burner, 6, "Destined");
		expect(burner._applyTier).not.toHaveBeenCalled();
		expect(burner.getData().tiers.find(t => t.isCurrent).label).toBe("7-9");
		await burner._onBurnBrightly();
		expect(burner._applyTier).toHaveBeenCalledWith("success");
		expect(burner.getData().tierNote).toBe("Burn Brightly: 6 → 7. Destined: your 7-9 counts as a 10+.");

		// Giving it your all on a Destined 5: it counts as a 7-9, so it goes to the next floor above THAT.
		const giver = doorFor(hero({ background: "impetuous-youth" }), "Destined");
		const card = await roll(giver, 5, "Destined");
		stubAsk("escalate");
		await giver._onGiveItAll();
		expect(card.rolls[0].total).toBe(10);
		expect(giver._applyTier).toHaveBeenCalledWith("success");
	});

	it("Accept lands the tier as it stands, once, and closing the window accepts it too", async () => {
		const accepter = doorFor(hero({ background: "impetuous-youth" }));
		await roll(accepter, 8);
		await accepter._onAcceptResult();
		await accepter._onAcceptResult();
		expect(accepter._applyTier).toHaveBeenCalledTimes(1);
		expect(accepter._applyTier).toHaveBeenCalledWith("partial");
		expect(accepter.getData()).toMatchObject({ boostsPending: false, canGiveItAll: false, isWeak: true });

		// Shut on the waiting result: the roll is spent, so the Door must not be left neither passed nor faced.
		const closer = doorFor(hero({ background: "impetuous-youth" }));
		await roll(closer, 4);
		await closer.close();
		expect(closer._applyTier).toHaveBeenCalledWith("failure");
	});
});

describe("Death's Door's roll card offers neither boost itself", () => {
	const SCOPE = "stonetop-pwd";
	const cardOf = move => {
		const store = { [ROLLED_FLAG]: rolledRecord("", { moveName: move }) };
		return {
			rolls: [{ total: 8 }], flavor: "", getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
			canUserModify: () => true, isAuthor: true,
		};
	};

	it("knows a Death's Door card by the move rollStat stamped on it", () => {
		expect(isDeathsDoorCard(cardOf("Death's Door"))).toBe(true);
		expect(isDeathsDoorCard(cardOf("Defy Danger"))).toBe(false);
		expect(isDeathsDoorCard(null)).toBe(false);
	});

	it("draws no live Burn Brightly or Give it your all there; the window offers them instead", () => {
		const hero = {
			id: "wren", name: "Wren", type: "character", isOwner: true,
			system: { playbook: { name: "The Would-Be Hero" } },
			flags: { [SCOPE]: { background: { selected: "impetuous-youth" } } },
		};
		expect(offersGiveItAll(cardOf("Death's Door"), hero)).toBe(false);
		// The card's Burn Brightly button asks the same question before it draws (a spent one still shows).
		const main = readRepo("stonetop.js");
		const wire = main.slice(main.indexOf("function _chatWireBurnBrightly"), main.indexOf("// -- +1 TO A ROLL JUST MADE"));
		// Any 0-HP move's card (deaths-door.js#isZeroHpMoveCard), Death's Door's among them.
		expect(wire).toMatch(/if \(!alreadyBurned\) \{[^}]*?if \(isZeroHpMoveCard\(message\)\) return;/);
		// And the window's footer puts accepting first (Foundry's order), each boost naming what it does.
		const hbs = readRepo("templates/dialogs/deaths-door.hbs");
		const accept = hbs.indexOf("deaths-door-accept-btn");
		expect(accept).toBeGreaterThan(-1);
		expect(hbs.indexOf("deaths-door-burn-btn")).toBeGreaterThan(accept);
		expect(hbs.indexOf("deaths-door-give-all-btn")).toBeGreaterThan(accept);
		const BUTTONS = "stonetop.specialMoves.deathsDoor.buttons";
		expect(hbs).toContain(`{{localize "${BUTTONS}.accept"}}`);
		expect(hbs).toContain(`{{localize "${BUTTONS}.burn" cost=burnBrightlyCost}}`);
		expect(hbs).toContain(`{{localize "${BUTTONS}.giveAll"}}`);
		expect(game.i18n.localize(`${BUTTONS}.accept`)).toBe("Accept this result");
		expect(game.i18n.format(`${BUTTONS}.burn`, { cost: 2 })).toBe("Burn Brightly (+1, 2 XP)");
		expect(game.i18n.localize(`${BUTTONS}.giveAll`)).toBe("Give it my all");
	});
});

// Two owners, one character. The window is one client's and the character stays dying until the tier lands, so
// the roll is said on the actor before the dice (the `deathsDoorRolling` flag), every other owner's window waits
// on it, and one whose roller has gone can be taken over without the dice going again.
describe("DeathsDoorDialog: a roll under way, seen from every owner's window", () => {
	const SCOPE = "stonetop-pwd";
	let world;
	let saved;
	let madeDocument = false;
	let actorSeq = 0;

	beforeEach(() => {
		saved = { user: game.user, users: game.users, messages: game.messages, time: game.time, actors: game.actors };
		const users = new Map([
			["p1", { id: "p1", name: "Aline", active: true }],
			["p2", { id: "p2", name: "Bea", active: true }],
			["gm", { id: "gm", name: "Gamemaster", active: true, isGM: true }],
		]);
		const messages = [];
		const actors = new Map();
		// Each client's chat: a private card (`onlyFor`) reaches only the users it was sent to.
		const seen = () => messages.filter(m => !m.onlyFor || m.onlyFor.includes(game.user?.id));
		game.users = { get: id => users.get(id) };
		game.messages = { get: id => seen().find(m => m.id === id), get contents() { return seen(); } };
		game.actors = { get: id => actors.get(id) };
		game.time = { serverTime: 1_000_000 };
		globalThis.ChatMessage = { create: vi.fn(async d => d), getSpeaker: () => ({}) };
		registerRollRewrite({
			shiftRoll:  vi.fn(async (roll, shift) => { roll.total += shift; }),
			cardFlavor: vi.fn(flavor => flavor),
			afterShift: vi.fn(async () => {}),
			hurt:       vi.fn(async () => {}),
		});
		if (!globalThis.document) {
			globalThis.document = { createElement: () => ({}) };
			madeDocument = true;
		}
		world = { users, messages, actors };
		rollStat.mockClear();
	});
	afterEach(() => {
		Object.assign(game, saved);
		registerRollRewrite(null);
		delete globalThis.ChatMessage;
		if (madeDocument) { delete globalThis.document; madeDocument = false; }
		messageOfRoll.mockReset();
		messageOfRoll.mockImplementation(() => null);
	});

	const as = id => { game.user = world.users.get(id); };
	const rollingOn = actor => actor.flags[SCOPE].deathsDoorRolling ?? null;
	const stateOf = actor => actor.flags[SCOPE].deathsDoor ?? null;
	// The marker's own update key. It is written with `render: false`: no sheet draws from it.
	const ROLLING = `flags.${SCOPE}.deathsDoorRolling`;
	const markerWrites = actor => actor.update.mock.calls.filter(([data]) => ROLLING in data);
	// Every marker written, in order: what the roll said about itself on its way to landing.
	const noted = actor => markerWrites(actor).map(([data]) => data[ROLLING]);

	// A GM connected: the active GM, whose client answers the Death's Door queries with the real handlers. `holdFor`
	// keeps a user's query on its way (a promise per user id) until the test lets it through; `beforeRuling` is
	// whatever changes on the table while it travels.
	function withGM({ holdFor = {}, beforeRuling = null } = {}) {
		const gm = world.users.get("gm");
		const handlers = { [DEATHS_DOOR_CLAIM_QUERY]: handleDeathsDoorClaimQuery, [DEATHS_DOOR_BOOST_QUERY]: handleDeathsDoorBoostQuery };
		gm.query = vi.fn(async (name, data) => {
			await holdFor[data.userId];
			beforeRuling?.();
			as("gm");
			try {
				return await handlers[name](data, {});
			} finally {
				as(data.userId);
			}
		});
		game.users.activeGM = gm;
		return gm;
	}

	// A Would-Be Hero at the Door. Impetuous Youth always has something to wait on (giving it your all);
	// Burn Brightly needs the XP; no background and no XP waits on nothing.
	function dyingHero({ background = "impetuous-youth", xp = 0, tierShift = null, skipRollMove = null } = {}) {
		const actor = {
			id: `hero-${++actorSeq}`, name: "Wren", type: "character", isOwner: true,
			system: {
				playbook: { name: "The Would-Be Hero" },
				attributes: { xp: { value: xp }, level: { value: 1 }, hp: { value: 0 } },
			},
			flags: { [SCOPE]: { deathsDoor: "dying", ...(background ? { background: { selected: background } } : {}) } },
			getFlag: (scope, key) => actor.flags[scope]?.[key],
			setFlag: vi.fn(async (scope, key, value) => { actor.flags[scope][key] = structuredClone(value); }),
			unsetFlag: vi.fn(async (scope, key) => { delete actor.flags[scope][key]; }),
			// A flag written or deleted by its update key (the roll's marker), and the XP a spend takes.
			update: vi.fn(async data => {
				for (const [path, value] of Object.entries(data)) {
					const gone = deletionTarget(path, value);
					const [, scope, key] = (gone ?? path).match(/^flags\.([^.]+)\.(.+)$/) ?? [];
					if (!key) continue;
					if (gone) delete actor.flags[scope][key];
					else actor.flags[scope][key] = structuredClone(value);
				}
				if ("system.attributes.xp.value" in data) actor.system.attributes.xp.value = data["system.attributes.xp.value"];
			}),
			// Every user at this table owns the hero.
			testUserPermission: () => true,
		};
		world.actors.set(actor.id, actor);
		const character = {
			_actor: actor,
			get deathsDoorState() { return actor.flags[SCOPE].deathsDoor ?? null; },
			onDirectStatRoll: directRoll,
			deathsDoorRollOptions: () => ({ statChoices: [{ stat: "", label: "+nothing" }], penalty: 0, tierShift, skipRollMove }),
			setDeathsDoorState: vi.fn(async state => {
				if (state) actor.flags[SCOPE].deathsDoor = state;
				else delete actor.flags[SCOPE].deathsDoor;
			}),
			returnToOneHp: vi.fn(async () => { actor.system.attributes.hp.value = 1; delete actor.flags[SCOPE].deathsDoor; }),
			addWound: vi.fn(async () => "w1"),
			moveResources: { setUses: vi.fn(async () => {}) },
		};
		return { actor, character };
	}

	function windowOn(character) {
		const dialog = new DeathsDoorDialog(character, () => {});
		dialog.renderIfOpen = vi.fn();
		return dialog;
	}

	// The Door's card, as rollStat posts it: its move, the Destined's bends when the roll carried them, and
	// whatever flags the window handed over (the roll's nonce).
	function doorCard(total, opts = {}) {
		const store = {
			...(opts.messageFlags?.[SCOPE] ?? {}),
			[ROLLED_FLAG]: rolledRecord("", {
				moveName: "Death's Door",
				missCountsAsPartial: opts.missCountsAsPartial ?? "",
				partialCountsAsSuccess: opts.partialCountsAsSuccess ?? "",
			}),
		};
		const message = {
			id: `m${world.messages.length + 1}`, flavor: "<p>Death's Door</p>", speaker: { alias: "Wren" }, whisper: [],
			rolls: [{ total, formula: "2d6" }],
			getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
			// Posted by this window's client, so this client may write it.
			canUserModify: () => true,
			update: vi.fn(async data => {
				if (data.flavor !== undefined) message.flavor = data.flavor;
				if (data.rolls) message.rolls = data.rolls;
				Object.assign(store, data.flags?.[SCOPE] ?? {});
			}),
			store,
		};
		return message;
	}

	// Roll `total` through the window's own path, posting the card into this table's chat. `during` runs with
	// the dice in the air, after the window has said so on the actor and before the card exists. `onlyFor` makes
	// it a private roll: the card reaches only those users' clients.
	async function rollAt(dialog, total, { during, onlyFor = null } = {}) {
		let card = null;
		const rolled = { total };
		rollStat.mockImplementationOnce(async (_stat, _actor, opts) => {
			await during?.();
			card = doorCard(total, opts);
			if (onlyFor) card.onlyFor = onlyFor;
			world.messages.push(card);
			return rolled;
		});
		messageOfRoll.mockImplementation(r => (r === rolled ? card : null));
		await dialog._onRoll();
		return card;
	}

	// The real template, with the partial it needs and the helpers it calls: core's `localize` (hash data
	// interpolates, as tests/setup.js registers it) and our `escapeHtml`, over the real English table.
	function draw(data) {
		const hb = Handlebars.create();
		hb.registerHelper("or", (...a) => a.slice(0, -1).some(Boolean));
		hb.registerHelper("eq", (a, b) => a === b);
		hb.registerHelper("localize", (key, options) => (Object.keys(options?.hash ?? {}).length
			? game.i18n.format(key, options.hash) : game.i18n.localize(key)));
		hb.registerHelper("escapeHtml", value => escHtml(value));
		hb.registerPartial("stonetop.deaths-door-outcomes", readRepo("templates/dialogs/partials/deaths-door-outcomes.hbs"));
		hb.registerPartial("stonetop.post-death-choices", "");
		return hb.compile(readRepo("templates/dialogs/deaths-door.hbs"))(data);
	}

	describe("the roll is said on the actor", () => {
		it("before the dice, with the card and the tier while it waits, and gone when the tier lands", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			const mine = windowOn(character);
			let inTheAir = null;

			const card = await rollAt(mine, 8, { during: () => { inTheAir = structuredClone(rollingOn(actor)); } });

			expect(inTheAir).toMatchObject({ userId: "p1", userName: "Aline", at: 1_000_000, messageId: null, total: null });
			// The card carries the roll's name, for a window that has to find it without the marker's help.
			expect(card.store[DEATHS_DOOR_ROLL_FLAG]).toBe(inTheAir.nonce);
			expect(rollingOn(actor)).toMatchObject({ userId: "p1", nonce: inTheAir.nonce, messageId: card.id, total: 8, tier: "partial" });

			await mine._onAcceptResult();
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			expect(rollingOn(actor)).toBeNull();
		});

		it("and cleared when the dice land with nothing to wait on", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			await rollAt(windowOn(character), 5);
			expect(actor.update).toHaveBeenCalledWith({ [ROLLING]: expect.objectContaining({ userId: "p1" }) }, { render: false });
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
			expect(rollingOn(actor)).toBeNull();
		});

		it("and cleared when a boost leaves nothing more to offer", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: "driven", xp: 2 });
			const mine = windowOn(character);
			await rollAt(mine, 9);
			expect(rollingOn(actor)).toMatchObject({ total: 9, tier: "partial" });

			await mine._onBurnBrightly();

			expect(character.returnToOneHp).toHaveBeenCalledTimes(1);
			expect(rollingOn(actor)).toBeNull();
		});

		it("and cleared by a window shut on the waiting result, or shut while the dice were still in the air", async () => {
			as("p1");
			const shut = dyingHero();
			const mine = windowOn(shut.character);
			await rollAt(mine, 8);
			await mine.close();
			expect(stateOf(shut.actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			expect(rollingOn(shut.actor)).toBeNull();

			// Left waiting on a closed window, the marker would hold every other owner off until it went stale.
			const early = dyingHero();
			const gone = windowOn(early.character);
			await rollAt(gone, 4, { during: () => gone.close() });
			expect(stateOf(early.actor)).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
			expect(rollingOn(early.actor)).toBeNull();
		});

		it("and cleared by Never Gonna Keep Me Down's 10+, which rolls nothing", async () => {
			as("p1");
			const { actor, character } = dyingHero({ skipRollMove: NEVER_GONNA_KEEP_ME_DOWN });

			await windowOn(character)._onTakeTenPlus();

			expect(rollStat).not.toHaveBeenCalled();
			expect(actor.update).toHaveBeenCalledWith({ [ROLLING]: expect.objectContaining({ userId: "p1" }) }, { render: false });
			expect(character.returnToOneHp).toHaveBeenCalledTimes(1);
			expect(rollingOn(actor)).toBeNull();
		});

		it("before a Battle Joy ends, and let go of when nothing reached the table", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			actor.flags[SCOPE].battleJoy = true;
			rollStat.mockRejectedValueOnce(new Error("the dice went under the table"));

			await expect(windowOn(character)._onRoll()).rejects.toThrow("the dice went under the table");

			const said = actor.update.mock.invocationCallOrder[actor.update.mock.calls.findIndex(([data]) => ROLLING in data)];
			const joyEnded = actor.unsetFlag.mock.calls.findIndex(([, key]) => key === "battleJoy");
			expect(said).toBeLessThan(actor.unsetFlag.mock.invocationCallOrder[joyEnded]);
			// No card: the Door is still to face, and nobody is rolling it.
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.DYING);
			expect(rollingOn(actor)).toBeNull();
		});
	});

	describe("another owner's window", () => {
		it("waits on the roll: no dice there, and the result so far once the card is down", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			const mine = windowOn(character);
			as("gm");
			const theirs = windowOn(character);
			expect(theirs.getData()).toMatchObject({ isRoll: true, isWatching: false });

			as("p1");
			let inTheAir = null;
			await rollAt(mine, 5, { during: () => { as("gm"); inTheAir = theirs.getData(); as("p1"); } });
			expect(inTheAir).toMatchObject({ isWatching: true, isRoll: false, isResult: false });
			expect(inTheAir.watch).toMatchObject({ userName: "Aline", actorName: "Wren", rolled: false, canTakeOver: false });

			as("gm");
			const data = theirs.getData();
			expect(data).toMatchObject({ isWatching: true, isRoll: false, isResult: false });
			expect(data.watch).toMatchObject({ rolled: true, total: 5, tier: "failure", canTakeOver: false });
			expect(data.tiers.find(t => t.isCurrent).label).toBe("6-");
			const html = draw(data);
			expect(html).toContain("<strong>Aline</strong> is rolling Death's Door for <strong>Wren</strong>.");
			expect(html).toContain("They rolled <strong>5</strong>");
			expect(html).not.toContain("deaths-door-roll-btn");
			expect(html).not.toContain("deaths-door-take-over-btn");

			// A roll pressed in a window that had not redrawn yet rolls nothing.
			rollStat.mockClear();
			await theirs._onRoll();
			expect(rollStat).not.toHaveBeenCalled();
			expect(rollingOn(actor).userId).toBe("p1");
		});

		it("follows it, through the actor's update hook, to where it lands: shown as theirs", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			const mine = windowOn(character);
			await rollAt(mine, 5);
			as("gm");
			const theirs = windowOn(character);
			const hooks = globalThis.Hooks;
			const handlers = {};
			globalThis.Hooks = { ...hooks, on: vi.fn((name, fn) => { handlers[name] = fn; return name; }), off: vi.fn() };
			try {
				// What an open window does on its draw: settle its view, listen, and note what it drew.
				theirs.rendered = true;
				theirs.render = vi.fn();
				theirs._syncRoll();
				theirs._listen();
				theirs._drawnWatchKey = theirs._watchKey();
				handlers.updateActor({ id: "someone-else" });
				expect(theirs.render).not.toHaveBeenCalled();

				as("p1");
				stubAsk("hurt");
				await mine._onGiveItAll();   // 5 lifted to 7, and nothing more on offer: the 7-9 lands
				expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);

				as("gm");
				handlers.updateActor(actor);
				expect(theirs.render).toHaveBeenCalledTimes(1);
				theirs._syncRoll();
				const data = theirs.getData();
				expect(data).toMatchObject({
					isWatching: false, isResult: true, spectator: true, rolledBy: "Aline", rolledTotal: 7,
					isWeak: true, boostsPending: false,
				});
				expect(data.tiers.find(t => t.isCurrent).label).toBe("7-9");
				expect(data.tierNote).toBe("Impetuous Youth: 5 → 7, and got hurt.");
				expect(draw(data)).toContain("<strong>Aline</strong> rolled <strong>7</strong>.");

				// Shown: later writes to the character redraw nothing more.
				theirs.render.mockClear();
				theirs._drawnWatchKey = theirs._watchKey();
				handlers.updateActor(actor);
				expect(theirs.render).not.toHaveBeenCalled();
			} finally {
				globalThis.Hooks = hooks;
			}
		});

		it("leaves the mark and a 6-'s fate to the roller, on a result it only watched land", async () => {
			as("p1");
			const miss = dyingHero();
			const rolled = windowOn(miss.character);
			await rollAt(rolled, 4);
			as("gm");
			const watcher = windowOn(miss.character);
			watcher._syncRoll();
			as("p1");
			await rolled._onAcceptResult();
			as("gm");
			watcher._syncRoll();
			const missed = watcher.getData();
			expect(missed).toMatchObject({ isResult: true, isMiss: true, spectator: true });
			const missHtml = draw(missed);
			expect(missHtml).toContain("The fate is Aline's to choose.");
			expect(missHtml).not.toContain("deaths-door-fate-btn");

			as("p1");
			const hit = dyingHero({ background: "driven", xp: 2 });
			const burner = windowOn(hit.character);
			await rollAt(burner, 9);
			as("gm");
			const onlooker = windowOn(hit.character);
			onlooker._syncRoll();
			as("p1");
			await burner._onBurnBrightly();   // 9 to 10: the 10+ lands
			as("gm");
			onlooker._syncRoll();
			const strong = onlooker.getData();
			expect(strong).toMatchObject({ isStrong: true, spectator: true, rolledTotal: 10 });
			const hitHtml = draw(strong);
			expect(hitHtml).toContain("Aline says how it marked them.");
			expect(hitHtml).not.toContain("deaths-door-mark-input");
			// Nothing the watcher's window does writes a second mark.
			await onlooker.close();
			expect(hit.character.addWound).toHaveBeenCalledTimes(1);
		});
	});

	describe("a roll nobody is finishing", () => {
		it("can be taken over once its roller has left, accepting their card without rolling again", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			const mine = windowOn(character);
			const card = await rollAt(mine, 8);
			const { nonce } = rollingOn(actor);
			world.users.get("p1").active = false;

			as("gm");
			const theirs = windowOn(character);
			const data = theirs.getData();
			expect(data.watch).toMatchObject({
				canTakeOver: true, takeOverAccepts: true, whyTakeOver: "Aline has left the game without finishing it.",
			});
			expect(draw(data)).toContain("Take over their roll");

			rollStat.mockClear();
			await theirs._onTakeOver();
			expect(rollStat).not.toHaveBeenCalled();
			expect(rollingOn(actor)).toMatchObject({ userId: "gm", userName: "Gamemaster", nonce, messageId: card.id });
			const taken = theirs.getData();
			expect(taken).toMatchObject({ isWatching: false, isResult: true, boostsPending: true, rolledTotal: 8 });
			expect(taken.tiers.find(t => t.isCurrent).label).toBe("7-9");

			// The window it was taken from (still open on a screen nobody is at) lands nothing.
			as("p1");
			await mine._onAcceptResult();
			expect(character.setDeathsDoorState).not.toHaveBeenCalled();

			as("gm");
			await theirs._onAcceptResult();
			expect(character.setDeathsDoorState).toHaveBeenCalledTimes(1);
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			expect(rollingOn(actor)).toBeNull();
		});

		it("reads the tier the card COUNTS as: a Destined 6 taken over is a 7-9", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: "destined", xp: 8, tierShift: "Destined" });
			await rollAt(windowOn(character), 6);
			expect(rollingOn(actor)).toMatchObject({ total: 6, tier: "partial" });
			world.users.get("p1").active = false;

			as("gm");
			const theirs = windowOn(character);
			expect(theirs.getData().watch.tier).toBe("partial");
			await theirs._onTakeOver();
			const taken = theirs.getData();
			expect(taken.tiers.find(t => t.isCurrent).label).toBe("7-9");
			expect(taken.tierNote).toBe("Destined: your 6- counts as a 7-9.");
			await theirs._onAcceptResult();
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		});

		it("can be taken over once it has sat untouched too long, its roller still here", async () => {
			as("p1");
			const { character } = dyingHero();
			await rollAt(windowOn(character), 8);
			as("gm");
			const theirs = windowOn(character);
			expect(theirs.getData().watch.canTakeOver).toBe(false);

			game.time.serverTime += DEATHS_DOOR_ROLL_STALE_MS + 1;

			expect(theirs.getData().watch).toMatchObject({
				canTakeOver: true, takeOverAccepts: true,
				whyTakeOver: "Aline started it over 5 minutes ago and hasn't finished it.",
			});
		});

		it("with nothing on the table, Take over hands back the dice", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			// The page went while the dice were being asked for: a marker, and no card.
			actor.flags[SCOPE].deathsDoorRolling = {
				userId: "p1", userName: "Aline", at: 1_000_000, nonce: "lost", messageId: null, total: null, tier: null,
			};
			world.users.get("p1").active = false;

			as("gm");
			const theirs = windowOn(character);
			const data = theirs.getData();
			expect(data.watch).toMatchObject({ canTakeOver: true, takeOverAccepts: false });
			expect(draw(data)).toContain("Take over and roll");

			await theirs._onTakeOver();
			expect(theirs.getData()).toMatchObject({ isRoll: true, isWatching: false });
			let during = null;
			await rollAt(theirs, 10, { during: () => { during = structuredClone(rollingOn(actor)); } });
			expect(during).toMatchObject({ userId: "gm" });
			expect(during.nonce).not.toBe("lost");
			expect(character.returnToOneHp).toHaveBeenCalledTimes(1);
			expect(rollingOn(actor)).toBeNull();
		});
	});

	// Audit DD-3: a window left open while the character left the Door. With no GM connected there is no claim
	// ruling to refuse the roll, so the window asks for itself before anything is written.
	describe("a window left open on someone no longer at the Door, with no GM to rule", () => {
		it("rolls nothing for a character brought back up, and writes no marker", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			const dialog = windowOn(character);
			delete actor.flags[SCOPE].deathsDoor;   // healed above 0 HP while the window sat on the dice

			await dialog._onRoll();
			await dialog._onTakeTenPlus();

			expect(rollStat).not.toHaveBeenCalled();
			expect(markerWrites(actor)).toHaveLength(0);
			expect(character.setDeathsDoorState).not.toHaveBeenCalled();
		});

		it("chooses no fate once none is owed, and still does while one is", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			character.setPostDeathInsert = vi.fn(async () => {});
			const dialog = windowOn(character);
			actor.flags[SCOPE].deathsDoor = DEATHS_DOOR_STATE.OUT_OF_ACTION;   // the GM cleared the pending fate

			await dialog._onChooseFate("last-door");
			await dialog._onTakeInsert("ghost");
			expect(character.setDeathsDoorState).not.toHaveBeenCalled();
			expect(character.setPostDeathInsert).not.toHaveBeenCalled();

			actor.flags[SCOPE].deathsDoor = DEATHS_DOOR_STATE.FATE_PENDING;
			await dialog._onChooseFate("last-door");
			expect(character.setDeathsDoorState).toHaveBeenCalledWith(DEATHS_DOOR_STATE.DEAD);
		});
	});

	// Audit DD-5: Hard to Kill's 7-9 trade, latched with the 7-9 so the sheet's card can offer it once this window
	// has gone.
	describe("Hard to Kill's 7-9 trade", () => {
		it("opens with the 7-9, in the same write as out of the action", async () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			character.deathsDoorRollOptions = () => ({ statChoices: [{ stat: "", label: "+nothing" }], penalty: 0, hardToKill: true });
			actor.update.mockClear();

			await rollAt(windowOn(character), 8);

			const opened = actor.update.mock.calls.find(([data]) => `flags.${SCOPE}.hardToKillTrade` in data);
			expect(opened?.[0]).toEqual({
				[`flags.${SCOPE}.deathsDoor`]: DEATHS_DOOR_STATE.OUT_OF_ACTION,
				[`flags.${SCOPE}.hardToKillTrade`]: true,
			});
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		});

		it("is made once, by the one trade both the window and the sheet's card call, which closes the latch in its write", async () => {
			const actor = { name: "Duvin", flags: { [SCOPE]: { hardToKillTrade: true } } };
			actor.getFlag = (scope, key) => actor.flags[scope]?.[key];
			actor.unsetFlag = vi.fn(async (scope, key) => { delete actor.flags[scope][key]; });
			const character = {
				_actor: actor,
				debilityChoices: [{ key: "weakened", name: "Weakened", marked: false }],
				markDebility: vi.fn(async () => true),
			};

			expect(await tradeHardToKillDebility(character, "weakened")).toBe(true);

			expect(character.markDebility).toHaveBeenCalledWith("weakened", {
				hp: 1, moveName: "Hard to Kill", clearsDeathsDoor: true,
				alsoUpdate: Object.fromEntries([deletionEntry(`flags.${SCOPE}.hardToKillTrade`)]),
			});
			expect(actor.unsetFlag).not.toHaveBeenCalled();
			expect(ChatMessage.create.mock.calls.at(-1)[0].content).toContain("marks <strong>Weakened</strong> to regain 1 HP");
		});
	});

	// Audit DD-8: a watching window names the tier that landed, not the state that followed it.
	describe("a watched result, read after more happened", () => {
		it("reads a 7-9 traded back to 1 HP as a 7-9, and a 6- that took an insert as a 6-", async () => {
			as("p1");
			const weak = dyingHero();
			const rolled = windowOn(weak.character);
			await rollAt(rolled, 8);
			as("gm");
			const watcher = windowOn(weak.character);
			watcher._syncRoll();
			as("p1");
			await rolled._onAcceptResult();
			delete weak.actor.flags[SCOPE].deathsDoor;   // Hard to Kill's trade: 1 HP, no state left behind
			as("gm");
			watcher._syncRoll();
			expect(watcher.getData()).toMatchObject({ isWeak: true, spectator: true });

			as("p1");
			const miss = dyingHero();
			const missed = windowOn(miss.character);
			await rollAt(missed, 4);
			as("gm");
			const onlooker = windowOn(miss.character);
			onlooker._syncRoll();
			as("p1");
			await missed._onAcceptResult();
			// The Ghost taken: out of the action, with the insert's own 0-HP move from now on.
			miss.actor.flags[SCOPE].deathsDoor = DEATHS_DOOR_STATE.OUT_OF_ACTION;
			miss.character.zeroHpMove = { dialog: false };
			as("gm");
			onlooker._syncRoll();
			expect(onlooker.getData()).toMatchObject({ isMiss: true, spectator: true });
		});

		it("shows no result as theirs when they were brought back up before anything landed", () => {
			as("p1");
			const { actor, character } = dyingHero({ background: null });
			actor.flags[SCOPE].deathsDoorRolling = { userId: "p2", userName: "Bea", nonce: "n1", at: 1_000_000 };
			const watcher = windowOn(character);
			watcher._syncRoll();
			// Healed with the dice still in the air: the state and the marker go together.
			delete actor.flags[SCOPE].deathsDoor;
			delete actor.flags[SCOPE].deathsDoorRolling;
			watcher._syncRoll();
			expect(watcher.getData()).toMatchObject({ isResult: false, spectator: false, isStrong: false });
		});
	});

	describe("the roller's own window, opened again (a reload mid-roll)", () => {
		it("picks the waiting result back up instead of offering the dice", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			// Posted before the reload, the marker never having got as far as naming its card.
			world.messages.push(doorCard(8, { messageFlags: { [SCOPE]: { [DEATHS_DOOR_ROLL_FLAG]: "before-reload" } } }));
			actor.flags[SCOPE].deathsDoorRolling = {
				userId: "p1", userName: "Aline", at: 1, nonce: "before-reload", messageId: null, total: null, tier: null,
			};

			const reopened = windowOn(character);
			reopened._syncRoll();   // what its first draw does

			expect(reopened.getData()).toMatchObject({
				isRoll: false, isWatching: false, isResult: true, boostsPending: true, rolledTotal: 8, canGiveItAll: true,
			});
			await reopened._onRoll();
			expect(rollStat).not.toHaveBeenCalled();
			await reopened._onAcceptResult();
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			expect(rollingOn(actor)).toBeNull();
		});

		it("offers the dice again when nothing was posted, and clears what was left behind", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			actor.flags[SCOPE].deathsDoorRolling = {
				userId: "p1", userName: "Aline", at: 1, nonce: "never-posted", messageId: null, total: null, tier: null,
			};

			const reopened = windowOn(character);
			reopened._syncRoll();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(reopened.getData()).toMatchObject({ isRoll: true, isWatching: false });
			expect(rollingOn(actor)).toBeNull();
		});
	});

	// The claim is made through the primary GM's client, which rules on one at a time (deaths-door-relay.js): the lock
	// that turns two owners' presses of Roll inside one round trip into one roll.
	describe("the GM's client holds the lock", () => {
		it("grants the claim that reaches it first, and refuses the second: that window waits on the roll and never rolls", async () => {
			let letAlineThrough;
			const alineHeld = new Promise(resolve => { letAlineThrough = resolve; });
			const gm = withGM({ holdFor: { p1: alineHeld } });
			const info = vi.spyOn(globalThis.ui.notifications, "info");
			try {
				const { actor, character } = dyingHero();   // Impetuous Youth: the roll waits on giving it your all
				as("p1");
				const aline = windowOn(character);
				as("p2");
				const bea = windowOn(character);

				// Aline presses first, but her claim is still on its way to the GM when Bea presses hers.
				as("p1");
				const alinePress = aline._onRoll();
				// Past the pre-roll window: her claim is on its way, under her name.
				await vi.waitFor(() => expect(gm.query).toHaveBeenCalledTimes(1));
				as("p2");
				const card = await rollAt(bea, 8);
				expect(rollingOn(actor)).toMatchObject({ userId: "p2", total: 8 });

				as("p1");
				letAlineThrough();
				await alinePress;

				expect(gm.query).toHaveBeenCalledTimes(2);
				expect(gm.query).toHaveBeenCalledWith(DEATHS_DOOR_CLAIM_QUERY,
					expect.objectContaining({ actorId: actor.id, takeOver: false, userId: "p1" }), expect.anything());
				expect(rollStat).toHaveBeenCalledTimes(1);
				expect(rollingOn(actor)).toMatchObject({ userId: "p2", messageId: card.id });
				const data = aline.getData();
				expect(data).toMatchObject({ isWatching: true, isRoll: false, isResult: false });
				expect(data.watch).toMatchObject({ userName: "Bea", rolled: true, total: 8, canTakeOver: false });
				expect(info).toHaveBeenCalledWith(
					"Bea is already rolling Death's Door for Wren, so nothing was rolled here. This window follows their roll.");

				// Bea's roll lands as hers, once.
				as("p2");
				await bea._onAcceptResult();
				expect(character.setDeathsDoorState).toHaveBeenCalledTimes(1);
				expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			} finally {
				info.mockRestore();
			}
		});

		it("refuses a claim that arrives after the Door was settled: nothing rolls a second tier", async () => {
			let letAlineThrough;
			const alineHeld = new Promise(resolve => { letAlineThrough = resolve; });
			const gm = withGM({ holdFor: { p1: alineHeld } });
			const { actor, character } = dyingHero({ background: null });   // nothing to wait on: lands with the dice
			as("p1");
			const aline = windowOn(character);
			const alinePress = aline._onRoll();
			await vi.waitFor(() => expect(gm.query).toHaveBeenCalledTimes(1));
			as("p2");
			await rollAt(windowOn(character), 9);
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);

			as("p1");
			letAlineThrough();
			await alinePress;
			expect(rollStat).toHaveBeenCalledTimes(1);
			expect(character.setDeathsDoorState).toHaveBeenCalledTimes(1);
			expect(rollingOn(actor)).toBeNull();
		});

		it("runs the GM's own claim through the same lock, with no query to itself", async () => {
			let letAlineThrough;
			const alineHeld = new Promise(resolve => { letAlineThrough = resolve; });
			const gm = withGM({ holdFor: { p1: alineHeld } });
			const { actor, character } = dyingHero();
			as("p1");
			const aline = windowOn(character);
			const alinePress = aline._onRoll();
			await vi.waitFor(() => expect(gm.query).toHaveBeenCalledTimes(1));

			as("gm");
			let during = null;
			await rollAt(windowOn(character), 8, { during: () => { during = structuredClone(rollingOn(actor)); } });
			expect(gm.query).toHaveBeenCalledTimes(1);   // Aline's, still on its way: none of the GM's own
			expect(during).toMatchObject({ userId: "gm", userName: "Gamemaster", total: null });

			// Aline's claim reaches the GM after the GM's own: refused, as any other would be.
			as("p1");
			letAlineThrough();
			await alinePress;
			expect(rollStat).toHaveBeenCalledTimes(1);
			expect(rollingOn(actor)).toMatchObject({ userId: "gm", total: 8 });
			expect(aline.getData().watch).toMatchObject({ userName: "Gamemaster" });
		});

		it("hands a stale roll to the owner taking it over, who accepts it without rolling", async () => {
			const gm = withGM();
			as("p1");
			const { actor, character } = dyingHero();
			const card = await rollAt(windowOn(character), 8);
			const { nonce } = rollingOn(actor);
			game.time.serverTime += DEATHS_DOOR_ROLL_STALE_MS + 1;

			as("p2");
			const bea = windowOn(character);
			expect(bea.getData().watch).toMatchObject({ canTakeOver: true, takeOverAccepts: true });
			rollStat.mockClear();
			await bea._onTakeOver();

			expect(gm.query).toHaveBeenLastCalledWith(DEATHS_DOOR_CLAIM_QUERY,
				expect.objectContaining({ nonce, takeOver: true, userId: "p2" }), expect.anything());
			expect(rollingOn(actor)).toMatchObject({
				userId: "p2", userName: "Bea", nonce, messageId: card.id, total: 8, tier: "partial", at: game.time.serverTime,
			});
			expect(bea.getData()).toMatchObject({ isWatching: false, isResult: true, boostsPending: true, rolledTotal: 8 });
			await bea._onAcceptResult();
			expect(rollStat).not.toHaveBeenCalled();
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		});

		it("refuses a take-over whose roller is back by the time it arrives: the taker follows their roll", async () => {
			const gm = withGM({ beforeRuling: () => { world.users.get("p1").active = true; } });
			as("p1");
			const { actor, character } = dyingHero();
			await rollAt(windowOn(character), 8);
			world.users.get("p1").active = false;

			as("p2");
			const bea = windowOn(character);
			expect(bea.getData().watch.canTakeOver).toBe(true);
			await bea._onTakeOver();

			expect(gm.query).toHaveBeenCalledTimes(2);
			expect(rollingOn(actor)).toMatchObject({ userId: "p1" });
			const data = bea.getData();
			expect(data).toMatchObject({ isWatching: true, isResult: false });
			expect(data.watch).toMatchObject({ userName: "Aline", canTakeOver: false });
		});

		it("rules only on the primary GM's client, and only for an owner", async () => {
			const { actor } = dyingHero();
			withGM();
			const ask = { actorId: actor.id, nonce: "n", takeOver: false, userId: "p1" };
			as("p1");
			expect(await handleDeathsDoorClaimQuery(ask, {})).toBeNull();
			as("gm");
			actor.testUserPermission = () => false;
			expect(await handleDeathsDoorClaimQuery(ask, {})).toBeNull();
			expect(rollingOn(actor)).toBeNull();
		});

		it("with no GM to rule, a claim another owner's write landed over rolls nothing, and waits on theirs", async () => {
			as("p1");
			const { actor, character } = dyingHero();
			actor.flags[SCOPE].battleJoy = true;
			const beas = { userId: "p2", userName: "Bea", at: 1_000_000, nonce: "beas", messageId: null, total: null, tier: null, boosts: null };
			// Bea's claim reaches the server just after Aline's, and its update is what Aline's client reads back.
			const write = actor.update.getMockImplementation();
			actor.update.mockImplementationOnce(async (data, options) => {
				await write(data, options);
				actor.flags[SCOPE].deathsDoorRolling = { ...beas };
			});
			const aline = windowOn(character);

			await aline._onRoll();

			expect(rollStat).not.toHaveBeenCalled();
			// Nothing moved, not even the Battle Joy's end, and Bea's claim stands.
			expect(actor.flags[SCOPE].battleJoy).toBe(true);
			expect(rollingOn(actor)).toEqual(beas);
			const data = aline.getData();
			expect(data).toMatchObject({ isWatching: true, isRoll: false });
			expect(data.watch.userName).toBe("Bea");
		});

		it("is registered on every client, for whichever of them is the GM", () => {
			const main = readRepo("stonetop.js");
			expect(main).toContain("CONFIG.queries[DEATHS_DOOR_CLAIM_QUERY] = (data, context) => handleDeathsDoorClaimQuery(data, context);");
			expect(main).toContain("CONFIG.queries[DEATHS_DOOR_BOOST_QUERY] = (data, context) => handleDeathsDoorBoostQuery(data, context);");
		});
	});

	// Everything a window taking the roll over may need of it goes on the marker as the dice land, not only while the
	// result waits: a private roll's card never reaches the other owners, so the marker is all they have of it.
	describe("the marker carries the result the moment it lands", () => {
		it("the card, the total, the tier it counts as and the boosts left, on every path to landing", async () => {
			as("p1");
			// Nothing to wait on: noted, then landed and cleared.
			const plain = dyingHero({ background: null });
			const plainCard = await rollAt(windowOn(plain.character), 5);
			expect(noted(plain.actor).at(-1)).toMatchObject({ messageId: plainCard.id, total: 5, tier: "failure", boosts: [] });
			expect(rollingOn(plain.actor)).toBeNull();

			// Waiting, with both boosts on offer.
			const both = dyingHero({ xp: 8 });
			const bothCard = await rollAt(windowOn(both.character), 8);
			expect(rollingOn(both.actor)).toMatchObject({ messageId: bothCard.id, total: 8, tier: "partial", boosts: ["burn", "giveAll"] });

			// A boost that leaves nothing more to offer: the lifted result noted as it lands.
			const driven = dyingHero({ background: "driven", xp: 2 });
			const burner = windowOn(driven.character);
			await rollAt(burner, 9);
			expect(rollingOn(driven.actor)).toMatchObject({ total: 9, tier: "partial", boosts: ["burn"] });
			await burner._onBurnBrightly();
			expect(noted(driven.actor).at(-1)).toMatchObject({ total: 10, tier: "success", boosts: [] });
			expect(rollingOn(driven.actor)).toBeNull();

			// The Destined's: the tier the dice COUNT as.
			const destined = dyingHero({ background: "destined", tierShift: "Destined" });
			await rollAt(windowOn(destined.character), 5);
			expect(noted(destined.actor).at(-1)).toMatchObject({ total: 5, tier: "partial", boosts: [] });

			// Never Gonna Keep Me Down: no dice, and its 10+ noted all the same.
			const skip = dyingHero({ background: null, skipRollMove: NEVER_GONNA_KEEP_ME_DOWN });
			await windowOn(skip.character)._onTakeTenPlus();
			expect(noted(skip.actor).at(-1)).toMatchObject({ messageId: null, total: null, tier: "success", boosts: [] });
		});
	});

	// A self, blind or GM roll: the card reaches its roller and the GM, and no other owner.
	describe("a private roll, taken over", () => {
		it("spends its boosts through the GM's client, which rewrites the card the taker never saw", async () => {
			const gm = withGM();
			as("p1");
			const { actor, character } = dyingHero({ xp: 8 });   // Impetuous Youth, with the XP to Burn Brightly
			const card = await rollAt(windowOn(character), 5, { onlyFor: ["p1", "gm"] });
			expect(rollingOn(actor)).toMatchObject({ messageId: card.id, total: 5, tier: "failure", boosts: ["burn", "giveAll"] });
			world.users.get("p1").active = false;

			as("p2");
			expect(game.messages.get(card.id)).toBeUndefined();
			const bea = windowOn(character);
			expect(bea.getData().watch).toMatchObject({ canTakeOver: true, takeOverAccepts: true, total: 5, tier: "failure" });
			await bea._onTakeOver();
			expect(bea.getData()).toMatchObject({
				isResult: true, boostsPending: true, rolledTotal: 5, canBurnBrightly: true, canGiveItAll: true, privateBoostsNote: "",
			});

			await bea._onBurnBrightly();
			expect(gm.query).toHaveBeenLastCalledWith(DEATHS_DOOR_BOOST_QUERY,
				expect.objectContaining({ boost: "burn", messageId: card.id, userId: "p2" }), expect.anything());
			expect(card.rolls[0].total).toBe(6);
			expect(card.store.burnBrightly).toBe(true);
			expect(actor.system.attributes.xp.value).toBe(6);
			expect(bea.getData()).toMatchObject({ boostsPending: true, rolledTotal: 6, canBurnBrightly: false, canGiveItAll: true });
			expect(rollingOn(actor)).toMatchObject({ userId: "p2", total: 6, tier: "failure", boosts: ["giveAll"] });

			stubAsk("hurt");
			await bea._onGiveItAll();
			expect(card.rolls[0].total).toBe(7);
			expect(card.store[GAVE_IT_ALL_FLAG]).toEqual({ cost: "hurt", from: 6, to: 7 });
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
			expect(rollingOn(actor)).toBeNull();
			expect(bea.getData().tierNote).toBe("Burn Brightly: 5 → 6. Impetuous Youth: 6 → 7, and got hurt.");
		});

		// One client writes a card's dice while a GM is connected (utils/roll-card-writer.js): the window's own
		// card too, so a Judge's +1 relayed to the GM and this Burn Brightly cannot erase each other.
		it("has the GM's client write even a card this window can read, while a GM is connected", async () => {
			const gm = withGM();
			as("p1");
			const { actor, character } = dyingHero({ xp: 8 });
			const win = windowOn(character);
			const card = await rollAt(win, 5);
			await win._onBurnBrightly();
			expect(gm.query).toHaveBeenLastCalledWith(DEATHS_DOOR_BOOST_QUERY,
				expect.objectContaining({ boost: "burn", messageId: card.id, userId: "p1" }), expect.anything());
			expect(card.rolls[0].total).toBe(6);
			expect(actor.system.attributes.xp.value).toBe(6);
			expect(win.getData()).toMatchObject({ boostsPending: true, rolledTotal: 6, canBurnBrightly: false });
		});

		it("with no GM connected, offers Accept only and says why", async () => {
			as("p1");
			const { actor, character } = dyingHero({ xp: 8 });
			const card = await rollAt(windowOn(character), 5, { onlyFor: ["p1", "gm"] });
			world.users.get("p1").active = false;

			as("p2");
			const bea = windowOn(character);
			await bea._onTakeOver();
			const data = bea.getData();
			expect(data).toMatchObject({ isResult: true, boostsPending: true, rolledTotal: 5, canBurnBrightly: false, canGiveItAll: false });
			expect(data.privateBoostsNote).toBe(
				"This roll was private, so Burn Brightly and giving it your all need the GM online to change its card.");
			const html = draw(data);
			expect(html).toContain(data.privateBoostsNote);
			expect(html).toContain("Accept this result");
			expect(html).not.toContain("deaths-door-burn-btn");
			expect(html).not.toContain("deaths-door-give-all-btn");

			await bea._onBurnBrightly();
			expect(card.rolls[0].total).toBe(5);
			// A GM coming online brings them back.
			withGM();
			expect(bea.getData()).toMatchObject({ canBurnBrightly: true, canGiveItAll: true, privateBoostsNote: "" });
			game.users.activeGM = null;

			await bea._onAcceptResult();
			expect(stateOf(actor)).toBe(DEATHS_DOOR_STATE.FATE_PENDING);
			expect(rollingOn(actor)).toBeNull();
		});
	});
});
