import { describe, it, expect, vi, beforeEach } from "vitest";
import { readRepo as read, readCss, repoFileExists, declarations } from "../../fakes/css.js";
import { withGmWonderTab } from "../../../module/actors/gmtoolkit/gm-wonder-tab.js";
import { GM_WONDER_GUIDE } from "../../../module/gm-toolkit/gm-wonder-guide.js";
import { fakeEl, fakeRoot, makeListHost } from "../../fakes/dom.js";

// The GM Toolkit's "I wonder..." tab: the running list of open questions from Book I p.33, and
// the ONE surface on this sheet a GM authors rather than reads.
//
// Two halves to this file, guarding two different kinds of failure.
//
// The WIRING half asserts on source text, like the Core Loop tab's tests do, because every leg of
// adding a tab fails silently: an unregistered partial renders nothing, a missing include leaves
// the rail button pointing at a panel that does not exist, a `data-tab` with no icon row paints a
// solid block, and a tab left out of the padding rule renders flush against the frame.
//
// The BEHAVIOUR half exercises the mixin over a fake actor, because the ways this tab loses a GM's
// typing are all quiet ones: a write that reads a stale list, a text edit that re-renders the node
// holding the caret, an emptied question box saved as an empty question.

const CSS         = readCss();
const STONETOP_JS = read("stonetop.js");
const SHEET_HBS   = read("templates/actor/gm-toolkit.hbs");
const WONDER_HBS  = read("templates/actor/partials/gm-toolkit-tab-wonder.hbs");
const MIXIN_JS    = read("module/actors/gmtoolkit/gm-wonder-tab.js");
const MODEL_JS    = read("module/data-models/GmToolkitModel.js");
const FIELDS_JS   = read("module/data-models/fields.js");

/**
 * The mixin over a stand-in actor whose `update` writes through. The harness itself is shared with
 * the Encounters tab — see tests/fakes/dom.js for what it models and why it lives there.
 *
 * `editing` takes a boolean for both pencils, or `{wonderOpen, wonderSettled}` to set them apart.
 */
const makeHost = (wonders = [], opts) =>
	makeListHost(withGmWonderTab, "system.wonders", wonders, opts);


/** One rendered row: the two fields and the three buttons, all under a `data-wonder-id` li. */
function makeRow(root, id, question = "", answer = "") {
	const li = fakeEl({ parent: root, dataset: { wonderId: id } });
	return {
		li,
		question: fakeEl({ cls: ["stonetop-gm-wonder-question"], value: question, parent: li }),
		answer:   fakeEl({ cls: ["stonetop-gm-wonder-answer"],   value: answer,   parent: li }),
		settle:   fakeEl({ cls: ["stonetop-gm-wonder-settle"],   parent: li }),
		reopen:   fakeEl({ cls: ["stonetop-gm-wonder-reopen"],   parent: li }),
		remove:   fakeEl({ cls: ["stonetop-gm-wonder-remove"],   parent: li }),
	};
}

/** The add bar: the field Enter fires from and the button beside it. */
function makeAddBar(root) {
	const bar = fakeEl({ cls: ["stonetop-gm-wonder-add"], parent: root });
	return {
		field:  fakeEl({ cls: ["stonetop-gm-wonder-new"],     parent: bar }),
		button: fakeEl({ cls: ["stonetop-gm-wonder-add-btn"], parent: bar }),
	};
}

