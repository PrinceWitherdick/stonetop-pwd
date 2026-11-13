import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Window } from "happy-dom";
import { readPlaybook, assemblePlaybook, BLOCK_KINDS, INSERT_ALWAYS, INSERT_NONE } from "../../module/playbooks/pdf/read-playbook.js";
import { PlaybookImportReview, splitParagraphs, openingWords } from "../../module/playbooks/PlaybookImportReview.js";
import { tester } from "../fakes/tester-playbook-pdf.js";
import { rosterHandlebars } from "../fakes/hbs.js";
import { readRepo } from "../fakes/css.js";

// Most of these tests are older than inserts, and read the Toolbox beside the inventory as pieces
// of the playbook: what answering "It's not an insert" does. `keepInsert` leaves the question open.
const freshDraft = ({ keepInsert = false, ...opts } = {}) => {
	const draft = readPlaybook(tester(opts)).draft;
	if (!keepInsert) for (const c of draft.confirm) if (c.insert) c.value = INSERT_NONE;
	return draft;
};
const block = (draft, title) => draft.blocks.find(b => b.title === title);
const moveNames = bundle => bundle.moves.map(m => m.name);

afterEach(() => vi.unstubAllGlobals());

describe("the draft: every piece is a movable block", () => {
	it("marks what it read with confidence, and what it guessed at, with why", () => {
		const draft = freshDraft();
		expect(block(draft, "Prod")).toMatchObject({ kind: "startingMove", unsure: false });
		expect(block(draft, "The Prober")).toMatchObject({ kind: "background", unsure: false });
		const tinker = block(draft, "Tinker");
		expect(tinker).toMatchObject({ kind: "move", unsure: true, from: "Tester's Toolbox (page 3)" });
		expect(tinker.why).toMatch(/isn't sure "Tester's Toolbox" is an insert/);
		expect(draft.blocks.filter(b => b.title === "Belonging").every(b => b.kind === "question" && b.unsure)).toBe(true);
	});

	it("hands back the draft alone, which assembles as read", () => {
		const read = readPlaybook(tester());
		expect(read).not.toHaveProperty("bundle");
		expect(assemblePlaybook(read.draft).bundle.playbook.name).toBeTruthy();
	});
});

describe("moving a block rebuilds it as its new kind", () => {
	it("a move becomes a question, its bullets the options", () => {
		const draft = freshDraft();
		block(draft, "Prod and Poke").kind = "question";
		const { bundle } = assemblePlaybook(draft);
		expect(moveNames(bundle)).not.toContain("Prod and Poke");
		const q = bundle.playbook.lore.find(l => l.title === "Prod and Poke");
		expect(q.options.map(o => o.description)).toEqual(["Ask a question", "Take a step back"]);
		expect(q.description).toMatch(/Requires level 6\+ and Prod/);
	});

	it("a question becomes a note, its options kept as bullets", () => {
		const draft = freshDraft();
		draft.blocks.filter(b => b.extra?.group === "Belonging").forEach(b => { b.kind = "note"; });
		const { bundle } = assemblePlaybook(draft);
		// Every question gone from it, so no "Belonging" heading is left standing over nothing.
		expect(bundle.playbook.lore).toEqual([]);
		expect(bundle.playbook.notes).toContain("Belonging:\nWhen you were young they … (choose 1 or 2)\n\n- … ignored you\n- … doted on you\n- Something else (write in)");
	});

	it("an insert's move becomes a starting move, or is left out", () => {
		const draft = freshDraft();
		block(draft, "Tinker").kind = "startingMove";
		block(draft, "Mend").kind = "skip";
		const { bundle } = assemblePlaybook(draft);
		expect(bundle.moves.find(m => m.name === "Tinker")).toMatchObject({ starting: true, rollType: "int" });
		expect(moveNames(bundle)).not.toContain("Mend");
	});

	it("a possession becomes a background, and a background a note", () => {
		const draft = freshDraft();
		block(draft, "Notebook").kind = "background";
		block(draft, "The Borrower").kind = "note";
		const { bundle } = assemblePlaybook(draft);
		expect(bundle.playbook.backgrounds.map(b => b.label)).toEqual(["The Prober", "Notebook"]);
		expect(bundle.playbook.notes).toMatch(/^The Borrower:\nYou learned from others/m);
	});

	it("every kind the review offers can be assembled", () => {
		for (const { kind } of BLOCK_KINDS) {
			const draft = freshDraft();
			draft.blocks.forEach(b => { b.kind = kind; });
			expect(() => assemblePlaybook(draft)).not.toThrow();
		}
	});
});

describe("the review window", () => {
	function render(draft, extra = {}) {
		const view = { _draft: draft, _fileName: "tester.pdf", _issues: [], _open: new Set(), ...extra };
		Object.setPrototypeOf(view, PlaybookImportReview.prototype);
		const data = PlaybookImportReview.prototype.getData.call(view);
		const window = new Window();
		window.document.body.innerHTML = rosterHandlebars().compile(readRepo("templates/dialogs/playbook-import-review.hbs"))(data);
		// happy-dom misreads `selected` on a later option written back to back (a browser doesn't):
		// re-assert it, so the test reads what a browser would.
		for (const select of window.document.querySelectorAll("select")) {
			const chosen = [...select.options].findIndex(o => o.hasAttribute("selected"));
			if (chosen >= 0) select.selectedIndex = chosen;
		}
		return { view, data, root: window.document.body };
	}

	it("lays the playbook out by section, unsure pieces marked, each with a Belongs in list", () => {
		const draft = freshDraft();
		const { data, root } = render(draft);
		expect(data.groups.map(g => g.kind)).toEqual(["background", "instinct", "possession", "startingMove", "move", "question", "note"]);
		expect(data.unsureCount).toBeGreaterThan(0);
		expect(root.querySelectorAll(".stonetop-pb-review-block.is-unsure").length).toBe(data.unsureCount);
		expect(root.querySelectorAll("select[data-block]").length).toBe(draft.blocks.length);
		const tinker = root.querySelector(`[data-id="${block(draft, "Tinker").id}"]`);
		expect(tinker.classList.contains("is-unsure")).toBe(true);
		expect(tinker.closest("[data-kind]").dataset.kind).toBe("move");
		expect(tinker.querySelector("select").value).toBe("move");
		expect(tinker.querySelector(".stonetop-pb-review-why").textContent).toMatch(/Tester's Toolbox/);
	});

	it("splits into rail pages: Start here, then one per section, gold where a piece is hard to place", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const { data, root } = render(draft);
		expect(data.tabs.map(t => t.key)).toEqual(["overview", ...data.groups.map(g => g.kind)]);
		expect(data.tabs[0]).toMatchObject({ title: "Start here", count: 1, unsure: true, selected: true });
		for (const g of data.groups) {
			const tab = data.tabs.find(t => t.key === g.kind);
			expect(tab.count).toBe(g.count);
			expect(!!tab.unsure).toBe(g.blocks.some(b => b.unsure));
		}
		const move = root.querySelector('.stonetop-pb-review-tab[data-tab="move"]').closest("li");
		expect(move.classList.contains("is-unsure")).toBe(true);
		// Only Start here shows; every section is still in the DOM behind its own page.
		const shown = [...root.querySelectorAll(".stonetop-pb-review-panel")].filter(p => !p.hidden).map(p => p.dataset.tab);
		expect(shown).toEqual(["overview"]);
		expect(root.querySelector('.stonetop-pb-review-panel[data-tab="move"] [data-kind="move"]')).toBeTruthy();
	});

	it("keeps the page it was on across a re-render, and falls back when that page empties", () => {
		const draft = freshDraft();
		const { view, root } = render(draft, { _activeTab: "move" });
		expect([...root.querySelectorAll(".stonetop-pb-review-panel")].filter(p => !p.hidden).map(p => p.dataset.tab)).toEqual(["move"]);
		draft.blocks.filter(b => b.kind === "move").forEach(b => { b.kind = "skip"; });
		const data = PlaybookImportReview.prototype.getData.call(view);
		expect(view._activeTab).toBe("overview");
		expect(data.overviewSelected).toBe(true);
	});

	it("drops Start here's open-question count as the questions are answered", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const { view, root } = render(draft);
		const tab = () => root.querySelector('.stonetop-pb-review-tab[data-tab="overview"]');
		expect(tab().querySelector(".stonetop-guide-toc-count").textContent).toBe("1");
		root.querySelector('input[type=radio][data-confirm="hp"][value="10"]').checked = true;
		PlaybookImportReview.prototype._readConfirm.call(view, root, "hp");
		expect(tab().querySelector(".stonetop-guide-toc-count")).toBeNull();
		expect(tab().closest("li").classList.contains("is-unsure")).toBe(false);
	});

	it("shows Start here when Finish in the builder finds a question unanswered", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const { view, root } = render(draft, { _activeTab: "move" });
		vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
		view._resolveWith = vi.fn();
		PlaybookImportReview.prototype._finish.call(view, root);
		expect(view._activeTab).toBe("overview");
		expect(root.querySelector('.stonetop-pb-review-panel[data-tab="overview"]').hidden).toBe(false);
		expect(root.querySelector('.stonetop-pb-review-panel[data-tab="move"]').hidden).toBe(true);
	});

	it("offers to move every hard-to-place piece from one part of the PDF at once", () => {
		const { data } = render(freshDraft());
		const toolbox = data.sources.find(s => s.from === "Tester's Toolbox (page 3)");
		expect(toolbox.count).toBe(3); // its opening note and two moves
	});

	it("asks for the HP with no answer picked, and won't finish until it is answered", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const { view, root } = render(draft);
		const radios = [...root.querySelectorAll('input[type=radio][data-confirm="hp"]')];
		expect(radios.map(r => r.value)).toEqual(["16", "10", "__other"]);
		expect(radios.some(r => r.checked)).toBe(false);

		const warn = vi.fn();
		vi.stubGlobal("ui", { notifications: { warn } });
		view._resolveWith = vi.fn();
		PlaybookImportReview.prototype._finish.call(view, root);
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Max HP/));
		expect(view._resolveWith).not.toHaveBeenCalled();

		radios[1].checked = true;
		PlaybookImportReview.prototype._finish.call(view, root);
		expect(view._resolveWith).toHaveBeenCalledTimes(1);
		expect(view._resolveWith.mock.calls[0][0].bundle.playbook.hp).toBe(10);
	});

	it("takes another number for the HP", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const { view, root } = render(draft);
		root.querySelector('input[type=radio][data-confirm="hp"][value="__other"]').checked = true;
		root.querySelector('input[data-confirm-other="hp"]').value = "14";
		view._resolveWith = vi.fn();
		vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
		PlaybookImportReview.prototype._finish.call(view, root);
		expect(view._resolveWith.mock.calls[0][0].bundle.playbook.hp).toBe(14);
	});
});

