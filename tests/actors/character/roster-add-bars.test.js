import { describe, it, expect } from "vitest";
import { readRepo as read, readCss, declarations, ownRule } from "../../fakes/css.js";
import { renderRoster } from "../../fakes/hbs.js";

// The "type a name and add them" bars — the Blessed's marks, the Judge's brands, the Judge's oaths
// — are one partial (roster-add.hbs) and one wiring (`RosterDialog._wireAddBar`), joined by nothing
// but two class words agreed between them.
//
// Both ends fail SILENTLY. `_wireAddBar` is all optional chaining, so a selector that matches
// nothing binds nothing and throws nothing; the partial takes its classes as hash arguments, so a
// typo in one invocation renders a bar whose button does nothing and whose Enter key does nothing.
// That reads as a dead FIELD rather than an unwired one, because the bars beside it still work —
// which is the exact failure the shared wiring was written to end, and which no test could see,
// because nothing in the suite read either dialog template.
//
// Counted by INVOCATION rather than by rendered bar: the Blessed's single invocation sits inside
// the loop over kinds, so it draws one bar per panel. That is also why its wiring is scoped to the
// panel rather than to the window — see the `scope` note on `_wireAddBar`, and the test below.

const MARKS_HBS    = read("templates/dialogs/blessed-marks.hbs");
const CONDEMNED_HBS = read("templates/dialogs/condemned.hbs");
const MARKS_JS     = read("module/actors/character/dialogs/BlessedMarksDialog.js");
const CONDEMNED_JS = read("module/actors/character/dialogs/CondemnedDialog.js");
const ROSTER_JS    = read("module/actors/character/dialogs/RosterDialog.js");

// Every `{{#> "stonetop.roster-add" …}}` in a template, with its hash arguments.
const addBars = (hbs) => [...hbs.matchAll(/\{\{#>\s*"stonetop\.roster-add"([\s\S]*?)\}\}/g)].map(m => m[1]);
const hashArg = (args, name) => args.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1] ?? null;

// Every `_wireAddBar(<scope>, { btnSelector: ".x", nameSelector: ".y" … })` in a dialog. The scope
// is the window where a roster's bars carry distinct classes, and the panel where it loops.
const wirings = (js) => [...js.matchAll(/_wireAddBar\(\w+,\s*\{([\s\S]*?)\}\)/g)].map(m => ({
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

	// The Blessed's one invocation draws a bar per kind, so up to five of them wear the same two
	// classes at once. Wired against the WINDOW, every button would have found the first panel's
	// field: four of the five kinds would have marked whoever was typed into Barkskin, and the
	// button beside the field you used would have looked simply unresponsive. The loop is the guard.
	it("wires the looped bar inside its own panel, not the window", () => {
		// One pass over the panels, handing each to `_wirePanel` — which wires that panel's bar and
		// that panel's drop zone together, behind the one guard they share.
		expect(MARKS_JS).toMatch(
			/for \(const panel of root\.querySelectorAll\("\.stonetop-marks-group"\)\)[\s\S]{0,80}?_wirePanel\(panel\)/,
		);
		expect(MARKS_JS).toMatch(/_wirePanel\(panel\) \{[\s\S]{0,400}?_wireAddBar\(panel,/);
		// And the field emptied after a successful write is that panel's too.
		expect(MARKS_JS).toMatch(/_clearAddField\("\.stonetop-marks-name", panel\)/);
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
		const html = renderRoster(
			'{{#> "stonetop.roster-add" prefix="p" nameClass="the-name" listId="l" addClass="the-add" '
			+ 'addLabel="Add" placeholder="ph" hint="drop"}}{{/"stonetop.roster-add"}}');
		expect(html).toMatch(/<input[^>]*class="[^"]*\bthe-name\b/);
		expect(html).toMatch(/<button[^>]*class="[^"]*\bthe-add\b/);
	});
});

// ── What the bar LOOKS like ───────────────────────────────────────────────────────────────────
//
// The other half of the split above, and the one that had gone wrong. A caller's `nameClass` and
// `addClass` exist so a host can bind a handler to ONE of its bars, so they differ per list by
// construction — and the stylesheet had keyed the add bar's chrome onto them anyway. Only the
// brands' two spellings were ever written down, so the Judge's oath bar (same window, same
// partial, different binding classes) got neither the `flex: 1` on its field nor the `width: auto`
// on its button: core's compat layer stretches every AppV1 button to `width: 100%`, so that one
// bar rendered with a swollen button squeezing a field that could not grow back.
//
// It fails the way the wiring above fails, which is to say invisibly: every control still works,
// and a bar you are not looking at side by side just reads as slightly off.
describe("the add bar's chrome", () => {
	const css = readCss();

	// The hook the stylesheet uses is the one the partial writes itself, not one a caller picks.
	it("wears a shared class the caller cannot get wrong", () => {
		const html = renderRoster(
			'{{#> "stonetop.roster-add" prefix="p" nameClass="the-name" listId="l" addClass="the-add" '
			+ 'addLabel="Add" placeholder="ph" hint="drop"}}{{/"stonetop.roster-add"}}');
		expect(html).toMatch(/<input[^>]*class="[^"]*\bstonetop-roster-add-name\b/);
		expect(html).toMatch(/<button[^>]*class="[^"]*\bstonetop-roster-add-btn\b/);
	});

	it("styles that shared class rather than the per-list ones", () => {
		expect(declarations(css, ".stonetop-roster-add-name")).toBeTruthy();
		expect(declarations(css, ".stonetop-roster-add-btn")).toBeTruthy();
		// The binding classes carry no chrome. Naming one here is how the drift started: it dresses
		// the bar you are looking at and leaves its twin bare.
		for (const bound of [...new Set(wirings(MARKS_JS).concat(wirings(CONDEMNED_JS))
			.flatMap(w => [w.btn, w.name]))]) {
			expect(declarations(css, `.${bound}`), `.${bound} is a binding class, not a style hook`)
				.toBeNull();
		}
	});

	// Core's compat layer paints an AppV1 button pale cream (`rgba(255, 255, 240, 0.8)`), which is
	// what both of these were wearing. Every other confirm in the system is the slate primary.
	it("paints the button our primary slate, through the tokens", () => {
		const btn = declarations(css, ".stonetop-roster-add-btn");
		expect(btn).toMatch(/background:\s*var\(--st-btn-primary-bg\)/);
		expect(btn).toMatch(/border:[^;]*var\(--st-btn-primary-border\)/);
		expect(btn).toMatch(/color:\s*var\(--st-btn-primary-text\)/);
		// Through the tokens rather than the hex behind them, so the Death's Door mood and the
		// high-contrast scope (both re-point --st-btn-primary-*) carry it without a second rule.
		expect(btn).not.toMatch(/slategrey|#708090|#556b8b/i);
		const hover = declarations(css, ".stonetop-roster-add-btn:hover");
		expect(hover).toMatch(/background:\s*var\(--st-btn-primary-bg-hover\)/);
	});

	// Paint, not geometry. The button sits beside a text field and takes its height from core's
	// `line-height: 28px`; giving it a height or a padding of its own is how it stops matching.
	it("leaves the button's own height to core", () => {
		const btn = ownRule(css, ".stonetop-roster-add-btn");
		expect(btn).not.toMatch(/(^|;)\s*(height|min-height|padding|line-height)\s*:/);
	});
});
