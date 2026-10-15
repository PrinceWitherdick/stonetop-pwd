// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

// The shared chooser and the one-line prompt are one AppV1 window, ContentPickerDialog, on the
// StonetopDialog base. The base is stood in for here (no Application in a test), with the two
// things the window leans on: promise(), which opens it, and _resolveWith(), which settles it.
// Everything ContentPickerDialog itself does (the markup, the wiring, the read, the opening focus)
// runs for real against a form drawn into happy-dom.

const opened = [];
vi.mock("../../module/utils/stonetop-dialog.js", () => ({
	StonetopDialog: class {
		constructor(options = {}) { this.options = options; }
		static get defaultOptions() { return {}; }
		activateListeners() {}
		async _render() {}
		promise() {
			opened.push(this);
			return new Promise(resolve => { this._settle = resolve; });
		}
		_resolveWith(value) { this._settle(value); }
	},
}));

const { promptForText, pickContentOption, pickOrWriteOption, ContentPickerDialog } =
	await import("../../module/dialogs/content-picker.js");

beforeEach(() => {
	opened.length = 0;
	globalThis.foundry ??= {};
	globalThis.foundry.utils ??= {};
	globalThis.foundry.utils.mergeObject ??= (a, b) => ({ ...a, ...b });
});

/**
 * Draw the window the way its template does, wire it as activateListeners does, and run its
 * opening step as _render does. Returns the form.
 */
async function show(dialog) {
	const { body, buttonLabel, bodyClass } = dialog.getData();
	const frame = document.createElement("div");
	frame.innerHTML = `<form class="stonetop-content-picker-form">
		<div class="stonetop-content-picker ${bodyClass}">${body}</div>
		<footer><button type="submit" class="stonetop-content-picker-confirm">${buttonLabel}</button></footer>
	</form>`;
	document.body.replaceChildren(frame);
	dialog.element = [frame];
	const form = frame.firstElementChild;
	dialog.activateListeners([form]);
	await dialog._render(true);
	return form;
}

