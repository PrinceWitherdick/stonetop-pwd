import { StonetopDialog } from "./stonetop-dialog.js";
import { loadImage, artImageUrl } from "../book2-art/rebuild-crops.js";
import { removeAvatarPreview } from "./avatar-preview.js";
import { localize, format } from "./i18n.js";
import { hasVideoExtension } from "./foundry-compat.js";
import { canOpenTokenizer } from "./portrait-tokenizer.js";
import {
	SQ_MIN, normalizeRect, normalizeFrame, isValidFrame, rectEq, sameSrc,
	frameSourceFor, frameStyle, suggestSquare, stageFor,
	rectToBox, boxToRect, hitTestBox, clampBox, resizeBox, boxFromDrag, nudgeBox
} from "./portrait-frame.js";

/**
 * Choose the square of a portrait that the small round surfaces show.
 *
 * The interaction is ported from the standalone art picker's square editor, because getting a
 * square right is two motions — put it roughly there, then nudge it — so an editor that can only
 * redraw makes you redo the size every time you fix the position, and the reverse. Press inside
 * to move, a corner to resize from the opposite corner, outside to draw a new one; arrows nudge.
 *
 * THIS DIALOG WRITES ONE FLAG AND NOTHING ELSE. No `actor.update({img})`, no
 * `prototypeToken.texture.src`. A token renders a raw texture with no clipping box and no CSS, so
 * a frame cannot apply to it; and repoint-portraits.js only ever moves a token that was already
 * following the portrait. Framing must not quietly become a second way to change someone's art.
 *
 * It also does not write per gesture. The picker commits on every pointerup and every keypress,
 * which here would be a server round trip plus a world-wide document broadcast, and held
 * arrow-key repeat is about thirty of those a second. All state is dialog-local until Save.
 */
/** Room the side rail needs: the 75px preview plus the 26 and 22 ones, their gaps, and a little
 *  slack so the readout line ("269px square at 41%, 0%") is not the thing that wraps. */
const RAIL_MIN = 178;
/** Window frame, .window-content padding and the body's own padding, taken off the configured
 *  width when the dialog has not been laid out yet and cannot be measured. */
const WINDOW_CHROME = 52;
/** Below this a stage is too small to frame anything on, so the rail gives way instead. */
const MIN_STAGE = 220;

