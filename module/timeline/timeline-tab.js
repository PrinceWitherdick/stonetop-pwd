// THE TIMELINE AS A TAB, ON EITHER SHEET.
//
// What renders there is a real TimelinePanel (dialogs/TimelinePanel.js), which is the window's own
// class mounted frameless. So the spine, the cards, the entry dialog, the single write path and the
// live sync are all the same code as the window, and there is nothing here to keep in step with it.
//
// ONE MODULE FOR BOTH SHEETS, unlike the relationship map's steading-only tab: the steading and
// every character carry this tab, and the only thing that differs between them is which track the
// sheet's own actor names -- which `trackForActor` already answers.
//
// The mount/move/detach/close lifecycle is `mountedPanelSlot` (utils/mounted-panel-slot.js), shared
// with the relationship map's tab; the AppV1 traps it steps around are stated there. What is left
// here is the timeline's own: which track, and where, and where the reader had got to in it.
//
// WHERE THEY HAD GOT TO SURVIVES A RELOAD. The pop-out is saved with its zoom and scroll by
// utils/window-restore.js (TimelineWindow#restoreView), but a panel has no frame and is skipped there;
// what comes back is its SHEET. So the sheet answers `restoreView` for its tab (`timelineTabView`),
// the reopening render hands it back (`holdTimelineTabView`), and the panel's first render takes it,
// whenever the reader next arrives on the tab.

import { TimelinePanel } from "../dialogs/TimelinePanel.js";
import { mountedPanelSlot } from "../utils/mounted-panel-slot.js";
import { trackForActor } from "./timeline-store.js";

/** The tab's `data-tab` key, and the class its panel wears. */
export const TIMELINE_TAB = "timeline";

/** Where the timeline is mounted inside that tab. */
const MOUNT_SEL = "[data-stonetop-timeline]";

/** The sheet field holding the view a reload handed back, until the tab's panel is built to take it. */
const HELD_VIEW = "_timelineTabView";

// NO `timelineTabContext` HERE, and there was one. The relationship map's tab needs a context
// because its markup carries an invitation for a world with no map; this one does not, because the
// panel IS the whole of the tab and answers "no page yet" and "nothing written yet" from its own
// getData, where the answer is already to hand. The context that stood here was computed on every
// render of every sheet, walked `game.journal` to do it, and nothing read it.

const slot = mountedPanelSlot({
	field:    "_timelinePanel",
	tab:      TIMELINE_TAB,
	mountSel: MOUNT_SEL,
	/** Build the panel, on the track this sheet's actor names. */
	build: (sheet, mount) => {
		const track = trackForActor(sheet?.actor);
		if (!track) return null;
		return new TimelinePanel(
			track,
			{ id: TimelinePanel.panelId(sheet.actor?.id ?? "actor") },
			mount,
		);
	},
	/** Its first render opens where a reload left it, and the view is the panel's from then on. */
	openOptions: (sheet) => {
		const view = sheet?.[HELD_VIEW];
		if (sheet) sheet[HELD_VIEW] = null;
		return view ? { view } : {};
	},
});

export const syncTimelineTab = slot.sync;
export const detachTimelineTab = slot.detach;
export const closeTimelineTab = slot.close;

/**
 * The sheet's `restoreView`: the tab's zoom and scroll, or the view a reload handed back and nobody has
 * opened the tab to take yet (a reader who reloads twice from another tab keeps it). Null for none.
 */
export function timelineTabView(sheet) {
	const view = sheet?._timelinePanel?.restoreView ?? sheet?.[HELD_VIEW] ?? null;
	return view ? { timeline: view } : null;
}

/** Keep the view a reopening render carried (`options.view`) for the tab's panel. Before `syncTimelineTab`. */
export function holdTimelineTabView(sheet, view) {
	if (sheet && view?.timeline && typeof view.timeline === "object") sheet[HELD_VIEW] = view.timeline;
}
