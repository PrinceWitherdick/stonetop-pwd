// renderAfterWrite repaints a sheet whether its write landed or not, and says so when it did not.
// Written bare (`await write; this.render(false)`), a rejection skips the repaint and the sheet keeps
// showing a change that never stored. The character sheet's own pins are render-after-writes.test.js.

import fs from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderAfterWrite } from "../../module/utils/render-after-write.js";
import { repoPath } from "../fakes/css.js";

const STEADING_JS = fs.readFileSync(repoPath("module/actors/steading/StonetopSteadingSheet.js"), "utf8");

describe("renderAfterWrite", () => {
	const originalUi = globalThis.ui;
	afterEach(() => { globalThis.ui = originalUi; vi.restoreAllMocks(); });

	it("repaints once the write lands, and hands back what it resolved to", async () => {
		const app = { render: vi.fn() };
		await expect(renderAfterWrite(app, Promise.resolve("ok"))).resolves.toBe("ok");
		expect(app.render).toHaveBeenCalledWith(false);
	});

	it("reports a failed write, still repaints, and does not rethrow", async () => {
		const error = vi.fn();
		globalThis.ui = { notifications: { error } };
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const app = { render: vi.fn() };
		await expect(renderAfterWrite(app, Promise.reject(new Error("denied")), "steading sheet")).resolves.toBeUndefined();
		expect(error).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0][0]).toBe("Stonetop | steading sheet write failed");
		expect(app.render).toHaveBeenCalledWith(false);
	});
});

describe("the steading sheet's list writes", () => {
	it("go through _renderAfter rather than a bare await before the render", () => {
		const bare = STEADING_JS.match(/await this\._stonetopSteading\.editList\([^;]*\);\s*\n\s*this\.render\(false\);/g) ?? [];
		expect(bare).toEqual([]);
		expect(STEADING_JS).toContain("await this._renderAfter(this._stonetopSteading.editList(list,");
	});
});
