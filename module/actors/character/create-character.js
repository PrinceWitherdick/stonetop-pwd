// Minting a player character. Shared by the Welcome guide's player roster and the
// sidebar "Create Actor" picker so both entry points mint identically: a player who
// already has a character is asked whether this one joins it or replaces it (a replace
// deletes, and says so first), the player gets ownership and — unless they are keeping a
// character they already play — the assignment, and their client is greeted with the
// creation intro rather than a blank sheet (see _maybeOpenCharacterCreation in
// hooks/Ready.js).
//
// A PLAYER MAY RUN MORE THAN ONE CHARACTER, and this is the flow that has to allow it:
// nothing downstream stands in the way. No party-facing surface reads the table off
// `User#character` — they all enumerate by actor type and playbook (utils/playbook-actors.js)
// — and every permission question is answered by ownership, so a second sheet is a full
// member of the party: the Chronicle, Introductions, the expedition roster, seasonal upkeep
// and the relationship board all count it. What the single-slot `character` field still buys
// its holder is core's own conveniences (the player-list entry, the C hotkey, the default
// speaker), which is why an added character leaves an existing assignment where it is.

import { charactersOwnedBy } from "../../utils/playbook-actors.js";
import { bringDialogToFront } from "../../utils/front-on-open.js";
import { escHtml } from "../../utils/strings.js";
import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { isMidCreation, progressFor } from "./onboarding-progress.js";

/**
 * Create a character, hand it to a player, and greet them with character creation.
 *
 * @param {string|null} userId            The player it belongs to; null mints it unassigned.
 * @param {object} [options]
 * @param {string|null} [options.folder]  Actor folder id to file the sheet under.
 * @param {string} [options.name]         Explicit name; defaults to "<player>'s Character".
 * @returns {Promise<Actor|null>}  The new character, or null if the choice about an
 *                                 existing one was dismissed, or creation failed
 *                                 (already reported).
 */
