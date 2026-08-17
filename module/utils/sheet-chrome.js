// Shared window-header chrome for the bestiary sheets (monster stat block +
// Bestiary Entry). Both wear the same edit/lock toggle, strip Foundry's
// document-id link, and collapse the portrait slot when its art fails to load.
// The only per-sheet variation is the header's BEM class and the toggle's noun,
// so those are parameters rather than two copies of the logic.

import { isInCompendium, warnCompendiumImmutable } from "./compendium-edit-guard.js";

/**
 * Drop the header portrait if its image fails to load, flagging the header so
 * CSS collapses the now-empty slot. No-op in edit mode (the slot stays so the
 * user can drop in art).
 * @param {Application} sheet      the host sheet (uses `_editMode`, `element`)
 * @param {string} headerClass     e.g. "stonetop-monster-header"
 */
export function hideBrokenPortrait(sheet, headerClass) {
	if (sheet._editMode) return;
	// The slot is the element wearing .stonetop-portrait, and it is not always the image: the
	// monster header puts the class on the <img>, while the NPC header puts it on a clipping
	// <span> (so a hand-framed face can be positioned inside it) and the no-art placeholder is
	// a <span> with no image at all. Remove the SLOT either way, so squaring the NPC header did
	// not leave a bordered empty box where a broken portrait used to vanish cleanly.
	const slot = sheet.element[0]?.querySelector(".stonetop-portrait");
	if (!slot) return;
	const img = slot.matches("img") ? slot : slot.querySelector("img");
	if (!img) return;
	const header = slot.closest(`.${headerClass}`);
	// Take the whole positioning wrapper when there is one: it is the header's flex item, and the
	// crop pip lives inside it. Removing only the picture would leave a zero-sized box in the
	// header holding a button nothing can reach.
	const remove = slot.closest(".stonetop-portrait-slot") ?? slot;
	const drop = () => {
		remove.remove();
		header?.classList.add(`${headerClass}--no-portrait`);
	};
	if (img.complete && img.naturalWidth === 0) { drop(); return; }
	img.addEventListener("error", drop, { once: true });
}

/** Whether the face a name is set in has actually arrived yet. */
function fontLoaded(textStyle, size) {
	try { return document.fonts.check(`${textStyle.fontStyle} ${textStyle.fontWeight} ${size}px ${textStyle.fontFamily}`); }
	// check() throws on a font shorthand it can't parse; fall back to the document-wide answer.
	catch { return document.fonts.status === "loaded"; }
}

/**
 * Shrink an oversized display name until it stops pushing the header around, and no further.
 *
 * A sheet header's name is set at --font-size-display, which is sized for a name, not for a
 * NAME AND a stat bar beside it: the column left over is narrow enough that anything past about
 * ten characters wraps, and a wrapped name grows its column past the portrait's height — which
 * unpins whatever is aligned to the bottom of that column (pronouns, traits) from the portrait's
 * bottom edge and pushes it out through the base of the header.
 *
 * So the name is shrunk to the largest size at which the column fits again, NOT to the largest
 * size that avoids wrapping. Those are far apart: a two-line name that needs 24px to fit on one
 * line usually needs only ~37px to fit the height, and the second answer is the one worth having.
 * `column` names the box with the height to keep to (its own `min-height` is the limit); leave it
 * out and the fit targets a single line instead.
 *
 * Writes the fitted size to `sizeVar` on the header element, which the stylesheet consumes with
 * the unfitted size as its fallback — so a name that already fits leaves no inline style behind
 * at all, and the CSS stays in charge of what "unfitted" means. `minVar` is the floor: shrinking
 * stops there and the header is left to grow, so a very long name stays readable.
 *
 * Play mode only. Edit mode swaps the name for an <input>, which scrolls rather than wraps, so
 * there is nothing to fit — and the variable is cleared on the way past so a fitted name doesn't
 * leave the input undersized.
 *
 * @param {Application} sheet   the host sheet (uses `element`; stores its observer on the instance)
 * @param {object} opts
 * @param {string} opts.header  selector for the element carrying the size variables
 * @param {string} opts.text    selector for the element holding the name text
 * @param {string} [opts.column] selector for the box whose min-height the name must not push past
 * @param {string} opts.sizeVar custom property to write the fitted size to
 * @param {string} opts.minVar  custom property naming the floor
 */
