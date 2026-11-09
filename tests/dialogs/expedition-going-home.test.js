import { describe, it, expect, beforeEach, vi } from "vitest";
import { readRepo as read, readCss, ownRule, declarations } from "../fakes/css.js";

// The question spiral, by its file or by the token that carries it. Background uses read
// `--stonetop-question-spiral-icon` so the dark palette can swap in the bone twin; either spelling
// is the same picture on paper.
const QUESTION_SPIRAL = /question-spiral\.svg|--stonetop-question-spiral-icon/;

// The last step of the Run an Expedition walkthrough, "Going home".
//
// Its list of things to settle before the PCs walk back in used to be tick boxes with a
// "Return Triumphant?" note box under them. Both were the wrong shape for what they held.
// The list is the GM's own thinking-through — questions, not answers — and nothing anywhere
// ever read a tick off it, so the boxes offered a state to leave half-filled and gave nothing
// back for it; they wear the question spiral now, the mark this system gives a question
// everywhere else it prints one. And Returning Triumphant is a MOVE, with an effect that lands
// on the steading: typing "yes, and it was glorious" into a box left the debility standing
// until somebody remembered to go and clear it on another sheet. So the box is a button that
// makes the move.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

// Who travels with each PC, as the roster would say: keyed by the PC's id, so a test sets it per actor.
const partyFollowersByActor = new Map();
vi.mock("../../module/actors/character/follower-roster.js", async importOriginal => ({
	...(await importOriginal()),
	partyFollowersOf: async actor => partyFollowersByActor.get(actor?.id) ?? [],
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { stubConfirm } = await import("../fakes/confirm.js");

const steps = Object.create(ExpeditionDialog.prototype)._steps;
const home  = steps.at(-1);

const DIALOG_JS = read("module/dialogs/ExpeditionDialog.js");
const HBS       = read("templates/dialogs/expedition.hbs");
const CSS       = readCss();
const SHEET_JS  = read("module/actors/steading/StonetopSteadingSheet.js");
const MOVE_JS   = read("module/actors/steading/return-triumphant.js");

/** A dialog instance without the Application constructor, as the sibling suites build one. */
function dialog(steading = { name: "Stonetop" }) {
	const d = Object.create(ExpeditionDialog.prototype);
	d._step  = steps.length - 1;
	d._rolls = {};
	d._steadingWrapper = () => steading;
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

describe("the arriving-home list", () => {
	it("is the last step's, and it is questions rather than a checklist", () => {
		expect(home.key).toBe("home");
		expect(home.qa.kind).toBe("questions");
		expect(home.qa.groups[0].items.length).toBeGreaterThan(0);
	});

	// The whole point of the change: no path, no `checked`, nothing to persist. A `path` left on
	// a row would be a checkbox's worth of plumbing feeding a control that no longer exists.
	it("builds rows that carry text and nothing to save", () => {
		const qa = dialog()._qaContext(home.qa);
		expect(qa.kind).toBe("questions");
		const rows = qa.groups.flatMap(g => g.items);
		expect(rows.length).toBe(home.qa.groups[0].items.length);
		for (const row of rows) {
			expect(row.text).toBeTruthy();
			expect(Object.keys(row)).toEqual(["text"]);
		}
	});

	// Every one of them ends in "?" — which is what earns the question spiral, and is the same
	// test `markQuestionBullets` applies to prose everywhere else (utils/question-bullets.js).
	it("asks questions, every one of them", () => {
		for (const item of home.qa.groups.flatMap(g => g.items)) {
			expect(item.text.trim().endsWith("?"), item.text).toBe(true);
		}
	});

	it("renders them as a spiral-marked list, with no checkbox in sight", () => {
		expect(HBS).toMatch(/eq qa\.kind "questions"/);
		expect(HBS).toMatch(/<ul class="stonetop-exp-questions">/);
		// The checklist branch is still there for Chart a Course, which records what it
		// presented — as a list a GM adds to now, not as twelve ticks. So there is no
		// checkbox left anywhere in this walkthrough, on either branch.
		expect(HBS).toMatch(/eq qa\.kind "checklist"/);
		expect(HBS).not.toMatch(/stonetop-exp-checkbox/);
	});

	it("hangs the question spiral on those rows in CSS", () => {
		// Through ownRule rather than a slice off indexOf: the spiral may be declared on a rule
		// this selector SHARES with the other question lists, which a fixed-length slice from the
		// first mention would read straight past.
		expect(ownRule(CSS, ".stonetop-exp-questions > li::before")).toMatch(QUESTION_SPIRAL);
	});

	// The rows draw their own box for that spiral rather than borrowing the walkthrough's
	// prose-bullet rule, and the reason is the art: question-spiral.svg is WIDE where the prose
	// bullet's check-spiral is square, so `contain` in a square box drew it a fifth short. It read
	// as a faint speck beside the type and rode above the words instead of sitting beside them.
	// This is the silent kind of style bug: the list still lays out and still reads, so nothing
	// short of looking at it says the glyph shrank.
	it("draws the wide glyph in a box shaped for it, not the square prose bullet's", () => {
		const svg = read("assets/icons/steading/question-spiral.svg");
		const [, w, h] = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+)"/).map(Number);
		expect(w, "the art is wider than it is tall, which is what the box below answers for")
			.toBeGreaterThan(h);

		// Not a member of the prose-bullet rule any more: that one is the SQUARE spiral's
		// arithmetic, and re-joining it is exactly how the glyph would silently shrink back.
		for (const sel of [".stonetop-spring-body ul:not([class]) > li",
			".stonetop-spring-body ul:not([class]) > li::before"]) {
			expect(declarations(CSS, sel).length, sel).toBeGreaterThan(0);
		}
		expect(CSS).not.toMatch(/ul:not\(\[class\]\) > li(::before)?,\s*\.stonetop-exp-questions/);

		// Its own box: as wide as the row's type (the 14px every other question spiral in the
		// system hangs in, in em so it tracks the font-scale setting), and one line tall, which
		// is what centres the glyph on the words rather than pinning it a fixed em down.
		const glyph = ownRule(CSS, ".stonetop-exp-questions > li::before");
		expect(glyph).toMatch(/width:\s*1em/);
		expect(glyph).toMatch(/top:\s*0/);
		expect(glyph).toMatch(/center\s*\/\s*contain/);

		// The box height and the row's line-height are the SAME number, or the centring is off by
		// their difference.
		const line = ownRule(CSS, ".stonetop-exp-questions > li").match(/line-height:\s*([\d.]+)/)[1];
		expect(glyph).toContain(`height: ${line}em`);

		// And the text hangs off that box, so the words clear the wider glyph.
		expect(ownRule(CSS, ".stonetop-exp-questions > li"))
			.toMatch(/padding-left:\s*calc\(1em \+ var\(--stonetop-spiral-gap\)\)/);
	});
});

describe("Return Triumphant, on the step where it comes up", () => {
	it("replaced the note box: the step records nothing of its own", () => {
		expect(home.qa.notes).toBeUndefined();
		expect(home.returnTriumphant).toBe(true);
		expect(HBS).not.toContain("Return Triumphant?");
		expect(DIALOG_JS).not.toContain("Return Triumphant?");
	});

	it("offers a button that opens the move", () => {
		expect(HBS).toMatch(/stonetop-exp-triumph-btn/);
		expect(DIALOG_JS).toMatch(/\.stonetop-exp-triumph-btn"\)\.on\("click"/);
		expect(DIALOG_JS).toMatch(/openReturnTriumphant\(/);
	});

	// GM-only and absent rather than disabled for a player, exactly as the Requisition step's
	// asset picker is, and for the same reason: making the move writes to the steading sheet.
	it("is built for the GM only, and only on its own step", () => {
		expect(DIALOG_JS).toMatch(/step\.returnTriumphant && game\.user\?\.isGM/);
	});

	// The sixth arriving-home question asks WHETHER they are Returning Triumphant. The book's
	// answer to it (the commentary under the move, Book I p.339) is printed with the button, not
	// left in the PDF: it is the one ruling this step asks the GM to make against a bar.
	it("prints the book's test for whether it counts, above the button", () => {
		expect(home.triumphBody, "the going-home step lost its triumph guidance").toBeTruthy();
		// The three things that decide it: what triumph means, that priorities depend on what
		// was at stake, and the tie-breaker when the table can't agree.
		expect(home.triumphBody).toContain("talk excitedly");
		expect(home.triumphBody).toContain("Priorities");
		expect(home.triumphBody).toMatch(/poll the table/i);
		// Cited, like the rest of the walkthrough's copy, so a GM can go read the page.
		expect(home.triumphBody).toContain("p.339");
		// Rides on the GM-only triumph block rather than as its own step field, so a player
		// never gets the ruling for a button they were not offered.
		expect(DIALOG_JS).toMatch(/body:\s*step\.triumphBody/);
		expect(HBS).toContain("{{{returnTriumphant.body}}}");
		// Above the button, which is the whole point of putting it here.
		expect(HBS.indexOf("returnTriumphant.body")).toBeLessThan(HBS.indexOf("stonetop-exp-triumph-btn"));
		// A column flex item shrinks to its content, which would set the prose in a narrower
		// measure than the step body it continues.
		expect(ownRule(CSS, ".stonetop-exp-triumph-body")).toMatch(/align-self:\s*stretch/);
	});

	// The world may have no steading sheet yet. The button says so instead of failing on press.
	it("reports whether there is a steading to clear a debility on", () => {
		expect(HBS).toContain("returnTriumphant.hasSteading");
		expect(HBS).toMatch(/{{#unless returnTriumphant\.hasSteading}}disabled/);
	});

	// ONE walkthrough, two doors. The steading sheet's move card and this button open the same
	// module; a second copy would drift on what "triumphant" does to Fortunes.
	it("shares its walkthrough with the steading sheet's own move card", () => {
		expect(SHEET_JS).toContain('from "./return-triumphant.js"');
		expect(SHEET_JS).toMatch(/_onReturnTriumphant\(\)\s*{\s*openReturnTriumphant\(/);
		// And the sheet keeps no second copy of the rules.
		expect(SHEET_JS).not.toContain("You return home in triumph");

		expect(MOVE_JS).toContain("You return home in triumph");
		expect(MOVE_JS).toContain("stats.fortunes.value");
		// The debility path itself now lives in the shared table three clearing moves read
		// (Return Triumphant, Rites of the Land, the Inn's gathering), so this asserts the
		// call rather than the path string it used to spell out inline.
		expect(MOVE_JS).toContain("steading-debilities.js");
		expect(MOVE_JS).toContain('clearDebility(steading, picked.id, "Return Triumphant")');
		// Every write is attributed, so the steading ledger names the move that caused it:
		// the Fortunes bump inline, the debility clear through clearDebility's third argument.
		expect(MOVE_JS.match(/stonetopMove: "Return Triumphant"/g)).toHaveLength(1);
	});

	it("warns rather than throws when the world has no steading", () => {
		const warn = vi.fn();
		global.ui = { notifications: { warn } };
		dialog(null)._returnTriumphant();
		expect(warn).toHaveBeenCalledOnce();
	});
});

// ── Reset Inventory, back home (Book I p.89, p.496) ─────────────────────────────────
// "When you return home, clear the marks from your Inventory insert." The card lists each PC on the trip and
// the followers travelling with them, ticked when there is something to clear; one press, after one ask,
// lands each character's reset (and their followers') in one update of that character.

describe("Going home's Reset Inventory card", () => {
	const SCOPE = "stonetop-pwd";
	const pc = (id, name, flags = {}) => ({
		id, name, type: "character",
		flags: { [SCOPE]: flags },
		typedActor: { resetForHomecoming: vi.fn(async () => true) },
		sheet: { _onConvalesceOpen: vi.fn(async () => {}) },
	});
	// A stand-in for the rendered card: its ticks and the Convalesce box, as the handler reads them.
	const section = (checks, { convalesce = false } = {}) => ({
		querySelectorAll: sel => sel === ".stonetop-exp-home-reset-check" ? checks : [],
		querySelector: sel => sel === ".stonetop-exp-home-reset-convalesce-check" ? { checked: convalesce } : null,
	});
	const check = (actor, { ftype = "", slug = "", name = actor, checked = true, disabled = false } = {}) =>
		({ checked, disabled, dataset: { actor, ftype, slug, name } });

	let aria, bryn, d, info;
	beforeEach(() => {
		partyFollowersByActor.clear();
		aria = pc("a1", "Aria", { inventory: { checked: { rope: true } } });
		bryn = pc("b1", "Bryn", {});
		info = vi.fn();
		global.ui = { notifications: { info, warn: vi.fn() } };
		global.game.actors = new Map([[aria.id, aria], [bryn.id, bryn]]);
		d = dialog();
		d._tripParty = () => [aria, bryn];
		d.render = vi.fn();
	});

	it("lists each PC on the trip and their followers, ticked only where something is marked", async () => {
		aria.flags[SCOPE].customFollowers = { f1: { name: "Wren", gear: [{ label: "Spear", checked: true }] } };
		partyFollowersByActor.set("a1", [{ ftype: "custom", slug: "f1", name: "Wren" }]);
		const card = await d._buildHomeReset();
		expect(card.rows.map(r => [r.name, !!r.follower, r.canReset])).toEqual([
			["Aria", false, true],
			["Wren", true, true],
			["Bryn", false, false],
		]);
		expect(card.rows[1].sub).toBe("(with Aria)");
		expect(card.anyToClear).toBe(true);
	});

	it("is built for the GM on the home step, beside the assets still out", () => {
		expect(DIALOG_JS).toMatch(/data\.homeReset = await this\._buildHomeReset\(\)/);
		expect(HBS).toContain(`{{> "stonetop.expedition-home-reset" homeReset=homeReset}}`);
		expect(HBS.indexOf("stonetop.expedition-home-assets")).toBeLessThan(HBS.indexOf("stonetop.expedition-home-reset"));
		expect(DIALOG_JS).toMatch(/\.stonetop-exp-home-reset-btn"\)\.on\("click"/);
	});

	it("asks once, then resets each character with their ticked followers in one call", async () => {
		const wait = stubConfirm(true);
		await d._resetHomeInventoriesNow(section([
			check("a1", { name: "Aria" }),
			check("a1", { ftype: "custom", slug: "f1", name: "Wren (with Aria)" }),
			check("a1", { ftype: "crew", name: "The Wolves (with Aria)", checked: false }),
			check("b1", { name: "Bryn", checked: false, disabled: true }),
		]));
		expect(wait).toHaveBeenCalledTimes(1);
		expect(wait.mock.calls[0][0].content).toContain("Aria &amp; Wren (with Aria)");
		expect(aria.typedActor.resetForHomecoming).toHaveBeenCalledTimes(1);
		expect(aria.typedActor.resetForHomecoming).toHaveBeenCalledWith({ pc: true, followers: [{ ftype: "custom", slug: "f1" }] });
		expect(bryn.typedActor.resetForHomecoming).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(expect.stringContaining("Aria"));
		expect(aria.sheet._onConvalesceOpen).not.toHaveBeenCalled();
	});

	it("writes nothing when the GM keeps the marks", async () => {
		stubConfirm(false);
		await d._resetHomeInventoriesNow(section([check("a1", { name: "Aria" })]));
		expect(aria.typedActor.resetForHomecoming).not.toHaveBeenCalled();
	});

	it("does not ask when nothing is ticked", async () => {
		const wait = stubConfirm(true);
		await d._resetHomeInventoriesNow(section([check("a1", { checked: false })]));
		expect(wait).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledOnce();
	});

	// The HP half of the book's downtime example is Convalesce, which has rules of its own; the card opens each
	// PC's own window rather than writing HP itself, and only when the GM ticks it.
	it("opens each PC's own Convalesce window when that box is ticked", async () => {
		stubConfirm(true);
		await d._resetHomeInventoriesNow(section([check("a1", { name: "Aria" })], { convalesce: true }));
		expect(aria.sheet._onConvalesceOpen).toHaveBeenCalledOnce();
		expect(bryn.sheet._onConvalesceOpen).toHaveBeenCalledOnce();
	});

	it("renders ticks, a greyed row for the unpacked, the Convalesce box unticked and the button", async () => {
		const html = await global.renderTemplate("systems/stonetop-pwd/templates/dialogs/partials/expedition-home-reset.hbs", {
			homeReset: { anyToClear: true, rows: [
				{ actorId: "a1", ftype: "", slug: "", name: "Aria", label: "Aria", canReset: true },
				{ actorId: "a1", ftype: "custom", slug: "f1", name: "Wren", sub: "(with Aria)", label: "Wren (with Aria)", follower: true, canReset: true },
				{ actorId: "b1", ftype: "", slug: "", name: "Bryn", label: "Bryn", canReset: false },
			] },
		});
		expect(html).toContain("Reset Inventory");
		expect(html).toMatch(/data-actor="a1" data-ftype="custom" data-slug="f1" data-name="Wren \(with Aria\)" checked/);
		expect(html).toMatch(/data-actor="b1"[^>]*disabled/);
		expect(html).toContain("Nothing to clear");
		expect(html).toContain("is-follower");
		expect(html).toMatch(/<input type="checkbox" class="stonetop-exp-home-reset-convalesce-check">/);
		expect(html).toContain("stonetop-exp-home-reset-btn");
	});

	it("says so when everyone has unpacked, with no button to press", async () => {
		const html = await global.renderTemplate("systems/stonetop-pwd/templates/dialogs/partials/expedition-home-reset.hbs", {
			homeReset: { anyToClear: false, rows: [{ actorId: "b1", ftype: "", slug: "", name: "Bryn", label: "Bryn", canReset: false }] },
		});
		expect(html).toContain("already unpacked");
		expect(html).not.toContain("stonetop-exp-home-reset-btn");
	});
});
