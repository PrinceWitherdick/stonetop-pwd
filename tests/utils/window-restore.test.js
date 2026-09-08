import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Window restore persists the sheets this client had open — geometry, active tab, and the
// Stonetop edit/lock mode — and replays them on ready. These tests drive the module through
// its real hooks: install it, fire renderActorSheet/closeActorSheet with fake sheets, let the
// debounce flush, then run restoreOpenWindows() against the state it wrote.

let hooks;      // hook name -> array of callbacks
let settings;   // setting key -> value
let docs;       // uuid -> fake document
let listeners;  // window event name -> callbacks

let installWindowRestore;
let restoreOpenWindows;
let RELMAP_WINDOW_CLASS;

function fire(hook, ...args) {
	(hooks[hook] ?? []).forEach((fn) => fn(...args));
}

// A stand-in for one of our AppV1 sheets: a positioned window over a world document, with
// the edit/lock mode as a plain instance field the way the real sheets carry it.
function fakeSheet({ uuid = "Actor.abc", editMode = false, isEditable = true, position = { left: 100, top: 50, width: 800, height: 600 } } = {}) {
	const doc = { uuid, sheet: null };
	const sheet = {
		document: doc,
		position,
		isEditable,
		_editMode: editMode,
		render: vi.fn(),
		testUserPermission: () => true,
	};
	doc.sheet = sheet;
	doc.testUserPermission = () => true;
	docs[uuid] = doc;
	return sheet;
}

beforeEach(async () => {
	vi.useFakeTimers();
	hooks = {};
	listeners = {};
	docs = {};
	settings = { restoreWindowsOnReload: true, openWindowsState: {} };

	global.Hooks = {
		on: (name, fn) => { (hooks[name] ??= []).push(fn); },
		once: (name, fn) => { (hooks[name] ??= []).push(fn); },
	};
	global.game = {
		...global.game,
		settings: {
			get: (_scope, key) => settings[key],
			set: (_scope, key, value) => { settings[key] = value; return Promise.resolve(value); },
		},
	};
	global.window = {
		innerWidth: 1920,
		innerHeight: 1080,
		addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
	};
	global.fromUuid = async (uuid) => docs[uuid] ?? null;

	// Fresh module instance per test — the live registry of open sheets is module state.
	vi.resetModules();
	({ installWindowRestore, restoreOpenWindows, RELMAP_WINDOW_CLASS } =
		await import("../../module/utils/window-restore.js"));
	installWindowRestore();
});

afterEach(() => { vi.useRealTimers(); });

const saved = (uuid) => settings.openWindowsState[uuid];

describe("snapshotting open sheets", () => {
	it("records the edit/lock mode alongside the geometry", () => {
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.edit", editMode: true }));
		vi.advanceTimersByTime(500);
		expect(saved("Actor.edit")).toMatchObject({ left: 100, top: 50, editMode: true });
	});

	it("records a locked sheet as locked, not as absent", () => {
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.locked", editMode: false }));
		vi.advanceTimersByTime(500);
		expect(saved("Actor.locked").editMode).toBe(false);
	});

	it("stores no mode for a sheet that has none (core sheets, journals)", () => {
		const plain = fakeSheet({ uuid: "Actor.plain" });
		delete plain._editMode;
		fire("renderActorSheet", plain);
		vi.advanceTimersByTime(500);
		expect("editMode" in saved("Actor.plain")).toBe(false);
	});

	it("follows a mode toggled after the first render", () => {
		const sheet = fakeSheet({ uuid: "Actor.toggled", editMode: false });
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		// The header wrench flips the flag and re-renders.
		sheet._editMode = true;
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		expect(saved("Actor.toggled").editMode).toBe(true);
	});

	it("drops a closed sheet from the snapshot", () => {
		const sheet = fakeSheet({ uuid: "Actor.closed", editMode: true });
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		fire("closeActorSheet", sheet);
		vi.advanceTimersByTime(500);
		expect(saved("Actor.closed")).toBeUndefined();
	});
});

describe("restoring the edit/lock mode", () => {
	// Restore renders on a stagger; run the queued timers and let the awaited fromUuid settle.
	async function restore() {
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
	}

	it("reopens a sheet left in edit mode in edit mode", async () => {
		// A sheet constructed fresh after the reload defaults to locked.
		const sheet = fakeSheet({ uuid: "Actor.edit", editMode: false });
		settings.openWindowsState = { "Actor.edit": { left: 10, top: 20, width: 800, height: 600, editMode: true } };
		await restore();
		expect(sheet._editMode).toBe(true);
		expect(sheet.render).toHaveBeenCalled();
	});

	it("reopens a sheet left locked as locked, even when it constructed itself in edit mode", async () => {
		// Mirrors the "Open Sheets in Edit Mode" client setting being on.
		const sheet = fakeSheet({ uuid: "Actor.locked", editMode: true });
		settings.openWindowsState = { "Actor.locked": { left: 10, top: 20, editMode: false } };
		await restore();
		expect(sheet._editMode).toBe(false);
	});

	it("sets the mode before the sheet renders, so the first render is in that mode", async () => {
		const sheet = fakeSheet({ uuid: "Actor.order", editMode: false });
		let modeAtRender = null;
		sheet.render = vi.fn(() => { modeAtRender = sheet._editMode; });
		settings.openWindowsState = { "Actor.order": { left: 10, top: 20, editMode: true } };
		await restore();
		expect(modeAtRender).toBe(true);
	});

	it("leaves a sheet this user cannot edit in play mode", async () => {
		const sheet = fakeSheet({ uuid: "Actor.readonly", editMode: false, isEditable: false });
		settings.openWindowsState = { "Actor.readonly": { left: 10, top: 20, editMode: true } };
		await restore();
		expect(sheet._editMode).toBe(false);
		expect(sheet.render).toHaveBeenCalled();
	});

	it("restores nothing when the reopen setting is off", async () => {
		const sheet = fakeSheet({ uuid: "Actor.edit", editMode: false });
		settings.restoreWindowsOnReload = false;
		settings.openWindowsState = { "Actor.edit": { left: 10, top: 20, editMode: true } };
		await restore();
		expect(sheet._editMode).toBe(false);
		expect(sheet.render).not.toHaveBeenCalled();
	});
});

