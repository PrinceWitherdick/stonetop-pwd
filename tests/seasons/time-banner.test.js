import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, ownRule } from "../fakes/css.js";
import {
	TIME_BANNER_PARTS, seasonMenuItems, timeBannerLabel, timeBannerTabs, timeBannerTabsFor,
} from "../../module/seasons/time-banner.js";
import { currentSeasonView, nextSeasonStamp } from "../../module/seasons/current-season.js";
import { WEATHER_SKIES, currentWeatherView } from "../../module/seasons/current-weather.js";
import { SEASON_IDS } from "../../module/seasons/seasons-change-reminders.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";
import { contrastRatio } from "../fakes/contrast.js";

// The weather, the season and the year hung from the top of the screen. WHAT each fact says is
// decided by current-weather.js and current-season.js and tested beside them; these hold the bar
// to reading them through the same two views the steading header paints from, and the wiring
// that fails without a sound (a part with no rule, a setting nothing reads).
//
// The bar's placement is not testable here (this suite runs on `node`, with no DOM): it is one
// prepend into core's own `#ui-top`. What IS held is the view it paints from.

const CSS = readCss();

/** A steading actor as far as the readers go: its flags, read by key. */
const steading = (flags = {}) => ({
	type: "stonetop",
	getFlag: (scope, key) => (scope === STONETOP_SCOPE ? flags[key] : undefined),
});

