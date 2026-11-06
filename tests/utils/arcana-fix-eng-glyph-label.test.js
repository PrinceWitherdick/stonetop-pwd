// @vitest-environment happy-dom
// A7 (arcana audit 2026-11-04): a glyph run inside <span class="stonetop-glyph-label"> is display only.
// It still draws as a glyph, but it is never a checkbox and never counted for any box index.
import { describe, it, expect } from "vitest";
import {
	boxIndexBefore, centerArcanumTracks, injectGlyphCheckboxes, maskGlyphLabels, unmaskGlyphLabels,
	wrapStonetopGlyphsInEl,
} from "../../module/utils/glyphs.js";
import {
	consequenceBoxRange, consequenceLabel, unlockChoiceSection, unlockCircleCount,
} from "../../module/actors/character/CharacterArcana.js";
import { frontTaskMarkers, frontTaskTrack, seekerMajorTrack } from "../../module/actors/character/seeker-collection.js";
import { consequenceParents, unmarkedConsequences } from "../../module/actors/character/arcana-seeker-moves.js";
import { parseArcanumMoves } from "../../module/data/arcana-moves.js";

const label = g => `<span class="stonetop-glyph-label">${g}</span>`;

describe("maskGlyphLabels", () => {
	it("hides the glyphs inside a label span and keeps the length", () => {
		const html = `<p>Loyalty ${label("○○○")} then ○○</p>`;
		const masked = maskGlyphLabels(html);
		expect(masked.length).toBe(html.length);
		expect((masked.match(/○/g) || []).length).toBe(2);
		expect(unmaskGlyphLabels(masked)).toBe(html);
	});

	it("is the text itself when no label is present", () => {
		expect(maskGlyphLabels("<p>□ ○○</p>")).toBe("<p>□ ○○</p>");
		expect(maskGlyphLabels(null)).toBe("");
	});
});

describe("injectGlyphCheckboxes skips label glyphs", () => {
	it("gives no checkbox and no index to a label run", () => {
		const html = `<p>Loyalty ${label("○○○")}</p><p>Charges ○○</p>`;
		const { html: out, count } = injectGlyphCheckboxes(html, /○{2,}/g, {
			slug: "x", context: "backCircle", cssClass: "c", isChecked: () => false,
		});
		expect(count).toBe(2);
		expect(out).toContain(label("○○○"));
		expect([...out.matchAll(/data-index="(\d+)"/g)].map(m => m[1])).toEqual(["0", "1"]);
	});

	it("leaves a label run off the centred track line", () => {
		const html = `<p>Loyalty ${label("○○○")}</p>`;
		expect(centerArcanumTracks(`<p>Loyalty ○○○</p>`)).toContain("stonetop-arcanum-track");
		expect(centerArcanumTracks(html)).toBe(html);
	});

	it("still draws the label's glyphs as styled glyphs", () => {
		const root = document.createElement("div");
		root.innerHTML = `<p>Loyalty ${label("○○○")}</p>`;
		wrapStonetopGlyphsInEl(root);
		expect(root.querySelectorAll(".stonetop-glyph-label .stonetop-glyph--circle").length).toBe(3);
	});
});

describe("counters skip label glyphs", () => {
	it("unlockCircleCount", () => {
		expect(unlockCircleCount(`${label("○")} ○○ When you mark the last`)).toBe(2);
	});

	it("boxIndexBefore", () => {
		const back = `<p>${label("□")} a note</p><p>□ GREATER CONDUIT</p>`;
		expect(boxIndexBefore(back, "GREATER CONDUIT")).toBe(0);
	});

	it("consequenceBoxRange, consequenceLabel, consequenceParents, unmarkedConsequences", () => {
		const back = `<p>${label("□")} aside □ MOVE</p><h3>Consequences</h3><ul><li>□ Lose 1 HP</li><li>□ Go blind</li></ul>`;
		expect(consequenceBoxRange(back)).toEqual({ from: 1, to: 3 });
		expect(consequenceLabel(back, 1)).toBe("Lose 1 HP");
		expect(consequenceParents(back).size).toBe(0);
		expect(unmarkedConsequences(back, {}, "s").map(c => c.index)).toEqual([1, 2]);
	});

	it("unlockChoiceSection", () => {
		const unlock = "○○ Each time you make a mark, choose one of the Codex Spells (see reverse)";
		const back = `<p>${label("□")}</p><h3>Spells of the Codex</h3><p>□ <strong>Call Up the Dead</strong></p>`;
		const section = unlockChoiceSection(unlock, back);
		expect(section.choices).toEqual([{ index: 0, label: "Call Up the Dead" }]);
	});

	it("frontTaskMarkers, frontTaskTrack and seekerMajorTrack", () => {
		const front = {
			description: `<ul><li>□ Find the heart ${label("◇")}</li><li>Note ${label("□")}</li><li>□ Find the helm</li></ul>`,
			unlock: { description: `When you've completed all the requirements ${label("○")}` },
		};
		expect(frontTaskMarkers(front.description).map(m => m.label)).toEqual(["Find the heart ◇", "Find the helm"]);
		expect(frontTaskTrack(front)?.needed).toBe(2);
		expect(seekerMajorTrack(front).kind).toBe("box");
	});

	it("parseArcanumMoves boxIndex", () => {
		const back = `<p>${label("□")} aside</p><h3>Moves</h3><p><strong>□ STORM CALL</strong><br>When you call the storm, roll +WIS.</p>`;
		const [move] = parseArcanumMoves(back);
		expect(move?.boxIndex).toBe(0);
	});
});
