// The Blessed's sacred pouch: what it holds besides Stock, how its room changes, and the downtime refill.
//
// Book I, The Blessed: the pouch "can hold up to 3 Stock... Each time you gain an even-numbered level, your
// pouch can hold +1 Stock... When you have a few days of downtime in familiar terrain, you may replenish
// your Stock." Two moves put something else in it:
//   · Suck the Poison Out, 10+: "you remove the malady and can safely discard it or store it in your sacred
//     pouch (taking the space of 1 Stock) to study or inflict on another".
//   · Borrow Power: "ask the GM for one of its tags or moves. Store it in your pouch in place of 1 Stock.
//     When you use the borrowed tag or move, roll +WIS: on a 10+, you do it and can use the power again; on a
//     7-9, you do it, but lose the power."
//
// THE COUNT. The pouch's track counts Stock SPENT (stock-cost.js): `remaining = max - spent`, so a spent
// pip is an EMPTY space. Each named entry (a malady, a borrowed power) takes one space, so the Stock track's
// max is the pouch's room less its entries: the USABLE max (StonetopCharacter#computePossessionMaxUses, the
// one place, so the gear tab, every Stock payer and Forage read the same number).
//
// Room changes keep the Stock that is in the pouch where they can (the user's rulings, 2026-10-18):
//   · An entry goes into an EMPTY space when there is one (spent - 1, Stock unchanged). With none, it
//     takes the place of 1 Stock, which is discarded (flagged to the player, never refused).
//   · An entry taken out leaves its space EMPTY (spent + 1, Stock unchanged).
//   · The pouch growing (an even level, Big Magic learned) adds EMPTY room (spent + the growth); shrinking
//     (Big Magic removed or un-learned) clamps spent to the new max. A pouch gained or lost has nothing to
//     settle: a new one (creation, a Seeker's Initiate) starts full.
//
// The arithmetic is plain numbers here; StonetopCharacter writes it, and the card and sheet flows at the
// bottom are the buttons that ask for it.

import { SYSTEM_ID } from "../../system-id.js";
import { readableFlags } from "./StonetopFlags.js";
import { SACRED_POUCH_SLUG } from "./stock-cost.js";
import { ownsLearnedMoveNamed } from "./owns-move.js";
import { escHtml } from "../../utils/strings.js";
import { postMoveNote } from "../../utils/chat.js";
import { askWithButtons, confirmOutcome } from "../../utils/ask-with-buttons.js";
import { contentElement } from "../../utils/dialogv2-content.js";
import { cardTierNow } from "../../utils/counted-tier.js";
import { withCardLatch, wireLatchedButtons } from "../../utils/card-latch.js";
import { clampInt } from "../../utils/custom-move-data.js";

export const SUCK_THE_POISON_OUT = "Suck the Poison Out";
export const BORROW_POWER = "Borrow Power";
export const SACRED_POUCH = "Sacred pouch";

/** Where the entries live: a list under the possessions flag bag, beside the pouch's spent count. */
export const POUCH_SLOTS_KEY = "pouchSlots";

/** What an entry is. */
export const POUCH_SLOT = { MALADY: "malady", POWER: "power" };
const KIND_LABEL = { [POUCH_SLOT.MALADY]: "Malady", [POUCH_SLOT.POWER]: "Borrowed power" };

/** The book's condition for the refill, quoted wherever the refill is offered. */
export const REPLENISH_CONDITION = "When you have a few days of downtime in familiar terrain, you may replenish your Stock.";

const whole = n => clampInt(n, 0, Infinity);

/** The stored list, normalised: `{id, kind, name}` rows with a name, anything else dropped. */
export function readPouchSlots(raw) {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter(e => e && typeof e === "object" && e.id && String(e.name ?? "").trim())
		.map(e => ({ id: String(e.id), kind: e.kind === POUCH_SLOT.POWER ? POUCH_SLOT.POWER : POUCH_SLOT.MALADY, name: String(e.name).trim() }));
}

/** "Malady" / "Borrowed power". */
export function pouchSlotLabel(kind) {
	return KIND_LABEL[kind] ?? KIND_LABEL[POUCH_SLOT.MALADY];
}

/** The Stock track's max: the pouch's room less its entries, never below 0. */
export function pouchUsableMax(capacity, slotCount) {
	return Math.max(0, whole(capacity) - whole(slotCount));
}

