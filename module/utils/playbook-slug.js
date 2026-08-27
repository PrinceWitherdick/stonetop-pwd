// Which playbook a character has, as the one thing about it that never changes.
//
// Its own leaf module for a dependency reason rather than a size one. `playbook-actors.js` is
// where every "player character" helper lives and where this belongs by subject, but that file
// reaches into WouldBeHeroAsterisk.js for the crossed-off-"Would-be" epithet — so the moment the
// Would-Be Hero's own rules guards want to ask this question, the two files import each other.
// A pure four-line answer that depends on nothing is the right thing to lift out of the cycle,
// and `playbook-actors.js` re-exports it so no caller has to know it moved.
//
// SLUG, not name. Both are stored (`system.playbook` carries `{ name, slug }`), and the name is a
// label: a player may edit it, and this system deliberately shows a Would-Be Hero who has crossed
// off "Would-be" as "The Hero" wherever they are named. A rules guard written against the name
// therefore turns itself off for anyone who retitles their sheet, silently and for good, while the
// slug is the pack's own id for the playbook and moves only when the pack does.

/**
 * A character's playbook slug, from either the embedded `system.playbook` data or a contained
 * playbook item. Returns "" when there's no playbook yet — which also makes it the truthiness
 * test for "is this actor a player character".
 *
 * Pure: no Foundry global is touched, so every caller stays testable with a plain object.
 */
export function playbookSlug(actor) {
	return actor?.system?.playbook?.slug
		?? actor?.items?.find?.(i => i.type === "playbook")?.system?.slug
		?? "";
}
