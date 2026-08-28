import { wrapStonetopGlyphsInEl } from "./glyphs.js";

/**
 * Prepare a move's authored text for a HOVER PANEL, in place.
 *
 * Three surfaces show a move's description in a panel that appears under the pointer and
 * vanishes on mouseleave: the sidebar's basic-move panel, the character sheet's move
 * cross-reference tooltip, and the onboarding dialog's word tooltip. All three had grown their
 * own copy of this preparation and the copies had already drifted — all three stripped
 * `<details>`, only one redrew the glyphs — so a move written with a mark read correctly in one
 * panel and as raw fallback-font characters in the next.
 *
 * What a hover panel needs, and why:
 *
 * COLLAPSIBLE BLOCKS GO. A `<details>` (Chart a Course's "Travel Times" table) cannot be opened
 * in a panel that closes the moment the pointer leaves it, so it would read as a dead label.
 * They stay clickable on the item sheet, which is where a reader can actually open one.
 *
 * GLYPHS ARE REDRAWN. These panels are the only place a move's text is shown without the
 * sheet's own pass over it — each writes its body straight from a compendium description, or
 * from a clone whose wrapper element is dropped on the way in — so Outfit's "mark as many ◇"
 * and Have What You Need's "(□)" arrived as raw characters in the fallback font.
 *
 * `wrapStonetopGlyphsInEl` over the whole panel rather than `wrapGlyphTextContainers`, per the
 * rule in glyphs.js: a surface with no editable prose at all wraps its root, which covers
 * strictly more and costs the container list nothing. A hover panel is display-only by
 * construction — it is built fresh from a string or a clone and never holds an input.
 *
 * Panels rebuild their content on every hover, so this is re-run each time and nothing goes
 * stale.
 *
 * @param {HTMLElement} panel  The panel/tooltip root, with its content already written.
 * @returns {HTMLElement} `panel`, so it can be chained onto the expression that built it.
 */
export function prepareMoveHoverBody(panel) {
	if (!panel) return panel;
	panel.querySelectorAll("details").forEach(d => d.remove());
	wrapStonetopGlyphsInEl(panel);
	return panel;
}
