import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";
import { hbsTruthy } from "../../module/utils/hbs-truthy.js";

// The `and` / `or` / `not` helpers stand inside the same expressions as Handlebars' own
// `{{#if}}`, so they have to answer the same way. The case where plain JS truthiness
// doesn't is the EMPTY ARRAY — truthy to `Boolean`, falsy to `{{#if}}` — and it is
// invisible at the call site: `{{#if (and edit rows)}}` reads exactly like `{{#if rows}}`
// and used to disagree with it on precisely the empty list. See utils/hbs-truthy.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STONETOP_JS = fs.readFileSync(path.resolve(HERE, "../../stonetop.js"), "utf8");

// Every distinguishable shape a template condition can arrive as.
const VALUES = [
	["empty array", []],
	["array of one falsy item", [0]],
	["non-empty array", ["a"]],
	["empty object", {}],
	["object", { a: 1 }],
	["empty string", ""],
	["string", "x"],
	["zero", 0],
	["number", 3],
	["false", false],
	["true", true],
	["null", null],
	["undefined", undefined],
];

// What `{{#if}}` itself does with each — the standard we are matching, asked of the real
// Handlebars rather than restated from its docs, so a change in it fails here.
const renderedByIf = value =>
	Handlebars.compile("{{#if v}}yes{{else}}no{{/if}}")({ v: value }) === "yes";

describe("hbsTruthy", () => {
	it.each(VALUES)("agrees with {{#if}} on %s", (_label, value) => {
		expect(hbsTruthy(value)).toBe(renderedByIf(value));
	});

	// The one that bit: stated on its own so a regression names itself.
	it("calls an empty array falsy, as {{#if}} does and Boolean does not", () => {
		expect(hbsTruthy([])).toBe(false);
		expect(Boolean([])).toBe(true);
	});
});

// The helpers are registered against the live Handlebars in stonetop.js, which can't be
// imported here (it pulls in the whole system at module scope). Rebuild them from the
// same predicate and check the shape, then hold the registration to it by source.
describe("the and / or / not helpers", () => {
	const or  = (...args) => args.some(hbsTruthy);
	const and = (...args) => args.every(hbsTruthy);
	const not = value => !hbsTruthy(value);

	it("treats an empty array as absent, not as present", () => {
		expect(and(true, [])).toBe(false);
		expect(and(true, ["a"])).toBe(true);
		expect(or(false, [])).toBe(false);
		expect(or(false, ["a"])).toBe(true);
		expect(not([])).toBe(true);
		expect(not(["a"])).toBe(false);
	});

	// `.slice(0, -1)` drops the options object Handlebars appends to every helper call.
	// Lose it and the trailing object counts as a truthy argument, so `or` is always true
	// and `and` is decided by the arguments alone only when they all pass.
	it("is registered on hbsTruthy, with the options argument dropped", () => {
		expect(STONETOP_JS).toContain('import { hbsTruthy } from "./module/utils/hbs-truthy.js"');
		expect(STONETOP_JS).toContain('registerHelper("or", (...args) => args.slice(0, -1).some(hbsTruthy))');
		expect(STONETOP_JS).toContain('registerHelper("and", (...args) => args.slice(0, -1).every(hbsTruthy))');
		expect(STONETOP_JS).toContain('registerHelper("not", value => !hbsTruthy(value))');
		expect(STONETOP_JS).not.toMatch(/registerHelper\("(?:or|and)", \(\.\.\.args\) => args\.slice\(0, -1\)\.\w+\(Boolean\)\)/);
	});
});
