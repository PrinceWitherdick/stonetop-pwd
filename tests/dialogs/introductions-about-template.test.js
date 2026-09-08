import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

// The introductions template, COMPILED AND RENDERED against the context getData actually builds,
// for the one control that is not just chrome: "Who is this about?".
//
// The pick is the only field in this dialog whose value has to reach two other systems (the
// Chronicle's record, and the arrow the relationship map draws from it), and it reaches them by
// its `data-actor-id` / `data-step-key` pair and its option values. A mistyped `{{this.id}}` inside
// the `{{#each}}`, or a `selected` that never lands, would ship green everywhere else and show up
// as a picker that forgets what you chose.

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

Handlebars.registerPartial("stonetop.guide-toc", read("templates/dialogs/partials/guide-toc.hbs"));
Handlebars.registerPartial("stonetop.intros-capture-head", read("templates/dialogs/partials/intros-capture-head.hbs"));
const template = Handlebars.compile(read("templates/dialogs/introductions.hbs"));

/** The ask step as getData shapes it: the writer's turn, with the table to point at. */
const context = (capture = {}) => ({
	isPreCheck: false,
	isGM: false,
	phase: 5,
	currentPc: { name: "Pim", index: 1, total: 3 },
	instruction: "Ask one of the others.",
	questions: [],
	hasQuestions: false,
	stepLabel: "Asking the others",
	capture: {
		isStep: true, isAsk: true, actorId: "pim", stepKey: "step6",
		canEdit: true, canPreview: false, passed: false, canPass: true,
		draftAnswer: "I asked outright, and got a shrug.",
		saveState: "saved", placeholder: "Who you asked…",
		recorded: [], hasRecorded: false, answeredCount: 0, total: 4,
		about: [
			{ id: "sela", name: "Sela", isSelected: false },
			{ id: "marrec", name: "Marrec", isSelected: true },
		],
		hasAbout: true,
		aboutName: "Marrec",
		...capture,
	},
});

describe("the introductions template — who an answer is about", () => {
	it("offers everyone at the table, wired to the PC and step being written", () => {
		const html = template(context());
		expect(html).toContain('class="stonetop-intros-about-pick"');
		expect(html).toContain('data-actor-id="pim"');
		expect(html).toContain('data-step-key="step6"');
		expect(html).toContain('<option value="sela" >Sela</option>');
		expect(html).toContain('<option value="marrec" selected>Marrec</option>');
	});

	// Blank is a real answer, and the first one offered: most "Bonds & ties" answers are about
	// somebody outside the party, and nobody should have to name a player character to record one.
	it("offers nobody at all, first", () => {
		const html = template(context());
		expect(html).toContain('<option value="">Nobody at this table</option>');
		expect(html.indexOf('value=""')).toBeLessThan(html.indexOf('value="sela"'));
	});

	// A one-person run has nobody to point at, so the control is not offered empty.
	it("leaves the picker out when there is nobody else in the run", () => {
		const html = template(context({ about: [], hasAbout: false, aboutName: "" }));
		expect(html).not.toContain("stonetop-intros-about-pick");
	});

	// The GM watching a player type has no control to read the pick off, so it is said in words.
	it("tells a watcher who is being asked about, in words", () => {
		const html = template(context({ canEdit: false, canPreview: true }));
		expect(html).not.toContain("stonetop-intros-about-pick");
		expect(html).toContain("stonetop-intros-about-said");
		expect(html).toContain("<strong>Marrec</strong>");
	});

	// A pick can be SEEN to have stuck: it is the one part of a recorded answer that is not in the
	// writing itself.
	it("says who a recorded answer was about, on its own line", () => {
		const html = template(context({
			hasRecorded: true, answeredCount: 1,
			recorded: [{ question: "Which one of you has stayed my hand?", answer: "I asked, and got a shrug.", about: "Sela" }],
		}));
		expect(html).toContain('class="stonetop-intros-recorded-about"');
		expect(html).toContain("Sela");
	});

	it("says nothing about a recorded answer nobody was picked for", () => {
		const html = template(context({
			hasRecorded: true, answeredCount: 1,
			recorded: [{ question: "Who is your closest kin?", answer: "My sister Maeve.", about: "" }],
		}));
		expect(html).not.toContain("stonetop-intros-recorded-about");
	});
});
