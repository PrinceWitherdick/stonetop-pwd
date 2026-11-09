import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The trip's timeline row is the writer's own business (tests/timeline/timeline-expedition-record.test.js);
// here it is only whether the move asks for the triumph, and when.
const { recordTrip, tripLog, homeNow } = vi.hoisted(() => ({
	recordTrip: vi.fn(async () => true),
	tripLog:    { log: { currentId: null, list: [] } },
	homeNow:    { value: false },
}));
vi.mock("../../../module/timeline/timeline-expedition-record.js", () => ({
	recordTrip,
	tripLogStore: () => ({ read: () => tripLog.log }),
	cameHomeNow:  () => homeNow.value,
}));

import { openReturnTriumphant } from "../../../module/actors/steading/return-triumphant.js";
import { stubAsk } from "../../fakes/confirm.js";

// Return Triumphant (Book I p.339) clears one of the steading's marked debilities, or raises
// Fortunes by 1 when none are marked.
//
// The clear used to land on the click that chose it: one press both picked the debility and
// wrote it away, on a sheet nobody was looking at, with no way back. Choosing and committing
// are two acts now. A click only marks the row; the footer button writes it, and it names the
// debility so the press cannot be made blind. There is no Cancel, because the window's own
// close is the way out and a button that does nothing is not worth a slot beside one that does.
//
// The suite runs in Node with no jsdom, so these drive the dialog's own render hook and button
// callback against fakes thin enough to carry only what the module touches, the way
// tests/actors/steading/roll-prompt.test.js does for the roll window.

const DEBILITY_IDS = ["diminished", "lacking", "malcontent"];

function fakeChoice(id) {
	const classes   = new Set();
	const attrs     = {};
	const listeners = { click: [], keydown: [] };
	return {
		dataset:   { choice: id },
		classList: {
			toggle:   (name, on) => (on ? classes.add(name) : classes.delete(name)),
			contains: name => classes.has(name),
		},
		setAttribute: (name, value) => { attrs[name] = value; },
		getAttribute: name => attrs[name],
		addEventListener: (type, fn) => listeners[type]?.push(fn),
		click() { listeners.click.forEach(fn => fn()); },
		/** Drive a keydown and hand back the event, so a test can see what was swallowed. */
		press(key) {
			const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
			listeners.keydown.forEach(fn => fn(event));
			return event;
		},
		selected: () => classes.has("is-selected"),
		checked:  () => attrs["aria-checked"],
	};
}

function fakeRoot(ids) {
	const choices = ids.map(fakeChoice);
	return {
		choices,
		querySelectorAll: sel => (sel === ".stonetop-disaster-choice" ? choices : []),
	};
}

function fakeSteading({ marked = [], fortunes = 0 } = {}) {
	return {
		marked,
		getSystemValue: vi.fn((path, fallback) => {
			const hit = /^attributes\.debilities\.options\.(\w+)\.value$/.exec(path);
			return hit ? marked.includes(hit[1]) : fallback;
		}),
		getStatValue:   vi.fn(() => fortunes),
		setSystemValue: vi.fn(async () => {}),
	};
}

/** Open the move against a steading and hand back the captured Dialog config plus its button. */
async function open(steading, opts) {
	let data, options;
	const applyBtn = { disabled: false, textContent: "" };
	const appEl    = { querySelector: sel => (sel === "button[data-button='apply']" ? applyBtn : null) };
	global.Dialog = vi.fn(function (d, o) {
		data = d;
		options = o;
		this.element = appEl;
		this.render  = vi.fn();
		this.close   = vi.fn();
	});
	await openReturnTriumphant(steading, opts);
	return { data, options, applyBtn };
}

/** Open with debilities marked and run the render hook, as Foundry does on paint. */
async function openPicker({ marked, onApplied } = {}) {
	const steading = fakeSteading({ marked });
	const opened   = await open(steading, { onApplied });
	const root     = fakeRoot(marked);
	opened.data.render([root]);
	return { steading, root, ...opened };
}

let onApplied;

beforeEach(() => {
	onApplied = vi.fn();
	recordTrip.mockClear();
});

