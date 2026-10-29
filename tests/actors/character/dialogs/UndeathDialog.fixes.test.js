// The 0-HP walkthrough's 2026-10-27 fixes: Dark Succor's task lights Apply as it is typed (LV-1), the roll
// stands on the actor across windows and owners (LV-2), a move that can't be paid is said and handed to the GM
// (GH-2), Tethered's card says where they reform (GH-3), the tether box stays while it is typed in (GH-10),
// Undying's own "out of the action" keeps its HP (RV-3), and the Revenant -> Ghost fork asks first (RV-5) and
// asks after the maimings (RV-4).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

// The pre-roll window. `during` runs while it is up (another owner rolling meanwhile, the character healed).
const prompt = vi.hoisted(() => ({ during: null }));
vi.mock("../../../../module/dialogs/RollDialog.js", () => ({
	promptRoll: async () => {
		const during = prompt.during;
		prompt.during = null;
		await during?.();
		return {};
	},
}));

import { UndeathDialog } from "../../../../module/actors/character/dialogs/UndeathDialog.js";
import { StonetopCharacter } from "../../../../module/actors/character/StonetopCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../../module/actors/character/deaths-door.js";
import { deathsDoorRollMarker } from "../../../../module/actors/character/deaths-door-actor.js";
import { UNDEATH_KEPT_HP_FLAG, comeBack } from "../../../../module/actors/character/undeath-return.js";
import { FakeRepositoryFactory } from "../../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../../fakes/LiveCharacter.js";
import { readRepo } from "../../../fakes/css.js";
import { stubConfirm } from "../../../fakes/confirm.js";

const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));

const GHOST_CONSEQUENCES = ["bodysnatcher", "breakdown", "unstable", "disturbing", "otherworldly", "poltergeist", "quarry", "specter"];
const REVENANT_CONSEQUENCES = ["breakdown", "unstable", "carrion-stench", "deathly-visage", "home-to-vermin", "nightkin",
	"quarry", "strange-appetites", "insatiable"];

