import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { PlaybookBuilderDialog } from "../../module/playbooks/PlaybookBuilderDialog.js";
import { normalizeBundle, normalizeMove, emptyBundle } from "../../module/playbooks/homebrew-bundle.js";
import { invalidatePlaybookCatalog } from "../../module/playbooks/playbook-catalog.js";
import { rosterHandlebars } from "../fakes/hbs.js";
import { readRepo } from "../fakes/css.js";

const SOURCE = readRepo("templates/dialogs/playbook-builder.hbs");

// An original test playbook touching every panel.
const TESTER = normalizeBundle({
	format: "stonetop-homebrew-playbook",
	version: 1,
	playbook: {
		name: "The Tester", published: true, summary: "Pokes at things.", complexity: "Low",
		description: "Every village needs someone who asks why.", notes: "Swap playbooks at level 3.",
		statsNote: "Assign these scores: +1, +1, +1, +0, +0, -1", hp: 18, damage: "d8", instinctLabel: "Drive",
		backgrounds: [{ label: "The Prober", description: "You test the ice.\n\n- carefully\n- twice", moves: ["Prod"], moveChoice: ["Frosty", "Poke"] }],
		instincts: [{ word: "Curiosity", description: "To find out." }, { word: "Caution", description: "" }],
		appearance: [["young", "old"], ["quiet", "loud"]],
		origin: [{ region: "Stonetop", names: ["Ade", "Bryn"] }, { region: "Gordin's Delve", names: [] }],
		possessions: { pickCount: 1, pickNote: "Pick 1", options: [{ label: "Tester's kit", description: "levers, a mallet", preselected: true }] },
		startingMovesNote: "You start with Prod and 1 of your choice.",
		moveChoices: [{ label: "Choose one", options: ["Prod", "Poke"] }],
		moveGroups: [{ label: "Poking", moves: ["Prod", "Poke"] }],
		lore: [{ title: "Belonging", description: "When you were young they... (choose 1 or 2)", options: [{ description: "... ignored you", max: 1 }, { description: "Who?", freeText: true }, { description: "lost", max: 2 }] }],
		introductions: { step3: "what you broke", step4: ["Who mended it?"], step6: ["Which of you laughed?", "Who cried?"] },
	},
	moves: [
		{ name: "Poke", description: "Gently.", level: 6, requires: "Requires level 6+ and Prod", requiresMoves: ["Prod"], repeatMax: 3 },
		{ name: "Prod", starting: true, description: "When you ***prod***, roll +INT:\n- it creaks", rollType: "int", results: { success: "It breaks.", partial: "It wobbles.", failure: "It bites." }, resource: { max: 3, title: "Doubt", labels: ["a", "b", "c"] } },
	],
}).bundle;

function renderInto(bundle, extra = {}) {
	const fake = {
		_bundle: structuredClone(bundle), _item: null, _issues: [], _activeTab: "playbook",
		_openMoves: new Set([0, 1]), appId: 7, _bundleRev: 0, ...extra,
	};
	// Whether the form on screen shows the bundle as it is: the builder's own getter (_readForm reads it).
	Object.defineProperty(fake, "_formIsCurrent", Object.getOwnPropertyDescriptor(PlaybookBuilderDialog.prototype, "_formIsCurrent"));
	const html = rosterHandlebars().compile(SOURCE)(PlaybookBuilderDialog.prototype.getData.call(fake));
	// Drawn, as activateListeners marks it.
	fake._formRev = fake._drawingRev;
	const window = new Window();
	window.document.body.innerHTML = html;
	// happy-dom quirk: options written back to back with `selected` on the third report the
	// SECOND as chosen (a browser picks the third). Re-assert the attribute so the test reads
	// what a browser would.
	for (const select of window.document.querySelectorAll("select")) {
		const chosen = [...select.options].findIndex(o => o.hasAttribute("selected"));
		if (chosen >= 0) select.selectedIndex = chosen;
	}
	fake.element = [window.document.body];
	return { fake, root: window.document.body };
}

beforeEach(() => {
	invalidatePlaybookCatalog();
	vi.stubGlobal("game", { items: Object.assign([], { get: () => null }), actors: [], user: { isGM: true } });
});
afterEach(() => { vi.unstubAllGlobals(); invalidatePlaybookCatalog(); });

