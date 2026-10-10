// ── Trade & Barter's special item, handed over from the roll card ───────────────
// "On a 10+, you can get it or sell it for a fair price; on a 7-9 ..." and "On a 6- either way ...
// you'll need to travel to ___ or wait until next season" (Book I p.540). So the item a Trade &
// Barter is about changes hands from its card's 10+ and 7-9, never before the dice: the move's window
// only carries which item it is (StonetopSteadingSheet `specialItem`).
//
// Two buttons, because whether the PC was buying or selling is said at the table, and they settle
// together: one card is one trade. Bought adds the item to a character's inventory; sold takes it off.
// Pressed by the user who rolled or a GM (the card is stamped, which only they may write), for a
// character they own.

import { SYSTEM_ID } from "../../system-id.js";
import { SPECIAL_ITEM_CATALOG } from "../../data/special-items.js";
import { CharacterInventory } from "../character/CharacterInventory.js";
import { StonetopFlags } from "../character/StonetopFlags.js";
import { pickPersonOnMap } from "../../dialogs/RelationshipLinkDialog.js";
import { canUserWriteCard } from "../../utils/chat.js";
import { withCardLatch } from "../../utils/card-latch.js";
import { wireChooseThenWrite } from "./steading-card-actions.js";
import { escHtml } from "../../utils/strings.js";

/** The message flag that latches a card's trade: `{ mode, actorId, name }`. */
export const TRADE_ITEM_FLAG = "tradeItemSettled";

/** A special item off the handout list, by slug, or null. */
export function specialItemBySlug(slug) {
	return SPECIAL_ITEM_CATALOG.flatMap(group => group.items ?? []).find(item => item.slug === slug) ?? null;
}

/** The card's two hand-over buttons for `slug`, or "" for an item the handout does not list. */
export function tradeItemActions(slug) {
	const item = specialItemBySlug(slug);
	if (!item) return "";
	const name = escHtml(item.name);
	return `<div class="stonetop-trade-item-row" data-item-slug="${escHtml(slug)}">`
		+ `<button type="button" class="stonetop-trade-item" data-trade="buy"><i class="fas fa-gem"></i> Bought: add ${name} to a character</button>`
		+ `<button type="button" class="stonetop-trade-item" data-trade="sell"><i class="fas fa-coins"></i> Sold: take ${name} off a character</button>`
		+ `</div>`;
}

/** The inventory wrapper a trade writes through. */
function inventoryOf(actor) {
	return new CharacterInventory(new StonetopFlags(actor, "inventory"));
}

/**
 * Who a trade can land on: characters `user` owns; for a sale, only those holding the item.
 * @param {"buy"|"sell"} mode
 */
export function tradeCandidates(mode, slug, actors = globalThis.game?.actors?.contents ?? []) {
	const owned = [...actors].filter(actor => actor?.type === "character" && actor.isOwner);
	return mode === "sell" ? owned.filter(actor => inventoryOf(actor).addedSpecial.includes(slug)) : owned;
}

/** Add (bought) or remove (sold) the item on `actor`'s inventory. */
export async function settleTradeItem(actor, slug, mode) {
	const inventory = inventoryOf(actor);
	if (mode === "sell") await inventory.removeSpecial(slug);
	else await inventory.addSpecial(slug);
}

/** What a settled card's row says. */
function settledLine({ mode, name, item }) {
	return mode === "sell" ? `${item} sold by ${name}.` : `${item} added to ${name}.`;
}

/**
 * Wire a Trade & Barter card's hand-over row (stonetop.js renderChatMessageHTML). Safe on every render.
 *
 * Who it lands on is asked first, through the people chooser (RelationshipLinkDialog.js#pickPersonOnMap),
 * since the card's latch records them. Then the card is latched (card-latch.js#withCardLatch) before the
 * item moves, and given back if it cannot.
 */
export function wireTradeItemCard(message, html, { pick = pickPersonOnMap } = {}) {
	const root = html?.[0] ?? html;
	const row = root?.querySelector?.(".stonetop-trade-item-row");
	if (!row) return;
	const slug = row.dataset.itemSlug ?? "";
	const item = specialItemBySlug(slug)?.name ?? slug;
	const settled = message?.getFlag?.(SYSTEM_ID, TRADE_ITEM_FLAG);
	if (settled) {
		row.innerHTML = `<p class="stonetop-trade-item-done">${escHtml(settledLine({ ...settled, item }))}</p>`;
		return;
	}
	const user = globalThis.game?.user;
	if (!canUserWriteCard(message, user, { whenUnknown: !!user?.isGM })) { row.remove(); return; }
	const buttons = [...row.querySelectorAll(".stonetop-trade-item")];
	wireChooseThenWrite(buttons, {
		what: "Could not settle a Trade & Barter item",
		choose: async btn => {
			const mode = btn.dataset.trade === "sell" ? "sell" : "buy";
			const people = tradeCandidates(mode, slug);
			if (!people.length) {
				globalThis.ui?.notifications?.warn?.(mode === "sell"
					? `None of your characters has ${item} to sell.`
					: "No character of yours to add the item to.");
				return null;
			}
			const id = people.length === 1 ? people[0].id : await pick({
				options: people.map(actor => ({ id: actor.id, name: actor.name, actor })),
				title:   mode === "sell" ? "Who sold it?" : "Who bought it?",
				hint:    mode === "sell" ? `Whose ${item} changes hands?` : `Who gets the ${item}?`,
				icon:    mode === "sell" ? "fa-coins" : "fa-gem",
			});
			const actor = id ? people.find(a => a.id === id) : null;
			return actor ? { mode, actor } : null;
		},
		write: ({ mode, actor }) => withCardLatch(message, TRADE_ITEM_FLAG, { mode, actorId: actor.id, name: actor.name }, buttons, async () => {
			await settleTradeItem(actor, slug, mode);
			globalThis.ui?.notifications?.info?.(settledLine({ mode, name: actor.name, item }));
			return true;
		}),
	});
}
