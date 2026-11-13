// A homebrew question that lists options to TICK and a write-in among them ("☐ The still night air …
// ☐ Something else") is drawn as a pick list, with nowhere to type. Its Next button followed the
// write-in all the same, so it never lit: a player could only Skip past it (live-tested 2026-11-12,
// the Stranger's "What keeps you tethered to this place? (choose 1 or 2)").

import { describe, it, expect } from "vitest";
import { CharacterOnboardingDialog } from "../../../module/actors/character/dialogs/CharacterOnboardingDialog.js";

function dialogWith(picks = {}, texts = {}) {
	const dialog = Object.create(CharacterOnboardingDialog.prototype);
	dialog._selections = { lore: { picks, texts } };
	return dialog;
}

const MIXED = {
	slug: "tethered",
	description: "What keeps you tethered to this place? (choose 1 or 2)",
	options: [
		{ slug: "tethered-1", description: "The still night air", max: 1 },
		{ slug: "tethered-2", description: "The howling of forest creatures", max: 1 },
		{ slug: "tethered-3", description: "Something else", type: "text" },
	],
};

describe("a list to tick with a write-in among its options", () => {
	it("is answered by its ticks: one of \"choose 1 or 2\" lets the player on", () => {
		expect(dialogWith({ "tethered:tethered-1": 1 })._isLoreSectionAnswered(MIXED)).toBe(true);
	});

	it("isn't answered with nothing ticked", () => {
		expect(dialogWith()._isLoreSectionAnswered(MIXED)).toBe(false);
	});

	it("leaves a page of nothing but written answers asking for its words", () => {
		const written = { slug: "place", description: "To what ancient place are you drawn?", options: [{ slug: "place-1", description: "Your answer", type: "text" }] };
		expect(dialogWith()._isLoreSectionAnswered(written)).toBe(false);
		expect(dialogWith({}, { "place:place-1": "The drowned tower" })._isLoreSectionAnswered(written)).toBe(true);
	});
});