describe("splitting, joining and starting over", () => {
	function review(draft) {
		const view = Object.create(PlaybookImportReview.prototype);
		Object.assign(view, { _draft: draft, _fileName: "t.pdf", _issues: [], _open: new Set(), _original: structuredClone({ blocks: draft.blocks, confirm: draft.confirm }) });
		return view;
	}

	it("splits a piece at its paragraphs, naming each new piece by its opening words", () => {
		const draft = freshDraft();
		const note = draft.add("note", { title: "Special possessions", text: "The tools of your station, whatever they are.\n\nSomething personal, a trinket.\n\nSomething useful." });
		review(draft).splitBlock(note.id);
		const pieces = draft.blocks.filter(b => b.id.startsWith(note.id));
		expect(pieces.map(b => [b.title, b.text])).toEqual([
			["Special possessions", "The tools of your station, whatever they are."],
			["Something personal", "Something personal, a trinket."],
			["Something useful", "Something useful."],
		]);
		pieces.slice(1).forEach(b => { b.kind = "possession"; });
		expect(assemblePlaybook(draft).bundle.playbook.possessions.options.map(o => o.label)).toEqual(expect.arrayContaining(["Something personal", "Something useful"]));
	});

	it("a second split never reuses an id an earlier split gave out", () => {
		const draft = freshDraft();
		const note = draft.add("note", { title: "Kit", text: "One thing.\n\nAnother thing." });
		const view = review(draft);
		view.splitBlock(note.id);
		// The split-off piece moves to another section; the first piece grows two paragraphs again.
		draft.blocks.find(b => b.id === `${note.id}-2`).kind = "possession";
		note.text = "One thing.\n\nA third thing.";
		view.splitBlock(note.id);
		const ids = draft.blocks.map(b => b.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain(`${note.id}-3`);
	});

	it("joins a piece into the one above it in the same section", () => {
		const draft = freshDraft();
		const view = review(draft);
		const [first, second] = draft.blocks.filter(b => b.kind === "move");
		view.joinUp(second.id);
		expect(draft.blocks.includes(second)).toBe(false);
		expect(first.text).toContain(`${second.title}: `);
	});

	it("starts over: every move, split, join and answer undone", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const view = review(draft);
		const before = JSON.stringify({ blocks: draft.blocks, confirm: draft.confirm });
		draft.blocks[0].kind = "skip";
		view.joinUp(draft.blocks.filter(b => b.kind === "move")[1].id);
		draft.confirm[0].value = 10;
		view.startOver();
		expect(JSON.stringify({ blocks: draft.blocks, confirm: draft.confirm })).toBe(before);
	});

	it("names split pieces sensibly", () => {
		expect(openingWords("- The tools of your station, whatever")).toBe("The tools of your station");
		expect(openingWords("One two three four five six seven eight.")).toBe("One two three four five six…");
		expect(splitParagraphs("a\n\n  \n\nb\nc")).toEqual(["a", "b\nc"]);
	});
});

