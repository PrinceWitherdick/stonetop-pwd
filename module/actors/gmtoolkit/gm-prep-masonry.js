/**
 * Height-packing for the GM Toolkit's prep-card grids (Threats, Hazards, Sites).
 *
 * `.steading-threats-grid` is a plain two-track CSS grid, and a grid couples its items into
 * ROWS: every card in a row starts at the row's top and the next row starts below the TALLEST
 * of them, so a one-line card sitting beside a fully written-up one leaves a hole the height of
 * the difference. Site cards are the worst case in the system for that -- a foundation-only
 * site is about 80px tall and one with areas and a timeline about 560px -- so the Sites tab
 * reads as a ragged, half-empty column rather than the packed board it looks like it should be.
 * Placing each card in the currently-shortest column instead closes every hole, and the Threats
 * and Hazards grids get it for free: same markup, same class, same defect, just less of it.
 *
 * THE COLUMN COUNT IS READ OFF THE PAGE, never recomputed here. The unpacked grid is laid out
 * first (that is what `reset` is for) and the distinct card x-positions ARE the count
 * `repeat(auto-fit, minmax(...))` chose, so the stylesheet stays the only place the track width
 * is written down and no magic number here can fall out of step with it. Measuring in that same
 * reset pass is also what makes the heights honest: a card measured flat is already at one
 * track's width, which is the width it will render at once packed.
 *
 * One column is left exactly as it is: `auto-fit` collapses the empty track so a lone card spans
 * the full width, and wrapping a single column around it would halve it instead.
 *
 * Foundry-free and DOM-only, like the masonry helper it is built on, so the offline sheet
 * driver and the unit tests exercise the shipped code rather than a retyped copy of it.
 */
import { createPacker, makeColumns, packShortest, wireMasonry } from "../../utils/masonry.js";

/** The grids this packs, and the cards inside one. Both are also written in gm-toolkit-tab-*.hbs. */
export const GM_PREP_GRID_SELECTOR = ".steading-threats-grid";
export const GM_PREP_CARD_SELECTOR = ".threat-card-wrap";

export const packGmPrepGrid = createPacker({
	cards: GM_PREP_CARD_SELECTOR,
	// Back to a flat grid, so the browser re-decides the track count and every card measures at
	// the width it will actually have in a packed column.
	reset: (grid, cards) => grid.replaceChildren(...cards),
	// The resolved track list, as the browser worked it out from the stylesheet. Dragging a sheet
	// edge fires this every frame, and all but the two or three frames that actually cross a track
	// boundary resolve to the string they resolved to last time, which skips a full reset, a
	// measure of every card and two re-parents. The STRING rather than a count for the reason the
	// docblock gives: `22rem` stays written in exactly one place, the stylesheet.
	//
	// Optional-called, because this module is DOM-only rather than browser-only on purpose: the
	// offline driver and the unit tests pack plain objects that have offsets and no styles. No
	// answer means no key, which is the unguarded packing this grid had before.
	layoutKey: (_width, grid) => globalThis.getComputedStyle?.(grid)?.gridTemplateColumns,
	place: (cards) => {
		// A card in a hidden tab measures 0 and its x is meaningless; returning null leaves the
		// guard unset so the next observer notification tries again, which is what fires when
		// the tab is first shown.
		const heights = new Map(cards.map(card => [card, card.offsetHeight]));
		const visible = cards.filter(card => heights.get(card) > 0);
		if (!visible.length) return null;

		const colCount = new Set(visible.map(card => card.offsetLeft)).size;
		if (colCount < 2) return cards;

		const cols = makeColumns(colCount, "steading-threats-col");
		packShortest(visible, cols, card => heights.get(card));
		// Anything unmeasurable stays in the tree rather than being dropped, so the next pack
		// still sees it.
		cols.at(-1).append(...cards.filter(card => !heights.get(card)));
		return cols;
	},
});

/**
 * Pack every prep grid under `root` and keep them packed.
 *
 * @returns {{repack: () => void, disconnect: () => void}}
 */
export function wireGmPrepMasonry(root) {
	return wireMasonry(packGmPrepGrid, root.querySelectorAll(GM_PREP_GRID_SELECTOR));
}
