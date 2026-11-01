import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Post-death copy that has to agree with the book (Book I pp.244-245) or with what the sheet does.
// Audit round 3, 2026-10-28: TX-2 to TX-7.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("languages/en.json"));
const key = dotted => dotted.split(".").reduce((n, k) => n?.[k], en);

describe("post-death copy", () => {
	it("the Thrall fate's hint follows the book: with no Thing Below met, maybe you can Know Things", () => {
		const hint = key("stonetop.specialMoves.deathsDoor.fates.thrall.hint");
		expect(hint).toContain("Know Things");
		expect(hint).not.toContain("can't call on one");
	});

	it("Choose Your Fate names every route to an insert, not only refusing to go", () => {
		const hint = key("stonetop.postDeath.chooseFateHint");
		expect(hint).toContain("called on a Thing Below");
		expect(hint).toContain("Blackwater Lake");
		expect(hint).toContain("Pale Hunter");
	});

	it("the Crossed Off hint names Favor's overflow as well as Dark Succor", () => {
		const hint = key("stonetop.postDeath.crossedOffHint");
		expect(hint).toContain("Dark Succor");
		expect(hint).toMatch(/Favor overflowed/);
	});

	it("the Gain a Mark hint sends an overflowing Favor to the +1 Favor button", () => {
		expect(key("stonetop.postDeath.outcomes.gainMarkHint")).toContain("press +1 Favor instead");
	});

	it("Death's Door says (describe them), as the book prints it, everywhere the move's text lives", () => {
		const places = {
			"en.json": key("stonetop.specialMoves.deathsDoor.description"),
			"pack source": JSON.parse(read("packs/src/stonetop-items/special-moves/deaths-door.json")).system.description,
			"reference journal": read("packs/src/stonetop-journals/reference-journals/moves.json"),
			"data export": read("data/special-moves.json"),
		};
		for (const [where, text] of Object.entries(places)) {
			expect(text, where).toContain("Lady of Crows (describe them)");
			expect(text, where).not.toContain("Lady of Crows (describe it)");
		}
	});

	it("the Undeath dialog's empty choice reads Choose one, with no dashes", () => {
		const hbs = read("templates/dialogs/undeath.hbs");
		expect(hbs).toContain('<option value="">Choose one</option>');
		expect(hbs).not.toContain("&mdash; choose &mdash;");
	});
});
