// The buttons on a post-death move's card, and on the roll cards they post (module/actors/character/
// post-death-actions.js): the user's ruling R-AUTO, 2026-09-27. Poltergeist's Get angry and its Fury
// spends, Bodysnatcher's possession, Disembodied's manifesting, Implacable's push, and Red Wrath's and
// Torment's Blessing's "spend 1-3 Favor, and roll +Favor spent". HP lost goes through the plain HP writer,
// so a fall to 0 is noticed as after any blow.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	moveActionsFor, runPostDeathAction, loseHp, tierDamageButtons, pressCardButton,
	POLTERGEIST, RED_WRATH, TORMENTS_BLESSING,
} from "../../../module/actors/character/post-death-actions.js";
import { loreMoveItemData, postDeathMoveItemData } from "../../../module/actors/character/post-death-moves.js";
import { manifestedPicks, manifestsHarmfulTouch } from "../../../module/actors/character/manifest.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { makeLiveActor, makeLiveItem } from "../../fakes/LiveCharacter.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import { stubAsk, fakeForm } from "../../fakes/confirm.js";

const SRC = path.resolve("packs/src/stonetop-items/post-death-moves");
const shipped = (slug, file) => JSON.parse(fs.readFileSync(path.join(SRC, slug, `${file}.json`), "utf8"));

// A lore move as the sync creates it, and an insert's own move as setPostDeathInsert does.
const loreItem = (slug, file) => makeLiveItem(loreMoveItemData(new MoveDefinition(shipped(slug, file))));
const insertItem = (slug, file) => makeLiveItem(postDeathMoveItemData(new MoveDefinition(shipped(slug, file))));

let rolls;
let posted;
beforeEach(() => {
	rolls = [];
	posted = [];
	globalThis.Roll = class {
		constructor(formula) { this.formula = formula; }
		// A flat number is itself; a die answers the next queued total.
		async evaluate() { this.total = /^\d+$/.test(this.formula) ? Number(this.formula) : rolls.shift() ?? 3; this.dice = []; return this; }
		async toMessage(data) { posted.push({ formula: this.formula, ...data }); return data; }
	};
	globalThis.ChatMessage = {
		create: vi.fn(async data => { posted.push(data); return data; }),
		getSpeaker: () => ({ alias: "Wisp" }),
	};
});
afterEach(() => {
	delete globalThis.Roll;
	delete globalThis.ChatMessage;
});

function character({ items = [], flags = {}, hp = 8 } = {}) {
	const actor = makeLiveActor({ slug: "the-heavy", name: "Wisp", items, flags });
	actor.system.attributes.hp.value = hp;
	actor.isOwner = true;
	const char = new StonetopCharacter(actor, new FakeRepositoryFactory());
	actor.typedActor = char;
	// The roll itself is the sheet's whole ladder; what these moves hand it is what is under test.
	char.onDirectStatRoll = vi.fn(async () => ({ total: 8 }));
	return { actor, char };
}
const held = char => char.moveResources.getMoveResources()[POLTERGEIST] ?? 0;
const prompt = vi.fn(async () => ({ situational: 0 }));

describe("the buttons each move card carries", () => {
	it("draws a Poltergeist's four, the spends off while no Fury is held", () => {
		const { actor } = character({ items: [loreItem("ghost", "poltergeist")] });
		const actions = moveActionsFor(actor)[POLTERGEIST];
		expect(actions.map(a => a.action)).toEqual(["getAngry", "shatter", "hurl", "fling"]);
		expect(actions.map(a => a.disabled)).toEqual([false, true, true, true]);
		expect(actions[1].tooltip).toContain("no Fury");
	});

	it("draws Red Wrath's roll off while the Thrall holds no Favor, and nothing for a move they lack", () => {
		const poor = character({ items: [loreItem("thrall", "red-wrath")] });
		expect(moveActionsFor(poor.actor)[RED_WRATH][0]).toMatchObject({ action: "lashOut", disabled: true });
		const rich = character({ items: [loreItem("thrall", "red-wrath")], flags: { "postDeathLore.counts": { "favor:favor-track": 2 } } });
		expect(moveActionsFor(rich.actor)[RED_WRATH][0].disabled).toBe(false);
		expect(moveActionsFor(rich.actor)[TORMENTS_BLESSING]).toBeUndefined();
	});
});

