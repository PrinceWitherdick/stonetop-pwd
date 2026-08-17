// Reopen document sheets (characters, steadings, monsters, items, journals) in the
// same place — and the same state — they were in when this client last reloaded. Foundry
// doesn't restore open windows across a refresh, so we keep a live registry of the open
// document sheets, persist a snapshot (geometry, active tab, edit/lock mode) to a
// per-client setting, and re-render each one on ready from that snapshot.
//
// Scope is deliberately narrow: only actual document sheets (things resolvable by uuid
// and re-openable via `doc.sheet`). Transient dialogs — the level-up wizard, the
// introductions walkthrough, pickers — are NOT tracked here: reopening a half-finished
// wizard is worse than not, and the session-zero walkthroughs already have their own
// reload-resume path (dialogs/walkthrough-resume.js).
//
// Per-client on purpose: window layout is personal, not shared world state (mirrors the
// existing `characterSheetWidths` client setting). Defaults on; the "Restore Open
// Windows on Reload" client setting turns it off.

import { getSetting } from "../settings.js";
import { SYSTEM_ID } from "../system-id.js";

const STATE_SETTING = "openWindowsState";
const TOGGLE_SETTING = "restoreWindowsOnReload";

// The render/close hook pairs we watch. Actor covers character / steading / monster
// sheets; Item covers gear and the arcanum sheet; the Journal pairs cover both the v12
// (`JournalSheet`) and v13+ (`JournalEntrySheet`) entry-sheet class names. Each render
// hook fires for the whole sheet-class inheritance chain, so one entry per base class
// catches every subclass.
const HOOK_PAIRS = [
	["renderActorSheet",        "closeActorSheet"],
	["renderItemSheet",         "closeItemSheet"],
	["renderJournalSheet",        "closeJournalSheet"],
	["renderJournalEntrySheet",   "closeJournalEntrySheet"],
];

// Live registry of currently-open tracked sheets, keyed by document uuid → app. We read
// each app's LIVE position at persist time (a window that's been dragged/resized never
// re-renders, so the render-time position would be stale).
const _openApps = new Map();
let _saveTimer = null;

// uuid → saved active-tab array, staged by restoreOpenWindows just before it re-renders a
// sheet. Consumed once by _onRender (the render hook fires after `_tabs` is bound to the
// DOM at its initial tab), which then activates the saved tab over the default.
const _pendingTabs = new Map();

