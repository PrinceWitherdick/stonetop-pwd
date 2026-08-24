// Wire an element as a drop zone.
//
// Three tabs take drops through this: the steading's Improvements tab (a "Steading Improvement"
// card), the GM Toolkit's Threats tab (a "Threat" card), and the GM Toolkit's Encounters tab
// (whole DOCUMENTS, core's own `{type, uuid}` payload). All three want the same four things: the
// shared drag-over highlight while something is over them, a payload filtered to what the tab
// takes, the drop stopped before it reaches Foundry's own handler, and the highlight cleared
// afterwards either way.
//
// This lived as a closure inside the steading sheet's activateListeners until the Threats tab
// moved onto the GM Toolkit and needed it from another file. The `dragleave` containment test is
// the part worth having in one place: `dragleave` fires when the pointer crosses onto a CHILD
// element too, so a naive handler flickers the highlight off over every card in the tab.
import { getDragEventData } from "./foundry-compat.js";
import { error } from "./logger.js";

/**
 * The operation to answer a drag with, NEGOTIATED against what the source said it allows.
 *
 * Not a formality, and answering "copy" unconditionally is not the safe default it reads as. The
 * HTML drag model intersects the source's `effectAllowed` with the target's `dropEffect` and
 * resolves an incompatible pair to NONE — at which point the browser converts the drop into a
 * `dragleave` and never fires `drop` at all. A source declaring `effectAllowed = "move"` (which is
 * the honest thing for a reorder to say, and what the Encounters tab's grip says) met a hard-coded
 * "copy" and the whole gesture died silently: no drop, no error, the row snapping back.
 *
 * `copy` stays the preference wherever the source permits it, because that is what these zones do
 * — a dropped document is collected, not taken away from wherever it came from.
 */
function negotiatedDropEffect(dataTransfer) {
	const allowed = String(dataTransfer?.effectAllowed ?? "").toLowerCase();
	// An unset value, "all" and "uninitialized" all mean "the source does not mind", so the zone
	// states its own preference. Everything else is a filter this has to answer inside.
	if (!allowed || allowed === "all" || allowed === "uninitialized") return "copy";
	for (const effect of ["copy", "move", "link"]) if (allowed.includes(effect)) return effect;
	return "none";
}

/**
 * The general form. Both zones below are this with a different `accepts`.
 *
 * WHAT A ZONE DOES NOT WANT IS LEFT UNCANCELLED, always, and that is the one rule worth stating:
 * an unrecognised drop belongs to somebody else — core's own handler, or a note box the GM was
 * really aiming at — and claiming it would be this zone answering for a gesture that was not made
 * to it. What differs between the two callers is only where the line is drawn.
 *
 * `onDrop` is handed the TARGET ELEMENT alongside the payload, because a zone the size of a whole
 * tab routes by where the drop landed as much as by what was dropped: on the Encounters tab the
 * same event means "add to this encounter", "move this row" or "make a new encounter" depending on
 * what is under the pointer. The card zones ignore it.
 *
 * @param {HTMLElement|null} el  The drop zone; a null element is a no-op, so callers can pass a
 *                               querySelector result straight in.
 * @param {object} options
 * @param {(data: object) => boolean} options.accepts  Whether this payload is ours to claim.
 * @param {(data: object, target: HTMLElement) => any} options.onDrop
 */
function wireDropZone(el, { accepts, onDrop }) {
	if (!el) return;
	// A neutral class, not any one tab's own: this helper serves every drop zone in the system, and
	// the rule behind it (styles/stonetop.css) is unscoped for the same reason.
	const setDrag = on => el.classList.toggle("stonetop-card-drag-over", on);

	el.addEventListener("dragover", (ev) => {
		// Mid-drag the payload is PROTECTED and `getData` answers "", so there is nothing here to
		// filter on but `types`. Permitting the drop and then declining it below is deliberate: it
		// is what leaves a plain text drag into one of a zone's own note boxes working.
		//
		// Read through `Array.from` rather than off `.includes`, because `DataTransfer#types` is a
		// plain array in current engines and was a `DOMStringList` — which has `contains` and no
		// `includes` — in older ones. An optional call on the missing method would answer
		// undefined, decline the dragover, and take every drop on the zone down with it.
		if (!Array.from(ev.dataTransfer?.types ?? []).includes("text/plain")) return;
		ev.preventDefault();
		ev.dataTransfer.dropEffect = negotiatedDropEffect(ev.dataTransfer);
		setDrag(true);
	});

	// The containment test: `dragleave` fires when the pointer crosses onto a CHILD too, so a
	// naive handler flickers the highlight off over every card in the tab.
	el.addEventListener("dragleave", (ev) => {
		if (!el.contains(ev.relatedTarget)) setDrag(false);
	});

	el.addEventListener("drop", (ev) => {
		// FIRST, and before the payload is even looked at: the drag is over either way, and no
		// `dragleave` follows a `drop` to clean up after us. Dropping something a zone does not take
		// used to return below with the highlight still on, leaving the tab outlined until an
		// unrelated drag happened to cross it.
		setDrag(false);
		const data = getDragEventData(ev);
		if (!accepts(data)) return;
		// SYNCHRONOUS, before `onDrop` is even called, let alone awaited: a cancel that happens
		// after an await has already lost the race with the browser's default handling.
		ev.preventDefault();
		ev.stopPropagation();
		// Deliberately not awaited, and the handler is not async: everything above this line has
		// already run, so there is nothing left for a rejection to undo. The callers report their
		// own failures (see `_mutateEncounters`), and an unhandled one here would be a second
		// report of the same thing.
		Promise.resolve(onDrop(data, ev.target)).catch(err => {
			error("a drop failed", err);
		});
	});
}

/**
 * A zone for journal-dragged Stonetop cards of ONE type.
 *
 * Everything else goes through uncancelled, which is right for a tab of cards: a sidebar Actor or
 * a compendium entry dropped here belongs to core, and core should still see it.
 *
 * @param {HTMLElement|null} el
 * @param {string} dragType           The `type` a dropped payload must carry.
 * @param {(data: object) => any} onDrop  Handed the whole payload.
 */
export function wireCardDropZone(el, dragType, onDrop) {
	wireDropZone(el, { accepts: data => data?.type === dragType, onDrop });
}

/**
 * A zone for whole DOCUMENTS — core's own `{type, uuid}` payload, the thing `Document#toDragData`
 * puts on the wire from the sidebar, a compendium, or another sheet.
 *
 * It claims EVERY document drop, whether or not the tab collects that kind, which is the one place
 * it differs from the card zone. The zone it is written for (the GM Toolkit's Encounters tab) is a
 * field of text inputs, and on Gecko an uncancelled document drop pastes its payload as raw JSON
 * into whichever input is under the pointer — where that tab's own change handlers would then SAVE
 * it. Chromium masks the bug entirely, which is why it has to be designed for rather than
 * discovered.
 *
 * A payload with no `type` at all is not a document drag — a text selection, a file, another
 * application's data — and is the one thing still let through, because it is the one a GM may
 * really have aimed at a note box.
 *
 * @param {HTMLElement|null} el
 * @param {(data: object, target: HTMLElement) => any} onDrop  Handed the payload and the element
 *                               the drop landed on.
 */
export function wireDocumentDropZone(el, onDrop) {
	wireDropZone(el, { accepts: data => !!data?.type, onDrop });
}
