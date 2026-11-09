import { describe, it, expect, vi, afterEach } from "vitest";
import { CreateSiteDialog, _reviewSections, TERRAIN_KEY } from "../../module/sites/create-site-dialog.js";
import { siteManner, combinableRows, REGION_TABLE_PREFIX } from "../../module/data/site-tables.js";
import Handlebars from "handlebars";
import { readRepo } from "../fakes/css.js";
import { stubConfirm } from "../fakes/confirm.js";
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
	name: "", why: "", description: "", manner: "", picks: {}, regionId: "", terrain: [],
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

	it("makes every paired list's row a titled card", () => {
		const dlg = on({
			...blankSel(),
			questions: [{ prompt: "p" }], timeline: [{ when: "w" }], denizens: [{ name: "n" }], areas: [{ title: "t" }],
		});
		// The first cell (on the delete button's line) reads as a bold label and the rest as plain
		// text until clicked, all boxed together in one card.
		for (const list of Object.keys(SITE_PAIR_LISTS)) {
			const [row] = dlg._pairRows(list);
			expect(row.rowClass).toContain("stonetop-cs-card");
			expect(row.cells.map(c => c.cls)).toEqual(row.cells.map((c, i) => i ? "stonetop-cs-body" : "stonetop-cs-title"));
		}
	});

	it("is empty for a list that is not a paired one", () => {
		expect(on(blankSel())._pairRows("dangers")).toEqual([]);
	});
});

describe("suggestion menu items", () => {
	// "Already added" and the pick handler's "once only" guard are the same question. Asking it of
	// a hardcoded `prompt` made both right for questions alone: on every other list the item never
	// showed as added and each pick appended another row.
	it("marks a question against the row's first key", () => {
		const dlg = on({ ...blankSel(), questions: [{ prompt: "Who built it?", answer: "" }] });
		expect(dlg._suggestionItems("questions", ["Who built it?", "Who lives here?"]))
			.toEqual([
				{ value: "Who built it?", label: "Who built it?", used: true },
				{ value: "Who lives here?", label: "Who lives here?", used: false },
			]);
	});

	it("marks an item on a list whose first key is NOT called prompt", () => {
		const dlg = on({ ...blankSel(), denizens: [{ name: "Crinwin", notes: "" }] });
		expect(dlg._suggestionItems("denizens", ["Crinwin"])[0].used).toBe(true);
		expect(on({ ...blankSel(), areas: [{ title: "Vault" }] })._suggestionItems("areas", ["Vault"])[0].used).toBe(true);
		expect(on({ ...blankSel(), timeline: [{ when: "Last autumn" }] })
			._suggestionItems("timeline", ["Last autumn"])[0].used).toBe(true);
	});

	it("does not mark an item that merely matches a LATER key", () => {
		const dlg = on({ ...blankSel(), questions: [{ prompt: "", answer: "Who built it?" }] });
		expect(dlg._suggestionItems("questions", ["Who built it?"])[0].used).toBe(false);
	});

	it("marks a plain string list's item", () => {
		expect(on({ ...blankSel(), connections: ["the Forest Folk knew"] })
			._suggestionItems("connections", ["the Forest Folk knew", "nobody knew"]).map(c => c.used))
			.toEqual([true, false]);
	});

	it("adds a picked suggestion once, as a line or under a paired list's first key", () => {
		const dlg = on({ ...blankSel() });
		dlg._addSuggestion("connections", "nobody knew");
		dlg._addSuggestion("connections", "nobody knew");
		expect(dlg._sel.connections).toEqual(["nobody knew"]);
		dlg._addSuggestion("questions", "Who built it?");
		dlg._addSuggestion("questions", "Who built it?");
		expect(dlg._sel.questions).toHaveLength(1);
		expect(dlg._sel.questions[0].prompt).toBe("Who built it?");
	});

	// Which lists have a menu is said once, in the dialog's _SUGGESTIONS: the template reads it off
	// the context rather than marking its own buttons.
	it("marks the menu buttons off the dialog's own list, not the template's", () => {
		const hbs = readRepo("templates/dialogs/create-site.hbs");
		expect(hbs).not.toContain("menu=true");
		expect(hbs).toContain("menu=this.suggestionMenus.connections");
		expect(hbs).toContain("menu=this.suggestionMenus.questions");
	});
});

