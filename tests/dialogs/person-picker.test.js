import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { PersonPickerDialog, pickPerson } from "../../module/dialogs/PersonPickerDialog.js";

// "Who goes on the map?": the window that replaced a single alphabetical column of everybody in
// the world with a rail of the village's own lists.
//
// The three things worth pinning are the three that made it worth building, and none of them is
// visible from the grouping helper next door:
//  • the find box narrows EVERY list and says how many are left in each, so a name on a list the
//    reader is not looking at is still findable;
//  • a pick made on one list survives moving to another, and the button says whose name it is
//    holding, because otherwise that pick is a decision the window made in secret;
//  • Enter picks but does not add.
//
// The suite runs in node, so the root is a stand-in answering the handful of selectors this path
// asks for. The markup itself is rendered from the real template at the bottom.

const ROOT = path.resolve(import.meta.dirname, "../..");
const template = Handlebars.compile(
	fs.readFileSync(path.join(ROOT, "templates/dialogs/person-picker.hbs"), "utf8"));

/** The lists, as `groupPeople` hands them over. */
const GROUPS = [
	{
		key: "players", label: "Players", hint: "The player characters.", icon: "fa-users",
		people: [
			{ id: "pim", name: "Pim", hint: "The Lightbearer" },
			{ id: "maeve", name: "Maeve", hint: "The Would-Be Hero" },
		],
	},
	{
		key: "residents", label: "Residents", hint: "The people of Stonetop.", icon: "fa-house-chimney",
		people: [
			{ id: "quill", name: "Quill", hint: "smith" },
			{ id: "tovia", name: "Tovia", hint: "" },
		],
	},
];

function makeDialog(groups = GROUPS) {
	const dialog = new PersonPickerDialog({
		title: "Who goes on the map?",
		groups,
		buttonLabel: "Add",
		formatLabel: name => `Add ${name}`,
	});
	dialog._resolveWith = vi.fn();
	return dialog;
}

/**
 * A window root answering the selectors this dialog actually asks for.
 *
 * ONE RADIO GROUP ACROSS EVERY LIST, modelled as one: checking a row unchecks whatever was checked
 * before it, wherever that row lives. That is the behaviour the "keeps the pick" test is about, and
 * a set of independent booleans would let it pass without being true.
 */
function makeRoot(dialog) {
	const data = dialog.getData();
	const radios = [];
	const label = { textContent: data.chooseLabel };
	const button = {
		disabled: true, focused: false,
		focus() { this.focused = true; },
		querySelector: sel => (sel === ".stonetop-person-picker-choose-label" ? label : null),
	};
	const find = { value: "" };
	const counts = new Map(data.groups.map(group => [group.key, { textContent: String(group.count) }]));

	const sections = data.groups.map(group => {
		const items = group.people.map(person => {
			const radio = {
				value: person.id,
				get checked() { return radios.picked === person.id; },
				set checked(on) { if (on) radios.picked = person.id; },
			};
			radios.push(radio);
			return {
				hidden: false,
				dataset: { search: person.search },
				querySelector: sel => (sel.includes("input[name='person']") ? radio : null),
				radio,
			};
		});
		const none = { hidden: true };
		return {
			dataset: { group: group.key },
			hidden: !group.selected,
			items, none,
			querySelectorAll: sel => (sel === ".stonetop-person-picker-item" ? items : []),
			querySelector(sel) {
				if (sel === ".stonetop-person-picker-none") return none;
				if (sel.startsWith(".stonetop-person-picker-item:not([hidden])")) {
					return items.find(item => !item.hidden)?.radio ?? null;
				}
				return null;
			},
		};
	});

	const root = {
		sections, button, label, find, counts,
		count: key => counts.get(key).textContent,
		section: key => sections.find(s => s.dataset.group === key),
		querySelectorAll: sel => (sel === ".stonetop-person-picker-group" ? sections : []),
		querySelector(sel) {
			if (sel === ".stonetop-person-picker-find-input") return find;
			if (sel === "[data-person-picker='choose']") return button;
			if (sel === "input[name='person']:checked") return radios.find(r => r.checked) ?? null;
			if (sel === ".stonetop-person-picker-group:not([hidden])") return sections.find(s => !s.hidden) ?? null;
			const forKey = sel.match(/\[data-count-for="([^"]+)"\]/);
			return forKey ? (counts.get(forKey[1]) ?? null) : null;
		},
	};
	return root;
}

/** Type into the find box, as a keystroke does. */
function type(dialog, root, text) {
	root.find.value = text;
	dialog._applyFilter(root);
}

beforeEach(() => {
	global.game = { i18n: global.game.i18n, actors: undefined };
});

