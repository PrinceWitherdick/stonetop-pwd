// "Your rulebooks": where a GM says which file is which book.
//
// One window for BOTH books rather than a picker per icon, because the answer is nearly always
// given once, for both, in the same minute: a GM who has just found Book I on their disk is
// standing in the folder Book II is in. The importer's setup asks the same question the same
// way and under the same heading, on purpose (module/book2-art/macro.js) - a GM who has run
// that recognises this.
//
// TWO DOORS PER BOOK, and the FIRST one is the OS file dialog, the same `<input type="file">`
// the importer opens. That is what a GM expects when they are asked for a file on their own
// computer, and the first version of this window offered only Foundry's server-side FilePicker,
// which is not that (user, 2026-08-29). The copy that follows is explained in book-store.js:
// the reader fetches by URL, so a book has to be somewhere this Foundry serves, and a `blob:`
// from an `<input>` dies with the page. The FilePicker stays as the SECOND door, for a book
// already on the server, which is the whole story on a hosted setup.
//
// It writes as it goes. Each pick lands in the setting immediately and the window redraws, so
// there is no Save to forget and no half-answered state to reconcile; the lone button is Done
// because by the time it is pressed there is nothing left to agree to.
import { StonetopDialog } from "../utils/stonetop-dialog.js";
import { openOrFocus } from "../utils/open-or-focus.js";
import { filePicker } from "../utils/foundry-compat.js";
import { RULEBOOKS, rulebookPath, saveRulebookPath } from "./rulebooks.js";
import {
	RULEBOOK_DIR, canBrowseRulebooks, canStoreRulebook, storeRulebookWithNotice,
} from "./book-store.js";
import { openBookReader } from "./BookReaderWindow.js";
import { localize } from "../utils/i18n.js";

const TEMPLATE = "systems/stonetop-pwd/templates/dialogs/rulebooks.hbs";
const DIALOG_ID = "stonetop-rulebooks";

/**
 * What FilePicker calls a PDF. Foundry files PDFs under its TEXT category (they sit beside
 * .md and .json in `CONST.TEXT_FILE_EXTENSIONS`), which is not a guess anyone makes twice, so
 * it is named here rather than inlined as a bare "text" at the call site.
 */
const PDF_PICKER_TYPE = "text";

export class RulebooksDialog extends StonetopDialog {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: DIALOG_ID,
			classes: ["stonetop", "stonetop-rulebooks-dialog"],
			template: TEMPLATE,
			title: localize("stonetop.books.title"),
			width: 520,
			height: "auto",
			resizable: true,
		});
	}

	/** Content-hugging: the list is two rows and the prose around it does not change. */
	get _autoHeight() { return true; }

	getData() {
		return {
			// Asked SEPARATELY, because they are separate rights: adding a file needs
			// FILES_UPLOAD and picking one already there needs FILES_BROWSE, and a world can
			// grant either without the other. Both controls are DISABLED rather than dropped: a
			// greyed button with the note beneath it says why nothing can be done here, where a
			// missing one reads as a window that failed to draw.
			canStore:  canStoreRulebook(),
			canBrowse: canBrowseRulebooks(),
			// Named in the note, so "copies it into this world" also says where.
			dir:       RULEBOOK_DIR,
			rows: RULEBOOKS.map(entry => ({
				book:  entry.book,
				icon:  entry.icon,
				title: localize(entry.titleKey),
				hint:  localize(`stonetop.books.${entry.key}.hint`),
				path:  rulebookPath(entry.book),
			})),
		};
	}

	activateListeners(html) {
		super.activateListeners(html);
		const root = html[0];
		root.addEventListener("click", ev => {
			const button = ev.target.closest?.("[data-action]");
			if (!button || !root.contains(button)) return;
			ev.preventDefault();
			const book = Number(button.dataset.book);
			switch (button.dataset.action) {
				case "choose": this._choose(root, book); break;
				case "browse": this._browse(book); break;
				case "forget": this._forget(book); break;
				case "read":   openBookReader(book); break;
				case "done":   this.close(); break;
			}
		});

		// The OS dialog's answer. Bound per input rather than delegated on the root, because each
		// one already knows which book it belongs to and there are exactly two of them.
		for (const input of root.querySelectorAll(".stonetop-rulebook-file")) {
			input.addEventListener("change", () =>
				this._accept(Number(input.dataset.book), input.files?.[0]));
		}
	}

	/**
	 * Ask for a file on the GM's OWN COMPUTER, which is what they meant by "choose a file".
	 *
	 * A hidden `<input type="file">` clicked from script, because that element is the only thing
	 * a browser lets open the OS dialog and there is no styling it into the row. The value is
	 * cleared first so re-choosing THE SAME file still fires `change`: without it, a GM who
	 * picks the wrong book, then the right one, then goes back to the first gets nothing at all
	 * and no reason why.
	 */
	_choose(root, book) {
		const input = root.querySelector(`.stonetop-rulebook-file[data-book="${book}"]`);
		if (!input) return;
		input.value = "";
		input.click();
	}

	/**
	 * Ask for one book among the files ALREADY in this world.
	 *
	 * `current` is the path already recorded, so a GM changing a file opens the picker in the
	 * folder the old one was in rather than at the top of their data directory; failing that,
	 * the folder copied books land in, which is where an earlier one will be.
	 */
	_browse(book) {
		const FilePickerClass = filePicker();
		if (!FilePickerClass) return;
		new FilePickerClass({
			type: PDF_PICKER_TYPE,
			current: rulebookPath(book) || `${RULEBOOK_DIR}/`,
			callback: path => this._acceptPath(book, path),
		}).render(true);
	}

	/**
	 * Record a file chosen off the GM's computer: copy it in, then remember where it landed.
	 *
	 * The copy is what makes the choice outlive the page (see book-store.js), and a host can
	 * refuse it, so nothing is recorded until there is a path. Writing one down on a refusal is
	 * how a book icon comes to open a reader showing nothing, with no error naming the cause.
	 */
	async _accept(book, file) {
		if (!file) return;
		const stored = await storeRulebookWithNotice(book, file);
		if (!stored) return;
		await saveRulebookPath(book, stored);
		this.renderIfOpen();
	}

	/**
	 * Record a file already on the server, having said so if it does not look like a PDF.
	 *
	 * A warning rather than a refusal. The extension is the only thing we can check without
	 * fetching the file, and it is the sort of check that is right often enough to be worth
	 * saying and wrong often enough (a book saved without its extension, a host that serves it
	 * from a URL with none) that refusing on it would block a working setup.
	 *
	 * Nothing is copied on this path: the file is already where the reader will fetch it from.
	 */
	async _acceptPath(book, path) {
		if (!path) return;
		if (!/\.pdf(\?|#|$)/i.test(path)) {
			ui.notifications?.warn?.(localize("stonetop.books.notPdf"));
		}
		await saveRulebookPath(book, path);
		this.renderIfOpen();
	}

	async _forget(book) {
		await saveRulebookPath(book, "");
		this.renderIfOpen();
	}
}

/** Open the rulebooks window, or bring the one already open to the front. */
export function openRulebooksDialog() {
	return openOrFocus(DIALOG_ID, () => new RulebooksDialog().render(true));
}
