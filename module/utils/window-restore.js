// Reopen document sheets (characters, steadings, monsters, items, journals) in the
// same place — and the same state — they were in when this client last reloaded. Foundry
// doesn't restore open windows across a refresh, so we keep a live registry of the open
// document sheets, persist a snapshot (geometry, active tab, edit/lock mode) to a
// per-client setting, and re-render each one on ready from that snapshot.
//
// Scope is deliberately narrow: only windows over a document (things resolvable by uuid
// and re-openable via `doc.sheet`), plus the few windows over something else that register
// a kind of their own (registerRestorableWindow, below). Transient dialogs — the level-up
// wizard, the introductions walkthrough, pickers — are NOT tracked here: reopening a
// half-finished wizard is worse than not, and the session-zero walkthroughs already have
// their own reload-resume path (dialogs/walkthrough-resume.js). The one wizard that is,
// Create a Site, is GM prep a table writes over a whole evening and asked to come back
// (sites/create-site-restore.js); it saves its answers in `restoreView`.
//
// Per-client on purpose: window layout is personal, not shared world state (mirrors the
// existing `characterSheetWidths` client setting). Defaults on; the "Restore Open
// Windows on Reload" client setting turns it off.
//
// ⚠ AND NESTED UNDER THE WORLD ID, which a client setting has to do for itself (relmap/relmap-last.js
// says why): it lives in localStorage under `namespace.key` alone, shared by every world this browser
// opens, and every save writes the whole record. Kept flat, a GM who left sheets open in one world and
// spent an evening in another came back to nothing, because the second world's first save wrote its
// own list over the first world's -- and a world copied from another, with the same document ids,
// reopened the other world's windows. The snapshot for each window is unchanged; only the record
// holding them is keyed by world.

import { getObjectSetting, getSetting, worldKey } from "../settings.js";
import { SYSTEM_ID } from "../system-id.js";
import { openApplications } from "./open-windows.js";

const STATE_SETTING = "openWindowsState";
const TOGGLE_SETTING = "restoreWindowsOnReload";

// The render/close hook pairs we watch. Actor covers character / steading / monster
// sheets; Item covers gear and the arcanum sheet; the Journal pairs cover both the v12
// (`JournalSheet`) and v13+ (`JournalEntrySheet`) entry-sheet class names. Each render
// hook fires for the whole sheet-class inheritance chain, so one entry per base class
// catches every subclass.
//
// The relationship map board is the one window here that is not a DocumentSheet. It earns its
// place: it is a window over a JournalEntry, it is opened from that entry's sidebar row like any
// sheet, and a table leaves it open for a whole session. It is a StonetopDialog only because a
// class cannot be both a registered sheet and a plain Application, so it exposes `document` and is
// reopened through `doc.sheet` — the bouncer sheet, which forwards the geometry to the board
// (journal/RelationshipMapEntrySheet.js).
// Exported so the hook names can be checked against the class that fires them: AppV1 builds a
// render hook out of `constructor.name`, so a rename of the board would stop it being restored
// with no error anywhere (tests/utils/window-restore.test.js holds the two together).
export const RELMAP_WINDOW_CLASS = "RelationshipMapWindow";

// Every pair registered by kind (registerRestorableWindow) joins this list.
const HOOK_PAIRS = [
	["renderActorSheet",        "closeActorSheet"],
	["renderItemSheet",         "closeItemSheet"],
	["renderJournalSheet",        "closeJournalSheet"],
	["renderJournalEntrySheet",   "closeJournalEntrySheet"],
	[`render${RELMAP_WINDOW_CLASS}`, `close${RELMAP_WINDOW_CLASS}`],
];

// WINDOWS OVER NO DOCUMENT, reopened by a kind of their own. The shared Make Camp window is one: its
// camp lives in a flag on every character at the fire, not in any document a uuid could name, and a
// table keeps it open through a whole scene. Such a window says its own key by name (`restoreKey`,
// "<kind>:<rest>"), the way the board says its page, and the module that owns the window registers
// the kind with the function that mints the window again from that key. Registered rather than
// imported, so this file never reaches into the modules whose windows it restores.
//
// A uuid never holds a colon, so a key that does is a kind's, and one that does not is a uuid.
const _reopeners = new Map();   // kind -> (key) => an unrendered window to reopen, or null
let _installed = false;