describe("the button, which is where the answer is", () => {
	// It opens dead and unnamed on purpose: there is no default person, and a live "Add" over a
	// list nobody has answered is an offer to add whoever happens to be first.
	it("opens dead, with nobody named", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		dialog._syncChoice(root);
		expect(root.button.disabled).toBe(true);
		expect(root.label.textContent).toBe("Add");
	});

	it("names the person once one is picked", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		root.section("residents").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(root.button.disabled).toBe(false);
		expect(root.label.textContent).toBe("Add Quill");
	});

	// ⚠ THE REASON THE BUTTON CARRIES A NAME AT ALL. A pick survives moving to another list, so
	// the person it is about can be off screen; a button still reading "Add" would be a window
	// that had quietly decided something for the reader.
	it("keeps naming somebody whose list is no longer showing", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		root.section("players").items[1].radio.checked = true;
		dialog._syncChoice(root);
		root.section("players").hidden = true;
		root.section("residents").hidden = false;
		dialog._syncChoice(root);
		expect(root.label.textContent).toBe("Add Maeve");
		dialog._choose(root);
		expect(dialog._resolveWith).toHaveBeenCalledWith("maeve");
	});
});

describe("the find box", () => {
	it("narrows the list in front of the reader", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "quill");
		expect(root.section("residents").items.map(i => i.hidden)).toEqual([false, true]);
	});

	// ⚠ EVERY LIST, NOT THE ONE SHOWING. This is what the counts on the rail are for: a reader
	// looking for Maeve under Residents can see that the one Maeve in this world is a player
	// without going and checking each list by hand.
	it("says how many are left on every other list too", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "mae");
		expect(root.count("players")).toBe("1");
		expect(root.count("residents")).toBe("0");
	});

	it("matches the note beside a name, so a trade or a home finds somebody", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "smith");
		expect(root.section("residents").items.map(i => i.hidden)).toEqual([false, true]);
	});

	it("says so on a list it has narrowed to nothing, and takes it back", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "mae");
		expect(root.section("residents").none.hidden).toBe(false);
		type(dialog, root, "");
		expect(root.section("residents").none.hidden).toBe(true);
		expect(root.count("residents")).toBe("2");
	});
});

describe("Enter, in the find box", () => {
	// ⚠ IT PICKS BUT DOES NOT ADD. Three quick keystrokes must not be able to put the wrong person
	// on the map without their name having been on screen: the confirm is a second press, on a
	// button that by then says who it is about.
	it("takes the first name still showing, and adds nobody", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "mae");
		dialog._takeFirstMatch(root);
		expect(root.section("players").items[1].radio.checked).toBe(true);
		expect(root.label.textContent).toBe("Add Maeve");
		expect(root.button.focused).toBe(true);
		expect(dialog._resolveWith).not.toHaveBeenCalled();
	});

	it("does nothing when nothing on this list matches", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "nobody at all");
		dialog._takeFirstMatch(root);
		expect(root.button.disabled).toBe(true);
	});
});

describe("settling", () => {
	it("hands back the person who was picked", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		root.section("players").items[0].radio.checked = true;
		dialog._onButton("choose", root);
		expect(dialog._resolveWith).toHaveBeenCalledWith("pim");
	});

	it("hands back nothing when the reader backs out", () => {
		const dialog = makeDialog();
		dialog._onButton("cancel", makeRoot(dialog));
		expect(dialog._resolveWith).toHaveBeenCalledWith(null);
	});

	// A double click lands on `_choose` whether or not the click before it checked anything, so
	// "nobody is picked" has to be a no-op rather than an answer of null: null is what backing
	// out means, and the caller cannot tell the two apart.
	it("settles nothing at all when nobody is picked", () => {
		const dialog = makeDialog();
		dialog._choose(makeRoot(dialog));
		expect(dialog._resolveWith).not.toHaveBeenCalled();
	});

	it("does not open a window with nobody to offer", async () => {
		await expect(pickPerson({ title: "Who?", groups: [] })).resolves.toBeNull();
		await expect(pickPerson({ title: "Who?", groups: [{ key: "players", people: [] }] }))
			.resolves.toBeNull();
	});
});

describe("the markup it renders", () => {
	const render = (groups = GROUPS) => template(makeDialog(groups).getData());

	it("puts every list on the rail, with its count", () => {
		const html = render();
		expect(html).toContain('data-group="players"');
		expect(html).toContain('data-count-for="players"');
		expect(html).toContain("Residents");
	});

	// The rail switches lists by toggling `hidden`, so exactly one section may open without it.
	it("opens with one list showing", () => {
		const html = render();
		const sections = [...html.matchAll(/<section class="stonetop-person-picker-group"[^>]*>/g)];
		expect(sections).toHaveLength(2);
		expect(sections.filter(s => !s[0].includes("hidden"))).toHaveLength(1);
	});

	it("draws a row per person, with the note beside the name", () => {
		const html = render();
		expect(html).toContain('value="pim"');
		expect(html).toContain("The Lightbearer");
		expect(html).toContain('value="tovia"');
	});

	it("folds each row's searchable text to lower case at render", () => {
		expect(render()).toContain('data-search="pim the lightbearer"');
	});

	it("opens with the confirm button disabled", () => {
		expect(render()).toMatch(/data-person-picker="choose"\s+disabled/);
	});

	// A rail with one entry is chrome that cannot be used, and it costs the names the width it
	// sits in.
	it("leaves the rail off a single list", () => {
		const html = render([GROUPS[0]]);
		expect(html).not.toContain("stonetop-person-picker-tab");
		expect(html).toContain('value="pim"');
	});
});
