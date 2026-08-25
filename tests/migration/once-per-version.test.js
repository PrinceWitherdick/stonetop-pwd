import { describe, it, expect, vi, beforeEach } from "vitest";
import { oncePerVersion, sweepVersion, sweptThisVersion, forgetSweep } from "../../module/migration/once-per-version.js";

// The gate that stops a one-time repair being a full-world scan on every load.
//
// A couple of these arrive with every release — give the slugless a slug, bring old pins up to the
// current design, fill in a write-up the packs gained — and each was written ungated on the
// argument that it is idempotent. Idempotent buys the second run being SAFE; it does not buy the
// scan, which a stocked world was paying on every load forever to find nothing.
//
// Keyed by version rather than latched to a boolean, because two different jobs wear one shape: a
// true one-shot repair never runs again either way, while a bring-up-to-date pass has to run again
// the next time the design moves.

const SETTING = "repairSweepVersions";

let stored;

beforeEach(() => {
	stored = {};
	globalThis.game = {
		system: { version: "1.5.3" },
		settings: {
			get: (_ns, key) => (key === SETTING ? stored : undefined),
			set: (_ns, key, value) => { if (key === SETTING) stored = value; return Promise.resolve(value); },
		},
	};
});

describe("oncePerVersion", () => {
	it("runs the sweep the first time, and records the version it ran under", async () => {
		const work = vi.fn(async () => {});

		expect(await oncePerVersion("arcanumSlugs", work)).toBe(true);

		expect(work).toHaveBeenCalledTimes(1);
		expect(sweepVersion("arcanumSlugs")).toBe("1.5.3");
	});

	it("does not run it again under the same version", async () => {
		const work = vi.fn(async () => {});
		await oncePerVersion("arcanumSlugs", work);

		expect(await oncePerVersion("arcanumSlugs", work)).toBe(false);

		expect(work).toHaveBeenCalledTimes(1);
	});

	// The refits are not one-shot repairs; they are "bring these up to the CURRENT design", so an
	// upgrade that changes the design has to reach the pins already down.
	it("runs it again after an upgrade, which is what a refit needs", async () => {
		const work = vi.fn(async () => {});
		await oncePerVersion("gmPrepPins", work);

		globalThis.game.system.version = "1.6.0";

		expect(await oncePerVersion("gmPrepPins", work)).toBe(true);
		expect(work).toHaveBeenCalledTimes(2);
		expect(sweepVersion("gmPrepPins")).toBe("1.6.0");
	});

	// Each sweep answers for itself: one finishing must not tell the others they have run.
	it("keeps one sweep's stamp out of another's", async () => {
		await oncePerVersion("arcanumSlugs", async () => {});

		expect(sweptThisVersion("arcanumSlugs")).toBe(true);
		expect(sweptThisVersion("gmPrepPins")).toBe(false);
		expect(stored).toEqual({ arcanumSlugs: "1.5.3" });
	});

	// The same bargain reapplyBook2ArtOnVersionChange strikes: a sweep that throws is retried on
	// the next load rather than being written off as done.
	it("leaves the version unstamped when the sweep throws, so it retries", async () => {
		const boom = vi.fn(async () => { throw new Error("locked"); });

		await expect(oncePerVersion("treasureWriteups", boom)).rejects.toThrow("locked");

		expect(sweepVersion("treasureWriteups")).toBe("");
		expect(sweptThisVersion("treasureWriteups")).toBe(false);
	});

	// A caller must never silently do nothing because the gate could not read its own bookkeeping.
	it("runs the sweep when there is no version to stamp against", async () => {
		globalThis.game.system.version = "";
		const work = vi.fn(async () => {});

		expect(await oncePerVersion("arcanumSlugs", work)).toBe(true);
		expect(await oncePerVersion("arcanumSlugs", work)).toBe(true);
		expect(work).toHaveBeenCalledTimes(2);
	});

	// A world whose stored value is missing, scalar or an array reads as "never swept" rather than
	// throwing — getObjectSetting's tolerance, relied on here.
	it("treats junk bookkeeping as never having run", async () => {
		for (const junk of [undefined, null, "1.5.3", ["1.5.3"], 7]) {
			stored = junk;
			expect(sweepVersion("arcanumSlugs"), String(junk)).toBe("");
			expect(sweptThisVersion("arcanumSlugs"), String(junk)).toBe(false);
		}
	});

	it("forgets one stamp on request, for the dev loop", async () => {
		await oncePerVersion("arcanumSlugs", async () => {});
		await oncePerVersion("gmPrepPins", async () => {});

		await forgetSweep("arcanumSlugs");

		expect(sweptThisVersion("arcanumSlugs")).toBe(false);
		expect(sweptThisVersion("gmPrepPins")).toBe(true);
	});
});
