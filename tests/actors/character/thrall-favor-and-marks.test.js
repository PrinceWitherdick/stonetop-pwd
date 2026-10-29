// The Thrall's Favor and Marks, past the pips (Book I pp.152-153), and the lore followers of both inserts:
//  - TH-1  "+1 Favor" (Urges), and at 3 its overflow: "reduce your Favor to 0 and choose 1".
//  - TH-3  Child of the Deeps' tentacle, a follower bought with 1 Favor.
//  - TH-4  the Ravenous maw (hand, 3 piercing, messy), out for 1 Favor as a weapon Clash offers.
//  - TH-5  two Impulses ticked are flagged; Ravenous's extra Impulse is printed beside the GM's.
//  - RV-4  a lore follower's card is asked about once its option is no longer held (default: dismiss).
//  - RV-7  the vermin (and the tentacle) eat nothing from a pack.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";
import {
	buildPostDeathTabView, callTentacle, gainFavor, ravenousMawOut, setRavenousMaw,
} from "../../../module/actors/character/post-death-outcomes.js";
import { moveActionsFor } from "../../../module/actors/character/post-death-actions.js";
import { LORE_FOLLOWERS, dropStrayHeldMoves, offerLoreFollowers } from "../../../module/actors/character/post-death-moves.js";
import { followerFeedsItself, followerMouths } from "../../../module/actors/character/follower-party.js";
import { HORRID_MAW, MOVE_GRANTED_WEAPONS } from "../../../module/data/weapons.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { makeLiveActor } from "../../fakes/LiveCharacter.js";
import { readRepo } from "../../fakes/css.js";

const INSERTS = ["revenant", "ghost", "thrall"].map(slug =>
	JSON.parse(readRepo(`packs/src/stonetop-items/post-death-inserts/${slug}.json`)));
const SCOPE = "stonetop-pwd";

function makeThrall({ counts = {}, insert = {}, slug = "thrall" } = {}) {
	const actor = makeLiveActor({
		name: "Vess",
		flags: { postDeathInsert: { slug, ...insert }, postDeathLore: { counts } },
	});
	actor.isOwner = true;
	actor.system.attributes.wounds = [];
	const factory = new FakeRepositoryFactory({
		postDeathInsert: new FakePostDeathInsertRepository(INSERTS),
		moves: { getPostDeathMoves: async () => [] },
	});
	const char = new StonetopCharacter(actor, factory);
	char.computedMaxHp = async () => 16;
	actor.typedActor = char;
	return { actor, char };
}

const favor = actor => Number(actor.flags[SCOPE].postDeathLore?.counts?.["favor:favor-track"] ?? 0);
const followers = actor => Object.values(actor.flags[SCOPE].customFollowers ?? {});

async function tabView(char, opts = {}) {
	const snapshot = await char._postDeath.buildSnapshot();
	return buildPostDeathTabView(char, snapshot.activeInsert, {
		editMode: false, canEdit: true, isGM: false, outOfPlay: false, hp: 8, maxHp: 16, ...opts,
	});
}

/** Press the button labelled `label` in the next asked window (null closes it). */
function press(label) {
	const wait = vi.fn(async config => config.buttons.find(b => b.label === label)?.action ?? null);
	globalThis.foundry.applications ??= {};
	globalThis.foundry.applications.api ??= {};
	globalThis.foundry.applications.api.DialogV2 = { wait };
	return wait;
}

let savedDialog;
beforeEach(() => {
	savedDialog = globalThis.foundry?.applications?.api?.DialogV2;
	global.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
});
afterEach(() => {
	delete global.ChatMessage;
	if (globalThis.foundry?.applications?.api) globalThis.foundry.applications.api.DialogV2 = savedDialog;
});

