// Using Bolster (homefront, Book I p.524): "When you prepare for what's coming or seek the favor of the gods,
// say how and answer the GM's questions. Then, hold Preparation based on the amount of time you devote."
//
// The window asks the two things the move leaves on the sheet: how long they devoted (a week, a month, the
// better part of a season: 1, 2 or 3 Preparation) and what they are preparing for, which p.525 asks the
// player to record beside it ("2 Preparation (laying in extra stores for winter)"). The +1 it buys is spent
// from a roll's card (roll-boosts.js, `preparation`). Bolstering again replaces what was held.

import { ContentPickerDialog } from "../../dialogs/content-picker.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";
import { BOLSTER_DURATIONS, holdPreparation, preparationFor, preparationHeld } from "./roll-boosts.js";

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
 * Ask how long the character Bolstered and for what, then hold that Preparation. Resolves to the amount
 * held, or null when the window was closed. Only for a character this user can write.
 *
 * @param {Actor} actor
 * @param {{ask?: (spec: object) => Promise<{hold: number, purpose: string}|null>}} [deps]
 */
export async function openBolster(actor, { ask = spec => ContentPickerDialog.ask(spec) } = {}) {
	if (actor?.type !== "character" || actor.isOwner === false) return null;
	const answer = await ask({
		title: localize(`${KEY}.title`),
		buttonLabel: localize(`${KEY}.confirm`),
		body: bolsterBodyHtml(actor),
		read: readBolsterForm,
	});
	if (!answer) return null;
	await holdPreparation(actor, answer.hold, answer.purpose);
	globalThis.ui?.notifications?.info?.(format(`${KEY}.held`, { name: actor.name, held: answer.hold }));
	return answer.hold;
}