function _kindOf(key) {
	const at = key.indexOf(":");
	return at > 0 ? key.slice(0, at) : null;
}

// Restore the windows of `windowClass` from a key rather than a document: watch the class's own
// render and close hooks, and on the next ready hand each saved key of `kind` to `reopen`, which
// answers with the window to render where it was, or null for one that should not come back. The
// class itself is passed, never a spelling of its name, because AppV1 names the hooks after
// `constructor.name`. Safe to call before or after installWindowRestore.
export function registerRestorableWindow(windowClass, kind, reopen) {
	_reopeners.set(kind, reopen);
	const pair = [`render${windowClass.name}`, `close${windowClass.name}`];
	HOOK_PAIRS.push(pair);
	if (_installed) _watchPair(pair);
}

// Live registry of currently-open tracked windows, keyed by document uuid (or a kind's own key) →
// app. We read each app's LIVE position at persist time (a window that's been dragged/resized never
// re-renders, so the render-time position would be stale).
const _openApps = new Map();
let _saveTimer = null;

// key → saved active-tab array, staged by restoreOpenWindows just before it re-renders a
// sheet. Consumed once by _onRender (the render hook fires after `_tabs` is bound to the
// DOM at its initial tab), which then activates the saved tab over the default.
const _pendingTabs = new Map();

// The restore in flight: which reopened windows have yet to report a render, and the order to
// stack them in once they all have. See restoreOpenWindows for why the stack is put back last.
let _restack = null;

// How long past the last staggered render to wait for stragglers before restacking whatever did
// open. A sheet whose render threw never fires its hook, and it must not hold the others down.
const RESTACK_GRACE_MS = 3000;

// The reopened windows still to land when the restack stood down early (a click, or the grace above
// running out), and the saved stack to slot each one into when it does. See _slotLate.
let _late = null;

// How long a window can still land late and be slotted. Past this it opens wherever core puts it.
const LATE_GRACE_MS = 30000;

// The key an app is persisted and later reopened under, or null for a window this does not restore.
// A window of a registered kind names its own. A document sheet is keyed by its document's uuid: it
// must expose a world document (not a compendium entry — those aren't re-openable from a stored uuid
// the same way) with a stable uuid. This naturally excludes our FormApplication dialogs, which have
// neither.
function _trackKey(app) {
	// ⚠ AND NOT A BOARD MOUNTED INSIDE SOMEBODY ELSE'S SHEET. AppV1 builds its render hook out of
	// every class name in the inheritance chain, so a frameless subclass of a tracked window fires
	// the parent's hook too: the relationship map's steading-sheet panel
	// (dialogs/RelationshipMapPanel.js) raises `renderRelationshipMapWindow` exactly as the window
	// does. Left tracked it would take the map's uuid in the registry, evicting the real window on
	// the same map, and on the next reload it would be reopened as a floating window nobody asked
	// for. There is nothing to restore about a panel in any case: where it was is wherever its host
	// sheet is, and the host is restored on its own account.
	if (app?.popOut === false) return null;
	const key = app?.restoreKey;
	if (typeof key === "string" && _reopeners.has(_kindOf(key))) return key;
	const doc = app?.document;
	if (!doc?.uuid) return null;
	if (doc.pack) return null;            // compendium entry — skip
	return doc.uuid;
}

// The active tab name(s) of an AppV1 sheet, in `_tabs` order, or null if it has no tab
// groups. Order is stable within a sheet class (tab groups are declared once in
// defaultOptions), so an index-keyed array restores reliably without depending on nav
// selectors. Tab switches don't re-render the sheet, so the live read at persist time
// (via the beforeunload flush) is what actually captures the tab the user ended on.
function _snapshotTabs(app) {
	const tabs = app?._tabs;
	if (!Array.isArray(tabs) || !tabs.length) return null;
	const active = tabs.map((t) => t?.active ?? null);
	return active.some(Boolean) ? active : null;
}