export async function createCharacterForUser(userId, { folder = null, name = "" } = {}) {
	const user = userId ? game.users?.get(userId) ?? null : null;
	if (userId && !user) return null;

	// Making a character for someone who already has one is two different jobs wearing one
	// button: a SECOND character to play alongside the first, or a REPLACEMENT for it. Only
	// the person pressing it knows which, and getting it wrong in either direction is bad —
	// an unasked-for delete throws away an hour of answers, an unasked-for addition leaves a
	// sheet nobody meant to make. So ask, and let the answer drive both the delete below and
	// the assignment further down.
	let alongside = false;
	if (user) {
		const existing = charactersOwnedBy(user.id);
		if (existing.length) {
			// Deleting an Actor needs Assistant GM or better — Actor's metadata overrides
			// only `create` and `update`, so `delete` keeps the base "ASSISTANT" default,
			// and owning the sheet doesn't help. Players still reach this flow, because the
			// system grants them ACTOR_CREATE so the sidebar's Create Actor button works
			// (_ensurePlayerActorCreationGrant). They are offered the addition alone rather
			// than a deletion confirmation the server would then refuse.
			const canReplace = existing.every(a => a.canUserModify(game.user, "delete"));
			const choice = await _askAboutExisting(user, existing, {
				canReplace,
				isSelf: user.id === game.user?.id,
			});
			if (!choice) return null;
			alongside = choice === "add";
			if (!alongside && !await _deleteCharacters(existing, user)) return null;
		}
	}

	// Granting ownership is a GM privilege; a player creating their own character is made
	// its owner by the server anyway, so there's nothing to stamp. Assignment is wider:
	// core lets any user update their own User document, so a self-mint can claim its own
	// character (BaseUser.#canUpdate: "Players may only modify themselves").
	const isGM = !!game.user?.isGM;
	const isSelf = !!user && user.id === game.user?.id;
	const createData = {
		name: name?.trim() || (user ? `${user.name}'s Character` : "New Character"),
		type: "character",
	};
	if (folder) createData.folder = folder;
	if (user && isGM) createData.ownership = { [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
	// The owner's client greets the player with the creation intro, then clears this — on
	// the next createActor, or on their next login. See _maybeOpenCharacterCreation.
	if (user) createData.flags = { [STONETOP_SCOPE]: { autoOpenFor: user.id } };

	let actor;
	try {
		actor = await getDocumentClass("Actor").create(createData);
	} catch (err) {
		console.error("Stonetop | failed to create character", err);
		ui.notifications?.error?.(user
			? `Couldn't create a character for ${user.name}.`
			: "Couldn't create the character.");
		return null;
	}
	if (!actor) return null;

	// Ownership alone only grants the player permission to edit the sheet — it doesn't
	// make this their character. Assign it as the user's player character too, so Foundry
	// treats it as their PC everywhere (the player list, token assignment, default
	// speaker, "release control", etc.).
	//
	// EXCEPT for a character added alongside one they already play: `User#character` holds a
	// single id, so assigning this one would silently demote the sheet they are in the middle
	// of playing — their player-list entry and their C hotkey would swing to a character that
	// has not been made yet. The one time an addition still claims the slot is when nothing
	// holds it: a player whose characters were all handed to them by ownership alone has an
	// empty `character`, and leaving it empty keeps re-triggering the "no character yet"
	// orientation in hooks/Ready.js. Ownership, which is what actually gates play, is stamped
	// on the create either way.
	const claimsAssignment = !alongside || !user?.character;
	if (user && (isGM || isSelf) && claimsAssignment) {
		try {
			await user.update({ character: actor.id });
		} catch (err) {
			console.error("Stonetop | failed to assign character to player", err);
			ui.notifications?.warn?.(`Created “${actor.name}” but couldn't set it as ${user.name}'s character.`);
			return actor;
		}
	}

	_announce(actor, user);
	return actor;
}

/**
 * Ask what a new character means for the ones this player already has: a second character
 * to play alongside them, or a replacement that deletes them.
 *
 * The replace side names anyone part-way through building theirs. The Welcome guide's roster
 * puts this button directly beside a row reading "on page 4 of 9", so the GM most likely to
 * press it is the one whose player is mid-creation right now — and what a replace takes isn't
 * a blank sheet, it's an hour of answers. Worth spelling out before the delete, not after.
 *
 * Adding is offered FIRST and is the default: it is the answer that destroys nothing, and a
 * stray Enter on this dialog should never be how a character goes away.
 *
 * @param {User}   user       The player the new character is for.
 * @param {Actor[]} existing  The characters they already own.
 * @param {object} [options]
 * @param {boolean} [options.canReplace]  May this client actually delete them? A player can't
 *                                        (delete is Assistant GM or better), so they are
 *                                        offered the addition alone.
 * @param {boolean} [options.isSelf]      Is the presser the player in question? Only the
 *                                        pronouns change.
 * @returns {Promise<"add"|"replace"|null>}  null if dismissed.
 */
function _askAboutExisting(user, existing, { canReplace = true, isSelf = false } = {}) {
	const names = existing.map(a => `<strong>${escHtml(a.name)}</strong>`).join(", ");
	const it    = existing.length === 1 ? "it" : "them";
	const has   = isSelf ? "You already play" : `<strong>${escHtml(user.name)}</strong> already plays`;
	// Deliberately plain markup and a bare core dialog, as this confirmation has always been:
	// nothing in this system's stylesheet reaches inside one, so <strong> carries the emphasis
	// on its own rather than leaning on a class that would render here as an unstyled span.
	const busy = existing.filter(isMidCreation)
		.map(a => `<strong>${escHtml(a.name)}</strong> (${escHtml(progressFor(a).text)})`);
	const busyNote = busy.length
		? ` ${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} still being created, so everything ` +
		  `answered so far goes with ${it}` +
		  (isSelf ? "." : `, and the creation window closes on ${escHtml(user.name)}'s screen.`)
		: "";
	const replaceLine = canReplace
		? `<p><strong>Replace</strong> instead and ${it} ${existing.length === 1 ? "is" : "are"} ` +
		  `<strong>permanently deleted</strong> first. This can't be undone.${busyNote}</p>`
		: `<p>Replacing ${it} would mean deleting ${it}, which only your GM can do.</p>`;

	return new Promise(resolve => {
		// Built in here so each button closes over THIS dialog's resolve. Insertion order is
		// render order, which is why Add sits first: the affirmative, non-destructive answer
		// leads, and Replace never occupies the spot a reflexive click lands on.
		const buttons = {
			add: {
				icon: '<i class="fas fa-user-plus"></i>',
				label: "Add Another",
				callback: () => resolve("add"),
			},
		};
		if (canReplace) {
			buttons.replace = {
				icon: '<i class="fas fa-triangle-exclamation"></i>',
				label: "Replace",
				callback: () => resolve("replace"),
			};
		}
		buttons.cancel = {
			icon: '<i class="fas fa-xmark"></i>',
			label: "Cancel",
			callback: () => resolve(null),
		};

		new Dialog({
			title: isSelf ? "Another character?" : `Another character for ${user.name}?`,
			content: `<p>${has} ${names}.</p>` +
				`<p><strong>Add Another</strong> keeps ${it} and makes a new sheet to play alongside.</p>` +
				replaceLine,
			buttons,
			default: "add",
			render: bringDialogToFront,
			// A dismissed dialog is a "no". Harmless after a button already answered: a
			// settled promise ignores a second resolve.
			close: () => resolve(null),
		}).render(true);
	});
}

/** Delete the characters being replaced. Returns false (and reports) if the delete failed. */
async function _deleteCharacters(existing, user) {
	try {
		await getDocumentClass("Actor").deleteDocuments(existing.map(a => a.id));
		return true;
	} catch (err) {
		console.error("Stonetop | failed to delete old character", err);
		ui.notifications?.error?.(`Couldn't replace ${user.name}'s character.`);
		return false;
	}
}

/** Say where the new sheet went, and whether its player is there to be greeted by it. */
function _announce(actor, user) {
	const info = message => ui.notifications?.info?.(message);
	if (!user) return info(`Created “${actor.name}”. Assign it to a player when you're ready.`);
	if (user.id === game.user?.id) return info(`Created “${actor.name}”. Starting character creation.`);
	if (user.active) return info(`Created “${actor.name}” and started character creation on ${user.name}'s screen.`);
	return info(`Created “${actor.name}” for ${user.name}. It'll be waiting when they log in.`);
}