describe("_reviewSections", () => {
	afterEach(() => { vi.restoreAllMocks(); });

	it("lists the entries of only the lists that have something, in step order", () => {
		expect(_reviewSections(shapeSiteSystem({
			dangers: ["wasps"], areas: [{ title: "A" }, { contents: "bones" }], outside: ["a hill"], inside: ["dark"],
		}))).toEqual([
			{ label: "Dangers", items: [{ lead: "", text: "wasps" }] },
			{ label: "Outside", items: [{ lead: "", text: "a hill" }] },
			{ label: "Inside", items: [{ lead: "", text: "dark" }] },
			// An area saved with no title still shows, under the name the card gives it.
			{ label: "Areas", items: [{ lead: "", text: "A" }, { lead: "", text: "Area 2" }] },
		]);
	});

	it("leads each paired entry with its question, date or name, and marks a question still open", () => {
		const s = _reviewSections(shapeSiteSystem({
			questions: [{ prompt: "Who built it?", answer: "" }, { prompt: "Why?", answer: "To keep her down" }],
			timeline: [{ when: "Long ago", text: "The barrow is raised" }],
			denizens: [{ name: "Maelis", notes: "one eye" }],
			randomTables: [{ caption: "What stirs", rows: ["a", "b", "c", "d", "e", "f"] }],
		}));
		expect(s.find(x => x.label === "Questions").items).toEqual([
			{ lead: "Who built it?", text: "", open: true },
			{ lead: "Why?", text: "To keep her down", open: false },
		]);
		expect(s.find(x => x.label === "Timeline").items).toEqual([{ lead: "Long ago", text: "The barrow is raised" }]);
		expect(s.find(x => x.label === "Denizens").items).toEqual([{ lead: "Maelis", text: "one eye" }]);
		expect(s.find(x => x.label === "Tables").items).toEqual([{ lead: "What stirs", text: "1d6" }]);
	});

	it("says so when a list the site saves is going unshown", () => {
		// The whole job of the review step is telling the GM what they have. A list added to the
		// site and left out of the review used to be invisible there with nothing to notice it.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_reviewSections({ ...shapeSiteSystem(), hooks: [{ trigger: "t" }] });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("hooks"));
	});

	it("stays quiet for the site as it actually is", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_reviewSections(shapeSiteSystem({ questions: [{ prompt: "p" }] }));
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

	it("keeps every face of a table run longer than one row may cover", () => {
		const rows = [...Array(30).fill("Nothing"), "A wolf"];
		const sel = seedFromPage({ name: "Tomb", system: { randomTables: [{ caption: "Encounters", rows }] } });
		expect(on({ ...blankSel(), ...sel })._seed().randomTables[0].rows).toEqual(rows);
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

describe("the theme step's pick controls", () => {
	const dlg = (sel) => on({ ...blankSel(), ...sel });
	const themeRows = (manner) => siteManner(manner).tables.find(t => t.key === "theme").rows;
	/** The Nth Green Lord theme the sub-die can reach that owes no further roll of its own. */
	const plainTheme = (n) => combinableRows(themeRows("greenLord"), 8).filter(r => !r.again)[n].text;

	it("offers the result alone, without the roll that would have produced it", () => {
		const [pick] = dlg({ manner: "greenLord" })._pickSlots("theme").slots;
		expect(pick.rows[0].text).toBe("Beasts or vermin: bred, changed, or harnessed");
		for (const row of pick.rows) expect(row.text).not.toMatch(/^\d+(-\d+)?\s/);
	});

	it("follows a chosen row's roll-again into a field of its own", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		const values = d._sel.picks.theme;
		expect(values[0]).toBe("Sized for giants");
		expect(values).toHaveLength(2);
		// The row says 1d8, so the extra comes from the eight rows that die can reach, never the
		// row itself (which is the ninth).
		expect(combinableRows(themeRows("greenLord"), 8).map(r => r.text)).toContain(values[1]);
	});

	it("offers an extra field only the sub-die its row names", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		const [, extra] = d._pickSlots("theme").slots;
		expect(extra.extra).toBe(true);
		expect(extra.rows).toHaveLength(8);
		expect(extra.rows.map(r => r.text)).not.toContain("Sized for giants");
	});

	it("rolls twice for a row that asks for two", () => {
		const d = dlg({ manner: "primordial" });
		d._setPick("marker", 0, "Two markers at once");
		expect(d._sel.picks.marker).toHaveLength(3);
		for (const value of d._sel.picks.marker.slice(1)) expect(value).toBeTruthy();
	});

	it("clears what was combined in when the pick itself changes", () => {
		const d = dlg({ manner: "primordial" });
		d._setPick("marker", 0, "Two markers at once");
		d._setPick("marker", 0, "Desolation/radiation");
		expect(d._sel.picks.marker).toEqual(["Desolation/radiation"]);
		expect(d._pickSlots("marker").canAdd).toBe(false);
	});

	it("keeps the extras when the pick is set to what it already was", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		const values = [...d._sel.picks.theme];
		d._setPick("theme", 0, "Sized for giants");
		expect(d._sel.picks.theme).toEqual(values);
	});

	it("clears the whole pick when it is emptied", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		d._setPick("theme", 0, "");
		expect(d._sel.picks.theme).toEqual([]);
		expect(d._pickSlots("theme").slots).toHaveLength(1);
	});

	it("allows a second answer on a table the book says to combine 2 of, and no more", () => {
		const d = dlg({ manner: "primordial" });
		const first = themeRows("primordial")[0].text;
		expect(d._pickSlots("theme").canAdd).toBe(false);       // nothing answered yet
		d._setPick("theme", 0, first);
		expect(d._pickSlots("theme").canAdd).toBe(true);
		d._setPick("theme", 1, themeRows("primordial")[1].text);
		expect(d._pickSlots("theme").canAdd).toBe(false);
		expect(d._pickSlots("theme").slots.map(s => !!s.extra)).toEqual([false, true]);
	});

	it("says which die each field rolls, and marks the combining ones", () => {
		const d = dlg({ manner: "primordial" });
		d._setPick("theme", 0, themeRows("primordial")[0].text);
		d._setPick("theme", 1, "");
		const [pick, extra] = d._pickSlots("theme").slots;
		expect(pick).toMatchObject({ label: "Theme", hint: "1d12 (pick 1, or combine 2)", rollTip: "Roll 1d12" });
		expect(extra).toMatchObject({ label: "combined with", hint: "", rollTip: "Roll again" });
	});

	it("allows a third answer on a table the book says to take 1 to 3 of", () => {
		const d = dlg({ manner: "primordial" });
		const rows = siteManner("primordial").tables.find(t => t.key === "features").rows;
		d._setPick("features", 0, rows[0].text);
		expect(d._pickSlots("features").slots[0].hint).toBe("1d12 (pick or roll 1 to 3)");
		// The book's OTHER phrasing, for a table that takes exactly two.
		expect(dlg({ manner: "greenLord" })._pickSlots("theme").slots[0].hint)
			.toContain("pick 1, or combine 2");
		d._setPick("features", 1, rows[1].text);
		expect(d._pickSlots("features").canAdd).toBe(true);
		d._setPick("features", 2, rows[2].text);
		expect(d._pickSlots("features").canAdd).toBe(false);
		expect(d._pickSlots("features").slots).toHaveLength(3);
	});

	// The extra slots are offered from the whole table whenever the first pick named no sub-die,
	// so a row carrying "and roll 1d8 again" can perfectly well be combined in there — and the
	// wording was taken OUT of the row text on purpose, so nothing on screen would say the roll
	// was owed. It has to be rolled here or it is silently dropped.
	it("follows a roll-again on a row combined in, not only on the first pick", () => {
		const d = dlg({ manner: "greenLord" });
		const plain = themeRows("greenLord").find(r => !r.again).text;
		d._setPick("theme", 0, plain);
		d._setPick("theme", 1, "Sized for giants");
		const values = d._sel.picks.theme;
		expect(values.slice(0, 2)).toEqual([plain, "Sized for giants"]);
		expect(values).toHaveLength(3);
		expect(combinableRows(themeRows("greenLord"), 8).map(r => r.text)).toContain(values[2]);
	});

	// Re-picking a combined slot drops what THAT row brought and leaves the rest standing: a row
	// combined freely off the table's own budget is the GM's choice, not this row's to throw away.
	it("drops only what the slot it replaces had rolled", () => {
		const d = dlg({ manner: "greenLord" });
		const [plain, other] = themeRows("greenLord").filter(r => !r.again).map(r => r.text);
		d._setPick("theme", 0, plain);
		d._setPick("theme", 1, "Sized for giants");
		expect(d._sel.picks.theme).toHaveLength(3);
		d._setPick("theme", 1, other);
		expect(d._sel.picks.theme).toEqual([plain, other]);
	});

	// The book's two instructions ADD. "Pick 1, or combine 2" is what the TABLE takes; "and roll
	// 1d8 again" is what a ROW owes. Reading them as one budget meant the hint on screen promised
	// a combine the button never offered, on exactly the rows that ask for both.
	it("still offers the table's combine after a row has spent its own roll-again", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		expect(d._sel.picks.theme).toHaveLength(2);
		// The sub-die filled slot 1 at random, and one of the eight rows it can reach carries a
		// roll-again of ITS own, which buys a further slot (see the test below). Pinned to a plain
		// row so what is under test here is the TABLE's budget and not which theme came up.
		d._setPick("theme", 1, plainTheme(1));
		expect(d._pickSlots("theme").slots[0].hint).toContain("pick 1, or combine 2");
		expect(d._pickSlots("theme").canAdd).toBe(true);
		d._setPick("theme", 2, plainTheme(0));
		expect(d._sel.picks.theme).toHaveLength(3);
		expect(d._pickSlots("theme").canAdd).toBe(false);
	});

	// The other half of "the two budgets ADD" (see maxExtraPicks): the roll-again belongs to the
	// ROW, so a row that arrives in a combined slot brings its own, exactly as the first pick did.
	// It is not rolled for automatically - the GM is offered the slot and fills it themselves.
	it("gives a combined row its own roll-again as one more slot to fill", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		d._setPick("theme", 1, plainTheme(0));
		expect(d._pickSlots("theme").canAdd).toBe(true);
		// Swap the combined slot for the one row in the sub-die's reach that owes a roll of its own.
		const owes = combinableRows(themeRows("greenLord"), 8).find(r => r.again);
		expect(owes, "the sub-die's pool no longer holds a roll-again row").toBeTruthy();
		d._setPick("theme", 1, owes.text);
		d._setPick("theme", 2, plainTheme(1));
		expect(d._sel.picks.theme).toHaveLength(3);
		// Two rows owing a roll plus the table's own free combine, so there is still room.
		expect(d._pickSlots("theme").canAdd).toBe(true);
	});

	it("says nothing about combining on a table that takes one answer", () => {
		const d = dlg({ manner: "greenLord" });
		expect(d._pickSlots("purpose").slots[0].hint).toBe("1d6");
	});

	it("runs the terrain through the same controls, roll-again and all", () => {
		const d = dlg({ regionId: "labyrinth" });
		expect(d._pickSlots(TERRAIN_KEY).slots[0]).toMatchObject({ label: "Terrain", key: TERRAIN_KEY });
		d._setPick(TERRAIN_KEY, 0, "An obstruction");
		expect(d._sel.terrain).toHaveLength(2);
		expect(d._sel.terrain[0]).toBe("An obstruction");
	});

	it("has no controls at all before a manner or a region is chosen", () => {
		expect(dlg({})._pickSlots("theme")).toEqual({ key: "theme", slots: [], canAdd: false });
		expect(dlg({})._pickSlots(TERRAIN_KEY).slots).toEqual([]);
	});

	it("carries a combined pick out to the page and back into its own fields", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		const combined = [...d._sel.picks.theme];
		const saved = shapeSiteSystem(d._seed());
		expect(saved.picks[0].value).toBe(combined.join(" + "));
		expect(CreateSiteDialog.prototype._seedFromPage.call({}, { name: "Tomb", system: saved }).picks.theme)
			.toEqual(combined);
	});

	it("carries a combined terrain out to the page and back", () => {
		const terrain = ["An obstruction", "Chamber, cavern, or alcove"];
		const saved = shapeSiteSystem(dlg({ regionId: "labyrinth", terrain })._seed());
		expect(saved.terrain).toBe("An obstruction + Chamber, cavern, or alcove");
		expect(CreateSiteDialog.prototype._seedFromPage.call({}, { name: "T", system: saved }).terrain)
			.toEqual(terrain);
	});
});

