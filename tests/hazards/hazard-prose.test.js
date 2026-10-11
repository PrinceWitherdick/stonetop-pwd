import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { plainTextToHtml, htmlToPlainText, asCardHtml } from "../../module/journal/card-vm.js";
import { buildHazardCardVM } from "../../module/hazards/hazard-view.js";
import { CreateHazardDialog } from "../../module/hazards/create-hazard-dialog.js";
import { ThreatEditorDialog } from "../../module/threats/threat-editor-dialog.js";

// The hazard wizard and the threat editor's custom-move rows are textareas over HTML fields. The
// Book I p.388 sample move is the case that broke: written on several lines, it drew as one
// run-on block, and a "<" in it opened a tag.
const FALL_MOVE = "When you fall from the boughs of the tree, take 1d10+3 damage (ignores armor, forceful) and roll +CON:\n"
	+ "on a 10+, you're bruised and bleeding;\non a 7-9, something's broken;\n\non a 6-, you're at Death's Door (HP < 1).";

describe("plain text stored in an HTML field", () => {
	it("keeps paragraphs and line breaks, and escapes markup", () => {
		const html = plainTextToHtml(FALL_MOVE);
		expect(html).toBe(
			"<p>When you fall from the boughs of the tree, take 1d10+3 damage (ignores armor, forceful) and roll +CON:<br>"
			+ "on a 10+, you&#x27;re bruised and bleeding;<br>on a 7-9, something&#x27;s broken;</p>"
			+ "<p>on a 6-, you&#x27;re at Death&#x27;s Door (HP &lt; 1).</p>");
		expect(plainTextToHtml("   ")).toBe("");
	});

	it("reads back as the same clean text", () => {
		expect(htmlToPlainText(plainTextToHtml(FALL_MOVE))).toBe(FALL_MOVE);
	});

	it("shows rich HTML from elsewhere as clean text, not tags", () => {
		expect(htmlToPlainText("<p>The pillar <strong>cracks</strong>.</p>\n<p>Dust &amp; stone fall.</p>"))
			.toBe("The pillar cracks.\n\nDust & stone fall.");
	});

	it("leaves legacy plain text alone, and draws it with its breaks", () => {
		const legacy = "Pillars creak.\nDust pours down.";
		expect(htmlToPlainText(legacy)).toBe(legacy);
		expect(asCardHtml(legacy)).toBe("<p>Pillars creak.<br>Dust pours down.</p>");
		expect(asCardHtml("<p>Already HTML</p>")).toBe("<p>Already HTML</p>");
	});
});

describe("hazard card prose", () => {
	const page = (system) => ({ id: "h1", uuid: "JournalEntry.e.JournalEntryPage.h1", name: "Unstable pillars", isOwner: true, system });

	it("draws a hazard saved before the fix with its line breaks", async () => {
		const vm = await buildHazardCardVM(page({
			description: "Three pillars hold the roof.\nA fourth has fallen.",
			customPlayerMoves: [{ label: "Fall", text: "Roll +CON:\non a 6-, Death's Door" }],
		}));
		expect(vm.description).toBe("<p>Three pillars hold the roof.<br>A fourth has fallen.</p>");
		expect(vm.customPlayerMoves[0].text).toBe("<p>Roll +CON:<br>on a 6-, Death&#x27;s Door</p>");
	});
});

describe("hazard wizard round trip", () => {
	it("saves textarea prose as paragraphs and re-opens it as clean text", () => {
		const fresh = new CreateHazardDialog();
		fresh._sel.description = "A cracked roof.\n\nCrinwin nest round the pillars.";
		fresh._sel.playerMoves = [{ label: "When you fall", text: FALL_MOVE }];
		const seed = fresh._seed();
		expect(seed.description).toBe("<p>A cracked roof.</p><p>Crinwin nest round the pillars.</p>");
		expect(seed.customPlayerMoves[0].text).toContain("HP &lt; 1");

		const edit = new CreateHazardDialog({ page: { id: "h2", name: "Pillars", system: {
			description: seed.description, customPlayerMoves: seed.customPlayerMoves,
		} } });
		expect(edit._sel.description).toBe("A cracked roof.\n\nCrinwin nest round the pillars.");
		expect(edit._sel.playerMoves[0].text).toBe(FALL_MOVE);
	});
});

// Flattening the page's rich HTML to a textarea is lossy, so an edit that leaves a text as it
// was (changing only the damage die, say) hands the stored HTML back untouched.
describe("hazard wizard edit keeps unedited rich text", () => {
	const RICH = "<p>The pillar <strong>cracks</strong>; see @UUID[JournalEntry.x]{Crinwin}.</p>";
	const RICH_MOVE = "<p>Roll <em>+CON</em>.</p>";

	it("keeps the stored HTML of a field left unedited, and stores an edited one afresh", () => {
		const edit = new CreateHazardDialog({ page: { id: "h3", name: "Pillars", system: {
			description: RICH, customPlayerMoves: [{ label: "Fall", text: RICH_MOVE }],
		} } });
		edit._sel.damageDie = "d10";
		let seed = edit._seed();
		expect(seed.description).toBe(RICH);
		expect(seed.customPlayerMoves[0].text).toBe(RICH_MOVE);

		edit._sel.description = "Only dust now.";
		seed = edit._seed();
		expect(seed.description).toBe("<p>Only dust now.</p>");
		expect(seed.customPlayerMoves[0].text).toBe(RICH_MOVE);
	});

	it("keeps a threat move's stored HTML when its row was left as it was", () => {
		const page = { id: "t2", name: "Sajra", system: { type: "villain", customPlayerMoves: [{ label: "Fall", text: RICH_MOVE }] } };
		const dialog = new ThreatEditorDialog(page);
		const row = { querySelector: sel => ({ value: sel.includes('"label"') ? "Fall" : htmlToPlainText(RICH_MOVE) }) };
		const list = { dataset: {}, querySelectorAll: () => [row] };
		const root = { querySelector: () => list };
		expect(dialog._collectList(root, "customPlayerMoves")).toEqual([{ label: "Fall", text: RICH_MOVE }]);
	});
});

describe("threat editor custom-move rows", () => {
	it("shows stored HTML as clean text and stores the textarea back as paragraphs", async () => {
		const stored = plainTextToHtml(FALL_MOVE);
		const page = { id: "t1", name: "Sajra", system: { type: "villain", customPlayerMoves: [{ label: "Fall", text: stored }] } };
		const dialog = new ThreatEditorDialog(page);
		const data = await dialog.getData();
		expect(data.customPlayerMoves[0].text).toBe(FALL_MOVE);

		const row = { querySelector: sel => ({ value: sel.includes('"label"') ? "Fall" : FALL_MOVE }) };
		const list = { dataset: {}, querySelectorAll: () => [row] };
		const root = { querySelector: () => list };
		expect(dialog._collectList(root, "customPlayerMoves")).toEqual([{ label: "Fall", text: stored }]);
	});
});

describe("hazard page model header", () => {
	// The model's own comment described the retired one-entry-per-hazard folder and a player
	// reveal; hazards are pages of one NONE-owned journal with no reveal.
	it("describes the single-journal, no-reveal storage", () => {
		const src = readFileSync(new URL("../../module/journal/HazardPageModel.js", import.meta.url), "utf8");
		expect(src).not.toMatch(/per-steading folder|reveal = the ENTRY/);
		expect(src).toMatch(/ONE "<Steading> Hazards" JournalEntry/);
	});
});
