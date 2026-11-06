// Arcana audit 2026-11-04, leftovers after the six fixers: Improvise's 10+ on a card whose unlock ○
// are all marked (the Staff of the Lidless Orb's new effect, the Storm Markings' Fury), Improvise on a
// homebrew card's typed unlock □ (context unlockBox, ruling A14), and the summons corrected on
// followers already summoned (follower-refresh.js).
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	askImproviseEffect, markImproviseStep, unlockOverflow, unmarkedUnlockBoxes,
} from "../../../module/actors/character/arcana-seeker-moves.js";
import { CharacterArcana } from "../../../module/actors/character/CharacterArcana.js";
import { FOLLOWER_SUPERSEDED, followerRefresh } from "../../../module/migration/follower-refresh.js";
import { summonEntryFor } from "../../../module/data/arcana-summons.js";
import { FakeArcanaRepository } from "../../fakes/FakeArcanaRepository.js";
import { flagFragmentOps } from "../../fakes/flag-fragments.js";

const MAJOR = "packs/src/stonetop-arcana/major";
const readCard = file => ({ ...JSON.parse(fs.readFileSync(path.resolve(MAJOR, file), "utf8")).flags.stonetop });
const LIDLESS = readCard("staff-of-the-lidless-orb.json");
const STORM = readCard("storm-markings.json");

function makeFlags(store = {}) {
	return {
		_store: store,
		...flagFragmentOps(store),
		getFlag: key => store[key] ?? null,
		setFlag: vi.fn(async (key, value) => { store[key] = value; }),
		batch: vi.fn(async ({ sets = {}, deletes = {} } = {}) => {
			for (const [k, v] of Object.entries(sets)) store[k] = v;
			for (const [k, subs] of Object.entries(deletes)) for (const sub of subs) delete store[k]?.[sub];
		}),
	};
}

/** A Seeker whose arcana are a real CharacterArcana, so every write goes through the engine (latch included). */
function seeker(cards, store = {}) {
	store.owned ??= cards.map(c => c.slug);
	store.identified ??= cards.map(c => c.slug);
	const arcana = new CharacterArcana(makeFlags(store), new FakeArcanaRepository(cards));
	const model = {
		_arcana: arcana,
		getArcanum: slug => arcana.getArcanum(slug),
		markNextArcanumUnlockStep: (slug, o) => arcana.markNextUnlockStep(slug, o),
		setArcanumBoxChecked: (...a) => arcana.setArcanumBoxChecked(...a),
		setArcanumBoxesChecked: (...a) => arcana.setArcanumBoxesChecked(...a),
		setArcanumUnlockCount: (...a) => arcana.setUnlockCount(...a),
		isArcanumUnlocked: slug => arcana.isArcanumUnlocked(slug),
		get arcanaBoxStates() { return arcana.boxStates; },
		get arcanaUnlockCounts() { return arcana.unlockCounts; },
	};
	const actor = { id: "wren", name: "Wren", type: "character", isOwner: true, typedActor: model };
	return { actor, arcana, store };
}

const allCircles = slug => ({ boxLayouts: { "staff-of-the-lidless-orb:back:power-boxes": true },
	boxes: { [`${slug}:unlock:0`]: true, [`${slug}:unlock:1`]: true, [`${slug}:unlock:2`]: true } });

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

describe("unlockOverflow: what a mark does once every unlock circle is marked, read off the card", () => {
	it("reads the Lidless Orb's four effect boxes under Power of the Lidless Orb", () => {
		const overflow = unlockOverflow(LIDLESS);
		expect(overflow).toMatchObject({ kind: "effect", name: "Power of the Lidless Orb" });
		expect(overflow.effects.map(e => e.index)).toEqual([1, 2, 3, 4]);
		expect(overflow.effects[0].label).toBe("Cast your sight afar");
	});

	it("reads the Storm Markings' Fury run and the value to set it to", () => {
		expect(unlockOverflow(STORM)).toEqual({ kind: "set", name: "Fury", value: 3, from: 0, length: 4 });
	});

	it("is null on every other major (the Redwood Effigy's overflow is Surrogate Suffering's, not every mark's)", () => {
		const others = fs.readdirSync(path.resolve(MAJOR))
			.filter(f => !["staff-of-the-lidless-orb.json", "storm-markings.json"].includes(f));
		expect(others).toHaveLength(16);
		for (const f of others) expect(unlockOverflow(readCard(f)), f).toBeNull();
	});
});

