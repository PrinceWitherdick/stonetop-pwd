import { beforeEach, describe, expect, it } from "vitest";
import { registerStonetopLightTheme } from "../../module/utils/window-theme.js";

// The forcer holds Stonetop's ApplicationV2 windows to the light theme in a dark-mode
// world. The env is node, so we fake the only DOM surface it touches — a root element's
// classList — and capture the handler the way Foundry would, by registering it.

class ClassList {
	constructor(names) { this._set = new Set(names); }
	add(...names) { for (const n of names) this._set.add(n); }
	remove(...names) { for (const n of names) this._set.delete(n); }
	contains(name) { return this._set.has(name); }
	[Symbol.iterator]() { return this._set[Symbol.iterator](); }
	get value() { return [...this._set].join(" "); }
}

/** A rendered window root carrying the classes Foundry and our code put on the frame. */
function root(...classes) {
	return { classList: new ClassList(classes) };
}

let onRender;

beforeEach(() => {
	// Capture the handler registerStonetopLightTheme binds, and assert it binds the
	// generic V2 hook: ApplicationV2 dispatches `renderApplicationV2` for every V2
	// window, which is what lets one registration cover dialogs we never subclass.
	const registered = [];
	global.Hooks = { on: (name, fn) => registered.push([name, fn]), once: () => {} };
	registerStonetopLightTheme();
	expect(registered.map(([name]) => name)).toEqual(["renderApplicationV2"]);
	onRender = registered[0][1];
});

describe("forced light theme on Stonetop windows", () => {
	it("swaps a dark-mode Stonetop dialog onto the light theme", () => {
		// A dark-mode world hands the frame `themed theme-dark`.
		const el = root("application", "dialog", "stonetop", "stonetop-themed", "themed", "theme-dark");
		onRender(null, el);
		expect(el.classList.contains("theme-dark")).toBe(false);
		expect(el.classList.contains("theme-light")).toBe(true);
		// Core's rule is `.themed.theme-light`, so both classes have to be present.
		expect(el.classList.contains("themed")).toBe(true);
	});

	it("marks a light-mode window too, so a mid-session switch to dark cannot reach it", () => {
		const el = root("application", "stonetop-fight-targets-app");
		onRender(null, el);
		expect(el.classList.contains("themed")).toBe(true);
		expect(el.classList.contains("theme-light")).toBe(true);
	});

	it("leaves core and other modules' windows on the world's theme", () => {
		for (const el of [
			root("application", "dialog", "themed", "theme-dark"),
			root("application", "sheet", "journal-entry", "themed", "theme-dark"),
			root("application", "some-module-window", "theme-dark"),
		]) {
			onRender(null, el);
			expect(el.classList.contains("theme-dark")).toBe(true);
			expect(el.classList.contains("theme-light")).toBe(false);
		}
	});

	it("ignores the bare package id, which is not a claim to own the window", () => {
		// `stonetop-pwd` is the system id; core or a module may stamp it on a window we
		// do not own, so only `stonetop` / `stonetop-*` skin classes count.
		const el = root("application", "stonetop-pwd", "themed", "theme-dark");
		onRender(null, el);
		expect(el.classList.contains("theme-dark")).toBe(true);
		expect(el.classList.contains("theme-light")).toBe(false);
	});

	it("accepts a jQuery-wrapped root, as AppV1 passes on v12", () => {
		const el = root("window-app", "stonetop-themed", "theme-dark");
		onRender(null, { jquery: "3.x", 0: el });
		expect(el.classList.contains("theme-light")).toBe(true);
	});

	it("is idempotent across re-renders and survives a frameless application", () => {
		const el = root("stonetop-themed", "theme-dark");
		onRender(null, el);
		onRender(null, el);
		expect(el.classList.value).toBe("stonetop-themed themed theme-light");
		expect(() => onRender(null, null)).not.toThrow();
		expect(() => onRender(null, {})).not.toThrow();
	});
});
