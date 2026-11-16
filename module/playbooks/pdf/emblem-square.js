// THE SQUARE THE EMBLEM CUTTER STARTS ON, AND HOW IT CUTS IT (PlaybookEmblemCut.js). Pure geometry,
// no pdf.js and no DOM, so it is tested on its own.
//
// A square is a rect in the portrait framer's terms (utils/portrait-frame.js): [x0, y0, x1, y1] as
// fractions of the page's width and height. On a page that isn't square the two spans differ while
// the square is square in points.

/** Room left round an emblem found by the importer, as a share of its larger side. */
const PAD = 0.08;

/**
 * A square round a box on the page, padded a little, kept on the page.
 * @param {{x0:number,y0:number,x1:number,y1:number}} box  PDF points from the top left
 * @param {number} pageW  the page's width in points
 * @param {number} pageH  its height
 * @returns {number[]|null}  the rect, or null for a box that isn't one
 */
export function squareAround(box, pageW, pageH) {
	if (!box || !(pageW > 0) || !(pageH > 0)) return null;
	const w = box.x1 - box.x0, h = box.y1 - box.y0;
	if (!(w > 0) || !(h > 0)) return null;
	const side = Math.min(Math.max(w, h) * (1 + PAD * 2), pageW, pageH);
	const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
	const x0 = Math.min(Math.max(cx - side / 2, 0), pageW - side);
	const y0 = Math.min(Math.max(cy - side / 2, 0), pageH - side);
	return [x0 / pageW, y0 / pageH, (x0 + side) / pageW, (y0 + side) / pageH];
}

/**
 * Where to start with nothing found: the top right of the page, where the community template prints
 * the emblem beside the playbook's name, a sixth of the page's width across.
 */
export function defaultSquare(pageW, pageH) {
	if (!(pageW > 0) || !(pageH > 0)) return null;
	const side = Math.min(pageW / 6, pageH);
	const x0 = pageW - side - pageW * 0.02;
	const y0 = Math.min(pageH * 0.02, pageH - side);
	return [x0 / pageW, y0 / pageH, (x0 + side) / pageW, (y0 + side) / pageH];
}

/**
 * How to render a chosen square so the picture it makes is sharp: its top left and side in points,
 * and the render scale that puts at least `out` pixels across it (twice that, then drawn down, for
 * clean edges), capped so a tiny square doesn't ask for a huge canvas.
 * @returns {{x0:number, y0:number, side:number, scale:number, px:number}|null}
 */
export function cutPlan(rect, pageW, pageH, out = 512) {
	if (!Array.isArray(rect) || rect.length !== 4 || !(pageW > 0) || !(pageH > 0)) return null;
	const x0 = rect[0] * pageW, y0 = rect[1] * pageH;
	const side = (rect[2] - rect[0]) * pageW;
	if (!(side > 0)) return null;
	const scale = Math.min(Math.max((out * 2) / side, 2), 24);
	return { x0, y0, side, scale, px: Math.ceil(side * scale) };
}
