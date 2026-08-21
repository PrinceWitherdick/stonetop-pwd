import { describe, it, expect } from "vitest";
import { readRepo as read } from "../fakes/css.js";
import { DURABLE_ART_DIRS } from "../../module/book2-art/browse.js";

// The GM playbook as a THIRD optional PDF the Import Book Art macro can read (`book: 3`).
//
// It is worth reading even for a GM who owns both rulebooks: it prints the Village, Vicinity and
// World's End maps at a true 300 dpi, where Book I embeds the village map at 478x272 and Book II
// the other two at ~700px, and it is the only PDF carrying the core-loop and flow-of-play
// diagrams. Everything asserted here fails silently if it breaks — an unlabelled book field, a
// row whose target folder is never created, a render capped below what the row asked for — so
// this file reads the SHIPPED macro command rather than any local copy of its source.


const COMMAND = JSON.parse(read("packs/src/stonetop-macros/import-book2-art.json")).command;

/** The manifest literal the shipped macro carries, extracted the way art-match-fallback does. */
function macroManifest() {
	const marker = COMMAND.indexOf("/*__MANIFEST__*/");
	const start = COMMAND.indexOf("{", marker);
	let depth = 0;
	for (let i = start; i < COMMAND.length; i++) {
		const c = COMMAND[i];
		if (c === "{") depth++;
		else if (c === "}" && --depth === 0) return JSON.parse(COMMAND.slice(start, i + 1));
	}
	throw new Error("could not find the manifest literal in the Import Book Art macro");
}

const MANIFEST = macroManifest();
const ROWS = MANIFEST.rows ?? [];
const GM_ROWS = ROWS.filter(r => r.book === 3);
const RENDERED = ROWS.filter(r => r.render === "region");
const DIAGRAMS = ROWS.filter(r => r.kind === "diagram");
/** A pagemap row owns a Setting Overview page only if it names one. */
const PAGE_OWNERS = ROWS.filter(r => r.kind === "pagemap" && r.soEntryId && r.soPageId);

/** A CONFIG number read out of the macro that ships, not out of a copy of it. */
function configNumber(name) {
	const m = COMMAND.match(new RegExp(`\\b${name}:\\s*([0-9.]+)`));
	expect(m, `CONFIG.${name} is not declared in the macro`).not.toBeNull();
	return Number(m[1]);
}

/** The source of one top-level function in the shipped macro, brace-matched out of the command. */
function macroFunction(name) {
	const start = COMMAND.indexOf(`async function ${name}(`);
	expect(start, `${name} is not declared in the macro`).toBeGreaterThan(-1);
	// Anchored on the end of the PARAMETER LIST rather than the first "{" after the name: a
	// signature that grows a destructured option (`function f(doc, { probes = 5 } = {})`) would
	// otherwise match the parameter brace and hand back a truncated function, which fails at parse
	// with an error naming nothing.
	const body = COMMAND.indexOf(") {", start);
	expect(body, `${name} has a signature this matcher cannot anchor on`).toBeGreaterThan(-1);
	let depth = 0;
	for (let i = body + 2; i < COMMAND.length; i++) {
		const c = COMMAND[i];
		if (c === "{") depth++;
		else if (c === "}" && --depth === 0) return COMMAND.slice(start, i + 1);
	}
	throw new Error(`could not find the end of ${name} in the Import Book Art macro`);
}

/** A pdf.js document stub: one [width, height] in points per page, in order. */
const fakeDoc = (sizes) => ({
	numPages: sizes.length,
	async getPage(p) {
		const [width, height] = sizes[p - 1];
		if (!sizes[p - 1]) throw new Error(`no page ${p}`);
		return { getViewport: () => ({ width, height }), cleanup() {} };
	},
});

