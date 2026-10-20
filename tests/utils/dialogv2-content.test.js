import { describe, it, expect } from "vitest";
import { contentElement } from "../../module/utils/dialogv2-content.js";

// ⚠ Core's `DialogV2#_initializeApplicationOptions` (v13 client/applications/api/dialog.mjs) refuses
// a content element that is not a `<div>`, refuses one carrying ANY attribute at all, and keeps only
// its `innerHTML`. A `content.className = "stonetop"` on the way in is `Error: config.content element
// must have no attributes`, raised in the constructor, which reaches the reader as a button that does
// nothing. It shipped that way twice. The fight and invocation asks build their DialogV2 content with
// this helper.

/** The little of an element contentElement touches. `className` records an attribute, as a real one does. */
function fakeElement(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		attributes: [],
		innerHTML: "",
		set className(value) { el.attributes.push({ name: "class", value }); },
	};
	return el;
}

describe("contentElement", () => {
	it("is a bare div core will accept, with the markup inside it", () => {
		const content = contentElement('<div class="stonetop x">hi</div>', { createElement: fakeElement });
		expect(content.tagName).toBe("DIV");
		expect(content.attributes).toEqual([]);
		expect(content.innerHTML).toContain("stonetop");
	});
});
