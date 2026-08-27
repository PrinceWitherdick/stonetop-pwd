import { pickCountLabel } from "./move-picks.js";

/**
 * The running tally over a list of options: "0/1 options selected", "2/3 options selected".
 *
 * A move that offers a choice says how many you may take ONCE, in prose — the lead-in above its
 * printed list, or a roll card's result line — and how many you have taken is nowhere at all
 * until you count the ticks yourself. This puts both numbers over the boxes.
 *
 * ONE implementation, because the same list shows up on two surfaces: a chat card (a posted
 * move's printed list, a roll card's own checklist) and the guided-move dialog an arcanum's
 * mystery opens. They are different markup with different owners, and the readout is the part
 * that must read identically on both, so only the readout lives here — each caller still finds
 * its own list and knows its own cap.
 *
 * DERIVED, never stored. The tally is repainted from the boxes every time one changes, and it is
 * never written into a chat message's content: a number baked into a card would be wrong the
 * moment anyone ticked anything. That is also why an existing readout is REUSED rather than
 * appended to — nothing persists one today, but a path that ever did would otherwise stack a
 * second one above the first on every render.
 */

/** The readout's class, shared by both surfaces so one CSS rule per home covers it. */
export const PICK_TALLY_CLASS = "stonetop-picklist-count";

/** Marks a list whose change listener is already bound, so a re-render cannot double it. */
const WIRED = "pickTallyWired";

/**
 * Paint (or repaint) the tally sitting immediately before `listEl`, creating it on first call.
 *
 * @param {Element|null} listEl  The element holding the option checkboxes.
 * @param {number|null} limit  How many the move allows; falsy leaves the tally without a
 *   denominator, which is the honest thing to show when nothing read a count.
 * @returns {Element|null} The readout, or null when there was nothing to count.
 */
export function paintPickTally(listEl, limit) {
	if (!listEl) return null;
	const boxes = [...listEl.querySelectorAll('input[type="checkbox"]')];
	if (!boxes.length) return null;

	let readout = listEl.previousElementSibling;
	if (!readout?.classList?.contains(PICK_TALLY_CLASS)) {
		// `ownerDocument`, not the global: this runs inside a dialog's detached form as well as
		// in the chat log, and a helper that reaches for `document` cannot be tested off-DOM.
		readout = listEl.ownerDocument.createElement("div");
		readout.className = PICK_TALLY_CLASS;
		listEl.parentNode?.insertBefore(readout, listEl);
	}

	const max    = Math.trunc(Number(limit)) || 0;
	const picked = boxes.filter(b => b.checked).length;
	readout.textContent = pickCountLabel(picked, max);
	// The one state worth saying twice: the list is full.
	readout.classList.toggle("is-full", max > 0 && picked >= max);
	return readout;
}

/**
 * Ticking past what the move allows releases the EARLIEST tick rather than refusing the new one.
 * Returns the boxes it let go, so a caller can drop whatever styling it hangs on a picked row.
 *
 * This is NOT permission to exceed the count — it never leaves the list over the cap. It is the
 * answer to what a click past the cap MEANS. The click is always honoured, which is what makes a
 * "pick 1" behave like the radio a reader expects: tick the second option and the first lets go.
 * Refusing instead would leave a player clicking a box that does nothing, with no way to change
 * their mind but to hunt for the one they already ticked.
 *
 * It also matters that the cap is READ FROM PROSE (utils/move-picks.js) rather than authored. A
 * reader that ever misjudged a sentence would, under a refusal, hard-block a player from taking
 * what their move grants; releasing can only ever change WHICH options are held, never how many
 * the move offers. The reader is timid for the same reason, and the one shipped move whose rules
 * do let you go over — the Ghost's Disembodied, "for each additional option you pick, lose 1d4
 * HP" — is vetoed there and reaches this with no cap at all.
 */
export function releaseOverLimit(listEl, justChecked, limit) {
	const max = Math.trunc(Number(limit)) || 0;
	if (!listEl || !max) return [];
	// The box just clicked is excluded from the candidates BEFORE the count, not skipped inside
	// the loop: skipping it there would spare it and release one fewer than needed, leaving the
	// list one over its limit whenever the new tick was also the earliest one.
	const others = [...listEl.querySelectorAll('input[type="checkbox"]')]
		.filter(b => b.checked && b !== justChecked);
	const release = others.slice(0, Math.max(0, others.length - (max - 1)));
	for (const box of release) box.checked = false;
	return release;
}

/**
 * Paint the tally and keep it painted, from ONE listener on the list itself rather than one per
 * box — a change event bubbles, so the count is right however many boxes there are and whatever
 * else (an over-limit release, a restored tick) changed them.
 *
 * `enforce` adds the release above to that same listener, for a list whose boxes have no handler
 * of their own. A chat card's do (they persist the tick to the message flag), so that surface
 * releases from its own handler and leaves this off.
 */
export function wirePickTally(listEl, limit, { enforce = false } = {}) {
	const readout = paintPickTally(listEl, limit);
	if (!readout || listEl.dataset[WIRED] === "1") return readout;
	listEl.dataset[WIRED] = "1";
	listEl.addEventListener("change", (ev) => {
		// After the release, not before: a tick that pushed the list over its cap has just let an
		// earlier one go, and a tally painted first would read one too many.
		if (enforce && ev?.target?.checked) releaseOverLimit(listEl, ev.target, limit);
		paintPickTally(listEl, limit);
	});
	return readout;
}
