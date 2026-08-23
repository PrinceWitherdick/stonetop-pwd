import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "What to prep" is no longer a step of the Run an Expedition walkthrough.
//
// It is between-sessions homework, and as a twelfth step it sat PAST "Going home", where a GM
// prepping for next week had already clicked Done and closed the window. It rides on the intro
// step now, folded shut behind a question, which is where a GM who opens this guide to prep
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
	d._step      = stepIndex;
	d._rolls     = {};
	d._asideOpen = false;
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
});

describe("the intro step's \"what to prep\" fold", () => {
	it("asks rather than tells", () => {
		expect(intro.key).toBe("intro");
		expect(intro.aside.label).toBe("Questions about what to prep?");
	});

	// The whole point of moving it was to keep it, so this pins the book's advice (Book I
	// p.342-343) line by line rather than just checking that SOME text came along.
	it("still carries every line of the advice the step used to print", () => {
		for (const line of [
			"Chart the course",
			"Draw a map",
			"Identify points of interest",
			"2&ndash;3 impressions",
			"7 encounters",
			"Die of Fate tables for weather",
			"sites, dangers, discoveries, NPCs, and followers",
			"Book II",
		]) expect(intro.aside.body, line).toContain(line);
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

describe("the fold's wiring", () => {
	it("reaches the template only on a step that has one, carrying its open state", async () => {
		const open = dialog();
		expect((await open.getData()).aside).toMatchObject({ label: intro.aside.label, open: false });

		open._asideOpen = true;
		expect((await open.getData()).aside.open).toBe(true);

		// Every other step: no fold, so the template's `{{#if aside}}` renders nothing.
		const other = dialog(steps.findIndex(s => s.key === "chart"));
		expect((await other.getData()).aside).toBe(null);
	});

	it("renders the toggle and the body, and gates the body on that state", () => {
		expect(HBS).toContain('class="stonetop-guide-aside-toggle{{#if aside.open}} is-open{{/if}}"');
		expect(HBS).toContain("{{aside.label}}");
		expect(HBS).toContain("{{{aside.body}}}");
		expect(HBS).toContain('aria-expanded="{{#if aside.open}}true{{else}}false{{/if}}"');
		// The body borrows the step body's prose styling, so the advice reads the same folded
		// out as it did when it was a step of its own.
		expect(HBS).toContain("stonetop-guide-aside-body stonetop-spring-body");
	});

	// Flipped by class, not by re-rendering: a render on the route step rebuilds the map panel.
	it("opens by class, and remembers on the dialog so a re-render can't shut it", () => {
		expect(DIALOG_JS).toContain('html.find(".stonetop-guide-aside-toggle").on("click"');
		expect(DIALOG_JS).toContain("this._asideOpen = !this._asideOpen;");
		expect(DIALOG_JS).toContain('classList.toggle("is-open", this._asideOpen)');
	});

	it("is styled shut by default and open by the class the handler sets", () => {
		expect(CSS).toContain(".stonetop-guide-aside-toggle");
		expect(CSS).toMatch(/\.stonetop-guide-aside-body\s*\{[^}]*display:\s*none/);
		expect(CSS).toContain(".stonetop-guide-aside-body.is-open { display: block; }");
	});
});
