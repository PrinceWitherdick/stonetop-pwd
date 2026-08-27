// Author a reusable, draggable steading-improvement card. On create it lands as a card
// in the "Homebrew Steading Improvements" journal, which the GM drags onto any
// steading's Improvements tab. The steading-bound quick-add
// (StonetopSteadingSheet._onCreateImprovementOpen) stays for adding straight to the open
// steading; this one is the reusable path. Both are the same window now, differing only
// in where the finished definition is written: see dialogs/ImprovementBuilderDialog.js.
import { ImprovementBuilderDialog, improvementCardSaver } from "./ImprovementBuilderDialog.js";

/** Open the create-improvement dialog on the reusable-card path. */
export function openCreateImprovementDialog() {
	new ImprovementBuilderDialog(improvementCardSaver()).render(true);
}
