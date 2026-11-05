import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, ownRule, stripComments } from "../../fakes/css.js";

// The steading header's "See the route" chip: the route the GM is showing the players
// (module/utils/shared-route.js). What it opens is covered by tests/dialogs/shared-route-window.test.js;
// these guard the wiring, which is the half that breaks silently.
const STEADING_HBS = stripComments(read("templates/actor/steading.hbs"));
const SHEET_JS     = read("module/actors/steading/StonetopSteadingSheet.js");
const ROUTE_JS     = read("module/utils/shared-route.js");
const CHIP_FN      = ROUTE_JS.match(/export function sharedRouteChipHtml[\s\S]*?\n\}/)?.[0] ?? "";
const CSS          = readCss();

describe("the steading header's See the route chip", () => {
	// One markup for the full render and the in-place refresh: the template prints what the JS builds,
	// which is "" while nothing is being shown.
	it("is the shared route's own markup, drawn only while a route is being shown", () => {
		expect(STEADING_HBS).toContain("{{{stonetop.sharedRouteChip}}}");
		expect(CHIP_FN).toMatch(/if \(!chip\) return "";/);
		expect(CHIP_FN).toContain('data-action="see-shared-route"');
	});

	// A labelled chip, so a screen reader has a name to read rather than a bare glyph.
	it("names itself in words and hides its glyph", () => {
		expect(CHIP_FN).toContain("${escHtml(chip.label)}");
		expect(CHIP_FN).toContain('aria-hidden="true"');
	});

	it("sits just ahead of the clock, which gives up its auto margin to it", () => {
		expect(STEADING_HBS.indexOf("stonetop.sharedRouteChip"))
			.toBeLessThan(STEADING_HBS.indexOf('<div class="steading-header-clock">'));
		expect(ownRule(CSS, ".steading-header .steading-header-route")).toMatch(/margin:\s*0 0 0 auto\s*;/);
		expect(ownRule(CSS, ".steading-header .steading-header-route + .steading-header-clock"))
			.toMatch(/margin-left:\s*10px\s*;/);
	});

	it("is fed from the shared route and opens it, for everyone", () => {
		expect(SHEET_JS).toContain("context.stonetop.sharedRouteChip = sharedRouteChipHtml(sharedRouteChip(readSharedRoute()));");
		expect(SHEET_JS).toMatch(/\[data-action='see-shared-route'\]"\)\.on\("click", \(\) => openSharedRoute\(\)\)/);
	});
});
