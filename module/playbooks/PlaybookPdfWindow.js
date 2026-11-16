import { StonetopDialog } from "../utils/stonetop-dialog.js";

/**
 * A playbook PDF, open beside the Playbook Builder while the GM types it in by hand: the one a
 * "Print to PDF" or a scan made, with no text for the reader to take (PlaybookBuilderDialog
 * explainNoTextPdf). Foundry's own pdf.js viewer in a frame, as the rulebook reader shows a book
 * (BookReaderWindow, whose template and frame styles this shares).
 *
 * The file is the GM's, picked from their own disk: it is shown from memory (a blob URL, same
 * origin, so the viewer takes it) and never uploaded. Closing the window lets it go.
 */
export class PlaybookPdfWindow extends StonetopDialog {
	/**
	 * @param {File|Blob} file
	 * @param {object} [opts]
	 * @param {string} [opts.title]
	 * @param {string} [opts.zoom]  the viewer's opening zoom ("page-width", or a percentage like "150")
	 */
	constructor(file, { title = "", zoom = "" } = {}, options = {}) {
		super(options);
		this._url = URL.createObjectURL(file);
		this._title = title || file?.name || "Playbook PDF";
		this._zoom = zoom;
	}

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["stonetop", "stonetop-book-reader-window", "stonetop-pb-pdf-window"],
			template: "systems/stonetop-pwd/templates/dialogs/book-reader.hbs",
			width: 620,
			height: 760,
			resizable: true,
		});
	}

	get title() { return this._title; }

	getData() {
		const viewer = globalThis.foundry?.utils?.getRoute?.("scripts/pdfjs/web/viewer.html") ?? "/scripts/pdfjs/web/viewer.html";
		// What to load goes in the query; what to do once loaded (the zoom) in the hash.
		const hash = this._zoom ? `#zoom=${encodeURIComponent(this._zoom)}` : "";
		return { src: `${viewer}?${new URLSearchParams({ file: this._url })}${hash}`, frameTitle: this._title };
	}

	async close(options = {}) {
		const out = await super.close(options);
		if (this._url && !this.rendered) { URL.revokeObjectURL(this._url); this._url = null; }
		return out;
	}
}

/**
 * Open `file` beside `builder`, side by side and not over it: the builder moves left to make room
 * when the screen is wide enough for both, and the PDF narrows (to no less than 420) when it isn't
 * quite. Only a screen too small for both lets them overlap. Returns the window.
 */
export function openPdfBeside(file, builder, { landscape = false } = {}) {
	// A landscape playbook is two columns of small print: at 150% one column fills the window, readable
	// enough to type from. An upright one fits its width.
	const win = new PlaybookPdfWindow(file, { title: `${file?.name ?? "Playbook PDF"} (to type in by hand)`, zoom: landscape ? "150" : "page-width" });
	const pos = builder?.position ?? {};
	const gap = 10;
	const screenW = window.innerWidth;
	const bw = Number.isFinite(pos.width) ? pos.width : 760;
	const width = Math.max(420, Math.min(620, screenW - bw - gap * 3));
	const room = screenW - (bw + gap + width);
	const top = Number.isFinite(pos.top) ? pos.top : undefined;
	if (room >= gap * 2 && builder?.setPosition) {
		const left = Math.round(room / 2);
		builder.setPosition({ left });
		win.render(true, { left: left + bw + gap, top, width, height: Math.min(760, window.innerHeight - 40) });
	} else {
		win.render(true, { left: Math.max(0, screenW - width), top, width, height: Math.min(760, window.innerHeight - 40) });
	}
	return win;
}
