import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A timeline entry being written comes back after a reload (dialogs/timeline-entry-restore.js) with
// everything typed in it, and, since the timeline that awaited its answer is gone, writes the entry
// itself through the timeline's own writer.

vi.mock("../../module/timeline/timeline-places.js", () => ({
	placeSuggestions: () => [],
	mergePlaceNames: (...lists) => lists.flat().filter(Boolean),
}));
vi.mock("../../module/timeline/timeline-tag-store.js", () => ({ worldCustomTags: () => [], createCustomTag: vi.fn() }));
vi.mock("../../module/timeline/timeline-store.js", async importOriginal => ({ ...(await importOriginal()), readTrack: vi.fn(() => ({ entries: [] })) }));
vi.mock("../../module/timeline/timeline-entry-write.js", () => ({ writeTimelineEntry: vi.fn(async () => ({})) }));
vi.mock("../../module/settings.js", async importOriginal => ({ ...(await importOriginal()), isTimelineShown: vi.fn(() => true) }));

const { TimelineEntryDialog } = await import("../../module/dialogs/TimelineEntryDialog.js");
const { readTrack } = await import("../../module/timeline/timeline-store.js");
const { writeTimelineEntry } = await import("../../module/timeline/timeline-entry-write.js");
const { isTimelineShown } = await import("../../module/settings.js");
const {
	TIMELINE_ENTRY_WINDOW_CLASS, TIMELINE_ENTRY_RESTORE_KIND, reopenTimelineEntry,
} = await import("../../module/dialogs/timeline-entry-restore.js");

const { TIMELINE_COLOUR_KINDS } = await import("../../module/timeline/timeline-colours.js");
const TAG = TIMELINE_COLOUR_KINDS[0];

const TRACK = { trackId: "a1", trackKind: "character", name: "Kefta" };

/** A form stand-in: the dialog reaches it only through `querySelector(...).value`. */
function formOf(values) {
	return { querySelector: sel => (sel in values ? { value: values[sel] } : null) };
}
const TITLE = ".stonetop-timeline-entry-title";
const PLACE = ".stonetop-timeline-entry-place";
const BODY  = ".stonetop-timeline-entry-body";
const YEAR  = ".stonetop-season-year-input";

