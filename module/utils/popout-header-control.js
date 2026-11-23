/**
 * Add a control to an ImagePopout's window header, across AppV1 and AppV2.
 *
 * Core builds the header after the popout renders and can rebuild it, so injection is retried on
 * a rAF and two timeouts rather than done once. Each pass is idempotent.
 *
 * ⚠ THE GUARD IS PER KEY, NOT PER WINDOW. It used to be "does this header already have a control
 * at all", which silently caps a header at one: the first successful pass installs the first
 * button and every later pass bails before reaching the second. Two controls on one popout is
 * exactly what the portrait framer needs (Edit Photo beside Frame Face), so the guard has to ask
 * about the control being added, not about the header.
 */

import { format, localize } from "./i18n.js";
import { openPortraitFrameEditor } from "./PortraitFrameDialog.js";
import { canOpenTokenizer, openTokenizer } from "./portrait-tokenizer.js";

/** Marks a control as ours, so several can be added without reversing their order. */
const OWN = "stonetop-popout-control";

/** Schedule `inject` the three times core might have (re)built the header. */
function schedule(inject) {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(inject);
	setTimeout(inject, 0);
	setTimeout(inject, 100);
}

/**
 * @param {Application} popout        the ImagePopout to decorate
 * @param {object}      opts
 * @param {string}      opts.key      unique class for this control; doubles as the dedupe guard
 * @param {string}      opts.icon     Font Awesome class, e.g. "fa-camera"
 * @param {string}      opts.label    tooltip and accessible name
 * @param {Function}    opts.onClick  invoked with the originating event already neutralised
 */
export function addPopoutHeaderControl(popout, { key, icon, label, onClick } = {}) {
	if (!popout || !key || typeof onClick !== "function") return;
	const inject = () => {
		const root = popout?.element?.jquery ? popout.element[0] : popout?.element;
		const header = root?.querySelector?.(".window-header");
		if (!header) return;
		if (header.querySelector(`.${key}`)) return;

		// AppV1 headers use <a class="header-button">, AppV2 <button class="header-control">.
		const isAppV1 = !!header.querySelector("a.header-button");
		const btn = document.createElement(isAppV1 ? "a" : "button");
		if (isAppV1) {
			btn.className = `header-button control ${OWN} ${key}`;
			btn.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i> ${label}`;
		} else {
			btn.type = "button";
			btn.className = `header-control icon ${OWN} ${key} fa-solid ${icon}`;
		}
		btn.setAttribute("data-tooltip", label);
		btn.setAttribute("aria-label", label);
		btn.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			onClick(ev);
		});

		// Ahead of core's own controls (Share, Close), so added controls read as belonging to
		// this window rather than trailing off the end of the standard set. The anchor is the
		// first control that is NOT one of ours, which keeps several added controls in the order
		// they were added rather than reversing them — a previously added control matches the
		// same `.header-button` / `.header-control` selector core's do.
		const controls = [...header.querySelectorAll(isAppV1 ? "a.header-button" : "button.header-control")];
		const anchor = controls.find((el) => !el.classList.contains(OWN));
		if (anchor) header.insertBefore(btn, anchor);
		else header.appendChild(btn);
	};
	schedule(inject);
}

/**
 * The "Frame …" control, for the three popouts that offer it: a PC's portrait, a monster's
 * stat-block portrait, and a steading roster member's photo.
 *
 * One helper rather than three copies of the same key/icon/label/title quartet, because they only
 * work if they agree — the key is the dedupe guard, and the label is a shared i18n string. The
 * three differed already: two titled the editor from `actor.name` and the third from the popout's
 * own title, with nothing to say whether that was deliberate. It is: a legacy roster row has no
 * document to take a name from, which is why `name` is passed in rather than read off the handle.
 *
 * A null or read-only handle is the no-op, so every caller can hand over whatever its lookup
 * returned without gating first.
 *
 * ⚠ THE PICTURE IS RESOLVED AT CLICK TIME, off the handle, and there is deliberately no way for a
 * caller to pass one in. This control is registered once when the window opens and clicked at some
 * later point, and the portrait can change in between — the window's own "Edit Photo" does exactly
 * that. A caller that handed over `actor.img` froze the picture as it was when the window opened,
 * so choosing a new face and then framing it opened the editor on the PREVIOUS one and would have
 * stamped a rect measured on it. Every handle exposes `img` as a live getter for this reason.
 *
 * `name` is still a plain string, and so still a snapshot — but a rename mid-window costs a stale
 * window title, which is cosmetic, where a stale image frames the wrong face.
 *
 * @param {Application} popout
 * @param {object|null} handle       a portrait-frame handle (see utils/portrait-frame-handles.js)
 * @param {object}      opts
 * @param {string}      opts.name    whose face this is, for the editor's title
 * @param {string}      [opts.key]   dedupe key, when a popout needs its own
 * @param {Function}    opts.onSaved
 */
export function addPortraitFrameControl(popout, handle, { name, key = "stonetop-frame-portrait", onSaved } = {}) {
	if (!handle?.canWrite) return;
	addPopoutHeaderControl(popout, {
		key,
		icon: "fa-crop-simple",
		label: localize("stonetop.portraitFrame.control"),
		onClick: () => openPortraitFrameEditor({
			handle,
			img: handle.img,
			title: format("stonetop.portraitFrame.title", { name }),
			onSaved,
		}),
	});
}

/**
 * The "Open Tokenizer" control, beside the framing one — the same pair the sheet headers carry as
 * pips, in the same order, so the two ways of reaching them agree.
 *
 * Takes a HANDLE rather than an actor, for the same reason the framing control does: it is the
 * handle that already answers both questions this needs. `canWrite` carries the ownership check
 * (roster NPCs are seeded at OBSERVER, so a player who may edit the steading still must not be
 * offered a control the server would refuse), and `actor` is present only for a real document —
 * so a legacy steading row, which is plain text in a flag array, silently gets nothing. Tokenizer
 * has no actor to work on there.
 *
 * Register this BEFORE the framing control so it lands to its left, matching the pips.
 *
 * @param {Application}  popout
 * @param {object|null}  handle  a portrait-frame handle (see utils/portrait-frame-handles.js)
 * @param {object}       [opts]
 * @param {string}       [opts.key] dedupe key, when a popout needs its own
 */
export function addTokenizerControl(popout, handle, { key = "stonetop-tokenize-portrait" } = {}) {
	if (!handle?.canWrite || !canOpenTokenizer(handle.actor)) return;
	addPopoutHeaderControl(popout, {
		key,
		icon: "fa-circle-user",
		label: localize("stonetop.portraitFrame.tokenizerPip"),
		onClick: () => openTokenizer(handle.actor),
	});
}
