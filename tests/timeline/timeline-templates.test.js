import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo, repoFileExists, readCss } from "../fakes/css.js";

// THE TIMELINE'S TEMPLATES, COMPILED. A Handlebars syntax error -- an unclosed block, a mistyped
// helper, a `{{#if}}` whose `{{/if}}` went missing in an edit -- throws only when the template is
// first rendered, which for these is inside a running world. The tab then shows nothing at all and
// the console carries one line. Compiling here is what turns that into a test failure.
//
// COMPILED, not rendered: `Handlebars.compile` parses the whole template including its `{{> ... }}`
// references, and only RESOLVES a partial at render time. So this covers the syntax without the
// test having to stand up the partial registry Foundry provides, which is the part
// tests/templates/partial-registration.test.js already guards from the other side.

const TEMPLATES = [
	"templates/dialogs/timeline.hbs",
	"templates/dialogs/timeline-entry.hbs",
	"templates/dialogs/partials/timeline-card.hbs",
	"templates/dialogs/partials/timeline-period.hbs",
	"templates/dialogs/partials/timeline-period-head.hbs",
	"templates/dialogs/partials/timeline-hperiod.hbs",
	"templates/dialogs/partials/timeline-lane-head.hbs",
	"templates/dialogs/partials/timeline-entry-tag.hbs",
	"templates/actor/partials/tab-timeline.hbs",
	"templates/actor/partials/steading-tab-timeline.hbs",
	"templates/journal/timeline-page.hbs",
];

describe("every timeline template compiles", () => {
	for (const rel of TEMPLATES) {
		it(`compiles ${rel.split("/").pop()}`, () => {
			expect(repoFileExists(rel), `${rel} is not on disk`).toBe(true);
			expect(() => Handlebars.compile(readRepo(rel))).not.toThrow();
		});
	}
});

describe("the tab bodies are left empty for their panel", () => {
	// ⚠ The panel replaces the mount's CHILDREN. Markup put inside the mount by the template would
	// be thrown away on the first render and would have been visible until then, which reads as a
	// flash of the wrong thing. Both tabs mount by the same attribute, so both are checked.
	for (const rel of ["templates/actor/partials/tab-timeline.hbs", "templates/actor/partials/steading-tab-timeline.hbs"]) {
		it(`leaves the mount empty in ${rel.split("/").pop()}`, () => {
			const html = readRepo(rel);
			expect(html, "the mount is not marked for the tab module to find").toContain("data-stonetop-timeline");
			// The mount element closes immediately, with nothing between its tags.
			expect(html).toMatch(/data-stonetop-timeline\s*>\s*<\/section>/);
		});
	}

	// The tab module finds its mount by exactly this attribute; a rename on one side alone is a tab
	// that renders nothing, silently.
	it("uses the attribute the tab module actually queries for", () => {
		expect(readRepo("module/timeline/timeline-tab.js")).toContain('"[data-stonetop-timeline]"');
	});
});

