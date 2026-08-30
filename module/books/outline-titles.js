// The name of the section a page falls in, taken from the book's own outline.
//
// WHY A BOOKMARK WANTS ONE. A list of page numbers is a list of nothing: "p. 180" is not a
// place a reader recognises a week later, and asking them to type a name for every mark makes
// marking one a chore rather than a reflex. The book already knows what is on page 180 -- its
// outline is the chapter and section headings, with a destination each -- so a new bookmark can
// be born already called "Steadings & Seasons" and renamed only if that is not what they meant.
//
// WHY IT IS NOT FREE. An outline item points at a DESTINATION, not at a page: either a named one
// the document resolves, or an explicit array whose first element is a REFERENCE to a page
// object. Turning that into a page number is `getPageIndex`, which is asynchronous, once per
// heading. So this resolves the whole outline ONCE, on demand, and hands back a sorted table
// that every later question is answered from -- rather than asking the document again for each
// bookmark a reader makes.
//
// EVERY FAILURE IS "no title". A document with no outline, a destination that resolves to
// nothing, a viewer that spells any of this differently: each answers with an empty table, and
// the caller falls back to naming the mark by its page. Nothing here is worth an error a reader
// would see.

/**
 * How many headings are resolved.
 *
 * The two rulebooks have outlines in the low hundreds. The cap is not about them -- it is about
 * the day a GM points the reader at some other PDF whose outline has a line per paragraph, and
 * `getPageIndex` is a promise each. Past the cap the tail is dropped, which costs a default
 * label on the last pages of an unusual document and nothing else.
 */
const MAX_HEADINGS = 600;

/**
 * The book's headings as `{ page, title }`, in page order.
 *
 * Nested items are flattened rather than kept as a tree: the question this table answers is
 * "what is the last heading at or before this page", and for that a chapter and its subsections
 * are all just marks on the same ruler. Depth-first, so a subsection sorts after its own
 * chapter when both land on one page.
 *
 * @param {object} pdfDocument  the viewer's loaded document proxy
 * @returns {Promise<Array<{page: number, title: string}>>}
 */
export async function outlineHeadings(pdfDocument) {
	if (!pdfDocument?.getOutline) return [];
	let outline;
	try { outline = await pdfDocument.getOutline(); }
	catch (_) { return []; }
	if (!Array.isArray(outline) || !outline.length) return [];

	const flat = [];
	const walk = (items) => {
		for (const item of items ?? []) {
			if (flat.length >= MAX_HEADINGS) return;
			const title = String(item?.title ?? "").replace(/\s+/g, " ").trim();
			if (title && item?.dest) flat.push({ title, dest: item.dest });
			walk(item?.items);
		}
	};
	walk(outline);

	const headings = [];
	for (const { title, dest } of flat) {
		const page = await destinationPage(pdfDocument, dest);
		if (page) headings.push({ page, title });
	}
	// A stable sort, so two headings resolved to the same page stay in the order the outline
	// listed them -- which is the order the book prints them in, and therefore the one where
	// the LAST match is the more specific of the two.
	return headings.sort((a, b) => a.page - b.page);
}

/**
 * The 1-based page one destination lands on, or 0.
 *
 * Two shapes, because a PDF has two ways to say where a heading goes. A STRING is a named
 * destination the document looks up for us. An ARRAY is explicit, and its first element is
 * either a page reference (the usual case, which only `getPageIndex` can resolve) or, in some
 * files, the page index already.
 */
async function destinationPage(pdfDocument, dest) {
	try {
		const explicit = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest;
		const ref = Array.isArray(explicit) ? explicit[0] : null;
		if (ref === null || ref === undefined) return 0;
		if (typeof ref === "number") return ref + 1;
		const index = await pdfDocument.getPageIndex(ref);
		return Number.isFinite(index) ? index + 1 : 0;
	} catch (_) {
		return 0;
	}
}

/**
 * The heading covering a page: the LAST one at or before it.
 *
 * At or before, rather than nearest, because a heading owns the pages that follow it until the
 * next one. Nothing before the first heading (a title page, a table of contents) has a name,
 * and answers with "".
 */
export function headingAt(headings, page) {
	const n = Number(page);
	let title = "";
	for (const heading of headings ?? []) {
		if (heading.page > n) break;
		title = heading.title;
	}
	return title;
}