describe("TH-1: +1 Favor and its overflow", () => {
	it("gains one below 3, in one write, and tells the table", async () => {
		const { actor, char } = makeThrall({ counts: { "favor:favor-track": 1 } });
		actor.update.mockClear();
		const done = await gainFavor(char);
		expect(favor(actor)).toBe(2);
		expect(done.held).toBe(2);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Gained 1 Favor");
	});

	it("flags a gain while the master's task stands, and never refuses it", async () => {
		const { actor, char } = makeThrall({ insert: { task: "Bring me the bell" } });
		const done = await gainFavor(char);
		expect(favor(actor)).toBe(1);
		expect(done.lines.join(" ")).toContain("master's task");
	});

	it("at 3, asks choose 1; the question resets Favor and holds advantage in ONE write", async () => {
		const { actor, char } = makeThrall({ counts: { "favor:favor-track": 3 } });
		actor.update.mockClear();
		const wait = press("Ask your master a question (advantage on your next roll to act on the answer)");
		const done = await gainFavor(char);
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual([
			"Ask your master a question (advantage on your next roll to act on the answer)",
			"Gain a new Mark of your choice (then the GM crosses one off)",
			"Never mind",
		]);
		expect(done.overflow).toBe("question");
		expect(favor(actor)).toBe(0);
		expect(char.heldAdvantage()?.sources).toEqual(["Your master's answer (Favor)"]);
		expect(actor.update).toHaveBeenCalledTimes(1);
	});

	it("at 3, the Mark resets Favor with the Mark, and the card asks the GM to cross one off", async () => {
		const { actor, char } = makeThrall({ counts: { "favor:favor-track": 3 } });
		const wait = vi.fn()
			.mockImplementationOnce(async config => config.buttons.find(b => b.label.startsWith("Gain a new Mark")).action)
			.mockImplementationOnce(async config => config.buttons.find(b => b.label === "Gain DEATH MASK").action);
		globalThis.foundry.applications.api.DialogV2 = { wait };
		const done = await gainFavor(char);
		expect(done.overflow).toBe("mark");
		expect(Number(actor.flags[SCOPE].postDeathLore.counts["marks:death-mask"])).toBe(1);
		expect(favor(actor)).toBe(0);
		expect(done.lines.join(" ")).toContain("ask the GM to choose a Mark that you don't have");
	});

	it("at 3, closing the window gains nothing and keeps the 3", async () => {
		const { actor, char } = makeThrall({ counts: { "favor:favor-track": 3 } });
		press(null);
		expect(await gainFavor(char)).toBeNull();
		expect(favor(actor)).toBe(3);
	});

	it("puts +1 Favor beside the pips, and on the Urges card", async () => {
		const { actor, char } = makeThrall();
		expect((await tabView(char)).favor.actions.map(a => a.action)).toEqual(["favor-gain"]);
		expect((await tabView(char, { canEdit: false })).favor.actions).toEqual([]);
		actor.items.push({ _id: "u", type: "move", name: "Urges", system: { moveType: "post-death" } });
		expect(moveActionsFor(actor).Urges.map(a => a.action)).toEqual(["gainFavor"]);
	});
});

describe("TH-3: Child of the Deeps' tentacle", () => {
	const KEY = "marks:child-of-the-deeps";

	it("offers the call only while the Mark is held, and says why with no Favor", async () => {
		const none = await tabView(makeThrall().char);
		expect(none.favor.actions.map(a => a.action)).not.toContain("favor-tentacle");
		const broke = (await tabView(makeThrall({ counts: { [KEY]: 1 } }).char)).favor.actions.find(a => a.action === "favor-tentacle");
		expect(broke).toMatchObject({ disabled: true, tooltip: "You hold no Favor to spend." });
		const flush = (await tabView(makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 1 } }).char))
			.favor.actions.find(a => a.action === "favor-tentacle");
		expect(flush.disabled).toBe(false);
		expect(flush.tooltip).toContain("the table's call");
	});

	it("spends 1 Favor and makes the follower, with the printed stats, in ONE write", async () => {
		const { actor, char } = makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 2 } });
		actor.update.mockClear();
		const done = await callTentacle(char);
		expect(done.created).toBe(true);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(favor(actor)).toBe(1);
		expect(followers(actor)).toEqual([expect.objectContaining({
			name: "Slimy tentacle", tags: ["stealthy", "relentless"], hpMax: 6,
			damage: "d10 (reach, forceful, grabby)", instinct: "to squeeze the life from things", cost: "lives drowned",
			sourceUuid: LORE_FOLLOWERS[KEY].sourceUuid,
		})]);
		expect(actor.flags[SCOPE].postDeathInsert.offered).toEqual([KEY]);
	});

	it("calls the same card forth again, spending the Favor and making no second one", async () => {
		const { actor, char } = makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 2 } });
		await callTentacle(char);
		const again = await callTentacle(char);
		expect(again.created).toBe(false);
		expect(favor(actor)).toBe(0);
		expect(followers(actor)).toHaveLength(1);
	});

	it("spends nothing without Favor, or without the Mark", async () => {
		globalThis.ui = { notifications: { warn: vi.fn() } };
		const broke = makeThrall({ counts: { [KEY]: 1 } });
		expect(await callTentacle(broke.char)).toBeNull();
		expect(followers(broke.actor)).toEqual([]);
		const none = makeThrall({ counts: { "favor:favor-track": 2 } });
		expect(await callTentacle(none.char)).toBeNull();
		expect(favor(none.actor)).toBe(2);
	});

	it("is never offered on marking: only the Favor spend makes it", async () => {
		const { actor } = makeThrall({ counts: { [KEY]: 1 } });
		const confirm = vi.fn(async () => true);
		expect(await offerLoreFollowers(actor, { confirm })).toEqual([]);
		expect(confirm).not.toHaveBeenCalled();
	});
});

