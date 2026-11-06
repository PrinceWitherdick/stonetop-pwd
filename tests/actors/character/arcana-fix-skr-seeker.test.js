import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
	DIVERT, arcanumCastingPenalty, askConsequenceDiversion, askImproviseOption, consequenceDiversions,
	hasDiversion, loyaltyDiversion, markImproviseStep, orderMissConsequenceActions, settleArcanumBoxTick, unmetUnlockOptions,
} from "../../../module/actors/character/arcana-seeker-moves.js";
import { consequenceBoxRange } from "../../../module/actors/character/CharacterArcana.js";

// Arcana audit 2026-11-04, fixer SKR: MNA-6 / SKR-1 (Improvise's 10+ step on a card unlocked by its
// requirements, paths per ruling A1), MAJ-10 / SKR-9 (the Demonhide Cloak's Loyalty in a Consequence's place),
// A12 / MAJ-15 (the Mighty Servant's Order Followers 6-), MAJ-9 (the Hec'tumel Codex's casting penalty).

const SCOPE = "stonetop-pwd";
const readCard = rel => JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")).flags.stonetop;
const BEADS = { slug: "length-of-prayer-beads", ...readCard("packs/src/stonetop-arcana/minor/length-of-prayer-beads.json") };
const DEMONHIDE = { slug: "demonhide-cloak", major: true, ...readCard("packs/src/stonetop-arcana/major/demonhide-cloak.json") };
const CODEX = { slug: "hectumel-codex", major: true, ...readCard("packs/src/stonetop-arcana/major/hectumel-codex.json") };

/** Two ways to unlock: a teacher alone, or brewing and drinking (the silvery glass bottle's shape, A1). */
const BOTTLE = {
	slug: "bottle",
	front: { title: "A silvery glass bottle", unlock: { requirements: [
		{ type: "option", slug: "study", description: "<p>… study it for a season;</p>" },
		{ type: "option", slug: "find-teacher", path: "teacher", description: "… find one who knows its workings;" },
		{ type: "text", content: "or…" },
		{ type: "option", slug: "fill", path: "brew", description: "… fill the bottle." },
		{ type: "option", slug: "drink", path: "brew", max: 2, description: "… drink the contents." },
	] } },
};