/** Press Confirm: the form's submit, as Enter or a click would fire it. */
function confirm(form) {
	form.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("the window", () => {
	it("opens on the Stonetop skin, at the width the prompt asks for, titled", () => {
		promptForText({ title: "Name the Settlement", buttonLabel: "Create", width: 380 });
		const dialog = opened[0];
		expect(dialog.options.title).toBe("Name the Settlement");
		expect(dialog.options.width).toBe(380);
		expect(dialog.constructor.defaultOptions.classes).toContain("stonetop");
		expect(dialog.constructor.defaultOptions.template).toMatch(/templates\/dialogs\/content-picker\.hbs$/);
	});

	// Confirm is the form's SUBMIT, so Enter in the name box saves it and a click on the button does
	// the same thing. The page must not navigate: the submit is prevented.
	it("resolves to what the prompt reads off the form when it is confirmed", async () => {
		const back = pickContentOption({ title: "t", options: [{ id: "a", label: "A", icon: "fa-user" }] });
		const form = await show(opened[0]);
		const event = new Event("submit", { cancelable: true });
		form.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(await back).toBe("a");
	});

	it("is opened by ContentPickerDialog.ask, which resolves to what read takes off the form", async () => {
		const back = ContentPickerDialog.ask({
			title: "t", buttonLabel: "Go", bodyClass: "x-variant",
			body: `<input type="text" name="n" value="kept">`,
			read: form => form.querySelector('input[name="n"]').value,
		});
		const dialog = opened[0];
		expect(dialog).toBeInstanceOf(ContentPickerDialog);
		expect(dialog.options.title).toBe("t");
		const form = await show(dialog);
		expect(form.querySelector(".stonetop-content-picker.x-variant")).not.toBeNull();
		confirm(form);
		expect(await back).toBe("kept");
	});

	it("gives Confirm the focus as it opens, as the V2 prompt did", async () => {
		pickContentOption({ title: "t", options: [{ id: "a", label: "A", icon: "fa-user" }] });
		const form = await show(opened[0]);
		expect(document.activeElement).toBe(form.querySelector(".stonetop-content-picker-confirm"));
	});
});

describe("asking for one line of text", () => {
	it("opens the box on the value it was given", async () => {
		promptForText({ title: "Rename this page", buttonLabel: "Rename it", value: "The Millers" });
		const form = await show(opened[0]);
		expect(form.querySelector('input[name="stonetopText"]').value).toBe("The Millers");
	});

	// A page name is text somebody at this table typed, and both of these are printed as ATTRIBUTES.
	it("escapes a value and a placeholder rather than trusting them", () => {
		promptForText({ title: "t", buttonLabel: "b", value: '" onfocus="alert(1)', placeholder: "<script>" });
		const html = opened[0].getData().body;
		expect(html).not.toContain('onfocus="alert(1)"');
		expect(html).toContain("&quot;");
		expect(html).toContain("&lt;script&gt;");
	});

	// ⚠ "" AND null ARE DIFFERENT ANSWERS, and every caller leans on it: "" means saved without
	// typing anything, which a caller may substitute a default for, while null means never mind and
	// must leave everything alone (StonetopDialog#close settles an unconfirmed window to null).
	it("resolves a saved box to trimmed text", async () => {
		const back = promptForText({ title: "t", buttonLabel: "b" });
		const form = await show(opened[0]);
		form.querySelector('input[name="stonetopText"]').value = "  The Millers  ";
		confirm(form);
		expect(await back).toBe("The Millers");
	});

	it("hands back an empty string, not a null, for a box saved blank", async () => {
		const back = promptForText({ title: "t", buttonLabel: "b" });
		const form = await show(opened[0]);
		form.querySelector('input[name="stonetopText"]').value = "   ";
		confirm(form);
		expect(await back).toBe("");
	});

	// The field takes the focus and its text is selected once the window is up, which is what makes
	// one prompt serve both "name this" and "rename this": a reader who meant to replace the name can
	// simply type.
	it("focuses and selects the field once the window is on screen", async () => {
		promptForText({ title: "t", buttonLabel: "b", value: "The Millers" });
		const form = await show(opened[0]);
		const field = form.querySelector('input[name="stonetopText"]');
		expect(document.activeElement).toBe(field);
		expect(field.selectionStart).toBe(0);
		expect(field.selectionEnd).toBe("The Millers".length);
	});
});

// ── Which row the chooser opens on ──────────────────────────────────────────────────────────────
//
// The first row, for nearly every caller. A chooser that wants a DEFAULT says which row rather than
// sorting it to the top: reordering is how a reader loses the order they had learned, and it gives
// no hint why the second row is the pre-selected one. The relationship map's Tidy up is the caller
// (its own suite pins that it asks this way).

describe("which row the chooser opens on", () => {
	const ROWS = [
		{ id: "ring", label: "Ring", icon: "fa-circle-nodes" },
		{ id: "clusters", label: "Clusters", icon: "fa-diagram-project" },
	];
	const checkedIn = form => form.querySelector('input[name="contentType"]:checked')?.value ?? null;

	it("opens on the first row when the caller names none", async () => {
		pickContentOption({ title: "t", options: ROWS });
		expect(checkedIn(await show(opened[0]))).toBe("ring");
	});

	it("opens on the row the caller named, without moving it", async () => {
		pickContentOption({ title: "t", options: ROWS, selected: "clusters" });
		const form = await show(opened[0]);
		expect(checkedIn(form)).toBe("clusters");
		expect([...form.querySelectorAll('input[name="contentType"]')].map(r => r.value)).toEqual(["ring", "clusters"]);
	});

	// ⚠ A DEFAULT THAT IS NOT THERE MUST NOT LEAVE THE GROUP EMPTY. A radio group with nothing
	// checked is a confirm button that resolves to nothing, which no caller can tell from a
	// dismissal -- so a name that matches no row falls back to the first, as if none was given.
	// A heading is a caption, not a choice: no radio, and never the row a window opens on.
	it("draws a heading without a radio and opens on the first real row", async () => {
		pickContentOption({ title: "t", options: [{ heading: "Shapes" }, ...ROWS] });
		const form = await show(opened[0]);
		expect(form.querySelector(".stonetop-content-picker-heading")?.textContent).toBe("Shapes");
		expect(form.querySelectorAll('input[type="radio"]')).toHaveLength(2);
		expect(checkedIn(form)).toBe("ring");
	});

	it("falls back to the first row when the named one is not on the list", async () => {
		pickContentOption({ title: "t", options: ROWS, selected: "spiral" });
		expect(checkedIn(await show(opened[0]))).toBe("ring");
	});

	// ⚠ AND THE PICKED ROW HAS TO BE ON SCREEN. Once the default can be anywhere in the list, one
	// the reader has to scroll to find is a default they will not know is there.
	it("scrolls the picked row into view once the window is up", async () => {
		pickContentOption({ title: "t", options: ROWS, selected: "clusters" });
		let scrolledRow = null;
		const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function () { scrolledRow = this; });
		const form = await show(opened[0]);
		spy.mockRestore();
		expect(scrolledRow).toBe(form.querySelector('input[value="clusters"]').closest("label"));
	});

	it("resolves to the row picked when it is confirmed", async () => {
		const back = pickContentOption({ title: "t", options: ROWS });
		const form = await show(opened[0]);
		form.querySelector('input[value="clusters"]').checked = true;
		confirm(form);
		expect(await back).toBe("clusters");
	});
});

