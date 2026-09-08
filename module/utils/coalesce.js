/**
 * Fold a burst of calls into one run, next microtask.
 *
 * WHAT IT IS FOR. Several of this system's surfaces are rebuilt from a document hook, and Foundry
 * fires those in bursts: a multi-note paste, a scene swap, a page edit that touches an entry and
 * every page under it. Rebuilding once per event repaints the same thing a dozen times in a frame,
 * and the reader sees the last one either way. So the first call latches and the rest are dropped
 * until the work has run.
 *
 * ⚠ THE LATCH CLEARS BEFORE THE WORK, not after: a throw inside `work` must not wedge the surface
 * shut for the rest of the session. The catch is what keeps that throw from surfacing as a bare
 * unhandled rejection with nothing to say which hook caused it, which is why `label` is required.
 *
 * @param {() => void} work    What to run, at most once per microtask.
 * @param {string} label       Prefixed to anything `work` throws, so the console names the surface.
 * @returns {() => void}       Call as often as you like.
 */
export function coalesceMicrotask(work, label) {
	let queued = false;
	return () => {
		if (queued) return;
		queued = true;
		Promise.resolve()
			.then(() => { queued = false; work(); })
			.catch(err => console.error(label, err));
	};
}
