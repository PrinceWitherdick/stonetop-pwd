// A PLAYBOOK'S EMBLEM, TAKEN FROM ITS OWN PDF as the picture the picker and the sheet show for it:
// the stretch beside the playbook's name (read-playbook.js emblemRegion) rendered by pdf.js, the text
// there blanked, the emblem found in what is left (emblem-box.js), and its paper made clear. The PDF
// is the GM's own, read in memory; only the finished picture is kept, as a WebP.
//
// Beside pdf-text-source.js, the one other file in playbooks/pdf/ that talks to pdf.js.

import { emblemBox, inkToAlpha } from "./emblem-box.js";

const SCALE = 4;   // render scale: a 50pt emblem comes out 200px across before it is fitted
const SIZE = 512;  // the picture's side, as the book's playbook icons are about

/**
 * @param {object} pdfjs   the pdf.js module (getDocument)
 * @param {ArrayBuffer|Uint8Array} data  the PDF's bytes
 * @param {{page: number, box: object, mask: object[]}} region  where to look (emblemRegion)
 * @param {{onFound?: function}} [opts]  onFound({page, box}) hears where on the page the emblem was
 *   found, in PDF points from the top left: the cutter (PlaybookEmblemCut.js) starts its square there
 * @returns {Promise<Blob|null>}  a square WebP of the emblem, or null when none was found
 */
export async function renderEmblem(pdfjs, data, region, { onFound = null } = {}) {
	if (!region?.box) return null;
	const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
	const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
	try {
		const page = await doc.getPage(region.page);
		const { box, mask = [] } = region;
		const w = Math.ceil((box.x1 - box.x0) * SCALE), h = Math.ceil((box.y1 - box.y0) * SCALE);
		if (w < 8 || h < 8) return null;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, w, h);
		const viewport = page.getViewport({ scale: SCALE, offsetX: -box.x0 * SCALE, offsetY: -box.y0 * SCALE });
		await page.render({ canvasContext: ctx, viewport }).promise;
		// The words beside it go: only the drawing (and an emblem set as type) is left to find.
		ctx.fillStyle = "#fff";
		for (const m of mask) ctx.fillRect((m.x0 - box.x0) * SCALE, (m.y0 - box.y0) * SCALE, (m.x1 - m.x0) * SCALE, (m.y1 - m.y0) * SCALE);
		const found = emblemBox(ctx.getImageData(0, 0, w, h), { cell: 2, minPx: 18 * SCALE });
		if (!found) return null;
		onFound?.({ page: region.page, box: {
			x0: box.x0 + found.x / SCALE, y0: box.y0 + found.y / SCALE,
			x1: box.x0 + (found.x + found.w) / SCALE, y1: box.y0 + (found.y + found.h) / SCALE,
		} });
		const cut = inkToAlpha(ctx.getImageData(found.x, found.y, found.w, found.h));
		const piece = document.createElement("canvas");
		piece.width = found.w;
		piece.height = found.h;
		piece.getContext("2d").putImageData(cut, 0, 0);
		// Square, centred, a little room round it.
		const out = document.createElement("canvas");
		out.width = out.height = SIZE;
		const fit = (SIZE * 0.94) / Math.max(found.w, found.h);
		const dw = found.w * fit, dh = found.h * fit;
		const octx = out.getContext("2d");
		octx.imageSmoothingQuality = "high";
		octx.drawImage(piece, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
		return await new Promise(resolve => out.toBlob(resolve, "image/webp", 0.9));
	} finally {
		await doc.destroy();
	}
}
