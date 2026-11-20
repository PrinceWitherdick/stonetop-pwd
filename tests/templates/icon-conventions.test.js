import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { repoPath } from "../fakes/css.js";
import { openingTags, templateSources } from "../fakes/hbs.js";

// HOW AN ICON IS WRITTEN IN A TEMPLATE (STYLEGUIDE.md, "Icons and glyphs").
//
// Three habits had drifted apart across 150 templates, and each is invisible in a browser, where
// both spellings draw the same glyph:
//
//   · the style class: `fas` in 813 places and `fa-solid` in 35. One spelling, so a search for an
//     icon finds all of them.
//   · the name: a handful of Font Awesome 5 aliases (`fa-times`, `fa-edit`, `fa-save`, `fa-undo`…)
//     beside their v6 names, and EDIT drawn as a pencil on the hover pencils but as a pen on some
//     two dozen other controls. One glyph per meaning; edit is `fa-pencil`.
//   · `aria-hidden`: on a third of them. A decorative `<i>` with no words in it is announced by
//     some screen readers as a private-use character, and one reader at this table uses one.
//
// A second pass took the same two rules to the markup JS builds, and gave every control that is
// ONLY an icon a name: a button holding one glyph and no words says nothing at all to a screen
// reader unless it carries an `aria-label`.

const TEMPLATES = templateSources();
const where = (re, source) => [...source.matchAll(re)].map(m => source.slice(0, m.index).split("\n").length);
const offenders = re => TEMPLATES.flatMap(({ rel, source }) => where(re, source).map(line => `${rel}:${line}`));

