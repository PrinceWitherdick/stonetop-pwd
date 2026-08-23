import Handlebars from "handlebars";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readRepo as read, readCss } from "../fakes/css.js";

// The exploration-moves rail in the Run an Expedition walkthrough.
//
// The seven GM exploration moves used to be a STEP, sat between "Running the journey" and
// "Player moves on the road". That put them on screen only while the GM was reading about them
// and took them away again by the time the GM was running the leg they are for. They are a
// permanent right-hand rail now, on every step, wearing the character sheet's Basic Moves
// sidebar chrome.
//
// Three things have to hold for that to be an improvement rather than a loss: the seven moves
// must still be here, in the book's words, from the one table; the rail must be on EVERY step
// rather than the one it replaced; and the collapse must survive a reload, since a rail that
// reopens against a reader's wishes is worse than no handle at all.

// The route step browses the art folder on render; nothing here renders a map, but the module
// is imported. Same fake as the sibling expedition suites.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const { ExpeditionDialog }     = await import("../../module/dialogs/ExpeditionDialog.js");
const { EXPLORATION_GM_MOVES } = await import("../../module/gm-toolkit/gm-moves.js");

const HBS        = read("templates/dialogs/expedition.hbs");
const CSS        = readCss();
const DIALOG_JS  = read("module/dialogs/ExpeditionDialog.js");

// The same two files with their comments stripped, for the guards that forbid a class or a
// field BY NAME. The prose beside the code says why the thing went, and to say it has to name
// it — so a guard reading the raw text would pass on its own rationale.
const MARKUP      = HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
const DIALOG_CODE = DIALOG_JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const steps = Object.create(ExpeditionDialog.prototype)._steps;

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
		user: { isGM: false },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
});

describe("the exploration moves the rail lists", () => {
	it("are the book's seven, in the book's order, read off the one table", async () => {
		const { explorationMoves } = await dialog().getData();
		expect(explorationMoves.map(m => m.name)).toEqual(EXPLORATION_GM_MOVES.map(m => m.name));
		expect(explorationMoves.map(m => m.gloss)).toEqual(EXPLORATION_GM_MOVES.map(m => m.gloss));
	});

	// The rail renders `{{name}}` and `{{gloss}}` and nothing else off each entry, so anything
	// else riding along is dead weight carried into every render of every step.
	it("carry a name and a gloss and nothing else", async () => {
		const { explorationMoves } = await dialog().getData();
		for (const move of explorationMoves) expect(Object.keys(move).sort()).toEqual(["gloss", "name"]);
	});
});

describe("where the rail appears", () => {
	// Furniture, not a step's content: a column that came and went as the reader stepped would
	// shift the prose sideways under them twice a walkthrough.
	it("is on every step, not just the ones that reach for a GM move", async () => {
		for (const [i, step] of steps.entries()) {
			const { explorationMoves } = await dialog(i).getData();
			expect(explorationMoves?.length, step.key).toBe(EXPLORATION_GM_MOVES.length);
		}
	});

	it("replaced the step it came from, and left no second copy of the list in the rail", () => {
		expect(steps.some(s => s.key === "explore")).toBe(false);
		expect(steps.map(s => s.title)).not.toContain("Exploration moves");
	});

	// The dropped step closed by telling the GM to keep making standard GM moves too. That line
	// is not about exploration moves and had nowhere else to be, so it landed on the step that
	// runs the loop. Losing it in the move was the easy mistake here.
	it("kept the dropped step's line about standard GM moves, on the step that runs the loop", () => {
		const running = steps.find(s => s.key === "running");
		expect(running.body).toContain("ask provocative questions");
		expect(running.body).toContain("use up their resources");
	});
});

