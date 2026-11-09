import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPickedOption, pickedOptionRecord, registerPickedOptionClaimQuery, releasePickedOption, settlePickedOption } from "../../module/utils/picked-option-button.js";

/**
 * A Forage payout's latch: CLAIM, PAY, SETTLE (picked-option-button.js). It used to be stamped after
 * the payout, so a player who owns the character but not the card (the GM rolled it) was paid, could
 * not stamp, and was offered the same button again on the next render.
 */

const SCOPE = "stonetop-pwd";

/** A chat message whose flags merge like Foundry's, and which only `writable` may write. */
function message({ writable = true, flags = {} } = {}) {
	const store = structuredClone(flags);
	const merge = (target, value) => {
		for (const [k, v] of Object.entries(value)) {
			if (v && typeof v === "object" && target[k] && typeof target[k] === "object") merge(target[k], v);
			else target[k] = v;
		}
	};
	return {
		getFlag: (scope, key) => store[key],
		setFlag: vi.fn(async (scope, key, value) => {
			if (!writable) throw new Error("User lacks permission to update ChatMessage");
			store[key] ??= {};
			merge(store[key], value);
		}),
		update: vi.fn(async data => {
			for (const path of Object.keys(data)) {
				const parts = path.replace(`flags.${SCOPE}.`, "").split(".");
				const leaf = parts.pop().replace(/^-=/, "");
				delete parts.reduce((node, k) => node?.[k], store)?.[leaf];
			}
		}),
		store,
	};
}

describe("two clients claiming at once with no GM to decide (audit ROAD-15)", () => {
	it("pays only the claim that stands once a crossing claim has landed", async () => {
		const msg = message();
		const realSet = msg.setFlag;
		// Another user's claim arrives just after this one's own write: theirs is the last, so it stands.
		msg.setFlag = vi.fn(async (...args) => {
			await realSet(...args);
			setTimeout(() => { msg.store.provisionsRolled["2"] = { pending: true, by: "other-user" }; }, 5);
		});
		expect(await claimPickedOption(msg, "provisionsRolled", "2", { settleMs: 20 })).toBe(false);
		// And the other user's client, reading its own claim, may now pay; this one is offered nothing.
		expect(pickedOptionRecord(msg, "provisionsRolled", "2")).toMatchObject({ by: "other-user" });
	});
});

describe("claiming a card's payout", () => {
	it("claims an option nobody has, and refuses it a second time", async () => {
		const msg = message();
		expect(await claimPickedOption(msg, "provisionsRolled", "1")).toBe(true);
		expect(msg.store.provisionsRolled["1"]).toEqual({ pending: true, by: "" });
		expect(await claimPickedOption(msg, "provisionsRolled", "1")).toBe(false);
	});

	it("refuses, having paid nothing, when this client may not write the card", async () => {
		const msg = message({ writable: false });
		expect(await claimPickedOption(msg, "provisionsRolled", "1")).toBe(false);
		expect(msg.store.provisionsRolled).toBeUndefined();
	});

	it("settles a claim into the paid record, with the claim marked done", async () => {
		const msg = message();
		await claimPickedOption(msg, "provisionsRolled", "0");
		await settlePickedOption(msg, "provisionsRolled", "0", { uses: 5, formula: "1d6" });
		expect(msg.store.provisionsRolled["0"]).toMatchObject({ uses: 5, formula: "1d6", pending: false });
	});

	it("lets this user claim past their own claim left by a reload, never another user's or one still held here", async () => {
		const saved = globalThis.game;
		globalThis.game = { user: { id: "me" } };
		try {
			// Left by a reload: claimed by this user, held by no client here.
			const reloaded = message({ flags: { provisionsRolled: { "0": { pending: true, by: "me" } } } });
			reloaded.id = "reloaded";
			expect(pickedOptionRecord(reloaded, "provisionsRolled", "0")).toBeNull();
			expect(await claimPickedOption(reloaded, "provisionsRolled", "0")).toBe(true);
			// Now held here: refused, and read as claimed.
			expect(pickedOptionRecord(reloaded, "provisionsRolled", "0")).toMatchObject({ pending: true });
			expect(await claimPickedOption(reloaded, "provisionsRolled", "0")).toBe(false);

			const theirs = message({ flags: { provisionsRolled: { "0": { pending: true, by: "someone" } } } });
			theirs.id = "theirs";
			expect(pickedOptionRecord(theirs, "provisionsRolled", "0")).toMatchObject({ pending: true });
			expect(await claimPickedOption(theirs, "provisionsRolled", "0")).toBe(false);
		} finally {
			globalThis.game = saved;
		}
	});

	it("keeps a claim whose payout landed but whose settle failed, so this client never offers it twice", async () => {
		const saved = globalThis.game;
		globalThis.game = { user: { id: "me" } };
		try {
			const msg = message();
			msg.id = "settle-fails";
			expect(await claimPickedOption(msg, "provisionsRolled", "0")).toBe(true);
			msg.setFlag.mockRejectedValueOnce(new Error("offline"));
			await expect(settlePickedOption(msg, "provisionsRolled", "0", { uses: 2 })).rejects.toThrow("offline");
			expect(pickedOptionRecord(msg, "provisionsRolled", "0")).toMatchObject({ pending: true });
		} finally {
			globalThis.game = saved;
		}
	});

	it("gives a claim back, so an option nothing was paid for can be pressed again", async () => {
		const msg = message({ flags: { provisionsRolled: { "2": { uses: 3 } } } });
		await claimPickedOption(msg, "provisionsRolled", "0");
		await releasePickedOption(msg, "provisionsRolled", "0");
		expect(msg.store.provisionsRolled).toEqual({ "2": { uses: 3 } });
		expect(await claimPickedOption(msg, "provisionsRolled", "0")).toBe(true);
	});
});

