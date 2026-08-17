import { describe, it, expect, vi, afterEach } from "vitest";
import { CreateSiteDialog, _countLines } from "../../module/sites/create-site-dialog.js";
import { shapeSiteSystem } from "../../module/sites/site-store.js";
import { SITE_PAIR_LISTS } from "../../module/sites/site-schema.js";

// The wizard had no tests at all, which is how a chip handler that could only ever dedupe ONE of
// its four lists, and a row renderer that could only ever draw two of areas' four fields, both
// shipped. These cover the table-driven half: the parts whose whole promise is that adding a list
// to the schema is enough.
//
// Called off the prototype rather than through the constructor: every method here is a pure
// function of `_sel`, and standing up an Application would test Foundry rather than the wizard.
const on = (sel) => Object.assign(Object.create(CreateSiteDialog.prototype), { _sel: sel });

const blankSel = () => ({
	name: "", why: "", description: "", manner: "", picks: {}, regionId: "", terrain: "",
	connections: [], questions: [], timeline: [], denizens: [], dangers: [], discoveries: [],
	outside: [], inside: [], areas: [], plans: [], randomTables: [],
});

describe("_pairRows", () => {
	it("emits one cell per key the schema declares, in that order", () => {
		const dlg = on({ ...blankSel(), areas: [{ title: "A", description: "d", contents: "c", exits: "e" }] });
		const [row] = dlg._pairRows("areas");
		expect(row.cells.map(c => c.key)).toEqual(["title", "description", "contents", "exits"]);
		expect(row.cells.map(c => c.value)).toEqual(["A", "d", "c", "e"]);
	});

	it("marks the textarea keys, and only those", () => {
		const dlg = on({ ...blankSel(), areas: [{ title: "A" }] });
		const multiline = dlg._pairRows("areas")[0].cells.filter(c => c.multiline).map(c => c.key);
		expect(multiline).toEqual(["description", "contents"]);
	});

	it("carries `list` and `index` on every row and every cell", () => {
		// The delegated add/remove/capture handlers key off data-list and data-index, and inside a
		// partial's block a `../` chain lands at a depth that depends on how the partial was
		// called. Reading one wrong yields data-list="", which no handler matches.
		const dlg = on({ ...blankSel(), denizens: [{ name: "a" }, { name: "b" }] });
		const rows = dlg._pairRows("denizens");
		expect(rows.map(r => r.index)).toEqual([0, 1]);
		for (const [i, row] of rows.entries()) {
			expect(row.list).toBe("denizens");
			for (const cell of row.cells) expect([cell.list, cell.index]).toEqual(["denizens", i]);
		}
	});

	it("flags only the first cell as first, which is the one sharing a row with the delete button", () => {
		const dlg = on({ ...blankSel(), areas: [{ title: "A" }] });
		expect(dlg._pairRows("areas")[0].cells.map(c => c.first)).toEqual([true, false, false, false]);
	});

	it("gives a key with no declared chrome a plain single-line cell rather than none at all", () => {
		const keys = SITE_PAIR_LISTS.questions.keys;
		SITE_PAIR_LISTS.questions = { keys: [...keys, "source"] };
		try {
			const dlg = on({ ...blankSel(), questions: [{ prompt: "p", answer: "a", source: "Book I" }] });
			const cell = dlg._pairRows("questions")[0].cells.at(-1);
			expect(cell).toMatchObject({ key: "source", value: "Book I", multiline: false, placeholder: "", cls: "" });
		} finally {
			SITE_PAIR_LISTS.questions = { keys };
		}
	});

	it("is empty for a list that is not a paired one", () => {
		expect(on(blankSel())._pairRows("dangers")).toEqual([]);
	});
});

