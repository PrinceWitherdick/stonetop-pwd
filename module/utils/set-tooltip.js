/**
 * Give an element Foundry's tooltip, or take it away.
 *
 * Foundry's, not a native `title`, which ignores the reader's palette and Sheet Text Size and never
 * shows on a touch screen (STYLEGUIDE.md, "Hover help"). Empty words remove the attribute rather
 * than leave it blank, since an empty attribute is still an attribute. Setting one form clears the
 * other, and empty words clear both: core reads `data-tooltip-text` first, so a control that
 * switched form would otherwise keep showing its old words.
 *
 * tests/templates/js-tooltip-conventions.test.js keeps hand-written clears out of the modules.
 *
 * @param {HTMLElement} el
 * @param {string|null|undefined} words
 * @param {object} [opts]
 * @param {boolean} [opts.text]  `data-tooltip-text`: for anything printed from data. Core draws a
 *   plain `data-tooltip` as HTML, so a name a player typed must not go there.
 * @param {boolean} [opts.name]  also make the words the control's `aria-label`, for a control
 *   that is only an icon.
 */
export function setTooltip(el, words, { text = false, name = false } = {}) {
	if (!el) return;
	if (words) {
		el.dataset[text ? "tooltipText" : "tooltip"] = words;
		delete el.dataset[text ? "tooltip" : "tooltipText"];
	} else {
		delete el.dataset.tooltip;
		delete el.dataset.tooltipText;
	}
	if (!name) return;
	if (words) el.setAttribute("aria-label", words);
	else el.removeAttribute("aria-label");
}
