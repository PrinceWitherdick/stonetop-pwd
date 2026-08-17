import { stonetopThumbnail } from "../utils/item-icon.js";
import { ensurePackIndex } from "../utils/pack-index.js";

/**
 * Give art-less compendium rows the same fallback markers the world Items sidebar gets.
 *
 * The sidebar is handled by `StonetopItem#thumbnail`, but a compendium window never builds
 * Item documents — `templates/sidebar/apps/compendium/index-partial.hbs` renders straight off
 * the pack INDEX, so the getter is never consulted. This patches those rows after render.
 *
 * Bound to `renderDocumentDirectory` rather than `renderCompendium`: ApplicationV2 fires a
 * render hook for every class in the inheritance chain, and the parent's name is the stable
 * one. That also means the world Items sidebar reaches this handler, so the CompendiumCollection
 * check below is load-bearing, not defensive tidiness.
 *
 * @param {Application} app
 * @param {HTMLElement} element
 */
export async function onRenderCompendiumItemIcons(app, element) {
	const pack = app?.collection;
	// Duck-typed rather than instanceof, so this survives the collection class moving namespace.
	if (pack?.documentName !== "Item" || !pack.index || typeof pack.getIndex !== "function") return;

	// Core indexes _id/name/img/type/sort/folder. `moveType` — which decides gear vs arcanum vs
	// move — is ours, added to CONFIG.Item.compendiumIndexFields at init, and nothing in the
	// render path fetches it, so ask for it here. Cached on the pack after the first call.
	// Asked for by name through ensurePackIndex rather than a bare `pack.getIndex()`: the bare
	// call would re-track this pack on the CORE fields only, costing every other reader its
	// system.* index fields. ensurePackIndex always re-requests the union, and no-ops when the
	// union is already covered — so the `pack.indexed` guard is no longer needed either.
	await ensurePackIndex(pack.collection, ["system.moveType"]);

	for (const li of element.querySelectorAll("li.directory-item.document[data-entry-id]")) {
		const entry = pack.index.get(li.dataset.entryId);
		if (!entry) continue;

		const src = stonetopThumbnail(entry);
		if (src === entry.img) continue;        // real art, already on screen

		let img = li.querySelector("img.thumbnail");
		if (!img) {
			// No `img` at all on the entry, so the partial drew the pack's generic <i> glyph.
			img = document.createElement("img");
			img.className = "thumbnail";
			img.alt = entry.name ?? "";
			li.querySelector(":scope > i")?.remove();
			li.prepend(img);
		}
		if (img.getAttribute("src") !== src) img.setAttribute("src", src);
	}
}
