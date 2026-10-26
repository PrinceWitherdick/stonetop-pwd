import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { readRepo as read, repoPath } from "../fakes/css.js";
import { bareHelperLookups, systemHandlebars, templateSources } from "../fakes/hbs.js";
import { replacedHelpers, replacedMessage, watchOwnHelpers } from "../../module/utils/foreign-helper-check.js";
import { buildSiteCardVM } from "../../module/sites/site-view.js";
import { shapeSiteSystem } from "../../module/sites/site-store.js";

// Handlebars helpers are GLOBAL, shared by every system and module in the world, and a bare
// `{{when}}` asks for a helper called `when` BEFORE it looks for a `when` on the data. So once
// some module registers a helper with that name, our template stops printing the value and calls
// their function instead.
//
// That is how the GM Toolkit stopped opening for a GM running Battle Transitions: it registers a
// `when` helper that expects `{{#when a "eq" b}}`, and given no arguments it calls
// `operators[undefined]()` and throws, taking the whole sheet render with it. Only for a world
// with a player wish or a site timeline entry that has a "when" filled in, which is why it
// looked like a clash rather than a bug.
//
// `{{this.when}}` is always a data lookup, never a helper call. Three guards:
//   • no template prints ANY value bare, so no module can take a name from us, whatever helpers
//     it registers (a block parameter is the one exception, and Handlebars never reads it as a
//     helper);
//   • the other way round, the startup watch names any module that replaces one of OUR helpers
//     (module/utils/foreign-helper-check.js), and it knows every one of them;
//   • the four templates that clashed render with Battle Transitions' helpers registered.

// Helpers Battle Transitions registers: the module whose clash this file exists for.
const BATTLE_TRANSITIONS = ["switch", "case", "when", "json", "group", "formatDuration",
	"stepDescription", "shouldConfigureStep", "stepName", "moduleTemplate"];

describe("finding the names Handlebars tries as a helper first", () => {
	const names = src => bareHelperLookups(src).map(f => f.name);

	it("finds a bare mustache, a bare block and a bare subexpression", () => {
		expect(names("{{when}}")).toEqual(["when"]);
		expect(names("{{#group}}x{{/group}}{{^json}}y{{/json}}")).toEqual(["group", "json"]);
		expect(names("{{#if (switch)}}z{{/if}}")).toEqual(["switch"]);
	});

	// Handlebars looks the helper up by the segment inside the brackets.
	it("names a bracketed segment by the helper it calls", () => {
		expect(names("{{[when]}} {{{[group]}}}")).toEqual(["when", "group"]);
	});

	it("leaves out what is always data or always a helper call", () => {
		expect(names("{{this.when}} {{../when}} {{@index}} {{a.b}} {{this}} {{this.[when]}}")).toEqual([]);
		expect(names('{{localize "x"}} {{format k n=1}} {{#each rows}}{{/each}} {{#if (eq a b)}}{{/if}}')).toEqual([]);
	});

	// Handlebars' compiler reads a block parameter as the value inside its block, never as a helper,
	// and `this.group` there would read the row's own field instead, a different value.
	it("leaves out a block parameter inside its block, and only there", () => {
		expect(names("{{#each rows as |group i|}}{{group}}{{i}}{{/each}}")).toEqual([]);
		expect(names("{{#each rows as |group|}}{{else}}{{group}}{{/each}}{{group}}")).toEqual(["group", "group"]);
		expect(names("{{#each rows as |group|}}{{#each group.items}}{{group}}{{/each}}{{/each}}")).toEqual([]);
	});

	it("reports the line it is on", () => {
		expect(bareHelperLookups("a\n\n{{when}}")).toEqual([{ name: "when", line: 3 }]);
	});
});

describe("templates never print a bare value", () => {
	const templates = templateSources();

	it("reads every template", () => {
		expect(templates.length).toBeGreaterThan(150);
		expect(templates.map(t => t.rel)).toContain("templates/actor/partials/gm-toolkit-tab-wonder.hbs");
	});

	// Any one-segment name with no arguments is a name some module can register a helper under,
	// common ones (`name`, `label`, `max`, `range`, `text`) most of all. So none is written bare:
	// `{{this.name}}` reads the same value and no helper can answer for it.
	it("writes every value `{{this.<name>}}`", () => {
		const offenders = templates.flatMap(({ rel, source }) =>
			bareHelperLookups(source).map(m => `${rel}:${m.line} {{${m.name}}} -> {{this.${m.name}}}`));
		expect(offenders, `\nBare values a module's helper could take:\n${offenders.join("\n")}\n`).toEqual([]);
	});
});

