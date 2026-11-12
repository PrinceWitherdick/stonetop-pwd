// A homebrew playbook's right-click menu in the Items sidebar: open it in the Playbook Builder,
// save it as a file to share, or stop (or start again) sharing it with the GM's other worlds
// through the playbook library (playbook-library.js). GM only, like the builder itself. The playbook's moves sit beside it
// in its folder; editing them through the builder keeps them matched to it by name.

import { contextMenuEntry } from "../utils/foundry-compat.js";
import { isHomebrewPlaybookItem } from "./playbook-catalog.js";
import { isRemovedFromLibrary } from "./playbook-library.js";
import { droppedFileKind } from "./dropped-file.js";

const itemOfRow = target => globalThis.game?.items?.get?.(target?.dataset?.entryId) ?? null;
const isGM = () => !!globalThis.game?.user?.isGM;
const homebrewRow = target => isGM() && isHomebrewPlaybookItem(itemOfRow(target));

export function homebrewPlaybookMenuEntries() {
	return [
		contextMenuEntry({
			label: "Open in Playbook Builder",
			icon: "fa-solid fa-book-open",
			visible: homebrewRow,
			run: async target => {
				const { openPlaybookBuilder } = await import("./PlaybookBuilderDialog.js");
				openPlaybookBuilder(itemOfRow(target));
			},
		}),
		contextMenuEntry({
			label: "Export Playbook File",
			icon: "fa-solid fa-file-export",
			visible: homebrewRow,
			run: async target => {
				const { exportHomebrewPlaybook } = await import("./homebrew-store.js");
				exportHomebrewPlaybook(itemOfRow(target));
			},
		}),
		contextMenuEntry({
			label: "Stop Sharing with My Other Worlds",
			icon: "fa-solid fa-link-slash",
			visible: target => homebrewRow(target) && !isRemovedFromLibrary(itemOfRow(target)),
			run: async target => {
				const item = itemOfRow(target);
				const { askWithButtons } = await import("../utils/ask-with-buttons.js");
				const { escHtml } = await import("../utils/strings.js");
				const go = await askWithButtons({
					title: `Stop sharing ${item.name}?`,
					content: `<p>New worlds won't get <strong>${escHtml(item.name)}</strong> from your playbook library any more, and edits saved here won't reach your other worlds. Worlds that already have it keep their copy, and this world keeps it too.</p>`,
					buttons: [{ key: "stop", label: "Stop sharing it", icon: "fa-link-slash", value: true }],
					defaultKey: false,
				});
				if (go !== true) return;
				const { removeFromLibrary } = await import("./playbook-library.js");
				if (await removeFromLibrary(item)) ui.notifications.info(`${item.name} is no longer shared with your other worlds.`);
				else ui.notifications.error(`Couldn't change your playbook library. Check that you can upload files.`);
			},
		}),
		contextMenuEntry({
			label: "Share with My Other Worlds",
			icon: "fa-solid fa-link",
			visible: target => homebrewRow(target) && isRemovedFromLibrary(itemOfRow(target)),
			run: async target => {
				const item = itemOfRow(target);
				const { shareInLibrary } = await import("./playbook-library.js");
				if (await shareInLibrary(item)) ui.notifications.info(`${item.name} is in your playbook library again, so your other worlds get it.`);
				else ui.notifications.error(`Couldn't change your playbook library. Check that you can upload files.`);
			},
		}),
	];
}

/**
 * A playbook PDF, or a shared playbook file, dropped on the Items sidebar opens the Playbook
 * Builder and reads it (GM only). Listened for in the CAPTURE phase, and only for a drag that
 * carries such a file, so core's own drop of documents and folders is untouched.
 */
function wireSidebarDrop(_app, html) {
	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root || root.dataset.stonetopPlaybookDrop) return;
	root.dataset.stonetopPlaybookDrop = "1";
	root.addEventListener("dragover", ev => {
		if (isGM() && droppedFileKind(ev.dataTransfer, { peek: true })) ev.preventDefault();
	}, true);
	root.addEventListener("drop", async ev => {
		if (!isGM()) return;
		// Decided and claimed BEFORE any await: a drop must be stopped while the event is live,
		// and its files are readable only then.
		const kind = droppedFileKind(ev.dataTransfer);
		if (!kind) return;
		const file = ev.dataTransfer.files[0];
		ev.preventDefault();
		ev.stopPropagation();
		const { PlaybookBuilderDialog } = await import("./PlaybookBuilderDialog.js");
		const builder = new PlaybookBuilderDialog({});
		await builder._render(true);
		builder.readDroppedFile(file, kind);
	}, true);
}

/** Register the menu entries and the sidebar drop. Call once, in init. */
export function registerHomebrewPlaybookMenu() {
	Hooks.on("getItemContextOptions", (_directory, options) => options.push(...homebrewPlaybookMenuEntries()));
	Hooks.on("renderItemDirectory", wireSidebarDrop);
}
