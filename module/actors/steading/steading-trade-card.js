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
import { escHtml, stripHtmlToText } from "../../utils/strings.js";
import { count } from "../../camp/camp-rules.js";
import { isSteadingActor } from "../../utils/world.js";
import { withLateStampLatch } from "../../utils/card-latch.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { inTurn } from "../../utils/turn-queue.js";
import { readInventoryItemData, splitInventoryNote } from "../../utils/inventory-item-data.js";
import { artifactVisibility } from "../character/artifact-identify.js";
import { ContentPickerDialog, pickContentOption } from "../../dialogs/content-picker.js";
import { STEADING_DEFAULTS, StonetopSteading } from "./StonetopSteading.js";

/** The message flag that latches a card's trade: `{ mode, actorId, name }`. */
export const TRADE_ITEM_FLAG = "tradeItemSettled";

/** The message flag that latches a card's payment in Surplus or coin: the payment itself. */
export const TRADE_PAY_FLAG = "tradePaymentSettled";

/** The message flag that latches a card's artifact changing hands: `{ actorId, name, item }`. */
export const TRADE_ARTIFACT_FLAG = "tradeArtifactSettled";

/** The move every write from a Trade & Barter card is filed under in the steading's ledger. */
const TRADE_MOVE = "Trade & Barter";

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
		// Settled while the chooser was open (the card's other writer): said, and the buttons stay down.
		write: ({ mode, actor }) => withCardLatch(message, TRADE_ITEM_FLAG, { mode, actorId: actor.id, name: actor.name }, buttons, async () => {
			await settleTradeItem(actor, slug, mode);
			globalThis.ui?.notifications?.info?.(settledLine({ mode, name: actor.name, item }));
			return true;
		}, { onTaken: () => saySettledMeanwhile() }),
	});
}

/**
 * The words for a card the latch refused because it was settled while this user's window was open (the GM
 * and whoever rolled can both write a Trade & Barter card). Answers true: the buttons stay down.
 */
function saySettledMeanwhile(notify = globalThis.ui?.notifications) {
	notify?.info?.("Someone else settled this on the card while your window was open, so nothing more changes hands.");
	return true;
}

// ── Paying for it: Surplus, coin, or an artifact (Book I pp.540-542) ─────────────
// "On a 10+, you can get it or sell it for a fair price", and "A fair price means trading things with the
// same Value" (p.542). What changes hands on the steading's side is its Surplus ("A Surplus" is one of
// p.542's Value 2 things) and the silver and gold in its coin boxes; on a character's side, an artifact
// they carry. So a 10+ or 7-9 card offers both: settle the payment, and take an artifact off a character
// (offered in trade, or sold though the handout does not list it).
//
// The window SAYS the Values (p.542) beside what is being handed over and the item's own Value, and
// decides nothing: whether the trade is fair, or "costs more than usual" on a 7-9, is the GM's to judge.
//
// "For unique or truly exceptional items, don't Trade & Barter" (p.540): an artifact with no Value at all
// is not offered here, and the table is pointed at Make a Plan instead.

/**
 * What each thing is worth in Value (Book I p.542): "A single silver coin" 0, "A handful of silver coins"
 * 1, "A purse of silver coins" 2, "A single gold coin" 2, "A handful of gold coins" 3, "A purse of gold
 * coins" 4, and "A Surplus" 2.
 */
export const TRADE_VALUES = Object.freeze({
	surplus: 2,
	silver: Object.freeze({ coins: 0, handfuls: 1, purses: 2 }),
	gold:   Object.freeze({ coins: 2, handfuls: 3, purses: 4 }),
});

/** The coin boxes' three sizes, smallest first, as the steading stores them. */
export const COIN_SIZES = Object.freeze(["coins", "handfuls", "purses"]);

const COIN_WORDS = {
	coins:    { one: "single {metal} coin", many: "single {metal} coins" },
	handfuls: { one: "handful of {metal}", many: "handfuls of {metal}" },
	purses:   { one: "purse of {metal}", many: "purses of {metal}" },
};

