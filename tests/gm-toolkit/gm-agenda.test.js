import Handlebars from "handlebars";
import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import {
	GM_AGENDA, GM_PRINCIPLES, GM_THE_LINE, GM_DONTS, FIRST_ADVENTURE_PREP, FIRST_ADVENTURE_HOOKS,
} from "../../module/gm-toolkit/gm-agenda-text.js";
import { localizedRunningReference, firstAdventureHooksHtml } from "../../module/gm-toolkit/gm-agenda-view.js";
import { SEASONAL_GAINS } from "../../module/dialogs/spring-burst-data.js";
import { SpringBurstDialog } from "../../module/dialogs/SpringBurstDialog.js";

// Running the game as reference, on the GM Toolkit's Core Loop tab: the agenda (Book I p.168), the
// principles (pp.192-199), the Line (p.195), what not to do (p.202) and the first adventure's prep
// (pp.251-273), whose per-result hook guidance (pp.255-259) the Spring Burst walkthrough shows too.

const LOOP_HBS = read("templates/actor/partials/gm-toolkit-tab-loop.hbs");

function renderLoopTab() {
	const hb = Handlebars.create();
	hb.registerHelper("localize", key => key);
	hb.registerPartial("stonetop.section-heading", read("templates/actor/partials/section-heading.hbs"));
	hb.registerPartial("stonetop.section-collapse", read("templates/actor/partials/section-collapse.hbs"));
	hb.registerPartial("stonetop.book-page-cite", read("templates/actor/partials/book-page-cite.hbs"));
	return hb.compile(LOOP_HBS)({ stonetop: { diagrams: [], running: localizedRunningReference() } });
}

describe("the book's lists", () => {
	it("has the three goals of the agenda (p.168)", () => {
		expect(GM_AGENDA.items.map(i => i.name)).toEqual([
			"Portray a rich and mysterious world",
			"Punctuate the characters' lives with adventure",
			"Play to find out what happens",
		]);
	});

	it("has the thirteen principles in the book's order (p.192)", () => {
		expect(GM_PRINCIPLES.map(p => p.name)).toEqual([
			"Follow the rules", "Begin and end with the fiction", "Address the characters, not the players",
			"Ask questions and build on the answers", "Be a fan of the player characters",
			"Embrace the fantastic and the mundane", "Exploit the setting guide", "Respect your prep",
			"Give your characters life", "Think offscreen, too", "Bring it home", "Let things breathe",
			"Let things burn",
		]);
		for (const p of GM_PRINCIPLES) expect(p.page).toBeGreaterThanOrEqual(192);
	});

	it("names who owns what across the Line (p.195), and the four don'ts (p.202)", () => {
		expect(GM_THE_LINE.page).toBe(195);
		expect(GM_THE_LINE.items[0].line).toContain("In charge of their characters");
		expect(GM_DONTS.items).toHaveLength(4);
	});

	it("lists the opening scene's ten homefront moves (p.268)", () => {
		expect(FIRST_ADVENTURE_PREP.sceneMoves).toHaveLength(10);
		expect(FIRST_ADVENTURE_PREP.steps.map(s => s.name)).toContain("If they ignore the hook");
	});

	it("keys every gain's hook guidance to a seasonal gain the walkthrough ticks", () => {
		const keys = new Set(SEASONAL_GAINS.map(g => g.key));
		for (const tier of FIRST_ADVENTURE_HOOKS) for (const g of tier.gains) expect(keys.has(g.gain), g.gain).toBe(true);
		// A 10+ is the three gains that hand you a hook; a 7-9 can be any of the six.
		expect(FIRST_ADVENTURE_HOOKS[0].gains.map(g => g.gain)).toEqual(["news", "insight", "trade"]);
		expect(FIRST_ADVENTURE_HOOKS[1].gains).toHaveLength(6);
	});

	it("puts no em dash in the copy", () => {
		const all = JSON.stringify([GM_AGENDA, GM_PRINCIPLES, GM_THE_LINE, GM_DONTS, FIRST_ADVENTURE_PREP, FIRST_ADVENTURE_HOOKS]);
		expect(all).not.toContain(String.fromCharCode(0x2014));
	});
});

describe("the Core Loop tab", () => {
	it("is handed the reference by the toolkit sheet", () => {
		const sheet = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
		expect(sheet).toContain("context.stonetop.running = localizedRunningReference();");
	});

	it("draws each section in its own box, shut until opened, with localized headings", () => {
		const html = renderLoopTab();
		const boxes = html.split('<div class="stonetop-move-group stonetop-gm-running-section');
		expect(boxes).toHaveLength(5 + 1);
		for (const box of boxes.slice(1)) expect(box.match(/stonetop-move-group-title/g) ?? []).toHaveLength(1);
		expect(html).toContain("Your agenda");
		expect(html).toContain("The Line");
		expect(html).toContain("First adventure prep");
		expect(html).toContain("Let things burn");
		expect(html).toContain("Threats abound");
	});
});

describe("the hook guide", () => {
	it("marks the gains already picked and escapes its copy", () => {
		const html = firstAdventureHooksHtml({ picked: { bounty: true } });
		expect(html).toContain('class="stonetop-hook-gain is-picked" data-gain="bounty"');
		expect(html).not.toContain('is-picked" data-gain="tor"');
		expect(html).toContain("Tor&#x27;s blessing");
	});

	it("rides under the hook field on the Spring Burst roll step", () => {
		const roll = new SpringBurstDialog()._steps.find(s => s.key === "roll");
		expect(roll.hookGuide).toBe(true);
		expect(read("templates/dialogs/spring-burst.hbs")).toContain("{{{this.hookGuide}}}");
	});
});