describe("the I wonder tab: wiring", () => {
	// Each of these is a silent failure on its own, exactly as for the Core Loop tab beside it.
	it("is registered, mounted, and has a rail button", () => {
		expect(STONETOP_JS).toContain('"stonetop.gm-toolkit-tab-wonder"');
		expect(SHEET_HBS).toContain('{{> "stonetop.gm-toolkit-tab-wonder"}}');
		expect(SHEET_HBS).toMatch(/\{\{>\s*"stonetop\.tab-rail-item"\s+tab="wonder"/);
	});

	it("binds to the same tab group as the rest of the sheet", () => {
		expect(WONDER_HBS).toMatch(/<div class="tab wonder\b[^"]*"[^>]*data-group="primary"/);
		expect(WONDER_HBS).toContain('data-tab="wonder"');
	});

	// The user asked for it ABOVE the Core Loop tab, and the rail's order is the source order of
	// these two partial calls. Asserted on both lists, because they are two separate lists that
	// have to agree: the rail decides the button order, the body decides nothing at all, and a
	// mismatch is invisible (the panels are shown one at a time).
	it("sits directly above the Core Loop tab, in the rail and in the body", () => {
		const order = ["homefront", "moves", "threats", "encounters", "expeditions", "wonder", "loop"];
		const railOrder = [...SHEET_HBS.matchAll(/tab-rail-item"\s+tab="(\w+)"/g)].map(m => m[1]);
		expect(railOrder).toEqual(order);
		const bodyOrder = [...SHEET_HBS.matchAll(/\{\{>\s*"stonetop\.gm-toolkit-tab-(\w+)"\}\}/g)].map(m => m[1]);
		expect(bodyOrder).toEqual(order);
	});

	// A data-tab with no row in the icon table gets a mask with no image, which resolves to FULL
	// coverage: a solid block where the glyph belongs, and nothing logged.
	it("earns a rail glyph from the icon table, and the file it names exists", () => {
		expect(CSS).toMatch(/\.stonetop-tab-rail \.item\[data-tab="wonder"\]\s*\{\s*--st-tab-icon:/);
		expect(repoFileExists("assets/icons/tabs/question-mark.svg")).toBe(true);
	});

	// Worn as a MASK, so alpha may exist only where the ink is. The transparent backing square
	// every other file in that folder carries is what keeps a mask from resolving to a slab.
	it("ships a maskable glyph, credited like the rest of the rail", () => {
		const svg = read("assets/icons/tabs/question-mark.svg");
		expect(svg).toContain('viewBox="0 0 512 512"');
		expect(svg).toContain('fill-opacity="0"');
		// `--` is illegal inside an XML comment and makes the whole file unparseable, which draws
		// nothing at all: this file carries a long one, so the rule is worth pinning.
		expect(svg.match(/<!--[\s\S]*?-->/)?.[0]).not.toMatch(/[^!]--[^>]/);
		expect(read("assets/icons/tabs/ATTRIBUTION.md")).toContain("question-mark.svg");
	});

	// The rail is icon-only, so a tab with no label has no name anywhere on screen.
	it("has a localized name", () => {
		expect(game.i18n.localize("stonetop.gmToolkit.tabs.wonder")).toBe("I Wonder...");
	});

	// Membership of the shared `:is()`, not its exact text, for the reason its sibling tests give:
	// The gutter reaches every panel through the bare `> .tab` rule, so there is no per-tab
	// membership left to get wrong — which is why this asserts the rule is still the general
	// one rather than that this tab is named in it. If it ever goes back to naming tabs, a tab
	// left out renders flush against both edges of the frame and nothing is logged.
	it("gets its panel gutter from the shared tab-padding rule", () => {
		expect(declarations(CSS, ".stonetop-gm-toolkit-sheet .sheet-body > .tab")).toMatch(/padding:/);
		expect(CSS).not.toMatch(/\.stonetop-gm-toolkit-sheet \.sheet-body > :is\([^)]*\)\s*\{[^}]*padding:/);
	});

	// Every field here is written by hand to `system.wonders`. A `name` on any of them would put
	// it in core's form submit data, where the array indices expand into an OBJECT keyed "0",
	// "1", ... and replace the list with it — no error, and the list is gone.
	it("gives no form field a name, so the sheet's submit cannot rewrite the list", () => {
		const markup = WONDER_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		expect(markup).not.toMatch(/<(?:input|textarea)[^>]*\sname=/);
	});

	// The fold walk claims a heading's FOLLOWING SIBLINGS until the next heading, so each of the
	// two folded sections has to be one element sitting after its own heading. The guide's own
	// sub-headings are h4 with their own class, deliberately NOT the stem HEADING_SELECTOR reads.
	it("keeps its folded sections foldable", () => {
		expect(WONDER_HBS).toContain('collapse="gm-wonder-settled"');
		expect(WONDER_HBS).toContain('collapse="gm-wonder-guide"');
		// Comments stripped first: this file discusses the very class it must not USE, and the
		// prose would answer for the markup.
		const markup = WONDER_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		expect(markup).not.toContain("stonetop-move-group-title");
		expect(markup).not.toContain("steading-residents-heading");
	});
});

describe("the I wonder list: storage", () => {
	// Additive, with an `initial`, so a toolkit made before this field loads with an empty list
	// and no migration runs. The alternative fails on OPEN, for every existing world.
	it("is an additive array field on the toolkit's own data model", () => {
		expect(FIELDS_JS).toMatch(/export const wondersField = \(\) => new fields\.ArrayField/);
		expect(FIELDS_JS).toMatch(/\}\), \{ required: false, initial: \[\] \}\);/);
		expect(MODEL_JS).toContain("wonders: wondersField()");
	});

	// `trim: false` on both text fields, because the sheet writes them on blur WITHOUT
	// re-rendering: a field the model silently trimmed would leave the box holding one string and
	// the document holding another, with nothing on screen saying which was saved.
	it("does not trim what it stores", () => {
		const field = FIELDS_JS.slice(FIELDS_JS.indexOf("export const wondersField"));
		expect(field).toMatch(/question:\s*new fields\.StringField\(\{[^}]*trim: false/);
		expect(field).toMatch(/answer:\s*new fields\.StringField\(\{[^}]*trim: false/);
	});

	it("reads an absent or malformed list as empty rather than throwing", () => {
		const { host } = makeHost();
		host.actor.system = {};
		expect(host._wonderList()).toEqual([]);
		host.actor.system = { wonders: "nope" };
		expect(host._wonderList()).toEqual([]);
	});

	it("normalizes a partial entry into the full shape", () => {
		const { host } = makeHost([{ id: "a" }]);
		expect(host._wonderList()).toEqual([{ id: "a", question: "", answer: "", settled: false }]);
	});
});

describe("the I wonder list: adding", () => {
	it("appends a question, with an id of its own", async () => {
		const { host, actor } = makeHost();
		await expect(host._addWonder("What did happen to the Forest Folk?")).resolves.toBe(true);
		expect(actor.system.wonders).toHaveLength(1);
		expect(actor.system.wonders[0].question).toBe("What did happen to the Forest Folk?");
		expect(actor.system.wonders[0].id).toBeTruthy();
		expect(actor.system.wonders[0].settled).toBe(false);
	});

	it("keeps the ones already there, in order", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "first" }]);
		await host._addWonder("second");
		expect(actor.system.wonders.map(w => w.question)).toEqual(["first", "second"]);
	});

	// Trimmed HERE rather than by the schema, which keeps `trim: false` for the reason above.
	it("trims the typed line, and refuses one that is only whitespace", async () => {
		const { host, actor, updates } = makeHost();
		await host._addWonder("  padded  ");
		expect(actor.system.wonders[0].question).toBe("padded");
		await expect(host._addWonder("   ")).resolves.toBe(false);
		await expect(host._addWonder("")).resolves.toBe(false);
		expect(updates).toHaveLength(1);
	});
});

