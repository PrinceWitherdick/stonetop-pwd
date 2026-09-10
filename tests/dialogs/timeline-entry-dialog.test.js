import { describe, it, expect, beforeEach, vi } from "vitest";

// WRITING DOWN ONE THING THAT HAPPENED. The dialog is a RESULT dialog: it collects a date, a
// title, a place and an account, and resolves them. It does not know where entries are stored or
// whether this is a new entry or an edit, so what is worth pinning is what it collects and what it
// refuses, plus the one thing the markup has to keep in step with the wiring (the field classes
// `_save` reads back).

vi.mock("../../module/timeline/timeline-places.js", () => ({
	placeSuggestions: () => ["The Stone", "Marshedge"],
	mergePlaceNames: (...lists) => lists.flat().filter(Boolean),
}));

const { TimelineEntryDialog } = await import("../../module/dialogs/TimelineEntryDialog.js");

/**
 * The dialog without a Foundry Application under it: every method exercised below reads only its
 * own fields, which is what lets this run with no window in sight.
 */
function makeDialog({ entry = null, season = "spring", year = 1 } = {}) {
	const dialog = Object.create(TimelineEntryDialog.prototype);
	dialog._entry = entry;
	dialog._trackName = "Stonetop";
	dialog._season = entry?.season ?? season;
	dialog._year = entry?.year ?? year;
	dialog._readYear = () => dialog._year;
	dialog.close = vi.fn(() => "closed");
	dialog._resolveWith = vi.fn(value => value);
	return dialog;
}

/** A form stand-in: `_save` reaches it only through `querySelector(...).value`. */
function makeForm(values) {
	return {
		querySelector: (sel) => (sel in values ? { value: values[sel] } : null),
	};
}

const TITLE = ".stonetop-timeline-entry-title";
const PLACE = ".stonetop-timeline-entry-place";
const BODY  = ".stonetop-timeline-entry-body";

beforeEach(() => { vi.clearAllMocks(); });

describe("what it collects", () => {
	it("resolves the date it was left on together with what was typed", () => {
		const dialog = makeDialog({ season: "autumn", year: 3 });
		const result = dialog._save(makeForm({
			[TITLE]: "The Bloody Hollow",
			[PLACE]: "The barrow",
			[BODY]:  "We went down and Kefta did not come back.",
		}));

		expect(result).toEqual({
			season: "autumn",
			year: 3,
			title: "The Bloody Hollow",
			place: "The barrow",
			body: "We went down and Kefta did not come back.",
		});
	});

	it("trims what was typed, so a stray space is not stored as content", () => {
		const dialog = makeDialog();
		const result = dialog._save(makeForm({ [TITLE]: "  The thaw  ", [PLACE]: " ", [BODY]: "" }));
		expect(result).toMatchObject({ title: "The thaw", place: "" });
	});

	// An entry is a dated thing that happened; the title is a line to find it by. One with only an
	// account is perfectly good, and refusing it would be refusing the commonest kind.
	it("takes an entry with an account and no title", () => {
		const dialog = makeDialog();
		const result = dialog._save(makeForm({ [TITLE]: "", [PLACE]: "", [BODY]: "A quiet season." }));
		expect(result).toMatchObject({ title: "", body: "A quiet season." });
		expect(dialog.close).not.toHaveBeenCalled();
	});

	// A reader who opened the dialog and changed their mind has pressed the wrong button. The
	// useful response is the one that costs them nothing, not an error about an empty field.
	it("saves nothing at all for an entry with nothing in it", () => {
		const dialog = makeDialog();
		dialog._save(makeForm({ [TITLE]: "  ", [PLACE]: "", [BODY]: "   " }));
		expect(dialog._resolveWith).not.toHaveBeenCalled();
		expect(dialog.close).toHaveBeenCalled();
	});

	// ⚠ The year is a FIELD, and the picker's own wiring reads it only when a season card is
	// clicked. A reader who types a year and saves without touching a card would otherwise have
	// their typing silently ignored, so `_save` goes through `_readYear` rather than the field the
	// last card click happened to see.
	it("reads the year at save time, not at the last card click", () => {
		const dialog = makeDialog({ season: "winter", year: 1 });
		dialog._readYear = () => 7;
		expect(dialog._save(makeForm({ [TITLE]: "Late", [PLACE]: "", [BODY]: "" }))).toMatchObject({ year: 7 });
	});
});

describe("editing an entry that already exists", () => {
	it("opens on that entry's own date rather than on the campaign clock", () => {
		const dialog = new TimelineEntryDialog(
			{ entry: { id: "e1", season: "summer", year: 4, title: "x" }, season: "spring", year: 9 });
		expect(dialog._season).toBe("summer");
		expect(dialog._year).toBe(4);
	});

	it("opens a new entry on the season the campaign is actually in", () => {
		const dialog = new TimelineEntryDialog({ season: "winter", year: 2 });
		expect(dialog._season).toBe("winter");
		expect(dialog._year).toBe(2);
	});

	// A world whose clock has never been stamped hands an empty season through. That is an undated
	// entry, which the timeline files under its own block rather than guessing a season for.
	it("takes an unstamped clock as no season at all", () => {
		expect(new TimelineEntryDialog({ season: "", year: 1 })._season).toBe("");
		expect(new TimelineEntryDialog({ season: "harvest", year: 1 })._season).toBe("");
	});
});

describe("the markup and the wiring agree", () => {
	// The three classes `_save` reads back are the only contract between this dialog and its
	// template, and a typo in either is silent: the field renders, the reader types into it, and
	// the value is dropped on save.
	it("gives every field the class the save path reads", async () => {
		const dialog = makeDialog();
		const html = await renderTemplate(
			"systems/stonetop-pwd/templates/dialogs/timeline-entry.hbs", dialog.getData());

		for (const cls of [TITLE, PLACE, BODY]) {
			expect(html, `${cls} is not in the template`).toContain(cls.slice(1));
		}
		expect(html).toContain("stonetop-timeline-entry-save");
		expect(html).toContain("stonetop-timeline-entry-cancel");
	});

	// The date question is the Seasons Change picker's own markup, dropped in whole rather than
	// rebuilt: two shapes of the same question in one system is what this avoids.
	it("asks for the date with the picker the season change already uses", async () => {
		const dialog = makeDialog({ season: "autumn", year: 2 });
		const html = await renderTemplate(
			"systems/stonetop-pwd/templates/dialogs/timeline-entry.hbs", dialog.getData());

		expect(html).toContain("stonetop-season-card");
		expect(html).toContain("stonetop-season-year-input");
		// And it opens marked on the season it was given.
		expect(html).toMatch(/data-season="autumn"[^>]*aria-current="true"|is-selected[^>]*data-season="autumn"/);
	});

	// A datalist, not a select: typing stays free and the known places merely autocomplete.
	it("offers the world's places without limiting the field to them", async () => {
		const dialog = makeDialog();
		const html = await renderTemplate(
			"systems/stonetop-pwd/templates/dialogs/timeline-entry.hbs", dialog.getData());

		expect(html).toContain("<datalist");
		expect(html).toContain("The Stone");
		expect(html).not.toContain("<select");
	});

	it("puts an entry being edited back into the fields", async () => {
		const dialog = makeDialog({ entry: { title: "The thaw", place: "The Stone", body: "<p>Warm.</p>" } });
		const data = dialog.getData();
		expect(data).toMatchObject({ isEdit: true, entryTitle: "The thaw", place: "The Stone" });
	});
});
