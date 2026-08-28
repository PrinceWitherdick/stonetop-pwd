import { describe, it, expect, vi } from "vitest";
import { readRepo as read } from "../../fakes/css.js";
import { HOLD_DEFS } from "../../../module/actors/steading/steading-holds.js";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";

// ── The fixture macro's seed, read back through the real reader ──────────────────
// The hold tray is EMPTY on a quiet steading by design, which makes it the one piece of the
// steading header a test world never shows by accident. So scripts/local/create-test-characters.js
// lights every chip at once, and these build the exact flag shape that macro writes and run it
// through holdsView. A seed that drifts out of step with what the reader wants then fails here,
// rather than turning up as a header that is quietly missing a chip nobody can explain.

function seededActor({ season = "spring", year = 1, steadingFlags = {} } = {}) {
	const flags = {
		seasonsCurrent: season ? { season, year } : undefined,
		seasonsCurrentYear: year,
		steading: steadingFlags,
	};
	return {
		type: "stonetop",
		system: {},
		flags: { "stonetop-pwd": flags },
		getFlag: (scope, key) => (scope === "stonetop-pwd" ? flags[key] ?? null : null),
		update: vi.fn(),
	};
}

/** Exactly what create-test-characters.js writes into flags["stonetop-pwd"].steading. */
function fixtureSteadingFlags({ year = 1, season = "spring" } = {}) {
	const built = { completed: true, applied: null, r: Array(16).fill(true) };
	return {
		fortunesAdvantage: { source: "Sacrifice (Rites of the Land)" },
		musterHold: { year, season, defenses: true },
		torsBlessing: `${year}:${season}`,
		improvements: { inn: { ...built }, standingWatch: { ...built }, weaponsOfWar: { ...built } },
		system: {
			stats: { defenses: { value: 1 } },
			attributes: {
				surplus: { value: 1 },
				debilities: {
					options: {
						diminished: { value: false },
						lacking: { value: true },
						malcontent: { value: false },
					},
				},
			},
		},
	};
}

const keysFor = actor => new StonetopSteading(actor).holdsView().map(r => r.key);

describe("the test fixture's seeded tray", () => {
	it("lights all six chips in spring, which is the widest the tray ever gets", () => {
		expect(keysFor(seededActor({ steadingFlags: fixtureSteadingFlags() })))
			.toEqual(HOLD_DEFS.map(d => d.key));
	});

	// The weapons' maintenance is a SPRING bill, so five is the correct answer in any other
	// season. The macro logs which of the two cases a world got, for exactly this reason.
	it("drops to five outside spring, and it is the weapons' upkeep that goes", () => {
		const actor = seededActor({
			season: "autumn",
			steadingFlags: fixtureSteadingFlags({ season: "autumn" }),
		});
		expect(keysFor(actor)).toEqual(HOLD_DEFS.map(d => d.key).filter(k => k !== "weaponsUpkeep"));
	});

	// Every gate the seed has to satisfy, failed one at a time. A chip that stops depending on
	// something the macro writes should break a test here, not the header in the world.
	it("needs a Surplus for the inn's gathering to count as unspent", () => {
		const flags = fixtureSteadingFlags();
		flags.system.attributes.surplus.value = 0;
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("innGathering");
	});

	it("needs a marked debility for the inn's gathering to have anything to clear", () => {
		const flags = fixtureSteadingFlags();
		flags.system.attributes.debilities.options.lacking.value = false;
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("innGathering");
	});

	it("needs the improvements built for their upkeep chips to exist at all", () => {
		const flags = fixtureSteadingFlags();
		flags.improvements = {};
		const keys = keysFor(seededActor({ steadingFlags: flags }));
		for (const k of ["innGathering", "standingWatch", "weaponsUpkeep"]) expect(keys, k).not.toContain(k);
	});

	// A paid step is precisely the state that hides a due, which is why the macro clears these
	// for the seeded season through the "-=" deletion syntax rather than off the object.
	it("needs this season's step markers clear for the dues to read as unpaid", () => {
		const flags = fixtureSteadingFlags();
		flags.seasonSteps = { innGathering: "1:spring", standingWatch: "1:spring", weaponsUpkeep: "1:spring" };
		const keys = keysFor(seededActor({ steadingFlags: flags }));
		for (const k of ["innGathering", "standingWatch", "weaponsUpkeep"]) expect(keys, k).not.toContain(k);
	});

	// The muster is stored against the season it was raised in, so a stamp from any other
	// season reads as lapsed. The macro dates it to the clock it just stamped for that reason.
	it("dates the muster to the seeded season, or it reads as already lapsed", () => {
		const flags = fixtureSteadingFlags();
		flags.musterHold = { year: 1, season: "winter", defenses: true };
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("muster");
	});

	it("dates Tor's blessing the same way", () => {
		const flags = fixtureSteadingFlags();
		flags.torsBlessing = "1:winter";
		expect(keysFor(seededActor({ steadingFlags: flags }))).not.toContain("torsBlessing");
	});

	// Before a world's first Seasons Change nothing has turned, so nothing can be overdue.
	it("shows no seasonal dues on a world whose clock was never stamped", () => {
		const keys = keysFor(seededActor({ season: "", steadingFlags: fixtureSteadingFlags() }));
		for (const k of ["standingWatch", "weaponsUpkeep"]) expect(keys, k).not.toContain(k);
	});
});

describe("the fixture macro itself", () => {
	const MACRO = read("scripts/local/create-test-characters.js");

	it("seeds every piece the tray reads", () => {
		for (const needle of [
			"sf.fortunesAdvantage", "sf.musterHold", "sf.torsBlessing",
			"TEST_HOLD_IMPROVEMENTS", "TEST_HOLD_STEPS",
		]) expect(MACRO, needle).toContain(needle);
	});

	// setFlag MERGES, so a sub-key dropped off the object it is handed survives untouched in
	// the stored flags. The seasonal dues would then stay hidden on every re-run but the first.
	it("clears the season-step markers with the deletion syntax, not with delete", () => {
		expect(MACRO).toContain("steading.seasonSteps.-=");
		expect(MACRO).not.toMatch(/delete sf\.seasonSteps/);
	});

	// Recording `defenses: true` without moving the stat would seed a muster whose +1 does not
	// exist, and the first stand-down would then subtract a point never gained.
	it("actually applies the +1 Defenses its seeded muster claims", () => {
		const at = MACRO.indexOf("const holdDefenses");
		expect(at).toBeGreaterThan(-1);
		const block = MACRO.slice(at, at + 800);
		expect(block).toContain("holdDefenses + 1");
		expect(block).toContain("defenses: true");
	});

	// An undefined `applied` on a completed improvement means "finished before the grants
	// engine shipped", which back-fills a presumed footprint and would revert grants that were
	// never made. Null says the true thing: this macro granted nothing.
	it("says explicitly that it granted nothing, rather than leaving it undefined", () => {
		expect(MACRO).toContain("completed: true, applied: null");
	});

	// The macro must not overwrite a steading that already holds these for real.
	it("seeds each held state only when it is absent", () => {
		expect(MACRO).toContain("if (!sf.musterHold)");
		expect(MACRO).toContain("if (!sf.fortunesAdvantage)");
		expect(MACRO).toContain("if (sf.improvements[slug]?.completed) continue;");
	});
});
