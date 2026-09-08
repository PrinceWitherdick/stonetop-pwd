import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { fakeEl } from "../fakes/dom.js";
import { wireTabSearch } from "../../module/utils/tab-search.js";

// The magnifying-glass filter on the sheets' tabs (module/utils/tab-search.js). It hides rows by
// class, live, without a re-render.
//
// What these are really about is the OTHER re-render: the one the reader didn't ask for. Rolling a
// move from its title writes to the actor, the sheet repaints, and the box, its term and every
// hidden card were DOM state on a tree Foundry had just thrown away. The reader got the whole
// unfiltered list back, scrolled to the top, mid-search. So the term is kept in a store the
// application owns and re-applied on the next wiring, which is what "survives a re-render" means
// here: not the same elements, the same reading.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, "../..", rel), "utf8");

/** One rendered tab: the collapsed search control, plus a card per name. */
function buildTab(names) {
	const scope = fakeEl({ cls: ["tab", "moves"] });
	const box    = fakeEl({ cls: ["stonetop-tab-search"], parent: scope });
	const input  = fakeEl({ cls: ["stonetop-tab-search-input"], parent: box });
	const toggle = fakeEl({ cls: ["stonetop-tab-search-toggle"], parent: box });
	const items = names.map(name => {
		const item = fakeEl({ cls: ["stonetop-item"], parent: scope });
		item.textContent = name;
		return item;
	});
	return { scope, box, input, toggle, items };
}

const fire = (node, type, ev = {}) => { for (const fn of node.handlers[type] ?? []) fn(ev); };

/** Type a term into an open box, the way the input event arrives. */
function type(tab, term) {
	fire(tab.toggle, "click");
	tab.input.value = term;
	fire(tab.input, "input", {});
}

const hidden = tab => tab.items.filter(i => i.classes.includes("stonetop-search-hidden")).map(i => i.textContent);
const shown  = tab => tab.items.filter(i => !i.classes.includes("stonetop-search-hidden")).map(i => i.textContent);

const wire = (tab, opts = {}) => wireTabSearch(tab.scope, {
	itemSel: ".stonetop-item",
	textFor: el => el.textContent,
	...opts,
});

const NAMES = ["Defy Danger", "Defend", "Persuade", "Volley"];

describe("tab search", () => {
	it("hides everything the term does not match, and flags the scope", () => {
		const tab = buildTab(NAMES);
		wire(tab);
		type(tab, "def");

		expect(shown(tab)).toEqual(["Defy Danger", "Defend"]);
		expect(hidden(tab)).toEqual(["Persuade", "Volley"]);
		expect(tab.scope.classes).toContain("is-searching");
	});

	it("brings the term, the open box and the hidden cards back on the next render", () => {
		const memory = {};
		const first = buildTab(NAMES);
		wire(first, { memory, key: "moves" });
		type(first, "def");

		// The re-render: a wholly new tree, wired against the same store.
		const second = buildTab(NAMES);
		const onFilter = vi.fn();
		wire(second, { memory, key: "moves", onFilter });

		expect(second.input.value).toBe("def");
		expect(second.box.classes).toContain("is-open");
		expect(shown(second)).toEqual(["Defy Danger", "Defend"]);
		expect(second.scope.classes).toContain("is-searching");
		// Focus stays where the click that caused the render left it.
		expect(second.input.focused).toBe(false);
		// `onFilter` here would still be the PREVIOUS render's packer, holding containers this
		// tree has replaced; this render packs itself, after this, from the classes just set.
		expect(onFilter).not.toHaveBeenCalled();
	});

	it("keeps one store's controls apart by key", () => {
		const memory = {};
		const major = buildTab(NAMES);
		const minor = buildTab(NAMES);
		wire(major, { memory, key: "arcanaMajor" });
		wire(minor, { memory, key: "arcanaMinor" });
		type(major, "def");

		const nextMinor = buildTab(NAMES);
		wire(nextMinor, { memory, key: "arcanaMinor" });
		expect(nextMinor.input.value).toBe("");
		expect(hidden(nextMinor)).toEqual([]);
	});

	it("forgets a term the reader cleared, by Escape or by closing the box", () => {
		for (const clear of [
			tab => fire(tab.input, "keydown", { key: "Escape" }),
			tab => fire(tab.toggle, "click"),
		]) {
			const memory = {};
			const tab = buildTab(NAMES);
			wire(tab, { memory, key: "moves" });
			type(tab, "def");
			clear(tab);

			expect(memory.moves).toBe("");
			const next = buildTab(NAMES);
			wire(next, { memory, key: "moves" });
			expect(next.box.classes).not.toContain("is-open");
			expect(hidden(next)).toEqual([]);
		}
	});

	it("still works for a caller that keeps no memory at all", () => {
		const tab = buildTab(NAMES);
		wire(tab);
		type(tab, "vol");
		expect(shown(tab)).toEqual(["Volley"]);
	});
});

describe("the sheets that mount one", () => {
	// Cheap, and it is the wiring that broke: the util can remember all it likes while a call
	// site that passes no store hands the reader the unfiltered list back anyway.
	const stores = {
		"module/actors/character/StonetopCharacterSheet.js": 5,
		"module/actors/steading/StonetopSteadingSheet.js": 2,
	};
	for (const [file, calls] of Object.entries(stores)) {
		it(`${path.basename(file)} gives every filter a slot in one sheet-level store`, () => {
			const src = read(file);
			expect(src).toContain("this._tabSearchTerms ??= {}");
			const wired = src.match(/wireTabSearch\(/g)?.length ?? 0;
			const remembered = src.match(/memory: searchTerms, key:/g)?.length ?? 0;
			expect(remembered).toBe(wired);
			expect(wired).toBe(calls);
		});
	}
});
