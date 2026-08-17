import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, ownRule, stripComments } from "../../fakes/css.js";
import { WEATHER_SKIES } from "../../../module/seasons/current-weather.js";

// The weather glyph beside the steading header's clock. WHAT it says is decided by
// module/seasons/current-weather.js (covered by tests/seasons/current-weather.test.js); these
// guard the wiring, which is the half that breaks without a sound — a glyph rendered outside the
// clock's wrapper still paints, still hovers, and simply sits in the wrong half of the header.
//
// Comments come out first, or a guard passes on its own rationale rather than on the markup.
const STEADING_HBS = stripComments(read("templates/actor/steading.hbs"));
const SHEET_JS     = read("module/actors/steading/StonetopSteadingSheet.js");
const DIALOG_JS    = read("module/dialogs/WeatherDialog.js");
const CSS          = readCss();

/** One `<div …>` block, counting nesting so an inner div can't end the slice early. */
function divBlock(html, openTag) {
	const start = html.indexOf(openTag);
	expect(start, openTag).toBeGreaterThan(-1);
	const re = /<div\b|<\/div>/g;
	re.lastIndex = start;
	for (let depth = 0, m; (m = re.exec(html)); ) {
		depth += m[0] === "</div>" ? -1 : 1;
		if (depth === 0) return html.slice(start, re.lastIndex);
	}
	throw new Error(`unclosed ${openTag}`);
}

const header = divBlock(STEADING_HBS, '<div class="steading-header">');
const clock  = divBlock(header, '<div class="steading-header-clock">');

