// Makes the baked "Steading Improvement" cards in journal prose draggable onto the
// Stonetop steading sheet. The cards are emitted by the gazetteer generator (see
// scripts/local/shared/gazetteer.mjs `renderSteadingImprovementCard`) with a
// `data-steading-improvement` attribute carrying the structured definition as JSON.
//
// Baked HTML can't populate `dataTransfer`, so — like the bestiary's
// `_bindStatBlockDrag` — this runtime pass attaches a `dragstart`. Unlike that one
// (which emits Foundry's native `{type:"Actor", uuid}` payload for the canvas drop
// handler), here we serialize the card's full definition into a custom payload the
// steading sheet's own drop handler recognizes. Wired
// from every journal render path (the generic journal hook for Lore/prose pages and
// the Location page sheet, which renders through its own sheet).

import { escHtml } from "../utils/strings.js";
import { createHomebrewCard, readHomebrewCardPayload, bindHomebrewCardDrag } from "./homebrew-cards.js";
import {
	alternativeSectionFlags,
	normalizeImprovementGrants,
	normalizeImprovementSections,
	summarizeImprovementGrants,
} from "../utils/improvement-def.js";

export const STEADING_IMPROVEMENT_DRAG_TYPE = "StonetopSteadingImprovement";

/**
 * Runtime twin of the gazetteer's `renderSteadingImprovementCard` (build-time,
 * scripts/local) — builds the same draggable card HTML for an improvement authored
 * in-app, so a dropped homebrew card lands as an identical custom improvement.
 *
 * A definition's `heading`, requirement items and `effect` are already HTML: authored
 * ones were escaped and had their *asterisks* resolved by buildImprovementDef, and the
 * generator's own cards ship the same light markdown already processed. They are emitted
 * as-is, exactly as the steading tab emits them. `name` and `flavor` are plain text on
 * both paths and are escaped here for display only, never in the payload: escaping them
 * into the payload is what used to put a literal `&#x27;` in the flavor line of every
 * dropped card, since the steading tab escapes it a second time on the way out.
 *
 * Each section's `min` ("2 of the following") and `group` (either/or alternatives) and
 * the improvement's `grants` (what completing it applies by itself) ride in the payload
 * alongside the prose, so a card dropped onto a steading is the same improvement that
 * was authored rather than a flattened copy of it.
 * @param {{name:string, flavor?:string, effect?:string, category?:string, sections?:Array<{heading?:string, min?:number, group?:string, items?:string[]}>, grants?:object}} def
 */
export function renderImprovementCardHtml(def) {
	const name = String(def?.name ?? "");
	const flavor = String(def?.flavor ?? "");
	const effect = String(def?.effect ?? "");
	const sections = normalizeImprovementSections(def?.sections);
	const alternatives = alternativeSectionFlags(sections);
	const grants = normalizeImprovementGrants(def?.grants);

	// Payload mirrors the built-in IMPROVEMENT_DEFINITIONS shape (items are HTML
	// strings); double-escaped for the double-quoted attribute, decoded on read.
	// `category` rides along so a dropped card lands under the right filter chip on the
	// steading sheet; the build-time gazetteer emits no category, and those cards stay
	// uncategorised (and so unfiltered). Validated by StonetopSteading.addCustomImprovement.
	const payload = { name, category: def?.category ?? "", flavor, effect, sections, grants };
	const dataAttr = escHtml(JSON.stringify(payload));

	const body = [];
	if (flavor) body.push(`<p class="stonetop-journal-improvement-flavor">${escHtml(flavor)}</p>`);
	sections.forEach((s, index) => {
		// The same "or" divider the steading sheet draws above a continued either/or, so
		// the card reads the way the improvement will once it is dropped.
		if (alternatives[index]) body.push(`<p class="steading-req-or">or</p>`);
		if (s.heading) body.push(`<p class="steading-req-heading">${s.heading}</p>`);
		if (s.items.length) body.push(`<ul class="steading-req-list">${s.items.map(i => `<li class="check-bullet">${i}</li>`).join("")}</ul>`);
	});
	if (effect) body.push(`<p class="stonetop-journal-improvement-effect">${effect}</p>`);
	// What the sheet will apply by itself when this is ticked complete, spelled out: the
	// effect prose says it in the book's voice, and this says which of it is automatic.
	const applied = summarizeImprovementGrants(grants);
	if (applied.length) {
		body.push(`<p class="stonetop-journal-improvement-grants"><strong>On completion:</strong> ${escHtml(applied.join("; "))}</p>`);
	}

	return `<div class="stonetop-journal-improvement" draggable="true" data-steading-improvement="${dataAttr}" title="Drag onto the Stonetop steading sheet">`
		+ `<div class="stonetop-journal-improvement-head">`
		+ `<i class="fas fa-screwdriver-wrench" aria-hidden="true"></i>`
		+ `<span class="stonetop-journal-improvement-eyebrow">Steading Improvement</span>`
		+ `<span class="stonetop-journal-improvement-name">${escHtml(name)}</span>`
		+ `</div>`
		+ `<div class="stonetop-journal-improvement-body">${body.join("")}</div>`
		+ `</div>`;
}

/** Author a homebrew steading-improvement card into the shared homebrew journal and
 *  open it so the fresh draggable card is on screen. GM-only. */
export function createImprovementCard(def) {
	return createHomebrewCard({
		title: "Homebrew Steading Improvements",
		kind: "improvement",
		name: def?.name,
		html: renderImprovementCardHtml(def),
	});
}

/** Read + parse a card's improvement definition, or null if malformed. */
export function readImprovementCard(card) {
	return readHomebrewCardPayload(card, "steadingImprovement");
}

/**
 * Attach drag behaviour to every steading-improvement card under `root`.
 * Idempotent — re-binding a card is skipped, so it's safe on every render.
 * @param {HTMLElement|jQuery} root
 */
export function bindSteadingImprovementDrag(root) {
	bindHomebrewCardDrag(root, {
		selector: ".stonetop-journal-improvement[data-steading-improvement]",
		datasetKey: "steadingImprovement",
		boundFlag: "stImprovementBound",
		dragType: STEADING_IMPROVEMENT_DRAG_TYPE,
		payloadKey: "improvement",
	});
}
