// A spend that adds to a damage roll's card: the part We Happy Few's +1d6 (inspiration-flow.js) and Bolster's
// +1 (preparation-damage.js) share, so a fix to which cards take one, how a card is written or how its note
// and button are drawn lands on both.
//
//  - the holder's OWN damage card, once per card for each kind of boost (its message flag): the plain card
//    (no one targeted), whose roll takes the amount as a term of its own; and the attack flow's results card,
//    before anyone has pressed Apply, whose every row takes it (the rows are one blow rolled per target).
//  - not a follower's blow posted under their name, a blow they took, a group's blow, or someone else's.
//
// What is spent, who may press and how a press is relayed stay with each boost.

import { SYSTEM_ID } from "../../system-id.js";
import { escHtml } from "../../utils/strings.js";
import { writeCardRoll } from "../../utils/roll-card-writer.js";
import { speakerActor } from "../../utils/speaker-actor.js";
import { cardSettled } from "../../utils/applying-mark.js";

/** Message flag: a follower's blow posted under their character's name, which is not the character's roll. */
export const FOLLOWER_BLOW_FLAG = "followerBlow";

/**
 * Which kind of damage card this is: the attack flow's `results` card (flag `damage`, one row per
 * target, Apply beneath), the `plain` card of a roll with nobody targeted, or null for anything else. PURE.
 */
export function damageCardKind(message, scope = SYSTEM_ID) {
	const damage = message?.getFlag?.(scope, "damage");
	if (Array.isArray(damage?.results)) return "results";
	if (message?.rolls?.length && String(message.flavor ?? "").includes("stonetop-damage-roll-card")) return "plain";
	return null;
}

/**
 * Who this card could take the boost recorded under `flag` for, and what kind of card it is: the speaker's own
 * damage roll, not yet given that boost, not a follower's blow, a blow they took or a group's blow, and not yet
 * applied. Null otherwise. Whether they hold enough, and whether this user presses for them, are the boost's.
 * PURE apart from reading the speaker.
 *
 * @returns {{holder: Actor, kind: "results"|"plain"}|null}
 */
export function damageBoostHolder(message, flag, { holderOf = speakerActor, scope = SYSTEM_ID } = {}) {
	const kind = damageCardKind(message, scope);
	if (!kind || message.getFlag(scope, flag) || message.getFlag(scope, FOLLOWER_BLOW_FLAG)) return null;
	const holder = holderOf(message);
	if (holder?.type !== "character") return null;
	if (kind === "results") {
		const damage = message.getFlag(scope, "damage");
		if (damage.selfHarm || damage.groupBlow) return null;
		if ((damage.applied ?? []).length || damage.attackerUuid !== holder.uuid) return null;
	}
	return { holder, kind };
}

/**
 * The card as it stands, read in its turn just before the boost is paid for: its kind and (a results card's)
 * damage flag, or null when it can no longer take this boost (not a damage card now, given it already, or
 * applied). PURE.
 *
 * @returns {{kind: "results"|"plain", damage: object|null}|null}
 */
export function openDamageCard(message, flag, scope = SYSTEM_ID) {
	const kind = damageCardKind(message, scope);
	if (!kind || message.getFlag(scope, flag)) return null;
	const damage = kind === "results" ? message.getFlag(scope, "damage") : null;
	// Another client applying the rows right now: the card queue orders presses on one client only, so a boost
	// written meanwhile would land after the rows were read, the +1 paid for and never dealt.
	if (damage && cardSettled(damage)) return null;
	return { kind, damage };
}

/**
 * `amount` onto a plain card's roll, as a term of its own tagged `tag`: the way stonetop.js#_shiftRoll puts a
 * GM's Shift on, so a Shift after this keeps it, and the Roll still adds up to what the card says. Handed the
 * copy utils/roll-card-writer.js#writeCardRoll lifts, so a refused write leaves the card's own roll as it was.
 */
