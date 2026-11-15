import { PortraitFrameDialog } from "../utils/PortraitFrameDialog.js";
import { normalizeRect, rectToBox, stageFor } from "../utils/portrait-frame.js";
import { squareAround, defaultSquare, cutPlan } from "./pdf/emblem-square.js";
import { inkToAlpha } from "./pdf/emblem-box.js";

/**
 * CUT A HOMEBREW PLAYBOOK'S PICTURE FROM ITS PDF, BY HAND. The Playbook Builder takes the emblem
 * printed beside the playbook's name on its own when it reads a PDF (pdf/pdf-emblem.js); this is for
 * when it found none, or cut it badly: the GM sees the page and puts the square where they want it.
 *
 * The People of Stonetop framer's editor (utils/PortraitFrameDialog.js), on a page of the PDF instead
 * of a portrait: the same stage, square, drag, resize and arrow keys, and the same look (it wears the
 * framer's dialog class). Only what it does with the square differs: the framer writes a flag, this
 * renders that square of the page again, sharp, and hands back a picture (onCut), which the builder
 * saves beside the playbook library. Nothing is written until Use this picture.
 *
 * The PDF is the GM's own, read in memory; it never leaves the browser.
 */

/** The page drawn on the stage: three times its size in points, so a window made big shows it sharp. */
const STAGE_SCALE = 3;
/** The finished picture's side, as the book's playbook icons are about. */
const OUT = 512;