// Every pick, roll, add and remove redraws the window, which threw the step column back to its top;
// a new step still opens at its top, because StepperDialog zeroes the same column on a step change.
describe("scroll", () => {
	it("keeps the step column and the rail where they were through a redraw", () => {
		expect(CreateSiteDialog.defaultOptions.scrollY).toEqual([".stonetop-guide-main", ".stonetop-guide-toc"]);
		expect(CreateSiteDialog.prototype._stepScrollSelector).toBe(".stonetop-guide-main");
	});
});

describe("cs-pick-slots.hbs", () => {
	// The partial and the handlers are joined by nothing but data-key and data-slot, and both ends
	// fail silently: a slot rendered without them is a control whose change and roll do nothing,
	// which reads as a dead field rather than an unwired one.
	const render = Handlebars.compile(readRepo("templates/dialogs/partials/cs-pick-slots.hbs"));
	const dlg = (sel) => on({ ...blankSel(), ...sel });

	it("gives every field the key and slot its handlers match on", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("theme", 0, "Sized for giants");
		const html = render({ note: "", ...d._pickSlots("theme") });
		expect(html).toContain('class="stonetop-cf-input stonetop-cs-pick" data-key="theme" data-slot="0"');
		expect(html).toContain('class="stonetop-cf-input stonetop-cs-pick" data-key="theme" data-slot="1"');
		expect(html).toContain('class="stonetop-cs-roll stonetop-cf-mini-btn" data-key="theme" data-slot="1"');
		expect(html).toContain('class="stonetop-cs-uncombine stonetop-cf-mini-btn" data-key="theme" data-slot="1"');
		// The pick itself is never one of the combined extras, so it carries no drop button.
		expect(html.split("stonetop-cs-uncombine")).toHaveLength(2);
	});

	it("prints the results without the rolls that would have produced them", () => {
		const html = render(dlg({ manner: "greenLord" })._pickSlots("theme"));
		expect(html).toContain("<option value=\"Sized for giants\">Sized for giants</option>");
		expect(html).not.toContain("&middot;");
		expect(html).not.toMatch(/>\s*\d+(-\d+)?\s*(&middot;|·)/);
	});

	it("offers the second answer a combinable table allows", () => {
		const d = dlg({ manner: "primordial" });
		d._setPick("theme", 0, siteManner("primordial").tables.find(t => t.key === "theme").rows[0].text);
		const html = render(d._pickSlots("theme"));
		expect(html).toContain('class="stonetop-cs-combine stonetop-cf-mini-btn stonetop-cf-mini-btn--add" data-key="theme"');
	});

	it("offers nothing to combine on a table that takes one answer", () => {
		const d = dlg({ manner: "greenLord" });
		d._setPick("purpose", 0, "Dwelling (home, barracks, dormitory, etc.)");
		expect(render(d._pickSlots("purpose"))).not.toContain("stonetop-cs-combine");
	});

	it("keeps an answer no row carries selected, so a save cannot silently change it", () => {
		const html = render(dlg({ manner: "greenLord", picks: { purpose: ["A dwelling of my own"] } })._pickSlots("purpose"));
		expect(html).toContain('<option value="A dwelling of my own" selected>A dwelling of my own</option>');
	});
});

