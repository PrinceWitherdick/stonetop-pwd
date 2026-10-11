// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readCss, declarations } from "../fakes/css.js";
import { WRAPPED_CLASS, layToolbar } from "../../module/timeline/timeline-toolbar-wrap.js";

// THE TOOLBAR'S SECOND LINE LINES UP UNDER ITS FIRST (user, 2026-10-07). A narrow sheet dropped
// Colours, Filter and Layout to a second line hung off the right edge at their own widths.

const CSS = readCss();

/** A toolbar, its geometry stubbed (happy-dom lays nothing out). `endTop` is where the far group starts. */
function toolbar({ width = 500, endTop = 40, newEntry = true, ages = false } = {}) {
	const bar = document.createElement("header");
	bar.className = "stonetop-timeline-toolbar";
	bar.innerHTML = `${newEntry ? `<button class="stonetop-timeline-new">New Entry</button>` : ""}
		<button class="stonetop-timeline-open-full">Open the full timeline</button>
		<div class="stonetop-timeline-toolbar-end">
			${ages ? `<button class="stonetop-timeline-ages-open">Ages</button>` : ""}
			<details class="stonetop-timeline-colours-menu"><summary class="stonetop-timeline-colours-open">Colours</summary></details>
			<details class="stonetop-timeline-show"><summary class="stonetop-timeline-show-summary">Filter</summary></details>
			<div class="stonetop-timeline-layout"></div>
		</div>`;
	const rect = (top, height) => () => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0 });
	const size = (el, w) => Object.defineProperty(el, "offsetWidth", { value: w });
	size(bar, width);
	const newBtn = bar.querySelector(".stonetop-timeline-new");
	const full = bar.querySelector(".stonetop-timeline-open-full");
	if (newBtn) { size(newBtn, 120); newBtn.getBoundingClientRect = rect(0, 32); }
	size(full, 185);
	full.getBoundingClientRect = rect(0, 32);
	const end = bar.querySelector(".stonetop-timeline-toolbar-end");
	end.getBoundingClientRect = rect(endTop, 32);
	document.body.append(bar);
	const above = [...bar.children].filter(el => el !== end);
	const [colours, filter] = end.querySelectorAll("summary");
	const agesBtn = end.querySelector(".stonetop-timeline-ages-open");
	return { bar, end, above, colours, filter, agesBtn };
}

describe("a timeline toolbar wrapped onto two lines", () => {
	it("marks itself and gives each lower button the width of the one above it", () => {
		const t = toolbar();
		layToolbar(t.bar, t.end, t.above);
		expect(t.bar.classList.contains(WRAPPED_CLASS)).toBe(true);
		expect(t.colours.style.minWidth).toBe("120px");
		expect(t.filter.style.minWidth).toBe("185px");
	});

	it("pairs from the first button there is, when there is no New Entry", () => {
		const t = toolbar({ newEntry: false });
		layToolbar(t.bar, t.end, t.above);
		expect(t.colours.style.minWidth).toBe("185px");
		expect(t.filter.style.minWidth).toBe("");
	});

	it("counts the GM's Ages button as the far group's first, the menus moving one along", () => {
		const t = toolbar({ ages: true });
		layToolbar(t.bar, t.end, t.above);
		expect(t.agesBtn.style.minWidth).toBe("120px");
		expect(t.colours.style.minWidth).toBe("185px");
		expect(t.filter.style.minWidth).toBe("");
	});

	it("goes back to the plain row once it fits on one line again", () => {
		const t = toolbar();
		layToolbar(t.bar, t.end, t.above);
		t.end.getBoundingClientRect = () => ({ top: 0, bottom: 32, height: 32 });
		layToolbar(t.bar, t.end, t.above);
		expect(t.bar.classList.contains(WRAPPED_CLASS)).toBe(false);
		expect(t.colours.style.minWidth).toBe("");
		expect(t.filter.style.minWidth).toBe("");
	});

	it("leaves a toolbar on a tab that is not showing alone", () => {
		const t = toolbar({ width: 0 });
		layToolbar(t.bar, t.end, t.above);
		expect(t.bar.classList.contains(WRAPPED_CLASS)).toBe(false);
	});

	it("lays the far group from the left, Layout still at the right, and opens its menus rightward", () => {
		const end = declarations(CSS, `.stonetop-timeline-toolbar.${WRAPPED_CLASS} > .stonetop-timeline-toolbar-end`);
		expect(end).toMatch(/flex-basis:\s*100%/);
		expect(end).toMatch(/margin-left:\s*0/);
		const menus = declarations(CSS, `.stonetop-timeline-toolbar.${WRAPPED_CLASS} :is(.stonetop-timeline-show-menu, .stonetop-timeline-colours)`);
		expect(menus).toMatch(/left:\s*0/);
		expect(menus).toMatch(/right:\s*auto/);
		expect(declarations(CSS, `.stonetop-timeline-toolbar.${WRAPPED_CLASS} .stonetop-timeline-layout`)).toMatch(/margin-left:\s*auto/);
	});
});
