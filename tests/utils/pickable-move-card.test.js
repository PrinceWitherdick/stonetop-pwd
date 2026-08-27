import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { moveChatCard, pickableMoveDescription } from "../../module/utils/chat.js";
import { formatCustomMoveDescription } from "../../module/utils/custom-move-text.js";

// A move that ROLLS makes its choice on the result card, once the dice have said how many. A
// move that never rolls — Mighty Thews' "pick 1", Keep Company's questions, Censure's four
// reactions — has no result card, so its choice belongs on the card its text is posted to.
//
// This is the fix for a real hole: the sheet used to carry 24 hand-written copies of those very
// lists, in a dialog that could never open (a move with no rollType renders no dice icon, and
// nothing else reached the guide table). The lists here are the MOVE'S OWN, read out of its
// printed description, so there is no second copy to drift.

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CENSURE = "<p>When you <strong>denounce</strong> someone, they pick 1:</p>"
	+ "<ul><li>They are <em>ashamed</em></li><li>They are doubtful</li></ul>";

describe("pickableMoveDescription", () => {
	it("turns the move's first option list into indexed checkboxes", () => {
		const html = pickableMoveDescription(CENSURE);
		expect(html).toContain('<ul class="stonetop-picklist"');
		expect(html).toContain('class="stonetop-check stonetop-picklist-check" data-index="0"');
		expect(html).toContain('data-index="1"');
		expect(html).not.toContain('data-index="2"');
		// The prose above the list is untouched.
		expect(html).toContain("<strong>denounce</strong>");
	});

	it("keeps each option's own markup", () => {
		// An option can carry the move's ◇/○/□ glyphs and emphasis; a text-only rewrite would
		// flatten them, and the description is rendered raw precisely so they survive.
		expect(pickableMoveDescription(CENSURE)).toContain("<span>They are <em>ashamed</em></span>");
	});

	it("leaves a move with no list exactly as it was", () => {
		const plain = "<p>You are hard to kill.</p>";
		expect(pickableMoveDescription(plain)).toBe(plain);
	});

	it("ticks only the FIRST list — a second one is a note about the options, not more of them", () => {
		const two = "<p>Pick 1:</p><ul><li>A</li></ul><p>Also:</p><ul><li>B</li></ul>";
		const html = pickableMoveDescription(two);
		expect((html.match(/stonetop-picklist-check/g) ?? []).length).toBe(1);
		expect(html).toContain("<ul><li>B</li></ul>");
	});

	it("leaves a nested list alone rather than cutting it in half", () => {
		// The non-greedy <ul> match closes on the INNER </ul>, so converting would emit an
		// unbalanced outer list. Better untouched than broken.
		const nested = "<ul><li>A<ul><li>A1</li></ul></li></ul>";
		expect(pickableMoveDescription(nested)).toBe(nested);
	});

	it("is idempotent — a description already ticked is left alone", () => {
		const once = pickableMoveDescription(CENSURE);
		expect(pickableMoveDescription(once)).toBe(once);
	});

	it("does nothing for a list with no items", () => {
		const empty = "<p>Nothing:</p><ul></ul>";
		expect(pickableMoveDescription(empty)).toBe(empty);
	});

	// A player-authored move's description is escaped at storage into <p>/<br> only
	// (utils/custom-move-text.js#formatCustomMoveDescription), so it can carry no list to tick
	// and no markup to inject through the <li> rewrite — which keeps the item's inner HTML raw.
	it("has nothing to act on in a player-authored description", () => {
		const authored = formatCustomMoveDescription("Pick 1:\n<ul><li>evil</li></ul>");
		expect(authored).not.toContain("<ul>");
		expect(pickableMoveDescription(authored)).toBe(authored);
		expect(pickableMoveDescription(authored)).not.toContain("stonetop-picklist");
	});
});

describe("moveChatCard", () => {
	it("only ticks when asked — a receipt card must not offer choices", () => {
		expect(moveChatCard("Censure", CENSURE)).not.toContain("stonetop-picklist");
		expect(moveChatCard("Censure", CENSURE, { pickable: true })).toContain("stonetop-picklist");
	});

	it("escapes the move name either way (a custom move's name is player-authored)", () => {
		for (const opts of [undefined, { pickable: true }]) {
			expect(moveChatCard("<img src=x>", CENSURE, opts)).toContain("&lt;img src=x&gt;");
		}
	});
});

describe("who asks for ticks", () => {
	const SHEET = read("module/actors/character/StonetopCharacterSheet.js");

	// Exactly the two places that post a move's PRINTED TEXT. Everything else moveChatCard
	// serves is a receipt ("Readiness lost", "Follower Down"), where a checkbox would be an
	// offer to change something that has already happened.
	it("is only the two name-click paths", () => {
		expect((SHEET.match(/pickable: true/g) ?? []).length).toBe(2);
		// Both also carry the Stock Spend button (see stock-cost.test.js) — one call each.
		expect(SHEET).toContain("moveChatCard(name, description, { pickable: true, actions: this._stockSpendButtonHtml(description) })");
		expect(SHEET).toContain('this._postMoveCard(doc.name, doc.system?.description ?? "", { pickable: true, stockSpend: true })');
	});

	// A move that ROLLS gets the same treatment on its result card's description — one rule for
	// every move, rather than a second way of showing the same list.
	it("and the roll card's description, through the item", () => {
		const item = read("module/item/StonetopItem.js");
		expect(item).toContain("pickableMoveDescription(moveDescription)");
		expect(item).toContain("moveDescription: cardDescription");
	});

	// Skipped when the move names its own pool: that renders as its own checklist, and a second
	// list in the description would start its data-index at 0 again and scramble the saved ticks.
	it("but not on a move that names its own pool", () => {
		const item = read("module/item/StonetopItem.js");
		const at = item.indexOf("const cardDescription");
		expect(at).toBeGreaterThan(-1);
		expect(item.slice(at, at + 160)).toContain("declaredPicks.length");
	});

	// The boxes are wired by the shared roll-card handler, which finds any .stonetop-picklist-check
	// in the message — so every one of these persists its ticks the same way, with no second
	// wiring pass to keep in step.
	it("rides the roll card's own wiring", () => {
		const stonetop = read("stonetop.js");
		expect(stonetop).toContain('html.querySelectorAll(".stonetop-picklist-check")');
		expect(stonetop).toContain("_chatWireRollCardPicks(message, html);");
	});

	// The checklist has to be styled in all three homes, or a move card's options render as
	// core's bare bullets with a stray checkbox beside them.
	it("is styled in every place it can appear", () => {
		const css = read("styles/stonetop.css");
		const homes = ":is(.stonetop-roll-card-picklist, .stonetop-chat-move-description, .stonetop-roll-card-description)";
		// The four rules that shape an item: the list, the row, its label, and the picked state.
		for (const part of [".stonetop-picklist ", ".stonetop-picklist-item ", ".stonetop-picklist-item label", ".stonetop-picklist-item.is-picked"]) {
			expect(css, part).toContain(`${homes} ${part}`);
		}
		// …and the spiral marker a description hangs off every <li> is dropped where the
		// checkbox now sits, in both description homes.
		expect(css).toContain(":is(.stonetop-chat-move-description, .stonetop-roll-card-description) .stonetop-picklist-item::before");
	});
});
