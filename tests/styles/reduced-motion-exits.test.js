// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readCss } from "../fakes/css.js";

// A reader asks for less motion in one of two ways: the OS (`prefers-reduced-motion: reduce`) or the
// system's Reduce Motion setting. settings.js#applyReduceMotion folds both into ONE root class,
// `stonetop-less-motion`, and every motion rule keys on that class. When rules wrote the two exits out
// for themselves, some honoured only the OS and some only the setting, and the setting's blanket
// (which zeroes durations) landed a fade on its transparent last frame instead of the drawn wash.
//
// `stonetop-reduce-motion` stays the setting alone: its blanket and the hidden hover-zoom popups are
// what the setting's hint promises, and the OS never asked for those.

const CSS = readCss();

describe("the stylesheet's motion exits", () => {
	it("never asks the media query itself", () => {
		expect(CSS).not.toMatch(/prefers-reduced-motion/);
	});

	it("uses the setting-only class just for its blanket and the hover popups", () => {
		const preludes = [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)]
			.map(m => m[1])
			.filter(p => p.includes("stonetop-reduce-motion"));
		const allowed = /^\.stonetop-reduce-motion \.stonetop(-welcome-springicon-wrap::after|-hover-popup|-welcome-springicon|-onboarding-arcana-thumb)?( \*(::before|::after)?)?$/;
		for (const prelude of preludes) {
			for (const sel of prelude.split(",").map(s => s.trim()).filter(Boolean)) {
				expect(sel, "a motion rule should key on stonetop-less-motion").toMatch(allowed);
			}
		}
	});
});

describe("applyReduceMotion", () => {
	let os;
	let listener;
	let applyReduceMotion;

	beforeEach(async () => {
		os = { matches: false };
		listener = null;
		vi.stubGlobal("matchMedia", query => ({
			get matches() { return query === "(prefers-reduced-motion: reduce)" && os.matches; },
			addEventListener: (type, fn) => { if (type === "change") listener = fn; },
		}));
		vi.resetModules();
		({ applyReduceMotion } = await import("../../module/settings.js"));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.documentElement.classList.remove("stonetop-reduce-motion", "stonetop-less-motion");
	});

	const classes = () => ({
		setting: document.documentElement.classList.contains("stonetop-reduce-motion"),
		less: document.documentElement.classList.contains("stonetop-less-motion"),
	});

	it("puts both classes on for the setting", () => {
		applyReduceMotion(true);
		expect(classes()).toEqual({ setting: true, less: true });
	});

	it("puts only the less-motion class on for the OS", () => {
		os.matches = true;
		applyReduceMotion(false);
		expect(classes()).toEqual({ setting: false, less: true });
	});

	it("follows the OS changing while the table is open", () => {
		applyReduceMotion(false);
		expect(classes().less).toBe(false);
		os.matches = true;
		listener();
		expect(classes()).toEqual({ setting: false, less: true });
		os.matches = false;
		listener();
		expect(classes().less).toBe(false);
	});

	it("takes both off when neither asks", () => {
		applyReduceMotion(true);
		applyReduceMotion(false);
		expect(classes()).toEqual({ setting: false, less: false });
	});
});