describe("Improvise's 10+ with every unlock circle marked", () => {
	it("on the Lidless Orb asks which unmarked effect and ticks its □", async () => {
		const store = allCircles(LIDLESS.slug);
		store.boxes[`${LIDLESS.slug}:back:1`] = true;   // the effect chosen at unlock
		const { actor } = seeker([LIDLESS], store);
		const effect = vi.fn(async ({ effects }) => effects[1]);
		expect(await markImproviseStep(actor, LIDLESS.slug, { effect })).toBe(true);
		expect(effect.mock.calls[0][0].effects.map(e => e.index)).toEqual([2, 3, 4]);
		expect(store.boxes[`${LIDLESS.slug}:back:3`]).toBe(true);
		expect(posted[0].content).toContain("marks a new effect for Power of the Lidless Orb");
	});

	it("marks nothing when closed, and says so when every effect is marked", async () => {
		const closed = seeker([LIDLESS], allCircles(LIDLESS.slug));
		expect(await markImproviseStep(closed.actor, LIDLESS.slug, { effect: async () => null })).toBe(false);
		expect(Object.keys(closed.store.boxes).filter(k => k.includes(":back:"))).toEqual([]);

		const full = allCircles(LIDLESS.slug);
		for (const i of [1, 2, 3, 4]) full.boxes[`${LIDLESS.slug}:back:${i}`] = true;
		const effect = vi.fn();
		expect(await markImproviseStep(seeker([LIDLESS], full).actor, LIDLESS.slug, { effect })).toBe(false);
		expect(effect).not.toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("so is every effect"));
	});

	it("asks with a button per effect and one that marks nothing", async () => {
		const ask = vi.fn(async () => null);
		await askImproviseEffect({ title: "Staff", name: "Power of the Lidless Orb", effects: unlockOverflow(LIDLESS).effects }, { ask });
		const asked = ask.mock.calls[0][0];
		expect(asked.buttons).toHaveLength(5);
		expect(asked.buttons.at(-1)).toMatchObject({ key: "none", label: "Mark nothing yet", value: null });
		expect(asked.content).toContain("marks a new effect for <strong>Power of the Lidless Orb</strong>");
	});

	it("on the Storm Markings sets Fury to 3", async () => {
		const store = allCircles(STORM.slug);
		store.boxes[`${STORM.slug}:backCircle:3`] = true;
		const { actor } = seeker([STORM], store);
		expect(await markImproviseStep(actor, STORM.slug)).toBe(true);
		expect([0, 1, 2, 3].map(i => !!store.boxes[`${STORM.slug}:backCircle:${i}`])).toEqual([true, true, true, false]);
		expect(posted[0].content).toContain("sets Fury to 3");
	});

	it("keeps the old message on a card that says nothing about it", async () => {
		const plain = { slug: "plain", front: { title: "Plain", description: "", unlock: { description: "○○ Mark it.", requirements: [] } },
			back: { title: "Back", description: "<p>□ X</p>", options: [] } };
		const store = { boxes: { "plain:unlock:0": true, "plain:unlock:1": true } };
		expect(await markImproviseStep(seeker([plain], store).actor, "plain")).toBe(false);
		expect(ui.notifications.info).toHaveBeenCalledWith("Every unlock circle on Plain is marked already.");
	});
});

