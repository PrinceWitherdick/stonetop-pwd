// Using Bolster (homefront, Book I p.524): "When you prepare for what's coming or seek the favor of the gods,
// say how and answer the GM's questions. Then, hold Preparation based on the amount of time you devote."
//
// The window asks the two things the move leaves on the sheet: how long they devoted (a week, a month, the
// better part of a season: 1, 2 or 3 Preparation) and what they are preparing for, which p.525 asks the
// player to record beside it ("2 Preparation (laying in extra stores for winter)"). The +1 it buys is spent
// from a roll's card (roll-boosts.js, `preparation`; preparation-damage.js on a damage roll). Bolstering
// again replaces what was held. Said in chat, so the GM who asked the questions sees what was laid in.
//
// "Preparation lasts until it is spent, until it no longer applies or makes sense, or until the PC Bolsters
// again" (p.525). Spending is the roll card's; the Special Moves card also lets it go when it no longer
// applies (dropPreparation), and fixes what it was written down as for (editPreparationFor) without
// Bolstering again.

import { ContentPickerDialog } from "../../dialogs/content-picker.js";
import { confirmOutcome } from "../../utils/ask-with-buttons.js";
import { postMoveNote } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";
import { inSpenderTurn } from "../../utils/spender-queue.js";
import {
	BOLSTER, BOLSTER_DURATIONS, holdPreparation, preparationFor, preparationHeld, refundPreparation, setPreparationFor,
	spendPreparation,
} from "./roll-boosts.js";

const KEY = "stonetop.rollBoosts.bolster";

/**
 * The window's body: the three amounts of time as one radio group (a week picked), what is held now
 * (Bolstering again replaces it), and the "what for" box. PURE apart from the localization.
 */
export function bolsterBodyHtml(actor) {
	const held = preparationHeld(actor);
	const purpose = preparationFor(actor);
	const rows = BOLSTER_DURATIONS.map((d, i) => `<label class="stonetop-content-picker-option">
			<input type="radio" name="bolsterHold" value="${d.hold}"${i === 0 ? " checked" : ""}>
			<i class="fas fa-hourglass-half" aria-hidden="true"></i>
			<span class="stonetop-content-picker-text">
				<span class="stonetop-content-picker-label">${escHtml(localize(`${KEY}.duration.${d.key}`))}</span>
				<span class="stonetop-content-picker-hint">${escHtml(format(`${KEY}.holds`, { hold: d.hold }))}</span>
			</span>
		</label>`).join("");
	const now = held
		? `<p class="stonetop-content-picker-hint">${escHtml(format(`${KEY}.replaces`, { held, purpose: purpose || localize(`${KEY}.noPurpose`) }))}</p>`
		: "";
	return `<p>${escHtml(localize(`${KEY}.lead`))}</p>
		${rows}
		${now}
		<label class="stonetop-bolster-purpose">
			<span>${escHtml(localize(`${KEY}.purposeLabel`))}</span>
			<input type="text" name="preparationFor" value="${escHtml(purpose)}" placeholder="${escHtml(localize(`${KEY}.purposePlaceholder`))}">
		</label>`;
}

/**
 * The Special Moves tab's Bolster card: what is held now, as one line, or no hint while nothing is.
 * PURE apart from the localization.
 */
export function bolsterCardData(actor) {
	const held = preparationHeld(actor);
	if (!held) return { held: 0, hint: "" };
	const purpose = preparationFor(actor);
	const hint = purpose
		? format("stonetop.specialMoves.bolster.heldHint", { held, purpose })
		: format("stonetop.specialMoves.bolster.heldHintNoPurpose", { held });
	return { held, hint };
}

/** The answer read off the window's form: `{hold, purpose}`. PURE. */
export function readBolsterForm(form) {
	const picked = form?.querySelector?.('input[name="bolsterHold"]:checked');
	return {
		hold: Math.trunc(Number(picked?.value) || BOLSTER_DURATIONS[0].hold),
		purpose: String(form?.querySelector?.('input[name="preparationFor"]')?.value ?? "").trim(),
	};
}

/**
 * The chat line for a Bolster: how long, how much, what for, and what it replaced. PURE apart from the
 * localization. `before` is what was held just before, `{held, purpose}`.
 */
export function bolsterChatText(actor, hold, purpose, before = { held: 0, purpose: "" }) {
	const d = BOLSTER_DURATIONS.find(x => x.hold === hold) ?? BOLSTER_DURATIONS[0];
	const time = localize(`${KEY}.chatTime.${d.key}`);
	let text = purpose
		? format(`${KEY}.chat`, { name: actor.name, time, held: d.hold, purpose })
		: format(`${KEY}.chatNoPurpose`, { name: actor.name, time, held: d.hold });
	if (before.held > 0) {
		text += " " + (before.purpose
			? format(`${KEY}.chatReplaces`, { held: before.held, purpose: before.purpose })
			: format(`${KEY}.chatReplacesNoPurpose`, { held: before.held }));
	}
	return text;
}

