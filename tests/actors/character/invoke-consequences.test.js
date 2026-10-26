import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	invokeConsequenceKind, CONSEQUENCE, cardInvocations, invokeDebilityChoices, settleInvokeDebility, settleInvokeTick,
	CIRCLE_CHOICE, CONSEQUENCES_FLAG, wielderRollOptions, settleWielderInvoke, WIELDER_INVOKED_FLAG, invokeTenPlusCardBody,
	auspiciousBirthChoice, INVOKE_CONSEQUENCE_BULLETS, consequenceKindOf, consequenceBullet, invokeCardFlags,
	CARD_EMPOWERED_FLAG, EMPOWERED_CONSEQUENCE_FLAG, PRE_PICK_RECORD, HOLY_RELIC_FLAG, TEN_PLUS_FLAG,
	cardEmpoweredConsequence, prePickPending, prePickReplaced, holyRelicOffers, holyRelicsSpent, settleHolyRelic,
	settleReducedEffect, settleReducedChoice, reducedOutcome, laterCardNames,
} from "../../../module/actors/character/invoke-consequences.js";
import { firstOptionList } from "../../../module/utils/chat.js";
import { readInvocationState, resolveInvocationEnd } from "../../../module/actors/character/ongoing-invocation.js";

// R2: Invoke the Sun God's ticked consequences act on the sheet. B5: Wielder of the White Flame's 10+
// invokes as a 10+, once per card.

const SCOPE = "stonetop-pwd";
const INVOKE_JSON = path.resolve("packs/src/stonetop-items/playbook-moves/the-lightbearer/invoke-the-sun-god.json");
const INVOKE_DESCRIPTION = JSON.parse(fs.readFileSync(INVOKE_JSON, "utf8")).system.description;

/** A chat message whose flags live in a plain object, dotted keys and all, as Foundry's do. */
function card({ invocations = null } = {}) {
	const flags = { [SCOPE]: { move: "Invoke the Sun God", ...(invocations ? { invocations } : {}) } };
	const walk = (key, make) => {
		const parts = key.split(".");
		let at = flags[SCOPE];
		for (const p of parts.slice(0, -1)) at = make ? (at[p] ??= {}) : at?.[p];
		return [at, parts.at(-1)];
	};
	const message = {
		id: `m${Math.random()}`,
		flags,
		getFlag: (scope, key) => {
			const [at, leaf] = walk(key, false);
			return scope === SCOPE ? at?.[leaf] : undefined;
		},
		setFlag: vi.fn(async (_scope, key, value) => {
			const [at, leaf] = walk(key, true);
			at[leaf] = value && typeof value === "object" && !Array.isArray(value) ? { ...(at[leaf] ?? {}), ...value } : value;
		}),
		unsetFlag: vi.fn(async (_scope, key) => {
			const [at, leaf] = walk(key, false);
			if (at) delete at[leaf];
		}),
		canUserModify: () => true,
	};
	return message;
}

/** A Lightbearer, with just the model calls the consequences make. */
function lightbearer({ running = [], lit = true, marked = [], background = null, circle = 0, sun = [] } = {}) {
	let needsSun = [...sun];
	const model = {
		holyLight: lit,
		ongoingInvocations: [...running],
		markInvocationSnuff: vi.fn(async () => true),
		setHolyLight: vi.fn(async function (on) { const changed = model.holyLight !== on; model.holyLight = on; return changed; }),
		markNeedsSun: vi.fn(async slugs => { const added = slugs.filter(s => !needsSun.includes(s)); needsSun = [...needsSun, ...added]; return added; }),
		clearNeedsSun: vi.fn(async slugs => { const removed = needsSun.filter(s => slugs.includes(s)); needsSun = needsSun.filter(s => !slugs.includes(s)); return removed; }),
		get needsSun() { return needsSun; },
		debilityChoices: ["weakened", "dazed", "miserable"].map(key => ({ key, name: key[0].toUpperCase() + key.slice(1), marked: marked.includes(key) })),
		// As StonetopCharacter#debilityMarkChoices: Auspicious Birth's circle first when that background is taken.
		get debilityMarkChoices() {
			const circleChoice = auspiciousBirthChoice({ playbook: "The Lightbearer", background, setupResources: model.background.setupResources });
			return circleChoice ? [circleChoice, ...model.debilityChoices] : model.debilityChoices;
		},
		markDebility: vi.fn(async key => !marked.includes(key)),
		background: {
			selectedSlug: background,
			setupResources: { "auspicious-birth": circle },
			setSetupResource: vi.fn(async () => {}),
		},
	};
	return {
		id: "seren", name: "Seren", type: "character", isOwner: true,
		system: { playbook: { name: "The Lightbearer" } },
		typedActor: model,
	};
}

