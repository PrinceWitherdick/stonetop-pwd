import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promptForText, pickContentOption } from "../../module/dialogs/content-picker.js";

// HOW A DialogV2 IS HANDED ITS CONTENT, which is a rule with no forgiveness in it.
//
// ⚠ WHAT THIS SUITE EXISTS TO STOP. Core's `DialogV2#_initializeApplicationOptions` (v13
// client/applications/api/dialog.mjs) does three things to a content ELEMENT: it refuses anything
// that is not a `<div>`, it refuses one carrying ANY attribute at all, and it then keeps only the
// element's `innerHTML` and throws the element away. So the obvious way to write one of these —
//
//     const content = document.createElement("div");
//     content.className = "stonetop";      // <- throws
//     content.appendChild(field);
//
// is `Error: config.content element must have no attributes`, raised inside the DialogV2
// constructor, which reaches the console as an unhandled rejection and reaches the READER as a
// button that does nothing whatsoever. It shipped exactly that way twice: the GM Toolkit's "New
// map" was dead from the day it landed, and the relationship map's "New page" was born dead
// because its author copied the pattern from it.
//
// The assertions below are core's own two conditions, spelled out, run against the element our
// helpers actually build. A stub `className` setter records an attribute the way a real element
// does, so re-introducing the line above fails here rather than in somebody's game.

/** The little of an element these builders touch. `className` records an attribute, as a real one
 * does — that is the whole trap, and a stub that quietly did not would hide it. */
function fakeElement(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		attributes: [],
		innerHTML: "",
		setAttribute(name, value) { el.attributes.push({ name, value }); },
		appendChild() {},
		querySelector: () => null,
		set className(value) { el.attributes.push({ name: "class", value }); },
		get className() { return el.attributes.find(a => a.name === "class")?.value ?? ""; },
	};
	return el;
}

let asked;
let priorDocument;
let priorApplications;

beforeEach(() => {
	asked = [];
	priorDocument = globalThis.document;
	globalThis.document = { createElement: fakeElement };
	globalThis.foundry ??= {};
	priorApplications = globalThis.foundry.applications;
	globalThis.foundry.applications = {
		api: {
			DialogV2: {
				prompt: config => { asked.push(config); return Promise.resolve(null); },
			},
		},
	};
});

afterEach(() => {
	globalThis.document = priorDocument;
	globalThis.foundry.applications = priorApplications;
});

/** Core's own test, as core writes it. */
function coreWouldAccept(content) {
	if (content.tagName !== "DIV") return "config.content must be <div> element";
	if (content.attributes.length) return "config.content element must have no attributes";
	return null;
}

describe("the content element every prompt in this file builds", () => {
	it("is a bare div core will accept, for the one-line text prompt", () => {
		promptForText({ title: "Name the new page", buttonLabel: "New page" });
		expect(coreWouldAccept(asked[0].content)).toBeNull();
	});

	it("is a bare div core will accept, for the chooser beside it", () => {
		pickContentOption({
			title: "What do you want to make?",
			options: [{ id: "a", label: "A", icon: "fa-user" }],
		});
		expect(coreWouldAccept(asked[0].content)).toBeNull();
	});

	// The classes still have to arrive, or the window comes up in Foundry's default chrome instead
	// of the parchment skin. They ride INSIDE the markup, which is the half core keeps.
	it("carries the skin one level in, where the innerHTML survives", () => {
		promptForText({ title: "t", buttonLabel: "b" });
		expect(asked[0].content.innerHTML).toContain("stonetop");
	});
});

describe("asking for one line of text", () => {
	it("opens the box on the value it was given", () => {
		promptForText({ title: "Rename this page", buttonLabel: "Rename it", value: "The Millers" });
		expect(asked[0].content.innerHTML).toContain('value="The Millers"');
	});

	// A page name is text somebody at this table typed, and both of these are printed as ATTRIBUTES.
	it("escapes a value and a placeholder rather than trusting them", () => {
		promptForText({
			title: "t", buttonLabel: "b",
			value: '" onfocus="alert(1)',
			placeholder: "<script>",
		});
		const html = asked[0].content.innerHTML;
		expect(html).not.toContain('onfocus="alert(1)"');
		expect(html).toContain("&quot;");
		expect(html).toContain("&lt;script&gt;");
	});

	// ⚠ "" AND null ARE DIFFERENT ANSWERS, and every caller leans on it: "" means saved without
	// typing anything, which a caller may substitute a default for, while null means never mind and
	// must leave everything alone. `rejectClose: false` is what makes the dismissal a null rather
	// than a rejected promise nobody catches.
	it("resolves a saved box to trimmed text and a dismissal to null", async () => {
		const back = promptForText({ title: "t", buttonLabel: "b" });
		const config = asked[0];
		expect(config.rejectClose).toBe(false);
		expect(await back).toBeNull();

		const form = { elements: { namedItem: () => ({ value: "  The Millers  " }) } };
		expect(config.ok.callback({}, { form })).toBe("The Millers");
	});

	it("hands back an empty string, not a null, for a box saved blank", () => {
		promptForText({ title: "t", buttonLabel: "b" });
		const form = { elements: { namedItem: () => ({ value: "   " }) } };
		expect(asked[0].ok.callback({}, { form })).toBe("");
	});

	// The field takes focus and its text is selected once the window is up, which is what makes one
	// prompt serve both "name this" and "rename this": a reader who meant to replace the name can
	// simply type. `render` and not a wire step, because focusing a node that is not in a document
	// yet is a silent no-op.
	it("focuses and selects the field once the window is on screen", () => {
		promptForText({ title: "t", buttonLabel: "b", value: "The Millers" });
		const field = { focus: vi.fn(), select: vi.fn() };
		asked[0].render({}, { element: { querySelector: () => field } });
		expect(field.focus).toHaveBeenCalled();
		expect(field.select).toHaveBeenCalled();
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
	const checkedIn = html => html.match(/value="([^"]+)"[^>]* checked/)?.[1] ?? null;

	it("opens on the first row when the caller names none", () => {
		pickContentOption({ title: "t", options: ROWS });
		expect(checkedIn(asked[0].content.innerHTML)).toBe("ring");
	});

	it("opens on the row the caller named, without moving it", () => {
		pickContentOption({ title: "t", options: ROWS, selected: "clusters" });
		const html = asked[0].content.innerHTML;
		expect(checkedIn(html)).toBe("clusters");
		expect(html.indexOf('value="ring"')).toBeLessThan(html.indexOf('value="clusters"'));
	});

	// ⚠ A DEFAULT THAT IS NOT THERE MUST NOT LEAVE THE GROUP EMPTY. A radio group with nothing
	// checked is a confirm button that resolves to undefined, which no caller can tell from a
	// dismissal -- so a name that matches no row falls back to the first, as if none was given.
	it("falls back to the first row when the named one is not on the list", () => {
		pickContentOption({ title: "t", options: ROWS, selected: "spiral" });
		expect(checkedIn(asked[0].content.innerHTML)).toBe("ring");
	});

	// ⚠ AND THE PICKED ROW HAS TO BE ON SCREEN. Once the default can be anywhere in the list, one
	// the reader has to scroll to find is a default they will not know is there. `scrollIntoView`
	// and not focus: the confirm button keeps the focus a dialog opens with.
	it("scrolls the picked row into view once the window is up", () => {
		pickContentOption({ title: "t", options: ROWS, selected: "clusters" });
		const row = { scrollIntoView: vi.fn() };
		asked[0].render({}, { element: { querySelector: () => ({ closest: () => row }) } });
		expect(row.scrollIntoView).toHaveBeenCalled();
	});
});
