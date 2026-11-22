import { documentPortraitFrame, resolvePortrait } from "../utils/portrait-frame.js";
import { touchesFlag } from "../utils/touches-flag.js";
import { repaintActorRow } from "./actor-directory-rows.js";

/**
 * Show a chosen portrait frame on the Actors sidebar rows.
 *
 * The frame is a rect on a flag, painted by an inline style, so only surfaces that know about it
 * apply it — and core's directory template renders a bare `<img src="{{img}}">`. The result was a
 * person whose face was cropped on every sheet in the system and uncropped in the one list a GM
 * scrolls all day.
 *
 * Nothing is written and no file is baked: the row's own image is wrapped in a clipping box and
 * given the same style the sheets use, so this works for a player with no upload rights and
 * reverts the moment a frame is cleared.
 *
 * TWO ENTRY POINTS, because the directory is only redrawn for changes core cares about — a
 * document created or deleted, or its name / img / sort / folder changed. A frame lives in
 * `flags`, which core does not watch, so framing somebody left the sidebar showing the old crop
 * until the next reload. `onUpdateActorPortraitFrame` closes that: it repaints the one row that
 * changed rather than re-rendering the directory, so nobody's scroll position or open folders
 * move because a face was cropped.
 *
 * The render hook is bound to `renderDocumentDirectory` rather than `renderActorDirectory`:
 * ApplicationV2 fires a render hook for every class in the inheritance chain and the parent's
 * name is the stable one (the same reason CompendiumItemIcons.js binds there). The collection
 * check below is therefore load-bearing — every other sidebar tab reaches this handler too.
 *
 * A compendium's Actor rows are deliberately NOT decorated: they render off the pack index, which
 * carries `img` but not `flags`, so there is no frame to read there without fetching every
 * document in the pack on every render.
 */

/** Marks the box we inserted, so a re-render neither double-wraps nor unwraps somebody else's. */
const BOX = "stonetop-dir-portrait";

/** Undo the wrap, putting the image back exactly where core rendered it. */
function unwrap(box) {
	const img = box.querySelector("img");
	if (img) {
		img.removeAttribute("style");
		box.replaceWith(img);
	} else {
		box.remove();
	}
}

/**
 * Bring one rendered row into line with the frame its actor is wearing — wrapping, repainting or
 * unwrapping as needed. Idempotent, so it can be called on every render and every update.
 */
export function decoratePortraitRow(li, actor) {
	const existing = li.querySelector(`.${BOX}`);
	// Read the flag FIRST: this runs for every row of every directory render, and almost none of
	// them are framed. With no frame stored and no box of ours already there, the row is one core
	// rendered and one we would leave exactly as it is, so there is nothing to look up.
	const frame = documentPortraitFrame(actor);
	if (!frame && !existing) return;

	const img = li.querySelector(`.${BOX} > img`) ?? li.querySelector(":scope > img");
	if (!img) return;

	// resolvePortrait can also REDIRECT: a rect measured on a whole illustration cannot be
	// applied to the square cut out of it, so a shipped square resolves back to the illustration
	// and is framed from there. The row has to follow that or it paints the rect onto the wrong
	// picture.
	const portrait = resolvePortrait(actor.img, frame);
	if (!portrait.framed) {
		if (existing) unwrap(existing);
		return;
	}

	// Read the ATTRIBUTE, not `.src`: the DOM resolves the latter to an absolute URL, which would
	// never match the relative path resolvePortrait hands back. `data-src` is core's lazy-loading
	// placeholder, which its own observer swaps into `src` when the row scrolls into view — leave
	// that attribute alone and set the one it is going to fill.
	const attr = img.hasAttribute("data-src") ? "data-src" : "src";
	if (img.getAttribute(attr) !== portrait.src) img.setAttribute(attr, portrait.src);
	img.setAttribute("style", portrait.style);

	if (!existing) {
		const box = document.createElement("span");
		box.className = BOX;
		img.replaceWith(box);
		box.appendChild(img);
	}
}

/**
 * Repaint one actor's sidebar row when its frame changes.
 *
 * Core redraws the directory for name / img / sort / folder and nothing else, so without this a
 * frame written from a sheet is invisible in the sidebar until the world is reloaded.
 *
 * ⚠ The flag bag is read with BRACKETS off SYSTEM_ID. The package id is hyphenated, so a dotted
 * `changed.flags.stonetop-pwd` parses as a subtraction and throws at runtime.
 *
 * Both write shapes count: `setFlag` sends `portraitFrame`, and clearing sends Foundry's
 * `-=portraitFrame` deletion key — the row has to un-crop as readily as it crops.
 *
 * @param {Actor}  actor
 * @param {object} changed  the update that was applied
 */
export function onUpdateActorPortraitFrame(actor, changed) {
	if (!touchesFlag(changed, "portraitFrame")) return;
	repaintActorRow(actor, decoratePortraitRow);
}
