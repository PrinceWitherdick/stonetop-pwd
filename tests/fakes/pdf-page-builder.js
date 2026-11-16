// Synthetic PageRuns (module/playbooks/pdf/pdf-text-source.js) for the playbook reader's tests,
// laid out the way the community "Stonetop Playbook Template" lays a page out: columns of lines,
// each line a row of ABUTTING runs (word spaces are runs of their own), checkboxes and pips as
// ZapfDingbats letters. No third-party playbook text: every fixture is written here.
//
// A line is a list of tokens: a string is body text, or { t, f } with f one of
// "heading" | "body" | "bold" | "bi" (bold italic) | "italic" | "ding". Helpers below build the
// common shapes (a checkbox item, a heading with a note, pips).

export const FONTS = {
	heading: { id: "f1", name: "Avara-Bold" },
	body: { id: "f2", name: "AAAAAA+ACaslonPro-Regular" },
	bold: { id: "f3", name: "BBBBBB+ACaslonPro-Bold" },
	bi: { id: "f4", name: "CCCCCC+ACaslonPro-BoldItalic" },
	italic: { id: "f5", name: "DDDDDD+ACaslonPro-Italic" },
	ding: { id: "f6", name: "EEEEEE+ZapfDingbats" },
};

// Caslon at 8pt averages about 3.3pt a character: a 176pt column holds some 50.
const CHAR_W = 3.3;

export const H = (title, note = "", size = 10) => ({ heading: true, size, tokens: [{ t: title, f: "heading" }, ...(note ? [{ t: " ", f: "heading" }, note] : [])] });
export const BOX = (...rest) => [{ t: "n", f: "ding" }, { t: " ", f: "ding" }, ...rest];
export const TICK = (...rest) => [{ t: "n4", f: "ding" }, { t: " ", f: "ding" }, ...rest];
export const BOXES = (n, ...rest) => [{ t: Array(n).fill("n").join(" "), f: "ding" }, { t: " ", f: "ding" }, ...rest];
export const B = t => ({ t, f: "bold" });
export const BI = t => ({ t, f: "bi" });
export const I = t => ({ t, f: "italic" });
export const PIPS = n => ({ t: Array(n).fill("l").join(" "), f: "ding" });

/**
 * @param {Array<{columns: Array<{x: number, y?: number, lines: Array}>}>} pages
 *   each line is a token array, an H(...) heading, or { gap: n } (extra space), or { indent, tokens }
 * @param {object} [opts]
 * @param {boolean} [opts.shuffle]  hand the runs over in a scrambled order, as a PDF may
 */
export function buildPageRuns(pages, { shuffle = true, meta = {} } = {}) {
	const fonts = Object.fromEntries(Object.values(FONTS).map(f => [f.id, { name: f.name }]));
	const out = { meta: { producer: "test", creator: "", title: "Stonetop Playbook Template", pageCount: pages.length, ...meta }, fonts, pages: [] };
	for (const page of pages) {
		const runs = [];
		for (const col of page.columns) {
			let y = col.y ?? 40;
			for (const raw of col.lines) {
				if (raw && raw.gap) { y += raw.gap; continue; }
				const line = Array.isArray(raw) ? { tokens: raw } : raw;
				const size = line.size ?? 8;
				let x = col.x + (line.indent ?? 0);
				for (const tok of line.tokens) {
					const t = typeof tok === "string" ? { t: tok, f: "body" } : tok;
					const font = FONTS[t.f] ?? FONTS.body;
					// Split body text into words and space runs, as the template writes them.
					const pieces = t.f === "ding" ? [t.t] : t.t.split(/( )/).filter(Boolean);
					// A token may set its own size: an insert title's flavour run on in body type, a nested
					// option's smaller box.
					const tsize = t.size ?? size;
					for (const piece of pieces) {
						const w = piece.length * CHAR_W * (tsize / 8);
						runs.push({ str: piece, x, y, w, size: tsize, font: font.id });
						x += w;
					}
				}
				y += line.heading ? 19 : 9.5;
			}
		}
		if (shuffle) runs.sort((a, b) => ((a.x * 7919 + a.y * 104729) % 97) - ((b.x * 7919 + b.y * 104729) % 97));
		out.pages.push({ w: 792, h: 612, runs });
	}
	return out;
}