export async function addTermToRoll(roll, amount, tag) {
	const { OperatorTerm, NumericTerm } = globalThis.foundry.dice.terms;
	roll.terms.push(
		new OperatorTerm({ operator: "+", options: { [tag]: true } }),
		new NumericTerm({ number: amount, options: { [tag]: true } }),
	);
	roll.resetFormula();
	await roll._evaluate();
}

/**
 * Write the boost onto the card, with `record` under `flag` so its button goes: `amount` on every row of a
 * results card (`damage`, from openDamageCard), or on a plain card's roll and total through `addTerm(roll,
 * amount)`. Throws when the card cannot take it; the caller gives back what it spent.
 *
 * @param {(flavor: string, total: number, formula: string) => string} [opts.cardFlavor]  stonetop.js#_shiftRollCardFlavor
 */
export async function writeDamageBoost(message, { damage, amount, flag, record, addTerm, cardFlavor = f => f, scope = SYSTEM_ID }) {
	if (damage) {
		const results = damage.results.map(r => ({ ...r, raw: (Number(r.raw) || 0) + amount }));
		await message.update({ flags: { [scope]: { damage: { results }, [flag]: record } } });
	} else {
		await writeCardRoll(message, roll => addTerm(roll, amount), {
			cardFlavor: (flavor, total, formula) => cardFlavor(flavor, Math.max(0, total), formula),
		}, { flags: { [scope]: { [flag]: record } } });
	}
}

/**
 * The rendered card, for a boost to draw on: its root, its kind, and the row its button goes in (the results
 * card's actions, a plain card's buttons). Null for anything but a damage card.
 */
export function damageBoostCard(message, html, scope = SYSTEM_ID) {
	const root = html?.[0] ?? html;
	if (!root?.querySelector) return null;
	const kind = damageCardKind(message, scope);
	if (!kind) return null;
	const row = root.querySelector(kind === "results" ? ".stonetop-attack-actions" : ".stonetop-card-buttons");
	return { root, kind, row };
}

/**
 * Name a boost the card took, in a note above its buttons (`noteClass`, words `text`), drawn every render.
 * A results card's totals are redrawn from its rows, since the card's own HTML was written before the boost;
 * with a fight's +N on the card, attack-flow.js#wireDamageSeed redraws them from the same rows.
 */
export function drawDamageBoostNote(message, { root, kind, row }, { noteClass, text, scope = SYSTEM_ID }) {
	const damage = kind === "results" ? message.getFlag(scope, "damage") : null;
	if (damage && !damage.seed) {
		for (const rowEl of root.querySelectorAll(".stonetop-damage-row[data-uuid]")) {
			const result = damage.results.find(r => r.uuid === rowEl.dataset.uuid);
			const number = rowEl.querySelector(".stonetop-roll-result-number");
			if (result && number) number.textContent = String(Math.max(0, Number(result.raw) || 0));
		}
	}
	root.querySelectorAll(`.${noteClass}`).forEach(el => el.remove());
	const note = `<p class="${noteClass}">${escHtml(text)}</p>`;
	if (row) row.insertAdjacentHTML("beforebegin", note);
	else root.querySelector(".card-content, .cell--chat")?.insertAdjacentHTML("beforeend", note);
}

/**
 * The boost's button, in the card's row. `tip` is plain text (it can name what a player typed), so it goes in
 * `data-tooltip-text`: core draws a plain `data-tooltip` as HTML. `press` resolves to whether the boost
 * landed; when it did not, `refused` is said and the button comes back.
 */
export function appendDamageBoostButton({ root, kind, row }, { className, label, tip, press, refused, failure }) {
	const button = (root.ownerDocument ?? globalThis.document).createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = label;
	button.dataset.tooltipText = tip;
	button.dataset.tooltipDirection = "UP";
	button.addEventListener("click", async () => {
		if (button.disabled) return;
		button.disabled = true;
		try {
			if (!(await press())) {
				globalThis.ui?.notifications?.warn?.(refused);
				button.disabled = false;
			}
		} catch (err) {
			console.error(`Stonetop | ${failure}`, err);
			button.disabled = false;
		}
	});
	row.appendChild(button);
	if (kind === "plain") row.style.display = "flex";
	return button;
}
