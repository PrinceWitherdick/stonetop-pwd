import { describe, it, expect, beforeEach, vi } from "vitest";

// The managed journal update channel: the pass that runs on a GM's first load after every
// release and decides, per seeded entry, whether the newly shipped content can be rolled in.
//
// It used to resolve each entry's source with its own `fromUuid` and stamp each baseline with
// its own `setFlag`, which is two server round trips per entry across ~240 entries, on the
// awaited ready path, for the majority of releases that change no journal content at all.
// These tests pin the shape that fixed it: one bulk read, one bulk write, and a progress
// report per entry so the setup window can show a row for it.

vi.mock("../../module/locations/location-tooltips.js", () => ({ invalidateLocationSummaryIndex: vi.fn() }));

const {
	needsJournalSync, planJournalSync, applyJournalSync,
} = await import("../../module/hooks/SeedCompendiums.js");
const { managedHash } = await import("../../module/hooks/journal-sync-core.js");

const VERSION = "9.9.9";

/** The whole pass as a load runs it: compare, then write. */
async function syncJournals({ onProgress } = {}) {
	return applyJournalSync(await planJournalSync({ onProgress }));
}
const PACK = "stonetop-pwd.stonetop-journal";

let store;
let updateDocuments;

/**
 * One seeded world journal and the compendium entry it came from, agreeing on their content
 * so the pair is "pristine" unless a test says otherwise.
 */
function seeded(id, { content = `body of ${id}`, baseline = "stamped", source = `Compendium.${PACK}.JournalEntry.${id}` } = {}) {
	const pages = [{ _id: `p-${id}`, name: id, type: "text", text: { content } }];
	// The real baseline of this entry's own content, so "pristine" means what it means in a
	// live world rather than whatever an invented number happens to compare against.
	const hash = managedHash({ pages });
	return {
		id,
		name: id,
		uuid: `JournalEntry.${id}`,
		pages,
		_stats: { compendiumSource: source },
		toObject: () => ({ name: id, pages: structuredClone(pages) }),
		getFlag: vi.fn(() => (baseline === "none" ? undefined : { hash, version: "0.0.0" })),
		setFlag: vi.fn(async () => {}),
	};
}

/** The compendium side of the pair, keyed the way the pack's own documents are. */
function shipped(id, { content = `body of ${id}` } = {}) {
	const pages = [{ _id: `p-${id}`, name: id, type: "text", text: { content } }];
	return {
		uuid: `Compendium.${PACK}.JournalEntry.${id}`,
		toObject: () => ({ name: id, pages: structuredClone(pages) }),
	};
}

function harness({ journals = [], packDocs = [], settings = {}, hasPack = true } = {}) {
	store = { seedingComplete: true, journalSyncVersion: "0.0.1", ...settings };
	updateDocuments = vi.fn(async () => []);

	global.game = {
		user: { isGM: true },
		system: { id: "stonetop-pwd", version: VERSION },
		journal: journals,
		settings: {
			get: (_ns, key) => store[key],
			set: async (_ns, key, value) => { store[key] = value; },
		},
		packs: { get: (id) => (hasPack && id === PACK ? { getDocuments: async () => packDocs } : undefined) },
	};
	global.JournalEntry = { updateDocuments };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
	global.fromUuid = vi.fn(async () => null);
}

beforeEach(() => {
	vi.clearAllMocks();
	harness();
});

describe("needsJournalSync", () => {
	it("is owed on the first load after a version bump", () => {
		expect(needsJournalSync()).toBe(true);
	});

	it("is settled once this version has been synced", () => {
		harness({ settings: { journalSyncVersion: VERSION } });
		expect(needsJournalSync()).toBe(false);
	});

	// A fresh world goes through the seed path, which stamps the sync's version on its way out.
	it("has nothing to do until the world has been seeded", () => {
		harness({ settings: { seedingComplete: false } });
		expect(needsJournalSync()).toBe(false);
	});

	it("is a GM job", () => {
		harness();
		global.game.user.isGM = false;
		expect(needsJournalSync()).toBe(false);
	});
});

