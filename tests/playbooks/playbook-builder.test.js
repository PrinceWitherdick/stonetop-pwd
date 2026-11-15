import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Window } from "happy-dom";
import { PlaybookBuilderDialog, loreGroupShape } from "../../module/playbooks/PlaybookBuilderDialog.js";
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

/** A new builder's blank playbook: shown to players unless the GM closes the header's eye. */
function shownBlank() {
	const bundle = emptyBundle();
	bundle.playbook.published = true;
	return bundle;
}

/** Every page and every card of a playbook, open for editing (the form's read-back sees every box). */
function everythingOpen(bundle) {
	const pb = bundle.playbook ?? {};
	return new Set([
		...["playbook", "stats", "instincts", "looks", "possessions", "moves", "advancement", "intro", "notes"].map(k => `page:${k}`),
		...(pb.backgrounds ?? []).map((_, i) => `bg:${i}`),
		...(pb.possessions?.options ?? []).map((_, i) => `pos:${i}`),
		...(pb.lore ?? []).map((_, i) => `lore:${i}`),
		...(pb.inserts ?? []).map((_, i) => `ins:${i}`),
	]);
}

function renderInto(bundle, extra = {}) {
	const fake = {
		_bundle: structuredClone(bundle), _item: null, _issues: [], _activeTab: "playbook",
		_openMoves: new Set([0, 1]), appId: 7, _bundleRev: 0,
		// Every page and card open for editing, so their text boxes are drawn to read back.
		_editing: everythingOpen(bundle), ...extra,
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
		// Shown to players is the header's eye now, not a field: it isn't in the form to read back.
		fake._bundle.playbook.published = TESTER.playbook.published;
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
		expect(back._pristineWork).toBe(JSON.stringify(shownBlank()));
	});

	it("keeps the window as it opened when the saved view doesn't read", () => {
		const back = new PlaybookBuilderDialog();
		back._takeRestoredView({ bundle: "nonsense", tab: "nowhere", openMoves: ["x"] });
		expect(back._bundle).toEqual(shownBlank());
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
		expect(builder._bundle).toEqual(shownBlank());
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
		expect(builder._pristineWork).toBe(JSON.stringify(shownBlank()));
	});

	it("asks again when the file picker is shut or the PDF doesn't come through", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		fakeFilePicker([null, { name: "scan.pdf" }]);
		const wait = answer("pdf", "pdf", "hand");
		vi.spyOn(PlaybookBuilderDialog.prototype, "_readPdf").mockResolvedValue(null);
		const builder = await startNewPlaybook();
		expect(wait).toHaveBeenCalledTimes(3);
		expect(builder._bundle).toEqual(shownBlank());
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

// A playbook the system knows (known/known-playbooks.js), read whole with nothing to check, is saved
// and announced in a small window instead of being handed over in the builder (_saveKnown).
describe("a known playbook read whole", () => {
	const KNOWN = { id: "the-tester" };
	const read = () => ({ bundle: structuredClone(TESTER), issues: [] });

	// Answers the window with the button keyed `key` (null closes it); the asked config is in mock.calls.
	function answer(key) {
		const wait = vi.fn(async config => (config.buttons?.some(b => b.action === key) ? key : null));
		vi.stubGlobal("foundry", { ...globalThis.foundry, applications: { api: { DialogV2: { wait } } } });
		return wait;
	}

	// A builder whose adopt leaves `issues` behind and whose save stands in for the world's.
	function builderLeaving(issues, { saves = true } = {}) {
		const builder = new PlaybookBuilderDialog({});
		vi.spyOn(builder, "_adopt").mockImplementation(async function (bundle) {
			this._bundle = bundle;
			this._issues = issues;
			return true;
		});
		const save = vi.spyOn(builder, "_save").mockImplementation(async function () {
			if (!saves) return false;
			this._item = { name: this._bundle.playbook.name };
			return true;
		});
		return { builder, save };
	}

	let info;
	beforeEach(() => {
		vi.spyOn(PlaybookBuilderDialog.prototype, "render").mockImplementation(function () { return this; });
		info = vi.fn();
		vi.stubGlobal("ui", { notifications: { info, warn: vi.fn(), error: vi.fn() } });
	});
	afterEach(() => { vi.restoreAllMocks(); });

	it("is saved without the builder, and the GM told what came in", async () => {
		const wait = answer("done");
		const { builder, save } = builderLeaving([]);
		expect(await builder._takeReviewed(read(), { fileName: "tester.pdf", known: KNOWN })).toBe("saved");
		expect(save).toHaveBeenCalledWith({ quiet: true });
		const asked = wait.mock.calls[0][0];
		expect(asked.window.title).toBe("The Tester is ready");
		expect(asked.content).toContain("2 moves and 1 background,");
		expect(asked.content).toContain("your players can pick it now");
		expect(asked.buttons.map(b => b.label)).toEqual(["Done", "Try character creation", "Open it in the Playbook Builder"]);
		// The window says it all: no second note about the read.
		expect(info).not.toHaveBeenCalled();
	});

	it("opens in the builder when the GM asks for it", async () => {
		answer("open");
		const { builder } = builderLeaving([]);
		expect(await builder._takeReviewed(read(), { known: KNOWN })).toBe("read");
	});

	it("walks character creation when the GM asks to try it", async () => {
		answer("try");
		const { builder } = builderLeaving([]);
		const tried = vi.spyOn(builder, "_tryIt").mockResolvedValue(undefined);
		expect(await builder._takeReviewed(read(), { known: KNOWN })).toBe("saved");
		expect(tried).toHaveBeenCalledOnce();
	});

	it("lists what changed when it updates the one this world has, notes escaped", async () => {
		const wait = answer("done");
		const { builder } = builderLeaving([{ severity: "info", message: "Since the saved version: <b>Prod</b> changed" }]);
		builder._item = { name: "The Tester" };
		await builder._takeReviewed(read(), { known: KNOWN });
		const { content } = wait.mock.calls[0][0];
		expect(content).toContain("saved over the one this world had");
		expect(content).toContain("<li>Since the saved version: &lt;b&gt;Prod&lt;/b&gt; changed</li>");
	});

	it("offers no Open button when the builder is already open", async () => {
		const wait = answer("done");
		const { builder, save } = builderLeaving([]);
		// On screen until it redraws: core counts a window that is drawing as not rendered.
		let drawing = false;
		Object.defineProperty(builder, "rendered", { get: () => !drawing });
		const render = vi.spyOn(builder, "render").mockImplementation(function () { drawing = true; return this; });
		await builder._takeReviewed(read(), { known: KNOWN });
		expect(wait.mock.calls[0][0].buttons.map(b => b.action)).toEqual(["done", "try"]);
		// Redrawn BEFORE the save: the open form still shows what was there before, and a save with no
		// redraw owed reads it back over the import (live, the blank form's empty name refused the save).
		expect(render.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
	});

	it("goes to the builder when something needs checking", async () => {
		const wait = answer("done");
		const { builder, save } = builderLeaving([{ severity: "check", message: "Some requirements name moves this playbook doesn't have." }]);
		expect(await builder._takeReviewed(read(), { known: KNOWN })).toBe("read");
		expect(save).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
		expect(info.mock.calls[0][0]).toContain("Check what's marked before you save");
	});

	it("goes to the builder when the save doesn't go through", async () => {
		const wait = answer("done");
		const { builder } = builderLeaving([], { saves: false });
		expect(await builder._takeReviewed(read(), { known: KNOWN })).toBe("read");
		expect(wait).not.toHaveBeenCalled();
	});

	it("leaves a playbook the system doesn't know to the builder", async () => {
		const wait = answer("done");
		const { builder, save } = builderLeaving([]);
		expect(await builder._takeReviewed(read(), {})).toBe("read");
		expect(save).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});

	it("opens no builder from New homebrew playbook once it's saved", async () => {
		const { startNewPlaybook } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		const input = { files: null, addEventListener: (type, fn) => { input[`on${type}`] = fn; }, click() { this.files = [{ name: "tester.pdf" }]; queueMicrotask(() => this.onchange()); } };
		vi.stubGlobal("document", { createElement: () => input });
		const wait = vi.fn(async config => config.buttons.find(b => b.action === "pdf").callback(null, { form: null }));
		vi.stubGlobal("foundry", { ...globalThis.foundry, applications: { api: { DialogV2: { wait } } } });
		vi.spyOn(PlaybookBuilderDialog.prototype, "_readPdf").mockResolvedValue("saved");
		expect(await startNewPlaybook()).toBeNull();
		expect(PlaybookBuilderDialog.prototype.render).not.toHaveBeenCalled();
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
		const { root } = renderInto(WITH_INSERT, { _openMoves: new Set([0, 1, 2, 3]) });
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

// Shown to players is an eye in the window's header, left of Close (it was a checkbox on the panel).
describe("the builder's shown-to-players eye", () => {
	// The eye saves the window for a reload (window-restore.js), which reads a setting.
	beforeEach(() => { vi.stubGlobal("game", { settings: { get: () => false }, items: Object.assign([], { get: () => null }), actors: [], user: { isGM: true } }); });
	afterEach(() => vi.unstubAllGlobals());

	function withHeader(published, item = null) {
		const window = new Window();
		window.document.body.innerHTML = `<div class="app"><header class="window-header"><a class="header-button control stonetop-pb-builder-shown"><i class="fas fa-eye"></i></a><a class="header-button control close">Close</a></header></div>`;
		const bundle = emptyBundle();
		bundle.playbook.published = published;
		const fake = { _bundle: bundle, _item: item, element: [window.document.body.firstElementChild], _readForm: vi.fn() };
		fake._drawShown = PlaybookBuilderDialog.prototype._drawShown;
		fake._pristineWork = JSON.stringify(bundle);
		return { fake, eye: window.document.querySelector(".stonetop-pb-builder-shown") };
	}

	it("sits left of Close, first among the header's buttons", () => {
		const proto = Object.getPrototypeOf(PlaybookBuilderDialog.prototype);
		const spy = vi.spyOn(proto, "_getHeaderButtons").mockReturnValue([{ class: "close", label: "Close" }]);
		try {
			const buttons = PlaybookBuilderDialog.prototype._getHeaderButtons.call({});
			expect(buttons.map(b => b.class)).toEqual(["stonetop-pb-builder-shown", "close"]);
		} finally { spy.mockRestore(); }
	});

	it("draws open when shown and shut when hidden, and says which", () => {
		const open = withHeader(true);
		open.fake._drawShown();
		expect(open.eye.querySelector("i").className).toBe("fas fa-eye");
		expect(open.eye.getAttribute("aria-pressed")).toBe("true");
		expect(open.eye.dataset.tooltip).toMatch(/^Shown to players/);
		const shut = withHeader(false);
		shut.fake._drawShown();
		expect(shut.eye.querySelector("i").className).toBe("fas fa-eye-slash");
		expect(shut.eye.classList.contains("is-hidden")).toBe(true);
		expect(shut.eye.dataset.tooltip).toMatch(/^Hidden from players/);
	});

	it("on a saved playbook, writes at once and never reads as unsaved work", async () => {
		vi.stubGlobal("ui", { notifications: { info: vi.fn(), error: vi.fn() } });
		// Foundry's setFlag refuses the "stonetop" scope (it is not the system's id), so it must not be used.
		const item = { name: "The Tester", update: vi.fn(async () => {}), setFlag: vi.fn(async () => { throw new Error("Flag scope \"stonetop\" is not valid"); }) };
		const { fake, eye } = withHeader(true, item);
		await PlaybookBuilderDialog.prototype._toggleShown.call(fake);
		expect(item.setFlag).not.toHaveBeenCalled();
		expect(item.update).toHaveBeenCalledWith({ "flags.stonetop.homebrew.published": false });
		expect(fake._bundle.playbook.published).toBe(false);
		expect(fake._pristineWork).toBe(JSON.stringify(fake._bundle));
		expect(eye.querySelector("i").className).toBe("fas fa-eye-slash");
	});

	it("on a new playbook, only changes the window, saved with the rest", async () => {
		const { fake } = withHeader(true);
		const pristine = fake._pristineWork;
		await PlaybookBuilderDialog.prototype._toggleShown.call(fake);
		expect(fake._bundle.playbook.published).toBe(false);
		expect(fake._pristineWork).toBe(pristine);
	});

	it("is not a field on the Playbook panel any more", () => {
		expect(readRepo("templates/dialogs/playbook-builder.hbs")).not.toMatch(/data-field="playbook\.published"/);
	});
});

// The Backgrounds panel draws each background as the playbook PDF prints it; its pencil opens the text boxes.
describe("the builder's backgrounds, read as the PDF prints them", () => {
	function bundleWith(bg) {
		const bundle = emptyBundle();
		bundle.playbook.backgrounds = [{ ...bundle.playbook.backgrounds?.[0], label: "Cursed", description: "You are cursed.\n\nWhen you ***defy the curse***, mark Doom.\n- once\n- twice", moves: ["Night Crawler"], moveChoice: [], possessions: [], track: { label: "Doom", max: 3 }, ...bg }];
		return bundle;
	}
	const show = (bundle, editing = []) => renderInto(bundle, { _activeTab: "backgrounds", _editing: new Set(editing.map(i => `bg:${i}`)) });

	it("draws a box and the name, the track's circles at the right, its words and what it gives, and no text boxes", () => {
		const { root } = show(bundleWith({}));
		const card = root.querySelector(".stonetop-pb-builder-bg");
		expect(card.classList.contains("is-editing")).toBe(false);
		expect(card.querySelector(".stonetop-pb-builder-read-name").textContent.trim()).toBe("□ Cursed");
		expect(card.querySelector(".stonetop-pb-builder-read-track").textContent.trim()).toBe("Doom: ○○○");
		// The trigger in bold italic, as the PDF sets it.
		expect(card.querySelector(".stonetop-pb-builder-read-desc").innerHTML).toContain("<strong><em>defy the curse</em></strong>");
		expect(card.querySelectorAll(".stonetop-pb-builder-read-desc li").length).toBe(2);
		expect(card.querySelector(".stonetop-pb-builder-read-meta").textContent).toBe("Gives: Night Crawler");
		expect(card.querySelector("input, textarea")).toBeNull();
		expect(card.querySelector("[data-action=edit-part]").dataset.part).toBe("bg:0");
	});

	it("opens its text boxes when its pencil is pressed, with a check to close them", () => {
		const { root } = show(bundleWith({}), [0]);
		const card = root.querySelector(".stonetop-pb-builder-bg");
		expect(card.classList.contains("is-editing")).toBe(true);
		expect(card.querySelector("[data-field='playbook.backgrounds.0.label']").value).toBe("Cursed");
		expect(card.querySelector("[data-action=done-part][data-part='bg:0']")).toBeTruthy();
		expect(card.querySelector("[data-action=remove-background]")).toBeTruthy();
	});

	it("opens a blank background for typing", () => {
		const { root } = show(bundleWith({ label: "", description: "" }));
		expect(root.querySelector(".stonetop-pb-builder-bg").classList.contains("is-editing")).toBe(true);
	});

	it("keeps the right ones open when one above is removed, and opens one just added", async () => {
		const fake = { _bundle: bundleWith({}), _editing: new Set(["bg:2"]), _readForm: vi.fn(), render: vi.fn() };
		fake._dropPart = PlaybookBuilderDialog.prototype._dropPart;
		fake._bundle.playbook.backgrounds.push({ ...fake._bundle.playbook.backgrounds[0], label: "B" }, { ...fake._bundle.playbook.backgrounds[0], label: "C" });
		const press = (action, index, part) => PlaybookBuilderDialog.prototype._onAction.call(fake, { preventDefault() {} }, action, { index: String(index), part });
		await press("remove-background", 0);
		expect([...fake._editing]).toEqual(["bg:1"]);
		await press("add-background");
		expect(fake._editing.has("bg:2")).toBe(true);
		await press("done-part", 0, "bg:1");
		expect(fake._editing.has("bg:1")).toBe(false);
		await press("edit-part", 0, "bg:0");
		expect(fake._editing.has("bg:0")).toBe(true);
	});
});

// A roll printed inside a background is lifted into a move of its own (homebrew-bundle.js), and the words
// say "You get the ***Moon Blessed*** move." The read view puts the move's words back where the PDF prints them.
describe("a background's own move, read in place", () => {
	it("shows the lifted move's words where its line stands, and keeps any other line as written", async () => {
		const { backgroundWordsInPlace } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		const moves = [{ name: "Moon Blessed", description: "When you ***whisper the name of a monstrous follower***, roll +CHA." }];
		const find = name => moves.find(m => m.name.toLowerCase() === name.toLowerCase());
		const text = "Gain the Child of the Night move.\n\nYou get the ***Moon Blessed*** move.\n\nNote that your followers may have instincts.";
		expect(backgroundWordsInPlace(text, find)).toBe("Gain the Child of the Night move.\n\nWhen you ***whisper the name of a monstrous follower***, roll +CHA.\n\nNote that your followers may have instincts.");
		// A move this playbook doesn't have (or one with no words) leaves the line alone.
		expect(backgroundWordsInPlace("You get the ***Bark an Order*** move.", find)).toBe("You get the ***Bark an Order*** move.");
	});

	it("draws it so on the Backgrounds page, with the move still listed under Gives", () => {
		const bundle = emptyBundle();
		bundle.playbook.backgrounds = [{ label: "Moon Blessed", description: "Those creatures comfort you.\n\nYou get the ***Moon Blessed*** move.", moves: ["Child of the Night", "Moon Blessed"], moveChoice: [], possessions: [], track: null }];
		bundle.moves = [normalizeMove({ name: "Moon Blessed", description: "When you ***whisper a name under the moon***, roll +CHA.", background: "Moon Blessed" })];
		const { root } = renderInto(bundle, { _activeTab: "backgrounds", _editing: new Set() });
		const desc = root.querySelector(".stonetop-pb-builder-read-desc").innerHTML;
		expect(desc).toContain("<strong><em>whisper a name under the moon</em></strong>");
		expect(desc).not.toContain("You get the");
		expect(root.querySelector(".stonetop-pb-builder-read-meta").textContent).toBe("Gives: Child of the Night, Moon Blessed");
	});
});

// Every page reads as the playbook PDF prints it until its pencil (or a card's) is pressed.
describe("the builder's pages, read as the PDF prints them", () => {
	const closed = { _editing: new Set(), _openMoves: new Set() };

	it("draws no text boxes on any page while nothing is open, and a pencil on each", () => {
		const { root } = renderInto(TESTER, closed);
		expect(root.querySelectorAll("[data-field], [data-lines], [data-list], [data-insert-ref]").length).toBe(0);
		for (const key of ["playbook", "stats", "instincts", "looks", "possessions", "moves", "advancement", "intro", "notes"]) {
			expect(root.querySelector(`[data-action=edit-part][data-part="page:${key}"]`), key).toBeTruthy();
		}
		expect(root.querySelectorAll("[data-action=edit-move]").length).toBe(TESTER.moves.length);
		expect(root.querySelectorAll("[data-action=edit-part][data-part^='pos:']").length).toBe(TESTER.playbook.possessions.options.length);
		expect(root.querySelectorAll("[data-action=edit-part][data-part^='lore:']").length).toBe(TESTER.playbook.lore.length);
	});

	it("loses nothing when the form is read back with every page closed", () => {
		const { fake } = renderInto(TESTER, closed);
		PlaybookBuilderDialog.prototype._readForm.call(fake);
		expect(normalizeBundle(fake._bundle).bundle).toEqual(TESTER);
	});

	it("opens one page's text boxes, and only that page's, with a check to close them", () => {
		const { root } = renderInto(TESTER, { ...closed, _editing: new Set(["page:stats"]) });
		const stats = root.querySelector("section[data-tab=stats]");
		expect(stats.querySelector("[data-field='playbook.hp']")).toBeTruthy();
		expect(stats.querySelector("[data-action=done-part][data-part='page:stats']")).toBeTruthy();
		expect(root.querySelector("section[data-tab=notes] [data-field]")).toBeNull();
	});

	it("shows the stats box, the instincts and a move as they're printed", () => {
		const { root } = renderInto(TESTER, closed);
		const stats = [...root.querySelectorAll("section[data-tab=stats] .stonetop-pb-builder-read-stats > div")].map(d => `${d.querySelector(".stonetop-pb-builder-read-stat-label").textContent}: ${d.querySelector(".stonetop-pb-builder-read-stat-value").textContent}`);
		expect(stats).toEqual([`Damage: ${TESTER.playbook.damage}`, `Max HP: ${TESTER.playbook.hp}`]);
		const firstInstinct = TESTER.playbook.instincts[0];
		expect(root.querySelector("section[data-tab=instincts] .stonetop-pb-builder-read-item-name").textContent.trim()).toBe(`□ ${firstInstinct.word}`);
		const move = root.querySelector(".stonetop-pb-builder-move-read .stonetop-pb-builder-read-name").textContent.trim();
		expect(move).toMatch(new RegExp(`^[□☑] ${TESTER.moves[0].name}$`));
	});

	it("opens a blank card for typing, and a page with nothing on it", () => {
		const bundle = structuredClone(TESTER);
		bundle.playbook.possessions.options.push({ label: "", description: "", preselected: false });
		bundle.playbook.instincts = [];
		const { root } = renderInto(bundle, closed);
		const last = bundle.playbook.possessions.options.length - 1;
		expect(root.querySelector(`[data-field='playbook.possessions.options.${last}.label']`)).toBeTruthy();
		expect(root.querySelector("section[data-tab=instincts] [data-lines='playbook.instincts']")).toBeTruthy();
	});

	it("frames a question heading with the questions under it, up to the next heading", () => {
		const q = t => ({ title: t, description: "(choose 1)", options: [{ description: "yes", max: 1 }] });
		const h = t => ({ title: t, description: "", options: [] });
		const bundle = structuredClone(TESTER);
		bundle.playbook.lore = [q("Loose"), h("Belonging"), q("When you were young"), q("How did you arrive"), h("Alone")];
		const { root } = renderInto(bundle, closed);
		const groups = [...root.querySelectorAll("section[data-tab=lore] .stonetop-pb-builder-lore-group")];
		const names = g => [...g.querySelectorAll(".stonetop-pb-builder-read-name")].map(n => n.textContent.trim());
		expect(groups.map(names)).toEqual([["Belonging", "When you were young", "How did you arrive"], ["Alone"]]);
		// A question before any heading stands on its own.
		expect(root.querySelector("section[data-tab=lore] > .stonetop-pb-builder-card .stonetop-pb-builder-read-name").textContent.trim()).toBe("Loose");
		expect(loreGroupShape(bundle.playbook.lore, 0)).toEqual({ groupStart: false, groupEnd: false });
	});
});