export class PortraitFrameDialog extends StonetopDialog {
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id: "stonetop-portrait-frame",
			title: localize("stonetop.portraitFrame.control"),
			template: "systems/stonetop-pwd/templates/dialogs/portrait-frame.hbs",
			width: 720,
			height: "auto",
			resizable: true,
			classes: ["stonetop", "stonetop-portrait-frame-dialog"]
		});
	}

	get _autoHeight() { return true; }

	constructor({ handle, img = "", title = "", onSaved } = {}, options = {}) {
		// Title goes through the options OBJECT rather than being assigned onto `this.options`
		// afterwards. Foundry freezes an Application's resolved options, so the assignment throws
		// part-way through the constructor — and a constructor that throws inside a click handler
		// looks exactly like a button that does nothing.
		super(title ? { ...options, title } : options);
		this._handle = handle;
		this._img = String(img ?? "");
		this._onSaved = onSaved;
		// The path actually loaded onto the stage, and therefore the only path ever stamped. A
		// frame's `src` is proven-loadable by construction, so the read side never needs to ask
		// whether the file it names exists.
		this._src = "";
		this._rect = null;
		this._stage = null;      // { w, h }
		this._natural = null;    // { pw, ph }
		this._drag = null;
	}

	getData() {
		return {
			stageSrc: this._route(frameSourceFor(this._img)),
			fallbackSrc: this._route(this._img),
			// The rail's "this is not Tokenizer" note. Asked of canOpenTokenizer, the same gate the
			// tokenize pip on the sheet header uses, so the note appears exactly when the button it
			// is distinguishing this dialog FROM is on offer. It answers false for a follower card
			// or a legacy roster row too (no `actor` on those handles), which is right: there is no
			// token in that story at all, so drawing the contrast would only raise a question.
			showTokenizerNote: canOpenTokenizer(this._handle?.actor)
		};
	}

	/** Data-relative paths go through Foundry's route; an absolute URL is left alone. */
	_route(path) {
		return artImageUrl(path);
	}

	activateListeners(html) {
		super.activateListeners(html);              // mandatory: FrontOnOpen lifecycle
		const root = html[0];
		this._root = root;
		this._stageEl = root.querySelector(".stonetop-frame-stage");
		this._imgEl = root.querySelector(".stonetop-frame-stage-img");
		this._layer = root.querySelector(".stonetop-frame-layer");
		this._readout = root.querySelector(".stonetop-frame-readout");
		this._errorEl = root.querySelector(".stonetop-frame-error");
		this._previews = [...root.querySelectorAll(".stonetop-frame-preview img")];

		root.querySelector(".stonetop-frame-save")?.addEventListener("click", () => this._onSave());
		root.querySelector(".stonetop-frame-suggest")?.addEventListener("click", () => this._onSuggest());

		this._bindPointer();
		this._bindKeys();
		this._loadStage();
	}

	async _loadStage() {
		const wanted = frameSourceFor(this._img);
		let img = null;
		for (const candidate of [wanted, this._img]) {
			if (!candidate) continue;
			try {
				// crossOrigin null, NOT the shared default of "anonymous": that default exists so a
				// canvas is never tainted, but it makes the load FAIL outright against any host
				// sending no CORS headers, which is exactly the external art this feature exists to
				// support. Nothing here ever touches a canvas.
				img = await loadImage(this._route(candidate), { crossOrigin: null });
				this._src = String(candidate);
				break;
			} catch { /* try the fallback */ }
		}
		if (!img) return this._fail(format("stonetop.portraitFrame.loadFailed", { src: this._img }));

		const pw = img.naturalWidth;
		const ph = img.naturalHeight;
		if (!(pw > 0) || !(ph > 0)) return this._fail(format("stonetop.portraitFrame.loadFailed", { src: this._img }));
		this._natural = { pw, ph };

		const stage = stageFor(pw, ph, { maxW: this._stageWidthBudget(), viewH: window.innerHeight });
		this._stage = stage;
		this._stageEl.style.width = `${stage.w}px`;
		this._stageEl.style.height = `${stage.h}px`;
		this._imgEl.src = this._route(this._src);
		this._imgEl.style.cssText = `width:${stage.w}px;height:${stage.h}px;left:0;top:0`;

		// A frame authored against a different picture is never loaded onto this stage: its rect
		// describes somewhere else entirely.
		const stored = this._handle?.read?.();
		const keep = isValidFrame(stored) && sameSrc(stored.src, this._src) ? normalizeRect(stored.rect) : null;
		this._rect = keep ?? suggestSquare(pw, ph);
		this._loaded = this._rect ? [...this._rect] : null;
		this._paint();
		this.setPosition({ height: "auto" });
	}

	/**
	 * How wide the stage may be, MEASURED from the laid-out dialog rather than assumed.
	 *
	 * A fixed cap is what clipped the side rail: the stage took its full 520px, the rail asked for
	 * its 150px minimum, and together with the gaps that came to more than the window had. Because
	 * the stage carries an inline pixel size (the uniform scale the whole editor rests on), it
	 * cannot be allowed to shrink with CSS afterwards — so the budget has to be known before the
	 * scale is chosen.
	 *
	 * Falls back to a figure derived from the configured width, so it stays right if that changes.
	 * Measurement can legitimately read 0 when this runs before the window is in the DOM.
	 */
	_stageWidthBudget() {
		const body = this._root?.querySelector(".stonetop-frame-body");
		const fallback = Math.max(MIN_STAGE, (Number(this.options?.width) || 720) - WINDOW_CHROME - RAIL_MIN);
		if (!body) return fallback;
		const cs = getComputedStyle(body);
		const inner = body.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
		if (!(inner > 0)) return fallback;
		const gap = parseFloat(cs.columnGap) || 0;
		return Math.max(MIN_STAGE, inner - RAIL_MIN - gap);
	}

	_fail(message) {
		if (this._errorEl) {
			this._errorEl.textContent = message;
			this._errorEl.hidden = false;
		}
		this._root?.querySelector(".stonetop-frame-save")?.setAttribute("disabled", "disabled");
		this._root?.querySelector(".stonetop-frame-suggest")?.setAttribute("disabled", "disabled");
		this.setPosition({ height: "auto" });
	}

	_box() { return this._stage ? rectToBox(this._rect, this._stage.w, this._stage.h) : null; }

	/** Dialog-local commit: redraw, refresh the previews, update the readout. No document write. */
	_commit(box) {
		if (!box || !this._stage) return;
		this._rect = normalizeRect(boxToRect(box, this._stage.w, this._stage.h)) ?? this._rect;
		this._paint();
	}

	/**
	 * Redraw the square, the previews and the readout from `this._rect`.
	 *
	 * ⚠ NOT `_render`. That is Application's own lifecycle method: `render(true)` calls
	 * `_render(force, options)`, so a same-named method here silently REPLACES it, and the
	 * window never renders at all. It fails inside a click handler with a message about
	 * whatever this method touches first, which points nowhere near the real cause. AppV1 also
	 * owns `_state`, `element`, `options`, `close`, `activateListeners` and `getData` — check
	 * before naming anything on a sheet or dialog.
	 */
	_paint() {
		// Defensive: a redraw can be reached before activateListeners has cached the elements.
		if (!this._previews) return;
		this._drawBox(this._box(), "");
		const style = frameStyle(this._rect);
		for (const el of this._previews) {
			el.src = this._imgEl?.src ?? "";
			el.style.cssText = style;
		}
		const r = this._rect;
		if (r && this._natural && this._readout) {
			// Source pixels, which is the number a user can actually judge a face against.
			const px = Math.round((r[2] - r[0]) * this._natural.pw);
			const text = `${px}px square at ${Math.round(r[0] * 100)}%, ${Math.round(r[1] * 100)}%`;
			this._readout.textContent = text;
			this._stageEl?.setAttribute("aria-label", text);
		}
	}

	_drawBox(box, cls) {
		if (!this._layer) return;
		this._layer.replaceChildren();
		if (!box) return;
		const el = document.createElement("div");
		el.className = `sq-rect${cls ? ` ${cls}` : ""}`;
		el.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.side}px;height:${box.side}px`;
		this._layer.append(el);
		// Grips are decoration only. The drag is bound to the stage and hit-tested geometrically,
		// so they are pointer-events:none and can never swallow the press that starts a resize.
		if (!cls) {
			for (const corner of ["nw", "ne", "sw", "se"]) {
				const g = document.createElement("div");
				g.className = `sq-grip sq-grip--${corner}`;
				el.append(g);
			}
		}
	}

	// Where the pointer is, in stage pixels.
	//
	// The stage's own rect is cached for the duration of a drag rather than re-read per sample.
	// Pointer capture means the stage cannot move while one is live, and the previous sample has
	// already written three preview styles and rebuilt the overlay — so an uncached read here is a
	// forced synchronous layout on every pointermove, at pointer poll rate rather than frame rate.
	_at(ev) {
		const r = this._drag?.rect ?? this._stageEl.getBoundingClientRect();
		const { w, h } = this._stage;
		// Clamped, so a drag that leaves the dialog tracks the edge instead of freezing.
		return {
			x: Math.min(Math.max(ev.clientX - r.left, 0), w),
			y: Math.min(Math.max(ev.clientY - r.top, 0), h)
		};
	}

	_bindPointer() {
		const stage = this._stageEl;
		// Pointer capture on the STAGE, not listeners on window: this dialog opens repeatedly, and
		// window listeners would leak a pair per open and pin a dead context alive. Capture also
		// buys touch and pen for free.
		stage.addEventListener("pointerdown", (ev) => {
			if (!this._stage || ev.button !== 0) return;
			const rect = this._stageEl.getBoundingClientRect();
			const { x, y } = this._at(ev);
			const start = this._box();
			this._drag = { x0: x, y0: y, start, box: null, rect, ...hitTestBox(x, y, start) };
			stage.setPointerCapture(ev.pointerId);
			ev.preventDefault();
		});

		stage.addEventListener("pointermove", (ev) => {
			if (!this._stage) return;
			const { x, y } = this._at(ev);
			const { w, h } = this._stage;
			if (!this._drag) {
				// The whole discoverability story: there is no legend, the cursor says what a press
				// here would do.
				const mode = hitTestBox(x, y, this._box());
				const cursor = mode.mode === "move" ? "move"
					: mode.mode === "resize" ? (mode.corner === "nw" || mode.corner === "se" ? "nwse-resize" : "nesw-resize")
						: "crosshair";
				// Only on a change: the cursor is the same for most of a stage, and a style write
				// per pointer sample dirties layout for a value the browser already has.
				if (cursor !== this._cursor) { this._cursor = cursor; stage.style.cursor = cursor; }
				return;
			}
			const d = this._drag;
			// Everything computes from the snapshot taken at pointerdown, never from the live box,
			// so nothing accumulates drift over a long drag.
			d.box = d.mode === "move"
				? clampBox({ side: d.start.side, left: x - d.dx, top: y - d.dy }, w, h)
				: d.mode === "resize"
					? resizeBox(d.corner, d.start, x, y, w, h)
					: boxFromDrag(d.x0, d.y0, x, y, w, h);
			this._drawBox(d.box, "ghost");
			const preview = frameStyle(normalizeRect(boxToRect(d.box, w, h)));
			if (preview) for (const el of this._previews) el.style.cssText = preview;
		});

		const end = () => {
			const d = this._drag;
			this._drag = null;
			if (!d) return;
			// Three no-op guards, all ported. They are the difference between "I clicked to focus"
			// and "I destroyed the square".
			const min = Math.min(this._stage.w, this._stage.h) * SQ_MIN;
			if (!d.box) return this._paint();                                  // never moved
			if (d.mode === "draw" && d.box.side < min) return this._paint();   // a click, not a square
			if (d.start && rectEq(boxToRect(d.box, this._stage.w, this._stage.h),
				boxToRect(d.start, this._stage.w, this._stage.h))) return this._paint();
			this._commit(d.box);
		};
		stage.addEventListener("pointerup", end);
		stage.addEventListener("pointercancel", end);
	}

	_bindKeys() {
		// Bound to the dialog, never to document: the picker guards a document listener on its
		// modal being open, which in Foundry would nudge the frame from any focused sheet.
		this._root.addEventListener("keydown", (ev) => {
			if (!this._stage) return;
			if (ev.target.closest?.("input, textarea, select, [contenteditable]")) return;
			const next = nudgeBox(this._box(), ev.key, { shift: ev.shiftKey }, this._stage.w, this._stage.h);
			if (!next) return;              // Tab and Escape still reach the dialog
			ev.preventDefault();            // or the arrows scroll the dialog body
			this._commit(next);
		});
	}

	_onSuggest() {
		if (!this._natural || !this._stage) return;
		const rect = suggestSquare(this._natural.pw, this._natural.ph);
		this._commit(rectToBox(rect, this._stage.w, this._stage.h));
	}

	async _onSave() {
		const rect = normalizeRect(this._rect);
		if (!rect || !this._src) return;
		// A no-op open must not queue a document update. rectToBox re-squares off the X span, so
		// an untouched open/close can otherwise "change" the rect by a thousandth.
		const stored = this._handle.read();
		if (isValidFrame(stored) && sameSrc(stored.src, this._src) && rectEq(normalizeRect(stored.rect), rect)) {
			return void this.close();
		}
		await this._handle.write(normalizeFrame({ src: this._src, rect }));
		this._onSaved?.();
		await this.close();
	}

	// No "Remove frame" button. A crop is undone by re-cropping, or by clearing the portrait
	// itself (the picker's own Remove, which drops the rect with it). The handles still expose
	// `clear()` and portrait-token-frame.js still exposes revertPrototypeTokenFrame; nothing
	// calls them at present.

	// No Tokenizer entry point in this dialog. It is a pip beside the crop pip on the sheet header
	// (templates/actor/partials/portrait-frame-pip.hbs), because the two are siblings rather than
	// steps: this dialog crops the face for the sheet, Tokenizer makes the pog for the map, and
	// reaching one THROUGH the other implied a sequence that does not exist.
}

/**
 * The one door onto the editor. Refuses rather than opening onto nothing.
 *
 * ⚠ THIS DOES NOT ROUTE TO TOKENIZER, and an earlier version that did was wrong. The two tools do
 * DIFFERENT jobs, and only this one leaves the portrait alone:
 *
 *   this dialog  -> a rect on a flag. `actor.img` stays the WHOLE illustration, and the small
 *                   surfaces (sheet header, follower cards, relationship rows, steading roster)
 *                   crop it with CSS. Modules that read `actor.img` — Image Hover and friends —
 *                   still get the full picture, which is the whole point of storing a rect
 *                   instead of cutting a file.
 *   Tokenizer    -> a token IMAGE, masked and framed. It never touches the rect, and its Avatar
 *                   pane would REPLACE `actor.img` with a square, losing the full illustration.
 *
 * So the crop control belongs here, and Tokenizer gets its own button in the footer.
 *
 * A video is a legal Foundry portrait, and `new Image()` never fires `onload` for one — the stage
 * would sit blank forever. The round surfaces show a still frame of it anyway, so there is
 * genuinely nothing here to choose.
 */
export function openPortraitFrameEditor({ handle, img, title, onSaved } = {}) {
	// Every refusal says why. A framing button that silently does nothing is indistinguishable
	// from a broken one, and the reasons here are all things a user can act on.
	if (!handle) {
		console.warn("stonetop | no portrait-frame handle for this surface");
		ui.notifications?.warn(localize("stonetop.portraitFrame.noTarget"));
		return null;
	}
	if (!handle.canWrite) {
		ui.notifications?.warn(localize("stonetop.portraitFrame.readOnly"));
		return null;
	}
	const src = String(img ?? handle.img ?? "");
	if (!src) {
		ui.notifications?.warn(localize("stonetop.portraitFrame.noImage"));
		return null;
	}
	if (hasVideoExtension(src)) {
		ui.notifications?.warn(localize("stonetop.portraitFrame.video"));
		return null;
	}
	try {
		// The hover preview is portaled to <body> and would otherwise hang over the dialog.
		removeAvatarPreview();
		return new PortraitFrameDialog({ handle, img: src, title, onSaved }).render(true);
	} catch (err) {
		console.error("stonetop | could not open the portrait framer", err);
		ui.notifications?.error(localize("stonetop.portraitFrame.openFailed"));
		return null;
	}
}