describe("the Playbook Builder's form", () => {
	it("isn't read back while a redraw is owed, so a re-sorted or replaced playbook keeps its own words", () => {
		const { fake, root } = renderInto(TESTER);
		const first = fake._bundle.moves[0].name;
		root.querySelector("[data-field='moves.0.name']").value = "Typed Over";
		// A save re-reads the playbook (its moves re-sorted) and asks for a redraw; until it draws, the
		// old form's "moves.0.*" belong to another move.
		fake._bundle = structuredClone(TESTER);
		fake._bundle.moves.reverse();
		fake._bundleRev++;
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(fake._bundle.moves.at(-1).name).toBe(first);
		expect(fake._bundle.moves.map(m => m.name)).not.toContain("Typed Over");
		// Drawn again, the form reads back as usual.
		PlaybookBuilderDialog.prototype.getData.call(fake);
		fake._formRev = fake._drawingRev;
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(fake._bundle.moves[0].name).toBe("Typed Over");
	});

	it("keeps only this reading for a later import to merge over: a library pick after a PDF keeps none", async () => {
		const app = new PlaybookBuilderDialog();
		const named = name => { const b = structuredClone(TESTER); b.playbook.name = name; return b; };
		await app._adopt(named("The Read One"), { source: "pdf" });
		expect(app._importBase.playbook.name).toBe("The Read One");
		await app._adopt(named("From The Library"), { source: "library" });
		expect(app._importBase).toBeNull();
	});

	it("draws once more when a render asked for mid-draw was dropped", async () => {
		const app = new PlaybookBuilderDialog();
		const renders = [];
		app.render = function (force) { renders.push(force); };
		Object.defineProperty(app, "rendered", { get: () => true });
		// Core's _render, standing in: the bundle changes after this draw's getData read it.
		const proto = Object.getPrototypeOf(PlaybookBuilderDialog.prototype);
		const real = proto._render;
		proto._render = async function () { this._drawingRev = this._bundleRev; this._bundleRev++; this._formRev = this._drawingRev; };
		try { await PlaybookBuilderDialog.prototype._render.call(app, false, {}); }
		finally { proto._render = real; }
		expect(renders).toEqual([false]);
	});

	it("reads back exactly the playbook it was drawn from", () => {
		const { fake } = renderInto(TESTER);
		fake._bundle = emptyBundle();
		fake._bundle.moves = TESTER.moves.map(() => ({}));
		fake._bundle.playbook.backgrounds = TESTER.playbook.backgrounds.map(() => ({}));
		fake._bundle.playbook.possessions.options = TESTER.playbook.possessions.options.map(() => ({}));
		fake._bundle.playbook.lore = TESTER.playbook.lore.map(() => ({}));
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle).toEqual(TESTER);
	});

	it("an edit in a field lands at its path, and a track with no boxes is no track", () => {
		const { fake, root } = renderInto(TESTER);
		root.querySelector("[data-field='moves.1.name']").value = "Prod Harder";
		root.querySelector("[data-resource='1'] [name=resourceMax]").value = "0";
		root.querySelector("[data-lines='playbook.instincts']").value = "Boldness: To leap.";
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(fake._bundle.moves[1].name).toBe("Prod Harder");
		expect(fake._bundle.moves[1].resource).toBeNull();
		expect(fake._bundle.playbook.instincts).toEqual([{ word: "Boldness", description: "To leap." }]);
	});

	it("a save keeps what a miss holds, beside the 10+ and 7-9 boxes", () => {
		const fear = structuredClone(TESTER);
		fear.moves[1] = normalizeMove({
			...fear.moves[1], description: "When you ***prod***, roll +INT. On a 10+, hold 3 Fear. On a miss, hold 1 Fear.",
			resource: { max: 3, title: "Fear", labels: [] },
		});
		expect(fear.moves[1].resource.holdOnRoll).toEqual({ success: 3, failure: 1 });
		const { fake, root } = renderInto(fear);
		expect(root.querySelector("[data-resource='1'] [name=holdFailure]").value).toBe("1");
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle.moves[1].resource.holdOnRoll).toEqual({ success: 3, failure: 1 });
	});

	it("names a Drive playbook's panel Drives, and flags a background move from outside the playbook", () => {
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: TESTER, _item: null, _issues: [], _activeTab: "instincts", _openMoves: new Set(), appId: 1 });
		expect(data.active.title).toBe("Drives");
		expect(data.backgrounds[0].foreign).toBe("Frosty");
	});

	it("flags a stats note that doesn't hand out six scores, and an unusual HP", () => {
		const odd = structuredClone(TESTER);
		odd.playbook.statsNote = "Assign +2, +1, +1";
		odd.playbook.hp = 30;
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: odd, _item: null, _issues: [], _activeTab: "stats", _openMoves: new Set(), appId: 1 });
		expect(data.statFlag).toMatch(/exactly six scores/);
		expect(data.hpFlag).toMatch(/between 10 and 24/);
	});

	it("shows what an import reported, on the first panel", () => {
		const { root } = renderInto(TESTER, { _issues: [{ severity: "check", message: "Max HP 160 is more than 40" }] });
		expect(root.querySelector(".stonetop-pb-builder-report")?.textContent).toContain("Max HP 160");
	});
});