// A reload brings "Check the imported playbook" back (playbook-builder-restore.js, by way of
// utils/window-restore.js) with every move, split, join and answer, on the page it was left on; and
// since the builder that awaited it is gone, Finish in the builder fills that builder itself.
describe("the review across a reload", () => {
	const KEY = "playbookBuilder:new-abc123";
	function leftOpen() {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const review = new PlaybookImportReview({ draft, fileName: "tester.pdf", issues: [{ severity: "check", message: "Look at page 3." }], report: { issues: [], pages: ["Page 1: x"], sections: [] }, builderKey: KEY });
		block(draft, "Tinker").kind = "startingMove";
		draft.confirm.find(c => c.key === "hp").value = 10;
		review._activeTab = "startingMove";
		review._open.add(block(draft, "Tinker").id);
		return { draft, review, view: JSON.parse(JSON.stringify(review.restoreView)) };
	}

	beforeEach(() => vi.stubGlobal("game", { user: { isGM: true } }));

	it("is restored under the class name its hooks are built from", async () => {
		const { IMPORT_REVIEW_WINDOW_CLASS } = await import("../../module/playbooks/playbook-builder-restore.js");
		expect(PlaybookImportReview.name).toBe(IMPORT_REVIEW_WINDOW_CLASS);
		expect(new PlaybookImportReview({ reviewId: "r1" }).restoreKey).toBe("playbookImportReview:r1");
		expect(new PlaybookImportReview({ draft: freshDraft() }).restoreKey).not.toBe(new PlaybookImportReview({ draft: freshDraft() }).restoreKey);
	});

	it("comes back with every move and answer, on its page, and Start over still goes back to the read", async () => {
		const { draft, view } = leftOpen();
		const { reopenImportReview } = await import("../../module/playbooks/playbook-builder-restore.js");
		const back = await reopenImportReview("playbookImportReview:r1");
		back._takeRestoredView(view);
		expect(back.restoreKey).toBe("playbookImportReview:r1");
		expect(back._draft.blocks).toEqual(JSON.parse(JSON.stringify(draft.blocks)));
		expect(back._draft.confirm.find(c => c.key === "hp").value).toBe(10);
		expect(back._activeTab).toBe("startingMove");
		expect([...back._open]).toEqual([block(draft, "Tinker").id]);
		expect(back._fileName).toBe("tester.pdf");
		expect(back._builderKey).toBe(KEY);
		expect(back._issues.map(i => i.message)).toEqual(["Look at page 3."]);
		expect(back.getData().tabs.find(t => t.selected).key).toBe("startingMove");
		back.startOver();
		expect(block(back._draft, "Tinker").kind).toBe("move");
		expect(back._draft.confirm.find(c => c.key === "hp").value).toBeNull();
	});

	it("saves the reader's report once, and joins it back up after the reload", async () => {
		const read = readPlaybook(tester());
		const review = new PlaybookImportReview({ draft: read.draft, fileName: "tester.pdf", issues: read.report.issues, report: read.report, builderKey: KEY });
		const view = JSON.parse(JSON.stringify(review.restoreView));
		expect(view.report).toBeTruthy();
		expect(view.draft).not.toHaveProperty("report");
		expect(view).not.toHaveProperty("issues");
		const { reopenImportReview } = await import("../../module/playbooks/playbook-builder-restore.js");
		const back = await reopenImportReview("playbookImportReview:r1");
		back._takeRestoredView(view);
		// One object again, as before the reload: a re-read section is noted where the builder reads it.
		expect(back._draft.report).toBe(back._report);
		expect(back._issues).toBe(back._report.issues);
		expect(back._report.sections).toEqual(read.report.sections);
	});

	it("reopens for a GM only, and stays shut when the saved view holds no draft", async () => {
		const { reopenImportReview } = await import("../../module/playbooks/playbook-builder-restore.js");
		expect(await reopenImportReview("playbookBuilder:r1")).toBeNull();
		const empty = await reopenImportReview("playbookImportReview:r1");
		empty._takeRestoredView({ draft: "nonsense" });
		expect(empty._draft).toBeNull();
		expect(await empty._render(true, { view: { draft: null } })).toBeUndefined();
		game.user.isGM = false;
		expect(await reopenImportReview("playbookImportReview:r1")).toBeNull();
	});

	function restored() {
		const { view } = leftOpen();
		const back = new PlaybookImportReview({ reviewId: "r1" });
		back._takeRestoredView(view);
		back._activeTab = "overview";
		const window = new Window();
		window.document.body.innerHTML = rosterHandlebars().compile(readRepo("templates/dialogs/playbook-import-review.hbs"))(back.getData());
		const root = window.document.body;
		back._resolveWith = vi.fn();
		return { back, root };
	}

	it("fills the builder it came from when Finish in the builder is pressed", async () => {
		const builder = { rendered: true, restoreKey: KEY, _mayReplace: vi.fn(async () => true), _takeReviewed: vi.fn(async () => "read"), bringToTop: vi.fn() };
		vi.stubGlobal("ui", { windows: { 1: builder }, notifications: { warn: vi.fn(), error: vi.fn() } });
		const { back, root } = restored();
		await back._finish(root);
		expect(builder._takeReviewed).toHaveBeenCalledTimes(1);
		const [result, ctx] = builder._takeReviewed.mock.calls[0];
		expect(result.bundle.playbook.hp).toBe(10);
		expect(result.bundle.moves.find(m => m.name === "Tinker")).toMatchObject({ starting: true });
		expect(ctx).toMatchObject({ fileName: "tester.pdf", report: { pages: ["Page 1: x"] } });
		expect(builder.bringToTop).toHaveBeenCalled();
		expect(back._resolveWith).toHaveBeenCalledTimes(1);
	});

	it("stays open when the GM won't let the builder's unsaved work be replaced", async () => {
		const builder = { rendered: true, restoreKey: KEY, _mayReplace: vi.fn(async () => false), _takeReviewed: vi.fn() };
		vi.stubGlobal("ui", { windows: { 1: builder }, notifications: { warn: vi.fn(), error: vi.fn() } });
		const { back, root } = restored();
		await back._finish(root);
		expect(builder._takeReviewed).not.toHaveBeenCalled();
		expect(back._resolveWith).not.toHaveBeenCalled();
	});

	it("reopens that builder when it isn't open, and shows it", async () => {
		vi.stubGlobal("ui", { windows: {}, notifications: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } });
		const { PlaybookBuilderDialog } = await import("../../module/playbooks/PlaybookBuilderDialog.js");
		const took = vi.spyOn(PlaybookBuilderDialog.prototype, "_takeReviewed").mockResolvedValue("read");
		const shown = vi.spyOn(PlaybookBuilderDialog.prototype, "render").mockImplementation(function () { return this; });
		const { back, root } = restored();
		await back._finish(root);
		expect(took).toHaveBeenCalledTimes(1);
		expect(took.mock.contexts[0].restoreKey).toBe(KEY);
		expect(shown).toHaveBeenCalledWith(true);
		expect(back._resolveWith).toHaveBeenCalledTimes(1);
		took.mockRestore(); shown.mockRestore();
	});
});

