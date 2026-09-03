// The improvement card as the steading's Improvements tab draws it, rendered from a
// definition alone. Used by the builder dialog's Preview panel, so an author can see the
// checkboxes, the written-for-you headings, the "or" divider above an either/or and the
// on-completion line before committing to any of them.
//
// It deliberately emits the same class names as templates/actor/partials/
// steading-tab-improvements.hbs rather than a look of its own: those rules are unscoped
// (.steading-req-heading, .steading-req-list, .steading-improvement-effect ...), so the
// preview is painted by the very CSS that will paint the real card, and a preview that
// still matched after the card was restyled would be a preview worth nothing.
//
// Pure and Foundry-free: it takes a definition and returns a string, which is what makes
// it testable next to the shape helpers in improvement-def.js.

import { escHtml } from "./strings.js";
import { alternativeSectionFlags, summarizeImprovementGrants } from "./improvement-def.js";

/** What the empty preview says, so a blank panel reads as "not yet" and not as broken. */
export const EMPTY_PREVIEW_HTML =
	`<p class="stonetop-improvement-preview-empty">Name the improvement and it will be drawn here, exactly as the Improvements tab will draw it.</p>`;

/**
 * One improvement card's HTML, in the shape the Improvements tab renders.
 *
 * `heading`, the requirement items and `effect` are already HTML on a definition (see
 * buildImprovementDef) and are emitted unescaped, the same way both real readers emit
 * them; `name` and `flavor` are plain text and are escaped here, the same way both real
 * readers escape them. Getting that split wrong in either direction is the whole reason
 * the preview is worth having.
 *
 * @param {{name?:string, flavor?:string, sections?:Array, effect?:string, grants?:object}} def
 * @returns {string}
 */
export function improvementPreviewHtml(def) {
	if (!def?.name) return EMPTY_PREVIEW_HTML;

	const sections = def.sections ?? [];
	const alternatives = alternativeSectionFlags(sections);
	const body = [];

	sections.forEach((section, i) => {
		if (alternatives[i]) body.push(`<p class="steading-req-or">or</p>`);
		if (section.heading) body.push(`<p class="steading-req-heading">${section.heading}</p>`);
		const items = section.items ?? [];
		if (!items.length) return;
		// Disabled rather than merely unwired: a preview whose boxes tick is a preview an
		// author will try to fill in, and nothing they tick here is stored anywhere.
		body.push(`<ul class="steading-req-list">${items.map(item =>
			`<li class="steading-req-item"><label><input type="checkbox" disabled><span>${item}</span></label></li>`
		).join("")}</ul>`);
	});

	if (def.effect) body.push(`<div class="steading-improvement-effect">${def.effect}</div>`);

	// The automatic half of the effect, named. The prose says it in the book's voice and
	// says it whether or not the sheet can perform it; this line is the part that is
	// actually wired, which is the distinction the Effect panel is asking about.
	const applied = summarizeImprovementGrants(def.grants);
	body.push(applied.length
		? `<p class="stonetop-improvement-preview-grants"><strong>On completion:</strong> ${escHtml(applied.join("; "))}</p>`
		: `<p class="stonetop-improvement-preview-grants is-none">Nothing is applied automatically; the effect is prose only.</p>`);

	// `is-open` because the tab's own cards collapse to their header until clicked, and a
	// preview that has to be opened before it previews anything is a poor preview.
	return `<div class="steading-improvement is-open stonetop-improvement-preview-card">`
		+ `<div class="steading-improvement-header">`
		+ `<label class="steading-improvement-complete-label"><input type="checkbox" disabled></label>`
		+ `<div class="steading-improvement-summary">`
		+ `<h4 class="steading-improvement-title">${escHtml(def.name)}</h4>`
		+ (def.flavor ? `<p class="steading-improvement-flavor">${escHtml(def.flavor)}</p>` : "")
		+ `</div></div>`
		+ `<div class="steading-improvement-body">${body.join("")}</div>`
		+ `</div>`;
}
