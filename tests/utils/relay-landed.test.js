import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_ANSWER, RELAY_GRACE_MS, relayLanded, relayOutcome } from "../../module/utils/relay-landed.js";
import { fakeHooks } from "../fakes/hooks.js";

describe("relayOutcome", () => {
	it("keeps an answer that came back", async () => {
		const landed = vi.fn(() => false);
		await expect(relayOutcome({ id: "m1" }, { applied: true }, landed)).resolves.toEqual({ applied: true });
		expect(landed).not.toHaveBeenCalled();
	});

	it("reads a refusal against the card once more, since the write may have landed before the answer failed", async () => {
		await expect(relayOutcome({ id: "m1" }, false, () => true)).resolves.toBe(true);
		await expect(relayOutcome({ id: "m1" }, null, () => false)).resolves.toBeNull();
		await expect(relayOutcome({ id: "m1" }, false, () => { throw new Error("gone"); })).resolves.toBe(false);
	});

	it("watches the card when no answer came (relayLanded)", async () => {
		const hooks = fakeHooks();
		await expect(relayOutcome({ id: "m1" }, NO_ANSWER, () => true, { hooks })).resolves.toBe(true);
		// A card this client cannot read: false at once.
		await expect(relayOutcome(null, NO_ANSWER, () => true, { hooks })).resolves.toBe(false);
	});
});

describe("relayLanded", () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it("answers true at once when the write is already on the card", async () => {
		const hooks = fakeHooks();
		await expect(relayLanded({ id: "m1" }, () => true, { hooks })).resolves.toBe(true);
		expect(hooks.on).not.toHaveBeenCalled();
	});

	it("answers true as soon as an update to that card shows the write, and stops watching", async () => {
		const hooks = fakeHooks();
		const card = { id: "m1", landed: false };
		const out = relayLanded(card, () => card.landed, { hooks });
		hooks.fire("updateChatMessage", { id: "other" });
		card.landed = true;
		hooks.fire("updateChatMessage", { id: "m2" });
		hooks.fire("updateChatMessage", card);
		await expect(out).resolves.toBe(true);
		expect(hooks.handlers.size).toBe(0);
	});

	it("reads the card once more at the end of the wait", async () => {
		const hooks = fakeHooks();
		const card = { id: "m1", landed: false };
		const out = relayLanded(card, () => card.landed, { hooks });
		card.landed = true;
		await vi.advanceTimersByTimeAsync(RELAY_GRACE_MS);
		await expect(out).resolves.toBe(true);
	});

	it("answers false when nothing lands in the wait, and stops watching", async () => {
		const hooks = fakeHooks();
		const out = relayLanded({ id: "m1" }, () => false, { hooks });
		await vi.advanceTimersByTimeAsync(RELAY_GRACE_MS - 1);
		expect(hooks.handlers.size).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await expect(out).resolves.toBe(false);
		expect(hooks.handlers.size).toBe(0);
	});

	it("answers false at once for a card this client cannot read, or with no wait", async () => {
		await expect(relayLanded(null, () => true)).resolves.toBe(false);
		await expect(relayLanded({ id: "m1" }, () => false, { grace: 0, hooks: fakeHooks() })).resolves.toBe(false);
	});

	it("reads a check that throws as not landed", async () => {
		const out = relayLanded({ id: "m1" }, () => { throw new Error("no card"); }, { hooks: fakeHooks() });
		await vi.advanceTimersByTimeAsync(RELAY_GRACE_MS);
		await expect(out).resolves.toBe(false);
	});
});