function holder({ cards = [], unlock = {}, followers = {}, unlocked = false } = {}) {
	const boxes = {};
	const model = {
		get arcanaUnlockCounts() { return unlock; },
		getArcanum: vi.fn(async slug => cards.find(c => c.slug === slug) ?? null),
		setArcanumUnlockCount: vi.fn(async (slug, option, n) => { unlock[`${slug}:${option}`] = n; }),
		setArcanumBoxChecked: vi.fn(async (slug, context, index, checked) => { boxes[`${slug}:${context}:${index}`] = checked; }),
		markNextArcanumUnlockStep: vi.fn(async () => ({ index: null, count: 0, title: "?" })),
		isArcanumUnlocked: vi.fn(async () => unlocked),
		ownedArcanaSlugs: new Set(cards.map(c => c.slug)),
		arcanaBoxStates: boxes,
		moveResources: { getMoveResources: () => ({}) },
		debilityChoices: [],
		get debilityMarkChoices() { return []; },
		background: { selectedSlug: null, setupResources: {} },
	};
	const flags = { customFollowers: followers };
	const actor = {
		id: "wren", name: "Wren", type: "character", isOwner: true, items: [], system: { playbook: { name: "The Seeker" } },
		typedActor: model,
		flags: { [SCOPE]: flags },
		getFlag: (scope, key) => (scope === SCOPE ? flags[key] : undefined),
		update: vi.fn(async data => {
			for (const [k, v] of Object.entries(data)) {
				const m = /^flags\.stonetop-pwd\.customFollowers\.([^.]+)\.loyalty$/.exec(k);
				if (m) flags.customFollowers[m[1]].loyalty = v;
			}
		}),
	};
	return { actor, model, boxes, unlock, flags };
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

describe("MNA-6: Improvise's step on a card unlocked by its requirements", () => {
	it("lists every requirement still wanted, by its own words, labelling each way when there are two", () => {
		const options = unmetUnlockOptions(BOTTLE.front, {}, "bottle");
		expect(options.map(o => o.slug)).toEqual(["study", "find-teacher", "fill", "drink"]);
		expect(options.map(o => o.label)).toEqual([
			"study it for a season", "Way 1: find one who knows its workings", "Way 2: fill the bottle", "Way 2: drink the contents (1 of 2)",
		]);
	});

	it("drops the other way's steps once one way is done, and what is already met", () => {
		const options = unmetUnlockOptions(BOTTLE.front, { "bottle:find-teacher": 1, "bottle:drink": 1 }, "bottle");
		expect(options.map(o => o.slug)).toEqual(["study"]);
		const half = unmetUnlockOptions(BOTTLE.front, { "bottle:drink": 1 }, "bottle");
		expect(half.find(o => o.slug === "drink")).toMatchObject({ count: 1, max: 2, label: "Way 2: drink the contents (2 of 2)" });
	});

	it("asks with a button per requirement and one that marks nothing, noting the ways", async () => {
		const ask = vi.fn(async () => null);
		await askImproviseOption({ title: "A silvery glass bottle", options: unmetUnlockOptions(BOTTLE.front, {}, "bottle") }, { ask });
		const asked = ask.mock.calls[0][0];
		expect(asked.buttons.at(-1).label).toBe("Mark nothing yet");
		expect(asked.buttons).toHaveLength(5);
		expect(asked.content).toContain("more than one way");
	});

	it("counts one more step on the requirement picked, up to its max, and says so", async () => {
		const { actor, model, unlock } = holder({ cards: [BEADS] });
		const option = vi.fn(async ({ options }) => options[1]);
		expect(await markImproviseStep(actor, BEADS.slug, { option })).toBe(true);
		expect(option.mock.calls[0][0].options.map(o => o.slug)).toEqual(["decipher-glyphs", "learn-chants", "isolated-fasting"]);
		expect(model.setArcanumUnlockCount).toHaveBeenCalledWith(BEADS.slug, "learn-chants", 1);
		expect(unlock[`${BEADS.slug}:learn-chants`]).toBe(1);
		// The ○ track is not this card's step: nothing was ticked there.
		expect(model.markNextArcanumUnlockStep).not.toHaveBeenCalled();
		expect(posted[0].content).toContain("marks a step towards unlocking");
		expect(posted[0].content).toContain("learn the meditative chants");
	});

	it("says when the last step unlocks it, and marks nothing when closed or when every requirement is met", async () => {
		const last = holder({ cards: [BEADS], unlocked: true, unlock: { [`${BEADS.slug}:decipher-glyphs`]: 1, [`${BEADS.slug}:learn-chants`]: 1 } });
		expect(await markImproviseStep(last.actor, BEADS.slug, { option: async ({ options }) => options[0] })).toBe(true);
		expect(posted.at(-1).content).toContain("That was the last step");

		const closed = holder({ cards: [BEADS] });
		expect(await markImproviseStep(closed.actor, BEADS.slug, { option: async () => null })).toBe(false);
		expect(closed.model.setArcanumUnlockCount).not.toHaveBeenCalled();

		const met = holder({ cards: [BEADS], unlock: Object.fromEntries(["decipher-glyphs", "learn-chants", "isolated-fasting"].map(s => [`${BEADS.slug}:${s}`, 1])) });
		const option = vi.fn();
		expect(await markImproviseStep(met.actor, BEADS.slug, { option })).toBe(false);
		expect(option).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("is met already"));
	});

	it("builds on a step marked while the ask was open, rather than writing over it", async () => {
		const { actor, model, unlock } = holder({ cards: [BOTTLE] });
		const option = vi.fn(async ({ options }) => {
			unlock["bottle:drink"] = 1;   // marked by hand meanwhile
			return options.find(o => o.slug === "drink");
		});
		expect(await markImproviseStep(actor, "bottle", { option })).toBe(true);
		expect(model.setArcanumUnlockCount).toHaveBeenCalledWith("bottle", "drink", 2);
	});
});