export function fitDisplayName(sheet, { header, text, column: columnSelector, sizeVar, minVar }) {
	// Each render builds a new header, so the observer from the last one is watching a detached
	// element. Drop it here rather than only on close: renders far outnumber closes.
	sheet._stonetopNameFit?.disconnect();
	sheet._stonetopNameFit = null;

	const host = sheet.element?.[0]?.querySelector(header);
	if (!host) return;
	host.style.removeProperty(sizeVar);
	const textEl = host.querySelector(text);
	if (!textEl) return;
	const field = textEl.closest(".stonetop-name-field") ?? textEl.parentElement;
	if (!field) return;

	// How many line boxes the name currently occupies. Measured off the rendered text rather
	// than summed from widths: a width sum has to agree with the browser about padding, borders,
	// trailing spaces and where a break is allowed, and being wrong by any of that is invisible
	// until a name wraps anyway (an earlier pass here read `clientWidth`, which INCLUDES padding,
	// so it allowed itself 8px it did not have and chose a size that still wrapped).
	const lineCount = () => {
		const range = document.createRange();
		range.selectNodeContents(textEl);
		return range.getClientRects().length;
	};

	// The column the name shares with whatever sits under it, and the height it is meant to keep
	// to — its own min-height, which is the portrait's size. Everything below the name is pinned
	// to the bottom of this box, and that pin only holds while the box is not overflowing.
	const column = columnSelector ? host.querySelector(columnSelector) : null;
	const columnFits = () => {
		if (!column) return false;
		const limit = parseFloat(getComputedStyle(column).minHeight);
		// Sub-pixel: the column's height is a sum of line boxes and can land a hair over.
		return limit > 0 && column.getBoundingClientRect().height <= limit + 0.5;
	};

	// Small enough. EITHER answer is a stopping point, and which one arrives first is the whole
	// behaviour: shrinking past the point where the column fits buys nothing (the name is going
	// to wrap at every size below it too, and the rows under it are already back on the
	// portrait's edge), while a name that reaches one line has nothing left to gain either. The
	// one-line half also stops a long TRAITS line — which no amount of name-shrinking can fix —
	// from dragging the name down with it.
	const fits = () => lineCount() <= 1 || columnFits();

	let awaitingFont = false;
	const refit = () => {
		// Measure at the unfitted size every time, so a widening window can grow the name back
		// rather than only ever ratcheting it down.
		host.style.removeProperty(sizeVar);
		if (!textEl.textContent.trim()) return;

		const textStyle = getComputedStyle(textEl);
		const max = parseFloat(textStyle.fontSize);
		const floor = parseFloat(getComputedStyle(host).getPropertyValue(minVar));
		const min = floor > 0 ? Math.min(floor, max) : max;

		// The display face is a webfont, and a name measured before it arrives is measured in
		// the fallback, whose advances are nothing like it. Fit anyway (an unfitted name is the
		// worse first paint), and do it again once the real face is in.
		if (!awaitingFont && document.fonts && !fontLoaded(textStyle, max)) {
			awaitingFont = true;
			document.fonts.ready
				.then(() => { awaitingFont = false; if (textEl.isConnected) refit(); })
				// A refit that throws would otherwise leave `awaitingFont` stuck true, so the
				// name never re-fits again for the life of this sheet.
				.catch(() => { awaitingFont = false; });
		}

		if (min >= max || fits()) return;

		// The largest size that fits, by bisection. Both halves of `fits` only ever become true
		// as the size comes down, so the range splits cleanly — and bisecting costs about five
		// reflows against the eighteen a walk down from 42px to the floor would, which matters
		// because this reruns on every frame of a window drag.
		let lo = min, hi = max - 1, best = min;
		while (lo <= hi) {
			const mid = Math.floor((lo + hi) / 2);
			host.style.setProperty(sizeVar, `${mid}px`);
			if (fits()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
		}
		host.style.setProperty(sizeVar, `${best}px`);
	};

	refit();

	// The sheet is resizable and the name column takes whatever the stat bar leaves it, so the
	// room to fit into moves with the window. Width only: setting the size changes the name's
	// HEIGHT, which would otherwise call this straight back for no reason (and, when it lands
	// mid-frame, as a ResizeObserver loop warning).
	if (typeof ResizeObserver === "function") {
		// Seeded from the observer's own first delivery rather than read off the element here:
		// `contentRect` excludes padding and `clientWidth` includes it, so seeding from the
		// latter guarantees a mismatch and one pointless refit on every render.
		let lastWidth = null;
		const observer = new ResizeObserver(entries => {
			const width = entries[0]?.contentRect?.width;
			if (lastWidth === null) { lastWidth = width; return; }
			if (width === lastWidth) return;
			lastWidth = width;
			refit();
		});
		observer.observe(field);
		sheet._stonetopNameFit = observer;
	}
}

/** Strip Foundry's document-id link from the window header. */
export function stripHeaderChrome(sheet) {
	const header = sheet.element[0]?.querySelector(".window-header");
	header?.querySelectorAll(".document-id-link").forEach(el => el.remove());
}

/**
 * Inject the edit/lock toggle into the window header. `noun` names the thing
 * being edited (e.g. "stat block" or "Entry") for the tooltip.
 *
 * Every Stonetop actor sheet routes through here. The character and steading sheets used to
 * carry their own byte-identical copies of the DOM building below, and both bailed on
 * `!this.isEditable` instead of drawing the lock — so opening either from a compendium showed
 * no toggle at all and no hint as to why, while an NPC or monster sheet in the same state
 * explained itself. That divergence is the reason this takes options rather than staying
 * three functions.
 *
 * @param {Application} sheet
 * @param {string} noun                  names the thing being edited, for the default tooltips
 * @param {object} [opts]
 * @param {string} [opts.editLabel]      tooltip when locked and clickable (default `Edit ${noun}`)
 * @param {string} [opts.lockLabel]      tooltip when already in edit mode (default `Lock ${noun}`)
 * @param {(on: boolean) => void} [opts.onChange]  extra work when the mode flips, before the render
 */
export function injectHeaderToggle(sheet, noun, { editLabel, lockLabel, onChange } = {}) {
	const header = sheet.element[0]?.querySelector(".window-header");
	if (!header || !sheet.actor?.isOwner) return;
	header.querySelector(".stonetop-header-toggle")?.remove();

	// Locked == viewed from a (read-only) compendium. Show a lock affordance; clicking
	// it explains that compendium content is immutable and to edit a world copy instead.
	const locked = !sheet.isEditable;

	const label = document.createElement("label");
	label.className = "stonetop-edit-toggle stonetop-header-toggle";
	label.title = locked
		? "Read-only: import to your world to edit"
		: (sheet._editMode ? (lockLabel ?? `Lock ${noun}`) : (editLabel ?? `Edit ${noun}`));

	const checkbox = document.createElement("input");
	checkbox.type = "checkbox";
	checkbox.checked = sheet._editMode;
	checkbox.addEventListener("change", () => toggleEdit(sheet, checkbox, { onChange }));

	const track = document.createElement("span");
	track.className = "stonetop-toggle-track";
	const thumb = document.createElement("span");
	thumb.className = "stonetop-toggle-thumb";
	const icon = document.createElement("i");
	icon.className = locked ? "fas fa-lock" : "fas fa-wrench";
	thumb.appendChild(icon);
	track.appendChild(thumb);
	label.appendChild(checkbox);
	label.appendChild(track);

	header.insertBefore(label, header.querySelector(".window-title"));
}

/**
 * Handle the edit/lock toggle: flip `_editMode` and re-render. A non-editable sheet
 * means a read-only compendium document (the toggle only shows for owners, so world
 * actors are always editable here); compendium content is immutable, so explain how to
 * edit a world copy instead of entering edit mode.
 */
export async function toggleEdit(sheet, checkbox, { onChange } = {}) {
	const turningOn = checkbox.checked;
	if (turningOn && !sheet.isEditable) {
		checkbox.checked = false;
		if (isInCompendium(sheet.actor)) warnCompendiumImmutable(sheet.actor);
		return;
	}
	sheet._editMode = turningOn;
	// Sheet-specific teardown (the steading drops its per-section pencils here) runs before the
	// render, so one paint shows the whole new state.
	onChange?.(turningOn);
	sheet.render(false);
}
