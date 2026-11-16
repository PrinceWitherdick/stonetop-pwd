// A timeline entry being written, reopened after a reload where it was left (utils/window-restore.js):
// the date, the title, the place, the account and the tag, as typed. An account of a whole session
// can be a good deal of typing, and it lives only in the dialog until Save.
//
// Registered by name from this small module (utils/window-restore.js#registerRestorableWindow says
// why); tests/dialogs/timeline-entry-restore.test.js holds this name and the class's own together.
//
// The timeline that opened the dialog awaited its answer and wrote it; a reload drops that, so the
// dialog carries where the answer goes (its thread, and the entry an edit is of) and writes it itself
// (TimelineEntryDialog#_save, through timeline-entry-write.js). A dialog opened without that is never
// saved for a reload at all.

import { registerRestorableWindow, restoreKeyRest } from "../utils/window-restore.js";
import { isTimelineShown } from "../settings.js";

export const TIMELINE_ENTRY_RESTORE_KIND = "timelineEntry";
export const TIMELINE_ENTRY_WINDOW_CLASS = "TimelineEntryDialog";

/**
 * The entry dialog a reload brings back, unrendered, or null: another kind's key, or a world that has
 * the timeline switched off since. Anyone may write on a thread they own, so there is nothing else to
 * ask here; the thread and the entry are checked when the saved view goes on (an edit whose entry has
 * gone stays shut), and a write the journal refuses is said when Save is pressed.
 */
export async function reopenTimelineEntry(key) {
	const restoreId = restoreKeyRest(key, TIMELINE_ENTRY_RESTORE_KIND);
	if (restoreId === null) return null;
	if (!restoreId || !isTimelineShown()) return null;
	const { TimelineEntryDialog } = await import("./TimelineEntryDialog.js");
	return new TimelineEntryDialog({ restoreId });
}

/** Registered once, at module scope in stonetop.js. */
export function registerTimelineEntryRestore() {
	registerRestorableWindow({ name: TIMELINE_ENTRY_WINDOW_CLASS }, TIMELINE_ENTRY_RESTORE_KIND, reopenTimelineEntry);
}