describe("with a GM connected, the GM's client decides the claim (gm-claim.js)", () => {
	const users = { a: { id: "a", isGM: false }, b: { id: "b", isGM: false }, gm: { id: "gm", isGM: true } };

	/**
	 * The card as the GM's client holds it, its query handler, and each player's own copy of the card
	 * (its own id, so this client's held claims stay apart), asking the GM's handler straight.
	 */
	function table({ mayWrite = () => true } = {}) {
		const gmCopy = Object.assign(message(), { id: "m1", uuid: "ChatMessage.m1", canUserModify: user => mayWrite(user) });
		const queries = {};
		registerPickedOptionClaimQuery(queries);
		const player = id => ({
			copy: Object.assign(message(), { id: `m1-${id}`, uuid: "ChatMessage.m1" }),
			deps: {
				settleMs: 0,
				game: { user: users[id], users: { activeGM: users.gm } },
				ask: (gm, query, data) => queries[query](data, { user: users[id] }),
			},
		});
		return { gmCopy, player };
	}

	let saved;
	beforeEach(() => {
		saved = { game: globalThis.game, fromUuidSync: globalThis.fromUuidSync };
	});
	afterEach(() => {
		globalThis.game = saved.game;
		globalThis.fromUuidSync = saved.fromUuidSync;
	});
	/** This process plays the GM's client while the players' asks are answered. */
	const asGM = gmCopy => {
		globalThis.game = { user: users.gm, users: { get: id => users[id], activeGM: users.gm } };
		globalThis.fromUuidSync = uuid => (uuid === gmCopy.uuid ? gmCopy : null);
	};

	it("pays only the first of two crossing claims, at once, with the claim written by the GM's client", async () => {
		const { gmCopy, player } = table();
		asGM(gmCopy);
		const a = player("a");
		const b = player("b");
		const answers = await Promise.all([
			claimPickedOption(a.copy, "provisionsRolled", "1", a.deps),
			claimPickedOption(b.copy, "provisionsRolled", "1", b.deps),
		]);
		expect(answers).toEqual([true, false]);
		expect(gmCopy.store.provisionsRolled["1"]).toEqual({ pending: true, by: "a" });
		// Neither player wrote a claim of their own, nor waited out a crossing one.
		expect(a.copy.setFlag).not.toHaveBeenCalled();
		expect(b.copy.setFlag).not.toHaveBeenCalled();
	});

	it("refuses, and writes nothing, for a player who could not write the card", async () => {
		const { gmCopy, player } = table({ mayWrite: user => user.id !== "b" });
		asGM(gmCopy);
		const b = player("b");
		expect(await claimPickedOption(b.copy, "provisionsRolled", "1", b.deps)).toBe(false);
		expect(gmCopy.store.provisionsRolled).toBeUndefined();
	});

	it("lets a player take back their own claim left by a reload, never another's", async () => {
		const { gmCopy, player } = table();
		gmCopy.store.provisionsRolled = { "0": { pending: true, by: "a" } };
		asGM(gmCopy);
		const b = player("b");
		expect(await claimPickedOption(b.copy, "provisionsRolled", "0", b.deps)).toBe(false);
		const a = player("a");
		expect(await claimPickedOption(a.copy, "provisionsRolled", "0", a.deps)).toBe(true);
	});

	it("claims the GM's own press on its own client, in line with the players' asks", async () => {
		const { gmCopy, player } = table();
		asGM(gmCopy);
		const a = player("a");
		const answers = await Promise.all([
			claimPickedOption(gmCopy, "provisionsRolled", "2", { settleMs: 0 }),
			claimPickedOption(a.copy, "provisionsRolled", "2", a.deps),
		]);
		expect(answers).toEqual([true, false]);
		expect(gmCopy.store.provisionsRolled["2"]).toEqual({ pending: true, by: "gm" });
	});

	it("claims on this client, as with no GM, when the GM's client does not answer", async () => {
		const { player } = table();
		const a = player("a");
		globalThis.game = { user: users.a };
		expect(await claimPickedOption(a.copy, "provisionsRolled", "3", { ...a.deps, ask: async () => null })).toBe(true);
		expect(a.copy.store.provisionsRolled["3"]).toEqual({ pending: true, by: "a" });
	});
});