describe("suggestion chips", () => {
	// The chip's "already added" state and the add handler's "once only" guard are the same
	// question. Asking it of a hardcoded `prompt` made both right for questions alone: on every
	// other list the chip never lit and each click appended another row.
	it("marks a questions chip against the row's first key", () => {
		const dlg = on({ ...blankSel(), questions: [{ prompt: "Who built it?", answer: "" }] });
		expect(dlg._pairChips("questions", ["Who built it?", "Who lives here?"]))
			.toEqual([
				{ list: "questions", text: "Who built it?", used: true },
				{ list: "questions", text: "Who lives here?", used: false },
			]);
	});

	it("marks a chip on a list whose first key is NOT called prompt", () => {
		const dlg = on({ ...blankSel(), denizens: [{ name: "Crinwin", notes: "" }] });
		expect(dlg._pairChips("denizens", ["Crinwin"])[0].used).toBe(true);
		expect(on({ ...blankSel(), areas: [{ title: "Vault" }] })._pairChips("areas", ["Vault"])[0].used).toBe(true);
		expect(on({ ...blankSel(), timeline: [{ when: "Last autumn" }] })
			._pairChips("timeline", ["Last autumn"])[0].used).toBe(true);
	});

	it("does not mark a chip that merely matches a LATER key", () => {
		const dlg = on({ ...blankSel(), questions: [{ prompt: "", answer: "Who built it?" }] });
		expect(dlg._pairChips("questions", ["Who built it?"])[0].used).toBe(false);
	});

	it("marks a plain string list's chip", () => {
		expect(on({ ...blankSel(), connections: ["the Forest Folk knew"] })
			._lineChips("connections", ["the Forest Folk knew", "nobody knew"]).map(c => c.used))
			.toEqual([true, false]);
	});
});

describe("_countLines", () => {
	afterEach(() => { vi.restoreAllMocks(); });

	it("counts only the lines that have something, in step order", () => {
		expect(_countLines(shapeSiteSystem({
			dangers: ["wasps"], areas: [{ title: "A" }], outside: ["a hill"], inside: ["dark"],
		}))).toEqual([
			{ label: "Dangers", n: 1 },
			{ label: "Impressions", n: 2 },   // outside + inside read as one line
			{ label: "Areas", n: 1 },
		]);
	});

	it("says so when a list the site saves is going uncounted", () => {
		// The whole job of the review step is telling the GM what they have. A list added to the
		// site and left out of the tally used to be invisible there with nothing to notice it.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_countLines({ ...shapeSiteSystem(), hooks: [{ trigger: "t" }] });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("hooks"));
	});

	it("stays quiet for the site as it actually is", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_countLines(shapeSiteSystem({ questions: [{ prompt: "p" }] }));
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("the schema round-trip", () => {
	// The promise the schema makes: collect on the wizard, save to the page, open it again and
	// find it. Each leg used to name its lists separately, so a list could be collected and never
	// written (the shaper), or written and never read back (the seeding).
	const seedFromPage = (page) => CreateSiteDialog.prototype._seedFromPage.call({}, page);

	it("carries a four-key area out to the page and back unchanged", () => {
		const area = { title: "Entrance", description: "Dimly lit.\n\nBeyond.", contents: "a hoard", exits: "north" };
		const saved = shapeSiteSystem({ areas: [area] });
		expect(seedFromPage({ name: "Tomb", system: saved }).areas).toEqual([area]);
	});

	it("keeps a half-filled row on the way back in, so the GM can finish it", () => {
		const saved = shapeSiteSystem({ questions: [{ prompt: "Who built it?", answer: "" }] });
		expect(seedFromPage({ name: "Tomb", system: saved }).questions)
			.toEqual([{ prompt: "Who built it?", answer: "" }]);
	});

	it("carries a list added to the schema alone, with nothing else edited", () => {
		SITE_PAIR_LISTS.hooks = { keys: ["trigger", "effect"] };
		try {
			const saved = shapeSiteSystem({ hooks: [{ trigger: " a bell ", effect: "the dead wake" }] });
			expect(saved.hooks).toEqual([{ trigger: "a bell", effect: "the dead wake" }]);
			expect(seedFromPage({ name: "Tomb", system: saved }).hooks)
				.toEqual([{ trigger: "a bell", effect: "the dead wake" }]);
		} finally {
			delete SITE_PAIR_LISTS.hooks;
		}
	});
});