/**
 * The spent count after storing one entry in a pouch whose Stock track is `usable` long. Into an empty
 * space when there is one (the Stock stays as it was); with none, it takes the place of 1 Stock
 * (`displaced`), and with no Stock space at all it goes in past the pouch's room (`overfull`).
 */
export function spentAfterStore(spent, usable) {
	const room = whole(usable);
	const s = Math.min(room, whole(spent));
	if (s > 0) return { spent: s - 1, displaced: false, overfull: false };
	return { spent: 0, displaced: room > 0, overfull: room === 0 };
}

/** The spent count after one entry leaves: its space comes back EMPTY, so the Stock stays as it was. */
export function spentAfterFree(spent, usableBefore, usableAfter) {
	return Math.min(whole(usableAfter), Math.min(whole(usableBefore), whole(spent)) + 1);
}

/**
 * The spent count once the pouch's max goes from `before` to `after` (an even level, Big Magic learned or
 * removed), or null when there is nothing to settle: no change, or a pouch gained or lost (null either side).
 * Growth arrives EMPTY (spent rises by it); a shrink clamps spent to the new max, never below 0.
 */
export function settledPouchSpent(spent, before, after) {
	if (before == null || after == null) return null;
	const b = whole(before);
	const a = whole(after);
	if (a === b) return null;
	const s = Math.min(b, whole(spent));
	return a > b ? Math.min(a, s + (a - b)) : Math.min(s, a);
}

/**
 * What the pouch's row on the Gear tab needs: its entries and whether the refill and the remove controls
 * show. Null when the character carries no pouch flags worth drawing (the template shows it on the pouch
 * row only). `usable` is the pouch's usable max (StonetopCharacter#sacredPouchMax): the stored spent count
 * is read against it, as replenishPouch reads it (pouchRoom), so a pouch whose every space holds an entry
 * offers no refill it would only answer "already full" to. Left out, the stored count is read as it is.
 */
export function sacredPouchPanel(actor, { editable = false, usable } = {}) {
	const bag = readableFlags(actor)?.possessions ?? {};
	const slots = readPouchSlots(bag[POUCH_SLOTS_KEY]).map(s => ({ ...s, kindLabel: pouchSlotLabel(s.kind) }));
	const stored = whole(bag.uses?.[SACRED_POUCH_SLUG]);
	const spent = usable === undefined ? stored : Math.min(stored, whole(usable));
	return { slug: SACRED_POUCH_SLUG, slots, hasSlots: slots.length > 0, spent, editable: !!editable, canReplenish: !!editable && spent > 0 };
}

// -- The flows the buttons run ------------------------------------------------------------------

const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);

/**
 * Ask what goes into the pouch. Answers the trimmed name, or null (closed, or nothing written).
 * `warning` is the room line (a Stock pushed out, or no room at all): said, never a refusal.
 */
export async function askPouchEntryName(kind, { warning = "" } = {}) {
	const power = kind === POUCH_SLOT.POWER;
	const prompt = power
		? "Which of its tags or moves did the GM loan you? It goes in your sacred pouch in place of 1 Stock."
		: "What malady did you draw out? Stored in your sacred pouch, it takes the space of 1 Stock, to study or inflict on another.";
	const content = contentElement(`<div class="stonetop stonetop-pouch-store">
		<p>${escHtml(prompt)}</p>
		${warning ? `<p class="stonetop-move-cost-warn">${escHtml(warning)}</p>` : ""}
		<input type="text" name="pouchEntryName" placeholder="${power ? "its tag or move" : "the malady"}">
	</div>`);
	const answer = await askWithButtons({
		title: power ? BORROW_POWER : SUCK_THE_POISON_OUT,
		content,
		render: root => root?.querySelector?.('[name="pouchEntryName"]')?.focus?.(),
		buttons: [
			{ key: "store", label: power ? "Store the borrowed power" : "Store the malady", icon: "fa-box-archive",
				value: form => String(form?.elements?.namedItem?.("pouchEntryName")?.value ?? "").trim() },
			{ key: "cancel", label: "Cancel", icon: "fa-xmark", value: null },
		],
	});
	if (answer === "") notify("warn", "Name what you store first.");
	return answer || null;
}

/** The room line the store window says, or "" when the entry fits in an empty space. */
export function pouchStoreWarning(room) {
	if (!room) return "";
	if (room.usable <= 0) return "Your pouch has no room left: every space already holds a malady or a borrowed power. You can still store this, past its room, if the GM agrees.";
	if (room.spent <= 0) return "Your pouch is full of Stock, so this takes the place of 1 Stock, which you discard. Take something else out first if you would rather keep it.";
	return "";
}

