// THE PREP TAB'S VIEW SWITCHER — Encounters, Expeditions and Sites, three panes behind one rail
// button on the GM Toolkit.
//
// WHY ONE BUTTON AND NOT THREE. Encounters and Expeditions are the same card over the same engine
// (gm-bundle-tab.js), and Sites had been folded in at the foot of Expeditions under a full card list,
// where a world with a season's worth of trips put it a long scroll from anywhere. Three rail buttons
// for what a GM thinks of as one job — getting tonight ready — spent the rail on a distinction the
// cards already draw, and the fold under Expeditions hid the one pane a trip is FOR. So the rail
// says "Prep" and the tab itself says which kind of prep.
//
// A SECOND CORE TAB GROUP, NOT A HANDLER OF OUR OWN. The sheet declares it as the second entry of
// its `tabs` option (StonetopGmToolkitSheet.js#defaultOptions), so AppV1 builds the controller once
// in the constructor and re-binds it on every render — and a `Tabs` controller keeps its `active`
// across those re-binds, which is exactly "the chosen view survives every re-render for as long as
// this sheet lives" without a field of ours to keep in step with it. It also means the window
// restore (utils/window-restore.js) puts the view back after a reload along with the rail tab, since
// it snapshots every group in `_tabs` by index. Nested groups are safe in core's controller: a panel
// whose `data-group` is not the controller's own is skipped when it toggles `active`, so the rail's
// group never touches these panes and this group never touches the rail's tabs.
//
// THE INDEX IS LOAD-BEARING, and that is why it is a named constant rather than a `1` typed in
// three places. Everything else in the system that asks "which tab" reads `_tabs[0]`
// (mounted-panel-slot.js, the sheets' own fallbacks), so the rail's group must stay first; and the
// window restore matches saved groups by position, so reordering the two would hand a saved rail
// tab to this switcher on the next reload.
//
// WHAT CORE DOES NOT DO is the ARIA half. Its controller toggles a class and nothing else, so the
// `aria-selected` / roving `tabindex` pair is put back here whenever the view changes without a
// render (`syncPrepSwitcher`, called from the sheet's `_onChangeTab`), and the arrow keys a tablist
// owes a keyboard user are wired here too (`wirePrepSwitcherKeys`). On a render both come out of
// `prepViewsContext`, so the markup is already right before core binds anything.
//
// Foundry-free, like gm-prep-masonry.js, so the unit tests and the offline sheet preview run the
// shipped code rather than a copy of it.
import { localize, format } from "../../utils/i18n.js";

/** Where the switcher's group sits in the sheet's `_tabs`. See the note above on why it is fixed. */
export const PREP_TAB_GROUP = 1;

/** The rail tab the three views sit under (gm-toolkit.hbs). */
export const PREP_RAIL_TAB = "prep";

/** The `data-group` the switcher and its three panes share. */
export const PREP_GROUP = "prep";

/** The switcher's nav, as the sheet's `tabs` option and the key handler both find it. */
export const PREP_SWITCHER_SELECTOR = ".stonetop-gm-prep-switcher";

/** The box the three panes sit in: the second group's `contentSelector`. */
export const PREP_PANES_SELECTOR = ".stonetop-gm-prep-panes";

/**
 * The three views, in switcher order. Encounters first because it is the one the tab opens on
 * (`initial` in the sheet's `tabs` option reads this list's head): it was the rail button the Prep
 * button replaced, and an encounter is the prep a GM makes every session rather than every trip.
 *
 * `countKey` names the pill's tooltip. Each says what the number COUNTS rather than repeating the
 * noun, because the label beside it already says "Encounters" and the count is the only new fact.
 */
export const PREP_VIEWS = Object.freeze([
	Object.freeze({ key: "encounters",  labelKey: "stonetop.gmToolkit.tabs.encounters",  countKey: "stonetop.gmToolkit.prep.countEncounters" }),
	Object.freeze({ key: "expeditions", labelKey: "stonetop.gmToolkit.tabs.expeditions", countKey: "stonetop.gmToolkit.prep.countExpeditions" }),
	Object.freeze({ key: "sites",       labelKey: "stonetop.gmToolkit.tabs.sites",       countKey: "stonetop.gmToolkit.prep.countSites" }),
]);

/** The view the Prep tab opens on. */
export const PREP_INITIAL_VIEW = PREP_VIEWS[0].key;

/**
 * How many things each view holds right now, off a context the three builders have already filled.
 *
 * LIVE ones only for the two bundle tabs: a completed encounter is history, filed into the fold at
 * the foot of its pane, and a pill that counted it would tell a GM there was more still to run than
 * there is. Every site counts, because a site has no "done" — it is a place, and it is still there
 * after the party has been.
 *
 * Read off the context rather than off the actor, so the number is the one the pane under it was
 * drawn from. A structural write re-renders the sheet, which re-runs this.
 */
export function prepViewCounts(stonetop = {}) {
	return {
		encounters:  stonetop.encounters?.active?.length ?? 0,
		expeditions: stonetop.expeditions?.active?.length ?? 0,
		sites:       stonetop.sites?.length ?? 0,
	};
}

