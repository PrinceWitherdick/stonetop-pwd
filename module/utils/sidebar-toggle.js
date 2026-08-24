// The handle that folds a moves sidebar away, for the three surfaces that wear one: the
// character sheet's Moves sidebar, the steading's classic-layout sidebar, and the expedition
// walkthrough's exploration rail.
//
// BY CLASS, NEVER BY RE-RENDERING. Toggling `is-collapsed` lets the content beside it reclaim
// the freed width with no flicker, and on the walkthrough a render would rebuild the route
// step's map panel — which browses the art folder and measures an image — to move one column.
// Because nothing re-renders, each host persists the new state itself.
//
// THE PAIR IS THE POINT. `aria-expanded` and `aria-label` have to move with the class, and they
// have to move TOGETHER: a handle that flips the class and forgets the label leaves a screen
// reader being told the panel is open while it is shut, with nothing on screen to say so. That
// pairing was written out three times, and an aria fix applied to one copy left two wrong — so
// it is written here once and the hosts supply only their own two words and their own storage.

/**
 * Wire the collapse handle inside `html`.
 *
 * Matches nothing when the layout has no sidebar (the steading's modern layout, for one), which
 * is why every host can bind it unconditionally.
 *
 * @param {object} html                jQuery-wrapped root, as activateListeners receives it.
 * @param {object} labels
 * @param {string} labels.expandLabel    `aria-label` once collapsed — what clicking will do.
 * @param {string} labels.collapseLabel  `aria-label` while open.
 * @param {(collapsed: boolean) => void} labels.persist  Store the new state; nothing re-renders.
 */
export function wireSidebarToggle(html, { expandLabel, collapseLabel, persist }) {
	html.find(".stonetop-sidebar-toggle").on("click", ev => {
		const sidebar = ev.currentTarget.closest(".stonetop-moves-sidebar");
		if (!sidebar) return;
		const collapsed = sidebar.classList.toggle("is-collapsed");
		ev.currentTarget.setAttribute("aria-expanded", String(!collapsed));
		ev.currentTarget.setAttribute("aria-label", collapsed ? expandLabel : collapseLabel);
		persist(collapsed);
	});
}
