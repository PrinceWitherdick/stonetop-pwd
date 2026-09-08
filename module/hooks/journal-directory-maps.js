import { SYSTEM_ID } from "../system-id.js";
import { RELMAP_FLAG } from "../relmap/relmap-store.js";
import { RELMAP_FOLDER_NAME } from "../relmap/relmap-doc.js";
import { DIRECTORY_ROW_SELECTOR, isWorldDirectory } from "./actor-directory-rows.js";

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
 * the steading sheet's own tab and from the hotbar macro, both of which go straight to the board.
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
 * ⚠ THE ONE THING THE SIDEBAR WAS STILL FOR was renaming and deleting a whole map, which no other
 * surface offered. Both moved onto the map window's own header menu in the same change
 * (dialogs/RelationshipMapWindow.js), so this takes nothing away with it.
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
