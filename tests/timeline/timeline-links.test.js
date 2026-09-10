import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { normalizeEntry, patchEntry } from "../../module/timeline/timeline-core.js";
import { buildTrackVM } from "../../module/timeline/timeline-view.js";
import { readRepo, stripComments } from "../fakes/css.js";

// TYING AN ENTRY BACK TO THE REST OF THE WORLD. Two halves, and they fail in different ways:
//
//  • a hand-written content link opens ONLY if it carries `data-link`. `.content-link` is the LOOK.
//    A link with the class and the right uuid but no `data-link` renders perfectly and does nothing
//    at all when clicked, with no console error; and
//  • `fromUuidSync` THROWS for a compendium-EMBEDDED uuid rather than answering null, and a page out
//    of this system's own shipped journal pack is exactly that -- so an unguarded call takes the
//    whole drop handler with it.

vi.mock("../../module/timeline/timeline-places.js", () => ({
	placeSuggestions: () => ["The Stone"],
	mergePlaceNames: (...lists) => lists.flat().filter(Boolean),
}));

// The payload a drop carries. `_resolveDropped` is handed this directly: parsing the drag event
// belongs to the shared drop zone (utils/card-drop-zone.js), which every zone in the system goes
// through, so what is left to test here is only what a uuid RESOLVES to.
const dragged = { value: null };
vi.mock("../../module/utils/foundry-compat.js", () => ({
	getDragEventData: () => dragged.value,
}));

const { TimelineEntryDialog } = await import("../../module/dialogs/TimelineEntryDialog.js");

/** The dialog without a Foundry Application under it. */
function makeDialog(entry = null) {
	const dialog = Object.create(TimelineEntryDialog.prototype);
	dialog._entry = entry;
	dialog._season = "spring";
	dialog._year = 1;
	dialog._placeUuid = entry?.placeUuid ?? "";
	dialog._readYear = () => 1;
	dialog.close = vi.fn();
	dialog._resolveWith = vi.fn(v => v);
	return dialog;
}

let savedSync;
let savedAsync;
beforeEach(() => {
	dragged.value = null;
	savedSync = globalThis.fromUuidSync;
	savedAsync = globalThis.fromUuid;
});
afterEach(() => {
	globalThis.fromUuidSync = savedSync;
	globalThis.fromUuid = savedAsync;
});

describe("what a drop resolves to", () => {
	it("takes the name and the uuid off a world document, without awaiting anything", async () => {
		dragged.value = { type: "JournalEntryPage", uuid: "JournalEntry.a.JournalEntryPage.b" };
		globalThis.fromUuidSync = () => ({ name: "Marshedge" });
		globalThis.fromUuid = vi.fn();

		const dropped = await makeDialog()._resolveDropped(dragged.value);
		expect(dropped).toEqual({ name: "Marshedge", uuid: "JournalEntry.a.JournalEntryPage.b" });
		expect(globalThis.fromUuid, "the async path was taken when it did not need to be").not.toHaveBeenCalled();
	});

	// ⚠ THE ONE THAT BITES. A page inside a compendium is the commonest thing a GM drags out of this
	// system, and `fromUuidSync` throws on it rather than answering null.
	it("survives a compendium-embedded uuid, which throws rather than answering null", async () => {
		dragged.value = { uuid: "Compendium.stonetop-pwd.stonetop-journal.JournalEntry.a.JournalEntryPage.b" };
		globalThis.fromUuidSync = () => { throw new Error("fromUuidSync was invoked on an Embedded Document"); };
		globalThis.fromUuid = async () => ({ name: "Gordin's Delve" });

		const dropped = await makeDialog()._resolveDropped(dragged.value);
		expect(dropped).toMatchObject({ name: "Gordin's Delve" });
	});

	// A pack uuid is KEPT here, unlike on the character rosters which deliberately drop one: this is
	// only ever a link to follow, and a link into a compendium is a perfectly good link.
	it("keeps a compendium uuid rather than throwing it away", async () => {
		const uuid = "Compendium.stonetop-pwd.stonetop-journal.JournalEntry.a.JournalEntryPage.b";
		dragged.value = { uuid };
		globalThis.fromUuidSync = () => { throw new Error("embedded"); };
		globalThis.fromUuid = async () => ({ name: "Gordin's Delve" });

		expect((await makeDialog()._resolveDropped(dragged.value)).uuid).toBe(uuid);
	});

	it("answers null for a drop that is not a document, and for one that resolves nowhere", async () => {
		dragged.value = null;
		expect(await makeDialog()._resolveDropped(dragged.value)).toBeNull();

		dragged.value = { uuid: "Actor.gone" };
		globalThis.fromUuidSync = () => null;
		globalThis.fromUuid = async () => null;
		expect(await makeDialog()._resolveDropped(dragged.value)).toBeNull();
	});
});