/** A character wearing `slug`, at 0 HP of 16 and dying (as UndeathDialog.apply.test.js builds one). */
function makeUndead(slug, { counts = {}, insert = {}, hp = 0, state = DEATHS_DOOR_STATE.DYING, flags = {} } = {}) {
	const actor = makeLiveActor({
		name: "Vess",
		flags: { deathsDoor: state, postDeathInsert: { slug, ...insert }, postDeathLore: { counts }, ...flags },
	});
	actor.id = "vess";
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
const allMarked = slugs => Object.fromEntries(slugs.map(s => [`consequences:${s}`, 1]));

async function landed(char, tierKey) {
	const dialog = await UndeathDialog.open(char, () => {});
	dialog._tierKey = tierKey;
	dialog._step = "resolve";
	dialog._syncForcedPicks();
	return dialog;
}

/** A dialog's window as the listeners see it: `find(sel)` hands back recorders for `.on` and `.prop`. */
function fakeHtml() {
	const handlers = {}, props = [];
	const html = {
		find: sel => ({
			on: (evt, fn) => { (handlers[`${sel}|${evt}`] ??= []).push(fn); },
			prop: (key, value) => props.push({ sel, key, value }),
			val: () => "",
		}),
		0: null,
	};
	return { html, handlers, props };
}

let chat;
beforeEach(() => {
	chat = vi.fn(async () => ({}));
	global.ChatMessage = { create: chat, getSpeaker: () => ({}) };
});
afterEach(() => {
	prompt.during = null;
	delete global.ChatMessage;
	delete globalThis.foundry?.applications?.api?.DialogV2;
});

describe("LV-1: Dark Succor's task lights Apply as it is typed", () => {
	it("the task box's input re-reads the gate and sets the button without a redraw", async () => {
		const { char } = makeUndead("thrall");
		const dialog = await landed(char, "success");
		dialog._setPicked("task", true);
		expect(dialog.getData().canApply).toBe(false);

		const { html, handlers, props } = fakeHtml();
		const base = Object.getPrototypeOf(UndeathDialog.prototype);
		const parentProto = Object.getPrototypeOf(base);
		parentProto.activateListeners ??= () => {};
		dialog.activateListeners(html);
		handlers[".undeath-task-input|input"][0]({ currentTarget: { value: "Drown the shrine" } });

		expect(dialog._choices.task).toBe("Drown the shrine");
		expect(props).toContainEqual({ sel: ".undeath-apply-btn", key: "disabled", value: false });
	});
});

describe("LV-2: the roll stands on the actor", () => {
	it("a second window resumes the landed roll instead of rolling, and the costs are paid once", async () => {
		const { actor, char } = makeUndead("revenant");
		char.onDirectStatRoll = vi.fn(async () => ({ total: 4 }));
		const first = await UndeathDialog.open(char, () => {});
		// Another owner's window, open on the Roll step before the dice fell.
		const waiting = await UndeathDialog.open(char, () => {});
		await first._onRoll();
		expect(first._tierKey).toBe("failure");
		expect(deathsDoorRollMarker(actor)).toMatchObject({ tier: "failure", total: 4 });

		// Its Roll press picks the landed roll up rather than rolling again.
		await waiting._onRoll();
		expect(char.onDirectStatRoll).toHaveBeenCalledTimes(1);
		expect(waiting._step).toBe("resolve");
		expect(waiting._tierKey).toBe("failure");

		// Closed and opened again: straight onto the 6-'s costs.
		const second = await UndeathDialog.open(char, () => {});
		expect(second._step).toBe("resolve");
		expect(second._tierKey).toBe("failure");
		expect([...second._picked].sort()).toEqual(["consequence", "maim", "out-of-action"]);

		second._setChoice("consequence", "nightkin");
		await second._onApply();
		expect(actor.system.attributes.wounds).toHaveLength(1);
		expect(deathsDoorRollMarker(actor)).toBeNull();

		// The first window, still open on the same 6-, pays nothing a second time.
		first._setChoice("consequence", "breakdown");
		await first._onApply();
		expect(count(actor, "consequences:breakdown")).toBe(0);
		expect(actor.system.attributes.wounds).toHaveLength(1);
	});

	it("a roll left by another brush with death is not resumed once they are not dying", async () => {
		const { actor, char } = makeUndead("revenant", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		actor.flags["stonetop-pwd"].deathsDoorRolling = { userId: "u", nonce: "undeath:x", tier: "failure", total: 3 };
		const dialog = await UndeathDialog.open(char, () => {});
		expect(dialog._step).toBe("roll");
	});
});

// Audit VL-1 / VL-2 (2026-10-28): the gaps the roll's stamp left open.
describe("VL-1: a window left waiting never rolls or pays a second time", () => {
	it("a roll landed while the pre-roll window was up is resumed, not rolled again", async () => {
		const { char } = makeUndead("revenant");
		char.onDirectStatRoll = vi.fn(async () => ({ total: 4 }));
		const waiting = await UndeathDialog.open(char, () => {});
		const other = await UndeathDialog.open(char, () => {});
		// The player sits in the pre-roll window; the GM rolls in theirs meanwhile.
		prompt.during = () => other._onRoll();
		await waiting._onRoll();
		expect(char.onDirectStatRoll).toHaveBeenCalledTimes(1);
		expect(waiting._step).toBe("resolve");
		expect(waiting._tierKey).toBe("failure");
	});

	it("nothing is rolled once they stopped dying while the pre-roll window was up", async () => {
		const { actor, char } = makeUndead("revenant");
		char.onDirectStatRoll = vi.fn(async () => ({ total: 4 }));
		const dialog = await UndeathDialog.open(char, () => {});
		prompt.during = async () => { actor.flags["stonetop-pwd"].deathsDoor = null; };
		await dialog._onRoll();
		expect(char.onDirectStatRoll).not.toHaveBeenCalled();
	});

	it("a window past the Roll step does not roll", async () => {
		const { char } = makeUndead("revenant");
		char.onDirectStatRoll = vi.fn(async () => ({ total: 11 }));
		const dialog = await landed(char, "failure");
		await dialog._onRoll();
		expect(char.onDirectStatRoll).not.toHaveBeenCalled();
		expect(dialog._tierKey).toBe("failure");
	});

	it("Apply does nothing while the gate the button is drawn with is shut", async () => {
		const { actor, char } = makeUndead("thrall");
		const dialog = await landed(char, "success");
		dialog._setPicked("task", true);
		expect(dialog._canApply()).toBe(false);
		await dialog._onApply();
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DYING);
		expect(chat).not.toHaveBeenCalled();
	});

	it("the fork to the Ghost, confirmed after the move was settled elsewhere, swaps nothing", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "failure");
		dialog._insertRepo = new FakePostDeathInsertRepository(INSERTS);
		dialog._openChoices = vi.fn(async () => {});
		dialog._confirmGhost = vi.fn(async () => {
			actor.flags["stonetop-pwd"].deathsDoor = DEATHS_DOOR_STATE.OUT_OF_ACTION;
			return true;
		});
		await dialog._onAlternative("ghost");
		expect(flag(actor, "postDeathInsert").slug).toBe("revenant");
		expect(dialog._openChoices).not.toHaveBeenCalled();
	});
});