describe("picking a debility to clear", () => {
	it("offers the marked debilities and only those, in the book's order", async () => {
		const { data } = await openPicker({ marked: ["malcontent", "diminished"] });
		const offered = [...data.content.matchAll(/data-choice="(\w+)"/g)].map(m => m[1]);
		expect(offered).toEqual(["diminished", "malcontent"]);
	});

	// The whole change: nothing lands until the footer button is pressed.
	it("writes nothing when a row is clicked", async () => {
		const { steading, root } = await openPicker({ marked: DEBILITY_IDS, onApplied });
		root.choices[1].click();
		expect(steading.setSystemValue).not.toHaveBeenCalled();
		expect(onApplied).not.toHaveBeenCalled();
	});

	it("marks the clicked row, and only ever one of them", async () => {
		const { root } = await openPicker({ marked: DEBILITY_IDS });
		root.choices[1].click();
		expect(root.choices.map(c => c.selected())).toEqual([false, true, false]);
		expect(root.choices.map(c => c.checked())).toEqual(["false", "true", "false"]);

		root.choices[2].click();
		expect(root.choices.map(c => c.selected())).toEqual([false, false, true]);
		expect(root.choices.map(c => c.checked())).toEqual(["false", "false", "true"]);
	});

	// Core hands the render callback jQuery on v13 and there is no promise it always will — which
	// is why the line above this one in the source already tests `dialog.element` both ways. Bare
	// `html[0]` threw one line AFTER the button was disabled and before any row was wired, so the
	// window that came up had a dead button, dead rows, and no way to make the move at all.
	it("wires the rows whether core hands it an element or jQuery", async () => {
		const steading = fakeSteading({ marked: DEBILITY_IDS });
		const opened   = await open(steading, { onApplied });
		const root     = fakeRoot(DEBILITY_IDS);

		expect(() => opened.data.render(root)).not.toThrow();
		root.choices[1].click();
		expect(root.choices.map(c => c.selected())).toEqual([false, true, false]);
		expect(opened.applyBtn.disabled).toBe(false);
	});
});

describe("the button that commits it", () => {
	it("is the only one, and it is not a Cancel", async () => {
		const { data } = await openPicker({ marked: ["lacking"] });
		expect(Object.keys(data.buttons)).toEqual(["apply"]);
		// Named as the default too: Foundry submits `data.buttons[data.default]` on Enter, and an
		// undefined default throws inside Dialog#submit rather than doing nothing.
		expect(data.default).toBe("apply");
	});

	it("starts disabled, because nothing is picked yet", async () => {
		const { applyBtn } = await openPicker({ marked: DEBILITY_IDS });
		expect(applyBtn.disabled).toBe(true);
	});

	it("wakes up naming the debility it will clear", async () => {
		const { root, applyBtn } = await openPicker({ marked: DEBILITY_IDS });
		root.choices[0].click();
		expect(applyBtn.disabled).toBe(false);
		expect(applyBtn.textContent).toBe("Clear Diminished");

		root.choices[2].click();
		expect(applyBtn.textContent).toBe("Clear Malcontent");
	});

	it("clears the picked debility, attributed to the move", async () => {
		const { steading, root, data } = await openPicker({ marked: DEBILITY_IDS, onApplied });
		root.choices[1].click();
		await data.buttons.apply.callback();

		expect(steading.setSystemValue).toHaveBeenCalledWith(
			"attributes.debilities.options.lacking.value", false,
			{ stonetopMove: "Return Triumphant" });
		expect(steading.setSystemValue).toHaveBeenCalledOnce();
		expect(onApplied).toHaveBeenCalledOnce();
	});

	// Enter submits the default button from anywhere in the window and `disabled` only stops the
	// click, so the callback has to survive being reached with no pick. It closes writing nothing.
	it("writes nothing when it fires with nothing picked", async () => {
		const { steading, data } = await openPicker({ marked: DEBILITY_IDS, onApplied });
		await data.buttons.apply.callback();
		expect(steading.setSystemValue).not.toHaveBeenCalled();
		expect(onApplied).not.toHaveBeenCalled();
	});
});

