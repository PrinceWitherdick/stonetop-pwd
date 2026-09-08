import { openApplications } from "../utils/open-windows.js";

/**
 * The scaffolding every "decorate the Actors sidebar rows" feature needs, in one place.
 *
 * Two features paint these rows — the portrait frame (ActorDirectoryPortraits.js) and the
 * playbook epithet (ActorDirectoryNames.js) — and both need the same three things: a way to
 * tell a world Actor directory from every other sidebar tab, a walk over its rows, and a way
 * to repaint ONE row when a flag core does not watch changes.
 *
 * Shared rather than copied because the duck-type is the fragile part. It is pinned to
 * ApplicationV2 internals (`collection.index` is what separates a CompendiumCollection from a
 * world one), and a copy that drifts does not fail loudly — the sidebar simply decorates for
 * one feature and not the other, on some renders and not others.
 *
 * The render hook binds to `renderDocumentDirectory` rather than `renderActorDirectory`
 * because ApplicationV2 fires a render hook per class in the inheritance chain and the
 * parent's name is the stable one. That is why the collection guard is load-bearing: every
 * other sidebar tab reaches the handler too.
 */

/** A document row in any sidebar directory, matching core's own directory partials
 *  (templates/sidebar/partials/). Exported because more than one feature marks up these rows
 *  and a copied selector that drifts does not fail loudly - it just stops matching. */
export const DIRECTORY_ROW_SELECTOR = "li.directory-item.document[data-entry-id]";

const ROW_SELECTOR = DIRECTORY_ROW_SELECTOR;

/**
 * Is this app a rendered WORLD directory for `documentName` (not a compendium's index view)?
 *
 * Shared rather than copied, because the duck-type is the fragile part: `index` is what tells a
 * CompendiumCollection from a world collection, and a second copy of that test would go quietly
 * wrong the day core changes it.
 */
export function isWorldDirectory(app, documentName) {
	const collection = app?.collection;
	return collection?.documentName === documentName
		&& typeof collection.get === "function"
		&& !collection.index;
}

/** Is this app a rendered WORLD Actor directory (not a compendium's index view)? */
export function isActorDirectory(app) {
	return isWorldDirectory(app, "Actor");
}

/**
 * Every rendered Actor directory: the sidebar tab, plus any popped-out copy of it. Collected by
 * duck-type rather than from `ui.actors` alone, so a popout — a second application over the same
 * collection — is not left showing stale decoration.
 *
 * `openApplications()` covers both registries (V1 `ui.windows` and V2
 * `foundry.applications.instances`), so this keeps working as tabs migrate.
 */
export function renderedActorDirectories() {
	const candidates = [globalThis.ui?.actors, ...openApplications()];
	return [...new Set(candidates)].filter(app => app && isActorDirectory(app) && app.element);
}

/** An app's root element, whether it hands back jQuery (V1) or a bare node (V2). */
function rootOf(app) {
	return app?.element?.jquery ? app.element[0] : app?.element;
}

/**
 * Walk a directory render once and hand every row to each decorator.
 *
 * ONE walk for all features: the row list and the `collection.get` per row are the cost here,
 * and doing them per feature repeats that work microseconds apart on the same event. Callers
 * pass their decorators together rather than registering a hook each.
 *
 * @param {Application}   app
 * @param {HTMLElement}   element
 * @param {Array<(li: HTMLElement, actor: Actor) => void>} decorators
 */
export function decorateActorDirectoryRows(app, element, decorators) {
	if (!isActorDirectory(app)) return;
	for (const li of element.querySelectorAll(ROW_SELECTOR)) {
		const actor = app.collection.get(li.dataset.entryId);
		if (!actor) continue;
		for (const decorate of decorators) decorate(li, actor);
	}
}

/**
 * Repaint one actor's row wherever it is on screen, without re-rendering the directory —
 * so nobody's scroll position or open folders move because a flag changed.
 *
 * @param {Actor} actor
 * @param {(li: HTMLElement, actor: Actor) => void} decorate
 */
export function repaintActorRow(actor, decorate) {
	if (!actor?.id) return;
	for (const app of renderedActorDirectories()) {
		const li = rootOf(app)?.querySelector?.(`li.directory-item.document[data-entry-id="${actor.id}"]`);
		if (li) decorate(li, actor);
	}
}
