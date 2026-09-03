// The sheet a relationship map's JournalEntry opens as: a bouncer, not a window.
//
// WHY THIS EXISTS. Every map is a JournalEntry, so every map has a row in the Journal sidebar that
// every player can see and click. Left alone, that click opens Foundry's prose editor on an entry
// with no pages and a graph hidden in its flags — a blank window that looks like the map is broken.
//
// So the entry carries `flags.core.sheetClass` naming this class, and this class opens the real
// board (dialogs/RelationshipMapWindow.js) and closes itself without ever painting.
//
// WHY IT IS A SEPARATE CLASS FROM THE WINDOW. `DocumentSheetConfig.registerSheet` stores the class
// and core constructs it as `new cls(document, options)` — it has to be a DocumentSheet.
// RelationshipMapWindow is a StonetopDialog, which is a plain Application, so it cannot be
// registered and the two jobs cannot be one class.
//
// ⚠ THE CLASS NAME IS PART OF A CONTRACT. It is half of the registration id that
// `flags.core.sheetClass` stores on every map in every world, and the system-id migration rewrites
// that key (see tests/migration/finish.test.js). Renaming this class orphans every existing map
// onto Foundry's generic sheet, silently, with no error anywhere.

import { openRelationshipMap } from "../dialogs/RelationshipMapWindow.js";

/**
 * Built from the V1 base the caller resolves, rather than importing one.
 *
 * V13 ships both `foundry.appv1.sheets.JournalSheet` and the V2 `JournalEntrySheet`, and which of
 * them exists is a property of the core the world is running. stonetop.js already resolves the page
 * sheets' base this way; this follows it so there is one place that knows.
 */
export function createRelationshipMapEntrySheetClass(Base) {
	return class StonetopRelationshipMapSheet extends Base {
		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				classes: ["stonetop", "stonetop-relmap-bounce"],
				width: 420,
				height: 200,
			});
		}

		/**
		 * Open the board instead of rendering.
		 *
		 * `super._render` is never called, so nothing of this sheet is ever inserted into the
		 * document — which is what makes it a bouncer rather than a window that flashes. The close
		 * still runs, so core's own bookkeeping (the document's `_sheet`, the apps registry) is
		 * left tidy.
		 */
		async _render(_force, _options) {
			openRelationshipMap(this.document);
			// Not awaited inside the render: closing an Application from inside its own render is
			// how AppV1 gets left with a half-registered app. A task of its own lets this return
			// first. Its failure is swallowed on purpose — the board is already open, and a window
			// that could not close itself is not something to put in front of the reader.
			Promise.resolve()
				.then(() => this.close())
				.catch(err => console.warn("Stonetop | relationship map bouncer could not close", err));
		}
	};
}
