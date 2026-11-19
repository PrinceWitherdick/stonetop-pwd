import { describe, it, expect, vi, afterEach } from "vitest";
import { bestEffort } from "../../module/utils/best-effort.js";

// The ready hook runs most of its steps through this, so a rejection in one of them is logged
// rather than ending the hook for whoever hit it.
describe("bestEffort", () => {
	afterEach(() => vi.restoreAllMocks());

	it("awaits the work", async () => {
		const order = [];
		await bestEffort("step", async () => { await null; order.push("ran"); });
		order.push("after");
		expect(order).toEqual(["ran", "after"]);
	});

	it("logs a rejection under its label instead of throwing it", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const err = new Error("no");
		await expect(bestEffort("chronicle repair", async () => { throw err; })).resolves.toBe(false);
		expect(spy).toHaveBeenCalledWith("Stonetop | chronicle repair failed", err);
	});

	it("catches a synchronous throw too", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(bestEffort("sync", () => { throw new Error("no"); })).resolves.toBe(false);
	});

	// So a caller can hold back a step that must not run after a half-done one.
	it("says whether the work went through", async () => {
		await expect(bestEffort("step", async () => {})).resolves.toBe(true);
	});
});
