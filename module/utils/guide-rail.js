// Shared DOM sync for the left-rail "stepped sheet" chrome used by the welcome guide
// (WelcomeDialog), the Make-a-Monster worksheet (CreateMonsterDialog), the arcanum
// editor (StonetopArcanumSheet), the wound editor (WoundDialog) and the custom-move
// author (CustomMoveDialog). These panels switch WITHOUT re-rendering so unsaved form
// state and live prose-mirror editors survive the switch, which means each sheet
// hand-syncs the rail in the DOM. Everything that behaves the same across those sheets
// lives here so the shared `.stonetop-guide-*` conventions can't drift; a caller opts
// into each part by passing its selector, and omitting one leaves that part alone.
//
// @param {HTMLElement} root  the sheet's root element (a raw node, not jQuery).
// @param {object} opts
// @param {string} opts.key             the active section's key.
// @param {string} opts.dataKey         dataset property naming a tab/section (e.g. "tab", "arcTab").
// @param {string} opts.tabSelector     selector for the rail's clickable tab buttons.
// @param {string} opts.sectionSelector selector for the switchable panels.
// @param {string} [opts.iconSelector]  selector for the banner icon <i>, if the sheet has one.
// @param {string} [opts.icon]          FA glyph class for the active section (e.g. "fa-book").
// @param {string} [opts.iconExtraClass] the sheet's own banner-icon class, kept beside the shared one.
// @param {string} [opts.mainSelector]  selector for the scroll column to reset to its top.
// @param {string} [opts.titleSelector] selector for the banner's title line.
// @param {string} [opts.title]         the active section's title, written into that line.
// @param {string} [opts.countSelector] selector for the banner's "N / M" readout.
// @param {number} [opts.index]         zero-based position of the active section in the rail.
// @param {number} [opts.total]         how many sections the rail holds.
// @param {string} [opts.backSelector]  selector for the Back button, disabled at the first section.
// @param {string} [opts.nextSelector]  selector for the Next button, disabled at the last.
export function applyGuideRail(root, {
	key, dataKey, tabSelector, sectionSelector, iconSelector, icon, iconExtraClass, mainSelector,
	titleSelector, title, countSelector, index, total, backSelector, nextSelector,
} = {}) {
	if (!root) return;

	root.querySelectorAll(tabSelector).forEach(btn => {
		const on = btn.dataset[dataKey] === key;
		btn.closest(".stonetop-guide-toc-item")?.classList.toggle("is-active", on);
		if (on) btn.setAttribute("aria-current", "true"); else btn.removeAttribute("aria-current");
	});
	if (sectionSelector) root.querySelectorAll(sectionSelector).forEach(sec => { sec.hidden = sec.dataset[dataKey] !== key; });

	if (iconSelector) {
		const iconEl = root.querySelector(iconSelector);
		if (iconEl) iconEl.className = `fas ${icon} stonetop-guide-banner-icon ${iconExtraClass}`;
	}
	// A tall previous panel can leave the column scrolled down; reset to the top.
	if (mainSelector) {
		const main = root.querySelector(mainSelector);
		if (main) main.scrollTop = 0;
	}

	if (titleSelector && title !== undefined) {
		const titleEl = root.querySelector(titleSelector);
		if (titleEl) titleEl.textContent = title;
	}
	if (countSelector && Number.isFinite(index) && Number.isFinite(total)) {
		const countEl = root.querySelector(countSelector);
		if (countEl) countEl.textContent = `${index + 1} / ${total}`;
	}
	// Back/Next go dead at the ends of the rail.
	if (backSelector && Number.isFinite(index)) {
		const back = root.querySelector(backSelector);
		if (back) back.disabled = index <= 0;
	}
	if (nextSelector && Number.isFinite(index) && Number.isFinite(total)) {
		const next = root.querySelector(nextSelector);
		if (next) next.disabled = index >= total - 1;
	}
}

/**
 * The section one step along the rail, or undefined at either end.
 *
 * Every rail dialog walks its own SECTIONS array by index for Back/Next; sharing the
 * arithmetic is what keeps the buttons, the rail and the banner counting the same way.
 *
 * @param {Array<{key: string}>} sections the rail's sections, in rendered order.
 * @param {string} activeKey  the section currently showing.
 * @param {number} delta      -1 for Back, +1 for Next.
 */
export function guideRailStep(sections, activeKey, delta) {
	const from = sections.findIndex(s => s.key === activeKey);
	// Bail on an unknown key rather than letting the arithmetic answer for it: findIndex gives
	// -1, so a bare `sections[-1 + delta]` would send Next to the FIRST section — a wrong
	// answer that looks like a working button, where undefined leaves the rail where it is.
	if (from < 0) return undefined;
	return sections[from + delta];
}