describe("the steading header's weather glyph", () => {
	it("sits inside the clock block, to the LEFT of the season", () => {
		expect(clock).toContain("steading-header-weather");
		expect(clock.indexOf("steading-header-weather")).toBeLessThan(clock.indexOf("steading-header-season"));
	});

	it("shows in both layouts", () => {
		expect(clock).not.toContain("classicLayout");
	});

	// A GM gets a button that opens the Weather picker — the window that decides this glyph, so
	// the readout is the way back to what set it. Everyone else gets plain text: the picker
	// rolls, posts to chat and writes the steading, none of which is a player's to do. Two
	// wrappers, ONE glyph, the same shape the clock beside it uses.
	it("opens the Weather picker for a GM, and is plain text for everyone else", () => {
		expect(clock).toContain('{{#if stonetop.isGM}}');
		expect(clock).toContain('{{#unless stonetop.isGM}}');
		expect(clock).toContain('data-action="set-current-weather"');
		// Two glyphs in the block, one per branch, and never both on screen at once.
		expect(clock.match(/class="steading-header-weather-glyph"/g)).toHaveLength(2);
		// Through the same entry point the hotbar macro and the Expedition dialog use, so
		// openOrFocus can keep it to one window however it was reached.
		expect(SHEET_JS).toContain(`html.find("[data-action='set-current-weather']").on("click", () => game.stonetop?.openWeather?.());`);
		expect(read("module/hooks/Ready.js")).toContain("game.stonetop.openWeather       = () => WeatherDialog.open();");
	});

	// An <i> is an empty element painting a private-use codepoint: a screen reader left to read
	// it announces nothing, so the name has to be on the wrapper and the glyph hidden. That goes
	// double for the GM's <button>, which has no text of its own to be named by.
	it("names itself for a screen reader", () => {
		expect(clock).toContain('role="img"');
		expect(clock.match(/aria-label="\{\{stonetop\.currentWeather\.label\}\}"/g)).toHaveLength(2);
		expect(clock.match(/aria-hidden="true"/g)).toHaveLength(2);
		// The hover carries the row's own line and nothing else — the glyph says the kind of day,
		// this says which — on both branches alike, because a hover that also explains the click
		// buries the one thing it was there to say. Plain text, no markup: nothing else in this
		// system puts HTML in a data-tooltip, and Foundry is the only thing that would render it.
		expect(clock.match(/data-tooltip="\{\{stonetop\.currentWeather\.text\}\}"/g)).toHaveLength(2);
		expect(clock).not.toContain("weather.setTooltip");
		expect(clock).not.toContain("<br>");
	});

	// The GM's wrapper is a <button>, so core's chrome has to be stripped by name or the glyph
	// sits in a 32px slate box beside a bare season. Same list the season's wrapper strips.
	it("strips core's button chrome off the GM's wrapper", () => {
		const glyph = ownRule(CSS, ".steading-header .steading-header-weather");
		for (const prop of ["border", "background", "box-shadow", "height", "min-height", "padding"]) {
			expect(glyph, prop).toMatch(new RegExp(`${prop}:\\s*(none|auto|0)`));
		}
		// The glyph has no surface of its own, so the hover paints one; the season next door
		// warms its year chip instead, which is a box it already had.
		expect(ownRule(CSS, ".steading-header .steading-header-weather--set")).toMatch(/cursor:\s*pointer/);
		expect(ownRule(CSS, ".steading-header .steading-header-weather--set:hover")).toContain("var(--st-slate-hover-bg)");
	});

	// The sky modifier is resolved by the view rather than composed in the markup, and BOTH
	// wrappers wear the one string it returns — the conditional that softens an un-set sky used
	// to be written out twice here, which is the drift the season next door avoids by putting
	// its readout in a partial. So this asserts the wrappers take the resolved classes, and the
	// view test next door asserts what those classes say for each of the thirteen skies.
	it("takes its glyph from the sky's modifier rather than choosing one here", () => {
		expect(clock.match(/class="\{\{stonetop\.currentWeather\.classes\}\}/g)).toHaveLength(2);
		expect(clock).not.toContain("steading-header-weather--{{");
		expect(clock).toContain('class="steading-header-weather-glyph"');
		// No {{#if}} chain picking a drawing, and no Font Awesome left over: the sky the view
		// resolved is the whole decision, and a second place deciding is a second place to
		// forget a weather.
		expect(clock).not.toMatch(/\{\{#if stonetop\.currentWeather\.(sun|rain|snow|storm)/);
		expect(clock).not.toContain("fa-");
		expect(clock).not.toContain("<i ");
	});

	it("is fed by the sheet's context", () => {
		expect(SHEET_JS).toContain("context.stonetop.currentWeather = currentWeatherView(readCurrentWeather(this.actor));");
	});

	// Posting the weather and setting the header are one action. A card in the log saying it is
	// snowing over a header still showing a sun is worse than either on its own.
	//
	// Asserted as ONE call rather than as the two lines this used to be: while the pair lived at
	// this call site, the guard could only ever say that THIS caller remembered both, and the
	// next one to reach for the exported `postWeather` would post a card and leave the header
	// on yesterday's sky. The pair itself is covered by tests/seasons/current-weather.test.js.
	it("is written by the Weather picker, on the post", () => {
		expect(DIALOG_JS).toContain("await announceWeather(this._season, this._picked);");
		// The picker must not be able to post without writing: no direct route to either half.
		expect(DIALOG_JS).not.toMatch(/\bpostWeather\s*\(/);
		expect(DIALOG_JS).not.toMatch(/\brecordCurrentWeather\s*\(/);
	});
});

describe("the clock block's layout", () => {
	// The auto margin moved to the WRAPPER when the glyph joined the clock: two auto left margins
	// in one flex row split the free space between them rather than stacking, which is a glyph
	// stranded in the middle of the header. The season keeps its own (it is asserted next door,
	// and inside a content-sized wrapper it has no slack left to take).
	it("parks the pair against the right edge from the wrapper", () => {
		const wrapper = ownRule(CSS, ".steading-header .steading-header-clock");
		expect(wrapper).toMatch(/margin-left:\s*auto\s*;/);
		expect(wrapper).toMatch(/align-items:\s*center\s*;/);
		expect(ownRule(CSS, ".steading-header .steading-header-season")).toMatch(/margin:\s*0 0 0 auto\s*;/);
	});

	// The season inks are the clock's alone — a hard rule with its own test counting every read
	// of them. And the book is monochrome throughout, so the glyph stays in plain ink rather than
	// growing a weather palette of its own.
	it("stays in plain ink", () => {
		const glyph = ownRule(CSS, ".steading-header .steading-header-weather");
		expect(glyph).toContain("var(--st-text-body)");
		expect(glyph).not.toContain("--stonetop-season-");
		expect(ownRule(CSS, ".steading-header .steading-header-weather--unset")).toContain("var(--st-text-secondary)");
	});

	// A sun nobody chose should read quieter than one they did, and the modifier ties with the
	// base rule on specificity — so it only wins by sitting after it.
	it("sorts the unset modifier after its base", () => {
		expect(CSS.indexOf(".steading-header .steading-header-weather--unset"))
			.toBeGreaterThan(CSS.indexOf(".steading-header .steading-header-weather {"));
	});

	// The glyph is a MASK over currentColor, not an <img> — which is what lets one file take the
	// header's ink in both themes, the dimmer unset tone, and whatever the dark palette hands it.
	it("wears its drawing as a mask over currentColor", () => {
		const glyph = ownRule(CSS, ".steading-header .steading-header-weather-glyph");
		expect(glyph).toMatch(/background:\s*currentColor/);
		expect(glyph).toMatch(/(^|[^-])mask:\s*var\(--st-weather-icon\)/m);
		// Both spellings, or WebKit paints the un-masked square.
		expect(glyph).toMatch(/-webkit-mask:\s*var\(--st-weather-icon\)/);
		// `contain`, so a 512-square drawing fits the 1em box rather than being cropped by it.
		expect(glyph).toMatch(/no-repeat center \/ contain/);
		// No fallback in the var: a sky with no rule must paint a hole, which is what the next
		// test catches. A default drawing would hide it behind the wrong weather instead.
		expect(glyph).not.toMatch(/var\(--st-weather-icon\s*,/);
	});

	// Every sky needs a rule, a file, and a file that can actually be masked. Each of the three
	// fails silently on its own: no rule paints nothing, no file paints nothing, and a file with
	// game-icons.net's opaque backing square paints a solid slab where the weather should be.
	it("gives every sky a rule pointing at a maskable file", () => {
		for (const sky of Object.keys(WEATHER_SKIES)) {
			const rule = `.steading-header .steading-header-weather--${sky}`;
			expect(CSS, sky).toContain(rule);
			expect(ownRule(CSS, rule), sky)
				.toContain(`url('/systems/stonetop-pwd/assets/icons/weather/${sky}.svg')`);

			const svg = read(`assets/icons/weather/${sky}.svg`);
			// The backing square punched transparent — see assets/icons/weather/ATTRIBUTION.md.
			expect(svg, `${sky}: backing square`).toContain('<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>');
			expect(svg, `${sky}: opaque backing square left in`).not.toMatch(/<path d="M0 0h512v512H0z"\s*\/>/);
			// And an actual glyph behind it, rather than a stripped file.
			expect(svg.length, `${sky}: too small to be a drawing`).toBeGreaterThan(400);
		}
	});

	// The drawings are third-party art under CC BY 3.0, so every one has to be credited by name.
	it("credits every drawing", () => {
		const attribution = read("assets/icons/weather/ATTRIBUTION.md");
		expect(attribution).toContain("CC BY 3.0");
		for (const sky of Object.keys(WEATHER_SKIES)) {
			expect(attribution, sky).toContain(`| ${sky}.svg |`);
		}
	});
});
