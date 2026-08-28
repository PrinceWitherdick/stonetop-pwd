import { replaceTextMatches } from "./text-nodes.js";

const _GLYPH_CHARS = "○●◇◆□☐■☑▶";

/**
 * A run of glyphs TOGETHER WITH THE PUNCTUATION IT WAS WRITTEN IN — "(□).", "◇◇◇,", the "○○○)"
 * of "(Loyalty ○○○)" — rather than the bare run.
 *
 * The punctuation comes along because each glyph is drawn as an inline-block, and CSS Text
 * gives an atomic inline a soft wrap opportunity on both sides "even when adjacent to a
 * character that would normally suppress them" — a word joiner and an &nbsp; are both powerless
 * there. Have What You Need's "small item/slot (□)." would break after the "(" and strand the
 * square at the head of the next line. Matching the cluster lets `render` put the whole thing
 * in one `white-space: nowrap` wrapper, which is the only thing that does suppress it.
 *
 * Deliberately punctuation and not `\S*`: absorbing whole neighbouring words would also swallow
 * their legitimate break opportunities (the "/" of "item/slot") into the nowrap span.
 */
const _GLYPH_RE = new RegExp(`[([{"'‘“]*[${_GLYPH_CHARS}]+[)\\]}.,;:!?"'’”]*`, "g");

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

/**
 * One `.stonetop-glyph` span for `glyph`, carrying the modifier its shape is drawn from.
 * `next` is the character that follows it in the same cluster, read only for the joined test.
 */
function _glyphSpan(glyph, next) {
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
	const nextIsDiamond = next === "◇" || next === "◆";
	if (isDiamond && nextIsDiamond) span.classList.add("stonetop-glyph--joined");
	span.textContent = glyph;
	return span;
}

/**
 * Redraw every literal ◇/◆/○/●/□/☐/■/☑/▶ under `container` as a styled glyph.
 *
 * Each glyph becomes its own span, and the whole cluster the regex matched — the glyphs plus
 * the punctuation they were written in — goes inside one `.stonetop-glyph-run`, which is
 * `white-space: nowrap`. Without that wrapper the spans are atomic inlines with a wrap
 * opportunity on either side, so "(□)." breaks after the "(" and a "◇◇◇" track splits down the
 * middle; see `_GLYPH_RE` for why no character-level trick closes that opportunity.
 *
 * Re-running is a no-op: the glyph spans are skipped, and the punctuation left as text inside
 * the wrapper no longer holds a glyph for the regex to match.
 */
export function wrapStonetopGlyphsInEl(container) {
	replaceTextMatches(container, {
		skip:  ".stonetop-glyph, .stonetop-move-ref",
		regex: _GLYPH_RE,
		render: (match) => {
			const cluster = [...match[0]];
			const run = document.createElement("span");
			run.className = "stonetop-glyph-run";
			let literal = "";
			const flushLiteral = () => {
				if (!literal) return;
				run.appendChild(document.createTextNode(literal));
				literal = "";
			};
			cluster.forEach((ch, i) => {
				if (!_GLYPH_CHARS.includes(ch)) { literal += ch; return; }
				flushLiteral();
				run.appendChild(_glyphSpan(ch, cluster[i + 1]));
			});
			flushLiteral();
			return run;
		},
	});
}

/**
 * Rewrite every glyph matched by `runRe` into an indexed, selectable checkbox.
 *
 * `runRe` may match a single glyph or a whole run; each glyph inside a match gets its own
 * checkbox and its own sequential index, assigned in document order. Distinct `context`
 * values keep the indices of different markers in one description from colliding.
 *
 * ONE implementation on purpose. The arcana sheet (CharacterArcana) and the onboarding
 * dialog both paint these boxes, and the index a box is given is the key its checked state
 * is persisted under -- so the two must agree glyph for glyph or a mark made during
 * onboarding lands on a different box once the sheet opens. They differ only in how a box
 * reports itself checked and in the class it wears, which is what the options carry.
 *
 * A match's boxes go inside one `.stonetop-glyph-run` wrapper (styles/stonetop.css), the same
 * one the display glyphs take: a checkbox is an atomic inline too, so without it a track
 * sitting in a line of prose can wrap between two of its own circles.
 *
 * @param {string} html                  the description to rewrite
 * @param {RegExp} runRe                 a GLOBAL pattern matching one glyph kind
 * @param {object} opts
 * @param {string} opts.slug             the arcanum, written to `data-arcanum-slug`
 * @param {string} opts.context          which marker on the card ("front", "unlock", ...)
 * @param {string} opts.cssClass         class(es) for the input
 * @param {(index: number) => boolean} opts.isChecked  is the box at this index marked?
 * @returns {{html: string, count: number}} the rewritten html and how many boxes it now has
 */
export function injectGlyphCheckboxes(html, runRe, { slug, context, cssClass, isChecked }) {
	if (!html) return { html, count: 0 };
	let index = 0;
	const processed = String(html).replace(runRe, run =>
		`<span class="stonetop-glyph-run">${[...run].map(() => {
			const i = index++;
			return `<input type="checkbox" class="${cssClass}" data-arcanum-slug="${slug}"`
				+ ` data-context="${context}" data-index="${i}"${isChecked(i) ? " checked" : ""}>`;
		}).join("")}</span>`
	);
	return { html: processed, count: index };
}
