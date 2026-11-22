// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readCss } from "../fakes/css.js";

// The step fade (StepperDialog `_stepMotion`): a walkthrough that opts in slides each new step in,
// from the right after Next and from the left after Back. Never on the window's first draw, never on
// a redraw of the same step, never for a reader who asked for less motion, and the class always comes
// off again, by `animationend` or by a timer when none comes (a hidden tab).

vi.mock("../../module/dialogs/walkthrough-resume.js", () => ({
	getWalkthroughResume:    () => null,
	patchWalkthroughResume:  () => {},
	saveWalkthroughPosition: () => {},
}));

const { StepperDialog } = await import("../../module/dialogs/StepperDialog.js");

const STATES = Application.RENDER_STATES;

/** A stepper whose core render puts a fresh `.stonetop-guide-main` in, as AppV1 replaces the content. */
function stepper({ motion = true } = {}) {
	const d = Object.create(StepperDialog.prototype);
	d._step = 0;
	d._frontOnOpen = { apply() {}, start() {}, stop() {} };
	d._state = STATES.RENDERED;
	d._saveResume = () => {};
	Object.defineProperty(d, "_steps", { get: () => [{ key: "a" }, { key: "b" }, { key: "c" }] });
	Object.defineProperty(d, "_stepMotion", { get: () => motion });
	const root = document.createElement("div");
	document.body.append(root);
	d.element = [root];
	d.render = () => {};
	vi.spyOn(Application.prototype, "_render").mockImplementation(async function () {
		root.innerHTML = `<section class="stonetop-guide-main" data-step="${this._step}"></section>`;
	});
	return { d, main: () => root.querySelector(".stonetop-guide-main") };
}

let reduce;
beforeEach(() => {
	reduce = false;
	globalThis.matchMedia = query => ({ matches: reduce && query.includes("reduce") });
	document.documentElement.classList.remove("stonetop-reduce-motion");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	delete globalThis.matchMedia;
});

describe("the step fade", () => {
	it("leaves the window's first draw and a redraw of the same step still", async () => {
		const { d, main } = stepper();
		await d._render(false);
		expect(main().classList.contains("is-entering")).toBe(false);
		await d._render(false);
		expect(main().classList.contains("is-entering")).toBe(false);
	});

	it("slides in after Next, and from the other side after Back", async () => {
		const { d, main } = stepper();
		await d._render(false);
		d._advance();
		await d._render(false);
		expect([...main().classList]).toEqual(["stonetop-guide-main", "is-entering"]);
		d._retreat();
		await d._render(false);
		expect([...main().classList]).toEqual(["stonetop-guide-main", "is-entering", "is-entering--back"]);
	});

	it("takes the class off when its animation ends, or by a timer when it never does", async () => {
		vi.useFakeTimers();
		const { d, main } = stepper();
		await d._render(false);
		d._advance();
		await d._render(false);
		main().dispatchEvent(new Event("animationend"));
		expect(main().classList.contains("is-entering")).toBe(false);
		d._advance();
		await d._render(false);
		expect(main().classList.contains("is-entering")).toBe(true);
		vi.advanceTimersByTime(400);
		expect(main().classList.contains("is-entering")).toBe(false);
	});

	it("does nothing for a stepper that has not opted in, or a reader who asked for less motion", async () => {
		const off = stepper({ motion: false });
		await off.d._render(false);
		off.d._advance();
		await off.d._render(false);
		expect(off.main().classList.contains("is-entering")).toBe(false);

		document.body.innerHTML = "";
		vi.restoreAllMocks();
		for (const ask of ["os", "setting"]) {
			const { d, main } = stepper();
			reduce = ask === "os";
			document.documentElement.classList.toggle("stonetop-reduce-motion", ask === "setting");
			await d._render(false);
			d._advance();
			await d._render(false);
			expect(main().classList.contains("is-entering"), ask).toBe(false);
			vi.restoreAllMocks();
		}
	});

	it("is any opted-in stepper's, and the less-motion class stops it", () => {
		const css = readCss();
		expect(css).toMatch(/\n\.stonetop-guide-main\.is-entering \{\s*animation: stonetop-guide-step-in 0\.18s ease-out both;/);
		expect(css).toMatch(/\n:root\.stonetop-less-motion \.stonetop-guide-main\.is-entering \{ animation: none; \}/);
		expect(css.match(/@keyframes stonetop-guide-step-(in|back) \{/g)).toHaveLength(2);
	});
});