describe("each combined slot rolls on its own row's sub-die", () => {
	const dlg = (sel) => on({ ...blankSel(), ...sel });
	const themes = siteManner("greenLord").tables.find(t => t.key === "theme").rows;
	const plain = themes.filter(r => !r.again).map(r => r.text);
	const top = () => 0.999;   // the last row the pool holds

	it("offers and rolls a giant-sized row's 1d8 even when it was combined in second", () => {
		const d = dlg({ manner: "greenLord", picks: { theme: [plain[0], "Sized for giants", plain[1]] } });
		expect(d._pickSlots("theme").slots[2].rows).toHaveLength(8);
		d._rollPick("theme", 2, top);
		// The top of the 1d8 is Corruption (row 8), never the giant-sized 9-12 the whole table ends on.
		expect(d._sel.picks.theme[2]).toBe("Corruption by the Things Below");
	});

	it("offers and rolls a free combine beside a giant-sized pick off the whole table", () => {
		const d = dlg({ manner: "greenLord", picks: { theme: ["Sized for giants", plain[0], ""] } });
		expect(d._pickSlots("theme").slots[2].rows).toHaveLength(themes.length);
		d._rollPick("theme", 2, top);
		expect(d._sel.picks.theme[2]).toBe("Sized for giants");
	});
});