describe("the aggregate's markup and its stylesheet agree", () => {
	// The columns line up because the header row and every season row are flex rows sharing one
	// gutter width. That only holds while the markup keeps emitting the spacer that stands in for
	// the gutter in the header row: without it every lane shifts one column left of its name.
	it("keeps the spacer that stands in for the season gutter in the header row", () => {
		expect(readRepo("templates/dialogs/timeline.hbs")).toContain("stonetop-timeline-lane-spacer");
		expect(readCss()).toContain(".stonetop-timeline-lane-spacer");
	});

	// Every class the delegated click listener reads has to exist in the markup, or the control is
	// rendered and dead. These are the ones it looks for.
	it("emits every control the window's listener binds to", () => {
		const markup = readRepo("templates/dialogs/timeline.hbs")
			+ readRepo("templates/dialogs/partials/timeline-card.hbs");
		const wiring = readRepo("module/dialogs/TimelineWindow.js");
		for (const cls of [
			"stonetop-timeline-new",
			"stonetop-timeline-open-full",
			"stonetop-timeline-orient",
			"stonetop-timeline-show-all",
			"stonetop-timeline-show",
			"data-timeline-source",
			"stonetop-timeline-edit",
			"stonetop-timeline-remove",
			"stonetop-timeline-move",
		]) {
			expect(markup, `${cls} is bound but never rendered`).toContain(cls);
			expect(wiring, `${cls} is rendered but never bound`).toContain(cls);
		}
	});

	// The listener reads which thread a click belongs to off `data-track-id`, falling back to the
	// panel's own track. In the aggregate there is no such fallback, so the lanes must carry it.
	it("stamps every lane with the thread it belongs to", () => {
		expect(readRepo("templates/dialogs/timeline.hbs"))
			.toMatch(/stonetop-timeline-lane[^"]*"\s*\n?\s*data-track-id=/);
	});
});

describe("a Seasons Change inside its season's heading", () => {
	// User, 2026-10-03: what the season recorded prints in the heading, not as a card under it.
	const render = (period) => {
		const hb = Handlebars.create();
		hb.registerHelper("localize", key => key);
		return hb.compile(readRepo("templates/dialogs/partials/timeline-period-head.hbs"))(period);
	};
	const period = (notes) => ({ seasonLabel: "Spring", yearLabel: "Year One", glyphClass: "", seasonNotes: notes });

	// On the aggregate the heading sits in no lane, so the note carries its own thread for the
	// window's listener, and its own row id for Edit and Remove.
	it("prints each note with its row and thread, and the writer's Edit and Remove", () => {
		const html = render(period([{ id: "s1", trackId: "steading", title: "", enrichedBody: "<p>Surplus: +1</p>", canEdit: true }]));
		expect(html).toMatch(/class="stonetop-timeline-season-note" data-entry-id="s1" data-track-id="steading"/);
		expect(html).toContain("<p>Surplus: +1</p>");
		expect(html).toContain('class="stonetop-timeline-edit" data-entry-id="s1"');
		expect(html).toContain('class="stonetop-timeline-remove" data-entry-id="s1"');
	});

	it("gives a reader who cannot write the words alone", () => {
		const html = render(period([{ id: "s1", trackId: "steading", title: "", enrichedBody: "<p>Gains</p>", canEdit: false }]));
		expect(html).toContain("<p>Gains</p>");
		expect(html).not.toContain("stonetop-timeline-edit");
	});

	it("prints nothing extra for a season with no notes", () => {
		expect(render(period([]))).not.toContain("stonetop-timeline-season-notes");
	});

	// A pill-shaped heading has to become a box the notes fit in, so every host says it holds some.
	it("marks every host of the heading that holds notes", () => {
		const hosts = readRepo("templates/dialogs/timeline.hbs")
			+ readRepo("templates/dialogs/partials/timeline-period.hbs")
			+ readRepo("templates/dialogs/partials/timeline-hperiod.hbs");
		const tags = hosts.match(/<[^>]*\{\{seasonClass\}\}[^>]*>/g) ?? [];
		expect(tags).toHaveLength(4);
		for (const tag of tags) expect(tag).toContain("{{#if seasonNotes.length}} stonetop-timeline-head--notes{{/if}}");
		expect(readCss()).toContain(".stonetop-timeline-head--notes");
	});

	// A partial called on a line of its own takes that line's indent onto every line it prints, so a
	// `<pre>` in a note gains the template's tabs. Core v14 and the release bundle compile with
	// `preventIndent`; v13 and a hot reload do not. `{{~>` makes the call not stand alone.
	it("is called so that it never indents a note's lines", () => {
		const hosts = readRepo("templates/dialogs/timeline.hbs")
			+ readRepo("templates/dialogs/partials/timeline-period.hbs")
			+ readRepo("templates/dialogs/partials/timeline-hperiod.hbs");
		const calls = hosts.match(/\{\{~?>\s*"stonetop\.timeline-period-head"\}\}/g) ?? [];
		expect(calls).toHaveLength(4);
		for (const call of calls) expect(call).toMatch(/^\{\{~>/);

		const hb = Handlebars.create();
		hb.registerPartial("head", "{{{body}}}");
		const host = (call) => hb.compile(`<header>\n\t\t${call}\n</header>`)({ body: "<pre>a\nb</pre>" });
		expect(host("{{> head}}"), "the mechanism this guards against").toContain("<pre>a\n\t\tb</pre>");
		expect(host("{{~> head}}")).toContain("<pre>a\nb</pre>");
	});
});