const METALS = ["silver", "gold"];

/** A payment as the window answered it, tidied: whole, non-negative counts. PURE. */
export function normalizePayment(raw = {}) {
	const coins = metal => Object.fromEntries(COIN_SIZES.map(size => [size, count(raw?.[metal]?.[size])]));
	return {
		direction: raw?.direction === "receive" ? "receive" : "pay",
		surplus: count(raw?.surplus),
		silver: coins("silver"),
		gold: coins("gold"),
	};
}

/** Whether a payment hands over nothing at all. PURE. */
export function paymentIsEmpty(payment) {
	const p = normalizePayment(payment);
	return !p.surplus && METALS.every(metal => COIN_SIZES.every(size => !p[metal][size]));
}

/** One phrase per thing a payment hands over, with its Value: "2 handfuls of silver (Value 1 each)". PURE. */
export function paymentParts(payment) {
	const p = normalizePayment(payment);
	const parts = [];
	if (p.surplus) parts.push(`${p.surplus} Surplus (Value ${TRADE_VALUES.surplus}${p.surplus > 1 ? " each" : ""})`);
	for (const metal of METALS) {
		for (const size of [...COIN_SIZES].reverse()) {
			const n = p[metal][size];
			if (!n) continue;
			const words = COIN_WORDS[size][n > 1 ? "many" : "one"].replace("{metal}", metal);
			parts.push(`${n === 1 ? "a" : n} ${words} (Value ${TRADE_VALUES[metal][size]}${n > 1 ? " each" : ""})`);
		}
	}
	return parts;
}

/** What a settled payment says, on the card and in the notification. PURE. */
export function paymentLine(payment, steadingName = "The steading") {
	const p = normalizePayment(payment);
	const parts = paymentParts(p);
	const what = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "nothing");
	return `${steadingName} ${p.direction === "receive" ? "received" : "paid"} ${what}.`;
}

/**
 * The steading write a payment makes, off what it holds now: Surplus and the coin boxes, down for a payment
 * and up for a receipt. `short` lists what the steading does not hold enough of (the caller writes nothing
 * then): coins are counted, never changed into one another. PURE.
 *
 * @param {{surplus: number, silver: object, gold: object}} held
 * @returns {{system: object, flags: object, short: string[]}}
 */
export function tradePaymentChanges(held, payment) {
	const p = normalizePayment(payment);
	const sign = p.direction === "receive" ? 1 : -1;
	const short = [];
	const system = {};
	const flags = {};
	if (p.surplus) {
		const next = count(held?.surplus) + sign * p.surplus;
		if (next < 0) short.push("Surplus");
		system["attributes.surplus.value"] = Math.max(0, next);
	}
	for (const metal of METALS) {
		if (COIN_SIZES.every(size => !p[metal][size])) continue;
		const next = {};
		for (const size of COIN_SIZES) {
			next[size] = count(held?.[metal]?.[size]) + sign * p[metal][size];
			if (next[size] < 0) short.push(COIN_WORDS[size].many.replace("{metal}", metal));
		}
		flags[metal] = Object.fromEntries(COIN_SIZES.map(size => [size, Math.max(0, next[size])]));
	}
	return { system, flags, short };
}

/**
 * What the steading holds that a payment can come out of: each coin box over its defaults, so every size is
 * there (the payment's own reads count a missing one as none).
 */
function heldStores(steading) {
	const f = steading?._flags ?? {};
	return {
		surplus: steading?.getStatValue?.("surplus") ?? 0,
		silver: { ...STEADING_DEFAULTS.silver, ...(f.silver ?? {}) },
		gold: { ...STEADING_DEFAULTS.gold, ...(f.gold ?? {}) },
	};
}

/**
 * Hand the payment over: one steading update filed under Trade & Barter, read and written in the steading's
 * turn (the queue every list write takes), so a Surplus spent elsewhere meanwhile is counted. Refused, with
 * what is short, when the steading cannot pay it.
 * @returns {Promise<{done: boolean, short: string[]}>}
 */
