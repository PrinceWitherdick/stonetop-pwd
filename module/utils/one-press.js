// ONE PRESS AT A TIME.
//
// A button whose work awaits a write can be pressed again before the first press lands, and the
// same act then runs twice. Every window that guards against that used to keep its own latch
// (StonetopDialog#_guardBusy, the walkthrough's trip stamp and its route toggles), and the copies
// had already drifted on whether the button comes back after. This is the one latch they share.

/**
 * Run `fn` unless a press under the same `key` is still in flight on `owner`, which answers
 * undefined. Presses under different keys do not block each other.
 *
 * `control` (the pressed button) is disabled while the work runs, so the person can see the press
 * took. `reenable` says when it comes back: "always", or "onError" for a caller whose success closes
 * or redraws the window, where greying it back in between would offer a second press at the one
 * moment the latch has let go (see StonetopDialog#_guardBusy).
 *
 * A throw from `fn` reaches the caller, after the latch is released.
 *
 * @param {object} owner     what the latch lives on (the window)
 * @param {string} key
 * @param {() => Promise<*>} fn
 * @param {{control?: HTMLElement|null, reenable?: "always"|"onError"}} [opts]
 */
export async function onePress(owner, key, fn, { control = null, reenable = "always" } = {}) {
	const busy = (owner._pressing ??= new Set());
	if (busy.has(key)) return undefined;
	busy.add(key);
	if (control) control.disabled = true;
	let failed = false;
	try {
		return await fn();
	} catch (err) {
		failed = true;
		throw err;
	} finally {
		busy.delete(key);
		if (control && (reenable === "always" || failed)) control.disabled = false;
	}
}
