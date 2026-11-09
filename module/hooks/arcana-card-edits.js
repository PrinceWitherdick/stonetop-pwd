import { ITEM_FLAG_SCOPE, StonetopFlags } from "../actors/character/StonetopFlags.js";
import { isWorldArcanum } from "../item/createArcanum.js";
import { arcanumHolders, actorHoldsArcanum } from "../item/arcanum-access.js";
import { shiftedBoxes } from "../actors/character/CharacterArcana.js";
import { confirmOutcome } from "../utils/ask-with-buttons.js";
import { format, localize } from "../utils/i18n.js";
import { escHtml, joinNames } from "../utils/strings.js";

// What happens to the characters holding a WORLD arcanum when the card itself changes: it is
// deleted (HB-6), or edited (HB-15). A character only stores the card's slug, so neither reached
// them before: a deleted card left a stub named by its random `arc-...` slug, and an edit showed
// on an open sheet only once something else re-rendered it.

/** The option a confirmed delete is re-issued with, so the guard lets it through. */
export const HELD_DELETE_CONFIRMED = "stonetopHeldArcanumConfirmed";

/** The name a character's stub should carry once the card is gone. */
function _cardTitle(item) {
	return String(item.flags?.[ITEM_FLAG_SCOPE]?.front?.title ?? "").trim() || String(item.name ?? "").trim();
}

/**
 * Store the card's title on every holder this client may write (`arcana.titles.<slug>`), so the
 * stub CharacterArcana builds for a held slug no card answers to, and the ledger reading it, name
 * the card rather than its slug. A holder this client can't write keeps the slug as its name.
 */
export async function stampHolderTitles(item, holders) {
	const slug  = item.flags?.[ITEM_FLAG_SCOPE]?.slug;
	const title = _cardTitle(item);
	if (!slug || !title) return;
	const writable = holders.filter(actor => actor?.isOwner && typeof actor.update === "function");
	await Promise.all(writable.map(async actor => {
		try {
			await actor.update(new StonetopFlags(actor, "arcana").subKeyData("titles", slug, title), { render: false });
		} catch (err) {
			console.warn(`Stonetop | Couldn't store the arcanum's title on ${actor.name}`, err);
		}
	}));
}

/**
 * The editor set `by` new □ into the card's back at box index `from` ("Add mystery", "Add
 * consequence"). Marks are stored by index, so every holder's back mark at `from` or later moves
 * along with its box (shiftedBoxes), quietly in the ledger: the marks mean what they meant. Only
 * the holders this client may write follow; a GM editing reaches them all. Whether any moved.
 */
export async function shiftHolderBackMarks(item, from, by = 1, holders = null) {
	const slug = item?.flags?.[ITEM_FLAG_SCOPE]?.slug;
	if (!slug || !(from >= 0) || !(by > 0)) return false;
	const writable = (holders ?? arcanumHolders(slug)).filter(actor => actor?.isOwner && typeof actor.update === "function");
	const moved = await Promise.all(writable.map(async actor => {
		const flags = new StonetopFlags(actor, "arcana");
		const next = shiftedBoxes(flags.getFlag("boxes") ?? {}, { slug, context: "back", from, by });
		if (!next) return false;
		try {
			await flags.batch({ sets: { boxes: next } }, { stonetopLedger: true });
			return true;
		} catch (err) {
			console.warn(`Stonetop | Couldn't move ${actor.name}'s marks on the edited arcanum`, err);
			return false;
		}
	}));
	return moved.some(Boolean);
}

async function _confirmHeldDelete(item, holders) {
	const names = escHtml(joinNames(holders.map(actor => actor.name)));
	const ok = await confirmOutcome({
		title:   localize("stonetop.arcana.homebrew.deleteTitle"),
		content: format("stonetop.arcana.homebrew.deleteBody", { name: escHtml(_cardTitle(item)), names }),
		yes:     { label: localize("stonetop.arcana.homebrew.deleteYes"), icon: "fa-trash" },
		no:      { label: localize("stonetop.arcana.homebrew.deleteNo") },
	});
	if (!ok || !globalThis.game?.items?.get?.(item.id)) return false;
	await stampHolderTitles(item, holders);
	await item.delete({ [HELD_DELETE_CONFIRMED]: true });
	return true;
}

/**
 * `preDeleteItem`: a world arcanum some character holds is not deleted on the first ask. The
 * delete is refused, the deleter is asked with the holders named, and on yes the titles are
 * stored and the delete re-issued with HELD_DELETE_CONFIRMED. Runs on the deleting client only
 * (core calls pre-hooks there). A card nobody holds goes straight through.
 */
export function onPreDeleteItem(item, options, userId) {
	if (!isWorldArcanum(item) || options?.[HELD_DELETE_CONFIRMED]) return true;
	if (userId && globalThis.game?.user?.id && userId !== globalThis.game.user.id) return true;
	const holders = arcanumHolders(item.flags?.[ITEM_FLAG_SCOPE]?.slug);
	if (!holders.length) return true;
	_confirmHeldDelete(item, holders).catch(err => console.error("Stonetop | Held arcanum delete failed", err));
	return false;
}

// ── Open sheets follow an edited card (HB-15) ──────────────────────────────────────────────────

const _pendingSlugs = new Set();
let _repaintTimer = null;
export const CARD_EDIT_REPAINT_MS = 250;

/** Every rendered sheet of a character holding one of these slugs (V1 apps registered on the actor). */
function _sheetsHolding(slugs) {
	const out = new Set();
	for (const actor of globalThis.game?.actors ?? []) {
		if (actor?.type !== "character") continue;
		if (![...slugs].some(slug => actorHoldsArcanum(actor, slug))) continue;
		for (const app of Object.values(actor.apps ?? {})) if (app?.rendered) out.add(app);
	}
	return [...out];
}

/** Re-render the open sheets holding the cards edited since the last repaint. */
export function flushCardEditRepaints() {
	_repaintTimer = null;
	const slugs = new Set(_pendingSlugs);
	_pendingSlugs.clear();
	if (!slugs.size) return;
	for (const app of _sheetsHolding(slugs)) app.render(false);
}

/**
 * `updateItem`: a world arcanum was edited. Its holders' open sheets repaint, once per burst of
 * edits (the editor saves per field, so typing through a card is many updates in a row).
 */
export function onUpdateItem(item) {
	if (!isWorldArcanum(item)) return;
	const slug = item.flags?.[ITEM_FLAG_SCOPE]?.slug;
	if (!slug) return;
	_pendingSlugs.add(slug);
	if (_repaintTimer) clearTimeout(_repaintTimer);
	_repaintTimer = setTimeout(flushCardEditRepaints, CARD_EDIT_REPAINT_MS);
}

/** Registered once, at module scope in stonetop.js. */
export function registerArcanaCardEditHooks() {
	Hooks.on("preDeleteItem", onPreDeleteItem);
	Hooks.on("updateItem", onUpdateItem);
	// A deleted card repaints its holders too, so their sheets show the stub straight away.
	Hooks.on("deleteItem", onUpdateItem);
}
