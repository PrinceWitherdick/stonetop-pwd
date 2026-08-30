import { resolvedFlagProperty } from "./StonetopFlags.js";
import { DEATHS_DOOR_FLAG, pastDeathKind } from "./deaths-door.js";

/**
 * What an actor is past the Door — their insert slug ("revenant"/"ghost"/"thrall"), "dead" for
 * one who stepped through the Last Door, or null for the living.
 *
 * The rule itself lives in deaths-door.js, which is deliberately Foundry-free so it can be read
 * and tested without a document; this is the one place that knows where the two answers it needs
 * are STORED. Both are read through `resolvedFlagProperty` so a sheet written before the
 * system-id rename still reports its death (see StonetopFlags).
 *
 * Anything that shows a character's death rather than ruling on it goes through here: the chat
 * drip's stamp, and the expedition Outfit readout, which drops the dead from the party list and
 * darkens whoever came back.
 */
export function actorPastDeathKind(actor) {
	if (!actor) return null;
	return pastDeathKind({
		state:      resolvedFlagProperty(actor, DEATHS_DOOR_FLAG) ?? null,
		insertSlug: resolvedFlagProperty(actor, "postDeathInsert.slug") ?? null,
	});
}
