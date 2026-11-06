import { SYSTEM_ID } from "../system-id.js";
import { getBooleanSetting } from "../settings.js";

// Who holds a world arcanum, and who may read its back off the item sheet. Shared by the item
// sheet (StonetopArcanumSheet: the back gate, the in-use warning and the locked option slugs) and
// the delete guard (module/hooks/arcana-card-edits.js).

/**
 * A character's arcana flags, live scope and the legacy "stonetop" scope a migrated world may
 * still store them under, lists merged so a card held under either counts.
 */
function _arcanaFlags(actor) {
	return [actor?.flags?.[SYSTEM_ID]?.arcana, actor?.flags?.stonetop?.arcana].filter(Boolean);
}

function _lists(actor, key) {
	return _arcanaFlags(actor).flatMap(arcana => (Array.isArray(arcana[key]) ? arcana[key] : []));
}

/**
 * True when this actor holds the card, or still keeps play state keyed by it: in its
 * owned / identified / flipped / Seeker-draw lists, or in marks, unlock counts, back options or
 * Seeker roles. Marks are saved by POSITION within a track and option counts by option slug, so
 * any of these means an edit to the card's glyphs or option slugs moves somebody's marks.
 */
export function actorHoldsArcanum(actor, slug) {
	if (!slug) return false;
	const prefix = `${slug}:`;
	const keyedBySlug = map => !!map && typeof map === "object"
		&& Object.keys(map).some(k => k === slug || k.startsWith(prefix));
	for (const arcana of _arcanaFlags(actor)) {
		if ([arcana.owned, arcana.identified, arcana.flipped, arcana.minorDraw]
			.some(list => Array.isArray(list) && list.includes(slug))) return true;
		if ([arcana.boxes, arcana.unlock, arcana.backOptions, arcana.minorRoles].some(keyedBySlug)) return true;
	}
	return false;
}

/** Every actor in the world holding this card (see actorHoldsArcanum), in directory order. */
export function arcanumHolders(slug, actors = globalThis.game?.actors) {
	if (!slug) return [];
	return [...(actors ?? [])].filter(actor => actorHoldsArcanum(actor, slug));
}

/** The characters a user plays: their assigned character, and every character they own. */
export function viewerCharacters(user = globalThis.game?.user, actors = globalThis.game?.actors) {
	const out = new Set();
	if (user?.character) out.add(user.character);
	for (const actor of actors ?? []) {
		if (actor?.type !== "character") continue;
		const owns = typeof actor.testUserPermission === "function"
			? actor.testUserPermission(user, "OWNER")
			: !!actor.isOwner;
		if (owns) out.add(actor);
	}
	return [...out];
}

/**
 * characterHasArcanumBack's answer from the flags alone: true or false, or null when it rests on
 * the card's unlock track, which needs the card (_unlockedNow).
 */
function _backFromFlags(actor, slug) {
	if (!slug || !_lists(actor, "owned").includes(slug)) return false;
	if (!_lists(actor, "identified").includes(slug)) return false;
	if (_lists(actor, "revealed").includes(slug)) return true;
	if (_lists(actor, "unlockedOnce").includes(slug)) return true;
	return null;
}

async function _unlockedNow(actor, slug) {
	try {
		return !!(await actor.typedActor?.isArcanumUnlocked?.(slug));
	} catch (err) {
		console.warn("Stonetop | Couldn't read whether an arcanum is unlocked", err);
		return false;
	}
}

/**
 * Whether this character has earned the card's back: they hold it identified, and the GM revealed
 * it to them or it is unlocked. Unlocked reads the latch (`arcana.unlockedOnce`, ruling A2) and
 * then the character's own isArcanumUnlocked. Identified comes first, as on the character sheet,
 * which shows nothing of an unidentified card.
 */
export async function characterHasArcanumBack(actor, slug) {
	return _backFromFlags(actor, slug) ?? await _unlockedNow(actor, slug);
}

/**
 * May this user read the card's BACK on its item sheet (ruling A3)?
 *
 * A homebrew card is a world item every player can open from the Items sidebar (it is shared at
 * Observer so other players' sheets can resolve it), so without this its back, GM prep and
 * drafts included, was readable by anyone. Shown to: a GM; everyone when the world's
 * `arcanaPlayersSeeBothSides` peek switch is on; the card's own author (OWNER of the item); and a
 * player whose own character has the back (characterHasArcanumBack). Shipped cards opened from
 * anywhere go through the same gate.
 *
 * @param {string} slug
 * @param {{user?: object, actors?: Iterable<object>, itemIsOwner?: boolean, playersSeeBoth?: boolean}} [opts]
 */
export async function viewerMaySeeArcanumBack(slug, { user = globalThis.game?.user, actors = globalThis.game?.actors, itemIsOwner = false, playersSeeBoth } = {}) {
	if (user?.isGM) return true;
	if (playersSeeBoth ?? getBooleanSetting("arcanaPlayersSeeBothSides")) return true;
	if (itemIsOwner) return true;
	if (!user || !slug) return false;
	// The flags first, so the card is only looked up when no character settles it without.
	const unread = [];
	for (const actor of viewerCharacters(user, actors)) {
		const known = _backFromFlags(actor, slug);
		if (known) return true;
		if (known === null) unread.push(actor);
	}
	const unlocked = await Promise.all(unread.map(actor => _unlockedNow(actor, slug)));
	return unlocked.some(Boolean);
}