describe("the rail's markup", () => {
	it("wears the character sheet's sidebar chrome plus its own modifier", () => {
		expect(HBS).toContain('class="stonetop-moves-sidebar stonetop-guide-moves-sidebar');
		expect(HBS).toContain('class="stonetop-sidebar-toggle"');
		expect(HBS).toContain('class="stonetop-sidebar-body"');
	});

	// Reference only: a GM move is something you say, so the ROWS take none of the character
	// sheet's rolling machinery or one looks like something to click. The die beside the
	// heading is not that — it draws one of the seven and whispers it, and it lives on the
	// heading rather than on any row. See "the rail's die" below.
	it("carries none of the rolling machinery those rows do", () => {
		const rail = HBS.match(/<div class="stonetop-moves-sidebar[\s\S]*?\n {4}<\/div>/)?.[0];
		expect(rail, "the rail's markup moved or was renamed").toBeTruthy();
		expect(rail).not.toContain("data-item-id");
		expect(rail).not.toContain("rollable");
		expect(rail).not.toContain("data-roll");
	});

	it("sits inside the split, beside the step column rather than within it", () => {
		const split = HBS.indexOf('class="stonetop-guide-split"');
		const main  = HBS.indexOf('class="stonetop-guide-main"');
		const rail  = HBS.indexOf('class="stonetop-moves-sidebar');
		const nav   = HBS.indexOf('class="stonetop-guide-nav"');
		expect(split).toBeGreaterThan(-1);
		expect(rail).toBeGreaterThan(main);
		expect(rail).toBeLessThan(nav);
	});
});

// ONE collapse: the edge handle, which takes the whole rail down to a 14px strip and hands its
// width back to the step. It has to survive a reload, or a rail that reopens against the reader
// is worse than no control at all.
//
// The heading carried a SECOND one for a while — the character sheet's group fold, a
// `role="button"` heading with a rotating caret that clamped the list away. It is gone, and this
// block is where that stays true. The rail holds exactly one group and nothing else, so folding
// it leaves a heading standing over an empty column: the handle's outcome, reached worse. The
// caret also cost the title the 14px that decides whether its name fits on one line.
describe("the rail's one collapse", () => {
	it("opens by default and rides in the reload-resume record", () => {
		const d = dialog();
		expect(d._resumeExtras()).toEqual({ movesRailCollapsed: undefined });

		d._applyResumeExtras({ movesRailCollapsed: true });
		expect(d._movesRailCollapsed).toBe(true);
		expect(d._resumeExtras()).toEqual({ movesRailCollapsed: true });

		// A record written before it existed, and one from a reader who never touched the
		// handle, open the rail.
		d._applyResumeExtras({});
		expect(d._movesRailCollapsed).toBe(false);
		d._applyResumeExtras(undefined);
		expect(d._movesRailCollapsed).toBe(false);

		// A record still carrying the retired list fold is read past, not tripped over.
		d._applyResumeExtras({ movesListCollapsed: true });
		expect(d._movesRailCollapsed).toBe(false);
		expect(d._resumeExtras()).toEqual({ movesRailCollapsed: false });
	});

	// saveWalkthroughPosition drops the write when the stored record already says exactly what
	// it is handed, comparing EVERY key of the position — so a collapse only persists while it
	// is a key of _resumeExtras. It is the only one, and this is what says so.
	it("is the only key of the saved position, so its write is never dropped as unchanged", () => {
		expect(Object.keys(dialog()._resumeExtras())).toEqual(["movesRailCollapsed"]);
	});

	it("reaches the template as the class its handle toggles", async () => {
		const d = dialog();
		expect((await d.getData()).movesRailCollapsed).toBe(false);
		d._movesRailCollapsed = true;
		expect((await d.getData()).movesRailCollapsed).toBe(true);
		expect(HBS).toContain("{{#if movesRailCollapsed}} is-collapsed{{/if}}");
	});

	// The retired fold, in every place it used to live. Each of these is a way for it to come
	// back by accident — the classes carry the caret and the clamp with them, so re-using either
	// on this rail re-grows the control without anybody writing one.
	it("leaves no second fold behind it, in the markup, the styling or the handlers", () => {
		// Comments stripped from both files: each one explains why the fold went, naming the
		// classes it forbids, so a guard reading the raw text would fail on its own rationale.
		expect(MARKUP).not.toContain("stonetop-moves-collapsible");
		expect(MARKUP).not.toContain("stonetop-moves-summary");
		expect(MARKUP).not.toContain("movesListCollapsed");
		expect(CSS).not.toContain(".stonetop-guide-moves-sidebar .stonetop-moves-summary");
		expect(CSS).not.toContain(".stonetop-guide-moves-sidebar .stonetop-moves-collapsible");
		expect(DIALOG_CODE).not.toContain("movesListCollapsed");
		expect(DIALOG_CODE).not.toContain("stonetop-moves-summary");

		// And the shared pair is untouched — the character sheet's sidebar still folds.
		expect(CSS).toContain(".stonetop-moves-collapsible.is-collapsed > .items-list");
		expect(CSS).toContain(".stonetop-moves-summary::after");
	});
});

describe("the rail's styling", () => {
	// The shared row rule is `.stonetop-moves-sidebar .items-list li` at (0,2,1). Being later
	// in the file does not beat that, so the overrides carry three classes and the element.
	// Drop one and the rows go back to a single nowrap line with a pointer cursor, silently.
	it("beats the shared sidebar row rule on specificity, not on source order", () => {
		expect(CSS).toContain(".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move");
		expect(CSS).toContain(".stonetop-guide-moves-sidebar li.stonetop-guide-move:hover");
	});

	// BEM order: the modifier and the base are both one class, so the modifier only wins the
	// width while it sits LATER in the file.
	it("declares its fixed width after the max-content base it overrides", () => {
		const base = CSS.indexOf(".stonetop-moves-sidebar {");
		const mod  = CSS.indexOf(".stonetop-guide-moves-sidebar {");
		expect(base).toBeGreaterThan(-1);
		expect(mod).toBeGreaterThan(base);
	});

	// Collapsed has to beat the modifier's own 200px, which is also one class.
	it("still collapses to the handle strip", () => {
		expect(CSS).toContain(".stonetop-guide-moves-sidebar.is-collapsed");
		expect(CSS.indexOf(".stonetop-guide-moves-sidebar.is-collapsed"))
			.toBeGreaterThan(CSS.indexOf(".stonetop-guide-moves-sidebar {"));
	});
});

// The standing rule: a prose list on these surfaces is bulleted with the spiral, never a disc,
// never a glyph standing in for one, and never nothing at all. This rail arrived with no marker,
// which is the failure shape the mechanical guard in tests/styles/spiral-bullets.test.js cannot
// see — that one walks <ul>s, and these rows are an <ol> (the shape both the character sheet's
// sidebar and the GM Toolkit's move lists use). So it is pinned here instead.
describe("the spiral on each move's title", () => {
	const ROW    = ".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move";
	const marker = CSS.slice(CSS.indexOf(`${ROW}::before`), CSS.indexOf(`${ROW}::before`) + 400);

	it("is drawn, and on every row", () => {
		expect(CSS).toContain(`${ROW}::before`);
		expect(marker).toContain('content: ""');
	});

	// NEVER the literal url(): three scopes re-point the variable at check-spiral-light.svg for
	// dark paper, and a hardcoded path renders a black spiral invisible in all three.
	it("goes through the shared icon variable rather than a hardcoded path", () => {
		expect(marker).toContain("var(--stonetop-spiral-icon)");
		expect(marker).not.toContain("check-spiral.svg");
	});

	// The reference spacing is the Assets list's, and it is a variable so every spiral list
	// stays in step. A hardcoded 18px here would drift the day the variable moves.
	it("hangs in the gutter the shared variables set, not a hardcoded one", () => {
		const row = CSS.slice(CSS.indexOf(`${ROW} {`), CSS.indexOf(`${ROW}::before`));
		expect(row).toContain("var(--stonetop-bullet-size, 10px) + var(--stonetop-spiral-gap)");
		expect(marker).toContain("position: absolute");
	});

	// The documented trap on this whole bullet family: a flex <li> makes every inline child its
	// own flex item, so an <em> mid-gloss would break out of the run instead of wrapping in it.
	it("keeps the row in block flow, which the bullet family requires", () => {
		const row = CSS.slice(CSS.indexOf(`${ROW} {`), CSS.indexOf(`${ROW}::before`));
		expect(row).toContain("display: block");
		expect(row).not.toContain("display: flex");
	});
});

describe("the rail as it renders", () => {
	it("prints every move's name and gloss, once each", async () => {
		const hb = Handlebars.create();
		hb.registerPartial("stonetop.guide-toc", "");
		hb.registerPartial("stonetop.expedition-journey", "");
		hb.registerPartial("stonetop.section-heading",
			read("templates/actor/partials/section-heading.hbs"));
		hb.registerHelper("localize", s => s);
		hb.registerHelper("eq", (a, b) => a === b);
		hb.registerHelper("and", (...a) => a.slice(0, -1).every(Boolean));
		hb.registerHelper("boldMissText", s => s);

		const { explorationMoves } = await dialog().getData();
		const html = hb.compile(HBS)({ explorationMoves, movesRailCollapsed: false, step: {} });

		// Through `escapeExpression`, because `{{ }}` is what renders these and one gloss
		// carries an apostrophe ("It's here, not looming"). Asserting on the raw string
		// instead would fail on that one entry and pass on the other six, which reads as a
		// missing move rather than as the escaping working.
		//
		// PRINTED once, which is not the same as "appears once": every name is also on its
		// row's `data-move`, which is how the randomizer finds the row it drew. So the count
		// is of the visible span, and the attribute is counted separately — the original
		// worry (a second copy of the whole list) would double both.
		for (const move of EXPLORATION_GM_MOVES) {
			const name  = hb.escapeExpression(move.name);
			const gloss = hb.escapeExpression(move.gloss);
			const printed = `<span class="stonetop-guide-move-name">${name}</span>`;
			expect(html.split(printed).length - 1, move.name).toBe(1);
			expect(html.split(`data-move="${name}"`).length - 1, move.name).toBe(1);
			expect(html, move.name).toContain(gloss);
		}
		// And escaped is the point: authored plain text, rendered as text. A switch to
		// `{{{ }}}` would put that apostrophe back through raw and is what this catches.
		expect(html).toContain("It&#x27;s here, not looming.");
	});
});

// ── The die ──────────────────────────────────────────────────────────────────
// The rail is a list to read down when there is time. The die is for the other case, which is
// most of an expedition: the party has walked into something, the table is looking at the GM,
// and seven moves have gone to soup. One click draws one move, runs a light down the list to
// it, and whispers it — the same three beats, off the same two functions, as the GM Toolkit's
// move groups, because it is the same seven moves off the same table.
//
// A minimal stand-in for the rail's DOM. The suite runs on `environment: "node"`, so this is the
// same shape the flash-highlight suite uses: a class list, a layout property, and a `closest`
// that answers the one selector the handler asks for. `hidden` nulls each row's `offsetParent`,
// which is what a collapsed rail looks like from here.
function fakeRail({ hidden = false } = {}) {
	const rows = EXPLORATION_GM_MOVES.map(m => {
		const set = new Set();
		return {
			dataset:   { move: m.name },
			classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) },
			offsetWidth:  10,
			// Not null, so the walk reads a stand-in row as on the page — which is what a test
			// of the walk needs.
			offsetParent: {},
		};
	});
	const scope = {
		querySelectorAll: sel => sel === ".stonetop-guide-move"
			? rows
			: rows.filter(r => r.classList.contains(sel.slice(1))),
	};
	const button = {
		dataset: { section: "exploration" },
		// The rail's one collapse is `display: none` on the whole column, so a hidden rail is a
		// rail whose rows have no `offsetParent` — there is no half-hidden state to stand in for.
		closest: sel => (sel === ".stonetop-guide-moves-sidebar" ? scope : null),
	};
	if (hidden) for (const row of rows) row.offsetParent = null;
	return { button, rows, lit: () => rows.filter(r => r.classList.contains("stonetop-flash")) };
}

