// The `gmToolkit` Actor subtype, as the rest of the system needs to talk about it.
//
// This is to the toolkit what steading-portrait.js's `STEADING_ACTOR_TYPE` and utils/world.js's
// `getStonetopSteadingActor` are to the steading: the one place the type string is written, the
// one way to find one, and the one way to make one. Four modules needed all three (the ready
// hook that mints it, the sidebar Create-Actor flow, the Create-Content site flow, and the sheet
// itself), and without a home they had grown two different "find the toolkit" predicates and two
// different create payloads that spelled the same i18n fallback longhand.
//
// Like the steading, the toolkit is a SINGLETON: hooks/StonetopSingleton.js vetoes a second
// create and refuses to delete the last one, which is what lets `theGmToolkit()` below be a
// plain lookup rather than a question about ownership.

import { SYSTEM_ID } from "../../system-id.js";

/** The Actor subtype. Written once; everything else imports it. */
export const GM_TOOLKIT_TYPE = "gmToolkit";

/**
 * The toolkit's portrait: a reader behind an open book, on the same cream-rimmed black disc the
 * Book I creature marks and the follower marker wear, so the GM's own sheet reads as one set with
 * them in the sidebar. See the file's own comment for the recipe and its attribution.
 *
 * Foundry's stock `mystery-man` is the alternative, and it is actively wrong here: it says "a
 * person whose portrait nobody has set yet", which invites a GM to go looking for one. The toolkit
 * is not a person and has no portrait to find.
 */
export const GM_TOOLKIT_DEFAULT_IMG = `systems/${SYSTEM_ID}/assets/icons/gm-toolkit.svg`;

/** The toolkit's default name, from the manifest's type label when there is one. */
function gmToolkitDefaultName() {
	return game.i18n?.localize?.(`TYPES.Actor.${GM_TOOLKIT_TYPE}`) || "GM Toolkit";
}

/** Is this an existing toolkit, or creation data for one? Used by the singleton guards. */
export function isGmToolkitData(actorOrData) {
	return actorOrData?.type === GM_TOOLKIT_TYPE;
}

/** Every toolkit in the world. One, by the singleton guards; a list so those guards can count. */
export function gmToolkitActors() {
	return game.actors?.filter(isGmToolkitData) ?? [];
}

/**
 * The world's GM Toolkit, or null.
 *
 * ONE per world, not one per GM, and enforced as such (hooks/StonetopSingleton.js vetoes a
 * second create and refuses to delete the last). So this is a plain lookup with no notion of
 * whose it is, and there is deliberately no ownership test here: `actor.isOwner` and
 * `testUserPermission(user, "OWNER")` both short-circuit to true for ANY gamemaster, so a
 * permission test cannot tell one GM's document from another's and would silently answer "the
 * first one in the list" while reading as though it meant "mine".
 *
 * One is the right number because nothing on the sheet is per-GM. The Moves and Core Loop tabs
 * are reference transcribed from the playbook; the Threats and Sites tabs read their storage off
 * the STEADING; and the one authored surface, the "I wonder..." list on `system.wonders`, is the
 * world's open questions rather than one GM's, which is why it sits on this document at all. A
 * second toolkit would be a second window onto identical data. What genuinely does vary per GM is
 * which sheet their "C" key opens, and that is a per-user flag on the User document
 * (`gmToolkitAssigned`), not a second Actor.
 */
export function theGmToolkit() {
	return gmToolkitActors().at(0) ?? null;
}

/**
 * Is this world's launch aware of the subtype?
 *
 * `game.model` — which is what `Actor.TYPES` reads and what the document validator checks a
 * `type` against — is built by the SERVER from the system manifest at WORLD LAUNCH
 * (World#prepareDataModel), so a table that updated the system and pressed F5 is running new
 * code against an old type list. Creating against that list throws a DataModelValidationError
 * deep inside the document constructor, which surfaces as a stack trace and a "see the console"
 * toast: nothing that tells anyone the actual answer is to relaunch the world.
 *
 * Answers true when the list is unavailable (older cores, the unit-test environment), so this
 * only ever suppresses a create it is sure would fail.
 */
function isGmToolkitTypeAvailable() {
	const types = game.documentTypes?.Actor;
	return !Array.isArray(types) || types.includes(GM_TOOLKIT_TYPE);
}

/** The message shown when the world predates the subtype. Stated once, shown by both flows. */
const GM_TOOLKIT_RELAUNCH_WARNING =
	"This world was launched before the GM Toolkit existed. Return to Setup and launch the world again, then try once more.";

/**
 * Create a GM Toolkit actor, or null if it could not be made.
 *
 * @param {object}  [options]
 * @param {string}  [options.name]    Overrides the default name.
 * @param {string|null} [options.folder]
 * @param {boolean} [options.warn=true]  Post the relaunch/failure notices. The ready hook's
 *   silent mint passes false: it runs before anyone has asked for anything, so a world that
 *   cannot make one yet should say nothing and try again next load.
 */
export async function createGmToolkit({ name = "", folder = null, warn = true } = {}) {
	if (!isGmToolkitTypeAvailable()) {
		if (warn) ui.notifications?.warn?.(GM_TOOLKIT_RELAUNCH_WARNING, { permanent: true });
		return null;
	}
	try {
		// `getDocumentClass` is the right way to reach a configured document class, but it is a
		// bare global that only exists once Foundry has booted — falling back to `Actor` keeps
		// this callable from the unit tests, which stub the document class directly.
		const cls = globalThis.getDocumentClass?.("Actor") ?? globalThis.Actor;
		return await cls.create({
			name: name?.trim() || gmToolkitDefaultName(),
			type: GM_TOOLKIT_TYPE,
			folder,
			img: GM_TOOLKIT_DEFAULT_IMG,
			// Nobody places the toolkit on a scene, but a GM CAN drag it there, and a sheet whose
			// sidebar row and token disagreed would read as two different documents. Stated here
			// rather than left to Foundry, which defaults the token to mystery-man regardless of img.
			prototypeToken: { texture: { src: GM_TOOLKIT_DEFAULT_IMG } },
		}) ?? null;
	} catch (err) {
		console.error("Stonetop | failed to create GM Toolkit", err);
		if (warn) ui.notifications?.error?.("Couldn't create the GM Toolkit. See the console for details.");
		return null;
	}
}