describe("re-opening a site saved under older wording", () => {
	const seedFromPage = (page) => CreateSiteDialog.prototype._seedFromPage.call({}, page);

	it("puts a legacy roll-again answer back on its row", () => {
		const sel = seedFromPage({ name: "Tomb", system: {
			manner: "greenLord",
			picks: [{ key: "theme", label: "Theme", value: "Sized for giants, and roll 1d8 again" }],
			regionId: "labyrinth", terrain: "An obstruction, and roll 1d10 again",
		} });
		expect(sel.picks.theme).toEqual(["Sized for giants"]);
		expect(sel.terrain).toEqual(["An obstruction"]);
		// And the 1d8 it was owed is on offer again.
		expect(on({ ...blankSel(), ...sel })._pickSlots("theme").canAdd).toBe(true);
	});

	it("keeps a branch whose opening row no longer matches, and its answers, through a save", () => {
		const sel = seedFromPage({ name: "Tomb", system: {
			manner: "greenLord",
			picks: [
				{ key: "site", label: "What kind of site?", value: "Lingering signs, as it was once worded" },
				{ key: "sign", label: "Lingering sign", value: "Strange plants" },
			],
		} });
		const saved = shapeSiteSystem(on({ ...blankSel(), ...sel })._seed());
		expect(saved.picks.map(p => [p.key, p.value])).toEqual([
			["site", "Lingering signs, as it was once worded"],
			["sign", "Strange plants"],
		]);
	});
});