describe("an icon in a template", () => {
	it("found the templates (guards every check below)", () => {
		expect(TEMPLATES.length).toBeGreaterThan(100);
		expect(offenders(/<i class="fas /g).length).toBeGreaterThan(500);
	});

	it("is written `fas`, never `fa-solid`", () => {
		expect(offenders(/<i\s+class="fa-solid /g)).toEqual([]);
	});

	it("uses the current name for its glyph, and the pencil for edit", () => {
		const OLD = /fa-(?:times|times-circle|edit|pen|pen-to-square|save|undo|info-circle|question-circle|exclamation-triangle|check-circle|dice-d20)(?![-\w])/g;
		expect(offenders(OLD)).toEqual([]);
	});

	// Only the bare form: an `<i>` that carries a tooltip, a title or a label of its own is saying
	// something, and hiding it would take that away.
	it("is hidden from a screen reader when it carries nothing but its class", () => {
		expect(offenders(/<i class="(?:fas|far|fab) [^"<>]*"><\/i>/g)).toEqual([]);
	});
});

describe("an icon in markup built in JS", () => {
	const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
		.flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
	const FILES = [...walk(repoPath("module")), repoPath("stonetop.js")];
	// With ", ' or an escaped \" round the class; a `${…}` inside it is still an icon.
	const ICON = /<i class=\\?["'](?:fas|far|fab) [^>]*><\/i>/g;

	it("found the modules", () => {
		expect(FILES.length).toBeGreaterThan(300);
	});

	it("is hidden from a screen reader when it carries nothing but its class", () => {
		const bare = FILES.flatMap(file => {
			const source = fs.readFileSync(file, "utf8");
			return [...source.matchAll(ICON)].filter(m => !/aria-hidden|data-tooltip|title=|aria-label/.test(m[0]))
				.map(m => `${path.relative(repoPath("."), file)}:${source.slice(0, m.index).split("\n").length}`);
		});
		expect(bare).toEqual([]);
	});

	// The same rule for an `<i>` made with createElement, which the markup check above cannot see:
	// the element it is assigned to must be given aria-hidden before it is used. Read a few lines on,
	// where the class is set beside it.
	it("is hidden from a screen reader when it is made with createElement", () => {
		const MADE = /const (\w+) = [^;\n]*createElement\(\s*["']i["']\s*\);/g;
		const unhidden = [];
		let made = 0;
		for (const file of FILES) {
			const source = fs.readFileSync(file, "utf8");
			for (const m of source.matchAll(MADE)) {
				made++;
				const after = source.slice(m.index, m.index + 400).split("\n").slice(0, 6).join("\n");
				if (!new RegExp(`${m[1]}\\.setAttribute\\(\\s*["']aria-hidden["']`).test(after)) {
					unhidden.push(`${path.relative(repoPath("."), file)}:${source.slice(0, m.index).split("\n").length}`);
				}
			}
		}
		expect(made, "found the createElement icons").toBeGreaterThan(5);
		expect(unhidden).toEqual([]);
	});

	// Except a window header's control, which core draws from the class on the button itself and
	// spells `fa-solid` (STYLEGUIDE.md, Known gaps 12).
	it("is written `fas` when it is made with createElement", () => {
		const SOLID = /\.className = ["'`][^"'`]*\bfa-solid\b/;
		const solid = FILES.flatMap(file => fs.readFileSync(file, "utf8").split("\n")
			.map((line, i) => SOLID.test(line) && !/header-control/.test(line) ? `${path.relative(repoPath("."), file)}:${i + 1}` : null)
			.filter(Boolean));
		expect(solid).toEqual([]);
	});
});

// A CONTROL WITH NO WORDS OF ITS OWN HAS A NAME. That is an icon-only button, and also an EMPTY one
// (a Loyalty pip, a resource circle: the look is all CSS), and a field whose only explanation is
// its hover help. A native `title` used to double as the name for all of these; `data-tooltip`
// does not, and a screen reader read them as a bare "button" or "edit text" once the titles went.
describe("a control that is only an icon", () => {
	// Named at runtime instead: the relationship map's group bar writes both buttons' aria-label
	// with the count in it each time it changes (relmap-group-bar.js#_sayCount).
	const NAMED_IN_JS = new Set(["stonetop-relmap-tiebar-btn stonetop-relmap-groupbar-who"]);
	const BLOCKS = /\{\{\s*(?:#if|#unless|else if|else|\/if|\/unless|\^)[^}]*\}\}/g;
	const unnamed = [];
	let seen = 0;
	for (const { rel, source } of TEMPLATES) {
		for (const tag of openingTags(source)) {
			if (tag.name !== "button" && tag.name !== "a") continue;
			const close = source.indexOf(`</${tag.name}>`, tag.end);
			if (close < 0) continue;
			const inner = source.slice(tag.end, close).replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![^}]*\}\}/g, "").replace(BLOCKS, "");
			// A mustache left outside the <i> is a label printed from data: not icon-only.
			if (/\{\{/.test(inner.replace(/<i\b[^>]*>/g, ""))) continue;
			// Nothing but icons, or nothing at all.
			if (!/^(?:\s*<i\b[^>]*>\s*<\/i>\s*)*$/.test(inner)) continue;
			seen++;
			const has = name => tag.attrs.some(a => a.name === name);
			if (has("aria-label") || has("aria-labelledby") || has("aria-hidden")) continue;
			if (NAMED_IN_JS.has(tag.attrs.find(a => a.name === "class")?.raw)) continue;
			unnamed.push(`${rel}:${source.slice(0, tag.start).split("\n").length}`);
		}
	}

	it("found them", () => {
		expect(seen).toBeGreaterThan(150);
	});

	it("says what it does", () => {
		expect(unnamed).toEqual([]);
	});
});

describe("a field explained only by its tooltip", () => {
	// An input with hover help and nothing else naming it: no aria-label, no id a <label for> could
	// point at, and not inside a <label>. Its tooltip is the only thing that says what it is for,
	// and a screen reader never hears a tooltip.
	const unnamed = [];
	let seen = 0;
	for (const { rel, source } of TEMPLATES) {
		for (const tag of openingTags(source)) {
			if (tag.name !== "input") continue;
			const has = name => tag.attrs.some(a => a.name === name);
			const type = tag.attrs.find(a => a.name === "type")?.raw ?? "text";
			if (["hidden", "submit", "button"].includes(type)) continue;
			if (!has("data-tooltip") && !has("data-tooltip-text")) continue;
			seen++;
			if (has("aria-label") || has("aria-labelledby") || has("id")) continue;
			const before = source.slice(0, tag.start);
			if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue;
			unnamed.push(`${rel}:${before.split("\n").length}`);
		}
	}

	it("found them", () => {
		expect(seen).toBeGreaterThan(10);
	});

	it("has a name besides", () => {
		expect(unnamed).toEqual([]);
	});
});
