import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { followerHpWriteUpdate } from "../../module/actors/character/follower-fate.js";

// A document update path is a STRING that Foundry splits on "." (foundry.utils.setProperty).
// A hyphen is perfectly legal inside one, so the scope is written plainly:
//
//     actor.update({ [`flags.stonetop-pwd.customFollowers.${id}`]: data })   ✅
//
// Bracket form belongs to CODE, where a hyphen can't sit in an identifier:
//
//     actor.flags["stonetop-pwd"].customFollowers                            ✅
//
// Mixing them up is silent. `flags["stonetop-pwd"].customFollowers.<id>` splits into
// ["flags[\"stonetop-pwd\"]", "customFollowers", "<id>"], so the write lands on a
// top-level field the Actor schema has never heard of and is dropped without an error —
// the button "works", nothing is saved. That is exactly what the system-id rename's
// bracketizer did to twelve follower writes when its hand-rolled lexer lost sync inside a
// template literal (the Demonhide Cloak's "Add as follower" among them), and the suite
// stayed green because the fakes never expand a dotted path.
//
// Cheap, lexer-free guard: a quote character immediately before `flags[` means the
// bracketed path is inside a string, which is always the wrong form.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SOURCE_DIRS = ["module", "scripts", "templates"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function sourceFiles(dir) {
	const out = [];
	const walk = (abs) => {
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			if (SKIP_DIRS.has(entry.name)) continue;
			const full = path.join(abs, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(js|mjs|cjs|hbs)$/.test(entry.name)) out.push(full);
		}
	};
	walk(dir);
	return out;
}

const FILES = [
	...SOURCE_DIRS.flatMap(d => sourceFiles(path.join(ROOT, d))),
	path.join(ROOT, "stonetop.js"),
];

/** A line that is wholly comment — prose is free to quote the broken shape and explain it. */
const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

// A quote character right before `flags[`: the bracket sits inside a string, so the string
// is a path and the brackets are wrong. Code position is always reached through a dot
// (`actor.flags["stonetop-pwd"]`), never through a quote.
const BRACKETED_IN_STRING = /['"`]\s*flags\[/;

/** `file:line: text` for every line where a quote is immediately followed by `flags[`. */
function bracketedPathsInStrings() {
	const found = [];
	for (const file of FILES) {
		const src = fs.readFileSync(file, "utf8");
		if (!src.includes("flags[")) continue;
		src.split("\n").forEach((line, i) => {
			if (!isComment(line) && BRACKETED_IN_STRING.test(line)) {
				found.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`);
			}
		});
	}
	return found;
}

describe("flag update paths", () => {
	it("never bracket the scope inside a path string", () => {
		expect(bracketedPathsInStrings()).toEqual([]);
	});

	it("catches the shape that actually shipped", () => {
		// Guard the guard: the line below is verbatim what the bracketizer left behind.
		expect(BRACKETED_IN_STRING.test('update[`flags["stonetop-pwd"].customFollowers.${id}`] = data')).toBe(true);
		expect(BRACKETED_IN_STRING.test('await actor.update({ [`flags.stonetop-pwd.beastHp.${slug}`]: val })')).toBe(false);
		expect(BRACKETED_IN_STRING.test('const bag = actor.flags["stonetop-pwd"].customFollowers;')).toBe(false);
	});

	it("writes the follower stores as plain dotted paths", () => {
		const sheet = fs.readFileSync(path.join(ROOT, "module/actors/character/StonetopCharacterSheet.js"), "utf8");
		// The stores every follower feature writes through: arcana summons and the Ring's
		// Call Up (customFollowers), plus the per-slug HP maps the card's HP box edits.
		for (const store of ["customFollowers", "initiatesHp", "beastHp", "crew.individualsHp"]) {
			expect(sheet, `${store} is written with a bracketed scope`)
				.not.toContain(`flags["${SYSTEM_ID}"].${store}`);
		}
		expect(sheet, "customFollowers has no dotted write left").toContain(`flags.${SYSTEM_ID}.customFollowers`);
		// The HP box's write is built in one place (follower-fate.js#followerHpWriteUpdate), from a path, so
		// the update it hands back is what has to be dotted.
		expect(Object.keys(followerHpWriteUpdate({}, "initiate", "ash", 0, 3))).toEqual([`flags.${SYSTEM_ID}.initiatesHp.ash`]);
		expect(Object.keys(followerHpWriteUpdate({}, "beast", "ox", 0, 3))).toEqual([`flags.${SYSTEM_ID}.beastHp.ox`]);
		expect(Object.keys(followerHpWriteUpdate({}, "crew-individual", null, 2, 3))).toEqual([`flags.${SYSTEM_ID}.crew.individualsHp.2`]);
	});

	it("splits a dotted scope path the way Foundry does", () => {
		// Foundry's setProperty walks key.split("."). The plain form lands under flags;
		// the bracketed one becomes a single junk top-level key.
		const expand = (key) => {
			const target = {};
			const parts = key.split(".");
			const leaf = parts.pop();
			parts.reduce((node, p) => (node[p] ??= {}), target)[leaf] = "value";
			return target;
		};
		expect(expand(`flags.${SYSTEM_ID}.customFollowers.abc`))
			.toEqual({ flags: { [SYSTEM_ID]: { customFollowers: { abc: "value" } } } });
		expect(Object.keys(expand(`flags["${SYSTEM_ID}"].customFollowers.abc`)))
			.toEqual([`flags["${SYSTEM_ID}"]`]);
	});
});
