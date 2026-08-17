import { describe, expect, it } from "vitest";
import {
	WEATHER_SEASONS,
	CAMPAIGN_SEASON_TABLES,
	getWeatherSeason,
	resolveWeatherRow,
	rowRange,
	weatherSeasonForCampaignSeason,
	defaultWeatherSeason,
} from "../../module/utils/weather.js";
import { SEASON_IDS } from "../../module/seasons/seasons-change-reminders.js";

// The seasonal weather tables (Book I, p.325) are GM-facing rules content, so the
// data itself is what we guard: each season must cover a 1d6 with no gaps or overlaps.

describe("weather tables", () => {
	it("has the six Book I seasons", () => {
		expect(WEATHER_SEASONS.map(s => s.key)).toEqual([
			"late-winter-early-spring",
			"spring-early-summer",
			"summer",
			"late-summer-early-autumn",
			"autumn",
			"winter",
		]);
	});

	for (const season of WEATHER_SEASONS) {
		describe(season.label, () => {
			it("maps every 1d6 result to exactly one row", () => {
				for (let n = 1; n <= 6; n++) {
					const matches = season.rows.filter(r => n >= r.min && n <= r.max);
					expect(matches, `d6=${n}`).toHaveLength(1);
				}
			});

			it("has rows that are contiguous and in order, 1 through 6", () => {
				const sorted = [...season.rows].sort((a, b) => a.min - b.min);
				expect(sorted[0].min).toBe(1);
				expect(sorted.at(-1).max).toBe(6);
				for (let i = 1; i < sorted.length; i++) {
					expect(sorted[i].min, season.label).toBe(sorted[i - 1].max + 1);
				}
			});

			it("gives every row non-empty text", () => {
				for (const row of season.rows) expect(row.text.trim().length).toBeGreaterThan(0);
			});
		});
	}

	it("resolves a roll to its row", () => {
		expect(resolveWeatherRow("winter", 1).text).toMatch(/Blizzard/);
		expect(resolveWeatherRow("winter", 6).text).toMatch(/Warm \(for winter\)/);
		expect(resolveWeatherRow("autumn", 5).text).toMatch(/Crisp, breezy/);
	});

	it("returns null for an unknown season or out-of-range roll", () => {
		expect(getWeatherSeason("nope")).toBeNull();
		expect(resolveWeatherRow("nope", 3)).toBeNull();
		expect(resolveWeatherRow("winter", 9)).toBeNull();
	});

	it("formats single and range labels", () => {
		expect(rowRange({ min: 4, max: 4 })).toBe("4");
		expect(rowRange({ min: 2, max: 3 })).toBe("2–3");
	});

	it("flags the reroll rows", () => {
		expect(resolveWeatherRow("autumn", 3).reroll).toBe(true);
		expect(resolveWeatherRow("late-winter-early-spring", 4).reroll).toBe(true);
		expect(resolveWeatherRow("winter", 3).reroll).toBeUndefined();
	});
});

// The picker opens on the season the steading's clock is in. The map is written out in
// weather.js rather than imported from the seasons module (see the note there), so the two
// halves are pinned together here instead.
describe("the campaign season's table", () => {
	it("maps every campaign season, and only campaign seasons", () => {
		expect(Object.keys(CAMPAIGN_SEASON_TABLES)).toEqual(SEASON_IDS);
	});

	it("maps each one to a real weather table", () => {
		for (const [season, key] of Object.entries(CAMPAIGN_SEASON_TABLES)) {
			expect(getWeatherSeason(key), season).not.toBeNull();
		}
	});

	it("points at the table that names that season outright", () => {
		expect(weatherSeasonForCampaignSeason("spring")).toBe("spring-early-summer");
		expect(weatherSeasonForCampaignSeason("summer")).toBe("summer");
		expect(weatherSeasonForCampaignSeason("autumn")).toBe("autumn");
		expect(weatherSeasonForCampaignSeason("winter")).toBe("winter");
	});

	it("has nothing to say without a stamped season", () => {
		expect(weatherSeasonForCampaignSeason(null)).toBeNull();
		expect(weatherSeasonForCampaignSeason("harvest")).toBeNull();
	});
});

describe("the picker's opening season", () => {
	it("follows the clock over a pick made in an earlier season", () => {
		expect(defaultWeatherSeason("autumn", { key: "summer", for: "summer" })).toBe("autumn");
	});

	it("follows the clock when nothing has been picked yet", () => {
		expect(defaultWeatherSeason("winter")).toBe("winter");
		expect(defaultWeatherSeason("winter", {})).toBe("winter");
	});

	it("keeps a deliberate pick made within the season showing", () => {
		expect(defaultWeatherSeason("autumn", { key: "late-summer-early-autumn", for: "autumn" }))
			.toBe("late-summer-early-autumn");
	});

	it("keeps the remembered pick in a world with no season stamped", () => {
		expect(defaultWeatherSeason(null, { key: "winter", for: null })).toBe("winter");
	});

	it("honours a pick saved before it was paired, but only where the clock is silent", () => {
		expect(defaultWeatherSeason(null, "winter")).toBe("winter");
		expect(defaultWeatherSeason("spring", "winter")).toBe("spring-early-summer");
	});

	it("falls back to the first table when there is nothing to go on", () => {
		expect(defaultWeatherSeason(null)).toBe(WEATHER_SEASONS[0].key);
		expect(defaultWeatherSeason(null, "")).toBe(WEATHER_SEASONS[0].key);
		expect(defaultWeatherSeason(null, { key: "nope", for: null })).toBe(WEATHER_SEASONS[0].key);
	});

	it("always names a real table", () => {
		expect(getWeatherSeason(defaultWeatherSeason("summer", { key: "nope", for: "summer" }))).not.toBeNull();
	});
});