describe("the startup watch knows every helper this system registers", () => {
	const BOOT = read("stonetop.js");
	const start = BOOT.indexOf("const helpersBeforeOurs");
	const end = BOOT.indexOf("watchOwnHelpers(Object.keys");

	/** Every `registerHelper(` call, string form or object form, in the system's own JS. */
	const calls = (() => {
		const found = [];
		const walk = rel => {
			for (const e of fs.readdirSync(repoPath(rel), { withFileTypes: true })) {
				const child = `${rel}/${e.name}`;
				if (e.isDirectory()) walk(child);
				else if (e.name.endsWith(".js")) found.push(...scan(child, read(child)));
			}
		};
		const scan = (rel, src) => [...src.matchAll(/\bregisterHelper\s*\(/g)]
			.filter(m => !inComment(src, m.index)).map(m => ({ rel, index: m.index }));
		found.push(...scan("stonetop.js", BOOT));
		walk("module");
		return found;
	})();

	function inComment(src, index) {
		const lineStart = src.lastIndexOf("\n", index) + 1;
		return /\/\/|^\s*\*/.test(src.slice(lineStart, index));
	}

	it("finds the bracket and the helpers inside it", () => {
		expect(start).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(start);
		expect(calls.filter(c => c.rel === "stonetop.js").length).toBeGreaterThan(10);
	});

	// A helper registered anywhere else is not in the watch's list, so a module replacing it would
	// go unreported. module/utils/foreign-helper-check.js's own wrapper is the one exception.
	it("registers every helper between the snapshot and the watch, and nowhere else", () => {
		const outside = calls
			.filter(c => !(c.rel === "stonetop.js" && c.index > start && c.index < end))
			.filter(c => c.rel !== "module/utils/foreign-helper-check.js")
			.map(c => `${c.rel} @${c.index}`);
		expect(outside).toEqual([]);
	});
});

describe("the startup watch names a module that replaces one of our helpers", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	afterEach(() => warn.mockClear());
	afterAll(() => warn.mockRestore());

	/** A fresh Handlebars with `times` and `eq` registered as ours, and a manual defer queue. */
	function rig({ ready = true } = {}) {
		const hb = Handlebars.create();
		hb.registerHelper("times", n => n);
		hb.registerHelper("eq", (a, b) => a === b);
		const queue = [];
		const state = { ready };
		const check = watchOwnHelpers(["times", "eq"], {
			handlebars: hb, isReady: () => state.ready, defer: fn => queue.push(fn),
		});
		const flush = () => { while (queue.length) queue.shift()(); };
		return { hb, check, flush, state };
	}

	it("lists only the helpers no longer ours", () => {
		const ours = () => {};
		expect(replacedHelpers({ a: ours, b: () => {} }, new Map([["b", ours], ["a", ours]]))).toEqual(["b"]);
		expect(replacedHelpers({}, new Map([["z", ours], ["a", ours]]))).toEqual(["a", "z"]);
		expect(replacedMessage([])).toBeNull();
		expect(replacedMessage(["times"])).toContain('helper "times"');
	});

	it("is silent while every helper is still ours, and a module adding new ones is fine", () => {
		const { hb, check, flush } = rig();
		hb.registerHelper("when", () => "");
		flush();
		expect(check()).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("still registers what the module asked for", () => {
		const { hb } = rig();
		const theirs = () => "theirs";
		hb.registerHelper("times", theirs);
		expect(hb.helpers.times).toBe(theirs);
	});

	it("catches a replacement made long after ready, in either registerHelper form", () => {
		const { hb, flush } = rig();
		hb.registerHelper({ times: () => [], eq: () => true });
		hb.registerHelper("times", () => []);
		flush();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('"eq", "times"'));
	});

	it("waits for ready, then the ready sweep reports what came before", () => {
		const { hb, check, flush, state } = rig({ ready: false });
		hb.registerHelper("times", () => []);
		flush();
		expect(warn).not.toHaveBeenCalled();
		state.ready = true;
		expect(check()).toEqual(["times"]);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("catches a helper assigned straight onto Handlebars.helpers, at the ready sweep", () => {
		const { hb, check } = rig();
		hb.helpers.eq = () => false;
		expect(check()).toEqual(["eq"]);
	});

	it("names each replacement once", () => {
		const { hb, check, flush } = rig();
		hb.registerHelper("times", () => []);
		flush();
		hb.registerHelper("times", () => [1]);
		flush();
		expect(check()).toEqual([]);
		hb.registerHelper("eq", () => true);
		flush();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[1][0]).toContain('helper "eq"');
	});

	// Modules often bring an `eq` or `times` that behaves just like ours, so an on-screen notice
	// would be noise in many worlds. The console line is for whoever is chasing a broken sheet.
	it("says it in the console only, never on screen", () => {
		const notify = vi.fn();
		const saved = globalThis.ui;
		globalThis.ui = { notifications: { warn: notify, error: notify, info: notify } };
		try {
			const { hb, flush } = rig();
			hb.registerHelper("times", () => []);
			flush();
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("times"));
			expect(notify).not.toHaveBeenCalled();
		} finally {
			globalThis.ui = saved;
		}
	});
});

describe("the templates that clashed render with Battle Transitions' helpers registered", () => {
	/**
	 * A Handlebars like the one in a world running Battle Transitions: every system partial
	 * registered under its real name, core's logic helpers, and each of the module's helpers as one
	 * that throws without arguments, which is what its `when` does. Every other helper renders empty.
	 */
	function hostileHandlebars() {
		const hb = systemHandlebars();
		hb.registerHelper("helperMissing", () => "");
		hb.registerHelper({
			eq: (a, b) => a === b,
			not: v => !v,
			and: (...a) => a.slice(0, -1).every(Boolean),
			or: (...a) => a.slice(0, -1).some(Boolean),
		});
		for (const name of BATTLE_TRANSITIONS) {
			hb.registerHelper(name, function (...args) {
				if (args.length < 2) throw new Error(`${name} called with no arguments`);
				return "";
			});
		}
		return hb;
	}

	const site = async () => buildSiteCardVM({
		id: "site1", uuid: "JournalEntry.j1.JournalEntryPage.site1", name: "The Green Lord's Tomb", isOwner: true,
		system: shapeSiteSystem({ timeline: [{ when: "Centuries ago", text: "The barrow was raised." }] }),
	});

	const CASES = [
		{
			file: "templates/actor/partials/gm-toolkit-tab-wonder.hbs", fixed: "({{this.when}})", bare: "({{when}})",
			context: async () => ({ stonetop: { playerWishes: [{ id: "a1", name: "Blodwen",
				wishes: [{ text: "See the Mighty Servant", when: "by spring" }] }] } }),
			expected: '<span class="stonetop-gm-wishes-when">(by spring)</span>',
		},
		{
			file: "templates/journal/partials/site-card.hbs", fixed: "{{this.when}}</strong>", bare: "{{when}}</strong>",
			context: site,
			expected: '<strong class="site-when">Centuries ago</strong>',
		},
		{
			file: "templates/dialogs/add-inventory-item.hbs", fixed: "--{{this.group}}", bare: "--{{group}}",
			context: async () => ({ activeTab: "tags", chips: [{ group: "weapon", insert: "+1 damage" }] }),
			expected: "stonetop-add-item-chip--weapon",
		},
		{
			file: "templates/journal/location.hbs", fixed: "--{{this.group}}", bare: "--{{group}}",
			context: async () => ({ stonetop: { sections: [{ index: 0, visible: true, groupStart: true,
				group: "place", groupLabel: "The place itself" }] } }),
			expected: 'stonetop-section-group--place">The place itself</h2>',
		},
	];

	for (const c of CASES) {
		it(`${path.basename(c.file)} prints the value, not the helper`, async () => {
			const hb = hostileHandlebars();
			const source = read(c.file);
			expect(source).toContain(c.fixed);
			const context = await c.context();
			expect(hb.compile(source)(context)).toContain(c.expected);
			// The rig bites: the old spelling, in the same template with the same data, does not render.
			expect(() => hb.compile(source.replace(c.fixed, c.bare))(context)).toThrow(/called with no arguments/);
		});
	}
});