describe("reaching it from the keyboard", () => {
	it("picks on Enter and on Space, and swallows the key either way", async () => {
		for (const key of ["Enter", " "]) {
			const { root, applyBtn } = await openPicker({ marked: DEBILITY_IDS });
			const event = root.choices[0].press(key);
			expect(root.choices[0].selected(), key).toBe(true);
			expect(applyBtn.disabled, key).toBe(false);
			// preventDefault so Space doesn't scroll; stopPropagation so Enter never reaches
			// Foundry's document-level handler, which would submit the dialog out from under it.
			expect(event.preventDefault, key).toHaveBeenCalled();
			expect(event.stopPropagation, key).toHaveBeenCalled();
		}
	});

	it("leaves other keys alone", async () => {
		const { root } = await openPicker({ marked: DEBILITY_IDS });
		const event = root.choices[0].press("a");
		expect(root.choices[0].selected()).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	// Foundry pulls focus to the first `.dialog-button` when focus is outside the window, and a
	// disabled button cannot take it. Without a target inside, Tab could never get anyone in.
	it("starts focus on a row rather than on the disabled button", async () => {
		const { data } = await openPicker({ marked: DEBILITY_IDS });
		expect(data.content.match(/autofocus/g)).toHaveLength(1);
		expect(data.content.indexOf("autofocus"))
			.toBeLessThan(data.content.indexOf("data-choice=\"lacking\""));
	});

	it("says out loud that the rows are a pick-one", async () => {
		const { data } = await openPicker({ marked: DEBILITY_IDS });
		expect(data.content).toContain("role=\"radiogroup\"");
		expect(data.content.match(/role="radio"/g)).toHaveLength(3);
	});
});

describe("with no debilities marked", () => {
	it("raises Fortunes by 1 instead, on its own button", async () => {
		const steading = fakeSteading({ marked: [], fortunes: 1 });
		const { data } = await open(steading, { onApplied });
		expect(data.content).toContain("no debilities marked");

		await data.buttons.apply.callback();
		expect(steading.setSystemValue).toHaveBeenCalledWith(
			"stats.fortunes.value", 2, { stonetopMove: "Return Triumphant" });
		expect(onApplied).toHaveBeenCalledOnce();
	});
});

describe("with no steading at all", () => {
	it("opens nothing", async () => {
		global.Dialog = vi.fn();
		await openReturnTriumphant(null, { onApplied });
		expect(global.Dialog).not.toHaveBeenCalled();
		expect(onApplied).not.toHaveBeenCalled();
	});
});

// The trip's row says they came home in triumph once the move is made, whichever door it was made
// from. It used to be the Expedition walkthrough's callback that did it, so the steading sheet's own
// move card never reached the row.
describe("crediting the trip", () => {
	it("marks it triumphant once a debility is cleared, with no callback asked to", async () => {
		const { root, data } = await openPicker({ marked: DEBILITY_IDS });
		root.choices[0].click();
		await data.buttons.apply.callback();
		expect(recordTrip).toHaveBeenCalledExactlyOnceWith({ triumphant: true, homeOnly: true });
	});

	it("marks it triumphant once Fortunes is raised", async () => {
		const { data } = await open(fakeSteading({ marked: [] }), {});
		await data.buttons.apply.callback();
		expect(recordTrip).toHaveBeenCalledExactlyOnceWith({ triumphant: true, homeOnly: true });
	});

	// The walkthrough's homecoming has the trip in hand; only the steading sheet has to ask whether
	// the current trip came home at all.
	it("credits the trip in hand when made from the walkthrough", async () => {
		const { data } = await open(fakeSteading({ marked: [] }), { fromWalkthrough: true });
		await data.buttons.apply.callback();
		expect(recordTrip).toHaveBeenCalledExactlyOnceWith({ triumphant: true });
	});

	// A window closed without committing, or Enter with nothing picked, made no move.
	it("claims nothing for a move that was not made", async () => {
		const { data } = await openPicker({ marked: DEBILITY_IDS });
		await data.buttons.apply.callback();
		expect(recordTrip).not.toHaveBeenCalled();
	});

	// The steading write has already landed; a timeline that cannot be written is a footnote.
	it("still repaints the sheet when the trip cannot be credited", async () => {
		recordTrip.mockRejectedValueOnce(new Error("no page"));
		const { data } = await open(fakeSteading({ marked: [] }), { onApplied });
		await expect(data.buttons.apply.callback()).resolves.toBeUndefined();
		expect(onApplied).toHaveBeenCalledOnce();
	});
});

// Audit WLK-3: the move is made once per homecoming (p.339). Either door asks before a trip that
// already Returned Triumphant clears a second debility or raises Fortunes again.
describe("a trip that already Returned Triumphant", () => {
	const triumphant = { id: "t1", title: "The Ford", returnedTriumphant: true };

	beforeEach(() => {
		tripLog.log = { currentId: "t1", list: [triumphant] };
		homeNow.value = true;
	});

	afterEach(() => {
		tripLog.log = { currentId: null, list: [] };
		homeNow.value = false;
	});

	it("asks first from the walkthrough, and opens nothing when told to leave it", async () => {
		const asked = stubAsk("leave");
		const { data } = await open(fakeSteading({ marked: DEBILITY_IDS }), { fromWalkthrough: true });
		expect(asked).toHaveBeenCalledOnce();
		expect(asked.mock.calls[0][0].content).toContain("The Ford");
		expect(asked.mock.calls[0][0].buttons.find(b => b.default).action).toBe("leave");
		expect(data).toBeUndefined();
	});

	it("opens the move when told to make it again", async () => {
		stubAsk("again");
		const { data } = await open(fakeSteading({ marked: [] }), { fromWalkthrough: true });
		expect(data.content).toContain("no debilities marked");
	});

	it("asks from the steading sheet only for a trip that came home this season", async () => {
		const asked = stubAsk("leave");
		homeNow.value = false;
		const { data } = await open(fakeSteading({ marked: [] }), {});
		expect(asked).not.toHaveBeenCalled();
		expect(data).toBeDefined();
	});

	it("asks nothing for a trip not yet triumphant", async () => {
		const asked = stubAsk("leave");
		tripLog.log = { currentId: "t1", list: [{ id: "t1", title: "The Ford" }] };
		const { data } = await open(fakeSteading({ marked: [] }), { fromWalkthrough: true });
		expect(asked).not.toHaveBeenCalled();
		expect(data).toBeDefined();
	});
});
