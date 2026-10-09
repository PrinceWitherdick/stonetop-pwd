// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readCss, readRepo } from "../fakes/css.js";

// THE YEAR SCRUBBER: one tick per year shown, the slider ONE STRAIGHT LINE from the first year
// centred to the last (user, 2026-10-04: "not lock to any points at all"), the timeline centred the
// other way, and moving the column moves the thumb to match.

const {
	SCRUB_MAX, yearStops, scrubTicks, centredScroll, pictureRect, scrollForValue, valueForScroll,
	tickShares, nearestStop, wireYearScrubber,
} = await import("../../module/timeline/timeline-scrub.js");

describe("yearStops", () => {
	it("gives one stop per year, oldest first, and none for the undated block", () => {
		const periods = [
			{ undated: true, year: 0, yearLabel: "" },
			{ year: 1, yearLabel: "Year One" },
			{ year: 1, yearLabel: "Year One" },
			{ year: 3, yearLabel: "Year Three" },
		];
		expect(yearStops(periods)).toEqual([{ year: 1, label: "Year One" }, { year: 3, label: "Year Three" }]);
	});
});

describe("scrubTicks", () => {
	it("spreads the ticks evenly for the page to open with, first at 0 and last at 1", () => {
		const stops = [1, 2, 3, 4].map(year => ({ year, label: `Year ${year}` }));
		expect(scrubTicks(stops).map(t => t.at)).toEqual([0, 0.3333, 0.6667, 1]);
	});

	it("draws the ticks behind the slider, half a thumb in from each end", () => {
		const main = readRepo("templates/dialogs/timeline.hbs");
		expect(main).toMatch(/\{\{#each scrub\.ticks\}\}<li class="stonetop-timeline-scrub-tick" style="--at: \{\{at\}\};">/);
		expect(main).toMatch(/stonetop-timeline-scrub-ticks" aria-hidden="true"/);
		const css = readCss();
		expect(css).toContain("left: calc(var(--scrub-thumb) / 2 + (100% - var(--scrub-thumb)) * var(--at, 0));");
		expect(css).toMatch(/\.stonetop-timeline-scrub-range::-webkit-slider-thumb \{\s*width: var\(--scrub-thumb\);/);
	});
});

describe("centredScroll", () => {
	it("puts a span that fits in the middle of the view", () => {
		// View 0..1000, span 1500..1700 on screen: its middle (1600) must land on 500.
		expect(centredScroll({ scroll: 200, viewStart: 0, viewSize: 1000, spanStart: 1500, spanSize: 200 })).toBe(1300);
	});

	it("lays a span longer than the view against the near edge, less the inset", () => {
		expect(centredScroll({ scroll: 0, viewStart: 100, viewSize: 400, spanStart: 900, spanSize: 800, inset: 12 })).toBe(788);
	});

	it("still centres a span longer than the view when told not to start from its start", () => {
		// Span 900..1700, middle 1300, onto the view's middle at 300.
		expect(centredScroll({ scroll: 0, viewStart: 100, viewSize: 400, spanStart: 900, spanSize: 800, fromStart: false })).toBe(1000);
	});
});

describe("pictureRect", () => {
	const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

	it("measures what a padded picture holds, not its box (the axis is the window's height)", () => {
		document.body.innerHTML = `<ol class="pic"><li></li><li></li></ol>`;
		const pic = document.querySelector(".pic");
		pic.getBoundingClientRect = () => rect(0, 0, 800, 600);
		const [a, b] = pic.children;
		a.getBoundingClientRect = () => rect(0, 200, 400, 150);
		b.getBoundingClientRect = () => rect(400, 180, 400, 200);
		expect(pictureRect(pic)).toMatchObject({ left: 0, top: 180, right: 800, bottom: 380, height: 200 });
	});

	it("takes the picture's own box when a child is pinned, since a pinned child is drawn where it sticks", () => {
		document.body.innerHTML = `<div class="pic"><span style="position: sticky"></span><div></div></div>`;
		const pic = document.querySelector(".pic");
		pic.getBoundingClientRect = () => rect(0, 0, 800, 600);
		expect(pictureRect(pic)).toMatchObject({ top: 0, height: 600 });
	});
});

describe("scrollForValue", () => {
	it("runs in one straight line from the first year's offset to the last's, whatever lies between", () => {
		const targets = [0, 100, null, 800];
		expect(SCRUB_MAX).toBe(1000);
		expect(scrollForValue(targets, 0)).toBe(0);
		// Halfway along the slider is halfway along the column, not halfway between two ticks.
		expect(scrollForValue(targets, 500)).toBe(400);
		expect(scrollForValue(targets, 437)).toBe(350);
		expect(scrollForValue(targets, 1000)).toBe(800);
		expect(scrollForValue(targets, 5000)).toBe(800);
		expect(scrollForValue([null], 0)).toBeNull();
	});
});

describe("valueForScroll", () => {
	it("is the inverse, held to the slider's ends", () => {
		const targets = [0, 100, null, 800];
		expect(valueForScroll(targets, 400)).toBe(500);
		expect(valueForScroll(targets, 100)).toBe(125);
		expect(valueForScroll(targets, -50)).toBe(0);
		expect(valueForScroll(targets, 5000)).toBe(1000);
		expect(valueForScroll([null], 10)).toBe(-1);
	});

	it("never sticks on a tick where the column's end holds two years to one place", () => {
		// The old year-to-year blend jumped the thumb to the later year here; a straight line cannot.
		expect(valueForScroll([0, 600, 600], 300)).toBe(500);
		expect(valueForScroll([0, 600, 600], 599)).toBeCloseTo(998.33, 1);
		expect(valueForScroll([300, 300], 300)).toBe(0);
	});
});

describe("tickShares", () => {
	it("puts each year's tick where it falls along the line", () => {
		expect(tickShares([0, 100, null, 800])).toEqual([0, 0.125, null, 1]);
	});
});

describe("nearestStop", () => {
	it("names the year whose tick is closest to the thumb", () => {
		expect(nearestStop([0, 100, 800], 500)).toBe(1);
		expect(nearestStop([0, 100, 800], 700)).toBe(2);
	});

	it("names the year that is really at each end when two share a tick", () => {
		expect(nearestStop([0, 0, 800], 0)).toBe(0);
		expect(nearestStop([0, 800, 800], 1000)).toBe(2);
		expect(nearestStop([null], 0)).toBe(-1);
	});
});

describe("wireYearScrubber", () => {
	let scroll, bar, range, unwire;
	const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

	beforeEach(() => {
		document.body.innerHTML = `
			<div class="scroll">
				<div class="canvas"><ol class="pic">
					<li data-year="1"></li><li data-year="2"></li><li data-year="3"></li>
				</ol></div>
			</div>
			<footer class="bar"><output></output>
				<ol><li class="stonetop-timeline-scrub-tick"></li><li class="stonetop-timeline-scrub-tick"></li><li class="stonetop-timeline-scrub-tick"></li></ol>
				<input type="range" min="0" max="1000" step="any" value="0"></footer>`;
		scroll = document.querySelector(".scroll");
		bar = document.querySelector(".bar");
		range = bar.querySelector("input");
		// A 1000x600 view; the picture is drawn as if scrollLeft/Top were 0: year 1 at 0..400
		// (centres at -300, held to 0), year 2 at 400..800 (centres at 100), year 3 at 800..2400
		// (wider than the view: laid from its start, 800). Everything 0..300 tall.
		const at = (x, y, w, h) => () => rect(x - scroll.scrollLeft, y - scroll.scrollTop, w, h);
		Object.defineProperty(scroll, "clientWidth", { value: 1000 });
		Object.defineProperty(scroll, "clientHeight", { value: 600 });
		scroll.getBoundingClientRect = () => rect(0, 0, 1000, 600);
		const [y1, y2, y3] = scroll.querySelectorAll("li");
		y1.getBoundingClientRect = at(0, 0, 400, 300);
		y2.getBoundingClientRect = at(400, 0, 400, 300);
		y3.getBoundingClientRect = at(800, 0, 1600, 300);
		scroll.querySelector(".pic").getBoundingClientRect = at(0, 0, 2400, 300);
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 0; });
	});
	afterEach(() => {
		unwire?.();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	const stops = [{ year: 1, label: "Year One" }, { year: 2, label: "Year Two" }, { year: 3, label: "Year Three" }];
	const slide = (value) => { range.value = String(value); range.dispatchEvent(new Event("input")); };
	const ticks = () => [...bar.querySelectorAll("li")].map(li => li.style.getPropertyValue("--at"));

	it("moves each tick to where its year falls along the line", () => {
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true });
		expect(ticks()).toEqual(["0", "0.125", "1"]);
	});

	it("scrolls in a straight line with the thumb, and centres the timeline the other way", () => {
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true, picture: ".pic" });
		slide(500);
		expect(scroll.scrollLeft).toBe(400);
		// The picture is 300 tall in a 600 view: centred, so 150 above it.
		expect(scroll.scrollTop).toBe(-150);
		expect(bar.querySelector("output").textContent).toBe("Year Two");
		slide(1000);
		expect(scroll.scrollLeft).toBe(800);
		expect(bar.querySelector("output").textContent).toBe("Year Three");
		expect(range.getAttribute("aria-valuetext")).toBe("Year Three");
	});

	it("moves the thumb with the column, anywhere along it", () => {
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true });
		scroll.scrollLeft = 200;
		scroll.dispatchEvent(new Event("scroll"));
		expect(range.value).toBe("250");
		scroll.scrollLeft = 800;
		scroll.dispatchEvent(new Event("scroll"));
		expect(range.value).toBe("1000");
	});

	it("leaves the thumb where the hand put it, and follows the next move", () => {
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true });
		slide(437);
		expect(scroll.scrollLeft).toBe(350);
		// The jump's echo: the thumb stays where the hand put it, not where the place reads back.
		scroll.dispatchEvent(new Event("scroll"));
		expect(range.value).toBe("437");
		// A wheel turn at once after.
		scroll.scrollLeft = 800;
		scroll.dispatchEvent(new Event("scroll"));
		expect(range.value).toBe("1000");
	});

	it("steps to the next year's tick from the keyboard, from wherever the thumb was left", () => {
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true });
		const key = (k) => range.dispatchEvent(new KeyboardEvent("keydown", { key: k, cancelable: true }));
		range.value = "300";
		key("ArrowRight");
		expect(range.value).toBe("1000");
		expect(scroll.scrollLeft).toBe(800);
		range.value = "300";
		key("ArrowLeft");
		expect(range.value).toBe("125");
		expect(scroll.scrollLeft).toBe(100);
		key("Home");
		expect(range.value).toBe("0");
		key("End");
		expect(range.value).toBe("1000");
	});

	it("Vertical: lays a timeline wider than the view against the left edge rather than centring it", () => {
		// Read down, the picture (2400 wide) is wider than the 1000 view: from the left, less the inset.
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: false, picture: ".pic", inset: 12 });
		scroll.scrollLeft = 500;
		slide(0);
		expect(scroll.scrollLeft).toBe(-12);
	});

	it("measures in layout pixels when the window is drawn at a UI scale", () => {
		// The same column drawn twice its size: every rect doubled, the scroll offsets not.
		const x2 = (x, y, w, h) => () => rect(2 * (x - scroll.scrollLeft), 2 * (y - scroll.scrollTop), 2 * w, 2 * h);
		Object.defineProperty(scroll, "offsetWidth", { value: 1000 });
		scroll.getBoundingClientRect = () => rect(0, 0, 2000, 1200);
		const [y1, y2, y3] = scroll.querySelectorAll("li");
		y1.getBoundingClientRect = x2(0, 0, 400, 300);
		y2.getBoundingClientRect = x2(400, 0, 400, 300);
		y3.getBoundingClientRect = x2(800, 0, 1600, 300);
		scroll.querySelector(".pic").getBoundingClientRect = x2(0, 0, 2400, 300);
		unwire = wireYearScrubber(scroll, bar, { stops, horizontal: true, picture: ".pic" });
		expect(ticks()).toEqual(["0", "0.125", "1"]);
		slide(500);
		expect(scroll.scrollLeft).toBe(400);
		expect(scroll.scrollTop).toBe(-150);
	});

	it("wires nothing for fewer than two years", () => {
		unwire = wireYearScrubber(scroll, bar, { stops: stops.slice(0, 1), horizontal: true });
		slide(1000);
		expect(scroll.scrollLeft).toBe(0);
	});
});

describe("the template", () => {
	const read = (p) => readRepo(`templates/dialogs/${p}`);

	it("stamps a year on every period element in all four shapes", () => {
		expect(read("partials/timeline-hperiod.hbs")).toMatch(/data-year="\{\{year\}\}"/);
		expect(read("partials/timeline-period.hbs")).toMatch(/stonetop-timeline-period" data-period="\{\{key\}\}"\{\{#unless undated\}\} data-year/);
		const main = read("timeline.hbs");
		expect(main).toMatch(/stonetop-timeline-swim-head[^>]*data-year/);
		expect(main).toMatch(/stonetop-timeline-row"[^>]*data-year/);
	});

	it("draws the scrubber only when there is something to slide between", () => {
		expect(read("timeline.hbs")).toMatch(/\{\{#if scrub\}\}\s*<footer class="stonetop-timeline-scrub">/);
	});
});
