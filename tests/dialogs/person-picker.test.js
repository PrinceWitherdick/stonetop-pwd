import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { PersonPickerDialog, pickPerson } from "../../module/dialogs/PersonPickerDialog.js";
import { frameEl } from "../fakes/frame-dom.js";

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
// AND THE SAME WINDOW ANSWERING WITH SEVERAL NAMES (`multiple`), which is what "who goes on the
// map" asks now. What is pinned there is what a second answer changes and nothing else: ticking a
// second name keeps the first (a radio group would not), the strip under the find box spells out
// who is going and each chip takes one back off, Enter clears the find box instead of jumping to
// the button, and the whole thing settles as an ARRAY while the one-answer question still settles
// as a bare id.
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

function makeDialog(groups = GROUPS, extra = {}) {
	const dialog = new PersonPickerDialog({
		title: "Who goes on the map?",
		groups,
		buttonLabel: "Add",
		formatLabel: name => `Add ${name}`,
		...extra,
	});
	dialog._resolveWith = vi.fn();
	return dialog;
}

/** The same window asked to take as many answers as the reader ticks. */
function makeMultiDialog(groups = GROUPS) {
	return makeDialog(groups, {
		multiple: true,
		formatManyLabel: count => `Add ${count} people`,
	});
}

/**
 * The tiny `document` the chip strip is built into.
 *
 * Only reached on the several-answers question, and only because `_paintChosen` builds its nodes
 * rather than rendering them: the suite has no DOM of its own (vitest.config.js runs on `node`).
 * `frameEl` is the element the PDF reader's tab is built out of, and it already answers exactly
 * the handful of things this path touches.
 */
function fakeDocument() {
	const doc = {};
	doc.createElement = tag => frameEl(doc, tag);
	return doc;
}

/**
 * A window root answering the selectors this dialog actually asks for.
 *
 * ONE RADIO GROUP ACROSS EVERY LIST, modelled as one: checking a row unchecks whatever was checked
 * before it, wherever that row lives. That is the behaviour the "keeps the pick" test is about, and
 * a set of independent booleans would let it pass without being true.
 *
 * ⚠ AND INDEPENDENT BOOLEANS WHERE THE QUESTION TAKES SEVERAL, which is what a column of checkboxes
 * is. Modelling that side as a radio group too would let "ticking a second name keeps the first"
 * pass on a window where it does not, which is the one thing that mode exists for.
 */