// A reload brings the builder back with every field typed in it (playbook-builder-restore.js, by
// way of utils/window-restore.js): a playbook is an evening's typing, and it lives only in the
// window until Save.
describe("the builder across a reload", () => {
	it("is restored under the class name its hooks are built from", async () => {
		const { PLAYBOOK_BUILDER_WINDOW_CLASS } = await import("../../module/playbooks/playbook-builder-restore.js");
		expect(PlaybookBuilderDialog.name).toBe(PLAYBOOK_BUILDER_WINDOW_CLASS);
	});

	it("is saved under its draft id while new, and under its Item once saved", () => {
		const d = new PlaybookBuilderDialog({ draftId: "abc123" });
		expect(d.restoreKey).toBe("playbookBuilder:new-abc123");
		expect(new PlaybookBuilderDialog().restoreKey).not.toBe(new PlaybookBuilderDialog().restoreKey);
		d._item = { uuid: "Item.pb1" };
		expect(d.restoreKey).toBe("playbookBuilder:Item.pb1");
	});

	it("comes back with the playbook as typed, on the panel it was left on, still unsaved", () => {
		const { fake, root } = renderInto(emptyBundle());
		const left = Object.assign(new PlaybookBuilderDialog(), { element: fake.element });
		left._formRev = left._bundleRev; // its form is drawn
		root.querySelector("[data-field='playbook.name']").value = "The Lantern";
		left._activeTab = "moves";
		left._openMoves = new Set([0]);
		left._source = "pdf";
		const view = JSON.parse(JSON.stringify(left.restoreView));

		const back = new PlaybookBuilderDialog({ draftId: "abc123" });
		back._takeRestoredView(view);
		expect(back._bundle.playbook.name).toBe("The Lantern");
		expect(back._activeTab).toBe("moves");
		expect([...back._openMoves]).toEqual([0]);
		expect(back._source).toBe("pdf");
		// Closing still asks: what came back through the reload was never saved.
		expect(back._pristineWork).toBe(JSON.stringify(emptyBundle()));
	});

	it("keeps the window as it opened when the saved view doesn't read", () => {
		const back = new PlaybookBuilderDialog();
		back._takeRestoredView({ bundle: "nonsense", tab: "nowhere", openMoves: ["x"] });
		expect(back._bundle).toEqual(emptyBundle());
		expect(back._activeTab).toBe("playbook");
		expect([...back._openMoves]).toEqual([]);
	});

	it("reopens for a GM only, a new playbook under the draft id it had", async () => {
		const { reopenPlaybookBuilder } = await import("../../module/playbooks/playbook-builder-restore.js");
		const app = await reopenPlaybookBuilder("playbookBuilder:new-abc123");
		expect(app).toBeInstanceOf(PlaybookBuilderDialog);
		expect(app.restoreKey).toBe("playbookBuilder:new-abc123");
		expect(await reopenPlaybookBuilder("camp:new-abc123")).toBeNull();
		game.user.isGM = false;
		expect(await reopenPlaybookBuilder("playbookBuilder:new-abc123")).toBeNull();
	});

	it("brings one whose Item has gone back as a new playbook, not as nothing", async () => {
		vi.stubGlobal("fromUuid", async () => null);
		const { reopenPlaybookBuilder } = await import("../../module/playbooks/playbook-builder-restore.js");
		const app = await reopenPlaybookBuilder("playbookBuilder:Item.gone");
		expect(app).toBeInstanceOf(PlaybookBuilderDialog);
		expect(app._item).toBeNull();
	});
});