describe("VL-2: no stamp on a character who stopped dying while the dice fell", () => {
	it("a roll that lands after the GM's not-lethal leaves no marker to resume", async () => {
		const { actor, char } = makeUndead("thrall");
		char.onDirectStatRoll = vi.fn(async () => {
			actor.flags["stonetop-pwd"].deathsDoor = DEATHS_DOOR_STATE.OUT_OF_ACTION;
			return { total: 5 };
		});
		const dialog = await UndeathDialog.open(char, () => {});
		await dialog._onRoll();
		expect(deathsDoorRollMarker(actor)).toBeNull();
	});
});

describe("GH-2's checkbox, as undeath.hbs draws and wires it", () => {
	const render = data => {
		const hb = Handlebars.create();
		hb.registerHelper("eq", (a, b) => a === b);
		const doc = new Window().document;
		doc.body.innerHTML = hb.compile(readRepo("templates/dialogs/undeath.hbs"))(data);
		return doc;
	};

	it("draws the Final Consequence box unticked with its note, ticked once the GM ticks it, and its change sets it", async () => {
		const { char } = makeUndead("ghost", { counts: allMarked(GHOST_CONSEQUENCES), insert: { tether: "My bones" } });
		const dialog = await UndeathDialog.open(char, () => {});
		const doc = render(dialog.getData());
		const box = doc.querySelector(".undeath-unpayable input.undeath-owed-final");
		expect(box).not.toBeNull();
		expect(box.checked).toBe(false);
		expect(doc.querySelector(".undeath-unpayable").textContent).toContain("can't be paid");

		const { html, handlers } = fakeHtml();
		dialog.render = vi.fn();
		const base = Object.getPrototypeOf(Object.getPrototypeOf(UndeathDialog.prototype));
		base.activateListeners ??= () => {};
		dialog.activateListeners(html);
		handlers[".undeath-owed-final|change"][0]({ currentTarget: { checked: true } });
		expect(dialog._owedFinal).toBe(true);
		expect(render(dialog.getData()).querySelector(".undeath-owed-final").checked).toBe(true);
	});

	it("draws no such box for a move that can be paid", async () => {
		const { char } = makeUndead("ghost", { insert: { tether: "My bones" } });
		const doc = render((await UndeathDialog.open(char, () => {})).getData());
		expect(doc.querySelector(".undeath-owed-final")).toBeNull();
	});
});