/**
 * Everything the switcher and its panes print, for the view `active` on a sheet with DOM id
 * `idBase`.
 *
 * `views` is the nav, in order. `panes` is the same three keyed by view, so each pane's partial can
 * name its own entry without walking a list for it.
 *
 * The ids are prefixed with the APPLICATION'S id, not the actor's, because they have to be unique in
 * the document and a GM can have the toolkit open twice through two windows on one actor.
 *
 * `introOpen` is the set of views whose pane-bar "?" the GM has opened (`wirePrepIntros`), so a
 * repaint draws the full intro open where it was left open. Absent, every intro is drawn shut.
 *
 * An unknown `active` falls back to the first view, which is also what core's controller does with
 * a name its nav does not carry — so the two cannot disagree about which pane is showing.
 */
export function prepViewsContext(stonetop, active, idBase = "stonetop-gm-toolkit", introOpen = null) {
	const current = PREP_VIEWS.some(v => v.key === active) ? active : PREP_INITIAL_VIEW;
	const counts = prepViewCounts(stonetop);
	const views = PREP_VIEWS.map(view => {
		const count = counts[view.key];
		return {
			key:      view.key,
			label:    localize(view.labelKey),
			count,
			countTip: format(view.countKey, { count }),
			active:   view.key === current,
			tabId:    `${idBase}-prep-${view.key}-tab`,
			paneId:   `${idBase}-prep-${view.key}`,
		};
	});
	const panes = Object.fromEntries(views.map(v => [v.key, {
		key: v.key, id: v.paneId, tabId: v.tabId, active: v.active,
		introOpen: !!introOpen?.has?.(v.key),
	}]));
	return { views, panes, label: localize("stonetop.gmToolkit.prep.switcherLabel") };
}

/**
 * Put the ARIA state back after core's controller has switched views without a render.
 *
 * Core toggles `active` on the buttons and the panes and nothing else, so without this a screen
 * reader goes on announcing the old view as the selected one and Tab still lands on its button.
 * Roving `tabindex`: the selected button is the one stop in the tab order, and the arrow keys move
 * between the others (`wirePrepSwitcherKeys`).
 */
export function syncPrepSwitcher(nav, active) {
	if (!nav) return;
	for (const button of nav.querySelectorAll("[data-tab]")) {
		const on = button.dataset.tab === active;
		button.setAttribute("aria-selected", on ? "true" : "false");
		button.setAttribute("tabindex", on ? "0" : "-1");
	}
}

/**
 * The arrow keys a tablist owes a keyboard user: Left/Right step (and wrap), Home/End jump.
 *
 * SELECTION FOLLOWS FOCUS, the automatic pattern, because a view switch here costs nothing — it is a
 * class flip on three panes already in the DOM, not a render — so there is no reason to make a GM
 * press Enter on a view they have already arrived at. Enter and Space still work: the segments are
 * real buttons, and core's own click handler takes them from there.
 *
 * `activate(name)` is handed in rather than the sheet, so this stays free of AppV1 and the tests can
 * drive it with a plain function.
 */
export function wirePrepSwitcherKeys(root, activate) {
	const nav = root?.querySelector?.(PREP_SWITCHER_SELECTOR);
	if (!nav) return;
	nav.addEventListener("keydown", (ev) => {
		const buttons = [...nav.querySelectorAll("[data-tab]")];
		const from = buttons.indexOf(ev.target.closest?.("[data-tab]"));
		if (from < 0) return;
		let to;
		if (ev.key === "ArrowRight") to = (from + 1) % buttons.length;
		else if (ev.key === "ArrowLeft") to = (from - 1 + buttons.length) % buttons.length;
		else if (ev.key === "Home") to = 0;
		else if (ev.key === "End") to = buttons.length - 1;
		else return;
		ev.preventDefault();
		const next = buttons[to];
		next.focus();
		activate(next.dataset.tab);
	});
}

/** The pane bar's "?" (gm-prep-pane-bar.hbs). */
export const PREP_INTRO_TOGGLE_SELECTOR = ".stonetop-gm-pane-help";

/**
 * The pane bar's "?": show or hide the view's full intro under its one-line lead, in place.
 *
 * A DISCLOSURE AND NOT A TOOLTIP, because core's tooltip opens on pointerenter and nothing else: a
 * keyboard user tabbing onto the old lead saw nothing, and a screen reader heard only the lead. A
 * button with `aria-expanded` over a paragraph it `aria-controls` is reachable by every one of them.
 *
 * A CLASS-AND-ATTRIBUTE FLIP, NEVER A RENDER, like the card carets: the intro is in the markup
 * already, `hidden` until asked for. What is kept is the CHOICE, in `open` (a Set of view keys the
 * sheet holds for its lifetime and hands back to `prepViewsContext`), so the sheet's frequent
 * repaints draw it the way the GM left it instead of snapping it shut mid-sentence.
 *
 * Delegated on the sheet's root, re-bound every render with the root it is handed, so nothing
 * outlives the markup it listens to.
 */
export function wirePrepIntros(root, open) {
	if (!root?.addEventListener) return;
	root.addEventListener("click", (ev) => {
		const button = ev.target?.closest?.(PREP_INTRO_TOGGLE_SELECTOR);
		if (!button || !root.contains(button)) return;
		ev.preventDefault();
		const intro = button.closest(".stonetop-gm-pane-bar")?.querySelector(".stonetop-gm-pane-intro");
		if (!intro) return;
		const show = button.getAttribute("aria-expanded") !== "true";
		button.setAttribute("aria-expanded", show ? "true" : "false");
		intro.hidden = !show;
		const view = button.dataset.prepIntro;
		if (view && open) {
			if (show) open.add(view); else open.delete(view);
		}
	});
}
