// Builds the shared view-model for a hazard card, used by all three renderers: the
// page sheet (view mode), the steading tab's Hazards section, and the on-canvas
// overlay. The hazard card deliberately reuses the threat card's markup conventions
// (.threat-card wrapper, .threat-portent__check doom boxes), so threat-view's shared
// wiring (doom toggles, drag-to-pin) works on hazard cards without a parallel set of
// handlers.
import { HAZARD_ACCENT, resolveDamageEffects, formatHazardDamage } from "./hazard-data.js";
import { hasText, stringList, buildDoomRows, buildImpending, buildCustomPlayerMoves, cardEnricher, asCardHtml } from "../journal/card-vm.js";

/** The hazard's book-style damage line ("1d10+2 (ignores armor, forceful)"), derived
 *  from the stored worksheet picks plus any free-form extras. */
export function hazardDamageLine(sys = {}) {
	const { tags, bonus } = resolveDamageEffects(sys.damageEffects ?? []);
	const extra = String(sys.damageExtra ?? "").split(",").map(t => t.trim()).filter(Boolean);
	return formatHazardDamage({
		die: sys.damageDie ?? "",
		bonus,
		tags: [...tags, ...extra.filter(t => !tags.includes(t))],
		certainDeath: !!sys.certainDeath,
	});
}

/**
 * View-model for one hazard page. Async because prose fields are enriched. Pass
 * `{ forOwner }` to force the owner/editable affordances (defaults to page.isOwner).
 */
export async function buildHazardCardVM(page, { forOwner } = {}) {
	const sys = page.system ?? {};
	// Enrich prose (resolve @UUID links, inline rolls) without revealing GM secret blocks.
	const enrich = cardEnricher();

	const doomRows = buildDoomRows(sys);
	const impending = buildImpending(sys);
	const gmMoves = stringList(sys.gmMoves);
	const customPlayerMoves = await buildCustomPlayerMoves(sys, enrich);

	const damage = hazardDamageLine(sys);

	return {
		id: page.id,
		uuid: page.uuid,
		name: page.name,
		accent: HAZARD_ACCENT,
		damage,
		hasDamage: hasText(damage),
		certainDeath: !!sys.certainDeath,
		instinct: String(sys.instinct ?? ""),
		hasInstinct: hasText(sys.instinct),
		// Written in the wizard's textarea; a hazard saved before that text was stored as
		// paragraphs is drawn with its line breaks all the same.
		description: await enrich(asCardHtml(sys.description)),
		hasDescription: hasText(sys.description),
		advanceTrigger: String(sys.advanceTrigger ?? ""),
		hasAdvanceTrigger: hasText(sys.advanceTrigger),
		doomRows,
		impendingDoom: impending,
		hasDoomTrack: doomRows.length > 0 || impending.hasText,
		gmMoves,
		hasGmMoves: gmMoves.length > 0,
		customPlayerMoves,
		hasCustomMoves: customPlayerMoves.length > 0,
		isOwner: forOwner ?? page.isOwner,
	};
}
