import { describe, it, expect, beforeEach, vi } from "vitest";

// When the setup window opens, and what it says. A brand-new world gets it up front; an
// established world gets it after an update ONLY when that release changed journals the world
// still holds untouched, since most releases change none and the window used to open on every
// one of them anyway. Every lane is mocked: what is under test is the decision, not the work.

const open = vi.fn();
const planJournalSync = vi.fn();
const applyJournalSync = vi.fn();
const needsJournalSeed = vi.fn();
const needsJournalSync = vi.fn();
const needsTreasureItemSeed = vi.fn();
const offerDurableArtOnce = vi.fn();
const openProgressNotification = vi.fn();

vi.mock("../../module/dialogs/WorldSetupDialog.js", () => ({ WorldSetupDialog: { open: (...a) => open(...a) } }));
vi.mock("../../module/dialogs/PosterMapScenesDialog.js", () => ({ PosterMapScenesDialog: { ask: async () => [] } }));
vi.mock("../../module/hooks/SeedCompendiums.js", () => ({
	needsJournalSeed: () => needsJournalSeed(),
	needsJournalSync: () => needsJournalSync(),
	seedCompendiumJournalsOnce: async () => {},
	restampSeededJournalSources: async () => {},
	planJournalSync: (...a) => planJournalSync(...a),
	applyJournalSync: (...a) => applyJournalSync(...a),
	syncSeededFolderColors: async () => {},
	unnestSeededWorldRootOnce: async () => {},
}));
vi.mock("../../module/utils/progress-notification.js", () => ({ openProgressNotification: (...a) => openProgressNotification(...a) }));
vi.mock("../../module/hooks/SeedActors.js", () => ({
	needsBestiaryActorSeed: () => false, seedBestiaryActorsOnce: async () => {}, collapseBestiaryActorSubfoldersOnce: async () => {},
}));
vi.mock("../../module/hooks/SeedItems.js", () => ({
	needsTreasureItemSeed: () => needsTreasureItemSeed(), seedTreasureItemsOnce: async () => {}, backfillTreasureWriteups: async () => {},
}));
vi.mock("../../module/book2-art/reapply.js", () => ({
	reapplyBook2ArtOnVersionChange: async () => null, reapplyBook2Art: async () => null,
}));
vi.mock("../../module/migration/once-per-version.js", () => ({ oncePerVersion: async () => {} }));
vi.mock("../../module/book2-art/art-root.js", () => ({ book2ArtRoot: () => "art" }));
vi.mock("../../module/book2-art/offer-once.js", () => ({ offerDurableArtOnce: (...a) => offerDurableArtOnce(...a) }));
vi.mock("../../module/book2-art/poster-maps.js", () => ({ posterMapScenePlan: async () => [], createPosterMapScenes: async () => ({}) }));
vi.mock("../../module/relmap/relmap-make.js", () => ({ seedRelationshipMapOnce: async () => {} }));
vi.mock("../../module/timeline/timeline-store.js", () => ({ syncTrackPages: async () => {} }));
vi.mock("../../module/timeline/timeline-backfill.js", () => ({ backfillLevelUpsOnce: async () => {} }));
vi.mock("../../module/migration/expedition-title-prefix.js", () => ({ stripExpeditionTitlePrefixesOnce: async () => {} }));
vi.mock("../../module/utils/primary-gm.js", () => ({ isPrimaryGM: () => true }));

const { runWorldSetup, updateWindowCopy, setupLead } = await import("../../module/hooks/WorldSetup.js");

/** A stand-in for the live window: every progress call is a no-op spy. */
function fakeDialog() {
	return { start: vi.fn(), step: vi.fn(), done: vi.fn(), skip: vi.fn(), fail: vi.fn(), finish: vi.fn(async () => {}) };
}

const PLAN = (refreshCount, keptCount = 0) => ({
	version: "2.0.0",
	refresh: Array.from({ length: refreshCount }, (_, i) => ({ entry: { name: `j${i}` } })),
	stamps: [],
	keptEdits: Array.from({ length: keptCount }, (_, i) => `k${i}`),
});