let posted;

/**
 * Run the clock to the LANDING and stop there.
 *
 * Not `runAllTimersAsync`: the landing arms a five-second timer that takes the highlight off
 * again, and running every timer to exhaustion runs that one too — so the walk would be over,
 * the card posted, and every row bare, with nothing left to assert the light ever arrived. The
 * card going out IS the landing (it is awaited on `spin.done`), so that is what this waits for.
 */
async function runToLanding() {
	for (let i = 0; i < 400 && !posted.length; i++) await vi.advanceTimersByTimeAsync(25);
}

beforeEach(() => {
	posted = [];
	global.ChatMessage = {
		create:               data => { posted.push(data); return Promise.resolve(data); },
		getWhisperRecipients: () => [{ id: "gm1" }, { id: "gm2" }],
		getSpeaker:           () => ({ alias: "The GM" }),
	};
});

describe("the rail's die, as markup", () => {
	// The section-heading partial can emit this button itself (`randomize=`), which would put it
	// inside the <h3> — where it would sit after the caption rather than beside the title, and
	// where the caption's own line would have to make room for it. Out here it is a flex item on
	// the heading row, so the title's line ends with it and the caption keeps the full column.
	it("sits beside the heading rather than inside it", () => {
		const head = HBS.indexOf('class="stonetop-guide-moves-head"');
		const h3   = HBS.indexOf('"stonetop.section-heading" title="Exploration moves"');
		const die  = HBS.indexOf('"stonetop.section-randomize"');
		const list = HBS.indexOf('class="items-list stonetop-guide-moves-list"');
		expect(head).toBeGreaterThan(-1);
		expect(die).toBeGreaterThan(h3);
		expect(die).toBeLessThan(list);
		expect(HBS).not.toContain("randomize=movesRandomize ");
		expect(HBS).toContain('{{> "stonetop.section-randomize" section=movesRandomize');
	});

	// A flex row, and the title takes the slack: the die belongs at the END of the title's line,
	// not immediately after its last word. `flex-start` because this heading is two lines — the
	// caption sits under the title — and centring drops the die into the gap between them.
	it("rides a flex heading row that seats it on the title's line", () => {
		const rule = CSS.slice(CSS.indexOf(".stonetop-guide-moves-sidebar .stonetop-guide-moves-head {"));
		expect(rule.slice(0, 120)).toContain("display: flex");
		expect(rule.slice(0, 120)).toContain("align-items: flex-start");
		expect(CSS).toContain(".stonetop-guide-moves-sidebar .stonetop-guide-moves-head > .stonetop-move-group-title");
		expect(CSS).toContain(".stonetop-guide-moves-sidebar .stonetop-guide-moves-head > .stonetop-section-randomize");
	});

	// GM-only, and by the same test the load readout and the asset picker use: the card is a
	// WHISPER to the GMs, so a player clicking it would watch the light run and get nothing.
	it("renders for a GM and not for a player", async () => {
		expect((await dialog().getData()).movesRandomize).toBe("");
		global.game.user.isGM = true;
		expect((await dialog().getData()).movesRandomize).toBe("exploration");
	});

	// One wording for one control across the two screens the same GM meets in one session —
	// the same rule EXPLORATION_SIDEBAR_MOVES enforces for the list itself.
	it("labels itself with the GM Toolkit's own string, not a second copy of it", async () => {
		const { movesRandomizeTitle } = await dialog().getData();
		expect(movesRandomizeTitle).toBe(game.i18n.localize("stonetop.gmToolkit.moves.randomize"));
		expect(DIALOG_JS).not.toContain('"Draw one at random');
	});
});

