// A TAG CHIP'S WORDS, MEASURED IN THE FONT THE BOARD DRAWS THEM IN.
//
// The pills under a person are packed into rows by utils/relmap-geometry.js `chipLayout`, and every
// group outline and the board's framing reach round those rows, so a pill's width has to be known
// before it is drawn. The pill is set in `--font-stonetop` (Libre Caslon Text, falling back to Signika)
// at 13px, weight 600 and 0.05em letter-spacing (`.stonetop-relmap-chip`), so the width is measured on
// a canvas in that face, and the geometry's per-character table is left for when this cannot answer.

import { measuringContext } from "./measuring-canvas.js";
import { setChipTextMeasure } from "./relmap-geometry.js";

/** Called (Hooks.callAll) once the chips' face has loaded; every open map repaints on it. */
export const RELMAP_CHIP_FACE_HOOK = "stonetopRelmapChipFace";

/** Measure chips in the board's face from now on (hooks/Ready.js, once). */
export function installChipMeasure(doc = globalThis.document) {
	setChipTextMeasure(canvasChipMeasure(doc, {
		onFaceLoaded: () => Hooks.callAll(RELMAP_CHIP_FACE_HOOK),
	}));
}

const CHIP_FONT_PX = 13;
const CHIP_WEIGHT = 600;
/** `letter-spacing: 0.05em`, which CSS adds after every character, the last one included. */
const CHIP_TRACKING_PX = 0.05 * CHIP_FONT_PX;
const CACHE_MAX = 1024;
const FALLBACK_FAMILY = "\"Libre Caslon Text\", Signika, sans-serif";

/** The family the stylesheet's `--font-stonetop` resolves to, read off the page's root. */
export function boardFontFamily(doc = globalThis.document) {
	try {
		const style = doc?.defaultView?.getComputedStyle?.(doc.documentElement);
		return style?.getPropertyValue?.("--font-stonetop")?.trim() || FALLBACK_FAMILY;
	} catch {
		return FALLBACK_FAMILY;
	}
}

/**
 * A measure for relmap-geometry.js `setChipTextMeasure`: upper-cased words -> board pixels, or `null`
 * while the face has not loaded (a fallback face would measure narrower than what is then drawn).
 * `null` from this factory where there is no canvas at all.
 *
 * A FACE NOT LOADED IS LOADED, BY NAME: a face nothing has painted with yet is not a pending load, so
 * it would never arrive by itself. `onFaceLoaded` is told once it has, so whatever was packed by the
 * table can be packed again.
 *
 * @param {Document} [doc]
 * @param {object} [o]
 * @param {Function} [o.onFaceLoaded]  `() => void`, once a face this had to load has loaded.
 */
export function canvasChipMeasure(doc = globalThis.document, { onFaceLoaded = null } = {}) {
	const ctx = measuringContext(doc);
	if (!ctx || typeof ctx.measureText !== "function") return null;
	const cache = new Map();
	let font = "";
	let ready = false;
	/** The font a load has been asked for, so one face is asked for once. */
	let loading = "";
	// The family is read off the computed style ONCE PER PASS: a board read measures every chip on it in
	// one synchronous run, and a style read per chip would force a style recalc each time. It is read
	// afresh on the next pass, so a setting that changes the sheet font is still followed.
	let family = null;
	const familyNow = () => {
		if (family === null) {
			family = boardFontFamily(doc);
			queueMicrotask(() => { family = null; });
		}
		return family;
	};
	return text => {
		const want = `${CHIP_WEIGHT} ${CHIP_FONT_PX}px ${familyNow()}`;
		if (want !== font) {
			font = want;
			ready = false;
			cache.clear();
		}
		if (!ready) {
			try { ready = doc.fonts?.check ? doc.fonts.check(font, text || "A") : true; } catch { ready = true; }
			if (!ready) {
				loadFace(font);
				return null;
			}
		}
		if (cache.has(text)) return cache.get(text);
		ctx.font = font;
		const width = ctx.measureText(text).width + CHIP_TRACKING_PX * [...text].length;
		if (cache.size >= CACHE_MAX) cache.clear();
		cache.set(text, width);
		return width;
	};

	function loadFace(want) {
		if (loading === want || typeof doc.fonts?.load !== "function") return;
		loading = want;
		doc.fonts.load(want)
			.then(() => {
				if (font === want) onFaceLoaded?.();
				return null;
			})
			// A face that never arrives leaves the table standing in; it may be asked for again.
			.catch(() => { if (loading === want) loading = ""; });
	}
}