describe("the I wonder list: answering, filing and deleting", () => {
	it("writes an answer without asking for a render", async () => {
		const { host, actor, updates } = makeHost([{ id: "a", question: "q" }]);
		await host._setWonderField("a", "answer", "A hunch.");
		expect(actor.system.wonders[0].answer).toBe("A hunch.");
		expect(updates[0][1]).toEqual({ render: false });
	});

	// The whole point of the split: a text edit fires on BLUR, and blur is usually the GM moving
	// into the next box. A render there tears out the node that just took focus.
	it("re-renders for a structural change, and only for those", async () => {
		const { host, updates } = makeHost([{ id: "a", question: "q" }]);
		await host._setWonderField("a", "question", "q2");
		await host._setWonderSettled("a", true);
		expect(updates.map(([, opts]) => opts)).toEqual([{ render: false }, {}]);
	});

	it("writes nothing at all when a field is unchanged", async () => {
		const { host, updates } = makeHost([{ id: "a", question: "q", answer: "" }]);
		await host._setWonderField("a", "question", "q");
		await host._setWonderSettled("a", false);
		await host._removeWonder("nope");
		await host._setWonderField("missing", "answer", "x");
		expect(updates).toHaveLength(0);
	});

	it("files a question and puts it back", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q", answer: "settled it" }]);
		await host._setWonderSettled("a", true);
		expect(actor.system.wonders[0]).toMatchObject({ settled: true, answer: "settled it" });
		await host._setWonderSettled("a", false);
		expect(actor.system.wonders[0].settled).toBe(false);
	});

	it("deletes only the one asked for", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "a" }, { id: "b", question: "b" }]);
		await host._removeWonder("a");
		expect(actor.system.wonders.map(w => w.id)).toEqual(["b"]);
	});

	// The failure this guards: clicking a button BLURS whatever field had focus, so the browser
	// fires `change` (one async write) and then `click` (a second) with nothing in between. Read
	// against the same starting list, the second to land wins and the typing is gone.
	it("serializes concurrent writes, so an in-flight answer is not clobbered", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }]);
		// Deliberately NOT awaited in turn: this is the interleaving the browser produces.
		const typing  = host._setWonderField("a", "answer", "the hunch I just typed");
		const filing  = host._setWonderSettled("a", true);
		const another = host._addWonder("a new question");
		await Promise.all([typing, filing, another]);

		expect(actor.system.wonders).toHaveLength(2);
		expect(actor.system.wonders[0]).toMatchObject({
			id: "a", answer: "the hunch I just typed", settled: true,
		});
		expect(actor.system.wonders[1].question).toBe("a new question");
	});

	// One failed write must not wedge every write after it: the chain's tail absorbs the error so
	// the next mutation still runs against the live document.
	it("survives a failed write and keeps taking the next one", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }]);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		globalThis.ui = { notifications: { error: vi.fn() } };
		actor.update.mockRejectedValueOnce(new Error("nope"));

		await host._setWonderField("a", "answer", "lost");
		expect(globalThis.ui.notifications.error).toHaveBeenCalled();

		await host._setWonderField("a", "answer", "kept");
		expect(actor.system.wonders[0].answer).toBe("kept");
		err.mockRestore();
	});
});

