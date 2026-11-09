// The one scratch canvas text is measured on, per page: the relationship map's captions
// (RelationshipMapWindow `captionMeasurer`) and its tag chips (utils/relmap-chip-measure.js).
//
// ONE OF IT, and not one per pass. The captions are measured on every repaint of the board, which is
// every flag write any client makes to the page, and a canvas minted and thrown away each time is an
// allocation on the path this feature has a measured raster budget for. Nothing about it is per-board
// or per-measurer: each sets `ctx.font` before it measures.
//
// Keyed by document because a dialog can be popped out into a second window, and a canvas belongs to
// the document that made it.

const CANVASES = new WeakMap();

/** The page's measuring context, made the first time it is asked for; null where there is no canvas. */
export function measuringContext(doc = globalThis.document) {
	if (!doc || typeof doc !== "object") return null;
	if (CANVASES.has(doc)) return CANVASES.get(doc);
	const ctx = doc.createElement?.("canvas")?.getContext?.("2d") ?? null;
	CANVASES.set(doc, ctx);
	return ctx;
}
