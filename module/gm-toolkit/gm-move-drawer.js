// "Give me one" — the whole of what pressing a GM Moves randomizer does, in one place.
//
// The PICK and the CARD are random-gm-move.js's (randomGmMove / postGmMove); this is the beat
// order around them, which is the part that was being written out once per surface:
//
//   1. draw a move from the section, avoiding the last one this section gave;
//   2. REMEMBER IT AT THE DRAW, not after the card posts;
//   3. run the light down the visible rows and land it on the one drawn;
//   4. whisper the card — and only then.
//
// Two surfaces press this button: the GM Toolkit sheet's three move lists, and the expedition
// walkthrough's exploration rail. They differ in exactly three selectors and a speaker, and in
// nothing else — so they hold one of these each and pass those in, rather than each keeping its
// own copy of the order above and its own pair of state fields.
//
// A CLASS, not a closure over the host. The drawer outlives every click (it is the memory of what
// was drawn), and building it out of a captured `this` would pin a whole sheet — its context, its
// element, its cached actor data — alive for as long as the drawer. It copies the four small
// things it needs instead.
//
// WHY THE ORDER MATTERS, in both surfaces:
//
//   Remembering at the DRAW is what makes a second click always move on. Remembering after the
//   card would leave a walk still in flight with its move unrecorded, so the click that
//   interrupts it is free to land on the very same move.
//
//   The whisper WAITS for the light. A card that posted at the click would answer the question
//   the walk is still in the middle of asking, and a GM reading chat would have no reason to
//   watch the list at all.
//
//   One landing, one card. A walk that a later click cancels resolves false and posts NOTHING —
//   otherwise a GM who pressed twice gets two whispers for one light.
import { randomGmMove, postGmMove } from "./random-gm-move.js";
import { flashHighlight, spinHighlight } from "../utils/flash-highlight.js";

export class GmMoveDrawer {
	/**
	 * @param {object} sel
	 * @param {string} sel.scope  Ancestor the light is confined to — the tab or the rail. Every
	 *                            other row inside it is doused, so only ever one is lit.
	 * @param {string} sel.row    The rows the light walks.
	 * @param {string} [sel.group]  Ancestor the ROWS are gathered from, when that is narrower than
	 *                            the scope. The toolkit stacks three lists in one tab and must
	 *                            walk only the pressed section's; a rail with one list omits it.
	 */
	constructor({ scope, row, group = scope }) {
		this._scopeSel = scope;
		this._rowSel   = row;
		this._groupSel = group;
		// Last move drawn per section key. Deliberately NOT persisted: it is one click's worth of
		// memory, and a "don't repeat" that survived a reload would be a stored preference nobody
		// asked for. A surface with a single list simply has one key.
		this._last = {};
		// The walk currently running, if any, so a second click can abandon the first.
		this._spin = null;
	}

	/**
	 * Press the die on `button` (which carries `data-section`): draw, walk the light, whisper.
	 *
	 * @param   {object} button
	 * @param   {object} [options]
	 * @param   {object} [options.speaker]  Chat speaker for the whisper — the host's, since the
	 *                                      toolkit speaks as its actor and a dialog does not.
	 * @returns {Promise<object|null>}  The move drawn, or null when nothing was drawn or a later
	 *                                  click superseded this one.
	 */
	async draw(button, { speaker } = {}) {
		const key  = button?.dataset?.section;
		const move = randomGmMove(key, { exclude: this._last[key] ?? "" });
		if (!move) return null;
		this._last[key] = move.name;
		if (!await this.spinTo(button, move.name)) return null;
		await postGmMove(key, move, { speaker });
		return move;
	}

	/**
	 * Run the light down the rows and land it on the one named (utils/flash-highlight.js).
	 *
	 * Matched on `data-move` by comparing the dataset rather than by building an attribute
	 * SELECTOR: these names are printed prose ("Offer an opportunity (with or without a cost)",
	 * "Provide a choice of paths"), and interpolating one into a selector would need `CSS.escape`
	 * to survive the brackets, the slash and the punctuation — a scan of a dozen <li> is cheaper
	 * than that is careful.
	 *
	 * No check for a hidden list, and none is needed: a folded list is `display: none`, which
	 * `spinHighlight`'s own visibility check catches — and which also puts the die out of reach,
	 * so the question cannot arise from a click. A walk left running by a CLOSE is not cancelled
	 * either: its timers only touch detached nodes, and the card the GM asked for still arrives.
	 *
	 * @returns {Promise<boolean>}  false if a later click superseded this one, which is the
	 *          caller's cue to post nothing. True when there was no walk to make at all (a row not
	 *          on the page, a folded section, motion turned off) — the whisper must still go out.
	 */
	async spinTo(button, name) {
		const scope  = button.closest(this._scopeSel);
		const rows   = [...(button.closest(this._groupSel)?.querySelectorAll(this._rowSel) ?? [])];
		const target = rows.findIndex(li => li.dataset.move === name);
		if (target < 0) return true;

		this._spin?.cancel();
		const spin = spinHighlight(rows, target, { scope });
		this._spin = spin;

		if (!await spin.done) return false;
		flashHighlight(rows[target], { scope });
		return true;
	}
}
