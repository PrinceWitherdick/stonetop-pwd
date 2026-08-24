import { ITEM_FLAG_SCOPE } from "../actors/character/StonetopFlags.js";

const ARCANUM_SHEET_CLASS = "stonetop.StonetopArcanumSheet";

/**
 * Is this document (or creation payload) an arcanum card?
 *
 * `move` is the catch-all Item sub-type, so `system.moveType` is what actually decides -- the same
 * test the sheet makes to choose between the card and the plain readout.
 */
export function isArcanumData(item) {
	return item?.type === "move" && item?.system?.moveType === "arcanum";
}

/**
 * An opaque, permanent id for a new homebrew arcanum.
 *
 * The slug is the identity key for everything a character saves about a card — its marks,
 * its unlock counts, and the owned/identified/flipped lists — so it has to stay fixed for
 * the life of the card. That rules out deriving it from the name: renaming a card would
 * orphan every mark on every sheet holding it. Random rather than name-derived also means
 * it can never collide with a shipped pack slug (which would shadow this card, since the
 * repository resolves the pack first) or with another homebrew one — so there is nothing
 * for the author to get wrong, which is why the editor doesn't show the slug at all.
 *
 * The `arc-` prefix is purely so a slug read off a flag in the console is recognisable.
 */
export function newArcanumSlug() {
	return `arc-${foundry.utils.randomID(16)}`;
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

	const slug = newArcanumSlug();
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
