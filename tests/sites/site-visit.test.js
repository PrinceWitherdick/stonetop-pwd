import { describe, it, expect } from "vitest";
import {
	addVisit, readVisits, siteVisitMilestone, visitedLabel,
} from "../../module/sites/site-visits-core.js";
import { readRepo } from "../fakes/css.js";
import Handlebars from "handlebars";
import { withGmPrepTabs } from "../../module/actors/gmtoolkit/gm-prep-tabs.js";
import { localize } from "../../module/utils/i18n.js";

// A SITE, MARKED VISITED. The GM says the party has been there; it goes on their timelines and on
// the card. Pinned here: a later visit is its own row, and nothing GM-only crosses to a player.

const page = { id: "p1", name: "The Barrow", uuid: "JournalEntry.j.JournalEntryPage.p1" };

describe("the row a visit writes", () => {
	it("is named for the site and dated the season it was marked", () => {
		const row = siteVisitMilestone(page, { season: "summer", year: 2 });
		expect(row).toEqual({
			source: "site", key: "site:p1:2:summer", title: "Visited The Barrow", place: "The Barrow", season: "summer", year: 2,
		});
	});

	// Going back in winter is a second visit, not the summer one seen again.
	it("keys each season's visit apart", () => {
		expect(siteVisitMilestone(page, { season: "winter", year: 2 }).key).not.toBe(siteVisitMilestone(page, { season: "summer", year: 2 }).key);
	});

	// The site page sits in a GM-only journal; a link to it would be one no player can open.
	it("never links the GM's page", () => {
		expect(siteVisitMilestone(page, { season: "summer", year: 2 })).not.toHaveProperty("placeUuid");
	});
});

describe("the visits a site remembers", () => {
	it("adds a season once, oldest first", () => {
		let visits = addVisit([], { season: "winter", year: 2 });
		visits = addVisit(visits, { season: "summer", year: 1 });
		visits = addVisit(visits, { season: "winter", year: 2 });
		expect(visits).toEqual([{ season: "summer", year: 1 }, { season: "winter", year: 2 }]);
	});

	it("drops anything undated or malformed", () => {
		expect(readVisits([{ year: 2 }, null, "x", { season: "spring", year: 0 }])).toEqual([{ season: "spring", year: 1 }]);
	});

	it("tells the card the latest visit, and nothing for a site never visited", () => {
		expect(visitedLabel([{ season: "summer", year: 1 }, { season: "autumn", year: 3 }])).toBe("Visited in Autumn, Year Three");
		expect(visitedLabel([])).toBe("");
	});
});

describe("the button", () => {
	// Only a site card wears it; threats and hazards share the same tools partial. RENDERED, off
	// the view-models the tab really builds: the partial reads the card's own `prepActions` rather
	// than a flag its call site passes, so reading the source cannot say which cards it lands on.
	it("is offered on site cards alone", async () => {
		const host = new (withGmPrepTabs(class { render() {} }))();
		const hbs = Handlebars.create();
		hbs.registerHelper("localize", key => localize(key));
		hbs.registerPartial("stonetop.gm-prep-card-tools", readRepo("templates/actor/partials/gm-prep-card-tools.hbs"));
		// The call exactly as the tabs make it, from inside the card's own context.
		const draw = async kind => {
			const [vm] = await host._cardVMsFor(kind, [{ uuid: `u-${kind}`, _stats: {} }], async () => ({ isOwner: true, uuid: `u-${kind}` }));
			return hbs.compile(`{{> "stonetop.gm-prep-card-tools" kind="${kind}" uuid=uuid}}`)(vm);
		};

		const site = await draw("site");
		expect(site).toContain('class="site-visit" data-page-uuid="u-site"');
		expect(site).toContain(`aria-label="${localize("stonetop.sites.visit.button")}"`);
		expect(site).toContain(`data-tooltip="${localize("stonetop.sites.visit.tooltip")}"`);
		expect(site).toContain('<i class="fas fa-flag" aria-hidden="true">');
		for (const kind of ["threat", "hazard"]) {
			const html = await draw(kind);
			expect(html, kind).not.toContain("site-visit");
			// The pencil and the trash, plus a live threat's own Cross off (Book I p.299).
			expect(html.match(/<button/g), kind).toHaveLength(kind === "threat" ? 3 : 2);
		}
		expect(await draw("threat")).toContain('class="threat-resolve"');

		// ...and no call site switches it on by hand any more.
		expect(readRepo("templates/actor/partials/gm-toolkit-sites-section.hbs")).not.toContain("visit=");
		expect(readRepo("templates/actor/partials/gm-prep-card-tools.hbs")).not.toContain("{{#if visit}}");
	});

	// Declared on the site's row of the prep tools table and dispatched by the one loop over every
	// row's actions, not by a branch of its own ahead of the table.
	it("is wired through the GM Toolkit's prep tools table", () => {
		const src = readRepo("module/actors/gmtoolkit/gm-prep-tabs.js");
		expect(src).toMatch(/kind: "site",[\s\S]*?actions: \[[\s\S]*?cls: "site-visit"[\s\S]*?markSiteVisited\(page\)/);
		expect(src).toMatch(/for \(const action of tool\.actions \?\? \[\]\)/);
		expect(src).not.toContain(".steading-sites .site-visit");
	});

	// The party of the trip in hand is ticked to start with, which only works if the picker is
	// actually handed who to tick.
	it("hands the picker who to tick", () => {
		const picker = readRepo("module/dialogs/PersonPickerDialog.js");
		const wrapper = picker.slice(picker.indexOf("export function pickPerson("));
		expect(wrapper).toMatch(/formatManyLabel, selected,\n\t\}, \{ id:/);
		expect(readRepo("module/sites/site-visit.js")).toContain("selected:    party.map(pc => pc.id)");
	});
});
