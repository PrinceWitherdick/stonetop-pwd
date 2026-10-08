// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";

// THE AGES' BANDS: each laid under the years it covers, wherever the column draws them, its name
// kept on screen while the band runs off an edge, and never drawn under a pinned header.

const { bandPlacement, wireAgeBands, OFF_ATTR } = await import("../../module/timeline/timeline-ages-band.js");

describe("bandPlacement", () => {
	it("runs from the first year's near edge to the last year's far edge", () => {
		expect(bandPlacement({ start: 100, end: 400, size: 800, name: 80 }))
			.toEqual({ hidden: false, pos: 100, length: 300, shift: 0 });
	});

	it("slides the name in to the visible edge of a band run off the start, never past its end", () => {
		expect(bandPlacement({ start: -200, end: 400, size: 800, name: 80 }).shift).toBe(200);
		// Only 40px of band left on screen: the name stops where it still fits inside the band.
		expect(bandPlacement({ start: -560, end: 40, size: 800, name: 80 }).shift).toBe(600 - 80 - 16);
	});

	it("keeps the name clear of a pinned column", () => {
		expect(bandPlacement({ start: 0, end: 600, size: 800, clip: 240, name: 80 }).shift).toBe(240);
	});

	it("hides a band wholly off screen or wholly under the pinned column", () => {
		expect(bandPlacement({ start: 900, end: 1200, size: 800 }).hidden).toBe(true);
		expect(bandPlacement({ start: -300, end: -10, size: 800 }).hidden).toBe(true);
		expect(bandPlacement({ start: 0, end: 200, size: 800, clip: 240 }).hidden).toBe(true);
	});
});

describe("wireAgeBands", () => {
	afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

	/** A column with two years drawn side by side, and a strip holding one band over both. */
	function rig() {
		document.body.innerHTML = `
			<div class="scroll"><div class="canvas"><ol>
				<li data-year="1"></li><li data-year="2"></li>
			</ol></div></div>
			<div class="stonetop-timeline-ages">
				<button class="stonetop-timeline-age" ${OFF_ATTR} data-age-first="1" data-age-last="2">
					<span class="stonetop-timeline-age-name">Embers</span>
				</button>
			</div>`;
		const rect = (left, width) => () => ({ left, right: left + width, top: 0, bottom: 50, width, height: 50 });
		const [one, two] = document.querySelectorAll("[data-year]");
		one.getBoundingClientRect = rect(150, 200);
		two.getBoundingClientRect = rect(350, 300);
		const layer = document.querySelector(".stonetop-timeline-ages");
		layer.getBoundingClientRect = rect(50, 800);
		return { scroll: document.querySelector(".scroll"), layer, band: layer.querySelector("button") };
	}

	it("places the band under its years once wired, and shows it", () => {
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 1; });
		const { scroll, layer, band } = rig();
		const unwire = wireAgeBands(scroll, layer, { horizontal: true });
		expect(band.hasAttribute(OFF_ATTR)).toBe(false);
		expect(band.style.getPropertyValue("--age-pos")).toBe("100px");
		expect(band.style.getPropertyValue("--age-length")).toBe("500px");
		unwire();
	});

	it("hides a band whose years are not drawn", () => {
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 1; });
		const { scroll, layer, band } = rig();
		band.dataset.ageLast = "9";
		wireAgeBands(scroll, layer, { horizontal: true })();
		expect(band.hasAttribute(OFF_ATTR)).toBe(true);
	});
});
