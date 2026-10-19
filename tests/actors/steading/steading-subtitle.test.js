import { describe, it, expect, vi } from "vitest";
import { StonetopSteading, steadingSubtitle, SIZE_HEADCOUNTS } from "../../../module/actors/steading/StonetopSteading.js";
import { readRepo as read, readCss, stripComments } from "../../fakes/css.js";

// The line under Stonetop's name ("Village · ~300 souls"). Each half follows Size until someone
// types over it, so a Township turning the village into a town moves only what nobody wrote.

describe("steadingSubtitle", () => {
	it("says what Book II prints for Stonetop on a fresh steading", () => {
		const s = steadingSubtitle({});
		expect(s.kind).toBe("Village");
		expect(s.headcount).toBe("~300 souls");
	});

	it("follows every Size while nothing is typed", () => {
		for (const [size, headcount] of Object.entries(SIZE_HEADCOUNTS)) {
			const s = steadingSubtitle({ size, kind: "", headcount: "" });
			expect(s.kind).toBe(size.charAt(0).toUpperCase() + size.slice(1));
			expect(s.headcount).toBe(headcount);
		}
	});

	it("keeps what was typed when Size moves, and moves only the other half", () => {
		const village = steadingSubtitle({ size: "village", kind: "Hilltop village", headcount: "" });
		expect(village.kind).toBe("Hilltop village");
		const town = steadingSubtitle({ size: "town", kind: "Hilltop village", headcount: "" });
		expect(town.kind).toBe("Hilltop village");
		expect(town.headcount).toBe(SIZE_HEADCOUNTS.town);
	});

	it("hands a cleared half back to Size", () => {
		const s = steadingSubtitle({ size: "town", kind: "   ", headcount: "" });
		expect(s.kind).toBe("Town");
		expect(s.typedKind).toBe("");
	});

	it("offers what Size would say as the defaults, whatever was typed", () => {
		const s = steadingSubtitle({ size: "hamlet", kind: "Camp", headcount: "a few dozen" });
		expect(s.kindDefault).toBe("Hamlet");
		expect(s.headcountDefault).toBe(SIZE_HEADCOUNTS.hamlet);
		expect(s.typedHeadcount).toBe("a few dozen");
	});
});

describe("the steading snapshot's subtitle", () => {
	const snapshot = steadingFlags => new StonetopSteading({
		type: "stonetop",
		system: {},
		flags: { stonetop: { steading: steadingFlags } },
		getFlag: (scope, key) => (scope === "stonetop-pwd" && key === "steading" ? steadingFlags : null),
		update: vi.fn(),
	}).buildSnapshot();

	it("reads the stored halves against the stored Size", async () => {
		const { subtitle } = await snapshot({ size: "town", headcount: "~1000 souls" });
		expect(subtitle.kind).toBe("Town");
		expect(subtitle.headcount).toBe("~1000 souls");
	});
});

describe("the steading header's subtitle markup", () => {
	const hbs = stripComments(read("templates/actor/steading.hbs"));

	it("edits under the Size pencil and reads as text otherwise", () => {
		expect(hbs).toContain("{{#if stonetop.edit.size}}");
		expect(hbs).toMatch(/data-field="kind"[\s\S]*?value="\{\{stonetop\.subtitle\.typedKind\}\}" placeholder="\{\{stonetop\.subtitle\.kindDefault\}\}"/);
		expect(hbs).toMatch(/data-field="headcount"[\s\S]*?value="\{\{stonetop\.subtitle\.typedHeadcount\}\}" placeholder="\{\{stonetop\.subtitle\.headcountDefault\}\}"/);
		expect(hbs).toContain("{{stonetop.subtitle.kind}}");
		expect(hbs).toContain("{{stonetop.subtitle.headcount}}");
	});

	it("saves each half through the sheet's listener", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain('ev.target.closest(".steading-subtitle-input")');
		expect(sheet).toContain("setFlags({ [field]: saysWhatSizeSays ? \"\" : value })");
	});

	it("stores what Size already says as blank, so a later Size change still moves it", () => {
		const sheet = read("module/actors/steading/StonetopSteadingSheet.js");
		expect(sheet).toContain("value.toLowerCase() === inp.placeholder.trim().toLowerCase()");
	});

	it("shows the inputs' edges whenever they are there, not only on hover", () => {
		const css = readCss();
		const rule = css.match(/\.app\.steading \.window-content input\.steading-subtitle-input \{([^}]*)\}/);
		expect(rule, "subtitle input rule").not.toBeNull();
		expect(rule[1]).toContain("border: 1px solid rgb(var(--st-ink-rgb) / 0.35)");
		expect(rule[1]).not.toContain("transparent");
	});
});