// Whether a sheet wears the Stonetop edit/lock mode at all (character, steading, NPC,
// monster, arcanum). Everything else — core sheets, journals — simply has no mode to save.
function _hasEditMode(app) {
	return typeof app?._editMode === "boolean";
}

/**
 * The finite numbers among a window's left, top, width and height, rounded. An auto-height window
 * (height: "auto") has no height here, so it reopens auto-sized. Also the Fight window's (fight/fight-window.js).
 */
export function finitePlace(position) {
	const out = {};
	for (const key of ["left", "top", "width", "height"]) {
		if (Number.isFinite(position?.[key])) out[key] = Math.round(position[key]);
	}
	return out;
}

// A {left, top, width, height} snapshot of an app's current window geometry (finitePlace), plus its
// minimized state, active tab(s), and edit/lock mode, or null if it isn't positioned yet.
function _snapshotPosition(app) {
	const p = app?.position ?? {};
	const out = finitePlace(p);
	if (out.left === undefined && out.top === undefined) return null;
	// Where it sat in the stack. Both application frameworks keep this current: every render and
	// every bring-to-front hands the window the next z-index, so a higher number is nearer the front.
	if (Number.isFinite(p.zIndex)) out.zIndex = p.zIndex;
	// ApplicationV2 exposes a public `minimized`; AppV1 uses the private `_minimized`.
	if (app.minimized ?? app._minimized) out.minimized = true;
	const tabs = _snapshotTabs(app);
	if (tabs) out.tabs = tabs;
	// Store both states, not just `true`: a sheet the user deliberately LOCKED must reopen
	// locked even when the "Open Sheets in Edit Mode" client setting would default it open.
	if (_hasEditMode(app)) out.editMode = app._editMode;
	// Which page of a multi-page window was up. The relationship map is the only window that
	// answers this: one map is several named boards, each a JournalEntryPage, and which one a
	// reader was on is as much a part of "where this window was" as its corner of the screen —
	// a table leaves that board open all session, and it is open ON something. Asked by name
	// rather than reached for, exactly as `document` is, because the board is not a
	// DocumentSheet and has no `_tabs` for `_snapshotTabs` above to find.
	if (typeof app?.restorePageId === "string") out.pageId = app.restorePageId;
	// Where the reader had got to INSIDE the window: the timeline's zoom and how far it was dragged.
	// Opaque here; the window names its own and reads it back from the render that reopens it. Read
	// live like the geometry, since scrolling and zooming never re-render.
	const view = app?.restoreView;
	if (view && typeof view === "object") out.view = view;
	return out;
}

// Put a restored sheet back into the mode it was left in, before its first render (the
// mode drives the template and context, so it has to land pre-render). Entering edit mode
// is skipped for a sheet this user can't edit — the toggle itself refuses that too.
function _applyEditMode(app, editMode) {
	if (typeof editMode !== "boolean" || !_hasEditMode(app)) return;
	if (editMode && app.isEditable === false) return;
	// The journal page sheets derive `_editMode` from a getter with no setter; assigning
	// there throws, and their mode follows the document's editability anyway.
	try { app._editMode = editMode; }
	catch (_err) { /* derived mode — nothing to restore */ }
}

// ApplicationV2 (v13+ journal entry sheets, and any future core-migrated sheet) takes
// geometry via `render({ position })`, not the AppV1 positional `render(force, {left,…})`.
function _isAppV2(app) {
	const V2 = foundry.applications?.api?.ApplicationV2;
	return !!(V2 && app instanceof V2);
}

// Build the full persisted map from the live registry: key → geometry for every open
// tracked window. Drops any that have since lost their document or position.
//
// Each window is read on its own: a `restoreView` reads a live form, and one that throws (a window
// halfway through closing) is left out of this save alone. Unguarded, it threw out of the whole
// collect, and every other open window lost its place and its typed work on the next reload.
function _collectState() {
	const state = {};
	for (const [key, app] of _openApps) {
		let pos;
		try { pos = _snapshotPosition(app); }
		catch (err) { console.warn(`Stonetop | couldn't save the window ${key} for a reload`, err); continue; }
		if (pos) state[key] = pos;
	}
	return state;
}