describe("Improvise on a homebrew card's typed unlock boxes (unlockBox)", () => {
	const boxed = (requirements = []) => ({
		slug: "boxed",
		front: { title: "Boxed", item: null, description: "<p>Front.</p>", unlock: { description: "<p>□ Find the smith. □ Pay her.</p>", requirements } },
		back: { title: "Boxed back", item: null, description: "<p>Back.</p>", resource: null, move: null, options: [] },
	});

	it("lists the unticked boxes by their words", () => {
		const card = boxed();
		expect(unmarkedUnlockBoxes(card.front, {}, "boxed").map(b => [b.box, b.label])).toEqual([[0, "Find the smith"], [1, "Pay her"]]);
		expect(unmarkedUnlockBoxes(card.front, { "boxed:unlockBox:0": true }, "boxed").map(b => b.box)).toEqual([1]);
	});

	it("asks which box, ticks it, and the tick that completes the track latches the unlock", async () => {
		const { actor, arcana, store } = seeker([boxed()]);
		const option = vi.fn(async ({ options }) => options.find(o => o.box === 1));
		expect(await markImproviseStep(actor, "boxed", { option })).toBe(true);
		expect(option.mock.calls[0][0].options.map(o => o.label)).toEqual(["Find the smith", "Pay her"]);
		expect(store.boxes["boxed:unlockBox:1"]).toBe(true);
		expect(await arcana.isArcanumUnlocked("boxed")).toBe(false);
		expect(posted[0].content).toContain("Pay her");

		expect(await markImproviseStep(actor, "boxed", { option: async ({ options }) => options[0] })).toBe(true);
		expect(store.boxes["boxed:unlockBox:0"]).toBe(true);
		expect(store.unlockedOnce).toEqual(["boxed"]);
		expect(posted.at(-1).content).toContain("That was the last step");
	});

	it("offers the boxes beside a card's requirement options", async () => {
		const card = boxed([{ type: "option", slug: "study", description: "study it" }]);
		const { actor, store } = seeker([card]);
		const option = vi.fn(async ({ options }) => options.find(o => o.box === 0));
		expect(await markImproviseStep(actor, "boxed", { option })).toBe(true);
		expect(option.mock.calls[0][0].options.map(o => o.label)).toEqual(["study it", "Find the smith", "Pay her"]);
		expect(store.boxes["boxed:unlockBox:0"]).toBe(true);
		expect(store.unlock?.["boxed:study"]).toBeUndefined();
	});

	it("offers a card's unlock ○ beside its requirement options, and ticks the next one", async () => {
		const card = boxed([{ type: "option", slug: "study", description: "study it" }]);
		card.front.unlock.description = "<p>○○ Each time you study it, mark one.</p>";
		const { actor, arcana, store } = seeker([card], { unlock: { "boxed:study": 1 } });
		const option = vi.fn(async ({ options }) => options.find(o => o.circle));
		expect(await markImproviseStep(actor, "boxed", { option, pick: vi.fn() })).toBe(true);
		expect(option.mock.calls[0][0].options.map(o => o.label)).toEqual(["The next ○ on the unlock track (1 of 2)"]);
		expect(store.boxes["boxed:unlock:0"]).toBe(true);
		expect(await markImproviseStep(actor, "boxed", { option, pick: vi.fn() })).toBe(true);
		expect(store.boxes["boxed:unlock:1"]).toBe(true);
		expect(await arcana.isArcanumUnlocked("boxed")).toBe(true);
		expect(posted.at(-1).content).toContain("That was the last step");
	});

	it("ticks the ○ first, then asks about the boxes; marks nothing for a box ticked while the ask was open", async () => {
		const card = boxed();
		card.front.unlock.description = "<p>○ Hear of it.</p><p>□ Find the smith.</p>";
		const { actor, store } = seeker([card]);
		const option = vi.fn(async ({ options }) => options[0]);
		expect(await markImproviseStep(actor, "boxed", { option })).toBe(true);
		expect(store.boxes["boxed:unlock:0"]).toBe(true);
		expect(option).not.toHaveBeenCalled();
		expect(posted[0].content).not.toContain("That was the last mark");

		const late = vi.fn(async ({ options }) => { store.boxes["boxed:unlockBox:0"] = true; return options[0]; });
		expect(await markImproviseStep(actor, "boxed", { option: late })).toBe(false);
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("is marked already; nothing was marked"));
	});
});

describe("follower-refresh: summons corrected on followers already summoned", () => {
	const DOOL = "scroll-and-bone-flute:dool-spirit";
	const HALIX = "blackwood-fetishes:halix";

	it("gives an old dool spirit d6 and leaves damage its player wrote", () => {
		const card = { sourceUuid: DOOL, damage: FOLLOWER_SUPERSEDED[DOOL].damage[0] };
		expect(followerRefresh(card)).toEqual({ damage: "feast on fear d6 (hand, close, ignores armor, disadvantage)" });
		expect(followerRefresh({ sourceUuid: DOOL, damage: "feast on fear d10" })).toBeNull();
	});

	it("gives an old Halix the book's damage and moves, alongside the old exceptional tag fix", () => {
		const entry = summonEntryFor({ sourceUuid: HALIX });
		const card = { sourceUuid: HALIX, tags: entry.tags, exceptional: true,
			damage: FOLLOWER_SUPERSEDED[HALIX].damage[0], moves: FOLLOWER_SUPERSEDED[HALIX].moves[0] };
		expect(followerRefresh(card)).toEqual({ damage: entry.damage, moves: entry.moves });
		expect(entry.damage).toContain("host's weapon d6 (tags vary)");
		expect(entry.moves).toContain("Manifest a ghostly presence (harmed only by silver or salt)");
		expect(followerRefresh({ ...card, damage: "my own", moves: "Haunt the cellar" })).toBeNull();
	});

	it("never lists a value the summons still ship, and leaves the mantle wraiths alone", () => {
		for (const uuid of [DOOL, HALIX]) {
			const entry = summonEntryFor({ sourceUuid: uuid });
			for (const field of ["damage", "moves"]) {
				if (FOLLOWER_SUPERSEDED[uuid][field]) expect(FOLLOWER_SUPERSEDED[uuid][field]).not.toContain(entry[field]);
			}
		}
		expect(FOLLOWER_SUPERSEDED["tattered-mantle:mantle-wraiths"]).toBeUndefined();
		const wraiths = { sourceUuid: "tattered-mantle:mantle-wraiths", hp: 13, tags: ["group (3)", "spirit", "undead", "terrifying", "vicious"],
			moves: "Whisper their longings to the weaver" };
		expect(followerRefresh(wraiths)).toBeNull();
	});
});