// The relationship map board is the one window tracked here that is not a DocumentSheet: a table
// leaves it open all session, so it is worth restoring, and it exposes `document` for that. Its
// hooks are named after its class, which is the join nothing else would notice breaking.
describe("the relationship map board", () => {
	it("is watched under the hook the board's own class name fires", async () => {
		const { RelationshipMapWindow } =
			await import("../../module/dialogs/RelationshipMapWindow.js");
		expect(RelationshipMapWindow.name).toBe(RELMAP_WINDOW_CLASS);
	});

	it("is saved and reopened like any sheet over its entry", async () => {
		const board = fakeSheet({ uuid: "JournalEntry.map1" });
		// A board has no edit/lock mode of the kind the sheets carry; its own lock is per window.
		delete board._editMode;
		fire(`render${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map1")).toMatchObject({ left: 100, top: 50, width: 800, height: 600 });

		// Reopened through `doc.sheet` — which for a map is the bouncer that opens the board.
		settings.openWindowsState = { "JournalEntry.map1": { left: 10, top: 20, width: 900, height: 700 } };
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
		expect(board.render).toHaveBeenCalledWith(true, { left: 10, top: 20, width: 900, height: 700 });
	});

	it("drops the board from the snapshot once it is closed", () => {
		const board = fakeSheet({ uuid: "JournalEntry.map2" });
		fire(`render${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		fire(`close${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map2")).toBeUndefined();
	});

	// One map is several named boards, and which one a reader was on is as much a part of "where
	// this window was" as its corner of the screen: a table leaves the board open all session, and
	// it is open ON something. Asked for by name (`restorePageId`) because this is not a
	// DocumentSheet and has no `_tabs` for the tab snapshot to find.
	it("saves which of the map's pages was up", () => {
		const board = fakeSheet({ uuid: "JournalEntry.map3" });
		delete board._editMode;
		board.restorePageId = "page7";
		fire(`render${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map3").pageId).toBe("page7");
	});

	// ⚠ IT TRAVELS BACK IN THE SAME RENDER OPTIONS THE GEOMETRY DOES, which is not a shortcut:
	// `pageId` is already core's own option for "open this entry at this page", and the map's
	// bouncer sheet forwards the whole options object to the board. So the board is handed its page
	// BEFORE its first render, rather than being switched to it afterwards, which the reader would
	// see as the wrong board painting and then jumping.
	it("hands the page back to the board in the render that reopens it", async () => {
		const board = fakeSheet({ uuid: "JournalEntry.map4" });
		settings.openWindowsState = {
			"JournalEntry.map4": { left: 10, top: 20, width: 900, height: 700, pageId: "page7" },
		};
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
		expect(board.render).toHaveBeenCalledWith(true,
			{ left: 10, top: 20, width: 900, height: 700, pageId: "page7" });
	});

	// Every other window tracked here has no pages, and must not grow a stray option because one
	// of them does.
	it("saves no page for a window that has none", () => {
		const sheet = fakeSheet({ uuid: "Actor.plain" });
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		expect(saved("Actor.plain")).not.toHaveProperty("pageId");
	});

	// ⚠ AND THE SAME BOARD MOUNTED INSIDE A SHEET IS NOT A WINDOW AT ALL. The steading sheet's
	// Relationship Map tab holds a frameless subclass of the board (RelationshipMapPanel), and
	// AppV1 builds its render hook out of EVERY class name in the inheritance chain -- so the
	// panel fires this hook exactly as the window does, over the same entry.
	//
	// Tracked, it would take the map's uuid in the registry and evict the real window on the same
	// map (last render wins), and on the next reload it would be reopened as a floating window
	// over a sheet that already contains one. There is nothing to restore about it in any case:
	// where a panel was is wherever its host sheet was, and the host is restored on its own
	// account. `popOut` is the honest question, and it covers any future embed rather than this
	// one class.
	it("ignores a board mounted inside a sheet rather than opened as a window", () => {
		const panel = fakeSheet({ uuid: "JournalEntry.map5" });
		delete panel._editMode;
		panel.popOut = false;
		fire(`render${RELMAP_WINDOW_CLASS}`, panel);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map5")).toBeUndefined();
	});

	it("and a panel closing does not un-save the window on the same map", () => {
		// Both fire the same close hook over the same uuid. If the panel were let through here it
		// would drop the real window's entry, and the map would simply not come back on reload.
		const board = fakeSheet({ uuid: "JournalEntry.map6" });
		delete board._editMode;
		fire(`render${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		const panel = { ...board, popOut: false };
		fire(`close${RELMAP_WINDOW_CLASS}`, panel);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map6")).toBeTruthy();
	});
});
