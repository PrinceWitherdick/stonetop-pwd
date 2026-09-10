// Sheet for the "timeline" JournalEntryPage subtype: one track's thread, read back as a page.
//
// READ ONLY, deliberately. Every way of CHANGING a timeline goes through the entry dialog on the
// sheet tab or the aggregate window, which is where the date picker and the place list live; a
// second editor here would be a second place that knows the entry shape, and the one thing a
// journal page is for that the tab is not is being read -- shared with the table, printed, opened on
// a phone. So this renders the same view model the tab draws and offers no controls.
//
// The bodies are enriched, so the @UUID links an entry carries back to an NPC, a site or a location
// resolve here exactly as they do on the sheet.
import { buildTrackVM, enrichTrackVM } from "../timeline/timeline-view.js";
import { sortEntries } from "../timeline/timeline-core.js";

export function createStonetopTimelinePageSheetClass(Base) {
	return class StonetopTimelinePageSheet extends Base {
		static get defaultOptions() {
			return foundry.utils.mergeObject(super.defaultOptions, {
				classes: ["stonetop", "sheet", "journal-entry-page", "stonetop-timeline-page"],
				width:   720,
				height:  800,
			});
		}

		get template() {
			return "systems/stonetop-pwd/templates/journal/timeline-page.hbs";
		}

		// Rendered with `editable: false` in the embedded view, and there is nothing to disable
		// anyway: the read markup carries no inputs. Suppressing FormApplication's blanket lockdown
		// keeps it from walking a tree that has no fields in it.
		_disableFields(_form) {}

		async getData(options = {}) {
			const context = await super.getData(options);
			const vm = buildTrackVM({
				trackId: this.document.system?.trackId ?? "",
				name:    this.document.name,
				entries: sortEntries(this.document.system?.entries ?? []),
			});

			// Enriched in place rather than inside buildTrackVM, and by the same walker the window
			// uses: the view model is pure so the tab and the window can build it without awaiting
			// anything, and enrichment is both async and Foundry-only.
			context.stonetop = { timeline: await enrichTrackVM(vm) };
			return context;
		}

		activateListeners(html) {
			super.activateListeners(html);
			// The embedded view is rendered by the journal, which never sets `_element`; point it at
			// our root so anything querying this sheet works in both modes. Same line, same reason,
			// as the location page sheet.
			this._element = html;
		}
	};
}
