import { describe, it, expect, vi } from "vitest";
import {
	planChronicleFlagRepair, repairChronicleFlagScope, LITERAL_SCOPE_KEY,
} from "../../module/migration/chronicle-flag-scope.js";
import { CHRONICLE_PROSE_FLAG } from "../../module/utils/chronicle-journals.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Repair for the worlds that ran the build whose seed pass wrote its find-or-create key under the
// literal property "SYSTEM_ID". The lookup could never match it, so every save re-created every
// page: the world this was written for held 42 Places of Interest pages where six belong, seven
// copies of each place — one properly filed original and six identical orphans.
//
// The rule that makes deletion safe is narrow on purpose, and most of these assert its edges: a
// page goes only when it BOTH carries the literal block (nothing but the bug writes one) AND
// shares its identity with a page being kept.

const prose = (body) => [{ heading: "Overview", kind: "prose", body }];

/** A page filed correctly. */
const good = (id, key, body, extra = {}) => ({
	_id: id, name: key, type: "chronicle", system: { sections: prose(body) },
	flags: { [SYSTEM_ID]: { chronicleKey: key, ...extra } },
});

/** A page the buggy seed pass made. */
const bad = (id, key, body, extra = {}) => ({
	_id: id, name: key, type: "chronicle", system: { sections: prose(body) },
	flags: { [LITERAL_SCOPE_KEY]: { chronicleKey: key, ...extra } },
});

/** A misfiled Seasons Change year page — a CORE text page, keyed by year, body in text.content. */
const year = (id, yr, content = "") => ({
	_id: id, name: `${yr}`, type: "text", text: { content },
	flags: { [LITERAL_SCOPE_KEY]: { chronicleYear: yr } },
});

/** One season's record, in the shape seasons-chronicle.js writes it. */
const seasonBlock = (season, body = "<p>A quiet season.</p>") =>
	`<section class="stonetop-season-block" data-season="${season}">`
	+ `<h2 class="stonetop-season-entry stonetop-season--${season}">${season}</h2>${body}</section>`;

const deletesLiteralBlock = (update) =>
	Object.keys(update).some(k => k === `flags.-=${LITERAL_SCOPE_KEY}` || k === `flags.${LITERAL_SCOPE_KEY}`);