/**
 * Store a malady or a borrowed power in `actor`'s pouch: ask its name, write it, say so in chat. Answers
 * the stored entry, or null when nothing was stored. A full pouch is said, never refused (flag, never block).
 */
export async function storeInPouch(actor, kind, { moveName = null, ask = askPouchEntryName, post = postMoveNote } = {}) {
	const char = actor?.typedActor;
	if (!char?.storePouchSlot) return null;
	const room = await char.pouchRoom();
	if (!room.held) {
		notify("warn", "You carry no sacred pouch to store it in.");
		return null;
	}
	const name = await ask(kind, { warning: pouchStoreWarning(room) });
	if (!name) return null;
	const entry = await char.storePouchSlot({ kind, name });
	if (!entry) return null;
	const what = kind === POUCH_SLOT.POWER ? "the borrowed power" : "the malady";
	const tail = entry.displaced ? ", discarding 1 Stock to make room" : "";
	await post(actor, moveName ?? (kind === POUCH_SLOT.POWER ? BORROW_POWER : SUCK_THE_POISON_OUT),
		`${actor.name} stores ${what} "${name}" in their sacred pouch${tail}.`);
	return entry;
}

/** What taking an entry out says in chat, by the reason picked. */
const TAKE_OUT_LINE = {
	discard: (who, s) => `${who} safely discards the malady "${s.name}" from their sacred pouch.`,
	inflict: (who, s) => `${who} takes the malady "${s.name}" from their sacred pouch to inflict on another.`,
	lose:    (who, s) => `${who} loses the borrowed power "${s.name}".`,
};

/**
 * The remove control on a pouch entry: ask why it comes out (a malady discarded or inflicted, a power
 * lost), then take it out. Its space comes back empty. Answers the entry taken out, or null.
 */
export async function takeFromPouch(actor, slotId, { ask = askWithButtons, post = postMoveNote } = {}) {
	const char = actor?.typedActor;
	const slot = char?.pouchSlots?.find(s => s.id === slotId);
	if (!slot) return null;
	const power = slot.kind === POUCH_SLOT.POWER;
	const reason = await ask({
		title: SACRED_POUCH,
		content: `<p>Take ${power ? "the borrowed power" : "the malady"} <strong>${escHtml(slot.name)}</strong> out of your sacred pouch? Its space comes back empty.</p>`,
		buttons: power
			? [
				{ key: "lose", label: "Lose the power", icon: "fa-wind", value: "lose" },
				{ key: "keep", label: "Keep it", icon: "fa-xmark", value: null },
			]
			: [
				{ key: "discard", label: "Discard it safely", icon: "fa-trash", value: "discard" },
				{ key: "inflict", label: "Inflict it on another", icon: "fa-skull", value: "inflict" },
				{ key: "keep",    label: "Keep it", icon: "fa-xmark", value: null },
			],
		defaultKey: "keep",
	});
	if (!reason) return null;
	const gone = await char.removePouchSlot(slotId);
	if (gone) await post(actor, power ? BORROW_POWER : SUCK_THE_POISON_OUT, TAKE_OUT_LINE[reason](actor.name, gone));
	return gone;
}

/**
 * "Replenish (downtime)": refill the pouch's Stock to its usable max, after a confirm that quotes the
 * book's condition. Owner (or GM) only. Answers whether it refilled.
 */
export async function replenishPouch(actor, { confirm = confirmOutcome, post = postMoveNote } = {}) {
	const char = actor?.typedActor;
	if (!actor?.isOwner || !char?.replenishPouch) return false;
	const room = await char.pouchRoom();
	if (!room.held) return false;
	if (room.spent <= 0) {
		notify("info", "Your sacred pouch is already full.");
		return false;
	}
	const slots = char.pouchSlots?.length ?? 0;
	const kept = slots ? ` What else it holds (${slots === 1 ? "1 malady or borrowed power" : `${slots} maladies or borrowed powers`}) stays where it is.` : "";
	const ok = await confirm({
		title: "Replenish Stock",
		content: `<p><em>${escHtml(REPLENISH_CONDITION)}</em></p>`
			+ `<p>Refill your sacred pouch from ${room.remaining} to ${room.usable} Stock?${escHtml(kept)}</p>`,
		yes: { label: "Replenish the pouch", icon: "fa-seedling" },
		no:  { label: "Not yet" },
	});
	if (!ok) return false;
	const done = await char.replenishPouch();
	if (done) await post(actor, SACRED_POUCH, `${actor.name} replenishes their sacred pouch: ${room.usable} Stock after a few days of downtime.`);
	return !!done;
}

