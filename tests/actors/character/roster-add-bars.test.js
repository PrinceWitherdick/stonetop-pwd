import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { readRepo as read } from "../../fakes/css.js";

// The three "type a name and add them" bars — the Blessed's marks, the Judge's brands, the Judge's
// oaths — are one partial (roster-add.hbs) and one wiring (`RosterDialog._wireAddBar`), joined by
// nothing but two class words agreed between them.
//
// Both ends fail SILENTLY. `_wireAddBar` is all optional chaining, so a selector that matches
// nothing binds nothing and throws nothing; the partial takes its classes as hash arguments, so a
// typo in one of three invocations renders a bar whose button does nothing and whose Enter key does
// nothing. That reads as a dead FIELD rather than an unwired one, because the two bars beside it
// still work — which is the exact failure the shared wiring was written to end, and which no test
// could see, because nothing in the suite read either dialog template.

const ADD_HBS      = read("templates/dialogs/partials/roster-add.hbs");
const MARKS_HBS    = read("templates/dialogs/blessed-marks.hbs");
const CONDEMNED_HBS = read("templates/dialogs/condemned.hbs");
const MARKS_JS     = read("module/actors/character/dialogs/BlessedMarksDialog.js");
const CONDEMNED_JS = read("module/actors/character/dialogs/CondemnedDialog.js");
const ROSTER_JS    = read("module/actors/character/dialogs/RosterDialog.js");

// Every `{{#> "stonetop.roster-add" …}}` in a template, with its hash arguments.
const addBars = (hbs) => [...hbs.matchAll(/\{\{#>\s*"stonetop\.roster-add"([\s\S]*?)\}\}/g)].map(m => m[1]);
const hashArg = (args, name) => args.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null;

// Every `_wireAddBar(root, { btnSelector: ".x", nameSelector: ".y" … })` in a dialog.
const wirings = (js) => [...js.matchAll(/_wireAddBar\(root,\s*\{([\s\S]*?)\}\)/g)].map(m => ({
	btn:  m[1].match(/btnSelector:\s*"\.([^"]+)"/)?.[1] ?? null,
	name: m[1].match(/nameSelector:\s*"\.([^"]+)"/)?.[1] ?? null,
}));

describe("the roster add bars", () => {
	const bars = [...addBars(MARKS_HBS), ...addBars(CONDEMNED_HBS)];
	const wired = [...wirings(MARKS_JS), ...wirings(CONDEMNED_JS)];

	it("has three of them, one partial and one wiring apiece", () => {
		expect(bars).toHaveLength(3);
		expect(wired).toHaveLength(3);
	});

	// THE assertion. Each bar's rendered button and field must be exactly what some `_wireAddBar`
	// call goes looking for; a mismatch either way is a control that binds nothing.
	it("renders the classes its dialog binds, for every bar", () => {
		const boundButtons = new Set(wired.map(w => w.btn));
		const boundFields  = new Set(wired.map(w => w.name));
		for (const args of bars) {
			const addClass  = hashArg(args, "addClass");
			const nameClass = hashArg(args, "nameClass");
			expect(addClass, `a bar passes no addClass: ${args}`).toBeTruthy();
			expect(nameClass, `a bar passes no nameClass: ${args}`).toBeTruthy();
			expect(boundButtons, `nothing binds .${addClass}`).toContain(addClass);
			expect(boundFields, `nothing binds .${nameClass}`).toContain(nameClass);
		}
	});

	it("binds nothing that no bar renders", () => {
		const rendered = new Set(bars.flatMap(a => [hashArg(a, "addClass"), hashArg(a, "nameClass")]));
		for (const { btn, name } of wired) {
			expect(rendered, `.${btn} is bound but never rendered`).toContain(btn);
			expect(rendered, `.${name} is bound but never rendered`).toContain(name);
		}
	});

	// Both halves of the bar, on every bar. The button alone still works when the Enter guard is
	// missed, which is precisely why a missed one is hard to notice.
	it("gives every bar both a button and an Enter key", () => {
		for (const w of wired) {
			expect(w.btn).toBeTruthy();
			expect(w.name).toBeTruthy();
		}
		expect(ROSTER_JS).toMatch(/nameSelector\)\?\.addEventListener\("keydown"/);
		expect(ROSTER_JS).toMatch(/if \(ev\.key !== "Enter"\) return;/);
		// Without preventDefault the keypress can still reach whatever encloses the dialog.
		expect(ROSTER_JS).toMatch(/ev\.preventDefault\(\);/);
	});

	// And that a bar actually emits the classes it is handed, rather than the partial having
	// quietly stopped printing one of them.
	it("puts the classes it is given on the elements the wiring looks for", () => {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.roster-add", ADD_HBS);
		hb.registerHelper("localize", (k) => String(k));
		const html = hb.compile(
			'{{#> "stonetop.roster-add" prefix="p" nameClass="the-name" listId="l" addClass="the-add" '
			+ 'addLabel="Add" placeholder="ph" hint="drop"}}{{/"stonetop.roster-add"}}',
		)({});
		expect(html).toMatch(/<input[^>]*class="the-name"/);
		expect(html).toMatch(/<button[^>]*class="the-add"/);
	});
});
