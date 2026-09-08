import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { IntroMatchDialog } from "../../module/dialogs/IntroMatchDialog.js";

// "Who did they mean?": the window a table opens once, on a world whose introductions were
// recorded before the answer step learned to ask who each answer was about.
//
// Two things are worth pinning here and neither is visible from the pure matcher next door: that
// SAVING WRITES ONLY WHAT CHANGED (a guess this window offered must not become a recorded fact
// just because the reader pressed Save without reading it), and that the template it renders is
// wired to the rows it was given.

const ROOT = path.resolve(import.meta.dirname, "../..");
const template = Handlebars.compile(fs.readFileSync(path.join(ROOT, "templates/dialogs/intro-match.hbs"), "utf8"));

const PCS = [
	{ id: "pim", name: "Pim" },
	{ id: "sela", name: "Sela" },
	{ id: "marrec", name: "Marrec" },
];

/** A row as `introAnswerRows` builds one. */
const row = (over = {}) => ({
	key: "pim::step6::0", writerId: "pim", writerName: "Pim", step: "step6",
	at: { source: "step6", index: 0 },
	prompt: "Which one of you joined me in my latest hijinx?",
	answer: "I asked, and got a shrug.",
	who: "", guess: "", target: "",
	...over,
});

/** A window root answering the one selector the save sweep asks for. */
function makeRoot(values = {}) {
	const selects = Object.entries(values).map(([rowKey, value]) => ({ dataset: { rowKey }, value }));
	return { querySelectorAll: () => selects };
}

function makeDialog(rows) {
	const dialog = new IntroMatchDialog({ rows, pcs: PCS });
	dialog._resolveWith = vi.fn();
	return dialog;
}

beforeEach(() => {
	globalThis.game = { i18n: { localize: key => key, format: key => key } };
});

describe("saving what the reader confirmed", () => {
	it("writes a pick the reader made", () => {
		const rows = [row()];
		const dialog = makeDialog(rows);
		dialog._onButton("save", makeRoot({ "pim::step6::0": "sela" }));
		expect(dialog._resolveWith).toHaveBeenCalledWith([
			{ writerId: "pim", at: { source: "step6", index: 0 }, who: "sela", answer: rows[0].answer, step: "step6" },
		]);
	});

	// ⚠ A GUESS CONFIRMED IS A PICK. The control arrives on the guess, so leaving it there IS the
	// reader saying yes -- and `who` was empty, so this is a change and gets written.
	it("writes a guess the reader left standing", () => {
		const dialog = makeDialog([row({ guess: "sela", target: "sela" })]);
		dialog._onButton("save", makeRoot({ "pim::step6::0": "sela" }));
		expect(dialog._resolveWith.mock.calls[0][0]).toHaveLength(1);
	});

	// ⚠ AND A ROW NOBODY MOVED IS NOT ONE. An answer already recorded as being about Sela, still
	// showing Sela, is not written again: nothing changed, and a save that rewrote every row would
	// touch every player character's flags to say what they already said.
	it("writes nothing for a row that still says what it said", () => {
		const dialog = makeDialog([row({ who: "sela", target: "sela" })]);
		dialog._onButton("save", makeRoot({ "pim::step6::0": "sela" }));
		expect(dialog._resolveWith).toHaveBeenCalledWith([]);
	});

	it("writes a cleared pick as nobody", () => {
		const dialog = makeDialog([row({ who: "sela", target: "sela" })]);
		dialog._onButton("save", makeRoot({ "pim::step6::0": "" }));
		expect(dialog._resolveWith.mock.calls[0][0][0]).toMatchObject({ who: "" });
	});

	// Every exit settles, so the caller is never left awaiting.
	it("answers nothing at all when the reader backs out", () => {
		const dialog = makeDialog([row()]);
		dialog._onButton("cancel", makeRoot({ "pim::step6::0": "sela" }));
		expect(dialog._resolveWith).toHaveBeenCalledWith(null);
	});
});

describe("the window it renders", () => {
	const render = (rows) => template(makeDialog(rows).getData());

	it("groups the answers under whoever wrote them", () => {
		const html = render([
			row(), row({ key: "pim::step6::1", at: { source: "step6", index: 1 }, answer: "Marrec, always." }),
			row({ key: "sela::step4::0", writerId: "sela", writerName: "Sela", step: "step4", answer: "My mother." }),
		]);
		// Two writers, three answers: the heading is per person and not per row, which is the whole
		// point of grouping them.
		expect(html.match(/stonetop-intro-match-group/g)).toHaveLength(2);
		expect(html.match(/stonetop-intro-match-writer/g)).toHaveLength(2);
		expect(html.match(/stonetop-intro-match-row/g)).toHaveLength(3);
		expect(html).toContain(">Pim</h3>");
		expect(html).toContain(">Sela</h3>");
	});

	it("offers everyone but the writer, wired to the row", () => {
		const html = render([row()]);
		expect(html).toContain('data-row-key="pim::step6::0"');
		expect(html).toContain('<option value="sela">Sela</option>');
		expect(html).toContain('<option value="marrec">Marrec</option>');
		// The writer cannot be the person their own answer is about.
		expect(html).not.toContain('value="pim"');
	});

	it("starts on the guess, and says that is what it is", () => {
		const html = render([row({ guess: "sela", target: "sela" })]);
		expect(html).toContain('<option value="sela" selected>Sela</option>');
		expect(html).toContain("stonetop-intro-match-guessed");
	});

	// A recorded pick shows as chosen and is NOT marked as a guess: it is what somebody said.
	it("starts on a recorded pick, unmarked", () => {
		const html = render([row({ who: "marrec", target: "marrec" })]);
		expect(html).toContain('<option value="marrec" selected>Marrec</option>');
		expect(html).not.toContain("stonetop-intro-match-guessed");
	});

	it("starts on nobody where there is neither, and offers nobody first", () => {
		const html = render([row()]);
		expect(html).toContain('<option value="" selected>');
		expect(html.indexOf('value=""')).toBeLessThan(html.indexOf('value="sela"'));
	});
});
