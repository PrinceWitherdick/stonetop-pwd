/**
 * Run one startup step, and log rather than throw if it fails.
 *
 * Foundry does not await a `ready` callback, so a bare `await` that rejects does not fail the
 * load out loud: it silently ends the hook there, and for whoever it happened to, everything after
 * it never runs (no hotbar macros, no game.stonetop, no window restore). Each step the rest of the
 * load does not depend on goes through here instead.
 *
 * Resolves to whether the step went through, for the rare caller whose NEXT step must not run on
 * a half-done one (onReady holds the world setup back when the steps that must precede it fail).
 * Most callers ignore it.
 *
 * @param {string} label    what failed, for the log ("chronicle flag-scope repair")
 * @param {() => any} work
 * @returns {Promise<boolean>} true when the work finished, false when it threw
 */
export async function bestEffort(label, work) {
	try {
		await work();
		return true;
	} catch (err) {
		console.error(`Stonetop | ${label} failed`, err);
		return false;
	}
}