// A record saved before worlds were kept apart: the windows themselves, keyed by uuid. A uuid always
// has a dot in it and a world id never does, which is the whole of how the two are told apart.
const _isFlatKey = (key) => key.includes(".");

// Whether this world has taken a flat record as its own, by reopening a window from it.
//
// ⚠ UNTIL IT HAS, EVERY SAVE LEAVES THAT RECORD WHERE IT IS. It belongs to whichever world was open when
// it was written, and nothing in it says which. Dropped on the first save in any world, a GM who
// updated and then opened a different world first lost the first world's windows to that save, which
// is the very loss keying the record by world is for. A world that reopens nothing from it leaves it
// for the world it came from.
let _claimedFlat = false;

// This world's saved windows, and whether they came out of a flat record. A flat record is read as this
// world's own: any window in it that belonged to another world resolves to no document on the way back
// in, which `restoreOpenWindows` already steps over.
function _savedHere() {
	const all = getObjectSetting(STATE_SETTING);
	const mine = all[worldKey()];
	if (mine && typeof mine === "object" && !Array.isArray(mine)) return { state: mine, flat: false };
	return { state: Object.fromEntries(Object.entries(all).filter(([key]) => _isFlatKey(key))), flat: true };
}

// The whole record to write: every other world's windows as they were, and this world's as they are.
function _recordWithThisWorld() {
	const all = {};
	for (const [key, value] of Object.entries(getObjectSetting(STATE_SETTING))) {
		if (!_claimedFlat || !_isFlatKey(key)) all[key] = value;
	}
	all[worldKey()] = _collectState();
	return all;
}

// Persist the current registry to the client setting. Debounced: dragging/resizing and
// bursts of re-renders shouldn't hammer the setting. A synchronous flush on page unload
// (below) captures the final positions the debounce might not have written yet.
function _schedulePersist() {
	if (!getSetting(TOGGLE_SETTING)) return;
	clearTimeout(_saveTimer);
	_saveTimer = setTimeout(() => {
		game.settings.set(SYSTEM_ID, STATE_SETTING, _recordWithThisWorld()).catch(() => {});
	}, 500);
}

// For a window whose work lives in `restoreView` and changes without a render (a form being typed
// in): save soon, so the work survives a page that goes down without the unload flush below (a
// crashed tab or a killed app), not only a reload.
export function persistOpenWindowsSoon() {
	_schedulePersist();
}

// Synchronous final write, called from beforeunload. Client settings persist to
// localStorage, so the write lands even as the page tears down.
function _flushNow() {
	if (!getSetting(TOGGLE_SETTING)) return;
	try {
		game.settings.set(SYSTEM_ID, STATE_SETTING, _recordWithThisWorld());
	} catch (_err) { /* nothing we can do mid-unload */ }
}

// Activate the saved active tab(s) on an AppV1 sheet, matched to `_tabs` by index. No-op
// for a tab already on the saved name (skips a redundant DOM shuffle), and safe when the
// sheet has fewer tab groups than were saved. Skips a saved tab the sheet no longer draws (the GM
// switched the Timeline or Relationship Map off since): activating it would hide every tab body
// and leave the sheet blank.
function _applyTabs(app, tabs) {
	if (!Array.isArray(tabs)) return;
	const groups = app?._tabs;
	if (!Array.isArray(groups)) return;
	tabs.forEach((name, idx) => {
		const group = groups[idx];
		if (!name || !group || group.active === name) return;
		const nav = group._nav;
		if (nav?.querySelectorAll && ![...nav.querySelectorAll("[data-tab]")].some(el => el.dataset?.tab === name)) return;
		group.activate?.(name);
	});
}