/**
 * Ask how long the character Bolstered and for what, then hold that Preparation and say so in chat.
 * Resolves to the amount held, or null when the window was closed. Only for a character this user can write.
 *
 * @param {Actor} actor
 * @param {{ask?: (spec: object) => Promise<{hold: number, purpose: string}|null>, post?: Function}} [deps]
 */
export async function openBolster(actor, { ask = spec => ContentPickerDialog.ask(spec), post = postMoveNote } = {}) {
	if (actor?.type !== "character" || actor.isOwner === false) return null;
	const answer = await ask({
		title: localize(`${KEY}.title`),
		buttonLabel: localize(`${KEY}.confirm`),
		body: bolsterBodyHtml(actor),
		read: readBolsterForm,
	});
	if (!answer) return null;
	const before = { held: preparationHeld(actor), purpose: preparationFor(actor) };
	await holdPreparation(actor, answer.hold, answer.purpose);
	await post(actor, BOLSTER, bolsterChatText(actor, answer.hold, answer.purpose, before));
	return answer.hold;
}

/** The "what for" window's body: the one text box, filled with what is written now. PURE apart from the localization. */
export function preparationForBodyHtml(actor) {
	return `<label class="stonetop-bolster-purpose">
			<span>${escHtml(localize(`${KEY}.purposeLabel`))}</span>
			<input type="text" name="preparationFor" value="${escHtml(preparationFor(actor))}" placeholder="${escHtml(localize(`${KEY}.purposePlaceholder`))}">
		</label>`;
}

/** What the "what for" window resolves to when "It no longer applies" is pressed instead of Save. */
const LET_GO = Symbol("letGo");

/**
 * Change what the Preparation is for, keeping how much is held: a typo, or the table's sharper wording
 * once the GM's questions are answered. Said in chat when it changed. Whether it changed.
 *
 * `offerDrop` puts "It no longer applies" beside Save (the header chip, the one control there is): pressed,
 * it asks and lets the Preparation go as dropPreparation does, and this resolves to whether it went. The
 * Special Moves card has that button of its own, so its window leaves it off.
 */
export async function editPreparationFor(actor, {
	ask = spec => ContentPickerDialog.ask(spec), post = postMoveNote, offerDrop = false, drop = dropPreparation,
} = {}) {
	if (actor?.type !== "character" || actor.isOwner === false || !preparationHeld(actor)) return false;
	const purpose = await ask({
		title: localize(`${KEY}.editTitle`),
		buttonLabel: localize(`${KEY}.editConfirm`),
		body: preparationForBodyHtml(actor),
		read: form => readBolsterForm(form).purpose,
		...(offerDrop ? { secondary: { label: localize(`${KEY}.dropButton`), icon: "fa-xmark", value: LET_GO } } : {}),
	});
	if (purpose === LET_GO) return drop(actor, { post });
	if (purpose === null || purpose === undefined || purpose === preparationFor(actor)) return false;
	await setPreparationFor(actor, purpose);
	await post(actor, BOLSTER, purpose
		? format(`${KEY}.chatEdited`, { name: actor.name, held: preparationHeld(actor), purpose })
		: format(`${KEY}.chatEditedBlank`, { name: actor.name, held: preparationHeld(actor) }));
	return true;
}

/**
 * Let the Preparation go: "until it no longer applies or makes sense" (p.525). Asked first, since nothing
 * gives it back but Bolstering again. Said in chat. Whether it was let go.
 */
export async function dropPreparation(actor, { confirm = confirmOutcome, post = postMoveNote } = {}) {
	if (actor?.type !== "character" || actor.isOwner === false) return false;
	const held = preparationHeld(actor);
	if (!held) return false;
	const purpose = preparationFor(actor);
	const ok = await confirm({
		title: localize(`${KEY}.dropTitle`),
		content: `<p>${escHtml(purpose
			? format(`${KEY}.dropAsk`, { name: actor.name, held, purpose })
			: format(`${KEY}.dropAskNoPurpose`, { name: actor.name, held }))}</p>`,
		// The house confirm for something only redoing the move gets back, as Introductions' "Delete this
		// answer?": the red answer with a bin, then "Keep it" on the stock cross.
		yes: { label: localize(`${KEY}.dropConfirm`), icon: "fa-trash", className: "stonetop-dialog-btn--danger" },
		no: { label: localize(`${KEY}.dropKeep`) },
	});
	if (ok !== true) return false;
	await holdPreparation(actor, 0, "");
	await post(actor, BOLSTER, purpose
		? format(`${KEY}.chatDropped`, { name: actor.name, held, purpose })
		: format(`${KEY}.chatDroppedNoPurpose`, { name: actor.name, held }));
	return true;
}

