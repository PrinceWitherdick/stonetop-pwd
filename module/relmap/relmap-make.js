// HOW A RELATIONSHIP MAP COMES INTO EXISTENCE. Two ways, and the difference between them is the
// whole of this file: the one the world is GIVEN, and the one somebody ASKS FOR.
//
// ⚠ THE SEEDED MAP IS NAMED FOR YOU AND EVERY LATER ONE ASKS. A world arrives with a map called
// "Stonetop", because that is the map every table at this game wants and offering to make it is a
// button in front of an answer nobody has to think about — the steading sheet's Relationship Map
// tab should open on a board, not on an invitation. But once a GM has deleted that map, giving them
// another one called "Stonetop" is answering a question they have already answered; the second map
// is a decision, so the button asks what it is called.
//
// WHY THE SEED AND THE PROMPT SIT TOGETHER. They are one rule seen from two sides, and the rule is
// "a map is named once, by whoever is entitled to name it". Split across two files, the day the
// seed name changes is the day the two spellings drift.

import { info, error } from "../utils/logger.js";
import { localize } from "../utils/i18n.js";
import { isPrimaryGM } from "../utils/primary-gm.js";
import { getSetting, setSetting } from "../settings.js";
import { promptForText } from "../dialogs/content-picker.js";
import { canCreateRelationshipMap, createRelationshipMap, listRelationshipMaps } from "./relmap-doc.js";

/** The world-scoped latch that says this world has had its one map. Registered in settings.js. */
export const RELMAP_SEED_SETTING = "relationshipMapSeeded";

/**
 * Give this world the relationship map it comes with, once and never again.
 *
 * Run from the world-setup finishing pass on every GM load, like every other lane there, and every
 * one of the guards below is what makes that safe.
 *
 * ⚠ THE LATCH IS THE FEATURE, not bookkeeping. Without it a GM who deletes the map finds it back
 * on the next load, which is a map nobody can be rid of — the same rule the party and village
 * boards keep with their own marks (`hadPartyPage`, `hadVillagePage`), and for the same reason:
 * anything that seats itself unasked has to be deletable, or it is not a suggestion, it is
 * furniture.
 *
 * ⚠ A WORLD THAT ALREADY HAS A MAP IS LATCHED WITHOUT BEING GIVEN ONE. Every world that existed
 * before this shipped made its map from the invitation, and a seed that only asked "is the latch
 * set?" would hand each of them a second "Stonetop" beside the one they have been using.
 *
 * ⚠ AND IT IS NOT LATCHED ON A FAILED CREATE. A create can fail for reasons that pass — a lost
 * connection mid-load — and a world latched on that failure would never be offered its map again
 * by anything except the invitation the seed exists to spare it.
 *
 * THE PRIMARY GM ALONE, the guard every unasked shared write in this system runs under: this is a
 * world document plus a world setting, written on load by whoever is at the table, and two GMs
 * loading in the same minute would otherwise each find no map and each make one.
 *
 * @returns {Promise<JournalEntry|null>}  the map that was made, or null when none was.
 */
export async function seedRelationshipMapOnce() {
	if (!isPrimaryGM()) return null;
	if (getSetting(RELMAP_SEED_SETTING)) return null;
	try {
		if (listRelationshipMaps().length) {
			await setSetting(RELMAP_SEED_SETTING, true);
			return null;
		}
		const made = await createRelationshipMap(localize("stonetop.relmap.maps.seedName"));
		if (!made) return null;
		await setSetting(RELMAP_SEED_SETTING, true);
		info(`Seeded this world's relationship map ("${made.name}").`);
		return made;
	} catch (err) {
		// Left unlatched on purpose, so the next load tries again. Reported and abandoned, like
		// every other lane in the setup pass: a world without its map is a tab with an invitation
		// on it, which is a fully usable answer.
		error("Failed to give this world its relationship map:", err);
		return null;
	}
}

/**
 * Ask what the new map is called, and make it.
 *
 * The two places a person can make a map — the steading sheet's empty Relationship Map tab and the
 * hotbar macro on a world with none — and one question between them, so the two cannot ask it
 * differently.
 *
 * ⚠ THE BOX OPENS EMPTY. Filling it with "Stonetop" would be the old behaviour wearing a dialog:
 * the reader who is here has deleted a map called Stonetop, and handing the name back to them is
 * offering to undo their own decision. The example names are the PLACEHOLDER, which is a hint about
 * what belongs in the field rather than a value that gets saved by pressing Enter.
 *
 * AN EMPTY NAME IS TAKEN, NOT REFUSED, exactly as `mapPageName` takes an empty board name: it falls
 * back to "Relationship Map", and the map is renameable from the sidebar like any journal entry. A
 * dialog that rejects the save over a blank field is a dialog that has to explain itself, for a
 * mistake that costs one rename to fix.
 *
 * @returns {Promise<JournalEntry|null>}  the new map, or null when the reader dismissed the box or
 *          may not make one.
 */
export async function promptForNewRelationshipMap() {
	// Asked BEFORE the box opens, not only inside `createRelationshipMap`, so a reader who may not
	// make a map is never asked to name one. Silent: both callers already say who can — the
	// steading tab in the line under its invitation, the macro in a notification of its own.
	if (!canCreateRelationshipMap()) return null;
	const name = await promptForText({
		title: localize("stonetop.relmap.maps.newTitle"),
		buttonLabel: localize("stonetop.relmap.maps.newGo"),
		placeholder: localize("stonetop.relmap.maps.namePlaceholder"),
	});
	// null is the dismissal and "" is a name nobody typed; only the first means "never mind".
	if (name === null) return null;
	return await createRelationshipMap(name || localize("stonetop.relmap.untitled"));
}
