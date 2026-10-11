// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";

// THE AGES' BANDS: each laid under the years it covers, wherever the column draws them, its name
// centred in what is on screen of it, and never drawn under a pinned header.

const { bandPlacement, wireAgeBands, OFF_ATTR } = await import("../../module/timeline/timeline-ages-band.js");

describe("bandPlacement", () => {
	it("runs from the first year's near edge to the last year's far edge, its name centred", () => {
		expect(bandPlacement({ start: 100, end: 400, size: 800, name: 80 }))
			.toEqual({ hidden: false, pos: 100, length: 300, shift: 110 });
	});

	it("centres the name in what is on screen of a band run off either end, never past its own ends", () => {
		expect(bandPlacement({ start: -200, end: 400, size: 800, name: 80 }).shift).toBe(360);
		expect(bandPlacement({ start: 600, end: 1200, size: 800, name: 80 }).shift).toBe(60);
		// Only 40px of band left on screen: the name stops where it still fits inside the band.
		expect(bandPlacement({ start: -560, end: 40, size: 800, name: 80 }).shift).toBe(600 - 80);
	});

	it("keeps the name clear of a pinned column", () => {
		expect(bandPlacement({ start: 0, end: 600, size: 800, clip: 240, name: 80 }).shift).toBe(380);
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

	it("writes layout pixels when the window is drawn at a UI scale", () => {
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 1; });
		const { scroll, layer, band } = rig();
		// The same strip drawn twice its size: 800 on screen, laid out 400.
		Object.defineProperty(layer, "offsetWidth", { value: 400 });
		const unwire = wireAgeBands(scroll, layer, { horizontal: true });
		expect(band.style.getPropertyValue("--age-pos")).toBe("50px");
		expect(band.style.getPropertyValue("--age-length")).toBe("250px");
		unwire();
	});

	it("hides a band whose years are not drawn", () => {
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 1; });
		const { scroll, layer, band } = rig();
		band.dataset.ageLast = "9";
		wireAgeBands(scroll, layer, { horizontal: true })();
		expect(band.hasAttribute(OFF_ATTR)).toBe(true);
	});

	it("keeps the strip clear of the scrollbar along the foot in both layouts, never the one down the side", () => {
		vi.stubGlobal("requestAnimationFrame", (fn) => { fn(); return 1; });
		for (const horizontal of [true, false]) {
			const { scroll, layer } = rig();
			// A 14px bar down the right edge, a 10px one along the foot.
			Object.defineProperties(scroll, {
				offsetWidth: { value: 414 }, clientWidth: { value: 400 },
				offsetHeight: { value: 310 }, clientHeight: { value: 300 },
			});
			wireAgeBands(scroll, layer, { horizontal })();
			expect(layer.style.getPropertyValue("--timeline-ages-bar")).toBe("10px");
		}
	});
});
