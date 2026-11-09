// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { CreateThingDialog } from "../../module/things-below/create-thing-dialog.js";
import { thingBelowPreset } from "../../module/data/things-below-presets.js";

// Create a Thing Below's preset dropdown writes the name, titles, themes, instinct and ticked GM
// moves. A switch keeps what the choice being left held, and switching back brings it back, so
// trying a preset never throws away what the GM had typed or ticked.

function makeDialog() {
	return Object.assign(Object.create(CreateThingDialog.prototype), {
		_preset: "", _name: "", _titlesText: "", _proximity: "distant", _themeIds: new Set(), _aspectIds: new Set(),
		_instinctId: null, _instinctCustom: "", _selectedMoves: new Set(), _customMoves: [""], _presetEdits: {},
	});
}

// The concept step as drawn, with the name and titles typed in but not yet blurred.
function conceptStep(name, titles) {
	const root = document.createElement("div");
	root.innerHTML = `<input data-field="name"><textarea data-field="titles"></textarea>`;
	root.querySelector("[data-field='name']").value = name;
	root.querySelector("[data-field='titles']").value = titles;
	return root;
}

// What the dropdown's change handler does: capture the live fields, then switch.
function pick(d, slug, root) {
	d._capture(root);
	d._applyPreset(slug);
}

const fields = d => ({
	name: d._name, titles: d._titlesText, themes: [...d._themeIds].sort(), instinct: d._instinctCustom,
	instinctId: d._instinctId, moves: [...d._selectedMoves].sort(),
});

describe("CreateThingDialog preset switching", () => {
	it("a preset's first visit fills in its own name, titles, themes, instinct and moves", () => {
		const d = makeDialog();
		d._applyPreset("daagon");
		const preset = thingBelowPreset("daagon");
		expect(d._name).toBe(preset.name);
		expect(d._titlesText).toBe((preset.titles ?? []).join("\n"));
		expect([...d._selectedMoves]).toEqual(preset.moves ?? []);
	});

	it("back to a preset brings back what was typed and ticked on it, not its defaults", () => {
		const d = makeDialog();
		pick(d, "daagon", conceptStep("", ""));
		d._themeIds.add(99);
		d._instinctCustom = "To drown the hills";
		d._instinctId = null;
		d._selectedMoves.add("Swallow a boat whole");
		pick(d, "hlad", conceptStep("Daagon the Patient", "Lord of the Deep\nThe Drowned King"));
		expect(d._name).toBe(thingBelowPreset("hlad").name);
		pick(d, "daagon", conceptStep(d._name, d._titlesText));
		expect(fields(d)).toMatchObject({
			name: "Daagon the Patient", titles: "Lord of the Deep\nThe Drowned King", instinct: "To drown the hills",
		});
		expect(d._themeIds.has(99)).toBe(true);
		expect(d._selectedMoves.has("Swallow a boat whole")).toBe(true);
	});

	it("back to From scratch brings back the GM's own typing and picks", () => {
		const d = makeDialog();
		d._themeIds = new Set([1, 2]);
		d._instinctId = 3;
		d._selectedMoves = new Set(["Whisper in dreams"]);
		const mine = { ...fields(d), name: "The Hungry Dark", titles: "Eater of Lamps" };
		pick(d, "daagon", conceptStep("The Hungry Dark", "Eater of Lamps"));
		pick(d, "hlad", conceptStep(d._name, d._titlesText));
		pick(d, "", conceptStep(d._name, d._titlesText));
		expect(d._preset).toBe("");
		expect(fields(d)).toEqual(mine);
	});

	it("From scratch with nothing kept for it leaves the fields as they are", () => {
		const d = makeDialog();
		d._preset = "daagon";   // as a dialog opened on a preset would be
		d._name = "Daagon";
		d._applyPreset("");
		expect(d._name).toBe("Daagon");
	});

	it("a kept choice is a copy: the sets it was taken from can't change it", () => {
		const d = makeDialog();
		d._themeIds = new Set([1]);
		const themes = d._themeIds;
		const moves = d._selectedMoves;
		pick(d, "daagon", conceptStep("Mine", ""));
		themes.add(2);
		moves.add("Whisper in dreams");
		expect(d._presetEdits[""]).toMatchObject({ themeIds: [1], selectedMoves: [] });
		// Switching back takes it out of what is kept, and puts the preset's own aside.
		pick(d, "", conceptStep(d._name, d._titlesText));
		expect([...d._themeIds]).toEqual([1]);
		expect(Object.keys(d._presetEdits)).toEqual(["daagon"]);
	});
});
