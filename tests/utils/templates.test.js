import { describe, it, expect, vi } from "vitest";
import Handlebars from "handlebars";
import { registerPrecompiledTemplates } from "../../module/utils/templates.js";
import PRECOMPILED from "../../module/utils/precompiled-templates.js";

/** A spec as the bundle carries it: precompiled with core's option, then evaluated as code. */
const spec = (source) => new Function(`return ${Handlebars.precompile(source, { preventIndent: true })}`)();

describe("registerPrecompiledTemplates", () => {
	it("registers nothing in a checkout, whose stand-in holds no templates", () => {
		expect(PRECOMPILED).toBeNull();
		const hbs = Handlebars.create();
		expect(registerPrecompiledTemplates({ "stonetop.x": "systems/s/templates/x.hbs" }, { Handlebars: hbs })).toBe(0);
		expect(hbs.partials).toEqual({});
	});

	it("registers each template under its path and under every alias of that path", () => {
		const hbs = Handlebars.create();
		Object.defineProperty(hbs, "templateIds", { value: {} });
		const path = "systems/s/templates/a.hbs";
		const count = registerPrecompiledTemplates(
			{ "stonetop.a": path, "stonetop.b": path, "stonetop.missing": "systems/s/templates/none.hbs" },
			{ Handlebars: hbs, specs: { [path]: spec("<b>{{name}}</b>") } });

		expect(count).toBe(3);
		for (const id of [path, "stonetop.a", "stonetop.b"]) expect(hbs.partials[id]({ name: "Lio" })).toBe("<b>Lio</b>");
		expect(hbs.partials["stonetop.missing"]).toBeUndefined();
		// Core's hot reload re-registers every id it finds here for a changed file.
		expect([...hbs.templateIds[path]]).toEqual([path, "stonetop.a", "stonetop.b"]);
	});

	it("registers nothing when core's Handlebars cannot run these specs, so core compiles them itself", () => {
		const hbs = Handlebars.create();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const stale = { ...spec("<i>new</i>"), compiler: [99, ">= 99.0.0"] };
		const count = registerPrecompiledTemplates({ "stonetop.ok": "ok.hbs" },
			{ Handlebars: hbs, specs: { "ok.hbs": spec("<i>ok</i>"), "stale.hbs": stale } });
		expect(count).toBe(0);
		expect(hbs.partials).toEqual({});
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("renders what core's own compile of the same file renders, partials and indentation included", () => {
		const parent = "<ul>\n  {{> \"stonetop.row\" this}}\n</ul>";
		const row = "<li>{{label}}</li>\n<li>{{#if more}}more{{/if}}</li>\n";
		const data = { label: "<Spear>", more: true };

		const live = Handlebars.create();
		live.registerPartial("stonetop.row", live.compile(row, { preventIndent: true }));
		const expected = live.compile(parent, { preventIndent: true })(data);

		const pre = Handlebars.create();
		registerPrecompiledTemplates({ "stonetop.row": "row.hbs" },
			{ Handlebars: pre, specs: { "row.hbs": spec(row), "parent.hbs": spec(parent) } });
		expect(pre.partials["parent.hbs"](data)).toBe(expected);
	});
});
