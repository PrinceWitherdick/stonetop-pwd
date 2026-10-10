import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	CONDUIT_OF_POWER, DIVERT, IMPROVISE, IMPROVISE_STEP_FLAG, IMPROVISE_USED_FLAG, MARK_CONSEQUENCE_FLAG, MIND_OVER_MAGIC, OVERCHANNEL,
	RING_OF_DAAGON, askConsequenceDiversion, askConsequencePick, askImproviseTask, consequenceDiversions, consequenceLabel, improviseOffer,
	improviseRollOptions, improviseTierActions, majorConsequenceCard, markArcanumConsequence, markConsequenceButton,
	mindOverMagicRoll, settleArcanumBoxTick, settleImproviseStep, settleImproviseUse,
	consequenceParents, settleMarkConsequence, unmarkedConsequences, unmarkedFrontTasks,
} from "../../../module/actors/character/arcana-seeker-moves.js";
import { CharacterArcana, consequenceBoxRange } from "../../../module/actors/character/CharacterArcana.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";

// The Seeker's arcana moves on the arcana tab (audit A7/C11 Mind Over Magic, A12/C12 Improvise,
// A10/C10 Conduit of Power + Overchannel).

const SCOPE = "stonetop-pwd";
const readJson = rel => JSON.parse(fs.readFileSync(path.resolve(rel), "utf8"));
const AZURE_HAND = readJson("packs/src/stonetop-arcana/major/azure-hand.json").flags.stonetop;
const MINDGEM_CARD = readJson("packs/src/stonetop-arcana/major/mindgem.json").flags.stonetop;
const RING_CARD = readJson("packs/src/stonetop-arcana/major/ring-of-daagon.json").flags.stonetop;
const IMPROVISE_MOVE = readJson("packs/src/stonetop-items/playbook-moves/the-seeker/improvise.json");

function move(name, { learned = true, system = {} } = {}) {
	return { type: "move", name, system, flags: learned ? {} : { [SCOPE]: { learned: false } } };
}

/** A Seeker, with the model calls these moves make. */
function seeker({ moves = [], conduit = 0, marked = [], cards = [] } = {}) {
	const boxes = {};
	const resources = { [CONDUIT_OF_POWER]: conduit };
	const model = {
		moveResources: {
			getMoveResources: () => resources,
			setUses: vi.fn(async (name, value) => { resources[name] = value; }),
		},
		debilityChoices: ["weakened", "dazed", "miserable"].map(key => ({ key, name: key[0].toUpperCase() + key.slice(1), marked: marked.includes(key) })),
		get debilityMarkChoices() { return this.debilityChoices; },
		markDebility: vi.fn(async key => !marked.includes(key)),
		background: { selectedSlug: null, setupResources: {} },
		getArcanum: vi.fn(async slug => cards.find(c => c.slug === slug) ?? null),
		setArcanumBoxChecked: vi.fn(async (slug, context, index, checked) => { boxes[`${slug}:${context}:${index}`] = checked; }),
		markNextArcanumUnlockStep: vi.fn(),
		ownedArcanaSlugs: new Set(cards.map(c => c.slug)),
		arcanaBoxStates: boxes,
	};
	return {
		actor: { id: "corvin", name: "Corvin", type: "character", isOwner: true, system: { playbook: { name: "The Seeker" } }, items: moves, typedActor: model },
		model, boxes, resources,
	};
}

const MAJOR = { slug: "azure-hand", major: true, ...AZURE_HAND };
const MINDGEM = { slug: "mindgem", major: true, ...MINDGEM_CARD };
const RING = { slug: "ring-of-daagon", major: true, ...RING_CARD };
const MINOR = { slug: "cracked-flute", major: false, front: { title: "A cracked flute" }, back: { description: "<h3>Consequences</h3><ul><li>□ Something</li></ul>" } };
const CONDUIT = move(CONDUIT_OF_POWER, { system: { resource: { max: 3 } } });

