// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { readCss, readRepo, stripComments } from "../fakes/css.js";
import { templateSources } from "../fakes/hbs.js";
import {
	ICON_ONLY_ATTR, isIconOnly, markIconOnly, unwatchWindow, watchIconOnlyButtons, watchWindow,
} from "../../module/utils/icon-only-buttons.js";

// Foundry core gives every icon in a V1 window's button `margin-right: 3px`, for the label that
// normally follows it. A button with no label keeps it, and its icon paints ~1.5px left of the
// button's middle. CSS cannot see text nodes, so the marker tells the two kinds apart and the
// stylesheet takes the margin off the marked ones. Painted check:
// z:/tmp/foundry-verify/icon-only-margin-audit.mjs --ink.

const button = html => {
	const host = document.createElement("div");
	host.innerHTML = html;
	return host.firstElementChild;
};

describe("which buttons hold only an icon", () => {
	it.each([
		["<button><i class=\"fas fa-xmark\"></i></button>", true],
		["<button>\n\t<i class=\"fas fa-xmark\"></i>\n</button>", true],
		["<button><!-- remove --><i class=\"fas fa-xmark\"></i></button>", true],
		["<button><i class=\"fas fa-trash\"></i> Remove</button>", false],
		["<button>Remove <i class=\"fas fa-trash\"></i></button>", false],
		["<button><i class=\"fas fa-dice\"></i><span>Roll</span></button>", false],
		["<button><i class=\"fas fa-minus\"></i><i class=\"fas fa-plus\"></i></button>", false],
		["<button><img src=\"x.webp\"></button>", false],
		["<button></button>", false],
	])("%s -> %s", (html, expected) => {
		expect(isIconOnly(button(html))).toBe(expected);
	});
});

describe("marking", () => {
	it("marks the icon-only buttons in a tree and leaves the labelled ones", () => {
		const root = button("<div><button id=a><i class=\"fas fa-pen\"></i></button><button id=b><i class=\"fas fa-pen\"></i> Edit</button></div>");
		markIconOnly(root);
		expect(root.querySelector("#a").hasAttribute(ICON_ONLY_ATTR)).toBe(true);
		expect(root.querySelector("#b").hasAttribute(ICON_ONLY_ATTR)).toBe(false);
	});

	it("unmarks a button that has gained a label", () => {
		const b = button("<button><i class=\"fas fa-pen\"></i></button>");
		markIconOnly(b);
		b.append(" Edit");
		markIconOnly(b);
		expect(b.hasAttribute(ICON_ONLY_ATTR)).toBe(false);
	});
});

describe("watching windows", () => {
	let win;
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));
	const open = html => { document.body.innerHTML = html; win = document.body.firstElementChild; return watchWindow(win); };
	beforeEach(() => { document.body.innerHTML = ""; });
	afterEach(() => win && unwatchWindow(win));

	it("marks what the window holds when first watched, once", () => {
		const observer = open("<div class=\"app\"><button id=open><i class=\"fas fa-xmark\"></i></button></div>");
		expect(document.getElementById("open").hasAttribute(ICON_ONLY_ATTR)).toBe(true);
		expect(watchWindow(win)).toBe(observer);
	});

	it("catches a row added inside a window after it rendered (a cloned <template> row)", async () => {
		open("<div class=\"app\"><ul id=rows></ul></div>");
		document.getElementById("rows").append(button("<li><button id=up><i class=\"fas fa-chevron-up\"></i></button></li>"));
		await settle();
		expect(document.getElementById("up").hasAttribute(ICON_ONLY_ATTR)).toBe(true);
	});

	it("re-reads a button whose content changes", async () => {
		open("<div class=\"app\"><button id=save><i class=\"fas fa-floppy-disk\"></i></button></div>");
		document.getElementById("save").append(" Saving");
		await settle();
		expect(document.getElementById("save").hasAttribute(ICON_ONLY_ATTR)).toBe(false);
	});

	it("stops watching a window once it closes", async () => {
		open("<div class=\"app\"><ul id=rows></ul></div>");
		unwatchWindow(win);
		document.getElementById("rows").append(button("<li><button id=gone><i class=\"fas fa-xmark\"></i></button></li>"));
		await settle();
		expect(document.getElementById("gone").hasAttribute(ICON_ONLY_ATTR)).toBe(false);
	});

	it("watches V1 windows as they render, and only windows (core adds no margin elsewhere)", () => {
		const on = {};
		watchIconOnlyButtons({ on: (name, fn) => { on[name] = fn; } });
		document.body.innerHTML = "<div class=\"app\"><button id=v1><i class=\"fas fa-xmark\"></i></button></div><div class=\"application\"><button id=v2><i class=\"fas fa-xmark\"></i></button></div>";
		const [v1, v2] = document.body.children;
		on.renderApplication({ element: [v2] });
		on.renderApplication({ element: [v1] });
		expect(document.getElementById("v1").hasAttribute(ICON_ONLY_ATTR)).toBe(true);
		expect(document.getElementById("v2").hasAttribute(ICON_ONLY_ATTR)).toBe(false);
		on.closeApplication({ element: [v1] });
	});
});

describe("the wiring", () => {
	it("starts the watcher at init", () => {
		const entry = readRepo("stonetop.js");
		expect(entry).toMatch(/import \{ watchIconOnlyButtons \} from "\.\/module\/utils\/icon-only-buttons\.js"/);
		expect(entry).toMatch(/^\s*watchIconOnlyButtons\(\);/m);
	});

	it("has a stylesheet rule that takes the margin off marked buttons' icons, at no weight", () => {
		// `:where()` so a rule that sets an icon's margin on purpose still wins; unlayered, so it
		// beats core's layered rule anyway.
		const css = readCss();
		const rule = css.match(/:where\(\.app button\[data-icon-only\]\) > i\s*\{([^}]*)\}/);
		expect(rule, "the marked-button rule is missing").toBeTruthy();
		expect(rule[1]).toMatch(/(?:^|;)\s*margin:\s*0;/);
	});
});

describe("every icon-only button in the templates", () => {
	// What the marker sees, with the Handlebars taken out: a button that LOOKS icon-only in the
	// template must also read as icon-only to the marker, or the rule above never reaches it.
	const found = [];
	for (const { source } of templateSources()) {
		for (const m of stripComments(source).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
			const inner = m[1].replace(/\{\{[#/^]?(?:if|unless|else)[^}]*\}\}/g, "").trim();
			if (/^<i\b[^>]*>\s*<\/i>$/.test(inner)) found.push(m[0].replace(/\{\{[\s\S]*?\}\}/g, "x"));
		}
	}

	it("are found at all", () => {
		expect(found.length).toBeGreaterThan(100);
	});

	it("read as icon-only to the marker", () => {
		const missed = found.filter(html => !isIconOnly(button(html)));
		expect(missed).toEqual([]);
	});
});
