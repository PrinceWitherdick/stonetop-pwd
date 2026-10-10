// "The first time you use any move marked with an asterisk (*), cross off 'Would-be'." Crossed off
// is now the flag (WBH_HERO_FLAG), written on the first USE of a starred move (WouldBeHeroAsterisk.js).
//
// Up to 1.6.5, OWNING a starred move was enough: the header read "The Hero" from the items alone,
// and the flag was only the announcement's latch, which a compendium drop, an import or a duplicated
// pre-built character never set. Those heroes have been "The Hero" at the table, and the promise the
// ruling made is that an already-crossed-off hero stays so; without this they would read as
// "The Would-Be Hero" again in the header, the sidebar and Introductions.
//
// So a Would-Be Hero holding a starred move made under a release that crossed off on ownership
// (LAST_OWNERSHIP_VERSION or earlier) is flagged, silently: the crossing-off already happened, and
// announcing it again would be news to nobody. A starred move taken since waits for its first use.
//
// A flag already written either way is left alone, FALSE included: that is a hero whose crossing-off
// was undone by hand (WouldBeHeroAsterisk.js#restoreWouldBe), and this runs again every release.

import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { WBH_HERO_FLAG, WBH_PLAYBOOK_SLUG, ASTERISK_MOVES } from "../actors/character/WouldBeHeroAsterisk.js";
import { playbookSlug } from "../utils/playbook-slug.js";
import { madeAtOrBefore } from "./made-under.js";

// The last release that crossed off "Would-be" on owning a starred move.
export const LAST_OWNERSHIP_VERSION = "1.6.5";

/**
 * Whether `actor` was already The Hero by the old reading: a Would-Be Hero, never flagged, holding a
 * starred move made under a release that crossed off on ownership. PURE apart from the actor.
 */
export function heroByOwnership(actor) {
	if (actor?.type !== "character" || playbookSlug(actor) !== WBH_PLAYBOOK_SLUG) return false;
	if (actor.getFlag?.(STONETOP_SCOPE, WBH_HERO_FLAG) != null) return false;
	return Array.from(actor.items ?? []).some(i => i.type === "move"
		&& (i.system?.asterisk || ASTERISK_MOVES.includes(i.name))
		&& madeAtOrBefore(i, LAST_OWNERSHIP_VERSION));
}

/**
 * Flag every Would-Be Hero who was The Hero by ownership (see above). Idempotent: a flagged hero is
 * passed over, so a second run writes nothing.
 *
 * @param {object} [options]
 * @param {Iterable} [options.actors]
 * @returns {Promise<number>} how many characters were written to
 */
export async function grandfatherWouldBeHeroes({ actors = globalThis.game?.actors ?? [] } = {}) {
	let written = 0;
	for (const actor of actors) {
		if (!heroByOwnership(actor)) continue;
		await actor.setFlag(STONETOP_SCOPE, WBH_HERO_FLAG, true);
		written += 1;
	}
	return written;
}