function _onRender(app) {
	const key = _trackKey(app);
	if (!key) return;
	// A window whose key changed while open (a new homebrew playbook, saved, is keyed by its Item from
	// then on) is the same window: the key it had must not reopen a second copy of it after a reload.
	for (const [other, open] of _openApps) if (open === app && other !== key) _openApps.delete(other);
	_openApps.set(key, app);
	const pending = _pendingTabs.get(key);
	if (pending) {
		_pendingTabs.delete(key);
		_applyTabs(app, pending);
	}
	_settleRestack(key);
	if (_late?.waiting.delete(key)) {
		const late = _late;
		setTimeout(() => _slotLate(late, key, app), 0);
	}
	_schedulePersist();
}

// Count one reopened window as landed (rendered, or failed to), and put the stack back once the
// last one has. Held back while `scheduling`: a render that lands while a later lookup is still
// awaited must not read an empty wait list as "all done".
function _settleRestack(key) {
	const restack = _restack;
	if (restack?.waiting.delete(key) && !restack.waiting.size && !restack.scheduling) _finishRestackSoon(restack);
}

// ⚠ ONE TASK AFTER THE LAST RENDER HOOK, NOT IN IT. A window raises itself AFTER its render hook has
// run: core's `render(true)` defaults to `focus: true` and raises once the frame is drawn
// (appv1 `maximize().then(() => bringToTop())`), an ApplicationV2 does the same on `force`, and our
// dialogs raise in FrontOnOpen once `super._render` returns. All of those are chained straight off the
// render, so they have run by the next task. Restacked inside the hook, the last window to land put
// itself back on top afterwards: a GM toolkit saved at the back came back in front of everything.
function _finishRestackSoon(restack) {
	setTimeout(() => { if (_restack === restack) _finishRestack(); }, 0);
}

// What counts as the user taking the stack back while a restore is still landing.
const HANDOVER_EVENTS = ["pointerdown", "keydown"];

// Stand the restore in flight down, leaving the stack as it is: its straggler timer and its watch
// on the user's input both go. Any window still to land is handed to _slotLate. Hands back what was
// in flight, or null if nothing was.
function _endRestack() {
	const restack = _restack;
	_restack = null;
	if (!restack) return null;
	clearTimeout(restack.timer);
	for (const type of HANDOVER_EVENTS) window.removeEventListener(type, _onHandoverInput, true);
	// The SAME list and set, not copies: a click can come while restoreOpenWindows is still looking
	// windows up (Create a Site's code alone takes a moment to load), and every window it queues after
	// that is late too.
	if (restack.waiting.size || restack.scheduling) {
		clearTimeout(_late?.timer);
		const late = _late = { order: restack.order, waiting: restack.waiting, timer: null };
		late.timer = setTimeout(() => { if (_late === late) _late = null; }, LATE_GRACE_MS);
	}
	return restack;
}

// The element of a window of either framework (an AppV1 element is a jQuery set).
const _frameOf = (app) => (app?.element?.jquery ? app.element[0] : app?.element) ?? null;

// Where a framed, open window sits in the stack, or null for one that isn't stacked.
function _depthOf(app) {
	if (!app || app.rendered === false || app.popOut === false || app.hasFrame === false) return null;
	const z = app.position?.zIndex;
	return Number.isFinite(z) ? z : null;
}

function _setDepth(app, z) {
	app.position.zIndex = z;
	const el = _frameOf(app);
	if (el?.style) el.style.zIndex = String(z);
}

// A reopened window that landed after the restack stood down, put back where it was saved: directly
// beneath the lowest of the reopened windows that were saved in front of it. Every window at or above
// that depth moves up one to make room, so nothing else changes order, including a window the user
// opened or clicked forward while this one was still loading. With nothing saved in front of it, it
// was the front window and stays on top.
//
// Without this, every window still loading at the user's first click opened on top: the window left
// in front reopens FIRST, so it was the one buried under everything that came after.
function _slotLate(late, key, app) {
	const depth = _depthOf(app);
	if (depth === null) return;
	const at = late.order.findIndex((entry) => entry.key === key);
	const ahead = late.order.slice(at + 1).map(({ sheet }) => _depthOf(sheet)).filter((z) => z !== null);
	if (!ahead.length) return;
	const target = Math.min(...ahead);
	if (depth < target) return;
	let front = app;
	let frontDepth = target;
	for (const other of openApplications()) {
		const z = other === app ? null : _depthOf(other);
		if (z === null || z < target) continue;
		_setDepth(other, z + 1);
		if (z + 1 > frontDepth) { front = other; frontDepth = z + 1; }
	}
	_setDepth(app, target);
	// AppV1's bringToTop does nothing for `ui.activeWindow`, which is still the late window: left so,
	// a click on it would not bring it forward.
	if (globalThis.ui) ui.activeWindow = front;
}