describe("the rail's die, as it behaves", () => {
	it("draws one of the seven, lands the light on that row, and whispers that same move", async () => {
		vi.useFakeTimers();
		const { button, rows, lit } = fakeRail();
		const d = dialog();

		const drawn = d._drawExplorationMove(button);
		await runToLanding();

		// ONE row lit, and it is one of the seven.
		expect(lit()).toHaveLength(1);
		expect(EXPLORATION_GM_MOVES.map(m => m.name)).toContain(lit()[0].dataset.move);
		// Nothing is left wearing the walking light after the landing.
		expect(rows.filter(r => r.classList.contains("stonetop-spin"))).toHaveLength(0);
		// And the card names the row the light stopped on, rather than a second draw.
		expect(posted).toHaveLength(1);
		expect(posted[0].content).toContain(lit()[0].dataset.move);

		// The light goes out on its own: a row still lit ten minutes later would have the rail
		// claiming a selection it does not have.
		await vi.runAllTimersAsync();
		await drawn;
		vi.useRealTimers();
		expect(lit()).toHaveLength(0);
	});

	// Whispered, never public: naming the move announces the trick before it is played, and
	// hands the players the move the GM has not made yet.
	it("whispers to the GMs and to nobody else", async () => {
		const { button } = fakeRail({ hidden: true });
		await dialog()._drawExplorationMove(button);
		expect(posted[0].whisper).toEqual(["gm1", "gm2"]);
	});

	// Seven moves: "Bar the way" twice running is a one-in-seven event, not a curiosity, and it
	// reads as a broken button rather than as a random one.
	it("never gives the same move twice running", async () => {
		const { button } = fakeRail({ hidden: true });
		const d = dialog();
		let previous = null;
		for (let i = 0; i < 20; i++) {
			const drawn = await d._drawExplorationMove(button);
			if (previous) expect(drawn.name).not.toBe(previous);
			previous = drawn.name;
		}
		expect(posted).toHaveLength(20);
	});

	// The card waits for the landing. One that posted at the click would answer the question the
	// walk is still in the middle of asking, and a GM reading chat would never watch the list.
	it("posts nothing until the light has landed", async () => {
		vi.useFakeTimers();
		const { button } = fakeRail();
		const drawn = dialog()._drawExplorationMove(button);

		await vi.advanceTimersByTimeAsync(40);
		expect(posted).toHaveLength(0);

		await vi.runAllTimersAsync();
		await drawn;
		vi.useRealTimers();
		expect(posted).toHaveLength(1);
	});

	// A second click abandons the first walk where it stands, and the click it interrupted drops
	// out before posting: one landing, one card.
	it("gives one card, not two, when a second click supersedes the first", async () => {
		vi.useFakeTimers();
		const { button, lit } = fakeRail();
		const d = dialog();

		const first = d._drawExplorationMove(button);
		await vi.advanceTimersByTimeAsync(40);
		const second = d._drawExplorationMove(button);
		await runToLanding();

		expect(posted).toHaveLength(1);
		expect(lit()).toHaveLength(1);

		await vi.runAllTimersAsync();
		await Promise.all([first, second]);
		vi.useRealTimers();
	});

	// A walk nobody can watch is two or three seconds of delay in front of the card the click was
	// actually for. `spinHighlight` skips it and resolves at once, and this is the dialog holding
	// up its end: the whisper still goes out. (Off a click it cannot happen — the rail's collapse
	// takes the die away with the rows — but a re-render mid-walk can detach them underneath it.)
	it("skips the walk when the rows are off the page, and posts at once", async () => {
		vi.useFakeTimers();
		const { button, rows } = fakeRail({ hidden: true });
		// No clock advanced anywhere in here: the card has to be out by the time the draw
		// resolves, which is the whole claim.
		await dialog()._drawExplorationMove(button);
		vi.useRealTimers();

		expect(posted).toHaveLength(1);
		// Not one step of the walk was taken — no row ever wore the travelling light.
		expect(rows.some(r => r.classList.contains("stonetop-spin"))).toBe(false);
		// The landing highlight still goes on, on the row that was drawn. It is invisible and it
		// clears itself on the same timer as always; suppressing it would be a second code path
		// for no gain, and would leave the row bare if the rail came back before it expired.
		expect(rows.filter(r => r.classList.contains("stonetop-flash"))).toHaveLength(1);
	});
});

