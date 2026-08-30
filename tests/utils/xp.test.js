import { describe, it, expect, vi } from "vitest";
import { xpToLevelUp, adjustXp, withXpLock } from "../../module/utils/xp.js";

// The one place a character's XP total changes.
//
// Every XP change is a delta applied to a total only the document holds, so each is a
// read-modify-write. Two of them overlapping means both read the same starting total and the
// second write lands on top of the first: one change is gone, with no error either side. Foundry
// has no atomic increment, so the fix is a queue per Actor with the read taken INSIDE it.
//
// Most of what follows is that property. A test that only checked "adding 1 gives 1" would pass
// against the four hand-rolled copies this replaced.

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A character whose XP write takes a turn of the event loop to land.
 *
 * The delay is the whole point: an update that applied synchronously leaves no window for a
 * second caller to read a stale total, and every test below would pass with no queue at all.
 */
function pc(xp = 0, level = 1, { uuid = "Actor.a1", delay = 1 } = {}) {
	const actor = {
		uuid,
		id: uuid.split(".").pop(),
		system: { attributes: { xp: { value: xp }, level: { value: level } } },
		update: vi.fn(async (data) => {
			await tick(delay);
			actor.system.attributes.xp.value = data["system.attributes.xp.value"];
		}),
	};
	return actor;
}

describe("xpToLevelUp", () => {
	it("is 6 + 2 x level", () => {
		expect([1, 2, 3, 10].map(xpToLevelUp)).toEqual([8, 10, 12, 26]);
	});
});