describe("the I wonder tab: context", () => {
	it("splits the list into open and answered, and carries the book's guidance", () => {
		const { host } = makeHost([
			{ id: "a", question: "open one" },
			{ id: "b", question: "done one", settled: true },
			{ id: "c", question: "open two" },
		]);
		const context = { stonetop: {} };
		host._addGmWonderContext(context);
		expect(context.stonetop.wonders.open.map(w => w.id)).toEqual(["a", "c"]);
		expect(context.stonetop.wonders.settled.map(w => w.id)).toEqual(["b"]);
		expect(context.stonetop.wonderGuide).toBe(GM_WONDER_GUIDE);
	});

	// The guidance is transcribed book text, so it cites the page it came off. Book I p.33 is the
	// section; the two cross-references are the later chapters that send a GM back to the list.
	it("cites Book I p.33 for every section of the guidance", () => {
		expect(GM_WONDER_GUIDE.length).toBeGreaterThan(0);
		for (const section of GM_WONDER_GUIDE) {
			expect(section.page).toBe(33);
			expect(section.name).toBeTruthy();
			expect(section.items.length).toBeGreaterThan(0);
		}
		expect(game.i18n.localize("stonetop.gmToolkit.wonder.guideNote")).toBe("Book I, p.33");
	});

	// The guide is half questions, on the tab named for asking them. They only draw as questions
	// if the swap is re-asserted INSIDE this list: the global `li.question-bullet::before` weighs
	// the same as the list's own spiral default and loses to it on source order, so the items
	// `markQuestionBullets` tags would quietly wear the ordinary spiral instead.
	it("lets the question-spiral swap reach its tagged items", () => {
		expect(declarations(CSS, ".stonetop-gm-wonder-guide-items > li.question-bullet::before"))
			.toContain("question-spiral.svg");
		expect(GM_WONDER_GUIDE.some(s => s.items.some(i => String(i).trim().endsWith("?")))).toBe(true);
	});
});

