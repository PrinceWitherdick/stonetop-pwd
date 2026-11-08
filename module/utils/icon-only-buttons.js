/**
 * Buttons that hold nothing but an icon, found by what they hold, so a new one needs no CSS of
 * its own to sit in the middle.
 *
 * Foundry core gives every icon in a V1 window's button a right margin
 * (`body.game .app button > i { margin-right: 3px }`) to space it from the label after it. A
 * button with no label keeps that margin, and its icon paints ~1.5px left of the button's middle.
 * CSS cannot tell `<i></i>` from `<i></i> Remove` (a text node is invisible to selectors), so this
 * marks the first kind with `data-icon-only` and stonetop.css takes the margin off those.
 *
 * One observer per open V1 window (`.app`, the only place core's margin applies), attached when
 * it first renders and dropped when it closes, rather than a render hook alone, because buttons
 * also arrive after a render (a row cloned from a <template>, a card redrawn in place) and a button
 * can gain or lose its label. Not one observer on <body>: that one ran for every chat message,
 * tooltip and sidebar redraw all session. The callback runs before the next paint, so a marked
 * button is never drawn off-centre first. It can go once the last V1 window has moved to AppV2.
 */

export const ICON_ONLY_ATTR = "data-icon-only";

/** Is this button's only content one `<i>` (whitespace and comments aside)? */
export function isIconOnly(button) {
	return button.childElementCount === 1 && button.firstElementChild.tagName === "I" && !button.textContent.trim();
}

const mark = button => button.toggleAttribute(ICON_ONLY_ATTR, isIconOnly(button));

/** Mark or unmark `root` (when it is a button) and every button inside it. */
export function markIconOnly(root) {
	if (root.matches("button")) mark(root);
	root.querySelectorAll("button").forEach(mark);
}

const observers = new WeakMap();

/**
 * Mark a V1 window's buttons now, and keep marking them as the window changes, until unwatchWindow.
 * Watching a window already watched does nothing. Returns the window's observer.
 */
export function watchWindow(element) {
	if (!element) return null;
	let observer = observers.get(element);
	if (observer) return observer;
	markIconOnly(element);
	observer = new MutationObserver(records => {
		for (const record of records) {
			// A button's own children changed: it may have gained or lost its label.
			const host = record.target.closest("button");
			if (host) { mark(host); continue; }
			for (const node of record.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) markIconOnly(node);
			}
		}
	});
	observer.observe(element, { childList: true, subtree: true });
	observers.set(element, observer);
	return observer;
}

/** Stop watching a window (it closed). */
export function unwatchWindow(element) {
	observers.get(element)?.disconnect();
	observers.delete(element);
}

/** A V1 app's element (`app.element` is jQuery) when it is, or sits in, a window: core's margin is `.app` only. */
const windowOf = app => {
	const element = app?.element?.[0];
	return element?.closest?.(".app") ? element : null;
};

/**
 * Watch every V1 window as it first renders, and let it go when it closes. Call once, in init.
 * `renderApplication` / `closeApplication` fire for every V1 app, whatever its class.
 */
export function watchIconOnlyButtons(hooks = globalThis.Hooks) {
	hooks?.on?.("renderApplication", app => watchWindow(windowOf(app)));
	hooks?.on?.("closeApplication", app => unwatchWindow(windowOf(app)));
}
