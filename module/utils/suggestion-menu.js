/**
 * A menu of suggestions dropped from an "Add …" button: the first item adds a blank row, the rest
 * add a ready-made one. Replaces the rows of suggestion chips that sat above those buttons (user,
 * 2026-11-07: "Lets just show a dropdown with these suggestions in it when they click the add
 * buttons").
 *
 * It wears the shared autocomplete popup's skin (`.stonetop-autocomplete`, utils/autocomplete.js)
 * and lives the same way: one `<ul>` on `<body>`, `position: fixed`, so no dialog's scroll box can
 * clip it, height-capped, and opened up instead of down when the button sits near the bottom.
 *
 * A real menu for the keyboard: the button says `aria-haspopup="menu"` and `aria-expanded`, the
 * first item takes focus, arrows / Home / End move, Enter or Space picks, and Escape closes and
 * hands focus back to the button. A click anywhere else, Tab, a resize, or the button's window
 * closing closes it.
 */

import { placeFixedPopup } from "./autocomplete.js";

const MAX_HEIGHT = 300;
// Every V1 / V2 window fires one of these as it closes, whatever its class.
const CLOSE_HOOKS = ["closeApplication", "closeApplicationV2"];
let current = null; // { menu, anchor, cleanup }

/** Close the open menu, if any. `refocus` hands focus back to the button that opened it. */
export function closeSuggestionMenu({ refocus = false } = {}) {
	if (!current) return;
	const { menu, anchor, cleanup } = current;
	current = null;
	cleanup();
	menu.remove();
	anchor.setAttribute("aria-expanded", "false");
	if (refocus && anchor.isConnected) anchor.focus();
}

/**
 * Open (or, pressed again, close) the menu under `anchor`.
 * @param {HTMLElement} anchor   the Add button
 * @param {object} o
 * @param {string} [o.heading]   a quiet line above the items ("Suggested for Ancient Evil")
 * @param {string} o.blankLabel  the first item, which adds an empty row
 * @param {{value: string, label: string, hint?: string, used?: boolean, icon?: string, iconClass?: string,
 *         iconStyle?: string}[]} o.items  `icon` is a Font Awesome class drawn before the label, in a
 *         span wearing `iconClass` and `iconStyle` (the relationship map colours its chips' icons so).
 * @param {(value: string|null) => void} o.onPick  called with an item's value, or null for blank
 */
export function openSuggestionMenu(anchor, { heading = "", blankLabel, items = [], onPick }) {
	if (current?.anchor === anchor) { closeSuggestionMenu({ refocus: true }); return; }
	closeSuggestionMenu();

	const esc = foundry.utils.escapeHTML;
	const menu = document.createElement("ul");
	menu.className = "stonetop-autocomplete stonetop-suggestion-menu";
	menu.setAttribute("role", "menu");
	if (anchor.id) menu.setAttribute("aria-labelledby", anchor.id);
	const glyph = ({ icon = "", iconClass = "", iconStyle = "" } = {}) => (icon
		? `<span class="stonetop-suggestion-menu-icon${iconClass ? ` ${esc(iconClass)}` : ""}"${iconStyle ? ` style="${esc(iconStyle)}"` : ""}`
			+ ` aria-hidden="true"><i class="fas ${esc(icon)}"></i></span>`
		: "");
	const row = (value, label, hint, { used = false, blank = false, item = null } = {}) =>
		`<li class="stonetop-autocomplete-option${blank ? " is-blank" : ""}${used ? " is-used" : ""}" role="menuitem" tabindex="-1"`
		+ ` data-value="${esc(value)}"${blank ? " data-blank" : ""}${used ? ' aria-disabled="true"' : ""}>`
		+ glyph(item ?? {})
		+ `<span class="stonetop-autocomplete-value">${esc(label)}</span>`
		+ (hint ? `<span class="stonetop-autocomplete-hint">${esc(hint)}</span>` : "")
		+ `</li>`;
	menu.innerHTML = row("", blankLabel, "", { blank: true })
		+ (items.length && heading ? `<li class="stonetop-suggestion-menu-heading" role="presentation">${esc(heading)}</li>` : "")
		+ items.map(i => row(i.value, i.label, i.used ? "added" : (i.hint ?? ""), { used: !!i.used, item: i })).join("");
	document.body.appendChild(menu);

	const options = () => [...menu.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];
	const pick = li => {
		if (!li || li.getAttribute("aria-disabled") === "true") return;
		const value = li.hasAttribute("data-blank") ? null : li.dataset.value;
		closeSuggestionMenu({ refocus: true });
		onPick(value);
	};

	// At least 360 wide, so a prompt's name is not cut for its hint ("Manifest or possess a body").
	const place = () => placeFixedPopup(menu, anchor.getBoundingClientRect(),
		{ maxHeight: MAX_HEIGHT, openUpBelow: 180, minHeight: 100, minWidth: 360 });

	menu.addEventListener("click", ev => pick(ev.target.closest('[role="menuitem"]')));
	menu.addEventListener("keydown", ev => {
		const list = options();
		const at = list.indexOf(document.activeElement);
		const go = i => { ev.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
		switch (ev.key) {
			case "ArrowDown": return go(at + 1);
			case "ArrowUp": return go(at - 1);
			case "Home": return go(0);
			case "End": return go(list.length - 1);
			case "Enter":
			case " ": ev.preventDefault(); return pick(document.activeElement.closest?.('[role="menuitem"]'));
			case "Escape": ev.preventDefault(); ev.stopPropagation(); return closeSuggestionMenu({ refocus: true });
			case "Tab": return closeSuggestionMenu();
		}
	});
	// Outside presses close it; presses on the button are left to the button's own click, which
	// toggles, so the menu does not close here and reopen there.
	const outside = ev => { if (!menu.contains(ev.target) && !anchor.contains(ev.target)) closeSuggestionMenu(); };
	// A scroll inside the menu is the menu's own; any other keeps it pinned to its button, and a
	// button scrolled away (or re-rendered out of the page) takes the menu with it.
	const reflow = ev => {
		if (ev?.target && menu.contains(ev.target)) return;
		if (!anchor.isConnected) return closeSuggestionMenu();
		place();
	};
	const resize = () => closeSuggestionMenu();
	// The menu goes with its button's window, so no window has to put it away in its own close().
	const windowClosed = app => {
		const el = app?.element?.jquery ? app.element[0] : app?.element;
		if (el?.contains?.(anchor)) closeSuggestionMenu();
	};
	const hooks = globalThis.Hooks;
	const hookIds = hooks?.on ? CLOSE_HOOKS.map(name => [name, hooks.on(name, windowClosed)]) : [];
	document.addEventListener("pointerdown", outside, true);
	window.addEventListener("scroll", reflow, true);
	window.addEventListener("resize", resize);

	current = {
		menu, anchor,
		cleanup: () => {
			document.removeEventListener("pointerdown", outside, true);
			window.removeEventListener("scroll", reflow, true);
			window.removeEventListener("resize", resize);
			for (const [name, id] of hookIds) hooks.off?.(name, id);
		},
	};
	anchor.setAttribute("aria-expanded", "true");
	place();
	options()[0]?.focus();
}
