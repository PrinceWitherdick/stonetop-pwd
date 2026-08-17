import { describe, expect, it } from "vitest";
import { WoundDialog } from "../../../../module/actors/character/dialogs/WoundDialog.js";

// A stand-in for the rendered <form>: selector → element. Only the lookups the dialog
// actually performs need to resolve; anything else answers null, matching a field the
// template didn't render.
function makeForm({ fields = {}, requirements = [], statusChecked = null } = {}) {
	const reqRows = requirements.map(r => ({
		querySelector: sel => ({
			".wd-req-text": { value: r.text },
			".wd-req-done": { checked: !!r.done },
		}[sel] ?? null),
	}));
	return {
		querySelector: sel => {
			if (sel === 'input[name="status"]:checked') return statusChecked ? { value: statusChecked } : null;
			const match = sel.match(/^\[name="(.+)"\]$/);
			if (match) return match[1] in fields ? fields[match[1]] : null;
			return null;
		},
		querySelectorAll: sel => (sel === ".wd-req" ? reqRows : []),
	};
}

describe("WoundDialog", () => {
	it("reads every panel's fields — not just the visible one — into a wound record", () => {
		const dialog = new WoundDialog({ isNew: true });
		const form = makeForm({
			statusChecked: "permanent",
			fields: {
				text:            { value: "  Shattered knee  " },
				origin:          { value: "deaths-door" },
				requirementNote: { value: " weeks off it " },
				mechanicalTag:   { value: " Defy Danger at disadvantage " },
				reminderMove:    { value: "Defy Danger" },
				planNote:        { value: " Walk with a cane " },
				healed:          { checked: true },
			},
			requirements: [
				{ text: " a crutch ", done: true },
				{ text: "", done: false },        // blank rows are dropped
				{ text: "months of practice", done: false },
			],
		});

		expect(dialog._read(form)).toEqual({
			text: "Shattered knee",
			status: "permanent",
			origin: "deaths-door",
			requirementNote: "weeks off it",
			mechanicalTag: "Defy Danger at disadvantage",
			reminderMove: "Defy Danger",
			planNote: "Walk with a cane",
			planRequirements: [
				{ text: "a crutch", done: true },
				{ text: "months of practice", done: false },
			],
			healed: true,
		});
	});

	it("reads the CHECKED status tile, not the first one in the group", () => {
		const dialog = new WoundDialog({ isNew: false, wound: { id: "w1" } });
		// A bare [name="status"] lookup would answer with the group's first radio
		// ("problematic"); only the :checked lookup gets the player's pick.
		expect(dialog._readStatus(makeForm({ statusChecked: "stabilized" }))).toBe("stabilized");
		// Nothing checked (a record with no status yet) falls back to the untreated state.
		expect(dialog._readStatus(makeForm())).toBe("problematic");
	});

	it("offers no-reminder / all-rolls / each move by name, with the stored pick selected", () => {
		const dialog = new WoundDialog({ isNew: false, wound: {}, moveNames: ["Clash", "Let Fly"] });
		const options = dialog._reminderOptions("Let Fly");

		expect(options.map(o => o.value)).toEqual(["", "*", "Clash", "Let Fly"]);
		expect(options.find(o => o.selected).value).toBe("Let Fly");
		expect(options[1].label).toBe("All move rolls");
	});

	it("keeps a drifted reminder as an option so re-saving doesn't drop the binding", () => {
		const dialog = new WoundDialog({ isNew: false, wound: {}, moveNames: ["Clash"] });
		const options = dialog._reminderOptions("Old Name");

		expect(options.at(-1)).toEqual({ value: "Old Name", label: "Old Name (not a current move)", selected: true });
	});

	it("summarises the wound for the banner, naming an unfilled one by its mode", () => {
		const fresh = new WoundDialog({ isNew: true });
		expect(fresh._summary("  ", "problematic")).toMatchObject({ name: "New wound", glyph: "fa-droplet" });

		const editing = new WoundDialog({ isNew: false, wound: { id: "w1" } });
		expect(editing._summary("", "permanent")).toMatchObject({ name: "(unnamed wound)", glyph: "fa-lock" });
		// The banner spells the state out (the sheet tooltip's label), where the status
		// tile only has room for the one-word one.
		expect(editing._summary("Twisted ankle", "stabilized")).toMatchObject({
			name: "Twisted ankle",
			glyph: "fa-bandage",
			status: "Stabilized: treated, but not yet healed",
		});
	});

	it("prefills the panels from an existing wound and opens on the first one", () => {
		const dialog = new WoundDialog({
			isNew: false,
			moveNames: ["Clash"],
			wound: {
				id: "w1", text: "Cracked ribs", status: "stabilized", origin: "wound",
				requirementNote: "rest", mechanicalTag: "hurts to breathe", reminderMove: "Clash",
				planNote: "", planRequirements: [{ text: "a splint", done: true }], healed: false,
			},
		});
		const data = dialog.getData();

		expect(data.text).toBe("Cracked ribs");
		expect(data.saveLabel).toBe("Save wound");
		expect(data.statusOptions.find(o => o.selected).value).toBe("stabilized");
		expect(data.originOptions.find(o => o.selected).value).toBe("wound");
		expect(data.planRequirements).toEqual([{ text: "a splint", done: true }]);
		expect(data.active).toMatchObject({ key: "wound", index: 1 });
		expect(data.sections.filter(s => s.selected).map(s => s.key)).toEqual(["wound"]);
		expect(data.sectionCount).toBe(data.sections.length);
	});

	it("defaults a brand-new wound to untreated, and labels its save button as an add", () => {
		const data = new WoundDialog({ isNew: true }).getData();

		expect(data.isNew).toBe(true);
		expect(data.saveLabel).toBe("Add wound");
		expect(data.statusOptions.find(o => o.selected).value).toBe("problematic");
		expect(data.originOptions.find(o => o.selected).value).toBe("wound");
		expect(data.planRequirements).toEqual([]);
		expect(data.reminderOptions.find(o => o.selected).value).toBe("");
	});
});