describe("TH-4: the Ravenous maw", () => {
	const KEY = "marks:ravenous";

	it("is a weapon (hand, 3 piercing, messy) granted by the move the maw coming out makes", () => {
		expect(MOVE_GRANTED_WEAPONS[HORRID_MAW].meta).toMatchObject({ range: ["hand"], piercing: 3, tags: ["messy"] });
	});

	it("comes out for 1 Favor, and goes away for nothing", async () => {
		const { actor, char } = makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 1 } });
		expect((await tabView(char)).favor.actions.map(a => a.action)).toContain("favor-maw");
		expect(await setRavenousMaw(char, true)).toBe(true);
		expect(favor(actor)).toBe(0);
		expect(ravenousMawOut(actor)).toBe(true);
		const maw = actor.items.find(i => i.name === HORRID_MAW);
		expect(maw.system.moveType).toBe("post-death");
		expect(maw.flags[SCOPE].heldWhile).toBe(KEY);
		expect((await tabView(char)).favor.actions.map(a => a.action)).toContain("favor-maw-away");
		expect(moveActionsFor(actor)[HORRID_MAW].map(a => a.action)).toEqual(["mawAway"]);

		expect(await setRavenousMaw(char, true)).toBe(false);
		expect(await setRavenousMaw(char, false)).toBe(true);
		expect(ravenousMawOut(actor)).toBe(false);
		expect(favor(actor)).toBe(0);
	});

	it("does not come out without Favor, or without Ravenous", async () => {
		globalThis.ui = { notifications: { warn: vi.fn() } };
		const broke = makeThrall({ counts: { [KEY]: 1 } });
		expect(await setRavenousMaw(broke.char, true)).toBe(false);
		expect(ravenousMawOut(broke.actor)).toBe(false);
		const none = makeThrall({ counts: { "favor:favor-track": 1 } });
		expect(await setRavenousMaw(none.char, true)).toBe(false);
		expect(favor(none.actor)).toBe(1);
	});

	it("goes when Ravenous is no longer held, or the insert is taken away", async () => {
		const { actor, char } = makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 1 } });
		await setRavenousMaw(char, true);
		expect(await dropStrayHeldMoves(actor)).toEqual([]);
		actor.flags[SCOPE].postDeathLore.counts[KEY] = 0;
		expect(await dropStrayHeldMoves(actor)).toHaveLength(1);
		expect(ravenousMawOut(actor)).toBe(false);
	});
});