describe("the I wonder tab: interactions", () => {
	beforeEach(() => {
		globalThis.ui = { notifications: { error: vi.fn() } };
	});

	it("adds from the button, clears the field and leaves the caret in it", async () => {
		const { host, actor } = makeHost();
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host._activateGmWonderListeners(root);

		bar.field.value = "why is the Forge cold?";
		await root.emit("click", bar.button);

		expect(actor.system.wonders).toHaveLength(1);
		expect(actor.system.wonders[0].question).toBe("why is the Forge cold?");
		expect(bar.field.value).toBe("");
		// The next question is typed straight after this one, so the caret is claimed for the box
		// the RE-RENDER is about to put there — see the add bar's own describe below.
		expect(host._wonderAdd).toMatchObject({ text: "", focus: true });
	});

	// An add that filed nothing did not re-render either, so there is no new box coming and the
	// live one has to be put back by hand — with what was typed in it, since the handler clears
	// the box before the write rather than after it.
	it("puts a blank line back in the add bar rather than swallowing it", async () => {
		const { host, updates } = makeHost();
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host._activateGmWonderListeners(root);

		bar.field.value = "   ";
		await root.emit("click", bar.button);

		expect(updates).toHaveLength(0);
		expect(bar.field.value).toBe("   ");
		expect(bar.field.focused).toBe(true);
	});

	// Both fields sit inside the sheet's <form>, where an unhandled Enter is IMPLICIT SUBMISSION:
	// core submits and re-renders, which on the add bar looks exactly like the question being
	// swallowed. So Enter is claimed and defaultPrevented in both places.
	it("adds on Enter in the add bar, rather than submitting the sheet", async () => {
		const { host, actor } = makeHost();
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host._activateGmWonderListeners(root);

		bar.field.value = "who else knows?";
		const ev = await root.emit("keydown", bar.field, { key: "Enter" });
		expect(ev.defaultPrevented).toBe(true);
		expect(actor.system.wonders.map(w => w.question)).toEqual(["who else knows?"]);
	});

	it("commits a question on Enter by blurring it, and does not submit either", async () => {
		const { host } = makeHost([{ id: "a", question: "q" }]);
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		row.question.focus();
		const ev = await root.emit("keydown", row.question, { key: "Enter" });
		expect(ev.defaultPrevented).toBe(true);
		expect(row.question.focused).toBe(false);
	});

	it("leaves other keys alone in both fields", async () => {
		const { host, actor } = makeHost();
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host._activateGmWonderListeners(root);

		bar.field.value = "half a question";
		const ev = await root.emit("keydown", bar.field, { key: "a" });
		expect(ev.defaultPrevented).toBe(false);
		expect(actor.system.wonders).toHaveLength(0);
	});

	it("saves a question and an answer on change", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }]);
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		row.question.value = "a better question";
		await root.emit("change", row.question);
		expect(actor.system.wonders[0].question).toBe("a better question");

		row.answer.value = "half of one";
		await root.emit("change", row.answer);
		expect(actor.system.wonders[0].answer).toBe("half of one");
	});

	// Delegation, not per-element binding: the row a control belongs to is the `data-wonder-id`
	// ancestor it sits under, and the second row's buttons must write to the second entry.
	it("writes to the row the control sits in, not the first one on the page", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "a" }, { id: "b", question: "b" }]);
		const root = fakeRoot();
		makeRow(root, "a", "a");
		const second = makeRow(root, "b", "b");
		host._activateGmWonderListeners(root);

		second.answer.value = "the second answer";
		await root.emit("change", second.answer);
		await root.emit("click", second.settle);

		expect(actor.system.wonders[0]).toMatchObject({ id: "a", answer: "", settled: false });
		expect(actor.system.wonders[1]).toMatchObject({ id: "b", answer: "the second answer", settled: true });
	});

	// A row with no question in it reads as a rendering fault, and cannot be told apart from a
	// stray Enter on the add bar. Removing a question is what the trash is for.
	it("refuses an emptied question and puts the stored one back in the box", async () => {
		const { host, actor, updates } = makeHost([{ id: "a", question: "the real question" }]);
		const root = fakeRoot();
		const row = makeRow(root, "a", "the real question");
		host._activateGmWonderListeners(root);

		row.question.value = "   ";
		await root.emit("change", row.question);

		expect(row.question.value).toBe("the real question");
		expect(updates).toHaveLength(0);
		expect(actor.system.wonders[0].question).toBe("the real question");
	});

	// An answer, unlike a question, may legitimately be emptied: a hunch that turned out to be
	// wrong is deleted, and the question stays open.
	it("does let an answer be cleared", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q", answer: "a wrong hunch" }]);
		const root = fakeRoot();
		const row = makeRow(root, "a", "q", "a wrong hunch");
		host._activateGmWonderListeners(root);

		row.answer.value = "";
		await root.emit("change", row.answer);
		expect(actor.system.wonders[0].answer).toBe("");
	});

	it("files and reopens from the row's buttons", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }]);
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		await root.emit("click", row.settle);
		expect(actor.system.wonders[0].settled).toBe(true);
		await root.emit("click", row.reopen);
		expect(actor.system.wonders[0].settled).toBe(false);
	});

	// The trash is the only irreversible control on the tab, and it is NOT the button the book's
	// own instruction points at — that is the tick, which is undoable. So this one asks.
	it("asks before deleting, and leaves the list alone when told no", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }]);
		globalThis.Dialog = { confirm: vi.fn(async () => false) };
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		await root.emit("click", row.remove);
		expect(globalThis.Dialog.confirm).toHaveBeenCalled();
		expect(actor.system.wonders).toHaveLength(1);

		globalThis.Dialog.confirm.mockResolvedValue(true);
		await root.emit("click", row.remove);
		expect(actor.system.wonders).toHaveLength(0);
	});

	// The question is printed prose and goes into the confirm's HTML, so it is escaped on the way
	// in. Unescaped, a question with a stray angle bracket is markup in a dialog.
	it("escapes the question in the confirmation it shows", async () => {
		const { host } = makeHost([{ id: "a", question: '<img src=x onerror="boom">' }]);
		globalThis.Dialog = { confirm: vi.fn(async () => false) };
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		await root.emit("click", row.remove);
		const { content } = globalThis.Dialog.confirm.mock.calls[0][0];
		expect(content).not.toContain("<img");
		expect(content).toContain("&lt;img");
	});

	it("is inert with no root to bind to", () => {
		const { host } = makeHost();
		expect(() => host._activateGmWonderListeners(null)).not.toThrow();
	});
});

