import { describe, it, expect, vi } from "vitest";
import {
	BOOT_SENTINELS, bootStep, bootReport, bootHealthMessage, sentinelReport, reportBootHealth,
} from "../../module/utils/boot-guard.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Turning a silent partial boot into a message.
//
// Foundry catches a hook callback that throws, logs it, and carries on with the next listener. Our
// `init` is one long run of registrations, so a throw partway down leaves a world that opens and
// looks entirely normal while every setting after that point is unregistered. The reported case
// was an empty People gallery on a world holding a full art import: the settings the gallery reads
// did not exist, and nothing anywhere said so.

/** A stand-in for `game.settings.settings`, which is a Map keyed "<namespace>.<key>". */
const registryOf = (keys) => new Map(keys.map((k) => [`${SYSTEM_ID}.${k}`, {}]));

describe("sentinelReport", () => {
	it("reads a healthy world as ok", () => {
		const r = sentinelReport(BOOT_SENTINELS, registryOf(BOOT_SENTINELS));
		expect(r.ok).toBe(true);
		expect(r.missing).toEqual([]);
		expect(r.lastRegistered).toBe(BOOT_SENTINELS.at(-1));
	});

	it("names how far the registration got, which is the whole point", () => {
		// A run that stopped partway leaves a prefix registered and the rest missing. Naming the
		// deepest one that landed is the closest this can get to naming the failing line.
		const got = BOOT_SENTINELS.slice(0, 4);
		const r = sentinelReport(BOOT_SENTINELS, registryOf(got));
		expect(r.ok).toBe(false);
		expect(r.lastRegistered).toBe(got.at(-1));
		expect(r.missing).toEqual(BOOT_SENTINELS.slice(4));
	});

	it("reports nothing registered at all rather than guessing", () => {
		const r = sentinelReport(BOOT_SENTINELS, registryOf([]));
		expect(r.ok).toBe(false);
		expect(r.lastRegistered).toBeNull();
	});

	it("survives a world with no settings registry to ask", () => {
		// This runs on a boot that may have failed early, so it must not be the next thing to
		// throw. `game.settings.get` would: it raises for an unregistered setting, which is
		// precisely the case being reported on.
		for (const absent of [undefined, null, {}]) {
			expect(() => sentinelReport(BOOT_SENTINELS, absent)).not.toThrow();
			expect(sentinelReport(BOOT_SENTINELS, absent).ok).toBe(false);
		}
	});

	it("checks the art setting the reported failure was seen through", () => {
		// Not decoration: the GM report that prompted this read `book2ArtRoot` back as
		// unregistered, and that is the setting whose absence empties the People gallery.
		expect(BOOT_SENTINELS).toContain("book2ArtRoot");
		expect(BOOT_SENTINELS).toContain("peopleArt");
	});
});

describe("bootStep", () => {
	it("returns the step's value and records it when it succeeds", () => {
		expect(bootStep("worksFine", () => 42)).toBe(42);
		expect(bootReport().completed).toContain("worksFine");
	});

	it("RE-THROWS, so it changes what is known and never what happens", () => {
		// The guard must not become a swallow. Foundry's own handling of a throwing hook is what
		// skips the rest of init, and that behaviour is deliberately left exactly as it was.
		const boom = new Error("nope");
		expect(() => bootStep("explodes", () => { throw boom; })).toThrow(boom);
	});

	it("keeps the stack, which is the one thing a bug report cannot reconstruct", () => {
		expect(() => bootStep("alsoExplodes", () => { throw new Error("kaboom"); })).toThrow("kaboom");
		const failure = bootReport().failures.at(-1);
		expect(failure.phase).toBe("alsoExplodes");
		expect(failure.message).toBe("kaboom");
		expect(failure.stack).toMatch(/kaboom/);
	});

	it("does not record a failed step as completed", () => {
		expect(bootReport().completed).not.toContain("explodes");
	});
});

