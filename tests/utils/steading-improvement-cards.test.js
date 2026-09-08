import { describe, it, expect } from "vitest";
import { describeLocal, loadLocal } from "../local-only.js";
import { readImprovementCard, renderImprovementCardHtml, STEADING_IMPROVEMENT_DRAG_TYPE } from "../../module/journal/steading-improvement-cards.js";
import { buildImprovementDef } from "../../module/utils/improvement-def.js";

// sectionHtml / renderSteadingImprovementCard come from the local-only generator; the
// readImprovementCard suite below tests the shipped module and runs everywhere.
const gazetteer = await loadLocal(() => import("../../scripts/local/shared/gazetteer.mjs"));
const describeGen = describeLocal(gazetteer);
const { sectionHtml, renderSteadingImprovementCard } = gazetteer ?? {};

// Decode the data-steading-improvement attribute the way the browser would, then
// JSON.parse it back into the structured definition.
function payloadFrom(html) {
	const m = html.match(/data-steading-improvement="([^"]*)"/);
	if (!m) return null;
	const json = m[1]
		.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
	return JSON.parse(json);
}

/** The visible half of a card, with the payload attribute (escaped JSON) taken off. */
function bodyOf(html) {
	return html.replace(/ data-steading-improvement="[^"]*"/, "");
}

const DEF = {
	name: "ROADBUILDING",
	flavor: "A grand road.",
	sections: [{ heading: "Requires all of the following:", items: ["Unlock the runes", "*Pull Together* a crew"] }],
	effect: "When you mark all the requirements, you can repair the Roads.",
};

describeGen("renderSteadingImprovementCard", () => {
	it("builds a draggable card carrying the definition as escaped JSON", () => {
		const html = renderSteadingImprovementCard(DEF);
		expect(html).toContain('class="stonetop-journal-improvement"');
		expect(html).toContain('draggable="true"');
		expect(html).toContain('<span class="stonetop-journal-improvement-name">ROADBUILDING</span>');
		expect(html).toContain('<li class="check-bullet">Unlock the runes</li>');
		// Light markdown is processed into HTML for both body and payload.
		expect(html).toContain("<em>Pull Together</em>");

		const payload = payloadFrom(html);
		expect(payload.name).toBe("ROADBUILDING");
		expect(payload.sections[0].items).toEqual(["Unlock the runes", "<em>Pull Together</em> a crew"]);
		expect(payload.effect).toContain("repair the Roads");
	});
});

describeGen("sectionHtml steading-improvement swap", () => {
	const lines = [
		"Some lead-in prose about the place.",
		"",
		"**. steading improvement .**",
		"",
		"**ROADBUILDING** Requires all of the following:",
		"",
		"- Unlock the runes",
		"- Recruit a crew",
		"",
		"When you mark all the requirements, you can repair the Roads.",
		"",
		"Henceforth, the Roads can be extended.",
	];

	it("swaps the marker block for one card and drops the raw improvement prose", () => {
		const out = sectionHtml(lines, [DEF]);
		// The lead-in prose survives.
		expect(out).toContain("Some lead-in prose about the place.");
		// Exactly one card, built from the manifest (not the messy source bullets).
		expect((out.match(/stonetop-journal-improvement"/g) || []).length).toBe(1);
		expect(out).toContain('<span class="stonetop-journal-improvement-name">ROADBUILDING</span>');
		// No leftover marker text or raw requirement/effect prose.
		expect(out).not.toContain("steading improvement .");
		expect(out).not.toContain("Henceforth, the Roads can be extended.");
	});

	it("leaves the prose untouched when no manifest entry is queued", () => {
		const out = sectionHtml(lines, []);
		expect(out).not.toContain("stonetop-journal-improvement");
		expect(out).toContain("Henceforth, the Roads can be extended.");
	});

	it("resumes normal parsing for unrelated content after the effect", () => {
		const withTrailing = [...lines, "", "- An unrelated artifact bullet"];
		const out = sectionHtml(withTrailing, [DEF]);
		expect(out).toContain("An unrelated artifact bullet");
	});
});

describe("readImprovementCard", () => {
	it("parses a card element's definition, or returns null when malformed/missing", () => {
		const ok = { dataset: { steadingImprovement: JSON.stringify(DEF) } };
		expect(readImprovementCard(ok).name).toBe("ROADBUILDING");

		expect(readImprovementCard({ dataset: { steadingImprovement: "not json" } })).toBeNull();
		expect(readImprovementCard({ dataset: {} })).toBeNull();
		expect(readImprovementCard(null)).toBeNull();
	});

	it("exposes the drag payload type", () => {
		expect(STEADING_IMPROVEMENT_DRAG_TYPE).toBe("StonetopSteadingImprovement");
	});
});

describe("renderImprovementCardHtml", () => {
	it("carries the authored category in the payload so a dropped card lands under its chip", () => {
		const payload = payloadFrom(renderImprovementCardHtml({ ...DEF, category: "wall" }));
		expect(payload.category).toBe("wall");
		expect(payload.name).toBe("ROADBUILDING");
	});

	it("emits an empty category when none was chosen", () => {
		expect(payloadFrom(renderImprovementCardHtml(DEF)).category).toBe("");
	});

	// A definition's heading, items and effect are already HTML (buildImprovementDef escaped
	// them and resolved their *asterisks*), and both readers paint them unescaped. Escaping
	// them a second time here put the tag source itself on the card.
	it("paints the already-marked-up fields rather than escaping them again", () => {
		const html = renderImprovementCardHtml(buildImprovementDef(DEF));
		expect(html).toContain(`<li class="check-bullet"><em>Pull Together</em> a crew</li>`);
		// The payload attribute legitimately carries `&lt;em&gt;` (the whole JSON is escaped
		// for the double-quoted attribute and decoded on read), so only the visible half of
		// the card can say that no tag source leaked into the prose.
		expect(bodyOf(html)).not.toContain("&lt;em&gt;");
	});

	// `name` and `flavor` ARE plain text, and the steading tab escapes them itself on the way
	// out. Escaping them into the payload as well is what used to leave a literal `&#x27;` in
	// the flavor line of every dropped card.
	it("escapes the plain fields for display only, never into the payload", () => {
		const html = renderImprovementCardHtml({ ...DEF, flavor: "It's a long walk." });
		expect(html).toContain("It&#x27;s a long walk.");
		expect(payloadFrom(html).flavor).toBe("It's a long walk.");
	});
});
