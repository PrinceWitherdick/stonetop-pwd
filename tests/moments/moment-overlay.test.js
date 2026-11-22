// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { momentView } from "../../module/moments/moment-view.js";
import {
	playMoment, _resetMoments, momentLifeMs, MOMENT_ID, MOMENT_VOICE_DELAY_MS, MOMENT_EXIT_S,
} from "../../module/moments/moment-overlay.js";

// The table moment on this screen (module/moments/moment-overlay.js): one band at a time, words
// as text in a live region, still for a reader who asked for less motion, and always taken down.

const band = () => document.getElementById(MOMENT_ID);
const shown = () => vi.advanceTimersByTime(MOMENT_VOICE_DELAY_MS);
const motion = reduce => { window.matchMedia = () => ({ matches: reduce }); };

beforeEach(() => {
	vi.useFakeTimers();
	motion(false);
	document.documentElement.className = "";
});

afterEach(() => {
	_resetMoments();
	vi.useRealTimers();
});

describe("playMoment", () => {
	it("builds the band as a polite live region, its words going in after it is in the page", () => {
		playMoment(momentView({ kind: "fight", sub: "On the road to the Crossroads" }));
		const el = band();
		expect(el.getAttribute("role")).toBe("status");
		expect(el.getAttribute("aria-live")).toBe("polite");
		expect(el.querySelector(".stonetop-moment-title")).toBeNull();
		shown();
		expect(el.querySelector(".stonetop-moment-title").textContent).toBe("A fight breaks out");
		expect(el.querySelector(".stonetop-moment-sub").textContent).toBe("On the road to the Crossroads");
		expect(el.querySelector(".stonetop-moment-veil").getAttribute("aria-hidden")).toBe("true");
		const icon = el.querySelector("i.stonetop-moment-icon");
		expect(icon.classList.contains("fa-swords")).toBe(true);
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(el.classList.contains("is-playing")).toBe(true);
	});

	it("sets the words as text, never markup", () => {
		playMoment(momentView({ kind: "setOut", title: "<b>x</b>", sub: "<img src=x onerror=alert(1)>" }));
		shown();
		expect(band().querySelector("b")).toBeNull();
		expect(band().querySelector("img")).toBeNull();
		expect(band().querySelector(".stonetop-moment-title").textContent).toBe("<b>x</b>");
	});

	it("leaves out the sub when empty and the veil unless the kind has one", () => {
		playMoment(momentView({ kind: "arrive" }));
		shown();
		expect(band().querySelector(".stonetop-moment-sub")).toBeNull();
		expect(band().querySelector(".stonetop-moment-veil")).toBeNull();
		expect(band().classList.contains("stonetop-moment--small")).toBe(true);
	});

	it("is still, and gone after its hold, for a reader whose OS asks for less motion", () => {
		motion(true);
		const view = momentView({ kind: "home" });
		playMoment(view);
		shown();
		expect(band().classList.contains("is-still")).toBe(true);
		expect(band().classList.contains("is-playing")).toBe(false);
		vi.advanceTimersByTime(view.holdMs);
		expect(band()).toBeNull();
	});

	it("is still under the system's own Reduce Motion", () => {
		document.documentElement.classList.add("stonetop-reduce-motion");
		playMoment(momentView({ kind: "home" }));
		shown();
		expect(band().classList.contains("is-still")).toBe(true);
	});

	it("tells the stylesheet when to start the fade", () => {
		const view = momentView({ kind: "fight" });
		playMoment(view);
		const at = parseFloat(band().style.getPropertyValue("--stonetop-moment-out-at"));
		expect(at * 1000).toBeCloseTo(momentLifeMs(view) - MOMENT_EXIT_S * 1000, 5);
	});

	it("comes down at its fade's end, or by the timer when that end never comes", () => {
		const view = momentView({ kind: "setOut" });
		playMoment(view);
		shown();
		const el = band();
		const done = new Event("animationend");
		Object.defineProperty(done, "animationName", { value: "stonetop-moment-in" });
		el.dispatchEvent(done);
		expect(band()).toBe(el);
		vi.advanceTimersByTime(momentLifeMs(view) + 499);
		expect(band()).toBe(el);
		vi.advanceTimersByTime(1);
		expect(band()).toBeNull();
	});

	it("comes down on the fade's own animationend", () => {
		playMoment(momentView({ kind: "setOut" }));
		shown();
		const done = new Event("animationend");
		Object.defineProperty(done, "animationName", { value: "stonetop-moment-out" });
		band().dispatchEvent(done);
		expect(band()).toBeNull();
	});

	it("keeps one waiting behind the band, a newer arrival replacing it", () => {
		motion(true);
		playMoment(momentView({ kind: "fight" }));
		playMoment(momentView({ kind: "setOut" }));
		playMoment(momentView({ kind: "home" }));
		expect(document.querySelectorAll(`#${MOMENT_ID}`).length).toBe(1);
		shown();
		vi.advanceTimersByTime(1200);
		shown();
		expect(band().classList.contains("stonetop-moment--home")).toBe(true);
		vi.advanceTimersByTime(1600);
		expect(band()).toBeNull();
	});

	it("does nothing for a null view", () => {
		expect(playMoment(null)).toBe(false);
		expect(band()).toBeNull();
	});
});