// The tabbed chooser (the settlement list): one page per heading behind a left rail, still ONE radio
// group, and it opens on the page holding the picked row so the default is on screen.
describe("the tabbed chooser", () => {
	const GROUPED = [
		{ heading: "Places", icon: "fa-book" },
		{ id: "delve", label: "Delve", icon: "fa-city" },
		{ id: "marsh", label: "Marsh", icon: "fa-city" },
		{ heading: "Your own", icon: "fa-pen" },
		{ id: "blank", label: "Blank", icon: "fa-file-lines" },
	];
	const checkedIn = form => form.querySelector('input[name="contentType"]:checked')?.value ?? null;
	const activePage = form => form.querySelector(".stonetop-content-picker-page.is-active")?.dataset.tab ?? null;

	it("draws a rail entry and a page per heading, with every row in one radio group", async () => {
		pickContentOption({ title: "t", options: GROUPED, tabbed: true });
		const form = await show(opened[0]);
		expect(form.querySelectorAll(".stonetop-guide-toc-btn")).toHaveLength(2);
		expect(form.querySelectorAll(".stonetop-content-picker-page")).toHaveLength(2);
		expect(form.querySelectorAll('input[name="contentType"]')).toHaveLength(3);
		expect(form.querySelector(".stonetop-content-picker-heading")).toBeNull();
		expect(checkedIn(form)).toBe("delve");
		expect(activePage(form)).toBe("0");
	});

	it("opens on the page that holds the picked row", async () => {
		pickContentOption({ title: "t", options: GROUPED, tabbed: true, selected: "blank" });
		const form = await show(opened[0]);
		expect(checkedIn(form)).toBe("blank");
		expect(activePage(form)).toBe("1");
	});

	// ⚠ WHAT IS PICKED IS ALWAYS ON THE PAGE SHOWING, so Continue never makes something the reader
	// cannot see.
	it("picks a page's first row when the rail opens it", async () => {
		const back = pickContentOption({ title: "t", options: GROUPED, tabbed: true });
		const form = await show(opened[0]);
		form.querySelector('.stonetop-content-picker-tab[data-tab="1"]').click();
		expect(activePage(form)).toBe("1");
		expect(checkedIn(form)).toBe("blank");
		confirm(form);
		expect(await back).toBe("blank");
	});

	it("turns the rail to the page of a row picked from the keyboard", async () => {
		pickContentOption({ title: "t", options: GROUPED, tabbed: true });
		const form = await show(opened[0]);
		const blank = form.querySelector('input[value="blank"]');
		blank.checked = true;
		blank.dispatchEvent(new Event("change", { bubbles: true }));
		expect(activePage(form)).toBe("1");
	});

	it("falls back to the plain stack when the list does not open on a heading", async () => {
		pickContentOption({ title: "t", options: GROUPED.slice(1), tabbed: true });
		const form = await show(opened[0]);
		expect(form.querySelector(".stonetop-guide-toc")).toBeNull();
		expect(form.querySelector(".stonetop-content-picker-heading")).not.toBeNull();
	});
});

describe("picking a line off a menu, or writing one", () => {
	const MENU = [{ id: "a", html: "Line A" }, { id: "b", html: "Line B" }];

	it("resolves a picked line to its key", async () => {
		const back = pickOrWriteOption({ title: "t", options: MENU });
		const form = await show(opened[0]);
		form.querySelector('input[name="pick"][value="b"]').checked = true;
		confirm(form);
		expect(await back).toEqual({ key: "b" });
	});

	// Typing is choosing: a GM who writes their own line and presses Add gets their words, not
	// whichever authored line happened to be picked.
	it("picks the write-your-own row as soon as something is typed in it", async () => {
		const back = pickOrWriteOption({ title: "t", options: MENU });
		const form = await show(opened[0]);
		const custom = form.querySelector('input[name="custom"]');
		custom.value = "  A ford nobody guards  ";
		custom.dispatchEvent(new Event("input", { bubbles: true }));
		confirm(form);
		expect(await back).toEqual({ text: "A ford nobody guards" });
	});

	it("resolves the write row with nothing written to null", async () => {
		const back = pickOrWriteOption({ title: "t", options: [] });
		const form = await show(opened[0]);
		confirm(form);
		expect(await back).toBeNull();
	});
});