describe("the rail's draw, as styling", () => {
	// The GM Toolkit's rules are written against `.stonetop-gm-toolkit-moves .stonetop-gm-move`
	// and reach nothing in a dialog, so the effect is re-scoped here. The KEYFRAME is not
	// re-declared: it is the one place the 5s is written in CSS, and the toolkit's suite pins
	// that number against FLASH_MS. Two copies would be two durations to keep in step with the
	// timer that takes the class off.
	it("re-scopes the walk and the landing without re-declaring the fade", () => {
		expect(CSS).toContain(".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move.stonetop-spin");
		expect(CSS).toContain(".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move.stonetop-flash");
		expect(CSS.match(/@keyframes stonetop-gm-move-flash\s*\{/g)).toHaveLength(1);
		const flash = CSS.slice(CSS.indexOf(".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move.stonetop-flash"));
		expect(flash.slice(0, 200)).toContain("animation: stonetop-gm-move-flash");
	});

	// `:is()` takes only the HIGHEST specificity of its arguments, so the band selector is
	// (0,4,1) against the row's own (0,3,1) base — drop a class and the padding silently loses
	// to the base rule and the wash to the row's `background: transparent` hover.
	it("beats the row's own base and hover rules on specificity", () => {
		const band = ".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move:is(.stonetop-spin, .stonetop-flash)";
		expect(CSS).toContain(`${band} {`);
		expect(CSS.indexOf(band)).toBeGreaterThan(CSS.indexOf(".stonetop-guide-moves-sidebar li.stonetop-guide-move:hover"));
	});

	// The band is pulled 6px wider than the row and given the width back as padding, so it reads
	// as a band around the text. The spiral is absolutely positioned against the row's padding
	// box, whose left edge moves with that margin — without the ::before nudge the marker slides
	// out and back on every row the light crosses.
	it("keeps the spiral still while the light passes", () => {
		const band = ".stonetop-guide-moves-sidebar .items-list li.stonetop-guide-move:is(.stonetop-spin, .stonetop-flash)";
		const rule = CSS.slice(CSS.indexOf(`${band} {`), CSS.indexOf(`${band}::before`));
		expect(rule).toContain("margin-inline: -6px");
		// The gutter is kept and the 6px added to it, rather than the toolkit's flat
		// `padding-inline`, which would have put the spiral under the move's name.
		expect(rule).toContain("padding-inline-start: calc(var(--stonetop-bullet-size, 10px) + var(--stonetop-spiral-gap) + 6px)");
		expect(CSS.slice(CSS.indexOf(`${band}::before`), CSS.indexOf(`${band}::before`) + 200)).toContain("left: 6px");
	});
});