describe("the place link travels with the entry", () => {
	it("saves the uuid that was dropped", () => {
		const dialog = makeDialog();
		dialog._placeUuid = "JournalEntry.a.JournalEntryPage.b";
		const form = { querySelector: (sel) => ({
			".stonetop-timeline-entry-title": { value: "The barrow" },
			".stonetop-timeline-entry-place": { value: "Marshedge" },
			".stonetop-timeline-entry-body":  { value: "" },
		}[sel] ?? null) };

		expect(dialog._save(form)).toMatchObject({ place: "Marshedge", placeUuid: "JournalEntry.a.JournalEntryPage.b" });
	});

	// An emptied field takes its link with it: a claim about a name that is no longer there is not
	// a claim worth keeping.
	it("drops the link when the place is cleared", () => {
		const dialog = makeDialog();
		dialog._placeUuid = "JournalEntry.a";
		const form = { querySelector: (sel) => ({
			".stonetop-timeline-entry-title": { value: "The barrow" },
			".stonetop-timeline-entry-place": { value: "  " },
			".stonetop-timeline-entry-body":  { value: "" },
		}[sel] ?? null) };

		expect(dialog._save(form)).toMatchObject({ place: "", placeUuid: "" });
	});

	// The uuid itself rides on the instance, not in the render context: the markup asks only
	// WHETHER the place is linked (to paint the chip), and a bare uuid in the context would be a
	// second copy of the same fact for a template to bind to by mistake.
	it("opens an edit on the link the entry already had", () => {
		const dialog = new TimelineEntryDialog({ entry: { place: "Marshedge", placeUuid: "JournalEntry.a" } });
		expect(dialog._placeUuid).toBe("JournalEntry.a");
		expect(dialog.getData()).toMatchObject({ place: "Marshedge", placeLinked: true });
	});
});

describe("the stored shape", () => {
	it("carries a placeUuid through normalisation", () => {
		expect(normalizeEntry({ placeUuid: " JournalEntry.a " }).placeUuid).toBe("JournalEntry.a");
		expect(normalizeEntry({}).placeUuid).toBe("");
	});

	// The link is part of what an edit can change, so re-dating or renaming must not silently keep
	// an old one -- and patching it alone must count as a change rather than a no-op.
	it("treats a changed link as a real edit", () => {
		const list = [{ id: "a", season: "spring", year: 1, order: 0, title: "x", placeUuid: "JournalEntry.a" }];
		expect(patchEntry(list, "a", { placeUuid: "JournalEntry.b" }).changed).not.toBeNull();
		expect(patchEntry(list, "a", { placeUuid: "JournalEntry.a" }).changed).toBeNull();
	});
});

describe("what the card is told", () => {
	it("marks a place that is a document as linked, and a typed one as not", () => {
		const vm = buildTrackVM({ trackId: "s", name: "Stonetop", entries: [
			{ id: "a", season: "spring", year: 1, order: 0, place: "Marshedge", placeUuid: "JournalEntry.a" },
			{ id: "b", season: "spring", year: 1, order: 1, place: "the hollow" },
		] });
		const [linked, typed] = vm.periods[0].entries;
		expect(linked).toMatchObject({ placeLinked: true, placeUuid: "JournalEntry.a" });
		expect(typed).toMatchObject({ placeLinked: false, placeUuid: "" });
	});
});

describe("the link markup core will actually open", () => {
	// ⚠ Core binds content links on document.body with `closest("a[data-link]")` and reads
	// `.dataset.uuid` off that same element. The class alone is paint: the link looks right, carries
	// the right target, and silently does nothing. Copy all three of what core's own builder emits.
	it("carries data-link, the uuid and draggable, not just the class", () => {
		const card = stripComments(readRepo("templates/dialogs/partials/timeline-card.hbs"));
		const anchor = card.match(/<a class="content-link"[^>]*>/)?.[0];
		expect(anchor, "the card renders no content link at all").toBeTruthy();
		expect(anchor, "without data-link the link is paint and does nothing on click").toContain("data-link");
		expect(anchor).toContain('data-uuid="{{placeUuid}}"');
		expect(anchor).toContain('draggable="true"');
	});

	// And it is only rendered when there IS something to open. A link to nowhere reads as broken.
	it("only draws a link for a place that has one", () => {
		expect(stripComments(readRepo("templates/dialogs/partials/timeline-card.hbs")))
			.toMatch(/\{\{#if placeLinked\}\}[\s\S]*content-link[\s\S]*\{\{else\}\}[\s\S]*<span>\{\{place\}\}<\/span>/);
	});
});

describe("the account takes a drop too", () => {
	// This is what makes crosslinks WRITABLE. Bodies have always been enriched on the way out, so an
	// @UUID in one resolved; but the field is a plain textarea and nobody hand-types a document id.
	it("builds an @UUID link from what was dropped", () => {
		const source = stripComments(readRepo("module/dialogs/TimelineEntryDialog.js"));
		expect(source, "the body drop does not build a UUID link").toContain("@UUID[");
	});

	// Inserted at the cursor rather than appended, or a drop mid-sentence lands at the end.
	it("inserts at the cursor and puts the caret after it", () => {
		const source = stripComments(readRepo("module/dialogs/TimelineEntryDialog.js"));
		expect(source).toContain("selectionStart");
		expect(source).toContain("setSelectionRange");
	});
});
