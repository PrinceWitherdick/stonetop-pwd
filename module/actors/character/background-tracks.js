import { SYSTEM_ID } from "../../system-id.js";
import { resolvedFlagProperty } from "./StonetopFlags.js";

/**
 * A background's setup tracks (`setup.resources`) that a move empties. The Lightbearer's Auspicious
 * Birth: "you may mark this background's circle instead, to no ill effect. Clear it when you Make
 * Camp or Convalesce." The track says which moves in the data, as `clearsOn`, so Make Camp and
 * Convalesce ask the data rather than naming the background.
 */
export const CLEARS_ON = Object.freeze({
	MAKE_CAMP:  "make-camp",
	CONVALESCE: "convalesce",
});

/**
 * The selected background's tracks that `event` (CLEARS_ON) clears, read off a character snapshot
 * (StonetopCharacter#buildSnapshot's playbook section), as `[{key, name, marked}]`. Named for a chat
 * line: "Auspicious Birth's background circle". Empty with no background, or none that says so.
 */
export function snapshotTracksClearedBy(snapshot, event) {
	const background = (snapshot?.playbook?.background?.options ?? []).find(o => o?.selected);
	return (background?.setupResources ?? [])
		.filter(r => r?.key && Array.isArray(r.clearsOn) && r.clearsOn.includes(event))
		.map(r => ({
			key:    String(r.key),
			name:   `${background.label ?? background.slug}'s ${String(r.label ?? r.key).toLowerCase()}`,
			marked: Number(r.current) > 0,
		}));
}

/** Of `tracks`, the ones with a mark on them in the character's stored `background.setupResources`. */
export function markedTracks(tracks, setupResources) {
	return (tracks ?? []).filter(t => Number(setupResources?.[t.key]) > 0);
}

/** The update fragment that empties `tracks` on a character, for flag scope `scope`. */
export function clearTracksData(tracks, scope) {
	return Object.fromEntries((tracks ?? []).map(t => [`flags.${scope}.background.setupResources.${t.key}`, 0]));
}

/**
 * Write one setup track's value (Enigma, Omens) through the character's own background store, which is
 * where the Details tab's circles write (CharacterBackgrounds#setSetupResource). Without that store, the
 * stored tracks are written back whole with this one changed.
 */
export async function writeSetupResource(actor, key, value, character = actor?.typedActor) {
	const background = character?.background;
	if (background?.setSetupResource) return background.setSetupResource(key, value);
	const stored = resolvedFlagProperty(actor, "background.setupResources") ?? {};
	return actor?.setFlag?.(SYSTEM_ID, "background.setupResources", { ...stored, [key]: value });
}