function makeRoot(dialog) {
	const data = dialog.getData();
	const multiple = !!data.multiple;
	const boxes = [];
	const label = { textContent: data.chooseLabel };
	const button = {
		disabled: true, focused: false,
		focus() { this.focused = true; },
		querySelector: sel => (sel === ".stonetop-person-picker-choose-label" ? label : null),
	};
	const find = { value: "", focused: false, focus() { this.focused = true; } };
	const counts = new Map(data.groups.map(group => [group.key, { textContent: String(group.count) }]));

	// The strip of ticked names, on the question that has one. `hidden` starts true, as the
	// template renders it.
	const doc = fakeDocument();
	// `_paintChosen` reaches for the global, as anything building nodes does; there is no DOM on
	// this environment, so the root that is about to be handed to it brings one.
	if (multiple) global.document = doc;
	const chosenList = multiple ? frameEl(doc, "ul") : null;
	const chosenBox = multiple ? Object.assign(frameEl(doc, "div"), { hidden: true }) : null;

	const sections = data.groups.map(group => {
		const items = group.people.map(person => {
			const box = multiple
				? { value: person.id, checked: false }
				: {
					value: person.id,
					get checked() { return boxes.picked === person.id; },
					set checked(on) { if (on) boxes.picked = person.id; },
				};
			boxes.push(box);
			return {
				hidden: false,
				dataset: { search: person.search },
				querySelector: sel => (sel.includes("input[name='person']") ? box : null),
				radio: box,
			};
		});
		const none = { hidden: true };
		// "Select all", one per list and only on the question that takes several. Three
		// states rather than two: `indeterminate` is what part of a list ticked looks like.
		const all = multiple
			? { checked: false, indeterminate: false, disabled: false, dataset: { allFor: group.key } }
			: null;
		return {
			dataset: { group: group.key },
			hidden: !group.selected,
			items, none, all,
			querySelectorAll: sel => (sel === ".stonetop-person-picker-item" ? items : []),
			querySelector(sel) {
				if (sel === ".stonetop-person-picker-none") return none;
				if (sel === ".stonetop-person-picker-all-check") return all;
				if (sel.startsWith(".stonetop-person-picker-item:not([hidden])")) {
					return items.find(item => !item.hidden)?.radio ?? null;
				}
				return null;
			},
		};
	});

	const root = {
		sections, button, label, find, counts, chosenBox, chosenList,
		count: key => counts.get(key).textContent,
		section: key => sections.find(s => s.dataset.group === key),
		/** The names on the chips, in the order they are shown. */
		chips: () => (chosenList?.children ?? []).map(item => item.children[0].text().trim()),
		querySelectorAll(sel) {
			if (sel === ".stonetop-person-picker-group") return sections;
			if (sel === "input[name='person']:checked") return boxes.filter(b => b.checked);
			return [];
		},
		querySelector(sel) {
			if (sel === ".stonetop-person-picker-find-input") return find;
			if (sel === "[data-person-picker='choose']") return button;
			if (sel === "input[name='person']:checked") return boxes.find(r => r.checked) ?? null;
			if (sel === ".stonetop-person-picker-group:not([hidden])") return sections.find(s => !s.hidden) ?? null;
			if (sel === ".stonetop-person-picker-chosen") return chosenBox;
			if (sel === ".stonetop-person-picker-chosen-list") return chosenList;
			const byValue = sel.match(/^input\[name='person'\]\[value="([^"]+)"\]$/);
			if (byValue) return boxes.find(b => b.value === byValue[1]) ?? null;
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

	// ⚠ AND ON THE SEVERAL-ANSWERS QUESTION IT STAYS PUT, with the box empty. A reader ticking off
	// a household types one name after another, and a find box still holding the last one is a box
	// they have to clear by hand between each; jumping to the button would be worse still, because
	// the answer is not finished. It still adds nobody.
	it("clears the find box and stays in it when several answers are wanted", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "mae");
		dialog._takeFirstMatch(root);
		expect(root.section("players").items[1].radio.checked).toBe(true);
		expect(root.find.value).toBe("");
		expect(root.find.focused).toBe(true);
		expect(root.button.focused).toBe(false);
		expect(dialog._resolveWith).not.toHaveBeenCalled();
		// And the list it narrowed is whole again, ready for the next name.
		expect(root.section("residents").items.map(i => i.hidden)).toEqual([false, false]);
	});
});

