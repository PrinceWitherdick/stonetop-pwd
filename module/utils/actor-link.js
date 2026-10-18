/**
 * Resolving the actor behind a row that names a person.
 *
 * Several tables list people who are backed by an Actor — the steading's Player Characters,
 * Residents and Neighbors, and the shared relationships component on all three sheets. Each
 * row carries the same pair of `data-` attributes, and every consumer resolved them the same
 * way: prefer the uuid (which survives a move into a compendium or a folder), fall back to
 * the world id (which is what older rows stored), and warn when neither finds anybody.
 *
 * Rows are written by templates, so the actor they point at can be gone by the time it is
 * clicked — deleted between renders, or a world imported without it. Every path therefore
 * has to handle "no longer there", which is why the notification lives in here rather than
 * being remembered separately at each call site.
 */

import { escHtml } from "./strings.js";

/** i18n keys for the "that person is gone" warning, by what the row lists. */
export const ACTOR_LINK_MISSING = {
	character: "stonetop.actorLink.gone",
	npc:       "stonetop.actorLink.goneNpc",
};

/**
 * The Actor a link element points at, or null.
 *
 * @param {HTMLElement|DOMStringMap} link  the clicked element, or its dataset
 * @returns {Promise<Actor|null>}
 */
export async function resolveLinkedActor(link) {
	const { actorUuid, actorId } = link?.dataset ?? link ?? {};
	return (actorUuid ? await fromUuid(actorUuid) : null)
		|| (actorId ? game.actors?.get(actorId) : null)
		|| null;
}

/**
 * Resolve a link and hand the actor to `use`, warning instead when it cannot be found.
 *
 * @param {HTMLElement} link      the clicked element
 * @param {Function}    use       called with the resolved actor
 * @param {string}     [missing]  i18n key for the warning; see {@link ACTOR_LINK_MISSING}
 */
export async function withLinkedActor(link, use, missing = ACTOR_LINK_MISSING.character) {
	const actor = await resolveLinkedActor(link);
	if (actor) return use(actor);
	ui.notifications?.warn?.(game.i18n.localize(missing));
	return undefined;
}

/** The common case: open the linked actor's sheet. */
export function openLinkedActorSheet(link, missing = ACTOR_LINK_MISSING.character) {
	return withLinkedActor(link, actor => actor.sheet?.render(true), missing);
}

/**
 * An actor as journal text: a content link to it by uuid (`@UUID[...]{name}`, enriched where it is shown), or its
 * name, escaped, when it has no uuid. For the notes and pages that say who someone once was (a retired PC's NPC,
 * the threat a PC or follower became). PURE.
 *
 * The label is escaped too: the enricher reads it from the page's text, so a name with `<` in it would otherwise be
 * markup. A name with a `}` in it can't be a label at all (the label ends at the first one), so that link goes
 * without one and the enricher shows the actor's own name.
 */
export function actorLinkHtml(actor) {
	const name = actor?.name ?? "";
	if (!actor?.uuid) return escHtml(name);
	return name && !name.includes("}") ? `@UUID[${actor.uuid}]{${escHtml(name)}}` : `@UUID[${actor.uuid}]`;
}
