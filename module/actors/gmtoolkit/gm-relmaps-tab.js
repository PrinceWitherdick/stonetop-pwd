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
import { themedDialogClasses } from "../../utils/window-theme.js";
import { openRelationshipMap } from "../../dialogs/RelationshipMapWindow.js";
import {
	canCreateRelationshipMap, createRelationshipMap, listRelationshipMaps, relationshipMapSize,
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
 * DialogV2 rather than one of our own AppV1 windows, because that is what the rest of the system
 * reaches for when the whole question is one line (see dialogs/content-picker.js). The
 * `stonetop-themed` class is not optional: a DialogV2 is an ApplicationV2, which the parchment skin
 * excludes by selector, so without it this one window would come up in Foundry's default chrome.
 */
async function promptForName() {
	const content = document.createElement("div");
	const field = document.createElement("input");
	field.type = "text";
	field.name = "name";
	field.placeholder = localize("stonetop.relmap.maps.newPlaceholder");
	content.className = "stonetop";
	content.appendChild(field);
	return foundry.applications.api.DialogV2.prompt({
		classes: themedDialogClasses(),
		window: { title: localize("stonetop.relmap.maps.newTitle") },
		position: { width: 420 },
		content,
		ok: {
			label: localize("stonetop.relmap.maps.newMap"),
			callback: (event, button) => button.form.elements.name?.value?.trim() ?? "",
		},
		rejectClose: false,
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
			const maps = listRelationshipMaps().map(entry => ({
				id: entry.id,
				name: entry.name,
				count: format("stonetop.relmap.maps.count", { count: relationshipMapSize(entry) }),
			}));
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
