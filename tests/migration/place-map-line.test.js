import { describe, it, expect, vi } from "vitest";
import { readRepo } from "../fakes/css.js";
import { withoutMapLine, clearPlaceMapLines } from "../../module/migration/place-map-line.js";
import { chronicleBodyHash, mergeChronicleSections } from "../../module/utils/chronicle-core.js";
import { buildPlacePages } from "../../module/utils/places-chronicle.js";

// Place pages used to open with "Marked D on the village map." This takes the line out of the
// pages seeded while they did, without costing a page that is still as we wrote it its sync.

const LINE = "<p>Marked <strong>D</strong> on the village map.</p>";
const BLURB = "<p>The Cistern is an underground vault.</p>";
const prose = body => ({ kind: "prose", heading: "Overview", group: "glance", body });

describe("withoutMapLine", () => {
	it("cuts the line and keeps what followed it", () => {
		const result = withoutMapLine([prose(LINE + BLURB)]);

		expect(result.sections).toEqual([prose(BLURB)]);
	});

	it("leaves an invented place's Overview empty", () => {
		expect(withoutMapLine([prose(LINE)]).sections).toEqual([prose("")]);
	});

	it("restamps a section still as we wrote it, so it goes on following its source", () => {
		const old = LINE + BLURB;
		const result = withoutMapLine([prose(old)], { Overview: chronicleBodyHash(old) });

		expect(result.restamped).toBe(true);
		expect(result.proseManaged).toEqual({ Overview: chronicleBodyHash(BLURB) });
	});

	it("cuts the line from a section the GM wrote into, and leaves it reading as edited", () => {
		const written = `${LINE}${BLURB}<p>Kirs keeps the key.</p>`;
		const stamp = chronicleBodyHash(LINE + BLURB);
		const result = withoutMapLine([prose(written)], { Overview: stamp });

		expect(result.sections[0].body).toBe(`${BLURB}<p>Kirs keeps the key.</p>`);
		expect(result.restamped).toBe(false);
		expect(result.proseManaged).toEqual({ Overview: stamp });
	});

	it("says so when there is nothing to do", () => {
		expect(withoutMapLine([prose(BLURB)])).toBeNull();
		expect(withoutMapLine([{ kind: "qa", heading: "Questions", pairs: [] }])).toBeNull();
		expect(withoutMapLine(undefined)).toBeNull();
	});

	// The cut text has to be what the compiler writes now, or the next seeding pass would read
	// the page as changed and write it a second time.
	it("leaves a pristine page exactly as the next seeding pass would write it", () => {
		const [page] = buildPlacePages([{ letter: "d", name: "Cistern" }]);
		const old = LINE + page.sections[0].body;
		const cut = withoutMapLine([prose(old)], { Overview: chronicleBodyHash(old) });
		const merged = mergeChronicleSections(cut.sections, page.sections, { proseManaged: cut.proseManaged });

		expect(merged.added).toBe(0);
		expect(merged.kept).toBe(0);
	});
});

// A live page as the sweep sees it: data on `system`, a clone on `system.toObject()`.
const livePage = (id, key, sections, proseManaged) => ({
	id,
	system: { sections, toObject: () => ({ sections: structuredClone(sections) }) },
	getFlag: (_scope, name) => name === "chronicleKey" ? key : name === "chronicleProse" ? proseManaged : undefined,
});

describe("clearPlaceMapLines", () => {
	it("clears every place page that carries the line, in one write", async () => {
		const old = LINE + BLURB;
		const journal = {
			id: "places",
			pages: [
				livePage("a", "place:d", [prose(old)], { Overview: chronicleBodyHash(old) }),
				livePage("b", "place:g", [prose(`${LINE}<p>Bethany's forge.</p>`)], { Overview: chronicleBodyHash(LINE) }),
				livePage("c", "place:a", [prose(BLURB)], {}),
				livePage("d", undefined, [prose(old)], {}),
			],
			updateEmbeddedDocuments: vi.fn(async () => []),
		};

		expect(await clearPlaceMapLines(journal)).toBe(2);
		expect(journal.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [type, updates] = journal.updateEmbeddedDocuments.mock.calls[0];
		expect(type).toBe("JournalEntryPage");
		expect(updates.map(u => u._id)).toEqual(["a", "b"]);
		expect(updates[0]["system.sections"]).toEqual([prose(BLURB)]);
		expect(updates[1]["system.sections"]).toEqual([prose("<p>Bethany's forge.</p>")]);
		// Only the pristine page's hash record is written.
		expect(Object.keys(updates[0]).some(k => k.includes("chronicleProse"))).toBe(true);
		expect(Object.keys(updates[1]).some(k => k.includes("chronicleProse"))).toBe(false);
	});

	it("writes nothing when no page carries the line, or there is no journal", async () => {
		const journal = { id: "places", pages: [livePage("c", "place:a", [prose(BLURB)], {})], updateEmbeddedDocuments: vi.fn() };

		expect(await clearPlaceMapLines(journal)).toBe(0);
		expect(journal.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(await clearPlaceMapLines(null)).toBe(0);
	});
});

describe("the sweep's place in the load", () => {
	it("runs for the primary GM once per version, and cannot take the load down with it", () => {
		const READY = readRepo("module/hooks/Ready.js");
		const gated = READY.slice(READY.indexOf("if (isActingPrimaryGM()) {"));
		expect(gated).toContain(`bestEffort("Places of Interest map-line cleanup", () => oncePerVersion("placeMapLine", clearAllPlaceMapLines))`);
	});
});
