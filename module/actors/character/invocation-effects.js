import { escHtml } from "../../utils/strings.js";

// Plain-language explanations for an Invocation's Reduced / Empowered effects,
// surfaced as hover tooltips on those labels wherever an Invocation's description is
// shown (the Invocations tab and the level-up "choose an Invocation" step).
export const INVOCATION_EFFECT_TOOLTIPS = {
	reduced:   "When you Invoke the Sun God, one consequence you can choose, and must, on a 7-9, is for the Invocation to take this weaker, reduced effect instead.",
	empowered: "With the Empowered Invocations move (6th level), you can choose an extra consequence before you roll to give the Invocation this stronger, empowered effect.",
};

// The "Empowered: …" block of an Invocation's description. Attribute-tolerant on both tags:
// by the time this runs on a card's rendered HTML the label may already carry the tooltip
// annotation below.
//
// The trailing group is not decoration. An empowered effect is not always one paragraph —
// Bath of Healing Light writes its as "add these to your possible choices:" followed by a
// <ul> of three — and stopping at the first </p> tore that in half: the list stayed in
// `base`, where an unlabelled run of empowered outcomes reads as three more of the normal
// ones, while the empowered card ended with a heading promising a list printed above it.
// Lists only: a following <p> is the next effect (or ordinary prose) and stays put.
const EMPOWERED_PARAGRAPH = /<p[^>]*>\s*<strong[^>]*>\s*Empowered:\s*<\/strong>[\s\S]*?<\/p>(?:\s*<(ul|ol)\b[\s\S]*?<\/\1>)*/i;

/**
 * Split an Invocation's description into what it does normally and its empowered effect.
 *
 * The empowered effect is NOT something the Invocation just has — it costs an extra
 * consequence, chosen before the roll, and only a Lightbearer with the 6th-level Empowered
 * Invocations move can pay it. Printed inline in a chat card it reads as part of the
 * effect, so the card takes `base` and only appends `empowered` when the player actually
 * chose to empower it (see _postInvocationCard).
 *
 * @param {string} html  The Invocation's description HTML.
 * @returns {{base: string, empowered: string|null}}  `empowered` is null when there is no
 *   empowered paragraph — some Invocations have none.
 */
export function splitEmpoweredEffect(html) {
	const src = String(html ?? "");
	const match = src.match(EMPOWERED_PARAGRAPH);
	if (!match) return { base: src, empowered: null };
	return { base: src.replace(match[0], ""), empowered: match[0] };
}

// Wrap the "Reduced:" / "Empowered:" labels inside an Invocation's description
// HTML so they carry a hover tooltip explaining what those effect tiers mean.
export function annotateInvocationEffects(html) {
	return String(html).replace(/<strong>(Reduced|Empowered):<\/strong>/g, (_match, label) => {
		const tip = INVOCATION_EFFECT_TOOLTIPS[label.toLowerCase()];
		return `<strong class="stonetop-invocation-effect-label" data-tooltip="${escHtml(tip)}" data-tooltip-direction="UP">${label}:</strong>`;
	});
}