describe("planChronicleFlagRepair", () => {
	it("does nothing to a journal that never ran the bad build", () => {
		const pages = [good("a", "place:a", "<p>The Stone.</p>"), good("b", "place:b", "<p>The Granary.</p>")];
		expect(planChronicleFlagRepair(pages)).toEqual({ updates: [], deleteIds: [] });
	});

	// The live-world shape: one properly filed keeper per place, six identical orphans behind it.
	it("removes the orphans and leaves the resolvable original untouched", () => {
		const pages = [
			...Array.from({ length: 6 }, (_, i) => bad(`dup-${i}`, "place:a", "<p>The Stone.</p>")),
			good("keep", "place:a", "<p>The Stone.</p>"),
		];

		const { updates, deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toEqual(["dup-0", "dup-1", "dup-2", "dup-3", "dup-4", "dup-5"]);
		// Identical content and a keeper that was already filed correctly: nothing to write.
		expect(updates).toEqual([]);
	});

	it("scales to the whole journal — six places, seven copies each", () => {
		const keys = ["place:a", "place:b", "place:c", "place:d", "place:e", "place:f"];
		const pages = [
			...keys.flatMap(key => Array.from({ length: 6 }, (_, i) => bad(`${key}-dup${i}`, key, `<p>${key}</p>`))),
			...keys.map(key => good(`${key}-keep`, key, `<p>${key}</p>`)),
		];
		expect(pages).toHaveLength(42);

		const { deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toHaveLength(36);
		expect(deleteIds.every(id => id.includes("-dup"))).toBe(true);
		// Every keeper survives.
		for (const key of keys) expect(deleteIds).not.toContain(`${key}-keep`);
	});

	// No properly filed page to fall back on: the first copy is promoted and re-filed.
	it("promotes and re-files the first copy when every copy is misfiled", () => {
		const pages = [bad("first", "place:a", "<p>The Stone.</p>"), bad("second", "place:a", "<p>The Stone.</p>")];

		const { updates, deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toEqual(["second"]);
		expect(updates).toHaveLength(1);
		expect(updates[0]._id).toBe("first");
		expect(updates[0][`flags.${SYSTEM_ID}.chronicleKey`]).toBe("place:a");
		expect(deletesLiteralBlock(updates[0])).toBe(true);
	});

	// Not a duplicate of anything — repaired where it stands.
	it("re-files a misfiled page with an identity of its own instead of deleting it", () => {
		const pages = [good("a", "place:a", "<p>A.</p>"), bad("lonely", "place:z", "<p>Z.</p>")];

		const { updates, deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toEqual([]);
		expect(updates.map(u => u._id)).toEqual(["lonely"]);
		expect(updates[0][`flags.${SYSTEM_ID}.chronicleKey`]).toBe("place:z");
	});

	// The bug is the only thing that writes a literal block, so anything without one is a
	// duplicate this does not understand and must not touch.
	it("never deletes a properly filed page, even a duplicate one", () => {
		const pages = [good("a1", "place:a", "<p>A.</p>"), good("a2", "place:a", "<p>A again.</p>")];
		expect(planChronicleFlagRepair(pages)).toEqual({ updates: [], deleteIds: [] });
	});

	it("folds content that exists only on a doomed copy into the keeper first", () => {
		const keeper = good("keep", "place:a", "<p>The Stone.</p>");
		const orphan = bad("dup", "place:a", "<p>The Stone.</p>");
		orphan.system.sections.push({ heading: "Rumours", kind: "prose", body: "<p>It hums.</p>" });

		const { updates, deleteIds } = planChronicleFlagRepair([keeper, orphan]);

		expect(deleteIds).toEqual(["dup"]);
		expect(updates).toHaveLength(1);
		expect(updates[0]["system.sections"].map(s => s.heading)).toEqual(["Overview", "Rumours"]);
		expect(updates[0][`flags.${SYSTEM_ID}.${CHRONICLE_PROSE_FLAG}`]).toHaveProperty("Rumours");
	});

	it("groups Seasons Change pages by their year", () => {
		const { deleteIds } = planChronicleFlagRepair([year("y1a", 1), year("y1b", 1), year("y2", 2)]);

		expect(deleteIds).toEqual(["y1b"]);
	});

	// The Seasons Change journal is made of CORE TEXT pages: their whole record is text.content,
	// not system.sections. A merge that only knew about sections deleted three seasons out of four
	// every time it de-duplicated a year.
	it("folds a doomed text page's seasons into the keeper before deleting it", () => {
		const pages = [
			year("p-spring", 1, seasonBlock("spring")),
			year("p-summer", 1, seasonBlock("summer")),
			year("p-winter", 1, seasonBlock("winter")),
		];

		const { updates, deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toEqual(["p-summer", "p-winter"]);
		const content = updates[0]["text.content"];
		for (const season of ["spring", "summer", "winter"]) {
			expect(content).toContain(`data-season="${season}"`);
		}
		// Re-emitted in canonical Spring→Winter order, whichever order the copies were in.
		expect(content.indexOf("summer")).toBeLessThan(content.indexOf("winter"));
	});

	// The same season recorded twice is one record, not two — matched on the marker, exactly as
	// re-recording a season through the picker matches it.
	it("doesn't double a season the keeper already carries", () => {
		const pages = [year("a", 1, seasonBlock("spring")), year("b", 1, seasonBlock("spring"))];

		const { updates, deleteIds } = planChronicleFlagRepair(pages);

		expect(deleteIds).toEqual(["b"]);
		expect(updates[0]).not.toHaveProperty("text.content");
	});

	// Neither sections nor season blocks: this cannot know what a hand-written page means, so it
	// keeps the words. A paragraph kept twice is something a GM can fix; one deleted is not.
	it("appends a body it can't merge rather than dropping it", () => {
		const pages = [
			year("a", 1, "<p>What we did in the spring.</p>"),
			year("b", 1, "<p>And then the summer.</p>"),
		];

		const { updates } = planChronicleFlagRepair(pages);

		expect(updates[0]["text.content"])
			.toBe("<p>What we did in the spring.</p><p>And then the summer.</p>");
	});

	it("leaves pages that carry no chronicle identity alone", () => {
		const plain = { _id: "p", name: "Notes", type: "text", flags: {} };
		expect(planChronicleFlagRepair([plain])).toEqual({ updates: [], deleteIds: [] });
	});

	// A stray block on a page with no identity is still swept off.
	it("sweeps a stray literal block off an unidentifiable page", () => {
		const stray = { _id: "s", name: "Notes", type: "text", flags: { [LITERAL_SCOPE_KEY]: { something: 1 } } };
		const { updates, deleteIds } = planChronicleFlagRepair([stray]);

		expect(deleteIds).toEqual([]);
		expect(deletesLiteralBlock(updates[0])).toBe(true);
		expect(updates[0][`flags.${SYSTEM_ID}.something`]).toBe(1);
	});

	// The proper scope is authoritative; a fossil must never win.
	it("does not let a misfiled value overwrite one already in the real scope", () => {
		const page = {
			_id: "p", name: "The Stone", type: "chronicle", system: { sections: prose("<p>A.</p>") },
			flags: { [SYSTEM_ID]: { chronicleKey: "place:a" }, [LITERAL_SCOPE_KEY]: { chronicleKey: "place:WRONG" } },
		};
		const { updates } = planChronicleFlagRepair([page]);

		expect(updates[0]).not.toHaveProperty(`flags.${SYSTEM_ID}.chronicleKey`);
		expect(deletesLiteralBlock(updates[0])).toBe(true);
	});
});

describe("repairChronicleFlagScope", () => {
	function fakeEntry(pages) {
		return {
			name: "Places of Interest",
			pages,
			updateEmbeddedDocuments: vi.fn(async () => {}),
			deleteEmbeddedDocuments: vi.fn(async () => {}),
		};
	}

	it("writes the updates before it deletes anything", async () => {
		const order = [];
		const entry = fakeEntry([bad("first", "place:a", "<p>A.</p>"), bad("second", "place:a", "<p>A.</p>")]);
		entry.updateEmbeddedDocuments = vi.fn(async () => { order.push("update"); });
		entry.deleteEmbeddedDocuments = vi.fn(async () => { order.push("delete"); });

		expect(await repairChronicleFlagScope(entry)).toEqual({ updated: 1, deleted: 1 });
		expect(order).toEqual(["update", "delete"]);
		expect(entry.deleteEmbeddedDocuments).toHaveBeenCalledWith("JournalEntryPage", ["second"]);
	});

	it("writes nothing at all to an undamaged journal", async () => {
		const entry = fakeEntry([good("a", "place:a", "<p>A.</p>")]);

		expect(await repairChronicleFlagScope(entry)).toEqual({ updated: 0, deleted: 0 });
		expect(entry.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(entry.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	// Swept on every load, so a second pass over the repaired state must be a no-op.
	it("is idempotent — the repaired journal needs no second repair", async () => {
		const pages = [
			...Array.from({ length: 6 }, (_, i) => bad(`dup-${i}`, "place:a", "<p>A.</p>")),
			good("keep", "place:a", "<p>A.</p>"),
		];
		const { deleteIds } = planChronicleFlagRepair(pages);
		const survivors = pages.filter(p => !deleteIds.includes(p._id));

		expect(planChronicleFlagRepair(survivors)).toEqual({ updates: [], deleteIds: [] });
	});
});
