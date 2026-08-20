import { describe, it, expect, vi, afterEach } from "vitest";
import { openSystemSetting, SETTING_FLASH_CLASS, SETTING_FLASH_MS } from "../../module/utils/open-settings.js";

// "Open Configure Settings and land on the row." The window opening is the promise this makes;
// finding the row inside it is best effort over markup that belongs to core, so what is guarded
// here is mostly that the best effort cannot take the guaranteed part down with it.

const saved = { game: undefined, document: undefined };
function hold() {
	saved.game     = globalThis.game;
	saved.document = globalThis.document;
}

afterEach(() => {
	for (const key of Object.keys(saved)) {
		if (saved[key] === undefined) delete globalThis[key];
		else globalThis[key] = saved[key];
		saved[key] = undefined;
	}
	vi.useRealTimers();
});

/**
 * A settings window with one row in it: the input core names after the setting, inside the
 * `.form-group` that is what actually gets lit, on a tab that is not the one showing.
 *
 * The row hangs off the APP's element, not off the document, because that is where this looks for
 * it. `stray` puts an identically-named row on the document and nowhere near the settings window,
 * standing in for the second Configure Settings popout or the module settings editor whose control
 * carries the same `name` — a document-wide query would light that one instead.
 */
function settingsWindow({ row = true, stray = false } = {}) {
	const classes  = new Set();
	const formGroup = {
		classList:      { add: c => classes.add(c), remove: c => classes.delete(c) },
		closest:        sel => (sel === "[data-tab]" ? { dataset: { tab: "system" } } : null),
		scrollIntoView: vi.fn(),
	};
	const input   = { closest: sel => (sel === ".form-group" ? formGroup : null) };
	const tabLink = { click: vi.fn() };
	const strayGroup = { classList: { add: vi.fn(), remove: vi.fn() }, scrollIntoView: vi.fn() };
	const strayInput = { closest: () => strayGroup };
	const element = {
		querySelector: vi.fn(sel => {
			if (sel.includes("data-tab=")) return tabLink;
			return row ? input : null;
		}),
	};
	const app = { render: vi.fn(async () => {}), element };

	hold();
	globalThis.game     = { settings: { sheet: app } };
	globalThis.document = { querySelector: vi.fn(() => (stray ? strayInput : null)) };
	return { app, element, tabLink, formGroup, strayGroup, classes, lit: () => classes.has(SETTING_FLASH_CLASS) };
}

describe("jumping to a system setting", () => {
	it("opens Configure Settings and looks for the setting by its full id", async () => {
		const { app, element } = settingsWindow();

		expect(await openSystemSetting("weatherSceneFx")).toBe(true);
		expect(app.render).toHaveBeenCalledWith(true);
		// `name="<system>.<key>"` is how core's own form maps back onto settings when it is
		// submitted, so it is the one attribute the row is certain to carry.
		expect(element.querySelector.mock.calls[0][0]).toContain("stonetop-pwd.weatherSceneFx");
	});

	// A setting's name is not unique to one window. Asking the whole document for it lit whichever
	// matching control happened to come first — and then read a `[data-tab]` out of that window's
	// tree and clicked it in this one.
	it("never reaches into a window that is not the settings window", async () => {
		const { formGroup, strayGroup, lit } = settingsWindow({ row: false, stray: true });

		expect(await openSystemSetting("weatherSceneFx")).toBe(true);
		expect(strayGroup.scrollIntoView).not.toHaveBeenCalled();
		expect(strayGroup.classList.add).not.toHaveBeenCalled();
		expect(formGroup.scrollIntoView).not.toHaveBeenCalled();
		expect(lit()).toBe(false);
	});

	// The row is no use behind a tab that is not showing, and none of the twenty around it says
	// which one the reader came for.
	it("shows the row's tab, scrolls to it, and lights it", async () => {
		const { tabLink, formGroup, lit } = settingsWindow();

		await openSystemSetting("weatherSceneFx");

		expect(tabLink.click).toHaveBeenCalled();
		expect(formGroup.scrollIntoView).toHaveBeenCalled();
		expect(lit()).toBe(true);
	});

	it("puts the light out on its own", async () => {
		vi.useFakeTimers();
		const { lit } = settingsWindow();

		await openSystemSetting("weatherSceneFx");
		expect(lit()).toBe(true);

		vi.advanceTimersByTime(SETTING_FLASH_MS);
		expect(lit()).toBe(false);
	});

	// The markup is core's. A version that renames the class or moves the row must leave the GM
	// looking at an open settings window, which is what they asked for, rather than at nothing.
	it("still counts as done when the row cannot be found", async () => {
		const { app } = settingsWindow({ row: false });

		expect(await openSystemSetting("weatherSceneFx")).toBe(true);
		expect(app.render).toHaveBeenCalledWith(true);
	});

	it("stands down where there is no settings window to open", async () => {
		hold();
		globalThis.game = { settings: {} };
		expect(await openSystemSetting("weatherSceneFx")).toBe(false);

		delete globalThis.game;
		expect(await openSystemSetting("weatherSceneFx")).toBe(false);
	});
});
