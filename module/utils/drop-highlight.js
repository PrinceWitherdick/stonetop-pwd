/**
 * Put `className` on `el` while a drag is over it, so "drop it here" is discoverable rather than
 * found by accident. Returns a clear() the host must call from its own drop handling: a
 * sheet-level handler often consumes the drop before it would ever reach a listener here, so
 * dragleave alone can't be trusted.
 *
 * dragenter and dragleave bubble up from every child, and crossing into a child fires the child's
 * dragenter BEFORE the parent's dragleave, so the nesting depth is counted and the class only goes
 * once the drag has truly left. A bare add-on-enter/remove-on-leave flickers off every time the
 * pointer crosses a child.
 *
 * Used by the relationships sections (the dashed outline), the character sheet's whole-sheet
 * "a drag is in progress" class and its playbook drop zone. tests/utils/drop-highlight.test.js
 *
 * @param {HTMLElement|null} el
 * @param {string} [className]
 * @returns {() => void}
 */
export function wireDropHighlight(el, className = "is-drop-target") {
	if (!el) return () => {};
	let depth = 0;
	const clear = () => { depth = 0; el.classList.remove(className); };
	el.addEventListener("dragenter", () => { depth++; el.classList.add(className); });
	el.addEventListener("dragleave", () => { if (--depth <= 0) clear(); });
	return clear;
}
