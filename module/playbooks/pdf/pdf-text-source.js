// READ A PDF'S TEXT LAYER INTO POSITIONED RUNS ("PageRuns"), the one input the playbook reader
// (read-playbook.js) works from. The only file in playbooks/pdf/ that talks to pdf.js; everything
// after it is pure and tested on synthetic pages.
//
// The PDF is the GM's own, held in memory for the read and never uploaded or kept. pdf.js is the
// copy Foundry ships (utils/pdfjs-loader.js); a Node script hands in pdfjs-dist of the same version.
//
// FONT NAMES COME FROM THE OPERATOR LIST. `textContent.styles[id].fontFamily` is only pdf.js's
// generic fallback ("sans-serif" for every font in the community playbook template), and the
// reader needs the real name: the template marks its checkboxes and pips with ZapfDingbats
// letters ("n" a box, "l" a pip), and an "n" in Caslon is just the letter. Loading the operator
// list puts each font object in `page.commonObjs`, whose `.name` is the embedded name
// ("GLYMCF+ZapfDingbats", "AFTPKC+ACaslonPro-Bold").
//
// PageRuns: { meta: {author, pageCount},
//             fonts: { <id>: { name } },
//             pages: [{ w, h, runs: [{ str, x, y, w, size, font }] }] }
// x/y: the run's left end and baseline, in points from the page's TOP-left (y grows downward).

/**
 * @param {object} pdfjs  the pdf.js module (getDocument, Util)
 * @param {ArrayBuffer|Uint8Array} data  the PDF's bytes
 * @param {object} [opts]
 * @param {number} [opts.maxPages]  stop after this many pages (a playbook is a few; a rulebook is not one)
 * @returns {Promise<object>} PageRuns
 */
export async function readPageRuns(pdfjs, data, { maxPages = 12 } = {}) {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
	try {
		let info = {};
		try { info = (await doc.getMetadata())?.info ?? {}; } catch { /* no metadata is fine */ }
		const out = {
			meta: {
				// Who made it, as the creator's tool recorded it: credited on the playbook.
				author: String(info.Author ?? "").trim(),
				pageCount: doc.numPages,
			},
			fonts: {},
			pages: [],
		};
		const count = Math.min(doc.numPages, maxPages);
		for (let n = 1; n <= count; n++) {
			const page = await doc.getPage(n);
			const viewport = page.getViewport({ scale: 1 });
			const tc = await page.getTextContent();
			// Loads the page's fonts into commonObjs, so their real names can be read below. The
			// expensive pass, and fonts repeat page to page, so only for a font no earlier page used.
			if (tc.items.some(item => item.fontName && !out.fonts[item.fontName])) await page.getOperatorList();
			const runs = [];
			for (const item of tc.items) {
				if (typeof item.str !== "string" || !item.str) continue;
				const id = item.fontName ?? "";
				if (id && !out.fonts[id]) {
					let name = "";
					try { name = String(page.commonObjs.get(id)?.name ?? ""); } catch { /* not loaded: role falls back to statistics */ }
					out.fonts[id] = { name };
				}
				const t = pdfjs.Util.transform(viewport.transform, item.transform);
				runs.push({
					str: item.str,
					x: round(t[4]),
					y: round(t[5]),
					w: round(item.width ?? 0),
					size: round(Math.hypot(t[2], t[3])),
					font: id,
				});
			}
			out.pages.push({ w: round(viewport.width), h: round(viewport.height), runs });
			page.cleanup?.();
		}
		return out;
	} finally {
		await doc.destroy();
	}
}

const round = v => Math.round(Number(v) * 100) / 100;