describe("the version sync, compare then write", () => {
	it("reads the whole pack once instead of resolving each entry on its own", async () => {
		const journals = [seeded("a"), seeded("b"), seeded("c")];
		harness({ journals, packDocs: [shipped("a"), shipped("b"), shipped("c")] });

		await syncJournals();

		expect(global.fromUuid).not.toHaveBeenCalled();
	});

	it("stamps every unchanged baseline in one write", async () => {
		const journals = [seeded("a"), seeded("b"), seeded("c")];
		harness({ journals, packDocs: [shipped("a"), shipped("b"), shipped("c")] });

		await syncJournals();

		expect(updateDocuments).toHaveBeenCalledTimes(1);
		expect(updateDocuments.mock.calls[0][0]).toHaveLength(3);
		for (const entry of journals) expect(entry.setFlag).not.toHaveBeenCalled();
	});

	// A dotted key, not a nested `flags` object: the write has to merge alongside the reader
	// state that lives in `flags.stonetop.checks`, exactly as setFlag did.
	it("writes the baseline as a merging flag update", async () => {
		harness({ journals: [seeded("a")], packDocs: [shipped("a")] });

		await syncJournals();

		expect(updateDocuments.mock.calls[0][0][0]).toEqual({
			_id: "a",
			"flags.stonetop-pwd.journalSync": { hash: expect.anything(), version: VERSION },
		});
	});

	it("marks the version done so the next load skips the pass", async () => {
		harness({ journals: [seeded("a")], packDocs: [shipped("a")] });

		await syncJournals();

		expect(store.journalSyncVersion).toBe(VERSION);
	});

	// Same contract every other seed here keeps: a failed write leaves the version unstamped so
	// the next load retries the whole pass, rather than recording work that never landed.
	it("leaves the version unstamped when the bulk write fails", async () => {
		harness({ journals: [seeded("a")], packDocs: [shipped("a")] });
		updateDocuments.mockRejectedValue(new Error("no"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await syncJournals();

		expect(store.journalSyncVersion).toBe("0.0.1");
	});

	// The caller shows a row for this pass. Swallowing the failure would tick that row off
	// green over a write that never landed, so the outcome has to come back out.
	it("reports the failed write to its caller", async () => {
		harness({ journals: [seeded("a")], packDocs: [shipped("a")] });
		updateDocuments.mockRejectedValue(new Error("no"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(syncJournals()).resolves.toMatchObject({ stamped: false });
	});

	it("reports success when the stamps land", async () => {
		harness({ journals: [seeded("a")], packDocs: [shipped("a")] });

		await expect(syncJournals()).resolves.toMatchObject({ stamped: true });
	});

	// Prefetching the pack and batching the stamps took every await out of the common path,
	// which is the point of both. Without an explicit yield the loop would hold the main thread
	// from the first entry to the last and the row it feeds could never draw a frame.
	it("hands the thread back mid-pass so its progress row can draw", async () => {
		harness({
			journals: [seeded("a"), seeded("b"), seeded("c")],
			packDocs: [shipped("a"), shipped("b"), shipped("c")],
		});
		// Make every iteration look like it held the thread for a full slice.
		let clock = 0;
		vi.spyOn(globalThis.performance, "now").mockImplementation(() => (clock += 1000));
		const timeout = vi.spyOn(globalThis, "setTimeout");

		await syncJournals();

		expect(timeout).toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("falls back to resolving one entry when the pack cannot be read", async () => {
		harness({ journals: [seeded("a")], hasPack: false });
		global.fromUuid.mockResolvedValue(shipped("a"));

		await syncJournals();

		expect(global.fromUuid).toHaveBeenCalledWith(`Compendium.${PACK}.JournalEntry.a`);
		expect(updateDocuments).toHaveBeenCalledTimes(1);
	});

	// A world seeded under an older system id stamps its sources with that id. The pack is
	// matched on the package-id-free tail so those entries still find their source.
	it("matches an entry seeded under an older system id", async () => {
		const entry = seeded("a", { source: "Compendium.stonetop_pwd.stonetop-journal.JournalEntry.a" });
		harness({ journals: [entry], packDocs: [shipped("a")] });

		await syncJournals();

		expect(global.fromUuid).not.toHaveBeenCalled();
		expect(updateDocuments).toHaveBeenCalledTimes(1);
	});

	it("reports a fraction per entry so the setup window can show a row", async () => {
		harness({ journals: [seeded("a"), seeded("b")], packDocs: [shipped("a"), shipped("b")] });
		const seen = [];

		await syncJournals({ onProgress: p => seen.push(p) });

		expect(seen.map(p => p.fraction)).toEqual([0.5, 1]);
		expect(seen[0].detail).toBe("Checking 1 of 2");
	});

	it("leaves a journal the GM has edited alone", async () => {
		const entry = seeded("a");
		// A baseline recording content that is no longer what the entry holds: the GM typed
		// into it since we last wrote it.
		entry.getFlag = vi.fn(() => ({ hash: "not-the-current-content", version: "0.0.0" }));
		harness({ journals: [entry], packDocs: [shipped("a")] });

		await syncJournals();

		expect(updateDocuments).not.toHaveBeenCalled();
		expect(global.ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("kept your edits"));
	});

	// The every-release toast: an edited entry whose shipped content has not moved since we last
	// wrote it is missing nothing, so there is nothing to tell the GM.
	it("says nothing about an edited journal whose shipped content is unchanged", async () => {
		const entry = seeded("a", { content: "the GM's own words" });
		const original = managedHash({ pages: [{ _id: "p-a", name: "a", type: "text", text: { content: "body of a" } }] });
		entry.getFlag = vi.fn(() => ({ hash: original, version: "0.0.0" }));
		harness({ journals: [entry], packDocs: [shipped("a")] });

		await syncJournals();

		expect(global.ui.notifications.info).not.toHaveBeenCalled();
		expect(store.journalSyncVersion).toBe(VERSION);
	});

	it("ignores journals that did not come from our compendium", async () => {
		const foreign = seeded("x", { source: "Compendium.other-system.stuff.JournalEntry.x" });
		harness({ journals: [foreign], packDocs: [] });

		await syncJournals();

		expect(updateDocuments).not.toHaveBeenCalled();
		expect(store.journalSyncVersion).toBe(VERSION);
	});
});

// The read-only half, which the setup window opens on. It has to be read-only for real: it runs
// before anything decides whether to tell the GM about the update.
describe("planJournalSync", () => {
	it("has nothing to refresh when the release changed no journals", async () => {
		harness({ journals: [seeded("a"), seeded("b")], packDocs: [shipped("a"), shipped("b")] });

		const plan = await planJournalSync();

		expect(plan.refresh).toEqual([]);
		expect(plan.stamps).toHaveLength(2);
		expect(plan.version).toBe(VERSION);
	});

	it("lists an untouched journal whose shipped content changed", async () => {
		const journals = [seeded("a"), seeded("b")];
		harness({ journals, packDocs: [shipped("a", { content: "new wording" }), shipped("b")] });

		const plan = await planJournalSync();

		expect(plan.refresh.map(r => r.entry)).toEqual([journals[0]]);
		expect(plan.stamps).toHaveLength(1);
	});

	it("names an edited journal only when its shipped content moved on", async () => {
		const entry = seeded("a", { content: "the GM's own words" });
		entry.getFlag = vi.fn(() => ({ hash: "what we last wrote", version: "0.0.0" }));
		harness({ journals: [entry], packDocs: [shipped("a", { content: "new wording" })] });

		const plan = await planJournalSync();

		expect(plan.refresh).toEqual([]);
		expect(plan.keptEdits).toEqual(["a"]);
	});

	it("writes nothing", async () => {
		const journals = [seeded("a")];
		harness({ journals, packDocs: [shipped("a", { content: "new wording" })] });

		await planJournalSync();

		expect(updateDocuments).not.toHaveBeenCalled();
		expect(journals[0].setFlag).not.toHaveBeenCalled();
		expect(store.journalSyncVersion).toBe("0.0.1");
		expect(global.ui.notifications.info).not.toHaveBeenCalled();
	});

	it("is null once this version is synced", async () => {
		harness({ settings: { journalSyncVersion: VERSION } });
		await expect(planJournalSync()).resolves.toBeNull();
	});

	// Seeded before baselines existed and different from what ships: left alone like an edit,
	// but with no baseline there is no telling whether this version changed it, so it must not
	// be announced as "also changed" on every release.
	it("keeps a differing entry with no baseline out of the kept-edits list", async () => {
		const entry = seeded("a", { content: "the GM's own words", baseline: "none" });
		harness({ journals: [entry], packDocs: [shipped("a")] });

		const plan = await planJournalSync();

		expect(plan.keptEdits).toEqual([]);
		expect(plan.legacyEdits).toEqual(["a"]);
		expect(plan.refresh).toEqual([]);
	});
});

// The writing half, on entries whose shipped content changed.
describe("applyJournalSync", () => {
	/** A pristine seeded entry that can have its pages rewritten. */
	function refreshable(id, { failWith = null } = {}) {
		const entry = seeded(id);
		entry.createEmbeddedDocuments = vi.fn(async () => {
			if (failWith) throw failWith;
			return [];
		});
		entry.deleteEmbeddedDocuments = vi.fn(async () => []);
		entry.update = vi.fn(async () => {});
		return entry;
	}

	it("refreshes an untouched entry and records the version", async () => {
		const entry = refreshable("a");
		harness({ journals: [entry], packDocs: [shipped("a", { content: "new wording" })] });

		const result = await syncJournals();

		expect(result).toEqual({ stamped: true, updated: ["a"], failed: [] });
		expect(entry.createEmbeddedDocuments).toHaveBeenCalled();
		expect(store.journalSyncVersion).toBe(VERSION);
	});

	// The entry still holds its old content under its old baseline, so it is still pristine and
	// a retry would pick it up. Recording the version would leave it stale until the next release.
	it("leaves the version unrecorded when a refresh throws, and does not call it an edit", async () => {
		const good = refreshable("a");
		const bad = refreshable("b", { failWith: new Error("no permission") });
		harness({
			journals: [good, bad],
			packDocs: [shipped("a", { content: "new a" }), shipped("b", { content: "new b" })],
		});
		vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await syncJournals();

		expect(result).toEqual({ stamped: false, updated: ["a"], failed: ["b"] });
		expect(store.journalSyncVersion).toBe("0.0.1");
		const toast = global.ui.notifications.info.mock.calls.map(c => c[0]).join(" ");
		expect(toast).toContain("updated 1 journal");
		expect(toast).not.toContain("kept your edits");
	});

	it("reports progress per refreshed entry", async () => {
		harness({
			journals: [refreshable("a"), refreshable("b")],
			packDocs: [shipped("a", { content: "new a" }), shipped("b", { content: "new b" })],
		});
		const seen = [];

		await applyJournalSync(await planJournalSync(), { onProgress: p => seen.push(p) });

		expect(seen.map(p => p.fraction)).toEqual([0.5, 1]);
		expect(seen[1].detail).toBe("Updating b (2 of 2)");
	});

	// The update window already says what changed and what was kept.
	it("drops its toast when the caller's window says the same", async () => {
		harness({ journals: [refreshable("a")], packDocs: [shipped("a", { content: "new wording" })] });

		await applyJournalSync(await planJournalSync(), { notify: false });

		expect(global.ui.notifications.info).not.toHaveBeenCalled();
	});

	it("says nothing about an old entry with no baseline", async () => {
		const entry = seeded("a", { content: "the GM's own words", baseline: "none" });
		harness({ journals: [entry], packDocs: [shipped("a")] });

		await syncJournals();

		expect(global.ui.notifications.info).not.toHaveBeenCalled();
		expect(store.journalSyncVersion).toBe(VERSION);
	});
});