// A click or key press while reopened windows are still landing. See restoreOpenWindows.
function _onHandoverInput() {
	_finishRestack();
}

// Put the reopened windows back in the stack they were saved in, back-most first, so the window
// that was in front ends in front. Only a z-index write per window, never a re-render. A window
// still to land is skipped here, and slotted into its place when it does (_slotLate).
function _finishRestack() {
	const restack = _endRestack();
	if (!restack) return;
	for (const { sheet } of restack.order) {
		if (sheet.rendered === false) continue;
		try { (sheet.bringToFront ?? sheet.bringToTop)?.call(sheet); }
		catch (_err) { /* a window mid-close keeps whatever depth it has */ }
	}
}

function _onClose(app) {
	const key = _trackKey(app);
	if (!key) return;
	_openApps.delete(key);
	_late?.waiting.delete(key);
	_schedulePersist();
}

// Clamp a stored position so a window saved at a larger resolution (or on another
// monitor) can't reopen off-screen. Keeps the whole window on screen when it fits, and
// at minimum keeps its title bar reachable.
function _clampToViewport(pos) {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const out = { ...pos };
	if (Number.isFinite(out.width))  out.width  = Math.min(out.width,  vw);
	if (Number.isFinite(out.height)) out.height = Math.min(out.height, vh);
	const w = Number.isFinite(out.width)  ? out.width  : 400;
	const h = Number.isFinite(out.height) ? out.height : 200;
	if (Number.isFinite(out.left)) out.left = Math.max(0, Math.min(out.left, vw - Math.min(w, vw)));
	if (Number.isFinite(out.top))  out.top  = Math.max(0, Math.min(out.top,  vh - Math.min(h, 40)));
	return out;
}

// The window a saved key reopens, or null. A registered kind mints its own and decides for itself
// whether it should come back. Anything else is a document's uuid, reopened through `doc.sheet`
// when this user may still view it, so a player never trips a "you don't have permission" error on
// a sheet they can no longer see.
async function _windowFor(key) {
	const reopen = _reopeners.get(_kindOf(key));
	if (reopen) {
		try { return (await reopen(key)) ?? null; }
		catch (err) {
			console.warn("Stonetop | Could not restore window", key, err);
			return null;
		}
	}
	let doc;
	try { doc = await fromUuid(key); }
	catch (_err) { doc = null; }
	if (!doc) return null;
	// Need at least limited view permission to open a sheet.
	if (doc.testUserPermission && !doc.testUserPermission(game.user, "LIMITED")) return null;
	return doc.sheet ?? null;
}

