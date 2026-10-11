// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { replaceTextMatches } from "../../module/utils/text-nodes.js";

const wrap = (match) => {
	const span = document.createElement("span");
	span.className = "term";
	span.textContent = match[0];
	return span;
};

const mark = (root) => replaceTextMatches(root, { skip: ".term, a, input", regex: /\bdebilit(?:y|ies)\b/gi, render: wrap });

function container(html) {
	const root = document.createElement("div");
	root.innerHTML = html;
	return root;
}

describe("replaceTextMatches", () => {
	it("wraps every match and keeps the text around it", () => {
		const root = container("<p>Take a debility, or two Debilities.</p>");
		mark(root);
		expect(root.innerHTML).toBe('<p>Take a <span class="term">debility</span>, or two <span class="term">Debilities</span>.</p>');
	});

	it("leaves a match inside a skipped element alone", () => {
		const root = container('<p><a>a debility link</a> and a debility</p>');
		mark(root);
		expect(root.querySelector("a").innerHTML).toBe("a debility link");
		expect(root.querySelectorAll(".term")).toHaveLength(1);
	});

	it("skips by any ancestor, not just the text's own parent", () => {
		const root = container("<a><b><i>debility</i></b></a>");
		mark(root);
		expect(root.querySelector(".term")).toBeNull();
	});

	it("is idempotent once the wrapper is in the skip list", () => {
		const root = container("<p>one debility</p>");
		mark(root);
		const once = root.innerHTML;
		mark(root);
		expect(root.innerHTML).toBe(once);
	});

	it("touches no text node that holds no match", () => {
		const root = container("<p>nothing here</p>\n  <div> or here </div>");
		const before = [...root.childNodes];
		mark(root);
		expect([...root.childNodes]).toEqual(before);
		expect(root.innerHTML).toBe("<p>nothing here</p>\n  <div> or here </div>");
	});

	it("keeps the raw text when render returns nothing", () => {
		const root = container("<p>a debility</p>");
		replaceTextMatches(root, { skip: ".term", regex: /debility/g, render: () => null });
		expect(root.innerHTML).toBe("<p>a debility</p>");
	});
});
