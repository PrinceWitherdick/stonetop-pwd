import { describe, it, expect, vi } from "vitest";
import { seasonsRollFlags, seasonsRollKey, seasonsRollTier } from "../../module/utils/roll-engine.js";
import { shortfallLine } from "../../module/actors/steading/winter-debt.js";
import {
	debilityPath, disasterOwedFlags, disasterPickLine, meetWithDisaster, openOwedDisasterPicker,
} from "../../module/actors/steading/steading-debilities.js";
import { applyWinterShortfall } from "../../module/actors/steading/winter-debt.js";

// The shortfall note is written through a module the steading code imports at call time.
const noted = vi.hoisted(() => []);
vi.mock("../../module/timeline/timeline-season-entry.js", () => ({
	noteSeasonShortfall: async (args) => { noted.push(args); },
}));
import { SYSTEM_ID } from "../../module/system-id.js";

// User, 2026-10-10: a season's record says how its +Fortunes roll went, and a shortfall is its own
// line in the season's heading on the timeline.

/** A posted card as seasonsRollTier reads it: its flags, and a roll total when it has one. */
function card(flags, total = null) {
	return {
		getFlag: (scope, key) => flags?.[scope]?.[key],
		rolls: total === null ? [] : [{ total }],
	};
}

describe("seasonsRollTier", () => {
	const key = seasonsRollKey(2, "summer");

	it("reads a rewritable card for the tier its total counts as now", () => {
		expect(seasonsRollTier(key, [card(seasonsRollFlags(key), 8)])).toBe("partial");
		// A 12+ is its 10+.
		expect(seasonsRollTier(key, [card(seasonsRollFlags(key), 12)])).toBe("success");
	});

	it("takes a fixed card's stamped tier over its dice (a storm's forced 6-)", () => {
		expect(seasonsRollTier(key, [card(seasonsRollFlags(key, "failure"), 11)])).toBe("failure");
	});

	it("goes with the latest card for that season, and ignores other seasons'", () => {
		const messages = [
			card(seasonsRollFlags(key), 4),
			card(seasonsRollFlags(seasonsRollKey(2, "autumn")), 11),
			card(seasonsRollFlags(key), 10),
			card({ [SYSTEM_ID]: {} }, 3),
		];
		expect(seasonsRollTier(key, messages)).toBe("success");
	});

	it("is null for a season no card was stamped for", () => {
		expect(seasonsRollTier(key, [card(seasonsRollFlags(seasonsRollKey(1, "summer")), 9)])).toBeNull();
		expect(seasonsRollTier(key, [])).toBeNull();
	});
});

describe("shortfallLine", () => {
	it("names the consequence picked and what it cost", () => {
		expect(shortfallLine("npc", { fortunes: 0, population: null, disaster: false }))
			.toBe("The stores ran out: Important NPC dies. Surplus to 0, Fortunes to +0.");
	});

	it("carries a Population loss, with a real minus", () => {
		expect(shortfallLine("population", { fortunes: -1, population: -1, disaster: false }))
			.toBe("The stores ran out: Population loss. Surplus to 0, Population to −1, Fortunes to −1.");
	});

	it("says the steading Met with Disaster at the floor, and leaves Fortunes alone", () => {
		const line = shortfallLine("resource", { fortunes: -1, population: null, disaster: true });
		expect(line).toContain("Met with Disaster");
		expect(line).not.toContain("Fortunes to");
	});

	it("says a debt refused after winter went unpaid", () => {
		expect(shortfallLine("pc", { fortunes: 1, population: null, disaster: false }, { late: true }))
			.toMatch(/^Winter's debt went unpaid: A PC dies/);
	});
});

describe("disasterPickLine", () => {
	it("says what the disaster took", () => {
		expect(disasterPickLine({ id: "malcontent", label: "Malcontent" })).toBe("Met with Disaster: marked Malcontent.");
		expect(disasterPickLine({ id: "population", label: "Folks start to leave" })).toContain("Population −1");
		expect(disasterPickLine(null)).toContain("nothing left");
	});
});

// A disaster met at Fortunes −1 in a Seasons Change, its pick shut unmade and made later from the
// header glyph: the pick still goes on that season's shortfall note, not a Disaster row of its own.
describe("an owed disaster keeps its season", () => {
	const WINTER = { seasonId: "winter", year: 2, title: "Winter's shortfall" };

	it("is stored with the season it was met in, and null for none", () => {
		expect(disasterOwedFlags("winter's shortfall", { ...WINTER, year: "2" }))
			.toEqual({ disasterOwed: { cause: "winter's shortfall", season: WINTER } });
		// Written as null, so an earlier owed flag's season is never merged into this one.
		expect(disasterOwedFlags("a Requisition taken on a miss"))
			.toEqual({ disasterOwed: { cause: "a Requisition taken on a miss", season: null } });
	});

	it("rides the write that owes it, from a failed harvest and from winter", async () => {
		const steading = () => ({ getStatValue: () => -1, getSystemValue: () => false, applyChanges: vi.fn(async () => {}) });
		const harvest = steading();
		globalThis.Dialog = class { render() {} };
		try {
			await meetWithDisaster(harvest, {
				cause: "a failed harvest",
				season: { seasonId: "autumn", year: 1, title: "The harvest failed", line: "No Surplus from it." },
			});
		} finally { delete globalThis.Dialog; }
		expect(harvest.applyChanges.mock.calls[0][0].flags.disasterOwed.season)
			.toEqual({ seasonId: "autumn", year: 1, title: "The harvest failed" });

		const winter = steading();
		await applyWinterShortfall(winter, "npc", { season: WINTER });
		expect(winter.applyChanges.mock.calls[0][0].flags.disasterOwed.season).toEqual(WINTER);
	});

	it("puts the pick made later on that season's shortfall note", async () => {
		noted.length = 0;
		const ALL = ["diminished", "lacking", "malcontent"];
		// Nothing left to take, so the picker settles at once and says so, with no window to click.
		const steading = {
			getStatValue: () => -1,
			getSystemValue: path => ALL.some(id => path === debilityPath(id)),
			applyChanges: vi.fn(async () => {}),
			disasterOwed: () => ({ cause: "winter's shortfall", season: WINTER }),
		};
		openOwedDisasterPicker(steading);
		await vi.waitFor(() => expect(noted).toHaveLength(1));
		expect(noted[0]).toMatchObject({ ...WINTER, line: disasterPickLine(null) });
	});
});