/**
 * Borrow Power's 7-9: "you do it, but lose the power". Which power, when the pouch holds several. Answers
 * the entry lost, or null (none held, or the question closed).
 */
export async function loseBorrowedPower(actor, { ask = askWithButtons, post = postMoveNote } = {}) {
	const char = actor?.typedActor;
	const powers = (char?.pouchSlots ?? []).filter(s => s.kind === POUCH_SLOT.POWER);
	if (!powers.length) {
		notify("warn", "Your sacred pouch holds no borrowed power to lose.");
		return null;
	}
	const id = powers.length === 1 ? powers[0].id : await ask({
		title: BORROW_POWER,
		content: "<p>Which borrowed power did you use? You do it, but lose the power.</p>",
		buttons: [
			...powers.map(p => ({ key: p.id, label: p.name, icon: "fa-wind", value: p.id })),
			{ key: "cancel", label: "Cancel", icon: "fa-xmark", value: null },
		],
	});
	if (!id) return null;
	const gone = await char.removePouchSlot(id);
	if (gone) await post(actor, BORROW_POWER, TAKE_OUT_LINE.lose(actor.name, gone));
	return gone;
}

// -- The roll cards ------------------------------------------------------------------------------

/** Message flags: the card's store / lose has been used. */
export const POUCH_STORED_FLAG = "pouchStored";
export const POWER_LOST_FLAG = "pouchPowerLost";

const STORE_SELECTOR = ".stonetop-pouch-card-store";
const LOSE_SELECTOR = ".stonetop-pouch-card-lose";

/** Suck the Poison Out's 10+ row: "Store the malady in your pouch". LEARNED only. */
export function suckThePoisonOutRollOptions(actor) {
	if (!ownsLearnedMoveNamed(actor, SUCK_THE_POISON_OUT)) return null;
	return { tierActions: { success: `<button type="button" class="stonetop-pouch-card-store" data-tier="success">`
		+ `<i class="fas fa-box-archive"></i> Store the malady in your pouch</button>` } };
}

/** Borrow Power's 7-9 row: "Lose the power". LEARNED only. */
export function borrowPowerRollOptions(actor) {
	if (!ownsLearnedMoveNamed(actor, BORROW_POWER)) return null;
	return { tierActions: { partial: `<button type="button" class="stonetop-pouch-card-lose" data-tier="partial">`
		+ `<i class="fas fa-wind"></i> Lose the power</button>` } };
}

/** Refuse a row the card no longer reads (a Shift since), the way Send Them Back does. */
function onTier(message, btn) {
	const want = btn?.dataset?.tier;
	if (cardTierNow(message, SYSTEM_ID) === want) return true;
	notify("warn", "This card no longer reads that result, so that button no longer applies.");
	return false;
}

/** Store from a Suck the Poison Out card, once per card. */
export async function settlePouchStore(message, actor, btn, { buttons = [], store = storeInPouch } = {}) {
	if (!actor || message?.getFlag?.(SYSTEM_ID, POUCH_STORED_FLAG) || !onTier(message, btn)) return false;
	return withCardLatch(message, POUCH_STORED_FLAG, true, buttons,
		async () => !!(await store(actor, POUCH_SLOT.MALADY, { moveName: SUCK_THE_POISON_OUT })));
}

/** Lose the power from a Borrow Power card, once per card. */
export async function settlePowerLost(message, actor, btn, { buttons = [], lose = loseBorrowedPower } = {}) {
	if (!actor || message?.getFlag?.(SYSTEM_ID, POWER_LOST_FLAG) || !onTier(message, btn)) return false;
	return withCardLatch(message, POWER_LOST_FLAG, true, buttons, async () => !!(await lose(actor)));
}

/** Wire both cards' buttons (stonetop.js renderChatMessageHTML). */
export function wirePouchCards(message, html) {
	wireLatchedButtons(message, html, { selector: STORE_SELECTOR, flag: POUCH_STORED_FLAG, what: "Storing the malady",
		act: (actor, btn, buttons) => settlePouchStore(message, actor, btn, { buttons }) });
	wireLatchedButtons(message, html, { selector: LOSE_SELECTOR, flag: POWER_LOST_FLAG, what: "Losing the borrowed power",
		act: (actor, btn, buttons) => settlePowerLost(message, actor, btn, { buttons }) });
}