/** A dialog left open with typing in it, and the view a reload would have saved. */
function leftOpen({ entry = null, target = { track: TRACK } } = {}) {
	const dialog = new TimelineEntryDialog({ entry, season: "summer", year: 3, nowYear: 4, trackName: "Kefta", target });
	dialog._readYear = () => 2;
	dialog.element = [formOf({ [TITLE]: "The Bloody Hollow", [PLACE]: "The barrow", [BODY]: "Kefta did not come back.", [YEAR]: "2" })];
	dialog._season = "autumn";
	dialog._tag = TAG;
	return { dialog, view: JSON.parse(JSON.stringify(dialog.restoreView)) };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the timeline entry restore", () => {
	it("watches the class that actually draws the window", () => {
		expect(TimelineEntryDialog.name).toBe(TIMELINE_ENTRY_WINDOW_CLASS);
	});

	it("is saved under its own id only when it knows where its answer goes", () => {
		const dialog = new TimelineEntryDialog({ target: { track: TRACK }, restoreId: "r1" });
		expect(dialog.restoreKey).toBe(`${TIMELINE_ENTRY_RESTORE_KIND}:r1`);
		expect(new TimelineEntryDialog({}).restoreKey).toBeNull();
		expect(new TimelineEntryDialog({}).restoreView).toBeNull();
	});

	it("comes back with the date, the tag and every word typed, and where it writes", async () => {
		const { view } = leftOpen();
		const back = await reopenTimelineEntry("timelineEntry:r1");
		back._takeRestoredView(view);
		expect(back._target).toEqual({ track: TRACK });
		expect(back._season).toBe("autumn");
		expect(back._year).toBe(2);
		expect(back._tag).toBe(TAG);
		const data = back.getData();
		expect(data).toMatchObject({ entryTitle: "The Bloody Hollow", place: "The barrow", body: "Kefta did not come back.", trackName: "Kefta" });
		expect(data.tagOptions.find(t => t.selected)?.id).toBe(TAG);
	});

	it("reopens an edit on its entry as it now is, under what was typed", async () => {
		const entry = { id: "e1", title: "Old title", body: "Old body", season: "spring", year: 1, source: "hand" };
		readTrack.mockReturnValue({ entries: [entry] });
		const { view } = leftOpen({ entry, target: { track: TRACK, entryId: "e1" } });
		const back = await reopenTimelineEntry("timelineEntry:r1");
		back._takeRestoredView(view);
		expect(back._entry).toBe(entry);
		expect(back.getData()).toMatchObject({ isEdit: true, entryTitle: "The Bloody Hollow" });
	});

	it("stays shut for an edit whose entry has gone, and for a view with nowhere to write", async () => {
		readTrack.mockReturnValue({ entries: [] });
		const { view } = leftOpen({ entry: { id: "e1", source: "hand" }, target: { track: TRACK, entryId: "e1" } });
		const gone = await reopenTimelineEntry("timelineEntry:r1");
		gone._takeRestoredView(view);
		expect(await gone._render(true, {})).toBeUndefined();
		const nowhere = await reopenTimelineEntry("timelineEntry:r2");
		nowhere._takeRestoredView({ target: { track: {} } });
		expect(await nowhere._render(true, {})).toBeUndefined();
		// And one handed no view at all opens nothing, rather than a blank dialog nothing tracks.
		const bare = await reopenTimelineEntry("timelineEntry:r3");
		expect(await bare._render(true, {})).toBeUndefined();
	});

	it("reopens for its own kind only, and not while the world has the timeline off", async () => {
		expect(await reopenTimelineEntry("timeline:aggregate")).toBeNull();
		expect(await reopenTimelineEntry("timelineEntry:")).toBeNull();
		isTimelineShown.mockReturnValueOnce(false);
		expect(await reopenTimelineEntry("timelineEntry:r1")).toBeNull();
	});
});

describe("saving a restored entry", () => {
	async function restored(extra = {}) {
		const { view } = leftOpen(extra);
		const back = await reopenTimelineEntry("timelineEntry:r1");
		back._takeRestoredView(view);
		back._readYear = () => 2;
		back._resolveWith = vi.fn();
		return back;
	}

	it("writes the entry itself onto the thread it was opened on", async () => {
		const back = await restored();
		await back._save(formOf({ [TITLE]: "The Bloody Hollow", [PLACE]: "", [BODY]: "Kefta did not come back." }));
		expect(writeTimelineEntry).toHaveBeenCalledWith({ track: TRACK }, expect.objectContaining({
			season: "autumn", year: 2, title: "The Bloody Hollow", body: "Kefta did not come back.", tag: TAG,
		}));
		expect(back._resolveWith).toHaveBeenCalledTimes(1);
	});

	it("stays open and says so when the thread refuses the write", async () => {
		writeTimelineEntry.mockRejectedValueOnce(new Error("not yours"));
		const back = await restored();
		back.reportWriteFailure = vi.fn();
		await back._save(formOf({ [TITLE]: "The Bloody Hollow", [PLACE]: "", [BODY]: "" }));
		expect(back.reportWriteFailure).toHaveBeenCalled();
		expect(back._resolveWith).not.toHaveBeenCalled();
	});

	it("still hands the answer back to the timeline that awaited it, when there was no reload", async () => {
		const { dialog } = leftOpen();
		dialog._resolveWith = vi.fn();
		await dialog._save(formOf({ [TITLE]: "The Bloody Hollow", [PLACE]: "", [BODY]: "" }));
		expect(writeTimelineEntry).not.toHaveBeenCalled();
		expect(dialog._resolveWith).toHaveBeenCalledTimes(1);
	});
});
