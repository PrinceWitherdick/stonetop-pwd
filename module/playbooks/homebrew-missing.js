// Characters who play a HOMEBREW playbook this world doesn't have (brought in from another world, or
// the playbook was deleted here). Their sheet says so and offers the GM a Restore button
// (actor-header.hbs, homebrew-store.js#restoreCarriedPlaybook); this tells the GM up front, once at
// load and whenever such a character arrives, so nobody finds out from a half-working sheet mid-game.

import { isPrimaryGM } from "../utils/primary-gm.js";
import { homebrewPlaybookBySlug, HOMEBREW_SLUG_PREFIX } from "./playbook-catalog.js";
import { STONETOP_SCOPE, HOMEBREW_PLAYBOOK_COPY_FLAG } from "../actors/character/StonetopFlags.js";

/**
 * The copy of its homebrew playbook `actor` carries, when it is a copy of the playbook they PLAY
 * (system.playbook.slug), or null. A copy of another one, left by a change of playbook that carried
 * none, is never offered as theirs. A copy with no slug of its own (an old one) is taken as theirs.
 */
export function carriedCopyOf(actor) {
	const copy = actor?.flags?.[STONETOP_SCOPE]?.[HOMEBREW_PLAYBOOK_COPY_FLAG];
	const slug = actor?.system?.playbook?.slug;
	if (!copy || !slug) return null;
	const own = String(copy.playbook?.slug ?? "");
	return !own || own === slug ? copy : null;
}

/** Characters whose recorded homebrew playbook isn't in this world. PURE but for the catalog. */
export function charactersMissingPlaybook(actors = globalThis.game?.actors, items) {
	return [...(actors ?? [])].filter(a => {
		const slug = a?.type === "character" ? a.system?.playbook?.slug : null;
		if (!String(slug ?? "").startsWith(HOMEBREW_SLUG_PREFIX)) return false;
		return !homebrewPlaybookBySlug(slug, items);
	});
}

function tellGM(actors) {
	if (!actors.length) return;
	const restorable = actors.filter(a => carriedCopyOf(a));
	const names = actors.map(a => `${a.name} (${a.system.playbook.name || "a homebrew playbook"})`).join(", ");
	const how = restorable.length
		? " Open their sheet and press Restore it beside the playbook's name to add it from the copy they carry."
		: " Import the playbook in the Playbook Builder (Create Item → Homebrew Playbook) to fix their sheets.";
	ui.notifications?.warn?.(`${actors.length === 1 ? "This character plays" : "These characters play"} a homebrew playbook this world doesn't have: ${names}.${how}`, { permanent: true });
}

/**
 * The load-time check. Called by the playbook library's run (hooks/Ready.js) once it has added what
 * the library holds, so a character from another world whose playbook just arrived isn't named.
 */
export function noticeMissingPlaybooks() {
	if (isPrimaryGM()) tellGM(charactersMissingPlaybook());
}

export function registerMissingPlaybookNotice() {
	Hooks.on("createActor", actor => {
		if (!isPrimaryGM() || actor?.type !== "character") return;
		tellGM(charactersMissingPlaybook([actor]));
	});
}
