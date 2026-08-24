import { describe, expect, it } from "vitest";
import {
	buildChroniclePages,
	mergeChronicleSections,
	SPRING_PAGE_KEY,
	SPRING_PAGE_NAME,
	EXPEDITION_PAGE_KEY_PREFIX,
} from "../../module/utils/chronicle-core.js";

// The compiler is pure — it only needs the recorded-answer blobs and a shaped PC
// roster, so these assert page shape, section omission, question-index resolution,
// the Spring Burst fold-in, and HTML escaping without any Foundry document wiring.
// Pages are structured: each is { key, name, sections }, where a section is a prose
// block ({ kind:"prose", heading, group, body }) or a Q&A block ({ kind:"qa",
// heading, group, pairs:[{prompt, answer}] }) — the LocationPageModel shape.

const sec     = (page, heading) => page.sections.find(s => s.heading === heading);
const bodyOf  = (page, heading) => sec(page, heading)?.body ?? "";
const pairsOf = (page, heading) => sec(page, heading)?.pairs ?? [];
const allBody = (page) => page.sections.map(s => s.body ?? "").join("\n");

const blessed = { id: "pc1", name: "Ana", playbookName: "The Blessed", slug: "the-blessed" };

function fullAnswers() {
	return {
		pc1: {
			r1: "She/her, raised by goat-herds.",
			r2: "A sacred pouch of seeds.",
			r3: "Danu's shrine sits by the spring.",
			r4: { q: 0, a: "Old Bemis, the goat-herd, is my closest kin." },
			r5: { q: 2, a: "Mother Aldercrone taught me the secret ways." },
			r6: { q: 3, a: "Bram has open doubts about Danu." },
			r7: { q: null, a: "" }, // passed
		},
	};
}

const springFull = {
	gains:   { trade: true },
	hook:    "Trade opportunity with the Hillfolk.",
	excites: { pc1: "Playing a healer who can also fight." },
};

