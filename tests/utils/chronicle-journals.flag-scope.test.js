import { describe, it, expect, vi } from "vitest";
import { seedChroniclePages, CHRONICLE_PROSE_FLAG } from "../../module/utils/chronicle-journals.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// The seed pass is find-or-create keyed on a flag it writes itself, so the write and the read
// have to name the SAME scope. They stopped doing so when the package id was centralised: the
// created page's flags went out as `{ SYSTEM_ID: {…} }` — a property literally named
// "SYSTEM_ID" — while the lookup asked for `getFlag(SYSTEM_ID, …)`. Nothing threw. The lookup
// simply never matched, so every save re-created every page: two saves, two copies of each PC's
// page, and findActorChroniclePage could never resolve one to merge into.
//
// Round-tripping the flag through getFlag is what these assert, rather than the literal shape,
// because that IS the contract — a page whose key cannot be read back is a page that will be
// created again.

const prose = (body) => [{ heading: "Who they are", kind: "prose", body }];

class FakePage {
	constructor(data, id) { Object.assign(this, data); this.id = id; }
	getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
	toObject() { return { system: this.system, flags: this.flags }; }
}

function fakeEntry() {
	const pages = [];
	return {
		pages,
		createEmbeddedDocuments: vi.fn(async (_type, docs) => {
			for (const doc of docs) pages.push(new FakePage(doc, `page-${pages.length}`));
		}),
		updateEmbeddedDocuments: vi.fn(async () => {}),
	};
}

describe("seedChroniclePages flag scope", () => {
	it("stamps the chronicle key where getFlag can read it back", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pim", name: "Pim", sections: prose("<p>A shepherd.</p>") }]);

		expect(entry.pages).toHaveLength(1);
		expect(entry.pages[0].getFlag(SYSTEM_ID, "chronicleKey")).toBe("pim");
	});

	it("does not write the flags under a literal \"SYSTEM_ID\" key", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pim", name: "Pim", sections: prose("<p>A shepherd.</p>") }]);

		const [created] = entry.createEmbeddedDocuments.mock.calls[0][1];
		expect(Object.keys(created.flags)).toEqual([SYSTEM_ID]);
		expect(created.flags).not.toHaveProperty("SYSTEM_ID");
	});

	it("stamps the prose hashes in the same scope, so a re-seed can tell a seed from an edit", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pim", name: "Pim", sections: prose("<p>A shepherd.</p>") }]);

		expect(entry.pages[0].getFlag(SYSTEM_ID, CHRONICLE_PROSE_FLAG)).toMatchObject({
			"Who they are": expect.anything(),
		});
	});

	// The bug this file exists for. Saving the Chronicle a second time used to duplicate every
	// page, because the key it looks pages up by was never readable.
	it("seeds each page once — a second save creates nothing", async () => {
		const entry = fakeEntry();
		const pages = [
			{ key: "pim",   name: "Pim",   sections: prose("<p>A shepherd.</p>") },
			{ key: "hana",  name: "Hana",  sections: prose("<p>A fisher.</p>") },
		];

		expect(await seedChroniclePages(entry, pages)).toEqual({ created: 2, updated: 0 });
		expect(await seedChroniclePages(entry, pages)).toEqual({ created: 0, updated: 0 });
		expect(entry.pages).toHaveLength(2);
	});

	it("tops up an already-seeded page instead of adding a second one", async () => {
		const entry = fakeEntry();
		await seedChroniclePages(entry, [{ key: "pim", name: "Pim", sections: prose("<p>A shepherd.</p>") }]);

		const result = await seedChroniclePages(entry, [{
			key: "pim",
			name: "Pim",
			sections: [...prose("<p>A shepherd.</p>"), { heading: "What they carry", kind: "prose", body: "<p>A crook.</p>" }],
		}]);

		expect(result).toEqual({ created: 0, updated: 1 });
		expect(entry.pages).toHaveLength(1);
		// The update targets the page that already exists, by its id.
		expect(entry.updateEmbeddedDocuments.mock.calls[0][1][0]._id).toBe("page-0");
	});
});
