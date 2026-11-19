import { describe, expect, it } from "vitest";
import { openingTags, templateSources } from "../fakes/hbs.js";

// A TOOLTIP IS FOUNDRY'S, NOT THE BROWSER'S (STYLEGUIDE.md, "Chat cards, journal pages, HUD").
//
// A native `title` is drawn by the operating system: a small grey box in the system font, at the
// system's size. It ignores the reader's palette and their Sheet Text Size, which are the two
// settings a low-vision player at this table depends on, and it cannot be seen at all on a touch
// screen. `data-tooltip` is drawn by the page and follows both.
//
// TWO SPELLINGS, and the difference is not cosmetic. Core draws a plain `data-tooltip` as HTML, so:
//   · words we wrote, or a `{{localize}}` of a key we ship   → data-tooltip
//   · anything printed from data (a name a player typed)     → data-tooltip-text
//
// CONVERTED A WINDOW AT A TIME, because a tooltip that code rewrites has to be moved in the same
// change as the code that rewrites it (the fold caret's, the header's edit switch). The character
// sheet and every partial it draws went first, 2026-11-19, the NPC and monster sheets after it.
// PENDING is what is left, by exact
// path: take a template off it when its titles are gone, and nothing new may be added to it.

const PENDING = new Set([
	"templates/actor/partials/bestiary-line-list.hbs",
	"templates/actor/partials/steading-tab-neighbors.hbs",
	"templates/actor/partials/steading-tab-overview.hbs",
	"templates/dialogs/add-steading-member.hbs",
	"templates/dialogs/arcana-inspire.hbs",
	"templates/dialogs/background-neighbors.hbs",
	"templates/dialogs/character-onboarding.hbs",
	"templates/dialogs/companion-setup.hbs",
	"templates/dialogs/deaths-door.hbs",
	"templates/dialogs/expedition.hbs",
	"templates/dialogs/introductions.hbs",
	"templates/dialogs/people-gallery.hbs",
	"templates/dialogs/playbook-import-review.hbs",
	"templates/dialogs/possession-choices.hbs",
	"templates/dialogs/weather.hbs",
	"templates/dialogs/welcome.hbs",
	"templates/item/arcanum-sheet-edit.hbs",
	"templates/journal/bestiary.hbs",
	"templates/journal/location.hbs",
	"templates/journal/partials/bestiary-group-section.hbs",
	"templates/journal/partials/bestiary-section-head.hbs",
]);

// An <iframe> and an <abbr> are named and expanded by their title, which is what it is for there.
const titled = source => openingTags(source)
	.filter(tag => !["iframe", "abbr"].includes(tag.name) && tag.attrs.some(a => a.name === "title"));
const TEMPLATES = templateSources().map(({ rel, source }) => ({ rel, source, tags: openingTags(source) }));

describe("a tooltip in a template", () => {
	it("read the templates, and tells a partial's `title=` argument from an attribute", () => {
		expect(TEMPLATES.length).toBeGreaterThan(100);
		expect(titled('{{> section-heading title="Stats"}}<a title="x">y</a>')).toHaveLength(1);
		expect(titled('<a data-tooltip="{{localize "a.b"}}" class="c">y</a>')).toHaveLength(0);
	});

	it("is not a native title, outside the templates still waiting their turn", () => {
		const native = TEMPLATES.filter(({ rel, source }) => !PENDING.has(rel) && titled(source).length);
		expect(native.map(({ rel }) => rel)).toEqual([]);
	});

	it("lists no template that has already been converted", () => {
		const done = TEMPLATES.filter(({ rel, source }) => PENDING.has(rel) && !titled(source).length);
		expect(done.map(({ rel }) => rel)).toEqual([]);
		expect([...PENDING].filter(rel => !TEMPLATES.some(t => t.rel === rel)), "a listed template is gone").toEqual([]);
	});
});