export function settleTradePayment(steading, payment) {
	return inTurn(`steading:${steading?._actor?.id ?? ""}`, async () => {
		const { system, flags, short } = tradePaymentChanges(heldStores(steading), payment);
		if (short.length) return { done: false, short };
		await steading.applyChanges({ system, flags }, { stonetopMove: TRADE_MOVE });
		return { done: true, short: [] };
	});
}

/** Whether the traded item's Value was said: a number, not left blank. PURE. */
function valueSaid(value) {
	return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

/** The payment row a Trade & Barter card's 10+ and 7-9 carry. `value` is the traded item's, when said. */
export function tradePaymentActions(value = null) {
	return `<div class="stonetop-trade-pay-row"${valueSaid(value) ? ` data-item-value="${count(value)}"` : ""}>`
		+ `<button type="button" class="stonetop-trade-pay" data-trade-pay="stores"><i class="fas fa-coins"></i> Settle the payment: Surplus or coin</button>`
		+ `<button type="button" class="stonetop-trade-pay" data-trade-pay="artifact"><i class="fas fa-gem"></i> An artifact changes hands</button>`
		+ `</div>`;
}

/** The payment window's body. `held` is the steading's stores; `value` the traded item's, or null. PURE. */
export function tradePaymentBodyHtml(held, value = null) {
	const field = (name, label, have, worth) => `<label class="stonetop-trade-pay-field">
			<span class="stonetop-trade-pay-label">${escHtml(label)} <small>(Value ${worth}; the steading has ${count(have)})</small></span>
			<input type="number" name="${name}" value="0" min="0" step="1">
		</label>`;
	const coinFields = metal => [...COIN_SIZES].reverse()
		.map(size => field(`${metal}.${size}`, COIN_WORDS[size].many.replace("{metal}", metal), held?.[metal]?.[size], TRADE_VALUES[metal][size]))
		.join("");
	const itemValue = valueSaid(value)
		? `<p class="stonetop-content-picker-hint">The item traded is Value ${count(value)}. A fair price trades things of the same Value (p.542); a 7-9 buy can cost more than usual.</p>`
		: "";
	return `<fieldset class="stonetop-trade-pay-direction">
			<label><input type="radio" name="direction" value="pay" checked> The steading pays</label>
			<label><input type="radio" name="direction" value="receive"> The steading receives</label>
		</fieldset>
		${itemValue}
		${field("surplus", "Surplus", held?.surplus, TRADE_VALUES.surplus)}
		<div class="stonetop-trade-pay-coins">${coinFields("silver")}${coinFields("gold")}</div>
		<p class="stonetop-content-picker-hint">Values are tiers, not sums: three Value 1 things are not Value 3 (p.542).</p>`;
}

/** The payment read off the window's form. PURE. */
export function readTradePaymentForm(form) {
	const num = name => form?.querySelector?.(`input[name="${name}"]`)?.value;
	const coins = metal => Object.fromEntries(COIN_SIZES.map(size => [size, num(`${metal}.${size}`)]));
	return normalizePayment({
		direction: form?.querySelector?.('input[name="direction"]:checked')?.value,
		surplus: num("surplus"),
		silver: coins("silver"),
		gold: coins("gold"),
	});
}

/**
 * An artifact's Value for a trade (p.542), as `{value, unique, hidden}`: `unique` for one with no Value at all
 * ("unique or truly exceptional items", p.540), `hidden` for one whose Value the viewer has not learned yet
 * (artifact-identify.js: a 7+ to Know Things tells them "what it's worth"). The Value is the note's lone
 * trailing "Value N", or else the first one its prose names ("Value 1, or Value 3 to a scholar"). PURE.
 */
export function artifactTradeValue(item, { viewerIsGM = false } = {}) {
	const read = readInventoryItemData(item);
	const split = splitInventoryNote(read.note, { column: read.column });
	const first = /\bValue\s+(\d+)/i.exec(stripHtmlToText(read.note));
	const value = split.value ?? (first ? Number(first[1]) : null);
	const hidden = !artifactVisibility(read.artifact?.state, { viewerIsGM }).showNote;
	return { value, unique: value === null, hidden };
}

/** Whether an owned item is an artifact a trade can move: a treasure carried in the inventory. PURE. */
function isTradeableArtifact(item) {
	return item?.type === "move" && readInventoryItemData(item).isTreasure;
}

/**
 * The artifacts the characters `actors` holds that this user owns carry, as the picker offers them: each
 * `{actor, item, value, unique, hidden}`. A unique one (no Value) comes back with `unique` set, so the caller
 * can say why it is not offered.
 */
export function tradeArtifactCandidates(actors = globalThis.game?.actors?.contents ?? [], { viewerIsGM = !!globalThis.game?.user?.isGM } = {}) {
	return [...actors]
		.filter(actor => actor?.type === "character" && actor.isOwner)
		.flatMap(actor => [...(actor.items ?? [])].filter(isTradeableArtifact)
			.map(item => ({ actor, item, ...artifactTradeValue(item, { viewerIsGM }) })));
}

/** The steading a Trade & Barter card was rolled for, as its model, or null when this user cannot write it. */
function cardSteading(message) {
	const actor = speakerActor(message);
	if (!actor?.isOwner || !isSteadingActor(actor)) return null;
	return actor.typedActor ?? new StonetopSteading(actor);
}

/** A settled button's line, in its place. */
function settledInPlace(button, text) {
	const line = button.ownerDocument.createElement("p");
	line.className = "stonetop-trade-item-done";
	line.textContent = text;
	button.replaceWith(line);
}

/**
 * Wire a Trade & Barter card's payment row (stonetop.js renderChatMessageHTML, on every render). It rides every
 * Trade & Barter 10+ and 7-9, with or without a handout item, so it is wired on its own. Each of its two buttons
 * settles once per card, latched on the message like the hand-over row, and only by someone who may write the
 * card (the GM, or whoever rolled).
 *
 * @param {object} [deps]
 * @param {(spec: object) => Promise<*>} [deps.ask]  the payment window (ContentPickerDialog.ask)
 * @param {typeof pickContentOption} [deps.pickArtifact]
 */
export function wireTradePaymentRow(message, html, {
	ask = spec => ContentPickerDialog.ask(spec), pickArtifact = pickContentOption,
	user = globalThis.game?.user, notify = globalThis.ui?.notifications, actors,
} = {}) {
	const root = html?.[0] ?? html;
	for (const row of root?.querySelectorAll?.(".stonetop-trade-pay-row") ?? []) {
		const stores = row.querySelector(".stonetop-trade-pay[data-trade-pay='stores']");
		const artifact = row.querySelector(".stonetop-trade-pay[data-trade-pay='artifact']");
		const paid = message?.getFlag?.(SYSTEM_ID, TRADE_PAY_FLAG);
		const handed = message?.getFlag?.(SYSTEM_ID, TRADE_ARTIFACT_FLAG);
		const writer = canUserWriteCard(message, user, { whenUnknown: !!user?.isGM });
		if (stores) {
			if (paid) settledInPlace(stores, paid === true ? "Payment settled." : paymentLine(paid, paid.steading));
			else if (!writer) stores.remove();
			else stores.addEventListener("click", ev => {
				ev?.preventDefault?.();
				if (!stores.disabled) return payFromCard(message, stores, row, { ask, notify });
			});
		}
		if (artifact) {
			if (handed) settledInPlace(artifact, handed === true ? "An artifact changed hands." : `${handed.item} changed hands (taken off ${handed.name}).`);
			else if (!writer) artifact.remove();
			else artifact.addEventListener("click", ev => {
				ev?.preventDefault?.();
				if (!artifact.disabled) return handOverArtifact(message, artifact, { pickArtifact, notify, viewerIsGM: !!user?.isGM, actors });
			});
		}
	}
}

/** The payment button: ask what changes hands, then latch the card and write it to the steading. */
export async function payFromCard(message, button, row, { ask, notify = globalThis.ui?.notifications } = {}) {
	const steading = cardSteading(message);
	if (!steading) {
		notify?.warn?.("You need permission to update the steading's Surplus and coin.");
		return null;
	}
	// Down while its window is open, so a second click opens no second window; up again only when
	// nothing was settled.
	return withButtonDown(message, TRADE_PAY_FLAG, button, {
		notify,
		what: "settle a Trade & Barter payment",
		choose: async () => {
			const payment = await ask({
				title: "Trade & Barter: the payment",
				buttonLabel: "Hand it over",
				width: 460,
				body: tradePaymentBodyHtml(heldStores(steading), row?.dataset?.itemValue ?? null),
				read: readTradePaymentForm,
			});
			return payment && !paymentIsEmpty(payment) ? payment : null;
		},
		settle: async payment => {
			const out = await settleTradePayment(steading, payment);
			if (!out.done) {
				notify?.warn?.(`The steading does not have enough to pay that: ${out.short.join(", ")}.`);
				return { abort: true };
			}
			const name = steading._actor?.name ?? "The steading";
			notify?.info?.(paymentLine(payment, name));
			return { stamp: { ...normalizePayment(payment), steading: name } };
		},
	});
}

/**
 * A card button's window, then its settle, with the button down throughout and up again afterwards only when
 * the card's `flag` is still unset (nothing was settled, here or elsewhere). `choose` opens the window (null
 * settles nothing); `settle(chosen)` runs under the card's latch (withLateStampLatch). A card settled while
 * the window was open is said and left alone; a settle that throws is logged as "could not `what`".
 */
async function withButtonDown(message, flag, button, { choose, settle, what, notify }) {
	button.disabled = true;
	try {
		const chosen = await choose();
		if (!chosen) return null;
		try {
			return await withLateStampLatch(message, flag, [button], () => settle(chosen), { onTaken: () => saySettledMeanwhile(notify) });
		} catch (err) {
			console.error(`Stonetop | Could not ${what}:`, err);
			return null;
		}
	} finally {
		if (!message?.getFlag?.(SYSTEM_ID, flag)) button.disabled = false;
	}
}

/** The artifact button: pick one of this user's characters' artifacts with a Value, and take it off them. */
export async function handOverArtifact(message, button, { pickArtifact = pickContentOption, notify = globalThis.ui?.notifications, viewerIsGM = false, actors } = {}) {
	const all = tradeArtifactCandidates(actors, { viewerIsGM });
	const unique = all.filter(c => c.unique);
	const offered = all.filter(c => !c.unique);
	if (unique.length) {
		notify?.info?.(`Not offered: ${unique.map(c => c.item.name).join(", ")}. A unique item with no Value is beyond Trade & Barter: Make a Plan or wait for a trade opportunity (p.540).`);
	}
	if (!offered.length) {
		notify?.warn?.("None of your characters carries an artifact with a Value to trade.");
		return null;
	}
	const key = c => `${c.actor.id}.${c.item.id}`;
	return withButtonDown(message, TRADE_ARTIFACT_FLAG, button, {
		notify,
		what: "hand over an artifact",
		choose: async () => {
			const id = await pickArtifact({
				title: "Which artifact changes hands?",
				buttonLabel: "Take it off them",
				options: offered.map(c => ({
					id: key(c),
					label: `${c.item.name} (${c.actor.name})`,
					icon: "fa-gem",
					hint: c.hidden ? "Value not yet known" : `Value ${c.value}`,
				})),
			});
			return id ? offered.find(c => key(c) === id) ?? null : null;
		},
		settle: async chosen => {
			// Taken off its character: it has changed hands.
			await chosen.item.delete();
			notify?.info?.(`${chosen.item.name} changes hands: taken off ${chosen.actor.name}.`);
			return { stamp: { actorId: chosen.actor.id, name: chosen.actor.name, item: chosen.item.name } };
		},
	});
}