describe("buildChroniclePages", () => {
	it("builds one page per PC with recorded content, named with the playbook", () => {
		const pages = buildChroniclePages({ pcs: [blessed], introAnswers: fullAnswers(), springAnswers: {} });
		expect(pages).toHaveLength(1);
		expect(pages[0].key).toBe("pc1");
		expect(pages[0].name).toBe("Ana — The Blessed");
	});

	it("renders prose sections and resolves Q&A question indices to their text", () => {
		const page = buildChroniclePages({ pcs: [blessed], introAnswers: fullAnswers(), springAnswers: {} })[0];
		expect(sec(page, "Introduction").kind).toBe("prose");
		expect(bodyOf(page, "Introduction")).toContain("She/her, raised by goat-herds.");
		expect(sec(page, "Possessions & contribution")).toBeTruthy();
		expect(sec(page, "Their place in Stonetop")).toBeTruthy();

		// r4 → step4[0], r5 → step4[2] (the playbook's "answer" questions).
		const bonds = sec(page, "Bonds & ties");
		expect(bonds.kind).toBe("qa");
		expect(bonds.pairs).toEqual([
			{ prompt: "Who is your closest kin?",        answer: "Old Bemis, the goat-herd, is my closest kin." },
			{ prompt: "Who taught you the secret ways?", answer: "Mother Aldercrone taught me the secret ways." },
		]);

		// r6 → step6[3] (the playbook's "ask" questions); r7 had no answer, so it's dropped.
		expect(pairsOf(page, "Asked of the others")).toEqual([
			{ prompt: "Which one of you doubts the power of Danu?", answer: "Bram has open doubts about Danu." },
		]);
	});

	it("decodes HTML entities in the resolved question text", () => {
		// step4[1] is authored as "Whose heart &amp; soul is entwined with yours?".
		const page = buildChroniclePages({
			pcs:          [blessed],
			introAnswers: { pc1: { r4: { q: 1, a: "My twin, Cerys." } } },
			springAnswers: {},
		})[0];
		expect(pairsOf(page, "Bonds & ties")[0].prompt).toBe("Whose heart & soul is entwined with yours?");
	});

	it("puts every section in the opening act so the page sheet draws no banner", () => {
		const page = buildChroniclePages({ pcs: [blessed], introAnswers: fullAnswers(), springAnswers: {} })[0];
		expect(page.sections.every(s => s.group === "glance")).toBe(true);
	});

	it("folds the per-PC Spring Burst 'what excites you' note onto the PC page", () => {
		const page = buildChroniclePages({ pcs: [blessed], introAnswers: fullAnswers(), springAnswers: springFull })[0];
		expect(bodyOf(page, "What excites their player")).toContain("Playing a healer who can also fight.");
	});

	it("appends a party Spring Burst page from the omen notes", () => {
		const pages = buildChroniclePages({ pcs: [blessed], introAnswers: fullAnswers(), springAnswers: springFull });
		const spring = pages.at(-1);
		expect(spring.key).toBe(SPRING_PAGE_KEY);
		expect(spring.name).toBe(SPRING_PAGE_NAME);
		expect(sec(spring, "The most hopeful")).toBeUndefined();
		expect(bodyOf(spring, "The season's omen")).toContain("Trade opportunity with the Hillfolk.");
	});

	it("names the ticked seasonal gain(s) in the omen section", () => {
		const spring = buildChroniclePages({
			pcs: [blessed], introAnswers: fullAnswers(),
			springAnswers: { gains: { trade: true, news: true }, hook: "Word from a passing merchant." },
		}).at(-1);
		const omen = bodyOf(spring, "The season's omen");
		expect(omen).toContain("Gains chosen:");
		expect(omen).toContain("Trade opportunity");
		expect(omen).toContain("Interesting news");
		expect(omen).toContain("Word from a passing merchant.");
	});

	it("omits empty sections and skips PCs with nothing recorded", () => {
		const pages = buildChroniclePages({
			pcs: [blessed, { id: "pc2", name: "Bram", playbookName: "The Heavy", slug: "the-heavy" }],
			introAnswers: { pc1: { r1: "Just an intro." } }, // pc2 has nothing
			springAnswers: {},
		});
		expect(pages).toHaveLength(1);
		expect(pages[0].sections.map(s => s.heading)).toEqual(["Introduction"]);
	});

	it("records an answer even when no question was marked", () => {
		const page = buildChroniclePages({
			pcs: [blessed],
			introAnswers: { pc1: { r4: { q: null, a: "A bond with no chosen prompt." } } },
			springAnswers: {},
		})[0];
		expect(pairsOf(page, "Bonds & ties")).toEqual([{ prompt: "", answer: "A bond with no chosen prompt." }]);
	});

	it("compiles the player-driven step4/step6 answer lists (multiple per step)", () => {
		const page = buildChroniclePages({
			pcs: [blessed],
			introAnswers: { pc1: {
				step4: { answers: [
					{ q: 0, a: "Old Bemis is my closest kin." },
					{ q: 2, a: "Mother Aldercrone taught me the secret ways." },
				], passed: true },
				step6: { answers: [
					{ q: 3, a: "Bram doubts Danu." },
				], passed: false },
			} },
			springAnswers: {},
		})[0];
		expect(pairsOf(page, "Bonds & ties")).toEqual([
			{ prompt: "Who is your closest kin?",        answer: "Old Bemis is my closest kin." },
			{ prompt: "Who taught you the secret ways?", answer: "Mother Aldercrone taught me the secret ways." },
		]);
		expect(pairsOf(page, "Asked of the others")).toEqual([
			{ prompt: "Which one of you doubts the power of Danu?", answer: "Bram doubts Danu." },
		]);
	});

	it("folds legacy r4/r5 behind the step list and dedupes an overlap", () => {
		const page = buildChroniclePages({
			pcs: [blessed],
			introAnswers: { pc1: {
				step4: { answers: [{ q: 0, a: "Old Bemis is my closest kin." }], passed: false },
				r4: { q: 0, a: "Old Bemis is my closest kin." }, // same as the step entry → deduped
				r5: { q: 1, a: "My twin, Cerys." },              // legacy-only → folded in behind
			} },
			springAnswers: {},
		})[0];
		expect(pairsOf(page, "Bonds & ties")).toEqual([
			{ prompt: "Who is your closest kin?",                 answer: "Old Bemis is my closest kin." },
			{ prompt: "Whose heart & soul is entwined with yours?", answer: "My twin, Cerys." },
		]);
	});

	it("omits the Q&A section for a step that was passed with no answers", () => {
		const page = buildChroniclePages({
			pcs: [blessed],
			introAnswers: { pc1: { r1: "Just an intro.", step4: { answers: [], passed: true } } },
			springAnswers: {},
		})[0];
		expect(sec(page, "Bonds & ties")).toBeUndefined();
	});

	it("escapes user-entered answer text in prose bodies", () => {
		const page = buildChroniclePages({
			pcs: [blessed],
			introAnswers: { pc1: { r1: "<script>alert('x')</script>" } },
			springAnswers: {},
		})[0];
		expect(bodyOf(page, "Introduction")).toContain("&lt;script&gt;");
		expect(bodyOf(page, "Introduction")).not.toContain("<script>");
	});

	it("returns no pages when nothing has been recorded", () => {
		expect(buildChroniclePages({ pcs: [blessed], introAnswers: {}, springAnswers: {} })).toEqual([]);
	});
});