/** Let the un-awaited finishing pass run out. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	open.mockImplementation(() => fakeDialog());
	needsJournalSeed.mockReturnValue(false);
	needsJournalSync.mockReturnValue(true);
	planJournalSync.mockResolvedValue(PLAN(0));
	applyJournalSync.mockResolvedValue({ stamped: true, updated: [], failed: [] });
	needsTreasureItemSeed.mockReturnValue(false);
	offerDurableArtOnce.mockResolvedValue(undefined);
	openProgressNotification.mockImplementation(() => ({ update: vi.fn(), close: vi.fn(), abandon: vi.fn() }));
	global.game = { user: { id: "gm-1", isGM: true }, users: { activeGM: { id: "gm-1" } }, system: { version: "2.0.0" } };
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

describe("runWorldSetup's window", () => {
	it("stays shut after an update that changed no journals", async () => {
		await runWorldSetup();
		await settle();

		expect(open).not.toHaveBeenCalled();
		// The baselines still get stamped, quietly.
		expect(applyJournalSync).toHaveBeenCalledWith(PLAN(0), expect.anything());
	});

	it("opens once, about the update, when a release changed journals", async () => {
		planJournalSync.mockResolvedValue(PLAN(3));
		applyJournalSync.mockResolvedValue({ stamped: true, updated: ["j0", "j1", "j2"] });

		await runWorldSetup();
		await settle();

		expect(open).toHaveBeenCalledTimes(1);
		const [steps, copy] = open.mock.calls[0];
		expect(steps.map(s => s.key)).toEqual(["journalSync"]);
		expect(steps[0].label).toBe("3 journals changed in 2.0.0");
		expect(copy.title).toBe("Updating your world");
		// It closes itself once the one lane it narrates has settled.
		expect(open.mock.results[0].value.finish).toHaveBeenCalled();
	});

	it("stays shut on a settled world with no update", async () => {
		needsJournalSync.mockReturnValue(false);
		planJournalSync.mockResolvedValue(null);

		await runWorldSetup();
		await settle();

		expect(open).not.toHaveBeenCalled();
	});

	it("opens up front, with the new-world wording, on a brand-new world", async () => {
		needsJournalSeed.mockReturnValue(true);
		needsJournalSync.mockReturnValue(false);
		planJournalSync.mockResolvedValue(null);

		void runWorldSetup();
		await settle();

		expect(open).toHaveBeenCalledTimes(1);
		expect(open.mock.calls[0][1].lead).toContain("new world");
	});

	it("reports a failed comparison on the row rather than ticking it off", async () => {
		planJournalSync.mockRejectedValue(new Error("pack unreadable"));
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runWorldSetup();
		await settle();

		// Nothing to show a window for, and nothing recorded: the next load retries.
		expect(open).not.toHaveBeenCalled();
		expect(applyJournalSync).toHaveBeenCalledWith(null, expect.anything());
		// With no window up, the GM still hears about it.
		expect(global.ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("try again"));
	});

	it("tells the GM when the baselines fail to stamp and no window is up", async () => {
		applyJournalSync.mockResolvedValue({ stamped: false, updated: [], failed: [] });
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runWorldSetup();
		await settle();

		expect(open).not.toHaveBeenCalled();
		expect(global.ui.notifications.warn).toHaveBeenCalledTimes(1);
	});

	it("fails the row when a journal could not be refreshed", async () => {
		planJournalSync.mockResolvedValue(PLAN(2));
		applyJournalSync.mockResolvedValue({ stamped: false, updated: ["j0"], failed: ["j1"] });
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runWorldSetup();
		await settle();

		const dialog = open.mock.results[0].value;
		expect(dialog.fail).toHaveBeenCalledWith("journalSync", expect.any(String));
		expect(dialog.done).not.toHaveBeenCalledWith("journalSync", expect.anything());
	});

	// The window says what changed and what was kept, so the toast would repeat it.
	it("asks for no toast when a window narrates the sync, and for one when none does", async () => {
		planJournalSync.mockResolvedValue(PLAN(1));
		await runWorldSetup();
		expect(applyJournalSync.mock.calls[0][1].notify).toBe(false);

		applyJournalSync.mockClear();
		open.mockClear();
		planJournalSync.mockResolvedValue(PLAN(0, 2));
		await runWorldSetup();
		expect(open).not.toHaveBeenCalled();
		expect(applyJournalSync.mock.calls[0][1].notify).toBe(true);
	});

	it("waits for the update window to close before offering poster-map scenes", async () => {
		planJournalSync.mockResolvedValue(PLAN(1));
		let closeWindow;
		open.mockImplementation(() => ({ ...fakeDialog(), finish: vi.fn(() => new Promise(r => { closeWindow = r; })) }));

		await runWorldSetup();
		await settle();
		expect(offerDurableArtOnce).not.toHaveBeenCalled();

		closeWindow();
		await settle();
		expect(offerDurableArtOnce).toHaveBeenCalled();
	});

	it("reports a slow comparison on a delayed bar when no window is up", async () => {
		planJournalSync.mockImplementation(async ({ onProgress }) => {
			onProgress?.({ fraction: 0.5, detail: "Checking 1 of 2" });
			return PLAN(0);
		});

		await runWorldSetup();

		expect(openProgressNotification).toHaveBeenCalledTimes(1);
		expect(openProgressNotification.mock.calls[0][1].delayMs).toBeGreaterThan(0);
		const bar = openProgressNotification.mock.results[0].value;
		expect(bar.update).toHaveBeenCalledWith({ fraction: 0.5, detail: "Checking 1 of 2" });
		expect(bar.close).toHaveBeenCalled();
	});

	it("reports the comparison on the main window's row when an import has that window up", async () => {
		needsTreasureItemSeed.mockReturnValue(true);
		planJournalSync.mockImplementation(async ({ onProgress }) => {
			onProgress?.({ fraction: 0.5, detail: "Checking 1 of 2" });
			return PLAN(0);
		});

		await runWorldSetup();

		expect(openProgressNotification).not.toHaveBeenCalled();
		const dialog = open.mock.results[0].value;
		expect(dialog.start).toHaveBeenCalledWith("journalSync", expect.any(String));
		expect(dialog.step).toHaveBeenCalledWith("journalSync", { fraction: 0.5, detail: "Checking 1 of 2" });
	});
});

describe("updateWindowCopy", () => {
	it("names the version and how many journals changed", () => {
		const copy = updateWindowCopy({ version: "1.9.0", refreshCount: 4 });
		expect(copy.lead).toContain("Stonetop 1.9.0 changed 4 journals");
		expect(copy.lead).toContain("only appears when an update changes journals");
		expect(copy.rowLabel).toBe("4 journals changed in 1.9.0");
		expect(copy.doneLine).toBe("Your journals are up to date with Stonetop 1.9.0.");
	});

	it("speaks of one journal in the singular", () => {
		const copy = updateWindowCopy({ version: "1.9.0", refreshCount: 1 });
		expect(copy.lead).toContain("changed 1 journal that");
		expect(copy.lead).toContain("bringing it up to date");
		expect(copy.rowLabel).toBe("1 journal changed in 1.9.0");
	});

	it("says where the new wording is for journals with edits", () => {
		expect(updateWindowCopy({ version: "1.9.0", refreshCount: 2, keptCount: 1 }).lead)
			.toContain("1 other journal also changed, but it has edits in your world, so it stays as it is");
		expect(updateWindowCopy({ version: "1.9.0", refreshCount: 2, keptCount: 2 }).lead)
			.toContain("they stay as they are");
		expect(updateWindowCopy({ version: "1.9.0", refreshCount: 2 }).lead).not.toContain("edits");
	});
});

describe("setupLead", () => {
	it("calls a world new only when its journals are still owed", () => {
		expect(setupLead({ journals: true, monsters: true, treasures: true })).toContain("your new world");
		expect(setupLead({ journals: false, monsters: false, treasures: true }))
			.toBe("Stonetop is adding its Treasures & Wonders to your world. This only happens once. You can carry on while it finishes.");
	});
});
