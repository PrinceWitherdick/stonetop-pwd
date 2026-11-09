import { describe, it, expect, vi, afterEach } from "vitest";
import { CreateSiteDialog } from "../../module/sites/create-site-dialog.js";
import { createSite } from "../../module/sites/site-store.js";

// The page store, faked: finishing a new site files it through createSite.
vi.mock("../../module/sites/site-store.js", async importOriginal => ({ ...(await importOriginal()), createSite: vi.fn() }));
import {
	CREATE_SITE_WINDOW_CLASS, CREATE_SITE_RESTORE_KIND, NEW_SITE_KEY, reopenCreateSite,
} from "../../module/sites/create-site-restore.js";

// Create a Site comes back after a reload like the character sheet (sites/create-site-restore.js):
// saved under its own key, with the step and every answer, and put back before the first draw.

const blankSel = () => ({
	name: "", why: "", description: "", manner: "", picks: {}, regionId: "", terrain: [], regionPicks: {},
	connections: [], questions: [], timeline: [], denizens: [], dangers: [], discoveries: [],
	outside: [], inside: [], areas: [], plans: [], randomTables: [],
});

// Off the prototype, as create-site-dialog.test.js does: no element, so the live-field read is a no-op.
const on = (sel, extra = {}) => Object.assign(Object.create(CreateSiteDialog.prototype), { _sel: sel, _step: 0, ...extra });

afterEach(() => {
	delete globalThis.fromUuid;
	delete game.user;
});

describe("the Create a Site restore", () => {
	// window-restore builds the hooks it watches from this name; registered before the heavy dialog
	// module loads, so it's spelled out there, and this holds it to the class that fires them.
	it("watches the class that actually draws the window", () => {
		expect(CreateSiteDialog.name).toBe(CREATE_SITE_WINDOW_CLASS);
	});

	it("is saved under its kind: one key for making a site, the page's uuid for an edit", () => {
		expect(on(blankSel()).restoreKey).toBe(`${CREATE_SITE_RESTORE_KIND}:${NEW_SITE_KEY}`);
		const page = { id: "p1", uuid: "JournalEntry.j1.JournalEntryPage.p1" };
		expect(on(blankSel(), { _page: page }).restoreKey).toBe("createSite:JournalEntry.j1.JournalEntryPage.p1");
	});

	it("keeps the step by key and every answer, and puts them back", () => {
		const sel = { ...blankSel(), name: "Barrow", manner: "tomb", picks: { theme: ["Sealed"] },
			areas: [{ title: "Entrance", description: "Dim", contents: "", exits: "" }] };
		const left = on(sel, { _step: 6 });
		const view = JSON.parse(JSON.stringify(left.restoreView));
		expect(view.step).toBe("areas");

		const back = on(blankSel());
		back._takeRestoredView(view);
		expect(back._sel).toEqual(sel);
		expect(back._step).toBe(6);
	});

	// So the answers that came back still count as unsaved, and closing asks before losing them.
	it("tells the close-guard what it would have opened with, not what came back", () => {
		const back = on(blankSel());
		back._takeRestoredView({ step: "foundation", sel: { ...blankSel(), name: "Barrow" } });
		expect(JSON.parse(back._pristineWork).name).toBe("");
	});

	it("takes an answer only in the shape this version keeps it in", () => {
		const back = on(blankSel());
		back._takeRestoredView({ step: "gone", sel: { name: "Barrow", areas: "not a list", picks: [], terrain: ["Hills"], why: null } });
		expect(back._sel).toEqual({ ...blankSel(), name: "Barrow", terrain: ["Hills"] });
		expect(back._step).toBe(0);
	});
});

describe("reopenCreateSite", () => {
	it("stays shut for a player: sites are GM prep", async () => {
		game.user = { isGM: false };
		expect(await reopenCreateSite("createSite:new")).toBeNull();
	});

	it("stays shut for another kind's key", async () => {
		game.user = { isGM: true };
		expect(await reopenCreateSite("camp:c1:h1")).toBeNull();
	});

	it("stays shut for an edit whose site has gone", async () => {
		game.user = { isGM: true };
		globalThis.fromUuid = vi.fn(async () => null);
		expect(await reopenCreateSite("createSite:JournalEntry.j1.JournalEntryPage.p1")).toBeNull();
	});

	// The reload dropped whoever was waiting on its answer, so a reopened one files its own site.
	it("mints a new-site walkthrough unrendered, that files its own site when it finishes", async () => {
		game.user = { isGM: true };
		const dialog = await reopenCreateSite("createSite:new");
		expect(dialog).toBeInstanceOf(CreateSiteDialog);
		expect(dialog._page).toBeNull();
		// It says where the site went, so Save for now's own notice stays quiet.
		expect(dialog._announce).toBe(true);
		expect(dialog._quietSave).toBe(true);
	});
});

describe("finishing a new site", () => {
	const steading = { name: "Stonetop" };
	const finished = (extra = {}) => {
		const d = on({ ...blankSel(), name: "Barrow" }, { _steading: steading, _announce: false, ...extra });
		d._resolveWith = vi.fn();
		return d;
	};

	const realUi = globalThis.ui;
	afterEach(() => { globalThis.ui = realUi; });

	// One place files a new site, whichever way the window was opened.
	it("files it under the steading and resolves to its page, quietly unless asked to announce", async () => {
		const page = { name: "Barrow" };
		createSite.mockResolvedValue(page);
		globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
		const quiet = finished();
		await quiet._finish();
		expect(createSite).toHaveBeenCalledWith(steading, expect.objectContaining({ name: "Barrow" }));
		expect(quiet._resolveWith).toHaveBeenCalledWith(page);
		expect(ui.notifications.info).not.toHaveBeenCalled();

		await finished({ _announce: true })._finish();
		expect(ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("Added site: Barrow"));
	});

	it("stays open when no page could be made, so nothing written is lost", async () => {
		createSite.mockResolvedValue(null);
		const d = finished();
		await d._finish();
		expect(d._resolveWith).not.toHaveBeenCalled();
	});
});
