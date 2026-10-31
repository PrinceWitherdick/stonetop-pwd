// A Consequence or Mark that rolls or holds something (Poltergeist, Bodysnatcher, Red Wrath, Torment's
// Blessing) is a move Item on the character exactly while it is marked (module/actors/character/
// post-death-moves.js), and Home to Vermin offers its follower once per marking. The user's ruling R-AUTO,
// 2026-09-27.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { planLoreMoveSync, loreMoveItemData, postDeathMoveItemData, offerLoreFollowers, mayMoveLoreMoves, LORE_FOLLOWERS, planMissingInsertMoves, repairInsertMoves, repairsInsertMovesHere } from "../../../module/actors/character/post-death-moves.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";
import { makeLiveActor } from "../../fakes/LiveCharacter.js";
import { FakeRepositoryFactory } from "../../fakes/FakeRepositoryFactory.js";
import { FakeMoveRepository } from "../../fakes/FakeMoveRepository.js";
import { FakePostDeathInsertRepository } from "../../fakes/FakePostDeathInsertRepository.js";
import { StonetopCharacter } from "../../../module/actors/character/StonetopCharacter.js";

const SCOPE = "stonetop-pwd";
const SRC = path.resolve("packs/src/stonetop-items");
const readJson = rel => JSON.parse(fs.readFileSync(path.join(SRC, rel), "utf8"));
const movesOf = slug => fs.readdirSync(path.join(SRC, "post-death-moves", slug))
	.filter(f => f.endsWith(".json")).map(f => readJson(`post-death-moves/${slug}/${f}`));

// The SHIPPED moves and inserts: what the sheet grants is decided by these files, not a retyping of them.
const SHIPPED = Object.fromEntries(["ghost", "revenant", "thrall"].map(slug => [slug, movesOf(slug)]));
const INSERTS = Object.fromEntries(["ghost", "revenant", "thrall"].map(slug => [slug, readJson(`post-death-inserts/${slug}.json`)]));

describe("the shipped Consequence and Mark moves", () => {
	it("are the four that roll or hold, each naming an option its own insert prints", () => {
		const lore = Object.entries(SHIPPED).flatMap(([slug, moves]) =>
			moves.filter(m => m.system.loreOption).map(m => [slug, m.name, m.system.loreOption]));
		expect(lore).toEqual(expect.arrayContaining([
			["ghost", "Bodysnatcher", "consequences:bodysnatcher"],
			["ghost", "Poltergeist", "consequences:poltergeist"],
			["thrall", "Red Wrath", "marks:red-wrath"],
			["thrall", "Torment's Blessing", "marks:torments-blessing"],
		]));
		expect(lore).toHaveLength(4);
		for (const [slug, , key] of lore) {
			const [section, option] = key.split(":");
			const entry = INSERTS[slug].flags.stonetop.lore.find(e => e.slug === section);
			expect(entry?.options.map(o => o.slug)).toContain(option);
		}
	});

	it("keeps the rules they automate: Poltergeist holds four Fury, Bodysnatcher rolls +CHA", () => {
		const poltergeist = SHIPPED.ghost.find(m => m.name === "Poltergeist");
		expect(poltergeist.system.resource).toMatchObject({ max: 4, title: "Fury" });
		expect(poltergeist.system.description).toContain("lose 1d4 HP and hold that much Fury");
		expect(SHIPPED.ghost.find(m => m.name === "Bodysnatcher").system.rollType).toBe("cha");
		// The +Favor rolls roll nothing of their own: the move card's button asks how much Favor first.
		for (const name of ["Red Wrath", "Torment's Blessing"]) {
			const move = SHIPPED.thrall.find(m => m.name === name);
			expect(move.system.rollType).toBeNull();
			expect(move.system.description).toContain("roll +Favor spent");
		}
	});
});

const def = raw => new MoveDefinition(raw);
const poltergeist = def(SHIPPED.ghost.find(m => m.name === "Poltergeist"));
const bodysnatcher = def(SHIPPED.ghost.find(m => m.name === "Bodysnatcher"));
const unliving = def(SHIPPED.ghost.find(m => m.name === "Unliving"));