describe("Poltergeist", () => {
	// The user's ruling R6 (2026-10-27): the book prints no ceiling, so what is rolled is all held.
	it("gets angry: loses 1d4 HP and holds that much Fury, with no ceiling", async () => {
		const { actor, char } = character({ items: [loreItem("ghost", "poltergeist")], hp: 12 });
		rolls.push(3);
		await runPostDeathAction(actor, "getAngry");
		expect(actor.system.attributes.hp.value).toBe(9);
		expect(held(char)).toBe(3);
		expect(posted.at(-1).formula).toBe("1d4");
		expect(posted.at(-1).flavor).toContain("Holds 3 Fury");
		rolls.push(4);
		await runPostDeathAction(actor, "getAngry");
		expect(held(char)).toBe(7);
		expect(posted.at(-1).flavor).toContain("Holds 7 Fury");
		expect(actor.system.attributes.hp.value).toBe(5);
	});

	it("spends from Fury held past four without clamping the rest away", async () => {
		const { actor, char } = character({ items: [loreItem("ghost", "poltergeist")] });
		await char.moveResources.setUses(POLTERGEIST, 6);
		expect(await runPostDeathAction(actor, "shatter")).toBe(true);
		expect(held(char)).toBe(5);
	});

	it("hurls: asks the roll window, spends 1 Fury, then rolls +DEX with your damage on both hits", async () => {
		const { actor, char } = character({ items: [loreItem("ghost", "poltergeist")] });
		await char.moveResources.setUses(POLTERGEIST, 2);
		expect(await runPostDeathAction(actor, "hurl", { prompt })).toBe(true);
		expect(held(char)).toBe(1);
		const [stat, options] = char.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("dex");
		expect(options.moveName).toBe("Poltergeist: Hurl");
		expect(options.moveResults.partial.value).toContain("lose 1d4 HP");
		expect(options.tierActions.success).toContain("stonetop-pd-own-damage");
		expect(options.tierActions.partial).toContain("stonetop-pd-own-damage");
		expect(options.tierActions.partial).toContain('data-formula="1d4"');
	});

	it("flings +INT, the pin's HP on both hits; a closed window spends nothing", async () => {
		const { actor, char } = character({ items: [loreItem("ghost", "poltergeist")] });
		await char.moveResources.setUses(POLTERGEIST, 1);
		expect(await runPostDeathAction(actor, "fling", { prompt: async () => null })).toBe(false);
		expect(held(char)).toBe(1);
		await runPostDeathAction(actor, "fling", { prompt });
		expect(char.onDirectStatRoll.mock.calls[0][0]).toBe("int");
		expect(char.onDirectStatRoll.mock.calls[0][1].tierActions.success).toContain("stonetop-pd-pin");
		expect(held(char)).toBe(0);
	});

	it("shatters for 1 Fury, and not at all with none held", async () => {
		const { actor, char } = character({ items: [loreItem("ghost", "poltergeist")] });
		expect(await runPostDeathAction(actor, "shatter")).toBe(false);
		await char.moveResources.setUses(POLTERGEIST, 1);
		expect(await runPostDeathAction(actor, "shatter")).toBe(true);
		expect(held(char)).toBe(0);
		expect(posted.at(-1).content).toContain("0 Fury left");
	});
});

