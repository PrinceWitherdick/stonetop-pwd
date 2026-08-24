import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "What to prep" is no longer a step of the Run an Expedition walkthrough.
//
// It is between-sessions homework, and as a twelfth step it sat PAST "Going home", where a GM
// prepping for next week had already clicked Done and closed the window. It rides on the intro
// step now, as a headed aside below the prose, which is where a GM who opens this guide to prep
// actually is. Two things have to hold for that to be an improvement rather than a loss: the
// advice must still be here in full, and the last step must still be the one carrying Done and
// "Save to the Chronicle".

// The route step browses the art folder on render; nothing here renders a map, but the module
// is imported. Same fake as the sibling expedition suites.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");

const steps = Object.create(ExpeditionDialog.prototype)._steps;
const intro = steps[0];

const read = rel => fs.readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", rel), "utf8");
const DIALOG_JS = read("module/dialogs/ExpeditionDialog.js");
const HBS       = read("templates/dialogs/expedition.hbs");
const CSS       = read("styles/stonetop.css");

/** A dialog instance without the Application constructor, as the sibling suites build one. */
function dialog(stepIndex = 0) {
	const d = Object.create(ExpeditionDialog.prototype);
	d._step  = stepIndex;
	d._rolls = {};
	return d;
}

let store;

beforeEach(() => {
	store = { expeditionAnswers: {} };
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("the walkthrough's steps", () => {
	it("no longer end on a step about prepping", () => {
		expect(steps.some(s => s.key === "prepAfter")).toBe(false);
		expect(steps.map(s => s.title)).not.toContain("What to prep");
		expect(steps.at(-1).key).toBe("home");
	});

	// Done and "Save to the Chronicle" render behind `isLast`, which reads `isFinal` off the
	// active step. Dropping the step that carried it would leave the walkthrough with no way to
	// finish and no way to save the trip.
	it("hand Done and the Chronicle save to exactly one step, the last one", () => {
		const final = steps.filter(s => s.isFinal);
		expect(final.map(s => s.key)).toEqual(["home"]);
		expect(final[0]).toBe(steps.at(-1));
	});

	// The Chronicle compiles a logged trip into a page of headed prose, and each of those
	// headings has exactly one source: a note field on the step it belongs to. Drop the field and
	// the heading does not vanish with it — buildExpeditionPage still reads the key, so the
	// section goes permanently blank on new trips while the notes already typed on old ones are
	// stranded, still printed on the page with nowhere left to edit them. So the two are pinned to
	// each other here rather than left to be noticed a season later.
	//
	// ONE EXEMPTION, and it is the other half of the same rule rather than a hole in it.
	// "Other preparations" was retired as a step, so `exp.prep` has no writer by design — and
	// the Chronicle deliberately goes on READING it, because trips logged while the step existed
	// still carry what a GM typed there and deleting the line would un-print it from pages that
	// already hold it. Naming it here is what keeps that a decision: an unlisted key with no
	// writer is still the accident this test was written for.
	//
	// `running` is the second, on the same terms. "Running the journey" asked for the points of
	// interest and the legs of travel, which is the question the route step before it already
	// answers on a map — so the box went and the step is prose and a die now. The Chronicle keeps
	// reading the key for the trips that were logged with it, and keeps printing them as "The
	// journey"; what it will not do is offer a heading nobody can fill in.
	//
	// `outfit` is the third, and the same shape again: "who's carrying what, and what loads" is
	// what the live party-load readout on that step already reads off the sheets, so the box under
	// it went. Stored answers still print as "Outfit & supplies".
	//
	// `requisition` is the fourth. What they borrowed is what the step's asset list is TICKED
	// with, and the Chronicle prints those names under "Requisitioned" on its own — so that
	// heading keeps a writer even with the box gone, and stored sentences still print beneath it.
	const RETIRED = new Set(["prep", "running", "outfit", "requisition"]);

	it("give every prose section the Chronicle compiles somewhere to be written", () => {
		const chronicle = read("module/utils/chronicle-core.js");
		const page = chronicle.slice(chronicle.indexOf("function buildExpeditionPage"));
		const reads = [...page.matchAll(/paragraphs\(exp\?\.(\w+)\)/g)].map(m => m[1]);
		// Retired, but the Chronicle must go on reading it or the notes already typed on trips
		// logged with the box un-print themselves. Also the canary that the match above still
		// matches anything at all.
		expect(reads).toContain("outfit");

		const writable = new Set(steps.filter(s => s.qa?.kind === "single").map(s => s.qa.key));
		for (const key of reads) {
			if (RETIRED.has(key)) continue;
			expect([...writable], `nothing writes exp.${key}`).toContain(key);
		}
		// And the exemption is not allowed to go stale: a retired key that gains a step again
		// should be struck from the list rather than left claiming to be write-only.
		for (const key of RETIRED) expect([...writable], `exp.${key} has a step again`).not.toContain(key);
	});

	// The step itself is gone from the rail, which is the visible half of the above.
	it("no longer walks the GM through a step of its own for the rest of prep", () => {
		expect(steps.some(s => s.key === "prep")).toBe(false);
		expect(steps.map(s => s.title)).not.toContain("Other preparations");
	});
});

describe("the intro step's \"what to prep\" aside", () => {
	it("heads the advice rather than asking whether you want it", () => {
		expect(intro.key).toBe("intro");
		expect(intro.aside.label).toBe("What to prep");
	});

	// The whole point of moving it was to keep it, so this pins the book's advice (Book I
	// p.340-341) line by line rather than just checking that SOME text came along.
	it("still carries every line of the advice the step used to print", () => {
		for (const line of [
			"Chart the course",
			"Draw a map",
			"Identify points of interest",
			"Identify the legs",
			"2&ndash;3 impressions",
			"7 encounters",
			"Die of Fate table",
			"site",
			"danger",
			"discovery",
			"NPC",
			"followers",
			"Book II",
		]) expect(intro.aside.body, line).toContain(line);
	});

	// The book's own cross-references out of "What to prep" (Book I p.340-341). They are the
	// reason the aside is worth reading at prep time: each one is a chapter the GM has to open
	// next. A wrong number sends them to the wrong chapter, and nothing else in this file would
	// catch a typo in one, so every page the copy cites is pinned to what the book cites.
	it("cites the pages the book sends you to, and no others", () => {
		const cited = [...intro.aside.body.matchAll(/\(p\.(\d+)\)/g)].map(m => m[1]);
		expect(cited).toEqual([
			"340", // "What to prep" itself
			"324", // Die of Fate: the weather
			"334", // Die of Fate: events while they Make Camp
			"323", // Die of Fate: a perilous area
			"355", // Creating sites
			"379", // Dangers
			"421", // Discoveries
			"453", // Creating NPCs
			"474", // Creating followers
		]);
	});

	// The intro used to promise five parts and the walkthrough now has four; a stale sentence
	// there would send the reader hunting for a step that isn't in the rail.
	it("no longer promises prep as a leg of the walk", () => {
		expect(intro.body).toContain("<strong>going home</strong>.</p>");
		expect(intro.body).not.toContain("between sessions");
	});

	it("is the only step with one", () => {
		expect(steps.filter(s => s.aside).map(s => s.key)).toEqual(["intro"]);
	});
});

describe("the aside's wiring", () => {
	it("reaches the template only on a step that has one", async () => {
		expect((await dialog().getData()).aside).toMatchObject({ label: intro.aside.label });

		// Every other step: no aside, so the template's `{{#if aside}}` renders nothing.
		const other = dialog(steps.findIndex(s => s.key === "chart"));
		expect((await other.getData()).aside).toBe(null);
	});

	it("renders a head and the body, with nothing gating the body shut", () => {
		expect(HBS).toContain('<h3 class="stonetop-guide-aside-head">{{aside.label}}</h3>');
		expect(HBS).toContain("{{{aside.body}}}");
		// The body borrows the step body's prose styling, so the advice reads the same here as
		// it did when it was a step of its own — and it carries no open/shut state at all.
		expect(HBS).toContain('class="stonetop-guide-aside-body stonetop-spring-body"');
		expect(HBS).not.toContain("aside.open");
	});

	// The advice is between-sessions homework a GM opened this guide to read, so it stands
	// open. Nothing left on the dialog or in the template may be able to fold it away again.
	it("keeps no fold machinery behind it", () => {
		expect(DIALOG_JS).not.toContain("_asideOpen");
		expect(DIALOG_JS).not.toContain("stonetop-guide-aside-toggle");
		expect(HBS).not.toContain("stonetop-guide-aside-toggle");
		expect(CSS).not.toContain(".stonetop-guide-aside-toggle");
	});

	it("styles the head and leaves the body displayed", () => {
		expect(CSS).toContain(".stonetop-guide-aside-head");
		expect(CSS).not.toMatch(/\.stonetop-guide-aside-body\s*\{[^}]*display:\s*none/);
	});
});