let posted;
let saved;
beforeEach(() => {
	posted = [];
	saved = { ChatMessage: globalThis.ChatMessage, ui: globalThis.ui };
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ alias: actor?.name }) };
	globalThis.ui = { notifications: { warn: vi.fn(), info: vi.fn() } };
});
afterEach(() => {
	globalThis.ChatMessage = saved.ChatMessage;
	globalThis.ui = saved.ui;
});

describe("which bullet is which", () => {
	// Keyed by the shipped move's own words: a reword in the pack fails here rather than going dead.
	it("reads all three writing consequences off the shipped move, and leaves the reduced effect as fiction", () => {
		const bullets = firstOptionList(INVOKE_DESCRIPTION).items;
		expect(bullets.map(invokeConsequenceKind)).toEqual([null, CONSEQUENCE.DEBILITY, CONSEQUENCE.SNUFF, CONSEQUENCE.SUN]);
	});

	it("reads the Invocations a card is for", () => {
		expect(cardInvocations(card({ invocations: ["warmth-of-the-sun"] }))).toEqual(["warmth-of-the-sun"]);
		expect(cardInvocations(card())).toEqual([]);
	});
});

// "The effort taxes you; mark a debility", and Auspicious Birth: "you may mark this background's
// circle instead, to no ill effect".
describe("the effort taxes you", () => {
	it("offers each unmarked debility, and the clear Auspicious Birth circle first", () => {
		expect(invokeDebilityChoices(lightbearer({ marked: ["dazed"] })).map(c => c.key)).toEqual(["weakened", "miserable"]);
		expect(invokeDebilityChoices(lightbearer({ background: "auspicious-birth" })).map(c => c.key))
			.toEqual([CIRCLE_CHOICE, "weakened", "dazed", "miserable"]);
		expect(invokeDebilityChoices(lightbearer({ background: "auspicious-birth", circle: 1 })).map(c => c.key))
			.toEqual(["weakened", "dazed", "miserable"]);
	});

	it("marks the chosen debility once, and says so", async () => {
		const seren = lightbearer();
		const message = card();
		await expect(settleInvokeDebility(message, seren, "1", "dazed")).resolves.toBe(true);
		expect(seren.typedActor.markDebility).toHaveBeenCalledWith("dazed", { moveName: "Invoke the Sun God" });
		expect(posted.at(-1).content).toContain("Seren marks Dazed");
		expect(message.getFlag(SCOPE, CONSEQUENCES_FLAG)["1"]).toEqual({ marked: "dazed" });
		// A second press, a re-render or a reload finds it marked.
		await expect(settleInvokeDebility(message, seren, "1", "weakened")).resolves.toBe(false);
		expect(seren.typedActor.markDebility).toHaveBeenCalledTimes(1);
	});

	it("marks the circle instead, to no ill effect", async () => {
		const seren = lightbearer({ background: "auspicious-birth" });
		await expect(settleInvokeDebility(card(), seren, "1", CIRCLE_CHOICE)).resolves.toBe(true);
		expect(seren.typedActor.background.setSetupResource).toHaveBeenCalledWith("auspicious-birth", 1);
		expect(seren.typedActor.markDebility).not.toHaveBeenCalled();
		expect(posted.at(-1).content).toContain("Auspicious Birth circle");
	});

	it("gives the bullet back when the debility was marked since the card was posted", async () => {
		const seren = lightbearer({ marked: ["dazed"] });
		const message = card();
		const buttons = [{ disabled: false }];
		await expect(settleInvokeDebility(message, seren, "1", "dazed", { buttons })).resolves.toBe(false);
		expect(message.getFlag(SCOPE, CONSEQUENCES_FLAG)?.["1"]?.marked).toBeUndefined();
		expect(buttons[0].disabled).toBe(false);
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
		await expect(settleInvokeDebility(message, seren, "1", "weakened")).resolves.toBe(true);
	});

	it("leaves the rest of the bullet's record alone when it gives the bullet back", async () => {
		const seren = lightbearer({ marked: ["dazed"] });
		const message = card();
		await message.setFlag(SCOPE, `${CONSEQUENCES_FLAG}.1`, { relic: true, stamped: ["warmth-of-the-sun"] });
		await expect(settleInvokeDebility(message, seren, "1", "dazed")).resolves.toBe(false);
		expect(message.getFlag(SCOPE, CONSEQUENCES_FLAG)["1"]).toEqual({ relic: true, stamped: ["warmth-of-the-sun"] });
	});
});

