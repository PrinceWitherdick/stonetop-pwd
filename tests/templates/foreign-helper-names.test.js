import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { describe, it, expect, vi } from "vitest";
import { bareHelperLookups, templateFiles, templateBareNames, renderBareNamesModule }
	from "../../scripts/lib/template-bare-names.js";
import { TEMPLATE_BARE_NAMES } from "../../module/utils/template-bare-names.js";
import { clashingHelpers, reportForeignHelperClashes } from "../../module/utils/foreign-helper-check.js";
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
// `{{this.when}}` is always a data lookup, never a helper call, so that is the spelling to use
// for a bare value whose name someone else has taken. Three guards:
//   • no template prints bare a name a helper is KNOWN to answer to (core's, ours, and the
//     foreign ones found in the wild), checked here;
//   • the list of every bare name, which the startup check holds against whatever helpers the
//     GM's modules register (module/utils/foreign-helper-check.js), is current;
//   • the four templates that clashed render with Battle Transitions' helpers registered.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const TEMPLATES = path.join(ROOT, "templates");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Foundry core's helpers (client/applications/handlebars.mjs, v14) and HandlebarsIntl's, which it
// registers alongside them.
const CORE_HELPERS = ["checked", "disabled", "concat", "editor", "formInput", "formGroup", "formField",
	"filePicker", "ifThen", "localize", "numberFormat", "numberInput", "object", "radioBoxes", "rangePicker",
	"selectOptions", "timeSince", "eq", "ne", "lt", "gt", "lte", "gte", "not", "and", "or",
	"intl", "intlGet", "formatDate", "formatTime", "formatRelative", "formatNumber", "formatMessage",
	"formatHTMLMessage"];
// Handlebars' own: the compiler treats these as known helpers outright.
const BUILTIN_HELPERS = ["if", "unless", "each", "with", "log", "lookup", "helperMissing", "blockHelperMissing"];
// Helpers other modules register that have clashed with ours. Add to it when a new clash turns up.
const FOREIGN_HELPERS = {
	"battle-transitions": ["switch", "case", "when", "json", "group", "formatDuration",
		"stepDescription", "shouldConfigureStep", "stepName", "moduleTemplate"],
};

/** Every helper this system registers, read off the source so a new one is covered unasked. */
function systemHelpers() {
	const files = [path.join(ROOT, "stonetop.js")];
	const walk = dir => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (e.name.endsWith(".js")) files.push(full);
		}
	};
	walk(path.join(ROOT, "module"));
	return [...new Set(files.flatMap(f =>
		[...fs.readFileSync(f, "utf8").matchAll(/registerHelper\(\s*["']([\w$]+)["']/g)].map(m => m[1])))];
}

describe("finding the names Handlebars tries as a helper first", () => {
	const names = src => bareHelperLookups(src).map(f => f.name);

	it("finds a bare mustache, a bare block and a bare subexpression", () => {
		expect(names("{{when}}")).toEqual(["when"]);
		expect(names("{{#group}}x{{/group}}{{^json}}y{{/json}}")).toEqual(["group", "json"]);
		expect(names("{{#if (switch)}}z{{/if}}")).toEqual(["switch"]);
	});

	it("leaves out what is always data or always a helper call", () => {
		expect(names("{{this.when}} {{../when}} {{@index}} {{a.b}} {{this}}")).toEqual([]);
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

describe("templates never print a bare value named after a helper", () => {
	const taken = new Map([
		...CORE_HELPERS.map(n => [n, "Foundry core"]),
		...BUILTIN_HELPERS.map(n => [n, "Handlebars"]),
		...systemHelpers().map(n => [n, "this system"]),
		...Object.entries(FOREIGN_HELPERS).flatMap(([mod, list]) => list.map(n => [n, mod])),
	]);

	it("reads this system's own helpers off the source", () => {
		expect(taken.get("moveBody")).toBe("this system");
		expect(taken.get("resourceChecks")).toBe("this system");
	});

	it("uses `this.<name>` wherever the name is a known helper", () => {
		const offenders = templateFiles(TEMPLATES).flatMap(file =>
			bareHelperLookups(fs.readFileSync(file, "utf8"))
				.filter(m => taken.has(m.name))
				.map(m => `${path.relative(TEMPLATES, file)}:${m.line} ${m.name} (${taken.get(m.name)})`));
		expect(offenders).toEqual([]);
	});

	// The startup check reads the generated list, because the template sources are not to hand in
	// the browser. A stale list leaves a new bare name unwatched.
	it("the generated list the startup check reads is current (npm run gen:template-names)", () => {
		const fresh = templateBareNames(TEMPLATES);
		expect(TEMPLATE_BARE_NAMES).toEqual(fresh);
		expect(read("module/utils/template-bare-names.js").replace(/\r\n/g, "\n")).toBe(renderBareNamesModule(fresh));
	});
});

describe("the startup check names a foreign helper that takes a bare name", () => {
	it("finds only the names a registered helper answers to", () => {
		expect(clashingHelpers({ name: () => {}, label: () => {}, unusedHere: () => {} }, ["id", "label", "name"]))
			.toEqual(["label", "name"]);
		expect(clashingHelpers({}, ["id"])).toEqual([]);
	});

	it("is silent on a world whose helpers are core's and ours", () => {
		const helpers = Object.fromEntries([...CORE_HELPERS, ...BUILTIN_HELPERS, ...systemHelpers()].map(n => [n, () => {}]));
		const notifications = { warn: vi.fn() };
		expect(reportForeignHelperClashes({ helpers, notifications, user: { isGM: true } })).toEqual([]);
		expect(notifications.warn).not.toHaveBeenCalled();
	});

	it("tells the GM, names the helper, and tells a player nothing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const gm = { warn: vi.fn() };
			const player = { warn: vi.fn() };
			const helpers = { name: () => {} };
			expect(reportForeignHelperClashes({ helpers, notifications: gm, user: { isGM: true } })).toEqual(["name"]);
			expect(gm.warn).toHaveBeenCalledWith(expect.stringContaining('"name"'), { permanent: true });
			reportForeignHelperClashes({ helpers, notifications: player, user: { isGM: false } });
			expect(player.warn).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
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
		const hb = Handlebars.create();
		hb.registerHelper("helperMissing", () => "");
		hb.registerHelper({
			eq: (a, b) => a === b,
			not: v => !v,
			and: (...a) => a.slice(0, -1).every(Boolean),
			or: (...a) => a.slice(0, -1).some(Boolean),
		});
		for (const name of FOREIGN_HELPERS["battle-transitions"]) {
			hb.registerHelper(name, function (...args) {
				if (args.length < 2) throw new Error(`${name} called with no arguments`);
				return "";
			});
		}
		const boot = read("stonetop.js");
		for (const m of boot.matchAll(/"(stonetop\.[\w-]+)":\s*"systems\/stonetop-pwd\/([^"]+\.hbs)"/g)) {
			hb.registerPartial(m[1], read(m[2]));
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