// Whether an app is a document sheet we can persist and later reopen: it must expose a
// world document (not a compendium entry — those aren't re-openable from a stored uuid
// the same way) with a stable uuid. This naturally excludes our FormApplication dialogs,
// which have no `.document`.
function _trackedDoc(app) {
	const doc = app?.document;
	if (!doc?.uuid) return null;
	if (doc.pack) return null;            // compendium entry — skip
	return doc;
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

// A {left, top, width, height} snapshot of an app's current window geometry, plus its
// minimized state, active tab(s), and edit/lock mode, or null if it isn't positioned yet.
// Only finite numbers are kept, so an auto-height window (height: "auto") stores no height
// and reopens auto-sized.
function _snapshotPosition(app) {
	const p = app?.position ?? {};
	const out = {};
	for (const key of ["left", "top", "width", "height"]) {
		if (Number.isFinite(p[key])) out[key] = Math.round(p[key]);
	}
	if (out.left === undefined && out.top === undefined) return null;
	// ApplicationV2 exposes a public `minimized`; AppV1 uses the private `_minimized`.
	if (app.minimized ?? app._minimized) out.minimized = true;
	const tabs = _snapshotTabs(app);
	if (tabs) out.tabs = tabs;
	// Store both states, not just `true`: a sheet the user deliberately LOCKED must reopen
	// locked even when the "Open Sheets in Edit Mode" client setting would default it open.
	if (_hasEditMode(app)) out.editMode = app._editMode;
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

// Build the full persisted map from the live registry: uuid → geometry for every open
// tracked sheet. Drops any that have since lost their document or position.
function _collectState() {
	const state = {};
	for (const [uuid, app] of _openApps) {
		const pos = _snapshotPosition(app);
		if (pos) state[uuid] = pos;
	}
	return state;
}

// Persist the current registry to the client setting. Debounced: dragging/resizing and
// bursts of re-renders shouldn't hammer the setting. A synchronous flush on page unload
// (below) captures the final positions the debounce might not have written yet.
function _schedulePersist() {
	if (!getSetting(TOGGLE_SETTING)) return;
	clearTimeout(_saveTimer);
	_saveTimer = setTimeout(() => {
		game.settings.set(SYSTEM_ID, STATE_SETTING, _collectState()).catch(() => {});
	}, 500);
}

// Synchronous final write, called from beforeunload. Client settings persist to
// localStorage, so the write lands even as the page tears down.
function _flushNow() {
	if (!getSetting(TOGGLE_SETTING)) return;
	try {
		game.settings.set(SYSTEM_ID, STATE_SETTING, _collectState());
	} catch (_err) { /* nothing we can do mid-unload */ }
}

// Activate the saved active tab(s) on an AppV1 sheet, matched to `_tabs` by index. No-op
// for a tab already on the saved name (skips a redundant DOM shuffle), and safe when the
// sheet has fewer tab groups than were saved.
function _applyTabs(app, tabs) {
	if (!Array.isArray(tabs)) return;
	const groups = app?._tabs;
	if (!Array.isArray(groups)) return;
	tabs.forEach((name, idx) => {
		const group = groups[idx];
		if (name && group && group.active !== name) group.activate?.(name);
	});
}

function _onRender(app) {
	const doc = _trackedDoc(app);
	if (!doc) return;
	_openApps.set(doc.uuid, app);
	const pending = _pendingTabs.get(doc.uuid);
	if (pending) {
		_pendingTabs.delete(doc.uuid);
		_applyTabs(app, pending);
	}
	_schedulePersist();
}

function _onClose(app) {
	const doc = _trackedDoc(app);
	if (!doc) return;
	_openApps.delete(doc.uuid);
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

// Reopen every saved sheet at its stored geometry. Runs on ready; no-op when the toggle
// is off or nothing was saved. Renders are staggered so a dozen sheets don't all fight
// for focus (and layout) in the same frame, and each is permission-checked so a player
// never trips a "you don't have permission" error on a sheet they can no longer view.
export async function restoreOpenWindows() {
	if (!getSetting(TOGGLE_SETTING)) return;
	const state = getSetting(STATE_SETTING) ?? {};
	const uuids = Object.keys(state);
	if (!uuids.length) return;

	let i = 0;
	for (const uuid of uuids) {
		let doc;
		try { doc = await fromUuid(uuid); }
		catch (_err) { doc = null; }
		if (!doc) continue;
		// Need at least limited view permission to open a sheet.
		if (doc.testUserPermission && !doc.testUserPermission(game.user, "LIMITED")) continue;
		const sheet = doc.sheet;
		if (!sheet) continue;

		const saved = state[uuid];
		const pos = _clampToViewport(saved);
		const delay = i++ * 120;
		setTimeout(() => {
			try {
				// Stage the saved tab so the render hook (fired once _tabs is bound) switches
				// off the sheet's default tab. Set right before render so it's live when the
				// hook lands, and consumed once so a later data re-render can't re-force it.
				if (Array.isArray(saved.tabs)) _pendingTabs.set(uuid, saved.tabs);
				_applyEditMode(sheet, saved.editMode);
				const geom = { left: pos.left, top: pos.top, width: pos.width, height: pos.height };
				if (_isAppV2(sheet)) sheet.render({ force: true, position: geom });
				else sheet.render(true, geom);
				if (saved.minimized) sheet.minimize?.();
			} catch (err) {
				console.warn("Stonetop | Could not restore window", uuid, err);
			}
		}, delay);
	}
}

// Wire the render/close tracking hooks and the unload flush. Called from the init hook.
// Restoration itself is registered here as a one-shot ready hook so this stays a single
// self-contained install call.
export function installWindowRestore() {
	for (const [renderHook, closeHook] of HOOK_PAIRS) {
		Hooks.on(renderHook, (app) => _onRender(app));
		Hooks.on(closeHook,  (app) => _onClose(app));
	}
	window.addEventListener("beforeunload", _flushNow);
	Hooks.once("ready", () => restoreOpenWindows());
}
