import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { repoPath } from "../fakes/css.js";

// A TOOLTIP BUILT IN JS IS FOUNDRY'S, NOT THE BROWSER'S (STYLEGUIDE.md, "Chat cards, journal
// pages, HUD"). The template half of this rule, and why it exists, is tooltip-conventions.test.js:
// a native `title` ignores the reader's palette and Sheet Text Size and never shows on a touch
// screen. This is the same rule for markup a module builds: no `title="…"` in a markup string, no
// `setAttribute("title", …)`, and no `.title =` on an element.
//
// `.title =` IS ALSO HOW A DATA OBJECT GETS ITS TITLE (a resource, a snapshot, a parsed playbook
// block), and nothing in the source says which is which. So the check is deny-by-default: every
// `.title =` fails unless its receiver is on DATA_RECEIVERS. A new element write therefore cannot
// slip past under a name nobody thought of; a new data write costs one line here.
//
// THE STATED EXCEPTIONS, by file, and why each keeps its `title`:
//   · journal/journal-image-titles.js sets one on purpose for the length of one synchronous read
//     by core, then removes it. It is not a tooltip.
//   · books/reader-bookmarks-tab.js builds its buttons inside the pdf.js viewer's iframe, where
//     Foundry's tooltip manager is not loaded; pdf.js's own toolbar uses native titles there.
//   · journal/steading-improvement-cards.js and threats/threat-seed-cards.js build the draggable
//     cards whose markup is also baked into seven pack pages and refreshed by a migration. Held
//     back for the owner's decision (STYLEGUIDE.md, gap 10); take them off when that lands.

const EXCEPTIONS = new Set([
	"module/journal/journal-image-titles.js",
	"module/books/reader-bookmarks-tab.js",
	"module/journal/steading-improvement-cards.js",
	"module/threats/threat-seed-cards.js",
]);

// Receivers of `.title =` that are data, not elements: models and snapshots (`this`), a window's
// options, a resource, an expedition entry, and the playbook reader's parsed blocks.
const DATA_RECEIVERS = new Set(["this", "this.options", "resource", "entry", "cur", "g", "p"]);

const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
	.flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []);
const FILES = [...walk(repoPath("module")), repoPath("stonetop.js")]
	.map(file => ({ rel: path.relative(repoPath("."), file).split(path.sep).join("/"), source: fs.readFileSync(file, "utf8") }));

// A comment may say `title=` while explaining this very rule.
const code = line => !/^\s*(?:\/\/|\*|\/\*)/.test(line);
const ASSIGN = /([\w$.]+)\.title\s*=(?!=)/g;
const MARKUP = /(?<![-\w])title=["'$\\]|setAttribute\(\s*["']title["']/;

const offences = ({ rel, source }) => source.split("\n").flatMap((line, i) => {
	if (!code(line)) return [];
	const found = [];
	for (const m of line.matchAll(ASSIGN)) if (!DATA_RECEIVERS.has(m[1])) found.push(`${rel}:${i + 1} ${m[1]}.title =`);
	if (MARKUP.test(line)) found.push(`${rel}:${i + 1} title in markup`);
	return found;
});

// A TOOLTIP THAT COMES AND GOES IS SET THROUGH setTooltip (module/utils/set-tooltip.js). Taking one
// away by hand meant each site picked its own form and its own idea of "no words", and a site that
// cleared `data-tooltip` left a `data-tooltip-text` behind. So no module deletes or removes either
// attribute itself, except:
//   · utils/set-tooltip.js, the helper.
//   · utils/clip-tooltips.js, which clears its own set (the HTML form and the direction too), all
//     of which only it ever writes.
const CLEAR_EXCEPTIONS = new Set(["module/utils/set-tooltip.js", "module/utils/clip-tooltips.js"]);
const CLEAR = /delete\s+[\w$.?]+\.dataset\.tooltip(?:Text)?\b(?!Html|Direction)|removeAttribute\(\s*["']data-tooltip(?:-text)?["']/;
const clears = ({ rel, source }) => source.split("\n")
	.flatMap((line, i) => (code(line) && CLEAR.test(line) ? [`${rel}:${i + 1}`] : []));

describe("a tooltip cleared in JS", () => {
	it("tells a hand-written clear from everything else", () => {
		const probe = source => clears({ rel: "x.js", source });
		expect(probe("delete btn.dataset.tooltip;")).toHaveLength(1);
		expect(probe("delete el.dataset.tooltipText;")).toHaveLength(1);
		expect(probe("btn.removeAttribute(\"data-tooltip\");")).toHaveLength(1);
		expect(probe("delete el.dataset.tooltipDirection;")).toHaveLength(0);
		expect(probe("setTooltip(btn, \"\");")).toHaveLength(0);
	});

	it("goes through setTooltip, outside the stated exceptions", () => {
		expect(FILES.filter(f => !CLEAR_EXCEPTIONS.has(f.rel)).flatMap(clears)).toEqual([]);
	});
});

describe("a tooltip built in JS", () => {
	it("read the modules, and tells an element's title from a data object's", () => {
		expect(FILES.length).toBeGreaterThan(300);
		const probe = source => offences({ rel: "x.js", source });
		expect(probe("btn.title = \"Roll\";")).toHaveLength(1);
		expect(probe("resource.title = label;")).toHaveLength(0);
		expect(probe("if (a.title == b) go();")).toHaveLength(0);
		expect(probe("const html = `<a title=\"x\">y</a>`;")).toHaveLength(1);
		expect(probe("const html = `<a data-title=\"x\" data-tooltip=\"y\">z</a>`;")).toHaveLength(0);
		expect(probe("el.setAttribute(\"title\", words);")).toHaveLength(1);
		expect(probe("// never write title=\"…\" here")).toHaveLength(0);
	});

	it("is not a native title, outside the stated exceptions", () => {
		expect(FILES.filter(f => !EXCEPTIONS.has(f.rel)).flatMap(offences)).toEqual([]);
	});

	it("lists no exception that no longer writes a title", () => {
		const listed = [...EXCEPTIONS].map(rel => FILES.find(f => f.rel === rel));
		expect([...EXCEPTIONS].filter((rel, i) => !listed[i]), "a listed module is gone").toEqual([]);
		expect(listed.filter(f => f && !offences(f).length).map(f => f.rel)).toEqual([]);
	});
});
