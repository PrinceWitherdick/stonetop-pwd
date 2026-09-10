// A TICKED OPTION THAT OWES SOMETHING, AND THE BUTTON IT GROWS.
//
// Two moves' worth of bullets work this way and there will be more. A Forage option that says "gain
// 1d4+1 uses of provisions" grows a die to throw for it; an option that says "suffer painful burns
// (2d4 damage, ignores armor)" grows a button that rolls onto the shared damage card. The bullet is
// the same shape either way: text somebody wrote in a move, a checkbox beside it, and a thing that
// is owed once the box is ticked.
//
// This was written out twice before it was written once, and the duplication had already leaked into
// the stylesheet, where the two button classes had to be `:is()`-grouped. The parts worth having in
// one place are the ones that are quietly easy to get wrong:
//
//   • OURS COME OUT BEFORE THE ROW IS READ. The button says "Roll 2d4 damage" and the readout says
//     "6 damage", and on a re-render both are lines the option reader would happily match. The
//     option's own words come first in the row and would win on word order alone -- but "would win"
//     is a coincidence to lean a damage roll on.
//   • THE LATCH IS ON THE MESSAGE, not on the element. Stamped as a flag keyed by the checkbox's
//     index, so every client shows the same result and two players cannot press it twice.
//   • THE CHANGE LISTENER IS BOUND ONCE PER ELEMENT. A message re-renders whenever its flag is
//     written and Foundry may patch the log in place, so an unguarded binding stacks up a listener
//     per render.
//   • THE BUTTON IS HIDDEN, NOT ABSENT, while its option is unticked -- so ticking a box shows it
//     without a re-render.
//
// What does NOT belong here is the rule about WHICH bullets qualify. That is read off each option's
// own printed words by the caller's own reader, so a move a world wrote gets the same treatment
// with nobody wiring it up by hand.

import { SYSTEM_ID } from "../system-id.js";

/**
 * Is this element part of the card being wired?
 *
 * The chat log holds every message at once and a render hook is handed the whole of it in some
 * paths, so an unfiltered `querySelectorAll` would wire another card's bullets onto this message.
 * An element with no `data-message-id` above it is taken as ours: that is the single-card render,
 * where the wrapper has not been stamped yet.
 */
export function belongsToMessage(el, message) {
	const owner = el.closest("[data-message-id]");
	return !owner || owner.dataset.messageId === message.id;
}

/**
 * Wire every ticked-option button on one chat card.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html  The rendered card.
 * @param {object} spec
 * @param {string} spec.flagKey       Message flag holding what has already been paid out, by index.
 * @param {string} spec.wiredKey      `dataset` key marking a row whose checkbox is already bound.
 * @param {string} spec.buttonClass   Class for the button this adds.
 * @param {string} spec.readoutClass  Class for the static readout that replaces it.
 * @param {(text: string) => object|null} spec.read
 *        What this option owes, read off its own words. Null for a bullet that owes nothing.
 * @param {(pick: object) => string} spec.icon    Font Awesome classes for the button's glyph.
 * @param {(pick: object) => string} spec.label   The button's words. It NAMES ITS OUTCOME.
 * @param {(paid: object) => HTMLElement} spec.readout  The static readout, from the stamped record.
 * @param {(btn: HTMLElement, index: string, pick: object) => any} spec.onPress
 */
export function wirePickedOptionButton(message, html, spec) {
	const { flagKey, wiredKey, buttonClass, readoutClass, read, icon, label, readout, onPress } = spec;

	const items = [...html.querySelectorAll(".stonetop-picklist-item")]
		.filter(item => belongsToMessage(item, message));
	if (!items.length) return;

	const done = message.getFlag(SYSTEM_ID, flagKey) ?? {};

	for (const item of items) {
		const box = item.querySelector(".stonetop-picklist-check");
		// Ours out first, then read; see the head of this file.
		item.querySelectorAll(`.${buttonClass}, .${readoutClass}`).forEach(el => el.remove());
		const pick = read(item.textContent);
		if (!box || !pick) continue;
		const index = box.dataset.index;

		// Already paid out: the card carries the result, not a second chance at it.
		const paid = done[index];
		if (paid) {
			item.appendChild(readout(paid));
			continue;
		}

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = buttonClass;
		const glyph = document.createElement("i");
		glyph.className = icon(pick);
		btn.append(glyph, label(pick));
		btn.hidden = !box.checked;
		item.appendChild(btn);

		if (item.dataset[wiredKey] !== "1") {
			item.dataset[wiredKey] = "1";
			box.addEventListener("change", () => {
				const live = item.querySelector(`.${buttonClass}`);
				if (live) live.hidden = !box.checked;
			});
		}

		btn.addEventListener("click", () => onPress(btn, index, pick));
	}
}
