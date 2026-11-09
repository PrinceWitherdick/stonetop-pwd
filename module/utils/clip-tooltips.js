/**
 * Full text on hover for one-line text that had to end in "…", and no tooltip for text that fits.
 *
 * The People rows (Stonetop's Player Characters / Residents / Neighbors, a settlement's
 * Residents) keep each field on one line and cut what doesn't fit. Whether a field is cut
 * depends on the window's width, so it is decided at hover time rather than in the template.
 *
 * Foundry's TooltipManager reads the tooltip attributes on `pointerenter` (a capture listener
 * on <body>). `pointerover` is dispatched before `pointerenter`, so a delegated `pointerover`
 * here sets or clears them just in time.
 */

const bound = new WeakSet();

/**
 * Set or clear one element's hover tooltip by whether its text is cut short. Rich text (the
 * NPC notes preview, already rendered on the sheet) keeps its formatting in the tooltip.
 * @param {HTMLElement} el
 */
export function syncClipTooltip(el) {
	const cut = el.scrollWidth > el.clientWidth + 1;
	if (!cut) {
		delete el.dataset.tooltipText;
		delete el.dataset.tooltipHtml;
		delete el.dataset.tooltipDirection;
		return;
	}
	if (el.matches(".stonetop-npc-rich-text")) el.dataset.tooltipHtml = el.innerHTML;
	else el.dataset.tooltipText = el.textContent.trim();
	el.dataset.tooltipDirection = "UP";
}

/**
 * Give every `selector` match under `root` its full text on hover while it is cut short.
 * @param {HTMLElement} root
 * @param {string} selector
 */
export function bindClipTooltips(root, selector) {
	if (!root || bound.has(root)) return;
	bound.add(root);
	root.addEventListener("pointerover", event => {
		const el = event.target?.closest?.(selector);
		if (el && root.contains(el)) syncClipTooltip(el);
	});
}