// -- Spring's Seasons Change, handed to the table ----------------------------------------------------------
// "PCs can Bolster for a coming season and spend the Preparation on the roll(s)" (p.516). The other seasons'
// +Fortunes cards take it from their own button (roll-boosts.js, `onSteading`). Spring's is rolled by a player
// clicking a card the GM handed over, whose result can never be rewritten (roll-engine.js#rollSeasonsCard), so
// its Preparation is spent as the GM hands it over: one line per PC holding any, in the same window as the
// storm's curse, and at most one taken ("maximum +1 per roll").

const OFFER_PREFIX = "preparation:";

/**
 * The window's lines: one per character holding Preparation, unticked. PURE apart from the localization.
 *
 * @param {Actor[]} characters
 * @returns {{key: string, label: string, applied: false, holder: Actor}[]}
 */
export function preparationRollOffers(characters = []) {
	return characters.filter(a => a?.type === "character" && preparationHeld(a) > 0).map(holder => {
		const purpose = preparationFor(holder);
		const held = preparationHeld(holder);
		return {
			key: `${OFFER_PREFIX}${holder.uuid}`,
			label: purpose
				? format(`${KEY}.rollOffer`, { name: holder.name, held, purpose })
				: format(`${KEY}.rollOfferNoPurpose`, { name: holder.name, held }),
			applied: false,
			holder,
		};
	});
}

/**
 * The line taken, the first ticked ("maximum +1 per roll"), or null for none, and how many more were ticked,
 * which buy nothing. PURE.
 *
 * @returns {{taken: object|null, extra: number}}
 */
export function takenPreparationOffer(offers = [], takenOffers = []) {
	const ticked = new Set(Array.isArray(takenOffers) ? takenOffers : []);
	const all = offers.filter(o => ticked.has(o.key));
	return { taken: all[0] ?? null, extra: Math.max(0, all.length - 1) };
}

/**
 * Pay for the taken line's +1, BEFORE the card that carries it goes out, so the card never shows a +1 nobody
 * paid for. Whether it was paid: the holder may have spent their last since the window opened, and then the
 * GM is told the roll goes without it.
 */
export async function claimPreparationOffer(offer, { warn = msg => globalThis.ui?.notifications?.warn?.(msg) } = {}) {
	const holder = offer?.holder;
	if (!holder) return false;
	if (await inSpenderTurn(holder, () => spendPreparation(holder))) return true;
	warn(format(`${KEY}.rollOfferGone`, { name: holder.name }));
	return false;
}

/** Give back a claimed line's Preparation, for a card that never went out. */
export async function returnPreparationOffer(offer) {
	const holder = offer?.holder;
	if (holder) await inSpenderTurn(holder, () => refundPreparation(holder));
}

/** Say in chat that the claimed line's Preparation went on the roll. `extra`: lines also ticked, which bought nothing. */
export async function announcePreparationOffer(offer, rollName, { extra = 0, post = postMoveNote } = {}) {
	const holder = offer?.holder;
	if (!holder) return;
	let text = format(`${KEY}.chatSpentOnRoll`, { name: holder.name, roll: rollName });
	if (extra > 0) text += " " + localize(`${KEY}.chatOnePerRoll`);
	await post(holder, BOLSTER, text);
}

/**
 * The header's Preparation pill, beside Inspiration's and Rapport's: what is held, IN WORDS ("Preparation 2"),
 * drawn only while some is held, with what it is for in its tooltip. Spent from a roll's card, so the pill
 * itself changes what it is for (editPreparationFor) where the sheet is editable. PURE apart from the
 * localization.
 */
export function preparationChip(actor, { editable = false } = {}) {
	const held = preparationHeld(actor);
	if (!held) return { show: false, held: 0, label: "", tooltip: "" };
	const purpose = preparationFor(actor);
	const base = purpose ? format(`${KEY}.chipTooltip`, { held, purpose }) : format(`${KEY}.chipTooltipNoPurpose`, { held });
	return {
		show: true,
		held,
		label: format(`${KEY}.chipLabel`, { held }),
		tooltip: editable ? `${base} ${localize(`${KEY}.chipClick`)}` : base,
	};
}
