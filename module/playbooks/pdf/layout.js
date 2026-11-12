// PageRuns (pdf-text-source.js) -> COLUMNS OF LINES, in reading order. PURE.
//
// What it relies on, read off the community "Stonetop Playbook Template" (Affinity Publisher) that
// third-party playbooks are made from, and kept loose enough for a hand-made look-alike:
//   - a line is a row of runs that ABUT: the template writes word spaces as runs of their own, so
//     a gap wider than about half the type size is never inside a line. It is a gutter, or a
//     right-hand piece of the same column ("CURSED ... Doom ●●●"), told apart below;
//   - a page is two to four columns, each starting at a steady left edge;
//   - checkboxes and pips are LETTERS in a dingbat font: "n" a box, "4" a tick, "l" a pip, "u" a
//     diamond. Only a run in a dingbat font becomes a widget; an "n" in Caslon is the letter n.
//
// It must not depend on the ORDER pdf.js hands runs over (a PDF may write its text in any order),
// so everything is rebuilt from positions.

/** What a font does on the page, from its embedded name ("AFTPKC+ACaslonPro-Bold"). */
export function fontRole(name) {
	const n = String(name ?? "").replace(/^[A-Z]{6}\+/, "");
	if (/dingbat/i.test(n)) return "dingbat";
	if (/avara/i.test(n)) return "heading";
	const bold = /(semi|demi|extra)?bold|black|heavy/i.test(n);
	const italic = /italic|oblique/i.test(n);
	if (bold && italic) return "bolditalic";
	if (bold) return "bold";
	if (italic) return "italic";
	return "body";
}

/**
 * The font roles for a PageRuns. A font with no readable name is judged by what it draws: one
 * whose runs are nearly all lone box/pip letters is a dingbat font (the template's are named, a
 * look-alike's may not be).
 */
export function fontRoles(pageRuns) {
	const roles = {};
	const counts = {};
	for (const page of pageRuns?.pages ?? []) {
		for (const r of page.runs) {
			const c = counts[r.font] ??= { all: 0, widgety: 0 };
			c.all++;
			if (/^[nl4u\s]+$/.test(r.str)) c.widgety++;
		}
	}
	for (const [id, info] of Object.entries(pageRuns?.fonts ?? {})) {
		const named = fontRole(info?.name);
		const c = counts[id];
		roles[id] = (!info?.name && c && c.all >= 5 && c.widgety / c.all > 0.9) ? "dingbat" : named;
	}
	return roles;
}

const BASELINE_TOLERANCE = 0.35; // × type size: runs this close vertically share a baseline
const ABUT_GAP = 0.6;            // × type size: a wider horizontal gap ends a segment
const COLUMN_MERGE = 24;         // points: left edges this close are one column (indents)
const MIN_COLUMN_LINES = 4;      // a left edge needs this many lines to be a column
const SUBCOLUMN_MAX_LINES = 12;  // a "column" this short, on its neighbour's baselines, is a second row of options

/**
 * A widget token for a dingbat run: { box, ticked, pips } counts.
 */
function widgetOf(str) {
	const s = str.replace(/\s+/g, "");
	return {
		box: (s.match(/n/g) ?? []).length,
		ticked: (s.match(/4/g) ?? []).length,
		pips: (s.match(/l/g) ?? []).length,
	};
}

/**
 * Lay one page out.
 * @returns {Array<{left: number, lines: Line[]}>} columns, left to right
 *
 * Line: { y, x, size, parts: [{ text, role, x, w, size }], text, lead: {boxes, ticked},
 *         pips: [{ count, label, x }], headingText, maxSize }
 */
