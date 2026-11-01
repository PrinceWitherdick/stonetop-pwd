// ── Which Thrall Marks a character holds, off the raw actor ────────────────
// Its own module, with nothing behind it but the flag reader (insert-lore.js), so the roll engine can ask
// it (A Festering Rot's doubles, utils/roll-engine.js) without importing Death's Door's whole rules chain.
// Re-exported by deaths-door-actor.js, where the camp and the healing rules have always found it.

import { holdsLoreOption } from "./insert-lore.js";

/** The Thrall Marks the system's rules turn on, by their slug in the insert's `marks` section. */
export const THRALL_MARK = Object.freeze({
	TORMENTS_BLESSING:  "torments-blessing",
	RAVENOUS:           "ravenous",
	QUICKSILVER_DREAMS: "quicksilver-dreams",
	CHILD_OF_THE_DEEPS: "child-of-the-deeps",
	FESTERING_ROT:      "a-festering-rot",
});

/**
 * Whether a Thrall has Mark `slug` marked. Read off the actor's flags rather than through the
 * character model, because Make Camp asks it of every character at the fire on every client, and a
 * camp reads raw actors (camp/camp-store.js). A Mark left on a sheet whose insert was taken away
 * (removal prunes nothing, so it can be undone) no longer counts.
 */
export function hasThrallMark(actor, slug) {
	return !!slug && holdsLoreOption(actor, `marks:${slug}`, { insert: "thrall" });
}