describe("the weather-and-season bar's view", () => {
	it("reads weather, season, year, left to right", () => {
		const tabs = timeBannerTabs(
			currentWeatherView({ sky: "rain", text: "A soaking rain" }),
			currentSeasonView({ season: "autumn", year: 2 }),
		);
		expect(tabs.map(tab => tab.part)).toEqual([...TIME_BANNER_PARTS]);
		expect(tabs.map(tab => tab.part)).toEqual(["weather", "season", "year"]);
		expect(tabs.map(tab => tab.label)).toEqual(["Rain", "Autumn", "Year Two"]);
		expect(timeBannerLabel(tabs)).toBe("Rain, Autumn, Year Two");
	});

	// A part turns only when the value it is turned BY moves, so these are what it compares.
	it("turns each part by the fact it shows", () => {
		const [weather, season, year] = timeBannerTabs(
			currentWeatherView({ sky: "snow", text: "" }),
			currentSeasonView({ season: "winter", year: 3 }),
		);
		expect(weather.value).toBe("snow");
		expect(season.value).toBe("winter");
		// By the year's NAME, so the GM renaming the years turns the part too.
		expect(year.value).toBe("Year Three");
	});

	// The same sky class the steading header wears, and the same softening of a sun nobody chose.
	it("draws the sky off the shared sky class, softened when nobody has set it", () => {
		const [set] = timeBannerTabs(currentWeatherView({ sky: "storm", text: "" }), currentSeasonView(null));
		expect(set.glyph).toContain("stonetop-sky--storm");
		expect(set.glyph).not.toContain("--unset");

		const [unset] = timeBannerTabs(currentWeatherView(null), currentSeasonView(null));
		expect(unset.glyph).toContain("stonetop-sky--sun");
		expect(unset.glyph).toContain("stonetop-time-banner__sky--unset");
	});

	// Its own masked glyphs, not the book's traced season art, which breaks up at bar size. Every
	// season needs a rule, a file that can be masked, and a credit; each fails silently on its own.
	it("heads each season with its own maskable, credited glyph", () => {
		const attribution = read("assets/icons/seasons/glyphs/ATTRIBUTION.md");
		expect(attribution).toContain("CC BY 3.0");
		for (const id of SEASON_IDS) {
			const [, season] = timeBannerTabs(currentWeatherView(null), currentSeasonView({ season: id, year: 1 }));
			expect(season.glyph).toContain(`stonetop-time-banner__season--${id}`);
			expect(season.glyph).not.toContain("stonetop-season-entry");

			expect(ownRule(CSS, `.stonetop-time-banner__season--${id}`), id)
				.toContain(`url('/systems/stonetop-pwd/assets/icons/seasons/glyphs/${id}.svg')`);
			const svg = read(`assets/icons/seasons/glyphs/${id}.svg`);
			expect(svg, `${id}: backing square`).toContain('<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>');
			expect(svg, `${id}: opaque backing square left in`).not.toMatch(/<path d="M0 0h512v512H0z"\s*\/>/);
			expect(attribution, id).toContain(`| ${id}.svg |`);
		}
		const glyph = ownRule(CSS, ".stonetop-time-banner__season");
		expect(glyph).toMatch(/(^|[^-])mask:\s*var\(--stonetop-banner-season-glyph\)/m);
		expect(glyph).not.toMatch(/var\(--stonetop-banner-season-glyph\s*,/);
	});

	it("hovers the weather's own line for everyone, and the season's action for a GM only", () => {
		const weather = currentWeatherView({ sky: "wind", text: "A gale off the Flats" });
		const season  = currentSeasonView({ season: "spring", year: 1 });

		const player = timeBannerTabs(weather, season);
		expect(player[0].tooltip).toBe("A gale off the Flats");
		expect(player[1].tooltip).toBe("");
		expect(player[2].tooltip).toBe("");

		const gm = timeBannerTabs(weather, season, { isGM: true });
		expect(gm[0].tooltip).toBe("A gale off the Flats");
		expect(gm[1].tooltip).toBeTruthy();
		expect(gm[2].tooltip).toBe(gm[1].tooltip);
	});

	// The header's display defaults, not a second set of them.
	it("shows the header's defaults on a steading that has recorded nothing", () => {
		const tabs = timeBannerTabsFor(steading());
		expect(tabs.map(tab => tab.label)).toEqual(["Clear", "Spring", "Year One"]);
	});

	// The STAMP's year, not the picker's high-water mark, which runs a year ahead through Winter.
	it("reads the year the season belongs to, not the picker's next year", () => {
		const tabs = timeBannerTabsFor(steading({
			seasonsCurrent:     { season: "winter", year: 1 },
			seasonsCurrentYear: 2,
			weatherCurrent:     { sky: "blizzard", text: "Snow to the eaves" },
		}));
		expect(tabs.map(tab => tab.label)).toEqual(["Blizzard", "Winter", "Year One"]);
	});

	it("puts up no bar at all without a steading", () => {
		expect(timeBannerTabsFor(null)).toBeNull();
	});
});

describe("the season buttons under the bar", () => {
	it("steps to the next season, and Winter into Spring of the next year", () => {
		expect(nextSeasonStamp({ season: "spring", year: 2 })).toEqual({ season: "summer", year: 2 });
		expect(nextSeasonStamp({ season: "summer", year: 2 })).toEqual({ season: "autumn", year: 2 });
		expect(nextSeasonStamp({ season: "autumn", year: 2 })).toEqual({ season: "winter", year: 2 });
		expect(nextSeasonStamp({ season: "winter", year: 2 })).toEqual({ season: "spring", year: 3 });
	});

	// The STAMP's year, not the picker's high-water mark: a completed Winter of Year One has already
	// moved that mark to Two, and the next season is Spring of Two, not of Three.
	it("counts on from the stamp, not the picker's year", () => {
		expect(nextSeasonStamp({ season: "winter", year: 1 }, 2)).toEqual({ season: "spring", year: 2 });
	});

	// Nothing recorded: the header shows Spring of the fallback year, so Next Season is its Summer.
	it("counts on from what the header shows on an un-stamped world", () => {
		expect(nextSeasonStamp(null)).toEqual({ season: "summer", year: 1 });
		expect(nextSeasonStamp(null, 3)).toEqual({ season: "summer", year: 3 });
	});

	it("offers Next Season, Change Season and Set the Year, Next naming the season it would begin", () => {
		const items = seasonMenuItems({ season: "winter", year: 1 });
		expect(items.map(item => item.move)).toEqual(["next", "change", "year"]);
		expect(items.map(item => item.label)).toEqual(["Next Season", "Change Season", "Set the Year"]);
		expect(items[0].hint).toContain("Spring, Year Two");
	});

	// Each button runs through `game.stonetop`, and the next-season entry point has to exist there.
	it("runs each button through a game.stonetop entry point that exists", () => {
		const banner = read("module/seasons/time-banner.js");
		expect(banner).toContain("game.stonetop?.openNextSeason?.()");
		expect(banner).toContain("game.stonetop?.openSeasonsChange?.()");
		expect(banner).toContain("game.stonetop?.openCampaignYear?.()");
		const ready = read("module/hooks/Ready.js");
		expect(ready).toMatch(/game\.stonetop\.openNextSeason\s*=/);
		expect(ready).toMatch(/game\.stonetop\.openCampaignYear\s*=/);
		expect(ready).toMatch(/nextSeasonStamp\(readCurrentSeason\(steading\), readCurrentYear\(steading\)\)/);
		expect(ready).toContain("._showSeasonDialog(next.season, next.year)");
	});
});

describe("the weather-and-season bar's wiring", () => {
	it("has a rule for every part and glyph the view emits", () => {
		for (const part of TIME_BANNER_PARTS) {
			expect(CSS, part).toMatch(new RegExp(`\\.stonetop-time-banner__tab--${part}\\s*\\{\\s*min-width:`));
		}
		const sky = ownRule(CSS, ".stonetop-time-banner__sky");
		expect(sky).toMatch(/(^|[^-])mask:\s*var\(--st-weather-icon\)/m);
		expect(sky).toMatch(/-webkit-mask:\s*var\(--st-weather-icon\)/);
		expect(ownRule(CSS, ".stonetop-time-banner__sky--unset")).toMatch(/opacity:/);
		expect(ownRule(CSS, ".stonetop-time-banner__icon")).toContain("var(--stonetop-banner-icon)");
	});

	// The year takes Bastionland's hourglass, not the steading's year chip.
	it("heads the year with an hourglass", () => {
		const [, , year] = timeBannerTabs(currentWeatherView(null), currentSeasonView(null));
		expect(year.glyph).toContain("fa-hourglass-half");
		expect(year.glyph).not.toContain("stonetop-year-chip");
		expect(year.light).toBe("stonetop-time-banner--year");
	});

	// Every light the view can hand out has a rule, or the part paints as a transparent hole with
	// its words in no colour at all. And every ink holds AAA against BOTH ends of its gradient: a
	// player at this table reads through Windows Magnifier, so "looks fine" is not evidence.
	it("paints every light the view can hand out, legibly", () => {
		const lights = [
			...Object.keys(WEATHER_SKIES).map(sky => timeBannerTabs(currentWeatherView({ sky, text: "" }), currentSeasonView(null))[0].light),
			...SEASON_IDS.map(season => timeBannerTabs(currentWeatherView(null), currentSeasonView({ season, year: 1 }))[1].light),
			"stonetop-time-banner--year",
		];
		expect(lights).toHaveLength(Object.keys(WEATHER_SKIES).length + SEASON_IDS.length + 1);
		for (const light of lights) {
			const rule = ownRule(CSS, `.${light}`);
			expect(rule, light).toBeTruthy();
			const value = name => new RegExp(`--stonetop-banner-${name}:\\s*([^;]+);`).exec(rule)?.[1]?.trim();
			for (const name of ["top", "bottom", "ink", "icon", "rule"]) expect(value(name), `${light} ${name}`).toBeTruthy();
			for (const end of ["top", "bottom"]) {
				expect(contrastRatio(value("ink"), value(end)), `${light}: ink on ${end}`).toBeGreaterThanOrEqual(7);
			}
		}
	});

	// The bar is the one sanctioned exception to "only the steading clock colours by season", and it
	// is kept to its own gradients: it never reads the four season inks, which stay the clock's alone
	// (steading-header-season.test.js counts them).
	it("spends no season ink", () => {
		const start = CSS.indexOf("#ui-top > .stonetop-time-banner {");
		const end   = CSS.indexOf("@keyframes stonetop-time-banner-turn");
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		expect(CSS.slice(start, end)).not.toMatch(/--stonetop-season-[a-z]+-ink/);
	});

	it("goes up on ready, and each browser can take it down", () => {
		expect(read("stonetop.js")).toMatch(/Hooks\.once\("ready",\s*installTimeBanner\)/);
		expect(read("module/settings.js")).toContain('game.settings.register(SYSTEM_ID, "timeBannerShown"');
		expect(read("module/utils/sheet-preferences.js")).toContain('"timeBannerShown"');
		const en = JSON.parse(read("languages/en.json"));
		expect(en.stonetop.settings.timeBannerShown.name).toBeTruthy();
		expect(en.stonetop.settings.timeBannerShown.hint).toBeTruthy();
	});
});
