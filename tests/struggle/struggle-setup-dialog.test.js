import { describe, expect, it, vi } from "vitest";
import { StruggleSetupDialog } from "../../module/struggle/StruggleSetupDialog.js";
import { AID_OTHER, newSetupDraft } from "../../module/struggle/struggle-setup.js";

/**
 * The setup reading its form back (StruggleSetupDialog#_capture) and deciding what redraws it
 * (#_onChange). The window is built without rendering; its root is a stand-in that answers the
 * selectors `_capture` asks, from a table of field values.
 */

const roster = [
	{ actorId: "rhianna", name: "Rhianna", img: "", owns: [], followers: [] },
	{ actorId: "garet", name: "Garet", img: "", owns: [], followers: [] },
];

function rootWith(fields) {
	const all = sel => {
		const m = sel.match(/^\[data-pc="([^"]+)"\]\[data-field="([^"]+)"\]$/);
		const hit = m ? fields[`${m[1]}.${m[2]}`] : undefined;
		return hit === undefined ? [] : [hit];
	};
	return { querySelectorAll: all, querySelector: sel => all(sel)[0] ?? null };
}

function setupWith(fields) {
	const dialog = Object.create(StruggleSetupDialog.prototype);
	dialog._draft = newSetupDraft(roster);
	dialog._roster = roster;
	Object.defineProperty(dialog, "element", { value: [rootWith(fields)] });
	return dialog;
}

describe("reading the outside Aid back off the form", () => {
	it("keeps who was picked, the name typed for someone else, and what the Aid gives", () => {
		const dialog = setupWith({
			"rhianna.include": { checked: true },
			"rhianna.aidPick": { value: AID_OTHER },
			"rhianna.aidOther": { value: "Lowri" },
			"rhianna.aidAdv": { value: "more" },
			"garet.include": { checked: true },
			"garet.aidPick": { value: "" },
		});
		dialog._capture();
		expect(dialog._draft.pcs.rhianna).toMatchObject({ aidPick: AID_OTHER, aidOther: "Lowri", aidAdv: false });
		expect(dialog._draft.pcs.garet).toMatchObject({ aidPick: "", aidAdv: true });
	});

	it("keeps a name typed for someone else when the name box is not drawn (another pick)", () => {
		const dialog = setupWith({ "rhianna.include": { checked: true }, "rhianna.aidPick": { value: "pc:garet" }, "rhianna.aidAdv": { value: "adv" } });
		dialog._draft.pcs.rhianna.aidOther = "Lowri";
		dialog._capture();
		expect(dialog._draft.pcs.rhianna).toMatchObject({ aidPick: "pc:garet", aidOther: "Lowri", aidAdv: true });
	});
});

describe("what redraws the setup", () => {
	const change = field => ({ target: { dataset: { field } } });

	it("redraws for somebody ticked in or out, and for a new pick of who Aids", () => {
		for (const field of ["include", "aidPick"]) {
			const dialog = setupWith({});
			dialog._capture = vi.fn();
			dialog.render = vi.fn();
			dialog._onChange(change(field));
			expect(dialog.render).toHaveBeenCalledWith(false);
		}
	});

	it("leaves typing and the other lists alone until Call", () => {
		for (const field of ["aidOther", "aidAdv", "mode", "stat"]) {
			const dialog = setupWith({});
			dialog.render = vi.fn();
			dialog._onChange(change(field));
			expect(dialog.render).not.toHaveBeenCalled();
		}
	});
});

describe("the control kept in focus across a redraw", () => {
	const savedCss = globalThis.CSS;
	const box = (field, value, type = "checkbox") => ({
		type, value, dataset: { pc: "rhianna", field }, getAttribute: name => (name === "value" ? value : null),
	});

	it("tells a stat chip or a tick from its siblings by its value, and a list or a text box by its field", () => {
		globalThis.CSS = { escape: s => String(s) };
		try {
			const dialog = Object.create(StruggleSetupDialog.prototype);
			expect(dialog._focusSelector(box("stat", "wis"))).toBe(`[data-pc="rhianna"][data-field="stat"][value="wis"]`);
			expect(dialog._focusSelector(box("tick", "Short on supplies"))).toBe(`[data-pc="rhianna"][data-field="tick"][value="Short on supplies"]`);
			expect(dialog._focusSelector(box("mode", "adv", "select-one"))).toBe(`[data-pc="rhianna"][data-field="mode"]`);
			expect(dialog._focusSelector(box("aidOther", "Lowri", "text"))).toBe(`[data-pc="rhianna"][data-field="aidOther"]`);
		} finally {
			if (savedCss) globalThis.CSS = savedCss; else delete globalThis.CSS;
		}
	});
});