// "The light is snuffed out when the Invocation is complete, its fuel consumed".
describe("the light is snuffed out", () => {
	it("stamps an ongoing Invocation, so ending it puts the light out", async () => {
		const seren = lightbearer({ running: ["warmth-of-the-sun"] });
		const message = card({ invocations: ["warmth-of-the-sun"] });
		await expect(settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true })).resolves.toBe(true);
		expect(seren.typedActor.markInvocationSnuff).toHaveBeenCalledWith("warmth-of-the-sun", true);
		expect(seren.typedActor.setHolyLight).not.toHaveBeenCalled();
		// Not twice.
		await settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		expect(seren.typedActor.markInvocationSnuff).toHaveBeenCalledTimes(1);
	});

	it("takes the stamp back when the box is unticked before it fired", async () => {
		const seren = lightbearer({ running: ["warmth-of-the-sun"] });
		const message = card({ invocations: ["warmth-of-the-sun"] });
		await settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		await expect(settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: false })).resolves.toBe(true);
		expect(seren.typedActor.markInvocationSnuff).toHaveBeenLastCalledWith("warmth-of-the-sun", false);
		// Ticked again, it stamps again.
		await settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		expect(seren.typedActor.markInvocationSnuff).toHaveBeenLastCalledWith("warmth-of-the-sun", true);
	});

	it("puts the light out at once for an instant Invocation, and only once", async () => {
		const seren = lightbearer();
		const message = card({ invocations: ["cleansing-light"] });
		await expect(settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true })).resolves.toBe(true);
		expect(seren.typedActor.setHolyLight).toHaveBeenCalledWith(false);
		expect(posted.at(-1).content).toContain("holy light is snuffed out as the Invocation completes, its fuel consumed.");
		// Relit since, and the box unticked and ticked again: the fuel was already spent.
		seren.typedActor.holyLight = true;
		await settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: false });
		await settleInvokeTick(message, seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		expect(seren.typedActor.setHolyLight).toHaveBeenCalledTimes(1);
		expect(seren.typedActor.holyLight).toBe(true);
	});

	// Burn Twice as Bright: "apply any consequences to both Invocations".
	it("stamps both of a Burn Twice pair while both run, and snuffs now when one of them was instant", async () => {
		const both = lightbearer({ running: ["warmth-of-the-sun", "blinding-flash"] });
		await settleInvokeTick(card({ invocations: ["blinding-flash", "warmth-of-the-sun"] }), both, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		expect(both.typedActor.markInvocationSnuff.mock.calls).toEqual([["blinding-flash", true], ["warmth-of-the-sun", true]]);

		const mixed = lightbearer({ running: ["warmth-of-the-sun"] });
		await settleInvokeTick(card({ invocations: ["cleansing-light", "warmth-of-the-sun"] }), mixed, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true });
		expect(mixed.typedActor.setHolyLight).toHaveBeenCalledWith(false);
		expect(posted.at(-1).content).toContain("It takes Warmth of the Sun with it.");
	});

	it("does nothing on a card that names no Invocation", async () => {
		const seren = lightbearer({ running: ["warmth-of-the-sun"] });
		await expect(settleInvokeTick(card(), seren, { index: "2", kind: CONSEQUENCE.SNUFF, checked: true })).resolves.toBe(false);
		expect(seren.typedActor.markInvocationSnuff).not.toHaveBeenCalled();
		expect(seren.typedActor.setHolyLight).not.toHaveBeenCalled();
	});
});

