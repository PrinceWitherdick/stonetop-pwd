// The Actor subtypes, sorted into the kinds the rest of the system asks about.
//
// Each new subtype used to be added by hand to a scattered list per question (is it in a fight? can
// a player run it? does its sheet mean a character's debilities?), and the list nobody remembered
// was the bug. Ask these sets instead, and a new subtype is placed once, here.
//
// The type strings come from each subtype's own home, which is the one place each is written.

import { STEADING_ACTOR_TYPE } from "../actors/steading/steading-portrait.js";
import { SETTLEMENT_TYPE } from "../actors/settlement/settlement-type.js";
import { GM_TOOLKIT_TYPE } from "../actors/gmtoolkit/gm-toolkit-actor.js";

/**
 * Somebody, rather than a place or the GM's own sheet: the types with a face, HP and a token that
 * fights. Anything else (the steadings, the toolkit, a third-party type) is not a person.
 * Read by fight/fight-sides.js (who can be a combatant), hooks/assign-to-player.js (what a GM can
 * hand a player), utils/actor-portrait-picker.js (whose portrait the gallery opens from),
 * actors/character/invocation-apply.js (who a Bath can heal) and RosterDialog.js (who a Judge's
 * or Blessed's roster row can name).
 */
export const PERSON_ACTOR_TYPES = new Set(["character", "npc", "monster"]);

/**
 * A steading: Stonetop itself, or another place with the same stat line (a settlement). Their
 * "debilities" are the steading's own (diminished/lacking/malcontent), and their sheets print the
 * homefront moves that name them. Read by hooks/RenderActorSheet.js, which leaves these sheets out
 * of the character-debility tooltips.
 */
export const STEADING_ACTOR_TYPES = new Set([STEADING_ACTOR_TYPE, SETTLEMENT_TYPE]);

/**
 * GM content a player never makes from the Create-Actor picker: they make their own character.
 * Read by actors/StonetopActor.js#createDialog. Only a picker filter: hooks/StonetopSingleton.js
 * vetoes the create itself for the types a player must never make by any path.
 */
export const GM_ONLY_ACTOR_TYPES = new Set(["monster", "npc", GM_TOOLKIT_TYPE, SETTLEMENT_TYPE]);