describe("the HP the other moves cost", () => {
	it("Bodysnatcher's possession loses 1d4 HP", async () => {
		const { actor } = character({ items: [loreItem("ghost", "bodysnatcher")] });
		// Nobody targeted: asked first, and "possess anyway" bills the 1d4 (bodysnatcher.test.js has the rest).
		stubAsk("untracked");
		rolls.push(2);
		await runPostDeathAction(actor, "possess");
		expect(actor.system.attributes.hp.value).toBe(6);
		expect(posted.at(-1).flavor).toContain("HP 8 → 6");
	});

	it("Implacable asks which feat, and loses 1d4 HP for it", async () => {
		const { actor } = character({ items: [insertItem("revenant", "implacable")] });
		const wait = stubAsk("push-1");
		rolls.push(4);
		expect(await runPostDeathAction(actor, "push")).toBe(true);
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual([
			"Perform a feat of inhuman strength", "Act with uncanny speed and grace", "Refuse to be moved, held back, or knocked off course",
		]);
		expect(actor.system.attributes.hp.value).toBe(4);
		expect(posted.at(-1).flavor).toContain("Act with uncanny speed and grace");
	});

	it("Disembodied's first manifestation is free and each one after it costs 1d4 HP", async () => {
		const one = character({ items: [insertItem("ghost", "disembodied")] });
		stubAsk("manifest", fakeForm({ "manifest-1": { checked: true } }));
		await runPostDeathAction(one.actor, "manifest");
		expect(one.actor.system.attributes.hp.value).toBe(8);
		expect(posted.at(-1).content).toContain("You can speak clearly and intelligibly");

		const three = character({ items: [insertItem("ghost", "disembodied")] });
		stubAsk("manifest", fakeForm({ "manifest-0": { checked: true }, "manifest-1": { checked: true }, "manifest-2": { checked: true } }));
		rolls.push(5);
		await runPostDeathAction(three.actor, "manifest");
		expect(posted.at(-1).formula).toBe("2d4");
		expect(three.actor.system.attributes.hp.value).toBe(3);
	});

	// Audit GH-6 (the user's ruling, 2026-10-27): the picks are kept while manifest, named on the End
	// manifestation button, and gone when it is pressed.
	it("Disembodied keeps the picks while manifest, and End manifestation clears them", async () => {
		const TOUCH = "Your touch (or ghostly weapons) can harm the living (ignores armor)";
		const { actor } = character({ items: [insertItem("ghost", "disembodied")], flags: { "postDeathInsert.slug": "ghost" } });
		expect(moveActionsFor(actor).Disembodied.map(a => a.action)).toEqual(["manifest"]);

		stubAsk("manifest", fakeForm({ "manifest-1": { checked: true }, "manifest-2": { checked: true } }));
		rolls.push(2);
		await runPostDeathAction(actor, "manifest");
		expect(manifestedPicks(actor)).toEqual(["You can speak clearly and intelligibly", TOUCH]);
		expect(manifestsHarmfulTouch(actor)).toBe(true);
		const end = moveActionsFor(actor).Disembodied[1];
		expect(end.action).toBe("endManifestation");
		expect(end.tooltip).toContain("You can speak clearly and intelligibly");

		await runPostDeathAction(actor, "endManifestation");
		expect(manifestedPicks(actor)).toEqual([]);
		expect(posted.at(-1).content).toContain("no longer manifest");
	});

	it("never takes HP below 0", async () => {
		const { actor } = character({ hp: 2 });
		rolls.push(4);
		expect(await loseHp(actor, "1d4", { moveName: "Implacable" })).toEqual({ lost: 4, oldHp: 2, newHp: 0 });
	});
});

