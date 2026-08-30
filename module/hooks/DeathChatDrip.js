import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { POST_DEATH_INSERT_SLUGS } from "../actors/character/deaths-door.js";
import { actorPastDeathKind } from "../actors/character/deaths-door-actor.js";

/**
 * The dead keep talking, and the log should say so.
 *
 * A character who came back wearing one of the three post-death inserts has everything they say
 * in chat turned over the way their sheet is: a black card instead of parchment (see the stylesheet,
 * "What the undead say, said on black"). It carries no rule and clicks nothing; it is there so a
 * Ghost's line doesn't scroll past reading like anyone else's.
 *
 * The name is older than that. Every death — insert or not — used to hang a dark fringe off the
 * bottom edge of its message, and that fringe is the "drip" here. It was cut by request; the flag,
 * the classes and this module keep their names rather than churning three files and their tests
 * over a word. A character who stepped through the Last Door and stayed there is still stamped,
 * and now draws nothing.
 *
 * STAMPED AT CREATION, not read at render. The kind rides along on the message as a flag, so a
 * message means "spoken while dead" for good: the log stays a record of when they died rather
 * than being rewritten the moment they do. (It also keeps the render pass off the actor
 * documents, which matters when a long backlog re-renders.) The cost is that messages already
 * in the log when a PC dies are never repainted — which is the reading we want anyway.
 */

/** Message flag (under the system scope) holding the speaker's {@link actorPastDeathKind}. */
export const DEATH_DRIP_FLAG = "deathDrip";

const DRIP_CLASS = "stonetop-death-drip";

/**
 * The `updateSource` fragment stamping a message with its speaker's death, or null for a living
 * speaker. Returned as a fragment rather than a bare value so the flag path lives only here and
 * the preCreate hook can fold it in with the changes it is already making.
 */
export function deathDripStamp(actor) {
	const kind = actorPastDeathKind(actor);
	return kind ? { [`flags.${STONETOP_SCOPE}.${DEATH_DRIP_FLAG}`]: kind } : null;
}

/**
 * Mark a rendered message with its speaker's death (dispatched from stonetop.js
 * renderChatMessageHTML).
 *
 * Three classes at most: the base one, the kind, and `--insert`. That last one says the speaker
 * came BACK rather than merely died, and is the line the black card repaint is drawn on — the
 * same distinction, and the same reason, as the sheet's `stonetop-past-death` (see
 * StonetopCharacterSheet._stampPastDeath). Named once here rather than spelled out as a
 * three-way `:is()` on every rule that wants it.
 *
 * The base and kind classes carry no styling of their own now that the fringe is gone; they stay
 * because the kind is what the repaint tints from, and because a hand-edited flag naming a kind
 * CSS has never heard of should land somewhere inert rather than throw.
 */
export function markDeathDrip(message, html) {
	const root = html?.[0] ?? html;
	if (!root?.classList) return;

	const kind = message?.getFlag?.(STONETOP_SCOPE, DEATH_DRIP_FLAG);
	if (!kind) return;

	root.classList.add(DRIP_CLASS, `${DRIP_CLASS}--${kind}`);
	if (POST_DEATH_INSERT_SLUGS.includes(kind)) root.classList.add(`${DRIP_CLASS}--insert`);
}
