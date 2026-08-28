import { replaceTextMatches } from "./text-nodes.js";

const _GLYPH_RE = /[○●◇◆□☐■☑▶]+/g;

/**
 * Wrap standalone mark/charge tracks (runs of ◇ or ○) in a block span so CSS can drop
 * them onto their own centered line, matching the printed cards. Only two shapes count
 * as tracks: a run trailing a sentence at the end of a paragraph (e.g. "…maximum of 3):
 * ◇◇◇</p>") and a run leading the text (e.g. the unlock line "○○○○ When you make the
 * last mark…"). Runs sitting inline with a label — "(Loyalty ○○○)", "□ STORM'S FURY
 * ○○○○", "Casting penalty ○○○○○", "(it's ○○ at most)" — are followed by ), </strong>,
 * <br>, or more text, never </p>, so they are left untouched.
 *
 * Call this on raw description HTML BEFORE any per-glyph processing (checkbox markers,
 * wrapStonetopGlyphsInEl) so the glyphs end up inside the centered wrapper.
 */
export function centerArcanumTracks(html) {
	if (!html) return html;
	return html
		.replace(/\s([◇○]{2,})\s*(<\/p>)/g, ' <span class="stonetop-arcanum-track">$1</span>$2')
		.replace(/^(\s*)([◇○]{2,})\s+/, '$1<span class="stonetop-arcanum-track">$2</span> ');
}

/**
 * Every container that renders *authored* text which may carry literal ◇/○/□/▶ — playbook
 * possession descriptions and `choices` labels, arcana card bodies, lore, the handful of
 * moves written with marks, follower/crew gear lines, catalog traits. One list rather than
 * a per-surface copy: these classes drift into new templates, and a container missing from
 * a list renders the raw fallback-font character instead of the styled glyph.
 *
 * Everything here must be **display-only**. A `<textarea>`'s value is a text node, so
 * wrapping one would corrupt the saved text — that is why this is a selector list and not
 * a blanket pass over the sheet. (Editable answers always live in a sibling <textarea> or
 * <input>; an <input>'s value is an attribute, so listing its wrapper stays safe.)
 *
 * Surfaces with no editable prose at all — the Outfit dialog, the steading sheet, the
 * onboarding FAQ popup, journal pages — skip this and call wrapStonetopGlyphsInEl on their
 * whole root instead, which covers strictly more.
 */
export const GLYPH_TEXT_CONTAINERS = [
	// Character sheet
	".stonetop-item-description",                            // moves, possessions, bundled gear
	".stonetop-arcanum-body",                                // front/back/unlock/requirements (read view; the editor is a separate template)
	".stonetop-invocation-desc",
	".stonetop-lore-description",
	".stonetop-lore-option-desc",
	".stonetop-sub-choice-text",                             // possession `choices` checklist (edit mode)
	".stonetop-possession-choice-gear .stonetop-inv-label",  // the chosen weapons' rows (play mode)
	".stonetop-crew-gear-label",                             // the Marshal's authored crew inventory
	".stonetop-follower-gear-name",                          // write-in follower gear — display span, never the edit <input>
	// Character onboarding
	".stonetop-onboarding-card-desc",
	".stonetop-onboarding-card-inline-desc",
	".stonetop-onboarding-lore-desc",
	".stonetop-onboarding-lore-pick-text",
	".stonetop-onboarding-lore-text-label",
	".stonetop-onboarding-suboption-label",
	".stonetop-onboarding-arcana-front-body",
	// Dialogs
	".stonetop-special-pick-traits",                         // Add Special Item catalog traits
	// (Hover panels are NOT here. A move's basic-move panel, cross-reference tooltip and word
	// tooltip hold no editable prose at all, so they take the whole-root pass this list's
	// docblock sends such surfaces to — see utils/move-hover.js.)
	// Chat cards
	".stonetop-chat-move-description",
	".stonetop-roll-card-description",
	".stonetop-arcanum-chat-card",
].join(", ");

/**
 * Redraw literal glyphs as styled ones across every known display-only container under
 * `root`. Each element is wrapped once — re-running on an already-processed tree is a
 * no-op, so this is safe to call from an activateListeners that may fire more than once.
 *
 * @param {HTMLElement} root  Sheet/dialog/message root. `root` itself is never matched,
 *                            only its descendants (same as the querySelectorAll it replaced).
 */
export function wrapGlyphTextContainers(root) {
	if (!root) return;
	for (const el of root.querySelectorAll(GLYPH_TEXT_CONTAINERS)) {
		if (el.dataset.glyphsWrapped) continue;
		el.dataset.glyphsWrapped = "1";
		wrapStonetopGlyphsInEl(el);
	}
}

export function wrapStonetopGlyphsInEl(container) {
	replaceTextMatches(container, {
		skip:  ".stonetop-glyph, .stonetop-move-ref",
		regex: _GLYPH_RE,
		// A run like "◇◇○" becomes one span per glyph.
		render: (match) => {
			const runGlyphs = [...match[0]];
			return runGlyphs.map((glyph, gi) => {
				const span = document.createElement("span");
				span.className = "stonetop-glyph";
				if (glyph === "◇") span.classList.add("stonetop-glyph--diamond");
				else if (glyph === "◆") span.classList.add("stonetop-glyph--diamond-selected");
				else if (glyph === "▶") span.classList.add("stonetop-glyph--arrow");
				else if (glyph === "□" || glyph === "☐") span.classList.add("stonetop-glyph--checkbox");
				else if (glyph === "■" || glyph === "☑") span.classList.add("stonetop-glyph--checkbox-checked");
				else if (glyph === "○") span.classList.add("stonetop-glyph--circle");
				else if (glyph === "●") span.classList.add("stonetop-glyph--circle-filled");
				// A diamond directly followed by another diamond in the same run is
				// "joined": the journal CSS drops its trailing gap so a "◇◇" load track
				// reads as one unit — the gap only opens up before the following text.
				const isDiamond     = glyph === "◇" || glyph === "◆";
				const nextIsDiamond = runGlyphs[gi + 1] === "◇" || runGlyphs[gi + 1] === "◆";
				if (isDiamond && nextIsDiamond) span.classList.add("stonetop-glyph--joined");
				span.textContent = glyph;
				return span;
			});
		},
	});
}
