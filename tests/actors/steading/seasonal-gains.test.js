import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StonetopSteading } from "../../../module/actors/steading/StonetopSteading.js";
import { seasonalGainChanges, applySeasonalGains, SEASONAL_GAINS_MOVE } from "../../../module/actors/steading/seasonal-gains.js";
import { applySpringBurstGains, SPRING_BURST_GAINS_STEP } from "../../../module/dialogs/SpringBurstDialog.js";
import { CURRENT_SEASON_KEY } from "../../../module/seasons/current-season.js";
import { STONETOP_SCOPE } from "../../../module/actors/character/StonetopFlags.js";
import { readRepo } from "../../fakes/css.js";

// The seasonal gains that change the sheet (Book I p.518): Population boom, Unexpected bounty and
// Tor's blessing. One helper applies them for both flows that make the Seasons Change move: the
// steading's own window and the session-zero first spring, which used to write the gains' names
// into the Chronicle and apply none of them.

/**
 * A steading actor with a real StonetopSteading on it. `clock` is the Seasons Change stamp, or
 * undefined for a world that has never recorded one.
 */
function steadingActor({ population = 0, surplus = 2, steadingFlags = {}, clock } = {}) {
	const actor = {
		type: "stonetop",
		system: { attributes: { population: { value: population }, surplus: { value: surplus } } },
		// The steading's own flags are read off `flags` (resolvedFlagProperty); the clock through getFlag.
		flags:  { [STONETOP_SCOPE]: { steading: steadingFlags } },
		getFlag: (scope, key) => {
			if (scope !== STONETOP_SCOPE) return undefined;
			if (key === "steading") return steadingFlags;
			if (key === CURRENT_SEASON_KEY) return clock;
			return undefined;
		},
		setFlag: vi.fn(),
		update:  vi.fn(),
	};
	actor.typedActor = new StonetopSteading(actor);
	return actor;
}

/** Everything the actor's updates wrote, flattened into one object of dotted keys. */
function written(actor) {
	return Object.assign({}, ...actor.update.mock.calls.map(([data]) => data));
}

let notices;
beforeEach(() => {
	notices = [];
	globalThis.ui = { notifications: { info: (m) => notices.push(m), warn: vi.fn() } };
});
afterEach(() => { delete globalThis.ui; });

describe("the seasonal gains' changes", () => {
	it("raises Population by 1, capped at +3", () => {
		expect(seasonalGainChanges(steadingActor({ population: 1 }).typedActor, ["population"], { year: 1, seasonId: "spring" }).system)
			.toEqual({ "attributes.population.value": 2 });
		expect(seasonalGainChanges(steadingActor({ population: 3 }).typedActor, ["population"], { year: 1, seasonId: "spring" }).system)
			.toEqual({ "attributes.population.value": 3 });
	});

	it("adds the bounty's 1 Surplus, and reports the Surplus it lands on", () => {
		const gains = seasonalGainChanges(steadingActor({ surplus: 2 }).typedActor, ["bounty"], { year: 1, seasonId: "spring" });
		expect(gains.system).toEqual({ "attributes.surplus.value": 3 });
		expect(gains.surplus).toBe(3);
	});

	it("stamps Tor's blessing to the season it was granted for", () => {
		const gains = seasonalGainChanges(steadingActor().typedActor, ["tor"], { year: 2, seasonId: "summer" });
		expect(gains.flags).toEqual({ torsBlessing: "2:summer" });
		expect(gains.notices).toEqual(["Tor's blessing holds for the season."]);
	});

	it("changes nothing for the gains that are the GM's to play out", () => {
		const gains = seasonalGainChanges(steadingActor({ surplus: 2 }).typedActor, ["trade", "news", "insight"], { year: 1, seasonId: "spring" });
		expect(gains.system).toEqual({});
		expect(gains.flags).toEqual({});
		expect(gains.surplus).toBe(2);
	});
});

