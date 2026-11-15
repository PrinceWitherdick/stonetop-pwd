// The GM's Struggle as One setup, reopened after a reload where it was left, the way the character
// sheet is (utils/window-restore.js): who is ticked, the danger and approach as typed, every row's
// stats and Aid, at the same place on screen.
//
// Registered by name from this small module (utils/window-restore.js#registerRestorableWindow says
// why); tests/struggle/struggle-setup-restore.test.js holds this name and the class's own together.
//
// Nothing waits on the setup: calling it writes the struggle itself (struggle-store.js#startStruggle).
// What came back through the reload is only the draft, and a setup that answered a player's ask comes
// back only while that ask is still up. The reload answers waiting asks by itself too
// (struggle-flow.js#answerNextAsk), so this one opens through the same one-setup-at-a-time door.

import { registerRestorableWindow, restoreKeyRest } from "../utils/window-restore.js";
import { openOrFocus } from "../utils/open-or-focus.js";

export const STRUGGLE_SETUP_RESTORE_KIND = "struggleSetup";
export const STRUGGLE_SETUP_WINDOW_CLASS = "StruggleSetupDialog";
export const STRUGGLE_SETUP_WINDOW_ID = "stonetop-struggle-setup";
/** The rest of the key for a setup the GM opened; one answering an ask is keyed by the asker's uuid. */
export const GM_SETUP_KEY = "gm";

/**
 * The setup a reload brings back, unrendered (or the one already opening for the same thing), or
 * null when it should stay shut: this user isn't a GM, a struggle has been called since, or the ask
 * it answered has come down.
 */
export async function reopenStruggleSetup(key) {
	const rest = restoreKeyRest(key, STRUGGLE_SETUP_RESTORE_KIND);
	if (rest === null) return null;
	if (!game.user?.isGM) return null;
	const [{ liveStruggle, askOf }, { answerNextAsk }, { StruggleSetupDialog }] = await Promise.all([
		import("./struggle-store.js"), import("./struggle-flow.js"), import("./StruggleSetupDialog.js"),
	]);
	if (liveStruggle()) return null;
	let opts = { onClosed: answerNextAsk };
	if (rest !== GM_SETUP_KEY) {
		const askActor = await fromUuid(rest).catch(() => null);
		const ask = askActor ? askOf(askActor) : null;
		if (!ask) return null;
		opts = { ...opts, ask, askActor };
	}
	return openOrFocus(STRUGGLE_SETUP_WINDOW_ID, () => new StruggleSetupDialog(opts));
}

/** Registered once, at module scope in stonetop.js. */
export function registerStruggleSetupRestore() {
	registerRestorableWindow({ name: STRUGGLE_SETUP_WINDOW_CLASS }, STRUGGLE_SETUP_RESTORE_KIND, reopenStruggleSetup);
}