describe("planLoreMoveSync", () => {
	const marked = (...keys) => key => keys.includes(key);

	it("creates the move of a marked option, with its track and its lore option", () => {
		const { create, remove } = planLoreMoveSync({
			entries: [unliving, poltergeist, bodysnatcher], owned: [], isMarked: marked("consequences:poltergeist"),
		});
		expect(remove).toEqual([]);
		expect(create).toEqual([expect.objectContaining({ name: "Poltergeist", type: "move" })]);
		expect(create[0].system).toMatchObject({
			moveType: "post-death", loreOption: "consequences:poltergeist",
			resource: { max: 4, title: "Fury" },
		});
		expect(create[0].system.resource.spendOptions).toHaveLength(3);
	});

	it("removes the move of an option no longer marked, and never the insert's own", () => {
		const owned = [
			{ _id: "u", system: { moveType: "post-death" } },
			{ _id: "p", system: { moveType: "post-death", loreOption: "consequences:poltergeist" } },
		];
		expect(planLoreMoveSync({ entries: [unliving, poltergeist], owned, isMarked: marked() }))
			.toEqual({ create: [], remove: ["p"] });
	});

	it("leaves a marked option's move alone, and drops a second copy of it", () => {
		const owned = [
			{ _id: "p1", system: { loreOption: "consequences:poltergeist" } },
			{ _id: "p2", system: { loreOption: "consequences:poltergeist" } },
		];
		expect(planLoreMoveSync({ entries: [poltergeist], owned, isMarked: marked("consequences:poltergeist") }))
			.toEqual({ create: [], remove: ["p2"] });
	});

	it("carries a rolling move's outcomes onto the Item", () => {
		expect(loreMoveItemData(bodysnatcher).system).toMatchObject({
			rollType: "cha", moveResults: { success: { value: "They do it anyway." } },
		});
	});

	// An insert's own move was made from its text alone, so Undying's roll card posted no outcomes.
	it("makes an insert's own move whole too, with no lore option", () => {
		const undying = def(SHIPPED.revenant.find(m => m.name === "Undying"));
		const { system } = postDeathMoveItemData(undying);
		expect(system.moveType).toBe("post-death");
		expect(system.moveResults?.partial?.value).toMatch(/half your max HP/);
		expect(system).not.toHaveProperty("loreOption");
	});
});

// A live character: the actor applies its writes and grows its items, so a mark and a sync are what
// Foundry would see.
function ghost({ counts = {}, slug = "ghost", items = [] } = {}) {
	const actor = makeLiveActor({ slug: "the-heavy", name: "The Heavy", items,
		flags: { "postDeathInsert.slug": slug, "postDeathLore.counts": counts } });
	const moves = new FakeMoveRepository([], [], [...SHIPPED.ghost]);
	const inserts = new FakePostDeathInsertRepository([INSERTS.ghost, INSERTS.revenant, INSERTS.thrall]);
	const char = new StonetopCharacter(actor, new FakeRepositoryFactory({ moves, postDeathInsert: inserts }));
	return { actor, char };
}
const names = actor => actor.items.map(i => i.name).sort();

