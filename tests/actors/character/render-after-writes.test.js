// The character sheet's "write to the actor, then repaint" handlers go through _renderAfter, so a
// rejected write is logged and announced and the sheet still repaints to what actually stored. Written
// bare — `await this.actor.setFlag(...); this.render(false);` — a rejection threw out of the handler
// before the render, so the sheet kept showing the state the player had just been told they were in,
// with nothing on screen to say otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHEET_JS = fs.readFileSync(path.resolve(HERE, "../../../module/actors/character/StonetopCharacterSheet.js"), "utf8");

function sheet() {
	const Base = class {
		get actor() { return {}; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	return new (createStonetopCharacterSheetClass(Base))();
}

describe("_renderAfter", () => {
	const originalUi = globalThis.ui;
	afterEach(() => { globalThis.ui = originalUi; vi.restoreAllMocks(); });

	it("repaints once the write lands", async () => {
		const s = sheet();
		await s._renderAfter(Promise.resolve("ok"));
		expect(s.render).toHaveBeenCalledWith(false);
	});

	it("reports a failed write, still repaints, and does not rethrow", async () => {
		const error = vi.fn();
		globalThis.ui = { notifications: { error } };
		vi.spyOn(console, "error").mockImplementation(() => {});
		const s = sheet();
		await expect(s._renderAfter(Promise.reject(new Error("denied")))).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledTimes(1);
		expect(s.render).toHaveBeenCalledWith(false);
	});

	it("repaints for a handler that had nothing to write", async () => {
		const s = sheet();
		await s._renderAfter(null);
		expect(s.render).toHaveBeenCalledWith(false);
	});
});

describe("activateListeners' write-then-repaint handlers", () => {
	const body = SHEET_JS.slice(
		SHEET_JS.indexOf("\t\tactivateListeners(html) {"),
		SHEET_JS.indexOf("\t\t_activateTabDragDrop(html) {"),
	);

	it("is the method being scanned", () => {
		expect(body.length).toBeGreaterThan(1000);
	});

	// The bare shape: an awaited actor write as its own statement, the repaint as the next one.
	it("leaves no actor write awaited bare before a render(false)", () => {
		const bare = body.match(/await this\.actor\.(?:setFlag|unsetFlag|update)\([^;]*\);\s*\n\s*this\.render\(false\);/g) ?? [];
		expect(bare).toEqual([]);
	});

	// Two writes that make one change (the crew row, then its Person) are one promise, so a failure
	// in either reaches the same report.
	it("wraps a crew removal's row write and Person release in one promise", () => {
		const at = body.indexOf("if (person) await releaseCrewPerson(row, { remove: deletePerson });");
		expect(at).toBeGreaterThan(-1);
		expect(body.slice(at - 200, at)).toContain("await this._renderAfter((async () => {");
	});
});
