// The GM Toolkit's Relationship Maps tab: a list of the world's maps, and the way to make another.
//
// NOT A GmBundleTab, unlike Encounters and Expeditions beside it. Those two gather PREP that lives
// on the toolkit actor, as rows in `system.*`. A relationship map is a JournalEntry of its own,
// owned by the whole table (relmap/relmap-doc.js), and the toolkit actor is GM-only — so nothing
// about a map can live here. This tab is a list and two buttons over documents that exist
// elsewhere, which is why it has no schema, no drag type and no normalizer.
//
// WHICH ALSO MEANS IT HAS NO STORE TO FLUSH. The three-method shape its neighbours follow is
// context / listeners / flush; there is nothing being typed here, so there is no third method.

import { format, localize } from "../../utils/i18n.js";
import { promptForText } from "../../dialogs/content-picker.js";
import { openRelationshipMap } from "../../dialogs/RelationshipMapWindow.js";
import {
	canCreateRelationshipMap, createRelationshipMap, listRelationshipMaps,
	relationshipMapPageCount, relationshipMapSize,
} from "../../relmap/relmap-doc.js";

/** Ask for a name, then make the map and open it. */
async function newMap(sheet) {
	const name = await promptForName();
	if (name === null) return;
	const made = await createRelationshipMap(name || localize("stonetop.relmap.maps.newPlaceholder"));
	if (!made) return;
	openRelationshipMap(made);
	sheet.render(false);
}

/**
 * One text field in a dialog.
 *
 * ⚠ THROUGH THE SHARED PROMPT, and that is not tidiness. This function used to build the window
 * itself and set `className` on the element it handed DialogV2 as its content — which core refuses
 * outright (`config.content element must have no attributes`), from inside the constructor, as an
 * unhandled rejection. So this button was DEAD from the day it shipped: pressing "New map" did
 * nothing at all, with the error only visible in the console. `promptForText` is the one place that
 * knows the rule; see dialogs/content-picker.js.
 */
async function promptForName() {
	return promptForText({
		title: localize("stonetop.relmap.maps.newTitle"),
		buttonLabel: localize("stonetop.relmap.maps.newMap"),
		placeholder: localize("stonetop.relmap.maps.newPlaceholder"),
	});
}

export function withGmRelationshipMapsTab(Base) {
	return class GmRelationshipMapsTab extends Base {
		/**
		 * The tab's context.
		 *
		 * Read live off the world's journals every render rather than cached: a map can be made,
		 * renamed or deleted from the sidebar while this sheet is open, and a cache would go stale
		 * with nothing to invalidate it.
		 *
		 * `canCreate` is the honest half of the permission story. Editing a map needs only OWNER,
		 * which everyone has; making one needs the journal-create right, which a plain player does
		 * not. The button is hidden rather than disabled, and the note below the list says who can.
		 */
		_addGmRelationshipMapsContext(context) {
			const maps = listRelationshipMaps().map(entry => {
				// HOW MANY BOARDS, said only where there is more than one. A map is several named
				// pages now, and "3 pages" is the thing a GM scanning this list wants to know
				// about the one that has them; putting "1 page" beside every other row would bury
				// that under a column of noise. The people count stays what it always was: how
				// many DIFFERENT people are on the map, counted once each however many pages they
				// stand on (see `relationshipMapSize`).
				const pages = relationshipMapPageCount(entry);
				return {
					id: entry.id,
					name: entry.name,
					count: format("stonetop.relmap.maps.count", { count: relationshipMapSize(entry) }),
					pages: pages > 1 ? format("stonetop.relmap.maps.pageCount", { count: pages }) : "",
				};
			});
			context.stonetop ??= {};
			context.stonetop.relmaps = {
				maps,
				canCreate: canCreateRelationshipMap(),
				empty: !maps.length,
			};
			return context;
		}

		/**
		 * Delegated from the sheet root, so the buttons keep working across a re-render.
		 *
		 * Scoped to this tab's own panel: the toolkit prints similar card markup on three tabs, and
		 * an unscoped selector here would answer a click on an encounter card.
		 */
		_activateGmRelationshipMapsListeners(root) {
			const panel = root.querySelector?.(".tab.relmaps");
			if (!panel) return;
			panel.addEventListener("click", ev => {
				const open = ev.target.closest?.("[data-relmap-open-id]");
				if (open) {
					const entry = game.journal?.get?.(open.dataset.relmapOpenId);
					if (entry) openRelationshipMap(entry);
					return;
				}
				if (ev.target.closest?.("[data-relmap-new]")) newMap(this);
			});
		}
	};
}