describe("TH-5: the Impulse", () => {
	it("flags two Impulses ticked together, never blocking", async () => {
		const { char } = makeThrall({ counts: { "impulse:stoke-conflict": 1, "impulse:erode-hope": 1 } });
		const view = await tabView(char, { editMode: true });
		const options = view.lore.entries.find(e => e.slug === "impulse").options;
		expect(options.find(o => o.slug === "stoke-conflict").caution).toContain("The GM chooses 1 Impulse");
		expect(options.find(o => o.slug === "hide-smother").caution).toBeUndefined();
	});

	it("prints Ravenous's extra Impulse beside the GM's, in play, while it is held", async () => {
		const ravenous = await tabView(makeThrall({ counts: { "impulse:stoke-conflict": 1, "marks:ravenous": 1 } }).char);
		const impulse = ravenous.lore.entries.find(e => e.slug === "impulse");
		expect(impulse.options.filter(o => o.count > 0).map(o => o.slug)).toEqual(["stoke-conflict", "ravenous-impulse"]);
		expect(impulse.options.at(-1).description).toContain("Wantonly devour flesh");

		const plain = await tabView(makeThrall({ counts: { "impulse:stoke-conflict": 1 } }).char);
		expect(plain.lore.entries.find(e => e.slug === "impulse").options.map(o => o.slug)).not.toContain("ravenous-impulse");
	});

	it("never counts Ravenous's extra Impulse as the GM's pick", async () => {
		const unpicked = await tabView(makeThrall({ counts: { "marks:ravenous": 1 } }).char);
		const impulse = unpicked.lore.entries.find(e => e.slug === "impulse");
		expect(impulse.options.at(-1).slug).toBe("ravenous-impulse");
		expect(impulse.selectedCount).toBe(0);
		expect(impulse.isAnswered).toBe(false);

		const picked = await tabView(makeThrall({ counts: { "impulse:stoke-conflict": 1, "marks:ravenous": 1 } }).char);
		expect(picked.lore.entries.find(e => e.slug === "impulse").selectedCount).toBe(1);
	});
});

describe("RV-4: a lore follower no longer held", () => {
	const VERMIN = "consequences:home-to-vermin";
	const card = { x: { name: "Vermin", sourceUuid: LORE_FOLLOWERS[VERMIN].sourceUuid } };

	it("asks once whether the vermin card goes, defaulting to dismiss, when the Consequence is unmarked", async () => {
		const { actor } = makeThrall({ slug: "revenant", counts: { [VERMIN]: 0 }, insert: { offered: [VERMIN] } });
		actor.flags[SCOPE].customFollowers = { ...card };
		const confirm = vi.fn(async () => true);
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
		const ask = confirm.mock.calls[0][0];
		expect(ask.defaultYes).toBe(true);
		expect(ask.yes.label).toBe("Dismiss the vermin");
		expect(ask.content).toContain("Vess");
		expect(followers(actor)).toEqual([]);
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	it("asks on the swap to Ghost too, and keeps the card on a no", async () => {
		const { actor } = makeThrall({ slug: "ghost", insert: { offered: [VERMIN] } });
		actor.flags[SCOPE].customFollowers = { ...card };
		const confirm = vi.fn(async () => false);
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(followers(actor)).toHaveLength(1);
		expect(actor.flags[SCOPE].postDeathInsert.offered).toEqual([]);
	});

	it("asks nothing of a card never offered for the option", async () => {
		const { actor } = makeThrall({ slug: "revenant" });
		actor.flags[SCOPE].customFollowers = { ...card };
		const confirm = vi.fn(async () => true);
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).not.toHaveBeenCalled();
		expect(followers(actor)).toHaveLength(1);
	});

	it("asks about the tentacle once Child of the Deeps is gone", async () => {
		const KEY = "marks:child-of-the-deeps";
		const { actor, char } = makeThrall({ counts: { [KEY]: 1, "favor:favor-track": 1 } });
		await callTentacle(char);
		actor.flags[SCOPE].postDeathLore.counts[KEY] = 0;
		const confirm = vi.fn(async () => true);
		await offerLoreFollowers(actor, { confirm });
		expect(confirm.mock.calls[0][0].yes.label).toBe("Dismiss the tentacle");
		expect(followers(actor)).toEqual([]);
	});
});

describe("RV-7: lore followers feed themselves", () => {
	it("counts the vermin group, and the tentacle, as no mouths", () => {
		const flags = { customFollowers: {
			bugs:  { isGroup: true, size: 4, sourceUuid: "post-death:home-to-vermin" },
			grip:  { sourceUuid: "post-death:child-of-the-deeps" },
			guide: { name: "Guide" },
		} };
		expect(followerFeedsItself(flags, { ftype: "custom", slug: "bugs" })).toBe(true);
		expect(followerMouths(flags, { ftype: "custom", slug: "bugs" })).toBe(0);
		expect(followerMouths(flags, { ftype: "custom", slug: "grip" })).toBe(0);
		expect(followerMouths(flags, { ftype: "custom", slug: "guide" })).toBe(1);
	});
});