// A new playbook starts with "Read it from a PDF" or "Fill it in by hand" (startNewPlaybook), and
// the builder opens after the answer.
describe("starting a new playbook", () => {
	// A file picker that, when the PDF answer opens it, picks `file` (or is shut, for null).
	function fakeFilePicker(files) {
		const queue = [...files];
		vi.stubGlobal("document", {
			createElement: () => {
				const on = {};
				return {
					files: null,
					addEventListener: (type, fn) => { on[type] = fn; },
					click() {
						const file = queue.shift() ?? null;
						this.files = file ? [file] : [];
						queueMicrotask(() => (file ? on.change : on.cancel)?.());
					},
				};
			},
		});
	}

	// Answers each question in turn with the button keyed there (null closes it).
	function answer(...keys) {
		const queue = [...keys];
		const wait = vi.fn(async config => {
			const key = queue.shift() ?? null;
			const button = config.buttons?.find(b => b.action === key);
			if (!button) return null;
			return button.callback ? button.callback(null, { form: null }) : key;
		});
		vi.stubGlobal("foundry", { ...globalThis.foundry, applications: { api: { DialogV2: { wait } } } });
		return wait;
	}

	beforeEach(() => {
		vi.spyOn(PlaybookBuilderDialog.prototype, "render").mockImplementation(function () { return this; });
	});
	afterEach(() => { vi.restoreAllMocks(); });

	it("asks first, and opens a blank builder for the hand-typed one", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		fakeFilePicker([]);
		const wait = answer("hand");
		const builder = await startNewPlaybook();
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Read it from a PDF…", "Fill it in by hand"]);
		expect(builder).toBeInstanceOf(PlaybookBuilderDialog);
		expect(builder._bundle).toEqual(emptyBundle());
	});

	it("opens nothing when the question is closed", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		fakeFilePicker([]);
		answer(null);
		expect(await startNewPlaybook()).toBeNull();
		expect(PlaybookBuilderDialog.prototype.render).not.toHaveBeenCalled();
	});

	it("opens the builder holding the PDF's playbook, which still counts as unsaved", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		const pdf = { name: "lantern.pdf" };
		fakeFilePicker([pdf]);
		answer("pdf");
		const read = vi.spyOn(PlaybookBuilderDialog.prototype, "_readPdf").mockImplementation(async function () {
			this._bundle = structuredClone(TESTER);
			return "read";
		});
		const builder = await startNewPlaybook();
		expect(read.mock.calls[0][0].files).toEqual([pdf]);
		expect(builder._bundle.playbook.name).toBe("The Tester");
		expect(builder._pristineWork).toBe(JSON.stringify(emptyBundle()));
	});

	it("asks again when the file picker is shut or the PDF doesn't come through", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		fakeFilePicker([null, { name: "scan.pdf" }]);
		const wait = answer("pdf", "pdf", "hand");
		vi.spyOn(PlaybookBuilderDialog.prototype, "_readPdf").mockResolvedValue(null);
		const builder = await startNewPlaybook();
		expect(wait).toHaveBeenCalledTimes(3);
		expect(builder._bundle).toEqual(emptyBundle());
	});

	it("opens a blank builder when a PDF with no text is to be typed in by hand", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		fakeFilePicker([{ name: "scan.pdf" }]);
		const wait = answer("pdf");
		vi.spyOn(PlaybookBuilderDialog.prototype, "_readPdf").mockResolvedValue("by-hand");
		expect(await startNewPlaybook()).toBeInstanceOf(PlaybookBuilderDialog);
		expect(wait).toHaveBeenCalledOnce();
	});

	it("is the GM's alone", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		game.user.isGM = false;
		vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
		const wait = answer("hand");
		expect(await startNewPlaybook()).toBeNull();
		expect(wait).not.toHaveBeenCalled();
	});
});

