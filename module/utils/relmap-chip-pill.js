// ONE TAG CHIP ("Dead", "Noble") as the relationship map draws it, for the places that build it in
// script: the person bar's row of worn chips. The board draws the same pill from its template
// (templates/dialogs/partials/relationship-map-board.hbs), and a test holds the two to the same markup.

import { inkPaint } from "../relmap/relmap-ink.js";
import { escHtml } from "./strings.js";

/** Escaped as the template escapes it, so a name with an apostrophe comes out the same both ways. */
export const esc = v => globalThis.Handlebars?.escapeExpression?.(String(v ?? "")) ?? escHtml(v);

/** What a pill needs to be drawn: its words, its icon, and its ink as a class and an inline colour. */
export function chipPaint(chip) {
	const { inkKey, inkHex } = inkPaint(chip?.ink ?? "");
	return { id: chip?.id ?? "", name: chip?.name ?? "", icon: chip?.icon ?? "", inkKey, inkHex };
}

/**
 * The pill's markup. A `<span>` on the board; the person bar makes it a `<button>` and adds its own
 * attributes (`attrs`, already escaped) after the class.
 *
 * @param {{name: string, icon?: string, inkKey: string, inkHex?: string}} paint  from `chipPaint`.
 */
export function chipPillHtml(paint, { tag = "span", attrs = "" } = {}) {
	const style = paint.inkHex ? ` style="--relmap-ink-raw:${esc(paint.inkHex)}"` : "";
	const icon = paint.icon ? `<i class="fas ${esc(paint.icon)}" aria-hidden="true"></i>` : "";
	return `<${tag} class="stonetop-relmap-chip stonetop-relmap-ink--${esc(paint.inkKey)}"${attrs}${style}`
		+ ` data-tooltip-text="${esc(paint.name)}">${icon}`
		+ `<span class="stonetop-relmap-chip-text">${esc(paint.name)}</span></${tag}>`;
}
