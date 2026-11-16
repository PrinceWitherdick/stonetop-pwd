// FIND A PLAYBOOK'S EMBLEM IN A RENDERED STRETCH OF ITS PAGE (pdf-emblem.js renders it, with the
// text there already blanked): the drawing that is most like an emblem, the largest roughly square
// shape of ink (the ring around the Stranger's raven), with every piece of ink inside it (the raven).
// A rule or a ragged border is long and thin, so it is never the one picked. Pure: pixels in, a box
// out, so it is tested on made-up images.

const INK = 160; // brighter than this is paper

/**
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img  RGBA pixels (ImageData)
 * @param {object} [opts]
 * @param {number} [opts.cell]   pixels per grid cell the search runs on (speed; 1 = every pixel)
 * @param {number} [opts.minPx]  the least width and height an emblem may have, in pixels
 * @returns {{x: number, y: number, w: number, h: number}|null}  in pixels
 */
export function emblemBox(img, { cell = 2, minPx = 40 } = {}) {
	const { width, height, data } = img;
	const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
	const ink = new Uint8Array(gw * gh);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (data[i + 3] < 128) continue;
			if ((data[i] + data[i + 1] + data[i + 2]) / 3 < INK) ink[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
		}
	}
	// The shapes of ink, each a run of touching cells (8 ways round).
	const seen = new Uint8Array(gw * gh);
	const shapes = [];
	for (let start = 0; start < ink.length; start++) {
		if (!ink[start] || seen[start]) continue;
		const s = { n: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
		const stack = [start];
		seen[start] = 1;
		while (stack.length) {
			const k = stack.pop();
			const x = k % gw, y = (k - x) / gw;
			s.n++;
			if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
			if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
				const nk = ny * gw + nx;
				if (ink[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
			}
		}
		shapes.push(s);
	}
	const minCells = Math.max(2, Math.ceil(minPx / cell));
	const w = s => s.x1 - s.x0 + 1, h = s => s.y1 - s.y0 + 1;
	const squarish = shapes.filter(s => w(s) >= minCells && h(s) >= minCells && Math.max(w(s), h(s)) / Math.min(w(s), h(s)) <= 2.5);
	if (!squarish.length) return null;
	const main = squarish.sort((a, b) => w(b) * h(b) - w(a) * h(a))[0];
	// Everything inside it, a little room round the edge allowed (a raven's wing past its ring).
	const padX = Math.ceil(w(main) * 0.08), padY = Math.ceil(h(main) * 0.08);
	const box = { x0: main.x0, y0: main.y0, x1: main.x1, y1: main.y1 };
	for (const s of shapes) {
		if (s === main) continue;
		const inside = s.x0 >= main.x0 - padX && s.x1 <= main.x1 + padX && s.y0 >= main.y0 - padY && s.y1 <= main.y1 + padY;
		if (!inside) continue;
		// In that room, a loose piece wholly above or below it is a rule running past (the speckle of the
		// Abhorsen's, under its header), never the emblem's own: what pokes out of a ring (a wing, a
		// tail) pokes out at its side, level with it.
		if (s.y0 > main.y1 || s.y1 < main.y0) continue;
		box.x0 = Math.min(box.x0, s.x0); box.y0 = Math.min(box.y0, s.y0);
		box.x1 = Math.max(box.x1, s.x1); box.y1 = Math.max(box.y1, s.y1);
	}
	const x = box.x0 * cell, y = box.y0 * cell;
	return { x, y, w: Math.min(width, (box.x1 + 1) * cell) - x, h: Math.min(height, (box.y1 + 1) * cell) - y };
}

/**
 * Paper to clear, ink kept: each pixel's opacity from how dark it is, its colour kept, so the emblem
 * sits on any background as the book's playbook icons do. Mutates `img`.
 */
export function inkToAlpha(img) {
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
		const a = Math.max(0, Math.min(255, Math.round((235 - lum) * 255 / 200)));
		d[i + 3] = Math.min(d[i + 3], a);
	}
	return img;
}
