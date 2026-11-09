// Where the keyboard goes when a window closes and another may open in its wake.
//
// A window that redraws or closes takes the focused control with it, and the browser drops focus on
// the page body: a screen-reader user hears nothing and Tab walks Foundry's own UI. These helpers put
// the keyboard on something that speaks: a window's marked first control ([data-autofocus]) or its
// first focusable one.

/** What can take the keyboard inside a window. */
export const FOCUSABLE = [
	"button:not([disabled])", "a[href]", "input:not([disabled]):not([type='hidden'])",
	"select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Focus `root`'s preferred control (`prefer`, else [data-autofocus], else its first focusable one).
 * Returns the element focused, or null.
 *
 * @param {HTMLElement|{0: HTMLElement}} root  a window element (a jQuery wrapper is fine)
 * @param {{prefer?: string}} [opts]
 */
export function focusInto(root, { prefer = null } = {}) {
	const el = root?.[0] ?? root;
	if (!el?.querySelector) return null;
	const target = (prefer && el.querySelector(prefer)) || el.querySelector("[data-autofocus]") || el.querySelector(FOCUSABLE);
	target?.focus?.({ preventScroll: true });
	return target ?? null;
}

/**
 * After a window closes: give the keyboard to the last OTHER window that draws within `wait` ms (a
 * follow-up the close opened, such as the next Level Up or the pouch trait editor), or else to
 * `fallback` (the sheet the window came from), at `fallbackSelector` inside it.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.fallback]           an Application whose element takes it when nothing opens
 * @param {string|null} [opts.fallbackSelector]   the control in `fallback` to focus
 * @param {number} [opts.wait]
 * @param {object} [opts.hooks]                   Foundry's Hooks (tests pass a fake)
 * @param {Function} [opts.setTimer]              setTimeout (tests pass a fake)
 * @returns {Promise<HTMLElement|null>}  what was focused
 */
export function focusNextWindow({
	fallback = null, fallbackSelector = null, wait = 600,
	hooks = globalThis.Hooks, setTimer = globalThis.setTimeout?.bind(globalThis),
} = {}) {
	let opened = null;
	// Only a window counts: the chat log, the notifications and the sidebar redraw as applications too
	// (a level-up writes a ledger line), and focusing one of those leaves the keyboard nowhere.
	const isWindow = app => app?.hasFrame === true || (app?.hasFrame === undefined && app?.popOut === true);
	const seen = app => { if (app && app !== fallback && isWindow(app)) opened = app; };
	const ids = ["renderApplication", "renderApplicationV2"].map(name => [name, hooks?.on?.(name, seen)]);
	return new Promise(resolve => {
		const done = () => {
			for (const [name, id] of ids) if (id != null) hooks?.off?.(name, id);
			const target = opened?.rendered !== false && opened?.element ? opened : fallback;
			const prefer = target === fallback ? fallbackSelector : null;
			// The sheet redraws once the change lands (a new level), which takes the focused control
			// with it: put the keyboard back after its next draw too.
			if (target && target === fallback) refocusAfterRedraw(fallback, prefer, { hooks, setTimer });
			resolve(target ? focusInto(target.element, { prefer }) : null);
		};
		if (setTimer) setTimer(done, wait);
		else done();
	});
}

/**
 * Focus `app`'s `prefer` control again after its next draw within `wait` ms, unless the keyboard has
 * moved somewhere else on purpose by then (into another window, or a control the user chose).
 *
 * @param {object} app
 * @param {string|null} prefer
 * @param {{hooks?: object, setTimer?: Function, wait?: number}} [opts]
 */
export function refocusAfterRedraw(app, prefer, { hooks = globalThis.Hooks, setTimer = globalThis.setTimeout?.bind(globalThis), wait = 3000 } = {}) {
	if (!app || !hooks?.on) return;
	const names = ["renderApplication", "renderApplicationV2", "renderActorSheet"];
	const ids = [];
	const stop = () => { for (const [name, id] of ids.splice(0)) if (id != null) hooks.off?.(name, id); };
	const onRender = rendered => {
		if (rendered !== app) return;
		stop();
		const active = globalThis.document?.activeElement;
		const root = app.element?.[0] ?? app.element;
		// Lost to the page body (the redraw took it) or still inside this window: give it back.
		if (!active || active === globalThis.document?.body || root?.contains?.(active)) focusInto(app.element, { prefer });
	};
	for (const name of names) ids.push([name, hooks.on(name, onRender)]);
	if (setTimer) setTimer(stop, wait);
}
