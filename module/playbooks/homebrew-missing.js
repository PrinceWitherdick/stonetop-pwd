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

// The notice up now and the characters it names, so it can be taken down once they are mended.
let _shown = null;

/**
 * "Angharad ×4 (The Stranger), Test (The Familiar Face)": who is named, a name played four times said once
 * with its count, so a world with several copies of one character reads as one line each. PURE.
 */
export function missingPlaybookNames(actors) {
	const rows = new Map();
	for (const a of actors ?? []) {
		const label = `${a.name} (${a.system?.playbook?.name || "a homebrew playbook"})`;
		const row = rows.get(label) ?? { name: a.name, playbook: a.system?.playbook?.name || "a homebrew playbook", n: 0 };
		row.n++;
		rows.set(label, row);
	}
	return [...rows.values()].map(r => `${r.name}${r.n > 1 ? ` ×${r.n}` : ""} (${r.playbook})`).join(", ");
}

function tellGM(actors) {
	if (!actors.length) return;
	const restorable = actors.filter(a => carriedCopyOf(a));
	const names = missingPlaybookNames(actors);
	const how = restorable.length
		? " Open their sheet and press Restore it beside the playbook's name to add it from the copy they carry."
		: " Import the playbook in the Playbook Builder (Create Item → Homebrew Playbook) to fix their sheets.";
	_shown?.note?.remove?.();
	const note = ui.notifications?.warn?.(`${actors.length === 1 ? "This character plays" : "These characters play"} a homebrew playbook this world doesn't have: ${names}.${how}`, { permanent: true });
	_shown = note ? { note, ids: actors.map(a => a.id) } : null;
}

/**
 * A homebrew playbook arrived (saved, restored, adopted from the library): the notice comes down once no
 * character it named is still missing theirs, and is said again, shorter, when some still are.
 */
function retireNotice() {
	if (!_shown) return;
	const named = _shown.ids.map(id => globalThis.game?.actors?.get(id)).filter(Boolean);
	const still = charactersMissingPlaybook(named, globalThis.game?.items);
	if (still.length === named.length && named.length === _shown.ids.length) return;
	_shown.note?.remove?.();
	_shown = null;
	tellGM(still);
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
		if (!charactersMissingPlaybook([actor]).length) return;
		// Said again with everyone the notice up now names, so the newcomer doesn't push them off it.
		const named = (_shown?.ids ?? []).filter(id => id !== actor.id).map(id => globalThis.game?.actors?.get(id)).filter(Boolean);
		tellGM([...charactersMissingPlaybook(named), actor]);
	});
	// Read against the world's items as they stand, not the catalog's cache, which this same hook drops.
	Hooks.on("createItem", item => { if (!item?.parent && item?.type === "playbook") retireNotice(); });
	Hooks.on("deleteActor", () => retireNotice());
}