describe("a region's further tables", () => {
	const dlg = (sel) => on({ ...blankSel(), ...sel });
	const building = `${REGION_TABLE_PREFIX}building`;
	const purpose = `${REGION_TABLE_PREFIX}purpose`;

	it("opens the Ruined Tower's building off its terrain and the purpose off the building", () => {
		const d = dlg({ regionId: "ruinedTower" });
		expect(d._pickSlots(building).slots).toEqual([]);
		d._setPick(TERRAIN_KEY, 0, "A building, at least somewhat intact");
		expect(d._pickSlots(building).slots[0]).toMatchObject({ label: "Building", hint: "1d12" });
		d._setPick(building, 0, "From before the tower's fall");
		d._setPick(purpose, 0, "Esoterica/experimentation");
		expect(d._seed().picks).toEqual([
			{ key: building, label: "Building", value: "From before the tower's fall" },
			{ key: purpose, label: "Purpose", value: "Esoterica/experimentation" },
		]);
	});

	it("drops the building and its purpose when the terrain changes away from it", () => {
		const d = dlg({ regionId: "ruinedTower" });
		d._setPick(TERRAIN_KEY, 0, "A building, at least somewhat intact");
		d._setPick(building, 0, "Built after the tower's fall");
		d._setPick(purpose, 0, "Home/barracks/living space");
		d._setPick(TERRAIN_KEY, 0, "Mud/standing water/deep snow");
		expect(d._sel.regionPicks).toEqual({});
		expect(d._seed().picks).toEqual([]);
	});

	it("carries the further picks out to the page and back", () => {
		const d = dlg({ manner: "cave", regionId: "ruinedTower" });
		d._setPick("structure", 0, "Long, narrow, meandering");
		d._setPick(TERRAIN_KEY, 0, "A building, at least somewhat intact");
		d._setPick(building, 0, "From before the tower's fall");
		d._setPick(purpose, 0, "Work/production/creation");
		const saved = shapeSiteSystem(d._seed());
		const sel = CreateSiteDialog.prototype._seedFromPage.call({}, { name: "T", system: saved });
		expect(sel.picks).toEqual({ structure: ["Long, narrow, meandering"] });
		expect(sel.regionPicks).toEqual({ building: ["From before the tower's fall"], purpose: ["Work/production/creation"] });
	});
});