/** The macro's own edition detector, lifted out of the shipped command and run for real. */
let lifted;
const pdfLayout = (doc) => {
	// Lifted on first use rather than at import. A lift that throws at module scope takes the whole
	// file down with it, including the seventeen manifest, rect and index assertions that have
	// nothing to do with edition detection, and reports "no tests" instead of naming the cause.
	lifted ??= new Function(`${macroFunction("pdfLayout")}; return pdfLayout;`)();
	return lifted(doc);
};

/** Both rulebooks: a half-width portrait cover, N landscape spreads, a half-width back cover. */
const spreadsBook = (pages) =>
	fakeDoc([[396, 612], ...Array.from({ length: pages - 2 }, () => [792, 612]), [396, 612]]);

describe("the GM playbook as a third source", () => {
	it("contributes the three maps and the two diagrams", () => {
		expect(GM_ROWS.map(r => r.slug)).toEqual([
			"gm-village", "gm-vicinity", "gm-worlds-end", "core-loop", "flow-of-play",
		]);
	});

	// Every label the dialog and the console messages use comes out of one BOOKS table. Without an
	// entry the fallback spells the label from the number, and a GM is asked for "Book 3".
	it("is named in the macro's book table rather than numbered", () => {
		expect(COMMAND).toMatch(/3:\s*\{\s*title:\s*"GM playbook"/);
		expect(COMMAND).toContain('label: "the GM playbook"');
		expect(COMMAND).not.toMatch(/Book \$\{roman\(book\)\}/);
	});

	// The file field is rendered for every book the ROWS reference, so a manifest with book-3 rows
	// and no way to supply a book-3 PDF fails every one of them with "not provided".
	it("earns a file field, and a page count to check the file against", () => {
		expect(COMMAND).toContain("MANIFEST.rows.map((r) => r.book ?? 2)");
		expect(MANIFEST.meta.expectedPdfPagesGm).toBe(12);
		expect(COMMAND).toContain('expected: "expectedPdfPagesGm"');
	});

	// Vector flowcharts and text-labelled maps both have to be RENDERED from the page: a stencil
	// lift takes the image object and leaves the text behind, and on page 12 there is no image
	// object at all.
	it("renders every one of its rows from a page rect", () => {
		for (const r of GM_ROWS) {
			expect(r.render, r.slug).toBe("region");
			expect(Array.isArray(r.rect) && r.rect.length === 4, r.slug).toBe(true);
			expect(r.rect[2] > r.rect[0] && r.rect[3] > r.rect[1], `${r.slug} rect is inside out`).toBe(true);
		}
	});

	// The ceiling is applied as min(PAGEMAP_MAXDIM, row.nlong), so a row asking for more than the
	// cap is silently downscaled — the exact failure that made a 300 dpi map come out at 2000px.
	it("is not capped below what its rows ask for", () => {
		const cap = configNumber("PAGEMAP_MAXDIM");
		for (const r of RENDERED) {
			expect(r.nlong ?? cap, `${r.slug} asks for more than PAGEMAP_MAXDIM`).toBeLessThanOrEqual(cap);
		}
		// And the GM maps really do ask for more than the old 2000 cap, or this guard proves nothing.
		expect(Math.max(...GM_ROWS.filter(r => r.kind === "pagemap").map(r => r.nlong))).toBeGreaterThan(2000);
	});

	// Three lists have to name the folder or the files are written and then never seen again: the
	// macro creates it, the macro's own inventory lists it (SKIP_EXISTING), and the runtime browse
	// lists it (the index refresh).
	it("writes into folders the macro creates and both sides browse", () => {
		for (const r of GM_ROWS) {
			const dir = r.out.slice(0, r.out.lastIndexOf("/"));
			expect(COMMAND, `${dir} is never created`).toContain(`ensureDir(\`\${CONFIG.ROOT}/${dir}\`)`);
			expect(COMMAND, `${dir} is not inventoried`).toContain(`"${dir}"`);
			expect(DURABLE_ART_DIRS, `${dir} is not browsed at runtime`).toContain(dir);
		}
	});
});

describe("the Setting Overview preference chains", () => {
	// The GM playbook's maps are extraction-only: they are a sharper file for a page a Book II row
	// already owns. Two rows owning one page would fight, since a page holds one managed figure.
	it("keeps one owner per page, with the GM maps owning none", () => {
		const pages = PAGE_OWNERS.map(r => r.soPageId);
		expect(new Set(pages).size).toBe(pages.length);
		for (const r of GM_ROWS) expect(r.soPageId, r.slug).toBeUndefined();
	});

	it("skips rows that own no page rather than asking the pack for undefined", () => {
		expect(COMMAND).toContain("if (!p.soEntryId || !p.soPageId) continue;");
	});

	// The chain is what makes a GM who owns more PDFs see a better picture, and a GM who owns
	// fewer keep the one they have.
	it("leads each chain with the GM playbook's file and ends it with the poster map", () => {
		expect(PAGE_OWNERS.length).toBeGreaterThan(0);
		for (const r of PAGE_OWNERS) {
			expect(Array.isArray(r.prefer), `${r.slug} states no chain`).toBe(true);
			expect(r.prefer[0], `${r.slug} does not lead with the GM playbook`).toMatch(/^assets\/maps\/gm-/);
			expect(r.prefer.at(-1), `${r.slug} does not fall back to a poster map`).toMatch(/^assets\/maps\/map-/);
			// Every link is a file something actually produces, or the chain has a dead rung that
			// can never be picked and quietly shortens by one.
			for (const link of r.prefer) {
				const produced = ROWS.some(x => x.out === link)
					|| ROWS.some(x => (x.images ?? []).some(im => im.out === link))
					|| (MANIFEST.maps ?? []).some(m => m.out === link);
				expect(produced, `${r.slug}: nothing ever writes ${link}`).toBe(true);
			}
		}
	});

	it("resolves the chain through one shared helper on both sides", () => {
		expect(COMMAND).toContain("const pageChain = (p) =>");
		expect(COMMAND).toContain("const chain = pageChain(p);");
	});
});

describe("the diagrams the toolkit shows", () => {
	it("both come off the playbook's last spread, side by side", () => {
		expect(DIAGRAMS).toHaveLength(2);
		for (const d of DIAGRAMS) expect(d.pdfPage, d.slug).toBe(12);
		const [core, flow] = DIAGRAMS;
		// Non-overlapping halves of one landscape spread; an overlap means one crop carries part
		// of the other diagram, which no assertion on size would catch.
		expect(core.rect[2]).toBeLessThanOrEqual(flow.rect[0]);
	});

	// The playbook is published twice: the 12-page "spreads" PDF and a 1-up booklet, one printed
	// page per portrait sheet, which is the download the publisher's page offers first. Read as a
	// spread, a 1-up file takes its crops off the wrong page entirely, and every rect past the
	// middle of a sheet falls off the paper and rasterises as blank white.
	it("reads a 1-up playbook by stitching each sheet back out of its page pair", async () => {
		// Detected from the shape of the paper, not the page count: a printing may add a cover.
		const booklet = await pdfLayout(fakeDoc(Array.from({ length: 25 }, () => [396, 612])));
		expect(booklet.oneUp).toBe(true);
		// Sheet S is 1-up pages 2S and 2S+1, offset by whatever front matter the file carries.
		expect(COMMAND).toContain("const left = 2 * sheet + layout.offset;");
		expect(COMMAND).toContain("return [left, left + 1];");
		// ...and the pair is drawn onto ONE canvas, so a rect that crosses the gutter (all three
		// regional maps do) still means what it says.
		expect(COMMAND).toContain("const pages = Array.isArray(page) ? page : [page];");
		expect(COMMAND).toContain("sheetX += viewport.width / scale;");
	});

	// ...and each page of a pair draws onto a sheet of ITS OWN before being composited in.
	//
	// pdf.js opens every render by filling the WHOLE target canvas with its background
	// (`CanvasGraphics#beginDrawing`: `fillStyle = background || "#ffffff"; fillRect(0, 0, width,
	// height)`), so two pages rendered into one context are not two pages — the second one's fill
	// erases the first. The sheet came back blank down its left half: the entire core-loop chart,
	// and the left page of all three regional maps, gone with nothing logged.
	it("composites the pair rather than rendering both into one context", () => {
		// The render TARGET, and nothing whatever about how the call is made. What must not regress
		// is the canvas each page of a pair paints onto; this assertion has now been broken twice by
		// changes that preserved that perfectly (a watchdog wrapped round the render, then a
		// renderPage helper), and each time it reported a regression that did not exist. So it is
		// pinned to the substring that IS the invariant and to nothing else.
		expect(COMMAND).toContain(`canvasContext: one.getContext("2d")`);
		expect(COMMAND).toContain("ctx.drawImage(one, Math.round(dx), Math.round(dy));");
		// Deliberately NO "and never renders a pair into ctx" assertion. `ctx` is a local name this
		// macro reuses in several unrelated renders (the picker thumbnail has its own), so a
		// negative on it fails on code that has nothing to do with pairs. The positive pair above
		// is the invariant; a regression to the shared context necessarily deletes it.
		// A lone page still renders straight into the crop at its exact fractional offset. That is
		// every row of both rulebooks, and re-cutting all 545 of them a pixel over is not free.
		expect(COMMAND).toContain("if (pages.length === 1) {");
		expect(COMMAND).toContain("transform: [1, 0, 0, 1, dx, dy]");
	});

	// The offset is READ off the file rather than assumed, and the words that anchor it have to be
	// the ones that appear on the flowchart page and nowhere else — "core loop" alone is also the
	// agenda page and the contents list, which would anchor 22 pages early.
	it("anchors a 1-up file on the one page it can name by its own words", () => {
		expect(COMMAND).toContain('words: ["core loop", "establish situation"]');
		expect(COMMAND).toContain("if (!ONE_UP_ANCHOR.words.every((w) => text.includes(w))) continue;");
		// Whitespace-insensitive: whether pdf.js hands a two-word label back as one item or two
		// is a detail of the file, and a phrase must not stop matching because of it.
		expect(COMMAND).toContain('.replace(/\\s+/g, " ").toLowerCase()');
	});

	// Only the playbook may be read 1-up. A rulebook's rows LIFT their art by size and placement on
	// a numbered page, so a re-paginated file would not fail — it would fill a world with the wrong
	// pictures, which is worse. Refused, and said out loud.
	it("refuses a 1-up rulebook rather than mis-extracting it", () => {
		expect(COMMAND).toMatch(/note: "sharper maps, plus the core loop & flow of play", oneUp: true/);
		expect(COMMAND).toContain("if (layout.oneUp && !BOOKS[book]?.oneUp) {");
		expect(COMMAND).toContain('is the 1-up edition (one page per sheet)');
		// Book I and Book II must NOT carry the flag, or that guard passes them straight through.
		expect(COMMAND).not.toMatch(/label: "Book I(I)?",[^}]*oneUp: true/);
	});

	// The regression that made the macro unusable for its main job: a "spreads" rulebook is NOT
	// landscape from end to end. Book I and Book II each open on a single half-width portrait cover
	// and close on another, so an edition read off page 1 alone was declared 1-up and refused, and
	// with both books skipped the run ended on "no usable book PDF provided". The GM playbook's
	// spreads edition has no separate cover, which is why it was the one file that still imported,
	// and why the fault looked like a problem with the rulebooks rather than with the detector.
	it("does not mistake a rulebook's portrait cover for a 1-up edition", async () => {
		for (const [label, pages] of [["Book I", 308], ["Book II", 302]]) {
			const layout = await pdfLayout(spreadsBook(pages));
			expect(layout.oneUp, `${label} was read as a 1-up edition`).toBe(false);
			// And it reports the spread it judged, not the cover it read past, so the log a GM is
			// asked for names the paper the verdict actually came from.
			expect([layout.width, layout.height], label).toEqual([792, 612]);
			// The evidence the console line is built from: five pages sampled, no cover among them,
			// and a unanimous verdict. A GM who pastes that line has said what their file is.
			expect(layout.probes, label).toHaveLength(5);
			expect(layout.probes.includes(1) || layout.probes.includes(pages), `${label} sampled a cover`).toBe(false);
			expect([layout.portrait, layout.landscape], label).toEqual([0, 5]);
		}
		// The playbook's spreads edition is landscape from page 1 and stays unaffected.
		expect((await pdfLayout(fakeDoc(Array.from({ length: 12 }, () => [792, 612])))).oneUp).toBe(false);
		// A booklet that carries one landscape foldout is still a booklet, and a spreads book whose
		// front matter runs to a second portrait page is still spreads. Both strays sit on PAGE 2,
		// which is deliberate: page 2 is the first page sampled, so these are the cases that tell a
		// majority apart from a detector that trusts a single page. Reading one page was the whole
		// of the original bug, and a rule that samples one page one place to the right of the cover
		// would pass every other assertion here.
		const foldout = Array.from({ length: 25 }, () => [396, 612]);
		foldout[1] = [792, 612];
		expect((await pdfLayout(fakeDoc(foldout))).oneUp).toBe(true);
		const twoCovers = [[396, 612], [396, 612], ...Array.from({ length: 305 }, () => [792, 612]), [396, 612]];
		expect(twoCovers).toHaveLength(308);
		expect((await pdfLayout(fakeDoc(twoCovers))).oneUp).toBe(false);
	});

	// A verdict nobody can see is a verdict nobody can check. The page-1 bug named the edition it
	// had settled on but never the evidence, so the console said "1-up edition supplied" and not one
	// word about the file that earned it. The vote now travels out with the verdict and is printed
	// on BOTH paths, which is what lets a GM's pasted log stand in for a 60 MB PDF.
	it("says what its verdict was read off, on the refusal path and the accepting one", () => {
		expect(COMMAND).toContain("return { oneUp, width, height, offset: 0, probes, portrait, landscape };");
		const logAt = COMMAND.indexOf("} edition: ${layout.oneUp");
		// The refusal rule is now applied in TWO places: once in the setup dialog, which reads a
		// book the moment it is chosen so a wrong edition is caught before a five-minute run, and
		// once in the run itself, which is the one that actually skips the book. Both spell the
		// condition the same way, so `indexOf` alone would find whichever comes first in the file
		// and this assertion would stop being about the run at all. Anchor it inside the run loop.
		const loopAt = COMMAND.indexOf("for (const { book, file } of bookFiles) {");
		expect(loopAt, "the book-reading loop was renamed").toBeGreaterThan(-1);
		const refuseAt = COMMAND.indexOf("if (layout.oneUp && !BOOKS[book]?.oneUp) {", loopAt);
		expect(refuseAt, "the run no longer refuses a 1-up rulebook").toBeGreaterThan(-1);
		expect(logAt, "the edition line is not logged at all").toBeGreaterThan(-1);
		// BEFORE the refusal branch, or a skipped book is the one case that says nothing.
		expect(logAt).toBeLessThan(refuseAt);
		// And the dialog applies the same rule, ahead of the run, so the two cannot drift into
		// disagreeing about which file is acceptable. It is a genuinely separate occurrence: the
		// run's is the first one AT OR AFTER the loop, so an earlier one can only be the preview.
		const previewAt = COMMAND.indexOf("if (layout.oneUp && !BOOKS[book]?.oneUp) {");
		expect(previewAt, "the setup dialog no longer checks the edition when a book is chosen")
			.toBeLessThan(loopAt);
		// And pdfLayout still names nothing outside itself. A `log()` call in there would read as
		// the obvious way to do this and would break the lift these tests run on.
		// Comments stripped first: the function carries a comment SAYING not to call log() in there,
		// so matching the raw source would decide this assertion on prose.
		const body = macroFunction("pdfLayout").replace(/^\s*\/\/.*$/gm, "");
		expect(body).not.toMatch(/\blog\(/);
	});

	// A file that answers nothing is not a file we know to be 1-up. It reads as the calibrated
	// edition and is left to the page-count check and the per-image extraction, which fail loudly,
	// rather than being refused whole on no evidence at all.
	it("reports an unreadable file as read off nothing, instead of guessing", async () => {
		const layout = await pdfLayout({ numPages: 308, async getPage() { throw new Error("corrupt"); } });
		expect(layout.oneUp).toBe(false);
		// 0x0pt and a 0/0 tally is the tell, and it is in the line the GM pastes.
		expect([layout.portrait, layout.landscape]).toEqual([0, 0]);
		expect([layout.width, layout.height]).toEqual([0, 0]);
		expect(layout.probes).toEqual([2, 78, 155, 231, 307]);
	});

	// The flowchart sheet is the one page whose two editions are genuinely different layouts: the
	// spread runs its text block to the gutter, the booklet insets it, and the charts are centred in
	// whichever block they sit in. Same picture, moved — so those rows carry a second rect, and it
	// has to stay the same SIZE as the first or the crop is no longer the same picture.
	it("gives each diagram a 1-up rect of its own, same size and still side by side", () => {
		for (const d of DIAGRAMS) {
			const one = d.oneUp?.rect;
			expect(Array.isArray(one) && one.length === 4, `${d.slug} has no 1-up rect`).toBe(true);
			expect(one[2] - one[0], `${d.slug} 1-up width`).toBe(d.rect[2] - d.rect[0]);
			expect(one[3] - one[1], `${d.slug} 1-up height`).toBe(d.rect[3] - d.rect[1]);
		}
		const [core, flow] = DIAGRAMS;
		expect(core.oneUp.rect[2]).toBeLessThanOrEqual(flow.oneUp.rect[0]);
		// Both inside the stitched sheet: two 396pt pages side by side.
		expect(flow.oneUp.rect[2]).toBeLessThanOrEqual(792);
		// And the row's rect is chosen by edition at the one place wants are built.
		expect(COMMAND).toContain("rect: rectFor(d)");
		expect(COMMAND).toContain("rect: rectFor(p)");
	});

	// Diagrams are always rendered, so unlike a pagemap there is no wiring-only case to skip —
	// and a `continue` copied over from that loop would extract neither.
	it("are extracted unconditionally, and published as an index", () => {
		expect(COMMAND).toContain("for (const d of diagrams) {");
		// Published through the macro's one index-publishing helper, which is what gives every
		// art index the same union-with-prior and write-only-on-change rules. Asserting the
		// call rather than a `settings.set` line is the point: an index that stopped going
		// through the helper would be the bug.
		expect(COMMAND).toContain('publishIndex("gmDiagramArt", diagrams');
	});

	// All four art indexes ride the same helper. A fifth added as a hand-rolled copy is exactly
	// how the first four drifted into four spellings of one rule.
	it("publishes every art index through the one helper", () => {
		expect(COMMAND).toMatch(/const publishIndex = async \(key, rows, pair, label\) =>/);
		for (const key of ["treasureArt", "gmDiagramArt", "peopleArt", "peoplePortraitArt"]) {
			expect(COMMAND, key).toContain(`publishIndex("${key}"`);
		}
		// ...and none of them still writes its setting inline.
		expect(COMMAND).not.toMatch(
			/settings\.set\("stonetop-pwd", "(treasureArt|gmDiagramArt|peopleArt|peoplePortraitArt)"/);
	});
});
