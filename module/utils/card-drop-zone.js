// Wire an element as a drop zone for journal-dragged Stonetop cards.
//
// Two tabs take these drops today — the steading's Improvements tab (a "Steading Improvement"
// card) and the GM Toolkit's Threats tab (a "Threat" card) — and both want the same three
// things: the shared drag-over highlight while a card is over them, a payload filtered to one
// drag type, and the drop stopped before it reaches Foundry's own handler.
//
// This lived as a closure inside the steading sheet's activateListeners until the Threats tab
// moved onto the GM Toolkit and needed it from another file. The `dragleave` containment test
// is the part worth having in one place: `dragleave` fires when the pointer crosses onto a
// CHILD element too, so a naive handler flickers the highlight off over every card in the tab.
import { getDragEventData } from "./foundry-compat.js";

/**
 * @param {HTMLElement|null} el        The drop zone; a null element is a no-op, so callers can
 *                                    pass a querySelector result straight in.
 * @param {string} dragType           The `type` a dropped payload must carry.
 * @param {(data: object) => any} onDrop  Handed the whole payload.
 */
export function wireCardDropZone(el, dragType, onDrop) {
	if (!el) return;
	// A neutral class, not the Improvements tab's own: this helper serves every card drop zone,
	// and the rule behind it (styles/stonetop.css) is unscoped for the same reason.
	const setDrag = on => el.classList.toggle("stonetop-card-drag-over", on);
	el.addEventListener("dragover", (ev) => {
		ev.preventDefault();
		ev.dataTransfer.dropEffect = "copy";
		setDrag(true);
	});
	el.addEventListener("dragleave", (ev) => {
		if (!el.contains(ev.relatedTarget)) setDrag(false);
	});
	el.addEventListener("drop", async (ev) => {
		// FIRST, and before the payload is even looked at: the drag is over either way, and no
		// `dragleave` follows a `drop` to clean up after us. Dropping something this zone does
		// not take (a sidebar Actor, a compendium entry) used to return below with the
		// highlight still on, leaving the tab outlined until an unrelated drag happened to
		// cross it.
		setDrag(false);
		const data = getDragEventData(ev);
		if (data?.type !== dragType) return;
		ev.preventDefault();
		ev.stopPropagation();
		await onDrop(data);
	});
}