function card() {
	const flags = { [SCOPE]: {} };
	return {
		flags,
		getFlag: (scope, key) => (scope === SCOPE ? flags[SCOPE][key] : undefined),
		setFlag: vi.fn(async (_s, key, value) => { flags[SCOPE][key] = value; }),
		unsetFlag: vi.fn(async (_s, key) => { delete flags[SCOPE][key]; }),
		canUserModify: () => true,
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

describe("Mind Over Magic: +INT instead of an arcanum roll's stat", () => {
	const withMom = seeker({ moves: [move(MIND_OVER_MAGIC)] }).actor;

	it("offers +INT beside a printed stat other than INT, named for the move", () => {
		expect(mindOverMagicRoll(withMom, "con")).toEqual({ stat: "int", label: "Roll +INT (Mind Over Magic)", source: MIND_OVER_MAGIC });
	});

	it("offers nothing for a roll that is +INT already, or that rolls no stat", () => {
		expect(mindOverMagicRoll(withMom, "int")).toBeNull();
		expect(mindOverMagicRoll(withMom, "nothing")).toBeNull();
		expect(mindOverMagicRoll(withMom, null)).toBeNull();
	});

	it("needs the move learned", () => {
		expect(mindOverMagicRoll(seeker().actor, "con")).toBeNull();
		expect(mindOverMagicRoll(seeker({ moves: [move(MIND_OVER_MAGIC, { learned: false })] }).actor, "con")).toBeNull();
	});
});

describe("Improvise: an un-learned mystery's own roll", () => {
	const mystery = { slug: "eye-of-the-storm", name: "EYE OF THE STORM", learned: false, cardTitle: "Mysteries of the Azure Hand" };
	const withImprovise = seeker({ moves: [move(IMPROVISE, { system: IMPROVISE_MOVE.system })] }).actor;

	it("is offered for a mystery not yet learned, with Improvise learned", () => {
		expect(improviseOffer(withImprovise, mystery, "azure-hand")).toEqual({
			arcanumSlug: "azure-hand", moveSlug: "eye-of-the-storm", moveName: "EYE OF THE STORM", cardTitle: "Mysteries of the Azure Hand",
		});
	});

	it("is not offered for a learned mystery, an observer, or without the move learned", () => {
		expect(improviseOffer(withImprovise, { ...mystery, learned: true }, "azure-hand")).toBeNull();
		expect(improviseOffer(withImprovise, mystery, "azure-hand", { editable: false })).toBeNull();
		expect(improviseOffer(seeker().actor, mystery, "azure-hand")).toBeNull();
		expect(improviseOffer(seeker({ moves: [move(IMPROVISE, { learned: false })] }).actor, mystery, "azure-hand")).toBeNull();
	});

	it("puts 'use it this once' on the 7+ and adds the unlock step on the 10+, nothing on the 6-", () => {
		const actions = improviseTierActions({ arcanumSlug: "azure-hand", moveSlug: "eye-of-the-storm", moveName: "EYE OF THE STORM" });
		expect(actions.success).toContain("stonetop-improvise-use");
		expect(actions.success).toContain("stonetop-improvise-step");
		expect(actions.success).toContain('data-arcanum-slug="azure-hand"');
		expect(actions.success).toContain('data-move-slug="eye-of-the-storm"');
		expect(actions.partial).toContain("Use EYE OF THE STORM this once");
		expect(actions.partial).not.toContain("stonetop-improvise-step");
		expect(actions.failure).toBeUndefined();
	});

	it("rolls as the Improvise move, with its own text and tiers, naming the mystery", () => {
		const options = improviseRollOptions(withImprovise, improviseOffer(withImprovise, mystery, "azure-hand"));
		expect(options.moveName).toBe(IMPROVISE);
		expect(options.moveDescription).toContain("Improvising EYE OF THE STORM (Mysteries of the Azure Hand)");
		expect(options.moveDescription).toContain("mark one step towards unlocking");
		expect(options.moveResults).toEqual(IMPROVISE_MOVE.system.moveResults);
		expect(options.tierActions.success).toContain("stonetop-improvise-step");
	});

	it("opens the mystery as if learned, once per card", async () => {
		const { actor } = seeker();
		const message = card();
		const open = vi.fn();
		expect(await settleImproviseUse(message, actor, { arcanumSlug: "azure-hand", moveSlug: "eye-of-the-storm" }, { open })).toBe(true);
		expect(open).toHaveBeenCalledWith(actor, "azure-hand", "eye-of-the-storm");
		expect(message.flags[SCOPE][IMPROVISE_USED_FLAG]).toBe(true);
		expect(await settleImproviseUse(message, actor, { arcanumSlug: "azure-hand", moveSlug: "eye-of-the-storm" }, { open })).toBe(false);
		expect(open).toHaveBeenCalledOnce();
	});

	it("marks the card's next unlock step on the 10+, once, and says so", async () => {
		const { actor, model } = seeker();
		model.markNextArcanumUnlockStep.mockResolvedValue({ index: 1, count: 4, title: "Azure Hand" });
		const message = card();
		expect(await settleImproviseStep(message, actor, "azure-hand")).toBe(true);
		expect(model.markNextArcanumUnlockStep).toHaveBeenCalledWith("azure-hand", { stonetopMove: IMPROVISE });
		expect(message.flags[SCOPE][IMPROVISE_STEP_FLAG]).toBe(true);
		expect(posted[0].content).toContain("marks a step towards unlocking Azure Hand (2 of 4)");
		expect(await settleImproviseStep(message, actor, "azure-hand")).toBe(false);
		expect(model.markNextArcanumUnlockStep).toHaveBeenCalledOnce();
	});

	it("asks which □ task to tick on a card whose steps are tasks, and ticks the one picked, once", async () => {
		const { actor, model, boxes } = seeker({ cards: [MINDGEM] });
		boxes["mindgem:front:0"] = true;
		model.markNextArcanumUnlockStep.mockResolvedValue({ index: null, count: 0, title: "Mindgem" });
		const ask = vi.fn(async ({ tasks }) => tasks[1]);
		const message = card();
		expect(await settleImproviseStep(message, actor, "mindgem", { ask })).toBe(true);
		// The marked chassis is not offered; the rest are, by their task text.
		expect(ask.mock.calls[0][0].title).toBe("Mindgem");
		expect(ask.mock.calls[0][0].tasks.map(t => t.index)).toEqual([1, 2, 3]);
		expect(ask.mock.calls[0][0].tasks[2].label).toBe("Puzzle out how to assemble all the pieces");
		expect(model.setArcanumBoxChecked).toHaveBeenCalledWith("mindgem", "front", 2, true);
		expect(boxes["mindgem:front:2"]).toBe(true);
		expect(message.flags[SCOPE][IMPROVISE_STEP_FLAG]).toBe(true);
		expect(posted[0].content).toContain("marks a step towards unlocking Mindgem: Recover and repair the intricate bronze helm");
		expect(await settleImproviseStep(message, actor, "mindgem", { ask })).toBe(false);
		expect(ask).toHaveBeenCalledOnce();
	});

	it("gives the button back when the task picker is closed, and says so when every step is marked", async () => {
		const closed = seeker({ cards: [MINDGEM] });
		closed.model.markNextArcanumUnlockStep.mockResolvedValue({ index: null, count: 0, title: "Mindgem" });
		const message = card();
		expect(await settleImproviseStep(message, closed.actor, "mindgem", { ask: async () => null })).toBe(false);
		expect(closed.model.setArcanumBoxChecked).not.toHaveBeenCalled();
		expect(message.flags[SCOPE][IMPROVISE_STEP_FLAG]).toBeUndefined();
		expect(posted).toHaveLength(0);

		const done = seeker({ cards: [MINDGEM] });
		for (const i of [0, 1, 2, 3]) done.boxes[`mindgem:front:${i}`] = true;
		done.model.markNextArcanumUnlockStep.mockResolvedValue({ index: null, count: 0, title: "Mindgem" });
		const ask = vi.fn();
		expect(await settleImproviseStep(card(), done.actor, "mindgem", { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith("Every step towards unlocking Mindgem is marked already.");

		const circles = seeker({ cards: [MAJOR] });
		circles.model.markNextArcanumUnlockStep.mockResolvedValue({ index: null, count: 4, title: "Azure Hand" });
		expect(await settleImproviseStep(card(), circles.actor, "azure-hand", { ask })).toBe(false);
		expect(ui.notifications.info).toHaveBeenCalledWith("Every unlock circle on Azure Hand is marked already.");
	});

	it("never offers a front □ as a step on a card whose ○ are all marked: that □ is another track", async () => {
		const both = seeker({ cards: [MINDGEM] });
		both.model.markNextArcanumUnlockStep.mockResolvedValue({ index: null, count: 3, title: "Mindgem" });
		const ask = vi.fn();
		expect(await settleImproviseStep(card(), both.actor, "mindgem", { ask })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(both.model.setArcanumBoxChecked).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith("Every unlock circle on Mindgem is marked already.");
	});

	it("lists the unmarked front tasks, and asks with a button per task and one that marks nothing", async () => {
		expect(unmarkedFrontTasks(MINDGEM.front, { "mindgem:front:1": true, "mindgem:front:3": false }, "mindgem").map(t => t.index)).toEqual([0, 2, 3]);
		expect(unmarkedFrontTasks(AZURE_HAND.front, {}, "azure-hand")).toEqual([]);
		// A one-shot □ on a card whose lead names no tasks is not a step towards unlocking it.
		const oneShot = { description: "<p>□ Once, you may call on it.</p>", unlock: { description: "When you learn its name, see reverse." } };
		expect(unmarkedFrontTasks(oneShot, {}, "charm")).toEqual([]);
		const ask = vi.fn(async () => null);
		await askImproviseTask({ title: "Mindgem", tasks: unmarkedFrontTasks(MINDGEM.front, {}, "mindgem").slice(0, 2) }, { ask });
		expect(ask.mock.calls[0][0].buttons.map(b => b.label)).toEqual([
			"Recover its chassis of white granite, which weighs well over a ton",
			expect.stringContaining("Recover its \"heart,\""),
			"Mark nothing yet",
		]);
	});
});

describe("CharacterArcana: the pieces the Seeker's moves read", () => {
	function arcana(store, cards) {
		const flags = {
			getFlag: key => store[key] ?? null,
			setFlag: vi.fn(async (key, value) => { store[key] = value; }),
		};
		return new CharacterArcana(flags, new FakeArcanaRepository(cards));
	}

	it("finds the □ of a card's Consequences section by their back-side index", () => {
		// The shipped Azure Hand prints 3 □ before its Consequences heading and 8 inside it.
		expect(consequenceBoxRange(AZURE_HAND.back.description)).toEqual({ from: 3, to: 11 });
		expect(consequenceBoxRange("<h3>Moves</h3><p>□ A MOVE</p>")).toBeNull();
	});

	it("ticks the first unmarked unlock ○, counting every glyph of the run", async () => {
		const store = { boxes: { "azure-hand:unlock:0": true } };
		const step = await arcana(store, [{ slug: "azure-hand", ...AZURE_HAND }]).markNextUnlockStep("azure-hand");
		expect(step).toEqual({ index: 1, count: 4, title: "Azure Hand" });
		expect(store.boxes["azure-hand:unlock:1"]).toBe(true);
	});

	it("ticks nothing when every circle is marked, or the card has none", async () => {
		const full = { boxes: Object.fromEntries([0, 1, 2, 3].map(i => [`azure-hand:unlock:${i}`, true])) };
		expect((await arcana(full, [{ slug: "azure-hand", ...AZURE_HAND }]).markNextUnlockStep("azure-hand")).index).toBeNull();
		const bare = { slug: "tasks", front: { title: "Tasks", unlock: { description: "When you have marked 3 tasks..." } }, back: {} };
		expect(await arcana({}, [bare]).markNextUnlockStep("tasks")).toEqual({ index: null, count: 0, title: "Tasks" });
	});
});

describe("Conduit of Power and Overchannel: a major arcanum's Consequence marked elsewhere", () => {
	const TICK = { slug: "azure-hand", context: "back", index: 3, checked: true };

	it("only a MAJOR card's Consequences section counts", async () => {
		const { model } = seeker({ cards: [MAJOR, MINOR] });
		expect(await majorConsequenceCard(model, "azure-hand", "back", 3)).toBe(MAJOR);
		expect(await majorConsequenceCard(model, "azure-hand", "back", 2)).toBeNull();   // a mystery's □
		expect(await majorConsequenceCard(model, "azure-hand", "front", 3)).toBeNull();
		expect(await majorConsequenceCard(model, "cracked-flute", "back", 0)).toBeNull();
	});

	it("offers a free Conduit box and, with Overchannel, each unmarked debility", () => {
		const { actor } = seeker({ moves: [CONDUIT, move(OVERCHANNEL)], conduit: 1, marked: ["dazed"] });
		const d = consequenceDiversions(actor);
		expect(d.conduit).toEqual({ marked: 1, max: 3 });
		expect(d.debilities.map(p => p.key)).toEqual(["weakened", "miserable"]);
		expect(consequenceDiversions(seeker({ moves: [CONDUIT], conduit: 3 }).actor).conduit).toBeNull();
	});

	it("marks the consequence without asking when there is nothing to divert it to", async () => {
		for (const moves of [[], [move(CONDUIT_OF_POWER, { learned: false, system: { resource: { max: 3 } } })]]) {
			const { actor, boxes } = seeker({ moves, cards: [MAJOR] });
			const ask = vi.fn();
			expect(await settleArcanumBoxTick(actor, TICK, { ask })).toBe("marked");
			expect(ask).not.toHaveBeenCalled();
			expect(boxes["azure-hand:back:3"]).toBe(true);
		}
		const full = seeker({ moves: [CONDUIT], conduit: 3, cards: [MAJOR] });
		const ask = vi.fn();
		expect(await settleArcanumBoxTick(full.actor, TICK, { ask })).toBe("marked");
		expect(ask).not.toHaveBeenCalled();
	});

	it("never asks for an untick, a mystery's □, or a minor card", async () => {
		const { actor, boxes } = seeker({ moves: [CONDUIT], cards: [MAJOR, MINOR] });
		const ask = vi.fn();
		expect(await settleArcanumBoxTick(actor, { ...TICK, checked: false }, { ask })).toBe("unticked");
		expect(await settleArcanumBoxTick(actor, { ...TICK, index: 0 }, { ask })).toBe("marked");
		expect(await settleArcanumBoxTick(actor, { slug: "cracked-flute", context: "back", index: 0, checked: true }, { ask })).toBe("marked");
		expect(ask).not.toHaveBeenCalled();
		expect(boxes["azure-hand:back:3"]).toBe(false);
	});

	it("marks a Conduit of Power box instead, leaving the consequence clear", async () => {
		const { actor, model, boxes, resources } = seeker({ moves: [CONDUIT], conduit: 1, cards: [MAJOR] });
		const ask = vi.fn(async () => ({ kind: DIVERT.CONDUIT }));
		expect(await settleArcanumBoxTick(actor, TICK, { ask })).toBe("diverted");
		expect(ask).toHaveBeenCalledWith({ title: "Azure Hand", diversions: { conduit: { marked: 1, max: 3 }, debilities: [] } });
		expect(model.moveResources.setUses).toHaveBeenCalledWith(CONDUIT_OF_POWER, 2, { stonetopMove: CONDUIT_OF_POWER });
		expect(resources[CONDUIT_OF_POWER]).toBe(2);
		expect(boxes["azure-hand:back:3"]).toBeUndefined();
		expect(posted[0].content).toContain("instead of a Consequence of Azure Hand");
	});

	it("marks a debility instead with Overchannel", async () => {
		const { actor, model, boxes } = seeker({ moves: [CONDUIT, move(OVERCHANNEL)], conduit: 3, cards: [MAJOR] });
		const ask = vi.fn(async () => ({ kind: DIVERT.DEBILITY, key: "weakened" }));
		expect(await settleArcanumBoxTick(actor, TICK, { ask })).toBe("diverted");
		expect(model.markDebility).toHaveBeenCalledWith("weakened", { moveName: OVERCHANNEL });
		expect(boxes["azure-hand:back:3"]).toBeUndefined();
	});

	it("marks the consequence when that is the answer, and nothing when the window is closed", async () => {
		const chosen = seeker({ moves: [CONDUIT], cards: [MAJOR] });
		expect(await settleArcanumBoxTick(chosen.actor, TICK, { ask: async () => ({ kind: DIVERT.CONSEQUENCE }) })).toBe("marked");
		expect(chosen.boxes["azure-hand:back:3"]).toBe(true);
		const closed = seeker({ moves: [CONDUIT], cards: [MAJOR] });
		expect(await settleArcanumBoxTick(closed.actor, TICK, { ask: async () => null })).toBe("cancelled");
		expect(closed.boxes["azure-hand:back:3"]).toBeUndefined();
		expect(closed.model.moveResources.setUses).not.toHaveBeenCalled();
	});

	it("asks with buttons that name each outcome, the consequence first, then which debility", async () => {
		const ask = vi.fn()
			.mockResolvedValueOnce({ kind: DIVERT.DEBILITY })
			.mockResolvedValueOnce("dazed");
		const diversions = { conduit: { marked: 0, max: 3 }, debilities: [{ key: "dazed", circle: false, name: "Dazed" }] };
		expect(await askConsequenceDiversion({ title: "Azure Hand", diversions }, { ask })).toEqual({ kind: DIVERT.DEBILITY, key: "dazed" });
		expect(ask.mock.calls[0][0].buttons.map(b => b.label)).toEqual([
			"Mark the Consequence", "Mark a Conduit of Power box instead", "Mark a debility instead (Overchannel)",
		]);
		expect(ask.mock.calls[1][0].buttons.map(b => b.label)).toEqual(["Mark Dazed"]);
	});
});

describe("Ring of Daagon: 'mark a consequence' from the Call Up and Send Them Back cards", () => {
	// The Ring prints 1 □ before its Consequences heading (CALL UP THE DEEP ONES) and 8 inside it.
	it("lists the unmarked Consequences in the order the card prints them, a run of □ as one entry", () => {
		expect(consequenceBoxRange(RING.back.description)).toEqual({ from: 1, to: 9 });
		// 2 (breathe water) is printed under 1 (clammy skin), 4 (raw flesh) under 3 (meat).
		expect(consequenceParents(RING.back.description)).toEqual(new Map([[2, [1]], [4, [3]]]));
		const fresh = unmarkedConsequences(RING.back.description, {}, RING_OF_DAAGON);
		expect(fresh.map(c => c.index)).toEqual([1, 3, 5, 8]);
		expect(fresh[0].label).toBe("Your skin becomes clammy and squamous.");
		expect(fresh[2].label).toMatch(/^1d6 sinkholes appear.*\(1 of 3\)$/);
		const some = unmarkedConsequences(RING.back.description,
			{ "ring-of-daagon:back:1": true, "ring-of-daagon:back:5": true, "ring-of-daagon:back:6": true }, RING_OF_DAAGON);
		expect(some.map(c => c.index)).toEqual([2, 3, 7, 8]);
		expect(some[0].label).toMatch(/^You can breathe water through your skin/);
		expect(some[2].label).toMatch(/\(3 of 3\)$/);
		const all = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(i => [`ring-of-daagon:back:${i}`, true]));
		expect(unmarkedConsequences(RING.back.description, all, RING_OF_DAAGON)).toEqual([]);
		expect(unmarkedConsequences("<p>No consequences here.</p>", {}, "x")).toEqual([]);
		expect(consequenceLabel(RING.back.description, 1)).toBe("Your skin becomes clammy and squamous.");
		expect(consequenceLabel(RING.back.description, 6)).toMatch(/^1d6 sinkholes appear/);
		expect(consequenceLabel(RING.back.description, 8)).toMatch(/^The ring's Cost becomes/);
	});

	it("puts a button naming the Ring on the card", () => {
		const html = markConsequenceButton(RING_OF_DAAGON, "Ring of Daagon");
		expect(html).toContain('class="stonetop-mark-consequence"');
		expect(html).toContain('data-arcanum-slug="ring-of-daagon"');
		expect(html).toContain("Mark a consequence (Ring of Daagon)");
	});

	it("asks the player which Consequence, marks that one, once per card, and says which", async () => {
		const { actor, boxes } = seeker({ cards: [RING] });
		boxes["ring-of-daagon:back:1"] = true;
		const message = card();
		const ask  = vi.fn();
		const pick = vi.fn(async ({ consequences }) => consequences.find(c => /only from meat/.test(c.label)));
		expect(await settleMarkConsequence(message, actor, RING_OF_DAAGON, { ask, pick })).toBe(true);
		expect(pick.mock.calls[0][0].title).toBe("Ring of Daagon");
		expect(pick.mock.calls[0][0].consequences.map(c => c.index)).toEqual([2, 3, 5, 8]);
		expect(boxes["ring-of-daagon:back:3"]).toBe(true);
		expect(boxes["ring-of-daagon:back:2"]).toBeUndefined();
		expect(ask).not.toHaveBeenCalled();   // nothing to divert it to
		expect(message.flags[SCOPE][MARK_CONSEQUENCE_FLAG]).toBe(true);
		expect(posted[0].content).toContain("marks a Consequence of Ring of Daagon: You gain nourishment only from meat");
		expect(await settleMarkConsequence(message, actor, RING_OF_DAAGON, { ask, pick })).toBe(false);
		expect(pick).toHaveBeenCalledTimes(1);
	});

	it("marks nothing and gives the card back when the pick is closed", async () => {
		const { actor, boxes } = seeker({ cards: [RING] });
		const message = card();
		expect(await settleMarkConsequence(message, actor, RING_OF_DAAGON, { pick: async () => null })).toBe(false);
		expect(Object.keys(boxes).filter(k => k.startsWith("ring-of-daagon:back:"))).toEqual([]);
		expect(message.flags[SCOPE][MARK_CONSEQUENCE_FLAG]).toBeUndefined();
		expect(posted).toHaveLength(0);
	});

	it("asks with one button per Consequence, then Mark nothing yet", async () => {
		const ask = vi.fn(async () => null);
		const consequences = unmarkedConsequences(RING.back.description, {}, RING_OF_DAAGON);
		await askConsequencePick({ title: "Ring of Daagon", consequences }, { ask });
		const labels = ask.mock.calls[0][0].buttons.map(b => b.label);
		expect(labels).toHaveLength(5);
		expect(labels[0]).toBe("Your skin becomes clammy and squamous.");
		expect(labels.at(-1)).toBe("Mark nothing yet");
	});

	it("goes through Conduit of Power's ask for the picked one, as a box ticked by hand does", async () => {
		const { actor, boxes, resources } = seeker({ moves: [CONDUIT], conduit: 0, cards: [RING] });
		const ask  = vi.fn(async () => ({ kind: DIVERT.CONDUIT }));
		const pick = async ({ consequences }) => consequences[0];
		expect(await markArcanumConsequence(actor, RING_OF_DAAGON, { ask, pick })).toBe(true);
		expect(ask).toHaveBeenCalledWith({ title: "Ring of Daagon", diversions: { conduit: { marked: 0, max: 3 }, debilities: [] } });
		expect(resources[CONDUIT_OF_POWER]).toBe(1);
		expect(boxes["ring-of-daagon:back:1"]).toBeUndefined();

		const closed = seeker({ moves: [CONDUIT], cards: [RING] });
		const message = card();
		expect(await settleMarkConsequence(message, closed.actor, RING_OF_DAAGON, { ask: async () => null, pick })).toBe(false);
		expect(message.flags[SCOPE][MARK_CONSEQUENCE_FLAG]).toBeUndefined();
	});

	it("says so when every Consequence is marked, or the Ring's card is not held", async () => {
		const full = seeker({ cards: [RING] });
		for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) full.boxes[`ring-of-daagon:back:${i}`] = true;
		expect(await markArcanumConsequence(full.actor, RING_OF_DAAGON)).toBe(false);
		expect(ui.notifications.info).toHaveBeenCalledWith("Every Consequence on Ring of Daagon is marked already.");

		const none = seeker();
		expect(await markArcanumConsequence(none.actor, RING_OF_DAAGON)).toBe(false);
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("mark the consequence by hand"));
		expect(posted).toHaveLength(0);
	});
});