describe("bootHealthMessage", () => {
	const healthy = {
		settings: { ok: true, registered: BOOT_SENTINELS, missing: [], lastRegistered: "x" },
		failures: [], completed: ["init"],
	};

	it("says nothing at all about a healthy boot", () => {
		expect(bootHealthMessage(healthy)).toBeNull();
	});

	it("speaks up when `init` never reached its last line, however clean everything else looks", () => {
		// The gap the sentinels cannot see. A throw AFTER registerSettings() got through leaves every
		// checked setting registered and no wrapped step recorded as failing, so the only evidence
		// left anywhere is that `init` did not finish. Without this the worst kind of partial boot,
		// the one where the settings all read back fine, reports as perfectly healthy.
		const msg = bootHealthMessage({ ...healthy, completed: ["registerSettings"] });
		expect(msg).toContain("did not finish starting up");
		expect(msg).toContain("settings all registered");
		// And it must not send the GM hunting through settings that are fine.
		expect(msg).not.toMatch(/stopped registering/);
	});

	it("names the step that threw", () => {
		const msg = bootHealthMessage({ ...healthy, failures: [{ phase: "registerSettings", message: "boom" }] });
		expect(msg).toContain("registerSettings");
		expect(msg).toContain("boom");
	});

	it("reports missing settings even when nothing was caught throwing", () => {
		// The case this has to cover: `init` threw somewhere that is not one of the wrapped steps,
		// so there is no recorded failure, and the only evidence is what did not get registered.
		const msg = bootHealthMessage({
			settings: { ok: false, registered: ["a", "b"], missing: ["c"], lastRegistered: "b" },
			failures: [],
		});
		expect(msg).toContain("did not finish starting up");
		expect(msg).toContain('after "b"');
	});

	it("tells the GM what they will actually notice, not just what is broken", () => {
		// The symptom and the cause look nothing alike from the table: art on disk, no art on
		// screen. A message that only says "settings failed to register" leaves a GM re-importing
		// their books, which is exactly the loop this is meant to break.
		const msg = bootHealthMessage({
			settings: { ok: false, registered: [], missing: BOOT_SENTINELS, lastRegistered: null },
			failures: [],
		});
		expect(msg).toMatch(/People gallery/);
		expect(msg).toMatch(/F12/);
	});

	it("keeps its user-facing copy free of em dashes", () => {
		const msg = bootHealthMessage({
			settings: { ok: false, registered: ["a"], missing: ["b"], lastRegistered: "a" },
			failures: [{ phase: "registerSettings", message: "boom" }],
		});
		expect(msg).not.toContain("—");
	});
});

describe("reportBootHealth", () => {
	const HEALTHY = { failures: [], completed: ["init"], settings: sentinelReport(BOOT_SENTINELS, registryOf(BOOT_SENTINELS)) };
	const BROKEN = { failures: [], completed: [], settings: sentinelReport(BOOT_SENTINELS, registryOf([])) };
	// Reporting writes to console.error by design, so it is muted for the length of a call rather
	// than left to scribble over the run's output.
	const quietly = (fn) => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try { return fn(); } finally { err.mockRestore(); }
	};

	it("stays silent on a healthy world", () => {
		const notifications = { error: vi.fn() };
		expect(quietly(() => reportBootHealth({ notifications, user: { isGM: true }, report: HEALTHY }))).toBeNull();
		expect(notifications.error).not.toHaveBeenCalled();
	});

	it("shouts at a GM, permanently, when the boot was incomplete", () => {
		const notifications = { error: vi.fn() };
		quietly(() => reportBootHealth({ notifications, user: { isGM: true }, report: BROKEN }));
		expect(notifications.error).toHaveBeenCalledTimes(1);
		// Permanent, because a world that loads while the GM is making coffee would otherwise
		// dismiss the only warning they were ever going to get.
		expect(notifications.error.mock.calls[0][1]).toEqual({ permanent: true });
	});

	it("says nothing to a player, who can neither act on it nor see the console error", () => {
		const notifications = { error: vi.fn() };
		quietly(() => reportBootHealth({ notifications, user: { isGM: false }, report: BROKEN }));
		expect(notifications.error).not.toHaveBeenCalled();
	});

	it("never throws on a world too broken to answer anything", () => {
		// The one hard requirement: this runs on a failed boot, so it cannot be the thing that
		// fails next. No notifications object, no user, no settings registry.
		expect(() => quietly(() => reportBootHealth({ notifications: undefined, user: undefined, report: BROKEN })))
			.not.toThrow();
	});
});
