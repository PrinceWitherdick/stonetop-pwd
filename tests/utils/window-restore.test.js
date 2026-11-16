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
		// The setting is one record for every world this browser opens, so it is kept per world: this
		// client is in world "w1", and anything under another key belongs to somewhere else.
		world: { id: "w1" },
		settings: {
			get: (_scope, key) => settings[key],
			set: (_scope, key, value) => { settings[key] = value; return Promise.resolve(value); },
		},
	};
	global.window = {
		innerWidth: 1920,
		innerHeight: 1080,
		addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
		removeEventListener: (name, fn) => { listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn); },
	};
	global.fromUuid = async (uuid) => docs[uuid] ?? null;

	// Fresh module instance per test — the live registry of open sheets is module state.
	vi.resetModules();
	({ installWindowRestore, restoreOpenWindows, RELMAP_WINDOW_CLASS } =
		await import("../../module/utils/window-restore.js"));
	installWindowRestore();
});

afterEach(() => { vi.useRealTimers(); });

const saved = (uuid) => settings.openWindowsState.w1?.[uuid];

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

	it("saves every other window when one's restoreView throws", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const broken = fakeSheet({ uuid: "Actor.broken" });
		Object.defineProperty(broken, "restoreView", { get() { throw new TypeError("half torn down"); } });
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.fine" }));
		fire("renderActorSheet", broken);
		vi.advanceTimersByTime(500);
		expect(saved("Actor.fine")).toMatchObject({ left: 100, top: 50 });
		expect(saved("Actor.broken")).toBeUndefined();
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

// ⚠ ONE SETTING FOR EVERY WORLD THIS BROWSER OPENS, and each save writes the whole of it. A save that
// wrote only this world's windows wiped every other world's: a GM who spent an evening in a second
// world came back to find nothing reopened in the first.
describe("keeping each world's windows apart", () => {
	async function restore() {
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
	}

	it("keeps the windows another world saved when it saves this one's", () => {
		settings.openWindowsState = { w2: { "Actor.theirs": { left: 1, top: 1 } } };
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.mine" }));
		vi.advanceTimersByTime(500);
		expect(settings.openWindowsState.w2).toEqual({ "Actor.theirs": { left: 1, top: 1 } });
		expect(Object.keys(settings.openWindowsState.w1)).toEqual(["Actor.mine"]);
	});

	it("reopens nothing another world left open", async () => {
		const sheet = fakeSheet({ uuid: "Actor.theirs" });
		settings.openWindowsState = { w2: { "Actor.theirs": { left: 10, top: 20 } } };
		await restore();
		expect(sheet.render).not.toHaveBeenCalled();
	});

	// A record saved before the worlds were kept apart is the windows themselves, keyed by uuid.
	it("still reads a record saved before the worlds were kept apart, and nests it on the next save", async () => {
		const sheet = fakeSheet({ uuid: "Actor.old" });
		settings.openWindowsState = { "Actor.old": { left: 10, top: 20 } };
		await restore();
		expect(sheet.render).toHaveBeenCalled();
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		expect(settings.openWindowsState["Actor.old"]).toBeUndefined();
		expect(saved("Actor.old")).toBeDefined();
	});

	// ⚠ AND LEFT FOR ITS OWN WORLD BY EVERY OTHER. Nothing in that record says which world wrote it, so a
	// world that reopens nothing from it has not found its own windows there, and its saves must not throw
	// them away: a GM who updated and opened a different world first came back to nothing.
	it("leaves a record saved before the worlds were kept apart alone, when this world reopens nothing from it", async () => {
		settings.openWindowsState = { "Actor.elsewhere": { left: 10, top: 20 } };
		await restore();
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.mine" }));
		vi.advanceTimersByTime(500);
		expect(settings.openWindowsState["Actor.elsewhere"]).toEqual({ left: 10, top: 20 });
		expect(Object.keys(settings.openWindowsState.w1)).toEqual(["Actor.mine"]);
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

	// The render is marked as the restore's own, so the relationship map's bouncer can refuse a
	// switched-off map without a notice (openRelationshipMap).
	it("marks a restored render as restored, with the geometry", async () => {
		const sheet = fakeSheet({ uuid: "Actor.mark" });
		settings.openWindowsState = { "Actor.mark": { left: 10, top: 20 } };
		await restore();
		expect(sheet.render).toHaveBeenCalledWith(true, expect.objectContaining({ left: 10, top: 20, restored: true }));
	});

	// The GM switched the Timeline off since: activating a tab the sheet no longer draws would hide
	// every tab body and leave the sheet blank, so the sheet stays on the tab it drew.
	it("skips a saved tab the sheet no longer draws, and switches to one it does", async () => {
		const nav = names => ({ querySelectorAll: () => names.map(tab => ({ dataset: { tab } })) });
		const gone = fakeSheet({ uuid: "Actor.gone" });
		const kept = fakeSheet({ uuid: "Actor.kept" });
		for (const sheet of [gone, kept]) {
			sheet._tabs = [{ active: "moves", _nav: nav(["moves", "notes"]), activate: vi.fn() }];
			sheet.render = vi.fn(() => fire("renderActorSheet", sheet));
		}
		settings.openWindowsState = {
			"Actor.gone": { left: 10, top: 20, tabs: ["timeline"] },
			"Actor.kept": { left: 10, top: 20, tabs: ["notes"] },
		};
		await restore();
		expect(gone._tabs[0].activate).not.toHaveBeenCalled();
		expect(kept._tabs[0].activate).toHaveBeenCalledWith("notes");
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

// The stagger puts 120ms between one reopened window and the next, so whichever opens last waits
// the longest. Opening the front-most first is what gets the window a GM was looking at back on
// screen soonest. Every render lands on top of the stack, though, so the saved stack has to be put
// back once they have all opened, or the front window would end up at the back.
describe("restoring the stack", () => {
	// A window whose render reports back through the real hook, as core's does, logging when it
	// was opened and when it was brought forward.
	function stackedSheet(uuid, log, { reports = true } = {}) {
		const sheet = fakeSheet({ uuid });
		delete sheet._editMode;
		sheet.render = vi.fn(() => {
			log.push(`open ${uuid}`);
			if (reports) fire("renderActorSheet", sheet);
		});
		sheet.bringToFront = vi.fn(() => log.push(`front ${uuid}`));
		return sheet;
	}

	const threeDeep = () => ({
		"Actor.back":   { left: 0, top: 0, zIndex: 101 },
		"Actor.middle": { left: 0, top: 0, zIndex: 105 },
		"Actor.front":  { left: 0, top: 0, zIndex: 110 },
	});

	async function restore() {
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
	}

	it("records where each window sat in the stack", () => {
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.z", position: { left: 1, top: 2, zIndex: 107 } }));
		vi.advanceTimersByTime(500);
		expect(saved("Actor.z").zIndex).toBe(107);
	});

	it("opens the front-most window first", async () => {
		const log = [];
		for (const id of ["Actor.back", "Actor.middle", "Actor.front"]) stackedSheet(id, log);
		settings.openWindowsState = threeDeep();
		await restore();
		expect(log.filter((l) => l.startsWith("open"))).toEqual(["open Actor.front", "open Actor.middle", "open Actor.back"]);
	});

	it("then brings them forward back-most first, so the front window ends in front", async () => {
		const log = [];
		for (const id of ["Actor.back", "Actor.middle", "Actor.front"]) stackedSheet(id, log);
		settings.openWindowsState = threeDeep();
		await restore();
		expect(log.filter((l) => l.startsWith("front"))).toEqual(["front Actor.back", "front Actor.middle", "front Actor.front"]);
		// ...and only once every window has opened, or a later render would land on top again.
		expect(log.indexOf("front Actor.back")).toBeGreaterThan(log.indexOf("open Actor.back"));
	});

	it("keeps the saved order for a save from before the stack was recorded", async () => {
		const log = [];
		for (const id of ["Actor.one", "Actor.two", "Actor.three"]) stackedSheet(id, log);
		settings.openWindowsState = {
			"Actor.one":   { left: 0, top: 0 },
			"Actor.two":   { left: 0, top: 0 },
			"Actor.three": { left: 0, top: 0 },
		};
		await restore();
		expect(log.filter((l) => l.startsWith("open"))).toEqual(["open Actor.one", "open Actor.two", "open Actor.three"]);
	});

	it("does not let a window that never reports its render hold the others at the back", async () => {
		const log = [];
		stackedSheet("Actor.back", log, { reports: false });
		stackedSheet("Actor.middle", log);
		stackedSheet("Actor.front", log);
		settings.openWindowsState = threeDeep();
		await restore();
		expect(log.at(-1)).toBe("front Actor.front");
	});

	it("skips a window that closed before the stack was put back", async () => {
		const log = [];
		stackedSheet("Actor.back", log).rendered = false;
		stackedSheet("Actor.middle", log);
		stackedSheet("Actor.front", log);
		settings.openWindowsState = threeDeep();
		await restore();
		expect(log).not.toContain("front Actor.back");
		expect(log.at(-1)).toBe("front Actor.front");
	});

	// A slow render can hold the restack back for seconds, and the user does not wait for it. The
	// first click puts back what has landed, before that click raises its own window, and nothing
	// raises them all again afterwards.
	it("hands the stack to the user at their first click, rather than burying what they chose", async () => {
		const log = [];
		for (const id of ["Actor.back", "Actor.middle", "Actor.front"]) {
			const sheet = stackedSheet(id, log);
			const open = sheet.render;
			sheet.rendered = false;
			sheet.render = vi.fn(() => { sheet.rendered = true; open(); });
		}
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.advanceTimersByTimeAsync(120);
		expect(log).toEqual(["open Actor.front", "open Actor.middle"]);

		for (const fn of listeners.pointerdown ?? []) fn({});
		expect(log.slice(2)).toEqual(["front Actor.middle", "front Actor.front"]);

		await vi.runAllTimersAsync();
		expect(log.slice(4)).toEqual(["open Actor.back"]);
		// ...and it stops listening once it has handed over.
		expect(listeners.pointerdown).toEqual([]);
		expect(listeners.keydown).toEqual([]);
	});
});

// The same, against a stack that keeps real depths, the way core's does: every frame drawn takes the
// next z-index, and every raise takes the next one after that.
describe("restoring the stack, by depth", () => {
	let maxZ;

	beforeEach(() => {
		maxZ = 100;
		global.ui = { windows: {}, activeWindow: null };
	});
	afterEach(() => { delete global.ui; });

	function raise(app) {
		app.position.zIndex = ++maxZ;
		app.element.style.zIndex = String(app.position.zIndex);
		ui.activeWindow = app;
	}

	// A window that, like core's `render(true)`, raises ITSELF a moment after its render hook has run
	// (appv1 `maximize().then(() => bringToTop())`). `landsAfter` holds its render back that long.
	function deepSheet(uuid, { landsAfter = 0 } = {}) {
		const sheet = fakeSheet({ uuid, position: { left: 0, top: 0 } });
		delete sheet._editMode;
		sheet.rendered = false;
		sheet.element = { style: {} };
		sheet.bringToFront = vi.fn(() => { if (ui.activeWindow !== sheet) raise(sheet); });
		sheet.render = vi.fn(() => {
			const draw = () => {
				sheet.rendered = true;
				raise(sheet);
				ui.windows[uuid] = sheet;
				fire("renderActorSheet", sheet);
				Promise.resolve().then(() => sheet.bringToFront());
			};
			if (landsAfter) setTimeout(draw, landsAfter); else draw();
		});
		return sheet;
	}

	// Some other window the user opens: drawn on top, and not one of ours.
	function openOther(id) {
		const app = { id, position: {}, element: { style: {} }, rendered: true };
		raise(app);
		ui.windows[id] = app;
		return app;
	}

	const threeDeep = () => ({
		"Actor.back":   { left: 0, top: 0, zIndex: 101 },
		"Actor.middle": { left: 0, top: 0, zIndex: 105 },
		"Actor.front":  { left: 0, top: 0, zIndex: 110 },
	});
	const z = (app) => app.position.zIndex;

	it("keeps the saved stack when the last window to open raises itself after its hook", async () => {
		const back = deepSheet("Actor.back");
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front");
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
	});

	it("slots a window that lands after the first click beneath the ones saved in front of it", async () => {
		const back = deepSheet("Actor.back", { landsAfter: 2000 });
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front");
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.advanceTimersByTimeAsync(200);
		for (const fn of listeners.pointerdown ?? []) fn({});
		await vi.runAllTimersAsync();
		expect(back.rendered).toBe(true);
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
		// The window really in front is the one a click on the late window has to rise above.
		expect(ui.activeWindow).toBe(front);
		expect(back.element.style.zIndex).toBe(String(z(back)));
	});

	it("leaves a window the user opened meanwhile above the late one", async () => {
		const back = deepSheet("Actor.back", { landsAfter: 2000 });
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front");
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.advanceTimersByTimeAsync(200);
		for (const fn of listeners.pointerdown ?? []) fn({});
		const journal = openOther("journal");
		await vi.runAllTimersAsync();
		expect(z(journal)).toBeGreaterThan(z(front));
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
		expect(ui.activeWindow).toBe(journal);
	});

	it("slots every window when the click comes before any of them was even looked up", async () => {
		const back = deepSheet("Actor.back");
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front");
		settings.openWindowsState = threeDeep();
		const restoring = restoreOpenWindows();
		for (const fn of listeners.pointerdown ?? []) fn({});
		await restoring;
		await vi.runAllTimersAsync();
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
		expect(ui.activeWindow).toBe(front);
	});

	it("slots a window that lands after the straggler grace the same way", async () => {
		const back = deepSheet("Actor.back", { landsAfter: 10000 });
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front");
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
		expect(back.rendered).toBe(true);
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
	});

	it("leaves a late window on top when it was the front one", async () => {
		const back = deepSheet("Actor.back");
		const middle = deepSheet("Actor.middle");
		const front = deepSheet("Actor.front", { landsAfter: 2000 });
		settings.openWindowsState = threeDeep();
		await restoreOpenWindows();
		await vi.advanceTimersByTimeAsync(400);
		for (const fn of listeners.pointerdown ?? []) fn({});
		await vi.runAllTimersAsync();
		expect(z(front)).toBeGreaterThan(z(middle));
		expect(z(middle)).toBeGreaterThan(z(back));
		expect(ui.activeWindow).toBe(front);
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
		expect(board.render).toHaveBeenCalledWith(true, { left: 10, top: 20, width: 900, height: 700, restored: true });
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
			{ left: 10, top: 20, width: 900, height: 700, pageId: "page7", restored: true });
	});

	// Every other window tracked here has no pages, and must not grow a stray option because one
	// of them does.
	it("saves no page for a window that has none", () => {
		const sheet = fakeSheet({ uuid: "Actor.plain" });
		fire("renderActorSheet", sheet);
		vi.advanceTimersByTime(500);
		expect(saved("Actor.plain")).not.toHaveProperty("pageId");
		expect(saved("Actor.plain")).not.toHaveProperty("view");
	});

	// Where the reader had got to INSIDE a window (the timeline's zoom and drag) is the window's own
	// to name, and comes back by the same road as the page.
	it("saves a window's own view and hands it back in the render that reopens it", async () => {
		const board = fakeSheet({ uuid: "JournalEntry.map6" });
		delete board._editMode;
		board.restoreView = { zoom: 1.5, left: 300, top: 40 };
		fire(`render${RELMAP_WINDOW_CLASS}`, board);
		vi.advanceTimersByTime(500);
		expect(saved("JournalEntry.map6").view).toEqual({ zoom: 1.5, left: 300, top: 40 });

		await restoreOpenWindows();
		await vi.runAllTimersAsync();
		expect(board.render).toHaveBeenCalledWith(true,
			{ left: 100, top: 50, width: 800, height: 600, view: { zoom: 1.5, left: 300, top: 40 }, restored: true });
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

// A window over no document: the shared Make Camp window, whose camp lives in a flag on every
// character at the fire. Its module registers a kind, the window names its own key, and the kind
// mints the window again from that key, or declines to.
describe("a window registered by its kind", () => {
	class CampWindow {}

	const campWindow = (key = "camp:c1:h1") => ({
		restoreKey: key,
		position:   { left: 30, top: 40, width: 900, height: 500, zIndex: 120 },
		render:     vi.fn(),
	});

	async function restore() {
		await restoreOpenWindows();
		await vi.runAllTimersAsync();
	}

	it("is saved under the key it names, beside the sheets, and dropped once it closes", async () => {
		const { registerRestorableWindow } = await import("../../module/utils/window-restore.js");
		registerRestorableWindow(CampWindow, "camp", vi.fn());
		const app = campWindow();
		fire("renderCampWindow", app);
		fire("renderActorSheet", fakeSheet({ uuid: "Actor.pc" }));
		vi.advanceTimersByTime(500);
		expect(saved("camp:c1:h1")).toEqual({ left: 30, top: 40, width: 900, height: 500, zIndex: 120 });
		expect(saved("Actor.pc")).toBeDefined();
		fire("closeCampWindow", app);
		vi.advanceTimersByTime(500);
		expect(saved("camp:c1:h1")).toBeUndefined();
	});

	// A new homebrew playbook's builder is keyed by a draft id until it is saved, then by its Item.
	it("forgets the key a window had once it names another, so a reload opens it once", async () => {
		const { registerRestorableWindow } = await import("../../module/utils/window-restore.js");
		registerRestorableWindow(CampWindow, "camp", vi.fn());
		const app = campWindow("camp:new-1");
		fire("renderCampWindow", app);
		app.restoreKey = "camp:saved-1";
		fire("renderCampWindow", app);
		vi.advanceTimersByTime(500);
		expect(saved("camp:new-1")).toBeUndefined();
		expect(saved("camp:saved-1")).toBeDefined();
	});

	// The order stonetop.js runs them in: the camp registers at module scope, and init installs.
	it("is watched when it was registered before the hooks were installed", async () => {
		hooks = {};
		vi.resetModules();
		const early = await import("../../module/utils/window-restore.js");
		early.registerRestorableWindow(CampWindow, "camp", vi.fn());
		early.installWindowRestore();
		fire("renderCampWindow", campWindow("camp:c2:h1"));
		vi.advanceTimersByTime(500);
		expect(saved("camp:c2:h1")).toBeDefined();
	});

	it("is reopened by its kind, where it was left", async () => {
		const { registerRestorableWindow } = await import("../../module/utils/window-restore.js");
		const app = campWindow();
		const reopen = vi.fn(() => app);
		registerRestorableWindow(CampWindow, "camp", reopen);
		settings.openWindowsState = { w1: { "camp:c1:h1": { left: 10, top: 20, width: 900, height: 500 } } };
		await restore();
		expect(reopen).toHaveBeenCalledWith("camp:c1:h1");
		expect(app.render).toHaveBeenCalledWith(true, { left: 10, top: 20, width: 900, height: 500, restored: true });
	});

	it("stays shut when its kind declines it, or fails, and the sheets still come back", async () => {
		const { registerRestorableWindow } = await import("../../module/utils/window-restore.js");
		class OtherWindow {}
		registerRestorableWindow(CampWindow, "camp", () => null);
		registerRestorableWindow(OtherWindow, "other", () => { throw new Error("boom"); });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const sheet = fakeSheet({ uuid: "Actor.pc" });
		settings.openWindowsState = { w1: {
			"camp:over:h1": { left: 1, top: 1 },
			"other:x":      { left: 1, top: 1 },
			"Actor.pc":     { left: 2, top: 2 },
		} };
		await restore();
		expect(sheet.render).toHaveBeenCalled();
		warn.mockRestore();
	});

	// A key of a kind nobody registered (a module since removed, say) is looked up as a uuid, finds
	// no document, and is stepped over like any other window that is gone.
	it("steps over a key of a kind nobody registered", async () => {
		const sheet = fakeSheet({ uuid: "Actor.pc" });
		settings.openWindowsState = { w1: { "gone:x": { left: 1, top: 1 }, "Actor.pc": { left: 2, top: 2 } } };
		await restore();
		expect(sheet.render).toHaveBeenCalled();
	});
});
