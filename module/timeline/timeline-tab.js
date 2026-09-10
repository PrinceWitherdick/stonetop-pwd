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
// here is the timeline's own: which track, and where.

import { TimelinePanel } from "../dialogs/TimelinePanel.js";
import { mountedPanelSlot } from "../utils/mounted-panel-slot.js";
import { trackForActor } from "./timeline-store.js";

/** The tab's `data-tab` key, and the class its panel wears. */
export const TIMELINE_TAB = "timeline";

/** Where the timeline is mounted inside that tab. */
const MOUNT_SEL = "[data-stonetop-timeline]";

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
});

export const syncTimelineTab = slot.sync;
export const detachTimelineTab = slot.detach;
export const closeTimelineTab = slot.close;
