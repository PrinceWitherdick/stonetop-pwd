import { describe, expect, it, vi } from "vitest";
import { claimPickedOption, releasePickedOption, settlePickedOption } from "../../module/utils/picked-option-button.js";

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

describe("claiming a card's payout", () => {
	it("claims an option nobody has, and refuses it a second time", async () => {
		const msg = message();
		expect(await claimPickedOption(msg, "provisionsRolled", "1")).toBe(true);
		expect(msg.store.provisionsRolled["1"]).toEqual({ pending: true });
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
		expect(msg.store.provisionsRolled["0"]).toEqual({ uses: 5, formula: "1d6", pending: false });
	});

	it("gives a claim back, so an option nothing was paid for can be pressed again", async () => {
		const msg = message({ flags: { provisionsRolled: { "2": { uses: 3 } } } });
		await claimPickedOption(msg, "provisionsRolled", "0");
		await releasePickedOption(msg, "provisionsRolled", "0");
		expect(msg.store.provisionsRolled).toEqual({ "2": { uses: 3 } });
		expect(await claimPickedOption(msg, "provisionsRolled", "0")).toBe(true);
	});
});
