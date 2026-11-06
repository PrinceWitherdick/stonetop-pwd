import { ITEM_FLAG_SCOPE, ARCANA_PACK } from "../actors/character/StonetopFlags.js";
import { ensurePackIndex } from "../utils/pack-index.js";
import { MAJOR_ARCANA_ICONS } from "../arcana-icons.js";

const ARCANUM_SHEET_CLASS = "stonetop.StonetopArcanumSheet";

// The shipped slugs, once the arcana pack has answered (or, for a player, once it was tried).
// Remembered for the session: the pack is rebuilt from source, never edited in play.
let _shippedSlugs = null;

/**
 * Every slug a shipped arcanum answers to: the arcana pack's index, plus the registered majors
 * (so the answer is never empty on a client that cannot read the GM-only pack). A world card on
 * one of these slugs is shadowed by the pack card (FoundryArcanaRepository resolves the pack
 * first), so its edits would never reach a sheet. Never throws; a pack that cannot be read
 * leaves the majors.
 */
export async function shippedArcanumSlugs() {
	if (_shippedSlugs) return _shippedSlugs;
	const slugs = new Set(Object.keys(MAJOR_ARCANA_ICONS));
	let readPack = false;
	try {
		const pack = await ensurePackIndex(ARCANA_PACK, [`flags.${ITEM_FLAG_SCOPE}.slug`]);
		for (const entry of pack?.index ?? []) {
			const slug = entry?.flags?.[ITEM_FLAG_SCOPE]?.slug;
			if (slug) slugs.add(slug);
		}
		readPack = !!pack;
	} catch (err) {
		console.warn("Stonetop | Couldn't read the arcana pack's slugs", err);
	}
	// A player usually can't read the GM-only pack, so the majors are their whole answer: kept
	// too, rather than asking the pack again on every create. A GM retries a pack that failed.
	if (readPack || !globalThis.game?.user?.isGM) _shippedSlugs = slugs;
	return slugs;
}

/** Forget the remembered shipped slugs. Tests only. */
export function resetShippedArcanumSlugs() {
	_shippedSlugs = null;
}

/**
 * Is this document (or creation payload) an arcanum card?
 *
 * `move` is the catch-all Item sub-type, so `system.moveType` is what actually decides -- the same
 * test the sheet makes to choose between the card and the plain readout.
 */
export function isArcanumData(item) {
	return item?.type === "move" && item?.system?.moveType === "arcanum";
}

/** A world arcanum: the record the arcana repository reads (FoundryArcanaRepository#_worldArcanumItem). */
export function isWorldArcanum(item) {
	return !!item && !item.parent && !item.pack && isArcanumData(item);
}

/**
 * A world arcanum its author has finished: not a draft (`flags.stonetop.draft`, set by
 * createArcanumItem and cleared on Save). What the browser lists and the Seeker may draw.
 */
export function isFinishedWorldArcanum(item) {
	return isWorldArcanum(item) && !item.flags?.[ITEM_FLAG_SCOPE]?.draft;
}

/**
 * An opaque, permanent id for a new homebrew arcanum.
 *
 * The slug is the identity key for everything a character saves about a card — its marks,
 * its unlock counts, and the owned/identified/flipped lists — so it has to stay fixed for
 * the life of the card. That rules out deriving it from the name: renaming a card would
 * orphan every mark on every sheet holding it. Random rather than name-derived also means
 * a MINTED slug can never collide with a shipped pack slug (which would shadow this card, since
 * the repository resolves the pack first) or with another homebrew one, so there is nothing
 * for the author to get wrong, which is why the editor doesn't show the slug at all. A card
 * that ARRIVES with a slug (a copy, an import, a shipped card dragged out of the pack) is
 * checked at creation instead: StonetopItem#_preCreate re-mints a slug another world card or
 * a shipped card already answers to.
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
export function buildArcanumItemData({ slug, name = "New Arcanum", major = false, img, front, back, ownerId = null, draft = false, gmNotes = "" } = {}) {
	const data = {
		name,
		type: "move",
		system: { moveType: "arcanum" },
		flags: {
			[ITEM_FLAG_SCOPE]: {
				slug,
				major,
				// An unfinished card: the browser and the Seeker's draw skip it, and reopening it
				// offers Finish / Discard. Cleared when the author saves (StonetopArcanumSheet).
				...(draft ? { draft: true } : {}),
				// The GM's own notes (the Inspire wizard's rolled Drawback, Spirit, Origin...; Book II
				// p.507 "that's all for you"). Shown in the editor and to a GM viewing the card only.
				...(gmNotes ? { gmNotes } : {}),
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
 * `front`/`back` optionally pre-fill the card (the inspiration wizard's rolled artifact notes
 * go to `gmNotes`, never the front). Returns the created Item, or null if creation was blocked
 * (no permission) or failed.
 *
 * `onSave` (optional) makes the opened editor a *pending draft*: the card is NOT attached to
 * anything on creation — `onSave(item)` runs only when the author clicks Save & Done (or the
 * header Done). Closing the editor first offers to discard the draft. Callers that want the
 * old "exists as a loose world item immediately" behavior (console/macro) just omit it.
 *
 * Either way the card is stored with `flags.stonetop.draft` until the author saves it, so a
 * reload mid-edit leaves a draft (skipped by the browser, Finish / Discard on reopening) rather
 * than a finished-looking loose card. `gmNotes` seeds the GM-only notes field.
 */
export async function createArcanumItem({ name = "New Arcanum", major = false, front, back, gmNotes = "", onSave = null } = {}) {
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
		item = await ItemCls.create(buildArcanumItemData({ slug, name, major, front, back, ownerId, draft: true, gmNotes }));
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