describe("the question that takes several answers", () => {
	// ⚠ THE WHOLE POINT. A second tick must not undo the first, which is the difference between a
	// column of checkboxes and the radio group the one-answer question uses.
	it("keeps a name ticked when the next one is ticked", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		root.section("players").items[0].radio.checked = true;
		root.section("residents").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(dialog._picked(root)).toEqual(["pim", "quill"]);
	});

	it("names the one person while there is only one, and counts them after that", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		expect(root.label.textContent).toBe("Add");
		root.section("players").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(root.label.textContent).toBe("Add Pim");
		expect(root.button.disabled).toBe(false);
		root.section("residents").items[1].radio.checked = true;
		dialog._syncChoice(root);
		expect(root.label.textContent).toBe("Add 2 people");
	});

	// ⚠ WHY THE STRIP IS THERE AT ALL. A pick survives both moving between lists and the find box
	// hiding its row, so by the third name every row the reader ticked can be off screen: "Add 3
	// people" over a list showing none of them is the window deciding three things in secret.
	it("spells out who is going, even once their rows are filtered away", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		root.section("players").items[1].radio.checked = true;
		root.section("residents").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(root.chosenBox.hidden).toBe(false);
		expect(root.chips()).toEqual(["Maeve", "Quill"]);
		type(dialog, root, "nobody at all");
		dialog._syncChoice(root);
		expect(root.chips()).toEqual(["Maeve", "Quill"]);
	});

	it("takes somebody back off from their chip, and puts the strip away with the last of them", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		root.section("players").items[0].radio.checked = true;
		root.section("players").items[1].radio.checked = true;
		dialog._syncChoice(root);
		dialog._unpick(root, "pim");
		expect(root.chips()).toEqual(["Maeve"]);
		expect(root.label.textContent).toBe("Add Maeve");
		dialog._unpick(root, "maeve");
		expect(root.chosenBox.hidden).toBe(true);
		expect(root.button.disabled).toBe(true);
		expect(root.label.textContent).toBe("Add");
	});

	// ⚠ SHOWING, NOT HOLDING. This is the whole of what "Select all" promises here, and the thing
	// that makes it worth having beside a find box: "everybody from Marshedge" is two keystrokes
	// and one press. A tick-all that reached past the filter would put names on the board that
	// were never on screen.
	it("ticks the names one list is showing, and not the ones the find box has hidden", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "pim");
		dialog._toggleAll(root, "players", true);
		expect(dialog._picked(root)).toEqual(["pim"]);
	});

	// And not across into a list the reader is not looking at: a board is set up one household at
	// a time, which is why the control is per list rather than one over the window.
	it("leaves the other lists alone", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		dialog._toggleAll(root, "players", true);
		expect(dialog._picked(root)).toEqual(["pim", "maeve"]);
		expect(root.label.textContent).toBe("Add 2 people");
		expect(root.chips()).toEqual(["Pim", "Maeve"]);
	});

	it("takes the same list back off again", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		dialog._toggleAll(root, "players", true);
		dialog._toggleAll(root, "players", false);
		expect(dialog._picked(root)).toEqual([]);
		expect(root.button.disabled).toBe(true);
	});

	// ⚠ IT IS A READOUT TOO. A box still claiming everyone is going while four of six names are
	// ticked is the window saying something untrue about what it is about to do, so the three
	// states have to follow the rows however they were ticked -- by hand, or by the box itself.
	it("goes part-way when part of a list is ticked, and whole when all of it is", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		const all = root.section("players").all;
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(false);
		root.section("players").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(true);
		root.section("players").items[1].radio.checked = true;
		dialog._syncChoice(root);
		expect(all.checked).toBe(true);
		expect(all.indeterminate).toBe(false);
	});

	// The find box changes what "everyone" means, so it has to change what the box says: a list
	// ticked whole and then narrowed is still whole, and one ticked whole then WIDENED is not.
	it("re-reads itself as the find box narrows the list under it", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		const all = root.section("players").all;
		root.section("players").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(all.indeterminate).toBe(true);
		type(dialog, root, "pim");
		expect(all.checked).toBe(true);
		expect(all.indeterminate).toBe(false);
		type(dialog, root, "");
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(true);
	});

	// A live box over a list showing nobody would tick nothing while looking like it had.
	it("goes dead over a list the find box has emptied", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		type(dialog, root, "nobody at all");
		expect(root.section("players").all.disabled).toBe(true);
		type(dialog, root, "");
		expect(root.section("players").all.disabled).toBe(false);
	});

	// The strip belongs to the several-answers question alone: on the other one the button already
	// names the single person it is about, and there is nothing a receipt would add.
	it("draws no strip on the one-answer question", () => {
		const dialog = makeDialog();
		const root = makeRoot(dialog);
		root.section("players").items[0].radio.checked = true;
		dialog._syncChoice(root);
		expect(root.chosenBox).toBe(null);
		expect(root.label.textContent).toBe("Add Pim");
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

	// ⚠ AN ARRAY, AND ONLY WHEN SEVERAL WERE ASKED FOR. The one-answer question still settles on a
	// bare id above; a caller told them apart by the shape of the answer would break the day one
	// reader happened to tick exactly one name, so it is the QUESTION that decides.
	it("hands back every ticked name, in list order, when several were asked for", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		root.section("residents").items[0].radio.checked = true;
		root.section("players").items[1].radio.checked = true;
		dialog._onButton("choose", root);
		expect(dialog._resolveWith).toHaveBeenCalledWith(["maeve", "quill"]);
	});

	it("settles on one name as a list of one rather than as a name", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		root.section("players").items[0].radio.checked = true;
		dialog._choose(root);
		expect(dialog._resolveWith).toHaveBeenCalledWith(["pim"]);
	});

	// Backing out is null on both questions, not an empty list: "never mind" is a thing a caller
	// may want to tell apart from an answer, and the button is dead until somebody is ticked, so an
	// empty answer can never come out of the window anyway.
	it("still hands back nothing when the reader backs out of the several-answer question", () => {
		const dialog = makeMultiDialog();
		const root = makeRoot(dialog);
		dialog._onButton("cancel", root);
		expect(dialog._resolveWith).toHaveBeenCalledWith(null);
		dialog._choose(root);
		expect(dialog._resolveWith).toHaveBeenCalledTimes(1);
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

	// One control asking two questions: the NAME is `person` either way, which is what every
	// selector in the dialog reads, and only the type says how many answers it takes.
	it("draws radios for one answer and checkboxes for several", () => {
		expect(render()).toContain('<input type="radio" class="stonetop-person-picker-radio" name="person" value="pim">');
		const many = template(makeMultiDialog().getData());
		expect(many).toContain('<input type="checkbox" class="stonetop-person-picker-check" name="person" value="pim">');
		expect(many).not.toContain('type="radio"');
	});

	// ⚠ THE SKIN IS A CLASS, AND THE CLASS IS THE ONLY THING THAT PUTS IT ON. Foundry v13's core
	// `input[type=checkbox]` rule forces a native browser box, so a checkbox that is not on the
	// master block in stonetop.css silently renders as one -- which is the whole reason the type
	// and the class are decided together in `getData` rather than the class being hard-coded here
	// beside a type that changes. tests/styles/person-picker-checkbox.test.js holds the other half:
	// that this class is actually on that block.
	it("puts the SVG checkbox class on every checkbox it draws, and on no radio", () => {
		const many = template(makeMultiDialog().getData());
		const checkboxes = [...many.matchAll(/<input type="checkbox"[^>]*>/g)].map(m => m[0]);
		expect(checkboxes.length).toBeGreaterThan(0);
		for (const box of checkboxes) expect(box).toContain("stonetop-person-picker-check");
		expect(render()).not.toContain("stonetop-person-picker-check");
	});

	// Empty at render and hidden with it: the dialog fills the strip as rows are ticked, so markup
	// that shipped a name in it would be a name nobody had picked.
	it("puts an empty picks strip on the several-answer question only", () => {
		expect(render()).not.toContain("stonetop-person-picker-chosen");
		const many = template(makeMultiDialog().getData());
		expect(many).toMatch(/class="stonetop-person-picker-chosen"\s+hidden/);
		expect(many).toMatch(/<ul class="stonetop-person-picker-chosen-list"><\/ul>/);
	});

	// One per list, above the names, and nowhere at all on the question that takes one answer --
	// where "everyone" is not a thing a radio group can mean.
	it("puts a tick-all at the top of each list, on the several-answer question only", () => {
		expect(render()).not.toContain("stonetop-person-picker-all");
		const many = template(makeMultiDialog().getData());
		expect([...many.matchAll(/data-all-for="/g)]).toHaveLength(2);
		expect(many).toContain('data-all-for="players"');
		expect(many).toContain("Select all");
		// Above the names it is about, not under them.
		expect(many.indexOf('data-all-for="players"'))
			.toBeLessThan(many.indexOf('value="pim"'));
	});

	// A rail with one entry is chrome that cannot be used, and it costs the names the width it
	// sits in.
	it("leaves the rail off a single list", () => {
		const html = render([GROUPS[0]]);
		expect(html).not.toContain("stonetop-person-picker-tab");
		expect(html).toContain('value="pim"');
	});
});