describe("StonetopCharacter#syncPostDeathLoreMoves", () => {
	it("grants Poltergeist when it is marked, and takes it away when it is not", async () => {
		const { actor, char } = ghost();
		await char.markSectionOption("consequences", "poltergeist");
		await char.syncPostDeathLoreMoves();
		expect(names(actor)).toEqual(["Poltergeist"]);
		expect(actor.items[0].system.loreOption).toBe("consequences:poltergeist");

		// Again: nothing more to do.
		expect(await char.syncPostDeathLoreMoves()).toEqual({ created: 0, removed: 0 });

		await char.unmarkSectionOption("consequences", "poltergeist");
		await char.syncPostDeathLoreMoves();
		expect(names(actor)).toEqual([]);
	});

	it("takes an insert with its own moves only, then the marked Consequences' moves on top", async () => {
		const { actor, char } = ghost({ slug: null, counts: { "consequences:bodysnatcher": 1 } });
		await char.setPostDeathInsert("ghost");
		// The insert's three, and Bodysnatcher (marked, carried through the swap), but no Poltergeist.
		expect(names(actor)).toEqual(["Bodysnatcher", "Disembodied", "Tethered", "Unliving"]);
	});

	it("draws Poltergeist on the Post-Death group with its Fury track, the held pips ticked", async () => {
		const { char } = ghost({ counts: { "consequences:poltergeist": 1 } });
		await char.syncPostDeathLoreMoves();
		await char.moveResources.setUses("Poltergeist", 3);
		const { movelist } = await char.buildSnapshot();
		const card = movelist.postDeathGroup.moves.find(m => m.name === "Poltergeist");
		expect(card.resource).toMatchObject({ current: 3, max: 4, title: "Fury" });
		expect(card.resource.spendTooltip).toContain("Hurl an object at someone and roll +DEX");
	});

	it("queues a sync behind an insert swap, so the two never decide from half a list", async () => {
		const { actor, char } = ghost({ slug: null, counts: { "consequences:poltergeist": 1 } });
		await Promise.all([char.setPostDeathInsert("ghost"), char.syncPostDeathLoreMoves()]);
		expect(names(actor).filter(n => n === "Poltergeist")).toHaveLength(1);
	});
});

describe("which updates re-sync", () => {
	it("is a write to the insert's lore or its slug, and nothing else", () => {
		expect(mayMoveLoreMoves({ flags: { [SCOPE]: { postDeathLore: { counts: { "consequences:poltergeist": 1 } } } } })).toBe(true);
		expect(mayMoveLoreMoves({ flags: { [SCOPE]: { postDeathInsert: { slug: "ghost" } } } })).toBe(true);
		expect(mayMoveLoreMoves({ flags: { [SCOPE]: { readiness: 1 } } })).toBe(false);
		expect(mayMoveLoreMoves({ system: { attributes: { hp: { value: 3 } } } })).toBe(false);
	});
});