export class PlaybookEmblemCutDialog extends PortraitFrameDialog {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-pb-emblem-cut",
			title: "Cut the picture from the PDF",
			template: "systems/stonetop-pwd/templates/dialogs/playbook-emblem-cut.hbs",
			width: 760,
			classes: ["stonetop", "stonetop-portrait-frame-dialog", "stonetop-pb-emblem-cut-dialog"],
		});
	}

	/**
	 * @param {object} opts
	 * @param {object} opts.doc        the open pdf.js document (destroyed when this window closes)
	 * @param {string} [opts.fileName]
	 * @param {{page:number, box:object}|null} [opts.hint]  where the importer found the emblem
	 * @param {function(Blob): Promise<boolean>} opts.onCut  takes the picture; false keeps this open
	 */
	constructor({ doc, fileName = "", hint = null, onCut } = {}, options = {}) {
		super({ handle: null, img: "" }, options);
		this._doc = doc;
		this._fileName = fileName;
		this._hint = hint?.box ? hint : null;
		this._onCut = onCut;
		this._page = Math.min(Math.max(Number(hint?.page) || 1, 1), doc?.numPages || 1);
		this._clear = true;
		this._pagePt = null;   // the page's size in points
		this._url = "";        // the stage picture's object URL, let go when replaced or closed
	}

	getData() {
		const pages = this._doc?.numPages ?? 1;
		return {
			fileName: this._fileName,
			pages: Array.from({ length: pages }, (_, i) => ({ value: i + 1, label: `Page ${i + 1}`, selected: i + 1 === this._page })),
			manyPages: pages > 1,
			clear: this._clear,
			found: !!this._hint,
		};
	}

	activateListeners(html) {
		const root = html[0];
		root.querySelector(".stonetop-pb-emblem-page")?.addEventListener("change", ev => {
			this._page = Number(ev.currentTarget.value) || 1;
			this._loadStage();
		});
		root.querySelector(".stonetop-pb-emblem-clear input")?.addEventListener("change", ev => {
			this._clear = ev.currentTarget.checked;
			root.classList.toggle("is-clear", this._clear);
			// Back to the page, so the arrow keys go on nudging the square (they pass a focused checkbox by).
			this._stageEl?.focus({ preventScroll: true });
		});
		root.classList.toggle("is-clear", this._clear);
		// The framer's own wiring: the stage's drag and keys, Save (here Use this picture), Suggest
		// (here Find the emblem), and the first _loadStage.
		super.activateListeners(html);
	}

	/** A whole page, not a portrait: a playbook's picture can be a small part of it. */
	get _minShare() {
		return 0.02;
	}

	/** The page, drawn by pdf.js onto the stage, and the square started where the emblem is. */
	async _loadStage() {
		try {
			const page = await this._doc.getPage(this._page);
			const vp = page.getViewport({ scale: STAGE_SCALE });
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(vp.width);
			canvas.height = Math.ceil(vp.height);
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			await page.render({ canvasContext: ctx, viewport: vp }).promise;
			const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
			if (!blob) throw new Error("the page couldn't be drawn");
			if (this._url) URL.revokeObjectURL(this._url);
			this._url = URL.createObjectURL(blob);
			this._src = this._url;
			this._pagePt = { w: vp.width / STAGE_SCALE, h: vp.height / STAGE_SCALE };
			this._natural = { pw: canvas.width, ph: canvas.height };
			this._imgEl.src = this._url;
			if (this._errorEl) this._errorEl.hidden = true;
			this._rect = this._startSquare();
			this._stage = null;
			this._fitStage();
			// The arrow keys work at once, before any click (a press on the page keeps it: the framer's pointerdown).
			this._stageEl.focus({ preventScroll: true });
		} catch (err) {
			console.error("Stonetop | couldn't draw the PDF page to cut from", err);
			this._fail("This page of the PDF couldn't be drawn. Try another page, or choose a picture instead.");
		}
	}

	/**
	 * Size the page on the stage to the room the window gives it. Opening, it fits the framer's caps
	 * (560px tall, two thirds of the screen) and the window fits round it; once the GM resizes the
	 * window (utils/resizable-dialogs.js marks it _stonetopHeightLocked), the page takes the whole of
	 * the room beside the rail and above the footer, so a bigger window is a bigger page. The square
	 * is kept as fractions of the page, so it stays where it was.
	 */
	_fitStage() {
		if (!this._natural || !this._stageEl) return;
		const { pw, ph } = this._natural;
		let maxH = 560, viewH = window.innerHeight;
		const content = this.element?.[0]?.querySelector(".window-content");
		const body = this._root?.querySelector(".stonetop-frame-body");
		if (this._stonetopHeightLocked && content && body) {
			const px = (el, side) => parseFloat(getComputedStyle(el)[side]) || 0;
			const footer = this._root.querySelector(".stonetop-frame-footer")?.offsetHeight ?? 0;
			maxH = content.clientHeight - px(content, "paddingTop") - px(content, "paddingBottom")
				- px(body, "paddingTop") - px(body, "paddingBottom") - footer - 2;
			viewH = 0;
		}
		const stage = stageFor(pw, ph, { maxW: this._stageWidthBudget(), maxH: Math.max(200, maxH), viewH });
		if (!stage || (this._stage && stage.w === this._stage.w && stage.h === this._stage.h)) return;
		this._stage = stage;
		this._stageEl.style.width = `${stage.w}px`;
		this._stageEl.style.height = `${stage.h}px`;
		this._imgEl.style.cssText = `width:${stage.w}px;height:${stage.h}px;left:0;top:0`;
		this._paint();
		// Not yet resized by hand: the window fits round the page (resizable-dialogs.js drops this once it is).
		if (!this._stonetopHeightLocked) {
			this._fitting = true;
			try { this.setPosition({ height: "auto" }); } finally { this._fitting = false; }
		}
	}

	/** A resize drag (Draggable passes only a width and height): fit the page to the new room, once a frame. */
	setPosition(position = {}) {
		const out = super.setPosition(position);
		const drag = (Number.isFinite(position?.width) || Number.isFinite(position?.height)) && !("top" in position) && !("left" in position);
		if (drag && this._natural && !this._fitting) {
			cancelAnimationFrame(this._fitFrame);
			this._fitFrame = requestAnimationFrame(() => this._fitStage());
		}
		return out;
	}

	/** The emblem the importer found, on its own page; otherwise the top right, where it's printed. */
	_startSquare() {
		const { w, h } = this._pagePt ?? {};
		const found = this._hint && this._hint.page === this._page ? squareAround(this._hint.box, w, h) : null;
		return normalizeRect(found ?? defaultSquare(w, h));
	}

	/** Find the emblem: back to where the importer found it (or the top right). */
	_onSuggest() {
		if (!this._stage) return;
		const rect = this._startSquare();
		if (rect) this._commit(rectToBox(rect, this._stage.w, this._stage.h));
	}

	/** Use this picture: that square of the page, drawn again sharp, made square at OUT pixels. */
	async _onSave() {
		const rect = normalizeRect(this._rect);
		const plan = cutPlan(rect, this._pagePt?.w, this._pagePt?.h, OUT);
		if (!plan || this._cutting) return;
		this._cutting = true;
		const buttons = [...(this._root?.querySelectorAll(".stonetop-frame-footer button") ?? [])];
		for (const b of buttons) b.disabled = true;
		try {
			const page = await this._doc.getPage(this._page);
			const piece = document.createElement("canvas");
			piece.width = piece.height = plan.px;
			const ctx = piece.getContext("2d", { willReadFrequently: true });
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, plan.px, plan.px);
			const viewport = page.getViewport({ scale: plan.scale, offsetX: -plan.x0 * plan.scale, offsetY: -plan.y0 * plan.scale });
			await page.render({ canvasContext: ctx, viewport }).promise;
			// The paper made clear, as the picture the importer takes is: it sits on any background.
			if (this._clear) ctx.putImageData(inkToAlpha(ctx.getImageData(0, 0, plan.px, plan.px)), 0, 0);
			const out = document.createElement("canvas");
			out.width = out.height = OUT;
			const octx = out.getContext("2d");
			octx.imageSmoothingQuality = "high";
			octx.drawImage(piece, 0, 0, OUT, OUT);
			const blob = await new Promise(resolve => out.toBlob(resolve, "image/webp", 0.9));
			if (!blob) throw new Error("the picture couldn't be made");
			if (await this._onCut?.(blob)) return void (await this.close());
		} catch (err) {
			console.error("Stonetop | couldn't cut the picture from the PDF", err);
			ui.notifications?.error("The picture couldn't be cut from the PDF. Try again, or choose a picture instead.");
		} finally {
			this._cutting = false;
			for (const b of buttons) b.disabled = false;
		}
	}

	async close(options) {
		cancelAnimationFrame(this._fitFrame);
		if (this._url) { URL.revokeObjectURL(this._url); this._url = ""; }
		const doc = this._doc;
		this._doc = null;
		try { await doc?.destroy?.(); } catch { /* already gone */ }
		return super.close(options);
	}
}

/**
 * Open the cutter on a PDF's bytes. Says why when it can't: a button that does nothing looks broken.
 * @param {object} opts
 * @param {object} opts.pdfjs   the pdf.js module (utils/pdfjs-loader.js)
 * @param {ArrayBuffer} opts.data
 * @param {string} [opts.fileName]
 * @param {{page:number, box:object}|null} [opts.hint]
 * @param {function(Blob): Promise<boolean>} opts.onCut
 */
export async function openEmblemCutter({ pdfjs, data, fileName = "", hint = null, onCut } = {}) {
	// One at a time: the window has a fixed id, and a second copy would share it.
	for (const w of Object.values(ui.windows ?? {})) if (w instanceof PlaybookEmblemCutDialog) await w.close();
	let doc = null;
	try {
		doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
	} catch (err) {
		console.error("Stonetop | couldn't open that PDF to cut a picture from", err);
		ui.notifications?.error("That PDF couldn't be opened. Is it a PDF file, and not password-protected?");
		return null;
	}
	return new PlaybookEmblemCutDialog({ doc, fileName, hint, onCut }).render(true);
}