export function layoutPage(page, roles) {
	const runs = (page?.runs ?? [])
		.filter(r => r.str && r.str.length)
		.map(r => ({ ...r, role: roles[r.font] ?? "body" }))
		.sort((a, b) => a.y - b.y || a.x - b.x);

	// 1. Rows: runs sharing a baseline.
	const rows = [];
	for (const r of runs) {
		// From the newest row back: runs come sorted by y, so the row a run joins is nearly always the last.
		const row = rows.findLast(rw => Math.abs(rw.y - r.y) <= BASELINE_TOLERANCE * Math.max(rw.size, r.size));
		if (row) { row.runs.push(r); row.size = Math.max(row.size, r.size); }
		else rows.push({ y: r.y, size: r.size, runs: [r] });
	}

	// 2. Segments: abutting runs within a row.
	const segments = [];
	for (const row of rows) {
		row.runs.sort((a, b) => a.x - b.x);
		let seg = null;
		for (const r of row.runs) {
			const gap = seg ? r.x - (seg.end) : Infinity;
			if (!seg || gap > ABUT_GAP * Math.max(r.size, 6)) {
				seg = { y: row.y, x: r.x, end: r.x + r.w, runs: [r] };
				segments.push(seg);
			} else {
				seg.runs.push(r);
				seg.end = Math.max(seg.end, r.x + r.w);
			}
		}
	}

	// 3. Columns: steady left edges.
	const starts = new Map();
	for (const s of segments) {
		const k = Math.round(s.x);
		starts.set(k, (starts.get(k) ?? 0) + 1);
	}
	const candidates = [...starts.entries()].filter(([, n]) => n >= 2).sort((a, b) => a[0] - b[0]);
	const groups = [];
	for (const [x, n] of candidates) {
		const g = groups[groups.length - 1];
		if (g && x - g.last <= COLUMN_MERGE) { g.last = x; g.n += n; }
		else groups.push({ left: x, last: x, n });
	}
	let lefts = groups.filter(g => g.n >= MIN_COLUMN_LINES).map(g => g.left);
	if (!lefts.length) lefts = [0];
	lefts[0] = Math.min(lefts[0], ...segments.map(s => s.x));

	const columns = lefts.map(left => ({ left, segments: [] }));
	for (const s of segments) {
		let i = 0;
		for (let c = 0; c < lefts.length; c++) if (s.x >= lefts[c] - 2) i = c;
		columns[i].segments.push(s);
	}

	// 3b. A short "column" every line of which sits on a baseline the column to its left also uses
	// is not a column: it is the right half of options set two to a row ("☐ To challenge rivals
	// ☐ To be worshiped"). Fold it back, so each row reads as one line of options.
	// The template's columns all sit on one baseline grid, so sharing baselines is not enough: the
	// half-row must also be options, each line opening on a checkbox.
	const opensOnBox = s => s.runs[0]?.role === "dingbat" && /n/.test(s.runs[0].str);
	for (let c = columns.length - 1; c > 0; c--) {
		const mine = [...new Set(columns[c].segments.map(s => Math.round(s.y)))];
		if (!mine.length || mine.length > SUBCOLUMN_MAX_LINES) continue;
		const boxed = columns[c].segments.filter(opensOnBox).length / columns[c].segments.length;
		if (boxed < 0.8) continue;
		// ...and the line it would join must be an option row too ("☐ To challenge rivals"), not
		// whatever the neighbouring column happens to print on that baseline.
		const left = columns[c - 1].segments.filter(opensOnBox);
		const shared = mine.filter(y => left.some(s => Math.abs(s.y - y) <= 1.5)).length;
		if (shared / mine.length >= 0.8) {
			columns[c - 1].segments.push(...columns[c].segments);
			columns.splice(c, 1);
		}
	}

	// 4. Lines: a column's segments on one baseline join (the right-hand piece keeps its x).
	return columns.map(col => {
		const lines = [];
		for (const s of col.segments.sort((a, b) => a.y - b.y || a.x - b.x)) {
			const line = lines.findLast(l => Math.abs(l.y - s.y) <= 1.5);
			if (line) line.segs.push(s);
			else lines.push({ y: s.y, segs: [s] });
		}
		return { left: col.left, lines: lines.map(l => buildLine(l, col.left)) };
	});
}

function buildLine(raw, columnLeft) {
	const parts = [];
	for (const seg of raw.segs.sort((a, b) => a.x - b.x)) {
		if (parts.length) parts.push({ text: " ", role: "gap", x: seg.x, w: 0, size: 0 });
		for (const r of seg.runs) {
			const last = parts[parts.length - 1];
			// Runs of one face merge, dingbats too: a pip row is often written one "l" at a time,
			// and "n" + "4" (a ticked box) arrive as two runs.
			if (last && last.role === r.role && last.role !== "gap") {
				last.text += r.str;
				last.w = r.x + r.w - last.x;
			} else {
				parts.push({ text: r.str, role: r.role, x: r.x, w: r.w, size: r.size });
			}
		}
	}
	const x = raw.segs[0].x;
	const maxSize = Math.max(...parts.map(p => p.size));

	// Leading widgets: the boxes before the first word ("n", "n4", "n n n").
	let boxes = 0, ticked = 0, i = 0;
	while (i < parts.length && (parts[i].role === "dingbat" || !parts[i].text.trim())) {
		if (parts[i].role === "dingbat") {
			const w = widgetOf(parts[i].text);
			if (w.pips && !w.box) break;
			boxes += w.box;
			ticked += w.ticked;
		}
		i++;
	}

	// Pip tracks anywhere on the line, each with the word just before it ("Fear ●●●●").
	const pips = [];
	parts.forEach((p, idx) => {
		if (p.role !== "dingbat") return;
		const w = widgetOf(p.text);
		if (!w.pips) return;
		let label = "";
		for (let j = idx - 1; j >= 0; j--) {
			if (parts[j].role === "gap") break;
			if (parts[j].role === "dingbat") break;
			label = parts[j].text.trim().split(/\s+/).pop() ?? "";
			if (label) break;
		}
		pips.push({ count: w.pips, label, x: p.x });
	});

	const text = parts.map(p => p.role === "dingbat" ? "" : p.text).join("").replace(/\s+/g, " ").trim();
	const headingText = parts.filter(p => p.role === "heading").map(p => p.text).join("").replace(/\s+/g, " ").trim();
	return {
		y: raw.y,
		x,
		indent: Math.max(0, x - columnLeft),
		parts,
		text,
		headingText,
		maxSize,
		lead: { boxes, ticked: ticked > 0 },
		pips,
	};
}

/** Every page laid out. */
export function layoutDocument(pageRuns) {
	const roles = fontRoles(pageRuns);
	return { pages: (pageRuns?.pages ?? []).map(p => ({ w: p.w, h: p.h, columns: layoutPage(p, roles) })) };
}
