// A button that opens the panel next to it, and nothing else.
//
// Two surfaces on the GM Toolkit want exactly this and nothing more: a GM move entry opening what
// Book I prints under it, and a threat type opening its own list of GM moves. Both are reference
// text sat under a name, both are `hidden` at render, and both toggle in place rather than
// re-rendering (a render on these tabs costs a scroll jump, which is the same reasoning the
// section folds give).
//
// Deliberately NOT the section fold in utils/section-editing.js. That one remembers its state per
// user, walks a heading's following siblings to decide what it governs, and exists to put a whole
// section away. This is one button and the panel beside it, opened to be read once and shut.
//
// What is worth having in one place is the `hidden`/`aria-expanded` pair. Move one without the
// other and the panel is open while a screen reader is told it is shut, which no test that looks
// at the visible page can see.

/**
 * Toggle the panel (or panels) `button` governs.
 *
 * The panel is looked up inside the button's PARENT rather than by an id, so the markup needs no
 * unique id per entry (thirty move entries across three sections, eight threat types) and no
 * `aria-controls` to point at one. That also means a panel may sit INSIDE the button, which the
 * GM moves list uses: the rest of its lead sentence is revealed within the button's own text.
 *
 * A selector matching SEVERAL elements moves them as one, taking the state from the first. The
 * alternative is a call per part, and two calls are two chances for the halves of one disclosure
 * to end up disagreeing.
 *
 * @param   {HTMLElement} button
 * @param   {string} panelSelector  The panel(s), as found within the button's parent element.
 * @returns {boolean|null}  Their new state, or null when there is no panel to toggle.
 */
export function toggleDisclosure(button, panelSelector) {
	const panels = [...(button?.parentElement?.querySelectorAll?.(panelSelector) ?? [])];
	if (!panels.length) return null;
	const open = panels[0].hidden;
	for (const panel of panels) panel.hidden = !open;
	button.setAttribute("aria-expanded", String(open));
	return open;
}