describe("spend 1-3 Favor, and roll +Favor spent", () => {
	const favorFlags = n => ({ "postDeathInsert.slug": "thrall", "postDeathLore.counts": { "favor:favor-track": n } });

	it("offers only what is held, spends it, and rolls with it as the number added", async () => {
		const { actor, char } = character({ items: [loreItem("thrall", "red-wrath")], flags: favorFlags(2) });
		const wait = stubAsk("spend-2");
		expect(await runPostDeathAction(actor, "lashOut", { prompt })).toBe(true);
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Spend 1 Favor", "Spend 2 Favor"]);
		expect(char.favor()).toBe(0);
		const [stat, options] = char.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("");
		expect(options).toMatchObject({ statValue: 2, moveName: RED_WRATH });
		expect(options.conditionNotes).toEqual(["Spent 2 Favor"]);
	});

	it("rolls nothing and spends nothing when the window closes", async () => {
		const { actor, char } = character({ items: [loreItem("thrall", "red-wrath")], flags: favorFlags(3) });
		stubAsk(null);
		expect(await runPostDeathAction(actor, "lashOut", { prompt })).toBe(false);
		expect(char.favor()).toBe(3);
		expect(char.onDirectStatRoll).not.toHaveBeenCalled();
	});

	it("gives Red Wrath's hits 2d8 (messy, forceful), the 7-9 being as a 10+", () => {
		const moveResults = shipped("thrall", "red-wrath").system.moveResults;
		const buttons = tierDamageButtons(moveResults, { move: RED_WRATH });
		for (const tier of ["success", "partial"]) {
			expect(buttons[tier]).toContain('data-formula="2d8"');
			expect(buttons[tier]).toContain('data-tags="messy,forceful"');
			expect(buttons[tier]).toContain('data-ignores="0"');
		}
	});

	it("gives Torment's Blessing's 10+ 2d4 and its 7-9 1d6 that ignores armor", () => {
		const buttons = tierDamageButtons(shipped("thrall", "torments-blessing").system.moveResults, { move: TORMENTS_BLESSING });
		expect(buttons.success).toContain('data-formula="2d4"');
		expect(buttons.success).toContain('data-ignores="0"');
		expect(buttons.partial).toContain('data-formula="1d6"');
		expect(buttons.partial).toContain('data-ignores="1"');
	});
});

describe("a roll card's HP button", () => {
	const button = (cls, data) => ({
		classList: { contains: c => c === cls },
		dataset: data,
		disabled: false,
	});
	function card() {
		const flags = {};
		return {
			flags,
			getFlag: (_s, key) => key.split(".").reduce((v, k) => v?.[k], flags),
			setFlag: vi.fn(async (_s, key, value) => {
				const parts = key.split(".");
				let node = flags;
				for (const part of parts.slice(0, -1)) node = node[part] ??= {};
				node[parts.at(-1)] = value;
			}),
			unsetFlag: vi.fn(async () => {}),
		};
	}

	// A GM Shift between 7-9 and 10+ draws the other tier's row; the blow already dealt is still the one owed.
	it("latches a damage button once per card, whichever tier it sits on", () => {
		const buttons = tierDamageButtons(shipped("thrall", "torments-blessing").system.moveResults, { move: TORMENTS_BLESSING });
		expect(buttons.success).toContain('data-key="move-damage"');
		expect(buttons.partial).toContain('data-key="move-damage"');
	});

	it("loses the HP once and latches on the card", async () => {
		const { actor } = character();
		const message = card();
		rolls.push(2);
		const btn = button("stonetop-pd-lose-hp", { key: "lose-hp-partial", move: "Poltergeist: Hurl", formula: "1d4" });
		expect(await pressCardButton(message, actor, btn)).toBe(true);
		expect(actor.system.attributes.hp.value).toBe(6);
		expect(message.flags.postDeathCard["lose-hp-partial"]).toBe(true);
	});

	it("pays the pin's 1 HP as often as they strain", async () => {
		const { actor } = character();
		const message = card();
		const btn = button("stonetop-pd-pin", { key: "pin-success", move: "Poltergeist: Telekinetic Force" });
		await pressCardButton(message, actor, btn);
		await pressCardButton(message, actor, btn);
		expect(actor.system.attributes.hp.value).toBe(6);
		expect(message.setFlag).not.toHaveBeenCalled();
	});
});