describe("GH-2: every Consequence already marked", () => {
	it("Tethered: says so, offers the Final Consequence unticked, and posts its card either way", async () => {
		const { actor, char } = makeUndead("ghost", { counts: allMarked(GHOST_CONSEQUENCES), insert: { tether: "My bones" } });
		const dialog = await UndeathDialog.open(char, () => {});
		const data = dialog.getData();
		expect(data.unpayable).toMatchObject({ on: false });
		expect(data.pick).toBe(0);
		expect(data.canApply).toBe(true);

		await dialog._onApply();
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);
		expect(count(actor, "consequences:final-consequence")).toBe(0);
		expect(chat).toHaveBeenCalledTimes(1);
		expect(dialog._summary.join(" ")).toContain("can't be paid");
	});

	it("the GM's tick marks the Final Consequence, and they leave play", async () => {
		const { actor, char } = makeUndead("ghost", { counts: allMarked(GHOST_CONSEQUENCES), insert: { tether: "My bones" } });
		const dialog = await UndeathDialog.open(char, () => {});
		dialog._owedFinal = true;
		await dialog._onApply();
		expect(count(actor, "consequences:final-consequence")).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
	});

	it("Undying: only a 6- (all three) can't be paid; a 10+ is paid with the other costs", async () => {
		const counts = allMarked(REVENANT_CONSEQUENCES);
		expect((await landed(makeUndead("revenant", { counts }).char, "failure")).getData().unpayable).not.toBeNull();
		expect((await landed(makeUndead("revenant", { counts }).char, "success")).getData().unpayable).toBeNull();
	});
});

describe("GH-3 and GH-10: Tethered says where they reform, and keeps asking what they are bound to", () => {
	it("the card names the tether and the HP they reform with", async () => {
		const { char } = makeUndead("ghost");
		const dialog = await UndeathDialog.open(char, () => {});
		dialog._setChoice("consequence", "specter");
		dialog._tether = "The oak where I fell";
		expect(dialog.getData().needsTether).toBe(true);
		await dialog._onApply();
		const card = dialog._summary.join(" ");
		expect(card).toContain("disperses until the next sunset");
		expect(card).toContain("The oak where I fell");
		expect(card).toContain("8 HP");
	});

	it("a Ghost already bound is not asked", async () => {
		const { char } = makeUndead("ghost", { insert: { tether: "My bones" } });
		expect((await UndeathDialog.open(char, () => {})).getData().needsTether).toBe(false);
	});
});

describe("RV-3: Undying's own out of the action keeps the HP the move gave", () => {
	it("a 6- leaves them at 1 HP, and Back on your feet keeps it", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "failure");
		dialog._setChoice("consequence", "nightkin");
		await dialog._onApply();
		expect(actor.system.attributes.hp.value).toBe(1);
		expect(flag(actor, UNDEATH_KEPT_HP_FLAG)).toBe(true);

		expect(await comeBack(char)).toBe("back");
		expect(actor.system.attributes.hp.value).toBe(1);
		expect(flag(actor, "deathsDoor") ?? null).toBeNull();
		expect(flag(actor, UNDEATH_KEPT_HP_FLAG)).toBeUndefined();
	});

	it("a 10+ that stays on its feet leaves no stamp", async () => {
		const { actor, char } = makeUndead("revenant");
		const dialog = await landed(char, "success");
		dialog._setPicked("maim", true);
		await dialog._onApply();
		expect(flag(actor, UNDEATH_KEPT_HP_FLAG)).toBeUndefined();
	});

	it("Clear (a state that is not a return) lifts a stamp left standing, in the same write (audit LC-2)", async () => {
		// The insert gone (removed by hand), the stamp still on them, out of the action.
		const { actor, char } = makeUndead(null, { state: DEATHS_DOOR_STATE.OUT_OF_ACTION, flags: { [UNDEATH_KEPT_HP_FLAG]: true } });
		expect(await comeBack(char)).toBe("cleared");
		expect(flag(actor, UNDEATH_KEPT_HP_FLAG)).toBeUndefined();
		expect(flag(actor, "deathsDoor") ?? null).toBeNull();
	});

	it("out of the action with no stamp (an insert taken at the Door) comes back with half max HP", async () => {
		const { actor, char } = makeUndead("revenant", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION });
		expect(await comeBack(char)).toBe("back");
		expect(actor.system.attributes.hp.value).toBe(8);
	});
});