describe("adjustXp", () => {
	it("applies the delta and reports what landed", async () => {
		const actor = pc(3, 1);
		const result = await adjustXp(actor, 1);
		expect(result).toEqual({ applied: true, before: 3, after: 4, max: 8, level: 1 });
		expect(actor.system.attributes.xp.value).toBe(4);
	});

	it("attributes the change to the causing move for the ledger", async () => {
		const actor = pc(3);
		await adjustXp(actor, 1, { move: "Defy Danger" });
		expect(actor.update).toHaveBeenCalledWith(expect.anything(), { stonetopMove: "Defy Danger" });
	});

	it("passes no attribution when there is no move behind the change", async () => {
		const actor = pc(3);
		await adjustXp(actor, 1);
		expect(actor.update).toHaveBeenCalledWith(expect.anything(), {});
	});

	// THE ONE THIS EXISTS FOR. Both callers read before either writes; without the queue the
	// second write lands on the first and one mark is silently gone.
	it("does not lose a mark when two changes overlap", async () => {
		const actor = pc(0);
		await Promise.all([adjustXp(actor, 1), adjustXp(actor, 1)]);
		expect(actor.system.attributes.xp.value).toBe(2);
	});

	it("holds a whole burst of marks, in order", async () => {
		const actor = pc(0);
		const results = await Promise.all([1, 1, 1, 1, 1].map(d => adjustXp(actor, d)));
		expect(actor.system.attributes.xp.value).toBe(5);
		expect(results.map(r => r.after)).toEqual([1, 2, 3, 4, 5]);
	});

	it("spends against the total as it is at the moment of writing", async () => {
		// A miss and a Burn Brightly landing together: +1 then -2 from 13 must reach 12, never
		// 11 (the spend applied to the pre-mark total) and never 14 (the mark applied last).
		const actor = pc(13);
		await Promise.all([adjustXp(actor, 1), adjustXp(actor, -2)]);
		expect(actor.system.attributes.xp.value).toBe(12);
	});

	it("floors at zero, because nobody owes XP", async () => {
		const actor = pc(1);
		const result = await adjustXp(actor, -5);
		expect(result.after).toBe(0);
		expect(actor.system.attributes.xp.value).toBe(0);
	});

	// The level-up total is a threshold to cross, not a ceiling to sit under.
	it("does not cap at the level-up total", async () => {
		const actor = pc(8, 1);
		const result = await adjustXp(actor, 1);
		expect(result).toMatchObject({ after: 9, max: 8 });
	});

	it("writes nothing for a delta that changes nothing", async () => {
		const actor = pc(3);
		const result = await adjustXp(actor, 0);
		expect(result.applied).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("survives an actor it cannot write to", async () => {
		const result = await adjustXp({ uuid: "Actor.x", system: {} }, 1);
		expect(result).toEqual({ applied: false, before: 0, after: 0, max: 8, level: 1 });
	});
});

describe("adjustXp preconditions", () => {
	const affordable = (xp, level) => xp >= xpToLevelUp(level);

	it("lets a spend through when the character can afford it", async () => {
		const actor = pc(9, 1);
		const result = await adjustXp(actor, -2, { require: affordable });
		expect(result).toMatchObject({ applied: true, after: 7 });
	});

	// Burn Brightly's affordability was checked when the BUTTON was clicked, so a second spend
	// queued behind the first tested a total the first had not yet reduced: 9 XP bought two +1s
	// and left the character on 5, under the threshold that made either of them legal.
	it("re-checks at write time, so a queued second spend cannot go through on a stale total", async () => {
		const actor = pc(9, 1);
		const [first, second] = await Promise.all([
			adjustXp(actor, -2, { require: affordable }),
			adjustXp(actor, -2, { require: affordable }),
		]);
		expect(first.applied).toBe(true);
		expect(second.applied).toBe(false);
		expect(actor.system.attributes.xp.value).toBe(7);
	});

	it("reports a refusal rather than throwing, so the caller can say why", async () => {
		const actor = pc(3, 1);
		const result = await adjustXp(actor, -2, { require: affordable });
		expect(result).toEqual({ applied: false, before: 3, after: 3, max: 8, level: 1 });
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("withXpLock", () => {
	it("runs queued work one at a time", async () => {
		const actor = pc(0);
		const order = [];
		const step = (name) => withXpLock(actor, async () => {
			order.push(`${name}:start`);
			await tick(1);
			order.push(`${name}:end`);
		});
		await Promise.all([step("a"), step("b")]);
		expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
	});

	it("passes the work's own result back", async () => {
		await expect(withXpLock(pc(0), async () => "done")).resolves.toBe("done");
	});

	// A queue that inherited a rejection would strand every later caller on that character.
	it("does not let one caller's failure strand the next", async () => {
		const actor = pc(0);
		await expect(withXpLock(actor, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
		await adjustXp(actor, 1);
		expect(actor.system.attributes.xp.value).toBe(1);
	});

	it("recovers after a failed write and marks the next one against the real total", async () => {
		const actor = pc(4);
		actor.update.mockRejectedValueOnce(new Error("no connection"));
		await expect(adjustXp(actor, 1)).rejects.toThrow("no connection");
		const result = await adjustXp(actor, 1);
		expect(result).toMatchObject({ before: 4, after: 5 });
	});

	// Two characters are two queues. Serialising them together would make a party's End of
	// Session award take one round trip per player in sequence for no reason.
	it("does not make one character wait on another", async () => {
		const torwyn = pc(0, 1, { uuid: "Actor.a1", delay: 20 });
		const bryn   = pc(0, 1, { uuid: "Actor.a2", delay: 1 });
		const order  = [];
		await Promise.all([
			adjustXp(torwyn, 1).then(() => order.push("torwyn")),
			adjustXp(bryn, 1).then(() => order.push("bryn")),
		]);
		expect(order).toEqual(["bryn", "torwyn"]);
	});

	// An unlinked token's synthetic Actor reports the WORLD Actor's id while being a separate
	// document, so keying the queue by id would quietly put two documents on one chain.
	it("keys on UUID, so a token's copy and its character are separate queues", async () => {
		const world = pc(0, 1, { uuid: "Actor.a1", delay: 20 });
		const onToken = pc(0, 1, { uuid: "Scene.s1.Token.t1.Actor.a1", delay: 1 });
		const order = [];
		await Promise.all([
			adjustXp(world, 1).then(() => order.push("world")),
			adjustXp(onToken, 1).then(() => order.push("token")),
		]);
		expect(order).toEqual(["token", "world"]);
	});

	it("still runs work for an actor it cannot identify", async () => {
		await expect(withXpLock(undefined, async () => "ran")).resolves.toBe("ran");
	});
});