// "You must bask in sunlight for an hour or so before using that Invocation again". A cue.
describe("you must bask in sunlight", () => {
	it("puts the card's Invocations on the list, once, and takes back only what it put there", async () => {
		const seren = lightbearer({ sun: ["blinding-flash"] });
		const message = card({ invocations: ["warmth-of-the-sun", "blinding-flash"] });
		await expect(settleInvokeTick(message, seren, { index: "3", kind: CONSEQUENCE.SUN, checked: true })).resolves.toBe(true);
		expect(seren.typedActor.needsSun).toEqual(["blinding-flash", "warmth-of-the-sun"]);
		await settleInvokeTick(message, seren, { index: "3", kind: CONSEQUENCE.SUN, checked: true });
		expect(seren.typedActor.markNeedsSun).toHaveBeenCalledTimes(1);

		await expect(settleInvokeTick(message, seren, { index: "3", kind: CONSEQUENCE.SUN, checked: false })).resolves.toBe(true);
		expect(seren.typedActor.clearNeedsSun).toHaveBeenCalledWith(["warmth-of-the-sun"]);
		expect(seren.typedActor.needsSun).toEqual(["blinding-flash"]);
	});

	it("does nothing on a card that names no Invocation", async () => {
		const seren = lightbearer();
		await expect(settleInvokeTick(card(), seren, { index: "3", kind: CONSEQUENCE.SUN, checked: true })).resolves.toBe(false);
		expect(seren.typedActor.markNeedsSun).not.toHaveBeenCalled();
	});
});

