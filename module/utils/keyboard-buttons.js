// A `role="button"` that is not a <button> gets no keyboard activation from the browser: Enter and Space do
// nothing. Rather than hand-wire a keydown handler beside every click handler, a window wires its root once
// and Enter or Space on any such element inside presses it, so the element's own click handler runs.
//
// Not for native buttons, links or form fields (the browser already activates those), and not while typing in
// a field that sits inside a role="button".

const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/** Whether a keydown should press the role="button" it lands in. PURE. */
export function pressesRoleButton(ev) {
	if (ev?.key !== "Enter" && ev?.key !== " ") return null;
	// Already answered by a handler of its own, or a held key's repeats.
	if (ev.defaultPrevented || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) return null;
	const target = ev.target;
	if (target?.closest?.(TYPING)) return null;
	const button = target?.closest?.("[role='button']");
	if (!button || button.matches?.("button, a[href]")) return null;
	// A real button or link inside it (a search control in a heading) answers for itself.
	const native = target.closest("button, a[href]");
	if (native && button.contains(native)) return null;
	if (button.getAttribute?.("aria-disabled") === "true") return null;
	return button;
}

/**
 * Wire Enter and Space on every role="button" inside `root` (now or added later) to press it.
 *
 * @param {HTMLElement|{0: HTMLElement}} root  the window's content element (a jQuery wrapper is fine)
 */
export function wireKeyboardButtons(root) {
	const el = root?.[0] ?? root;
	if (!el?.addEventListener || el.dataset?.stonetopKeyButtons) return;
	if (el.dataset) el.dataset.stonetopKeyButtons = "1";
	el.addEventListener("keydown", ev => {
		const button = pressesRoleButton(ev);
		if (!button || !el.contains(button)) return;
		// Space would scroll the window, Enter submit a surrounding form.
		ev.preventDefault();
		button.click();
	});
}
