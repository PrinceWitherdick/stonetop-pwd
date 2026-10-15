// The content element for a DialogV2 prompt: the system's remaining DialogV2 asks (the fight and
// invocation asks, the campaign year, the expedition's questions) build their content with it.

/**
 * The `<div>` a DialogV2 will accept as its content, wrapped around the markup you actually want.
 *
 * ⚠ THE RULE, AND IT THROWS. Core's `DialogV2#_initializeApplicationOptions` (v13
 * client/applications/api/dialog.mjs) refuses a content element that is not a `<div>`, refuses one
 * carrying ANY attribute at all, and then keeps only its `innerHTML` — the element itself is
 * discarded. So a `content.className = "stonetop"` on the way in is not merely ignored: it is
 * `Error: config.content element must have no attributes`, thrown out of the constructor, which
 * surfaces as an unhandled rejection and a button that silently does nothing. It cost the "New map"
 * button on the GM Toolkit's relationship maps tab, which shipped dead for exactly that reason, and
 * then cost the map's own "New page" button when its author copied the pattern.
 *
 * ONE FUNCTION so there is one place that knows, and so the next window to ask a question inherits
 * the rule rather than rediscovering it. The classed, styled container always lives one level in —
 * which is fine, because the wrapper is inside the `innerHTML` that survives.
 *
 * @param {string} inner  Authored markup for the container that carries the classes.
 * @param {Document} [doc]  The document to build it in (injectable for tests).
 * @returns {HTMLDivElement}
 */
export function contentElement(inner, doc = globalThis.document) {
	const content = doc.createElement("div");
	content.innerHTML = inner;
	return content;
}
