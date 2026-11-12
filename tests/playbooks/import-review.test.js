import { describe, it, expect, vi, afterEach } from "vitest";
import { Window } from "happy-dom";
import { readPlaybook, assemblePlaybook, BLOCK_KINDS } from "../../module/playbooks/pdf/read-playbook.js";
import { PlaybookImportReview, splitParagraphs, openingWords } from "../../module/playbooks/PlaybookImportReview.js";
import { tester } from "../fakes/tester-playbook-pdf.js";
import { rosterHandlebars } from "../fakes/hbs.js";
import { readRepo } from "../fakes/css.js";

const freshDraft = (opts) => readPlaybook(tester(opts)).draft;
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
		expect(tinker.why).toMatch(/part of the playbook the book's playbooks don't have/);
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
		draft.blocks.filter(b => b.title === "Belonging").forEach(b => { b.kind = "note"; });
		const { bundle } = assemblePlaybook(draft);
		expect(bundle.playbook.lore.filter(l => l.title === "Belonging")).toEqual([]);
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
	function render(draft) {
		const view = { _draft: draft, _fileName: "tester.pdf", _issues: [], _open: new Set() };
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