describe("MAJ-10: the Demonhide Cloak's Loyalty in a Consequence's place", () => {
	const cloak = (loyalty, extra = {}) => ({ c1: { name: "The Cloak", sourceUuid: "demonhide-cloak:the-cloak", loyalty, ...extra } });
	const range = consequenceBoxRange(DEMONHIDE.back.description);

	it("is offered only for the Cloak's own card, while the Cloak follower holds Loyalty", () => {
		expect(loyaltyDiversion(holder({ followers: cloak(2) }).actor, "demonhide-cloak")).toEqual({ id: "c1", name: "The Cloak", loyalty: 2 });
		expect(loyaltyDiversion(holder({ followers: cloak(0) }).actor, "demonhide-cloak")).toBeNull();
		expect(loyaltyDiversion(holder({ followers: cloak(2, { dead: true }) }).actor, "demonhide-cloak")).toBeNull();
		expect(loyaltyDiversion(holder({ followers: cloak(2) }).actor, "azure-hand")).toBeNull();
		expect(loyaltyDiversion(holder().actor, "demonhide-cloak")).toBeNull();
		const d = consequenceDiversions(holder({ followers: cloak(1) }).actor, "demonhide-cloak");
		expect(hasDiversion(d)).toBe(true);
		expect(hasDiversion(consequenceDiversions(holder({ followers: cloak(1) }).actor, "azure-hand"))).toBe(false);
	});

	it("asks with its own button beside marking the Consequence", async () => {
		const ask = vi.fn(async () => null);
		await askConsequenceDiversion({ title: "Demonhide Cloak", diversions: { conduit: null, debilities: [], loyalty: { id: "c1", name: "The Cloak", loyalty: 2 } } }, { ask });
		const asked = ask.mock.calls[0][0];
		expect(asked.buttons.map(b => b.key)).toEqual([DIVERT.CONSEQUENCE, DIVERT.LOYALTY]);
		expect(asked.buttons[1].label).toBe("Spend 1 of The Cloak's Loyalty instead");
		expect(asked.content).toContain("it holds 2");
	});

	it("spends 1 Loyalty off the follower card and leaves the Consequence clear", async () => {
		const { actor, boxes, flags } = holder({ cards: [DEMONHIDE], followers: cloak(2) });
		const ask = vi.fn(async () => ({ kind: DIVERT.LOYALTY }));
		const result = await settleArcanumBoxTick(actor, { slug: "demonhide-cloak", context: "back", index: range.from, checked: true }, { ask });
		expect(result).toBe("diverted");
		expect(flags.customFollowers.c1.loyalty).toBe(1);
		expect(actor.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.c1.loyalty": 1 }, { stonetopMove: "Demonhide Cloak" });
		expect(boxes[`demonhide-cloak:back:${range.from}`]).toBeUndefined();
		expect(posted[0].content).toMatch(/spends 1 of The Cloak(&#x27;|&#39;|')s Loyalty \(now 1\)/);
	});

	it("marks the Consequence as it stands with no Cloak to ask about", async () => {
		const { actor, boxes } = holder({ cards: [DEMONHIDE] });
		const ask = vi.fn();
		expect(await settleArcanumBoxTick(actor, { slug: "demonhide-cloak", context: "back", index: range.from, checked: true }, { ask })).toBe("marked");
		expect(ask).not.toHaveBeenCalled();
		expect(boxes[`demonhide-cloak:back:${range.from}`]).toBe(true);
	});
});

describe("A12: the Mighty Servant's Order Followers 6- marks a Mindgem Consequence", () => {
	it("carries the Mindgem's Mark a consequence button for the Servant only", () => {
		const html = orderMissConsequenceActions({ name: "The Mighty Servant", sourceUuid: "mindgem:mighty-servant" });
		expect(html).toContain('class="stonetop-mark-consequence"');
		expect(html).toContain('data-arcanum-slug="mindgem"');
		expect(html).toContain("Mark a consequence (Mindgem)");
		expect(orderMissConsequenceActions({ name: "Astor", sourceUuid: "blackwood-fetishes:astor" })).toBe("");
		expect(orderMissConsequenceActions(undefined)).toBe("");
	});
});

describe("MAJ-9: the Hec'tumel Codex's casting penalty on Cast a Codex Spell", () => {
	const cast = { name: "CAST A CODEX SPELL" };

	it("is -1 for each ticked circle of the track printed after its label", () => {
		expect(arcanumCastingPenalty(CODEX, cast, {})).toBeNull();
		const two = { "hectumel-codex:frontCircle:0": true, "hectumel-codex:frontCircle:3": true, "hectumel-codex:frontCircle:4": false };
		expect(arcanumCastingPenalty(CODEX, cast, two)).toEqual({ value: -2, marked: 2, note: "Casting penalty -2 (Hec'tumel Codex)" });
		const all = Object.fromEntries([0, 1, 2, 3, 4].map(i => [`hectumel-codex:frontCircle:${i}`, true]));
		expect(arcanumCastingPenalty(CODEX, cast, all).value).toBe(-5);
	});

	it("touches no other move, and no other card", () => {
		const marks = { "hectumel-codex:frontCircle:0": true };
		expect(arcanumCastingPenalty(CODEX, { name: "DARKSOME VESSEL" }, marks)).toBeNull();
		expect(arcanumCastingPenalty({ ...CODEX, slug: "azure-hand" }, cast, { "azure-hand:frontCircle:0": true })).toBeNull();
	});

	it("finds the track after other circle runs printed before it", () => {
		const card = { slug: "hectumel-codex", front: { title: "Codex", description: "<p>Heat ○○○</p><p><strong>CAST A CODEX SPELL</strong>: Casting penalty ○○</p>" } };
		expect(arcanumCastingPenalty(card, cast, { "hectumel-codex:frontCircle:0": true })).toBeNull();
		expect(arcanumCastingPenalty(card, cast, { "hectumel-codex:frontCircle:3": true })?.value).toBe(-1);
	});
});