describe("applying the seasonal gains", () => {
	it("writes the gains and anything else the move changes in ONE update, named for the move", async () => {
		const actor = steadingActor({ population: 0, surplus: 1 });
		await applySeasonalGains(actor.typedActor, ["population", "bounty", "tor"], {
			year: 1, seasonId: "autumn",
			also: { system: { "stats.defenses.value": 0 }, notices: ["The muster lapses with the season."] },
		});
		expect(actor.update).toHaveBeenCalledTimes(1);
		const [data, options] = actor.update.mock.calls[0];
		expect(options).toEqual({ stonetopMove: SEASONAL_GAINS_MOVE });
		expect(SEASONAL_GAINS_MOVE).toBe("Seasons Change");
		expect(data).toMatchObject({
			"system.attributes.population.value": 1,
			"system.attributes.surplus.value": 2,
			"system.stats.defenses.value": 0,
			"flags.stonetop-pwd.steading.torsBlessing": "1:autumn",
		});
		// The gains say what they did first, then whatever rode along.
		expect(notices.at(-1)).toBe("The muster lapses with the season.");
		expect(notices[0]).toMatch(/^Population boom/);
	});
});

// "Let Spring Burst Forth" is the campaign's first Seasons Change, and its gains are real gains.
describe("the first spring's gains", () => {
	it("take effect: Tor's blessing, a Population boom and a bounty, in one update", async () => {
		const actor = steadingActor({ population: 0, surplus: 0 });
		const applied = await applySpringBurstGains(actor, { tor: true, population: true, bounty: true, news: true });
		expect(applied).not.toBeNull();
		expect(actor.update).toHaveBeenCalledTimes(1);
		const [data, options] = actor.update.mock.calls[0];
		expect(options).toEqual({ stonetopMove: "Seasons Change" });
		expect(data).toMatchObject({
			"system.attributes.population.value": 1,
			"system.attributes.surplus.value": 1,
			"flags.stonetop-pwd.steading.torsBlessing": "1:spring",
		});
		// The marker that keeps a second finish from granting them again, in the same write.
		expect(data["flags.stonetop-pwd.steading.seasonSteps"]).toEqual({ [SPRING_BURST_GAINS_STEP]: "1:spring" });
	});

	it("hold once the clock is stamped Spring of Year One", async () => {
		const actor = steadingActor({ clock: { season: "spring", year: 1 }, steadingFlags: { torsBlessing: "1:spring" } });
		expect(actor.typedActor.torsBlessingActive()).toBe(true);
	});

	it("still apply when the clock already reads Spring of Year One", async () => {
		const actor = steadingActor({ clock: { season: "spring", year: 1 } });
		expect(await applySpringBurstGains(actor, { tor: true })).not.toBeNull();
		// Written as its own key, not the whole steading rebuilt from the cache (see applyChanges).
		expect(written(actor)["flags.stonetop-pwd.steading.torsBlessing"]).toBe("1:spring");
	});

	// Re-running the walkthrough mid-campaign: the clock is past the first spring, the same test
	// that has recordCurrentSeason's `advanceOnly` refuse to rewind it.
	it("are not granted again once the campaign has moved past the first spring", async () => {
		const actor = steadingActor({ clock: { season: "summer", year: 1 } });
		expect(await applySpringBurstGains(actor, { tor: true, population: true, bounty: true })).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	// Finished twice inside that first spring, the clock reads the same both times; the marker
	// is what refuses the second grant.
	it("are not granted twice within the first spring", async () => {
		const actor = steadingActor({
			clock: { season: "spring", year: 1 },
			steadingFlags: { seasonSteps: { [SPRING_BURST_GAINS_STEP]: "1:spring" } },
		});
		expect(await applySpringBurstGains(actor, { population: true })).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
	});

	// The walkthrough's Done applies them, and BEFORE it stamps the clock: the clock guard reads
	// the stamp as it stood when the walkthrough was finished, not the one Done just wrote.
	it("are applied by the walkthrough's Done, before the clock is stamped", () => {
		const src  = readRepo("module/dialogs/SpringBurstDialog.js");
		const body = src.slice(src.indexOf("async _finish(button)"));
		const gains = body.indexOf("await applySpringBurstGains(steadingActor, picked)");
		const clock = body.indexOf("await recordCurrentSeason(");
		expect(gains).toBeGreaterThan(-1);
		expect(clock).toBeGreaterThan(gains);
	});

	it("write nothing when nothing was ticked, or there is no steading", async () => {
		const actor = steadingActor();
		expect(await applySpringBurstGains(actor, {})).toBeNull();
		expect(await applySpringBurstGains(null, { tor: true })).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
	});
});