// A pencil PER SECTION, the same per-section toggle every other section in the system carries.
// Each guards the three STRUCTURAL buttons of its own list and nothing else: this list is written
// on mid-session, and a tab that has to be unlocked before a hunch can be typed into it is one
// nobody writes on.
describe("the I wonder tab: the edit pencils", () => {
	beforeEach(() => {
		globalThis.ui = { notifications: { error: vi.fn() } };
		globalThis.Dialog = { confirm: vi.fn(async () => true) };
	});

	it("publishes an edit flag per list, both ways", () => {
		for (const editing of [true, false]) {
			const context = { stonetop: {} };
			makeHost([], { editing }).host._addGmWonderContext(context);
			expect(context.stonetop.edit.wonderOpen).toBe(editing);
			expect(context.stonetop.edit.wonderSettled).toBe(editing);
		}
	});

	// MERGED, never assigned over. `_addGmPrepContext` publishes `threats` and `sites` into this
	// same object, and an `=` here would drop them — which renders those sections permanently
	// read-only with nothing logged, the exact failure that mixin's own note is about.
	it("leaves the prep tabs' edit flags where it finds them", () => {
		const { host } = makeHost();
		const context = { stonetop: { edit: { threats: true, sites: false } } };
		host._addGmWonderContext(context);
		expect(context.stonetop.edit).toEqual({
			threats: true, sites: false, wonderOpen: true, wonderSettled: true,
		});
	});

	// The pencils come from the shared partial, so the sheet's existing
	// `_wireSectionEditToggle(html, ".steading-section-edit-toggle")` drives them with no new
	// wiring — but only if each sits in a `steading-edit-section` box, which is the positioned
	// ancestor it floats in, and only if the section ids match the ones the context publishes.
	it("gives each question list its own boxed pencil", () => {
		for (const section of ["wonderOpen", "wonderSettled"]) {
			expect(WONDER_HBS).toMatch(
				new RegExp(`\\{\\{>\\s*"stonetop\\.steading-section-toggle"\\s+section="${section}"\\s+editing=stonetop\\.edit\\.${section}`),
			);
		}
		const boxes = WONDER_HBS.match(/class="stonetop-gm-wonder-section[^"]*"/g) ?? [];
		expect(boxes).toHaveLength(3);
		expect(boxes.filter(c => c.includes("steading-edit-section"))).toHaveLength(2);
		// The guidance box is the third, and carries no pencil: there is nothing in it to edit.
		expect(boxes.filter(c => !c.includes("steading-edit-section"))).toHaveLength(1);
	});

	// The pencil is emitted AHEAD of its heading, which is not a style choice: the fold walk finds
	// a corner caret's heading through `caret.parentElement.querySelector(...)` and then claims
	// that heading's following siblings, so a toggle after the list would leave the list behind it.
	it("puts each pencil ahead of the heading it belongs to", () => {
		for (const section of ["wonderOpen", "wonderSettled"]) {
			const toggle = WONDER_HBS.indexOf(`section="${section}"`);
			const heading = WONDER_HBS.indexOf('"stonetop.section-heading"', toggle);
			expect(toggle).toBeGreaterThan(-1);
			expect(heading).toBeGreaterThan(toggle);
		}
		// The Answered section's caret moves onto the TOGGLE for the same reason, so the pair sits
		// in one corner; the guidance section, having no pencil, keeps its caret on its heading.
		expect(WONDER_HBS).toMatch(/section="wonderSettled"[^}]*collapse="gm-wonder-settled"/);
		expect(WONDER_HBS).toMatch(/"stonetop\.section-heading"[^}]*collapse="gm-wonder-guide"/);
	});

	// NOT `stonetop-readonly`: that class is the sheet-wide lock (pointer-events off every input,
	// textarea and button) and on this tab it would put out the add bar and both text fields to
	// guard three buttons.
	it("hides a section's row tools while it reads, and locks nothing else", () => {
		for (const section of ["wonderOpen", "wonderSettled"]) {
			expect(WONDER_HBS).toContain(`{{#unless stonetop.edit.${section}}} stonetop-gm-wonder-section--reading{{/unless}}`);
		}
		expect(declarations(CSS, ".stonetop-gm-wonder-section--reading .stonetop-gm-wonder-tools"))
			.toMatch(/display:\s*none/);
		const markup = WONDER_HBS.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
		expect(markup).not.toContain("stonetop-readonly");
	});

	// The second lock, and not the first: the template does not draw these buttons at all while the
	// pencil is off. But a delegated handler outlives the markup it was written against, and "the
	// button isn't there" is a claim about CSS that the mixin cannot check.
	it("refuses to file, reopen or delete while the pencils are off", async () => {
		const { host, actor, updates } = makeHost(
			[{ id: "a", question: "q" }, { id: "b", question: "q2", settled: true }],
			{ editing: false },
		);
		const root = fakeRoot();
		const open = makeRow(root, "a", "q");
		const filed = makeRow(root, "b", "q2");
		host._activateGmWonderListeners(root);

		await root.emit("click", open.settle);
		await root.emit("click", filed.reopen);
		await root.emit("click", open.remove);

		expect(updates).toHaveLength(0);
		expect(globalThis.Dialog.confirm).not.toHaveBeenCalled();
		expect(actor.system.wonders).toHaveLength(2);
		expect(host._wonderList().map(w => w.settled)).toEqual([false, true]);
	});

	// The two pencils are independent, and each governs only its own list. Which list a row is in
	// comes off the entry's own `settled` flag — the same fact the context split the two lists by.
	it("gates each list by its own pencil, not by the other's", async () => {
		const seed = () => [{ id: "a", question: "q" }, { id: "b", question: "q2", settled: true }];

		const open = makeHost(seed(), { editing: { wonderOpen: true, wonderSettled: false } });
		const openRoot = fakeRoot();
		const openRows = [makeRow(openRoot, "a", "q"), makeRow(openRoot, "b", "q2")];
		open.host._activateGmWonderListeners(openRoot);
		await openRoot.emit("click", openRows[1].reopen);   // Answered is locked: refused
		expect(open.updates).toHaveLength(0);
		await openRoot.emit("click", openRows[0].settle);   // Open is unlocked: files it
		expect(open.host._wonderList().map(w => w.settled)).toEqual([true, true]);

		const filed = makeHost(seed(), { editing: { wonderOpen: false, wonderSettled: true } });
		const filedRoot = fakeRoot();
		const filedRows = [makeRow(filedRoot, "a", "q"), makeRow(filedRoot, "b", "q2")];
		filed.host._activateGmWonderListeners(filedRoot);
		await filedRoot.emit("click", filedRows[0].settle); // Open is locked: refused
		expect(filed.updates).toHaveLength(0);
		await filedRoot.emit("click", filedRows[1].reopen); // Answered is unlocked: puts it back
		expect(filed.host._wonderList().map(w => w.settled)).toEqual([false, false]);
	});

	// Everything the tab is FOR stays live with both pencils off. This is the half of the split
	// worth pinning: a later hand tidying the gates above into one `if` at the top of the listener
	// would lock the list against being written to and nothing would say so.
	it("still adds, rewords and answers while the pencils are off", async () => {
		const { host, actor } = makeHost([{ id: "a", question: "q" }], { editing: false });
		const root = fakeRoot();
		const bar = makeAddBar(root);
		const row = makeRow(root, "a", "q");
		host._activateGmWonderListeners(root);

		bar.field.value = "a question that occurred to me just now";
		await root.emit("click", bar.button);
		row.question.value = "a better question";
		await root.emit("change", row.question);
		row.answer.value = "a hunch";
		await root.emit("change", row.answer);

		expect(actor.system.wonders[0]).toMatchObject({ question: "a better question", answer: "a hunch" });
		expect(actor.system.wonders[1].question).toBe("a question that occurred to me just now");
	});
});

