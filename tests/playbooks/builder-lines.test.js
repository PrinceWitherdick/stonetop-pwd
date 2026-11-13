import { describe, it, expect } from "vitest";
import * as L from "../../module/playbooks/builder-lines.js";

// Each box must give back what it was given: data -> text -> data is the identity, so opening and
// saving the builder never changes a playbook nobody edited.
describe("the builder's one-per-line boxes", () => {
	it("instincts: 'Word: meaning', a bare word allowed", () => {
		const data = [{ word: "Freedom", description: "To chafe against rules." }, { word: "Mystery", description: "" }];
		expect(L.parseInstinctLines(L.instinctLines(data))).toEqual(data);
		expect(L.parseInstinctLines("  Duty : To do what's required: always \n\n")).toEqual([{ word: "Duty", description: "To do what's required: always" }]);
	});

	it("appearance: one row per line, choices by comma", () => {
		const data = [["young pup", "\"responsible\" adult"], ["lithe", "heavyset"]];
		expect(L.parseAppearanceLines(L.appearanceLines(data))).toEqual(data);
	});

	it("origins: 'Region: names', a region with no names kept", () => {
		const data = [{ region: "Stonetop", names: ["Aderyn", "Braith"] }, { region: "Gordin's Delve", names: [] }];
		expect(L.parseOriginLines(L.originLines(data))).toEqual(data);
	});

	it("either/or picks split on '/' or the book's capital OR, never a lowercase 'or'", () => {
		expect(L.parseChoiceLines("Ambush OR Skill at Arms\nDanger Sense / Perceptive\nHold or Fold")).toEqual([
			{ label: "Choose one", options: ["Ambush", "Skill at Arms"] },
			{ label: "Choose one", options: ["Danger Sense", "Perceptive"] },
		]);
		const data = [{ label: "Choose one", options: ["A", "B", "C"] }];
		expect(L.parseChoiceLines(L.choiceLines(data))).toEqual(data);
	});

	it("move groups: 'Label: moves'; a line with no colon is dropped", () => {
		const data = [{ label: "Night", moves: ["Child of the Night", "Nightmare"] }];
		expect(L.parseGroupLines(L.groupLines(data) + "\nstray line")).toEqual(data);
	});

	it("lore options: 'write:' is a write-in, '(x2)' a double tick", () => {
		const data = [
			{ description: "... persecuted you relentlessly", max: 1, freeText: false },
			{ description: "got lost in the Great Wood", max: 2, freeText: false },
			{ description: "Who taught you?", max: 1, freeText: true },
		];
		expect(L.parseLoreOptionLines(L.loreOptionLines(data))).toEqual(data);
	});

	it("comma name lists trim and drop blanks", () => {
		expect(L.parseNameList(" Frosty,  We Happy Few , ,Underestimated")).toEqual(["Frosty", "We Happy Few", "Underestimated"]);
	});
});

describe("writing a field back into the bundle", () => {
	it("walks through a null on the way (a background with no track), making the object", () => {
		const bundle = { playbook: { backgrounds: [{ label: "Moon Blessed", track: null }] } };
		L.setBundlePath(bundle, "playbook.backgrounds.0.track.label", "Doom");
		L.setBundlePath(bundle, "playbook.backgrounds.0.track.max", 3);
		expect(bundle.playbook.backgrounds[0].track).toEqual({ label: "Doom", max: 3 });
	});

	it("leaves a missing track missing when its boxes are blank", () => {
		const bundle = { playbook: { backgrounds: [{ label: "Moon Blessed", track: null }] } };
		L.setBundlePath(bundle, "playbook.backgrounds.0.track.label", "");
		L.setBundlePath(bundle, "playbook.backgrounds.0.track.max", 0);
		expect(bundle.playbook.backgrounds[0].track).toBeNull();
	});

	it("writes into the arrays already there by their index", () => {
		const bundle = { moves: [{ name: "A" }, { name: "B" }] };
		L.setBundlePath(bundle, "moves.1.name", "Bee");
		expect(bundle.moves.map(m => m.name)).toEqual(["A", "Bee"]);
		expect(Array.isArray(bundle.moves)).toBe(true);
	});
});