describe("Start over", () => {
	it("is offered only once something has changed, and an answer wakes it without a re-render", () => {
		const draft = freshDraft({ hp: ["HP (max 16)", "HP (max 10)"] });
		const review = new PlaybookImportReview({ draft, fileName: "t.pdf" });
		const tpl = rosterHandlebars().compile(readRepo("templates/dialogs/playbook-import-review.hbs"));
		const win = new Window();
		win.document.body.innerHTML = tpl(review.getData());
		const root = win.document.body;
		const reset = () => root.querySelector(".stonetop-pb-review-reset");
		expect(review.hasChanges()).toBe(false);
		expect(reset().disabled).toBe(true);
		root.querySelector('input[type=radio][data-confirm="hp"][value="10"]').checked = true;
		review._readConfirm(root, "hp");
		expect(reset().disabled).toBe(false);
		review.startOver();
		expect(review.hasChanges()).toBe(false);
		block(draft, "Tinker").kind = "skip";
		win.document.body.innerHTML = tpl(review.getData());
		expect(reset().disabled).toBe(false);
	});
});

describe("an insert in the review", () => {
	function render(draft, extra = {}) {
		const view = { _draft: draft, _fileName: "tester.pdf", _issues: [], _open: new Set(), ...extra };
		Object.setPrototypeOf(view, PlaybookImportReview.prototype);
		const data = PlaybookImportReview.prototype.getData.call(view);
		const window = new Window();
		window.document.body.innerHTML = rosterHandlebars().compile(readRepo("templates/dialogs/playbook-import-review.hbs"))(data);
		for (const select of window.document.querySelectorAll("select")) {
			const chosen = [...select.options].findIndex(o => o.hasAttribute("selected"));
			if (chosen >= 0) select.selectedIndex = chosen;
		}
		return { view, data, root: window.document.body };
	}
	const titled = () => freshDraft({ insert: "titled", keepInsert: true });
	const question = draft => draft.confirm.find(c => c.insert);

	it("gets a rail page of its own, holding every piece of it", () => {
		const draft = titled();
		const { data, root } = render(draft);
		const page = data.groups.find(g => g.kind === "insert-i1");
		expect(page).toMatchObject({ title: "Tester's Toolbox", icon: "fa-puzzle-piece" });
		expect(page.blocks.map(b => b.title)).toEqual(["Tester's Toolbox", "Unfold", "Gadgets", "Instinct", "Extra Gear", "Whirr", "Clank"]);
		expect(data.tabs.map(t => t.key)).toContain("insert-i1");
		// Its moves are not among the playbook's.
		expect(data.groups.find(g => g.kind === "move").blocks.map(b => b.title)).not.toContain("Whirr");
		const whirr = root.querySelector(`[data-id="${block(draft, "Whirr").id}"]`);
		expect(whirr.closest("[data-kind]").dataset.kind).toBe("insert-i1");
		expect(whirr.querySelector("select").value).toBe("move@i1");
	});

	it("asks which move opens it from a list, the reader's guess picked", () => {
		const { root } = render(titled());
		const select = root.querySelector('select[data-confirm="insert:i1"]');
		const values = [...select.options].map(o => o.value);
		expect(values).toContain("Tooled Up");
		expect(values).not.toContain("Whirr");
		expect(values.slice(-2)).toEqual([INSERT_ALWAYS, INSERT_NONE]);
		expect(select.value).toBe("Tooled Up");
	});

	it("an unsure one starts unanswered, and Finish waits for it", () => {
		const draft = freshDraft({ keepInsert: true });
		const { view, root } = render(draft);
		expect(root.querySelector('select[data-confirm="insert:i1"]').value).toBe("");
		vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
		view._resolveWith = vi.fn();
		PlaybookImportReview.prototype._finish.call(view, root);
		expect(ui.notifications.warn).toHaveBeenCalledWith(expect.stringMatching(/looks like an insert/));
		expect(view._resolveWith).not.toHaveBeenCalled();
	});

	it("moves a piece out of it, or into it, through Belongs in", () => {
		const draft = titled();
		const { view } = render(draft);
		view._place(block(draft, "Whirr"), "move");
		view._place(block(draft, "Poke"), "move@i1");
		const { bundle } = assemblePlaybook(draft);
		expect(bundle.moves.find(m => m.name === "Whirr").insert).toBeFalsy();
		expect(bundle.moves.find(m => m.name === "Poke").insert).toBe("tester-s-toolbox");
		// Only a kind an insert holds goes into one.
		view._place(block(draft, "The Prober"), "background@i1");
		expect(block(draft, "The Prober").insert).toBe("");
	});

	it("keeps two inserts read under one name apart, each with its own moves", async () => {
		const { normalizeBundle } = await import("../../module/playbooks/homebrew-bundle.js");
		const draft = titled();
		const first = draft.inserts[0];
		draft.inserts.push({ ...structuredClone(first), id: "i2" });
		const q = question(draft);
		draft.confirm.push({ ...structuredClone(q), key: `${q.key}-2`, insert: "i2" });
		const { view } = render(draft);
		view._place(block(draft, "Poke"), "move@i2");
		const { bundle } = normalizeBundle(assemblePlaybook(draft).bundle);
		expect(bundle.playbook.inserts.map(i => i.key)).toEqual(["tester-s-toolbox", "tester-s-toolbox-2"]);
		expect(bundle.moves.find(m => m.name === "Poke").insert).toBe("tester-s-toolbox-2");
		expect(bundle.moves.find(m => m.name === "Whirr").insert).toBe("tester-s-toolbox");
	});

	it("'It's not an insert' sends its pieces back to the playbook's sections", () => {
		const draft = titled();
		const { view, root } = render(draft);
		view.render = vi.fn();
		const select = root.querySelector('select[data-confirm="insert:i1"]');
		select.value = INSERT_NONE;
		PlaybookImportReview.prototype._readConfirm.call(view, root, "insert:i1");
		expect(question(draft).value).toBe(INSERT_NONE);
		expect(view.render).toHaveBeenCalled();
		const data = PlaybookImportReview.prototype.getData.call(view);
		expect(data.groups.some(g => g.kind === "insert-i1")).toBe(false);
		expect(data.groups.find(g => g.kind === "move").blocks.map(b => b.title)).toContain("Whirr");
	});

	it("is kept across a reload, inserts and all", async () => {
		const draft = titled();
		const review = new PlaybookImportReview({ draft });
		const view = JSON.parse(JSON.stringify(review.restoreView));
		expect(view.draft.inserts).toHaveLength(1);
		const back = new PlaybookImportReview({});
		back._takeRestoredView(view);
		expect(back._draft.inserts[0]).toMatchObject({ name: "Tester's Toolbox", guess: "Tooled Up" });
		expect(assemblePlaybook(back._draft).bundle.playbook.inserts[0].unlockedBy).toBe("Tooled Up");
	});
});
