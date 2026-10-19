/**
 * Two moves whose whole mechanical offer is a price paid to shrug something off, used from their posted card
 * (StonetopCharacterSheet.js's MOVE_USE_EFFECTS: posting the text IS using the move):
 *
 *  - IRON WILL (the Would-Be Hero, Book I p.138): "When you are subject to mind control or magic that affects
 *    your feelings, you can take 1d4 damage (ignoring armor) to disregard its influence." Asked, since "can";
 *    taken, the 1d4 goes through the option-damage card at the hero themselves (combat/attack-flow.js
 *    #rollOptionDamage), Apply and all.
 *  - UNFETTERED (the Heavy, p.115): "When you are subject to physical or mental restraint, you may mark a
 *    debility to immediately break free of that restraint." The shared pick-one window
 *    (steading/steading-debilities.js#openDebilityPicker) over the debilities a MOVE may mark
 *    (StonetopCharacter#debilityMarkChoices, Auspicious Birth's circle among them), then marked and said.
 *    The same window (pickDebilityToMark) a ticked "(mark a debility)" option opens (option-debility.js).
 *
 * Whether the hero is under such magic, or the Heavy restrained, is the table's: nothing is applied unasked.
 */

import { ownsLearnedMoveNamed } from "./owns-move.js";
import { askWithButtons } from "../../utils/ask-with-buttons.js";
import { contentElement } from "../../utils/dialogv2-content.js";
import { openDebilityPicker } from "../steading/steading-debilities.js";
import { postMoveNote } from "../../utils/chat.js";
import { escHtml } from "../../utils/strings.js";
import { format, localize } from "../../utils/i18n.js";

export const IRON_WILL = "Iron Will";
export const UNFETTERED = "Unfettered";

/** Iron Will's price, in the option-damage card's terms: the hero's own 1d4, no armor in the way. */
export const IRON_WILL_DAMAGE = Object.freeze({ formula: "1d4", self: true, ignoresArmor: true });

const KEY = "stonetop.willAndRestraint";

/**
 * Iron Will: ask, and on a yes roll the 1d4 at the hero. Whether it was taken.
 *
 * @param {Actor} actor
 * @param {{ask?: Function, roll?: Function}} [deps]  `roll` stands in for attack-flow.js#rollOptionDamage
 */
export async function ironWill(actor, { ask = askWithButtons, roll = null } = {}) {
	if (actor?.type !== "character" || !ownsLearnedMoveNamed(actor, IRON_WILL)) return false;
	const take = await ask({
		title: IRON_WILL,
		content: contentElement(`<p>${escHtml(localize(`${KEY}.ironWill.ask`))}</p>`),
		buttons: [
			{ key: "take", label: localize(`${KEY}.ironWill.take`), icon: "fa-brain", value: true },
			{ key: "skip", label: localize(`${KEY}.notNow`), value: false },
		],
	});
	if (take !== true) return false;
	// Loaded when used: attack-flow.js is the whole fight, and the sheet's other imports of it stay its own.
	const rollIt = roll ?? (await import("../../combat/attack-flow.js")).rollOptionDamage;
	await rollIt(actor, { move: IRON_WILL, damage: { ...IRON_WILL_DAMAGE } });
	return true;
}

/**
 * The window a move that has its character mark a debility opens: pick one of the debilities a MOVE may mark
 * (StonetopCharacter#debilityMarkChoices, Auspicious Birth's circle among them) still unmarked; picked, it is
 * marked for `moveName` and the table told. Closing the window marks nothing. Whether the window was opened
 * (the picker is not awaited, as Rites of the Land's is not: a window closed by its corner answers nobody).
 * Unfettered's, and a ticked "(mark a debility)" option's (option-debility.js: Mighty Thews' toll).
 *
 * `strings` is the i18n subtree holding the move's `ask`, `none`, `apply`, `applyFor` ({debility}),
 * `choices` and `note` ({name}, {debility}). `latch(picked, mark)` wraps the marking, for a caller that
 * has to record it somewhere first (a chat card's once-only latch); `mark()` answers whether it marked.
 *
 * @param {Actor} actor
 * @param {{moveName: string, strings: string, latch?: Function}} spec
 * @param {{pick?: Function, note?: Function}} [deps]  `pick` stands in for openDebilityPicker
 */
export function pickDebilityToMark(actor, { moveName, strings, latch = null }, { pick = openDebilityPicker, note = postMoveNote } = {}) {
	const character = actor?.typedActor;
	if (actor?.type !== "character" || !character) return false;
	const open = (character.debilityMarkChoices ?? []).filter(d => !d.marked);
	if (!open.length) {
		globalThis.ui?.notifications?.info?.(localize(`${strings}.none`));
		return false;
	}
	pick({
		title: moveName,
		introHtml: `<p>${escHtml(localize(`${strings}.ask`))}</p>`,
		marked: open.map(d => ({ id: d.key, label: d.name, detail: d.description ?? "" })),
		applyLabel: localize(`${strings}.apply`),
		applyLabelFor: d => format(`${strings}.applyFor`, { debility: d.label }),
		choicesLabel: localize(`${strings}.choices`),
		buttons: { cancel: { label: localize(`${KEY}.notNow`) } },
		onApply: async picked => {
			const mark = async () => {
				const marked = await character.markDebility(picked.id, { moveName });
				if (marked) await note(actor, moveName, format(`${strings}.note`, { name: actor.name, debility: picked.label }));
				return marked;
			};
			await (latch ? latch(picked, mark) : mark());
		},
	});
	return true;
}

/**
 * Unfettered: open the window to pick a debility to mark; picked, it is marked and the table told they broke
 * free (pickDebilityToMark).
 *
 * @param {Actor} actor
 * @param {{pick?: Function, note?: Function}} [deps]  `pick` stands in for openDebilityPicker
 */
export function unfettered(actor, deps = {}) {
	if (actor?.type !== "character" || !ownsLearnedMoveNamed(actor, UNFETTERED)) return false;
	return pickDebilityToMark(actor, { moveName: UNFETTERED, strings: `${KEY}.unfettered` }, deps);
}
