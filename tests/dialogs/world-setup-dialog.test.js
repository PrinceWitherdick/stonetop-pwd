// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The setup window is a singleton, so a second run reopens the window the first one left up.
// Reopening has to take on the new run's rows AND words: the update window's one row says how
// many journals changed in which version, so two runs can share their keys and still say
// different things.

const { WorldSetupDialog } = await import("../../module/dialogs/WorldSetupDialog.js");
const { FIRST_LOAD_LEAD } = await import("../../module/dialogs/world-setup-steps.js");

const ROW = label => [{ key: "journalSync", label }];
const COPY = (lead, doneLine = "Done.") => ({ title: "Updating your world", lead, doneLine });

/** A window that was put up and has settled, with its re-render spied on. */
function settledWindow(steps, copy) {
	const dialog = new WorldSetupDialog(steps, copy);
	dialog.renderNow = vi.fn();
	dialog._complete = true;
	return dialog;
}

describe("WorldSetupDialog.adoptSteps", () => {
	it("does nothing when the rows and the words are the same", () => {
		const dialog = settledWindow(ROW("3 journals changed in 1.9.0"), COPY("A"));

		dialog.adoptSteps(ROW("3 journals changed in 1.9.0"), COPY("A"));

		expect(dialog.renderNow).not.toHaveBeenCalled();
		expect(dialog._complete).toBe(true);
	});

	it("takes on new words and row labels even when the keys match", () => {
		const dialog = settledWindow(ROW("3 journals changed in 1.9.0"), COPY("Old lead", "Old done."));

		dialog.adoptSteps(ROW("2 journals changed in 2.0.0"), COPY("New lead", "New done."));

		const data = dialog.getData();
		expect(data.lead).toBe("New lead");
		expect(data.steps[0].label).toBe("2 journals changed in 2.0.0");
		// A fresh run, so it is no longer showing the old run's closing summary.
		expect(data.complete).toBe(false);
		expect(dialog.renderNow).toHaveBeenCalled();
	});

	it("writes a new title into a header that is already up", () => {
		const dialog = settledWindow(ROW("x"), COPY("A"));
		const root = document.createElement("div");
		root.innerHTML = `<header><h4 class="window-title">Setting up your world</h4></header>`;
		dialog.element = [root];

		dialog.adoptSteps(ROW("x"), { ...COPY("B"), title: "Something else" });

		expect(root.querySelector(".window-title").textContent).toBe("Something else");
	});

	it("opens on the first-load words when its caller gives none", () => {
		const dialog = new WorldSetupDialog(ROW("x"));
		expect(dialog.getData().lead).toBe(FIRST_LOAD_LEAD);
	});
});

// A run with failures stays up for the GM to read, so it must not be buried by the windows the
// load opens straight after it (the Welcome guide, resumed walkthroughs). Nothing waits on it.
describe("a finished window with failures", () => {
	let handlers;

	beforeEach(() => {
		vi.useFakeTimers();
		handlers = {};
		let nextId = 1;
		global.Hooks = {
			...global.Hooks,
			on: (name, fn) => { const id = nextId++; (handlers[name] ??= new Map()).set(id, fn); return id; },
			off: (name, id) => { handlers[name]?.delete(id); },
		};
		global.ui = { windows: { 7: {} }, activeWindow: null };
	});
	afterEach(() => { vi.useRealTimers(); });

	const fire = (name, ...args) => { for (const fn of handlers[name]?.values() ?? []) fn(...args); };

	/** A rendered window whose one row failed, finished, with its raise spied on. */
	function failedWindow() {
		const dialog = new WorldSetupDialog(ROW("x"), COPY("A"));
		dialog.renderNow = vi.fn();
		dialog.rendered = true;
		dialog.element = [document.createElement("div")];
		dialog.bringToTop = vi.fn();
		dialog.fail("journalSync", "Could not finish");
		void dialog.finish();
		return dialog;
	}

	it("comes to the front, and again over a window that opens after it", () => {
		const dialog = failedWindow();
		expect(dialog.bringToTop).toHaveBeenCalledTimes(1);

		fire("renderApplication", { popOut: true, appId: 12 });
		fire("renderApplicationV2", { hasFrame: true }, null, {}, { isFirstRender: true });
		vi.advanceTimersByTime(0);

		expect(dialog.bringToTop).toHaveBeenCalledTimes(3);
	});

	it("ignores a window that was already up re-rendering", () => {
		const dialog = failedWindow();

		fire("renderApplication", { popOut: true, appId: 7 });
		fire("renderApplicationV2", { hasFrame: true }, null, {}, { isFirstRender: false });
		vi.advanceTimersByTime(0);

		expect(dialog.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("stops once the GM clicks into another window", () => {
		const dialog = failedWindow();

		document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		fire("renderApplication", { popOut: true, appId: 12 });
		vi.advanceTimersByTime(0);

		expect(dialog.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("stops after the load's burst of windows", () => {
		const dialog = failedWindow();

		vi.advanceTimersByTime(10_000);
		fire("renderApplication", { popOut: true, appId: 12 });
		vi.advanceTimersByTime(0);

		expect(dialog.bringToTop).toHaveBeenCalledTimes(1);
	});

	it("does none of this when nothing failed", () => {
		const dialog = new WorldSetupDialog(ROW("x"), COPY("A"));
		dialog.renderNow = vi.fn();
		dialog.rendered = true;
		dialog.bringToTop = vi.fn();
		dialog.done("journalSync", "ok");
		void dialog.finish();

		fire("renderApplication", { popOut: true, appId: 12 });
		vi.advanceTimersByTime(0);

		expect(dialog.bringToTop).not.toHaveBeenCalled();
		expect(handlers.renderApplication?.size ?? 0).toBe(0);
	});
});