// Home to Vermin: "Treat them as followers: group, tiny, gross, meek, stealthy; HP 1 each; Instinct to
// get distracted; Cost: genuine affection."
describe("offerLoreFollowers", () => {
	const VERMIN = "consequences:home-to-vermin";
	function revenant(counts = { [VERMIN]: 1 }, extra = {}) {
		const actor = makeLiveActor({ slug: "the-heavy", name: "Anwen",
			flags: { "postDeathInsert.slug": "revenant", "postDeathLore.counts": counts, ...extra } });
		actor.isOwner = true;
		return actor;
	}
	const followers = actor => Object.values(actor.flags[SCOPE].customFollowers ?? {});

	it("offers the vermin as a group follower, named for what they are, and adds them on a yes", async () => {
		const actor = revenant();
		const confirm = vi.fn(async () => true);
		expect(await offerLoreFollowers(actor, { confirm })).toEqual([VERMIN]);
		const ask = confirm.mock.calls[0][0];
		expect(ask.yes.label).toBe("Add the vermin to Followers");
		expect(ask.content).toContain("Anwen");
		const [vermin] = followers(actor);
		expect(vermin).toMatchObject({
			name: "Vermin", isGroup: true, tags: ["tiny", "gross", "meek", "stealthy"],
			hpMax: 1, instinct: "to get distracted", cost: "genuine affection",
			sourceUuid: LORE_FOLLOWERS[VERMIN].sourceUuid,
		});
	});

	it("asks once per marking: a no is kept, and so is a card already made", async () => {
		const actor = revenant();
		const confirm = vi.fn(async () => false);
		await offerLoreFollowers(actor, { confirm });
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(followers(actor)).toEqual([]);

		const kept = revenant({ [VERMIN]: 1 }, { customFollowers: { x: { name: "Bugs", sourceUuid: LORE_FOLLOWERS[VERMIN].sourceUuid } } });
		const never = vi.fn(async () => true);
		await offerLoreFollowers(kept, { confirm: never });
		expect(never).not.toHaveBeenCalled();
	});

	it("asks afresh once the Consequence has been cleared and marked again", async () => {
		const actor = revenant();
		const confirm = vi.fn(async () => false);
		await offerLoreFollowers(actor, { confirm });
		actor.flags[SCOPE].postDeathLore.counts[VERMIN] = 0;
		await offerLoreFollowers(actor, { confirm });
		expect(actor.flags[SCOPE].postDeathInsert.offered).toEqual([]);
		actor.flags[SCOPE].postDeathLore.counts[VERMIN] = 1;
		await offerLoreFollowers(actor, { confirm });
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("asks nothing of a character without the Consequence, or without an insert", async () => {
		const confirm = vi.fn(async () => true);
		await offerLoreFollowers(revenant({}), { confirm });
		await offerLoreFollowers(revenant({ [VERMIN]: 1 }, { "postDeathInsert.slug": null }), { confirm });
		expect(confirm).not.toHaveBeenCalled();
	});
});

// Audit RV-6 (2026-10-26): a swap a reload cut short after the slug moved left the insert's own moves
// unmade, and retaking the same insert is a no-op. The primary GM's load-time pass makes them.
describe("planMissingInsertMoves and the load-time repair", () => {
	const def = (name, loreOption = null) => new MoveDefinition({ name, type: "move", system: { moveType: "post-death", ...(loreOption ? { loreOption } : {}) } });

	it("names the worn insert's own moves held by no copy, never a lore option's", () => {
		const entries = [def("Unliving"), def("Undying"), def("Implacable"), def("Poltergeist", "consequences:poltergeist")];
		const owned = [{ name: "Undying", system: { moveType: "post-death" } }, { name: "Implacable", system: { moveType: "post-death", loreOption: "x" } }];
		expect(planMissingInsertMoves({ entries, owned }).map(m => m.name)).toEqual(["Unliving", "Implacable"]);
	});

	it("asks the character to make them, and a fault in one sheet is swallowed", async () => {
		const syncPostDeathInsertMoves = vi.fn(async () => 2);
		expect(await repairInsertMoves({ name: "Wyn", typedActor: { syncPostDeathInsertMoves } })).toBe(2);
		const broken = { name: "Bram", typedActor: { syncPostDeathInsertMoves: vi.fn(async () => { throw new Error("pack"); }) } };
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await repairInsertMoves(broken)).toBe(0);
		err.mockRestore();
	});
});

// Review 10-28: a swap still under way on its player's client must not be repaired beside itself by the GM's load.
describe("repairsInsertMovesHere: who finishes a swap a reload cut short", () => {
	const active = new Set(["player-1"]);
	it("leaves a swap to the player who started it while they are connected", () => {
		expect(repairsInsertMovesHere("player-1", { userId: "gm", primaryGM: true, activeUserIds: active })).toBe(false);
		expect(repairsInsertMovesHere("player-1", { userId: "player-1", primaryGM: false, activeUserIds: new Set(["gm"]) })).toBe(true);
	});

	it("hands it to the primary GM once they are gone, or for a marker naming nobody", () => {
		expect(repairsInsertMovesHere("player-1", { userId: "gm", primaryGM: true, activeUserIds: new Set() })).toBe(true);
		expect(repairsInsertMovesHere(true, { userId: "gm", primaryGM: true, activeUserIds: active })).toBe(true);
		expect(repairsInsertMovesHere(true, { userId: "player-2", primaryGM: false, activeUserIds: active })).toBe(false);
	});

	it("repairs nothing without a marker", () => {
		expect(repairsInsertMovesHere(undefined, { userId: "gm", primaryGM: true })).toBe(false);
		expect(repairsInsertMovesHere(null, { userId: "gm", primaryGM: true })).toBe(false);
	});
});
