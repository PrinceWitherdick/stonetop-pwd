import { describe, it, expect } from "vitest";
import { EMPTY_PREVIEW_HTML, improvementPreviewHtml } from "../../module/utils/improvement-preview.js";
import { buildImprovementDef, sectionsFromGroups } from "../../module/utils/improvement-def.js";
import { IMPROVEMENT_DEFINITIONS, IMPROVEMENT_GRANTS } from "../../module/actors/steading/StonetopSteading.js";
import { readRepo } from "../fakes/css.js";

// The builder's Preview panel: the improvement card as the Improvements tab will draw it,
// from the definition alone. It exists because everything the builder authors is invisible
// until it has been saved somewhere, so the "or" divider, the written-for-you headings and
// the boxes a repeat expands into were all things you found out about afterwards.

const tab = readRepo("templates/actor/partials/steading-tab-improvements.hbs");

const DEF = buildImprovementDef({
	name: "Roads & Bridges",
	flavor: "It's a long walk to Marshedge.",
	effect: "Increase Prosperity by 1.",
	sections: sectionsFromGroups([
		{ heading: "Requires either this:", rows: [{ text: "A surveyor" }] },
		{ rows: [{ text: "*Pull Together*", repeat: 2 }], alternative: true },
	]),
	grants: { stats: { prosperity: 1 } },
});

describe("improvementPreviewHtml", () => {
	it("says what is missing rather than drawing an empty card", () => {
		expect(improvementPreviewHtml({})).toBe(EMPTY_PREVIEW_HTML);
		expect(improvementPreviewHtml(null)).toBe(EMPTY_PREVIEW_HTML);
	});

	it("draws one check-off box per requirement, inert", () => {
		const html = improvementPreviewHtml(DEF);
		expect(html.match(/<input type="checkbox" disabled>/g)).toHaveLength(4); // 3 requirements + complete
		expect(html).toContain("<em>Pull Together</em> (1st)");
		expect(html).toContain("<em>Pull Together</em> (2nd)");
	});

	it("draws the heading written for a group that was left blank", () => {
		expect(improvementPreviewHtml(DEF)).toContain("Or all of these:");
	});

	it("draws the divider above a group that is an alternative rather than a further requirement", () => {
		expect(improvementPreviewHtml(DEF)).toContain(`<p class="steading-req-or">or</p>`);
	});

	// The split that is easy to get backwards, and the reason a preview is worth having at
	// all: name and flavor are plain text on a definition and escaped for display, while a
	// heading, an item and the effect are already HTML and are painted as they are.
	it("escapes the plain fields and paints the marked-up ones", () => {
		const html = improvementPreviewHtml(DEF);
		expect(html).toContain("Roads &amp; Bridges");
		expect(html).toContain("It&#x27;s a long walk to Marshedge.");
		expect(html).toContain("<em>Pull Together</em>");
	});

	it("names what the sheet will apply by itself, and says so when it is nothing", () => {
		expect(improvementPreviewHtml(DEF)).toContain("<strong>On completion:</strong> Prosperity +1");
		expect(improvementPreviewHtml({ ...DEF, grants: null })).toContain("the effect is prose only");
	});

	// The preview borrows the Improvements tab's own (unscoped) rules rather than owning a
	// look of its own, so a class name that drifts apart from the tab is a preview that has
	// silently stopped previewing.
	it("uses the same class names the Improvements tab paints its card with", () => {
		const html = improvementPreviewHtml(DEF);
		for (const name of [
			"steading-improvement", "steading-improvement-header", "steading-improvement-summary",
			"steading-improvement-title", "steading-improvement-flavor", "steading-improvement-body",
			"steading-req-or", "steading-req-heading", "steading-req-list", "steading-req-item",
			"steading-improvement-effect",
		]) {
			expect(html, name).toContain(name);
			expect(tab, name).toContain(name);
		}
		// The tab's cards collapse to their header until clicked; a preview must not.
		expect(html).toContain("steading-improvement is-open");
		expect(tab).toContain("is-open");
	});

	it("draws one of the book's own improvements the way the book prints it", () => {
		const def = IMPROVEMENT_DEFINITIONS.find(d => d.slug === "weaponsOfWar");
		const html = improvementPreviewHtml({ ...def, name: def.label, grants: IMPROVEMENT_GRANTS[def.slug] });
		expect(html).toContain("Requires either this:");
		expect(html).toContain(`<p class="steading-req-or">or</p>`);
		expect(html).toContain("Or all of these:");
		expect(html).toContain("Defenses +1");
		expect(html).toContain("Fortifications: Weapons of War");
	});
});
