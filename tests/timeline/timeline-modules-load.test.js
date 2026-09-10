import { describe, it, expect } from "vitest";

// A LOADING CHECK, and it is not busywork. Most of this feature's modules are exercised by the
// suites next door, but the two Application subclasses and the tab that mounts them are reached
// only through Foundry, and an import that throws at module scope shows up in a world as the whole
// system failing to initialise with one line in the console. Three things would do it here:
//
//  • a circular import, which this feature has already had once: the timeline core imports the
//    season clock for `seasonRank`, the clock imports the Seasons Change journal for `yearLabel`,
//    and that journal writes a timeline row. It is broken by a call-time import in exactly one
//    place, and nothing but this would notice it coming back;
//  • a module-scope call into a Foundry global that only exists once a world is up; and
//  • a stale path after a file is moved.

describe("every timeline module loads", () => {
	// Named one by one rather than globbed: a glob would quietly stop covering a module the day it
	// is renamed, which is one of the three failures this is here to catch.
	const MODULES = [
		"../../module/timeline/timeline-core.js",
		"../../module/timeline/timeline-store.js",
		"../../module/timeline/timeline-view.js",
		"../../module/timeline/timeline-tab.js",
		"../../module/timeline/timeline-places.js",
		"../../module/timeline/timeline-seasons.js",
		"../../module/timeline/timeline-auto-rows.js",
		"../../module/timeline/timeline-season-entry.js",
		"../../module/journal/StonetopTimelinePageSheet.js",
		"../../module/dialogs/TimelineWindow.js",
		"../../module/dialogs/TimelinePanel.js",
		"../../module/dialogs/TimelineEntryDialog.js",
		// NOT TimelinePageModel.js, and it cannot be: a TypeDataModel extends
		// `foundry.abstract.TypeDataModel` at class-definition time, and tests/setup.js fakes only
		// `foundry.utils` and `foundry.data.operators`. Every data model in this system sits outside
		// this kind of check for the same reason; the schema is exercised in the world.
	];

	for (const path of MODULES) {
		it(`loads ${path.split("/").pop()}`, async () => {
			const mod = await import(path);
			expect(mod).toBeTruthy();
		});
	}

	// ⚠ THE CYCLE THAT ALREADY BIT ONCE. Entering the ring at the journal end is what failed before
	// (a const read before its initializer ran), and it is the entry point a real world takes: the
	// Seasons Change move is what loads this first.
	it("survives being entered from the Seasons Change journal, which closes the ring", async () => {
		const mod = await import("../../module/seasons/seasons-chronicle.js");
		expect(mod.yearLabel(2)).toBe("Year Two");
	});

	// The panel IS the window, mounted frameless, and the two halves of that are load-bearing:
	// `popOut: false` is what makes AppV1 skip the frame, and `resizable: false` is what stops core
	// binding a Draggable to a tab body and what makes `setPosition` return early.
	it("keeps the panel frameless and unresizable, which is what makes it a tab body", async () => {
		const { TimelinePanel } = await import("../../module/dialogs/TimelinePanel.js");
		const { TimelineWindow } = await import("../../module/dialogs/TimelineWindow.js");
		expect(TimelinePanel.prototype).toBeInstanceOf(TimelineWindow);

		const options = TimelinePanel.defaultOptions;
		expect(options.popOut, "the panel would build a window frame inside the tab").toBe(false);
		expect(options.resizable, "core would bind a Draggable to a tab body").toBe(false);
	});

	// ⚠ The panel must NOT answer to the window's id: AppV1 resolves an element by id, and
	// `openTimelineWindow` focuses whatever it finds under that id -- so a panel sharing it would
	// be "brought to top" and the aggregate would refuse to open while any such sheet was on screen.
	it("gives the panel an id the aggregate window cannot be confused with", async () => {
		const { TimelinePanel } = await import("../../module/dialogs/TimelinePanel.js");
		const { TIMELINE_WINDOW_ID } = await import("../../module/dialogs/TimelineWindow.js");
		expect(TimelinePanel.panelId("abc")).not.toBe(TIMELINE_WINDOW_ID);
	});
});
