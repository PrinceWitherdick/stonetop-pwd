import { describe, it, expect } from "vitest";
import { withMarkOptionList } from "../../../module/actors/character/mark-option-list.js";

// Where a move is chosen (creation, Level Up) its mark options have no boxes yet, so its card lists
// them under the words that lead into them; on the sheet they are the boxes, and listed once.
describe("a move's mark options on a card it is chosen from", () => {
	it("go under the words that lead into them, escaped; a stat choice is not one to list", () => {
		expect(withMarkOptionList("<p>Something. Mark one:</p><p>While so, roll.</p>", [{ label: "A & b" }, { label: "C" }, { label: "S", choice: "stat" }]))
			.toBe("<p>Something. Mark one:</p><ul><li>A &amp; b</li><li>C</li></ul><p>While so, roll.</p>");
	});

	it("go last when no words lead into them", () => {
		expect(withMarkOptionList("<p>Each time you take this move, pick 1</p>", [{ label: "A" }])).toBe("<p>Each time you take this move, pick 1</p><ul><li>A</li></ul>");
	});

	it("aren't listed twice: words that name every one already are left alone, as is a move without any", () => {
		expect(withMarkOptionList("<p>Pick:</p><ul><li>A</li></ul>", [{ label: "A" }])).toBe("<p>Pick:</p><ul><li>A</li></ul>");
		expect(withMarkOptionList("<p>x</p>", [])).toBe("<p>x</p>");
		expect(withMarkOptionList(null, null)).toBe("");
	});

	it("read entities and curly quotes as the words they are, so a list already there isn't added again", () => {
		const html = "<p>Mark one:</p><ul><li>Salt &amp; iron</li><li>The witch&rsquo;s&nbsp;eye</li></ul>";
		expect(withMarkOptionList(html, [{ label: "Salt & iron" }, { label: "The witch's eye" }])).toBe(html);
	});

	it("go under the mark lead-in, not a roll's \"choose\" that comes first", () => {
		expect(withMarkOptionList("<p>On a 10+, choose 2:</p><ul><li>x</li></ul><p>Mark one:</p>", [{ label: "A" }]))
			.toBe("<p>On a 10+, choose 2:</p><ul><li>x</li></ul><p>Mark one:</p><ul><li>A</li></ul>");
		// With only a roll's lead-in, the list goes last.
		expect(withMarkOptionList("<p>On a 7-9, choose 1:</p><ul><li>x</li></ul>", [{ label: "A" }]))
			.toBe("<p>On a 7-9, choose 1:</p><ul><li>x</li></ul><ul><li>A</li></ul>");
	});
});
