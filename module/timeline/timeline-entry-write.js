// WRITING ONE TYPED ENTRY ONTO A THREAD.
//
// What the timeline window does with the entry dialog's answer, in one place, because two windows do
// it: the timeline that awaited the dialog, and the dialog itself when a reload brought it back
// without that timeline (TimelineEntryDialog#_save). Two writers would drift, and the second one is
// only ever exercised after a reload, which is exactly where a drift would go unseen.
//
// `target` is plain data so it can ride through a reload: the thread as `mutateTrack` needs it (the
// timeline window's `_trackDescriptor`) and, for an edit, the entry's id.

import { mutateTrack } from "./timeline-store.js";
import { addEntry, patchEntry } from "./timeline-core.js";

/**
 * Write the dialog's answer: a new entry appended to its season, or an edit patched onto its entry.
 * Throws what `mutateTrack` throws; the caller says it to the reader.
 *
 * @param {{track: {trackId: string, trackKind?: string, name?: string}, entryId?: string}} target
 * @param {object} input  what promptForTimelineEntry resolved with
 */
export function writeTimelineEntry(target, input) {
	if (target?.entryId) {
		return mutateTrack(target.track, entries => patchEntry(entries, target.entryId, input));
	}
	return mutateTrack(target.track, entries => addEntry(entries, {
		...input,
		source:    "hand",
		createdAt: Date.now(),
		authorId:  game.user?.id ?? "",
	}, foundry.utils.randomID), { create: true });
}
