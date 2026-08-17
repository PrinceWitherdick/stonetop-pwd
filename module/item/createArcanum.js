import { ITEM_FLAG_SCOPE, ARCANA_PACK } from "../actors/character/StonetopFlags.js";
import { slugify } from "../utils/strings.js";
import { ensurePackIndex } from "../utils/pack-index.js";

// Re-exported for the arcana creator's callers (kept here for back-compat); the
// implementation is the shared one in utils/strings.js.
export { slugify };

const ARCANUM_SHEET_CLASS = "stonetop.StonetopArcanumSheet";

/**
 * A slug derived from `name` that doesn't collide with any in `takenSlugs` (Set or array).
 * Appends -2, -3, … until free; empty names fall back to "arcanum". Pure + testable.
 */
export function uniqueArcanumSlug(name, takenSlugs = []) {
	const taken = takenSlugs instanceof Set ? takenSlugs : new Set(takenSlugs);
	const base  = slugify(name) || "arcanum";
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/**
 * Item-creation payload for a blank homebrew arcanum. Pure — no Foundry calls — so it's
 * unit-testable and reusable by any creator UI. The card data lives under `flags.stonetop`
 * (matching shipped arcana); `system.moveType` + the sheetClass flag make it open as an
 * arcanum card; `major` declares the tier so it's first-class without an icon-registry edit.
 * Write via Item.create()/update(), NOT setFlag — that scope ("stonetop") rejects setFlag.
 */
export function buildArcanumItemData({ slug, name = "New Arcanum", major = false, img, front, back, ownerId = null } = {}) {
	const data = {
		name,
		type: "move",
		system: { moveType: "arcanum" },
		flags: {
			[ITEM_FLAG_SCOPE]: {
				slug,
				major,
				front: {
					title:       name,
					item:        null,
					description: "",
					unlock:      { description: "", requirements: [] },
					...(front ?? {}),
				},
				back: {
					title:       "",
					item:        null,
					description: "",
					resource:    null,
					move:        null,
					options:     [],
					...(back ?? {}),
				},
			},
			core: { sheetClass: ARCANUM_SHEET_CLASS },
		},
		// Everyone can read a homebrew card (matching shipped pack arcana). Without this, a
		// world item authored by a non-GM defaults to no ownership for other users, so the
		// arcanum vanishes from every OTHER player's view of the owning character's sheet.
		// 2 === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER (literal keeps this module Foundry-free).
		// A non-GM author also needs explicit OWNER (3) on their own card, or the editor opens
		// read-only — don't rely on Foundry's create-time owner grant surviving an explicit
		// ownership block.
		ownership: ownerId ? { default: 2, [ownerId]: 3 } : { default: 2 },
	};
	if (img) data.img = img;
	return data;
}

/**
 * Every arcanum slug already in use across the shipped pack + the world, so a new homebrew
 * slug can be made unique against both. Pack precedence means a homebrew never shadows a
 * shipped card (the repository resolves the pack first), but we still avoid the collision.
 * Pass `excludeId` to skip a world item (the card currently being edited), so checking its
 * own slug for collisions doesn't flag itself.
 */
export async function collectTakenArcanumSlugs({ excludeId = null } = {}) {
	const taken = new Set();
	const pack  = await ensurePackIndex(ARCANA_PACK, [`flags.${ITEM_FLAG_SCOPE}.slug`]);
	if (pack) {
		for (const e of pack.index) {
			const slug = e.flags?.[ITEM_FLAG_SCOPE]?.slug;
			if (slug) taken.add(slug);
		}
	}
	for (const i of globalThis.game?.items ?? []) {
		if (excludeId && i.id === excludeId) continue;
		const slug = i.flags?.[ITEM_FLAG_SCOPE]?.slug;
		if (slug) taken.add(slug);
	}
	return taken;
}

/**
 * Create a homebrew arcanum world Item with a unique slug and open its sheet ready to edit.
 * `front`/`back` optionally pre-fill the card (the inspiration wizard seeds front.description
 * with the rolled artifact notes). Returns the created Item, or null if creation was blocked
 * (no permission) or failed.
 *
 * `onSave` (optional) makes the opened editor a *pending draft*: the card is NOT attached to
 * anything on creation — `onSave(item)` runs only when the author clicks Save & Done (or the
 * header Done). Closing the editor first offers to discard the draft. Callers that want the
 * old "exists as a loose world item immediately" behavior (console/macro) just omit it.
 */
export async function createArcanumItem({ name = "New Arcanum", major = false, front, back, onSave = null } = {}) {
	// Arcana are WORLD items, so a non-GM needs the world "Create New Items" permission to
	// author one (unlike embedded custom moves, which any actor owner can create). Fail loudly
	// here instead of the silent no-op a downstream `if (!slug) return` would produce.
	const user    = globalThis.game?.user;
	const ItemCls = globalThis.Item;
	if (user && !user.isGM && ItemCls?.canUserCreate && !ItemCls.canUserCreate(user)) {
		globalThis.ui?.notifications?.error(
			'You can\'t create arcana: a GM must grant your role the "Create New Items" permission.',
		);
		return null;
	}

	const taken = await collectTakenArcanumSlugs();
	const slug  = uniqueArcanumSlug(name, taken);
	let item = null;
	try {
		// Grant a non-GM author OWNER on their own card so its editor opens editable. A GM
		// already owns everything, so only pass an ownerId for non-GM creators.
		const ownerId = user && !user.isGM ? user.id : null;
		item = await ItemCls.create(buildArcanumItemData({ slug, name, major, front, back, ownerId }));
	} catch (err) {
		console.error("Stonetop | Failed to create arcanum item", err);
	}
	if (!item) {
		globalThis.ui?.notifications?.error("Couldn't create the arcanum item.");
		return null;
	}

	// Open the new (blank) card ready to edit rather than read-only. Capture ONE sheet
	// reference — the v14 `.sheet` getter can mint a fresh instance per access — so the
	// edit-mode flag and the render act on the same instance.
	const sheet = item.sheet;
	if (sheet) {
		sheet._editMode = true;
		// A draft opened from a character's Create button holds its "attach to that
		// character" callback and won't be committed until Save & Done. Without onSave the
		// card is just a standalone world item (the macro/console path), so leave it non-draft.
		if (onSave) {
			sheet._arcanumDraft  = true;
			sheet._arcanumOnSave = onSave;
		}
		sheet.render(true);
	}
	return item;
}