// This sheet redraws on EVERY threat, hazard and site write in the world (`_wirePrepPageSync`),
// which is a redraw no blur precedes: a GM part-way through an answer when another client ticks a
// grim portent would watch the sentence vanish. So the sheet flushes the focused field first.
describe("the I wonder tab: flushing what is being typed", () => {
	/** A host whose `element` answers the focus query the way a rendered sheet's would. */
	function makeFlushHost(wonders, focusedFactory) {
		const { host, actor, updates } = makeHost(wonders);
		host.element = [{
			querySelector: sel => (sel.includes(":focus") ? focusedFactory() : null),
		}];
		return { host, actor, updates };
	}

	it("saves the answer being typed", async () => {
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		row.answer.value = "half a sentence, not yet blurred";
		const { host, actor } = makeFlushHost([{ id: "a", question: "q" }], () => row.answer);

		await host._flushGmWonderEdits();
		expect(actor.system.wonders[0].answer).toBe("half a sentence, not yet blurred");
	});

	it("saves the question being reworded", async () => {
		const root = fakeRoot();
		const row = makeRow(root, "a", "q");
		row.question.value = "a reworded question";
		const { host, actor } = makeFlushHost([{ id: "a", question: "q" }], () => row.question);

		await host._flushGmWonderEdits();
		expect(actor.system.wonders[0].question).toBe("a reworded question");
	});

	// The repaint about to happen restores the box, so this only has to decline to save it.
	it("declines to save a question emptied but not yet blurred", async () => {
		const root = fakeRoot();
		const row = makeRow(root, "a", "the real question");
		row.question.value = "  ";
		const { host, updates } = makeFlushHost([{ id: "a", question: "the real question" }], () => row.question);

		await host._flushGmWonderEdits();
		expect(updates).toHaveLength(0);
	});

	it("writes nothing when no field has focus, or when there is no sheet yet", async () => {
		const { host, updates } = makeFlushHost([{ id: "a", question: "q" }], () => null);
		await host._flushGmWonderEdits();
		expect(updates).toHaveLength(0);

		const bare = makeHost([{ id: "a", question: "q" }]);
		await expect(bare.host._flushGmWonderEdits()).resolves.toBeUndefined();
		expect(bare.updates).toHaveLength(0);
	});

	// AWAITED in both places. Un-awaited in `_render`, the repaint reads a document the write has
	// not reached, and the GM sees their own sentence replaced by the previous one.
	it("is awaited by the sheet, before the paint and before the close", () => {
		const sheet = read("module/actors/gmtoolkit/StonetopGmToolkitSheet.js");
		const render = sheet.slice(sheet.indexOf("async _render("), sheet.indexOf("async close("));
		expect(render.indexOf("await this._flushGmWonderEdits();")).toBeGreaterThan(-1);
		expect(render.indexOf("await this._flushGmWonderEdits();"))
			.toBeLessThan(render.indexOf("await super._render("));
		const close = sheet.slice(sheet.indexOf("async close("));
		expect(close).toMatch(/await this\._flushGmWonderEdits\(\);[\s\S]*return super\.close\(/);
	});

	// `change` is what fires on blur with the final value; `input` fires per keystroke, and each
	// one of those is a document update that re-renders every sheet showing this actor.
	it("saves text on change rather than on every keystroke", () => {
		expect(MIXIN_JS).toMatch(/addEventListener\("change"/);
		expect(MIXIN_JS).not.toMatch(/addEventListener\("input"/);
	});
});

// The add bar loses its contents to that same repaint, and is the one box on the tab that must not
// be SAVED out of it: a line nobody has filed yet is not a question, and filing it on a redraw the
// GM did not ask for would leave a fragment in the list under an id of its own. So it is stashed
// and put back — which is also how the caret gets home after an add, since the box it was in is
// gone by the time the write returns.
describe("the I wonder tab: the add bar across a repaint", () => {
	beforeEach(() => {
		globalThis.ui = { notifications: { error: vi.fn() } };
	});

	/** A host whose `element` is a rendered root, so both halves of the flush can find nodes. */
	function makeAddHost(wonders = []) {
		const { host, actor, updates } = makeHost(wonders);
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host.element = [root];
		host._activateGmWonderListeners(root);
		return { host, actor, updates, root, bar };
	}

	/** The repaint: new nodes, bound the way `activateListeners` binds them. */
	function repaint(host) {
		const root = fakeRoot();
		const bar = makeAddBar(root);
		host.element = [root];
		host._activateGmWonderListeners(root);
		return bar;
	}

	it("carries a half-typed question over the render and puts it back", async () => {
		const { host, bar } = makeAddHost();
		bar.field.value = "half a question, still being thought about";

		await host._flushGmWonderEdits();
		expect(repaint(host).field.value).toBe("half a question, still being thought about");
	});

	// The whole reason it is stashed and not saved.
	it("does not file it, so a repaint cannot add a fragment to the list", async () => {
		const { host, actor, updates, bar } = makeAddHost();
		bar.field.value = "half a question";

		await host._flushGmWonderEdits();
		expect(updates).toHaveLength(0);
		expect(actor.system.wonders).toHaveLength(0);
	});

	// No focus test: the GM types half a line, goes to read a threat, and leaves it sitting there
	// — which is exactly when another client's prep write redraws this sheet under it.
	it("takes it whether or not the box still has the caret", async () => {
		const { host, bar } = makeAddHost();
		bar.field.value = "typed, then left alone";
		bar.field.blur();

		await host._flushGmWonderEdits();
		expect(repaint(host).field.value).toBe("typed, then left alone");
	});

	// The filed line must NOT come back with it. The box is cleared before the write rather than
	// after, because an AppV1 re-render lands from inside `Document.update` — so a clear afterwards
	// lands on a replaced node, and a stash still holding the line puts it straight back.
	it("hands the caret to the box the add's re-render puts there, empty", async () => {
		const { host, actor, root, bar } = makeAddHost();
		bar.field.value = "why is the Forge cold?";
		await root.emit("click", bar.button);
		await host._flushGmWonderEdits();

		const fresh = repaint(host);
		expect(actor.system.wonders.map(w => w.question)).toEqual(["why is the Forge cold?"]);
		expect(fresh.field.value).toBe("");
		expect(fresh.field.focused).toBe(true);
	});

	// One-shot: every other redraw of this sheet comes from somewhere else in the world, and one
	// that stole the caret into the add bar would be worse than the problem it was fixing.
	it("claims the caret once, not on every render after it", async () => {
		const { host, root, bar } = makeAddHost();
		bar.field.value = "who else knows?";
		await root.emit("click", bar.button);

		expect(repaint(host).field.focused).toBe(true);
		expect(repaint(host).field.focused).toBe(false);
	});
});