// B5: "you may Invoke the Sun God right now as if you rolled a 10+".
describe("Wielder of the White Flame's 10+", () => {
	const owned = (...names) => names.map(name => ({ type: "move", name }));

	it("offers the button only with Wielder and Invoke the Sun God both learned", () => {
		const actor = { type: "character", items: owned("Wielder of the White Flame", "Invoke the Sun God") };
		expect(wielderRollOptions(actor).tierActions.success).toContain("stonetop-wielder-invoke");
		expect(wielderRollOptions({ type: "character", items: owned("Wielder of the White Flame") })).toBeNull();
		expect(wielderRollOptions({ type: "npc", items: actor.items })).toBeNull();
	});

	it("invokes once per card", async () => {
		const message = card();
		const invoke = vi.fn(async () => ({ id: "posted" }));
		await expect(settleWielderInvoke(message, lightbearer(), { invoke })).resolves.toBe(true);
		expect(message.getFlag(SCOPE, WIELDER_INVOKED_FLAG)).toBe(true);
		await expect(settleWielderInvoke(message, lightbearer(), { invoke })).resolves.toBe(false);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it("gives the card back when nothing was invoked", async () => {
		const message = card();
		const buttons = [{ disabled: false }];
		await expect(settleWielderInvoke(message, lightbearer(), { buttons, invoke: async () => null })).resolves.toBe(false);
		expect(message.getFlag(SCOPE, WIELDER_INVOKED_FLAG)).toBeUndefined();
		expect(buttons[0].disabled).toBe(false);
	});

	it("builds the 10+ card from the move's own list: choose 1, all four tickable", () => {
		const body = invokeTenPlusCardBody(INVOKE_DESCRIPTION, { type: "character", items: [] });
		expect(body).toMatch(/as if you rolled a 10\+/);
		expect(body).toMatch(/<ul class="stonetop-picklist" data-pick-max-success="1">/);
		expect(body.match(/stonetop-picklist-check/g)).toHaveLength(4);
		expect(body).toContain("You must bask in sunlight for an hour or so before using that Invocation again");
	});

	// Re-audit 10-18: the lead says the counts the card really asks for.
	it("tells a Glorious Servant they need not choose, and sets the Empowered consequence off the list", () => {
		const servant = { type: "character", items: [{ type: "move", name: "Glorious Servant" }, { type: "move", name: "Empowered Invocations" }] };
		const body = invokeTenPlusCardBody(INVOKE_DESCRIPTION, servant,
			{ empowered: true, empoweredConsequence: "The effort taxes you; mark a debility" });
		expect(body).toMatch(/as a Glorious Servant you need not choose a consequence: take 1 from the list below, or none/);
		expect(body).not.toMatch(/you must choose 1 consequence/);
		expect(body).toMatch(/<ul class="stonetop-picklist" data-pick-max-success="1">/);
		expect(body.match(/stonetop-picklist-check/g)).toHaveLength(3);
		expect(body).toContain('class="stonetop-pre-pick"');
	});
});

// Re-audit 10-18: Empowered Invocations, "you can choose an extra consequence BEFORE you roll".
describe("the Empowered consequence chosen before the roll", () => {
	it("is pinned, bullet for bullet, to the shipped move", () => {
		expect(INVOKE_CONSEQUENCE_BULLETS.map(b => b.text)).toEqual(firstOptionList(INVOKE_DESCRIPTION).items);
		expect(INVOKE_CONSEQUENCE_BULLETS.map(b => consequenceKindOf(b.text))).toEqual(["reduced", "debility", "snuff", "sun"]);
		expect(consequenceBullet("sun")).toBe("You must bask in sunlight for an hour or so before using that Invocation again");
		expect(consequenceBullet("nope")).toBeNull();
	});

	it("is stamped on the card from the roll's pick context, as its kind", () => {
		const debility = "The effort taxes you; mark a debility";
		expect(invokeCardFlags({ empowered: true, empoweredConsequence: debility, invocations: ["warmth-of-the-sun"] })).toEqual({
			invocations: ["warmth-of-the-sun"], [CARD_EMPOWERED_FLAG]: true, [EMPOWERED_CONSEQUENCE_FLAG]: "debility",
		});
		// Taken even on a roll that names no Invocation: the debility still marks.
		expect(invokeCardFlags({ empowered: true, empoweredConsequence: debility })).toEqual({ [EMPOWERED_CONSEQUENCE_FLAG]: "debility" });
		expect(invokeCardFlags({ empowered: false, empoweredConsequence: debility, invocations: ["a"] })).toEqual({ invocations: ["a"] });
		expect(invokeCardFlags(null)).toEqual({});
	});

	it("is pending until paid or replaced, and the reduced effect stays open to a relic", () => {
		const stamped = (kind, record = null) => {
			const message = card({ invocations: ["warmth-of-the-sun"] });
			message.flags[SCOPE][EMPOWERED_CONSEQUENCE_FLAG] = kind;
			if (record) message.flags[SCOPE][CONSEQUENCES_FLAG] = { [PRE_PICK_RECORD]: record };
			return message;
		};
		expect(cardEmpoweredConsequence(stamped("snuff"))).toBe("snuff");
		expect(cardEmpoweredConsequence(stamped("bogus"))).toBeNull();
		expect(prePickPending(stamped("debility"))).toBe(true);
		expect(prePickPending(stamped("debility", { marked: "dazed" }))).toBe(false);
		expect(prePickPending(stamped("snuff", { stamped: ["warmth-of-the-sun"] }))).toBe(false);
		expect(prePickPending(stamped("snuff", { snuffed: true }))).toBe(false);
		expect(prePickPending(stamped("sun", { added: [] }))).toBe(false);
		expect(prePickPending(stamped("reduced"))).toBe(true);
		expect(prePickPending(stamped("reduced", { relic: true }))).toBe(false);
		expect(prePickPending(card())).toBe(false);
	});

	it("is paid through the same settles a ticked bullet uses, on both of a Burn Twice pair", async () => {
		const seren = lightbearer({ running: ["warmth-of-the-sun", "blinding-flash"] });
		const message = card({ invocations: ["warmth-of-the-sun", "blinding-flash"] });
		await settleInvokeTick(message, seren, { index: PRE_PICK_RECORD, kind: CONSEQUENCE.SNUFF, checked: true });
		expect(seren.typedActor.markInvocationSnuff.mock.calls).toEqual([["warmth-of-the-sun", true], ["blinding-flash", true]]);
		await settleInvokeDebility(message, seren, PRE_PICK_RECORD, "dazed");
		expect(message.getFlag(SCOPE, CONSEQUENCES_FLAG)[PRE_PICK_RECORD]).toMatchObject({ marked: "dazed" });
	});
});

// Re-audit 10-18, holy relics: "mark a use in lieu of choosing a consequence", one per consequence the PLAYER
// owes: their pick on a 10+ or a 7-9 (never the GM's), none on a Glorious Servant's 10+, plus the Empowered one.
describe("holy relics, one per consequence owed", () => {
	const servant = () => Object.assign(lightbearer(), { items: [{ type: "move", name: "Glorious Servant" }] });
	const invoke = ({ tenPlus = false, prePick = null } = {}) => {
		const message = card({ invocations: ["warmth-of-the-sun"] });
		if (tenPlus) message.flags[SCOPE][TEN_PLUS_FLAG] = true;
		if (prePick) message.flags[SCOPE][EMPOWERED_CONSEQUENCE_FLAG] = prePick;
		return message;
	};

	it("owes the player's one pick on a hit, none on a 6-, and none on a Glorious Servant's 10+", () => {
		const seren = lightbearer();
		expect(holyRelicOffers(invoke(), seren, { total: 11 })).toEqual({ list: 1, prePick: false });
		expect(holyRelicOffers(invoke(), seren, { total: 8 })).toEqual({ list: 1, prePick: false });
		expect(holyRelicOffers(invoke(), seren, { total: 5 })).toEqual({ list: 0, prePick: false });
		expect(holyRelicOffers(invoke({ tenPlus: true }), seren)).toEqual({ list: 1, prePick: false });
		expect(holyRelicOffers(invoke(), servant(), { total: 12 })).toEqual({ list: 0, prePick: false });
		expect(holyRelicOffers(invoke({ tenPlus: true }), servant())).toEqual({ list: 0, prePick: false });
		expect(holyRelicOffers(invoke(), servant(), { total: 8 })).toEqual({ list: 1, prePick: false });
	});

	it("owes the Empowered consequence on every result, a 6- and a Glorious Servant's 10+ included", () => {
		expect(holyRelicOffers(invoke({ prePick: "debility" }), lightbearer(), { total: 4 })).toEqual({ list: 0, prePick: true });
		expect(holyRelicOffers(invoke({ prePick: "sun" }), servant(), { total: 10 })).toEqual({ list: 0, prePick: true });
		expect(holyRelicOffers(invoke({ prePick: "sun" }), lightbearer(), { total: 9 })).toEqual({ list: 1, prePick: true });
	});

	it("counts the uses on the card, the old one-per-card latch as one", async () => {
		const message = invoke({ prePick: "debility" });
		const spend = vi.fn(async () => true);
		await expect(settleHolyRelic(message, lightbearer(), { total: 8, spend })).resolves.toBe(true);
		expect(message.getFlag(SCOPE, HOLY_RELIC_FLAG)).toBe(1);
		expect(holyRelicOffers(message, lightbearer(), { total: 8 })).toEqual({ list: 0, prePick: true });
		// The list's one is spent: a second for it is refused, and spends nothing.
		await expect(settleHolyRelic(message, lightbearer(), { total: 8, spend })).resolves.toBe(false);
		expect(spend).toHaveBeenCalledTimes(1);
		await expect(settleHolyRelic(message, lightbearer(), { total: 8, prePick: true, spend })).resolves.toBe(true);
		expect(message.getFlag(SCOPE, HOLY_RELIC_FLAG)).toBe(2);
		expect(prePickReplaced(message)).toBe(true);
		expect(holyRelicOffers(message, lightbearer(), { total: 8 })).toEqual({ list: 0, prePick: false });

		const legacy = invoke();
		legacy.flags[SCOPE][HOLY_RELIC_FLAG] = true;
		expect(holyRelicsSpent(legacy)).toBe(1);
		expect(holyRelicOffers(legacy, lightbearer(), { total: 10 })).toEqual({ list: 0, prePick: false });
	});

	it("gives the card back when the track had no use left, or the spend threw", async () => {
		const message = invoke({ prePick: "snuff" });
		await expect(settleHolyRelic(message, lightbearer(), { total: 10, prePick: true, spend: async () => false })).resolves.toBe(false);
		expect(holyRelicsSpent(message)).toBe(0);
		expect(prePickPending(message)).toBe(true);
		await expect(settleHolyRelic(message, lightbearer(), { total: 10, spend: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
		expect(holyRelicsSpent(message)).toBe(0);
		expect(holyRelicOffers(message, lightbearer(), { total: 10 })).toEqual({ list: 1, prePick: true });
	});
});

// Re-audit 10-18: a reduced Blinding Light or Cold Light of Day is over at once, so it gives up its slot;
// a reduced Moth to a Flame is the GM's choice. Ends one slot only, once per card, never restarted.
describe("the reduced effect of a short-lived Invocation", () => {
	/** A Lightbearer whose slots are a real state, ended as the model ends them. */
	function holding(state, { snuff = false } = {}) {
		const seren = lightbearer();
		let now = readInvocationState(typeof state === "string" ? { primary: state, snuff } : state);
		Object.defineProperty(seren.typedActor, "invocationState", { get: () => now });
		seren.typedActor.endOngoingInvocation = vi.fn(async slug => {
			const end = resolveInvocationEnd({ current: now, ending: slug });
			now = end.state;
			return { changed: end.changed, ended: end.ended, snuffed: end.snuffs };
		});
		return seren;
	}

	it("ends a running Blinding Light at once, and only once per card", async () => {
		const seren = holding("blinding-light");
		const message = card({ invocations: ["blinding-light"] });
		await expect(settleReducedEffect(message, seren)).resolves.toBe(true);
		expect(seren.typedActor.endOngoingInvocation).toHaveBeenCalledWith("blinding-light");
		expect(seren.typedActor.invocationState.primary).toBe("");
		expect(reducedOutcome(message, "blinding-light")).toBe("ended");
		await expect(settleReducedEffect(message, seren)).resolves.toBe(false);
		expect(seren.typedActor.endOngoingInvocation).toHaveBeenCalledTimes(1);
	});

	it("ends only the matching slot of two", async () => {
		const seren = holding({ primary: "warmth-of-the-sun", second: "cold-light-of-day" });
		await settleReducedEffect(card({ invocations: ["warmth-of-the-sun", "cold-light-of-day"] }), seren);
		expect(seren.typedActor.invocationState).toMatchObject({ primary: "warmth-of-the-sun", second: "" });
	});

	it("does nothing to another ongoing Invocation, or to one a later card used again", async () => {
		const warm = holding("warmth-of-the-sun");
		await expect(settleReducedEffect(card({ invocations: ["warmth-of-the-sun"] }), warm)).resolves.toBe(false);
		expect(warm.typedActor.endOngoingInvocation).not.toHaveBeenCalled();

		const seren = holding("blinding-light");
		const old = { ...card({ invocations: ["blinding-light"] }), speaker: { actor: "seren" } };
		const later = { ...card({ invocations: ["blinding-light"] }), speaker: { actor: "seren" } };
		expect(laterCardNames(old, "blinding-light", [old, later])).toBe(true);
		expect(laterCardNames(later, "blinding-light", [old, later])).toBe(false);
		const saved = globalThis.game.messages;
		globalThis.game.messages = { contents: [old, later] };
		try {
			await expect(settleReducedEffect(old, seren)).resolves.toBe(false);
		} finally { globalThis.game.messages = saved; }
		expect(seren.typedActor.endOngoingInvocation).not.toHaveBeenCalled();
	});

	it("says the light went out when the Invocation carried the snuff stamp", async () => {
		const seren = holding("blinding-light", { snuff: true });
		await settleReducedEffect(card({ invocations: ["blinding-light"] }), seren);
		expect(posted.at(-1).content).toContain("holy light is snuffed out as Blinding Light ends");
	});

	it("leaves Moth to a Flame to the GM: briefly ends it, only some keeps it, once", async () => {
		const ended = holding("moth-to-a-flame");
		const one = card({ invocations: ["moth-to-a-flame"] });
		await expect(settleReducedEffect(one, ended)).resolves.toBe(false);
		expect(ended.typedActor.endOngoingInvocation).not.toHaveBeenCalled();
		await expect(settleReducedChoice(one, ended, "moth-to-a-flame", true)).resolves.toBe(true);
		expect(ended.typedActor.invocationState.primary).toBe("");
		expect(reducedOutcome(one, "moth-to-a-flame")).toBe("ended");

		const kept = holding("moth-to-a-flame");
		const two = card({ invocations: ["moth-to-a-flame"] });
		await expect(settleReducedChoice(two, kept, "moth-to-a-flame", false)).resolves.toBe(true);
		expect(kept.typedActor.endOngoingInvocation).not.toHaveBeenCalled();
		expect(kept.typedActor.invocationState.primary).toBe("moth-to-a-flame");
		expect(reducedOutcome(two, "moth-to-a-flame")).toBe("kept");
		// Chosen: the other button does nothing.
		await expect(settleReducedChoice(two, kept, "moth-to-a-flame", true)).resolves.toBe(false);
		expect(kept.typedActor.endOngoingInvocation).not.toHaveBeenCalled();
	});
});
