import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The tick-box the Import Book Art macro draws beside each book, exercised as the SHIPPED STRING
// rather than as a copy of it kept here.
//
// Worth the extraction. That macro is generated outside this repo and nothing in the running
// system imports it, so it is the one piece of this feature no ordinary test can reach: a
// regeneration that drops the box, or a `canKeep` that stops being asked, produces a window that
// looks entirely normal and quietly goes back to asking a GM for the same 60 MB file twice.
const COMMAND = JSON.parse(fs.readFileSync(
	path.resolve(__dirname, "../../packs/src/stonetop-macros/import-book2-art.json"), "utf8")).command;

/**
 * Lift one arrow function out of the command by matching its braces.
 *
 * Anchored on the declaration and counted rather than matched with a regex, because the body
 * holds both braces and template literals. A shape this cannot find fails loudly, which is the
 * right answer: it means the thing under test is no longer there to test.
 */
function lift(decl) {
	const at = COMMAND.indexOf(decl);
	expect(at, `${decl} is not in the shipped macro`).toBeGreaterThan(-1);
	// From the `=` rather than from the declaration, so what comes back is the ARROW and not a
	// bare braced block, which `return` would read as an object literal.
	const from = COMMAND.indexOf("=", at) + 1;
	let depth = 0;
	for (let j = COMMAND.indexOf("{", at); j < COMMAND.length; j++) {
		if (COMMAND[j] === "{") depth++;
		else if (COMMAND[j] === "}" && --depth === 0) return COMMAND.slice(from, j + 1);
	}
	throw new Error(`unbalanced braces after ${decl}`);
}

/** `keepFieldFor`, wired to a stand-in reader. */
function keepFieldFor({ canKeep = true, has = false } = {}) {
	const body = lift("const keepFieldFor = (b) => {");
	const make = new Function("canKeepBook", "bookAlreadyKept", "esc", "bookTitle", `return ${body};`);
	return make(() => canKeep, () => has, s => String(s), b => `Book ${b}`);
}

describe("the keep-this-book box on the importer's own window", () => {
	it("is offered, and ticked, for a book that can be kept", () => {
		const html = keepFieldFor()(1);
		expect(html).toContain('type="checkbox"');
		expect(html).toContain('name="keep-book-1"');
		expect(html).toContain("checked");
	});

	// The free GM playbook is book 3 and no reader icon opens it. An offer there would upload a
	// file this world has no way to show anyone.
	it("is not offered for a book nothing can open", () => {
		expect(keepFieldFor({ canKeep: false })(3)).toBe("");
	});

	// Re-uploading 60 MB to arrive at the file already sitting there is pure cost, and an
	// unticked box would read as a warning that the copy they have is about to go.
	it("says so, and asks for nothing, when the world already has the book", () => {
		const html = keepFieldFor({ has: true })(1);
		expect(html).not.toContain("<input");
		expect(html).toContain("Already in this world to read");
	});
});