// Reopen every saved window at its stored geometry. Runs on ready; no-op when the toggle
// is off or nothing was saved. Renders are staggered so a dozen sheets don't all fight
// for focus (and layout) in the same frame, and each is checked first (_windowFor) so
// nothing reopens that this user can no longer see, or that has no reason to come back.
//
// FRONT-MOST FIRST. The stagger puts 120ms between one window and the next, so whichever opens
// last waits the longest, and saved order is only the order the windows were first opened in.
// A GM's big character sheet could come sixth behind five monster sheets and paint most of a
// second late -- the window they were actually looking at, and the page's largest paint.
// Every render lands on top of the stack, though, so opening front to back leaves the front
// window at the BACK; once every window has rendered, _finishRestack puts the saved stack back.
// A save from before `zIndex` was recorded has none, and keeps its saved order.
//
// UNLESS THE USER GETS THERE FIRST. One slow render can hold that restack back for seconds, and
// in the meantime the user opens a journal or clicks a sheet forward; raising every restored
// window after that buries what they just chose. So the first click or key press puts back
// whatever has landed so far, in the capture phase, before that input raises the window it is
// aimed at, and from then on the stack is theirs. A window that lands after that is slotted in
// beneath the reopened windows saved in front of it (_slotLate), not left on top.
export async function restoreOpenWindows() {
	if (!getSetting(TOGGLE_SETTING)) return;
	const { state, flat } = _savedHere();
	const depth = (key) => (Number.isFinite(state[key]?.zIndex) ? state[key].zIndex : -Infinity);
	const keys = Object.keys(state).sort((a, b) => depth(b) - depth(a));
	if (!keys.length) return;

	// `scheduling` holds the restack back until every window is queued (see _settleRestack).
	const restack = _restack = { waiting: new Set(), order: [], timer: null, scheduling: true };
	for (const type of HANDOVER_EVENTS) window.addEventListener(type, _onHandoverInput, true);

	let i = 0;
	for (const key of keys) {
		const sheet = await _windowFor(key);
		if (!sheet) continue;
		// A window reopened out of a flat record says whose that record was: this world's. See `_claimedFlat`.
		if (flat) _claimedFlat = true;

		const saved = state[key];
		const pos = _clampToViewport(saved);
		const delay = i++ * 120;
		// Queued front to back, so each lands at the head of the back-to-front restack order.
		restack.waiting.add(key);
		restack.order.unshift({ key, sheet });
		setTimeout(() => {
			try {
				// Stage the saved tab so the render hook (fired once _tabs is bound) switches
				// off the sheet's default tab. Set right before render so it's live when the
				// hook lands, and consumed once so a later data re-render can't re-force it.
				if (Array.isArray(saved.tabs)) _pendingTabs.set(key, saved.tabs);
				_applyEditMode(sheet, saved.editMode);
				const geom = { left: pos.left, top: pos.top, width: pos.width, height: pos.height };
				// The page a multi-page window was left on travels back in the SAME render
				// options the geometry does. That is not a shortcut: `pageId` is already core's
				// own option for "open this journal entry at this page", and the relationship
				// map's bouncer sheet forwards the whole options object to the board it opens
				// (journal/RelationshipMapEntrySheet.js), so the board is handed its page before
				// its first render rather than being switched to it afterwards — which the
				// reader would see as the wrong board painting and then jumping.
				if (saved.pageId) geom.pageId = saved.pageId;
				// And the view inside it, by the same road, so the first paint is already where the
				// reader left it rather than at the start and then jumping.
				if (saved.view && typeof saved.view === "object") geom.view = saved.view;
				// `restored` marks the render as this file's, not a reader's click, for a sheet that
				// would otherwise speak up: the relationship map's bouncer refuses a switched-off map
				// silently for a restore, where a click is told why (openRelationshipMap).
				if (_isAppV2(sheet)) sheet.render({ force: true, position: geom });
				else sheet.render(true, { ...geom, restored: true });
				if (saved.minimized) sheet.minimize?.();
			} catch (err) {
				console.warn("Stonetop | Could not restore window", key, err);
				_settleRestack(key);
			}
		}, delay);
	}

	restack.scheduling = false;
	if (_restack !== restack) return;
	if (!restack.order.length) { _endRestack(); return; }
	if (!restack.waiting.size) { _finishRestackSoon(restack); return; }
	restack.timer = setTimeout(() => {
		if (_restack === restack) _finishRestack();
	}, (i - 1) * 120 + RESTACK_GRACE_MS);
}

function _watchPair([renderHook, closeHook]) {
	Hooks.on(renderHook, (app) => _onRender(app));
	Hooks.on(closeHook,  (app) => _onClose(app));
}

// Wire the render/close tracking hooks and the unload flush. Called from the init hook.
// Restoration itself is registered here as a one-shot ready hook so this stays a single
// self-contained install call. A kind registered later has its hooks wired as it arrives.
export function installWindowRestore() {
	_installed = true;
	for (const pair of HOOK_PAIRS) _watchPair(pair);
	window.addEventListener("beforeunload", _flushNow);
	Hooks.once("ready", () => restoreOpenWindows());
}
