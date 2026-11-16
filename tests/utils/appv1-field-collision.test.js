import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// CORE OWNS THESE NAMES AS INSTANCE FIELDS. AppV1's Application constructor assigns them on `this`,
// so a subclass METHOD or getter of the same name is shadowed the moment the window exists and the
// first call throws "this._state is not a function" (PlaybookImportReview, 11-13: every Undo step
// and the reopen after a reload). Unit tests never build a real Application, so nothing else
// catches it; this reads the source instead.
const CORE_FIELDS = [
	"_state", "_element", "_priorState", "_scrollPositions", "_minimized", "_dragDrop",
	"_searchFilters", "_tabs", "appId",
];
const MEMBER = new RegExp(String.raw`^\s+(?:async\s+|get\s+|set\s+)?(${CORE_FIELDS.join("|")})\s*\([^)]*\)\s*\{`, "m");

function jsFiles(dir) {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? jsFiles(path) : name.endsWith(".js") ? [path] : [];
	});
}

describe("AppV1 field names", () => {
	it("no class defines a method or getter named after a core instance field", () => {
		const root = join(__dirname, "../..");
		const hits = jsFiles(join(root, "module"))
			.map(path => [relative(root, path), readFileSync(path, "utf8").match(MEMBER)?.[1]])
			.filter(([, name]) => name)
			.map(([path, name]) => `${path}: ${name}()`);
		expect(hits).toEqual([]);
	});
});
