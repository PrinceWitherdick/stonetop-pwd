import { describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments, declarations } from "../fakes/css.js";

/**
 * The Save row at the bottom of the two settings submenus ("On Hover Info" and the map pin
 * names), which are the same window twice: a stack of labelled rows, `height: "auto"`,
 * `resizable`, and one Save at the end (`_createSettingsMenuApp` in module/settings.js).
 *
 * Both open exactly as tall as their rows, which is precisely why the footer being unpinned went
 * unnoticed: it LOOKS pinned until the window is dragged taller, and then the button stays sitting
 * under the last row with all the empty space below it. Nothing is logged, and the menu still
 * saves — it just stops reading as a window with a bottom bar.
 *
 * Two declarations carry it, and neither works without the other, so both are guarded here:
 * the form has to be a flex COLUMN for an auto margin to have any slack to eat, and the footer
 * has to take that slack with `margin-top: auto` rather than a fixed gap.
 *
 * The third guard is the one that would fail SILENTLY in the other direction: core dresses any
 * `.notes` inside a form with `flex: 0 0 100%`, meaning "a full line" — which in the flex column
 * this fix declares is a full HEIGHT. The map menu has a `.notes` paragraph directly inside its
 * form, so without the reset the fix for one menu breaks the other by pushing every select out
 * through the bottom of the window.
 */

const CSS = readCss();
const HOVER_HBS = stripComments(readRepo("templates/settings/hover-descriptions.hbs"));
const MAP_HBS = stripComments(readRepo("templates/settings/map-pin-names.hbs"));

const FORMS = [".stonetop-hover-settings", ".stonetop-map-pin-name-settings"];

describe("the settings submenus' Save footer", () => {
	it.each(FORMS)("%s is a flex column, so the footer has slack to be pushed into", (form) => {
		const css = declarations(CSS, form);
		expect(css).toBeTruthy();
		expect(css).toMatch(/display:\s*flex/);
		expect(css).toMatch(/flex-direction:\s*column/);
		// NOT min-height: 0. The form has no overflow of its own, so a form allowed to shrink
		// below its rows would clip the last of them instead of letting .window-content scroll.
		expect(css).not.toMatch(/min-height:\s*0/);
	});

	it.each(FORMS)("%s pins its footer down rather than spacing it off the last row", (form) => {
		const css = declarations(CSS, `${form} .sheet-footer`);
		expect(css).toBeTruthy();
		expect(css).toMatch(/margin-top:\s*auto/);
		// The gap under the last row has to survive as padding: an auto margin is eaten by the
		// free space, so a margin-based gap would only appear on a window with no slack left.
		expect(css).toMatch(/padding-top:\s*\d/);
	});

	it.each(FORMS)("%s hands its direct children back automatic sizing", (form) => {
		const css = declarations(CSS, `${form} > *`);
		expect(css).toBeTruthy();
		expect(css).toMatch(/flex:\s*0\s+0\s+auto/);
		// And restates the row gap top-only, because a flex column stops core's `margin: 3px 0`
		// collapsing between rows — which silently loosens the list by 3px a row.
		expect(css).toMatch(/margin-block:\s*3px\s+0/);
	});

	it("has a hint sitting directly inside the map form, which is what that reset is for", () => {
		// If this stops being true the reset is still correct, but the reason above stops being
		// the reason — and the same shape is one edit away in either menu.
		expect(MAP_HBS).toMatch(/<form class="stonetop-map-pin-name-settings">[\s\S]*?<p class="notes"/);
	});

	it("ends both forms with the shared footer partial, which is what the rules key on", () => {
		for (const hbs of [HOVER_HBS, MAP_HBS]) {
			expect(hbs).toMatch(/\{\{>\s*"stonetop\.settings-save-footer"\s*\}\}\s*<\/form>/);
		}
		expect(stripComments(readRepo("templates/settings/partials/settings-save-footer.hbs")))
			.toMatch(/<footer class="sheet-footer/);
	});
});
