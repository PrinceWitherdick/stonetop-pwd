import { SYSTEM_ID } from "../system-id.js";
import { RELMAP_FLAG } from "../relmap/relmap-store.js";
import { RELMAP_FOLDER_NAME } from "../relmap/relmap-doc.js";
import { DIRECTORY_ROW_SELECTOR, isWorldDirectory } from "./actor-directory-rows.js";
import { localize } from "../utils/i18n.js";

/**
 * KEEP THE RELATIONSHIP MAPS OUT OF THE JOURNAL SIDEBAR.
 *
 * A map is a JournalEntry and has to be one: writing a world setting needs SETTINGS_MODIFY, which
 * is an assistant-GM right, so a map kept in a setting is a map no player can draw on -- while a
 * document the whole table OWNS is one anybody may edit, with the server broadcasting each change
 * for free. The long version of that argument is at the top of relmap/relmap-doc.js.
 *
 * WHAT DOES NOT FOLLOW is that the storage has to be furniture in the Journal tab. A world arrives
 * with a "Relationship Maps" folder holding a "Stonetop" nobody asked for, in the same list as the
 * gazetteer and the Chronicle and everything else a table actually browses, and every map made
 * afterwards lands there too. The map is not read as a journal entry by anyone: it is opened from
 * the steading sheet's own tab, from the hotbar macro, and from the one button this file puts at the
 * top of the Journal tab, all of which go straight to the board.
 *
 * SO THE ROWS ARE TAKEN OUT OF THE RENDER, and nothing about the document changes. Ownership,
 * editing, broadcast, `@UUID` links, the sheet class, the folder itself -- all exactly as they
 * were; what is gone is two lines in a list. That is also why this is a render hook and not, say,
 * an ownership change: hiding by permission would take the map away from the players who are meant
 * to be drawing on it.
 *
 * ⚠ AND IT IS A SCREEN, NOT A VAULT, which is the same sentence relmap-doc.js says about hidden
 * boards. Foundry ships every world JournalEntry to every client; this hides what is DRAWN. Nothing
 * here is a secret being kept -- the map is meant to be opened, just not from this list.
 *
 * ⚠ A WHOLE MAP CANNOT BE RENAMED OR DELETED ANYWHERE ONCE ITS ROW IS GONE, and that is on purpose.
 * This list was the last place that offered either; the map window's title-bar buttons that took
 * over were removed at the user's request, because a Stonetop world has one map and the table works
 * in its pages (which the page strip's own pen and trash still rename and delete).
 */

/** Row selectors, matching core's own directory partials (templates/sidebar/partials/). The
 *  document row is the shared one; a copy that drifts does not fail loudly. */
const ENTRY_ROW = DIRECTORY_ROW_SELECTOR;
const FOLDER_ROW = "li.directory-item.folder[data-folder-id]";

/** Is this app a rendered WORLD Journal directory (not a compendium's index view)?
 *
 * Duck-typed by the shared `isWorldDirectory` (hooks/actor-directory-rows.js), and for the same
 * reason it is shared: ApplicationV2 fires a render hook per class in the inheritance chain, so the
 * stable hook name is the PARENT's (`renderDocumentDirectory`) and every other sidebar tab reaches
 * this handler, which makes the collection guard load-bearing. */
export function isJournalDirectory(app) {
	return isWorldDirectory(app, "JournalEntry");
}

/** Is this entry one of our relationship maps? By the flag, never by the name or the folder: the
 * flag is what `listRelationshipMaps` goes by, and a GM is free to rename either. */
export function isRelationshipMapEntry(doc) {
	return !!doc?.getFlag?.(SYSTEM_ID, RELMAP_FLAG);
}

/**
 * Should this folder go too?
 *
 * ONLY WHEN NOTHING ELSE IS IN IT. A GM who files a page of prose beside their maps has made the
 * folder theirs, and a folder that vanished with their notes inside it would be this system hiding
 * somebody else's work. So: no subfolders, and every entry in it a map.
 *
 * ⚠ AN EMPTY ONE GOES ONLY IF IT IS STILL CALLED WHAT WE CALLED IT. A world whose only map has been
 * deleted is left with an empty "Relationship Maps", which is furniture with nothing in it -- but
 * an empty folder somebody renamed is a folder they are using for something, and taking it off
 * their screen would look like the system had eaten it.
 */
export function isRelationshipMapFolder(folder) {
	if (!folder) return false;
	if (folder.getSubfolders?.(false)?.length ?? folder.children?.length) return false;
	const contents = folder.contents ?? [];
	if (!contents.length) return folder.name === RELMAP_FOLDER_NAME;
	return contents.every(isRelationshipMapEntry);
}

/**
 * Take the map rows out of one rendered Journal directory.
 *
 * REMOVED RATHER THAN HIDDEN, because core's search filter works by setting `hidden` on rows and
 * clearing it again on the next keystroke -- so a row we merely hid would come back the moment
 * anybody typed in the search box, and again every time they cleared it.
 *
 * @param {Application} app
 * @param {HTMLElement|jQuery} element
 */
export function hideRelationshipMapRows(app, element) {
	if (!isJournalDirectory(app)) return;
	const root = element?.jquery ? element[0] : element;
	if (!root?.querySelectorAll) return;

	for (const li of root.querySelectorAll(ENTRY_ROW)) {
		if (isRelationshipMapEntry(app.collection.get(li.dataset.entryId))) li.remove();
	}
	// ⚠ THE FOLDERS AFTER THE ENTRIES, and it does not matter that the rows are already gone: the
	// question is asked of the DOCUMENT, not of what is left standing in the list. Asked of the
	// markup it would be "is this folder row empty now", which is also true of a folder the GM
	// collapsed and of one whose only entry they lack permission to see.
	for (const li of root.querySelectorAll(FOLDER_ROW)) {
		if (isRelationshipMapFolder(game.folders?.get(li.dataset.folderId))) li.remove();
	}
}

/**
 * Put the "Relationship Map" button into one rendered Journal directory, under core's own create
 * buttons.
 *
 * THE WAY IN FROM THE JOURNAL TAB, now that the map's own rows are taken out of it. What a press does
 * is the caller's (stonetop.js hands it the hotbar macro's own `game.stonetop.openRelationshipMap`),
 * so the button and the macro can never land a reader on different boards.
 *
 * A ROW OF ITS OWN rather than a third button squeezed into core's row: that row is sized for two, and
 * a third would cut every label short. Written once per render and never twice, since a directory
 * re-renders on every change to any journal entry.
 *
 * @param {Application} app
 * @param {HTMLElement|jQuery} element
 * @param {Function} onOpen  what a press does.
 */
export function addOpenMapButton(app, element, onOpen) {
	if (!isJournalDirectory(app)) return;
	const root = element?.jquery ? element[0] : element;
	const header = root?.querySelector?.(".directory-header");
	if (!header || header.querySelector("[data-relmap-open-map]")) return;

	const row = document.createElement("div");
	row.className = "header-actions action-buttons flexrow stonetop-relmap-directory-actions";
	const button = document.createElement("button");
	button.type = "button";
	button.dataset.relmapOpenMap = "";
	const icon = document.createElement("i");
	icon.className = "fas fa-diagram-project";
	icon.setAttribute("inert", "");
	icon.setAttribute("aria-hidden", "true");
	const label = document.createElement("span");
	label.textContent = localize("stonetop.relmap.directory.open");
	button.append(icon, label);
	button.addEventListener("click", ev => {
		ev.preventDefault();
		onOpen?.();
	});
	row.append(button);

	const actions = header.querySelector(".header-actions");
	if (actions) actions.after(row);
	else header.prepend(row);
}
