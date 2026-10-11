import { describe, it, expect, vi, afterEach } from "vitest";
import { ThreatEditorDialog } from "../../module/threats/threat-editor-dialog.js";

// The editor skips re-rendering under its own rich-text save. The save's option reaches every
// client, and appId is a per-client counter, so a match alone does not make the save this one's.
describe("ThreatEditorDialog page sync", () => {
	const page = { id: "p1", name: "The Hollow King" };
	const dialogFor = () => {
		const dialog = new ThreatEditorDialog(page);
		dialog.appId = 42;
		Object.defineProperty(dialog, "rendered", { get: () => true });
		dialog.render = vi.fn();
		return dialog;
	};

	afterEach(() => { delete game.user; });

	it("does not re-render under its own rich save", () => {
		game.user = { id: "gm-a" };
		const dialog = dialogFor();
		dialog._onUpdate(page, {}, { threatEditorRichSave: 42 }, "gm-a");
		expect(dialog.render).not.toHaveBeenCalled();
	});

	it("re-renders for another user's save, even one tagged with the same appId", () => {
		game.user = { id: "gm-b" };
		const dialog = dialogFor();
		dialog._onUpdate(page, {}, { threatEditorRichSave: 42 }, "gm-a");
		expect(dialog.render).toHaveBeenCalledWith(false);
	});
});

// A suggested-move chip appends to the GM-move list. It must build that list from what is on
// screen, as adding or removing a row does: a row the GM just edited may still have its `change`
// write in flight, and a list read off the stored page would overwrite that edit.
describe("ThreatEditorDialog suggested-move chip", () => {
	const fakeRoot = (values) => {
		const rows = values.map(value => ({ querySelector: () => ({ value }) }));
		const list = { dataset: { kind: "string" }, querySelectorAll: () => rows };
		return { querySelector: sel => (sel.includes('data-list="gmMoves"') ? list : null) };
	};

	it("keeps an edit that has not reached the page yet", async () => {
		const page = { id: "p2", name: "Sajra", system: { gmMoves: ["Lay a curse"] }, update: vi.fn(async () => {}) };
		const dialog = new ThreatEditorDialog(page);
		Object.defineProperty(dialog, "element", { get: () => [fakeRoot(["Lay a curse on Caradoc"])] });
		await dialog._addGmMove("Twist a bargain to its favor");
		expect(page.update).toHaveBeenCalledWith({
			"system.gmMoves": ["Lay a curse on Caradoc", "Twist a bargain to its favor"],
		});
	});

	it("does not add a move already in the on-screen list", async () => {
		const page = { id: "p3", name: "Sajra", system: { gmMoves: [] }, update: vi.fn(async () => {}) };
		const dialog = new ThreatEditorDialog(page);
		Object.defineProperty(dialog, "element", { get: () => [fakeRoot(["Lay a curse"])] });
		await dialog._addGmMove("Lay a curse");
		expect(page.update).not.toHaveBeenCalled();
	});
});