describe("GH-9: Reform asks whether the tether still stands", () => {
	it("destroyed: the Final Consequence instead of reforming, with a card", async () => {
		const { actor, char } = makeUndead("ghost", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION, insert: { tether: "My bones" } });
		const ask = vi.fn(async () => false);
		expect(await comeBack(char, { askTetherIntact: ask })).toBe("final");
		expect(ask).toHaveBeenCalledWith("My bones");
		expect(count(actor, "consequences:final-consequence")).toBe(1);
		expect(flag(actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.DEAD);
		expect(actor.system.attributes.hp.value).toBe(0);
		expect(chat).toHaveBeenCalledTimes(1);
	});

	it("intact reforms with half max HP; not yet changes nothing", async () => {
		const later = makeUndead("ghost", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION, insert: { tether: "My bones" } });
		expect(await comeBack(later.char, { askTetherIntact: async () => null })).toBeNull();
		expect(flag(later.actor, "deathsDoor")).toBe(DEATHS_DOOR_STATE.OUT_OF_ACTION);

		const { actor, char } = makeUndead("ghost", { state: DEATHS_DOOR_STATE.OUT_OF_ACTION, insert: { tether: "My bones" } });
		expect(await comeBack(char, { askTetherIntact: async () => true })).toBe("back");
		expect(actor.system.attributes.hp.value).toBe(8);
	});
});

describe("RV-5 and RV-4: the fork to the Ghost asks first, and asks after the maimings", () => {
	it("asks, naming the Consequences the Ghost does not print; a no changes nothing", async () => {
		const { actor, char } = makeUndead("revenant", {
			counts: { "consequences:breakdown": 1, "consequences:carrion-stench": 1 },
		});
		const dialog = await landed(char, "failure");
		dialog._insertRepo = new FakePostDeathInsertRepository(INSERTS);
		dialog._openChoices = vi.fn(async () => {});
		const wait = stubConfirm(false);

		await dialog._onAlternative("ghost");

		expect(wait).toHaveBeenCalledTimes(1);
		const asked = wait.mock.calls[0][0].content;
		expect(asked).toMatch(/CARRION STENCH/i);
		expect(asked).not.toMatch(/BREAKDOWN/i);
		expect(flag(actor, "postDeathInsert").slug).toBe("revenant");
		expect(dialog._openChoices).not.toHaveBeenCalled();
	});

	it("a yes swaps, and the maimings Undying left are marked healed unless they say not", async () => {
		const { actor, char } = makeUndead("revenant");
		actor.system.attributes.wounds = [
			{ id: "m1", text: "Permanently maimed: lost the left hand", status: "permanent" },
			{ id: "w2", text: "Broken rib", status: "problematic" },
		];
		const dialog = await landed(char, "failure");
		dialog._insertRepo = new FakePostDeathInsertRepository(INSERTS);
		dialog._openChoices = vi.fn(async () => {});
		dialog._confirmGhost = vi.fn(async () => true);
		dialog._askHealMaimings = vi.fn(async () => true);

		await dialog._onAlternative("ghost");

		expect(flag(actor, "postDeathInsert").slug).toBe("ghost");
		expect(dialog._askHealMaimings).toHaveBeenCalledWith(1);
		const wounds = actor.system.attributes.wounds;
		expect(wounds.find(w => w.id === "m1").healed).toBe(true);
		expect(wounds.find(w => w.id === "w2").healed).toBe(false);
		expect(dialog._openChoices).toHaveBeenCalled();
	});
});