describe("Roll the lot", () => {
	const dlg = (sel) => on({ ...blankSel(), ...sel });

	it("leaves the tables the book makes conditional for the GM to roll on their own", () => {
		const haunted = dlg({ manner: "haunted" });
		haunted._rollAll(() => 0);
		expect(Object.keys(haunted._sel.picks)).toEqual(["theme", "howLong", "origins"]);
		const cave = dlg({ manner: "cave" });
		cave._rollAll(() => 0);
		expect(Object.keys(cave._sel.picks)).not.toContain("beast");
		expect(Object.keys(cave._sel.picks)).toContain("discovery");
		// Still rollable one at a time.
		cave._rollPick("beast", 0, () => 0);
		expect(cave._sel.picks.beast).toEqual(["Bats. So many bats"]);
	});

	describe("a Manner or Region switch sets answers aside rather than losing them", () => {
		it("brings a manner's answers back when it is chosen again", () => {
			const d = dlg({ manner: "cave" });
			d._setPick("structure", 0, "Long, narrow, meandering");
			d._switchManner("haunted");
			expect(d._sel.picks).toEqual({});
			d._rollAll(() => 0);
			const haunted = structuredClone(d._sel.picks);
			d._switchManner("cave");
			expect(d._sel.picks).toEqual({ structure: ["Long, narrow, meandering"] });
			d._switchManner("haunted");
			expect(d._sel.picks).toEqual(haunted);
			// Nothing set aside rides into the write-up.
			expect(d._seed().picks.every(p => haunted[p.key])).toBe(true);
		});

		it("brings a region's terrain, and the tables it opened, back likewise", () => {
			const d = dlg({ regionId: "ruinedTower", regionPicks: {} });
			d._setPick(TERRAIN_KEY, 0, "A building, at least somewhat intact");
			d._setPick(`${REGION_TABLE_PREFIX}building`, 0, "Built after the tower's fall");
			const before = { terrain: [...d._sel.terrain], regionPicks: structuredClone(d._sel.regionPicks) };
			d._switchRegion("greatWood");
			expect([d._sel.terrain, d._sel.regionPicks]).toEqual([[], {}]);
			d._switchRegion("ruinedTower");
			expect({ terrain: d._sel.terrain, regionPicks: d._sel.regionPicks }).toEqual(before);
		});

		it("keeps what it set aside across a reload", () => {
			const left = dlg({ manner: "cave" });
			left._step = 0;
			left._setPick("structure", 0, "Long, narrow, meandering");
			left._switchManner("haunted");
			const view = JSON.parse(JSON.stringify({ step: null, sel: left._sel, setAside: left._setAside }));
			const back = dlg({});
			back._takeRestoredView(view);
			back._switchManner("cave");
			expect(back._sel.picks).toEqual({ structure: ["Long, narrow, meandering"] });
		});
	});

	describe("asks before throwing answers away", () => {
		afterEach(() => { delete globalThis.foundry?.applications?.api?.DialogV2; });

		it("goes straight ahead while the manner's tables are empty", async () => {
			const wait = stubConfirm(false);
			expect(await dlg({ manner: "cave" })._confirmRollAll()).toBe(true);
			expect(wait).not.toHaveBeenCalled();
		});

		it("asks once any table has an answer, and keeps them unless told otherwise", async () => {
			const d = dlg({ manner: "cave" });
			d._setPick("structure", 0, "Long, narrow, meandering");
			const wait = stubConfirm(false);
			expect(await d._confirmRollAll()).toBe(false);
			expect(wait).toHaveBeenCalledOnce();
			const asked = wait.mock.calls[0][0];
			expect(asked.content).toContain("an answer");
			// Enter lands on keeping them.
			expect(asked.buttons.find(b => b.default).action).toBe("no");
			stubConfirm(null);
			expect(await d._confirmRollAll()).toBe(false);
			stubConfirm(true);
			expect(await d._confirmRollAll()).toBe(true);
		});

		it("counts a hand-picked conditional answer, which rolling the lot clears and never re-rolls", async () => {
			const d = dlg({ manner: "cave" });
			d._setPick("beast", 0, "Bats. So many bats");
			const wait = stubConfirm(false);
			expect(await d._confirmRollAll()).toBe(false);
			expect(wait).toHaveBeenCalledOnce();
		});

		it("doesn't count terrain, which rolling the lot leaves alone", async () => {
			const d = dlg({ manner: "cave", regionId: "greatWood" });
			d._setPick(TERRAIN_KEY, 0, "Dense thicket");
			const wait = stubConfirm(false);
			expect(await d._confirmRollAll()).toBe(true);
			expect(wait).not.toHaveBeenCalled();
		});
	});
});
