import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { buildSiteCardVM } from "../../module/sites/site-view.js";
import { shapeSiteSystem } from "../../module/sites/site-store.js";
import { LIGHT_TAGS, SITE_CONSIDERATIONS } from "../../module/sites/site-running.js";
import { GEAR_TERMS } from "../../module/data/gear-terms.js";

// A site card's "Running it" fold (Book I p.348): what to keep in mind while the PCs explore, with
// marching order among it, and the book's quick reference for light sources and their tags. The
// same on every site, shut until opened, and apart from the folds of what this site has written up.

const page = seed => ({ id: "s", uuid: "JournalEntry.j.JournalEntryPage.s", name: "Barrow", isOwner: true, system: shapeSiteSystem(seed) });

describe("the Running it fold", () => {
	it("rides on every site card, shut, even a foundation-only one", async () => {
		const vm = await buildSiteCardVM(page({ mannerLabel: "Barrow" }));
		expect(vm.runGroup).toMatchObject({ id: "run", show: true, open: false });
		expect(vm.running.considerations.map(c => c.name)).toContain("Marching order");
		expect(vm.running.lightTags.map(t => t.name)).toEqual(["Hand", "Close, area", "Reach, area", "Crude", "Dangerous", "Slow"]);
	});

	it("gives each card its own copy, so one card's fold state is not another's", async () => {
		const [a, b] = await Promise.all([buildSiteCardVM(page({})), buildSiteCardVM(page({}))]);
		a.runGroup.open = true;
		expect(b.runGroup.open).toBe(false);
	});

	it("names light tags the system's gear tags already define", () => {
		for (const tag of LIGHT_TAGS.flatMap(t => t.name.toLowerCase().split(", "))) {
			expect(GEAR_TERMS[tag], tag).toBeTruthy();
		}
		expect(SITE_CONSIDERATIONS).toHaveLength(8);
	});

	it("is drawn by the site card as its own fold", () => {
		const hbs = read("templates/journal/partials/site-card.hbs");
		expect(hbs).toContain('{{#> "stonetop.site-group" group=runGroup}}');
		expect(hbs).toContain("{{#each running.lightTags}}");
	});
});