describe("the builder's inserts", () => {
	// The Tester with an insert of its own: a list to tick, a moves list, an always-held move.
	const WITH_INSERT = normalizeBundle({
		...structuredClone(TESTER),
		playbook: {
			...structuredClone(TESTER.playbook),
			inserts: [{
				key: "toolbox", name: "Tester's Toolbox", description: "The tools inside you.", unlockedBy: "Prod",
				form: { enabled: true, on: "Unfold", off: "Fold up" },
				lists: [
					{ key: "gadgets", title: "Gadgets", prompt: "pick 2", pick: 2, min: 1, bonusPicks: [{ move: "Whirr", count: 1 }], options: [
						{ description: "Spring Fist: d6+1 (close, forceful)" }, { description: "humming", preselected: true }, { description: "Something else", freeText: true },
					] },
					{ key: "tricks", title: "Tricks", prompt: "pick 1", kind: "moves", pick: 1, perUnlock: 1 },
				],
			}],
		},
		moves: [
			...structuredClone(TESTER.moves),
			{ name: "Unfold", insert: "toolbox", starting: true, description: "Out they come." },
			{ name: "Whirr", insert: "toolbox", insertList: "tricks", description: "Choose 1 additional gadget." },
		],
	}).bundle;

	it("reads back exactly the inserts it was drawn from", () => {
		const { fake } = renderInto(WITH_INSERT, { _activeTab: "inserts", _openMoves: new Set([0, 1, 2, 3]) });
		const blank = structuredClone(WITH_INSERT);
		for (const m of blank.moves) { m.insert = ""; m.insertList = ""; }
		blank.playbook.inserts[0].lists[0].options = [];
		blank.playbook.inserts[0].lists[0].bonusPicks = [];
		blank.playbook.inserts[0].unlockedBy = "";
		fake._bundle = blank;
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle).toEqual(WITH_INSERT);
	});

	it("offers each move a place: the playbook, the insert, or its moves list", () => {
		const { root } = renderInto(WITH_INSERT);
		const whirr = root.querySelector("[data-insert-ref='3']");
		expect([...whirr.options].map(o => o.value)).toEqual(["", "toolbox::", "toolbox::tricks"]);
		expect(whirr.value).toBe("toolbox::tricks");
		// The opening move is picked from the playbook's own moves only.
		const opener = root.querySelector("[data-field='playbook.inserts.0.unlockedBy']");
		expect([...opener.options].map(o => o.value)).toEqual(["", "Poke", "Prod"]);
		expect(opener.value).toBe("Prod");
	});

	it("counts the insert's moves apart from the playbook's starting moves", () => {
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: WITH_INSERT, _item: null, _issues: [], _activeTab: "moves", _openMoves: new Set(), appId: 1 });
		expect(data.startingCount).toBe(1);
		expect(data.insertMoveCount).toBe(2);
		expect(data.inserts[0].lists[1]).toMatchObject({ isMoves: true, moveNames: "Whirr" });
		expect(data.inserts[0].looseMoves).toBe("Unfold (always held)");
	});

	it("flags an insert its own move opens, and one with no lists", () => {
		const bad = structuredClone(WITH_INSERT);
		bad.playbook.inserts[0].unlockedBy = "Whirr";
		bad.playbook.inserts.push({ key: "empty", name: "Empty", description: "", unlockedBy: "", form: { enabled: false, on: "", off: "" }, lists: [] });
		const data = PlaybookBuilderDialog.prototype.getData.call({ _bundle: bad, _item: null, _issues: [], _activeTab: "inserts", _openMoves: new Set(), appId: 1 });
		expect(data.inserts[0].flags.join()).toMatch(/one of this insert's own moves/);
		expect(data.inserts[1].flags).toContain("It has no lists yet.");
	});

	it("removing an insert or a list keeps its moves, as the playbook's own", async () => {
		const { fake } = renderInto(WITH_INSERT);
		Object.setPrototypeOf(fake, PlaybookBuilderDialog.prototype);
		fake.render = vi.fn();
		const ev = { preventDefault() {} };
		await PlaybookBuilderDialog.prototype._onAction.call(fake, ev, "remove-insert-list", { index: "0", listIndex: "1" });
		expect(fake._bundle.moves.find(m => m.name === "Whirr")).toMatchObject({ insert: "toolbox", insertList: "" });
		await PlaybookBuilderDialog.prototype._onAction.call(fake, ev, "remove-insert", { index: "0" });
		expect(fake._bundle.playbook.inserts).toEqual([]);
		expect(fake._bundle.moves.filter(m => m.insert)).toEqual([]);
		expect(fake._bundle.moves.map(m => m.name)).toContain("Whirr");
	});

	it("adds an insert and a list with fresh keys", async () => {
		const { fake } = renderInto(WITH_INSERT);
		Object.setPrototypeOf(fake, PlaybookBuilderDialog.prototype);
		fake.render = vi.fn();
		const ev = { preventDefault() {} };
		await PlaybookBuilderDialog.prototype._onAction.call(fake, ev, "add-insert", {});
		await PlaybookBuilderDialog.prototype._onAction.call(fake, ev, "add-insert-list", { index: "1" });
		await PlaybookBuilderDialog.prototype._onAction.call(fake, ev, "add-insert-list", { index: "1" });
		expect(fake._bundle.playbook.inserts[1].key).toBe("insert-1");
		expect(fake._bundle.playbook.inserts[1].lists.map(l => l.key)).toEqual(["list-1", "list-2"]);
	});
});