function expeditionFull() {
	return {
		id:    "exp1",
		title: "The Wandering Tower",
		chart: {
			route:  "North along the old logging road to the ridge.",
			checks: { guide: true, perilous: true }, // one Requirement, one Challenge
			notes:  "Borrowed Old Finn's map.",
		},
		outfit:      "Light loads; Bram hauls the rope.",
		requisition: "Two ponies from the commons.",
		prep:        "Mustered the watch to cover the gate.",
		running:     "Ridge camp, then the ravine, then the tower.",
		home:        { checks: { absence: true }, notes: "A true triumph — clear a debility." },
	};
}

describe("buildChroniclePages — expeditions", () => {
	it("builds one page per logged expedition, titled and keyed by trip id", () => {
		const pages = buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] });
		expect(pages).toHaveLength(1);
		expect(pages[0].key).toBe(`${EXPEDITION_PAGE_KEY_PREFIX}exp1`);
		expect(pages[0].name).toBe("Expedition: The Wandering Tower");
	});

	it("renders every recorded step section as prose", () => {
		const page = buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] })[0];
		expect(bodyOf(page, "Destination & route")).toContain("North along the old logging road to the ridge.");
		expect(bodyOf(page, "The way ahead")).toContain("Borrowed Old Finn"); // apostrophe is HTML-escaped (Finn&#39;s)
		expect(bodyOf(page, "Outfit & supplies")).toContain("Light loads; Bram hauls the rope.");
		expect(bodyOf(page, "Requisitioned")).toContain("Two ponies from the commons.");
		expect(sec(page, "Other preparations")).toBeTruthy();
		expect(bodyOf(page, "The journey")).toContain("Ridge camp, then the ravine, then the tower.");
		expect(bodyOf(page, "Coming home")).toContain("A true triumph");
	});

	// What the Requisition step actually ticked off, above whatever the GM typed. The steading
	// sheet says where an asset is WHILE it is out; this says what the trip borrowed, and goes
	// on saying it after the wagon is back in the barn.
	it("names the steading assets the trip took, above the GM's own words", () => {
		const exp = expeditionFull();
		exp.requisitioned = [{ index: 0, name: "A pair of hardy draft horses" }, { index: 3, name: "A wagon" }];

		const body = bodyOf(buildChroniclePages({ pcs: [], expeditions: [exp] })[0], "Requisitioned");

		expect(body).toContain("<p><strong>Taken from the steading</strong></p>");
		expect(body).toContain("<li>A pair of hardy draft horses</li>");
		expect(body).toContain("<li>A wagon</li>");
		expect(body.indexOf("A wagon")).toBeLessThan(body.indexOf("Two ponies from the commons."));
	});

	it("names them even when nothing was typed on the step", () => {
		const exp = expeditionFull();
		delete exp.requisition;
		exp.requisitioned = [{ index: 3, name: "A wagon" }];

		expect(bodyOf(buildChroniclePages({ pcs: [], expeditions: [exp] })[0], "Requisitioned"))
			.toContain("<li>A wagon</li>");
	});

	it("escapes an asset name, and skips a record with no name left on it", () => {
		const exp = expeditionFull();
		exp.requisitioned = [{ index: 0, name: "Finn's <cart>" }, { index: 1, name: "  " }, { index: 2 }];

		const body = bodyOf(buildChroniclePages({ pcs: [], expeditions: [exp] })[0], "Requisitioned");

		expect(body).toContain("Finn&#x27;s &lt;cart&gt;");
		expect(body).not.toContain("<cart>");
		expect((body.match(/<li>/g) ?? [])).toHaveLength(1);
	});

	it("says nothing about assets when the trip took none", () => {
		expect(bodyOf(buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] })[0], "Requisitioned"))
			.not.toContain("Taken from the steading");
	});

	it("lists only the ticked chart checks, grouped, with the spiral-bullet wrapper", () => {
		const way = bodyOf(buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] })[0], "The way ahead");
		expect(way).toContain('<div class="stonetop-location-body">'); // list-bearing body gets spiral bullets
		expect(way).toContain("<p><strong>Requirements</strong></p>");
		expect(way).toContain("A knowledgeable guide / accurate map / detailed directions");
		expect(way).toContain("<p><strong>Challenges</strong></p>");
		expect(way).toContain("The way is perilous, plagued with danger");
		// An unticked challenge is omitted.
		expect(way).not.toContain("You risk getting lost");
	});

	// The step records what it presented as a LIST a GM adds to now, and the two shapes have to
	// print the same page: the block above proves it off the old tick-and-fill pair, this one off
	// the list. Both go through `chartPicked`, which is the only place the older shape is known.
	describe("the charted list", () => {
		const charting = picked => bodyOf(buildChroniclePages({
			pcs: [], expeditions: [{ ...expeditionFull(), chart: { picked, notes: "" } }],
		})[0], "The way ahead");

		it("prints each presented line under its group, in the order it was added", () => {
			const way = charting([
				{ id: "a", group: "requirements", key: "guide",    answer: "" },
				{ id: "b", group: "challenges",   key: "lost",     answer: "" },
				{ id: "c", group: "challenges",   key: "perilous", answer: "" },
			]);
			expect(way).toContain("<p><strong>Requirements</strong></p>");
			expect(way).toContain("A knowledgeable guide / accurate map / detailed directions");
			expect(way.indexOf("You risk getting lost"))
				.toBeLessThan(way.indexOf("The way is perilous"));
			// Nothing the trip did not present.
			expect(way).not.toContain("Wait until");
		});

		it("splices what was said into the line's blank, and escapes it", () => {
			const way = charting([
				{ id: "a", group: "challenges", key: "watchOut", answer: "the <wolves> of the Ettenmark" },
			]);
			expect(way).toContain("Watch out for the &lt;wolves&gt; of the Ettenmark");
			expect(way).not.toContain("Watch out for ___");
			expect(way).not.toContain("<wolves>");
		});

		it("prints what was said after a line with no blank in it", () => {
			const way = charting([
				{ id: "a", group: "challenges", key: "perilous", answer: "raiders on the ridge" },
			]);
			expect(way).toContain("The way is perilous, plagued with danger: raiders on the ridge");
		});

		// A line the GM wrote is the one user-authored string in this section, so it is the one
		// that has to be escaped rather than trusted the way the book's own wording is.
		it("prints a line the GM wrote themselves, escaped, with what was said after it", () => {
			const way = charting([
				{ id: "a", group: "challenges", text: "The <ford> is watched", answer: "by Brennan's Claws" },
			]);
			expect(way).toContain("The &lt;ford&gt; is watched: by Brennan&#x27;s Claws");
			expect(way).not.toContain("<ford>");
		});

		it("says nothing at all for a trip that presented nothing", () => {
			expect(charting([])).toBe("");
		});
	});

	it("omits the arriving-home prep questions (only the free-text note carries through)", () => {
		const page = buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] })[0];
		expect(allBody(page)).not.toContain("How long have they been gone");
	});

	// The route plotted on the walkthrough's map step. Stored as two slugs and recomputed here, so
	// a correction to the travel table reaches an old trip's page rather than freezing into it.
	describe("the plotted route", () => {
		const withJourney = (journey, chart) => buildChroniclePages({
			pcs: [], expeditions: [{ ...expeditionFull(), journey, chart: { ...expeditionFull().chart, ...chart } }],
		})[0];

		it("leads the route section with the legs and the total", () => {
			const body = bodyOf(withJourney({ origin: "stonetop", destination: "lygos" }), "Destination & route");
			expect(body).toContain("<strong>Stonetop to Marshedge to Lygos</strong>: at least 40 days.");
			expect(body).toContain("<li>Stonetop to Marshedge, 10 days (via the Roads)</li>");
			expect(body).toContain("<li>Marshedge to Lygos, 30 days</li>");
			// The GM's own prose still follows it.
			expect(body).toContain("North along the old logging road to the ridge.");
		});

		it("fills the requirement blanks exactly as the dialog's own checklist does", () => {
			const way = bodyOf(
				withJourney({ origin: "stonetop", destination: "lygos" },
					{ checks: { days: true, firstTravel: true } }),
				"The way ahead");
			expect(way).toContain("It'll take at least 40 days");
			expect(way).toContain("First travel to Marshedge, and from there to your destination");
			expect(way).not.toContain("___");
		});

		it("keeps the authored blank when a ticked requirement has nothing to fill it", () => {
			const way = bodyOf(withJourney(null, { checks: { days: true } }), "The way ahead");
			expect(way).toContain("It'll take at least ___ days");
		});

		// What the GM wrote against each requirement on the step. The page is the record of what
		// the table was actually TOLD, so a requirement that reached it as "watch out for ___" was
		// only ever half of one.
		it("prints what the GM wrote into a requirement's blank", () => {
			const way = bodyOf(withJourney(null, {
				checks: { watchOut: true },
				fills:  { watchOut: "the wolves of the Ettenmark" },
			}), "The way ahead");
			expect(way).toContain("Watch out for the wolves of the Ettenmark");
			expect(way).not.toContain("Watch out for ___");
		});

		it("lets what the GM wrote outrank what the route worked out", () => {
			const way = bodyOf(withJourney({ origin: "stonetop", destination: "lygos" }, {
				checks: { days: true },
				fills:  { days: "60, if the passes are shut" },
			}), "The way ahead");
			expect(way).toContain("It'll take at least 60, if the passes are shut days");
			expect(way).not.toContain("at least 40 days");
		});

		// A requirement with no blank has nowhere to splice, so its answer follows the line.
		it("prints a note written against a requirement that has no blank", () => {
			const way = bodyOf(withJourney(null, {
				checks: { perilous: true },
				fills:  { perilous: "raiders on the <ridge>" },
			}), "The way ahead");
			expect(way).toContain("The way is perilous, plagued with danger: raiders on the &lt;ridge&gt;");
			expect(way).not.toContain("<ridge>");
		});

		it("says nothing extra for a requirement the GM answered but did not present", () => {
			const way = bodyOf(withJourney(null, {
				checks: { perilous: true },
				fills:  { perilous: "raiders", lost: "the fog off the fens" },
			}), "The way ahead");
			expect(way).not.toContain("the fog off the fens");
		});

		it("compiles a trip with no journey exactly as it did before", () => {
			const before = buildChroniclePages({ pcs: [], expeditions: [expeditionFull()] })[0];
			const after = withJourney(undefined, {});
			expect(after.sections).toEqual(before.sections);
		});

		it("ignores a journey that goes nowhere", () => {
			const same = withJourney({ origin: "marshedge", destination: "marshedge" }, {});
			expect(bodyOf(same, "Destination & route")).not.toContain("at least");
		});

		// Picking a destination seeds the empty "Destination & route" field with the route line,
		// so the walkthrough shows an answer rather than a blank — and that is the exact string
		// the prose above already leads with. Printed verbatim underneath, the page said the same
		// sentence twice, once bold and once not.
		it("does not print the route line a second time as the GM's note", () => {
			const body = bodyOf(
				withJourney({ origin: "stonetop", destination: "lygos" },
					{ route: "Stonetop to Marshedge to Lygos" }),
				"Destination & route");
			expect(body).toContain("<strong>Stonetop to Marshedge to Lygos</strong>: at least 40 days.");
			expect(body).not.toContain("<p>Stonetop to Marshedge to Lygos</p>");
		});

		it("keeps every word once the GM has added to it", () => {
			const body = bodyOf(
				withJourney({ origin: "stonetop", destination: "lygos" },
					{ route: "Stonetop to Marshedge to Lygos, but by boat from the Fen." }),
				"Destination & route");
			expect(body).toContain("but by boat from the Fen.");
		});
	});

	it("falls back to a numbered name for an untitled trip", () => {
		const pages = buildChroniclePages({
			pcs:         [],
			expeditions: [{ id: "x", chart: { route: "Down to the fen." } }],
		});
		expect(pages[0].name).toBe("Expedition 1");
	});

	it("skips an expedition with no recorded content", () => {
		const pages = buildChroniclePages({
			pcs:         [],
			expeditions: [{ id: "empty", title: "Unstarted", chart: { checks: {} } }],
		});
		expect(pages).toEqual([]);
	});

	it("escapes user-entered expedition text", () => {
		const page = buildChroniclePages({
			pcs:         [],
			expeditions: [{ id: "x", chart: { route: "<script>alert('x')</script>" } }],
		})[0];
		expect(bodyOf(page, "Destination & route")).toContain("&lt;script&gt;");
		expect(bodyOf(page, "Destination & route")).not.toContain("<script>");
	});

	it("appends expedition pages after the PC and Spring Burst pages, oldest first", () => {
		const pages = buildChroniclePages({
			pcs:           [blessed],
			introAnswers:  fullAnswers(),
			springAnswers: springFull,
			expeditions:   [expeditionFull(), { id: "exp2", title: "Down the Dread River", chart: { route: "By raft." } }],
		});
		expect(pages.map(p => p.key)).toEqual([
			"pc1",
			SPRING_PAGE_KEY,
			`${EXPEDITION_PAGE_KEY_PREFIX}exp1`,
			`${EXPEDITION_PAGE_KEY_PREFIX}exp2`,
		]);
	});
});

