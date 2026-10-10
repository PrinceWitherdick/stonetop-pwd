import { afterEach, describe, expect, it, vi } from "vitest";
import { withCardLatch, withLateStampLatch } from "../../module/utils/card-latch.js";

// A card's once-only button is latched on the MESSAGE before its work, so a client that can do the
// work but cannot write the card never does it twice, and the latch is given back when the work is
// backed out of or fails.

const FLAG = "spent";

/** A chat message that keeps its flags, recording each write in order. */
function makeMessage({ failSet = false } = {}) {
	const flags = {};
	const writes = [];
	return {
		flags,
		writes,
		getFlag: (_scope, key) => flags[key],
		setFlag: vi.fn(async (_scope, key, value) => {
			if (failSet) throw new Error("cannot write the card");
			writes.push(["set", key, value]);
			flags[key] = value;
		}),
		unsetFlag: vi.fn(async (_scope, key) => {
			writes.push(["unset", key]);
			delete flags[key];
		}),
	};
}

const makeButtons = () => [{ disabled: false }, { disabled: false }];

afterEach(() => vi.restoreAllMocks());

describe("withCardLatch", () => {
	it("latches before the work and keeps the latch when it happens", async () => {
		const message = makeMessage();
		let latchedDuringWork;
		const ok = await withCardLatch(message, FLAG, true, makeButtons(), async () => {
			latchedDuringWork = message.flags[FLAG];
			return true;
		});
		expect(ok).toBe(true);
		expect(latchedDuringWork).toBe(true);
		expect(message.flags[FLAG]).toBe(true);
	});

	it("gives the card back when the work does not happen", async () => {
		const message = makeMessage();
		const buttons = makeButtons();
		expect(await withCardLatch(message, FLAG, true, buttons, async () => false)).toBe(false);
		expect(message.flags[FLAG]).toBeUndefined();
		expect(buttons.every(b => !b.disabled)).toBe(true);
	});
});

describe("withLateStampLatch", () => {
	it("latches with true FIRST, then writes the stamp the work answered", async () => {
		const message = makeMessage();
		let duringWork;
		const done = await withLateStampLatch(message, FLAG, makeButtons(), async () => {
			duringWork = message.flags[FLAG];
			return { stamp: { rolled: 3 }, notice: "Rolled 3." };
		});
		expect(duringWork).toBe(true);
		expect(message.writes).toEqual([["set", FLAG, true], ["set", FLAG, { rolled: 3 }]]);
		expect(done).toEqual({ stamp: { rolled: 3 }, notice: "Rolled 3." });
	});

	it("writes once when the stamp is the plain latch", async () => {
		const message = makeMessage();
		const done = await withLateStampLatch(message, FLAG, makeButtons(), async () => ({ notice: "Paid." }));
		expect(message.setFlag).toHaveBeenCalledTimes(1);
		expect(done).toEqual({ stamp: true, notice: "Paid." });
	});

	it("takes the latch off and gives the buttons back on an abort", async () => {
		const message = makeMessage();
		const buttons = makeButtons();
		const done = await withLateStampLatch(message, FLAG, buttons, async () => ({ abort: true }));
		expect(done).toBeNull();
		expect(message.flags[FLAG]).toBeUndefined();
		expect(buttons.every(b => !b.disabled)).toBe(true);
	});

	it("takes the latch off and rethrows when the work throws", async () => {
		const message = makeMessage();
		const buttons = makeButtons();
		await expect(withLateStampLatch(message, FLAG, buttons, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
		expect(message.flags[FLAG]).toBeUndefined();
		expect(buttons.every(b => !b.disabled)).toBe(true);
	});

	it("never runs the work when the card cannot be written", async () => {
		const message = makeMessage({ failSet: true });
		const work = vi.fn(async () => ({}));
		await expect(withLateStampLatch(message, FLAG, makeButtons(), work)).rejects.toThrow("cannot write the card");
		expect(work).not.toHaveBeenCalled();
	});

	it("keeps the provisional latch when only the final stamp fails to write", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const message = makeMessage();
		message.setFlag.mockImplementation(async (_scope, key, value) => {
			if (value !== true) throw new Error("second write failed");
			message.flags[key] = value;
		});
		const done = await withLateStampLatch(message, FLAG, makeButtons(), async () => ({ stamp: { gained: 2 } }));
		expect(done).toEqual({ stamp: { gained: 2 }, notice: undefined });
		expect(message.flags[FLAG]).toBe(true);
		expect(message.unsetFlag).not.toHaveBeenCalled();
	});
});
