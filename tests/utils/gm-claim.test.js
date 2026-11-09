import { describe, expect, it, vi } from "vitest";
import { defineGmClaim } from "../../module/utils/gm-claim.js";

// One kind of claim decided on the GM's client (gm-claim.js): the first asker for a key wins, in turn,
// with the GM's own press in the same line; nobody to decide answers null, so the caller claims alone.

const player = id => ({ id, isGM: false });
const gmUser = { id: "gm", isGM: true };

/** A claim on a slot in `table`: taken by the first asker, and only by an asker `may` allows. */
function slotClaim(table = new Map(), { may = () => true, grantDelay = 0 } = {}) {
	return defineGmClaim({
		query:   "test.slot",
		what:    "take the slot",
		subject: data => (data?.slot ? { id: data.slot } : null),
		key:     thing => thing.id,
		may,
		async grant(thing, data, asker) {
			// A write that takes a round trip, so a claim that did not wait its turn would read "free" too.
			const free = !table.has(thing.id);
			if (grantDelay) await new Promise(resolve => setTimeout(resolve, grantDelay));
			if (!free) return false;
			table.set(thing.id, asker.id);
			return true;
		},
		release(thing, data, asker) {
			if (table.get(thing.id) === asker.id) table.delete(thing.id);
		},
	});
}

/** The handler's deps on the GM's client: the asker taken as named, as v14's context names them. */
const gmSide = { me: gmUser, verify: async (data, context) => context.user ?? null };

/** A player's `game` and `ask`, wired straight to the GM's handler. */
function clientOf(claim, user) {
	return {
		game: { user, users: { activeGM: gmUser } },
		ask: vi.fn((gm, query, data) => claim.handle(data, { user }, gmSide)),
	};
}

describe("a claim the GM's client decides", () => {
	it("gives the first of two crossing asks the claim and refuses the second, in the order they arrived", async () => {
		const table = new Map();
		const claim = slotClaim(table, { grantDelay: 5 });
		const a = clientOf(claim, player("a"));
		const b = clientOf(claim, player("b"));
		const answers = await Promise.all([claim.ask({ slot: "s" }, a), claim.ask({ slot: "s" }, b)]);
		expect(answers).toEqual([true, false]);
		expect(table.get("s")).toBe("a");
		expect(a.ask).toHaveBeenCalledWith(gmUser, "test.slot", expect.objectContaining({ slot: "s", userId: "a", askId: expect.any(String) }), expect.objectContaining({ fallback: null }));
	});

	it("decides the GM's own press on its own client, in the same line as the asks", async () => {
		const table = new Map();
		const claim = slotClaim(table, { grantDelay: 5 });
		const b = clientOf(claim, player("b"));
		const own = { game: { user: gmUser, users: { activeGM: gmUser } }, ask: vi.fn() };
		const answers = await Promise.all([claim.ask({ slot: "s" }, own), claim.ask({ slot: "s" }, b)]);
		expect(answers).toEqual([true, false]);
		expect(own.ask).not.toHaveBeenCalled();
		expect(table.get("s")).toBe("gm");
	});

	it("refuses an asker who could not take it themselves, but not the GM's own press", async () => {
		const claim = slotClaim(new Map(), { may: () => false });
		expect(await claim.ask({ slot: "s" }, clientOf(claim, player("a")))).toBe(false);
		expect(await claim.ask({ slot: "t" }, { game: { user: gmUser, users: { activeGM: gmUser } } })).toBe(true);
	});

	it("gives a claim back, so the next asker may take it", async () => {
		const table = new Map();
		const claim = slotClaim(table);
		const a = clientOf(claim, player("a"));
		const b = clientOf(claim, player("b"));
		expect(await claim.ask({ slot: "s" }, a)).toBe(true);
		await claim.release({ slot: "s" }, b);
		expect(table.get("s")).toBe("a");
		await claim.release({ slot: "s" }, a);
		expect(await claim.ask({ slot: "s" }, b)).toBe(true);
	});

	it("answers null with no GM connected, or no answer from the GM's client, so the caller claims alone", async () => {
		const claim = slotClaim();
		const ask = vi.fn();
		expect(await claim.ask({ slot: "s" }, { game: { user: player("a"), users: {} }, ask })).toBeNull();
		expect(ask).not.toHaveBeenCalled();
		expect(await claim.ask({ slot: "s" }, { game: { user: player("a"), users: { activeGM: gmUser } }, ask: async () => null })).toBeNull();
	});

	it("on the GM's client answers null for an asker it cannot tell, a thing it cannot find, or a client that is not a GM's", async () => {
		const table = new Map();
		const claim = slotClaim(table);
		expect(await claim.handle({ slot: "s" }, {}, gmSide)).toBeNull();
		expect(await claim.handle({}, { user: player("a") }, gmSide)).toBeNull();
		expect(await claim.handle({ slot: "s" }, { user: player("a") }, { ...gmSide, me: player("c") })).toBeNull();
		expect(table.size).toBe(0);
	});

	it("writes nothing for a claim whose turn comes after its asker stopped waiting", async () => {
		const table = new Map();
		const claim = slotClaim(table);
		let t = 0;
		const now = () => t;
		const slowVerify = async (data, context) => { t += 60000; return context.user; };
		expect(await claim.handle({ slot: "s" }, { user: player("a") }, { ...gmSide, verify: slowVerify, now })).toBeNull();
		expect(table.size).toBe(0);
	});
});