describe("mergeChronicleSections", () => {
	const prose = (heading, body) => ({ kind: "prose", heading, group: "glance", body });
	const qa    = (heading, pairs) => ({ kind: "qa", heading, group: "glance", pairs });

	it("appends a section recorded after the first save (new heading)", () => {
		const existing = [prose("Destination & route", "<p>North.</p>")];
		const computed = [prose("Destination & route", "<p>North.</p>"), prose("The journey", "<p>Rough.</p>")];
		const { sections, added } = mergeChronicleSections(existing, computed);
		expect(added).toBe(1);
		expect(sections.map(s => s.heading)).toEqual(["Destination & route", "The journey"]);
	});

	it("leaves an already-present prose section untouched (inline edits stick)", () => {
		const existing = [prose("Destination & route", "<p>EDITED IN JOURNAL.</p>")];
		const computed = [prose("Destination & route", "<p>North.</p>")];
		const { sections, added } = mergeChronicleSections(existing, computed);
		expect(added).toBe(0);
		expect(sections[0].body).toBe("<p>EDITED IN JOURNAL.</p>");
	});

	it("folds a later-round answer into an existing Q&A section", () => {
		const existing = [qa("Bonds & ties", [{ prompt: "Who is your closest kin?", answer: "My sister." }])];
		const computed = [qa("Bonds & ties", [
			{ prompt: "Who is your closest kin?", answer: "My sister." },          // already present
			{ prompt: "Who taught you the secret ways?", answer: "Old Maren." },   // recorded later
		])];
		const { sections, added } = mergeChronicleSections(existing, computed);
		expect(added).toBe(1);
		expect(sections[0].pairs.map(p => p.answer)).toEqual(["My sister.", "Old Maren."]);
	});

	it("doesn't duplicate an unchanged Q&A pair, and never mutates the input", () => {
		const existing = [qa("Bonds & ties", [{ prompt: "Q", answer: "A" }])];
		const computed = [qa("Bonds & ties", [{ prompt: "Q", answer: "A" }])];
		const { sections, added } = mergeChronicleSections(existing, computed);
		expect(added).toBe(0);
		expect(sections[0].pairs).toHaveLength(1);
		expect(existing[0].pairs).toHaveLength(1); // input untouched
		expect(sections[0].pairs).not.toBe(existing[0].pairs);
	});

	it("treats same-text pairs under different prompts as distinct", () => {
		const existing = [qa("Asked", [{ prompt: "P1", answer: "yes" }])];
		const computed = [qa("Asked", [{ prompt: "P1", answer: "yes" }, { prompt: "P2", answer: "yes" }])];
		const { added } = mergeChronicleSections(existing, computed);
		expect(added).toBe(1);
	});

	// Live introductions: a prose section keeps tracking the source while it hasn't been
	// hand-edited (its stored body still hashes to what we last wrote), so a player's
	// introduction fills the Chronicle in as they type. Once edited, it freezes.
	it("stamps a per-heading prose hash for a newly-added section", () => {
		const computed = [prose("Introduction", "<p>North.</p>")];
		const { proseManaged } = mergeChronicleSections([], computed);
		expect(proseManaged).toHaveProperty("Introduction");
		expect(typeof proseManaged.Introduction).toBe("string");
	});

	it("refreshes a still-pristine prose section to the newer source text", () => {
		// First seed: empty page → the section is added and fingerprinted.
		const seed = mergeChronicleSections([], [prose("Introduction", "<p>I'm Sa.</p>")]);
		// Second sync: same body stored, longer source → the stored hash still matches, so refresh.
		const next = mergeChronicleSections(seed.sections, [prose("Introduction", "<p>I'm Sael.</p>")], { proseManaged: seed.proseManaged });
		expect(next.added).toBe(1);
		expect(next.sections[0].body).toBe("<p>I'm Sael.</p>");
		// The tracked hash advances to the newly-written body, so the NEXT sync compares against it.
		expect(next.proseManaged.Introduction).not.toBe(seed.proseManaged.Introduction);
	});

	it("freezes a prose section once its stored body no longer matches the tracked hash", () => {
		const seed = mergeChronicleSections([], [prose("Introduction", "<p>Auto text.</p>")]);
		// The GM edits the section in the journal — its body diverges from the tracked hash.
		const edited = [prose("Introduction", "<p>HAND-EDITED.</p>")];
		const next   = mergeChronicleSections(edited, [prose("Introduction", "<p>Newer source.</p>")], { proseManaged: seed.proseManaged });
		expect(next.added).toBe(0);
		expect(next.sections[0].body).toBe("<p>HAND-EDITED.</p>");
	});

	it("adopts a legacy prose section (no tracked hash) only when it already equals the source", () => {
		// Body equals what we'd compute now → clearly still ours → start tracking it.
		const same = mergeChronicleSections([prose("Introduction", "<p>Same.</p>")], [prose("Introduction", "<p>Same.</p>")]);
		expect(same.proseManaged).toHaveProperty("Introduction");
		expect(same.added).toBe(0);
		// Body differs and there's no tracked hash → assume edited → leave it frozen.
		const diff = mergeChronicleSections([prose("Introduction", "<p>Older.</p>")], [prose("Introduction", "<p>Newer.</p>")]);
		expect(diff.added).toBe(0);
		expect(diff.sections[0].body).toBe("<p>Older.</p>");
		expect(diff.proseManaged).not.toHaveProperty("Introduction");
	});

	// adoptLegacy: the page being AUTHORED live this instant (a reused character's pre-fix
	// page) may have its untracked prose taken over by the current text and start tracking.
	it("adopts and refreshes an untracked legacy prose section when adoptLegacy is set", () => {
		const existing = [prose("Introduction", "<p>Stale from a prior run.</p>")];
		const computed = [prose("Introduction", "<p>Freshly typed this session.</p>")];
		const res = mergeChronicleSections(existing, computed, { adoptLegacy: true });
		expect(res.added).toBe(1);
		expect(res.sections[0].body).toBe("<p>Freshly typed this session.</p>");
		expect(res.proseManaged).toHaveProperty("Introduction"); // now tracked
	});

	it("without adoptLegacy an untracked, differing legacy prose section stays frozen", () => {
		const existing = [prose("Introduction", "<p>Stale.</p>")];
		const computed = [prose("Introduction", "<p>New.</p>")];
		const res = mergeChronicleSections(existing, computed, { adoptLegacy: false });
		expect(res.added).toBe(0);
		expect(res.sections[0].body).toBe("<p>Stale.</p>");
	});

	it("adoptLegacy never overrides a TRACKED hand edit (only rescues untracked sections)", () => {
		// Seed → tracked. Then the GM edits it in the journal so the stored body diverges from
		// the tracked hash. Even under adoptLegacy that section must stay frozen.
		const seed   = mergeChronicleSections([], [prose("Introduction", "<p>Auto.</p>")]);
		const edited = [prose("Introduction", "<p>HAND EDIT.</p>")];
		const res    = mergeChronicleSections(edited, [prose("Introduction", "<p>Newer.</p>")],
			{ proseManaged: seed.proseManaged, adoptLegacy: true });
		expect(res.added).toBe(0);
		expect(res.sections[0].body).toBe("<p>HAND EDIT.</p>");
	});
});
